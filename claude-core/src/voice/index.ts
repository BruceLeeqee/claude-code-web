export type VoiceEngineState = 'idle' | 'listening' | 'speaking' | 'error';

export interface VoiceInputFrame {
  ts: number;
  level: number;
  pcm?: Float32Array;
}

export interface VoiceTranscriptChunk {
  ts: number;
  text: string;
  final: boolean;
}

export interface VoiceSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  state: VoiceEngineState;
}

/**
 * Browser-first voice architecture placeholder.
 *
 * No local command execution; UI/transport layers can bind to this contract.
 */
export class VoiceArchitecture {
  private state: VoiceEngineState = 'idle';

  getState(): VoiceEngineState {
    return this.state;
  }

  startListening(): void {
    this.state = 'listening';
  }

  startSpeaking(): void {
    this.state = 'speaking';
  }

  stop(): void {
    this.state = 'idle';
  }

  markError(): void {
    this.state = 'error';
  }
}
