import { Injectable, inject, signal, computed } from '@angular/core';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES, type MultiAgentEventType } from '../multi-agent.events';

export type AgentState =
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'waiting'
  | 'recovering'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  reason: string;
  timestamp: number;
}

export interface AgentStateMachineConfig {
  agentId: string;
  initialState?: AgentState;
  maxRecoveryAttempts?: number;
  heartbeatIntervalMs?: number;
  idleTimeoutMs?: number;
}

const STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  initializing: ['ready', 'failed'],
  ready: ['busy', 'stopping', 'failed'],
  busy: ['ready', 'waiting', 'failed'],
  waiting: ['busy', 'ready', 'stopping'],
  recovering: ['ready', 'failed'],
  stopping: ['stopped'],
  stopped: [],
  failed: ['recovering', 'stopping'],
};

@Injectable({ providedIn: 'root' })
export class AgentStateMachineService {
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly agentStates = signal<Map<string, AgentState>>(new Map());
  private readonly transitionHistory = signal<Map<string, StateTransition[]>>(new Map());
  private readonly recoveryAttempts = signal<Map<string, number>>(new Map());
  private readonly lastHeartbeat = signal<Map<string, number>>(new Map());

  readonly states = this.agentStates;
  readonly history = this.transitionHistory;

  initialize(config: AgentStateMachineConfig): void {
    const state = config.initialState || 'initializing';
    this.agentStates.update(map => {
      const newMap = new Map(map);
      newMap.set(config.agentId, state);
      return newMap;
    });

    this.transitionHistory.update(map => {
      const newMap = new Map(map);
      newMap.set(config.agentId, []);
      return newMap;
    });

    this.recoveryAttempts.update(map => {
      const newMap = new Map(map);
      newMap.set(config.agentId, 0);
      return newMap;
    });

    this.lastHeartbeat.update(map => {
      const newMap = new Map(map);
      newMap.set(config.agentId, Date.now());
      return newMap;
    });
  }

  canTransition(agentId: string, targetState: AgentState): boolean {
    const currentState = this.agentStates().get(agentId);
    if (!currentState) return false;

    const allowedTransitions = STATE_TRANSITIONS[currentState];
    return allowedTransitions.includes(targetState);
  }

  transition(agentId: string, targetState: AgentState, reason: string): boolean {
    if (!this.canTransition(agentId, targetState)) {
      console.warn(`Invalid state transition: ${this.agentStates().get(agentId)} -> ${targetState} for agent ${agentId}`);
      return false;
    }

    const previousState = this.agentStates().get(agentId)!;

    this.agentStates.update(map => {
      const newMap = new Map(map);
      newMap.set(agentId, targetState);
      return newMap;
    });

    const transition: StateTransition = {
      from: previousState,
      to: targetState,
      reason,
      timestamp: Date.now(),
    };

    this.transitionHistory.update(map => {
      const newMap = new Map(map);
      const history = newMap.get(agentId) || [];
      newMap.set(agentId, [...history, transition].slice(-100));
      return newMap;
    });

    this.emitStateChangeEvent(agentId, previousState, targetState, reason);

    return true;
  }

  private emitStateChangeEvent(
    agentId: string,
    previousState: AgentState,
    newState: AgentState,
    reason: string,
  ): void {
    const eventType = this.getEventTypeForState(newState);

    this.eventBus.emit({
      type: eventType,
      sessionId: 'state-machine',
      source: 'system',
      payload: {
        agentId,
        previousStatus: previousState as any,
        newStatus: newState as any,
        reason,
      },
    });
  }

  private getEventTypeForState(state: AgentState): MultiAgentEventType {
    const mapping: Record<AgentState, MultiAgentEventType> = {
      initializing: EVENT_TYPES.AGENT_INITIALIZING,
      ready: EVENT_TYPES.AGENT_STARTED,
      busy: EVENT_TYPES.AGENT_STARTED,
      waiting: EVENT_TYPES.AGENT_WAITING,
      recovering: EVENT_TYPES.AGENT_RECONNECTING,
      stopping: EVENT_TYPES.AGENT_STOPPING,
      stopped: EVENT_TYPES.AGENT_STOPPED,
      failed: EVENT_TYPES.AGENT_FAILED,
    };
    return mapping[state] || EVENT_TYPES.AGENT_STARTED;
  }

  heartbeat(agentId: string): void {
    this.lastHeartbeat.update(map => {
      const newMap = new Map(map);
      newMap.set(agentId, Date.now());
      return newMap;
    });
  }

  checkIdleTimeout(agentId: string, timeoutMs: number = 300000): boolean {
    const lastBeat = this.lastHeartbeat().get(agentId);
    if (!lastBeat) return false;

    const elapsed = Date.now() - lastBeat;
    if (elapsed > timeoutMs) {
      this.transition(agentId, 'stopping', '空闲超时');
      return true;
    }
    return false;
  }

  attemptRecovery(agentId: string, maxAttempts: number = 3): boolean {
    const attempts = this.recoveryAttempts().get(agentId) || 0;

    if (attempts >= maxAttempts) {
      this.transition(agentId, 'stopping', '恢复尝试次数已达上限');
      return false;
    }

    this.recoveryAttempts.update(map => {
      const newMap = new Map(map);
      newMap.set(agentId, attempts + 1);
      return newMap;
    });

    return this.transition(agentId, 'recovering', `尝试恢复 (${attempts + 1}/${maxAttempts})`);
  }

  markRecovered(agentId: string): void {
    this.recoveryAttempts.update(map => {
      const newMap = new Map(map);
      newMap.set(agentId, 0);
      return newMap;
    });
    this.transition(agentId, 'ready', '恢复成功');
  }

  getState(agentId: string): AgentState | undefined {
    return this.agentStates().get(agentId);
  }

  getTransitionHistory(agentId: string): StateTransition[] {
    return this.transitionHistory().get(agentId) || [];
  }

  getRecoveryAttempts(agentId: string): number {
    return this.recoveryAttempts().get(agentId) || 0;
  }

  getStateStats(): {
    total: number;
    initializing: number;
    ready: number;
    busy: number;
    waiting: number;
    recovering: number;
    stopping: number;
    stopped: number;
    failed: number;
  } {
    const states = this.agentStates();
    const stats = {
      total: states.size,
      initializing: 0,
      ready: 0,
      busy: 0,
      waiting: 0,
      recovering: 0,
      stopping: 0,
      stopped: 0,
      failed: 0,
    };

    states.forEach(state => {
      stats[state]++;
    });

    return stats;
  }

  cleanup(agentId: string): void {
    this.agentStates.update(map => {
      const newMap = new Map(map);
      newMap.delete(agentId);
      return newMap;
    });

    this.transitionHistory.update(map => {
      const newMap = new Map(map);
      newMap.delete(agentId);
      return newMap;
    });

    this.recoveryAttempts.update(map => {
      const newMap = new Map(map);
      newMap.delete(agentId);
      return newMap;
    });

    this.lastHeartbeat.update(map => {
      const newMap = new Map(map);
      newMap.delete(agentId);
      return newMap;
    });
  }
}
