import { Injectable } from '@angular/core';

export interface PlanModeTrigger {
  shouldEnterPlanMode: boolean;
  reason: 'step_threshold' | 'context_budget' | 'complexity' | 'user_request' | 'none';
  details: string;
  estimatedSteps: number;
  contextUsage: number;
}

export interface ExecutionConstraint {
  maxToolCalls: number;
  maxTokenUsage: number;
  maxFileModifications: number;
  maxDurationMs: number;
  requiresApproval: boolean;
  pauseThresholds: {
    toolCallWarning: number;
    tokenWarning: number;
    fileWarning: number;
  };
}

export interface TaskExecutionState {
  toolCallCount: number;
  tokenUsage: number;
  fileModifications: string[];
  durationMs: number;
  isPaused: boolean;
  pauseReason?: string;
}

@Injectable({ providedIn: 'root' })
export class PlanModeTriggerService {
  private readonly DEFAULT_STEP_THRESHOLD = 8;
  private readonly DEFAULT_CONTEXT_BUDGET_RATIO = 0.8;
  private readonly DEFAULT_MAX_CONTEXT_TOKENS = 128000;

  private readonly DEFAULT_EXECUTION_CONSTRAINT: ExecutionConstraint = {
    maxToolCalls: 50,
    maxTokenUsage: 100000,
    maxFileModifications: 20,
    maxDurationMs: 30 * 60 * 1000,
    requiresApproval: false,
    pauseThresholds: {
      toolCallWarning: 40,
      tokenWarning: 80000,
      fileWarning: 15,
    },
  };

  private executionState: TaskExecutionState = {
    toolCallCount: 0,
    tokenUsage: 0,
    fileModifications: [],
    durationMs: 0,
    isPaused: false,
  };

  private stepThreshold = this.DEFAULT_STEP_THRESHOLD;
  private contextBudgetRatio = this.DEFAULT_CONTEXT_BUDGET_RATIO;
  private maxContextTokens = this.DEFAULT_MAX_CONTEXT_TOKENS;

  setStepThreshold(threshold: number): void {
    this.stepThreshold = threshold;
  }

  setContextBudget(ratio: number, maxTokens?: number): void {
    this.contextBudgetRatio = ratio;
    if (maxTokens) this.maxContextTokens = maxTokens;
  }

  checkPlanModeTrigger(
    request: string,
    estimatedSteps: number,
    currentContextTokens: number,
    complexityLevel: 'simple' | 'medium' | 'complex',
  ): PlanModeTrigger {
    if (estimatedSteps > this.stepThreshold) {
      return {
        shouldEnterPlanMode: true,
        reason: 'step_threshold',
        details: `预估步骤数 ${estimatedSteps} 超过阈值 ${this.stepThreshold}，需要进入规划模式`,
        estimatedSteps,
        contextUsage: currentContextTokens / this.maxContextTokens,
      };
    }

    const contextBudget = this.maxContextTokens * this.contextBudgetRatio;
    if (currentContextTokens > contextBudget) {
      return {
        shouldEnterPlanMode: true,
        reason: 'context_budget',
        details: `上下文消耗 ${currentContextTokens} tokens 接近预算上限 ${contextBudget}，需要拆分任务`,
        estimatedSteps,
        contextUsage: currentContextTokens / this.maxContextTokens,
      };
    }

    if (complexityLevel === 'complex') {
      return {
        shouldEnterPlanMode: true,
        reason: 'complexity',
        details: `任务复杂度为 ${complexityLevel}，建议进入规划模式进行任务拆分`,
        estimatedSteps,
        contextUsage: currentContextTokens / this.maxContextTokens,
      };
    }

    if (complexityLevel === 'medium' && estimatedSteps >= 4) {
      return {
        shouldEnterPlanMode: true,
        reason: 'complexity',
        details: `任务复杂度为 ${complexityLevel}，预估需要 ${estimatedSteps} 个步骤，建议进入规划模式`,
        estimatedSteps,
        contextUsage: currentContextTokens / this.maxContextTokens,
      };
    }

    const planKeywords = ['规划', '计划', '拆分', '分解', 'plan', 'break down', 'decompose'];
    if (planKeywords.some(kw => request.toLowerCase().includes(kw))) {
      return {
        shouldEnterPlanMode: true,
        reason: 'user_request',
        details: '用户请求中包含规划相关关键词',
        estimatedSteps,
        contextUsage: currentContextTokens / this.maxContextTokens,
      };
    }

    const projectAnalysisPatterns = [
      /分析.*项目|项目.*分析/i,
      /当前项目|整个项目|全部代码/i,
      /项目结构|代码结构|架构分析/i,
    ];
    if (projectAnalysisPatterns.some(p => p.test(request))) {
      return {
        shouldEnterPlanMode: true,
        reason: 'complexity',
        details: '项目级分析任务需要系统性规划，建议进入规划模式',
        estimatedSteps,
        contextUsage: currentContextTokens / this.maxContextTokens,
      };
    }

    return {
      shouldEnterPlanMode: false,
      reason: 'none',
      details: '无需进入规划模式，可直接执行',
      estimatedSteps,
      contextUsage: currentContextTokens / this.maxContextTokens,
    };
  }

