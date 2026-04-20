import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  AgentDescriptor,
  AgentIntent,
  AgentLifecycleStatus,
  AgentRole,
  AgentRuntimeState,
  AgentTemplate,
  ModelRouteDecision,
  PlannerOutput,
  SessionContext,
  SessionSnapshot,
  TaskGraph,
  TaskNode,
  TeamContext,
} from './domain/types';
import type { OrchestrationState, ExecutionResult } from './services/auto-scale-orchestrator.service';
import { TaskPlannerService } from './services/task-planner.service';
import { AgentFactoryService, AgentCreateInput, DryRunResult } from './services/agent-factory.service';
import { AgentIntentEngine, IntentEvaluationContext, IntentEvaluationResult } from './services/agent-intent-engine.service';
import { AgentLifecycleManager, AgentTerminationReason } from './services/agent-lifecycle-manager.service';
import { SessionRegistryService, SessionCreateOptions, SessionRestoreOptions } from './services/session-registry.service';
import { ModelRouterService, RouteContext, BudgetStatus } from './services/model-router.service';
import { AutoScaleOrchestrator } from './services/auto-scale-orchestrator.service';
import { MultiAgentEventBusService } from './multi-agent.event-bus.service';

@Injectable({ providedIn: 'root' })
export class MultiAgentFacade {
  constructor(
    private readonly planner: TaskPlannerService,
    private readonly factory: AgentFactoryService,
    private readonly intentEngine: AgentIntentEngine,
    private readonly lifecycleManager: AgentLifecycleManager,
    private readonly sessionRegistry: SessionRegistryService,
    private readonly modelRouter: ModelRouterService,
    private readonly orchestrator: AutoScaleOrchestrator,
    private readonly eventBus: MultiAgentEventBusService,
  ) {}

  readonly orchestrationState$ = this.orchestrator.state;
  readonly sessions$ = this.sessionRegistry.sessions;
  readonly activeSessionId$ = this.sessionRegistry.activeSessionId;
  readonly events$ = this.eventBus.events$;

  async startSession(
    userRequest: string,
    options: {
      sessionName?: string;
      teamName: string;
      modelPolicyId?: string;
      backendPolicy?: 'auto' | 'in-process' | 'tmux' | 'iterm2';
    },
  ): Promise<SessionContext> {
    return this.orchestrator.startSession(userRequest, options);
  }

  pauseSession(sessionId: string): void {
    this.orchestrator.pauseSession(sessionId);
  }

  resumeSession(sessionId: string): void {
    this.orchestrator.resumeSession(sessionId);
  }

  closeSession(sessionId: string): void {
    this.orchestrator.closeSession(sessionId);
  }

  getSession(sessionId: string): SessionContext | undefined {
    return this.sessionRegistry.get(sessionId);
  }

  getActiveSession(): SessionContext | undefined {
    return this.sessionRegistry.getActive();
  }

  getAllSessions(): SessionContext[] {
    return this.sessionRegistry.getAll();
  }

  createSnapshot(sessionId: string): SessionSnapshot | undefined {
    return this.sessionRegistry.createSnapshot(sessionId);
  }

  restoreFromSnapshot(
    sessionId: string,
    snapshotId: string,
    options?: SessionRestoreOptions,
  ): SessionContext | undefined {
    return this.sessionRegistry.restoreFromSnapshot(sessionId, snapshotId, options);
  }

  getTaskGraph(sessionId: string): TaskGraph | undefined {
    return this.sessionRegistry.getTaskGraph(sessionId);
  }

  async executeTask(sessionId: string, taskId: string): Promise<ExecutionResult> {
    return this.orchestrator.executeTask(sessionId, taskId);
  }

  async replan(sessionId: string, reason: string): Promise<PlannerOutput> {
    return this.orchestrator.replan(sessionId, reason);
  }

  getAgent(agentId: string): AgentDescriptor | undefined {
    return this.factory.getAgent(agentId);
  }

  getAgentState(agentId: string): AgentRuntimeState | undefined {
    return this.lifecycleManager.getState(agentId);
  }

  getAgentState$(agentId: string): Observable<AgentRuntimeState> | undefined {
    return this.lifecycleManager.getState$(agentId);
  }

  getAllAgents(): Array<{ descriptor: AgentDescriptor; state: AgentRuntimeState }> {
    return this.lifecycleManager.getAllAgents();
  }

  getAgentTemplate(roleOrId: string): AgentTemplate | undefined {
    return this.factory.getTemplate(roleOrId);
  }

  getAllAgentTemplates(): AgentTemplate[] {
    return this.factory.getAllTemplates();
  }

  async createAgent(input: AgentCreateInput): Promise<{
    descriptor: AgentDescriptor;
    runtimeState: AgentRuntimeState;
  }> {
    const result = await this.factory.create(input);
    this.lifecycleManager.register(result.descriptor, result.runtimeState);

    if (input.sessionContext) {
      this.sessionRegistry.addAgent(input.sessionContext.sessionId, result.descriptor.agentId);
    }

    return {
      descriptor: result.descriptor,
      runtimeState: result.runtimeState,
    };
  }

  async previewAgentCreation(input: AgentCreateInput): Promise<DryRunResult> {
    return this.factory.dryRun(input);
  }

  async stopAgent(agentId: string, reason?: string): Promise<void> {
    await this.lifecycleManager.stop(agentId, reason);
  }

  async terminateAgent(agentId: string, reason: AgentTerminationReason): Promise<void> {
    const descriptor = this.factory.getAgent(agentId);
    await this.lifecycleManager.terminate(agentId, reason);

    if (descriptor) {
      this.sessionRegistry.removeAgent(descriptor.sessionId, agentId);
    }
  }

  async recoverAgent(agentId: string): Promise<void> {
    await this.lifecycleManager.recover(agentId);
  }

  routeModel(ctx: RouteContext): ModelRouteDecision {
    return this.modelRouter.route(ctx);
  }

  setSessionBudget(sessionId: string, limitUsd: number): void {
    this.modelRouter.setSessionBudget(sessionId, limitUsd);
  }

  getSessionBudgetStatus(sessionId: string): BudgetStatus {
    return this.modelRouter.getBudgetStatus(sessionId);
  }

  evaluateAutoScale(ctx: IntentEvaluationContext): IntentEvaluationResult {
    return this.intentEngine.evaluate(ctx);
  }

  async scaleUp(sessionId: string): Promise<AgentDescriptor[]> {
    return this.orchestrator.scaleUp(sessionId);
  }

  async recover(sessionId: string): Promise<void> {
    return this.orchestrator.recover(sessionId);
  }

  getOrchestrationState(): OrchestrationState {
    return this.orchestrator.getCurrentState();
  }

  analyzeTaskComplexity(request: string): {
    level: 'simple' | 'medium' | 'complex';
    factors: string[];
    estimatedSubtasks: number;
    requiresMultipleAgents: boolean;
    estimatedDurationMs: number;
  } {
    return this.planner.analyzeComplexity(request);
  }

  getPendingIntents(): AgentIntent[] {
    return this.intentEngine.getPendingIntents();
  }

  getAgentTransitions(agentId?: string): Array<{
    agentId: string;
    from: AgentLifecycleStatus;
    to: AgentLifecycleStatus;
    reason?: string;
    timestamp: number;
  }> {
    return this.lifecycleManager.getTransitions(agentId);
  }
}
