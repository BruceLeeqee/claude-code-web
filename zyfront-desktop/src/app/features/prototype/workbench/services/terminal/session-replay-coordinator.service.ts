/**
 * 会话回放协调服务（M4: 历史回放与实时流统一）
 *
 * 基于 Claude Code 终端展示优化设计文档（§9.4, §10.4）：
 * - 历史回放和实时输出共用同一套 block 模型
 * - 折叠态与展开态共享同一数据结构，只是不同渲染策略
 * - 区分紧凑回放 / 完整回放两种模式
 * - 回放模式下的展开状态可预测
 * - 统一 transcript 与 live stream 数据格式
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { Terminal } from 'xterm';
import { ThinkingBlockStateMachineService } from './thinking-block-state-machine.service';
import { TerminalBlockRendererService } from './terminal-block-renderer.service';
import {
  type ThinkingBlockMeta,
  type ThinkingBlockIndexEntry,
  type ReplayMode,
  type TerminalDisplayMode,
  type TurnMetadata,
  REPLAY_STATE_SESSION_KEY,
  TERMINAL_SESSION_STORAGE_PREFIX,
} from './terminal-display.types';

/** 回放帧：一次完整的终端输出单元 */
export interface ReplayFrame {
  /** 帧唯一 ID */
  id: string;
  /** 归属会话 ID */
  sessionId: string;
  /** 归属轮次 ID */
  turnId: string;
  /** 帧类型 */
  type: 'user-input' | 'thinking' | 'tool-call' | 'tool-result' | 'answer' | 'system';
  /** 帧内容（折叠摘要） */
  summary: string;
  /** 帧内容（完整文本） */
  fullText?: string;
  /** 关联的思考块 ID */
  thinkingBlockId?: number;
  /** 时间戳 */
  timestamp: number;
}

/** 回放会话快照 */
export interface ReplaySessionSnapshot {
  sessionId: string;
  frames: ReplayFrame[];
  turnMetas: TurnMetadata[];
  capturedAt: number;
  replayMode: ReplayMode;
}

@Injectable({ providedIn: 'root' })
export class SessionReplayCoordinatorService {
  private readonly stateMachine = inject(ThinkingBlockStateMachineService);
  private readonly renderer = inject(TerminalBlockRendererService);

  // ─── 状态 ──────────────────────────────────────────────────

  /** 当前是否处于回放模式 */
  readonly isReplaying = signal(false);

  /** 当前回放模式 */
  readonly replayMode = signal<ReplayMode>('compact');

  /** 当前回放帧列表 */
  readonly frames = signal<ReplayFrame[]>([]);

  /** 当前回放位置（帧索引） */
  readonly currentFrameIndex = signal(0);

  /** 当前回放会话 ID */
  readonly replaySessionId = signal<string | null>(null);

  /** 回放是否完成 */
  readonly replayComplete = computed(() =>
    this.currentFrameIndex() >= this.frames().length - 1,
  );

  /** 当前帧 */
  readonly currentFrame = computed(() =>
    this.frames()[this.currentFrameIndex()] ?? null,
  );

  // ─── 回放控制 ──────────────────────────────────────────────

  /**
   * 开始回放
   *
   * @param sessionId 要回放的会话 ID
   * @param mode 回放模式
   */
  startReplay(sessionId: string, mode: ReplayMode = 'compact'): void {
    this.stateMachine.setDisplayMode('replay');
    this.stateMachine.setReplayMode(mode);

    this.isReplaying.set(true);
    this.replayMode.set(mode);
    this.replaySessionId.set(sessionId);
    this.currentFrameIndex.set(0);

    // 从状态机构建回放帧
    this.buildFramesFromBlocks(sessionId);

    // 持久化回放状态
    this.persistReplayState();
  }

