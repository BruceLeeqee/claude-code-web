import { Injectable, inject, signal, computed, Injector } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { TeamRunMode, TeamStageDefinition, TeamRuntimeState, TeamLogEntry, CommandResult } from './team.types';
import { TeamRuntimeService } from './team-runtime.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { TeamMailboxService } from './team-mailbox.service';
import { StructRegistryService } from './struct-registry.service';
import { TeamSubagentCommandService, SubagentResult } from './team-subagent-command.service';
import { TeamAgentCommandService } from './team-agent-command.service';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { TeamLoggerService } from './team-logger.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export type StageMachineState = 'idle' | 'pending' | 'running' | 'succeeded' | 'failed' | 'escalating' | 'retrying' | 'skipped' | 'aborted';

export interface StageMachineNode {
  stageIndex: number;
  stageName: string;
  stageMode: TeamRunMode;
  state: StageMachineState;
  attemptCount: number;
  maxAttempts: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  summary?: string;
  error?: string;
  artifacts: string[];
  inputFromPrevious: string[];
}

export interface StageMachineSnapshot {
  teamId: string;
  structName: string;
  nodes: StageMachineNode[];
  currentNodeIndex: number;
  overallState: 'idle' | 'running' | 'completed' | 'failed' | 'aborted';
  createdAt: number;
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class TeamStageMachineService {
  private readonly injector = inject(Injector);
  private _runtime: TeamRuntimeService | null = null;
  private get runtime(): TeamRuntimeService {
    if (!this._runtime) {
      this._runtime = this.injector.get(TeamRuntimeService);
    }
    return this._runtime;
  }
  private _subagentCmd: TeamSubagentCommandService | null = null;
  private get subagentCmd(): TeamSubagentCommandService {
    if (!this._subagentCmd) {
      this._subagentCmd = this.injector.get(TeamSubagentCommandService);
    }
    return this._subagentCmd;
  }
  private readonly taskBoard = inject(TeamTaskBoardService);
  private readonly mailbox = inject(TeamMailboxService);
  private readonly structRegistry = inject(StructRegistryService);
  private readonly agentCmd = inject(TeamAgentCommandService);
  private readonly persistence = inject(TeamFilePersistenceService);
  private readonly eventBus = inject(MultiAgentEventBusService);
  private readonly logger = inject(TeamLoggerService);

  private readonly machines = signal<Map<string, StageMachineSnapshot>>(new Map());

  readonly activeMachine = computed(() => {
    const map = this.machines();
    return map.size > 0 ? [...map.values()].find(m => m.overallState === 'running') : null;
  });

  initialize(teamId: string, stages: TeamStageDefinition[]): StageMachineSnapshot {
    const team = this.runtime.getTeam(teamId);
    if (!team) throw new Error(`团队 ${teamId} 不存在`);

    const nodes: StageMachineNode[] = stages.map((stage, index) => ({
      stageIndex: index,
      stageName: stage.name,
      stageMode: stage.mode,
      state: 'idle' as StageMachineState,
      attemptCount: 0,
      maxAttempts: stage.failurePolicy === 'retry' ? 3 : 1,
      artifacts: [],
      inputFromPrevious: [],
    }));

    if (nodes.length > 0) {
      nodes[0].state = 'pending';
    }

    const snapshot: StageMachineSnapshot = {
      teamId,
      structName: team.structName,
      nodes,
      currentNodeIndex: 0,
      overallState: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.machines.update(map => {
      const newMap = new Map(map);
      newMap.set(teamId, snapshot);
      return newMap;
    });

    return snapshot;
  }

  async runAll(teamId: string, task: string): Promise<CommandResult<StageMachineSnapshot>> {
    const machine = this.machines().get(teamId);
    if (!machine) {
      return {
        ok: false,
        command: 'stage-machine-run',
        message: '状态机未初始化',
        errors: ['请先调用 initialize()'],
      };
    }

    this.updateMachine(teamId, { overallState: 'running' });

    const struct = this.structRegistry.getByName(machine.structName);
    if (!struct) {
      this.updateMachine(teamId, { overallState: 'failed' });
      return {
        ok: false,
        command: 'stage-machine-run',
        message: `协作结构 "${machine.structName}" 不存在`,
        errors: [`协作结构 "${machine.structName}" 不存在`],
      };
    }

    for (let i = 0; i < machine.nodes.length; i++) {
      const node = this.machines().get(teamId)!.nodes[i];
      const stage = struct.stages[i];

      this.updateNode(teamId, i, { state: 'running', startedAt: Date.now(), attemptCount: node.attemptCount + 1 });

      if (i > 0) {
        this.runtime.advanceStage(teamId);
        const previousNode = this.machines().get(teamId)!.nodes[i - 1];
        this.updateNode(teamId, i, { inputFromPrevious: previousNode.artifacts });
      }

      const result = await this.executeStageByMode(teamId, stage, task, node);

      if (result.success) {
        if (stage.completionCondition && !this.checkCompletionCondition(stage.completionCondition, result)) {
          this.updateNode(teamId, i, {
            state: 'failed',
            completedAt: Date.now(),
            durationMs: Date.now() - (this.machines().get(teamId)!.nodes[i].startedAt || Date.now()),
            error: `完成条件未满足：${stage.completionCondition}`,
          });

          const handled = await this.handleFailure(teamId, i, stage, task, `完成条件未满足：${stage.completionCondition}`);
          if (!handled) {
            this.updateMachine(teamId, { overallState: 'failed' });
            this.runtime.updateStatus(teamId, 'failed', `阶段 "${stage.name}" 完成条件未满足`);

            return {
              ok: false,
              command: 'stage-machine-run',
              message: `阶段 "${stage.name}" 完成条件未满足`,
              data: this.machines().get(teamId)!,
              errors: [`完成条件未满足：${stage.completionCondition}`],
            };
          }

          continue;
        }

        this.updateNode(teamId, i, {
          state: 'succeeded',
          completedAt: Date.now(),
          durationMs: Date.now() - (this.machines().get(teamId)!.nodes[i].startedAt || Date.now()),
          summary: result.summary,
          artifacts: result.artifacts,
        });

        this.taskBoard.completeTask(teamId, this.findTaskForStage(teamId, stage.name), result.summary);

        if (stage.regressionTest) {
          await this.runRegressionVerification(teamId, i, stage, result.artifacts);
        }
      } else {
        this.updateNode(teamId, i, {
          state: 'failed',
          completedAt: Date.now(),
          durationMs: Date.now() - (this.machines().get(teamId)!.nodes[i].startedAt || Date.now()),
          error: result.error,
        });

        const handled = await this.handleFailure(teamId, i, stage, task, result.error || 'Unknown error');
        if (!handled) {
          this.updateMachine(teamId, { overallState: 'failed' });
          this.runtime.updateStatus(teamId, 'failed', `阶段 "${stage.name}" 失败且无法恢复`);

          return {
            ok: false,
            command: 'stage-machine-run',
            message: `阶段 "${stage.name}" 失败`,
            data: this.machines().get(teamId)!,
            errors: [result.error || 'Unknown error'],
          };
        }
      }
    }

    const finalMachine = this.machines().get(teamId)!;
    if (finalMachine.overallState === 'running') {
      const allArtifacts = finalMachine.nodes.flatMap(n => n.artifacts);
      const stageSummaries = finalMachine.nodes.map(n => `[${n.stageName}] ${n.summary || '无摘要'}`).join('\n');

      this.updateMachine(teamId, { overallState: 'completed' });
      this.runtime.updateStatus(teamId, 'completed', '所有阶段执行完成');

      this.eventBus.emit({
        type: EVENT_TYPES.TEAM_RUNTIME_COMPLETED,
        sessionId: teamId,
        source: 'system',
        payload: {
          teamId,
          finalStatus: 'completed',
          durationMs: Date.now() - finalMachine.createdAt,
          completedTasks: finalMachine.nodes.filter(n => n.state === 'succeeded').length,
          failedTasks: finalMachine.nodes.filter(n => n.state === 'failed').length,
          structName: finalMachine.structName,
        },
      });

      this.addLog(teamId, 'info', 'stage-machine', `产物汇总：${allArtifacts.length} 个文件\n${stageSummaries}`);
    }

    return {
      ok: true,
      command: 'stage-machine-run',
      message: '所有阶段执行完成',
      data: this.machines().get(teamId)!,
    };
  }

  private async executeStageByMode(
    teamId: string,
    stage: TeamStageDefinition,
    task: string,
    node: StageMachineNode
  ): Promise<{ success: boolean; summary: string; error?: string; artifacts: string[] }> {
    const team = this.runtime.getTeam(teamId);

    try {
      if (stage.mode === 'subagent') {
        const result = await this.subagentCmd.execute(stage.roles, task);
        return {
          success: result.ok,
          summary: result.message,
          error: result.ok ? undefined : result.errors?.join('; '),
          artifacts: result.ok ? (result.createdFiles || []) : [],
        };
      }

      if (stage.mode === 'agent-team') {
        const result = await this.agentCmd.execute(stage.roles, task);
        return {
          success: result.ok,
          summary: result.message,
          error: result.ok ? undefined : result.errors?.join('; '),
          artifacts: result.ok ? (result.createdFiles || []) : [],
        };
      }

      if (stage.mode === 'hybrid') {
        return await this.executeHybridMode(teamId, stage, task);
      }

      return {
        success: false,
        summary: `不支持的模式：${stage.mode}`,
        error: `Unsupported stage mode: ${stage.mode}`,
        artifacts: [],
      };
    } catch (error) {
      return {
        success: false,
        summary: `阶段执行异常`,
        error: error instanceof Error ? error.message : String(error),
        artifacts: [],
      };
    }
  }

  private async executeHybridMode(
    teamId: string,
    stage: TeamStageDefinition,
    task: string
  ): Promise<{ success: boolean; summary: string; error?: string; artifacts: string[] }> {
    const team = this.runtime.getTeam(teamId);
    const subagentResult = await this.subagentCmd.execute(stage.roles, task);

    if (!subagentResult.ok) {
      this.addLog(teamId, 'warn', 'stage-machine', `hybrid阶段subagent部分失败，升级到agent-team协作`, { stageName: stage.name });

      const escalationResult = await this.agentCmd.execute(stage.roles, `协作排查：${task}`);

      if (team) {
        this.mailbox.broadcast(teamId, team.leadAgentId, 'subagent阶段失败，已升级到协作模式', 'high');
      }

      return {
        success: escalationResult.ok,
        summary: escalationResult.message,
        error: escalationResult.ok ? undefined : escalationResult.errors?.join('; '),
        artifacts: escalationResult.ok ? (escalationResult.createdFiles || []) : [],
      };
    }

    if (team) {
      this.mailbox.broadcast(teamId, team.leadAgentId, 'subagent阶段完成，请协作汇总结果', 'normal');
    }

    const agentResult = await this.agentCmd.execute(stage.roles, `汇总并验证：${task}`);

    return {
      success: agentResult.ok,
      summary: `hybrid完成：subagent=${subagentResult.message}, agent-team=${agentResult.message}`,
      error: agentResult.ok ? undefined : agentResult.errors?.join('; '),
      artifacts: [...(subagentResult.createdFiles || []), ...(agentResult.createdFiles || [])],
    };
  }

  private async handleFailure(
    teamId: string,
    nodeIndex: number,
    stage: TeamStageDefinition,
    task: string,
    error: string
  ): Promise<boolean> {
    const machine = this.machines().get(teamId);
    if (!machine) return false;

    const node = machine.nodes[nodeIndex];

    if (node.attemptCount < node.maxAttempts && stage.failurePolicy === 'retry') {
      this.updateNode(teamId, nodeIndex, { state: 'retrying' });
      this.addLog(teamId, 'info', 'stage-machine', `重试阶段 "${stage.name}"（第${node.attemptCount + 1}次）`, { stageName: stage.name });

      const retryResult = await this.executeStageByMode(teamId, stage, task, node);

      if (retryResult.success) {
        this.updateNode(teamId, nodeIndex, {
          state: 'succeeded',
          completedAt: Date.now(),
          summary: retryResult.summary,
          artifacts: retryResult.artifacts,
        });
        return true;
      }

      return false;
    }

    if (stage.failurePolicy === 'escalate' && stage.mode === 'subagent') {
      this.updateNode(teamId, nodeIndex, { state: 'escalating' });
      this.addLog(teamId, 'info', 'stage-machine', `升级阶段 "${stage.name}" 到协作模式`, { stageName: stage.name });

      const escalationResult = await this.agentCmd.execute(stage.roles, `协作排查：${task}`);

      if (escalationResult.ok) {
        this.updateNode(teamId, nodeIndex, {
          state: 'succeeded',
          completedAt: Date.now(),
          summary: `升级后成功：${escalationResult.message}`,
          artifacts: escalationResult.createdFiles || [],
        });
        return true;
      }

      return false;
    }

    if (stage.failurePolicy === 'abort') {
      this.updateNode(teamId, nodeIndex, { state: 'aborted' });
      return false;
    }

    return false;
  }

  getMachine(teamId: string): StageMachineSnapshot | undefined {
    return this.machines().get(teamId);
  }

  destroyMachine(teamId: string): boolean {
    const exists = this.machines().has(teamId);
    if (!exists) return false;

    this.machines.update(map => {
      const newMap = new Map(map);
      newMap.delete(teamId);
      return newMap;
    });

    return true;
  }

  private findTaskForStage(teamId: string, stageName: string): string {
    const tasks = this.taskBoard.getTasksByStage(teamId, stageName);
    return tasks.length > 0 ? tasks[0].id : '';
  }

  private updateMachine(teamId: string, updates: Partial<StageMachineSnapshot>): void {
    this.machines.update(map => {
      const newMap = new Map(map);
      const current = newMap.get(teamId);
      if (current) {
        newMap.set(teamId, { ...current, ...updates, updatedAt: Date.now() });
      }
      return newMap;
    });
  }

  private updateNode(teamId: string, nodeIndex: number, updates: Partial<StageMachineNode>): void {
    this.machines.update(map => {
      const newMap = new Map(map);
      const current = newMap.get(teamId);
      if (current) {
        const newNodes = [...current.nodes];
        newNodes[nodeIndex] = { ...newNodes[nodeIndex], ...updates };
        newMap.set(teamId, { ...current, nodes: newNodes, updatedAt: Date.now() });
      }
      return newMap;
    });
  }

  private addLog(teamId: string, level: TeamLogEntry['level'], source: string, message: string, context?: { stageName?: string; taskId?: string; agentId?: string }): void {
    this.logger.log(level, source, message, {
      teamId,
      stageName: context?.stageName,
      taskId: context?.taskId,
      agentId: context?.agentId,
    });
    this.runtime.persistRuntime(teamId);
  }

  private checkCompletionCondition(
    condition: string,
    result: { success: boolean; summary: string; artifacts: string[] },
  ): boolean {
    if (condition === 'artifacts-required') {
      return result.artifacts.length > 0;
    }
    if (condition === 'summary-required') {
      return result.summary.length > 0;
    }
    if (condition.startsWith('artifacts-min:')) {
      const min = parseInt(condition.split(':')[1], 10);
      return result.artifacts.length >= min;
    }
    return true;
  }

  private async runRegressionVerification(
    teamId: string,
    nodeIndex: number,
    stage: TeamStageDefinition,
    artifacts: string[],
  ): Promise<void> {
    this.addLog(teamId, 'info', 'stage-machine', `触发回归验证：${stage.regressionTest}`, { stageName: stage.name });

    const regressionRoles = stage.roles.length > 0 ? [stage.roles[stage.roles.length - 1]] : stage.roles;
    const regressionTask = `回归验证：${stage.regressionTest}\n验证产物：${artifacts.join(', ')}`;

    try {
      const regressionResult = await this.subagentCmd.execute(regressionRoles, regressionTask);

      if (regressionResult.ok) {
        this.addLog(teamId, 'info', 'stage-machine', `回归验证通过：${regressionResult.message}`, { stageName: stage.name });
      } else {
        this.addLog(teamId, 'warn', 'stage-machine', `回归验证失败：${regressionResult.errors?.join('; ')}`, { stageName: stage.name });
      }
    } catch (e: any) {
      this.addLog(teamId, 'warn', 'stage-machine', `回归验证异常：${e?.message ?? String(e)}`, { stageName: stage.name });
    }
  }
}
