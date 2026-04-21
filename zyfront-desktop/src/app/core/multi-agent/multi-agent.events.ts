import type { BackendCapability, BackendType, ExecutionModeSnapshot, TeammateIdentity, TeammateMode, TeammateRuntimeStatus } from './multi-agent.types';
import type { AgentDescriptor, AgentIntent, AgentLifecycleStatus, AgentRuntimeState, ModelRouteDecision, RecoveryAction, SessionContext, SessionSnapshot, TaskGraph, TeamContext } from './domain/types';

export type MultiAgentEventSource = 'system' | 'leader' | 'teammate' | 'backend' | 'user' | 'planner' | 'auto-scale' | 'recovery' | 'executor' | 'validator' | 'constraint';

export interface MultiAgentEventEnvelope<TType extends string, TPayload> {
  type: TType;
  ts: number;
  sessionId: string;
  requestId?: string;
  source: MultiAgentEventSource;
  payload: TPayload;
}

export type MultiAgentEventType =
  | 'multiagent.mode.captured'
  | 'multiagent.backend.detected'
  | 'multiagent.backend.fallback'
  | 'multiagent.teammate.spawned'
  | 'multiagent.teammate.state.changed'
  | 'multiagent.teammate.stopped'
  | 'multiagent.teammate.killed'
  | 'multiagent.teammate.failed'
  | 'multiagent.teammate.message'
  | 'multiagent.team.updated'
  | 'multiagent.error'
  | 'mode.single'
  | 'mode.multi'
  | 'mode.auto'
  | 'session.created'
  | 'session.resumed'
  | 'session.paused'
  | 'session.closed'
  | 'session.snapshot.created'
  | 'session.snapshot.restored'
  | 'task.planned'
  | 'task.assigned'
  | 'task.started'
  | 'task.progress'
  | 'task.blocked'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'agent.intent.created'
  | 'agent.intent.expired'
  | 'agent.created'
  | 'agent.initializing'
  | 'agent.started'
  | 'agent.idle'
  | 'agent.waiting'
  | 'agent.blocked'
  | 'agent.reconnecting'
  | 'agent.background'
  | 'agent.stopping'
  | 'agent.stopped'
  | 'agent.failed'
  | 'agent.recovered'
  | 'agent.terminated'
  | 'agent.archived'
  | 'agent.thinking'
  | 'agent.output'
  | 'model.routed'
  | 'model.fallback'
  | 'memory.synced'
  | 'team.updated'
  | 'recovery.initiated'
  | 'recovery.completed'
  | 'execution.warning'
  | 'execution.paused'
  | 'execution.resumed';

export interface MultiAgentModeCapturedPayload extends ExecutionModeSnapshot {
  snapshotAt: number;
  capturedAt?: number;
}

export interface MultiAgentBackendDetectedPayload {
  configuredMode: TeammateMode;
  effectiveBackend: BackendType;
  platform: string;
  capabilities: BackendCapability;
}

export interface MultiAgentBackendFallbackPayload {
  fromMode: TeammateMode;
  toBackend: BackendType;
  reason: string;
  blocking: boolean;
}

export interface MultiAgentTeammateSpawnedPayload {
  identity: TeammateIdentity;
  backend: BackendType;
  paneId?: string;
  windowId?: string;
}

export interface MultiAgentTeammateStateChangedPayload {
  agentId: string;
  prev: TeammateRuntimeStatus;
  next: TeammateRuntimeStatus;
  reason?: string;
}

export interface MultiAgentTeammateStoppedPayload {
  agentId: string;
  graceful: boolean;
  reason?: string;
}

export interface MultiAgentTeammateKilledPayload {
  agentId: string;
  signal?: string;
  reason?: string;
}

export interface MultiAgentTeammateFailedPayload {
  agentId?: string;
  stage: 'spawn' | 'message' | 'stop' | 'kill' | 'detect';
  code?: string;
  message: string;
  retriable: boolean;
}

