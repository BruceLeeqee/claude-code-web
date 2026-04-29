import { Injectable } from '@angular/core';
import { DirectoryManagerService } from './directory-manager.service';
import { MemoryOrchestratorService } from './memory/memory.orchestrator';
import { TeamMemorySyncService, type TeamSyncState } from './memory/team/team-memory-sync.service';
import { type MemoryPipelineStatus, type TurnContext } from './memory/memory.types';

export interface AgentShortTermMemory {
  id: string;
  createTime: string;
  updateTime: string;
  expireTime: string;
  context: string;
  userId?: string;
  sessionId?: string;
}

export interface AgentLongTermMemory {
  id: string;
  createTime: string;
  updateTime: string;
  type: string;
  format?: 'json' | 'md';
  content: unknown;
  relatedNotes?: string[];
  relatedMemory?: string[];
}

export interface AgentContextMemory {
  id: string;
  createTime: string;
  updateTime: string;
  context: string;
  sessionId?: string;
  relatedNotes?: string[];
}

type AgentMemoryType = 'short' | 'long' | 'context';

@Injectable({ providedIn: 'root' })
export class AgentMemoryService {
  constructor(
    private readonly directoryManager: DirectoryManagerService,
    private readonly memoryOrchestrator: MemoryOrchestratorService,
    private readonly teamSync: TeamMemorySyncService,
  ) {}

  private keyByType(type: AgentMemoryType): string {
    return type === 'short' ? 'agent-short-term' : type === 'long' ? 'agent-long-user' : 'agent-context';
  }

  private buildId(prefix: string, extra?: string): string {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
    const nonce = Math.random().toString(36).slice(2, 8);
    const suffix = extra ? `-${extra.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 24)}` : '';
    return `${prefix}-${ts}-${nonce}${suffix}`;
  }

  async writeShortTermMemory(
    payload: Omit<AgentShortTermMemory, 'id' | 'createTime' | 'updateTime' | 'expireTime'>,
  ): Promise<AgentShortTermMemory> {
    await this.directoryManager.ensureVaultReady();
    const now = new Date();
    const id = this.buildId('short-term');
    const createTime = now.toISOString();
    const expireTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const record: AgentShortTermMemory = {
      id,
      createTime,
      updateTime: createTime,
      expireTime,
      ...payload,
    };

    const relDir = await this.directoryManager.getRelativePathByKey('agent-short-term');
    const relPath = `${relDir}/${id}.json`;
    const write = await window.zytrader.fs.write(relPath, JSON.stringify(record, null, 2), { scope: 'vault' });
    if (!write.ok) throw new Error('failed to write short-term memory');
    return record;
  }

  async writeLongTermMemory(
    payload: Omit<AgentLongTermMemory, 'id' | 'createTime' | 'updateTime'>,
  ): Promise<AgentLongTermMemory> {
    await this.directoryManager.ensureVaultReady();
    const now = new Date().toISOString();
    const id = this.buildId('long-term', payload.type || 'memory');
    const record: AgentLongTermMemory = {
      id,
      createTime: now,
      updateTime: now,
      relatedNotes: [],
      relatedMemory: [],
      ...payload,
    };

    const relDir = await this.directoryManager.getRelativePathByKey('agent-long-user');
    const ext = record.format === 'md' ? 'md' : 'json';
    const relPath = `${relDir}/${id}.${ext}`;
    const content = ext === 'json' ? JSON.stringify(record, null, 2) : this.toMarkdownMemory(record);
    const write = await window.zytrader.fs.write(relPath, content, { scope: 'vault' });
    if (!write.ok) throw new Error('failed to write long-term memory');
    return record;
  }

  async readMemories(type: AgentMemoryType, keyword?: string): Promise<unknown[]> {
    await this.directoryManager.ensureVaultReady();
    const dirs =
      type === 'long'
        ? await Promise.all(
            ['agent-long-user', 'agent-long-feedback', 'agent-long-project', 'agent-long-reference'].map((k) =>
              this.directoryManager.getRelativePathByKey(k),
            ),
          )
        : [await this.directoryManager.getRelativePathByKey(this.keyByType(type))];

    const out: unknown[] = [];
    for (const relDir of dirs) {
      const listed = await window.zytrader.fs.list(relDir, { scope: 'vault' });
      if (!listed.ok) continue;
      for (const e of listed.entries) {
        if (e.type !== 'file') continue;
        const rel = `${relDir}/${e.name}`;
        const read = await window.zytrader.fs.read(rel, { scope: 'vault' });
        if (!read.ok) continue;
        const maybe = this.parseMemoryFile(read.content);
        if (!keyword || JSON.stringify(maybe).includes(keyword)) out.push(maybe);
      }
    }
    return out;
  }

  async readMemoryById(type: AgentMemoryType, id: string): Promise<unknown | null> {
    await this.directoryManager.ensureVaultReady();
    const dirs =
      type === 'long'
        ? await Promise.all(
            ['agent-long-user', 'agent-long-feedback', 'agent-long-project', 'agent-long-reference'].map((k) =>
              this.directoryManager.getRelativePathByKey(k),
            ),
          )
        : [await this.directoryManager.getRelativePathByKey(this.keyByType(type))];

    for (const relDir of dirs) {
      for (const ext of ['json', 'md']) {
        const read = await window.zytrader.fs.read(`${relDir}/${id}.${ext}`, { scope: 'vault' });
        if (read.ok) return this.parseMemoryFile(read.content);
      }
    }
    return null;
  }

