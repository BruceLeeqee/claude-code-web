import { Injectable, computed, signal } from '@angular/core';
import { SessionLifecycleStatus, TaskLifecycleStatus, TeamLifecycleStatus } from '../../../../core/multi-agent/multi-agent.types';
import { CollaborationMode } from './mode-manager.service';

export interface CollaborationAgentVm {
  id: string;
  name: string;
  role: 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product';
  status: 'idle' | 'running' | 'busy' | 'error';
  load: number;
  skills: string[];
  teamRole?: 'affirmative' | 'negative' | 'judge';
  prompt?: string;
}

export interface CollaborationTeamVm {
  id: string;
  name: string;
  score: number;
  agents: Array<{
    id: string;
    name: string;
    role: 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product';
    status: 'idle' | 'running' | 'busy' | 'error';
    position: { x: number; y: number };
  }>;
}

export interface CollaborationTaskVm {
  id: string;
  title: string;
  description: string;
  assignedAgentId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];
  createdAt?: string;
  completedAt?: string;
}

export interface CollaborationStateSnapshot {
  activeTab: 'arena' | 'network' | 'cognitive';
  mode: CollaborationMode;
  modeLabel: string;
  modeDescription: string;
  modeStatus: string;
  collaborationSummary: {
    runningAgents: number;
    currentTasks: number;
    collaborationLevel: string;
    syncLatency: string;
  };
  orchestration: {
    planMode: string;
    assignedAgents: number;
    activeEdges: number;
    convergence: string;
  };
  runtime: {
    teamCount: number;
    agentCount: number;
    activeSessions: number;
    failedSessions: number;
    currentTasks?: number;
  };
  autoOrchestration: {
    entryStatus: string;
    recommendedMode: string;
    taskSplit: string;
    humanIntervention: string;
  };
  battleStage: {
    teams: CollaborationTeamVm[];
    currentTurn: string;
    round: number;
    status: 'playing' | 'paused' | 'finished';
  };
  tasks: CollaborationTaskVm[];
  agents: CollaborationAgentVm[];
  pageStatus: TeamLifecycleStatus | SessionLifecycleStatus | TaskLifecycleStatus;
}

@Injectable({ providedIn: 'root' })
export class CollaborationStateService {
  private readonly state = signal<CollaborationStateSnapshot>({
    activeTab: 'network',
    mode: 'battle',
    modeLabel: '对抗模式',
    modeDescription: '智能体之间的辩论和竞争',
    modeStatus: '已停止',
    collaborationSummary: {
      runningAgents: 0,
      currentTasks: 0,
      collaborationLevel: 'Low',
      syncLatency: '--',
    },
    orchestration: {
      planMode: '未启动',
      assignedAgents: 0,
      activeEdges: 0,
      convergence: '待确认',
    },
    runtime: {
      teamCount: 0,
      agentCount: 0,
      activeSessions: 0,
      failedSessions: 0,
      currentTasks: 0,
    },
    autoOrchestration: {
      entryStatus: '未启动',
      recommendedMode: '协作模式',
      taskSplit: '--',
      humanIntervention: '保留（裁决前）',
    },
    battleStage: {
      teams: [],
      currentTurn: '--',
      round: 0,
      status: 'paused',
    },
    tasks: [],
    agents: [],
    pageStatus: 'stopped',
  });

  readonly snapshot = this.state.asReadonly();
  readonly activeTab = computed(() => this.state().activeTab);
  readonly mode = computed(() => this.state().mode);
  readonly modeLabel = computed(() => this.state().modeLabel);
  readonly modeDescription = computed(() => this.state().modeDescription);
  readonly modeStatus = computed(() => this.state().modeStatus);
  readonly collaborationSummary = computed(() => this.state().collaborationSummary);
  readonly orchestration = computed(() => this.state().orchestration);
  readonly runtime = computed(() => this.state().runtime);
  readonly autoOrchestration = computed(() => this.state().autoOrchestration);
  readonly battleStage = computed(() => this.state().battleStage);
  readonly tasks = computed(() => this.state().tasks);
  readonly agents = computed(() => this.state().agents);

  setActiveTab(tab: CollaborationStateSnapshot['activeTab']): void {
    this.state.update(state => ({ ...state, activeTab: tab }));
  }

  updateMode(mode: CollaborationMode, label: string, description: string, status: string): void {
    this.state.update(state => ({ ...state, mode, modeLabel: label, modeDescription: description, modeStatus: status }));
  }

