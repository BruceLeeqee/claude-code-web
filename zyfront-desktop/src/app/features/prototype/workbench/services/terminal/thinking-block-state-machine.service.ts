/**
 * 思考块状态机服务（M2: 思考块状态机重构）
 *
 * 基于 Claude Code AssistantThinkingMessage.tsx 的设计思想（§3.2, §8, §10.2）：
 * - 将 thinking block 从"多处判断"升级为"单一状态机"
 * - 明确 collapsed / expanded / inline-expanded / historical-hidden 四种状态
 * - 折叠态必须保留定位能力
 * - 展开态必须能回到原始块
 * - 历史回放中可以只渲染简洁版或完整版
 *
 * 从 workbench.page.ts 拆出：
 * - block 注册
 * - block 查找
 * - block 持久化
 * - block 展开/收起
 * - block 回放恢复
 */

import { Injectable, signal, computed } from '@angular/core';
import type { IMarker } from 'xterm';
import {
  type ThinkingBlockMeta,
  type ThinkingBlockStatus,
  type ThinkingBlockIndexEntry,
  type ThinkingExpandedRange,
  type BlockAnchor,
  type ReplayMode,
  type TerminalDisplayMode,
  THINKING_BLOCK_TRANSITIONS,
  THINKING_BLOCK_VERSION,
  THINKING_BLOCKS_SESSION_KEY,
  MAX_THINKING_BLOCKS,
  MAX_THINKING_MARKERS,
} from './terminal-display.types';

@Injectable({ providedIn: 'root' })
export class ThinkingBlockStateMachineService {
  // ─── 核心状态 ──────────────────────────────────────────────

  /** 思考块元数据注册表（id → meta） */
  private readonly blocksById = new Map<number, ThinkingBlockMeta>();

  /** 折叠行写入后注册的 buffer 标记 */
  private readonly blockMarkers = new Map<number, IMarker>();

  /** 当前为展开态的思考块 id 集合 */
  private readonly expandedIds = new Set<number>();

  /** 展开后在 buffer 中占据的范围 */
  private readonly expandedRanges = new Map<number, ThinkingExpandedRange>();

  /** 下一个可用 block ID */
  private _nextBlockId = 1;

  /** 最近一轮产生的 thinking 块 id */
  private _latestTurnBlockIds: number[] = [];

  /** 是否全部展开 */
  private _allExpanded = false;

  /** 当前展示模式 */
  private _displayMode: TerminalDisplayMode = 'live';

  /** 当前回放模式 */
  private _replayMode: ReplayMode = 'compact';

  // ─── Signals（供 UI 层绑定） ──────────────────────────────

  readonly blockCount = signal(0);
  readonly expandedCount = signal(0);
  readonly latestTurnBlockIds = signal<number[]>([]);
  readonly displayMode = signal<TerminalDisplayMode>('live');
  readonly replayMode = signal<ReplayMode>('compact');

  // ─── 注册 ──────────────────────────────────────────────────

  /**
   * 注册新的思考块
   */
  registerBlock(params: {
    sessionId: string;
    turnId: string;
    text: string;
    summary: string;
    foldSuffixAnsi: string;
    tagEndCol0: number;
    hasNonChinese: boolean;
    collapsedRows: number;
    expandedRows: number;
  }): ThinkingBlockMeta {
    const id = this._nextBlockId++;
    const now = Date.now();

    const meta: ThinkingBlockMeta = {
      id,
      sessionId: params.sessionId,
      turnId: params.turnId,
      text: params.text,
      summary: params.summary,
      status: 'collapsed',
      anchor: {},
      collapsedRows: params.collapsedRows,
      expandedRows: params.expandedRows,
      foldSuffixAnsi: params.foldSuffixAnsi,
      tagEndCol0: params.tagEndCol0,
      hasNonChinese: params.hasNonChinese,
      version: THINKING_BLOCK_VERSION,
      createdAt: now,
      updatedAt: now,
    };

    this.blocksById.set(id, meta);
    this._latestTurnBlockIds = [id];
    this.latestTurnBlockIds.set(this._latestTurnBlockIds);
    this.persistToSession();
    this.updateSignals();
    return meta;
  }

  // ─── 查找 ──────────────────────────────────────────────────

