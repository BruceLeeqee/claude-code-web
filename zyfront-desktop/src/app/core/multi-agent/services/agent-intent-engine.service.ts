import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentIntent,
  AgentRole,
  SessionContext,
  TaskGraph,
  TaskNode,
  TeamContext,
} from '../domain/types';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface IntentEvaluationContext {
  sessionContext: SessionContext;
  teamContext: TeamContext;
  taskGraph: TaskGraph;
  currentAgentCount: number;
  activeTaskCount: number;
  contextPressure: number;
}

export interface IntentEvaluationResult {
  shouldCreateAgent: boolean;
  intents: AgentIntent[];
  reasons: string[];
  urgency: 'low' | 'medium' | 'high';
}

export interface AutoScaleConfig {
  maxAgentsPerSession: number;
  idleTimeoutMs: number;
  contextPressureThreshold: number;
  parallelTaskThreshold: number;
}

@Injectable({ providedIn: 'root' })
export class AgentIntentEngine {
  private readonly pendingIntents: Map<string, AgentIntent> = new Map();
  private readonly config: AutoScaleConfig = {
    maxAgentsPerSession: 8,
    idleTimeoutMs: 5 * 60 * 1000,
    contextPressureThreshold: 0.8,
    parallelTaskThreshold: 3,
  };

  constructor(private readonly eventBus: MultiAgentEventBusService) {}

  evaluate(ctx: IntentEvaluationContext): IntentEvaluationResult {
    const intents: AgentIntent[] = [];
    const reasons: string[] = [];
    let urgency: 'low' | 'medium' | 'high' = 'low';

    const complexityIntents = this.evaluateTaskComplexity(ctx);
    if (complexityIntents.length > 0) {
      intents.push(...complexityIntents);
      reasons.push('任务复杂度需要额外智能体');
      urgency = 'medium';
    }

    const contextIntents = this.evaluateContextPressure(ctx);
    if (contextIntents.length > 0) {
      intents.push(...contextIntents);
      reasons.push('上下文压力需要分流');
      if (urgency === 'low') {
        urgency = 'medium';
      }
    }

    const parallelIntents = this.evaluateParallelism(ctx);
    if (parallelIntents.length > 0) {
      intents.push(...parallelIntents);
      reasons.push('并行任务需要多个执行者');
    }

    const roleIntents = this.evaluateRoleGaps(ctx);
    if (roleIntents.length > 0) {
      intents.push(...roleIntents);
      reasons.push('缺少必要角色');
    }

    const recoveryIntents = this.evaluateRecoveryNeeds(ctx);
    if (recoveryIntents.length > 0) {
      intents.push(...recoveryIntents);
      reasons.push('需要恢复失败的智能体');
      urgency = 'high';
    }

    const filteredIntents = this.applyLimits(intents, ctx);

    filteredIntents.forEach(intent => {
      this.pendingIntents.set(intent.intentId, intent);
      this.eventBus.emit({
        type: EVENT_TYPES.AGENT_INTENT_CREATED,
        sessionId: ctx.sessionContext.sessionId,
        source: 'auto-scale',
        payload: {
          intent,
          triggerTaskId: intent.taskId,
        },
      });
    });

    return {
      shouldCreateAgent: filteredIntents.length > 0,
      intents: filteredIntents,
      reasons,
      urgency,
    };
  }

  getIntent(intentId: string): AgentIntent | undefined {
    return this.pendingIntents.get(intentId);
  }

  consumeIntent(intentId: string): AgentIntent | undefined {
    const intent = this.pendingIntents.get(intentId);
    if (intent) {
      this.pendingIntents.delete(intentId);
    }
    return intent;
  }

  expireIntent(intentId: string, reason: 'timeout' | 'cancelled' | 'superseded'): void {
    const intent = this.pendingIntents.get(intentId);
    if (intent) {
      this.pendingIntents.delete(intentId);
      this.eventBus.emit({
        type: EVENT_TYPES.AGENT_INTENT_EXPIRED,
        sessionId: intent.taskId.split('-')[0] || 'unknown',
        source: 'system',
        payload: {
          intentId,
          reason,
        },
      });
    }
  }

  expireAllIntents(reason: 'timeout' | 'cancelled' | 'superseded'): void {
    this.pendingIntents.forEach((_, intentId) => {
      this.expireIntent(intentId, reason);
    });
  }

  getPendingIntents(): AgentIntent[] {
    return Array.from(this.pendingIntents.values());
  }

  private evaluateTaskComplexity(ctx: IntentEvaluationContext): AgentIntent[] {
    const intents: AgentIntent[] = [];
    const tasks = Object.values(ctx.taskGraph.tasks);
    const complexTasks = tasks.filter(t => this.isComplexTask(t));

    complexTasks.forEach(task => {
      if (ctx.currentAgentCount >= this.config.maxAgentsPerSession) return;

      const subTasks = this.estimateSubTasks(task);
      if (subTasks > 1) {
        intents.push(this.createIntent({
          reason: 'task-complexity',
          taskId: task.taskId,
          suggestedRole: this.suggestRoleForTask(task),
          priority: task.priority,
          lifetimePolicy: 'task-bound',
        }));
      }
    });

    return intents;
  }

