/**
 * Turn 元数据服务（M5: Prompt / Memory / Terminal 三方联动）
 *
 * 基于 Claude Code 终端展示优化设计文档（§10.4）：
 * - 把 prompt 记忆层、终端展示层、历史回放层都映射到同一份 turn metadata
 * - 当前轮次、思考块列表、命令执行结果、记忆快照、滚动锚点统一建模
 * - 显著降低"显示和语义不同步"的风险
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ThinkingBlockStateMachineService } from './thinking-block-state-machine.service';
import { type TurnMetadata, type ThinkingBlockIndexEntry } from './terminal-display.types';

/** Turn 命令执行结果 */
export interface TurnCommandResult {
  route: 'directive' | 'shell' | 'natural' | 'error' | 'fallback';
  success: boolean;
  summary: string;
  timestamp: number;
}

/** Turn 记忆快照 */
export interface TurnMemorySnapshot {
  shortTermCount: number;
  latestSnippet: string | null;
  buildReportSummary: string | null;
  capturedAt: number;
}

/** 完整 Turn 上下文 */
export interface TurnContext {
  turnId: string;
  sessionId: string;
  userPrompt: string;
  commandResult?: TurnCommandResult;
  memorySnapshot?: TurnMemorySnapshot;
  thinkingBlocks: ThinkingBlockIndexEntry[];
  scrollAnchorLine?: number;
  createdAt: number;
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class TurnMetadataService {
  private readonly stateMachine = inject(ThinkingBlockStateMachineService);

  // ─── 状态 ──────────────────────────────────────────────────

  private readonly _turns = new Map<string, TurnContext>();
  private readonly _currentTurnId = signal<string | null>(null);

  readonly currentTurnId = this._currentTurnId.asReadonly();

  readonly currentTurn = computed<TurnContext | null>(() => {
    const id = this._currentTurnId();
    return id ? this._turns.get(id) ?? null : null;
  });

  readonly turnCount = computed(() => this._turns.size);

  // ─── Turn 生命周期 ─────────────────────────────────────────

  /**
   * 开始新的 Turn
   */
  startTurn(sessionId: string, userPrompt: string): TurnContext {
    const turnId = `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const ctx: TurnContext = {
      turnId,
      sessionId,
      userPrompt,
      thinkingBlocks: [],
      createdAt: now,
      updatedAt: now,
    };

    this._turns.set(turnId, ctx);
    this._currentTurnId.set(turnId);
    return ctx;
  }

  /**
   * 结束当前 Turn
   */
  endTurn(turnId: string): void {
    const ctx = this._turns.get(turnId);
    if (!ctx) return;

    ctx.updatedAt = Date.now();

    // 同步思考块索引
    ctx.thinkingBlocks = this.stateMachine.getBlockIndex().filter(
      b => b.sessionId === ctx.sessionId,
    );
  }

  /**
   * 获取 Turn 上下文
   */
  getTurn(turnId: string): TurnContext | undefined {
    return this._turns.get(turnId);
  }

  /**
   * 获取会话的所有 Turn
   */
  getTurnsBySession(sessionId: string): TurnContext[] {
    return [...this._turns.values()]
      .filter(t => t.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  // ─── 增量更新 ──────────────────────────────────────────────

  /**
   * 更新 Turn 的命令执行结果
   */
  updateCommandResult(turnId: string, result: TurnCommandResult): void {
    const ctx = this._turns.get(turnId);
    if (!ctx) return;
    ctx.commandResult = result;
    ctx.updatedAt = Date.now();
  }

  /**
   * 更新 Turn 的记忆快照
   */
  updateMemorySnapshot(turnId: string, snapshot: TurnMemorySnapshot): void {
    const ctx = this._turns.get(turnId);
    if (!ctx) return;
    ctx.memorySnapshot = snapshot;
    ctx.updatedAt = Date.now();
  }

  /**
   * 更新 Turn 的滚动锚点
   */
  updateScrollAnchor(turnId: string, line: number): void {
    const ctx = this._turns.get(turnId);
    if (!ctx) return;
    ctx.scrollAnchorLine = line;
    ctx.updatedAt = Date.now();
  }

  /**
   * 同步思考块索引到当前 Turn
   */
  syncThinkingBlocks(turnId: string): void {
    const ctx = this._turns.get(turnId);
    if (!ctx) return;

    ctx.thinkingBlocks = this.stateMachine.getBlockIndex().filter(
      b => b.sessionId === ctx.sessionId,
    );
    ctx.updatedAt = Date.now();
  }

  // ─── 元数据导出（§13.5 调试报告） ─────────────────────────

  /**
   * 导出 Turn 元数据为 TurnMetadata 格式
   */
  exportTurnMetadata(turnId: string): TurnMetadata | null {
    const ctx = this._turns.get(turnId);
    if (!ctx) return null;

    return {
      turnId: ctx.turnId,
      sessionId: ctx.sessionId,
      thinkingBlocks: ctx.thinkingBlocks,
      commandResultSummary: ctx.commandResult?.summary,
      memorySnapshotSummary: ctx.memorySnapshot?.buildReportSummary ?? undefined,
      scrollAnchorLine: ctx.scrollAnchorLine,
      createdAt: ctx.createdAt,
    };
  }

  /**
   * 导出所有 Turn 元数据
   */
  exportAllTurnMetadata(sessionId?: string): TurnMetadata[] {
    const turns = sessionId
      ? this.getTurnsBySession(sessionId)
      : [...this._turns.values()];

    return turns.map(t => this.exportTurnMetadata(t.turnId)!).filter(Boolean);
  }

  // ─── 清理 ──────────────────────────────────────────────────

  /**
   * 清理指定会话的 Turn 数据
   */
  clearSession(sessionId: string): void {
    for (const [id, ctx] of this._turns) {
      if (ctx.sessionId === sessionId) {
        this._turns.delete(id);
      }
    }
  }

  /**
   * 清理所有 Turn 数据
   */
  clearAll(): void {
    this._turns.clear();
    this._currentTurnId.set(null);
  }
}
