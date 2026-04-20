import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import type {
  SessionContext,
  SessionSnapshot,
  SessionStatus,
  TaskGraph,
  TeamContext,
} from '../domain/types';
import { TaskPlannerService } from './task-planner.service';
import { AgentLifecycleManager } from './agent-lifecycle-manager.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface SessionCreateOptions {
  sessionName?: string;
  teamName: string;
  modelPolicyId?: string;
  backendPolicy?: 'auto' | 'in-process' | 'tmux' | 'iterm2';
  memoryScope?: 'isolated' | 'shared-with-team';
}

export interface SessionRestoreOptions {
  restoreAgents?: boolean;
  restoreTasks?: boolean;
  resumeExecution?: boolean;
}

interface SessionRegistryEntry {
  context: SessionContext;
  teamContext: TeamContext;
  taskGraph?: TaskGraph;
  snapshots: SessionSnapshot[];
  lastActiveAt: number;
}

const SESSION_STORAGE_KEY = 'zyfront:multi-agent:sessions';
const SNAPSHOT_STORAGE_KEY = 'zyfront:multi-agent:snapshots';

@Injectable({ providedIn: 'root' })
export class SessionRegistryService {
  private readonly registry = new Map<string, SessionRegistryEntry>();
  private readonly activeSessionId$ = new BehaviorSubject<string | null>(null);
  private readonly sessions$ = new BehaviorSubject<SessionContext[]>([]);

  constructor(
    private readonly planner: TaskPlannerService,
    private readonly lifecycleManager: AgentLifecycleManager,
    private readonly eventBus: MultiAgentEventBusService,
  ) {
    this.loadPersistedSessions();
  }

  create(options: SessionCreateOptions): SessionContext {
    const sessionId = `session-${uuidv4()}`;
    const teamId = `team-${uuidv4()}`;
    const now = Date.now();

    const teamContext: TeamContext = {
      teamId,
      teamName: options.teamName,
      status: 'forming',
      leaderAgentId: '',
      agentIds: [],
      sessionIds: [sessionId],
      createdAt: now,
      updatedAt: now,
    };

    const context: SessionContext = {
      sessionId,
      sessionName: options.sessionName || `Session ${this.registry.size + 1}`,
      status: 'created',
      teamId,
      teamName: options.teamName,
      planVersion: 0,
      agentIds: [],
      memoryScope: options.memoryScope || 'isolated',
      modelPolicyId: options.modelPolicyId || 'default',
      backendPolicy: options.backendPolicy || 'auto',
      createdAt: now,
      updatedAt: now,
    };

    const entry: SessionRegistryEntry = {
      context,
      teamContext,
      snapshots: [],
      lastActiveAt: now,
    };

    this.registry.set(sessionId, entry);
    this.updateSessionsSubject();
    this.persistSessions();

    this.eventBus.emit({
      type: EVENT_TYPES.SESSION_CREATED,
      sessionId,
      source: 'system',
      payload: {
        session: context,
        team: teamContext,
      },
    });

    return context;
  }

  get(sessionId: string): SessionContext | undefined {
    return this.registry.get(sessionId)?.context;
  }

  getTeamContext(sessionId: string): TeamContext | undefined {
    return this.registry.get(sessionId)?.teamContext;
  }

  getTaskGraph(sessionId: string): TaskGraph | undefined {
    return this.registry.get(sessionId)?.taskGraph;
  }

  getAll(): SessionContext[] {
    return Array.from(this.registry.values()).map(e => e.context);
  }

  getActive(): SessionContext | undefined {
    const activeId = this.activeSessionId$.value;
    return activeId ? this.registry.get(activeId)?.context : undefined;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId$.value;
  }

  getActiveSessionCount(): number {
    let count = 0;
    this.registry.forEach(entry => {
      if (entry.context.status === 'active') {
        count++;
      }
    });
    return count;
  }

  setActive(sessionId: string): void {
    const entry = this.registry.get(sessionId);
    if (!entry) return;

    this.activeSessionId$.next(sessionId);
    entry.lastActiveAt = Date.now();

    if (entry.context.status === 'created') {
      this.updateStatus(sessionId, 'active');
    }
  }

  pause(sessionId: string, reason: 'user' | 'resource' | 'error' = 'user'): string | undefined {
    const entry = this.registry.get(sessionId);
    if (!entry) return undefined;

    const snapshot = this.createSnapshot(sessionId);
    if (snapshot) {
      entry.snapshots.push(snapshot);
      this.persistSnapshot(snapshot);
    }

    this.updateStatus(sessionId, 'paused');

    this.eventBus.emit({
      type: EVENT_TYPES.SESSION_PAUSED,
      sessionId,
      source: 'system',
      payload: {
        sessionId,
        reason,
        snapshotId: snapshot?.snapshotId,
      },
    });

    return snapshot?.snapshotId;
  }

