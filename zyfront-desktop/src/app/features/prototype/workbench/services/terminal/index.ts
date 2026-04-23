/**
 * 终端展示服务统一导出桶
 *
 * 基于 Claude Code 终端展示优化设计文档的完整实现，
 * 包含 M1~M6 所有里程碑的服务和类型。
 */

// ─── 类型 ──────────────────────────────────────────────────────

export {
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
  TERMINAL_SESSION_STORAGE_PREFIX,
} from './terminal-display.types';

// ─── M1: 终端宿主抽象 ──────────────────────────────────────────

export { TerminalSessionHostService } from './terminal-session-host.service';

// ─── M2: 思考块状态机 ──────────────────────────────────────────

export { ThinkingBlockStateMachineService } from './thinking-block-state-machine.service';

// ─── M3: 展示渲染改造 ──────────────────────────────────────────

export { TerminalBlockRendererService } from './terminal-block-renderer.service';

// ─── M4: 历史回放与实时流统一 ──────────────────────────────────

export {
  SessionReplayCoordinatorService,
  type ReplayFrame,
  type ReplaySessionSnapshot,
} from './session-replay-coordinator.service';

// ─── M5: Prompt/Memory/Terminal 三方联动 ────────────────────────

export {
  TurnMetadataService,
  type TurnCommandResult,
  type TurnMemorySnapshot,
  type TurnContext,
} from './turn-metadata.service';

export {
  CommandPresentationService,
  type PresentationTier,
  type PresentationFragment,
  type CommandPresentation,
} from './command-presentation.service';

// ─── M6: 调试报告 ──────────────────────────────────────────────

export {
  TerminalDisplayDebugService,
  type FullDebugReport,
} from './terminal-display-debug.service';
