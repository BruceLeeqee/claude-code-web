import type { ChatMessage } from '../types/index.js';

export type CoordinationMode = 'single' | 'plan' | 'parallel';

export interface CoordinationStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  detail?: string;
}

export interface PlanState {
  mode: CoordinationMode;
  steps: CoordinationStep[];
  updatedAt: number;
}

export class CoordinatorEngine {
  private state: PlanState = {
    mode: 'single',
    steps: [],
    updatedAt: Date.now(),
  };

  getState(): PlanState {
    return this.state;
  }

  setMode(mode: CoordinationMode): void {
    this.state = { ...this.state, mode, updatedAt: Date.now() };
  }

  setSteps(steps: CoordinationStep[]): void {
    this.state = { ...this.state, steps, updatedAt: Date.now() };
  }

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

  detectPlanModeHint(message: ChatMessage): boolean {
    const normalized = message.content.toLowerCase();
    return normalized.includes('plan') || normalized.includes('步骤') || normalized.includes('phase');
  }

  ingestAssistantMessage(message: ChatMessage): void {
    if (this.state.mode !== 'single') return;
    if (this.detectPlanModeHint(message)) {
      this.setMode('plan');
    }
  }
}
