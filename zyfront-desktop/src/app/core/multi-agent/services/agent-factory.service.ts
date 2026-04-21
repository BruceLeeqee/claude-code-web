import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentDescriptor,
  AgentIntent,
  AgentRole,
  AgentTemplate,
  AgentRuntimeState,
  SessionContext,
  TaskNode,
} from '../domain/types';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { MultiAgentOrchestratorService } from '../multi-agent.orchestrator.service';
import { MultiAgentSessionService } from '../multi-agent.session';
import { EVENT_TYPES } from '../multi-agent.events';

export interface AgentCreateInput {
  intent?: AgentIntent;
  task?: TaskNode;
  sessionContext: SessionContext;
  modelId?: string;
  backendType?: 'in-process' | 'tmux' | 'iterm2';
  customPrompt?: string;
  createdBy: 'user' | 'planner' | 'auto-scale' | 'recovery';
}

export interface AgentCreateResult {
  descriptor: AgentDescriptor;
  runtimeState: AgentRuntimeState;
  spawnResult?: {
    identity: {
      agentId: string;
      agentName: string;
      teamName: string;
      color: string;
      model?: string;
      cwd?: string;
    };
    backend: 'in-process' | 'tmux' | 'iterm2';
    status: string;
    paneId?: string;
    windowId?: string;
  };
}

export interface DryRunResult {
  wouldCreate: boolean;
  descriptor: Partial<AgentDescriptor>;
  warnings: string[];
  estimatedCostUsd: number;
}

@Injectable({ providedIn: 'root' })
export class AgentFactoryService {
  private readonly templates: Map<string, AgentTemplate> = new Map();
  private readonly agents: Map<string, AgentDescriptor> = new Map();
  private readonly runtimeStates: Map<string, AgentRuntimeState> = new Map();

  constructor(
    private readonly eventBus: MultiAgentEventBusService,
    private readonly orchestrator: MultiAgentOrchestratorService,
    private readonly sessionService: MultiAgentSessionService,
  ) {
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    const defaultTemplates: AgentTemplate[] = [
      {
        templateId: 'tpl-leader',
        roleName: 'leader',
        displayName: '团队领导者',
        description: '负责整体协调、决策和任务分配',
        defaultPromptTemplate: `你是一个团队的领导者。你的职责是：
1. 理解和分析用户需求
2. 制定任务计划并分配给团队成员
3. 协调团队成员之间的协作
4. 汇总和整合团队成果
5. 做出关键决策

请始终保持全局视角，确保团队高效协作。`,
        defaultPermissions: ['fs.read', 'fs.write', 'terminal.exec'],
        recommendedModelFamily: ['claude-3-5-sonnet', 'claude-3-opus'],
        recommendedBackend: ['in-process'],
        allowAutoRecycle: false,
        skills: ['planning', 'coordination', 'decision-making'],
      },
      {
        templateId: 'tpl-planner',
        roleName: 'planner',
        displayName: '任务规划师',
        description: '负责详细任务规划和进度跟踪',
        defaultPromptTemplate: `你是一个任务规划专家。你的职责是：
1. 将复杂目标拆解为可执行的子任务
2. 识别任务依赖关系
3. 估算任务时间和资源需求
4. 制定执行计划和时间表
5. 跟踪进度并调整计划

请确保计划清晰、可执行、有明确的验收标准。`,
        defaultPermissions: ['fs.read'],
        recommendedModelFamily: ['claude-3-5-sonnet', 'MiniMax-M2.7'],
        recommendedBackend: ['in-process'],
        allowAutoRecycle: true,
        skills: ['planning', 'estimation', 'tracking'],
      },
      {
        templateId: 'tpl-executor',
        roleName: 'executor',
        displayName: '执行者',
        description: '负责具体任务的实施和代码编写',
        defaultPromptTemplate: `你是一个高效的执行者。你的职责是：
1. 执行分配的具体任务
2. 编写高质量代码
3. 遵循最佳实践和编码规范
4. 编写必要的测试
5. 记录实现细节

请专注于交付高质量的工作成果。`,
        defaultPermissions: ['fs.read', 'fs.write', 'terminal.exec', 'fs.edit'],
        recommendedModelFamily: ['claude-3-5-sonnet', 'claude-3-7-sonnet'],
        recommendedBackend: ['in-process', 'tmux'],
        allowAutoRecycle: true,
        skills: ['coding', 'testing', 'debugging'],
      },
      {
        templateId: 'tpl-reviewer',
        roleName: 'reviewer',
        displayName: '代码评审员',
        description: '负责代码质量审查和改进建议',
        defaultPromptTemplate: `你是一个严格的代码评审员。你的职责是：
1. 审查代码质量和风格
2. 发现潜在问题和风险
3. 提出改进建议
4. 确保符合最佳实践
5. 验证测试覆盖

请保持客观、专业，提供具体可操作的反馈。`,
        defaultPermissions: ['fs.read'],
        recommendedModelFamily: ['claude-3-5-sonnet', 'claude-3-opus'],
        recommendedBackend: ['in-process'],
        allowAutoRecycle: true,
        skills: ['review', 'quality-assurance', 'best-practices'],
      },
      {
        templateId: 'tpl-researcher',
        roleName: 'researcher',
        displayName: '研究员',
        description: '负责信息收集、调研和分析',
        defaultPromptTemplate: `你是一个专业的研究员。你的职责是：
1. 收集和整理相关信息
2. 分析技术方案和可行性
3. 生成研究报告
4. 提供数据支持决策
5. 维护知识库

请确保研究全面、结论可靠。`,
        defaultPermissions: ['fs.read', 'fs.write', 'web.search', 'web.fetch'],
        recommendedModelFamily: ['claude-3-5-sonnet', 'MiniMax-M2.7'],
        recommendedBackend: ['in-process'],
        allowAutoRecycle: true,
        skills: ['research', 'analysis', 'documentation'],
      },
      {
        templateId: 'tpl-validator',
        roleName: 'validator',
        displayName: '验证者',
        description: '负责测试验证和质量保证',
        defaultPromptTemplate: `你是一个专业的验证者。你的职责是：
1. 设计测试用例
2. 执行测试验证
3. 报告测试结果
4. 追踪问题修复
5. 确保质量标准

请确保测试全面、结果准确。`,
        defaultPermissions: ['fs.read', 'terminal.exec'],
        recommendedModelFamily: ['claude-3-5-sonnet', 'abab6.5s-chat'],
        recommendedBackend: ['in-process'],
        allowAutoRecycle: true,
        skills: ['testing', 'validation', 'quality-assurance'],
      },
    ];

    defaultTemplates.forEach(template => {
      this.templates.set(template.templateId, template);
      this.templates.set(template.roleName, template);
    });
  }