  private evaluateContextPressure(ctx: IntentEvaluationContext): AgentIntent[] {
    const intents: AgentIntent[] = [];

    if (ctx.contextPressure >= this.config.contextPressureThreshold) {
      const runningTasks = Object.values(ctx.taskGraph.tasks).filter(
        t => t.status === 'running',
      );

      if (runningTasks.length > 0 && ctx.currentAgentCount < this.config.maxAgentsPerSession) {
        intents.push(this.createIntent({
          reason: 'context-pressure',
          taskId: runningTasks[0].taskId,
          suggestedRole: 'executor',
          priority: 'high',
          lifetimePolicy: 'task-bound',
          resourceBudget: {
            maxTokens: 50000,
          },
        }));
      }
    }

    return intents;
  }

  private evaluateParallelism(ctx: IntentEvaluationContext): AgentIntent[] {
    const intents: AgentIntent[] = [];
    const readyTasks = Object.values(ctx.taskGraph.tasks).filter(
      t => t.status === 'pending' && t.dependencies.length === 0,
    );

    if (readyTasks.length >= this.config.parallelTaskThreshold) {
      const availableSlots = this.config.maxAgentsPerSession - ctx.currentAgentCount;
      const tasksToAssign = readyTasks.slice(0, Math.min(availableSlots, readyTasks.length - 1));

      tasksToAssign.forEach(task => {
        intents.push(this.createIntent({
          reason: 'parallelism',
          taskId: task.taskId,
          suggestedRole: this.suggestRoleForTask(task),
          priority: task.priority,
          lifetimePolicy: 'task-bound',
        }));
      });
    }

    return intents;
  }

  private evaluateRoleGaps(ctx: IntentEvaluationContext): AgentIntent[] {
    const intents: AgentIntent[] = [];
    const requiredRoles = this.identifyRequiredRoles(ctx.taskGraph);
    const existingRoles = new Set(ctx.teamContext.agentIds.map(() => 'executor'));

    requiredRoles.forEach(role => {
      if (!existingRoles.has(role) && ctx.currentAgentCount < this.config.maxAgentsPerSession) {
        const unassignedTasks = Object.values(ctx.taskGraph.tasks).filter(
          t => t.status === 'pending' && !t.assignedAgentId,
        );

        const matchingTask = unassignedTasks.find(t => this.taskRequiresRole(t, role));

        if (matchingTask) {
          intents.push(this.createIntent({
            reason: 'role-gap',
            taskId: matchingTask.taskId,
            suggestedRole: role,
            priority: 'medium',
            lifetimePolicy: 'task-bound',
          }));
        }
      }
    });

    return intents;
  }

  private evaluateRecoveryNeeds(ctx: IntentEvaluationContext): AgentIntent[] {
    const intents: AgentIntent[] = [];
    const failedTasks = Object.values(ctx.taskGraph.tasks).filter(
      t => t.status === 'failed',
    );

    failedTasks.forEach(task => {
      if (ctx.currentAgentCount < this.config.maxAgentsPerSession) {
        intents.push(this.createIntent({
          reason: 'recovery',
          taskId: task.taskId,
          suggestedRole: this.suggestRoleForTask(task),
          priority: 'high',
          lifetimePolicy: 'task-bound',
        }));
      }
    });

    return intents;
  }

  private applyLimits(intents: AgentIntent[], ctx: IntentEvaluationContext): AgentIntent[] {
    const availableSlots = this.config.maxAgentsPerSession - ctx.currentAgentCount;

    if (intents.length <= availableSlots) {
      return intents;
    }

    return intents
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })
      .slice(0, availableSlots);
  }

  private createIntent(options: {
    reason: AgentIntent['reason'];
    taskId: string;
    suggestedRole: AgentRole;
    priority: AgentIntent['priority'];
    lifetimePolicy: AgentIntent['lifetimePolicy'];
    resourceBudget?: AgentIntent['resourceBudget'];
  }): AgentIntent {
    return {
      intentId: `intent-${uuidv4()}`,
      reason: options.reason,
      taskId: options.taskId,
      suggestedRole: options.suggestedRole,
      expectedInputs: [],
      expectedOutputs: [],
      priority: options.priority,
      lifetimePolicy: options.lifetimePolicy,
      resourceBudget: options.resourceBudget,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
  }

  private isComplexTask(task: TaskNode): boolean {
    const complexIndicators = [
      task.description.length > 200,
      task.type === 'planning',
      task.type === 'research',
      task.priority === 'critical',
    ];

    return complexIndicators.filter(Boolean).length >= 2;
  }

  private estimateSubTasks(task: TaskNode): number {
    if (task.type === 'planning') return 3;
    if (task.type === 'research') return 2;
    if (task.description.includes('同时') || task.description.includes('并行')) return 2;
    return 1;
  }

  private suggestRoleForTask(task: TaskNode): AgentRole {
    const roleMap: Record<string, AgentRole> = {
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

  private identifyRequiredRoles(taskGraph: TaskGraph): AgentRole[] {
    const roles = new Set<AgentRole>();

    Object.values(taskGraph.tasks).forEach(task => {
      roles.add(this.suggestRoleForTask(task));
    });

    return Array.from(roles);
  }

  private taskRequiresRole(task: TaskNode, role: AgentRole): boolean {
    return this.suggestRoleForTask(task) === role;
  }
}