  /** 获取块元数据 */
  getBlock(id: number): ThinkingBlockMeta | undefined {
    return this.blocksById.get(id);
  }

  /** 获取所有块 ID（有序） */
  getAllBlockIds(): number[] {
    return [...this.blocksById.keys()].sort((a, b) => a - b);
  }

  /** 获取块索引条目列表 */
  getBlockIndex(): ThinkingBlockIndexEntry[] {
    return [...this.blocksById.values()].map(b => ({
      id: b.id,
      sessionId: b.sessionId,
      turnId: b.turnId,
      status: b.status,
      createdAt: b.createdAt,
    }));
  }

  /** 检查块是否存在 */
  hasBlock(id: number): boolean {
    return this.blocksById.has(id);
  }

  /** 查找指定会话的所有块 */
  getBlocksBySession(sessionId: string): ThinkingBlockMeta[] {
    return [...this.blocksById.values()].filter(b => b.sessionId === sessionId);
  }

  /** 查找指定轮次的所有块 */
  getBlocksByTurn(turnId: string): ThinkingBlockMeta[] {
    return [...this.blocksById.values()].filter(b => b.turnId === turnId);
  }

  // ─── 状态迁移 ──────────────────────────────────────────────

  /**
   * 执行状态迁移（§8.1）
   *
   * @returns 迁移是否成功
   */
  transition(id: number, targetStatus: ThinkingBlockStatus): boolean {
    const block = this.blocksById.get(id);
    if (!block) return false;

    const allowed = THINKING_BLOCK_TRANSITIONS[block.status];
    if (!allowed.includes(targetStatus)) {
      return false;
    }

    // 状态不变量检查（§8.2）：同一时刻只能有一个展示状态
    block.status = targetStatus;
    block.updatedAt = Date.now();

    // 同步展开状态集合
    if (targetStatus === 'expanded' || targetStatus === 'inline-expanded') {
      this.expandedIds.add(id);
    } else {
      this.expandedIds.delete(id);
      this.expandedRanges.delete(id);
    }

    if (targetStatus !== 'expanded' && targetStatus !== 'inline-expanded') {
      this._allExpanded = false;
    }

    this.updateSignals();
    return true;
  }

  /**
   * 展开/切换指定块
   */
  toggleExpand(id: number): ThinkingBlockStatus | null {
    const block = this.blocksById.get(id);
    if (!block) return null;

    if (block.status === 'collapsed' || block.status === 'historical-hidden') {
      const target = this._displayMode === 'replay' ? 'expanded' : 'inline-expanded';
      return this.transition(id, target) ? target : null;
    }

    if (block.status === 'expanded' || block.status === 'inline-expanded') {
      return this.transition(id, 'collapsed') ? 'collapsed' : null;
    }

    return null;
  }

  /**
   * 全部展开 / 全部收起
   */
  toggleAllExpand(): boolean {
    if (this._allExpanded) {
      // 全部收起
      for (const id of [...this.expandedIds]) {
        this.transition(id, 'collapsed');
      }
      this._allExpanded = false;
      return false;
    }

    // 全部展开
    for (const [id, block] of this.blocksById) {
      if (block.status === 'collapsed' || block.status === 'historical-hidden') {
        const target = this._displayMode === 'replay' ? 'expanded' : 'inline-expanded';
        this.transition(id, target);
      }
    }
    this._allExpanded = true;
    return true;
  }

  // ─── 展开范围 ──────────────────────────────────────────────

  /** 记录展开范围 */
  setExpandedRange(id: number, range: ThinkingExpandedRange): void {
    this.expandedRanges.set(id, range);
  }

  /** 获取展开范围 */
  getExpandedRange(id: number): ThinkingExpandedRange | undefined {
    return this.expandedRanges.get(id);
  }

  /** 检查是否处于展开态 */
  isExpanded(id: number): boolean {
    return this.expandedIds.has(id);
  }

  /** 获取所有展开 ID */
  getExpandedIds(): Set<number> {
    return new Set(this.expandedIds);
  }

  // ─── Marker 管理 ───────────────────────────────────────────

