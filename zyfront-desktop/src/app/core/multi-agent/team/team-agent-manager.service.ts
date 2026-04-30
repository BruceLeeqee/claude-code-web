import { Injectable, inject, signal, computed } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { AgentDescriptor, AgentRuntimeState, AgentLifecycleStatus } from '../domain/types';
import type { RoleDefinition, TeamMemberState } from './team.types';
import { AgentFactoryService } from '../services/agent-factory.service';
import { AgentLifecycleManager } from '../services/agent-lifecycle-manager.service';
import { TeamLLMExecutionService, LLMExecutionResult } from './team-llm-execution.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface TeamAgent {
  descriptor: AgentDescriptor;
  runtimeState: AgentRuntimeState;
  roleDefinition: RoleDefinition;
  teamId: string;
  conversationHistory: ConversationMessage[];
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskResult {
  agentId: string;
  roleName: string;
  success: boolean;
  content: string;
  reasoningContent?: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  error?: string;
}

export interface AgentExecutionContext {
  teamId: string;
  stageName: string;
  task: string;
  inputs?: string[];
  conversationHistory?: ConversationMessage[];
}

@Injectable({ providedIn: 'root' })
export class TeamAgentManager {
  private readonly agentFactory = inject(AgentFactoryService);
  private readonly lifecycleManager = inject(AgentLifecycleManager);
  private readonly llmExecutor = inject(TeamLLMExecutionService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly agents = signal<Map<string, TeamAgent>>(new Map());
  private readonly teamAgents = signal<Map<string, Set<string>>>(new Map());

  readonly allAgents = computed(() => [...this.agents().values()]);
  readonly activeAgents = computed(() =>
    [...this.agents().values()].filter(a => a.runtimeState.status === 'running')
  );

  async createAgent(
    role: RoleDefinition,
    teamId: string,
    options: { sessionId?: string; taskContext?: string } = {}
  ): Promise<TeamAgent> {
    console.log('[TeamAgentManager] Creating agent for role:', { roleName: role.name, slug: role.slug, teamId });
    const agentId = `agent-${role.slug}-${uuidv4().substring(0, 8)}`;
    const now = Date.now();

    const descriptor: AgentDescriptor = {
      agentId,
      agentName: role.name,
      role: this.mapRoleType(role.type),
      teamId,
      sessionId: options.sessionId || teamId,
      modelId: role.model || 'default',
      backendType: 'in-process',
      promptTemplate: role.prompt,
      permissions: this.buildPermissions(role),
      createdAt: now,
      createdBy: 'user',
      lifetimePolicy: 'task-bound',
      metadata: {
        roleSlug: role.slug,
        roleType: role.type,
        capabilities: role.capabilities,
        constraints: role.constraints,
        taskContext: options.taskContext,
      },
    };

    const runtimeState: AgentRuntimeState = {
      agentId,
      status: 'initializing',
      lastSeenAt: now,
      heartbeatInterval: 30000,
      activeTaskIds: [],
      recoveryAttempts: 0,
      totalMessagesProcessed: 0,
      totalTokensUsed: 0,
      startedAt: now,
      lastStateChangeAt: now,
    };

    const teamAgent: TeamAgent = {
      descriptor,
      runtimeState,
      roleDefinition: role,
      teamId,
      conversationHistory: [],
    };

    this.agents.update(map => {
      const newMap = new Map(map);
      newMap.set(agentId, teamAgent);
      return newMap;
    });

    this.teamAgents.update(map => {
      const newMap = new Map(map);
      const teamAgentIds = newMap.get(teamId) || new Set();
      teamAgentIds.add(agentId);
      newMap.set(teamId, teamAgentIds);
      return newMap;
    });

    this.updateAgentStatus(agentId, 'running', 'Agent created and ready');

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_MEMBER_JOINED,
      sessionId: teamId,
      source: 'system',
      payload: {
        teamId,
        agentId,
        roleName: role.name,
      },
    });

