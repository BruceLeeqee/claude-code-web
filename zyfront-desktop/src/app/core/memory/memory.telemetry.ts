import { Injectable } from '@angular/core';
import { type MemoryPipelineEvent } from './memory.types';

@Injectable({ providedIn: 'root' })
export class MemoryTelemetryService {
  private readonly events: MemoryPipelineEvent[] = [];
  private readonly maxEvents = 200;

  track(event: MemoryPipelineEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    // Sprint 1: console-based telemetry sink (can be replaced by logger service)
    console.info('[memory.pipeline]', event);
  }

  listRecent(limit = 50): MemoryPipelineEvent[] {
    return this.events.slice(-Math.max(1, limit));
  }
}
