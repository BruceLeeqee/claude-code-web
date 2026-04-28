import { Injectable, inject, signal, computed } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { TeamRunMode, TeamStageDefinition, TeamRuntimeState, TeamLogEntry, CommandResult } from './team.types';
import { StructRegistryService } from './struct-registry.service';
import { RoleRegistryService } from './role-registry.service';
import { TeamRuntimeService } from './team-runtime.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { TeamMailboxService } from './team-mailbox.service';
import { TeamSubagentCommandService, SubagentResult } from './team-subagent-command.service';
import { TeamAgentCommandService } from './team-agent-command.service';
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
}

export interface StageResult {
  stageName: string;
  mode: TeamRunMode;
  success: boolean;
  summary: string;
  durationMs: number;
  subagentResults?: SubagentResult[];
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class TeamOrchestrationService {
  private readonly runtime = inject(TeamRuntimeService);
  private readonly structRegistry = inject(StructRegistryService);
  private readonly roleRegistry = inject(RoleRegistryService);
  private readonly taskBoard = inject(TeamTaskBoardService);
  private readonly mailbox = inject(TeamMailboxService);
  private readonly subagentCmd = inject(TeamSubagentCommandService);
  private readonly agentCmd = inject(TeamAgentCommandService);
  private readonly persistence = inject(TeamFilePersistenceService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly progress = signal<Map<string, OrchestrationProgress>>(new Map());

  readonly activeProgress = computed(() => {
    const map = this.progress();
    return map.size > 0 ? [...map.values()].find(p => p.status === 'running') : null;
  });

  async executeStruct(structName: string, task: string): Promise<CommandResult<TeamRuntimeState>> {
    const struct = this.structRegistry.getByName(structName) || this.structRegistry.get(structName);
    if (!struct) {
      return {
        ok: false,
        command: '/team run struct',
        message: `协作结构 "${structName}" 不存在`,
        errors: [`协作结构 "${structName}" 不存在`],
      };
    }

    const roleValidation = this.structRegistry.validateRoles(struct.roles);
    if (!roleValidation.valid) {
      return {
        ok: false,
        command: '/team run struct',
        message: `以下角色未定义：${roleValidation.missing.join(', ')}`,
        errors: [`未定义角色：${roleValidation.missing.join(', ')}`],
      };
    }

    try {
      const team = this.runtime.createTeam(structName, task);

      const orchestrationProgress: OrchestrationProgress = {
        teamId: team.id,
        structName: struct.name,
        totalStages: struct.stages.length,
        currentStageIndex: 0,
        currentStageName: struct.stages[0]?.name || '',
        currentStageMode: struct.stages[0]?.mode || 'subagent',
        status: 'running',
        stageResults: [],
      };

      this.progress.update(map => {
        const newMap = new Map(map);
        newMap.set(team.id, orchestrationProgress);
        return newMap;
      });

      this.runtime.updateStatus(team.id, 'running', '开始执行协作结构');

      for (let i = 0; i < struct.stages.length; i++) {
        const stage = struct.stages[i];

        if (i > 0) {
          this.runtime.advanceStage(team.id);
        }

        this.updateProgress(team.id, {
          currentStageIndex: i,
          currentStageName: stage.name,
          currentStageMode: stage.mode,
        });

        const stageResult = await this.executeStage(team.id, stage, task);

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

  private async executeStage(teamId: string, stage: TeamStageDefinition, task: string): Promise<StageResult> {
    const startTime = Date.now();

    this.addRuntimeLog(teamId, 'info', 'orchestration', `开始执行阶段 "${stage.name}"，模式：${stage.mode}`);

    try {
      if (stage.mode === 'subagent') {
        const result = await this.subagentCmd.execute(stage.roles, task);
        const durationMs = Date.now() - startTime;

        return {
          stageName: stage.name,
          mode: stage.mode,
          success: result.ok,
          summary: result.message,
          durationMs,
          subagentResults: result.data,
        };
      }

      if (stage.mode === 'agent-team') {
        const result = await this.agentCmd.execute(stage.roles, task);
        const durationMs = Date.now() - startTime;

        return {
          stageName: stage.name,
          mode: stage.mode,
          success: result.ok,
          summary: result.message,
          durationMs,
        };
      }

      if (stage.mode === 'hybrid') {
        const result = await this.executeHybridStage(teamId, stage, task);
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

  private async executeHybridStage(teamId: string, stage: TeamStageDefinition, task: string): Promise<CommandResult> {
    this.addRuntimeLog(teamId, 'info', 'orchestration', `hybrid阶段：先subagent并行，再agent-team协作汇总`);

    const subagentResult = await this.subagentCmd.execute(stage.roles, task);

    if (!subagentResult.ok) {
      this.addRuntimeLog(teamId, 'warn', 'orchestration', `hybrid阶段subagent部分失败，升级到agent-team协作`);
      return this.agentCmd.execute(stage.roles, `协作排查：${task}`);
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

    const agentResult = await this.agentCmd.execute(stage.roles, `汇总并验证：${task}`);

    return {
      ok: agentResult.ok,
      command: agentResult.command,
      message: `hybrid完成：subagent=${subagentResult.message}, agent-team=${agentResult.message}`,
      data: agentResult.data,
      errors: agentResult.errors,
      createdFiles: [...(subagentResult.createdFiles || []), ...(agentResult.createdFiles || [])],
    };
  }

  private async escalateToCollaboration(teamId: string, failedStage: TeamStageDefinition, task: string): Promise<StageResult> {
    const startTime = Date.now();

    this.addRuntimeLog(teamId, 'info', 'orchestration', `升级到协作模式，角色：${failedStage.roles.join(', ')}`);

    try {
      const result = await this.agentCmd.execute(failedStage.roles, `协作排查：${task}`);

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
        success: result.ok,
        summary: result.message,
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
}
