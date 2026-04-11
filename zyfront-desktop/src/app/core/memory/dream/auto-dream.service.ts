import { Injectable } from '@angular/core';
import { DirectoryManagerService } from '../../directory-manager.service';
import { MemoryConfigService } from '../memory.config';
import { MemoryTelemetryService } from '../memory.telemetry';
import { TeamMemorySyncService } from '../team/team-memory-sync.service';
import { type MemoryPipelineResult, type TurnContext } from '../memory.types';

interface DreamStateFile {
  lastConsolidatedAtMs?: number;
}

@Injectable({ providedIn: 'root' })
export class AutoDreamService {
  private inProgress = false;
  private recentSessionIds = new Set<string>();
  /** 与参考实现 SESSION_SCAN_INTERVAL 类似：限制做梦管线被评估的频率 */
  private lastProbeAtMs = 0;

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

    const scanMs = Math.max(1, cfg.scanThrottleMinutes) * 60 * 1000;
    if (this.lastProbeAtMs > 0 && Date.now() - this.lastProbeAtMs < scanMs) {
      return {
        pipeline: 'dream',
        status: 'skipped',
        reason: 'dream_scan_throttled',
        durationMs: Date.now() - startedAt,
      };
    }
    this.lastProbeAtMs = Date.now();

    this.recentSessionIds.add(turn.sessionId);

    this.inProgress = true;
    let lockPath = '';
    try {
      await this.directoryManager.ensureVaultReady();

      const metaRel = await this.directoryManager.getRelativePathByKey('agent-memory-index');
      const statePath = `${metaRel}/.dream.state.json`;
      this.assertSafeRelativePath(statePath);

      const stateRead = await window.zytrader.fs.read(statePath, { scope: 'vault' });
      let lastConsolidatedAtMs = 0;
      if (stateRead.ok && stateRead.content.trim()) {
        try {
          const doc = JSON.parse(stateRead.content) as DreamStateFile;
          if (typeof doc.lastConsolidatedAtMs === 'number' && Number.isFinite(doc.lastConsolidatedAtMs)) {
            lastConsolidatedAtMs = doc.lastConsolidatedAtMs;
          }
        } catch {
          /* ignore corrupt state */
        }
      }

      const minHoursMs = Math.max(1, cfg.minHours) * 60 * 60 * 1000;
      if (lastConsolidatedAtMs > 0 && Date.now() - lastConsolidatedAtMs < minHoursMs) {
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

      const relDir = await this.directoryManager.getRelativePathByKey('agent-long-user');
      lockPath = `${relDir}/.dream.lock`;
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
        JSON.stringify(
          {
            startedAt: new Date().toISOString(),
            sessionId: turn.sessionId,
            turnId: turn.turnId,
          },
          null,
          2,
        ),
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

      const nowMs = Date.now();
      const stateWrite = await window.zytrader.fs.write(
        statePath,
        JSON.stringify({ lastConsolidatedAtMs: nowMs } satisfies DreamStateFile, null, 2),
        { scope: 'vault' },
      );
      if (!stateWrite.ok) {
        throw new Error('failed_to_write_dream_state');
      }

      await window.zytrader.fs.write(lockPath, '', { scope: 'vault' });

      this.recentSessionIds = new Set([turn.sessionId]);

      const result: MemoryPipelineResult = {
        pipeline: 'dream',
        status: 'succeeded',
        reason: 'auto_dream_written',
        durationMs: Date.now() - startedAt,
        filesTouched: [outPath, statePath],
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
      if (lockPath) {
        try {
          await window.zytrader.fs.write(lockPath, '', { scope: 'vault' });
        } catch {
          /* best-effort release */
        }
      }
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
