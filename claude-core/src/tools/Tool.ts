import type { JsonValue, ToolCall, ToolResult } from '../types/index.js';

export interface ToolExecutionContext {
  sessionId: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface AgentTool<TInput extends JsonValue = JsonValue, TOutput extends JsonValue = JsonValue> {
  name: string;
  description: string;
  inputSchema?: ToolSchema;
  enabled?: boolean;
  run(input: TInput, ctx: ToolExecutionContext): Promise<TOutput>;
}

export interface ToolExecutionEnvelope {
  call: ToolCall;
  context: ToolExecutionContext;
}

export type ToolMiddleware = (env: ToolExecutionEnvelope, next: () => Promise<ToolResult>) => Promise<ToolResult>;

export class ToolDispatcher {
  constructor(
    private readonly getTool: (name: string) => AgentTool | undefined,
    private readonly middleware: ToolMiddleware[] = [],
  ) {}

  async dispatch(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.getTool(call.toolName);
    if (!tool || tool.enabled === false) {
      return {
        toolCallId: call.id,
        ok: false,
        output: null,
        error: `Tool unavailable: ${call.toolName}`,
      };
    }

    const env: ToolExecutionEnvelope = { call, context };
    let idx = -1;

    const runner = async (): Promise<ToolResult> => {
      const output = await tool.run(call.input, context);
      return {
        toolCallId: call.id,
        ok: true,
        output,
      };
    };

    const invoke = async (): Promise<ToolResult> => {
      idx += 1;
      const layer = this.middleware[idx];
      if (!layer) return runner();
      return layer(env, invoke);
    };

    try {
      return await invoke();
    } catch (error) {
      return {
        toolCallId: call.id,
        ok: false,
        output: null,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      };
    }
  }
}
