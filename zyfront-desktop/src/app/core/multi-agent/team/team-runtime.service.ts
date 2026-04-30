import { Injectable, inject, signal, computed, Injector } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { TeamRuntimeState, TeamRuntimeStatus, TeamMemberState, TeamLogEntry, TeamRunMode, TeamStageDefinition } from './team.types';
import { StructRegistryService } from './struct-registry.service';
import { RoleRegistryService } from './role-registry.service';
import { TeamMailboxService } from './team-mailbox.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { TeamStageMachineService } from './team-stage-machine.service';
import { TeamLoggerService } from './team-logger.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

@Injectable({ providedIn: 'root' })
export class TeamRuntimeService {
  private readonly injector = inject(Injector);
  private _stageMachine: TeamStageMachineService | null = null;
  private get stageMachine(): TeamStageMachineService {
    if (!this._stageMachine) {
      this._stageMachine = this.injector.get(TeamStageMachineService);
    }
    return this._stageMachine;
  }
  private readonly structRegistry = inject(StructRegistryService);
  private readonly roleRegistry = inject(RoleRegistryService);
  private readonly mailbox = inject(TeamMailboxService);
  private readonly taskBoard = inject(TeamTaskBoardService);
  private readonly eventBus = inject(MultiAgentEventBusService);
  private readonly persistence = inject(TeamFilePersistenceService);
  private readonly logger = inject(TeamLoggerService);

  private readonly runtimes = signal<Map<string, TeamRuntimeState>>(new Map());
  private readonly activeTeamId = signal<string | null>(null);

  readonly activeRuntime = computed(() => {
    const id = this.activeTeamId();
    return id ? this.runtimes().get(id) ?? null : null;
  });

  readonly allRuntimes = computed(() => [...this.runtimes().values()]);

  async restoreFromDisk(): Promise<number> {
    const fileRuntimes = await this.persistence.scanRuntimes();
    if (fileRuntimes.length === 0) return 0;

    const map = new Map(this.runtimes());
    fileRuntimes.forEach(rt => {
      if (rt.status !== 'closed' && rt.status !== 'cleaning-up') {
        map.set(rt.id, rt);
      }
    });
    this.runtimes.set(map);

    if (!this.activeTeamId() && map.size > 0) {
      const lastActive = fileRuntimes.find(rt => rt.status === 'running' || rt.status === 'paused');
      if (lastActive) {
        this.activeTeamId.set(lastActive.id);
      }
    }

    return fileRuntimes.length;
  }