export interface MultiAgentTeammateMessagePayload {
  direction: 'leader_to_teammate' | 'teammate_to_leader' | 'teammate_to_teammate';
  fromAgentId: string;
  toAgentId?: string;
  teamName: string;
  text: string;
  textPreview: string;
}

export interface MultiAgentTeamUpdatedPayload {
  teamName: string;
  leadAgentId: string;
  teammateIds: string[];
  version: number;
}

export interface MultiAgentErrorPayload {
  scope: 'backend' | 'lifecycle' | 'message' | 'ui' | 'team' | 'planning' | 'routing' | 'recovery' | 'session';
  code?: string;
  message: string;
  details?: Record<string, unknown>;
  retriable?: boolean;
}

export interface ModeSinglePayload {
  mode: 'single';
  reason: string;
  complexity?: any;
  previousMode?: 'single' | 'multi';
  timestamp?: number;
  constraints?: any;
}

export interface ModeMultiPayload {
  mode: 'multi';
  reason: string;
  complexity?: any;
  suggestedTeamConfig?: any;
  previousMode?: 'single' | 'multi';
  timestamp?: number;
}

export interface ModeAutoPayload {
  previousMode?: 'single' | 'multi';
  reason: string;
  timestamp?: number;
}

export interface SessionCreatedPayload {
  session: SessionContext;
  team: TeamContext;
}

export interface SessionResumedPayload {
  session: SessionContext;
  restoredFromSnapshot: boolean;
  snapshotId?: string;
}

export interface SessionPausedPayload {
  sessionId: string;
  reason: 'user' | 'resource' | 'error';
  snapshotId?: string;
}

export interface SessionClosedPayload {
  sessionId: string;
  reason: 'user' | 'completed' | 'error' | 'timeout';
  finalStats: {
    totalTasks: number;
    completedTasks: number;
    totalTokens: number;
    totalCostUsd: number;
    durationMs: number;
  };
}

export interface SessionSnapshotCreatedPayload {
  snapshot: SessionSnapshot;
}

export interface SessionSnapshotRestoredPayload {
  snapshot: SessionSnapshot;
  restoredAgents: string[];
  restoredTasks: string[];
}

export interface TaskPlannedPayload {
  taskGraph: TaskGraph;
  planVersion: number;
  replanReason?: string;
}

export interface TaskAssignedPayload {
  taskId: string;
  agentId: string;
}

export interface TaskStartedPayload {
  taskId: string;
  agentId: string;
  startedAt: number;
}

export interface TaskProgressPayload {
  taskId: string;
  agentId: string;
  progress: number;
  message: string;
}

export interface TaskBlockedPayload {
  taskId: string;
  agentId: string;
  reason: string;
  blockedBy: string[];
}

export interface TaskCompletedPayload {
  taskId: string;
  agentId: string;
  result: string;
  durationMs: number;
}

export interface TaskFailedPayload {
  taskId: string;
  agentId: string;
  error: string;
  retriable: boolean;
  needsReplan?: boolean;
  suggestions?: string[];
}

export interface TaskCancelledPayload {
  taskId: string;
  reason: string;
}

export interface AgentIntentCreatedPayload {
  intent: AgentIntent;
  triggerTaskId: string;
}

export interface AgentIntentExpiredPayload {
  intentId: string;
  reason: 'timeout' | 'cancelled' | 'superseded';
}

export interface AgentCreatedPayload {
  descriptor: AgentDescriptor;
  runtimeState: AgentRuntimeState;
  intentId?: string;
}

export interface AgentStateChangedPayload {
  agentId: string;
  previousStatus: AgentLifecycleStatus;
  newStatus: AgentLifecycleStatus;
  reason?: string;
}

export interface AgentFailedPayload {
  agentId: string;
  stage: 'spawn' | 'message' | 'execute' | 'stop';
  errorCode?: string;
  errorMessage: string;
  retriable: boolean;
}

export interface AgentRecoveredPayload {
  agentId: string;
  recoveryAction: RecoveryAction;
  previousStatus: AgentLifecycleStatus;
}

