export { CommandRouterService } from './command-router.service';
export { CommandExecutorService } from './command-executor.service';
export { CommandProcessingService } from './command-processing.service';
export { InputPreprocessorService } from './input-preprocessor.service';
export {
  parseSlashCommand,
  parseDirectiveWithValidation,
  formatDirectiveHelp,
  formatGroupedHelp,
  getCommandSuggestions,
  resolveCommandName,
  type ParseResult,
} from './directive-parser';
export {
  DIRECTIVE_REGISTRY,
  parseDirective,
  findDirectiveDefinition,
  getModeDirectives,
  getVisibleDirectives,
  getDirectivesByGroup,
  formatDirectiveUsage,
  isBridgeSafeDirectiveName,
  type DirectiveDefinition,
  type DirectiveGroup,
  type DirectiveKind,
  type ParsedDirective,
} from './directive-registry';
export {
  type CommandRoute,
  type RouteOptions,
  type RouteResult,
  type RoutingContext,
} from './command-routing.types';

// ─── 终端展示优化服务（M1~M6） ────────────────────────────
export {
  // 类型
  type ThinkingBlockStatus,
  type ThinkingBlockMeta,
  type ThinkingBlockIndexEntry,
  type ThinkingExpandedRange,
  type BlockAnchor,
  type ReplayMode,
  type TerminalDisplayMode,
  type TerminalPanelMode,
  type TerminalSessionState,
  type TerminalPanelTransition,
  type TurnMetadata,
  type BlockRenderCommand,
  type BlockRenderAction,
  type TerminalDisplayDebugReport,
  THINKING_BLOCK_TRANSITIONS,
  THINKING_BLOCK_VERSION,
  THINKING_BLOCKS_SESSION_KEY,
  REPLAY_STATE_SESSION_KEY,
  MAX_THINKING_BLOCKS,
  MAX_THINKING_MARKERS,
  // M1: 终端宿主抽象
  TerminalSessionHostService,
  // M2: 思考块状态机
  ThinkingBlockStateMachineService,
  // M3: 展示渲染改造
  TerminalBlockRendererService,
  // M4: 历史回放与实时流统一
  SessionReplayCoordinatorService,
  type ReplayFrame,
  type ReplaySessionSnapshot,
  // M5: Prompt/Memory/Terminal 三方联动
  TurnMetadataService,
  type TurnCommandResult,
  type TurnMemorySnapshot,
  type TurnContext,
  CommandPresentationService,
  type PresentationTier,
  type PresentationFragment,
  type CommandPresentation,
  // M6: 调试报告
  TerminalDisplayDebugService,
  type FullDebugReport,
} from './services/terminal';
