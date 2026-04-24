import { Injectable, inject } from '@angular/core';
import { PromptBuildContextService } from '../../../../core/memory/prompt-build-context.service';
import { PromptDebugReportService } from '../../../../core/memory/prompt-debug-report.service';
import { TurnMetadataService } from './terminal/turn-metadata.service';

export interface WorkbenchContextSnapshot {
  sessionId: string;
  turnId?: string;
  userPrompt?: string;
  prompt?: string;
  debugReport?: string;
  generatedAt: number;
}

export interface WorkbenchDebugTabModel {
  title: string;
  report: string;
  sessionId: string;
  generatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class WorkbenchContextService {
  private readonly promptContext = inject(PromptBuildContextService);
  private readonly debugReport = inject(PromptDebugReportService);
  private readonly turnMeta = inject(TurnMetadataService);

  private readonly snapshots = new Map<string, WorkbenchContextSnapshot>();

  capture(sessionId: string): WorkbenchContextSnapshot {
    const currentTurnId = this.turnMeta.currentTurnId();
    const currentTurn = currentTurnId ? this.turnMeta.getTurn(currentTurnId) : null;
    const prompt = this.promptContext.getLastPrompt(sessionId);
    const debugReport = this.debugReport.buildTextReport(sessionId);

    const snapshot: WorkbenchContextSnapshot = {
      sessionId,
      turnId: currentTurn?.turnId,
      userPrompt: currentTurn?.userPrompt,
      prompt,
      debugReport,
      generatedAt: Date.now(),
    };

    this.snapshots.set(sessionId, snapshot);
    return snapshot;
  }

  getSnapshot(sessionId: string): WorkbenchContextSnapshot | null {
    return this.snapshots.get(sessionId) ?? null;
  }

  setDebugReport(sessionId: string, debugReport: string): void {
    const current = this.snapshots.get(sessionId) ?? {
      sessionId,
      generatedAt: Date.now(),
    };
    this.snapshots.set(sessionId, {
      ...current,
      debugReport,
      generatedAt: Date.now(),
    });
  }

  buildDebugTabModel(sessionId: string): WorkbenchDebugTabModel {
    const snapshot = this.capture(sessionId);
    return {
      title: 'Debug / Workbench',
      report: snapshot.debugReport ?? '',
      sessionId,
      generatedAt: snapshot.generatedAt,
    };
  }
}
