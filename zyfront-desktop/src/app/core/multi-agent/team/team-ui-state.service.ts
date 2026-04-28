import { Injectable, inject, signal, computed } from '@angular/core';
import type { TeamRuntimeState, RoleDefinition, StructDefinition } from './team.types';
import { TeamRuntimeService } from './team-runtime.service';
import { RoleRegistryService } from './role-registry.service';
import { StructRegistryService } from './struct-registry.service';
import { TeamStageMachineService } from './team-stage-machine.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface TeamUIState {
  activeTeam: TeamRuntimeState | null;
  teams: TeamRuntimeState[];
  roles: RoleDefinition[];
  structs: StructDefinition[];
  stageMachine: import('./team-stage-machine.service').StageMachineSnapshot | null;
  taskStats: { total: number; pending: number; inProgress: number; done: number; failed: number };
}

@Injectable({ providedIn: 'root' })
export class TeamUIStateService {
  private readonly runtime = inject(TeamRuntimeService);
  private readonly roleRegistry = inject(RoleRegistryService);
  private readonly structRegistry = inject(StructRegistryService);
  private readonly stageMachine = inject(TeamStageMachineService);
  private readonly taskBoard = inject(TeamTaskBoardService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly refreshTrigger = signal(0);

  readonly uiState = computed<TeamUIState>(() => {
    this.refreshTrigger();

    const activeTeam = this.runtime.getActiveTeam();
    const teams = this.runtime.listTeams();
    const roles = this.roleRegistry.roleList();
    const structs = this.structRegistry.structList();
    const teamId = activeTeam?.id;
    const machine = teamId ? this.stageMachine.getMachine(teamId) ?? null : null;

    let taskStats = { total: 0, pending: 0, inProgress: 0, done: 0, failed: 0 };
    if (teamId) {
      const allTasks = this.taskBoard.getTasksByTeam(teamId);
      taskStats = {
        total: allTasks.length,
        pending: allTasks.filter(t => t.status === 'pending').length,
        inProgress: allTasks.filter(t => t.status === 'in_progress').length,
        done: allTasks.filter(t => t.status === 'done').length,
        failed: allTasks.filter(t => t.status === 'rejected' || t.status === 'cancelled').length,
      };
    }

    return { activeTeam, teams, roles, structs, stageMachine: machine, taskStats };
  });

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const refreshEvents: string[] = [
      EVENT_TYPES.TEAM_RUNTIME_CREATED,
      EVENT_TYPES.TEAM_RUNTIME_STATUS_CHANGED,
      EVENT_TYPES.TEAM_RUNTIME_CLOSED,
      EVENT_TYPES.TEAM_RUNTIME_STAGE_CHANGED,
      EVENT_TYPES.TEAM_RUNTIME_COMPLETED,
      EVENT_TYPES.TEAM_RUNTIME_FAILED,
      EVENT_TYPES.TEAM_TASK_CREATED,
      EVENT_TYPES.TEAM_TASK_STATUS_CHANGED,
      EVENT_TYPES.TEAM_TASK_COMPLETED,
      EVENT_TYPES.TEAM_ROLE_CREATED,
      EVENT_TYPES.TEAM_STRUCT_CREATED,
    ];

    for (const eventType of refreshEvents) {
      this.eventBus.on(eventType as any, () => {
        this.refreshTrigger.update(v => v + 1);
      });
    }
  }

  async refresh(): Promise<void> {
    await this.roleRegistry.ensureInitialized();
    await this.structRegistry.ensureInitialized();
    this.refreshTrigger.update(v => v + 1);
  }
}
