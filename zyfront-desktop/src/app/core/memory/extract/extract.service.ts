import { Injectable } from '@angular/core';
import { DirectoryManagerService } from '../../directory-manager.service';
import { MemoryConfigService } from '../memory.config';
import { MemoryTelemetryService } from '../memory.telemetry';
import { TeamMemorySyncService } from '../team/team-memory-sync.service';
import { type MemoryPipelineResult, type TurnContext, type TurnMessage } from '../memory.types';

@Injectable({ providedIn: 'root' })
export class ExtractService {
  private inProgress = false;
  private eligibleTurns = 0;
  private lastCursorMessageId?: string;
  private lastSummaryFingerprint?: string;

  constructor(
    private readonly configService: MemoryConfigService,
    private readonly telemetry: MemoryTelemetryService,
    private readonly directoryManager: DirectoryManagerService,
    private readonly teamSync: TeamMemorySyncService,
  ) {}

  async run(turn: TurnContext): Promise<MemoryPipelineResult> {
    const startedAt = Date.now();
    const cfg = this.configService.getConfig().extract;

    if (this.inProgress) {
      return {
        pipeline: 'extract',
        status: 'skipped',
        reason: 'in_progress',
        durationMs: Date.now() - startedAt,
      };
    }

    this.eligibleTurns += 1;
    if (this.eligibleTurns < Math.max(1, cfg.everyNTurns)) {
      this.telemetry.track({
        event: 'run',
        pipeline: 'extract',
        gate_passed: true,
        skip_reason: 'turn_throttled',
        duration_ms: Date.now() - startedAt,
        messages_seen: turn.messages.length,
        tool_calls_seen: 0,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        timestamp: Date.now(),
      });
      return {
        pipeline: 'extract',
        status: 'skipped',
        reason: 'turn_throttled',
        durationMs: Date.now() - startedAt,
      };
    }

    this.eligibleTurns = 0;
    this.inProgress = true;

    try {
      await this.directoryManager.ensureVaultReady();
      // Extract pipeline writes turn-level summary into short-term memory bucket.
      const relDir = await this.directoryManager.getRelativePathByKey('agent-short-term');

      const newMessages = this.sliceMessagesAfterCursor(turn.messages, this.lastCursorMessageId);
      if (newMessages.length === 0) {
        return {
          pipeline: 'extract',
          status: 'skipped',
          reason: 'no_new_messages_since_cursor',
          durationMs: Date.now() - startedAt,
        };
      }

      const summary = this.buildTurnSummary(newMessages);
      if (!summary) {
        return {
          pipeline: 'extract',
          status: 'skipped',
          reason: 'empty_turn_summary',
          durationMs: Date.now() - startedAt,
        };
      }

      const fingerprint = this.fingerprint(summary);
      if (fingerprint === this.lastSummaryFingerprint) {
        const lastMsg = turn.messages.at(-1);
        this.lastCursorMessageId = lastMsg?.id;
        return {
          pipeline: 'extract',
          status: 'skipped',
          reason: 'duplicate_summary',
          durationMs: Date.now() - startedAt,
        };
      }

      const memoryId = this.buildMemoryId(turn.turnId);
      const relPath = `${relDir}/${memoryId}.json`;
      this.assertSafeRelativePath(relPath);

      const nowIso = new Date().toISOString();
      const record = {
        id: memoryId,
        createTime: nowIso,
        updateTime: nowIso,
        type: 'turn-summary',
        format: 'json',
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        content: summary,
        source: 'extract-service-sprint3',
      };

      const write = await window.zytrader.fs.write(relPath, JSON.stringify(record, null, 2), { scope: 'vault' });
      if (!write.ok) {
        throw new Error('failed_to_write_extract_memory');
      }

      const indexPath = `${relDir}/MEMORY.md`;
      this.assertSafeRelativePath(indexPath);
      const readIndex = await window.zytrader.fs.read(indexPath, { scope: 'vault' });
      const oldIndex = readIndex.ok ? readIndex.content : '# MEMORY\n\n';
      const line = `- ${nowIso} | ${memoryId} | session=${turn.sessionId} | turn=${turn.turnId}`;
      const nextIndex = `${oldIndex.trimEnd()}\n${line}\n`;
      await window.zytrader.fs.write(indexPath, nextIndex, { scope: 'vault' });

      const lastMsg = turn.messages.at(-1);
      this.lastCursorMessageId = lastMsg?.id;
      this.lastSummaryFingerprint = fingerprint;

      const result: MemoryPipelineResult = {
        pipeline: 'extract',
        status: 'succeeded',
        reason: 'memory_written',
        durationMs: Date.now() - startedAt,
        filesTouched: [relPath, indexPath],
      };

      this.teamSync.notifyWrite();

      this.telemetry.track({
        event: 'run',
        pipeline: 'extract',
        gate_passed: true,
        skip_reason: 'none',
        duration_ms: result.durationMs,
        messages_seen: newMessages.length,
        tool_calls_seen: 0,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      this.telemetry.track({
        event: 'error',
        pipeline: 'extract',
        gate_passed: true,
        skip_reason: 'extract_error',
        duration_ms: Date.now() - startedAt,
        messages_seen: turn.messages.length,
        tool_calls_seen: 0,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        timestamp: Date.now(),
      });
      return {
        pipeline: 'extract',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown_error',
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.inProgress = false;
    }
  }

  private buildMemoryId(turnId: string): string {
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `short-term-${ts}-${turnId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 32)}`;
  }

  private sliceMessagesAfterCursor(messages: TurnMessage[], cursorId?: string): TurnMessage[] {
    if (!cursorId) return messages;
    const idx = messages.findIndex((m) => m.id === cursorId);
    if (idx < 0) return messages;
    return messages.slice(idx + 1);
  }

  private buildTurnSummary(messages: TurnMessage[]): string {
    const recent = messages.slice(-8);
    if (recent.length === 0) return '';

    const lines = recent
      .map((m) => `[${m.role}] ${String(m.content ?? '').trim()}`)
      .filter((line) => line.length > 0)
      .slice(0, 8);

    return lines.join('\n');
  }

  private fingerprint(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `fp_${(hash >>> 0).toString(16)}`;
  }

  private assertSafeRelativePath(relPath: string): void {
    if (!relPath || relPath.includes('\0')) {
      throw new Error('invalid_memory_path');
    }
    const normalized = relPath.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.includes('../') || normalized.includes('..\\')) {
      throw new Error('unsafe_memory_path');
    }
  }
}
