/**
 * 协调引擎：维护「单轮 / 计划 / 并行」模式与步骤列表，并根据助手消息启发式切入计划模式。
 */
import type { ChatMessage } from '../types/index.js';

/** UI 与 Assistant 侧使用的协调模式 */
export type CoordinationMode = 'single' | 'plan' | 'parallel';

/** 计划中的一步 */
export interface CoordinationStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  detail?: string;
}

/** 当前计划状态快照 */
export interface PlanState {
  mode: CoordinationMode;
  steps: CoordinationStep[];
  updatedAt: number;
  lastUserGoal?: string;
}

/** 内存中的计划/模式状态机 */
export class CoordinatorEngine {
  private state: PlanState = {
    mode: 'single',
    steps: [],
    updatedAt: Date.now(),
  };

  /** 获取当前模式与步骤 */
  getState(): PlanState {
    return this.state;
  }

  /** 切换协调模式并刷新时间戳 */
  setMode(mode: CoordinationMode): void {
    this.state = { ...this.state, mode, updatedAt: Date.now() };
  }

  /** 整体替换计划步骤 */
  setSteps(steps: CoordinationStep[]): void {
    this.state = { ...this.state, steps, updatedAt: Date.now() };
  }

  /** 按 id 更新单步状态或标题等 */
  updateStep(stepId: string, patch: Partial<CoordinationStep>): CoordinationStep | null {
    const idx = this.state.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return null;

    const current = this.state.steps[idx];
    if (!current) return null;

    const next: CoordinationStep = {
      ...current,
      ...patch,
      id: current.id,
      title: patch.title ?? current.title,
      status: patch.status ?? current.status,
    };

    if (patch.detail !== undefined) {
      next.detail = patch.detail;
    }

    const steps = [...this.state.steps];
    steps[idx] = next;
    this.state = { ...this.state, steps, updatedAt: Date.now() };
    return next;
  }

  /** 根据正文关键词判断是否建议进入计划模式 */
  detectPlanModeHint(message: ChatMessage): boolean {
    const normalized = message.content.toLowerCase();
    return normalized.includes('plan') || normalized.includes('步骤') || normalized.includes('phase');
  }

  /** 仅保存最新用户目标，不在这里做冲突判定（由模型结论驱动） */
  recordUserGoal(userGoal: string): void {
    const normalized = userGoal.trim();
    if (!normalized) return;
    this.state = {
      ...this.state,
      lastUserGoal: normalized,
      updatedAt: Date.now(),
    };
  }

  /** 按模型结论强制重置计划状态 */
  forceResetForNewGoal(nextUserGoal: string): void {
    const normalized = nextUserGoal.trim() || this.state.lastUserGoal;
    this.state = {
      mode: 'single',
      steps: [],
      updatedAt: Date.now(),
      ...(normalized ? { lastUserGoal: normalized } : {}),
    };
  }

  /** 在 single 模式下消费一条助手消息，必要时自动切到 plan */
  ingestAssistantMessage(message: ChatMessage): void {
    if (this.state.mode !== 'single') return;
    if (this.detectPlanModeHint(message)) {
      this.setMode('plan');
    }
  }
}