export interface AgentTerminatedPayload {
  agentId: string;
  reason: 'task-complete' | 'idle-timeout' | 'user' | 'error' | 'replaced' | 'max-lifetime';
  graceful: boolean;
  finalStats: {
    tasksCompleted: number;
    messagesProcessed: number;
    tokensUsed: number;
    durationMs: number;
  };
}

export interface AgentThinkingPayload {
  agentId: string;
  thinking: string;
}

export interface AgentOutputPayload {
  agentId: string;
  output: string;
}

export interface ModelRoutedPayload {
  decision: ModelRouteDecision;
}

export interface ModelFallbackPayload {
  agentId: string;
  fromModelId: string;
  toModelId: string;
  reason: string;
}

export interface MemorySyncedPayload {
  sessionId: string;
  pipeline: 'extract' | 'session' | 'dream' | 'team';
  filesTouched: string[];
}

export interface TeamUpdatedPayloadV2 {
  team: TeamContext;
  addedAgents: string[];
  removedAgents: string[];
  version: number;
}

export interface RecoveryInitiatedPayload {
  action: RecoveryAction;
}

export interface RecoveryCompletedPayload {
  action: RecoveryAction;
  success: boolean;
  result?: string;
}

export interface ExecutionWarningPayload {
  warning: string;
  type?: 'tool_call' | 'token_usage' | 'file_modification';
  currentCount?: number;
  maxCount?: number;
}

export interface ExecutionPausedPayload {
  reason?: string;
  state?: any;
}

export interface ExecutionResumedPayload {
  timestamp: number;
}

export type MultiAgentEventMap = {
  'multiagent.mode.captured': MultiAgentModeCapturedPayload;
  'multiagent.backend.detected': MultiAgentBackendDetectedPayload;
  'multiagent.backend.fallback': MultiAgentBackendFallbackPayload;
  'multiagent.teammate.spawned': MultiAgentTeammateSpawnedPayload;
  'multiagent.teammate.state.changed': MultiAgentTeammateStateChangedPayload;
  'multiagent.teammate.stopped': MultiAgentTeammateStoppedPayload;
  'multiagent.teammate.killed': MultiAgentTeammateKilledPayload;
  'multiagent.teammate.failed': MultiAgentTeammateFailedPayload;
  'multiagent.teammate.message': MultiAgentTeammateMessagePayload;
  'multiagent.team.updated': MultiAgentTeamUpdatedPayload;
  'multiagent.error': MultiAgentErrorPayload;
  'mode.single': ModeSinglePayload;
  'mode.multi': ModeMultiPayload;
  'mode.auto': ModeAutoPayload;
  'session.created': SessionCreatedPayload;
  'session.resumed': SessionResumedPayload;
  'session.paused': SessionPausedPayload;
  'session.closed': SessionClosedPayload;
  'session.snapshot.created': SessionSnapshotCreatedPayload;
  'session.snapshot.restored': SessionSnapshotRestoredPayload;
  'task.planned': TaskPlannedPayload;
  'task.assigned': TaskAssignedPayload;
  'task.started': TaskStartedPayload;
  'task.progress': TaskProgressPayload;
  'task.blocked': TaskBlockedPayload;
  'task.completed': TaskCompletedPayload;
  'task.failed': TaskFailedPayload;
  'task.cancelled': TaskCancelledPayload;
  'agent.intent.created': AgentIntentCreatedPayload;
  'agent.intent.expired': AgentIntentExpiredPayload;
  'agent.created': AgentCreatedPayload;
  'agent.initializing': AgentStateChangedPayload;
  'agent.started': AgentStateChangedPayload;
  'agent.idle': AgentStateChangedPayload;
  'agent.waiting': AgentStateChangedPayload;
  'agent.blocked': AgentStateChangedPayload;
  'agent.reconnecting': AgentStateChangedPayload;
  'agent.background': AgentStateChangedPayload;
  'agent.stopping': AgentStateChangedPayload;
  'agent.stopped': AgentStateChangedPayload;
  'agent.failed': AgentFailedPayload;
  'agent.recovered': AgentRecoveredPayload;
  'agent.terminated': AgentTerminatedPayload;
  'agent.archived': AgentStateChangedPayload;
  'agent.thinking': AgentThinkingPayload;
  'agent.output': AgentOutputPayload;
  'model.routed': ModelRoutedPayload;
  'model.fallback': ModelFallbackPayload;
  'memory.synced': MemorySyncedPayload;
  'team.updated': TeamUpdatedPayloadV2;
  'recovery.initiated': RecoveryInitiatedPayload;
  'recovery.completed': RecoveryCompletedPayload;
  'execution.warning': ExecutionWarningPayload;
  'execution.paused': ExecutionPausedPayload;
  'execution.resumed': ExecutionResumedPayload;
};

