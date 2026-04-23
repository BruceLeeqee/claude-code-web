/**
 * 终端展示调试报告服务（M5/M6）
 *
 * 基于 Claude Code 终端展示优化设计文档（§13.5）：
 * - 为调试提供一键导出报告
 * - 终端看到的状态与 prompt 构建报告一致
 * - 能快速追踪某轮输出为何被截断或折叠
 */

import { Injectable, inject } from '@angular/core';
import { ThinkingBlockStateMachineService } from './thinking-block-state-machine.service';
import { TurnMetadataService } from './turn-metadata.service';
import { TerminalSessionHostService } from './terminal-session-host.service';
import { SessionReplayCoordinatorService } from './session-replay-coordinator.service';
import {
  type TerminalDisplayDebugReport,
  type ThinkingBlockStatus,
  type TerminalDisplayMode,
  type ReplayMode,
  type TerminalPanelMode,
} from './terminal-display.types';

/** 完整调试报告 */
export interface FullDebugReport extends TerminalDisplayDebugReport {
  turns: Array<{
    turnId: string;
    userPrompt: string;
    commandResult?: string;
    memorySnapshot?: string;
    thinkingBlockCount: number;
  }>;
  sessionHostTransitions: Array<{
    from: TerminalPanelMode;
    to: TerminalPanelMode;
    timestamp: number;
  }>;
  replayState: {
    isReplaying: boolean;
    replayMode: ReplayMode;
    frameCount: number;
    currentFrameIndex: number;
  };
}

@Injectable({ providedIn: 'root' })
export class TerminalDisplayDebugService {
  private readonly stateMachine = inject(ThinkingBlockStateMachineService);
  private readonly turnMeta = inject(TurnMetadataService);
  private readonly sessionHost = inject(TerminalSessionHostService);
  private readonly replay = inject(SessionReplayCoordinatorService);

  /**
   * 生成快速调试报告
   */
  generateQuickReport(sessionId: string): TerminalDisplayDebugReport {
    const blocks = this.stateMachine.getAllBlockIds().map(id => {
      const block = this.stateMachine.getBlock(id);
      const anchorLine = this.stateMachine.locateBlockBufferLine(id);
      return {
        id,
        status: (block?.status ?? 'collapsed') as ThinkingBlockStatus,
        hasAnchor: anchorLine !== null,
        anchorLine,
      };
    });

    return {
      sessionId,
      displayMode: this.stateMachine.getDisplayMode() as TerminalDisplayMode,
      replayMode: this.stateMachine.getReplayMode() as ReplayMode | undefined,
      thinkingBlockCount: blocks.length,
      thinkingBlocks: blocks,
      panelMode: this.sessionHost.panelMode() as TerminalPanelMode,
      generatedAt: Date.now(),
    };
  }

  /**
   * 生成完整调试报告
   */
  generateFullReport(sessionId: string): FullDebugReport {
    const quick = this.generateQuickReport(sessionId);

    const turns = this.turnMeta.getTurnsBySession(sessionId).map(t => ({
      turnId: t.turnId,
      userPrompt: t.userPrompt.slice(0, 200),
      commandResult: t.commandResult?.summary,
      memorySnapshot: t.memorySnapshot?.buildReportSummary ?? undefined,
      thinkingBlockCount: t.thinkingBlocks.length,
    }));

    return {
      ...quick,
      turns,
      sessionHostTransitions: [...this.sessionHost.getTransitionLog()],
      replayState: {
        isReplaying: this.replay.isReplaying(),
        replayMode: this.replay.replayMode(),
        frameCount: this.replay.frames().length,
        currentFrameIndex: this.replay.currentFrameIndex(),
      },
    };
  }

  /**
   * 导出调试报告为 JSON 字符串
   */
  exportReportAsJson(sessionId: string): string {
    return JSON.stringify(this.generateFullReport(sessionId), null, 2);
  }

  /**
   * 导出调试报告为可读文本
   */
  exportReportAsText(sessionId: string): string {
    const report = this.generateFullReport(sessionId);
    const lines: string[] = [
      `=== 终端展示调试报告 ===`,
      `会话 ID: ${report.sessionId}`,
      `生成时间: ${new Date(report.generatedAt).toISOString()}`,
      `展示模式: ${report.displayMode}`,
      `回放模式: ${report.replayMode ?? 'N/A'}`,
      `面板模式: ${report.panelMode}`,
      ``,
      `--- 思考块 (${report.thinkingBlockCount}) ---`,
    ];

    for (const b of report.thinkingBlocks) {
      lines.push(
        `  #${b.id} status=${b.status} anchor=${b.hasAnchor ? `line=${b.anchorLine}` : 'none'}`,
      );
    }

    lines.push('', `--- Turns (${report.turns.length}) ---`);
    for (const t of report.turns) {
      lines.push(
        `  ${t.turnId}: "${t.userPrompt.slice(0, 40)}…" blocks=${t.thinkingBlockCount}`,
      );
    }

    lines.push('', `--- 回放状态 ---`);
    lines.push(`  正在回放: ${report.replayState.isReplaying}`);
    lines.push(`  回放模式: ${report.replayState.replayMode}`);
    lines.push(`  帧数: ${report.replayState.frameCount}`);

    lines.push('', `--- 面板切换历史 (${report.sessionHostTransitions.length}) ---`);
    for (const t of report.sessionHostTransitions.slice(-10)) {
      lines.push(`  ${new Date(t.timestamp).toISOString()} ${t.from} → ${t.to}`);
    }

    return lines.join('\n');
  }
}
