import { Injectable, inject } from '@angular/core';
import { WorkbenchContextService } from '../services/workbench-context.service';
import { TerminalDisplayDebugService } from '../services/terminal/terminal-display-debug.service';
import { SessionReplayCoordinatorService } from '../services/terminal/session-replay-coordinator.service';

@Injectable({ providedIn: 'root' })
export class DebugWorkbenchAdapterService {
  private readonly context = inject(WorkbenchContextService);
  private readonly debug = inject(TerminalDisplayDebugService);
  private readonly replay = inject(SessionReplayCoordinatorService);

  snapshot(sessionId: string) {
    return {
      context: this.context.capture(sessionId),
      report: this.debug.generateFullReport(sessionId),
      replay: {
        isReplaying: this.replay.isReplaying(),
        mode: this.replay.replayMode(),
        frameCount: this.replay.frames().length,
        currentFrameIndex: this.replay.currentFrameIndex(),
      },
    };
  }

  restore(sessionId: string): void {
    this.context.capture(sessionId);
  }
}