  /** 注册/更新 marker */
  upsertMarker(id: number, marker: IMarker): void {
    const existing = this.blockMarkers.get(id);
    if (existing) {
      try { existing.dispose(); } catch { /* ignore */ }
    }
    this.blockMarkers.set(id, marker);

    // 同时更新 anchor
    const block = this.blocksById.get(id);
    if (block) {
      block.anchor.marker = marker;
    }

    // 限制 marker 数量
    if (this.blockMarkers.size > MAX_THINKING_MARKERS) {
      const keys = [...this.blockMarkers.keys()];
      const toRemove = keys.slice(0, keys.length - MAX_THINKING_MARKERS);
      for (const k of toRemove) {
        const m = this.blockMarkers.get(k);
        try { m?.dispose(); } catch { /* ignore */ }
        this.blockMarkers.delete(k);
      }
    }
  }

  /** 获取 marker */
  getMarker(id: number): IMarker | undefined {
    return this.blockMarkers.get(id);
  }

  /** 清理已释放的 marker */
  pruneDisposedMarkers(): void {
    for (const [id, marker] of this.blockMarkers) {
      if (marker.isDisposed) {
        this.blockMarkers.delete(id);
      }
    }
  }

  // ─── 锚点操作 ──────────────────────────────────────────────

  /** 更新块的 buffer 锚点 */
  updateBufferAnchor(id: number, range: { first: number; last: number }): void {
    const block = this.blocksById.get(id);
    if (block) {
      block.anchor.bufferRange = range;
      block.anchor.markerLineSnapshot = range.first;
    }
  }

  /** 通过锚点定位块的 buffer 行号 */
  locateBlockBufferLine(id: number): number | null {
    const block = this.blocksById.get(id);
    if (!block) return null;

    // 优先级1：marker
    if (block.anchor.marker && !block.anchor.marker.isDisposed && block.anchor.marker.line >= 0) {
      return block.anchor.marker.line;
    }

    // 优先级2：marker 快照
    if (block.anchor.markerLineSnapshot !== undefined && block.anchor.markerLineSnapshot >= 0) {
      return block.anchor.markerLineSnapshot;
    }

    // 优先级3：最近已知 buffer range
    if (block.anchor.bufferRange) {
      return block.anchor.bufferRange.first;
    }

    return null;
  }

  // ─── 回放模式 ──────────────────────────────────────────────

  /** 设置展示模式 */
  setDisplayMode(mode: TerminalDisplayMode): void {
    this._displayMode = mode;
    this.displayMode.set(mode);
  }

  /** 设置回放模式 */
  setReplayMode(mode: ReplayMode): void {
    this._replayMode = mode;
    this.replayMode.set(mode);

    // compact 模式下，所有非当前轮次的 expanded 块变为 historical-hidden
    if (mode === 'compact') {
      for (const [id, block] of this.blocksById) {
        if (block.status === 'expanded' && !this._latestTurnBlockIds.includes(id)) {
          this.transition(id, 'historical-hidden');
        }
      }
    }
  }

  /** 获取当前展示模式 */
  getDisplayMode(): TerminalDisplayMode {
    return this._displayMode;
  }

  /** 获取当前回放模式 */
  getReplayMode(): ReplayMode {
    return this._replayMode;
  }

  // ─── 持久化 ────────────────────────────────────────────────

