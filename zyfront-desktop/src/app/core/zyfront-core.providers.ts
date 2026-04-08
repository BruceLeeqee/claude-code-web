/**
 * Angular DI 装配：向应用提供 `zyfront-core` 运行时（客户端、历史、工具、协调器、Assistant）。
 * 桌面版通过 Electron preload IPC 直接访问本地文件系统与终端能力。
 */
import { InjectionToken, Provider } from '@angular/core';
import {
  AssistantRuntime,
  bootstrapClaudeApi,
  BrowserLocalStorageAdapter,
  ClaudeClient,
  ContextManager,
  Coordinator,
  InMemoryHistoryStore,
  PlanEngine,
  PluginSystem,
  SkillSystem,
  ToolSystem,
  type AgentTool,
  type ClaudeApiBootstrapConfig,
  type JsonValue,
  type ModelConfig,
} from 'zyfront-core';

export interface ClaudeCoreConfig {
  api: ClaudeApiBootstrapConfig;
  defaultSessionId?: string;
}

export interface ClaudeCoreRuntime {
  client: ClaudeClient;
  context: ContextManager;
  history: InMemoryHistoryStore;
  tools: ToolSystem;
  skills: SkillSystem;
  plugins: PluginSystem;
  coordinator: Coordinator;
  assistant: AssistantRuntime;
}

export const CLAUDE_CORE_CONFIG = new InjectionToken<ClaudeCoreConfig>('CLAUDE_CORE_CONFIG');
export const CLAUDE_CLIENT = new InjectionToken<ClaudeClient>('CLAUDE_CLIENT');
export const CLAUDE_RUNTIME = new InjectionToken<ClaudeCoreRuntime>('CLAUDE_RUNTIME');
export const CLAUDE_DEFAULT_MODEL = new InjectionToken<ModelConfig>('CLAUDE_DEFAULT_MODEL');

function memoryKeyByType(memoryType: string, includeMeta = false): string {
  if (memoryType === 'long') return 'agent-long-term';
  if (memoryType === 'context') return 'agent-context';
  if (includeMeta && memoryType === 'meta') return 'agent-meta';
  return 'agent-short-term';
}