  /**
   * 停止回放，返回实时模式
   */
  stopReplay(): void {
    this.stateMachine.setDisplayMode('live');
    this.isReplaying.set(false);
    this.replaySessionId.set(null);
    this.currentFrameIndex.set(0);
    this.frames.set([]);

    // 恢复所有 historical-hidden 块为 collapsed
    for (const id of this.stateMachine.getAllBlockIds()) {
      const block = this.stateMachine.getBlock(id);
      if (block?.status === 'historical-hidden') {
        this.stateMachine.transition(id, 'collapsed');
      }
    }

    this.clearReplayState();
  }

  /**
   * 前进到下一帧
   */
  nextFrame(term?: Terminal): ReplayFrame | null {
    const idx = this.currentFrameIndex();
    if (idx >= this.frames().length - 1) return null;

    this.currentFrameIndex.set(idx + 1);
    const frame = this.frames()[idx + 1];

    if (term && frame) {
      this.renderFrameToTerminal(term, frame);
    }

    return frame ?? null;
  }

  /**
   * 回退到上一帧
   */
  prevFrame(): ReplayFrame | null {
    const idx = this.currentFrameIndex();
    if (idx <= 0) return null;

    this.currentFrameIndex.set(idx - 1);
    return this.frames()[idx - 1] ?? null;
  }

  /**
   * 跳转到指定帧
   */
  seekFrame(index: number, term?: Terminal): ReplayFrame | null {
    const fs = this.frames();
    if (index < 0 || index >= fs.length) return null;

    this.currentFrameIndex.set(index);
    const frame = fs[index];

    if (term && frame) {
      this.renderFrameToTerminal(term, frame);
    }

    return frame ?? null;
  }

  /**
   * 切换回放模式
   */
  toggleReplayMode(): ReplayMode {
    const newMode: ReplayMode = this.replayMode() === 'compact' ? 'full' : 'compact';
    this.replayMode.set(newMode);
    this.stateMachine.setReplayMode(newMode);
    this.persistReplayState();
    return newMode;
  }

  // ─── 帧构建 ────────────────────────────────────────────────

  /**
   * 从思考块元数据构建回放帧
   *
   * 统一 transcript 与 live stream 数据格式：
   * 回放和实时共用同一套 block 元数据。
   */
  private buildFramesFromBlocks(sessionId: string): void {
    const blocks = this.stateMachine.getBlocksBySession(sessionId);
    const fs: ReplayFrame[] = [];

    for (const block of blocks) {
      // 思考帧
      fs.push({
        id: `thinking-${block.id}`,
        sessionId: block.sessionId,
        turnId: block.turnId,
        type: 'thinking',
        summary: block.summary || `思考 #${block.id}`,
        fullText: block.text,
        thinkingBlockId: block.id,
        timestamp: block.createdAt,
      });

      // 如果有锚点，添加一个定位帧
      if (block.anchor.bufferRange) {
        fs.push({
          id: `answer-after-${block.id}`,
          sessionId: block.sessionId,
          turnId: block.turnId,
          type: 'answer',
          summary: `[回答] #${block.id}`,
          thinkingBlockId: block.id,
          timestamp: block.createdAt + 1,
        });
      }
    }

    // 按时间排序
    fs.sort((a, b) => a.timestamp - b.timestamp);
    this.frames.set(fs);
  }

  /**
   * 添加实时帧（实时模式下由流式输出调用）
   *
   * 让实时流也通过帧模型，保证回放和实时使用统一格式。
   */
  addLiveFrame(frame: ReplayFrame): void {
    if (this.isReplaying()) return; // 回放模式下不接受实时帧
    this.frames.update(fs => [...fs, frame]);
  }

  // ─── 终端渲染 ──────────────────────────────────────────────

