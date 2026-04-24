import { Injectable, inject } from '@angular/core';
import { parseLoopCommand } from './loop-command-parser';
import { LoopTaskRouterService } from './loop-task-router.service';
import { LoopTeamManagerService } from './loop-team-manager.service';
import type {
  LoopPlanStep,
  LoopRequest,
  LoopState,
  LoopStatus,
  LoopTaskType,
  LoopTeamMember,
  LoopValidationResult,
  LoopVerificationEntry,
} from './loop-command.types';

export interface LoopCycleResult {
  state: LoopState;
  verification: LoopValidationResult;
  messages: string[];
}

@Injectable({ providedIn: 'root' })
export class LoopCommandService {
  private readonly storagePrefix = 'zyfront:loop:';
  private readonly taskRouter = inject(LoopTaskRouterService);
  private readonly teamManager = inject(LoopTeamManagerService);

  start(rawInput: string, sessionId: string): LoopState | null {
    const request = parseLoopCommand(rawInput);
    if (!request) return null;

    const state = this.createInitialState(request);
    this.save(sessionId, state);
    return state;
  }

  get(sessionId: string): LoopState | null {
    try {
      const raw = localStorage.getItem(this.key(sessionId));
      if (!raw) return null;
      return JSON.parse(raw) as LoopState;
    } catch {
      return null;
    }
  }

  update(sessionId: string, patch: Partial<LoopState>): LoopState | null {
    const current = this.get(sessionId);
    if (!current) return null;
    const next: LoopState = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.save(sessionId, next);
    return next;
  }

  advance(sessionId: string, summary?: string): LoopState | null {
    const current = this.get(sessionId);
    if (!current) return null;

    const nextIteration = current.iteration + 1;
    const status: LoopStatus =
      nextIteration >= current.maxIterations || current.status === 'blocked' || current.status === 'paused'
        ? current.status
        : 'executing';

    return this.update(sessionId, {
      iteration: nextIteration,
      status,
      lastSummary: summary ?? current.lastSummary,
    });
  }

  addValidation(sessionId: string, result: LoopValidationResult): LoopState | null {
    const current = this.get(sessionId);
    if (!current) return null;
    const nextHistory = [...current.validationHistory, result].slice(-50);
    const nextStatus: LoopStatus = result.passed
      ? result.recommendation === 'release'
        ? 'ready_for_release'
        : result.recommendation === 'stop'
          ? 'completed'
          : 'verifying'
      : result.recommendation === 'pause'
        ? 'paused'
        : result.recommendation === 'stop'
          ? 'failed'
          : result.recommendation === 'release'
            ? 'ready_for_release'
            : 'repairing';

    return this.update(sessionId, {
      validationHistory: nextHistory,
      status: nextStatus,
      blockedReasons: result.blockers.length ? [...current.blockedReasons, ...result.blockers] : current.blockedReasons,
    });
  }

  addPlanSteps(sessionId: string, steps: LoopPlanStep[]): LoopState | null {
    return this.update(sessionId, { currentPlan: steps });
  }

  /* ── 初始状态创建 ─────────────────────────────────────── */

  private createInitialState(request: LoopRequest): LoopState {
    const now = new Date().toISOString();
    const taskType = request.taskType ?? this.taskRouter.inferTaskType(request.objective);
    const teamName = request.teamName ?? this.taskRouter.defaultTeamName(taskType);
    const teamMembers = this.teamManager.buildTeamMembers(teamName);
    const requirementsDocPath = this.docPath('requirements', request.objective);
    const designDocPath = this.docPath('design', request.objective);
    return {
      loopId: `loop-${Date.now()}`,
      taskId: `task-${Date.now()}`,
      objective: request.objective,
      taskType,
      phase: taskType === 'development' ? 'requirements' : 'development',
      teamName,
      teamMembers,
      status: 'planning',
      iteration: 0,
      maxIterations: request.maxIterations ?? 12,
      currentPlan: this.buildPlan(request),
      completedSteps: [],
      blockedReasons: [],
      validationHistory: [],
      toolHistory: [],
      fileChanges: [],
      memoryRefs: [],
      buildStatus: 'unknown',
      uiStatus: 'unknown',
      apiStatus: 'unknown',
      dataStatus: 'unknown',
      retryCount: 0,
      lastEvidence: [],
      stepDocs: [
        this.buildStepDoc('requirements', 'requirements', requirementsDocPath, now),
        this.buildStepDoc('design', 'design', designDocPath, now),
        this.buildStepDoc('status', 'status', this.docPath('status', request.objective), now),
      ],
      verificationMatrix: this.defaultVerificationMatrix(now),
      artifacts: [
        { kind: 'document', label: 'requirements', path: requirementsDocPath, createdAt: now },
        { kind: 'document', label: 'design', path: designDocPath, createdAt: now },
      ],
      requirementsDocPath,
      designDocPath,
      patchFailureMap: {},
      lastSummary: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  private buildPlan(request: LoopRequest): LoopPlanStep[] {
    const objective = request.objective;
    const taskType = request.taskType ?? this.taskRouter.inferTaskType(objective);
    // 委托 TaskRouter 生成步骤
    return this.taskRouter.buildStepsForTaskType(taskType, objective);
  }

  private defaultVerificationMatrix(now: string): LoopVerificationEntry[] {
    return [
      { dimension: 'compile', passed: false, evidence: [], note: 'pending', updatedAt: now },
      { dimension: 'ui', passed: false, evidence: [], note: 'pending', updatedAt: now },
      { dimension: 'api', passed: false, evidence: [], note: 'pending', updatedAt: now },
      { dimension: 'data', passed: false, evidence: [], note: 'pending', updatedAt: now },
      { dimension: 'terminal', passed: false, evidence: [], note: 'pending', updatedAt: now },
    ];
  }

  private docPath(type: string, objective: string): string {
    const normalized = objective.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'task';
    return `02-AGENT-MEMORY/01-Short-Term/loop/${type}-${normalized}.md`;
  }

  private buildStepDoc(
    stepId: string,
    type: 'requirements' | 'design' | 'execution' | 'verification' | 'repair' | 'summary' | 'status',
    path: string,
    createdAt: string,
  ): LoopState['stepDocs'][number] {
    return {
      id: `${stepId}-${Date.now()}`,
      stepId,
      type,
      path,
      title: `${type}-${stepId}`,
      createdAt,
    };
  }

  private save(sessionId: string, state: LoopState): void {
    localStorage.setItem(this.key(sessionId), JSON.stringify(state, null, 2));
  }

  private key(sessionId: string): string {
    return `${this.storagePrefix}${sessionId}`;
  }
}
