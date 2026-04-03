import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamResponse,
  JsonArray,
  JsonValue,
  ModelConfig,
  ProxyConfig,
  StreamChunk,
  Usage,
} from '../types/index.js';
import { createJsonHeaders } from '../utils/index.js';
import {
  ANTHROPIC_WIRE_KEY,
  parseAnthropicMessageJson,
  toAnthropicApiMessage,
} from './anthropic-messages.js';
import { AnthropicSseTurnAccumulator } from './anthropic-stream.js';
import {
  feedSseChunkWithLines,
  flushSseBufferWithLines,
  type SseLineBuffer,
} from './anthropic-sse.js';

export interface ClaudeApiBootstrapConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel: ModelConfig;
  proxy?: ProxyConfig;
}

export interface ClaudeApiClientOptions extends ClaudeApiBootstrapConfig {
  fetchImpl?: typeof fetch;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
  modelOverride?: Partial<ModelConfig>;
}

export class ClaudeApiClient {
  private readonly fetchImpl: typeof fetch;
  private activeModel: ModelConfig;
  private currentBaseUrl: string;
  private currentApiKey: string | undefined;
  private currentProxy: ProxyConfig | undefined;

  constructor(private readonly options: ClaudeApiClientOptions) {
    const fallbackFetch = globalThis.fetch?.bind(globalThis);
    this.fetchImpl = options.fetchImpl ?? fallbackFetch;
    if (!this.fetchImpl) {
      throw new Error('No fetch implementation available');
    }
    this.activeModel = options.defaultModel;
    this.currentBaseUrl = options.baseUrl;
    this.currentApiKey = options.apiKey;
    this.currentProxy = options.proxy;
  }

  getModel(): ModelConfig {
    return this.activeModel;
  }

  switchModel(config: Partial<ModelConfig>): ModelConfig {
    this.activeModel = {
      ...this.activeModel,
      ...config,
    };
    return this.activeModel;
  }

  configureRuntime(config: {
    baseUrl?: string;
    apiKey?: string;
    proxy?: ProxyConfig;
    model?: Partial<ModelConfig>;
  }): void {
    if (config.baseUrl) this.currentBaseUrl = config.baseUrl;
    if (typeof config.apiKey === 'string') this.currentApiKey = config.apiKey;
    if (config.proxy) this.currentProxy = config.proxy;
    if (config.model) this.switchModel(config.model);
  }

  async createMessage(request: Omit<ChatRequest, 'config'> & { config?: ModelConfig }, opts: ApiRequestOptions = {}): Promise<ChatResponse> {
    const activeConfig: ModelConfig = {
      ...(request.config ?? this.activeModel),
      ...(opts.modelOverride ?? {}),
    };

    const res = await this.fetchImpl(this.resolveUrl('/api/llm/messages'), {
      method: 'POST',
      headers: this.resolveHeaders(activeConfig),
      body: JSON.stringify(this.resolveRequestBody(request, activeConfig)),
      signal: opts.signal ?? null,
    });

    if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
    const raw = (await res.json()) as JsonValue;
    if (!this.isAnthropicCompatible(activeConfig)) {
      return raw as unknown as ChatResponse;
    }

    const turn = parseAnthropicMessageJson(raw);
    const rawObj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const apiId = typeof rawObj['id'] === 'string' ? rawObj['id'] : `asst_${Date.now()}`;

    const blocks =
      turn.assistantContentBlocks.length > 0
        ? turn.assistantContentBlocks
        : ([{ type: 'text', text: turn.assistantText || '' }] as JsonArray);

    const message: ChatMessage = {
      id: apiId,
      role: 'assistant',
      content:
        turn.assistantText || (turn.toolCalls.length > 0 ? '（已请求本地工具执行）' : ''),
      timestamp: Date.now(),
      metadata: {
        [ANTHROPIC_WIRE_KEY]: { role: 'assistant', content: blocks },
      },
    };

    const out: ChatResponse = {
      message,
      raw,
      stopReason: turn.stopReason,
      toolCalls: turn.toolCalls,
    };
    if (turn.usage !== undefined) out.usage = turn.usage;
    return out;
  }

