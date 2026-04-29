import type { BackendCapability, BackendType, ExecutionModeSnapshot, TeammateIdentity, TeammateMode, TeammateRuntimeStatus } from './multi-agent.types';
import type { AgentDescriptor, AgentIntent, AgentLifecycleStatus, AgentRuntimeState, ModelRouteDecision, RecoveryAction, SessionContext, SessionSnapshot, TaskGraph, TeamContext } from './domain/types';
import type { RoleDefinition, StructDefinition, TeamRuntimeState, TeamTask, TeamMessage, TeamRuntimeStatus as TeamRuntimeStatusType, TeamRunMode, TeamStageDefinition, CommandResult } from './team/team.types';

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
  | 'team.mode.single'
  | 'team.mode.multi'
  | 'team.mode.auto'
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
  | 'execution.resumed'
  | 'input.submitted'
  | 'team.role.created'
  | 'team.role.listed'
  | 'team.role.opened'
  | 'team.struct.created'
  | 'team.struct.listed'
  | 'team.struct.opened'
  | 'team.runtime.created'
  | 'team.runtime.status.changed'
  | 'team.runtime.member.joined'
  | 'team.runtime.member.left'
  | 'team.runtime.stage.changed'
  | 'team.runtime.completed'
  | 'team.runtime.failed'
  | 'team.runtime.closed'
  | 'team.mailbox.message.sent'
  | 'team.mailbox.message.received'
  | 'team.mailbox.message.read'
  | 'team.task.created'
  | 'team.task.assigned'
  | 'team.task.status.changed'
  | 'team.task.completed'
  | 'team.subagent.started'
  | 'team.subagent.completed'
  | 'team.subagent.failed'
  | 'team.agent.started'
  | 'team.agent.completed'
  | 'team.agent.failed'
  | 'team.command.executed';

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

export interface Attachment {
  id: string;
  type: 'file' | 'image' | 'code' | 'link';
  name: string;
  path?: string;
  url?: string;
  content?: string;
  size?: number;
  mimeType?: string;
}

export interface InputSubmittedPayload {
  sessionId: string;
  text: string;
  attachments?: Attachment[];
  command?: string;
  timestamp: number;
  source: 'user' | 'shortcut' | 'script';
}

export interface TeamRoleCreatedPayload {
  role: RoleDefinition;
  filePath: string;
  teamId?: string;
  autoGenerated?: boolean;
}

export interface TeamRoleListedPayload {
  roles: Array<Pick<RoleDefinition, 'name' | 'slug' | 'type' | 'description' | 'model' | 'status' | 'updatedAt'>>;
  teamId?: string;
}

export interface TeamRoleOpenedPayload {
  role: RoleDefinition;
  filePath: string;
  teamId?: string;
}

export interface TeamStructCreatedPayload {
  struct: StructDefinition;
  filePath: string;
  teamId?: string;
}

export interface TeamStructListedPayload {
  structs: Array<Pick<StructDefinition, 'name' | 'slug' | 'type' | 'description' | 'roles' | 'status' | 'updatedAt'>>;
  teamId?: string;
}

export interface TeamStructOpenedPayload {
  struct: StructDefinition;
  filePath: string;
  teamId?: string;
}

export interface TeamRuntimeCreatedPayload {
  runtime: TeamRuntimeState;
  teamId: string;
  structName: string;
}

export interface TeamRuntimeStatusChangedPayload {
  teamId: string;
  previousStatus: TeamRuntimeStatusType;
  newStatus: TeamRuntimeStatusType;
  reason?: string;
  structName?: string;
}

export interface TeamRuntimeMemberJoinedPayload {
  teamId: string;
  agentId: string;
  roleName: string;
  structName?: string;
}

export interface TeamRuntimeMemberLeftPayload {
  teamId: string;
  agentId: string;
  roleName: string;
  reason?: string;
  structName?: string;
}

export interface TeamRuntimeStageChangedPayload {
  teamId: string;
  previousStageIndex: number;
  newStageIndex: number;
  stageName: string;
  stageMode: TeamRunMode;
  structName?: string;
}

export interface TeamRuntimeCompletedPayload {
  teamId: string;
  finalStatus: TeamRuntimeStatusType;
  durationMs: number;
  completedTasks: number;
  failedTasks: number;
  structName?: string;
}

export interface TeamRuntimeFailedPayload {
  teamId: string;
  error: string;
  stage?: string;
  structName?: string;
}

export interface TeamRuntimeClosedPayload {
  teamId: string;
  cleanedUp: string[];
  structName?: string;
}

export interface TeamMailboxMessageSentPayload {
  teamId: string;
  message: TeamMessage;
}

export interface TeamMailboxMessageReceivedPayload {
  teamId: string;
  message: TeamMessage;
}

export interface TeamMailboxMessageReadPayload {
  teamId: string;
  messageId: string;
  readBy: string;
}

export interface TeamTaskCreatedPayload {
  teamId: string;
  task: TeamTask;
}

export interface TeamTaskAssignedPayload {
  teamId: string;
  taskId: string;
  assignee: string;
}

export interface TeamTaskStatusChangedPayload {
  teamId: string;
  taskId: string;
  previousStatus: TeamTask['status'];
  newStatus: TeamTask['status'];
  reason?: string;
}

export interface TeamTaskCompletedPayload {
  teamId: string;
  taskId: string;
  outputs?: string;
}

export interface TeamSubagentStartedPayload {
  teamId: string;
  roles: string[];
  task: string;
}

export interface TeamSubagentCompletedPayload {
  teamId: string;
  results: Array<{
    roleName: string;
    success: boolean;
    summary: string;
    files: string[];
    durationMs: number;
  }>;
}

