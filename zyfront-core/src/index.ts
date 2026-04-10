/**
 * zyfront-core 对外统一入口（供 Angular / Web 等消费）。
 * 汇总类型、API、上下文、历史、工具、技能、插件、协调器、Assistant 等子模块，并导出产品层别名。
 */

// 类型导出
export * from './types/index.js';

// 各功能模块导出
export * from './api/index.js';
export * from './context/index.js';
export * from './history/index.js';
export * from './tools/index.js';
export * from './skills/index.js';
export * from './plugins/index.js';
export * from './prompt/index.js';
export * from './mcp/index.js';
export * from './voice/index.js';
export * from './vim/index.js';
export * from './memdir/index.js';
export * from './transport/index.js';
export * from './coordinator/index.js';
export * from './assistant/index.js';
export * from './compact/index.js';
export * from './cost/index.js';
export * from './utils/index.js';
export * from './utils/storage.js';
export * from './schemas/index.js';
export * from './migrations/index.js';
export * from './services/index.js';

// 产品/API 设计所需的统一别名（如 ToolRegistry → ToolSystem）
export { ClaudeApiClient as ClaudeClient, bootstrapClaudeApi } from './api/index.js';
export { ContextManager } from './context/index.js';
export { PersistentHistoryStore as HistoryManager, InMemoryHistoryStore } from './history/index.js';
export { ToolRegistry as ToolSystem } from './tools/index.js';
export { CoordinatorEngine as PlanEngine, CoordinatorEngine as Coordinator } from './coordinator/index.js';
export { SkillRegistry as SkillSystem } from './skills/index.js';
export { PluginManager as PluginSystem } from './plugins/index.js';
export { MCPClient } from './mcp/index.js';
export { SessionCompactor as Compactor } from './compact/index.js';
export { CostTracker } from './cost/index.js';
