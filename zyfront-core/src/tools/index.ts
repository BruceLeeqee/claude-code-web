/**
 * 工具注册表：维护 name → AgentTool 映射，支持中间件并委托 `ToolDispatcher` 执行。
 */
import type { ToolCall, ToolResult } from '../types/index.js';
import type { AgentTool, ToolExecutionContext, ToolMiddleware } from './Tool.js';
import { ToolDispatcher } from './Tool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private middleware: ToolMiddleware[] = [];

  /** 注册或覆盖同名工具 */
  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /** 按名称移除工具 */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** 返回当前已注册工具列表快照 */
  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  /** 追加一层工具中间件（按注册顺序包裹） */
  use(middleware: ToolMiddleware): void {
    this.middleware = [...this.middleware, middleware];
  }

  /** 执行一次模型下发的工具调用 */
  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    const dispatcher = new ToolDispatcher((name) => this.tools.get(name), this.middleware);
    return dispatcher.dispatch(call, context);
  }
}

export type { AgentTool, ToolExecutionContext, ToolMiddleware } from './Tool.js';
