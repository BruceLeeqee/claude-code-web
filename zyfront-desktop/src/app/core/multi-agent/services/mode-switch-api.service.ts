import { Injectable, inject, signal, computed } from '@angular/core';
import { ExecutionModeDeciderService, type ExecutionMode, type ModeDecision } from './execution-mode-decider.service';
import { MultiAgentConfigService } from './multi-agent-config.service';
import { TaskPlannerService } from './task-planner.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface ModeSwitchResult {
  previousMode: ExecutionMode;
  newMode: ExecutionMode;
  reason: string;
  timestamp: number;
}

export interface ModeSwitchOptions {
  force?: boolean;
  reason?: string;
  persist?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ModeSwitchApiService {
  private readonly decider = inject(ExecutionModeDeciderService);
  private readonly configService = inject(MultiAgentConfigService);
  private readonly planner = inject(TaskPlannerService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly currentMode = signal<ExecutionMode>('single');
  private readonly lastDecision = signal<ModeDecision | null>(null);
  private readonly modeHistory = signal<Array<{ mode: ExecutionMode; reason: string; timestamp: number }>>([]);

  readonly mode = this.currentMode;
  readonly decision = this.lastDecision;
  readonly history = this.modeHistory;

  readonly isSingleMode = computed(() => this.currentMode() === 'single');
  readonly isMultiMode = computed(() => this.currentMode() === 'multi');
  readonly isForced = computed(() => this.configService.getForceMode() !== null);

  initialize(): void {
    const config = this.configService.getConfig();
    if (config.forceMode) {
      this.currentMode.set(config.forceMode);
      this.decider.forceExecutionMode(config.forceMode);
    }
  }

  switchToSingle(options?: ModeSwitchOptions): ModeSwitchResult {
    return this.switchMode('single', options);
  }

  switchToMulti(options?: ModeSwitchOptions): ModeSwitchResult {
    return this.switchMode('multi', options);
  }

  toggleMode(options?: ModeSwitchOptions): ModeSwitchResult {
    const next: ExecutionMode = this.currentMode() === 'single' ? 'multi' : 'single';
    return this.switchMode(next, options);
  }

  clearForce(): void {
    this.configService.clearForceMode();
    this.decider.forceExecutionMode(null);
    this.eventBus.emit({
      type: EVENT_TYPES.MODE_AUTO,
      sessionId: 'mode-switch-api',
      source: 'user',
      payload: {
        previousMode: this.currentMode(),
        reason: '清除强制模式，恢复自动决策',
        timestamp: Date.now(),
      },
    });
  }

  decideForRequest(userRequest: string): ModeDecision {
    const decision = this.decider.decide(userRequest);

    if (!this.isForced()) {
      this.currentMode.set(decision.mode);
    }

    this.lastDecision.set(decision);

    this.eventBus.emit({
      type: decision.mode === 'single' ? EVENT_TYPES.MODE_SINGLE : EVENT_TYPES.MODE_MULTI,
      sessionId: 'mode-switch-api',
      source: 'system',
      payload: {
        mode: decision.mode,
        reason: decision.reason,
        complexity: decision.complexity,
        timestamp: Date.now(),
      },
    });

    return decision;
  }

  getModeIndicatorText(): string {
    const mode = this.currentMode();
    const forced = this.isForced();
    if (mode === 'single') {
      return forced ? '单Agent (强制)' : '单Agent';
    }
    return forced ? '多智能体 (强制)' : '多智能体';
  }

  getModeDescription(): string {
    const decision = this.lastDecision();
    if (decision) {
      return decision.reason;
    }
    return this.currentMode() === 'single' ? '简单任务直接执行' : '复杂任务自动拆分';
  }

  canToggle(): boolean {
    return this.configService.isEnabled();
  }

  private switchMode(targetMode: ExecutionMode, options?: ModeSwitchOptions): ModeSwitchResult {
    const previousMode = this.currentMode();

    if (previousMode === targetMode && !options?.force) {
      return {
        previousMode,
        newMode: targetMode,
        reason: '模式未变更',
        timestamp: Date.now(),
      };
    }

    this.currentMode.set(targetMode);

    if (options?.persist !== false) {
      this.configService.setForceMode(targetMode);
      this.decider.forceExecutionMode(targetMode);
    }

    const reason = options?.reason || `用户手动切换至${targetMode === 'single' ? '单Agent' : '多智能体'}模式`;

    this.modeHistory.update(history => [
      ...history.slice(-99),
      { mode: targetMode, reason, timestamp: Date.now() },
    ]);

    this.eventBus.emit({
      type: targetMode === 'single' ? EVENT_TYPES.MODE_SINGLE : EVENT_TYPES.MODE_MULTI,
      sessionId: 'mode-switch-api',
      source: 'user',
      payload: {
        mode: targetMode,
        reason,
        previousMode,
        timestamp: Date.now(),
      },
    });

    return {
      previousMode,
      newMode: targetMode,
      reason,
      timestamp: Date.now(),
    };
  }
}