  createTeam(structName: string, task: string, leadAgentId?: string): TeamRuntimeState {
    const struct = this.structRegistry.getByName(structName) || this.structRegistry.get(structName);
    if (!struct) {
      throw new Error(`协作结构 "${structName}" 不存在，请先使用 /team-struct new 创建`);
    }

    const teamId = `team-${uuidv4()}`;
    const now = Date.now();

    const members: TeamMemberState[] = struct.roles.map(roleName => ({
      agentId: `agent-${roleName}-${uuidv4().substring(0, 8)}`,
      roleName,
      status: 'joining' as const,
      unreadCount: 0,
      joinedAt: now,
    }));

    const firstStage = struct.stages[0];
    const runtime: TeamRuntimeState = {
      id: teamId,
      structName: struct.name,
      status: 'created',
      leadAgentId: leadAgentId || `lead-${teamId}`,
      members,
      tasks: [],
      messages: [],
      currentStageIndex: 0,
      currentStageName: firstStage?.name,
      logs: [{
        id: uuidv4(),
        timestamp: now,
        level: 'info',
        source: 'runtime',
        message: `团队创建：基于结构 "${struct.name}"，任务：${task}`,
      }],
      artifacts: [],
      allowedPaths: [],
      createdAt: now,
      updatedAt: now,
    };

    this.runtimes.update(map => {
      const newMap = new Map(map);
      newMap.set(teamId, runtime);
      return newMap;
    });

    this.activeTeamId.set(teamId);

    this.persistence.writeRuntime(runtime);

    const firstStageRoles = struct.stages[0]?.roles;
    if (Array.isArray(firstStageRoles)) {
      firstStageRoles.forEach(roleName => {
        const member = members.find(m => m.roleName === roleName);
        if (member) {
          this.updateMemberStatus(teamId, member.agentId, 'active');
        }
      });
    }

    if (Array.isArray(struct.roles)) {
      struct.roles.forEach(roleName => {
        this.taskBoard.createTask(teamId, `${roleName}: ${task}`, roleName, firstStage?.name);
      });
    }

    this.addLog(teamId, 'info', 'runtime', `初始化阶段：${firstStage?.name || '无阶段'}`);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_CREATED,
      sessionId: teamId,
      source: 'user',
      payload: { runtime, teamId, structName: runtime.structName },
    });

    this.updateStatus(teamId, 'initializing', '团队创建完成，开始初始化');

    return runtime;
  }

  updateStatus(teamId: string, newStatus: TeamRuntimeStatus, reason?: string): TeamRuntimeState | undefined {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return undefined;

    const previousStatus = runtime.status;
    const updated: TeamRuntimeState = {
      ...runtime,
      status: newStatus,
      updatedAt: Date.now(),
    };

    this.runtimes.update(map => {
      const newMap = new Map(map);
      newMap.set(teamId, updated);
      return newMap;
    });

    this.addLog(teamId, 'info', 'runtime', `状态变更：${previousStatus} → ${newStatus}${reason ? ` (${reason})` : ''}`);

    this.persistence.writeRuntime(updated);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_STATUS_CHANGED,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, previousStatus, newStatus, reason, structName: runtime.structName },
    });

    if (newStatus === 'completed') {
      this.handleCompletion(teamId);
    } else if (newStatus === 'failed') {
      this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_FAILED,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, error: reason || 'Unknown error', structName: runtime.structName },
    });
    }

    return updated;
  }

  advanceStage(teamId: string): TeamRuntimeState | undefined {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return undefined;

    const struct = this.structRegistry.getByName(runtime.structName);
    if (!struct) return undefined;

    const nextIndex = runtime.currentStageIndex + 1;
    if (nextIndex >= struct.stages.length) {
      this.updateStatus(teamId, 'completed', '所有阶段已完成');
      return this.runtimes().get(teamId);
    }

    const previousIndex = runtime.currentStageIndex;
    const nextStage = struct.stages[nextIndex];

    const updated: TeamRuntimeState = {
      ...runtime,
      currentStageIndex: nextIndex,
      currentStageName: nextStage.name,
      updatedAt: Date.now(),
    };

    this.runtimes.update(map => {
      const newMap = new Map(map);
      newMap.set(teamId, updated);
      return newMap;
    });

    if (Array.isArray(nextStage.roles)) {
      nextStage.roles.forEach(roleName => {
        const member = updated.members.find(m => m.roleName === roleName);
        if (member && member.status !== 'active') {
          this.updateMemberStatus(teamId, member.agentId, 'active');
        }
      });
    }

    this.addLog(teamId, 'info', 'runtime', `阶段切换：${struct.stages[previousIndex].name} → ${nextStage.name}`);

    this.persistence.writeRuntime(updated);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_STAGE_CHANGED,
      sessionId: teamId,
      source: 'system',
      payload: {
        teamId,
        previousStageIndex: previousIndex,
        newStageIndex: nextIndex,
        stageName: nextStage.name,
        stageMode: nextStage.mode,
        structName: runtime.structName,
      },
    });

    return this.runtimes().get(teamId);
  }

  addMember(teamId: string, roleName: string, agentId?: string): TeamMemberState | undefined {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return undefined;

    const member: TeamMemberState = {
      agentId: agentId || `agent-${roleName}-${uuidv4().substring(0, 8)}`,
      roleName,
      status: 'joining',
      unreadCount: 0,
      joinedAt: Date.now(),
    };

    const updated: TeamRuntimeState = {
      ...runtime,
      members: [...runtime.members, member],
      updatedAt: Date.now(),
    };

    this.runtimes.update(map => {
      const newMap = new Map(map);
      newMap.set(teamId, updated);
      return newMap;
    });

    this.persistence.writeRuntime(updated);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_MEMBER_JOINED,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, agentId: member.agentId, roleName, structName: runtime.structName },
    });

    this.updateMemberStatus(teamId, member.agentId, 'active');

    return member;
  }

  removeMember(teamId: string, agentId: string, reason?: string): boolean {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return false;

    const member = runtime.members.find(m => m.agentId === agentId);
    if (!member) return false;

    this.updateMemberStatus(teamId, agentId, 'leaving');

    const updated: TeamRuntimeState = {
      ...runtime,
      members: runtime.members.map(m =>
        m.agentId === agentId ? { ...m, status: 'left' as const } : m
      ),
      updatedAt: Date.now(),
    };

    this.runtimes.update(map => {
      const newMap = new Map(map);
      newMap.set(teamId, updated);
      return newMap;
    });

    this.persistence.writeRuntime(updated);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_MEMBER_LEFT,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, agentId, roleName: member.roleName, reason, structName: runtime.structName },
    });

    return true;
  }

  closeTeam(teamId: string): string[] {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return [];
    if (runtime.status === 'closed') return [];

    const cleanedUp: string[] = [];

    runtime.members.forEach(m => {
      this.mailbox.clearInbox(teamId, m.agentId);
      this.mailbox.clearOutbox(teamId, m.agentId);
      cleanedUp.push(`mailbox:${m.agentId}`);
    });

    this.mailbox.clearTeamMailboxes(teamId);
    cleanedUp.push('mailbox-team');

    this.stageMachine.destroyMachine(teamId);
    cleanedUp.push('stage-machine');

    this.taskBoard.clearTeamTasks(teamId);
    cleanedUp.push('task-board');

    this.logger.clearTeamLogs(teamId);
    cleanedUp.push('logs');

    this.updateStatus(teamId, 'closed', '团队关闭，资源已清理');

    if (this.activeTeamId() === teamId) {
      this.activeTeamId.set(null);
    }

    this.persistence.deleteRuntime(teamId);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_CLOSED,
      sessionId: teamId,
      source: 'system',
      payload: { teamId, cleanedUp, structName: runtime.structName },
    });

    return cleanedUp;
  }

  getTeam(teamId: string): TeamRuntimeState | undefined {
    return this.runtimes().get(teamId);
  }

  getActiveTeam(): TeamRuntimeState | null {
    return this.activeRuntime();
  }

  setActiveTeam(teamId: string): boolean {
    if (!this.runtimes().has(teamId)) return false;
    this.activeTeamId.set(teamId);
    return true;
  }

  listTeams(): TeamRuntimeState[] {
    return this.allRuntimes();
  }

  getCurrentStageMode(teamId: string): TeamRunMode | undefined {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return undefined;

    const struct = this.structRegistry.getByName(runtime.structName);
    if (!struct) return undefined;

    return struct.stages[runtime.currentStageIndex]?.mode;
  }

  getCurrentStage(teamId: string): TeamStageDefinition | undefined {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return undefined;

    const struct = this.structRegistry.getByName(runtime.structName);
    if (!struct) return undefined;

    return struct.stages[runtime.currentStageIndex];
  }

  persistRuntime(teamId: string): void {
    const runtime = this.runtimes().get(teamId);
    if (runtime) {
      this.persistence.writeRuntime(runtime);
    }
  }

  private updateMemberStatus(teamId: string, agentId: string, status: TeamMemberState['status']): void {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return;

    const updated: TeamRuntimeState = {
      ...runtime,
      members: runtime.members.map(m =>
        m.agentId === agentId ? { ...m, status } : m
      ),
      updatedAt: Date.now(),
    };

    this.runtimes.update(map => {
      const newMap = new Map(map);
      newMap.set(teamId, updated);
      return newMap;
    });
  }

  private addLog(teamId: string, level: TeamLogEntry['level'], source: string, message: string, details?: Record<string, unknown>): void {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return;

    const entry: TeamLogEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      level,
      source,
      message,
      details,
    };

    const updated: TeamRuntimeState = {
      ...runtime,
      logs: [...runtime.logs, entry],
      updatedAt: Date.now(),
    };

    this.runtimes.update(map => {
      const newMap = new Map(map);
      newMap.set(teamId, updated);
      return newMap;
    });
  }

  private handleCompletion(teamId: string): void {
    const runtime = this.runtimes().get(teamId);
    if (!runtime) return;

    const durationMs = Date.now() - runtime.createdAt;
    const progress = this.taskBoard.getProgress(teamId);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_RUNTIME_COMPLETED,
      sessionId: teamId,
      source: 'system',
      payload: {
        teamId,
        finalStatus: runtime.status,
        durationMs,
        completedTasks: progress.completed,
        failedTasks: progress.failed,
        structName: runtime.structName,
      },
    });
  }
}
