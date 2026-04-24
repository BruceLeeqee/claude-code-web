/**
 * 命令展示服务（M5: Prompt / Memory / Terminal 三方联动）
 *
 * 基于 Claude Code 终端展示优化设计文档（§10.3）：
 * - 让"如何解释"与"如何显示"分离
 * - CommandPresentationService 负责将执行结果格式化为终端可展示的文本
 * - 与 CommandRouterService / CommandExecutorService 配合，但不直接操作终端
 */

import { Injectable, inject } from '@angular/core';
import { TurnMetadataService, type TurnCommandResult } from './turn-metadata.service';

/** 展示层级 */
export type PresentationTier = 'info' | 'success' | 'warning' | 'error' | 'debug';

/** 展示内容片段 */
export interface PresentationFragment {
  tier: PresentationTier;
  text: string;
  /** 是否需要独立一行 */
  standalone: boolean;
}

/** 命令展示结果 */
export interface CommandPresentation {
  /** 展示片段列表 */
  fragments: PresentationFragment[];
  /** 折叠摘要（用于回放紧凑模式） */
  compactSummary: string;
  /** 完整展示文本（ANSI 格式） */
  fullText: string;
  /** 关联的 Turn ID */
  turnId?: string;
}

@Injectable({ providedIn: 'root' })
export class CommandPresentationService {
  private readonly turnMeta = inject(TurnMetadataService);

  // ─── ANSI 颜色映射 ─────────────────────────────────────────

  private readonly tierColors: Record<PresentationTier, string> = {
    info: '\x1b[36m',     // cyan
    success: '\x1b[32m',  // green
    warning: '\x1b[33m',  // yellow
    error: '\x1b[31m',    // red
    debug: '\x1b[90m',    // bright black (gray)
  };

  private readonly RESET = '\x1b[0m';
  private readonly DIM = '\x1b[2m';
  private readonly BOLD = '\x1b[1m';

  // ─── 格式化方法 ────────────────────────────────────────────

  /**
   * 格式化用户输入
   */
  formatUserInput(prompt: string, skillLabel?: string | null): CommandPresentation {
    const fragments: PresentationFragment[] = [
      {
        tier: 'info',
        text: `${this.tierColors.info}[用户]${this.RESET} ${prompt}`,
        standalone: true,
      },
    ];

    if (skillLabel) {
      fragments.push({
        tier: 'warning',
        text: ` ${this.tierColors.warning}${this.DIM}[Skill: ${skillLabel}]${this.RESET}`,
        standalone: false,
      });
    }

    const fullText = fragments.map(f => f.text).join('');
    return {
      fragments,
      compactSummary: `[用户] ${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}`,
      fullText,
    };
  }

  /**
   * 格式化思考块折叠态
   */
  formatThinkingCollapsed(blockId: number, shortcutHint: string): CommandPresentation {
    const text = `  ${this.DIM}[已思考 #${blockId}]${this.RESET} … ${this.DIM}${shortcutHint}${this.RESET}`;
    return {
      fragments: [{ tier: 'debug', text, standalone: true }],
      compactSummary: `[思考 #${blockId}]`,
      fullText: text,
    };
  }

  /**
   * 格式化回答区
   */
  formatAnswer(text: string, showLabel: boolean): CommandPresentation {
    const label = showLabel ? `\r\n${this.tierColors.info}[回答]${this.RESET} ` : '\r\n';
    const fullText = `${label}${text.replaceAll('\n', '\r\n')}`;

    return {
      fragments: [{ tier: 'info', text: fullText, standalone: true }],
      compactSummary: `[回答] ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
      fullText,
    };
  }

  /**
   * 格式化工具调用
   */
  formatToolCall(toolName: string, args?: string): CommandPresentation {
    const argsSummary = args ? ` ${args.slice(0, 60)}${args.length > 60 ? '…' : ''}` : '';
    const fullText = `\r\n${this.tierColors.warning}[Tool]${this.RESET} ${this.BOLD}${toolName}${this.RESET}${this.DIM}${argsSummary}${this.RESET}`;

    return {
      fragments: [{ tier: 'warning', text: fullText, standalone: true }],
      compactSummary: `[Tool] ${toolName}`,
      fullText,
    };
  }

  /**
   * 格式化工具结果
   */
  formatToolResult(ok: boolean, error?: string): CommandPresentation {
    const tier: PresentationTier = ok ? 'success' : 'error';
    const icon = ok ? '✓' : '✗';
    const text = ok
      ? `\r\n${this.tierColors.success}[Tool]${this.RESET} ${icon} 完成`
      : `\r\n${this.tierColors.error}[Tool]${this.RESET} ${icon} ${error ?? '失败'}`;

    return {
      fragments: [{ tier, text, standalone: true }],
      compactSummary: ok ? '[Tool] 完成' : `[Tool] 失败: ${error?.slice(0, 40) ?? ''}`,
      fullText: text,
    };
  }

  /**
   * 格式化指令 / shell / assistant 统一执行结果
   */
  formatExecutionResult(
    kind: 'directive' | 'shell' | 'assistant' | 'system' | 'error',
    title: string,
    success: boolean,
    content: string,
  ): CommandPresentation {
    const tier: PresentationTier = success ? 'info' : 'error';
    const headerMap: Record<typeof kind, string> = {
      directive: '/directive',
      shell: '/shell',
      assistant: '/assistant',
      system: '/system',
      error: '/error',
    };
    const header = success
      ? `${this.tierColors.info}[${headerMap[kind]} ${title}]${this.RESET}`
      : `${this.tierColors.error}[${headerMap[kind]} ${title}]${this.RESET}`;
    const body = content ? ` ${content.replaceAll('\n', '\r\n')}` : '';

    return {
      fragments: [{ tier, text: `${header}${body}`, standalone: true }],
      compactSummary: `[${title}] ${success ? '成功' : '失败'}`,
      fullText: `${header}${body}`,
    };
  }

  /**
   * 格式化指令执行结果
   */
  formatDirectiveResult(
    directiveName: string,
    success: boolean,
    content: string,
  ): CommandPresentation {
    return this.formatExecutionResult('directive', directiveName, success, content);
  }

  /**
   * 格式化错误消息
   */
  formatError(message: string): CommandPresentation {
    const text = `\r\n${this.tierColors.error}[错误]${this.RESET} ${message}`;
    return {
      fragments: [{ tier: 'error', text, standalone: true }],
      compactSummary: `[错误] ${message.slice(0, 60)}`,
      fullText: text,
    };
  }

  /**
   * 格式化系统提示
   */
  formatSystemNotice(message: string): CommandPresentation {
    const text = `${this.DIM}${message}${this.RESET}`;
    return {
      fragments: [{ tier: 'debug', text, standalone: true }],
      compactSummary: message.slice(0, 60),
      fullText: text,
    };
  }

  // ─── Turn 集成 ─────────────────────────────────────────────

  /**
   * 从命令执行结果生成展示，并同步到 Turn 元数据
   */
  presentAndSync(
    route: TurnCommandResult['route'],
    success: boolean,
    summary: string,
    turnId?: string,
  ): CommandPresentation {
    if (turnId) {
      this.turnMeta.updateCommandResult(turnId, {
        route,
        success,
        summary,
        timestamp: Date.now(),
      });
    }

    return this.formatDirectiveResult(route, success, summary);
  }
}
