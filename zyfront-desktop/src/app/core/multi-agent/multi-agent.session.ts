import { Injectable } from '@angular/core';
import type { ExecutionModeSnapshot, TeammateMode } from './multi-agent.types';

@Injectable({ providedIn: 'root' })
export class MultiAgentSessionService {
  private currentSessionId = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private modeSnapshot?: ExecutionModeSnapshot;

  getSessionId(): string {
    return this.currentSessionId;
  }

  captureModeIfNeeded(
    mode: TeammateMode,
    effectiveBackend: ExecutionModeSnapshot['effectiveBackend'] = 'in-process',
  ): ExecutionModeSnapshot {
    if (!this.modeSnapshot) {
      const now = Date.now();
      this.modeSnapshot = {
        configuredMode: mode,
        effectiveBackend,
        snapshotAt: now,
        capturedAt: now,
      };
    }
    return this.modeSnapshot;
  }

  setModeSnapshot(snapshot: ExecutionModeSnapshot): ExecutionModeSnapshot {
    this.modeSnapshot = snapshot;
    return snapshot;
  }

  getModeSnapshot(): ExecutionModeSnapshot | undefined {
    return this.modeSnapshot;
  }

  resetForNewSession(mode?: TeammateMode): ExecutionModeSnapshot | undefined {
    this.currentSessionId = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.modeSnapshot = mode
      ? {
          configuredMode: mode,
          effectiveBackend: mode === 'auto' ? 'in-process' : mode,
          snapshotAt: Date.now(),
          capturedAt: Date.now(),
        }
      : undefined;
    return this.modeSnapshot;
  }
}
