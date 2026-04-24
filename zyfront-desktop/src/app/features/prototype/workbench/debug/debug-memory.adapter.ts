import { Injectable, inject } from '@angular/core';
import { MemoryConfigService } from '../../../../core/memory/memory.config';
import { MemoryOrchestratorService } from '../../../../core/memory/memory.orchestrator';
import { MemoryTelemetryService } from '../../../../core/memory/memory.telemetry';

@Injectable({ providedIn: 'root' })
export class DebugMemoryAdapterService {
  private readonly config = inject(MemoryConfigService);
  private readonly orchestrator = inject(MemoryOrchestratorService);
  private readonly telemetry = inject(MemoryTelemetryService);

  snapshot() {
    return {
      config: this.config.getConfig(),
      status: this.orchestrator.getStatus(),
      telemetry: this.telemetry.listRecent(20),
    };
  }

  async runNow(turn: { sessionId: string; turnId: string; timestamp: number; messages: Array<{ role: string; content: unknown }> }): Promise<void> {
    await this.orchestrator.runNow(turn as any);
  }
}
