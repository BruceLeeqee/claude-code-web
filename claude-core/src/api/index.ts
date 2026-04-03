import type {
  ChatRequest,
  ChatResponse,
  ChatStreamResponse,
  JsonValue,
  StreamChunk,
  Usage,
} from '../types/index.js';
import { createJsonHeaders } from '../utils/index.js';

export interface ClaudeApiClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class ClaudeApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClaudeApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createMessage(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const init: RequestInit = {
      method: 'POST',
      headers: createJsonHeaders(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : undefined),
      body: JSON.stringify(request),
    };
    if (signal) init.signal = signal;

    const res = await this.fetchImpl(`${this.options.baseUrl}/v1/messages`, init);

    if (!res.ok) {
      throw new Error(`Claude API error: ${res.status}`);
    }

    return (await res.json()) as ChatResponse;
  }

  createMessageStream(request: ChatRequest): ChatStreamResponse {
    const controller = new AbortController();

    const stream = new ReadableStream<StreamChunk>({
      start: async (streamController) => {
        try {
          const res = await this.fetchImpl(`${this.options.baseUrl}/v1/messages:stream`, {
            method: 'POST',
            headers: createJsonHeaders(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : undefined),
            body: JSON.stringify(request),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            streamController.error(new Error(`Stream failed: ${res.status}`));
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            streamController.enqueue({ type: 'delta', textDelta: text });
          }

          streamController.enqueue({ type: 'done' });
          streamController.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown stream error';
          streamController.enqueue({ type: 'error', error: message });
          streamController.close();
        }
      },
      cancel: () => controller.abort(),
    });

    return {
      stream,
      cancel: () => controller.abort(),
    };
  }
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