  async create(input: AgentCreateInput): Promise<AgentCreateResult> {
    const role = input.intent?.suggestedRole || 'executor';
    const template = this.selectTemplate(role);

    const descriptor = this.buildDescriptor(input, template);
    const runtimeState = this.initializeRuntimeState(descriptor);

    this.agents.set(descriptor.agentId, descriptor);
    this.runtimeStates.set(descriptor.agentId, runtimeState);

    this.eventBus.emit({
      type: EVENT_TYPES.AGENT_CREATED,
      sessionId: input.sessionContext.sessionId,
      source: input.createdBy,
      payload: {
        descriptor,
        runtimeState,
        intentId: input.intent?.intentId,
      },
    });

    let spawnResult: AgentCreateResult['spawnResult'];

    try {
      const spawnConfig = {
        name: descriptor.agentName,
        prompt: input.customPrompt || template.defaultPromptTemplate,
        teamName: input.sessionContext.teamName,
        mode: 'auto' as const,
        cwd: descriptor.cwd,
        model: descriptor.modelId,
        agentType: descriptor.role,
      };

      const result = await this.orchestrator.spawnTeammate(spawnConfig);

      spawnResult = {
        identity: result.identity,
        backend: result.backend,
        status: result.status,
        paneId: result.paneId,
        windowId: result.windowId,
      };

      runtimeState.status = result.status === 'running' ? 'running' : 'initializing';
      runtimeState.paneId = result.paneId;
      runtimeState.windowId = result.windowId;
      runtimeState.lastStateChangeAt = Date.now();
    } catch (error) {
      runtimeState.status = 'failed';
      runtimeState.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      runtimeState.lastStateChangeAt = Date.now();

      this.eventBus.emit({
        type: EVENT_TYPES.AGENT_FAILED,
        sessionId: input.sessionContext.sessionId,
        source: 'backend',
        payload: {
          agentId: descriptor.agentId,
          stage: 'spawn',
          errorMessage: runtimeState.errorMessage,
          retriable: true,
        },
      });
    }

    return {
      descriptor,
      runtimeState,
      spawnResult,
    };
  }

