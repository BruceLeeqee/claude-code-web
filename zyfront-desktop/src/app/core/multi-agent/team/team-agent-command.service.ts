import { Injectable, inject, signal, computed } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { CommandResult, TeamRuntimeState, RoleDefinition, TeamMemberState } from './team.types';
import { TEAM_FILE_PATHS } from './team.types';
import { RoleRegistryService } from './role-registry.service';
import { TeamRuntimeService } from './team-runtime.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { TeamMailboxService } from './team-mailbox.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

@Injectable({ providedIn: 'root' })
export class TeamAgentCommandService {
  private readonly registry = inject(RoleRegistryService);
  private readonly runtime = inject(TeamRuntimeService);
  private readonly taskBoard = inject(TeamTaskBoardService);
  private readonly mailbox = inject(TeamMailboxService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly isRunning = signal(false);
  readonly running = computed(() => this.isRunning());

  async execute(roleNames: string[], task: string): Promise<CommandResult<TeamRuntimeState>> {
    this.isRunning.set(true);
    await this.registry.refreshFromFiles();

    const resolvedRoles: RoleDefinition[] = [];
    const missingRoles: string[] = [];

    for (const name of roleNames) {
      const role = this.registry.getByName(name) || this.registry.get(name);
      if (role) {
        resolvedRoles.push(role);
      } else {
        missingRoles.push(name);
      }
    }

    if (missingRoles.length > 0) {
      this.isRunning.set(false);
      return {
        ok: false,
        command: '/team-agent',
        message: `以下角色未定义：${missingRoles.join(', ')}，请先使用 /team-role new 创建`,
        errors: [`未定义角色：${missingRoles.join(', ')}`],
      };
    }

    const structName = this.inferStructName(roleNames, task);

    try {
      const team = this.runtime.createTeam(structName, task);

      this.eventBus.emit({
        type: EVENT_TYPES.TEAM_AGENT_STARTED,
        sessionId: team.id,
        source: 'user',
        payload: { teamId: team.id, roles: roleNames, task },
      });

      for (const role of resolvedRoles) {
        const member = team.members.find(m => m.roleName === role.name);
        if (member) {
          this.mailbox.sendMessage(
            team.id,
            team.leadAgentId,
            member.agentId,
            `你好 ${role.name}，团队任务：${task}。你的职责：${role.description}`,
            'normal'
          );
        }
      }

      for (const role of resolvedRoles) {
        this.taskBoard.createTask(team.id, `${role.name}: ${task}`, role.name, 'collaborative-work');
      }

      this.runtime.updateStatus(team.id, 'running', '团队协作已启动');

      this.isRunning.set(false);

      return {
        ok: true,
        command: '/team-agent',
        message: `团队协作已启动，${resolvedRoles.length} 个成员已加入`,
        data: this.runtime.getTeam(team.id)!,
        createdFiles: [`${TEAM_FILE_PATHS.teams}/${team.id}/team.json`],
      };
    } catch (error) {
      this.isRunning.set(false);

      return {
        ok: false,
        command: '/team-agent',
        message: `团队创建失败：${error instanceof Error ? error.message : String(error)}`,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async sendMessage(teamId: string, from: string, to: string, content: string): Promise<CommandResult> {
    const team = this.runtime.getTeam(teamId);
    if (!team) {
      return {
        ok: false,
        command: '/team-agent message',
        message: `团队 ${teamId} 不存在`,
        errors: [`团队 ${teamId} 不存在`],
      };
    }

    const message = this.mailbox.sendMessage(teamId, from, to, content, 'normal');

    return {
      ok: true,
      command: '/team-agent message',
      message: `消息已发送给 ${to}`,
      data: message,
    };
  }

  async getInbox(teamId: string, agentId: string): Promise<CommandResult> {
    const team = this.runtime.getTeam(teamId);
    if (!team) {
      return {
        ok: false,
        command: '/team-agent inbox',
        message: `团队 ${teamId} 不存在`,
        errors: [`团队 ${teamId} 不存在`],
      };
    }

    const messages = this.mailbox.getInbox(teamId, agentId);
    const unread = this.mailbox.getUnreadCount(teamId, agentId);

    return {
      ok: true,
      command: '/team-agent inbox',
      message: `${agentId} 收件箱：${messages.length} 条消息，${unread} 条未读`,
      data: { messages, unread },
    };
  }

  async closeTeam(teamId: string): Promise<CommandResult> {
    const team = this.runtime.getTeam(teamId);
    if (!team) {
      return {
        ok: false,
        command: '/team-agent close',
        message: `团队 ${teamId} 不存在`,
        errors: [`团队 ${teamId} 不存在`],
      };
    }

    const cleanedUp = this.runtime.closeTeam(teamId);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_AGENT_COMPLETED,
      sessionId: teamId,
      source: 'user',
      payload: { teamId, summary: `团队已关闭，清理了 ${cleanedUp.length} 项资源` },
    });

    return {
      ok: true,
      command: '/team-agent close',
      message: `团队已关闭，清理了 ${cleanedUp.length} 项资源`,
      data: { cleanedUp },
    };
  }

  private inferStructName(roleNames: string[], task: string): string {
    if (/安全|security/i.test(task)) return 'security-review';
    if (/pr|评审|review/i.test(task)) return 'pr-verification';

    const hasFrontend = roleNames.some(r => /frontend|前端/i.test(r));
    const hasBackend = roleNames.some(r => /backend|后端/i.test(r));
    const hasQa = roleNames.some(r => /qa|test|测试/i.test(r));

    if (hasFrontend && hasBackend && hasQa) return 'fullstack-dev-with-fix';

    return 'fullstack-dev-with-fix';
  }
}
