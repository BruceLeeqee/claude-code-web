import { Injectable } from '@angular/core';
import { DirectoryManagerService } from '../../directory-manager.service';
import { MemoryConfigService } from '../memory.config';
import { MemoryTelemetryService } from '../memory.telemetry';
import { TeamMemorySyncService } from '../team/team-memory-sync.service';
import { type MemoryPipelineResult, type TurnContext, type TurnMessage } from '../memory.types';

interface ExtractSessionState {
  inProgress: boolean;
  eligibleTurns: number;
  lastCursorMessageId?: string;
  lastSummaryFingerprint?: string;
  pendingTurn?: TurnContext;
}

@Injectable({ providedIn: 'root' })
export class ExtractService {
  private readonly sessionStates = new Map<string, ExtractSessionState>();

  constructor(
    private readonly configService: MemoryConfigService,
    private readonly telemetry: MemoryTelemetryService,
    private readonly directoryManager: DirectoryManagerService,
    private readonly teamSync: TeamMemorySyncService,
  ) {}

  async run(turn: TurnContext): Promise<MemoryPipelineResult> {
    const startedAt = Date.now();
    const cfg = this.configService.getConfig().extract;
    const state = this.getSessionState(turn.sessionId);

    if (state.inProgress) {
      state.pendingTurn = turn;
      return {
        pipeline: 'extract',
        status: 'skipped',
        reason: 'in_progress_coalesced',
        durationMs: Date.now() - startedAt,
      };
    }

    state.eligibleTurns += 1;
    if (state.eligibleTurns < Math.max(1, cfg.everyNTurns)) {
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

    state.eligibleTurns = 0;
    state.inProgress = true;

    try {
      await this.directoryManager.ensureVaultReady();
      const relDir = await this.directoryManager.getRelativePathByKey('agent-short-term');

      const newMessages = this.sliceMessagesAfterCursor(turn.messages, state.lastCursorMessageId);
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
      if (fingerprint === state.lastSummaryFingerprint) {
        const lastMsg = turn.messages.at(-1);
        state.lastCursorMessageId = lastMsg?.id;
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

      const longTermTouched = await this.writeLongTermMemoriesFromTurn(turn, newMessages);

      const lastMsg = turn.messages.at(-1);
      state.lastCursorMessageId = lastMsg?.id;
      state.lastSummaryFingerprint = fingerprint;

      const result: MemoryPipelineResult = {
        pipeline: 'extract',
        status: 'succeeded',
        reason: 'memory_written',
        durationMs: Date.now() - startedAt,
        filesTouched: [relPath, indexPath, ...longTermTouched],
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
      state.inProgress = false;
      const trailing = state.pendingTurn;
      state.pendingTurn = undefined;
      if (trailing) {
        queueMicrotask(() => {
          void this.run(trailing);
        });
      }
    }
  }

  private getSessionState(sessionId: string): ExtractSessionState {
    const existing = this.sessionStates.get(sessionId);
    if (existing) return existing;
    const created: ExtractSessionState = {
      inProgress: false,
      eligibleTurns: 0,
    };
    this.sessionStates.set(sessionId, created);
    return created;
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

  private async writeLongTermMemoriesFromTurn(turn: TurnContext, messages: TurnMessage[]): Promise<string[]> {
    const touched: string[] = [];
    const indexPatches: Array<{ type: 'user' | 'feedback' | 'project' | 'reference'; topicKey: string; path: string; updatedAt: string }> = [];
    const userMsg = [...messages].reverse().find((m) => m.role === 'user');
    const assistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
    const userText = String(userMsg?.content ?? '').trim();
    const assistantText = String(assistantMsg?.content ?? '').trim();
    if (!userText && !assistantText) return touched;

    const candidates = [
      this.buildLongTermCandidate('user', turn, userText, assistantText),
      this.buildLongTermCandidate('feedback', turn, userText, assistantText),
      this.buildLongTermCandidate('project', turn, userText, assistantText),
      this.buildLongTermCandidate('reference', turn, userText, assistantText),
    ].filter(
      (x): x is { type: 'user' | 'feedback' | 'project' | 'reference'; content: string; topicKey: string } =>
        Boolean(x),
    );

    for (const c of candidates) {
      const relDir = await this.resolveLongTermDir(c.type);
      const existing = await this.findLongTermMemoryByTopicKey(relDir, c.topicKey);
      const memoryId = existing?.id ?? this.buildLongTermId(c.type, turn.turnId);
      const file = `${relDir}/${memoryId}.md`;
      this.assertSafeRelativePath(file);

      const createdAt = existing?.createdAt ?? new Date(turn.timestamp).toISOString();
      const updatedAt = new Date(turn.timestamp).toISOString();
      const frontmatter = [
        '---',
        `name: ${memoryId}`,
        `description: ${c.type} memory from ${turn.turnId}`,
        `type: ${c.type}`,
        `topicKey: ${c.topicKey}`,
        `createdAt: ${createdAt}`,
        `updatedAt: ${updatedAt}`,
        `sourceSession: ${turn.sessionId}`,
        `sourceTurn: ${turn.turnId}`,
        '---',
        '',
      ].join('\n');
      const body = `${frontmatter}${c.content}\n`;
      const w = await window.zytrader.fs.write(file, body, { scope: 'vault' });
      if (w.ok) {
        touched.push(file);
        indexPatches.push({ type: c.type, topicKey: c.topicKey, path: file, updatedAt });
      }
    }

    if (indexPatches.length > 0) {
      const topicIndexFile = await this.updateTopicIndex(indexPatches);
      if (topicIndexFile) touched.push(topicIndexFile);
      const timeIndexFile = await this.updateTimeIndex(indexPatches);
      if (timeIndexFile) touched.push(timeIndexFile);
      const manifestFile = await this.updateManifest(indexPatches);
      if (manifestFile) touched.push(manifestFile);
    }

    return touched;
  }

  private buildLongTermCandidate(
    type: 'user' | 'feedback' | 'project' | 'reference',
    turn: TurnContext,
    userText: string,
    assistantText: string,
  ): { type: 'user' | 'feedback' | 'project' | 'reference'; content: string; topicKey: string } | null {
    const compactUser = userText.replace(/\s+/g, ' ').slice(0, 280);
    const compactAsst = assistantText.replace(/\s+/g, ' ').slice(0, 360);
    if (type === 'user' && !/(我是|I am|my role|偏好|习惯|负责|经验|背景)/i.test(userText)) return null;
    if (type === 'feedback' && !/(不要|别|请|建议|prefer|should|must|风格|格式)/i.test(userText)) return null;
    if (type === 'project' && !/(项目|计划|里程碑|发布|deadline|freeze|roadmap|本周|下周|生成|创建|新增|添加|角色|文件|配置|编写|实现)/i.test(userText)) return null;
    if (type === 'reference' && !/(http|链接|文档|Linear|Jira|Grafana|看板|地址)/i.test(userText)) return null;

    const content = [
      `Fact: ${compactUser || '(empty user)'}`,
      `Why: Captured from turn ${turn.turnId} for long-term retrieval.`,
      `How to apply: Use with current repo state verification before acting.`,
      compactAsst ? `Assistant context: ${compactAsst}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const topicSource = `${type}|${compactUser.slice(0, 120).toLowerCase()}|${turn.turnId}`;
    const topicKey = this.fingerprint(topicSource).slice(0, 18);
    return { type, content, topicKey };
  }

  private async resolveLongTermDir(type: 'user' | 'feedback' | 'project' | 'reference'): Promise<string> {
    if (type === 'user') return this.directoryManager.getRelativePathByKey('agent-long-user');
    if (type === 'feedback') return this.directoryManager.getRelativePathByKey('agent-long-feedback');
    if (type === 'project') return this.directoryManager.getRelativePathByKey('agent-long-project');
    return this.directoryManager.getRelativePathByKey('agent-long-reference');
  }

  private async findLongTermMemoryByTopicKey(
    relDir: string,
    topicKey: string,
  ): Promise<{ id: string; createdAt?: string } | null> {
    const listed = await window.zytrader.fs.list(relDir, { scope: 'vault' });
    if (!listed.ok) return null;

    for (const e of listed.entries) {
      if (e.type !== 'file' || !/\.md$/i.test(e.name)) continue;
      const path = `${relDir}/${e.name}`;
      const read = await window.zytrader.fs.read(path, { scope: 'vault' });
      if (!read.ok) continue;
      const meta = this.parseYamlLikeFrontmatter(read.content);
      if (meta['topicKey'] !== topicKey) continue;
      const id = e.name.replace(/\.md$/i, '');
      const createdAt = typeof meta['createdAt'] === 'string' ? meta['createdAt'] : undefined;
      return { id, createdAt };
    }

    return null;
  }

  private parseYamlLikeFrontmatter(text: string): Record<string, string> {
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m?.[1]) return {};
    const out: Record<string, string> = {};
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) out[k] = v;
    }
    return out;
  }

  private async updateTopicIndex(
    patches: Array<{ type: 'user' | 'feedback' | 'project' | 'reference'; topicKey: string; path: string; updatedAt: string }>,
  ): Promise<string | null> {
    const metaRel = await this.directoryManager.getRelativePathByKey('agent-memory-index');
    const indexPath = `${metaRel}/topic-index.json`;
    this.assertSafeRelativePath(indexPath);

    const read = await window.zytrader.fs.read(indexPath, { scope: 'vault' });
    const base: {
      updatedAt?: string;
      topics?: Record<string, { type: string; path: string; updatedAt: string }>;
    } = read.ok
      ? (() => {
          try {
            return JSON.parse(read.content) as {
              updatedAt?: string;
              topics?: Record<string, { type: string; path: string; updatedAt: string }>;
            };
          } catch {
            return {};
          }
        })()
      : {};

    const topics = { ...(base.topics ?? {}) };
    for (const p of patches) {
      topics[p.topicKey] = {
        type: p.type,
        path: p.path,
        updatedAt: p.updatedAt,
      };
    }

    const doc = {
      updatedAt: new Date().toISOString(),
      topics,
    };

    const write = await window.zytrader.fs.write(indexPath, JSON.stringify(doc, null, 2), { scope: 'vault' });
    if (!write.ok) return null;
    return indexPath;
  }

  private async updateTimeIndex(
    patches: Array<{ type: 'user' | 'feedback' | 'project' | 'reference'; topicKey: string; path: string; updatedAt: string }>,
  ): Promise<string | null> {
    const metaRel = await this.directoryManager.getRelativePathByKey('agent-memory-index');
    const indexPath = `${metaRel}/time-index.json`;
    this.assertSafeRelativePath(indexPath);

    const read = await window.zytrader.fs.read(indexPath, { scope: 'vault' });
    const base: {
      updatedAt?: string;
      entries?: Array<{ type: string; topicKey: string; path: string; updatedAt: string }>;
    } = read.ok
      ? (() => {
          try {
            return JSON.parse(read.content) as {
              updatedAt?: string;
              entries?: Array<{ type: string; topicKey: string; path: string; updatedAt: string }>;
            };
          } catch {
            return {};
          }
        })()
      : {};

    const map = new Map<string, { type: string; topicKey: string; path: string; updatedAt: string }>();
    for (const e of base.entries ?? []) {
      const key = `${e.type}|${e.topicKey}`;
      if (!map.has(key)) map.set(key, e);
    }
    for (const p of patches) {
      const key = `${p.type}|${p.topicKey}`;
      map.set(key, {
        type: p.type,
        topicKey: p.topicKey,
        path: p.path,
        updatedAt: p.updatedAt,
      });
    }

    const entries = [...map.values()]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, 2000);

    const doc = {
      updatedAt: new Date().toISOString(),
      entries,
    };

    const write = await window.zytrader.fs.write(indexPath, JSON.stringify(doc, null, 2), { scope: 'vault' });
    if (!write.ok) return null;
    return indexPath;
  }

  private async updateManifest(
    patches: Array<{ type: 'user' | 'feedback' | 'project' | 'reference'; topicKey: string; path: string; updatedAt: string }>,
  ): Promise<string | null> {
    const metaRel = await this.directoryManager.getRelativePathByKey('agent-memory-index');
    const manifestPath = `${metaRel}/manifest.json`;
    this.assertSafeRelativePath(manifestPath);

    const read = await window.zytrader.fs.read(manifestPath, { scope: 'vault' });
    const base: {
      updatedAt?: string;
      lastExtractAt?: string;
      totals?: {
        all?: number;
        byType?: Record<string, number>;
      };
    } = read.ok
      ? (() => {
          try {
            return JSON.parse(read.content) as {
              updatedAt?: string;
              lastExtractAt?: string;
              totals?: {
                all?: number;
                byType?: Record<string, number>;
              };
            };
          } catch {
            return {};
          }
        })()
      : {};

    const topicIndexPath = `${metaRel}/topic-index.json`;
    const topicRead = await window.zytrader.fs.read(topicIndexPath, { scope: 'vault' });
    const topics: Record<string, { type: string; path: string; updatedAt: string }> = topicRead.ok
      ? (() => {
          try {
            const parsed = JSON.parse(topicRead.content) as {
              topics?: Record<string, { type: string; path: string; updatedAt: string }>;
            };
            return parsed.topics ?? {};
          } catch {
            return {};
          }
        })()
      : {};

    const byType: Record<string, number> = { user: 0, feedback: 0, project: 0, reference: 0 };
    for (const v of Object.values(topics)) {
      const t = String(v.type || '');
      byType[t] = (byType[t] ?? 0) + 1;
    }

    const lastExtractAt = patches
      .map((p) => p.updatedAt)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0] ?? base.lastExtractAt ?? new Date().toISOString();

    const doc = {
      updatedAt: new Date().toISOString(),
      lastExtractAt,
      totals: {
        all: Object.keys(topics).length,
        byType,
      },
    };

    const write = await window.zytrader.fs.write(manifestPath, JSON.stringify(doc, null, 2), { scope: 'vault' });
    if (!write.ok) return null;
    return manifestPath;
  }

  private buildLongTermId(type: 'user' | 'feedback' | 'project' | 'reference', turnId: string): string {
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const safeTurn = turnId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 24);
    return `long-${type}-${ts}-${safeTurn}`;
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
