import { Injectable, inject } from '@angular/core';
import { PromptBuildContextService } from '../../../../core/memory/prompt-build-context.service';
import { PromptDebugReportService } from '../../../../core/memory/prompt-debug-report.service';

@Injectable({ providedIn: 'root' })
export class DebugPromptAdapterService {
  private readonly context = inject(PromptBuildContextService);
  private readonly report = inject(PromptDebugReportService);

  snapshot(sessionId: string) {
    const snap = this.context.getSnapshot(sessionId);
    const report = snap?.report ?? this.context.getLastReport(sessionId);
    const textReport = this.report.buildTextReport(sessionId);
    return { snap, report, textReport };
  }

  rebuild(sessionId: string): Promise<void> {
    const last = this.context.getSnapshot(sessionId);
    return this.context.build({
      sessionId,
      userQuery: last?.userQuery ?? 'debug prompt rebuild',
      systemPrompt: last?.systemPrompt ?? '',
      builtAt: Date.now(),
    }).then(() => void 0);
  }
}
