import { Injectable, inject, signal, computed } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { CommandResult, TeamTask, RoleDefinition } from './team.types';
import { RoleRegistryService } from './role-registry.service';
import { TeamRuntimeService } from './team-runtime.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { TeamMailboxService } from './team-mailbox.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import { ParallelExecutionService } from '../services/parallel-execution.service';
import { AgentFactoryService } from '../services/agent-factory.service';

export interface SubagentResult {
  roleName: string;
  success: boolean;
  summary: string;
  files: string[];
  durationMs: number;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class TeamSubagentCommandService {
  private readonly registry = inject(RoleRegistryService);
  private readonly runtime = inject(TeamRuntimeService);
  private readonly taskBoard = inject(TeamTaskBoardService);
  private readonly mailbox = inject(TeamMailboxService);
  private readonly eventBus = inject(MultiAgentEventBusService);
  private readonly parallel = inject(ParallelExecutionService);
  private readonly factory = inject(AgentFactoryService);

  private readonly results = signal<SubagentResult[]>([]);
  private readonly isRunning = signal(false);

  readonly currentResults = computed(() => this.results());
  readonly running = computed(() => this.isRunning());

  async execute(roleNames: string[], task: string): Promise<CommandResult<SubagentResult[]>> {
    this.isRunning.set(true);
    this.results.set([]);

    const teamId = `subagent-${uuidv4()}`;
    const now = Date.now();

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
        command: '/team-subagent',
        message: `以下角色未定义：${missingRoles.join(', ')}，请先使用 /team-role new 创建`,
        errors: [`未定义角色：${missingRoles.join(', ')}`],
      };
    }

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_SUBAGENT_STARTED,
      sessionId: teamId,
      source: 'user',
      payload: { teamId, roles: roleNames, task },
    });

    const taskEntries: TeamTask[] = [];
    for (const role of resolvedRoles) {
      const t = this.taskBoard.createTask(teamId, `${role.name}: ${task}`, role.name, 'subagent-execution');
      taskEntries.push(t);
    }

    try {
      const parallelResults = await this.executeInParallel(resolvedRoles, task, teamId);

      this.results.set(parallelResults);

      const allSuccess = parallelResults.every(r => r.success);
      const failedRoles = parallelResults.filter(r => !r.success);

      if (allSuccess) {
        this.eventBus.emit({
          type: EVENT_TYPES.TEAM_SUBAGENT_COMPLETED,
          sessionId: teamId,
          source: 'system',
          payload: { teamId, results: parallelResults },
        });
      } else {
        for (const failed of failedRoles) {
          this.eventBus.emit({
            type: EVENT_TYPES.TEAM_SUBAGENT_FAILED,
            sessionId: teamId,
            source: 'system',
            payload: { teamId, roleName: failed.roleName, error: failed.error || 'Unknown error' },
          });
        }
      }

      const needsCollaboration = this.detectNeedForCollaboration(parallelResults);

      this.isRunning.set(false);

      return {
        ok: allSuccess,
        command: '/team-subagent',
        message: allSuccess
          ? `${resolvedRoles.length} 个子智能体全部执行完成`
          : `${failedRoles.length}/${resolvedRoles.length} 个子智能体执行失败`,
        data: parallelResults,
        warnings: needsCollaboration
          ? ['检测到集成风险，建议使用 /team-agent 进入协作模式']
          : undefined,
      };
    } catch (error) {
      this.isRunning.set(false);

      return {
        ok: false,
        command: '/team-subagent',
        message: `子智能体执行异常：${error instanceof Error ? error.message : String(error)}`,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private async executeInParallel(roles: RoleDefinition[], task: string, teamId: string): Promise<SubagentResult[]> {
    const promises = roles.map(async (role): Promise<SubagentResult> => {
      const startTime = Date.now();

      try {
        const summary = await this.simulateSubagentExecution(role, task, teamId);
        const durationMs = Date.now() - startTime;

        this.taskBoard.completeTask(teamId,
          this.taskBoard.taskList().find(t => t.assignee === role.name)?.id || '',
          summary
        );

        return {
          roleName: role.name,
          success: true,
          summary,
          files: [],
          durationMs,
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;

        this.taskBoard.failTask(teamId,
          this.taskBoard.taskList().find(t => t.assignee === role.name)?.id || '',
          error instanceof Error ? error.message : String(error)
        );

        return {
          roleName: role.name,
          success: false,
          summary: `执行失败：${error instanceof Error ? error.message : String(error)}`,
          files: [],
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    return Promise.all(promises);
  }

  private async simulateSubagentExecution(role: RoleDefinition, task: string, teamId: string): Promise<string> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(`[${role.name}] 已完成任务：${task}。角色类型：${role.type}，使用模型：${role.model || 'default'}`);
      }, 100);
    });
  }

  private detectNeedForCollaboration(results: SubagentResult[]): boolean {
    const failedCount = results.filter(r => !r.success).length;
    if (failedCount > 0 && results.length > 1) return true;

    const summaries = results.map(r => r.summary.toLowerCase());
    const conflictKeywords = ['冲突', '不一致', '集成失败', '接口不匹配', 'conflict', 'inconsistency'];
    return summaries.some(s => conflictKeywords.some(kw => s.includes(kw)));
  }
}
