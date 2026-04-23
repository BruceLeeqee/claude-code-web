/**
 * 终端宿主抽象服务（M1: 终端宿主抽象化）
 *
 * 基于 Claude Code terminalPanel.ts 的设计思想（§3.1, §10.1）：
 * - 把"进入 shell 面板 / 退出 shell 面板"的逻辑抽离成独立协调层
 * - 终端面板是持久 shell 宿主，不是临时弹层
 * - 展示层和执行层是解耦的
 * - "展示层"和"执行层"是解耦的
 *
 * 在 zyfront-desktop 中，我们不使用 tmux，而是用 xterm + PTY session 管理实现等效语义：
 * - panelMode 状态机管理 main-ui / shell-panel 切换
 * - 进入 shell 时保存主 UI 状态，退出时恢复
 * - shell 进程在面板外可以继续运行
 */

import { Injectable, signal, computed } from '@angular/core';
import {
  type TerminalPanelMode,
  type TerminalSessionState,
  type TerminalPanelTransition,
} from './terminal-display.types';

@Injectable({ providedIn: 'root' })
export class TerminalSessionHostService {
  // ─── 状态 ──────────────────────────────────────────────────

  private readonly _state = signal<TerminalSessionState>({
    panelMode: 'main-ui',
    sessionId: '',
    persistent: false,
  });

  /** 只读状态快照 */
  readonly state = this._state.asReadonly();

  /** 当前面板模式 */
  readonly panelMode = computed(() => this._state().panelMode);

  /** 是否处于 shell 面板模式 */
  readonly inShellPanel = computed(() => this._state().panelMode === 'shell-panel');

  /** 当前会话 ID */
  readonly sessionId = computed(() => this._state().sessionId);

  /** 是否持久会话 */
  readonly persistent = computed(() => this._state().persistent);

  // ─── 切换历史（用于调试） ──────────────────────────────────

  private readonly _transitionLog: TerminalPanelTransition[] = [];
  private readonly _transitionLogMax = 50;

  // ─── 主 UI 状态保存 ────────────────────────────────────────

  /** 进入 shell 前的主 UI 状态 */
  private mainUiSnapshot: {
    scrollLine?: number;
    cursorLine?: number;
    viewportY?: number;
  } | null = null;

  // ─── 快捷键绑定 ────────────────────────────────────────────

  private keyBindings: Array<{ key: string; handler: () => void }> = [];

  constructor() {
    // 注册默认快捷键
    this.registerKeyBinding('Meta+J', () => this.toggleShellPanel());
    this.registerKeyBinding('Escape', () => {
      if (this.inShellPanel()) this.exitShellPanel();
    });
  }

  // ─── 公共 API ──────────────────────────────────────────────

  /**
   * 初始化会话
   */
  initSession(sessionId: string, options?: { persistent?: boolean }): void {
    this._state.update(s => ({
      ...s,
      sessionId,
      persistent: options?.persistent ?? false,
    }));
  }

  /**
   * 切换 shell 面板（Claude Code 的 toggle() 语义）
   *
   * - 当前在 main-ui → 进入 shell-panel
   * - 当前在 shell-panel → 返回 main-ui
   */
  toggleShellPanel(): void {
    if (this.inShellPanel()) {
      this.exitShellPanel();
    } else {
      this.enterShellPanel();
    }
  }

  /**
   * 进入 shell 面板（Claude Code 的 showShell() 语义）
   *
   * 步骤：
   * 1. 保存当前主 UI 状态（滚动位置、光标位置）
   * 2. 切换面板模式为 shell-panel
   * 3. 记录转换事件
   */
  enterShellPanel(): void {
    if (this.inShellPanel()) return;

    const prev = this._state();

    // 保存主 UI 状态
    this.mainUiSnapshot = {
      scrollLine: prev.mainUiScrollLine,
    };

    this._state.update(s => ({
      ...s,
      panelMode: 'shell-panel',
      shellEnteredAt: Date.now(),
    }));

    this.logTransition(prev.panelMode, 'shell-panel');
  }

  /**
   * 退出 shell 面板，返回主 UI
   *
   * 步骤：
   * 1. 恢复主 UI 的滚动位置
   * 2. 切换面板模式为 main-ui
   * 3. shell 进程不会被销毁（持久语义）
   */
  exitShellPanel(): void {
    if (!this.inShellPanel()) return;

    const prev = this._state();

    this._state.update(s => ({
      ...s,
      panelMode: 'main-ui',
      mainUiScrollLine: this.mainUiSnapshot?.scrollLine,
    }));

    this.mainUiSnapshot = null;
    this.logTransition(prev.panelMode, 'main-ui');
  }

  /**
   * 保存主 UI 滚动位置（供外部调用）
   */
  saveMainUiScrollPosition(scrollLine: number): void {
    this._state.update(s => ({
      ...s,
      mainUiScrollLine: scrollLine,
    }));
  }

  /**
   * 获取上次保存的主 UI 滚动位置
   */
  getMainUiScrollPosition(): number | undefined {
    return this.mainUiSnapshot?.scrollLine ?? this._state().mainUiScrollLine;
  }

  /**
   * 重置会话状态（新会话或清屏时调用）
   */
  reset(sessionId?: string): void {
    this._state.set({
      panelMode: 'main-ui',
      sessionId: sessionId ?? this._state().sessionId,
      persistent: false,
    });
    this.mainUiSnapshot = null;
  }

  /**
   * 获取面板切换历史（调试用）
   */
  getTransitionLog(): readonly TerminalPanelTransition[] {
    return this._transitionLog;
  }

  // ─── 快捷键注册 ────────────────────────────────────────────

  private registerKeyBinding(key: string, handler: () => void): void {
    this.keyBindings.push({ key, handler });
  }

  /**
   * 处理快捷键事件（由 workbench.page.ts 转发）
   */
  handleKeyBinding(key: string): boolean {
    const binding = this.keyBindings.find(b => b.key === key);
    if (binding) {
      binding.handler();
      return true;
    }
    return false;
  }

  // ─── 内部方法 ──────────────────────────────────────────────

  private logTransition(from: TerminalPanelMode, to: TerminalPanelMode): void {
    const entry: TerminalPanelTransition = {
      from,
      to,
      timestamp: Date.now(),
      sessionId: this._state().sessionId,
    };
    this._transitionLog.push(entry);
    if (this._transitionLog.length > this._transitionLogMax) {
      this._transitionLog.splice(0, this._transitionLog.length - this._transitionLogMax);
    }
  }
}
