import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import type {
  AgentDescriptor,
  AgentIntent,
  PlannerInput,
  PlannerOutput,
  SessionContext,
  TaskGraph,
  TaskNode,
  TeamContext,
} from '../domain/types';
import { TaskPlannerService } from './task-planner.service';
import { AgentFactoryService } from './agent-factory.service';
import { AgentIntentEngine, IntentEvaluationContext } from './agent-intent-engine.service';
import { AgentLifecycleManager } from './agent-lifecycle-manager.service';
import { SessionRegistryService } from './session-registry.service';
import { ModelRouterService } from './model-router.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface OrchestrationState {
  sessionId: string | null;
  status: 'idle' | 'planning' | 'executing' | 'scaling' | 'recovering' | 'completed' | 'error';
  currentPlanVersion: number;
  activeAgentCount: number;
  pendingTaskCount: number;
  completedTaskCount: number;
  lastUpdateAt: number;
  error?: string;
}

export interface ExecutionResult {
  success: boolean;
  taskId: string;
  agentId: string;
  result?: string;
  error?: string;
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class AutoScaleOrchestrator implements OnDestroy {
  private readonly state$ = new BehaviorSubject<OrchestrationState>({
    sessionId: null,
    status: 'idle',
    currentPlanVersion: 0,
    activeAgentCount: 0,
    pendingTaskCount: 0,
    completedTaskCount: 0,
    lastUpdateAt: Date.now(),
  });

  private monitorSubscription?: Subscription;
  private readonly executionQueue: Array<{ taskId: string; agentId: string }> = [];

  constructor(
    private readonly planner: TaskPlannerService,
    private readonly factory: AgentFactoryService,
    private readonly intentEngine: AgentIntentEngine,
    private readonly lifecycleManager: AgentLifecycleManager,
    private readonly sessionRegistry: SessionRegistryService,
    private readonly modelRouter: ModelRouterService,
    private readonly eventBus: MultiAgentEventBusService,
  ) {
    this.startMonitoring();
  }

  ngOnDestroy(): void {
    this.monitorSubscription?.unsubscribe();
  }

  get state() {
    return this.state$.asObservable();
  }

  getCurrentState(): OrchestrationState {
    return this.state$.value;
  }

  async startSession(
    userRequest: string,
    options: {
      sessionName?: string;
      teamName: string;
      modelPolicyId?: string;
      backendPolicy?: 'auto' | 'in-process' | 'tmux' | 'iterm2';
    },
  ): Promise<SessionContext> {
    const session = this.sessionRegistry.create({
      sessionName: options.sessionName,
      teamName: options.teamName,
      modelPolicyId: options.modelPolicyId,
      backendPolicy: options.backendPolicy,
    });

    this.sessionRegistry.setActive(session.sessionId);

    this.updateState({
      sessionId: session.sessionId,
      status: 'planning',
    });

    try {
      const plannerInput: PlannerInput = {
        userRequest,
        sessionContext: session,
        teamContext: this.sessionRegistry.getTeamContext(session.sessionId)!,
        availableAgents: [],
        toolAvailability: {},
      };

      const plan = await this.planner.plan(plannerInput);

      this.sessionRegistry.updateTaskGraph(session.sessionId, plan.taskGraph);

      await this.createAgentsForPlan(session, plan);

      this.updateState({
        status: 'executing',
        currentPlanVersion: plan.planVersion,
        pendingTaskCount: Object.keys(plan.taskGraph.tasks).length,
      });

      this.startTaskExecution(session.sessionId);

      return session;
    } catch (error) {
      this.updateState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async executeTask(sessionId: string, taskId: string): Promise<ExecutionResult> {
    const taskGraph = this.sessionRegistry.getTaskGraph(sessionId);
    if (!taskGraph) {
      throw new Error(`Task graph not found for session ${sessionId}`);
    }

    const task = taskGraph.tasks[taskId];
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const agents = this.lifecycleManager.getAllAgents();
    const agent = agents.find(
      a => a.descriptor.role === this.suggestRoleForTask(task) && a.state.status === 'idle',
    );

    if (!agent) {
      throw new Error(`No available agent for task ${taskId}`);
    }

    const startTime = Date.now();

    try {
      this.lifecycleManager.assignTask(agent.descriptor.agentId, taskId);
      task.status = 'running';
      task.startedAt = startTime;
      task.assignedAgentId = agent.descriptor.agentId;

      this.eventBus.emit({
        type: EVENT_TYPES.TASK_STARTED,
        sessionId,
        source: 'system',
        payload: {
          taskId,
          agentId: agent.descriptor.agentId,
          startedAt: startTime,
        },
      });

      const result: ExecutionResult = {
        success: true,
        taskId,
        agentId: agent.descriptor.agentId,
        result: `Task ${task.title} completed successfully`,
        durationMs: Date.now() - startTime,
      };

      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result.result;

      this.lifecycleManager.completeTask(agent.descriptor.agentId, taskId);

      this.eventBus.emit({
        type: EVENT_TYPES.TASK_COMPLETED,
        sessionId,
        source: 'system',
        payload: {
          taskId,
          agentId: agent.descriptor.agentId,
          result: result.result!,
          durationMs: result.durationMs,
        },
      });

      this.updateTaskCounts(sessionId);

      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';

      this.eventBus.emit({
        type: EVENT_TYPES.TASK_FAILED,
        sessionId,
        source: 'system',
        payload: {
          taskId,
          agentId: agent.descriptor.agentId,
          error: task.error,
          retriable: true,
        },
      });

      return {
        success: false,
        taskId,
        agentId: agent.descriptor.agentId,
        error: task.error,
        durationMs: Date.now() - startTime,
      };
    }
  }

  async scaleUp(sessionId: string): Promise<AgentDescriptor[]> {
    this.updateState({ status: 'scaling' });

    const session = this.sessionRegistry.get(sessionId);
    const teamContext = this.sessionRegistry.getTeamContext(sessionId);
    const taskGraph = this.sessionRegistry.getTaskGraph(sessionId);

    if (!session || !teamContext || !taskGraph) {
      throw new Error('Session context not found');
    }

    const evalContext: IntentEvaluationContext = {
      sessionContext: session,
      teamContext,
      taskGraph,
      currentAgentCount: session.agentIds.length,
      activeTaskCount: Object.values(taskGraph.tasks).filter(t => t.status === 'running').length,
      contextPressure: this.calculateContextPressure(sessionId),
    };

    const evaluation = this.intentEngine.evaluate(evalContext);

    if (!evaluation.shouldCreateAgent) {
      this.updateState({ status: 'executing' });
      return [];
    }

    const createdAgents: AgentDescriptor[] = [];

    for (const intent of evaluation.intents) {
      try {
        const result = await this.factory.create({
          intent,
          task: taskGraph.tasks[intent.taskId],
          sessionContext: session,
          createdBy: 'auto-scale',
        });

        this.lifecycleManager.register(result.descriptor, result.runtimeState);
        this.sessionRegistry.addAgent(sessionId, result.descriptor.agentId);

        createdAgents.push(result.descriptor);

        this.intentEngine.consumeIntent(intent.intentId);
      } catch (error) {
        console.error(`Failed to create agent for intent ${intent.intentId}:`, error);
      }
    }

    this.updateState({
      status: 'executing',
      activeAgentCount: session.agentIds.length + createdAgents.length,
    });

    return createdAgents;
  }

  async recover(sessionId: string): Promise<void> {
    this.updateState({ status: 'recovering' });

    const failedAgents = this.lifecycleManager.getAgentsByStatus('failed');

    for (const agentId of failedAgents) {
      try {
        await this.lifecycleManager.recover(agentId);
      } catch (error) {
        console.error(`Failed to recover agent ${agentId}:`, error);
      }
    }

    const taskGraph = this.sessionRegistry.getTaskGraph(sessionId);
    if (taskGraph) {
      const failedTasks = Object.values(taskGraph.tasks).filter(t => t.status === 'failed');

      for (const task of failedTasks) {
        task.status = 'pending';
        task.error = undefined;
      }
    }

    this.updateState({ status: 'executing' });
  }

  async replan(sessionId: string, reason: string): Promise<PlannerOutput> {
    const session = this.sessionRegistry.get(sessionId);
    const teamContext = this.sessionRegistry.getTeamContext(sessionId);
    const currentGraph = this.sessionRegistry.getTaskGraph(sessionId);

    if (!session || !teamContext || !currentGraph) {
      throw new Error('Session context not found');
    }

    const agents = this.lifecycleManager.getAllAgents();

    const plannerInput: PlannerInput = {
      userRequest: reason,
      sessionContext: session,
      teamContext,
      availableAgents: agents.map(a => a.descriptor),
      toolAvailability: {},
    };

    const plan = await this.planner.replan(
      plannerInput,
      reason,
      currentGraph.planVersion,
    );

    this.sessionRegistry.updateTaskGraph(sessionId, plan.taskGraph);

    await this.createAgentsForPlan(session, plan);

    this.updateState({
      currentPlanVersion: plan.planVersion,
      pendingTaskCount: Object.keys(plan.taskGraph.tasks).length,
    });

    return plan;
  }

  pauseSession(sessionId: string): void {
    this.sessionRegistry.pause(sessionId, 'user');
    this.updateState({ status: 'idle' });
  }

  resumeSession(sessionId: string): void {
    this.sessionRegistry.resume(sessionId, {
      restoreAgents: true,
      restoreTasks: true,
      resumeExecution: true,
    });
    this.updateState({ status: 'executing' });
    this.startTaskExecution(sessionId);
  }

  closeSession(sessionId: string): void {
    this.sessionRegistry.close(sessionId, 'user');
    this.updateState({
      sessionId: null,
      status: 'idle',
      currentPlanVersion: 0,
      activeAgentCount: 0,
      pendingTaskCount: 0,
      completedTaskCount: 0,
    });
  }

  private async createAgentsForPlan(
    session: SessionContext,
    plan: PlannerOutput,
  ): Promise<void> {
    const existingAgents = this.lifecycleManager.getAllAgents();

    for (const intent of plan.agentIntents) {
      const task = plan.taskGraph.tasks[intent.taskId];
      if (!task) continue;

      const routeDecision = this.modelRouter.route({
        agentId: `pending-${intent.suggestedRole}`,
        agentRole: intent.suggestedRole,
        taskId: intent.taskId,
        taskType: task.type,
        contextLength: 8000,
        costBudget: 'medium',
        qualityRequirement: 'balanced',
        toolUseRequired: true,
      });

      const result = await this.factory.create({
        intent,
        task,
        sessionContext: session,
        modelId: routeDecision.primaryModelId,
        createdBy: 'planner',
      });

      this.lifecycleManager.register(result.descriptor, result.runtimeState);
      this.sessionRegistry.addAgent(session.sessionId, result.descriptor.agentId);
    }

    if (existingAgents.length === 0 && plan.agentIntents.length === 0) {
      const leaderResult = await this.factory.create({
        sessionContext: session,
        modelId: 'claude-3-5-sonnet-latest',
        createdBy: 'planner',
      });

      this.lifecycleManager.register(leaderResult.descriptor, leaderResult.runtimeState);
      this.sessionRegistry.addAgent(session.sessionId, leaderResult.descriptor.agentId);
    }

    this.updateState({
      activeAgentCount: this.sessionRegistry.get(session.sessionId)?.agentIds.length || 0,
    });
  }

  private startTaskExecution(sessionId: string): void {
    const taskGraph = this.sessionRegistry.getTaskGraph(sessionId);
    if (!taskGraph) return;

    const readyTasks = Object.values(taskGraph.tasks).filter(
      t => t.status === 'pending' && this.areDependenciesMet(t, taskGraph),
    );

    readyTasks.forEach(task => {
      this.executionQueue.push({
        taskId: task.taskId,
        agentId: task.assignedAgentId || '',
      });
    });

    this.processExecutionQueue(sessionId);
  }

  private async processExecutionQueue(sessionId: string): Promise<void> {
    while (this.executionQueue.length > 0) {
      const item = this.executionQueue.shift();
      if (!item) break;

      const taskGraph = this.sessionRegistry.getTaskGraph(sessionId);
      if (!taskGraph) break;

      const task = taskGraph.tasks[item.taskId];
      if (!task || task.status !== 'pending') continue;

      if (!this.areDependenciesMet(task, taskGraph)) {
        this.executionQueue.push(item);
        continue;
      }

      try {
        await this.executeTask(sessionId, item.taskId);
      } catch (error) {
        console.error(`Failed to execute task ${item.taskId}:`, error);
      }

      const updatedGraph = this.sessionRegistry.getTaskGraph(sessionId);
      if (updatedGraph) {
        Object.values(updatedGraph.tasks)
          .filter(t => t.status === 'pending' && this.areDependenciesMet(t, updatedGraph))
          .forEach(t => {
            if (!this.executionQueue.some(e => e.taskId === t.taskId)) {
              this.executionQueue.push({
                taskId: t.taskId,
                agentId: t.assignedAgentId || '',
              });
            }
          });
      }
    }

    this.checkCompletion(sessionId);
  }

  private areDependenciesMet(task: TaskNode, graph: TaskGraph): boolean {
    return task.dependencies.every(depId => {
      const depTask = graph.tasks[depId];
      return depTask && depTask.status === 'completed';
    });
  }

  private checkCompletion(sessionId: string): void {
    const taskGraph = this.sessionRegistry.getTaskGraph(sessionId);
    if (!taskGraph) return;

    const allTasks = Object.values(taskGraph.tasks);
    const completed = allTasks.filter(t => t.status === 'completed').length;
    const failed = allTasks.filter(t => t.status === 'failed').length;
    const pending = allTasks.filter(t => t.status === 'pending' || t.status === 'running').length;

    if (pending === 0) {
      if (failed > 0) {
        this.updateState({ status: 'error', error: `${failed} tasks failed` });
      } else {
        this.updateState({ status: 'completed' });
      }
    }
  }

  private updateTaskCounts(sessionId: string): void {
    const taskGraph = this.sessionRegistry.getTaskGraph(sessionId);
    if (!taskGraph) return;

    const tasks = Object.values(taskGraph.tasks);
    const pending = tasks.filter(t => t.status === 'pending' || t.status === 'running').length;
    const completed = tasks.filter(t => t.status === 'completed').length;

    this.updateState({
      pendingTaskCount: pending,
      completedTaskCount: completed,
    });
  }

  private calculateContextPressure(sessionId: string): number {
    const agents = this.lifecycleManager.getAllAgents();
    const sessionAgents = agents.filter(
      a => a.descriptor.sessionId === sessionId,
    );

    if (sessionAgents.length === 0) return 0;

    const avgTokens = sessionAgents.reduce(
      (sum, a) => sum + a.state.totalTokensUsed,
      0,
    ) / sessionAgents.length;

    const maxTokens = 100000;
    return Math.min(1, avgTokens / maxTokens);
  }

  private suggestRoleForTask(task: TaskNode): string {
    const roleMap: Record<string, string> = {
      planning: 'planner',
      coding: 'executor',
      debugging: 'executor',
      review: 'reviewer',
      research: 'researcher',
      testing: 'validator',
      documentation: 'researcher',
      analysis: 'researcher',
    };

    return roleMap[task.type] || 'executor';
  }

  private startMonitoring(): void {
    this.monitorSubscription = interval(30000).subscribe(() => {
      const state = this.state$.value;
      if (state.status === 'executing' && state.sessionId) {
        this.evaluateAutoScale(state.sessionId);
      }
    });
  }

  private async evaluateAutoScale(sessionId: string): Promise<void> {
    const session = this.sessionRegistry.get(sessionId);
    const taskGraph = this.sessionRegistry.getTaskGraph(sessionId);

    if (!session || !taskGraph) return;

    const pendingTasks = Object.values(taskGraph.tasks).filter(
      t => t.status === 'pending',
    ).length;

    const idleAgents = this.lifecycleManager.getAgentsByStatus('idle').length;

    if (pendingTasks > idleAgents * 2 && session.agentIds.length < 8) {
      await this.scaleUp(sessionId);
    }
  }

  private updateState(partial: Partial<OrchestrationState>): void {
    this.state$.next({
      ...this.state$.value,
      ...partial,
      lastUpdateAt: Date.now(),
    });
  }
}
