import { Injectable, inject } from '@angular/core';
import { PromptBuildContextService } from './prompt-build-context.service';
import { PromptMemoryBuilderService } from './prompt-memory-builder.service';
import { MemoryConfigService } from './memory.config';
import { MemoryOrchestratorService } from './memory.orchestrator';
import { MemoryTelemetryService } from './memory.telemetry';

export interface PromptDebugReportItem {
  label: string;
  value: string;
}

@Injectable({ providedIn: 'root' })
export class PromptDebugReportService {
  private readonly context = inject(PromptBuildContextService);
  private readonly promptBuilder = inject(PromptMemoryBuilderService);
  private readonly config = inject(MemoryConfigService);
  private readonly orchestrator = inject(MemoryOrchestratorService);
  private readonly telemetry = inject(MemoryTelemetryService);

  buildTextReport(sessionId: string): string {
    const snapshot = this.context.getSnapshot(sessionId);
    const report = this.promptBuilder.getLastBuildReport(sessionId);
    const cfg = this.config.getConfig();
    const status = this.orchestrator.getStatus();
    const events = this.telemetry.listRecent(10);

    const lines = [
      '=== Prompt / Memory Debug Report ===',
      `Session: ${sessionId}`,
      `Memory enabled: ${cfg.enabled}`,
      `Extract enabled: ${cfg.extract.enabled}`,
      `Session enabled: ${cfg.session.enabled}`,
      `Dream enabled: ${cfg.dream.enabled}`,
      `Orchestrator inProgress: ${status.inProgress}`,
      `Last run: ${status.lastRunAt ? new Date(status.lastRunAt).toISOString() : 'N/A'}`,
      '',
      '--- Snapshot ---',
      `Has snapshot: ${Boolean(snapshot)}`,
      `Has prompt: ${Boolean(snapshot?.prompt)}`,
      `Has report: ${Boolean(snapshot?.report)}`,
      '',
      '--- Last Build Report ---',
      report
        ? report.layers.map((l) => `${l.name}: ${l.charsAfter} chars${l.truncated ? ' (truncated)' : ''}`).join('\n')
        : '(none)',
      '',
      '--- Recent Telemetry ---',
      events.map((e) => `${e.event} ${e.pipeline} ${e.skip_reason ?? ''}`.trim()).join('\n') || '(none)',
    ];

    return lines.join('\n');
  }
}