  getExecutionConstraints(complexity: 'simple' | 'medium' | 'complex'): ExecutionConstraint {
    const base = { ...this.DEFAULT_EXECUTION_CONSTRAINT };

    switch (complexity) {
      case 'simple':
        return {
          ...base,
          maxToolCalls: 20,
          maxTokenUsage: 30000,
          maxFileModifications: 5,
          maxDurationMs: 10 * 60 * 1000,
          requiresApproval: false,
          pauseThresholds: {
            toolCallWarning: 15,
            tokenWarning: 25000,
            fileWarning: 4,
          },
        };
      case 'medium':
        return {
          ...base,
          maxToolCalls: 35,
          maxTokenUsage: 60000,
          maxFileModifications: 10,
          maxDurationMs: 20 * 60 * 1000,
          requiresApproval: false,
          pauseThresholds: {
            toolCallWarning: 30,
            tokenWarning: 50000,
            fileWarning: 8,
          },
        };
      case 'complex':
        return {
          ...base,
          requiresApproval: true,
          pauseThresholds: {
            toolCallWarning: 40,
            tokenWarning: 80000,
            fileWarning: 15,
          },
        };
    }
  }

  resetExecutionState(): void {
    this.executionState = {
      toolCallCount: 0,
      tokenUsage: 0,
      fileModifications: [],
      durationMs: 0,
      isPaused: false,
    };
  }

  recordToolCall(): { shouldPause: boolean; warning: string | null } {
    this.executionState.toolCallCount++;
    const constraints = this.DEFAULT_EXECUTION_CONSTRAINT;

    if (this.executionState.toolCallCount >= constraints.maxToolCalls) {
      this.executionState.isPaused = true;
      this.executionState.pauseReason = '工具调用次数达到上限';
      return {
        shouldPause: true,
        warning: `工具调用次数已达上限 ${constraints.maxToolCalls}，执行已暂停`,
      };
    }

    if (this.executionState.toolCallCount >= constraints.pauseThresholds.toolCallWarning) {
      return {
        shouldPause: false,
        warning: `警告：工具调用次数接近上限 (${this.executionState.toolCallCount}/${constraints.maxToolCalls})`,
      };
    }

    return { shouldPause: false, warning: null };
  }

  recordTokenUsage(tokens: number): { shouldPause: boolean; warning: string | null } {
    this.executionState.tokenUsage += tokens;
    const constraints = this.DEFAULT_EXECUTION_CONSTRAINT;

    if (this.executionState.tokenUsage >= constraints.maxTokenUsage) {
      this.executionState.isPaused = true;
      this.executionState.pauseReason = 'Token消耗达到上限';
      return {
        shouldPause: true,
        warning: `Token消耗已达上限 ${constraints.maxTokenUsage}，执行已暂停`,
      };
    }

    if (this.executionState.tokenUsage >= constraints.pauseThresholds.tokenWarning) {
      return {
        shouldPause: false,
        warning: `警告：Token消耗接近上限 (${this.executionState.tokenUsage}/${constraints.maxTokenUsage})`,
      };
    }

    return { shouldPause: false, warning: null };
  }

  recordFileModification(filePath: string): { shouldPause: boolean; warning: string | null } {
    if (!this.executionState.fileModifications.includes(filePath)) {
      this.executionState.fileModifications.push(filePath);
    }
    const constraints = this.DEFAULT_EXECUTION_CONSTRAINT;

    if (this.executionState.fileModifications.length >= constraints.maxFileModifications) {
      this.executionState.isPaused = true;
      this.executionState.pauseReason = '文件修改数量达到上限';
      return {
        shouldPause: true,
        warning: `文件修改数量已达上限 ${constraints.maxFileModifications}，执行已暂停`,
      };
    }

    if (this.executionState.fileModifications.length >= constraints.pauseThresholds.fileWarning) {
      return {
        shouldPause: false,
        warning: `警告：文件修改数量接近上限 (${this.executionState.fileModifications.length}/${constraints.maxFileModifications})`,
      };
    }

    return { shouldPause: false, warning: null };
  }

  getExecutionState(): TaskExecutionState {
    return { ...this.executionState };
  }

  isExecutionPaused(): boolean {
    return this.executionState.isPaused;
  }

  resumeExecution(): void {
    this.executionState.isPaused = false;
    this.executionState.pauseReason = undefined;
  }

  estimateStepsFromRequest(request: string): number {
    let score = 0;

    const taskKeywords = [
      { pattern: /实现|开发|编写|创建|构建/i, weight: 3 },
      { pattern: /设计|架构|方案/i, weight: 2 },
      { pattern: /测试|验证|检查/i, weight: 2 },
      { pattern: /重构|优化|改进/i, weight: 3 },
      { pattern: /修复|解决|bug/i, weight: 2 },
      { pattern: /分析|评估|调研/i, weight: 2 },
      { pattern: /集成|对接|API/i, weight: 2 },
      { pattern: /部署|发布|CI\/CD/i, weight: 2 },
    ];

    for (const { pattern, weight } of taskKeywords) {
      const matches = request.match(pattern);
      if (matches) {
        score += weight * matches.length;
      }
    }

    const connectorCount = (request.match(/并|然后|以及|同时|接着|随后|以及/g) || []).length;
    score += connectorCount * 2;

    const commaCount = (request.match(/[,，、]/g) || []).length;
    score += Math.floor(commaCount / 3);

    const domainCount = [
      /前端|UI|界面|页面/i,
      /后端|API|服务|接口/i,
      /数据库|SQL/i,
      /测试|E2E/i,
      /部署|Docker/i,
      /安全|认证/i,
    ].filter(pattern => pattern.test(request)).length;
    score += domainCount * 2;

    return Math.max(1, Math.min(score, 20));
  }
}