  createMessageStream(request: Omit<ChatRequest, 'config'> & { config?: ModelConfig }, opts: ApiRequestOptions = {}): ChatStreamResponse {
    const abortController = new AbortController();

    const stream = new ReadableStream<StreamChunk>({
      start: async (controller) => {
        try {
          const activeConfig: ModelConfig = {
            ...(request.config ?? this.activeModel),
            ...(opts.modelOverride ?? {}),
          };

          const streamBody = this.resolveStreamRequestBody(request, activeConfig);
          const streamHeaders = this.resolveStreamHeaders(activeConfig);

          const res = await this.fetchImpl(this.resolveUrl('/api/llm/stream'), {
            method: 'POST',
            headers: streamHeaders,
            body: JSON.stringify(streamBody),
            signal: opts.signal ?? abortController.signal,
          });

          if (!res.ok || !res.body) {
            controller.enqueue({ type: 'error', error: `Stream request failed: ${res.status}` });
            controller.close();
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();

          if (this.isAnthropicCompatible(activeConfig)) {
            const sse: SseLineBuffer = { remainder: '' };
            const acc = new AnthropicSseTurnAccumulator();
            const onLine = (line: string) => acc.consumeLine(line);
            const push = (t: string) => controller.enqueue({ type: 'delta', textDelta: t });
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value, { stream: true });
              if (text.length > 0) feedSseChunkWithLines(sse, text, push, onLine);
            }
            flushSseBufferWithLines(sse, push, onLine);
            controller.enqueue({ type: 'anthropic_turn', turn: acc.finalize() });
          } else {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value, { stream: true });
              if (text.length > 0) controller.enqueue({ type: 'delta', textDelta: text });
            }
          }

          controller.enqueue({ type: 'done' });
          controller.close();
        } catch (error) {
          controller.enqueue({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown stream error',
          });
          controller.close();
        }
      },
      cancel: () => abortController.abort(),
    });

    return {
      stream,
      cancel: () => abortController.abort(),
    };
  }

  private resolveUrl(path: string): string {
    if (!this.currentProxy?.enabled) return `${this.currentBaseUrl}${path}`;
    return `${this.currentProxy.baseUrl}${path}`;
  }

  private resolveHeaders(config: ModelConfig): HeadersInit {
    const apiKey = this.currentApiKey;
    const common = {
      ...(this.currentProxy?.headers ?? {}),
    };

    if (!apiKey) return createJsonHeaders(common);

    if (this.isAnthropicCompatible(config)) {
      return createJsonHeaders({
        ...common,
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      });
    }

    return createJsonHeaders({
      ...common,
      Authorization: `Bearer ${apiKey}`,
    });
  }

  /** Same as a normal message body plus stream: true for Anthropic-compatible providers (single /v1/messages endpoint). */
  private resolveStreamRequestBody(
    request: Omit<ChatRequest, 'config'> & { config?: ModelConfig },
    config: ModelConfig,
  ): JsonValue {
    const base = this.resolveRequestBody(request, config);
    if (!this.isAnthropicCompatible(config) || base === null || typeof base !== 'object' || Array.isArray(base)) {
      return base;
    }
    return { ...(base as Record<string, JsonValue>), stream: true };
  }

  private resolveStreamHeaders(config: ModelConfig): HeadersInit {
    const base = this.resolveHeaders(config);
    if (!this.isAnthropicCompatible(config)) return base;
    return { ...base, Accept: 'text/event-stream' };
  }

  private resolveRequestBody(request: Omit<ChatRequest, 'config'> & { config?: ModelConfig }, config: ModelConfig): JsonValue {
    if (this.isAnthropicCompatible(config)) {
      const body: Record<string, JsonValue> = {
        model: config.model,
        messages: request.messages.map((m) => toAnthropicApiMessage(m)) as JsonValue,
        max_tokens: config.maxTokens ?? 1024,
        temperature: config.temperature ?? 0.2,
      };
      if (config.topP !== undefined) body['top_p'] = config.topP;
      if (config.stopSequences !== undefined) body['stop_sequences'] = config.stopSequences as JsonValue;
      if (request.systemPrompt) body['system'] = request.systemPrompt;
      if (request.tools && request.tools.length > 0) body['tools'] = request.tools as JsonValue;
      return body as JsonValue;
    }

    return {
      ...request,
      config,
    } as unknown as JsonValue;
  }

  private isAnthropicCompatible(config: ModelConfig): boolean {
    const model = config.model.toLowerCase();
    return config.provider === 'anthropic' || config.provider === 'minimax' || model.includes('minimax') || model.includes('abab');
  }
}

export function bootstrapClaudeApi(config: ClaudeApiBootstrapConfig, fetchImpl?: typeof fetch): ClaudeApiClient {
  return new ClaudeApiClient(
    fetchImpl
      ? {
          ...config,
          fetchImpl,
        }
      : {
          ...config,
        },
  );
}

export function estimateUsageFromText(input: string, output: string): Usage {
  const roughToken = (t: string) => Math.ceil(t.length / 4);
  return {
    inputTokens: roughToken(input),
    outputTokens: roughToken(output),
  };
}

export function safeJsonParse(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return { raw };
  }
}
