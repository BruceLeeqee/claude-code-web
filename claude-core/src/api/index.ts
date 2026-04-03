import type {
  ChatRequest,
  ChatResponse,
  ChatStreamResponse,
  JsonValue,
  ModelConfig,
  ProxyConfig,
  StreamChunk,
  Usage,
} from '../types/index.js';
import { createJsonHeaders } from '../utils/index.js';

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

  constructor(private readonly options: ClaudeApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.activeModel = options.defaultModel;
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

  async createMessage(request: Omit<ChatRequest, 'config'> & { config?: ModelConfig }, opts: ApiRequestOptions = {}): Promise<ChatResponse> {
    const res = await this.fetchImpl(this.resolveUrl('/v1/messages'), {
      method: 'POST',
      headers: this.resolveHeaders(),
      body: JSON.stringify({
        ...request,
        config: {
          ...(request.config ?? this.activeModel),
          ...(opts.modelOverride ?? {}),
        },
      }),
      signal: opts.signal ?? null,
    });

    if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
    return (await res.json()) as ChatResponse;
  }

  createMessageStream(request: Omit<ChatRequest, 'config'> & { config?: ModelConfig }, opts: ApiRequestOptions = {}): ChatStreamResponse {
    const abortController = new AbortController();

    const stream = new ReadableStream<StreamChunk>({
      start: async (controller) => {
        try {
          const res = await this.fetchImpl(this.resolveUrl('/v1/messages:stream'), {
            method: 'POST',
            headers: this.resolveHeaders(),
            body: JSON.stringify({
              ...request,
              config: {
                ...(request.config ?? this.activeModel),
                ...(opts.modelOverride ?? {}),
              },
            }),
            signal: opts.signal ?? abortController.signal,
          });

          if (!res.ok || !res.body) {
            controller.enqueue({ type: 'error', error: `Stream request failed: ${res.status}` });
            controller.close();
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            if (text.length > 0) controller.enqueue({ type: 'delta', textDelta: text });
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
    if (!this.options.proxy?.enabled) return `${this.options.baseUrl}${path}`;
    return `${this.options.proxy.baseUrl}${path}`;
  }

  private resolveHeaders(): HeadersInit {
    return createJsonHeaders({
      ...(this.options.proxy?.headers ?? {}),
      ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
    });
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
