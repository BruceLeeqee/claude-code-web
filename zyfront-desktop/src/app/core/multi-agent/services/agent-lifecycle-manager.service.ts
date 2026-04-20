import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import type {
  AgentDescriptor,
  AgentLifecycleStatus,
  AgentRuntimeState,
  RecoveryAction,
} from '../domain/types';
import { AgentFactoryService } from './agent-factory.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { MultiAgentOrchestratorService } from '../multi-agent.orchestrator.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface LifecycleTransition {
  agentId: string;
  from: AgentLifecycleStatus;
  to: AgentLifecycleStatus;
  reason?: string;
  timestamp: number;
}

export interface HeartbeatConfig {
  intervalMs: number;
  timeoutMs: number;
  maxMissedHeartbeats: number;
}

export interface RecyclePolicy {
  idleTimeoutMs: number;
  taskCompleteDelayMs: number;
  maxLifetimeMs: number;
  preserveOnFailure: boolean;
}

interface AgentRegistryEntry {
  descriptor: AgentDescriptor;
  runtimeState: AgentRuntimeState;
  lastHeartbeat: number;
  missedHeartbeats: number;
}

@Injectable({ providedIn: 'root' })
export class AgentLifecycleManager implements OnDestroy {
  private readonly registry = new Map<string, AgentRegistryEntry>();
  private readonly stateSubjects = new Map<string, BehaviorSubject<AgentRuntimeState>>();
  private readonly transitions: LifecycleTransition[] = [];

  private readonly heartbeatConfig: HeartbeatConfig = {
    intervalMs: 30000,
    timeoutMs: 60000,
    maxMissedHeartbeats: 3,
  };

  private readonly recyclePolicy: RecyclePolicy = {
    idleTimeoutMs: 5 * 60 * 1000,
    taskCompleteDelayMs: 30000,
    maxLifetimeMs: 8 * 60 * 60 * 1000,
    preserveOnFailure: true,
  };

  private heartbeatSubscription?: Subscription;

  constructor(
    private readonly factory: AgentFactoryService,
    private readonly eventBus: MultiAgentEventBusService,
    private readonly orchestrator: MultiAgentOrchestratorService,
  ) {
    this.startHeartbeatMonitor();
  }

  ngOnDestroy(): void {
    this.heartbeatSubscription?.unsubscribe();
  }

  register(descriptor: AgentDescriptor, runtimeState: AgentRuntimeState): void {
    const entry: AgentRegistryEntry = {
      descriptor,
      runtimeState: { ...runtimeState },
      lastHeartbeat: Date.now(),
      missedHeartbeats: 0,
    };

    this.registry.set(descriptor.agentId, entry);
    this.stateSubjects.set(
      descriptor.agentId,
      new BehaviorSubject(runtimeState),
    );

    this.recordTransition(descriptor.agentId, 'draft', 'initializing', 'registered');
  }

  unregister(agentId: string): void {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    this.registry.delete(agentId);
    this.stateSubjects.get(agentId)?.complete();
    this.stateSubjects.delete(agentId);
  }

  updateState(
    agentId: string,
    newStatus: AgentLifecycleStatus,
    reason?: string,
  ): void {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    const previousStatus = entry.runtimeState.status;
    entry.runtimeState.status = newStatus;
    entry.runtimeState.lastStateChangeAt = Date.now();

    if (newStatus === 'running' || newStatus === 'idle') {
      entry.lastHeartbeat = Date.now();
      entry.missedHeartbeats = 0;
    }

    this.recordTransition(agentId, previousStatus, newStatus, reason);
    this.stateSubjects.get(agentId)?.next(entry.runtimeState);

    this.emitStateEvent(agentId, previousStatus, newStatus, reason);
  }

  recordHeartbeat(agentId: string): void {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    entry.lastHeartbeat = Date.now();
    entry.missedHeartbeats = 0;

    if (entry.runtimeState.status === 'reconnecting') {
      this.updateState(agentId, 'running', 'heartbeat-recovered');
    }
  }

  assignTask(agentId: string, taskId: string): void {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    if (!entry.runtimeState.activeTaskIds.includes(taskId)) {
      entry.runtimeState.activeTaskIds.push(taskId);
    }

    if (entry.runtimeState.status === 'idle') {
      this.updateState(agentId, 'running', 'task-assigned');
    }
  }

  completeTask(agentId: string, taskId: string): void {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    entry.runtimeState.activeTaskIds = entry.runtimeState.activeTaskIds.filter(
      id => id !== taskId,
    );

    if (entry.runtimeState.activeTaskIds.length === 0) {
      this.updateState(agentId, 'idle', 'all-tasks-completed');

      if (entry.descriptor.lifetimePolicy === 'task-bound') {
        this.scheduleRecycle(agentId, this.recyclePolicy.taskCompleteDelayMs, 'task-complete');
      }
    }
  }

  blockAgent(agentId: string, reason: string): void {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    entry.runtimeState.blockedReason = reason;
    this.updateState(agentId, 'blocked', reason);
  }

