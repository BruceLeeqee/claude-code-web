// Unified public entry for Angular/Web consumers

// Canonical type exports
export * from './types/index.js';

// Canonical module exports
export * from './api/index.js';
export * from './context/index.js';
export * from './history/index.js';
export * from './tools/index.js';
export * from './skills/index.js';
export * from './plugins/index.js';
export * from './mcp/index.js';
export * from './coordinator/index.js';
export * from './assistant/index.js';
export * from './compact/index.js';
export * from './cost/index.js';
export * from './utils/index.js';
export * from './utils/storage.js';
export * from './schemas/index.js';
export * from './migrations/index.js';
export * from './services/index.js';

// Unified aliases requested by product/API design
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