  /**
   * 将回放帧渲染到终端
   */
  renderFrameToTerminal(term: Terminal, frame: ReplayFrame): void {
    const mode = this.replayMode();

    switch (frame.type) {
      case 'thinking': {
        if (frame.thinkingBlockId === undefined) break;

        if (mode === 'compact') {
          // 紧凑回放：只显示折叠摘要
          this.renderer.renderCollapsed(term, frame.thinkingBlockId);
        } else {
          // 完整回放：展开显示
          const block = this.stateMachine.getBlock(frame.thinkingBlockId);
          if (block) {
            this.stateMachine.transition(frame.thinkingBlockId, 'expanded');
            this.renderer.expandBlock(term, frame.thinkingBlockId);
          }
        }
        break;
      }
      case 'answer': {
        if (mode === 'compact') {
          term.write(`\r\n\x1b[35m[回答]\x1b[0m ...`);
        }
        // 完整回放时，回答内容由帧的 fullText 提供
        if (mode === 'full' && frame.fullText) {
          term.write(`\r\n\x1b[35m[回答]\x1b[0m ${frame.fullText.replaceAll('\n', '\r\n')}`);
        }
        break;
      }
      case 'user-input': {
        term.write(`\r\n\x1b[36m[用户]\x1b[0m ${frame.summary.replaceAll('\n', '\r\n')}`);
        break;
      }
      case 'tool-call': {
        term.write(`\r\n\x1b[33m[Tool]\x1b[0m ${frame.summary}`);
        break;
      }
      default:
        break;
    }
  }

  // ─── 快照 ──────────────────────────────────────────────────

  /**
   * 创建回放快照（用于持久化和跨页面恢复）
   */
  createSnapshot(sessionId: string): ReplaySessionSnapshot {
    const blocks = this.stateMachine.getBlocksBySession(sessionId);
    const turnMetas = this.buildTurnMetas(sessionId);

    return {
      sessionId,
      frames: this.frames(),
      turnMetas,
      capturedAt: Date.now(),
      replayMode: this.replayMode(),
    };
  }

  /**
   * 从快照恢复
   */
  restoreFromSnapshot(snapshot: ReplaySessionSnapshot): void {
    this.frames.set(snapshot.frames);
    this.replayMode.set(snapshot.replayMode);
    this.replaySessionId.set(snapshot.sessionId);
    this.currentFrameIndex.set(0);
  }

  // ─── Turn 元数据 ───────────────────────────────────────────

  /**
   * 构建会话的 Turn 元数据列表
   */
  buildTurnMetas(sessionId: string): TurnMetadata[] {
    const blocks = this.stateMachine.getBlocksBySession(sessionId);
    const turnMap = new Map<string, ThinkingBlockMeta[]>();

    for (const block of blocks) {
      const list = turnMap.get(block.turnId) ?? [];
      list.push(block);
      turnMap.set(block.turnId, list);
    }

    return [...turnMap.entries()].map(([turnId, turnBlocks]) => ({
      turnId,
      sessionId,
      thinkingBlocks: turnBlocks.map(b => ({
        id: b.id,
        sessionId: b.sessionId,
        turnId: b.turnId,
        status: b.status,
        createdAt: b.createdAt,
      })),
      createdAt: Math.min(...turnBlocks.map(b => b.createdAt)),
    }));
  }

  // ─── 持久化 ────────────────────────────────────────────────

  private persistReplayState(): void {
    try {
      const state = {
        isReplaying: this.isReplaying(),
        replayMode: this.replayMode(),
        replaySessionId: this.replaySessionId(),
        currentFrameIndex: this.currentFrameIndex(),
      };
      sessionStorage.setItem(REPLAY_STATE_SESSION_KEY, JSON.stringify(state));
    } catch { /* ignore */ }
  }

  private clearReplayState(): void {
    try {
      sessionStorage.removeItem(REPLAY_STATE_SESSION_KEY);
    } catch { /* ignore */ }
  }

  /**
   * 从 sessionStorage 恢复回放状态
   */
  restoreReplayState(): boolean {
    try {
      const raw = sessionStorage.getItem(REPLAY_STATE_SESSION_KEY);
      if (!raw) return false;
      const state = JSON.parse(raw) as Record<string, unknown>;

      if (state['isReplaying']) {
        this.isReplaying.set(true);
        this.replayMode.set((state['replayMode'] as ReplayMode) ?? 'compact');
        this.replaySessionId.set((state['replaySessionId'] as string) ?? null);
        this.currentFrameIndex.set((state['currentFrameIndex'] as number) ?? 0);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
