import { Injectable } from '@angular/core';
import type { TeammateMode } from './multi-agent.types';

@Injectable({ providedIn: 'root' })
export class MultiAgentSessionService {
  private currentSessionId = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private modeSnapshot?: { configuredMode: TeammateMode; capturedAt: number };

  getSessionId(): string {
    return this.currentSessionId;
  }

  captureModeIfNeeded(mode: TeammateMode): { configuredMode: TeammateMode; capturedAt: number } {
    if (!this.modeSnapshot) {
      this.modeSnapshot = { configuredMode: mode, capturedAt: Date.now() };
    }
    return this.modeSnapshot;
  }

  getModeSnapshot(): { configuredMode: TeammateMode; capturedAt: number } | undefined {
    return this.modeSnapshot;
  }

  resetForNewSession(mode?: TeammateMode): { configuredMode?: TeammateMode; capturedAt: number } {
    this.currentSessionId = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.modeSnapshot = mode ? { configuredMode: mode, capturedAt: Date.now() } : undefined;
    return { configuredMode: this.modeSnapshot?.configuredMode, capturedAt: Date.now() };
  }
}
