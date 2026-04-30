import { Injectable, inject } from '@angular/core';
import type { CommandResult, TeamRuntimeState } from './team.types';
import { TeamOrchestrationService } from './team-orchestration.service';
import { TeamStageMachineService } from './team-stage-machine.service';
import { StructRegistryService } from './struct-registry.service';
import { TeamRuntimeService } from './team-runtime.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

@Injectable({ providedIn: 'root' })
export class TeamRunCommandService {
  private readonly orchestration = inject(TeamOrchestrationService);
  private readonly stageMachine = inject(TeamStageMachineService);
  private readonly structRegistry = inject(StructRegistryService);
  private readonly runtime = inject(TeamRuntimeService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  async executeStruct(structName: string, task: string): Promise<CommandResult<TeamRuntimeState>> {
    await this.structRegistry.refreshFromFiles();
    const struct = this.structRegistry.getByName(structName) || this.structRegistry.get(structName);
    if (!struct) {
      return {
        ok: false,
        command: '/team run struct',
        message: `协作结构 "${structName}" 不存在，请先使用 /team-struct new 创建`,
        errors: [`协作结构 "${structName}" 不存在`],
      };
    }

    const result = await this.orchestration.executeStruct(structName, task);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_COMMAND_EXECUTED,
      sessionId: 'team-run-command',
      source: 'user',
      payload: {
        command: `/team run struct "${structName}" "${task}"`,
        result,
      },
    });

    return result;
  }

  async executeStructWithStateMachine(structName: string, task: string): Promise<CommandResult> {
    await this.structRegistry.refreshFromFiles();
    const struct = this.structRegistry.getByName(structName) || this.structRegistry.get(structName);
    if (!struct) {
      return {
        ok: false,
        command: '/team run struct',
        message: `协作结构 "${structName}" 不存在`,
        errors: [`协作结构 "${structName}" 不存在`],
      };
    }

    const team = this.runtime.createTeam(structName, task);
    this.runtime.updateStatus(team.id, 'running', '使用阶段状态机执行');

    this.stageMachine.initialize(team.id, struct.stages);
    const result = await this.stageMachine.runAll(team.id, task);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_COMMAND_EXECUTED,
      sessionId: team.id,
      source: 'user',
      payload: {
        command: `/team run struct "${structName}" "${task}"`,
        result,
      },
    });

    return result;
  }

  async pauseTeam(teamId: string): Promise<CommandResult> {
    const team = this.runtime.getTeam(teamId);
    if (!team) {
      return {
        ok: false,
        command: '/team run pause',
        message: `团队 ${teamId} 不存在`,
        errors: [`团队 ${teamId} 不存在`],
      };
    }

    this.runtime.updateStatus(teamId, 'paused', '用户暂停');
    return {
      ok: true,
      command: '/team run pause',
      message: `团队 ${teamId} 已暂停`,
    };
  }

  async resumeTeam(teamId: string): Promise<CommandResult> {
    const team = this.runtime.getTeam(teamId);
    if (!team) {
      return {
        ok: false,
        command: '/team run resume',
        message: `团队 ${teamId} 不存在`,
        errors: [`团队 ${teamId} 不存在`],
      };
    }

    this.runtime.updateStatus(teamId, 'running', '用户恢复');
    return {
      ok: true,
      command: '/team run resume',
      message: `团队 ${teamId} 已恢复`,
    };
  }

  async stopTeam(teamId: string): Promise<CommandResult> {
    const team = this.runtime.getTeam(teamId);
    if (!team) {
      return {
        ok: false,
        command: '/team run stop',
        message: `团队 ${teamId} 不存在`,
        errors: [`团队 ${teamId} 不存在`],
      };
    }

    const cleanedUp = this.runtime.closeTeam(teamId);
    return {
      ok: true,
      command: '/team run stop',
      message: `团队 ${teamId} 已停止并清理，清理了 ${cleanedUp.length} 项资源`,
      data: { cleanedUp },
    };
  }

  async status(teamId?: string): Promise<CommandResult> {
    if (teamId) {
      const team = this.runtime.getTeam(teamId);
      if (!team) {
        return {
          ok: false,
          command: '/team run status',
          message: `团队 ${teamId} 不存在`,
          errors: [`团队 ${teamId} 不存在`],
        };
      }

      const progress = this.orchestration.getProgress(teamId);
      const machineState = this.stageMachine.getMachine(teamId);

      return {
        ok: true,
        command: '/team run status',
        message: `团队 ${teamId} 状态：${team.status}`,
        data: { team, progress, machineState },
      };
    }

    const teams = this.runtime.listTeams();
    return {
      ok: true,
      command: '/team run status',
      message: `共 ${teams.length} 个团队`,
      data: { teams },
    };
  }
}
