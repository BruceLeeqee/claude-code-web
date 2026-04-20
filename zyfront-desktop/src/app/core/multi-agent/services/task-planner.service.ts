import { Injectable, inject } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentDescriptor,
  AgentIntent,
  AgentRole,
  PlannerInput,
  PlannerOutput,
  SessionContext,
  TaskGraph,
  TaskNode,
  TaskNodeStatus,
  TaskPriority,
  TaskType,
  TeamContext,
} from '../domain/types';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import { LLMTaskDecompositionService } from './llm-task-decomposition.service';

export interface TaskDecomposition {
  subtasks: TaskNode[];
  dependencies: Array<{ from: string; to: string }>;
  suggestedRoles: AgentRole[];
  parallelizable: boolean;
}

export interface ComplexityAnalysis {
  level: 'simple' | 'medium' | 'complex';
  factors: string[];
  estimatedSubtasks: number;
  requiresMultipleAgents: boolean;
  estimatedDurationMs: number;
}

export interface SimplePlan {
  type: 'simple';
  task: {
    title: string;
    description: string;
    type: TaskType;
  };
  estimatedDurationMs: number;
  shouldUseSingleAgent: boolean;
}

@Injectable({ providedIn: 'root' })
export class TaskPlannerService {
  private planVersion = 0;
  private currentTaskGraph: TaskGraph | null = null;

  private readonly taskTypeKeywords: Record<TaskType, string[]> = {
    planning: ['规划', '设计方案', '制定计划', '计划', '设计', '方案', 'plan', 'design'],
    coding: ['编码', '实现', '开发', '写代码', 'code', 'implement', 'develop', '算法'],
    debugging: ['调试', '修复', 'bug', '错误', 'debug', 'fix', 'error'],
    review: ['评审', '审查', '检查', 'review', 'audit', 'check'],
    research: ['调研', '研究', '分析', '调研分析', 'research', 'analyze', 'investigate'],
    testing: ['测试', '验证', 'test', 'verify', 'validate'],
    documentation: ['文档', '说明', '注释', 'document', 'doc', 'readme'],
    analysis: ['评估', '统计', 'evaluate', 'statistics'],
    coordination: ['协调', '同步', '协作', 'coordinate', 'sync', 'collaborate'],
  };

  private readonly taskTypePriority: TaskType[] = ['research', 'testing', 'review', 'debugging', 'planning', 'coding', 'documentation', 'analysis', 'coordination'];

  private readonly roleCapabilities: Record<AgentRole, TaskType[]> = {
    leader: ['planning', 'coordination'],
    planner: ['planning', 'analysis'],
    executor: ['coding', 'debugging', 'testing'],
    reviewer: ['review', 'testing'],
    researcher: ['research', 'analysis', 'documentation'],
    validator: ['testing', 'review'],
    coordinator: ['planning', 'coordination'],
  };

  constructor(
    private readonly eventBus: MultiAgentEventBusService,
    private readonly llmDecomposition: LLMTaskDecompositionService,
  ) {}

  planSimple(request: string): SimplePlan {
    const taskType = this.detectTaskType(request);
    const complexity = this.analyzeComplexity(request);

    return {
      type: 'simple',
      task: {
        title: this.extractTitle(request),
        description: request,
        type: taskType,
      },
      estimatedDurationMs: complexity.estimatedDurationMs,
      shouldUseSingleAgent: complexity.level === 'simple' && !complexity.requiresMultipleAgents,
    };
  }

  private extractTitle(request: string): string {
    const firstLine = request.split('\n')[0] || request;
    if (firstLine.length <= 50) {
      return firstLine;
    }
    return firstLine.substring(0, 47) + '...';
  }

  shouldUseSingleAgent(request: string): boolean {
    const complexity = this.analyzeComplexity(request);
    return complexity.level === 'simple' && !complexity.requiresMultipleAgents;
  }

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    this.planVersion += 1;