  /** 持久化到 sessionStorage */
  persistToSession(): void {
    try {
      const entries = [...this.blocksById.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(-MAX_THINKING_BLOCKS);
      const serializable = Object.fromEntries(
        entries.map(([id, meta]) => [id, this.serializeBlock(meta)])
      );
      sessionStorage.setItem(THINKING_BLOCKS_SESSION_KEY, JSON.stringify(serializable));
    } catch { /* ignore */ }
  }

  /** 从 sessionStorage 合并缺失的块 */
  mergeFromSession(): void {
    try {
      const raw = sessionStorage.getItem(THINKING_BLOCKS_SESSION_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(o)) {
        const id = Number.parseInt(k, 10);
        if (!Number.isFinite(id) || id < 1) continue;
        if (this.blocksById.has(id)) continue;
        const meta = this.deserializeBlock(v);
        if (meta) this.blocksById.set(id, meta);
      }
      const keys = [...this.blocksById.keys()];
      if (keys.length > 0) {
        const floor = Math.max(...keys) + 1;
        this._nextBlockId = Math.max(this._nextBlockId, floor);
      }
    } catch { /* ignore */ }
  }

  // ─── 重置 ──────────────────────────────────────────────────

  /** 收起所有已展开的思考块 */
  collapseAll(): void {
    for (const id of [...this.expandedIds]) {
      this.transition(id, 'collapsed');
    }
    this.expandedIds.clear();
    this.expandedRanges.clear();
    this._allExpanded = false;
    this.updateSignals();
  }

  /** 重置所有块数据 */
  reset(): void {
    this.collapseAll();
    // 释放所有 marker
    for (const [, marker] of this.blockMarkers) {
      try { marker.dispose(); } catch { /* ignore */ }
    }
    this.blockMarkers.clear();
    this.blocksById.clear();
    this._nextBlockId = 1;
    this._latestTurnBlockIds = [];
    this.latestTurnBlockIds.set([]);
    try {
      sessionStorage.removeItem(THINKING_BLOCKS_SESSION_KEY);
    } catch { /* ignore */ }
    this.updateSignals();
  }

  // ─── 内部方法 ──────────────────────────────────────────────

  private updateSignals(): void {
    this.blockCount.set(this.blocksById.size);
    this.expandedCount.set(this.expandedIds.size);
  }

  private serializeBlock(meta: ThinkingBlockMeta): Record<string, unknown> {
    return {
      id: meta.id,
      sessionId: meta.sessionId,
      turnId: meta.turnId,
      text: meta.text,
      summary: meta.summary,
      status: meta.status,
      collapsedRows: meta.collapsedRows,
      expandedRows: meta.expandedRows,
      foldSuffixAnsi: meta.foldSuffixAnsi,
      tagEndCol0: meta.tagEndCol0,
      hasNonChinese: meta.hasNonChinese,
      version: meta.version,
      anchor: {
        markerLineSnapshot: meta.anchor.markerLineSnapshot,
        bufferRange: meta.anchor.bufferRange,
        foldTagText: meta.anchor.foldTagText,
      },
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }

  private deserializeBlock(v: unknown): ThinkingBlockMeta | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const r = v as Record<string, unknown>;

    if (typeof r['text'] !== 'string') return undefined;
    const foldSuffixAnsi = typeof r['foldSuffixAnsi'] === 'string' ? r['foldSuffixAnsi'] : undefined;
    if (!foldSuffixAnsi) return undefined;

    const anchorData = r['anchor'] as Record<string, unknown> | undefined;

    return {
      id: typeof r['id'] === 'number' ? r['id'] : 0,
      sessionId: typeof r['sessionId'] === 'string' ? r['sessionId'] : '',
      turnId: typeof r['turnId'] === 'string' ? r['turnId'] : '',
      text: r['text'],
      summary: typeof r['summary'] === 'string' ? r['summary'] : '',
      status: (typeof r['status'] === 'string' ? r['status'] : 'collapsed') as ThinkingBlockStatus,
      anchor: {
        markerLineSnapshot: typeof anchorData?.['markerLineSnapshot'] === 'number'
          ? anchorData['markerLineSnapshot'] as number : undefined,
        bufferRange: anchorData?.['bufferRange'] as { first: number; last: number } | undefined,
        foldTagText: typeof anchorData?.['foldTagText'] === 'string' ? anchorData['foldTagText'] as string : undefined,
      },
      collapsedRows: typeof r['collapsedRows'] === 'number' && r['collapsedRows'] >= 1
        ? r['collapsedRows'] : 1,
      expandedRows: typeof r['expandedRows'] === 'number' && r['expandedRows'] >= 1
        ? r['expandedRows'] : 1,
      foldSuffixAnsi,
      tagEndCol0: typeof r['tagEndCol0'] === 'number' && r['tagEndCol0'] >= 0
        ? r['tagEndCol0'] : 1,
      hasNonChinese: Boolean(r['hasNonChinese']),
      version: typeof r['version'] === 'number' ? r['version'] : THINKING_BLOCK_VERSION,
      createdAt: typeof r['createdAt'] === 'number' ? r['createdAt'] : 0,
      updatedAt: typeof r['updatedAt'] === 'number' ? r['updatedAt'] : 0,
    };
  }
}
