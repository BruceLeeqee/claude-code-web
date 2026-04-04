/**
 * 工具运行时：定义 Agent 工具形态、执行上下文、中间件与 `ToolDispatcher`（按名查找并调用 `run`，捕获异常为 ToolResult）。
 */
import type { JsonValue, ToolCall, ToolResult } from '../types/index.js';

/** 单次工具执行时的上下文（会话、可选 AbortSignal） */
export interface ToolExecutionContext {
  sessionId: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

/** 与 JSON Schema 子集兼容的工具入参描述 */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/** 注册到系统中的可调用工具 */
export interface AgentTool<TInput extends JsonValue = JsonValue, TOutput extends JsonValue = JsonValue> {
  name: string;
  description: string;
  inputSchema?: ToolSchema;
  enabled?: boolean;
  run(input: TInput, ctx: ToolExecutionContext): Promise<TOutput>;
}

/** 中间件链上传递的包：调用 + 上下文 */
export interface ToolExecutionEnvelope {
  call: ToolCall;
  context: ToolExecutionContext;
}

/** 洋葱模型中间件：可记录/改写/短路工具执行 */
export type ToolMiddleware = (env: ToolExecutionEnvelope, next: () => Promise<ToolResult>) => Promise<ToolResult>;

/** 将 `ToolCall` 分发给具体 `AgentTool` 并套用中间件 */
export class ToolDispatcher {
  constructor(
    private readonly getTool: (name: string) => AgentTool | undefined,
    private readonly middleware: ToolMiddleware[] = [],
  ) {}

  /** 查找工具、执行中间件链、调用 `run` 并标准化为 `ToolResult` */
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