export interface TeamSubagentFailedPayload {
  teamId: string;
  roleName: string;
  error: string;
}

export interface TeamAgentStartedPayload {
  teamId: string;
  roles: string[];
  task: string;
}

export interface TeamAgentCompletedPayload {
  teamId: string;
  summary: string;
}

export interface TeamAgentFailedPayload {
  teamId: string;
  error: string;
}

export interface TeamCommandExecutedPayload {
  command: string;
  result: CommandResult;
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
  'team.mode.single': ModeSinglePayload;
  'team.mode.multi': ModeMultiPayload;
  'team.mode.auto': ModeAutoPayload;
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
  'input.submitted': InputSubmittedPayload;
  'team.role.created': TeamRoleCreatedPayload;
  'team.role.listed': TeamRoleListedPayload;
  'team.role.opened': TeamRoleOpenedPayload;
  'team.struct.created': TeamStructCreatedPayload;
  'team.struct.listed': TeamStructListedPayload;
  'team.struct.opened': TeamStructOpenedPayload;
  'team.runtime.created': TeamRuntimeCreatedPayload;
  'team.runtime.status.changed': TeamRuntimeStatusChangedPayload;
  'team.runtime.member.joined': TeamRuntimeMemberJoinedPayload;
  'team.runtime.member.left': TeamRuntimeMemberLeftPayload;
  'team.runtime.stage.changed': TeamRuntimeStageChangedPayload;
  'team.runtime.completed': TeamRuntimeCompletedPayload;
  'team.runtime.failed': TeamRuntimeFailedPayload;
  'team.runtime.closed': TeamRuntimeClosedPayload;
  'team.mailbox.message.sent': TeamMailboxMessageSentPayload;
  'team.mailbox.message.received': TeamMailboxMessageReceivedPayload;
  'team.mailbox.message.read': TeamMailboxMessageReadPayload;
  'team.task.created': TeamTaskCreatedPayload;
  'team.task.assigned': TeamTaskAssignedPayload;
  'team.task.status.changed': TeamTaskStatusChangedPayload;
  'team.task.completed': TeamTaskCompletedPayload;
  'team.subagent.started': TeamSubagentStartedPayload;
  'team.subagent.completed': TeamSubagentCompletedPayload;
  'team.subagent.failed': TeamSubagentFailedPayload;
  'team.agent.started': TeamAgentStartedPayload;
  'team.agent.completed': TeamAgentCompletedPayload;
  'team.agent.failed': TeamAgentFailedPayload;
  'team.command.executed': TeamCommandExecutedPayload;
};

export const EVENT_TYPES = {
  MODE_SINGLE: 'team.mode.single' as const,
  MODE_MULTI: 'team.mode.multi' as const,
  MODE_AUTO: 'team.mode.auto' as const,
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
  INPUT_SUBMITTED: 'input.submitted' as const,
  TEAM_ROLE_CREATED: 'team.role.created' as const,
  TEAM_ROLE_LISTED: 'team.role.listed' as const,
  TEAM_ROLE_OPENED: 'team.role.opened' as const,
  TEAM_STRUCT_CREATED: 'team.struct.created' as const,
  TEAM_STRUCT_LISTED: 'team.struct.listed' as const,
  TEAM_STRUCT_OPENED: 'team.struct.opened' as const,
  TEAM_RUNTIME_CREATED: 'team.runtime.created' as const,
  TEAM_RUNTIME_STATUS_CHANGED: 'team.runtime.status.changed' as const,
  TEAM_RUNTIME_MEMBER_JOINED: 'team.runtime.member.joined' as const,
  TEAM_RUNTIME_MEMBER_LEFT: 'team.runtime.member.left' as const,
  TEAM_RUNTIME_STAGE_CHANGED: 'team.runtime.stage.changed' as const,
  TEAM_RUNTIME_COMPLETED: 'team.runtime.completed' as const,
  TEAM_RUNTIME_FAILED: 'team.runtime.failed' as const,
  TEAM_RUNTIME_CLOSED: 'team.runtime.closed' as const,
  TEAM_MAILBOX_MESSAGE_SENT: 'team.mailbox.message.sent' as const,
  TEAM_MAILBOX_MESSAGE_RECEIVED: 'team.mailbox.message.received' as const,
  TEAM_MAILBOX_MESSAGE_READ: 'team.mailbox.message.read' as const,
  TEAM_TASK_CREATED: 'team.task.created' as const,
  TEAM_TASK_ASSIGNED: 'team.task.assigned' as const,
  TEAM_TASK_STATUS_CHANGED: 'team.task.status.changed' as const,
  TEAM_TASK_COMPLETED: 'team.task.completed' as const,
  TEAM_SUBAGENT_STARTED: 'team.subagent.started' as const,
  TEAM_SUBAGENT_COMPLETED: 'team.subagent.completed' as const,
  TEAM_SUBAGENT_FAILED: 'team.subagent.failed' as const,
  TEAM_AGENT_STARTED: 'team.agent.started' as const,
  TEAM_AGENT_COMPLETED: 'team.agent.completed' as const,
  TEAM_AGENT_FAILED: 'team.agent.failed' as const,
  TEAM_COMMAND_EXECUTED: 'team.command.executed' as const,
} as const;

/**
 * 关键：必须是“可按 type 收窄 payload”的判别联合类型。
 * 使用分布式条件类型，确保当 K 为联合时，`type` 与 `payload` 仍保持一一对应关系。
 */
export type MultiAgentEvent<K extends keyof MultiAgentEventMap = keyof MultiAgentEventMap> =
  K extends keyof MultiAgentEventMap ? MultiAgentEventEnvelope<K, MultiAgentEventMap[K]> : never;
