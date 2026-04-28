import { Injectable, inject, signal } from '@angular/core';
import { TeamRuntimeService } from './team-runtime.service';
import { TeamMemorySyncService } from './team-memory-sync.service';
import { TeamLoggerService } from './team-logger.service';
import { TeamMailboxService } from './team-mailbox.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { TeamStageMachineService } from './team-stage-machine.service';

export interface RecoveryResult {
  teamId: string;
  recovered: boolean;
  actions: string[];
  errors: string[];
}

export interface CleanupResult {
  teamId: string;
  cleaned: boolean;
  resourcesReleased: string[];
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class TeamRecoveryService {
  private readonly runtime = inject(TeamRuntimeService);
  private readonly memory = inject(TeamMemorySyncService);
  private readonly logger = inject(TeamLoggerService);
  private readonly mailbox = inject(TeamMailboxService);
  private readonly taskBoard = inject(TeamTaskBoardService);
  private readonly stageMachine = inject(TeamStageMachineService);

  private readonly recoveryInProgress = signal<Set<string>>(new Set());

  isRecovering(teamId: string): boolean {
    return this.recoveryInProgress().has(teamId);
  }

  async recoverTeam(teamId: string): Promise<RecoveryResult> {
    const actions: string[] = [];
    const errors: string[] = [];

    if (this.recoveryInProgress().has(teamId)) {
      return { teamId, recovered: false, actions: [], errors: ['恢复已在进行中'] };
    }

    this.recoveryInProgress.update(s => new Set(s).add(teamId));
    this.logger.info('recovery', '开始团队恢复流程', { teamId });

    try {
      const snapshot = this.memory.getSnapshot(teamId);
      if (snapshot) {
        const restored = this.memory.restoreFromSnapshot(teamId);
        if (restored) {
          actions.push(`从快照恢复 ${restored.length} 条记忆`);
          this.logger.info('recovery', `从快照恢复 ${restored.length} 条记忆`, { teamId });
        }
      } else {
        actions.push('无可用快照，跳过记忆恢复');
      }

      const state = this.runtime.getTeam(teamId);
      if (state) {
        if (state.status === 'initializing') {
          const initDuration = Date.now() - state.updatedAt;
          if (initDuration > 60000) {
            this.runtime.updateStatus(teamId, 'failed', '恢复：初始化超时，标记为失败');
            actions.push('检测到半初始化状态（超时60s），已标记为失败');
            this.logger.warn('recovery', '检测到半初始化状态，已标记为失败', { teamId });
          } else {
            actions.push('团队正在初始化中，跳过恢复');
          }
        } else if (state.status === 'failed') {
          this.runtime.updateStatus(teamId, 'paused', '恢复：将失败状态重置为暂停');
          actions.push('将失败状态重置为暂停');
          this.logger.info('recovery', '将失败状态重置为暂停', { teamId });
        } else if (state.status === 'blocked') {
          this.runtime.updateStatus(teamId, 'paused', '恢复：将阻塞状态重置为暂停');
          actions.push('团队处于阻塞状态，已重置为暂停');
        } else if (state.status === 'closed') {
          return { teamId, recovered: false, actions, errors: ['团队已关闭，无法恢复'] };
        }

        const memberIds = state.members.map(m => m.agentId);
        for (const mid of memberIds) {
          const inbox = this.mailbox.getInbox(teamId, mid);
          if (inbox.length > 0) {
            actions.push(`成员 ${mid} 有 ${inbox.length} 条未处理消息`);
          }
        }
      } else {
        errors.push('未找到团队运行时状态');
      }

      const inProgressTasks = this.taskBoard.getTasksByStatus(teamId, 'in_progress');
      if (inProgressTasks.length > 0) {
        for (const task of inProgressTasks) {
          this.taskBoard.updateStatus(teamId, task.id, 'pending', '恢复：重置为待处理');
        }
        actions.push(`将 ${inProgressTasks.length} 个进行中任务重置为待处理`);
        this.logger.info('recovery', `将 ${inProgressTasks.length} 个进行中任务重置为待处理`, { teamId });
      }

      this.memory.addEntry(teamId, {
        type: 'summary',
        source: 'recovery',
        content: `团队恢复完成: ${actions.join('; ')}`,
      });

      this.logger.info('recovery', `团队恢复完成: ${actions.length} 个操作`, { teamId });

      return { teamId, recovered: true, actions, errors };
    } catch (e: any) {
      const errMsg = e?.message ?? String(e);
      errors.push(errMsg);
      this.logger.error('recovery', `恢复失败: ${errMsg}`, { teamId });
      return { teamId, recovered: false, actions, errors };
    } finally {
      this.recoveryInProgress.update(s => {
        const newSet = new Set(s);
        newSet.delete(teamId);
        return newSet;
      });
    }
  }

  async cleanupTeam(teamId: string, options?: { force?: boolean; preserveMemory?: boolean }): Promise<CleanupResult> {
    const resourcesReleased: string[] = [];
    const errors: string[] = [];

    this.logger.info('recovery', '开始团队资源清理', { teamId });

    try {
      const state = this.runtime.getTeam(teamId);
      if (state && !options?.force && (state.status === 'running' || state.status === 'initializing')) {
        return {
          teamId,
          cleaned: false,
          resourcesReleased: [],
          errors: ['团队仍在运行中，使用 force=true 强制清理'],
        };
      }

      if (state) {
        this.runtime.updateStatus(teamId, 'cleaning-up', '开始资源清理');

        const memberIds = state.members.map(m => m.agentId);
        for (const mid of memberIds) {
          this.mailbox.clearInbox(teamId, mid);
          this.mailbox.clearOutbox(teamId, mid);
        }
        this.mailbox.clearTeamMailboxes(teamId);
        resourcesReleased.push('mailbox');
      }

      this.stageMachine.destroyMachine(teamId);
      resourcesReleased.push('stage-machine');

      this.taskBoard.clearTeamTasks(teamId);
      resourcesReleased.push('task-board');

      if (!options?.preserveMemory) {
        this.memory.clearTeamMemory(teamId);
        resourcesReleased.push('memory');
      } else {
        resourcesReleased.push('memory(preserved)');
      }

      this.logger.clearTeamLogs(teamId);
      resourcesReleased.push('logs');

      if (state) {
        this.runtime.updateStatus(teamId, 'closed', '资源清理完成');
        resourcesReleased.push('runtime');
      }

      return { teamId, cleaned: true, resourcesReleased, errors };
    } catch (e: any) {
      const errMsg = e?.message ?? String(e);
      errors.push(errMsg);
      this.logger.error('recovery', `清理失败: ${errMsg}`, { teamId });
      return { teamId, cleaned: false, resourcesReleased, errors };
    }
  }

  getRecoveryReport(teamId: string): string {
    const state = this.runtime.getTeam(teamId);
    const teamLogs = this.logger.getLogsByTeam(teamId);
    const errorCount = teamLogs.filter(l => l.level === 'error').length;
    const warningCount = teamLogs.filter(l => l.level === 'warn').length;
    const snapshot = this.memory.getSnapshot(teamId);

    const lines: string[] = [
      `**恢复状态报告** (${teamId})`,
      '',
      `运行时状态: ${state?.status ?? '不存在'}`,
      `错误数: ${errorCount}`,
      `警告数: ${warningCount}`,
      `快照可用: ${snapshot ? '是' : '否'}`,
      `恢复中: ${this.isRecovering(teamId) ? '是' : '否'}`,
    ];

    if (snapshot) {
      lines.push('', '**最近快照**:');
      lines.push(`- 时间: ${new Date(snapshot.snapshotAt).toLocaleString()}`);
      lines.push(`- 成员: ${snapshot.members.length}`);
      lines.push(`- 任务: ${snapshot.tasks.length}`);
      lines.push(`- 记忆: ${snapshot.memoryEntries.length} 条`);
    }

    return lines.join('\n');
  }
}
