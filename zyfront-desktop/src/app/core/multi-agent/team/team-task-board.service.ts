import { Injectable, signal, computed, inject } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { TeamTask, TeamTaskStatus, CommandResult } from './team.types';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import { LocalBridgeService } from '../../local-bridge.service';
import { TEAM_FILE_PATHS } from './team.types';

@Injectable({ providedIn: 'root' })
export class TeamTaskBoardService {
  private readonly tasksByTeam = signal<Map<string, Map<string, TeamTask>>>(new Map());
  private readonly bridge = inject(LocalBridgeService);
  private persistDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly allTasks = computed(() => {
    const result: TeamTask[] = [];
    this.tasksByTeam().forEach(teamTasks => {
      teamTasks.forEach(task => result.push(task));
    });
    return result;
  });

  readonly pendingTasks = computed(() => this.allTasks().filter(t => t.status === 'pending'));
  readonly inProgressTasks = computed(() => this.allTasks().filter(t => t.status === 'in_progress'));
  readonly completedTasks = computed(() => this.allTasks().filter(t => t.status === 'done'));
  readonly failedTasks = computed(() => this.allTasks().filter(t => t.status === 'rejected' || t.status === 'cancelled'));

  constructor(private readonly eventBus: MultiAgentEventBusService) {}

  private getTeamTasks(teamId: string): Map<string, TeamTask> {
    return this.tasksByTeam().get(teamId) || new Map();
  }

  private updateTeamTasks(teamId: string, updater: (map: Map<string, TeamTask>) => Map<string, TeamTask>): void {
    this.tasksByTeam.update(outer => {
      const newOuter = new Map(outer);
      const current = newOuter.get(teamId) || new Map();
      newOuter.set(teamId, updater(current));
      return newOuter;
    });
  }

