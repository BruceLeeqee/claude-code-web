/**
 * 终端展示统一类型定义
 *
 * 基于 Claude Code 终端展示优化设计文档（§8 展示状态模型设计），
 * 定义思考块元数据、状态迁移、锚点模型、回放模式等核心类型。
 */

import type { IMarker } from 'xterm';

// ─── 思考块展示状态 ───────────────────────────────────────────

/** 思考块的四种展示状态（§8.1 状态迁移） */
export type ThinkingBlockStatus =
  | 'collapsed'           // 默认折叠态：显示简洁提示 + 快捷键
  | 'expanded'            // 完整展开态：显示完整思考文本
  | 'inline-expanded'     // 行内展开态：在终端中展开（overlay 式）
  | 'historical-hidden';  // 历史回放隐藏态：紧凑回放时不展示

/** 状态迁移映射表 */
export const THINKING_BLOCK_TRANSITIONS: Record<ThinkingBlockStatus, ThinkingBlockStatus[]> = {
  collapsed:        ['expanded', 'inline-expanded', 'historical-hidden'],
  expanded:         ['collapsed'],
  'inline-expanded': ['collapsed'],
  'historical-hidden': ['collapsed'],
};

// ─── 锚点三层模型 ─────────────────────────────────────────────

/**
 * 块级锚点：marker / buffer / logical block 三层定位（§9.2）
 *
 * 优先级：block marker > block id > 最近已知 buffer range > 文本前缀匹配
 */
export interface BlockAnchor {
  /** xterm marker（最优先） */
  marker?: IMarker;
  /** marker 对应的 buffer 绝对行号快照（marker 异步就绪前用） */
  markerLineSnapshot?: number;
  /** 最近一次已知的 buffer 行范围 */
  bufferRange?: { first: number; last: number };
  /** 折叠标签文本（用于文本前缀匹配兜底） */
  foldTagText?: string;
}

// ─── 思考块元数据 ─────────────────────────────────────────────

/**
 * 思考块完整元数据（§8）
 *
 * 与终端 buffer 解耦的纯数据模型，所有展示操作以此为唯一数据源。
 */
export interface ThinkingBlockMeta {
  /** 全局唯一编号 */
  id: number;
  /** 归属会话 ID */
  sessionId: string;
  /** 归属轮次 ID */
  turnId: string;
  /** 原始思考内容（完整文本） */
  text: string;
  /** 折叠态摘要（默认显示的简短提示） */
  summary: string;
  /** 当前展示状态 */
  status: ThinkingBlockStatus;
  /** 三层锚点 */
  anchor: BlockAnchor;
  /** 折叠时占用的物理行数 */
  collapsedRows: number;
  /** 展开时占用的物理行数 */
  expandedRows: number;
  /** 折叠尾部 ANSI 片段（含快捷键提示） */
  foldSuffixAnsi: string;
  /** [已思考 #N] 标签结束后的列位置（0-based） */
  tagEndCol0: number;
  /** 是否含英文长词段（影响展示策略） */
  hasNonChinese: boolean;
  /** 数据版本号（用于兼容旧数据，§12.3） */
  version: number;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后状态变更时间戳 */
  updatedAt: number;
}

/** 思考块注册/查找的精简索引条目 */
export interface ThinkingBlockIndexEntry {
  id: number;
  sessionId: string;
  turnId: string;
  status: ThinkingBlockStatus;
  createdAt: number;
}

// ─── 展开范围记录 ─────────────────────────────────────────────

/** 展开态记录：块在 buffer 中的范围与插入行数 */
export interface ThinkingExpandedRange {
  /** 展开区起始 buffer 行 */
  first: number;
  /** 展开区结束 buffer 行 */
  last: number;
  /** 展开时插入的额外行数（收起时精确删除） */
  insertedRows: number;
}

// ─── 回放模式 ─────────────────────────────────────────────────

/** 历史回放模式（§9.4） */
export type ReplayMode = 'compact' | 'full';

/** 当前终端展示模式 */
export type TerminalDisplayMode = 'live' | 'replay';

// ─── 终端宿主会话状态 ─────────────────────────────────────────

/** 终端面板模式（§3.1 Claude Code 的 alternate screen 语义） */
export type TerminalPanelMode = 'main-ui' | 'shell-panel';

/** 终端宿主会话状态 */
export interface TerminalSessionState {
  /** 当前面板模式 */
  panelMode: TerminalPanelMode;
  /** 会话 ID */
  sessionId: string;
  /** 是否为持久会话（tmux / detached） */
  persistent: boolean;
  /** 进入 shell 面板的时间戳 */
  shellEnteredAt?: number;
  /** 退出 shell 面板前的主 UI 滚动位置 */
  mainUiScrollLine?: number;
}

// ─── 终端宿主切换事件 ─────────────────────────────────────────

export interface TerminalPanelTransition {
  from: TerminalPanelMode;
  to: TerminalPanelMode;
  timestamp: number;
  sessionId: string;
}

// ─── Turn 元数据（§10.4 统一上下文来源） ──────────────────────

export interface TurnMetadata {
  /** 当前轮次 ID */
  turnId: string;
  /** 归属会话 ID */
  sessionId: string;
  /** 当前思考块列表（id + status） */
  thinkingBlocks: ThinkingBlockIndexEntry[];
  /** 当前命令执行结果摘要 */
  commandResultSummary?: string;
  /** 当前记忆快照摘要 */
  memorySnapshotSummary?: string;
  /** 当前滚动锚点 */
  scrollAnchorLine?: number;
  /** 创建时间 */
  createdAt: number;
}

// ─── 块级重绘指令 ─────────────────────────────────────────────

/** 块级重绘操作类型（§9.1 由"覆盖式"改为"块级重绘式"） */
export type BlockRenderAction =
  | { type: 'render-collapsed'; blockId: number }
  | { type: 'render-expanded'; blockId: number }
  | { type: 'insert-placeholder'; blockId: number; rows: number }
  | { type: 'remove-placeholder'; blockId: number; rows: number }
  | { type: 'scroll-to-block'; blockId: number };

/** 块级重绘指令 */
export interface BlockRenderCommand {
  action: BlockRenderAction;
  timestamp: number;
}

// ─── 展示调试报告（§13.5） ────────────────────────────────────

export interface TerminalDisplayDebugReport {
  sessionId: string;
  displayMode: TerminalDisplayMode;
  replayMode?: ReplayMode;
  thinkingBlockCount: number;
  thinkingBlocks: Array<{
    id: number;
    status: ThinkingBlockStatus;
    hasAnchor: boolean;
    anchorLine: number | null;
  }>;
  panelMode: TerminalPanelMode;
  generatedAt: number;
}

// ─── 常量 ─────────────────────────────────────────────────────

/** 当前思考块元数据版本 */
export const THINKING_BLOCK_VERSION = 1;

/** sessionStorage key 前缀 */
export const TERMINAL_SESSION_STORAGE_PREFIX = 'zyfront:workbench:terminal:';

/** 思考块 sessionStorage key */
export const THINKING_BLOCKS_SESSION_KEY = `${TERMINAL_SESSION_STORAGE_PREFIX}thinking-blocks:v2`;

/** 回放状态 sessionStorage key */
export const REPLAY_STATE_SESSION_KEY = `${TERMINAL_SESSION_STORAGE_PREFIX}replay-state:v1`;

/** 最大保留思考块数量 */
export const MAX_THINKING_BLOCKS = 320;

/** 最大保留 marker 数量 */
export const MAX_THINKING_MARKERS = 80;
