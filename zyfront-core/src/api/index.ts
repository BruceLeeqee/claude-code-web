/**
 * Claude 兼容 API 客户端：请求 `/api/llm/messages` 与 `/api/llm/stream`（通常由本地 Bridge 转发），
 * 核心功能：模块导出清单 (Barrel File)。
 * 作用：作为该目录的统一出口，将上述三个文件中的核心类、函数、类型（如 Anthropic 客户端、MessageStream、SSEDecoder 等）统一导出，
 *       方便外部通过单一路径 import ... from './api" 引用，避免深层路径导入。
 */
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
  feedSseChunkWithLinesExtended,
  flushSseBufferWithLinesExtended,
  ThinkingTagTracker,
  type SseLineBuffer,
  type SseStreamCallbacks,
} from './anthropic-sse.js';

/** `bootstrapClaudeApi` 使用的最小配置 */
export interface ClaudeApiBootstrapConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel: ModelConfig;
  proxy?: ProxyConfig;
}

/** 客户端构造选项（可注入自定义 fetch） */
export interface ClaudeApiClientOptions extends ClaudeApiBootstrapConfig {
  fetchImpl?: typeof fetch;
}

/** 单次请求的 AbortSignal 与模型覆盖 */
export interface ApiRequestOptions {
  signal?: AbortSignal;
  modelOverride?: Partial<ModelConfig>;
}

/** DeepSeek 要求工具名匹配 ^[a-zA-Z0-9_-]+$，用双下划线替代点号以保持可逆 */
const DEEPSEEK_TOOL_NAME_SEP = '__';

/** 通过 Bridge 或直连访问 LLM，支持 Anthropic 兼容 JSON 与 SSE 流 */
export class ClaudeApiClient {
  private readonly fetchImpl: typeof fetch;
  private activeModel: ModelConfig;
  private currentBaseUrl: string;
  private currentApiKey: string | undefined;
  private currentProxy: ProxyConfig | undefined;
  /** DeepSeek 工具名映射：sanitizedName → originalName */
  private deepseekToolNameMap: Map<string, string> = new Map();

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

  /** 当前生效的模型配置快照 */
  getModel(): ModelConfig {
    return this.activeModel;
  }

  /** 合并更新当前模型参数并返回新快照 */
  switchModel(config: Partial<ModelConfig>): ModelConfig {
    this.activeModel = {
      ...this.activeModel,
      ...config,
    };
    return this.activeModel;
  }

  /** 运行时热更新基址、Key、代理与模型（供设置页同步） */
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

  /** 非流式创建消息，解析 Anthropic 兼容响应中的文本与 tool_use */
  async createMessage(request: Omit<ChatRequest, 'config'> & { config?: ModelConfig }, opts: ApiRequestOptions = {}): Promise<ChatResponse> {
    const activeConfig: ModelConfig = {
      ...(request.config ?? this.activeModel),
      ...(opts.modelOverride ?? {}),
    };

    const endpoint = this.resolveMessageEndpoint(activeConfig, false);
    const res = await this.fetchImpl(this.resolveUrl(endpoint), {
      method: 'POST',
      headers: this.resolveHeaders(activeConfig),
      body: JSON.stringify(this.resolveRequestBody(request, activeConfig)),
      signal: opts.signal ?? null,
    });

    if (!res.ok) {
      const bodySnippet = await this.readErrorBodySnippet(res);
      throw new Error(`Claude API error: ${res.status}${bodySnippet ? ` - ${bodySnippet}` : ''}`);
    }
    const raw = (await res.json()) as JsonValue;
    if (!this.isAnthropicCompatible(activeConfig)) {
      return raw as unknown as ChatResponse;
    }

    const turn = parseAnthropicMessageJson(raw);
    // DeepSeek: 还原被清理的工具名
    if (this.isDeepseekProvider(activeConfig)) {
      for (const tc of turn.toolCalls) {
        tc.toolName = this.restoreDeepseekToolName(tc.toolName);
      }
      for (const block of turn.assistantContentBlocks) {
        if (block && typeof block === 'object' && !Array.isArray(block)) {
          const b = block as Record<string, unknown>;
          if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
            b['name'] = this.restoreDeepseekToolName(b['name'] as string);
          }
        }
      }
    }
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