  createTask(teamId: string, title: string, assignee: string, stageName?: string, dependencies: string[] = []): TeamTask {
    const task: TeamTask = {
      id: uuidv4(),
      title,
      assignee,
      status: 'pending',
      dependencies,
      stageName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.updateTeamTasks(teamId, map => {
      const newMap = new Map(map);
      newMap.set(task.id, task);
      return newMap;
    });

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_TASK_CREATED,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, task },
    });

    this.persistTeamTasks(teamId);

    return task;
  }

  assignTask(teamId: string, taskId: string, assignee: string): TeamTask | undefined {
    const teamTasks = this.getTeamTasks(teamId);
    const task = teamTasks.get(taskId);
    if (!task) return undefined;

    const updated: TeamTask = { ...task, assignee, updatedAt: Date.now() };
    this.updateTeamTasks(teamId, map => {
      const newMap = new Map(map);
      newMap.set(taskId, updated);
      return newMap;
    });

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_TASK_ASSIGNED,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, taskId, assignee },
    });

    this.persistTeamTasks(teamId);

    return updated;
  }

  updateStatus(teamId: string, taskId: string, newStatus: TeamTaskStatus, reason?: string): TeamTask | undefined {
    const teamTasks = this.getTeamTasks(teamId);
    const task = teamTasks.get(taskId);
    if (!task) return undefined;

    const previousStatus = task.status;
    const updated: TeamTask = { ...task, status: newStatus, updatedAt: Date.now() };
    this.updateTeamTasks(teamId, map => {
      const newMap = new Map(map);
      newMap.set(taskId, updated);
      return newMap;
    });

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_TASK_STATUS_CHANGED,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, taskId, previousStatus, newStatus, reason },
    });

    if (newStatus === 'done') {
      this.eventBus.emit({
        type: EVENT_TYPES.TEAM_TASK_COMPLETED,
        sessionId: teamId,
        source: 'system',
        payload: { teamId, taskId, outputs: updated.outputs },
      });
    }

    this.persistTeamTasks(teamId);

    return updated;
  }

  getTask(teamId: string, taskId: string): TeamTask | undefined {
    return this.getTeamTasks(teamId).get(taskId);
  }

  getTaskGlobal(taskId: string): TeamTask | undefined {
    for (const teamTasks of this.tasksByTeam().values()) {
      if (teamTasks.has(taskId)) return teamTasks.get(taskId);
    }
    return undefined;
  }

  getTasksByTeam(teamId: string): TeamTask[] {
    return [...this.getTeamTasks(teamId).values()];
  }

  getTasksByAssignee(teamId: string, assignee: string): TeamTask[] {
    return this.getTasksByTeam(teamId).filter(t => t.assignee === assignee);
  }

  getTasksByStage(teamId: string, stageName: string): TeamTask[] {
    return this.getTasksByTeam(teamId).filter(t => t.stageName === stageName);
  }

  getTasksByStatus(teamId: string, status: TeamTaskStatus): TeamTask[] {
    return this.getTasksByTeam(teamId).filter(t => t.status === status);
  }

  getBlockingTasks(teamId: string): TeamTask[] {
    return this.getTasksByTeam(teamId).filter(t => t.status === 'blocked' && t.blockers && t.blockers.length > 0);
  }

  canStart(teamId: string, taskId: string): boolean {
    const task = this.getTeamTasks(teamId).get(taskId);
    if (!task) return false;
    if (task.dependencies.length === 0) return true;
    return task.dependencies.every(depId => {
      const dep = this.getTeamTasks(teamId).get(depId);
      return dep?.status === 'done';
    });
  }

  completeTask(teamId: string, taskId: string, outputs?: string): TeamTask | undefined {
    return this.updateStatus(teamId, taskId, 'done', outputs ? `完成：${outputs}` : undefined);
  }

  failTask(teamId: string, taskId: string, error: string): TeamTask | undefined {
    const teamTasks = this.getTeamTasks(teamId);
    const task = teamTasks.get(taskId);
    if (!task) return undefined;

    const updated: TeamTask = {
      ...task,
      status: 'rejected',
      blockers: [...(task.blockers || []), error],
      updatedAt: Date.now(),
    };

    this.updateTeamTasks(teamId, map => {
      const newMap = new Map(map);
      newMap.set(taskId, updated);
      return newMap;
    });

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_TASK_STATUS_CHANGED,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, taskId, previousStatus: task.status, newStatus: 'rejected', reason: error },
    });

    this.persistTeamTasks(teamId);

    return updated;
  }

  clearTeamTasks(teamId: string): void {
    this.tasksByTeam.update(outer => {
      const newOuter = new Map(outer);
      newOuter.delete(teamId);
      return newOuter;
    });
  }

  clearAll(): void {
    this.tasksByTeam.set(new Map());
  }

  getProgress(teamId: string): { total: number; completed: number; failed: number; pending: number; inProgress: number } {
    const list = this.getTasksByTeam(teamId);
    return {
      total: list.length,
      completed: list.filter(t => t.status === 'done').length,
      failed: list.filter(t => t.status === 'rejected' || t.status === 'cancelled').length,
      pending: list.filter(t => t.status === 'pending').length,
      inProgress: list.filter(t => t.status === 'in_progress').length,
    };
  }

  taskList(teamId?: string): TeamTask[] {
    if (teamId) return this.getTasksByTeam(teamId);
    return this.allTasks();
  }

  private persistTeamTasks(teamId: string): void {
    const existing = this.persistDebounceTimers.get(teamId);
    if (existing) clearTimeout(existing);

    this.persistDebounceTimers.set(teamId, setTimeout(() => {
      this.persistDebounceTimers.delete(teamId);
      const tasks = this.getTasksByTeam(teamId);
      const filePath = `${TEAM_FILE_PATHS.tasks}/${teamId}/tasks.json`;
      const content = JSON.stringify(tasks, null, 2);
      this.bridge.write(filePath, content, 'vault').catch(e => {
        console.error('[TeamTaskBoard] Failed to persist tasks:', filePath, e);
      });
    }, 500));
  }

  async loadTeamTasks(teamId: string): Promise<void> {
    try {
      const filePath = `${TEAM_FILE_PATHS.tasks}/${teamId}/tasks.json`;
      const result = await this.bridge.read(filePath, 'vault');
      if (result.ok && typeof result.content === 'string') {
        const parsed = JSON.parse(result.content) as TeamTask[];
        this.tasksByTeam.update(outer => {
          const newOuter = new Map(outer);
          const teamMap = new Map<string, TeamTask>();
          for (const task of parsed) {
            teamMap.set(task.id, task);
          }
          newOuter.set(teamId, teamMap);
          return newOuter;
        });
      }
    } catch {
      // File doesn't exist yet, that's fine
    }
  }
}