  async dryRun(input: AgentCreateInput): Promise<DryRunResult> {
    const warnings: string[] = [];
    const role = input.intent?.suggestedRole || 'executor';
    const template = this.selectTemplate(role);

    const partialDescriptor: Partial<AgentDescriptor> = {
      role,
      agentName: this.generateAgentName(role),
      modelId: input.modelId || template.recommendedModelFamily[0],
      backendType: input.backendType || template.recommendedBackend[0],
      permissions: template.defaultPermissions,
      lifetimePolicy: input.intent?.lifetimePolicy || 'task-bound',
    };

    const estimatedCostUsd = this.estimateCost(partialDescriptor);

    if (!template.allowAutoRecycle && input.intent?.lifetimePolicy === 'idle-timeout') {
      warnings.push(`${role} 角色不建议使用 idle-timeout 生命周期策略`);
    }

    if (input.modelId && !template.recommendedModelFamily.includes(input.modelId)) {
      warnings.push(`${input.modelId} 不在 ${role} 角色的推荐模型列表中`);
    }

    return {
      wouldCreate: true,
      descriptor: partialDescriptor,
      warnings,
      estimatedCostUsd,
    };
  }

  getTemplate(roleOrId: string): AgentTemplate | undefined {
    return this.templates.get(roleOrId);
  }

  getAllTemplates(): AgentTemplate[] {
    const uniqueTemplates = new Map<string, AgentTemplate>();
    this.templates.forEach((template, key) => {
      if (key.startsWith('tpl-')) {
        uniqueTemplates.set(key, template);
      }
    });
    return Array.from(uniqueTemplates.values());
  }

  getAgent(agentId: string): AgentDescriptor | undefined {
    return this.agents.get(agentId);
  }

  getAgentRuntimeState(agentId: string): AgentRuntimeState | undefined {
    return this.runtimeStates.get(agentId);
  }

  getAllAgents(): AgentDescriptor[] {
    return Array.from(this.agents.values());
  }

  private selectTemplate(role: AgentRole): AgentTemplate {
    const template = this.templates.get(role);
    if (template) return template;

    return this.templates.get('executor')!;
  }

  private buildDescriptor(
    input: AgentCreateInput,
    template: AgentTemplate,
  ): AgentDescriptor {
    const agentId = `agent-${uuidv4()}`;

    return {
      agentId,
      agentName: this.generateAgentName(template.roleName),
      role: template.roleName,
      teamId: input.sessionContext.teamId,
      sessionId: input.sessionContext.sessionId,
      modelId: input.modelId || template.recommendedModelFamily[0] || 'MiniMax-M2.7',
      backendType: input.backendType || template.recommendedBackend[0] || 'in-process',
      cwd: input.sessionContext.backendPolicy === 'tmux' ? '.' : undefined,
      promptTemplate: input.customPrompt || template.defaultPromptTemplate,
      permissions: [...template.defaultPermissions],
      createdAt: Date.now(),
      createdBy: input.createdBy,
      lifetimePolicy: input.intent?.lifetimePolicy || 'task-bound',
      maxIdleMs: input.intent?.lifetimePolicy === 'idle-timeout' ? 5 * 60 * 1000 : undefined,
      metadata: {
        templateId: template.templateId,
        intentId: input.intent?.intentId,
        taskId: input.task?.taskId,
      },
    };
  }

  private initializeRuntimeState(descriptor: AgentDescriptor): AgentRuntimeState {
    return {
      agentId: descriptor.agentId,
      status: 'initializing',
      lastSeenAt: Date.now(),
      heartbeatInterval: 30000,
      activeTaskIds: [],
      recoveryAttempts: 0,
      totalMessagesProcessed: 0,
      totalTokensUsed: 0,
      startedAt: Date.now(),
      lastStateChangeAt: Date.now(),
    };
  }

  private generateAgentName(role: AgentRole): string {
    const timestamp = Date.now().toString(36).slice(-4);
    const random = Math.random().toString(36).slice(2, 5);
    return `${role}-${timestamp}-${random}`;
  }

  private estimateCost(descriptor: Partial<AgentDescriptor>): number {
    const avgCostPerSession = 0.1;
    return avgCostPerSession;
  }
}
