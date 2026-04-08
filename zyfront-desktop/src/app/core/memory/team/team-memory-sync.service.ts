import { Injectable } from '@angular/core';
import { MemoryTelemetryService } from '../memory.telemetry';

export type TeamSyncState = {
  started: boolean;
  pushSuppressedReason: string | null;
  lastPullAt?: number;
  lastPushAt?: number;
  lastError?: string;
};

@Injectable({ providedIn: 'root' })
export class TeamMemorySyncService {
  private state: TeamSyncState = {
    started: false,
    pushSuppressedReason: null,
  };

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly telemetry: MemoryTelemetryService) {}

  async start(): Promise<void> {
    if (this.state.started) return;
    this.state.started = true;
    await this.pullNow();
    this.telemetry.track({
      event: 'run',
      pipeline: 'extract',
      gate_passed: true,
      skip_reason: 'team_sync_started_stub',
      timestamp: Date.now(),
    });
  }

  notifyWrite(): void {
    if (this.state.pushSuppressedReason) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.pushNow();
    }, 2000);
  }

  async pullNow(): Promise<void> {
    this.state.lastPullAt = Date.now();
    this.state.lastError = undefined;
    this.telemetry.track({
      event: 'run',
      pipeline: 'extract',
      gate_passed: true,
      skip_reason: 'team_sync_pull_stub',
      timestamp: Date.now(),
    });
  }

  async pushNow(force = false): Promise<void> {
    if (this.state.pushSuppressedReason && !force) {
      return;
    }
    this.state.lastPushAt = Date.now();
    this.state.lastError = undefined;
    this.telemetry.track({
      event: 'run',
      pipeline: 'extract',
      gate_passed: true,
      skip_reason: force ? 'team_sync_force_push_stub' : 'team_sync_push_stub',
      timestamp: Date.now(),
    });
  }

  async retryNow(): Promise<void> {
    this.clearSuppression();
    await this.pullNow();
    await this.pushNow(true);
  }

  suppressPush(reason: string): void {
    this.state.pushSuppressedReason = reason;
  }

  clearSuppression(): void {
    this.state.pushSuppressedReason = null;
  }

  getState(): TeamSyncState {
    return { ...this.state };
  }
}