  /** 流式创建消息：兼容体走 SSE 累积器并最终发出 `anthropic_turn` */
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

          const streamEndpoint = this.resolveMessageEndpoint(activeConfig, true);
          const res = await this.fetchStreamWithRetry(this.resolveUrl(streamEndpoint), {
            method: 'POST',
            headers: streamHeaders,
            body: JSON.stringify(streamBody),
            signal: opts.signal ?? abortController.signal,
          });

          if (!res.ok || !res.body) {
            const bodySnippet = await this.readErrorBodySnippet(res);
            controller.enqueue({
              type: 'error',
              error: `Stream request failed: ${res.status}${bodySnippet ? ` - ${bodySnippet}` : ''}`,
            });
            controller.close();
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();

          if (this.isAnthropicCompatible(activeConfig)) {
            const sse: SseLineBuffer = { remainder: '' };
            const acc = new AnthropicSseTurnAccumulator();
            const tagTracker = new ThinkingTagTracker();
            const onLine = (line: string) => acc.consumeLine(line);
            const push = (t: string) => {
              const result = tagTracker.feed(t);
              for (const b of result.boundaries) {
                controller.enqueue({ type: b.type, blockIndex: b.blockIndex });
              }
              if (result.thinking) controller.enqueue({ type: 'thinking_delta', textDelta: result.thinking });
              if (result.answer) controller.enqueue({ type: 'delta', textDelta: result.answer });
            };
            const pushThinking = (t: string) => controller.enqueue({ type: 'thinking_delta', textDelta: t });
            const pushBoundary = (e: { type: 'thinking_start' | 'thinking_done'; blockIndex: number }) => {
              controller.enqueue({ type: e.type, blockIndex: e.blockIndex });
            };
            const callbacks: SseStreamCallbacks = {
              onTextDelta: push,
              onThinkingDelta: pushThinking,
              onThinkingBoundary: pushBoundary,
              onSseLine: onLine,
            };
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value, { stream: true });
              if (text.length > 0) feedSseChunkWithLinesExtended(sse, text, callbacks);
            }
            flushSseBufferWithLinesExtended(sse, callbacks);
            const flushResult = tagTracker.flush();
            for (const b of flushResult.boundaries) {
              controller.enqueue({ type: b.type, blockIndex: b.blockIndex });
            }
            if (flushResult.thinking) controller.enqueue({ type: 'thinking_delta', textDelta: flushResult.thinking });
            if (flushResult.answer) controller.enqueue({ type: 'delta', textDelta: flushResult.answer });
            const turn = acc.finalize();
            // DeepSeek: 还原被清理的工具名
            if (this.isDeepseekProvider(activeConfig)) {
              for (const tc of turn.toolCalls) {
                tc.toolName = this.restoreDeepseekToolName(tc.toolName);
              }
              for (const block of turn.assistantContentBlocks) {
                if (block && typeof block === 'object' && !Array.isArray(block)) {
                  const b = block as Record<string, unknown>;
                  if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
                    b['name'] = this.restoreDeepseekToolName(b['name'] as string);
                  }
                }
              }
            }
            controller.enqueue({ type: 'anthropic_turn', turn });
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

  /** 流式请求轻量重试：覆盖网络抖动、429、5xx 等短暂失败 */
  private async fetchStreamWithRetry(url: string, init: RequestInit): Promise<Response> {
    const maxAttempts = 3;
    const baseDelayMs = 350;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await this.fetchImpl(url, init);
        if (res.ok || !this.shouldRetryStreamStatus(res.status) || attempt >= maxAttempts) {
          return res;
        }
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !this.shouldRetryStreamError(error)) {
          throw error;
        }
      }

      const jitter = Math.floor(Math.random() * 120);
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await this.sleep(delayMs);
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('Stream request failed after retries');
  }

  private shouldRetryStreamStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  private shouldRetryStreamError(error: unknown): boolean {
    if (!(error instanceof Error)) return true;
    const msg = (error.message || '').toLowerCase();
    return (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('timeout') ||
      msg.includes('abort') ||
      msg.includes('socket') ||
      msg.includes('tls') ||
      msg.includes('handshake')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async readErrorBodySnippet(res: Response): Promise<string> {
    try {
      const raw = await res.text();
      if (!raw) return '';
      return raw.replace(/\s+/g, ' ').trim().slice(0, 320);
    } catch {
      return '';
    }
  }

  /** 解析真实请求 URL（是否走代理 baseUrl） */
  private resolveUrl(path: string): string {
    const base = this.currentProxy?.enabled ? this.currentProxy.baseUrl : this.currentBaseUrl;
    const normalizedBase = base.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  /** 根据模型兼容性选择消息接口路径 */
  private resolveMessageEndpoint(config: ModelConfig, stream: boolean): string {
    if (this.isAnthropicCompatible(config)) {
      return '/v1/messages';
    }
    return stream ? '/api/llm/stream' : '/api/llm/messages';
  }

  /** 非流式请求头：Anthropic 系用 x-api-key，DeepSeek 用 Bearer，其余 Bearer */
  private resolveHeaders(config: ModelConfig): HeadersInit {
    const apiKey = this.currentApiKey;
    const common = {
      ...(this.currentProxy?.headers ?? {}),
    };

    if (!apiKey) return createJsonHeaders(common);

    if (this.isAnthropicCompatible(config)) {
      // DeepSeek 虽然走 Anthropic 兼容协议体，但认证要求 Authorization: Bearer
      if (this.isDeepseekProvider(config)) {
        return createJsonHeaders({
          ...common,
          Authorization: `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01',
        });
      }
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

  /** 在兼容体请求体上附加 `stream: true` */
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

  /** 流式请求头：兼容体需 Accept: text/event-stream */
  private resolveStreamHeaders(config: ModelConfig): HeadersInit {
    const base = this.resolveHeaders(config);
    if (!this.isAnthropicCompatible(config)) return base;
    return { ...base, Accept: 'text/event-stream' };
  }

  /** 组装 POST JSON：Anthropic 消息数组或通用透传 */
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
      if (config.thinking !== undefined) body['thinking'] = config.thinking as JsonValue;
      if (this.isDeepseekProvider(config) && config.thinking?.type === 'enabled') {
        body['output_config'] = { effort: 'max' } as JsonValue;
      }
      if (this.isMiniMaxProvider(config) && config.thinking?.type === 'enabled') {
        body['reasoning_split'] = true as JsonValue;
      }
      if (request.tools && request.tools.length > 0) {
        body['tools'] = this.isDeepseekProvider(config)
          ? this.sanitizeDeepseekTools(request.tools)
          : request.tools as JsonValue;
      }
      if (this.isDeepseekProvider(config)) {
        this.sanitizeDeepseekRequestBody(body);
      }
      // 兜底：无论 tools 来自哪个层，DeepSeek 请求体中所有 tool/function.name 必须是安全字符集
      if (this.isDeepseekProvider(config)) {
        this.normalizeDeepseekToolNamesInObject(body);
      }
      // DeepSeek: 历史消息中 tool_use 块的 name 也需清理
      if (this.isDeepseekProvider(config) && this.deepseekToolNameMap.size > 0) {
        this.sanitizeDeepseekMessageNames(body);
      }
      return body as JsonValue;
    }

    return {
      ...request,
      config,
    } as unknown as JsonValue;
  }

  /** 对请求体 messages 中历史 tool_use 块的 name 做清理（替换 . → __） */
  private sanitizeDeepseekMessageNames(body: Record<string, JsonValue>): void {
    const messages = body['messages'];
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;
      const content = (msg as Record<string, unknown>)['content'];
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
        const b = block as Record<string, unknown>;
        if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
          const name = b['name'] as string;
          if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            b['name'] = name.replace(/\./g, DEEPSEEK_TOOL_NAME_SEP);
          }
        }
      }
    }
  }

  /** 递归兜底：任何对象中出现的 name/function.name 都清洗 */
  private normalizeDeepseekToolNamesInObject(value: JsonValue): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const obj = value as Record<string, JsonValue>;
    for (const [key, child] of Object.entries(obj)) {
      if (key === 'name' && typeof child === 'string' && !/^[a-zA-Z0-9_-]+$/.test(child)) {
        const sanitized = child.replace(/\./g, DEEPSEEK_TOOL_NAME_SEP);
        this.deepseekToolNameMap.set(sanitized, child);
        obj[key] = sanitized;
        continue;
      }
      if (key === 'function' && child && typeof child === 'object' && !Array.isArray(child)) {
        this.normalizeDeepseekToolNamesInObject(child);
        continue;
      }
      this.normalizeDeepseekToolNamesInObject(child);
    }
  }

  /** 额外清洗 DeepSeek 请求体内的 tools / tool_choice 等结构 */
  private sanitizeDeepseekRequestBody(body: Record<string, JsonValue>): void {
    this.sanitizeDeepseekMessageNames(body);
    this.normalizeDeepseekToolNamesInObject(body['tools'] as JsonValue);
    this.normalizeDeepseekToolNamesInObject(body['tool_choice'] as JsonValue);
    this.normalizeDeepseekToolNamesInObject(body['messages'] as JsonValue);
  }

  /** 对 DeepSeek 不兼容的工具名做 . → __ 替换，并缓存映射以便响应时还原 */
  private sanitizeDeepseekTools(tools: JsonArray): JsonArray {
    this.deepseekToolNameMap.clear();
    return tools.map((t) => this.sanitizeDeepseekToolNode(t));
  }

  private sanitizeDeepseekToolNode(node: JsonValue): JsonValue {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const obj = node as Record<string, JsonValue>;
    const next: Record<string, JsonValue> = { ...obj };

    const directName = typeof obj['name'] === 'string' ? (obj['name'] as string) : '';
    if (directName && !/^[a-zA-Z0-9_-]+$/.test(directName)) {
      const sanitized = directName.replace(/\./g, DEEPSEEK_TOOL_NAME_SEP);
      this.deepseekToolNameMap.set(sanitized, directName);
      next['name'] = sanitized;
    }

    const functionNode = obj['function'];
    if (functionNode && typeof functionNode === 'object' && !Array.isArray(functionNode)) {
      const fn = functionNode as Record<string, JsonValue>;
      const fnNext: Record<string, JsonValue> = { ...fn };
      const fnName = typeof fn['name'] === 'string' ? (fn['name'] as string) : '';
      if (fnName && !/^[a-zA-Z0-9_-]+$/.test(fnName)) {
        const sanitized = fnName.replace(/\./g, DEEPSEEK_TOOL_NAME_SEP);
        this.deepseekToolNameMap.set(sanitized, fnName);
        fnNext['name'] = sanitized;
      }
      next['function'] = fnNext as JsonValue;
    }

    return next as JsonValue;
  }

  /** 将响应中 DeepSeek 清理过的工具名还原为原始名 */
  private restoreDeepseekToolName(name: string): string {
    return this.deepseekToolNameMap.get(name) ?? name;
  }

  /** 是否按 Anthropic Messages API 形状序列化/解析 */
  private isAnthropicCompatible(config: ModelConfig): boolean {
    const model = config.model.toLowerCase();
    return config.provider === 'anthropic' || config.provider === 'minimax' || config.provider === 'deepseek' || model.includes('minimax') || model.includes('abab') || model.includes('deepseek');
  }

  /** 是否为 MiniMax 提供商 */
  private isMiniMaxProvider(config: ModelConfig): boolean {
    return config.provider === 'minimax' || config.model.toLowerCase().includes('minimax');
  }

  /** 是否为 DeepSeek 提供商（需要 Bearer 认证而非 x-api-key） */
  private isDeepseekProvider(config: ModelConfig): boolean {
    return config.provider === 'deepseek' || config.model.toLowerCase().includes('deepseek');
  }
}

/** 工厂：创建默认配置的 `ClaudeApiClient` */
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

/** 用字符长度粗略估算 token（非精确） */
export function estimateUsageFromText(input: string, output: string): Usage {
  const roughToken = (t: string) => Math.ceil(t.length / 4);
  return {
    inputTokens: roughToken(input),
    outputTokens: roughToken(output),
  };
}

/** 安全 JSON 解析，失败时返回 `{ raw }` 占位 */
export function safeJsonParse(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return { raw };
  }
}