    const complexity = this.analyzeComplexity(input.userRequest);
    const decomposition = await this.decomposeTaskWithLLM(input.userRequest, complexity, input);

    const taskGraph = this.buildTaskGraph(
      decomposition,
      input.sessionContext.sessionId,
      this.planVersion,
    );

    const agentIntents = this.generateAgentIntents(
      decomposition,
      taskGraph,
      input,
    );

    const output: PlannerOutput = {
      planVersion: this.planVersion,
      taskGraph,
      agentIntents,
      estimatedDurationMs: complexity.estimatedDurationMs,
      estimatedCostUsd: this.estimateCost(taskGraph, input),
      riskAssessment: this.assessRisk(complexity, decomposition, input),
      requiresApproval: complexity.level === 'complex' || agentIntents.length > 2,
      explanation: this.generateExplanation(complexity, decomposition, agentIntents),
    };

    this.currentTaskGraph = taskGraph;

    this.eventBus.emit({
      type: EVENT_TYPES.TASK_PLANNED,
      sessionId: input.sessionContext.sessionId,
      source: 'planner',
      payload: {
        taskGraph,
        planVersion: this.planVersion,
      },
    });

    return output;
  }

  async replan(
    input: PlannerInput,
    reason: string,
    parentVersion: number,
  ): Promise<PlannerOutput> {
    const previousGraph = this.currentTaskGraph;
    this.planVersion += 1;

    const complexity = this.analyzeComplexity(input.userRequest);
    const decomposition = await this.decomposeTaskWithLLM(input.userRequest, complexity, input);

    const taskGraph = this.buildTaskGraph(
      decomposition,
      input.sessionContext.sessionId,
      this.planVersion,
    );
    taskGraph.parentPlanVersion = parentVersion;
    taskGraph.replanReason = reason;

    if (previousGraph) {
      this.preserveCompletedTasks(taskGraph, previousGraph);
    }

    const agentIntents = this.generateAgentIntents(
      decomposition,
      taskGraph,
      input,
    );

    const output: PlannerOutput = {
      planVersion: this.planVersion,
      taskGraph,
      agentIntents,
      estimatedDurationMs: complexity.estimatedDurationMs,
      estimatedCostUsd: this.estimateCost(taskGraph, input),
      riskAssessment: this.assessRisk(complexity, decomposition, input),
      requiresApproval: true,
      explanation: `重规划原因: ${reason}\n${this.generateExplanation(complexity, decomposition, agentIntents)}`,
    };

    this.currentTaskGraph = taskGraph;

    this.eventBus.emit({
      type: EVENT_TYPES.TASK_PLANNED,
      sessionId: input.sessionContext.sessionId,
      source: 'planner',
      payload: {
        taskGraph,
        planVersion: this.planVersion,
        replanReason: reason,
      },
    });

    return output;
  }

  getCurrentTaskGraph(): TaskGraph | null {
    return this.currentTaskGraph;
  }

  getPlanVersion(): number {
    return this.planVersion;
  }

  analyzeComplexity(request: string): ComplexityAnalysis {
    const factors: string[] = [];
    let score = 0;

    score += this.analyzeLength(request, factors);
    score += this.analyzeKeywords(request, factors);
    score += this.analyzeCrossDomain(request, factors);
    score += this.analyzeParallelism(request, factors);
    score += this.analyzeDependencies(request, factors);
    score += this.analyzeTechnicalComplexity(request, factors);
    score += this.analyzeBusinessComplexity(request, factors);
    score += this.analyzeProjectScope(request, factors);

    const level = score <= 2 ? 'simple' : score <= 5 ? 'medium' : 'complex';
    const estimatedSubtasks = level === 'simple' ? 1 : level === 'medium' ? 3 : 6;
    const requiresMultipleAgents = level !== 'simple' || factors.length > 2;
    const estimatedDurationMs = level === 'simple' ? 5 * 60 * 1000 : level === 'medium' ? 15 * 60 * 1000 : 60 * 60 * 1000;

    return {
      level,
      factors,
      estimatedSubtasks,
      requiresMultipleAgents,
      estimatedDurationMs,
    };
  }

  private analyzeProjectScope(request: string, factors: string[]): number {
    let score = 0;

    if (/分析.*项目|项目.*分析|analyze.*project|project.*analyze/i.test(request)) {
      score += 3;
      factors.push('项目级分析任务');
    }

    if (/当前项目|整个项目|全部代码|全量分析/i.test(request)) {
      score += 2;
      factors.push('涉及项目全局');
    }

    if (/重构|优化|改进|升级|迁移/i.test(request)) {
      score += 2;
      factors.push('涉及代码重构');
    }

    if (/需求|功能|特性|feature/i.test(request)) {
      score += 1;
      factors.push('涉及需求分析');
    }

    if (/代码|源码|实现|逻辑/i.test(request)) {
      score += 1;
    }

    if (/架构|设计|方案/i.test(request)) {
      score += 2;
      factors.push('涉及架构设计');
    }

    return score;
  }

  private analyzeLength(request: string, factors: string[]): number {
    if (request.length > 500) {
      factors.push('请求描述很长');
      return 3;
    } else if (request.length > 200) {
      factors.push('请求描述较长');
      return 2;
    }
    return 0;
  }

  private analyzeKeywords(request: string, factors: string[]): number {
    let score = 0;

    if (request.includes('同时') || request.includes('并行') || request.includes('多个')) {
      score += 2;
      factors.push('包含并行任务');
    }

    if (request.includes('系统') || request.includes('架构') || request.includes('模块')) {
      score += 2;
      factors.push('涉及系统架构');
    }

    const commaCount = (request.match(/[,，、]/g) || []).length;
    if (commaCount > 8) {
      score += 2;
      factors.push('包含多个子任务');
    } else if (commaCount > 4) {
      score += 1;
      factors.push('包含多个子任务');
    }

    return score;
  }

  private analyzeCrossDomain(request: string, factors: string[]): number {
    let score = 0;
    const domains: string[] = [];

    if (/前端|UI|界面|页面|组件|Vue|React|Angular/i.test(request)) {
      domains.push('前端');
    }
    if (/后端|API|服务|接口|数据库|SQL/i.test(request)) {
      domains.push('后端');
    }
    if (/测试|单元测试|集成测试|E2E/i.test(request)) {
      domains.push('测试');
    }
    if (/部署|CI\/CD|Docker|Kubernetes|运维/i.test(request)) {
      domains.push('DevOps');
    }
    if (/安全|认证|授权|加密/i.test(request)) {
      domains.push('安全');
    }
    if (/性能|优化|缓存|负载均衡/i.test(request)) {
      domains.push('性能');
    }

    if (domains.length >= 3) {
      score += 3;
      factors.push(`跨领域任务: ${domains.join(', ')}`);
    } else if (domains.length === 2) {
      score += 1;
      factors.push(`涉及多个领域: ${domains.join(', ')}`);
    }

    return score;
  }

  private analyzeParallelism(request: string, factors: string[]): number {
    let score = 0;
    const parallelIndicators = ['同时', '并行', '一起', '同步', '多个任务', '多个功能', '分别', '并发'];

    if (parallelIndicators.some(indicator => request.includes(indicator))) {
      score += 2;
      factors.push('存在并行任务');
    }

    const taskConnectors = ['并', '然后', '以及', '同时', '接着', '随后'];
    let connectorCount = 0;
    for (const connector of taskConnectors) {
      const matches = request.match(new RegExp(connector, 'g'));
      if (matches) {
        connectorCount += matches.length;
      }
    }

    if (connectorCount >= 3) {
      score += 2;
      factors.push('任务依赖复杂');
    } else if (connectorCount >= 2) {
      score += 1;
      factors.push('存在任务依赖');
    }

    return score;
  }

  private analyzeDependencies(request: string, factors: string[]): number {
    let score = 0;

    if (request.includes('集成') || request.includes('对接') || request.includes('API')) {
      score += 1;
      factors.push('需要外部集成');
    }

    if (request.includes('依赖') || request.includes('基于') || request.includes('引用')) {
      score += 1;
      factors.push('存在外部依赖');
    }

    if (request.includes('第三方') || request.includes('外部服务') || request.includes('SDK')) {
      score += 1;
      factors.push('涉及第三方服务');
    }

    return score;
  }

  private analyzeTechnicalComplexity(request: string, factors: string[]): number {
    let score = 0;

    if (request.includes('分布式') || request.includes('微服务') || request.includes('集群')) {
      score += 2;
      factors.push('涉及分布式架构');
    }

    if (request.includes('CI/CD') || request.includes('流水线') || request.includes('部署') || request.includes('Kubernetes')) {
      score += 2;
      factors.push('涉及DevOps');
    }

    if (request.includes('前后端') || request.includes('全栈') || (request.includes('前端') && request.includes('后端'))) {
      score += 1;
      factors.push('涉及前后端开发');
    }

    if (request.includes('数据库') || request.includes('缓存') || request.includes('消息队列')) {
      score += 1;
      factors.push('涉及数据存储');
    }

    if (request.includes('实时') || request.includes('WebSocket') || request.includes('推送')) {
      score += 1;
      factors.push('涉及实时通信');
    }

    return score;
  }

  private analyzeBusinessComplexity(request: string, factors: string[]): number {
    let score = 0;

    if (request.includes('用户管理') || request.includes('权限') || request.includes('认证') || request.includes('授权')) {
      score += 1;
      factors.push('涉及用户权限');
    }

    if (request.includes('安全') || request.includes('性能') || request.includes('优化')) {
      score += 1;
      factors.push('有非功能性需求');
    }

    if (request.includes('支付') || request.includes('订单') || request.includes('交易')) {
      score += 2;
      factors.push('涉及核心业务流程');
    }

    if (request.includes('报表') || request.includes('统计') || request.includes('分析')) {
      score += 1;
      factors.push('涉及数据分析');
    }

    return score;
  }

  private decomposeTask(
    request: string,
    complexity: ComplexityAnalysis,
    input: PlannerInput,
  ): TaskDecomposition {
    const subtasks: TaskNode[] = [];
    const dependencies: Array<{ from: string; to: string }> = [];
    const suggestedRoles: AgentRole[] = [];

    const primaryType = this.detectTaskType(request);
    const hasParallel = this.hasParallelTasks(request);

    const phases = this.extractPhases(request, complexity);

    phases.forEach((phase, index) => {
      const task = this.createTaskNode(
        phase.title,
        phase.description,
        phase.type,
        index === 0 ? 'high' : 'medium',
      );
      subtasks.push(task);

      if (index > 0 && !hasParallel) {
        dependencies.push({
          from: subtasks[index - 1].taskId,
          to: task.taskId,
        });
      }

      suggestedRoles.push(this.suggestRoleForTaskType(phase.type));
    });

    const uniqueRoles = [...new Set(suggestedRoles)];
    const parallelizable = hasParallel || this.canParallelize(subtasks, dependencies);

    return {
      subtasks,
      dependencies,
      suggestedRoles: uniqueRoles,
      parallelizable,
    };
  }

  async decomposeTaskWithLLM(
    request: string,
    complexity: ComplexityAnalysis,
    input: PlannerInput,
  ): Promise<TaskDecomposition> {
    try {
      const llmResponse = await this.llmDecomposition.decomposeTask({
        userRequest: request,
        complexityLevel: complexity.level,
        context: {
          projectType: input.teamContext?.teamId,
        },
      });

      const subtasks = this.llmDecomposition.convertToTaskNodes(llmResponse);

      const dependencies: Array<{ from: string; to: string }> = [];
      subtasks.forEach(task => {
        task.dependencies.forEach(depId => {
          dependencies.push({ from: depId, to: task.taskId });
        });
      });

      const suggestedRoles = llmResponse.suggestedAgents.map(a => a.role);
      const uniqueRoles = [...new Set(suggestedRoles)];

      return {
        subtasks,
        dependencies,
        suggestedRoles: uniqueRoles,
        parallelizable: llmResponse.parallelizable,
      };
    } catch (error) {
      console.warn('LLM decomposition failed, using rule-based fallback:', error);
      return this.decomposeTask(request, complexity, input);
    }
  }

  private detectTaskType(request: string): TaskType {
    const lowerRequest = request.toLowerCase();

    for (const type of this.taskTypePriority) {
      const keywords = this.taskTypeKeywords[type];
      if (keywords.some(kw => lowerRequest.includes(kw.toLowerCase()))) {
        return type;
      }
    }

    return 'coding';
  }

  private extractPhases(
    request: string,
    complexity: ComplexityAnalysis,
  ): Array<{ title: string; description: string; type: TaskType }> {
    const phases: Array<{ title: string; description: string; type: TaskType }> = [];

    const isAnalysisTask = /^分析|项目分析|代码分析|架构分析|性能分析|^analyze|^analysis/i.test(request);
    const isProjectAnalysis = /分析.*项目|项目.*分析|当前项目|整个项目|全量分析/i.test(request);
    const hasImplementation = /实现|编码|开发|implement|code|develop|编写|创建|构建/i.test(request);
    const hasDesign = /设计|架构|方案|design|architecture/i.test(request);
    const hasTesting = /测试|验证|test|verify/i.test(request);
    const hasRefactor = /重构|优化|改进|refactor|optimize|improve/i.test(request);
    const hasFix = /修复|解决|fix|solve|bug|问题/i.test(request);

    if (isProjectAnalysis) {
      phases.push(
        { title: '项目结构分析', description: '分析项目目录结构和文件组织', type: 'analysis' },
        { title: '代码质量评估', description: '评估代码质量和编码规范', type: 'analysis' },
        { title: '依赖关系分析', description: '分析模块依赖和引用关系', type: 'analysis' },
        { title: '架构模式识别', description: '识别项目架构模式和设计模式', type: 'analysis' },
        { title: '生成分析报告', description: '汇总分析结果并生成报告', type: 'documentation' },
      );
      return phases;
    }

    if (isAnalysisTask && !hasImplementation) {
      phases.push(
        { title: '数据收集', description: '收集相关数据和信息', type: 'research' },
        { title: '深度分析', description: '执行核心分析任务', type: 'analysis' },
        { title: '结果整理', description: '整理分析结果和发现', type: 'documentation' },
      );
      return phases;
    }

    if (hasRefactor) {
      phases.push(
        { title: '现状评估', description: '评估当前代码状态和问题', type: 'analysis' },
        { title: '重构方案设计', description: '设计重构方案和步骤', type: 'planning' },
        { title: '重构实施', description: '执行代码重构', type: 'coding' },
        { title: '回归测试', description: '验证重构后功能正确性', type: 'testing' },
      );
      return phases;
    }

    if (hasFix) {
      phases.push(
        { title: '问题定位', description: '定位问题根源', type: 'debugging' },
        { title: '修复方案', description: '制定修复方案', type: 'planning' },
        { title: '修复实施', description: '执行修复操作', type: 'coding' },
        { title: '验证修复', description: '验证问题已解决', type: 'testing' },
      );
      return phases;
    }

    if (hasDesign) {
      phases.push(
        { title: '需求分析', description: '分析设计需求和约束', type: 'research' },
        { title: '方案设计', description: '设计实现方案', type: 'planning' },
      );
    }

    if (hasImplementation || complexity.level !== 'simple') {
      phases.push({
        title: '核心实现',
        description: '执行主要开发任务',
        type: 'coding',
      });
    }

    if (hasTesting || complexity.level === 'complex') {
      phases.push({
        title: '测试验证',
        description: '编写测试用例，验证实现正确性',
        type: 'testing',
      });
    }

    if (complexity.level === 'complex') {
      phases.push({
        title: '代码评审',
        description: '评审代码质量，优化实现细节',
        type: 'review',
      });
    }

    if (phases.length === 0) {
      phases.push({
        title: '执行任务',
        description: '完成请求的任务',
        type: 'coding',
      });
    }

    return phases;
  }

  private createTaskNode(
    title: string,
    description: string,
    type: TaskType,
    priority: TaskPriority,
  ): TaskNode {
    return {
      taskId: `task-${uuidv4()}`,
      title,
      description,
      type,
      status: 'pending' as TaskNodeStatus,
      priority,
      dependencies: [],
      dependents: [],
    };
  }

  private suggestRoleForTaskType(type: TaskType): AgentRole {
    const mapping: Record<TaskType, AgentRole> = {
      planning: 'planner',
      coding: 'executor',
      debugging: 'executor',
      review: 'reviewer',
      research: 'researcher',
      testing: 'validator',
      documentation: 'researcher',
      analysis: 'researcher',
      coordination: 'coordinator',
    };
    return mapping[type] || 'executor';
  }

  private buildTaskGraph(
    decomposition: TaskDecomposition,
    sessionId: string,
    planVersion: number,
  ): TaskGraph {
    const tasks: Record<string, TaskNode> = {};

    decomposition.subtasks.forEach(task => {
      tasks[task.taskId] = { ...task };
    });

    decomposition.dependencies.forEach(dep => {
      if (tasks[dep.from]) {
        tasks[dep.from].dependents.push(dep.to);
      }
      if (tasks[dep.to]) {
        tasks[dep.to].dependencies.push(dep.from);
      }
    });

    const rootTaskIds = decomposition.subtasks
      .filter(task => task.dependencies.length === 0)
      .map(task => task.taskId);

    return {
      graphId: `graph-${uuidv4()}`,
      sessionId,
      planVersion,
      rootTaskIds,
      tasks,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'active',
    };
  }

  private generateAgentIntents(
    decomposition: TaskDecomposition,
    taskGraph: TaskGraph,
    input: PlannerInput,
  ): AgentIntent[] {
    const intents: AgentIntent[] = [];
    const existingRoles = new Set(input.availableAgents.map(a => a.role));
    const neededRoles = decomposition.suggestedRoles.filter(
      role => !existingRoles.has(role),
    );

    const roleTaskMap = new Map<AgentRole, string[]>();
    Object.values(taskGraph.tasks).forEach(task => {
      const role = this.suggestRoleForTaskType(task.type);
      if (!roleTaskMap.has(role)) {
        roleTaskMap.set(role, []);
      }
      roleTaskMap.get(role)!.push(task.taskId);
    });

    neededRoles.forEach(role => {
      const taskIds = roleTaskMap.get(role) || [];
      const primaryTaskId = taskIds[0];

      if (primaryTaskId) {
        intents.push({
          intentId: `intent-${uuidv4()}`,
          reason: 'role-gap',
          taskId: primaryTaskId,
          suggestedRole: role,
          expectedInputs: this.getExpectedInputsForRole(role),
          expectedOutputs: this.getExpectedOutputsForRole(role),
          priority: 'medium',
          lifetimePolicy: 'task-bound',
          createdAt: Date.now(),
        });
      }
    });

    return intents;
  }

  private getExpectedInputsForRole(role: AgentRole): string[] {
    const inputs: Record<AgentRole, string[]> = {
      leader: ['任务目标', '团队状态', '资源约束'],
      planner: ['需求描述', '技术约束', '时间预算'],
      executor: ['任务描述', '代码上下文', '测试要求'],
      reviewer: ['代码变更', '评审标准', '历史问题'],
      researcher: ['研究主题', '信息源', '输出格式'],
      validator: ['测试目标', '验证标准', '测试数据'],
      coordinator: ['任务列表', '依赖关系', '资源状态'],
    };
    return inputs[role] || [];
  }

  private getExpectedOutputsForRole(role: AgentRole): string[] {
    const outputs: Record<AgentRole, string[]> = {
      leader: ['决策结果', '任务分配', '进度报告'],
      planner: ['任务计划', '时间估算', '风险评估'],
      executor: ['代码实现', '测试结果', '文档更新'],
      reviewer: ['评审意见', '改进建议', '质量评分'],
      researcher: ['研究报告', '数据收集', '结论摘要'],
      validator: ['测试报告', '问题列表', '验证结果'],
      coordinator: ['调度计划', '状态同步', '冲突解决'],
    };
    return outputs[role] || [];
  }

  private canParallelize(
    tasks: TaskNode[],
    dependencies: Array<{ from: string; to: string }>,
  ): boolean {
    if (tasks.length <= 1) return false;
    return dependencies.length < tasks.length - 1;
  }

  hasParallelTasks(request: string): boolean {
    const parallelIndicators = ['同时', '并行', '一起', '同步', '多个任务', '多个功能', '分别'];
    
    if (parallelIndicators.some(indicator => request.includes(indicator))) {
      return true;
    }

    const taskConnectors = ['并', '然后', '以及', '同时'];
    let connectorCount = 0;
    for (const connector of taskConnectors) {
      const matches = request.match(new RegExp(connector, 'g'));
      if (matches) {
        connectorCount += matches.length;
      }
    }

    return connectorCount >= 2;
  }

  private preserveCompletedTasks(
    newGraph: TaskGraph,
    previousGraph: TaskGraph,
  ): void {
    Object.values(previousGraph.tasks).forEach(task => {
      if (task.status === 'completed' && newGraph.tasks[task.taskId]) {
        newGraph.tasks[task.taskId] = { ...task };
      }
    });
  }

  private estimateCost(
    taskGraph: TaskGraph,
    input: PlannerInput,
  ): number {
    const taskCount = Object.keys(taskGraph.tasks).length;
    const avgCostPerTask = 0.05;
    return taskCount * avgCostPerTask;
  }

  private assessRisk(
    complexity: ComplexityAnalysis,
    decomposition: TaskDecomposition,
    input: PlannerInput,
  ): PlannerOutput['riskAssessment'] {
    const factors: string[] = [];
    const mitigations: string[] = [];

    if (complexity.level === 'complex') {
      factors.push('任务复杂度高');
      mitigations.push('建议分阶段执行，设置检查点');
    }

    if (decomposition.subtasks.length > 4) {
      factors.push('子任务数量多');
      mitigations.push('建议增加协调智能体');
    }

    if (input.availableAgents.length < decomposition.suggestedRoles.length) {
      factors.push('可用智能体不足');
      mitigations.push('需要动态创建智能体');
    }

    const level = factors.length === 0 ? 'low' : factors.length <= 2 ? 'medium' : 'high';

    return { level, factors, mitigations };
  }

  private generateExplanation(
    complexity: ComplexityAnalysis,
    decomposition: TaskDecomposition,
    agentIntents: AgentIntent[],
  ): string {
    const lines: string[] = [];

    lines.push(`任务复杂度: ${complexity.level}`);
    lines.push(`子任务数量: ${decomposition.subtasks.length}`);
    lines.push(`是否可并行: ${decomposition.parallelizable ? '是' : '否'}`);

    if (agentIntents.length > 0) {
      lines.push(`需要创建 ${agentIntents.length} 个新智能体:`);
      agentIntents.forEach(intent => {
        lines.push(`  - ${intent.suggestedRole} (原因: ${intent.reason})`);
      });
    }

    if (complexity.factors.length > 0) {
      lines.push('复杂度因素:');
      complexity.factors.forEach(f => lines.push(`  - ${f}`));
    }

    return lines.join('\n');
  }
}
