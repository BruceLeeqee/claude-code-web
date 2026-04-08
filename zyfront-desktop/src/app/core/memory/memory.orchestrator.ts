import { Injectable } from '@angular/core';
import { MemorySchedulerService } from './memory.scheduler';
import { type MemoryPipelineResult, type MemoryPipelineStatus, type TurnContext } from './memory.types';
import { MemoryConfigService } from './memory.config';
import { MemoryTelemetryService } from './memory.telemetry';

@Injectable({ providedIn: 'root' })
export class MemoryOrchestratorService {
  private inProgress = false;
  private lastRunAt?: number;
  private lastResult?: MemoryPipelineResult;

  constructor(
    private readonly scheduler: MemorySchedulerService,
    private readonly configService: MemoryConfigService,
    private readonly telemetry: MemoryTelemetryService,
  ) {}

  runOnTurnCompleted(turn: TurnContext): void {
    if (!this.configService.getConfig().enabled) {
      return;
    }

    void this.runInternal(turn);
  }

  runNow(turn: TurnContext): Promise<void> {
    return this.runInternal(turn);
  }

  getStatus(): MemoryPipelineStatus {
    return {
      enabled: this.configService.getConfig().enabled,
      inProgress: this.inProgress,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      recentEvents: this.telemetry.listRecent(50),
    };
  }

  private async runInternal(turn: TurnContext): Promise<void> {
    this.inProgress = true;
    this.lastRunAt = Date.now();
    try {
      const results = await this.scheduler.runOnTurnEnd(turn);
      this.lastResult = results[0];
    } finally {
      this.inProgress = false;
    }
  }
}
