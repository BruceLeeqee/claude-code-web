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

  ingestAssistantMessage(message: ChatMessage): void {
    if (!message.content.toLowerCase().includes('plan')) return;
    if (this.state.mode === 'single') {
      this.setMode('plan');
    }
  }
}
