import { Injectable, inject, signal, computed } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { TeamRunMode, TeamStageDefinition, TeamRuntimeState, TeamLogEntry, CommandResult, RoleDefinition } from './team.types';
import { StructRegistryService } from './struct-registry.service';
import { RoleRegistryService } from './role-registry.service';
import { TeamRuntimeService } from './team-runtime.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { TeamMailboxService } from './team-mailbox.service';
import { TeamAgentManager, TeamAgent, AgentTaskResult } from './team-agent-manager.service';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface OrchestrationProgress {
  teamId: string;
  structName: string;
  totalStages: number;
  currentStageIndex: number;
  currentStageName: string;
  currentStageMode: TeamRunMode;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  stageResults: StageResult[];
  agents: AgentInfo[];
}

export interface AgentInfo {
  agentId: string;
  roleName: string;
  status: string;
}

export interface StageResult {
  stageName: string;
  mode: TeamRunMode;
  success: boolean;
  summary: string;
  durationMs: number;
  agentResults?: AgentTaskResult[];
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class TeamOrchestrationService {
  private readonly runtime = inject(TeamRuntimeService);
  private readonly structRegistry = inject(StructRegistryService);
  private readonly roleRegistry = inject(RoleRegistryService);
  private readonly taskBoard = inject(TeamTaskBoardService);
  private readonly mailbox = inject(TeamMailboxService);
  private readonly agentManager = inject(TeamAgentManager);
  private readonly persistence = inject(TeamFilePersistenceService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly progress = signal<Map<string, OrchestrationProgress>>(new Map());

  readonly activeProgress = computed(() => {
    const map = this.progress();
    return map.size > 0 ? [...map.values()].find(p => p.status === 'running') : null;
  });

  async executeStruct(structName: string, task: string): Promise<CommandResult<TeamRuntimeState>> {
    console.log('[TeamOrchestration] executeStruct called:', { structName, task });
    
    const structRefreshResult = await this.structRegistry.refreshFromFiles();
    const roleRefreshResult = await this.roleRegistry.refreshFromFiles();
    
    console.log('[TeamOrchestration] File refresh results:', { 
      structCount: structRefreshResult, 
      roleCount: roleRefreshResult 
    });
    
    const allStructs = this.structRegistry.list();
    console.log('[TeamOrchestration] Available structs:', allStructs.map(s => ({ name: s.name, slug: s.slug })));
    
    const allRoles = this.roleRegistry.list();
    console.log('[TeamOrchestration] Available roles:', allRoles.map(r => ({ name: r.name, slug: r.slug })));
    
    const struct = this.structRegistry.getByName(structName) || this.structRegistry.get(structName);
    console.log('[TeamOrchestration] Struct lookup result:', struct ? { name: struct.name, stages: struct.stages?.length, roles: struct.roles } : null);
    
    if (!struct) {
      return {
        ok: false,
        command: '/team run struct',
        message: `协作结构 "${structName}" 不存在（可用结构：${allStructs.map(s => s.slug).join(', ') || '无'}）`,
        errors: [`协作结构 "${structName}" 不存在`],
      };
    }

    if (!Array.isArray(struct.stages) || struct.stages.length === 0) {
      return {
        ok: false,
        command: '/team run struct',
        message: `协作结构 "${structName}" 没有定义任何阶段`,
        errors: [`协作结构必须至少包含一个阶段`],
      };
    }

    const roleValidation = this.structRegistry.validateRoles(struct.roles);
    console.log('[TeamOrchestration] Role validation result:', roleValidation);
    
    if (!roleValidation.valid) {
      const registeredSlugs = this.roleRegistry.roleList().map(r => r.slug);
      return {
        ok: false,
        command: '/team run struct',
        message: `以下角色未定义：${roleValidation.missing.join(', ')}（已注册角色：${registeredSlugs.join(', ') || '无'}）`,
        errors: [`未定义角色：${roleValidation.missing.join(', ')}`],
      };
    }

    try {
      console.log('[TeamOrchestration] Creating team...');
      const team = this.runtime.createTeam(structName, task);
      console.log('[TeamOrchestration] Team created:', { teamId: team.id, structName });

      await Promise.all([
        this.taskBoard.loadTeamTasks(team.id),
        this.mailbox.loadTeamMessages(team.id),
      ]);

      console.log('[TeamOrchestration] Resolving stage roles:', struct.roles);
      const allRoles = await this.resolveStageRoles(struct.roles);
      console.log('[TeamOrchestration] Resolved roles:', allRoles.map(r => ({ name: r.name, slug: r.slug })));
      
      console.log('[TeamOrchestration] Creating agents for roles...');
      const agents = await this.agentManager.createAgentsForRoles(allRoles, team.id, task);
      console.log('[TeamOrchestration] Agents created:', agents.length, agents.map(a => a.roleDefinition.name));

      this.addRuntimeLog(team.id, 'info', 'orchestration', 
        `创建了 ${agents.length} 个 Agent：${agents.map(a => a.roleDefinition.name).join(', ')}`);

      const agentInfos: AgentInfo[] = agents.map(a => ({
        agentId: a.descriptor.agentId,
        roleName: a.roleDefinition.name,
        status: 'running',
      }));

      const orchestrationProgress: OrchestrationProgress = {
        teamId: team.id,
        structName: struct.name,
        totalStages: struct.stages.length,
        currentStageIndex: 0,
        currentStageName: struct.stages[0]?.name || '',
        currentStageMode: struct.stages[0]?.mode || 'subagent',
        status: 'running',
        stageResults: [],
        agents: agentInfos,
      };

      console.log('[TeamOrchestration] Starting stage execution:', { 
        totalStages: struct.stages.length,
        stages: struct.stages.map(s => ({ name: s.name, mode: s.mode, roles: s.roles }))
      });

      this.progress.update(map => {
        const newMap = new Map(map);
        newMap.set(team.id, orchestrationProgress);
        return newMap;
      });

      this.runtime.updateStatus(team.id, 'running', '开始执行协作结构');

      const stageOutputMap = new Map<string, string>();

      for (let i = 0; i < struct.stages.length; i++) {
        const stage = struct.stages[i];
        console.log(`[TeamOrchestration] Executing stage ${i + 1}/${struct.stages.length}:`, stage.name);

        if (i > 0) {
          this.runtime.advanceStage(team.id);
        }

        this.updateProgress(team.id, {
          currentStageIndex: i,
          currentStageName: stage.name,
          currentStageMode: stage.mode,
        });

        const previousStageOutputs = this.buildPreviousStageContext(i, struct.stages, stageOutputMap);

        const stageResult = await this.executeStage(team.id, stage, task, previousStageOutputs);
        console.log(`[TeamOrchestration] Stage "${stage.name}" result:`, { 
          success: stageResult.success, 
          summary: stageResult.summary,
          durationMs: stageResult.durationMs 
        });

        if (stageResult.success && stageResult.agentResults) {
          const stageOutput = stageResult.agentResults
            .map(r => `## ${r.roleName} 的产出\n${r.content}`)
            .join('\n\n');
          stageOutputMap.set(stage.name, stageOutput);
        }

        this.updateProgressStageResult(team.id, stageResult);

        if (!stageResult.success) {
          const shouldEscalate = stage.failurePolicy === 'escalate' || (stage.mode === 'subagent' && struct.type === 'hybrid');

          if (shouldEscalate && stage.mode === 'subagent') {
            this.addRuntimeLog(team.id, 'warn', 'orchestration', `阶段 "${stage.name}" 失败，升级到协作模式`);

            const escalationResult = await this.escalateToCollaboration(team.id, stage, task);
            if (!escalationResult.success) {
              this.updateProgress(team.id, { status: 'failed' });
              this.runtime.updateStatus(team.id, 'failed', `阶段 "${stage.name}" 升级后仍失败`);
              break;
            }
          } else if (stage.failurePolicy === 'abort') {
            this.updateProgress(team.id, { status: 'failed' });
            this.runtime.updateStatus(team.id, 'failed', `阶段 "${stage.name}" 失败，中止执行`);
            break;
          }
        }
      }

      const currentProgress = this.progress().get(team.id);
      if (currentProgress?.status === 'running') {
        if (struct.completionCriteria && struct.completionCriteria.length > 0) {
          const allSucceeded = currentProgress.stageResults.every(r => r.success);
          if (!allSucceeded) {
            this.updateProgress(team.id, { status: 'failed' });
            this.runtime.updateStatus(team.id, 'failed', '完成条件未满足：存在失败阶段');
          } else {
            this.updateProgress(team.id, { status: 'completed' });
            this.runtime.updateStatus(team.id, 'completed', '所有阶段执行完成，满足完成条件');
          }
        } else {
          this.updateProgress(team.id, { status: 'completed' });
          this.runtime.updateStatus(team.id, 'completed', '所有阶段执行完成');
        }

        if (this.progress().get(team.id)?.status === 'completed') {
          const allArtifacts = currentProgress.stageResults
            .filter(r => r.success)
            .map(r => r.stageName);
          this.addRuntimeLog(team.id, 'info', 'orchestration',
            `产物汇总（策略：${struct.artifactAggregationStrategy || 'default'}）：${allArtifacts.join(', ')}`);
        }
      }

      await this.agentManager.terminateTeam(team.id);

      return {
        ok: true,
        command: '/team run struct',
        message: `协作结构 "${struct.name}" 执行${currentProgress?.status === 'completed' ? '完成' : '中止'}`,
        data: this.runtime.getTeam(team.id)!,
      };
    } catch (error) {
      return {
        ok: false,
        command: '/team run struct',
        message: `执行异常：${error instanceof Error ? error.message : String(error)}`,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private async executeStage(teamId: string, stage: TeamStageDefinition, task: string, previousStageOutputs?: string): Promise<StageResult> {
    const startTime = Date.now();

    this.addRuntimeLog(teamId, 'info', 'orchestration', `开始执行阶段 "${stage.name}"，模式：${stage.mode}`);

    try {
      const teamAgents = this.agentManager.getAgentsByTeam(teamId);
      const stageAgents = teamAgents.filter(a => 
        stage.roles.includes(a.roleDefinition.name) || 
        stage.roles.includes(a.roleDefinition.slug)
      );

      if (stage.mode === 'subagent') {
        const result = await this.executeSubagentStage(teamId, stage, stageAgents, task, previousStageOutputs);
        const durationMs = Date.now() - startTime;

        return {
          stageName: stage.name,
          mode: stage.mode,
          success: result.success,
          summary: result.summary,
          durationMs,
          agentResults: result.agentResults,
        };
      }

      if (stage.mode === 'agent-team') {
        const result = await this.executeAgentTeamStage(teamId, stage, stageAgents, task, previousStageOutputs);
        const durationMs = Date.now() - startTime;

        return {
          stageName: stage.name,
          mode: stage.mode,
          success: result.success,
          summary: result.summary,
          durationMs,
          agentResults: result.agentResults,
        };
      }

      if (stage.mode === 'hybrid') {
        const result = await this.executeHybridStage(teamId, stage, stageAgents, task, previousStageOutputs);
        const durationMs = Date.now() - startTime;

        return {
          stageName: stage.name,
          mode: stage.mode,
          success: result.ok,
          summary: result.message,
          durationMs,
        };
      }

      return {
        stageName: stage.name,
        mode: stage.mode,
        success: false,
        summary: `不支持的模式：${stage.mode}`,
        durationMs: Date.now() - startTime,
        error: `Unsupported mode: ${stage.mode}`,
      };
    } catch (error) {
      return {
        stageName: stage.name,
        mode: stage.mode,
        success: false,
        summary: `阶段执行异常：${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveStageRoles(roleNames: string[]): Promise<RoleDefinition[]> {
    await this.roleRegistry.refreshFromFiles();
    const resolved: RoleDefinition[] = [];
    for (const name of roleNames) {
      const role = this.roleRegistry.getByName(name) || this.roleRegistry.get(name);
      if (role) {
        resolved.push(role);
      }
    }
    return resolved;
  }

  private async executeSubagentStage(
    teamId: string,
    stage: TeamStageDefinition,
    stageAgents: TeamAgent[],
    task: string,
    previousStageOutputs?: string,
  ): Promise<{ success: boolean; summary: string; agentResults?: AgentTaskResult[] }> {
    console.log('[TeamOrchestration] executeSubagentStage:', { 
      teamId, 
      stageName: stage.name, 
      agentsCount: stageAgents.length,
      parallel: stage.parallel !== false 
    });
    
    if (stageAgents.length === 0) {
      console.warn('[TeamOrchestration] No agents for stage:', stage.name);
      return { success: false, summary: `阶段 "${stage.name}" 没有可用的 Agent` };
    }

    const team = this.runtime.getTeam(teamId);
    if (!team) {
      console.error('[TeamOrchestration] Team not found:', teamId);
      return { success: false, summary: `团队 ${teamId} 不存在` };
    }

    const stageTask = this.buildStageTask(stage, task, previousStageOutputs);

    console.log('[TeamOrchestration] Creating tasks for agents:', stageAgents.map(a => a.roleDefinition.name));
    for (const agent of stageAgents) {
      const taskId = this.taskBoard.createTask(teamId, `${agent.roleDefinition.name}: ${stageTask}`, agent.roleDefinition.name, stage.name);

      this.mailbox.sendMessage(
        teamId,
        team.leadAgentId,
        agent.descriptor.agentId,
        `阶段 "${stage.name}" 任务：${stageTask}。你的职责：${agent.roleDefinition.description}`,
        'normal'
      );
    }

    const parallel = stage.parallel !== false;
    let results: AgentTaskResult[];

    const executionContext = {
      teamId,
      stageName: stage.name,
      task: stageTask,
      inputs: previousStageOutputs ? [previousStageOutputs] : undefined,
    };

    console.log('[TeamOrchestration] Executing agents:', { parallel, agentsCount: stageAgents.length });
    if (parallel && stageAgents.length > 1) {
      results = await this.agentManager.executeParallel(stageAgents, executionContext);
    } else {
      results = await this.agentManager.executeSequential(stageAgents, executionContext, { passResults: true });
    }
    
    console.log('[TeamOrchestration] Agent execution results:', results.map(r => ({ 
      roleName: r.roleName, 
      success: r.success, 
      contentLength: r.content.length,
      durationMs: r.durationMs 
    })));

    for (const result of results) {
      const taskEntry = this.taskBoard.getTasksByAssignee(teamId, result.roleName)
        .find((t: import('./team.types').TeamTask) => t.status === 'in_progress');
      
      if (taskEntry) {
        if (result.success) {
          this.taskBoard.completeTask(teamId, taskEntry.id, result.content);
        } else {
          this.taskBoard.failTask(teamId, taskEntry.id, result.error || 'Unknown error');
        }
      }
    }

    const allSuccess = results.every(r => r.success);
    const failedCount = results.filter(r => !r.success).length;

    this.addRuntimeLog(teamId, allSuccess ? 'info' : 'warn', 'orchestration',
      `阶段 "${stage.name}" Agent执行${allSuccess ? '完成' : '部分失败'}：${results.length - failedCount}/${results.length} 成功`);

    return {
      success: allSuccess,
      summary: allSuccess
        ? `${stageAgents.length} 个 Agent 全部执行完成`
        : `${failedCount}/${stageAgents.length} 个 Agent 执行失败`,
      agentResults: results,
    };
  }

  private async executeAgentTeamStage(
    teamId: string,
    stage: TeamStageDefinition,
    stageAgents: TeamAgent[],
    task: string,
    previousStageOutputs?: string,
  ): Promise<{ success: boolean; summary: string; agentResults?: AgentTaskResult[] }> {
    if (stageAgents.length === 0) {
      return { success: false, summary: `阶段 "${stage.name}" 没有可用的 Agent` };
    }

    const team = this.runtime.getTeam(teamId);
    if (!team) {
      return { success: false, summary: `团队 ${teamId} 不存在` };
    }

    const stageTask = this.buildStageTask(stage, task, previousStageOutputs);

    for (const agent of stageAgents) {
      this.mailbox.sendMessage(
        teamId,
        team.leadAgentId,
        agent.descriptor.agentId,
        `阶段 "${stage.name}" 协作任务：${stageTask}。你的职责：${agent.roleDefinition.description}`,
        'normal'
      );
      this.taskBoard.createTask(teamId, `${agent.roleDefinition.name}: ${stageTask}`, agent.roleDefinition.name, stage.name);
    }

    const results = await this.agentManager.executeParallel(stageAgents, {
      teamId,
      stageName: stage.name,
      task: stageTask,
      inputs: previousStageOutputs ? [previousStageOutputs] : undefined,
    });

    const allSuccess = results.every(r => r.success);

    this.addRuntimeLog(teamId, 'info', 'orchestration',
      `阶段 "${stage.name}" agent-team协作${allSuccess ? '完成' : '部分失败'}，${stageAgents.length} 个成员`);

    return {
      success: allSuccess,
      summary: `团队协作阶段 "${stage.name}" ${allSuccess ? '完成' : '部分失败'}，${stageAgents.length} 个成员`,
      agentResults: results,
    };
  }

  private async executeHybridStage(
    teamId: string, 
    stage: TeamStageDefinition, 
    stageAgents: TeamAgent[], 
    task: string,
    previousStageOutputs?: string,
  ): Promise<CommandResult> {
    this.addRuntimeLog(teamId, 'info', 'orchestration', `hybrid阶段：先subagent并行，再agent-team协作汇总`);

    const subagentResult = await this.executeSubagentStage(teamId, stage, stageAgents, task, previousStageOutputs);

    const subagentOutput = subagentResult.agentResults
      ?.map(r => `## ${r.roleName} 的产出\n${r.content}`)
      .join('\n\n') || '';

    if (!subagentResult.success) {
      this.addRuntimeLog(teamId, 'warn', 'orchestration', `hybrid阶段subagent部分失败，升级到agent-team协作`);
      const escalationResult = await this.executeAgentTeamStage(teamId, stage, stageAgents, `协作排查：${task}`, subagentOutput);
      return {
        ok: escalationResult.success,
        command: '/team run struct',
        message: escalationResult.summary,
      };
    }

    const team = this.runtime.getTeam(teamId);
    if (team) {
      this.mailbox.broadcast(
        teamId,
        team.leadAgentId,
        'subagent阶段完成，请协作汇总结果',
        'normal'
      );
    }

    const agentResult = await this.executeAgentTeamStage(teamId, stage, stageAgents, `汇总并验证：${task}`, subagentOutput);

    return {
      ok: agentResult.success,
      command: '/team run struct',
      message: `hybrid完成：subagent=${subagentResult.summary}, agent-team=${agentResult.summary}`,
    };
  }

  private async escalateToCollaboration(teamId: string, failedStage: TeamStageDefinition, task: string): Promise<StageResult> {
    const startTime = Date.now();

    this.addRuntimeLog(teamId, 'info', 'orchestration', `升级到协作模式，角色：${failedStage.roles.join(', ')}`);

    try {
      const teamAgents = this.agentManager.getAgentsByTeam(teamId);
      const stageAgents = teamAgents.filter(a => 
        failedStage.roles.includes(a.roleDefinition.name) || 
        failedStage.roles.includes(a.roleDefinition.slug)
      );

      const result = await this.executeAgentTeamStage(teamId, failedStage, stageAgents, `协作排查：${task}`);

      const team = this.runtime.getTeam(teamId);
      if (team) {
        this.mailbox.broadcast(
          teamId,
          team.leadAgentId,
          '前一阶段执行失败，已升级到协作模式。请协作排查问题。',
          'high'
        );
      }

      return {
        stageName: `${failedStage.name}-escalation`,
        mode: 'agent-team',
        success: result.success,
        summary: result.summary,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        stageName: `${failedStage.name}-escalation`,
        mode: 'agent-team',
        success: false,
        summary: `升级后仍失败：${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getProgress(teamId: string): OrchestrationProgress | undefined {
    return this.progress().get(teamId);
  }

  private updateProgress(teamId: string, updates: Partial<OrchestrationProgress>): void {
    this.progress.update(map => {
      const newMap = new Map(map);
      const current = newMap.get(teamId);
      if (current) {
        newMap.set(teamId, { ...current, ...updates });
      }
      return newMap;
    });
  }

  private updateProgressStageResult(teamId: string, result: StageResult): void {
    this.progress.update(map => {
      const newMap = new Map(map);
      const current = newMap.get(teamId);
      if (current) {
        newMap.set(teamId, {
          ...current,
          stageResults: [...current.stageResults, result],
        });
      }
      return newMap;
    });
  }

  private addRuntimeLog(teamId: string, level: TeamLogEntry['level'], source: string, message: string): void {
    const team = this.runtime.getTeam(teamId);
    if (!team) return;

    const entry: TeamLogEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      level,
      source,
      message,
    };

    const updated: TeamRuntimeState = {
      ...team,
      logs: [...team.logs, entry],
      updatedAt: Date.now(),
    };

    this.runtime.persistRuntime(teamId);
  }

  private buildPreviousStageContext(
    currentStageIndex: number,
    stages: TeamStageDefinition[],
    stageOutputMap: Map<string, string>,
  ): string {
    if (currentStageIndex === 0) return '';

    const previousOutputs: string[] = [];
    for (let i = 0; i < currentStageIndex; i++) {
      const prevStage = stages[i];
      const output = stageOutputMap.get(prevStage.name);
      if (output) {
        previousOutputs.push(`### 阶段 "${prevStage.name}" 的产出\n${output}`);
      }
    }

    if (previousOutputs.length === 0) return '';

    return `## 前序阶段的产出物\n\n以下是之前阶段已经完成的工作成果，请基于这些内容继续推进：\n\n${previousOutputs.join('\n\n')}\n\n---\n请基于以上前序阶段的产出，继续完成你当前阶段的任务。`;
  }

  private buildStageTask(
    stage: TeamStageDefinition,
    originalTask: string,
    previousStageOutputs?: string,
  ): string {
    const parts: string[] = [];

    parts.push(`【团队目标】${originalTask}`);
    parts.push(`【当前阶段】${stage.name}（模式：${stage.mode}）`);

    if (stage.trigger) {
      parts.push(`【触发条件】${stage.trigger}`);
    }

    if (stage.output) {
      parts.push(`【本阶段产出要求】${stage.output}`);
    } else {
      const deliverableHints = this.inferStageDeliverables(stage);
      if (deliverableHints) {
        parts.push(`【本阶段产出要求】${deliverableHints}`);
      }
    }

    if (stage.completionCondition) {
      parts.push(`【完成条件】${stage.completionCondition}`);
    }

    if (stage.handoffCondition) {
      parts.push(`【移交条件】${stage.handoffCondition}`);
    }

    if (previousStageOutputs) {
      parts.push(previousStageOutputs);
    }

    return parts.join('\n\n');
  }

  private inferStageDeliverables(stage: TeamStageDefinition): string {
    const stageName = stage.name.toLowerCase();
    const roleHints = stage.roles.map(r => r.toLowerCase());

    if (stageName.includes('需求') || roleHints.some(r => r.includes('产品') || r.includes('product') || r.includes('经理'))) {
      return '请输出完整的需求文档，包含：用户故事、功能需求列表、非功能需求、优先级排序。确保与用户进行充分的需求沟通和头脑风暴。';
    }

    if (stageName.includes('设计') || stageName.includes('架构') || roleHints.some(r => r.includes('架构') || r.includes('architect'))) {
      return '请输出完整的设计文档，包含：系统架构图描述、模块划分、接口设计、数据模型、技术选型说明。';
    }

    if (stageName.includes('开发') || stageName.includes('实现') || roleHints.some(r => r.includes('开发') || r.includes('developer') || r.includes('前端') || r.includes('后端'))) {
      return '请基于前序阶段的需求文档和设计文档进行代码实现，输出关键代码文件和实现说明。';
    }

    if (stageName.includes('测试') || roleHints.some(r => r.includes('测试') || r.includes('test') || r.includes('qa'))) {
      return '请输出测试报告，包含：测试用例、测试结果、发现的缺陷列表、回归验证结论。';
    }

    if (stageName.includes('ui') || roleHints.some(r => r.includes('设计') || r.includes('design'))) {
      return '请输出设计方案，包含：界面布局方案、交互流程说明、样式规范建议。';
    }

    return '请输出本阶段的详细工作成果文档。';
  }
}
