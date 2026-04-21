import { Injectable, inject, signal } from '@angular/core';
import { TaskPlannerService, type ComplexityAnalysis } from './task-planner.service';
import type { PlannerInput } from '../domain/types';

export type ExecutionMode = 'single' | 'multi';

export interface TeamConfig {
  roles: Array<{
    type: string;
    task: string;
    model?: string;
  }>;
  parallelizable: boolean;
  estimatedDuration: number;
}

export interface ModeDecision {
  mode: ExecutionMode;
  reason: string;
  complexity: ComplexityAnalysis;
  suggestedTeamConfig?: TeamConfig;
}

export interface MultiAgentConfig {
  enabled: boolean;
  maxAgents: number;
  autoTriggerThreshold: {
    complexityScore: number;
    minSubtasks: number;
    minDuration: number;
  };
  forceMode: ExecutionMode | null;
  defaultBackend: 'in-process' | 'tmux' | 'iterm2';
  timeouts: {
    agentStartup: number;
    taskExecution: number;
    teamCreation: number;
  };
}

export const DEFAULT_MULTI_AGENT_CONFIG: MultiAgentConfig = {
  enabled: true,
  maxAgents: 5,
  autoTriggerThreshold: {
    complexityScore: 4,
    minSubtasks: 3,
    minDuration: 60_000,
  },
  forceMode: null,
  defaultBackend: 'in-process',
  timeouts: {
    agentStartup: 30_000,
    taskExecution: 300_000,
    teamCreation: 10_000,
  },
};

@Injectable({ providedIn: 'root' })
export class ExecutionModeDeciderService {
  private readonly planner = inject(TaskPlannerService);

  private readonly config = signal<MultiAgentConfig>(DEFAULT_MULTI_AGENT_CONFIG);
  private readonly multiAgentEnabled = signal(true);
  private readonly forceMode = signal<ExecutionMode | null>(null);

  getConfig(): MultiAgentConfig {
    return this.config();
  }

  setConfig(config: Partial<MultiAgentConfig>): void {
    this.config.update(current => ({ ...current, ...config }));
  }

  setMultiAgentEnabled(enabled: boolean): void {
    this.multiAgentEnabled.set(enabled);
  }

  isMultiAgentEnabled(): boolean {
    return this.multiAgentEnabled() && this.config().enabled;
  }

  forceExecutionMode(mode: ExecutionMode | null): void {
    this.forceMode.set(mode);
  }

  getForcedMode(): ExecutionMode | null {
    return this.forceMode();
  }

  decide(userRequest: string, context?: PlannerInput): ModeDecision {
    if (this.forceMode()) {
      return this.createForcedDecision(this.forceMode()!);
    }

    if (!this.isMultiAgentEnabled()) {
      return this.createSingleDecision('多智能体模式已禁用');
    }

    const complexity = this.planner.analyzeComplexity(userRequest);

    if (complexity.level === 'simple' && !complexity.requiresMultipleAgents) {
      return this.createSingleDecision('简单任务，单Agent执行', complexity);
    }

    return this.createMultiDecision(userRequest, complexity, context);
  }

  private createForcedDecision(mode: ExecutionMode): ModeDecision {
    const complexity: ComplexityAnalysis = {
      level: 'simple',
      factors: ['强制模式'],
      estimatedSubtasks: 1,
      requiresMultipleAgents: mode === 'multi',
      estimatedDurationMs: 30_000,
      estimatedSteps: 1,
    };

    return {
      mode,
      reason: `强制${mode === 'single' ? '单Agent' : '多智能体'}模式`,
      complexity,
    };
  }

  private createSingleDecision(reason: string, complexity?: ComplexityAnalysis): ModeDecision {
    return {
      mode: 'single',
      reason,
      complexity: complexity || {
        level: 'simple',
        factors: [],
        estimatedSubtasks: 1,
        requiresMultipleAgents: false,
        estimatedDurationMs: 30_000,
        estimatedSteps: 1,
      },
    };
  }

  private createMultiDecision(
    userRequest: string,
    complexity: ComplexityAnalysis,
    context?: PlannerInput,
  ): ModeDecision {
    const teamConfig = this.suggestTeamConfig(userRequest, complexity);

    return {
      mode: 'multi',
      reason: this.generateMultiReason(complexity),
      complexity,
      suggestedTeamConfig: teamConfig,
    };
  }

  private suggestTeamConfig(request: string, complexity: ComplexityAnalysis): TeamConfig {
    const roles: TeamConfig['roles'] = [];
    const lowerRequest = request.toLowerCase();

    if (/分析|调研|研究|analyze|research/i.test(request)) {
      roles.push({
        type: 'researcher',
        task: '需求分析与调研',
        model: 'haiku',
      });
    }

    if (/设计|架构|方案|design|architecture/i.test(request)) {
      roles.push({
        type: 'planner',
        task: '方案设计',
        model: 'sonnet',
      });
    }

    roles.push({
      type: 'executor',
      task: '核心实现',
      model: 'sonnet',
    });

    if (/测试|验证|test|verify/i.test(request) || complexity.level !== 'simple') {
      roles.push({
        type: 'validator',
        task: '测试验证',
        model: 'haiku',
      });
    }

    if (complexity.level === 'complex') {
      roles.push({
        type: 'reviewer',
        task: '代码评审',
        model: 'sonnet',
      });
    }

    const parallelizable = this.detectParallelism(request);

    return {
      roles,
      parallelizable,
      estimatedDuration: complexity.estimatedDurationMs,
    };
  }

  private detectParallelism(request: string): boolean {
    const indicators = ['同时', '并行', '一起', '同步', '多个任务', '多个功能', '分别'];
    return indicators.some(indicator => request.includes(indicator));
  }

  private generateMultiReason(complexity: ComplexityAnalysis): string {
    const reasons: string[] = [];

    if (complexity.level === 'complex') {
      reasons.push('任务复杂度高');
    }

    if (complexity.requiresMultipleAgents) {
      reasons.push('需要多智能体协作');
    }

    if (complexity.factors.length > 0) {
      reasons.push(...complexity.factors.slice(0, 2));
    }

    return reasons.length > 0 ? reasons.join('，') : '复杂任务需要拆分执行';
  }

  shouldShowSidebar(decision: ModeDecision): boolean {
    return decision.mode === 'multi' && this.isMultiAgentEnabled();
  }

  getModeIndicator(decision: ModeDecision): string {
    return decision.mode === 'single' ? '单Agent' : '多智能体';
  }
}