export const EVENT_TYPES = {
  MODE_SINGLE: 'mode.single' as const,
  MODE_MULTI: 'mode.multi' as const,
  MODE_AUTO: 'mode.auto' as const,
  SESSION_CREATED: 'session.created' as const,
  SESSION_RESUMED: 'session.resumed' as const,
  SESSION_PAUSED: 'session.paused' as const,
  SESSION_CLOSED: 'session.closed' as const,
  SESSION_SNAPSHOT_CREATED: 'session.snapshot.created' as const,
  SESSION_SNAPSHOT_RESTORED: 'session.snapshot.restored' as const,
  TASK_PLANNED: 'task.planned' as const,
  TASK_ASSIGNED: 'task.assigned' as const,
  TASK_STARTED: 'task.started' as const,
  TASK_PROGRESS: 'task.progress' as const,
  TASK_BLOCKED: 'task.blocked' as const,
  TASK_COMPLETED: 'task.completed' as const,
  TASK_FAILED: 'task.failed' as const,
  TASK_CANCELLED: 'task.cancelled' as const,
  AGENT_INTENT_CREATED: 'agent.intent.created' as const,
  AGENT_INTENT_EXPIRED: 'agent.intent.expired' as const,
  AGENT_CREATED: 'agent.created' as const,
  AGENT_INITIALIZING: 'agent.initializing' as const,
  AGENT_STARTED: 'agent.started' as const,
  AGENT_IDLE: 'agent.idle' as const,
  AGENT_WAITING: 'agent.waiting' as const,
  AGENT_BLOCKED: 'agent.blocked' as const,
  AGENT_RECONNECTING: 'agent.reconnecting' as const,
  AGENT_BACKGROUND: 'agent.background' as const,
  AGENT_STOPPING: 'agent.stopping' as const,
  AGENT_STOPPED: 'agent.stopped' as const,
  AGENT_FAILED: 'agent.failed' as const,
  AGENT_RECOVERED: 'agent.recovered' as const,
  AGENT_TERMINATED: 'agent.terminated' as const,
  AGENT_ARCHIVED: 'agent.archived' as const,
  AGENT_THINKING: 'agent.thinking' as const,
  AGENT_OUTPUT: 'agent.output' as const,
  MODEL_ROUTED: 'model.routed' as const,
  MODEL_FALLBACK: 'model.fallback' as const,
  MEMORY_SYNCED: 'memory.synced' as const,
  TEAM_UPDATED: 'team.updated' as const,
  RECOVERY_INITIATED: 'recovery.initiated' as const,
  RECOVERY_COMPLETED: 'recovery.completed' as const,
  ERROR: 'multiagent.error' as const,
  EXECUTION_WARNING: 'execution.warning' as const,
  EXECUTION_PAUSED: 'execution.paused' as const,
  EXECUTION_RESUMED: 'execution.resumed' as const,
} as const;

/**
 * 关键：必须是“可按 type 收窄 payload”的判别联合类型。
 * 使用分布式条件类型，确保当 K 为联合时，`type` 与 `payload` 仍保持一一对应关系。
 */
export type MultiAgentEvent<K extends keyof MultiAgentEventMap = keyof MultiAgentEventMap> =
  K extends keyof MultiAgentEventMap ? MultiAgentEventEnvelope<K, MultiAgentEventMap[K]> : never;
