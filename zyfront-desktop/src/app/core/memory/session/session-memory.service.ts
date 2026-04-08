import { Injectable } from '@angular/core';
import { DirectoryManagerService } from '../../directory-manager.service';
import { MemoryTelemetryService } from '../memory.telemetry';
import { TeamMemorySyncService } from '../team/team-memory-sync.service';
import { type MemoryPipelineResult, type TurnContext } from '../memory.types';

@Injectable({ providedIn: 'root' })
export class SessionMemoryService {
  private inProgress = false;

  constructor(
    private readonly directoryManager: DirectoryManagerService,
    private readonly telemetry: MemoryTelemetryService,
    private readonly teamSync: TeamMemorySyncService,
  ) {}

  async run(turn: TurnContext): Promise<MemoryPipelineResult> {
    const startedAt = Date.now();

    if (this.inProgress) {
      return {
        pipeline: 'session',
        status: 'skipped',
        reason: 'in_progress',
        durationMs: Date.now() - startedAt,
      };
    }

    this.inProgress = true;
    try {
      await this.directoryManager.ensureVaultReady();
      const relDir = await this.directoryManager.getRelativePathByKey('agent-context');
      const relPath = `${relDir}/sessions/${turn.sessionId}.md`;
      this.assertSafeRelativePath(relPath);

      const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
      const old = read.ok ? read.content : `# Session Memory\n\nsessionId: ${turn.sessionId}\n\n`;

      const lastUser = [...turn.messages].reverse().find((m) => m.role === 'user');
      const lastAssistant = [...turn.messages].reverse().find((m) => m.role === 'assistant');
      const block = [
        `## ${new Date(turn.timestamp).toISOString()} / ${turn.turnId}`,
        `- user: ${String(lastUser?.content ?? '').slice(0, 220)}`,
        `- assistant: ${String(lastAssistant?.content ?? '').slice(0, 320)}`,
        '',
      ].join('\n');

      const next = `${old.trimEnd()}\n\n${block}`;
      const write = await window.zytrader.fs.write(relPath, next, { scope: 'vault' });
      if (!write.ok) {
        throw new Error('failed_to_write_session_memory');
      }

      const result: MemoryPipelineResult = {
        pipeline: 'session',
        status: 'succeeded',
        reason: 'session_memory_written',
        durationMs: Date.now() - startedAt,
        filesTouched: [relPath],
      };

      this.teamSync.notifyWrite();

      this.telemetry.track({
        event: 'run',
        pipeline: 'session',
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
        pipeline: 'session',
        gate_passed: true,
        skip_reason: 'session_error',
        duration_ms: Date.now() - startedAt,
        messages_seen: turn.messages.length,
        tool_calls_seen: 0,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        timestamp: Date.now(),
      });
      return {
        pipeline: 'session',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown_error',
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.inProgress = false;
    }
  }

  private assertSafeRelativePath(relPath: string): void {
    if (!relPath || relPath.includes('\0')) {
      throw new Error('invalid_session_memory_path');
    }
    const normalized = relPath.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.includes('../') || normalized.includes('..\\')) {
      throw new Error('unsafe_session_memory_path');
    }
  }
}
