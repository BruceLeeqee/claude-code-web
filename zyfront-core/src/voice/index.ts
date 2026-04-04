/**
 * 语音架构占位：仅维护引擎状态枚举，供 UI/传输层后续接入真实 ASR/TTS。
 */
export type VoiceEngineState = 'idle' | 'listening' | 'speaking' | 'error';

/** 一帧输入电平/PCM 占位 */
export interface VoiceInputFrame {
  ts: number;
  level: number;
  pcm?: Float32Array;
}

/** 转写分片占位 */
export interface VoiceTranscriptChunk {
  ts: number;
  text: string;
  final: boolean;
}

/** 会话元信息占位 */
export interface VoiceSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  state: VoiceEngineState;
}

/** 语音引擎状态占位实现 */
export class VoiceArchitecture {
  private state: VoiceEngineState = 'idle';

  /** 当前引擎状态 */
  getState(): VoiceEngineState {
    return this.state;
  }

  /** 标记为监听中 */
  startListening(): void {
    this.state = 'listening';
  }

  /** 标记为播报中 */
  startSpeaking(): void {
    this.state = 'speaking';
  }

  /** 回到 idle */
  stop(): void {
    this.state = 'idle';
  }

  /** 标记错误态 */
  markError(): void {
    this.state = 'error';
  }
}
