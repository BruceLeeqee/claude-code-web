import type { BackendCapability, BackendType, ExecutionModeSnapshot, TeammateIdentity, TeammateMode, TeammateRuntimeStatus } from './multi-agent.types';

export type MultiAgentEventSource = 'system' | 'leader' | 'teammate' | 'backend' | 'user';

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
  | 'multiagent.error';

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
  scope: 'backend' | 'lifecycle' | 'message' | 'ui';
  code?: string;
  message: string;
  details?: Record<string, unknown>;
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
};

/**
 * 关键：必须是“可按 type 收窄 payload”的判别联合类型。
 * 使用分布式条件类型，确保当 K 为联合时，`type` 与 `payload` 仍保持一一对应关系。
 */
export type MultiAgentEvent<K extends keyof MultiAgentEventMap = keyof MultiAgentEventMap> =
  K extends keyof MultiAgentEventMap ? MultiAgentEventEnvelope<K, MultiAgentEventMap[K]> : never;