  resume(sessionId: string, options: SessionRestoreOptions = {}): SessionContext | undefined {
    const entry = this.registry.get(sessionId);
    if (!entry) return undefined;

    const snapshot = entry.snapshots[entry.snapshots.length - 1];
    const restoredFromSnapshot = !!snapshot;

    if (options.restoreAgents && snapshot) {
      this.restoreAgentsFromSnapshot(snapshot, options.resumeExecution || false);
    }

    if (options.restoreTasks && snapshot) {
      entry.taskGraph = snapshot.taskGraphSnapshot;
    }

    this.updateStatus(sessionId, 'active');
    this.setActive(sessionId);

    this.eventBus.emit({
      type: EVENT_TYPES.SESSION_RESUMED,
      sessionId,
      source: 'system',
      payload: {
        session: entry.context,
        restoredFromSnapshot,
        snapshotId: snapshot?.snapshotId,
      },
    });

    return entry.context;
  }

  close(sessionId: string, reason: 'user' | 'completed' | 'error' | 'timeout' = 'user'): void {
    const entry = this.registry.get(sessionId);
    if (!entry) return;

    const stats = this.calculateSessionStats(sessionId);

    this.eventBus.emit({
      type: EVENT_TYPES.SESSION_CLOSED,
      sessionId,
      source: 'system',
      payload: {
        sessionId,
        reason,
        finalStats: stats,
      },
    });

    entry.context.agentIds.forEach(agentId => {
      const state = this.lifecycleManager.getState(agentId);
      if (state && state.status !== 'stopped') {
        this.lifecycleManager.terminate(agentId, 'user');
      }
    });

    this.updateStatus(sessionId, 'closed');

    if (this.activeSessionId$.value === sessionId) {
      this.activeSessionId$.next(null);
    }

    this.persistSessions();
  }

  delete(sessionId: string): void {
    const entry = this.registry.get(sessionId);
    if (!entry) return;

    if (entry.context.status !== 'closed') {
      this.close(sessionId, 'user');
    }

    this.registry.delete(sessionId);
    this.updateSessionsSubject();
    this.persistSessions();
  }

  createSnapshot(sessionId: string): SessionSnapshot | undefined {
    const entry = this.registry.get(sessionId);
    if (!entry) return undefined;

    const agents = entry.context.agentIds
      .map(agentId => this.lifecycleManager.getState(agentId))
      .filter((state): state is NonNullable<typeof state> => state !== undefined);

    const snapshot: SessionSnapshot = {
      snapshotId: `snapshot-${uuidv4()}`,
      sessionId,
      capturedAt: Date.now(),
      taskGraphSnapshot: entry.taskGraph || this.createEmptyTaskGraph(sessionId),
      agentStates: agents,
      memoryReferences: [],
      pendingEvents: [],
    };

    entry.snapshots.push(snapshot);
    this.persistSnapshot(snapshot);

    this.eventBus.emit({
      type: EVENT_TYPES.SESSION_SNAPSHOT_CREATED,
      sessionId,
      source: 'system',
      payload: { snapshot },
    });

    return snapshot;
  }

  restoreFromSnapshot(
    sessionId: string,
    snapshotId: string,
    options: SessionRestoreOptions = {},
  ): SessionContext | undefined {
    const entry = this.registry.get(sessionId);
    if (!entry) return undefined;

    const snapshot = entry.snapshots.find(s => s.snapshotId === snapshotId);
    if (!snapshot) return undefined;

    if (options.restoreAgents) {
      this.restoreAgentsFromSnapshot(snapshot, options.resumeExecution || false);
    }

    if (options.restoreTasks) {
      entry.taskGraph = snapshot.taskGraphSnapshot;
    }

    this.updateStatus(sessionId, 'active');
    this.setActive(sessionId);

    this.eventBus.emit({
      type: EVENT_TYPES.SESSION_SNAPSHOT_RESTORED,
      sessionId,
      source: 'system',
      payload: {
        snapshot,
        restoredAgents: options.restoreAgents ? snapshot.agentStates.map(a => a.agentId) : [],
        restoredTasks: options.restoreTasks ? Object.keys(snapshot.taskGraphSnapshot.tasks) : [],
      },
    });

    return entry.context;
  }