  updateRuntime(partial: Partial<CollaborationStateSnapshot['runtime']>): void {
    this.state.update(state => ({ ...state, runtime: { ...state.runtime, ...partial } }));
  }

  updateAgentStatus(agentId: string, status: CollaborationAgentVm['status'], load?: number): void {
    this.state.update(state => ({
      ...state,
      agents: state.agents.map(agent => (agent.id === agentId ? { ...agent, status, ...(load === undefined ? {} : { load }) } : agent)),
      battleStage: {
        ...state.battleStage,
        teams: state.battleStage.teams.map(team => ({
          ...team,
          agents: team.agents.map(agent => (agent.id === agentId ? { ...agent, status } : agent)),
        })),
      },
    }));
  }

  updateBattleState(partial: Partial<CollaborationStateSnapshot['battleStage']>): void {
    this.state.update(state => ({ ...state, battleStage: { ...state.battleStage, ...partial } }));
  }

  updateCollaborationSummary(partial: Partial<CollaborationStateSnapshot['collaborationSummary']>): void {
    this.state.update(state => ({ ...state, collaborationSummary: { ...state.collaborationSummary, ...partial } }));
  }

  updateOrchestration(partial: Partial<CollaborationStateSnapshot['orchestration']>): void {
    this.state.update(state => ({ ...state, orchestration: { ...state.orchestration, ...partial } }));
  }

  addAgent(agent: CollaborationAgentVm): void {
    this.state.update(state => ({
      ...state,
      agents: [...state.agents, agent],
      runtime: {
        ...state.runtime,
        agentCount: state.agents.length + 1,
      },
    }));
  }

  addTeam(team: CollaborationTeamVm): void {
    this.state.update(state => ({
      ...state,
      battleStage: {
        ...state.battleStage,
        teams: [...state.battleStage.teams, team],
      },
      runtime: {
        ...state.runtime,
        teamCount: state.battleStage.teams.length + 1,
      },
    }));
  }

  addTask(task: CollaborationTaskVm): void {
    this.state.update(state => ({
      ...state,
      tasks: [...state.tasks, task],
      runtime: {
        ...state.runtime,
        currentTasks: state.tasks.length + 1,
      },
    }));
  }

  updateTaskStatus(taskId: string, status: CollaborationTaskVm['status'], completedAt?: string): void {
    this.state.update(state => ({
      ...state,
      tasks: state.tasks.map(task => 
        task.id === taskId 
          ? { ...task, status, ...(completedAt ? { completedAt } : {}) } 
          : task
      ),
    }));
  }

  assignTask(taskId: string, agentId: string): void {
    this.state.update(state => ({
      ...state,
      tasks: state.tasks.map(task => 
        task.id === taskId 
          ? { ...task, assignedAgentId: agentId } 
          : task
      ),
    }));
  }

  updateAgent(agentId: string, updates: Partial<CollaborationAgentVm>): void {
    this.state.update(state => ({
      ...state,
      agents: state.agents.map(agent =>
        agent.id === agentId ? { ...agent, ...updates } : agent
      ),
    }));
  }

  removeAgent(agentId: string): void {
    this.state.update(state => ({
      ...state,
      agents: state.agents.filter(agent => agent.id !== agentId),
      runtime: {
        ...state.runtime,
        agentCount: Math.max(0, state.agents.length - 1),
      },
    }));
  }

  removeTask(taskId: string): void {
    this.state.update(state => ({
      ...state,
      tasks: state.tasks.filter(task => task.id !== taskId),
      runtime: {
        ...state.runtime,
        currentTasks: state.tasks.length - 1,
      },
    }));
  }

  resetCollaborationScene(mode: CollaborationMode = 'battle'): void {
    this.state.update(state => ({
      ...state,
      mode,
      modeLabel: '辩论对抗模式',
      modeDescription: '围绕辩题进行正反对抗与裁决',
      modeStatus: '已加载',
      collaborationSummary: {
        runningAgents: 0,
        currentTasks: 0,
        collaborationLevel: 'Low',
        syncLatency: '--',
      },
      orchestration: {
        planMode: '未启动',
        assignedAgents: 0,
        activeEdges: 0,
        convergence: '待确认',
      },
      runtime: {
        teamCount: 0,
        agentCount: 0,
        activeSessions: 0,
        failedSessions: 0,
        currentTasks: 0,
      },
      battleStage: {
        teams: [],
        currentTurn: '--',
        round: 0,
        status: 'paused',
      },
      tasks: [],
      agents: [],
    }));
  }
}