  unblockAgent(agentId: string): void {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    entry.runtimeState.blockedReason = undefined;
    this.updateState(agentId, 'running', 'unblocked');
  }

  async stop(agentId: string, reason?: string): Promise<void> {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    this.updateState(agentId, 'stopping', reason);

    try {
      await this.orchestrator.stopTeammate(agentId, reason);
      this.updateState(agentId, 'stopped', reason);
    } catch (error) {
      this.updateState(agentId, 'failed', error instanceof Error ? error.message : 'stop-failed');
      throw error;
    }
  }

  async kill(agentId: string, reason?: string): Promise<void> {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    this.updateState(agentId, 'stopping', reason || 'force-kill');

    try {
      await this.orchestrator.killTeammate(agentId, reason);
      this.updateState(agentId, 'stopped', reason || 'force-kill');
    } catch (error) {
      this.updateState(agentId, 'failed', error instanceof Error ? error.message : 'kill-failed');
      throw error;
    }
  }

  async terminate(agentId: string, reason: AgentTerminationReason): Promise<void> {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    const finalStats = {
      tasksCompleted: entry.runtimeState.activeTaskIds.length,
      messagesProcessed: entry.runtimeState.totalMessagesProcessed,
      tokensUsed: entry.runtimeState.totalTokensUsed,
      durationMs: Date.now() - entry.runtimeState.startedAt,
    };

    const graceful = reason !== 'error' && reason !== 'replaced';

    if (graceful) {
      await this.stop(agentId, reason);
    } else {
      await this.kill(agentId, reason);
    }

    this.eventBus.emit({
      type: EVENT_TYPES.AGENT_TERMINATED,
      sessionId: entry.descriptor.sessionId,
      source: 'system',
      payload: {
        agentId,
        reason,
        graceful,
        finalStats,
      },
    });

    this.unregister(agentId);
  }

  async archive(agentId: string): Promise<void> {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    this.updateState(agentId, 'archived', 'manual-archive');
    this.unregister(agentId);
  }

  async recover(agentId: string): Promise<RecoveryAction> {
    const entry = this.registry.get(agentId);
    if (!entry) {
      throw new Error(`Agent ${agentId} not found in registry`);
    }

    const action: RecoveryAction = {
      actionId: `recovery-${Date.now()}`,
      targetType: 'agent',
      targetId: agentId,
      actionType: 'restart',
      reason: entry.runtimeState.errorMessage || 'recovery-requested',
      status: 'in-progress',
      createdAt: Date.now(),
    };

    entry.runtimeState.recoveryAttempts += 1;

    this.eventBus.emit({
      type: EVENT_TYPES.RECOVERY_INITIATED,
      sessionId: entry.descriptor.sessionId,
      source: 'recovery',
      payload: { action },
    });

    try {
      const previousStatus = entry.runtimeState.status;

      const result = await this.factory.create({
        sessionContext: {
          sessionId: entry.descriptor.sessionId,
          sessionName: '',
          status: 'active',
          teamId: entry.descriptor.teamId,
          teamName: '',
          planVersion: 0,
          agentIds: [],
          memoryScope: 'isolated',
          modelPolicyId: '',
          backendPolicy: 'auto',
          createdAt: 0,
          updatedAt: 0,
        },
        modelId: entry.descriptor.modelId,
        backendType: entry.descriptor.backendType,
        createdBy: 'recovery',
      });

      this.updateState(agentId, 'running', 'recovery-successful');
      action.status = 'completed';
      action.executedAt = Date.now();
      action.result = 'Agent recovered successfully';

      this.eventBus.emit({
        type: EVENT_TYPES.AGENT_RECOVERED,
        sessionId: entry.descriptor.sessionId,
        source: 'recovery',
        payload: {
          agentId,
          recoveryAction: action,
          previousStatus,
        },
      });

      this.eventBus.emit({
        type: EVENT_TYPES.RECOVERY_COMPLETED,
        sessionId: entry.descriptor.sessionId,
        source: 'recovery',
        payload: { action, success: true },
      });

      return action;
    } catch (error) {
      action.status = 'failed';
      action.executedAt = Date.now();
      action.result = error instanceof Error ? error.message : 'Recovery failed';

      this.updateState(agentId, 'failed', action.result);

      this.eventBus.emit({
        type: EVENT_TYPES.RECOVERY_COMPLETED,
        sessionId: entry.descriptor.sessionId,
        source: 'recovery',
        payload: { action, success: false, result: action.result },
      });

      return action;
    }
  }

  getState(agentId: string): AgentRuntimeState | undefined {
    return this.registry.get(agentId)?.runtimeState;
  }

  getState$(agentId: string) {
    return this.stateSubjects.get(agentId)?.asObservable();
  }

  getDescriptor(agentId: string): AgentDescriptor | undefined {
    return this.registry.get(agentId)?.descriptor;
  }

  getAllAgents(): Array<{ descriptor: AgentDescriptor; state: AgentRuntimeState }> {
    return Array.from(this.registry.values()).map(entry => ({
      descriptor: entry.descriptor,
      state: entry.runtimeState,
    }));
  }

