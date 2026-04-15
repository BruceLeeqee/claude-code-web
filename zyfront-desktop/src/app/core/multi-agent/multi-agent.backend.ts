import type { BackendCapability, TeammateBackendHealth, TeammateMode, TeammateSpawnConfig, TeammateSpawnResult } from './multi-agent.types';

export interface BackendProbeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface BackendProbeService {
  exec(command: string, cwd?: string): Promise<BackendProbeResult>;
}

export interface TeammateSendMessageInput {
  teamName: string;
  fromAgentId: string;
  toAgentId?: string;
  text: string;
  requestId?: string;
}

export interface TeammateTerminateInput {
  agentId: string;
  reason?: string;
  requestId?: string;
}

export interface TeammateBackend {
  readonly backendType: 'in-process' | 'tmux' | 'iterm2';
  spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult>;
  sendMessage(input: TeammateSendMessageInput): Promise<{ ok: true; deliveredAt: number }>;
  terminate(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number; graceful: boolean }>;
  kill(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number }>;
  isActive(agentId: string): Promise<boolean>;
}

export interface BackendDetectionResult {
  configuredMode: TeammateMode;
  effectiveBackend?: 'in-process' | 'tmux' | 'iterm2';
  fallbackFromMode?: TeammateMode;
  fallbackReason?: string;
  blocking: boolean;
  health: TeammateBackendHealth;
  capability: BackendCapability;
  snapshotAt: number;
}