  getSnapshots(sessionId: string): SessionSnapshot[] {
    return this.registry.get(sessionId)?.snapshots || [];
  }

  updateTaskGraph(sessionId: string, taskGraph: TaskGraph): void {
    const entry = this.registry.get(sessionId);
    if (!entry) return;

    entry.taskGraph = taskGraph;
    entry.context.planVersion = taskGraph.planVersion;
    entry.context.updatedAt = Date.now();
    this.persistSessions();
  }

  addAgent(sessionId: string, agentId: string): void {
    const entry = this.registry.get(sessionId);
    if (!entry) return;

    if (!entry.context.agentIds.includes(agentId)) {
      entry.context.agentIds.push(agentId);
      entry.teamContext.agentIds.push(agentId);
      entry.context.updatedAt = Date.now();
      this.persistSessions();
    }
  }

  removeAgent(sessionId: string, agentId: string): void {
    const entry = this.registry.get(sessionId);
    if (!entry) return;

    entry.context.agentIds = entry.context.agentIds.filter(id => id !== agentId);
    entry.teamContext.agentIds = entry.teamContext.agentIds.filter(id => id !== agentId);
    entry.context.updatedAt = Date.now();
    this.persistSessions();
  }

  get activeSessionId() {
    return this.activeSessionId$.asObservable();
  }

  get sessions() {
    return this.sessions$.asObservable();
  }

  private updateStatus(sessionId: string, status: SessionStatus): void {
    const entry = this.registry.get(sessionId);
    if (!entry) return;

    entry.context.status = status;
    entry.context.updatedAt = Date.now();
    this.updateSessionsSubject();
    this.persistSessions();
  }

  private updateSessionsSubject(): void {
    this.sessions$.next(this.getAll());
  }

  private createEmptyTaskGraph(sessionId: string): TaskGraph {
    return {
      graphId: `graph-${uuidv4()}`,
      sessionId,
      planVersion: 0,
      rootTaskIds: [],
      tasks: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'draft',
    };
  }

  private restoreAgentsFromSnapshot(snapshot: SessionSnapshot, resume: boolean): void {
    snapshot.agentStates.forEach(state => {
      const descriptor = this.lifecycleManager.getDescriptor(state.agentId);
      if (descriptor) {
        this.lifecycleManager.updateState(
          state.agentId,
          resume ? 'running' : 'idle',
          'restored-from-snapshot',
        );
      }
    });
  }

  private calculateSessionStats(sessionId: string): {
    totalTasks: number;
    completedTasks: number;
    totalTokens: number;
    totalCostUsd: number;
    durationMs: number;
  } {
    const entry = this.registry.get(sessionId);
    if (!entry) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        durationMs: 0,
      };
    }

    const tasks = entry.taskGraph ? Object.values(entry.taskGraph.tasks) : [];
    const completedTasks = tasks.filter(t => t.status === 'completed');

    let totalTokens = 0;
    entry.context.agentIds.forEach(agentId => {
      const state = this.lifecycleManager.getState(agentId);
      if (state) {
        totalTokens += state.totalTokensUsed;
      }
    });

    return {
      totalTasks: tasks.length,
      completedTasks: completedTasks.length,
      totalTokens,
      totalCostUsd: totalTokens * 0.00001,
      durationMs: Date.now() - entry.context.createdAt,
    };
  }

  private persistSessions(): void {
    try {
      const data = Array.from(this.registry.entries()).map(([sessionId, entry]) => ({
        sessionId,
        context: entry.context,
        teamContext: entry.teamContext,
        lastActiveAt: entry.lastActiveAt,
      }));

      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }

  private loadPersistedSessions(): void {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw) as Array<{
        sessionId: string;
        context: SessionContext;
        teamContext: TeamContext;
        lastActiveAt: number;
      }>;

      data.forEach(item => {
        const entry: SessionRegistryEntry = {
          context: item.context,
          teamContext: item.teamContext,
          snapshots: [],
          lastActiveAt: item.lastActiveAt,
        };

        this.registry.set(item.sessionId, entry);
      });

      this.updateSessionsSubject();
    } catch {
      // Ignore loading errors
    }
  }

  private persistSnapshot(snapshot: SessionSnapshot): void {
    try {
      const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
      const snapshots = raw ? JSON.parse(raw) : [];
      snapshots.push(snapshot);

      const limited = snapshots.slice(-50);
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(limited));
    } catch {
      // Ignore storage errors
    }
  }
}