  async updateMemory(type: AgentMemoryType, id: string, patch: Record<string, unknown>): Promise<boolean> {
    await this.directoryManager.ensureVaultReady();
    const dirs =
      type === 'long'
        ? await Promise.all(
            ['agent-long-user', 'agent-long-feedback', 'agent-long-project', 'agent-long-reference'].map((k) =>
              this.directoryManager.getRelativePathByKey(k),
            ),
          )
        : [await this.directoryManager.getRelativePathByKey(this.keyByType(type))];

    for (const relDir of dirs) {
      for (const ext of ['json', 'md']) {
        const relPath = `${relDir}/${id}.${ext}`;
        const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
        if (!read.ok) continue;

        if (ext === 'md') {
          const parsed = this.parseMarkdownMemory(read.content);
          if (!parsed) return false;
          const next = { ...parsed, ...patch, updateTime: new Date().toISOString() };
          const write = await window.zytrader.fs.write(relPath, this.toMarkdownMemory(next), { scope: 'vault' });
          return Boolean(write.ok);
        }

        const current = this.parseMemoryFile(read.content);
        if (typeof current !== 'object' || !current) return false;
        const next = { ...(current as Record<string, unknown>), ...patch, updateTime: new Date().toISOString() };
        const write = await window.zytrader.fs.write(relPath, JSON.stringify(next, null, 2), { scope: 'vault' });
        return Boolean(write.ok);
      }
    }

    return false;
  }

  async relateNoteToMemory(memoryId: string, notePath: string): Promise<boolean> {
    const found = await this.readMemoryById('long', memoryId);
    if (!found || typeof found !== 'object') return false;
    const obj = found as Record<string, unknown>;
    const related = Array.isArray(obj['relatedNotes']) ? (obj['relatedNotes'] as string[]) : [];
    const next = Array.from(new Set([...related, notePath]));
    return this.updateMemory('long', memoryId, { relatedNotes: next });
  }

  async getShortTermStats(): Promise<{ count: number; latestUpdateTime: string | null }> {
    const memories = (await this.readMemories('short')) as Array<{ updateTime?: string }>;
    const latestUpdateTime = memories
      .map((m) => m?.updateTime)
      .filter((x): x is string => typeof x === 'string')
      .sort((a, b) => (a > b ? -1 : 1))[0] ?? null;

    return { count: memories.length, latestUpdateTime };
  }

  private parseMemoryFile(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      const md = this.parseMarkdownMemory(content);
      return md ?? content;
    }
  }

  private parseMarkdownMemory(content: string): Record<string, unknown> | null {
    const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!m?.[1]) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }

  private toMarkdownMemory(obj: AgentLongTermMemory | Record<string, unknown>): string {
    const map = obj as Record<string, unknown>;
    const content = map['content'];
    const body = typeof content === 'string' ? content : JSON.stringify(content ?? {}, null, 2);
    return `---\n${JSON.stringify(map, null, 2)}\n---\n\n${body}`;
  }

  /** Sprint 1: memory pipeline runtime status */
  getPipelineStatus(): MemoryPipelineStatus {
    return this.memoryOrchestrator.getStatus();
  }

  async runMemoryPipelineNow(turn?: TurnContext): Promise<void> {
    const now = Date.now();
    const fallbackTurn: TurnContext = {
      sessionId: 'manual-session',
      turnId: `manual-${now}`,
      timestamp: now,
      messages: [
        {
          id: `manual-${now}`,
          role: 'system',
          content: 'Manual memory pipeline run',
          timestamp: now,
        },
      ],
    };
    await this.memoryOrchestrator.runNow(turn ?? fallbackTurn);
  }

  /**
   * 每轮对话落盘一条「项目长期记忆」到固定文件，避免仅依赖分散 JSON 导致用户看到“长期记忆文件为空”。
   */
  async appendProjectLongTermTurn(turn: TurnContext): Promise<{ ok: boolean; path?: string }> {
    await this.directoryManager.ensureVaultReady();
    const relDir = await this.directoryManager.getRelativePathByKey('agent-long-project');
    const relPath = `${relDir}/PROJECT-LONG-TERM-MEMORY.md`;

    const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
    const old = read.ok
      ? read.content
      : '# Project Long-Term Memory\n\n> Auto-appended after each successful conversation turn.\n';

    const lastUser = [...turn.messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...turn.messages].reverse().find((m) => m.role === 'assistant');

    const allUserMsgs = turn.messages.filter((m) => m.role === 'user');
    const allAssistantMsgs = turn.messages.filter((m) => m.role === 'assistant');

    const userText = allUserMsgs.length > 1
      ? allUserMsgs.map((m, i) => `[${i + 1}] ${String(m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}`).join(' | ')
      : String(lastUser?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 320);
    const assistantText = allAssistantMsgs.length > 1
      ? allAssistantMsgs.map((m, i) => `[${i + 1}] ${String(m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 350)}`).join(' | ')
      : String(lastAssistant?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 560);

    const block = [
      `## ${new Date(turn.timestamp).toISOString()} / ${turn.turnId}`,
      `- session: ${turn.sessionId}`,
      `- user (${allUserMsgs.length}): ${userText || '(empty)'}`,
      `- assistant (${allAssistantMsgs.length}): ${assistantText || '(empty)'}`,
      '',
    ].join('\n');

    const next = `${old.trimEnd()}\n\n${block}`;
    const write = await window.zytrader.fs.write(relPath, next, { scope: 'vault' });
    return { ok: Boolean(write.ok), path: relPath };
  }

  getTeamSyncState(): TeamSyncState {
    return this.teamSync.getState();
  }

  async retryTeamSyncNow(): Promise<void> {
    await this.teamSync.retryNow();
  }
}
