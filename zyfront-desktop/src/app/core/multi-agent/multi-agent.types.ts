export type TeammateMode = 'auto' | 'in-process' | 'tmux' | 'iterm2';

export type BackendType = 'in-process' | 'tmux' | 'iterm2';

export type TeammateRuntimeStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'waiting'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface ExecutionModeSnapshot {
  configuredMode: TeammateMode;
  effectiveBackend: BackendType;
  snapshotAt: number;
  capturedAt?: number;
  reason?: string;
}

export interface BackendCapability {
  platform: string;
  wslAvailable?: boolean;
  tmuxExecutable?: string;
  tmuxAvailable: boolean;
  itermAvailable: boolean;
  inProcessAvailable: boolean;
  blocking: boolean;
  setupHints: string[];
}

export interface TeammateIdentity {
  agentId: string;
  agentName: string;
  teamName: string;
  color: string;
  model?: string;
  cwd?: string;
  planModeRequired?: boolean;
  agentType?: string;
  parentSessionId?: string;
}

export interface TeammateSpawnConfig {
  name: string;
  prompt: string;
  teamName: string;
  mode?: TeammateMode;
  cwd?: string;
  model?: string;
  agentType?: string;
  planModeRequired?: boolean;
  useSplitPane?: boolean;
  description?: string;
  invokingRequestId?: string;
}

export interface TeammateSpawnResult {
  identity: TeammateIdentity;
  backend: BackendType;
  status: TeammateRuntimeStatus;
  paneId?: string;
  windowId?: string;
  fallbackFromMode?: TeammateMode;
  fallbackReason?: string;
  startedAt: number;
  lastUpdatedAt?: number;
  lastStoppedAt?: number;
  lastError?: string;
}

export interface TeammateCapabilitySnapshot {
  platform: string;
  tmuxAvailable: boolean;
  itermAvailable: boolean;
  inProcessAvailable: boolean;
}

export interface TeammateBackendHealth {
  configuredMode: TeammateMode;
  effectiveBackend?: BackendType;
  isNative: boolean;
  blocking: boolean;
  capabilities: TeammateCapabilitySnapshot;
  needsSetup: boolean;
  fallbackReason?: string;
  setupHints?: string[];
  updatedAt: number;
}

export interface TeamContextState {
  teamName: string;
  leadAgentId: string;
  teammates: Record<string, TeammateSpawnResult>;
  version: number;
  updatedAt: number;
}

export interface WorkbenchTeammateVm {
  agentId: string;
  name: string;
  color: string;
  backend: BackendType;
  paneId?: string;
  windowId?: string;
  status: TeammateRuntimeStatus;
  model?: string;
  cwd?: string;
  planModeRequired: boolean;
  lastMessagePreview?: string;
  updatedAt: number;
  attached?: boolean;
  canAttach?: boolean;
  canDetach?: boolean;
  recoveryState?: 'live' | 'detached' | 'reconnecting' | 'restored' | 'blocked';
  sessionName?: string;
  sessionLastSeenAt?: number;
}

export interface WorkbenchTeamVm {
  teamName: string;
  leadAgentId: string;
  mode: TeammateMode;
  effectiveBackend?: BackendType;
  health: TeammateBackendHealth;
  teammates: WorkbenchTeammateVm[];
  runningCount: number;
  stoppedCount: number;
  errorCount: number;
  updatedAt: number;
}