    return teamAgent;
  }

  async createAgentsForRoles(
    roles: RoleDefinition[],
    teamId: string,
    taskContext?: string
  ): Promise<TeamAgent[]> {
    const createdAgents: TeamAgent[] = [];

    for (const role of roles) {
      const agent = await this.createAgent(role, teamId, { taskContext });
      createdAgents.push(agent);
    }

    return createdAgents;
  }

  async executeTask(
    agent: TeamAgent,
    context: AgentExecutionContext
  ): Promise<AgentTaskResult> {
    const startTime = Date.now();
    const { teamId, stageName, task, inputs } = context;
    
    console.log('[TeamAgentManager] executeTask called:', { 
      agentId: agent.descriptor.agentId, 
      roleName: agent.roleDefinition.name, 
      stageName, 
      taskLength: task.length 
    });

    this.updateAgentStatus(agent.descriptor.agentId, 'running', `Executing task: ${stageName}`);

    const systemPrompt = this.buildSystemPrompt(agent.roleDefinition, task, stageName);
    console.log('[TeamAgentManager] System prompt built, calling LLM...');

    const userMessage: ConversationMessage = {
      id: `msg-${uuidv4()}`,
      role: 'user',
      content: this.buildUserMessage(task, inputs, context.conversationHistory),
      timestamp: Date.now(),
    };

    const llmResult = await this.llmExecutor.executeForRole(
      agent.roleDefinition,
      userMessage.content,
      teamId,
      {
        systemPrompt,
        stream: true,
        onDelta: (text) => {
          this.eventBus.emit({
            type: EVENT_TYPES.AGENT_OUTPUT,
            sessionId: teamId,
            source: 'teammate',
            payload: {
              agentId: agent.descriptor.agentId,
              output: text,
            },
          });
        },
        onThinkingDelta: (text) => {
          this.eventBus.emit({
            type: EVENT_TYPES.AGENT_THINKING,
            sessionId: teamId,
            source: 'teammate',
            payload: {
              agentId: agent.descriptor.agentId,
              thinking: text,
            },
          });
        },
      }
    );

    const assistantMessage: ConversationMessage = {
      id: `msg-${uuidv4()}`,
      role: 'assistant',
      content: llmResult.content,
      timestamp: Date.now(),
      metadata: {
        reasoningContent: llmResult.reasoningContent,
        usage: llmResult.usage,
      },
    };

    this.agents.update(map => {
      const newMap = new Map(map);
      const existingAgent = newMap.get(agent.descriptor.agentId);
      if (existingAgent) {
        existingAgent.conversationHistory.push(userMessage, assistantMessage);
        if (llmResult.usage) {
          existingAgent.runtimeState.totalTokensUsed +=
            llmResult.usage.inputTokens + llmResult.usage.outputTokens;
        }
        existingAgent.runtimeState.totalMessagesProcessed += 2;
        existingAgent.runtimeState.lastSeenAt = Date.now();
      }
      return newMap;
    });

    const result: AgentTaskResult = {
      agentId: agent.descriptor.agentId,
      roleName: agent.roleDefinition.name,
      success: llmResult.success,
      content: llmResult.content,
      reasoningContent: llmResult.reasoningContent,
      usage: llmResult.usage,
      durationMs: Date.now() - startTime,
      error: llmResult.error,
    };

    if (llmResult.success) {
      this.updateAgentStatus(agent.descriptor.agentId, 'idle', 'Task completed');
    } else {
      this.updateAgentStatus(agent.descriptor.agentId, 'failed', llmResult.error || 'Task failed');
    }

    return result;
  }

  async executeParallel(
    agents: TeamAgent[],
    context: AgentExecutionContext
  ): Promise<AgentTaskResult[]> {
    const promises = agents.map(agent => this.executeTask(agent, context));
    return Promise.all(promises);
  }

  async executeSequential(
    agents: TeamAgent[],
    context: AgentExecutionContext,
    options: { passResults?: boolean } = {}
  ): Promise<AgentTaskResult[]> {
    const results: AgentTaskResult[] = [];
    let accumulatedInputs: string[] = context.inputs || [];

    for (const agent of agents) {
      const agentContext: AgentExecutionContext = {
        ...context,
        inputs: options.passResults ? accumulatedInputs : context.inputs,
        conversationHistory: this.getAgent(agent.descriptor.agentId)?.conversationHistory || [],
      };

      const result = await this.executeTask(agent, agentContext);
      results.push(result);

      if (options.passResults && result.success) {
        accumulatedInputs = [...accumulatedInputs, result.content];
      }

      if (!result.success) {
        break;
      }
    }

    return results;
  }

  getAgent(agentId: string): TeamAgent | undefined {
    return this.agents().get(agentId);
  }

  getAgentsByTeam(teamId: string): TeamAgent[] {
    const agentIds = this.teamAgents().get(teamId);
    if (!agentIds) return [];

    const agents = this.agents();
    return [...agentIds].map(id => agents.get(id)).filter((a): a is TeamAgent => !!a);
  }

  getAgentByRole(teamId: string, roleName: string): TeamAgent | undefined {
    const teamAgents = this.getAgentsByTeam(teamId);
    return teamAgents.find(a =>
      a.roleDefinition.name === roleName ||
      a.roleDefinition.slug === roleName
    );
  }

  async terminateAgent(agentId: string, reason: string = 'Task completed'): Promise<void> {
    const agent = this.agents().get(agentId);
    if (!agent) return;

    this.updateAgentStatus(agentId, 'stopping', reason);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_MEMBER_LEFT,
      sessionId: agent.teamId,
      source: 'system',
      payload: {
        teamId: agent.teamId,
        agentId,
        roleName: agent.roleDefinition.name,
        reason,
      },
    });

    this.agents.update(map => {
      const newMap = new Map(map);
      newMap.delete(agentId);
      return newMap;
    });

    this.teamAgents.update(map => {
      const newMap = new Map(map);
      const teamAgentIds = newMap.get(agent.teamId);
      if (teamAgentIds) {
        teamAgentIds.delete(agentId);
        if (teamAgentIds.size === 0) {
          newMap.delete(agent.teamId);
        }
      }
      return newMap;
    });
  }

  async terminateTeam(teamId: string): Promise<void> {
    const agents = this.getAgentsByTeam(teamId);
    for (const agent of agents) {
      await this.terminateAgent(agent.descriptor.agentId, 'Team terminated');
    }
  }

  addConversationMessage(agentId: string, message: ConversationMessage): void {
    this.agents.update(map => {
      const newMap = new Map(map);
      const agent = newMap.get(agentId);
      if (agent) {
        agent.conversationHistory.push(message);
      }
      return newMap;
    });
  }

  private updateAgentStatus(agentId: string, status: AgentLifecycleStatus, reason?: string): void {
    this.agents.update(map => {
      const newMap = new Map(map);
      const agent = newMap.get(agentId);
      if (agent) {
        agent.runtimeState.status = status;
        agent.runtimeState.lastSeenAt = Date.now();
        agent.runtimeState.lastStateChangeAt = Date.now();
        if (status === 'failed' && reason) {
          agent.runtimeState.errorMessage = reason;
        }
      }
      return newMap;
    });

    this.eventBus.emit({
      type: EVENT_TYPES.AGENT_STARTED,
      sessionId: agentId,
      source: 'system',
      payload: {
        agentId,
        previousStatus: 'initializing' as AgentLifecycleStatus,
        newStatus: status,
        reason,
      },
    });
  }

  private mapRoleType(roleType: string): import('../domain/types').AgentRole {
    const mapping: Record<string, import('../domain/types').AgentRole> = {
      'subagent': 'executor',
      'agent-team': 'executor',
    };
    return mapping[roleType] || 'executor';
  }

  private buildPermissions(role: RoleDefinition): string[] {
    const permissions: string[] = ['fs.read'];

    if (role.allowedWritePaths && role.allowedWritePaths.length > 0) {
      permissions.push('fs.write');
    }

    if (role.tools && role.tools.length > 0) {
      role.tools.forEach(tool => {
        if (tool.includes('terminal') || tool.includes('exec')) {
          permissions.push('terminal.exec');
        }
        if (tool.includes('edit')) {
          permissions.push('fs.edit');
        }
      });
    }

    return [...new Set(permissions)];
  }

  private buildSystemPrompt(role: RoleDefinition, task: string, stageName: string): string {
    const parts: string[] = [];

    parts.push(`# 角色定义`);
    parts.push(`你是 ${role.name}，当前正在参与团队协作。`);
    parts.push('');
    parts.push(`## 当前阶段`);
    parts.push(`正在执行阶段：${stageName}`);
    parts.push('');
    parts.push(`## 职责`);
    parts.push(role.description);
    parts.push('');

    if (role.capabilities && role.capabilities.length > 0) {
      parts.push(`## 能力范围`);
      role.capabilities.forEach(cap => parts.push(`- ${cap}`));
      parts.push('');
    }

    if (role.constraints && role.constraints.length > 0) {
      parts.push(`## 约束条件`);
      role.constraints.forEach(con => parts.push(`- ${con}`));
      parts.push('');
    }

    if (role.tools && role.tools.length > 0) {
      parts.push(`## 可用工具`);
      parts.push(role.tools.join(', '));
      parts.push('');
    }

    parts.push(`## 工作流程`);
    parts.push(`1. 理解任务需求`);
    parts.push(`2. 制定执行计划`);
    parts.push(`3. 执行具体操作`);
    parts.push(`4. 验证结果`);
    parts.push(`5. 输出执行摘要`);
    parts.push('');

    parts.push(`## 输出格式`);
    parts.push(`请以清晰的格式输出你的工作成果，包括：`);
    parts.push(`- 任务理解`);
    parts.push(`- 执行步骤`);
    parts.push(`- 关键发现/变更`);
    parts.push(`- 结论与建议`);

    return parts.join('\n');
  }

  private buildUserMessage(
    task: string,
    inputs?: string[],
    history?: ConversationMessage[]
  ): string {
    const parts: string[] = [];

    parts.push(`## 任务`);
    parts.push(task);
    parts.push('');

    if (inputs && inputs.length > 0) {
      parts.push(`## 输入信息`);
      inputs.forEach((input, i) => {
        parts.push(`### 输入 ${i + 1}`);
        parts.push(input);
        parts.push('');
      });
    }

    if (history && history.length > 0) {
      const recentHistory = history.slice(-6);
      if (recentHistory.length > 0) {
        parts.push(`## 对话历史`);
        recentHistory.forEach(msg => {
          parts.push(`**${msg.role === 'user' ? '用户' : '助手'}**: ${msg.content.slice(0, 500)}...`);
          parts.push('');
        });
      }
    }

    return parts.join('\n');
  }
}