function buildLocalTools(): AgentTool[] {
  return [
    {
      name: 'fs.list',
      description:
        'List files and folders. scope "workspace" = code repo root; scope "vault" = Obsidian-Agent vault (INBOX, AGENT-MEMORY, etc.). Default workspace.',
      inputSchema: {
        type: 'object',
        properties: { dir: { type: 'string' }, scope: { type: 'string', enum: ['workspace', 'vault'] } },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const dir = String(o['dir'] ?? '.');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        return (await window.zytrader.fs.list(dir, { scope })) as unknown as JsonValue;
      },
    },
    {
      name: 'fs.read',
      description:
        'Read a UTF-8 text file. Path is relative to workspace root or vault root depending on scope (default workspace). Use scope vault for Agent memory under 02-AGENT-MEMORY.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, scope: { type: 'string', enum: ['workspace', 'vault'] } },
        required: ['path'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const p = String(o['path'] ?? '').trim();
        if (!p) throw new Error('fs.read: path is required.');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        return (await window.zytrader.fs.read(p, { scope })) as unknown as JsonValue;
      },
    },
    {
      name: 'fs.write',
      description:
        'Write UTF-8 text. scope "vault" for notes/Agent memory paths; "workspace" for repository files (default).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          scope: { type: 'string', enum: ['workspace', 'vault'] },
        },
        required: ['path', 'content'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const p = String(o['path'] ?? '').trim();
        if (!p) throw new Error('fs.write: path is required.');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        return (await window.zytrader.fs.write(p, String(o['content'] ?? ''), { scope })) as unknown as JsonValue;
      },
    },
    {
      name: 'fs.delete',
      description: 'Delete file or directory under workspace or vault (see scope, default workspace).',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, scope: { type: 'string', enum: ['workspace', 'vault'] } },
        required: ['path'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const p = String(o['path'] ?? '').trim();
        if (!p) throw new Error('fs.delete: path is required.');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        return (await window.zytrader.fs.remove(p, { scope })) as unknown as JsonValue;
      },
    },
    {
      name: 'terminal.exec',
      description:
        'Run shell command. cwd is relative to workspace or vault root (cwdScope, default workspace). Git/npm use cwd "." and cwdScope workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' },
          cwdScope: { type: 'string', enum: ['workspace', 'vault'] },
        },
        required: ['command'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const cwdScope = o['cwdScope'] === 'vault' ? 'vault' : 'workspace';
        return (await window.zytrader.terminal.exec(
          String(o['command'] ?? ''),
          String(o['cwd'] ?? '.'),
          cwdScope,
        )) as unknown as JsonValue;
      },
    },
    {
      name: 'memory.write_short_term',
      description:
        'Write one short-term memory record into vault key agent-short-term. Use for temporary session context.',
      inputSchema: {
        type: 'object',
        properties: {
          context: { type: 'string' },
          userId: { type: 'string' },
          sessionId: { type: 'string' },
        },
        required: ['context'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const context = String(o['context'] ?? '').trim();
        if (!context) throw new Error('memory.write_short_term: context is required.');
        const now = new Date();
        const id = `short-term-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
        const createTime = now.toISOString();
        const expireTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const record = {
          id,
          createTime,
          updateTime: createTime,
          expireTime,
          context,
          userId: o['userId'] ? String(o['userId']) : undefined,
          sessionId: o['sessionId'] ? String(o['sessionId']) : undefined,
        };

        const resolved = await window.zytrader.vault.resolve('agent-short-term');
        if (!resolved.ok || !resolved.relative) {
          throw new Error(resolved.error ?? 'failed to resolve agent-short-term path.');
        }
        const relPath = `${resolved.relative}/${id}.json`;
        return (await window.zytrader.fs.write(relPath, JSON.stringify(record, null, 2), {
          scope: 'vault',
        })) as unknown as JsonValue;
      },
    },
    {
      name: 'memory.write_long_term',
      description:
        'Write one long-term memory record into 02-AGENT-MEMORY/02-Long-Term. Supports json (default) or md format.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          content: { type: 'string' },
          format: { type: 'string', enum: ['json', 'md'] },
          relatedNotes: { type: 'array', items: { type: 'string' } },
          relatedMemory: { type: 'array', items: { type: 'string' } },
        },
        required: ['type', 'content'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const type = String(o['type'] ?? '').trim();
        const content = String(o['content'] ?? '').trim();
        if (!type || !content) {
          throw new Error('memory.write_long_term: type and content are required.');
        }
        const format = String(o['format'] ?? 'json') === 'md' ? 'md' : 'json';

        const resolved = await window.zytrader.vault.resolve('agent-long-term');
        if (!resolved.ok || !resolved.relative) {
          throw new Error(resolved.error ?? 'failed to resolve agent-long-term path.');
        }

        const now = new Date();
        const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const safeType = type.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 24) || 'memory';
        const id = `long-term-${safeType}-${stamp}`;
        const record = {
          id,
          createTime: now.toISOString(),
          updateTime: now.toISOString(),
          type,
          format,
          content,
          relatedNotes: Array.isArray(o['relatedNotes']) ? o['relatedNotes'] : [],
          relatedMemory: Array.isArray(o['relatedMemory']) ? o['relatedMemory'] : [],
        };

        const ext = format === 'md' ? 'md' : 'json';
        const relPath = `${resolved.relative}/${id}.${ext}`;
        const body =
          ext === 'json'
            ? JSON.stringify(record, null, 2)
            : `---\n${JSON.stringify(record, null, 2)}\n---\n\n${content}`;

        return (await window.zytrader.fs.write(relPath, body, { scope: 'vault' })) as unknown as JsonValue;
      },
    },
    {
      name: 'memory.read',
      description:
        'Read one memory by id from a bucket (short|long|context). If json is missing, tries markdown for long-term bucket.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryType: { type: 'string', enum: ['short', 'long', 'context'] },
          id: { type: 'string' },
        },
        required: ['memoryType', 'id'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const mt = String(o['memoryType'] ?? '').trim();
        const id = String(o['id'] ?? '').trim();
        if (!mt || !id) throw new Error('memory.read: memoryType and id are required.');
        const key = memoryKeyByType(mt);

        const resolved = await window.zytrader.vault.resolve(key);
        if (!resolved.ok || !resolved.relative) {
          throw new Error(resolved.error ?? `failed to resolve ${key} path.`);
        }

        const candidates = mt === 'long' ? ['json', 'md'] : ['json'];
        for (const ext of candidates) {
          const relPath = `${resolved.relative}/${id}.${ext}`;
          const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
          if (read.ok) {
            return { ok: true, memoryType: mt, id, path: relPath, content: read.content } as unknown as JsonValue;
          }
        }

        return { ok: false, error: 'memory not found', memoryType: mt, id } as unknown as JsonValue;
      },
    },
    {
      name: 'memory.list',
      description:
        'List memory files in vault by memoryType: short|long|context|meta, with optional keyword filter in content.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryType: { type: 'string', enum: ['short', 'long', 'context', 'meta'] },
          keyword: { type: 'string' },
        },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const mt = String(o['memoryType'] ?? 'short');
        const key = memoryKeyByType(mt, true);
        const keyword = String(o['keyword'] ?? '').trim();

        const resolved = await window.zytrader.vault.resolve(key);
        if (!resolved.ok || !resolved.relative) {
          throw new Error(resolved.error ?? `failed to resolve ${key} path.`);
        }

        const listed = await window.zytrader.fs.list(resolved.relative, { scope: 'vault' });
        if (!listed.ok) return listed as unknown as JsonValue;

        const hits: Array<{ path: string; name: string }> = [];
        for (const e of listed.entries) {
          if (e.type !== 'file') continue;
          const rel = `${resolved.relative}/${e.name}`;
          if (!keyword) {
            hits.push({ path: rel, name: e.name });
            continue;
          }
          const read = await window.zytrader.fs.read(rel, { scope: 'vault' });
          if (!read.ok) continue;
          if (read.content.includes(keyword)) {
            hits.push({ path: rel, name: e.name });
          }
        }

        return {
          ok: true,
          memoryType: mt,
          count: hits.length,
          files: hits,
        } as unknown as JsonValue;
      },
    },
    {
      name: 'memory.update',
      description:
        'Patch a memory file (json preferred; markdown metadata for long-term supported) and refresh updateTime.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryType: { type: 'string', enum: ['short', 'long', 'context'] },
          id: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['memoryType', 'id', 'patch'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const mt = String(o['memoryType'] ?? '').trim();
        const id = String(o['id'] ?? '').trim();
        const patch = (o['patch'] ?? {}) as Record<string, unknown>;
        if (!mt || !id || typeof patch !== 'object' || patch === null) {
          throw new Error('memory.update: memoryType, id and patch are required.');
        }

        const key = memoryKeyByType(mt);
        const resolved = await window.zytrader.vault.resolve(key);
        if (!resolved.ok || !resolved.relative) {
          throw new Error(resolved.error ?? `failed to resolve ${key} path.`);
        }

        const candidates = mt === 'long' ? ['json', 'md'] : ['json'];
        for (const ext of candidates) {
          const relPath = `${resolved.relative}/${id}.${ext}`;
          const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
          if (!read.ok) continue;

          if (ext === 'md') {
            const m = read.content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
            if (!m?.[1]) return { ok: false, error: 'invalid markdown memory format' } as unknown as JsonValue;
            const meta = JSON.parse(m[1]) as Record<string, unknown>;
            const next: Record<string, unknown> = { ...meta, ...patch, updateTime: new Date().toISOString() };
            const body = typeof next['content'] === 'string' ? String(next['content']) : m[2] ?? '';
            const out = `---\n${JSON.stringify(next, null, 2)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
            return (await window.zytrader.fs.write(relPath, out, { scope: 'vault' })) as unknown as JsonValue;
          }

          const obj = JSON.parse(read.content) as Record<string, unknown>;
          const next = { ...obj, ...patch, updateTime: new Date().toISOString() };
          return (await window.zytrader.fs.write(relPath, JSON.stringify(next, null, 2), {
            scope: 'vault',
          })) as unknown as JsonValue;
        }

        return { ok: false, error: 'memory not found', memoryType: mt, id } as unknown as JsonValue;
      },
    },
    {
      name: 'memory.relate_note',
      description:
        'Add one related note path into a long-term memory relatedNotes list (deduplicated).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          notePath: { type: 'string' },
        },
        required: ['id', 'notePath'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const id = String(o['id'] ?? '').trim();
        const notePath = String(o['notePath'] ?? '').trim();
        if (!id || !notePath) {
          throw new Error('memory.relate_note: id and notePath are required.');
        }

        const resolved = await window.zytrader.vault.resolve('agent-long-term');
        if (!resolved.ok || !resolved.relative) {
          throw new Error(resolved.error ?? 'failed to resolve agent-long-term path.');
        }

        for (const ext of ['json', 'md']) {
          const relPath = `${resolved.relative}/${id}.${ext}`;
          const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
          if (!read.ok) continue;

          if (ext === 'md') {
            const m = read.content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
            if (!m?.[1]) return { ok: false, error: 'invalid markdown memory format' } as unknown as JsonValue;
            const meta = JSON.parse(m[1]) as Record<string, unknown>;
            const related = Array.isArray(meta['relatedNotes']) ? (meta['relatedNotes'] as unknown[]) : [];
            const nextRelated = Array.from(new Set([...related.map((x) => String(x)), notePath]));
            const next = { ...meta, relatedNotes: nextRelated, updateTime: new Date().toISOString() };
            const body = m[2] ?? '';
            const out = `---\n${JSON.stringify(next, null, 2)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
            return (await window.zytrader.fs.write(relPath, out, { scope: 'vault' })) as unknown as JsonValue;
          }

          const obj = JSON.parse(read.content) as Record<string, unknown>;
          const related = Array.isArray(obj['relatedNotes']) ? (obj['relatedNotes'] as unknown[]) : [];
          const nextRelated = Array.from(new Set([...related.map((x) => String(x)), notePath]));
          const next = { ...obj, relatedNotes: nextRelated, updateTime: new Date().toISOString() };
          return (await window.zytrader.fs.write(relPath, JSON.stringify(next, null, 2), {
            scope: 'vault',
          })) as unknown as JsonValue;
        }

        return { ok: false, error: 'memory not found', id } as unknown as JsonValue;
      },
    },
    {
      name: 'host.open_path',
      description:
        'Open a file or folder with the OS default application (Explorer for folders, Notepad/default app for files). Use workspace-relative paths, or an absolute path under the user home directory (e.g. Desktop). Example: open a notebook file on Desktop.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async run(input) {
        const p = String((input as Record<string, unknown> | undefined)?.['path'] ?? '').trim();
        if (!p) throw new Error('host.open_path: path is required.');
        return (await window.zytrader.host.openPath(p)) as unknown as JsonValue;
      },
    },
  ];
}

export function provideClaudeCore(config: ClaudeCoreConfig): Provider[] {
  return [
    { provide: CLAUDE_CORE_CONFIG, useValue: config },
    { provide: CLAUDE_DEFAULT_MODEL, useValue: config.api.defaultModel },
    {
      provide: CLAUDE_CLIENT,
      useFactory: () => bootstrapClaudeApi({ ...config.api }),
    },
    {
      provide: CLAUDE_RUNTIME,
      useFactory: (client: ClaudeClient): ClaudeCoreRuntime => {
        const storage = new BrowserLocalStorageAdapter(localStorage, 'cw:');
        const history = new InMemoryHistoryStore();
        const tools = new ToolSystem();
        const skills = new SkillSystem();
        const plugins = new PluginSystem(storage);
        const coordinator = new PlanEngine();

        for (const tool of buildLocalTools()) tools.register(tool);

        const assistant = new AssistantRuntime({
          api: client,
          storage,
          history,
          tools,
          skills,
          coordinator,
        });

        return { client, context: assistant.context, history, tools, skills, plugins, coordinator, assistant };
      },
      deps: [CLAUDE_CLIENT],
    },
  ];
}
