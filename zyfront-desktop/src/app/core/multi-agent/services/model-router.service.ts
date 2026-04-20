import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentRole,
  ModelRouteDecision,
  ModelRoutePolicy,
  ModelRouteRule,
  TaskType,
} from '../domain/types';
import { ModelCatalogEntry, MODEL_CATALOG, findCatalogEntry } from '../../model-catalog';
import { ModelUsageLedgerService } from '../../model-usage-ledger.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface RouteContext {
  agentId: string;
  agentRole: AgentRole;
  taskId?: string;
  taskType?: TaskType;
  contextLength: number;
  costBudget: 'low' | 'medium' | 'high';
  qualityRequirement: 'fast' | 'balanced' | 'high';
  toolUseRequired: boolean;
}

export interface BudgetStatus {
  usedUsd: number;
  limitUsd: number | null;
  remainingUsd: number | null;
  percentageUsed: number;
  isOverBudget: boolean;
}

@Injectable({ providedIn: 'root' })
export class ModelRouterService {
  private readonly policies = new Map<string, ModelRoutePolicy>();
  private readonly decisions = new Map<string, ModelRouteDecision>();
  private readonly sessionBudgets = new Map<string, number>();

  private readonly defaultPolicy: ModelRoutePolicy = {
    policyId: 'default',
    policyName: '默认路由策略',
    description: '基于任务类型和角色的智能路由',
    rules: this.buildDefaultRules(),
    defaultModelId: 'MiniMax-M2.7',
    fallbackModelId: 'MiniMax-M2.7',
  };

  constructor(
    private readonly usageLedger: ModelUsageLedgerService,
    private readonly eventBus: MultiAgentEventBusService,
  ) {
    this.policies.set('default', this.defaultPolicy);
  }

  route(ctx: RouteContext): ModelRouteDecision {
    const policy = this.policies.get('default')!;
    const factors = this.evaluateFactors(ctx);

    let selectedModelId = this.selectModel(ctx, policy, factors);
    let fallbackModelId = this.selectFallback(selectedModelId, policy);

    const budgetCheck = this.checkBudget(ctx.agentId, factors.estimatedCostUsd);
    if (budgetCheck.isOverBudget && factors.costBudget !== 'low') {
      const cheaperModel = this.findCheaperModel(selectedModelId, factors);
      if (cheaperModel) {
        fallbackModelId = selectedModelId;
        selectedModelId = cheaperModel;
      }
    }

    const decision: ModelRouteDecision = {
      decisionId: `route-${uuidv4()}`,
      agentId: ctx.agentId,
      taskId: ctx.taskId,
      primaryModelId: selectedModelId,
      fallbackModelId,
      reason: this.buildReason(ctx, selectedModelId, factors),
      factors,
      budgetEstimate: {
        estimatedInputTokens: Math.round(ctx.contextLength * 0.75),
        estimatedOutputTokens: Math.round(ctx.contextLength * 0.25),
        estimatedCostUsd: factors.estimatedCostUsd,
      },
      confidence: this.calculateConfidence(ctx, selectedModelId, factors),
      createdAt: Date.now(),
    };

    this.decisions.set(decision.decisionId, decision);

    this.eventBus.emit({
      type: EVENT_TYPES.MODEL_ROUTED,
      sessionId: ctx.agentId.split('@')[1] || 'unknown',
      source: 'system',
      payload: { decision },
    });

    return decision;
  }

  fallback(agentId: string, fromModelId: string, reason: string): string {
    const catalog = findCatalogEntry(fromModelId);
    const fallbackId = this.defaultPolicy.fallbackModelId;

    this.eventBus.emit({
      type: EVENT_TYPES.MODEL_FALLBACK,
      sessionId: agentId.split('@')[1] || 'unknown',
      source: 'system',
      payload: {
        agentId,
        fromModelId,
        toModelId: fallbackId,
        reason,
      },
    });

    return fallbackId;
  }

  setSessionBudget(sessionId: string, limitUsd: number): void {
    this.sessionBudgets.set(sessionId, limitUsd);
  }

