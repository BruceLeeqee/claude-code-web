import type { JsonValue, ToolCall, ToolResult } from '../types/index.js';

export interface ToolExecutionContext {
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition<TInput extends JsonValue = JsonValue, TOutput extends JsonValue = JsonValue> {
  name: string;
  description: string;
  inputSchema?: unknown;
  run(input: TInput, ctx: ToolExecutionContext): Promise<TOutput>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(call: ToolCall, ctx: ToolExecutionContext = {}): Promise<ToolResult> {
    const tool = this.tools.get(call.toolName);
    if (!tool) {
      return {
        toolCallId: call.id,
        ok: false,
        output: null,
        error: `Tool not found: ${call.toolName}`,
      };
    }

    try {
      const output = await tool.run(call.input, ctx);
      return {
        toolCallId: call.id,
        ok: true,
        output,
      };
    } catch (error) {
      return {
        toolCallId: call.id,
        ok: false,
        output: null,
        error: error instanceof Error ? error.message : 'Unknown tool error',
      };
    }
  }
}
