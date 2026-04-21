import { Injectable, signal, computed, inject } from '@angular/core';
import { MultiAgentOrchestratorService } from '../multi-agent.orchestrator.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import type { AgentRole, AgentDescriptor, AgentRuntimeState } from '../domain/types';

export type WorkbenchMode = 'solo' | 'plan' | 'dev';

export interface DevTeamConfig {
  architect: AgentDescriptor;
  frontend: AgentDescriptor;
  backend: AgentDescriptor;
  tester: AgentDescriptor;
}

export interface ModeState {
  current: WorkbenchMode;
  previousMode: WorkbenchMode | null;
  switchedAt: number;
  reason: string;
  devTeam?: DevTeamConfig;
  planDocument?: string;
}

const DEV_TEAM_ROLES: Array<{ role: AgentRole; name: string; description: string; isCoordinator?: boolean }> = [
  { role: 'planner', name: '架构师', description: '负责系统架构设计、技术决策和任务协调', isCoordinator: true },
  { role: 'executor', name: '前端开发', description: '负责前端界面和交互实现' },
  { role: 'executor', name: '后端开发', description: '负责后端服务和API实现' },
  { role: 'validator', name: '测试工程师', description: '负责测试用例和质量验证' },
];

const MODE_DESCRIPTIONS: Record<WorkbenchMode, { name: string; desc: string }> = {
  solo: {
    name: '单智能体模式',
    desc: '默认模式，单个智能体负责日常任务执行',
  },
  plan: {
    name: '计划模式',
    desc: '根据用户提示词生成详细计划文档，不执行实际操作',
  },
  dev: {
    name: '开发者模式',
    desc: '实例化开发团队（架构师、前端、后端、测试），采用主从多智能体协作',
  },
};

@Injectable({ providedIn: 'root' })
export class WorkbenchModeService {
  private readonly orchestrator = inject(MultiAgentOrchestratorService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly state = signal<ModeState>({
    current: 'solo',
    previousMode: null,
    switchedAt: Date.now(),
    reason: '初始化',
  });

  readonly currentMode = computed(() => this.state().current);
  readonly modeState = computed(() => this.state());
  readonly modeInfo = computed(() => MODE_DESCRIPTIONS[this.state().current]);
  readonly isSoloMode = computed(() => this.state().current === 'solo');
  readonly isPlanMode = computed(() => this.state().current === 'plan');
  readonly isDevMode = computed(() => this.state().current === 'dev');
  readonly devTeam = computed(() => this.state().devTeam);

  getModeDescriptions(): Record<WorkbenchMode, { name: string; desc: string }> {
    return MODE_DESCRIPTIONS;
  }

  switchMode(newMode: WorkbenchMode, reason: string = '用户切换'): boolean {
    const current = this.state().current;
    if (current === newMode) {
      return false;
    }

    if (current === 'dev' && this.state().devTeam) {
      this.cleanupDevTeam();
    }

    const now = Date.now();
    this.state.update(s => ({
      ...s,
      previousMode: s.current,
      current: newMode,
      switchedAt: now,
      reason,
      devTeam: undefined,
      planDocument: undefined,
    }));

    this.eventBus.emit({
      type: EVENT_TYPES.MODE_SINGLE,
      sessionId: 'workbench-mode',
      source: 'system',
      ts: now,
      payload: {
        mode: newMode,
        reason,
        previousMode: current,
        timestamp: now,
      },
    } as any);

    return true;
  }

  async initializeDevTeam(): Promise<DevTeamConfig> {
    if (this.state().current !== 'dev') {
      throw new Error('只能在开发者模式下初始化开发团队');
    }

    const timestamp = Date.now();
    const teamId = `dev-team-${timestamp}`;
    const sessionId = `dev-session-${timestamp}`;

    const devTeam: DevTeamConfig = {
      architect: this.createAgentDescriptor('planner', '架构师', teamId, sessionId, timestamp),
      frontend: this.createAgentDescriptor('executor', '前端开发', teamId, sessionId, timestamp + 1),
      backend: this.createAgentDescriptor('executor', '后端开发', teamId, sessionId, timestamp + 2),
      tester: this.createAgentDescriptor('validator', '测试工程师', teamId, sessionId, timestamp + 3),
    };

    this.state.update(s => ({
      ...s,
      devTeam,
    }));

    Object.values(devTeam).forEach(descriptor => {
      this.eventBus.emit({
        type: EVENT_TYPES.AGENT_CREATED,
        sessionId,
        source: 'planner',
        ts: Date.now(),
        payload: {
          descriptor,
          runtimeState: this.createInitialRuntimeState(descriptor.agentId),
        },
      } as any);
    });

    return devTeam;
  }

  setPlanDocument(document: string): void {
    this.state.update(s => ({
      ...s,
      planDocument: document,
    }));
  }

  private createAgentDescriptor(
    role: AgentRole,
    name: string,
    teamId: string,
    sessionId: string,
    timestamp: number,
  ): AgentDescriptor {
    return {
      agentId: `agent-${role}-${timestamp}`,
      agentName: name,
      role,
      teamId,
      sessionId,
      modelId: 'default',
      backendType: 'in-process',
      permissions: ['read', 'write', 'execute'],
      createdAt: timestamp,
      createdBy: 'planner',
      lifetimePolicy: 'task-bound',
    };
  }

  private createInitialRuntimeState(agentId: string): AgentRuntimeState {
    return {
      agentId,
      status: 'idle',
      lastSeenAt: Date.now(),
      heartbeatInterval: 30000,
      activeTaskIds: [],
      recoveryAttempts: 0,
      totalMessagesProcessed: 0,
      totalTokensUsed: 0,
      startedAt: Date.now(),
      lastStateChangeAt: Date.now(),
    };
  }

  private cleanupDevTeam(): void {
    const devTeam = this.state().devTeam;
    if (!devTeam) return;

    Object.values(devTeam).forEach(descriptor => {
      this.eventBus.emit({
        type: EVENT_TYPES.AGENT_STOPPED,
        sessionId: descriptor.sessionId,
        source: 'system',
        ts: Date.now(),
        payload: {
          agentId: descriptor.agentId,
          previousStatus: 'idle',
          newStatus: 'stopped',
        },
      } as any);
    });
  }
}