  getAgentsByStatus(status: AgentLifecycleStatus): string[] {
    return Array.from(this.registry.entries())
      .filter(([_, entry]) => entry.runtimeState.status === status)
      .map(([agentId]) => agentId);
  }

  getTransitions(agentId?: string): LifecycleTransition[] {
    if (agentId) {
      return this.transitions.filter(t => t.agentId === agentId);
    }
    return [...this.transitions];
  }

  private startHeartbeatMonitor(): void {
    this.heartbeatSubscription = interval(this.heartbeatConfig.intervalMs).subscribe(() => {
      this.checkHeartbeats();
      this.checkIdleTimeouts();
      this.checkMaxLifetimes();
    });
  }

  private checkHeartbeats(): void {
    const now = Date.now();

    this.registry.forEach((entry, agentId) => {
      if (entry.runtimeState.status === 'stopped' || entry.runtimeState.status === 'archived') {
        return;
      }

      const timeSinceLastHeartbeat = now - entry.lastHeartbeat;

      if (timeSinceLastHeartbeat > this.heartbeatConfig.timeoutMs) {
        entry.missedHeartbeats += 1;

        if (entry.missedHeartbeats >= this.heartbeatConfig.maxMissedHeartbeats) {
          if (entry.runtimeState.status !== 'reconnecting') {
            this.updateState(agentId, 'reconnecting', 'heartbeat-timeout');
          }
        }
      }
    });
  }

  private checkIdleTimeouts(): void {
    const now = Date.now();

    this.registry.forEach((entry, agentId) => {
      if (entry.runtimeState.status !== 'idle') return;
      if (entry.descriptor.lifetimePolicy !== 'idle-timeout') return;
      if (!entry.descriptor.maxIdleMs) return;

      const idleDuration = now - entry.runtimeState.lastStateChangeAt;

      if (idleDuration >= entry.descriptor.maxIdleMs) {
        this.terminate(agentId, 'idle-timeout');
      }
    });
  }

  private checkMaxLifetimes(): void {
    const now = Date.now();

    this.registry.forEach((entry, agentId) => {
      const lifetime = now - entry.runtimeState.startedAt;

      if (lifetime >= this.recyclePolicy.maxLifetimeMs) {
        if (entry.runtimeState.status === 'idle') {
          this.terminate(agentId, 'max-lifetime');
        }
      }
    });
  }

  private scheduleRecycle(agentId: string, delayMs: number, reason: string): void {
    setTimeout(() => {
      const entry = this.registry.get(agentId);
      if (!entry) return;

      if (entry.runtimeState.status === 'idle' && entry.runtimeState.activeTaskIds.length === 0) {
        this.terminate(agentId, reason as AgentTerminationReason);
      }
    }, delayMs);
  }

  private recordTransition(
    agentId: string,
    from: AgentLifecycleStatus,
    to: AgentLifecycleStatus,
    reason?: string,
  ): void {
    this.transitions.push({
      agentId,
      from,
      to,
      reason,
      timestamp: Date.now(),
    });

    if (this.transitions.length > 1000) {
      this.transitions.splice(0, 100);
    }
  }

  private emitStateEvent(
    agentId: string,
    previousStatus: AgentLifecycleStatus,
    newStatus: AgentLifecycleStatus,
    reason?: string,
  ): void {
    const entry = this.registry.get(agentId);
    if (!entry) return;

    const eventType = this.getEventTypeForStatus(newStatus);

    if (eventType) {
      this.eventBus.emit({
        type: eventType,
        sessionId: entry.descriptor.sessionId,
        source: 'system',
        payload: {
          agentId,
          previousStatus,
          newStatus,
          reason,
        },
      });
    }
  }

  private getEventTypeForStatus(status: AgentLifecycleStatus): keyof import('../multi-agent.events').MultiAgentEventMap | null {
    const mapping: Record<AgentLifecycleStatus, keyof import('../multi-agent.events').MultiAgentEventMap> = {
      draft: EVENT_TYPES.AGENT_CREATED,
      initializing: EVENT_TYPES.AGENT_INITIALIZING,
      running: EVENT_TYPES.AGENT_STARTED,
      idle: EVENT_TYPES.AGENT_IDLE,
      waiting: EVENT_TYPES.AGENT_WAITING,
      blocked: EVENT_TYPES.AGENT_BLOCKED,
      reconnecting: EVENT_TYPES.AGENT_RECONNECTING,
      background: EVENT_TYPES.AGENT_BACKGROUND,
      stopping: EVENT_TYPES.AGENT_STOPPING,
      stopped: EVENT_TYPES.AGENT_STOPPED,
      failed: EVENT_TYPES.AGENT_FAILED,
      archived: EVENT_TYPES.AGENT_ARCHIVED,
    };

    return mapping[status] || null;
  }
}

export type AgentTerminationReason =
  | 'task-complete'
  | 'idle-timeout'
  | 'user'
  | 'error'
  | 'replaced'
  | 'max-lifetime';
