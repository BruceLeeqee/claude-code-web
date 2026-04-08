export type MemoryPipelineName = 'extract' | 'session' | 'dream';

export interface TurnMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface TurnContext {
  sessionId: string;
  turnId: string;
  messages: TurnMessage[];
  timestamp: number;
}

export interface MemoryGateResult {
  pipeline: MemoryPipelineName;
  shouldRun: boolean;
  reason: string;
}

export interface MemoryPipelineResult {
  pipeline: MemoryPipelineName;
  status: 'skipped' | 'started' | 'succeeded' | 'failed';
  reason?: string;
  durationMs?: number;
  filesTouched?: string[];
}

export interface MemoryPipelineEvent {
  event: 'gate' | 'run' | 'error';
  pipeline: MemoryPipelineName;
  gate_passed: boolean;
  skip_reason: string;
  duration_ms?: number;
  messages_seen?: number;
  tool_calls_seen?: number;
  session_id?: string;
  turn_id?: string;
  timestamp: number;
}

export interface MemoryPipelineStatus {
  enabled: boolean;
  inProgress: boolean;
  lastRunAt?: number;
  lastResult?: MemoryPipelineResult;
  recentEvents: MemoryPipelineEvent[];
}
