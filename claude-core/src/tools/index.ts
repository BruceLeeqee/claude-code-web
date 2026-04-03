import type { ToolCall, ToolResult } from '../types/index.js';
import type { AgentTool, ToolExecutionContext, ToolMiddleware } from './Tool.js';
import { ToolDispatcher } from './Tool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private middleware: ToolMiddleware[] = [];

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  use(middleware: ToolMiddleware): void {
    this.middleware = [...this.middleware, middleware];
  }

  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    const dispatcher = new ToolDispatcher((name) => this.tools.get(name), this.middleware);
    return dispatcher.dispatch(call, context);
  }
}

export type { AgentTool, ToolExecutionContext, ToolMiddleware } from './Tool.js';
