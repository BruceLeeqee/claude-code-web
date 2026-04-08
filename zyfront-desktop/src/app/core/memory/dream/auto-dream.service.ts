import { Injectable } from '@angular/core';
import { DirectoryManagerService } from '../../directory-manager.service';
import { MemoryConfigService } from '../memory.config';
import { MemoryTelemetryService } from '../memory.telemetry';
import { TeamMemorySyncService } from '../team/team-memory-sync.service';
import { type MemoryPipelineResult, type TurnContext } from '../memory.types';

@Injectable({ providedIn: 'root' })
export class AutoDreamService {
  private inProgress = false;
  private lastRunAtMs = 0;
  private recentSessionIds = new Set<string>();

  constructor(
    private readonly directoryManager: DirectoryManagerService,
    private readonly configService: MemoryConfigService,
    private readonly telemetry: MemoryTelemetryService,
    private readonly teamSync: TeamMemorySyncService,
  ) {}

  async run(turn: TurnContext): Promise<MemoryPipelineResult> {
    const startedAt = Date.now();
    const cfg = this.configService.getConfig().dream;

    if (this.inProgress) {
      return {
        pipeline: 'dream',
        status: 'skipped',
        reason: 'in_progress',
        durationMs: Date.now() - startedAt,
      };
    }

    this.recentSessionIds.add(turn.sessionId);

    const minHoursMs = Math.max(1, cfg.minHours) * 60 * 60 * 1000;
    if (this.lastRunAtMs > 0 && Date.now() - this.lastRunAtMs < minHoursMs) {
      return {
        pipeline: 'dream',
        status: 'skipped',
        reason: 'time_threshold_not_met',
        durationMs: Date.now() - startedAt,
      };
    }

    if (this.recentSessionIds.size < Math.max(1, cfg.minSessions)) {
      return {
        pipeline: 'dream',
        status: 'skipped',
        reason: 'session_threshold_not_met',
        durationMs: Date.now() - startedAt,
      };
    }

    this.inProgress = true;
    try {
      await this.directoryManager.ensureVaultReady();
      const relDir = await this.directoryManager.getRelativePathByKey('agent-long-term');
      const lockPath = `${relDir}/.dream.lock`;
      const outPath = `${relDir}/AUTO_DREAM.md`;
      this.assertSafeRelativePath(lockPath);
      this.assertSafeRelativePath(outPath);

      const lockRead = await window.zytrader.fs.read(lockPath, { scope: 'vault' });
      if (lockRead.ok && lockRead.content.trim().length > 0) {
        return {
          pipeline: 'dream',
          status: 'skipped',
          reason: 'lock_held',
          durationMs: Date.now() - startedAt,
        };
      }

      const lockWrite = await window.zytrader.fs.write(
        lockPath,
        JSON.stringify({
          startedAt: new Date().toISOString(),
          sessionId: turn.sessionId,
          turnId: turn.turnId,
        }, null, 2),
        { scope: 'vault' },
      );
      if (!lockWrite.ok) {
        throw new Error('failed_to_acquire_dream_lock');
      }

      const old = await window.zytrader.fs.read(outPath, { scope: 'vault' });
      const base = old.ok ? old.content : '# AUTO DREAM\n\n';
      const summary = this.buildDreamSummary(turn);
      const next = `${base.trimEnd()}\n\n## ${new Date().toISOString()}\n${summary}\n`;

      const write = await window.zytrader.fs.write(outPath, next, { scope: 'vault' });
      if (!write.ok) {
        throw new Error('failed_to_write_auto_dream');
      }

      await window.zytrader.fs.write(lockPath, '', { scope: 'vault' });

      this.lastRunAtMs = Date.now();
      this.recentSessionIds = new Set([turn.sessionId]);

      const result: MemoryPipelineResult = {
        pipeline: 'dream',
        status: 'succeeded',
        reason: 'auto_dream_written',
        durationMs: Date.now() - startedAt,
        filesTouched: [outPath],
      };

      this.teamSync.notifyWrite();

      this.telemetry.track({
        event: 'run',
        pipeline: 'dream',
        gate_passed: true,
        skip_reason: 'none',
        duration_ms: result.durationMs,
        messages_seen: turn.messages.length,
        tool_calls_seen: 0,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      this.telemetry.track({
        event: 'error',
        pipeline: 'dream',
        gate_passed: true,
        skip_reason: 'dream_error',
        duration_ms: Date.now() - startedAt,
        messages_seen: turn.messages.length,
        tool_calls_seen: 0,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        timestamp: Date.now(),
      });
      return {
        pipeline: 'dream',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown_error',
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.inProgress = false;
    }
  }

  private buildDreamSummary(turn: TurnContext): string {
    const tail = turn.messages.slice(-12);
    const userCount = tail.filter((m) => m.role === 'user').length;
    const assistantCount = tail.filter((m) => m.role === 'assistant').length;
    const lastAssistant = [...tail].reverse().find((m) => m.role === 'assistant');
    return [
      `- session: ${turn.sessionId}`,
      `- turn: ${turn.turnId}`,
      `- messages(user/assistant): ${userCount}/${assistantCount}`,
      `- insight: ${String(lastAssistant?.content ?? '').slice(0, 400)}`,
    ].join('\n');
  }

  private assertSafeRelativePath(relPath: string): void {
    if (!relPath || relPath.includes('\0')) {
      throw new Error('invalid_dream_path');
    }
    const normalized = relPath.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.includes('../') || normalized.includes('..\\')) {
      throw new Error('unsafe_dream_path');
    }
  }
}