  getBudgetStatus(sessionId: string): BudgetStatus {
    const state = this.usageLedger.stateRo();
    const usedUsd = state.lifetimeCostUsd;
    const limitUsd = this.sessionBudgets.get(sessionId) ?? null;

    return {
      usedUsd,
      limitUsd,
      remainingUsd: limitUsd !== null ? Math.max(0, limitUsd - usedUsd) : null,
      percentageUsed: limitUsd !== null ? (usedUsd / limitUsd) * 100 : 0,
      isOverBudget: limitUsd !== null && usedUsd > limitUsd,
    };
  }

  getDecision(decisionId: string): ModelRouteDecision | undefined {
    return this.decisions.get(decisionId);
  }

  getRecentDecisions(limit = 50): ModelRouteDecision[] {
    return Array.from(this.decisions.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  getPolicy(policyId: string): ModelRoutePolicy | undefined {
    return this.policies.get(policyId);
  }

  registerPolicy(policy: ModelRoutePolicy): void {
    this.policies.set(policy.policyId, policy);
  }

  private buildDefaultRules(): ModelRouteRule[] {
    return [
      {
        condition: {
          agentRoles: ['leader', 'planner'],
          taskTypes: ['planning'],
        },
        modelId: 'claude-3-5-sonnet-latest',
        priority: 100,
      },
      {
        condition: {
          agentRoles: ['reviewer'],
          taskTypes: ['review'],
        },
        modelId: 'claude-3-5-sonnet-latest',
        priority: 90,
      },
      {
        condition: {
          agentRoles: ['executor'],
          taskTypes: ['coding', 'debugging'],
        },
        modelId: 'claude-3-7-sonnet-latest',
        priority: 85,
      },
      {
        condition: {
          taskTypes: ['research', 'analysis'],
        },
        modelId: 'claude-3-5-sonnet-latest',
        priority: 80,
      },
      {
        condition: {
          taskTypes: ['testing', 'documentation'],
        },
        modelId: 'MiniMax-M2.7',
        priority: 70,
      },
      {
        condition: {
          costBudget: 'low',
        },
        modelId: 'abab6.5s-chat',
        priority: 60,
      },
      {
        condition: {
          qualityRequirement: 'fast',
        },
        modelId: 'abab6.5s-chat',
        priority: 50,
      },
      {
        condition: {
          qualityRequirement: 'high',
        },
        modelId: 'claude-3-opus-latest',
        priority: 40,
      },
    ];
  }

  private evaluateFactors(ctx: RouteContext): ModelRouteDecision['factors'] & { estimatedCostUsd: number } {
    const contextLength = this.categorizeContextLength(ctx.contextLength);

    const model = this.getModelForEstimate(ctx);
    const estimatedCostUsd = this.estimateCost(ctx.contextLength, model);

    return {
      taskType: ctx.taskType || 'coding',
      agentRole: ctx.agentRole,
      contextLength,
      costBudget: ctx.costBudget,
      qualityRequirement: ctx.qualityRequirement,
      toolUseRequired: ctx.toolUseRequired,
      estimatedCostUsd,
    };
  }

  private selectModel(
    ctx: RouteContext,
    policy: ModelRoutePolicy,
    factors: ModelRouteDecision['factors'] & { estimatedCostUsd: number },
  ): string {
    const matchingRules = policy.rules
      .filter(rule => this.matchesRule(ctx, rule))
      .sort((a, b) => b.priority - a.priority);

    if (matchingRules.length > 0) {
      return matchingRules[0].modelId;
    }

    return policy.defaultModelId;
  }

  private matchesRule(ctx: RouteContext, rule: ModelRouteRule): boolean {
    const cond = rule.condition;

    if (cond.agentRoles && !cond.agentRoles.includes(ctx.agentRole)) {
      return false;
    }

    if (cond.taskTypes && ctx.taskType && !cond.taskTypes.includes(ctx.taskType)) {
      return false;
    }

    if (cond.costBudget && cond.costBudget !== ctx.costBudget) {
      return false;
    }

    if (cond.qualityRequirement && cond.qualityRequirement !== ctx.qualityRequirement) {
      return false;
    }

    return true;
  }

  private selectFallback(primaryModelId: string, policy: ModelRoutePolicy): string {
    const primary = findCatalogEntry(primaryModelId);
    if (!primary) return policy.fallbackModelId;

    const fallbacks = MODEL_CATALOG.filter(
      m => m.id !== primaryModelId && m.usdPer1MInput <= primary.usdPer1MInput,
    );

    if (fallbacks.length === 0) return policy.fallbackModelId;

    fallbacks.sort((a, b) => a.usdPer1MInput - b.usdPer1MInput);
    return fallbacks[0].id;
  }

  private findCheaperModel(
    currentModelId: string,
    factors: ModelRouteDecision['factors'],
  ): string | null {
    const current = findCatalogEntry(currentModelId);
    if (!current) return null;

    const cheaper = MODEL_CATALOG.filter(
      m => m.usdPer1MInput < current.usdPer1MInput,
    );

    if (cheaper.length === 0) return null;

    if (factors.toolUseRequired) {
      const withTools = cheaper.filter(m =>
        m.id.includes('claude') || m.id.includes('MiniMax'),
      );
      if (withTools.length > 0) {
        return withTools[withTools.length - 1].id;
      }
    }

    return cheaper[cheaper.length - 1].id;
  }

  private checkBudget(agentId: string, estimatedCost: number): BudgetStatus {
    const sessionId = agentId.split('@')[1];
    if (!sessionId) {
      return {
        usedUsd: 0,
        limitUsd: null,
        remainingUsd: null,
        percentageUsed: 0,
        isOverBudget: false,
      };
    }

    return this.getBudgetStatus(sessionId);
  }

  private categorizeContextLength(tokens: number): 'short' | 'medium' | 'long' {
    if (tokens < 4000) return 'short';
    if (tokens < 16000) return 'medium';
    return 'long';
  }

  private getModelForEstimate(ctx: RouteContext): ModelCatalogEntry {
    const roleModelMap: Record<AgentRole, string> = {
      leader: 'claude-3-5-sonnet-latest',
      planner: 'claude-3-5-sonnet-latest',
      executor: 'claude-3-7-sonnet-latest',
      reviewer: 'claude-3-5-sonnet-latest',
      researcher: 'claude-3-5-sonnet-latest',
      validator: 'MiniMax-M2.7',
      coordinator: 'MiniMax-M2.7',
    };

    const modelId = roleModelMap[ctx.agentRole] || 'MiniMax-M2.7';
    return findCatalogEntry(modelId) ?? MODEL_CATALOG[0];
  }

  private estimateCost(contextLength: number, model: ModelCatalogEntry): number {
    const inputTokens = Math.round(contextLength * 0.75);
    const outputTokens = Math.round(contextLength * 0.25);

    const inputCost = (inputTokens / 1_000_000) * model.usdPer1MInput;
    const outputCost = (outputTokens / 1_000_000) * model.usdPer1MOutput;

    return inputCost + outputCost;
  }

  private buildReason(
    ctx: RouteContext,
    modelId: string,
    factors: ModelRouteDecision['factors'],
  ): string {
    const parts: string[] = [];

    parts.push(`角色 ${ctx.agentRole} 推荐 ${modelId}`);

    if (ctx.taskType) {
      parts.push(`任务类型: ${ctx.taskType}`);
    }

    parts.push(`上下文长度: ${factors.contextLength}`);
    parts.push(`成本预算: ${factors.costBudget}`);
    parts.push(`质量要求: ${factors.qualityRequirement}`);

    return parts.join('; ');
  }

  private calculateConfidence(
    ctx: RouteContext,
    modelId: string,
    factors: ModelRouteDecision['factors'],
  ): number {
    let confidence = 0.5;

    const policy = this.policies.get('default')!;
    const matchingRules = policy.rules.filter(rule => this.matchesRule(ctx, rule));

    if (matchingRules.length > 0) {
      confidence += 0.3;
    }

    const model = findCatalogEntry(modelId);
    if (model) {
      if (factors.contextLength === 'long' && model.maxContextTokens >= 100000) {
        confidence += 0.1;
      }
      if (factors.toolUseRequired && model.id.includes('claude')) {
        confidence += 0.1;
      }
    }

    return Math.min(1, confidence);
  }
}
