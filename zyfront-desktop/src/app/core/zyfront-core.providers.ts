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

const LONG_MEMORY_VAULT_KEYS = [
  'agent-long-user',
  'agent-long-feedback',
  'agent-long-project',
  'agent-long-reference',
] as const;

/** 将工具里的 memoryType 映射到 directory.config 的 vault key */
function memoryVaultKey(memoryType: string, includeMeta = false): string {
  const mt = String(memoryType ?? '').trim();
  if (mt === 'short') return 'agent-short-term';
  if (mt === 'context') return 'agent-context';
  if (includeMeta && mt === 'meta') return 'agent-meta';
  if (mt === 'long' || mt === 'user') return 'agent-long-user';
  if (mt === 'feedback') return 'agent-long-feedback';
  if (mt === 'project') return 'agent-long-project';
  if (mt === 'reference') return 'agent-long-reference';
  return 'agent-short-term';
}

function buildLocalTools(): AgentTool[] {
  const psSingle = (s: string): string => s.replace(/'/g, "''");

  const globToRegex = (glob: string): RegExp => {
    const normalized = (glob || '*').replace(/\\/g, '/');
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const doubled = escaped.replace(/\*\*/g, '::DOUBLE_STAR::');
    const single = doubled.replace(/\*/g, '[^/]*').replace(/\?/g, '.');
    const restored = single.replace(/::DOUBLE_STAR::/g, '.*');
    return new RegExp(`^${restored}$`, 'i');
  };

  const fetchWithTimeout = async (url: string, timeoutMs = 15000): Promise<Response> => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      window.clearTimeout(t);
    }
  };

  const stateReadJson = <T>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  const stateWriteJson = (key: string, value: unknown): void => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const nowIso = (): string => new Date().toISOString();
  const makeId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  /** 与 Electron main `normalizeComputerTargetUrl` 对齐，供 computer.use 在渲染进程侧补全 URL */
  const normalizeComputerUrl = (raw: unknown): string => {
    const s = String(raw ?? '').trim();
    if (!s) return 'https://www.baidu.com';
    if (/^https?:\/\//i.test(s)) return s;
    return `https://${s.replace(/^\/+/, '')}`;
  };

  /** 无 Electron preload 时：用新标签打开网页（需用户允许弹窗） */
  const openUrlInBrowserTab = (target: string): JsonValue => {
    const opened = window.open(target, '_blank', 'noopener,noreferrer');
    if (!opened) {
      return { ok: false, error: '浏览器拦截了新窗口，请允许本站弹出窗口后重试。' } as unknown as JsonValue;
    }
    return { ok: true, url: target, via: 'window.open' } as unknown as JsonValue;
  };

  type ZytraderComputer = {
    open: (u: string) => Promise<unknown>;
    navigate: (u: string) => Promise<unknown>;
    evaluate: (s: string) => Promise<unknown>;
    snapshot: () => Promise<unknown>;
  };

  const listRecursively = async (root: string, scope: 'workspace' | 'vault', maxEntries = 2000): Promise<string[]> => {
    const out: string[] = [];
    const queue: string[] = [root];
    while (queue.length > 0 && out.length < maxEntries) {
      const dir = queue.shift()!;
      const listed = await window.zytrader.fs.list(dir, { scope });
      if (!listed.ok) continue;
      for (const e of listed.entries) {
        const full = dir === '.' ? e.name : `${dir}/${e.name}`;
        if (e.type === 'dir') {
          queue.push(full);
        } else {
          out.push(full);
          if (out.length >= maxEntries) break;
        }
      }
    }
    return out;
  };

  /** 07-Meta：长期记忆索引目录（manifest / time-index / topic-index） */
  const resolveMemoryIndexDir = async (): Promise<string> => {
    const r = await window.zytrader.vault.resolve('agent-memory-index');
    if (r.ok && r.relative) return r.relative;
    return '02-AGENT-MEMORY/07-Meta';
  };

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
        'Write one long-term memory record到 02-AGENT-MEMORY 下四类长期目录之一（默认 user → 02-Long-User）。支持 json（默认）或 md。',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          content: { type: 'string' },
          format: { type: 'string', enum: ['json', 'md'] },
          bucket: {
            type: 'string',
            enum: ['user', 'feedback', 'project', 'reference'],
            description: '写入哪一类长期记忆目录，默认 user',
          },
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
        const bucketRaw = String(o['bucket'] ?? 'user').trim().toLowerCase();
        const bucket: 'user' | 'feedback' | 'project' | 'reference' =
          bucketRaw === 'feedback' || bucketRaw === 'project' || bucketRaw === 'reference' ? bucketRaw : 'user';
        const vaultKey =
          bucket === 'feedback'
            ? 'agent-long-feedback'
            : bucket === 'project'
              ? 'agent-long-project'
              : bucket === 'reference'
                ? 'agent-long-reference'
                : 'agent-long-user';

        const resolved = await window.zytrader.vault.resolve(vaultKey);
        if (!resolved.ok || !resolved.relative) {
          throw new Error(resolved.error ?? `failed to resolve ${vaultKey} path.`);
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
        'Read one memory by id。long 时在四类长期目录中查找；short|context|meta|user|feedback|project|reference 为单目录。',
      inputSchema: {
        type: 'object',
        properties: {
          memoryType: {
            type: 'string',
            enum: ['short', 'long', 'context', 'meta', 'user', 'feedback', 'project', 'reference'],
          },
          id: { type: 'string' },
        },
        required: ['memoryType', 'id'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const mt = String(o['memoryType'] ?? '').trim();
        const id = String(o['id'] ?? '').trim();
        if (!mt || !id) throw new Error('memory.read: memoryType and id are required.');
        const keyOrder = mt === 'long' ? [...LONG_MEMORY_VAULT_KEYS] : [memoryVaultKey(mt, mt === 'meta')];

        const exts = mt === 'long' || mt === 'user' || mt === 'feedback' || mt === 'project' || mt === 'reference' ? ['json', 'md'] : ['json'];

        for (const key of keyOrder) {
          const resolved = await window.zytrader.vault.resolve(key);
          if (!resolved.ok || !resolved.relative) continue;
          for (const ext of exts) {
            const relPath = `${resolved.relative}/${id}.${ext}`;
            const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
            if (read.ok) {
              return { ok: true, memoryType: mt, id, path: relPath, content: read.content } as unknown as JsonValue;
            }
          }
        }

        return { ok: false, error: 'memory not found', memoryType: mt, id } as unknown as JsonValue;
      },
    },
    {
      name: 'memory.list',
      description:
        'List memory files。memoryType=long 时合并四类长期目录；否则 short|context|meta|user|feedback|project|reference 为单目录。可选 keyword 过滤文件内容。',
      inputSchema: {
        type: 'object',
        properties: {
          memoryType: {
            type: 'string',
            enum: ['short', 'long', 'context', 'meta', 'user', 'feedback', 'project', 'reference'],
          },
          keyword: { type: 'string' },
        },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const mt = String(o['memoryType'] ?? 'short');
        const keyword = String(o['keyword'] ?? '').trim();

        const scanDir = async (relBase: string): Promise<Array<{ path: string; name: string }>> => {
          const listed = await window.zytrader.fs.list(relBase, { scope: 'vault' });
          if (!listed.ok) return [];
          const hits: Array<{ path: string; name: string }> = [];
          for (const e of listed.entries) {
            if (e.type !== 'file') continue;
            const rel = `${relBase}/${e.name}`;
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
          return hits;
        };

        if (mt === 'long') {
          const hits: Array<{ path: string; name: string }> = [];
          for (const key of LONG_MEMORY_VAULT_KEYS) {
            const resolved = await window.zytrader.vault.resolve(key);
            if (!resolved.ok || !resolved.relative) continue;
            hits.push(...(await scanDir(resolved.relative)));
          }
          return { ok: true, memoryType: mt, count: hits.length, files: hits } as unknown as JsonValue;
        }

        const key = memoryVaultKey(mt, true);
        const resolved = await window.zytrader.vault.resolve(key);
        if (!resolved.ok || !resolved.relative) {
          throw new Error(resolved.error ?? `failed to resolve ${key} path.`);
        }

        const hits = await scanDir(resolved.relative);
        return {
          ok: true,
          memoryType: mt,
          count: hits.length,
          files: hits,
        } as unknown as JsonValue;
      },
    },
    {
      name: 'memory.query',
      description:
        '【按需】查询长期记忆**索引**（用户画像/反馈/项目/参考四类分别在 vault 的 02-Long-User、03-Long-Feedback、04-Long-Projects、05-Long-Reference；索引 JSON 在 07-Meta）。默认对话**不会**自动附带全部长期记忆。支持按 UTC 日期、标签、关键词、`memory_types` 过滤；可用 `read_paths` 再读正文。若 `index_status` 非 ok，桌面端会尝试在 `07-Meta/tools` 自动执行 `npm install` 与 `node build-manifest.mjs` 后重载。',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'UTC 日期 YYYY-MM-DD，对应 time-index.json' },
          tag: { type: 'string', description: '主题标签（与 topic-index 小写键一致）' },
          keyword: {
            type: 'string',
            description: '对路径与 summary 子串匹配（不区分大小写）；无 date/tag 时在全 manifest 条目中搜',
          },
          memory_types: {
            type: 'array',
            items: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
          },
          max_results: { type: 'number', description: '默认 30，最大 80' },
          read_paths: {
            type: 'array',
            items: { type: 'string' },
            description: '额外读取的 vault 相对路径，最多 3 个',
          },
          max_chars_per_file: { type: 'number', description: 'read_paths 单文件最大字符，默认 24000' },
        },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const date = String(o['date'] ?? '').trim();
        const tag = String(o['tag'] ?? '').trim();
        const keyword = String(o['keyword'] ?? '').trim().toLowerCase();
        const maxResults = Math.min(80, Math.max(1, Number(o['max_results'] ?? 30) || 30));
        const memoryTypes = Array.isArray(o['memory_types'])
          ? (o['memory_types'] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
          : [];
        const readPaths = Array.isArray(o['read_paths'])
          ? (o['read_paths'] as unknown[]).slice(0, 3).map((x) => String(x).trim()).filter(Boolean)
          : [];
        const maxChars = Math.min(
          120_000,
          Math.max(1024, Number(o['max_chars_per_file'] ?? 24_000) || 24_000),
        );

        const metaDir = await resolveMemoryIndexDir();

        const loadJson = async (name: string) => {
          const p = `${metaDir}/${name}`;
          const r = await window.zytrader.fs.read(p, { scope: 'vault' });
          if (!r.ok || typeof r.content !== 'string') {
            return { name, ok: false as const, error: 'read failed' };
          }
          try {
            return { name, ok: true as const, data: JSON.parse(r.content) as Record<string, unknown> };
          } catch {
            return { name, ok: false as const, error: 'invalid json' };
          }
        };

        let [manifestJ, timeJ, topicJ] = await Promise.all([
          loadJson('manifest.json'),
          loadJson('time-index.json'),
          loadJson('topic-index.json'),
        ]);

        type RebuildInfo = { attempted: boolean; ok?: boolean; error?: string; detail?: string };
        const indexRebuild: RebuildInfo = { attempted: false };

        const indexBroken = () => !manifestJ.ok || !timeJ.ok || !topicJ.ok;
        if (indexBroken() && typeof window.zytrader?.vault?.buildMemoryIndex === 'function') {
          indexRebuild.attempted = true;
          const br = await window.zytrader.vault.buildMemoryIndex();
          indexRebuild.ok = br.ok;
          if (!br.ok) {
            indexRebuild.error = br.error;
            const tail = `${br.stderr ?? ''}\n${br.stdout ?? ''}`.trim();
            if (tail) indexRebuild.detail = tail.slice(0, 2000);
          } else {
            [manifestJ, timeJ, topicJ] = await Promise.all([
              loadJson('manifest.json'),
              loadJson('time-index.json'),
              loadJson('topic-index.json'),
            ]);
          }
        }

        const index_status = {
          manifest: manifestJ.ok ? 'ok' : manifestJ.error,
          time_index: timeJ.ok ? 'ok' : timeJ.error,
          topic_index: topicJ.ok ? 'ok' : topicJ.error,
        };

        type Hit = {
          file_path: string;
          memory_type?: string | null;
          summary?: string;
          date_sources?: string[];
          sources: string[];
        };

        const byPath = new Map<string, Hit>();

        const upsert = (fp: string, patch: Partial<Hit>, source: string) => {
          if (!fp) return;
          const cur = byPath.get(fp) ?? { file_path: fp, sources: [] };
          if (patch.memory_type !== undefined) cur.memory_type = patch.memory_type;
          if (patch.summary !== undefined && patch.summary !== '') cur.summary = patch.summary;
          if (patch.date_sources) cur.date_sources = patch.date_sources;
          if (!cur.sources.includes(source)) cur.sources.push(source);
          byPath.set(fp, cur);
        };

        const pathSets: string[][] = [];

        if (date && timeJ.ok) {
          const byDate = timeJ.data['by_date'] as Record<string, unknown[]> | undefined;
          const rows = byDate?.[date] ?? [];
          for (const row of rows) {
            const r = row as Record<string, unknown>;
            const fp = String(r['file_path'] ?? '');
            const mt = r['memory_type'];
            upsert(fp, {
              memory_type: typeof mt === 'string' ? mt : (mt as string | null) ?? null,
              summary: String(r['summary'] ?? ''),
              date_sources: Array.isArray(r['date_sources'])
                ? (r['date_sources'] as string[])
                : undefined,
            }, 'time-index');
          }
          pathSets.push(
            rows.map((row) => String((row as Record<string, unknown>)['file_path'] ?? '')).filter(Boolean),
          );
        }

        if (tag && topicJ.ok) {
          const byTag = topicJ.data['by_tag'] as Record<string, unknown[]> | undefined;
          const rows = byTag?.[tag.toLowerCase()] ?? [];
          for (const row of rows) {
            const r = row as Record<string, unknown>;
            const fp = String(r['file_path'] ?? '');
            const mt = r['memory_type'];
            upsert(fp, {
              memory_type: typeof mt === 'string' ? mt : (mt as string | null) ?? null,
              summary: String(r['summary'] ?? ''),
            }, 'topic-index');
          }
          pathSets.push(
            rows.map((row) => String((row as Record<string, unknown>)['file_path'] ?? '')).filter(Boolean),
          );
        }

        let allowed: Set<string> | null = null;
        for (const ps of pathSets) {
          const s = new Set(ps);
          if (allowed === null) {
            allowed = s;
          } else {
            const nx = new Set<string>();
            for (const x of allowed) {
              if (s.has(x)) nx.add(x);
            }
            allowed = nx;
          }
        }

        if (allowed !== null) {
          for (const k of [...byPath.keys()]) {
            if (!allowed.has(k)) byPath.delete(k);
          }
        }

        const hasStructuralFilter = !!(date || tag);

        if (!hasStructuralFilter && manifestJ.ok) {
          const entries = (manifestJ.data['entries'] as unknown[]) ?? [];
          const walk =
            !keyword && memoryTypes.length === 0 ? entries.slice(0, 20) : entries;
          for (const e of walk) {
            const row = e as Record<string, unknown>;
            const fp = String(row['filename'] ?? '');
            const mt = row['memory_type'];
            upsert(fp, {
              memory_type: typeof mt === 'string' ? mt : (mt as string | null) ?? null,
              summary: String(row['summary'] ?? ''),
            }, 'manifest');
          }
        }

        if (keyword) {
          for (const [fp, h] of [...byPath.entries()]) {
            const hay = `${fp} ${h.summary ?? ''}`.toLowerCase();
            if (!hay.includes(keyword)) byPath.delete(fp);
          }
        }

        if (memoryTypes.length > 0) {
          const set = new Set(memoryTypes);
          for (const [fp, h] of [...byPath.entries()]) {
            const mt = h.memory_type;
            if (!mt || !set.has(mt)) byPath.delete(fp);
          }
        }

        const hintNoIndex =
          !manifestJ.ok || !timeJ.ok || !topicJ.ok
            ? indexRebuild.attempted && indexRebuild.ok
              ? '索引文件在自动重建后仍无法读取，请检查 07-Meta 目录权限或 tools 脚本输出路径。'
              : indexRebuild.attempted
                ? `自动重建失败（需本机 Node/npm，且 vault 含 02-AGENT-MEMORY/07-Meta/tools）：${indexRebuild.error ?? 'unknown'}${indexRebuild.detail ? `\n${indexRebuild.detail}` : ''}`
                : '部分索引文件缺失或损坏：请在 vault 根目录执行 cd 02-AGENT-MEMORY/07-Meta/tools && npm install && node build-manifest.mjs（非桌面 Electron 环境无自动重建）。'
            : undefined;

        let rows = [...byPath.values()];
        rows.sort((a, b) => (b.file_path ?? '').localeCompare(a.file_path ?? ''));
        rows = rows.slice(0, maxResults);

        const mode =
          hasStructuralFilter || keyword || memoryTypes.length > 0 ? 'query' : 'overview';

        const file_contents: Record<string, JsonValue> = {};
        for (const rp of readPaths) {
          const r = await window.zytrader.fs.read(rp, { scope: 'vault' });
          if (!r.ok || typeof r.content !== 'string') {
            file_contents[rp] = { ok: false, error: 'read failed' } as unknown as JsonValue;
            continue;
          }
          const text = r.content;
          const truncated = text.length > maxChars;
          file_contents[rp] = {
            ok: true,
            truncated,
            chars: truncated ? maxChars : text.length,
            content: truncated ? text.slice(0, maxChars) : text,
          } as unknown as JsonValue;
        }

        return {
          ok: true,
          mode,
          meta_dir: metaDir,
          index_status,
          ...(indexRebuild.attempted ? { index_rebuild: indexRebuild } : {}),
          hint: hintNoIndex,
          filters: {
            date: date || undefined,
            tag: tag || undefined,
            keyword: keyword || undefined,
            memory_types: memoryTypes,
          },
          count: rows.length,
          hits: rows,
          ...(Object.keys(file_contents).length > 0 ? { file_contents } : {}),
        } as unknown as JsonValue;
      },
    },
    {
      name: 'memory.update',
      description:
        'Patch a memory file (json preferred; markdown metadata for long-term supported) and refresh updateTime。long 时在四类长期目录中查找 id。',
      inputSchema: {
        type: 'object',
        properties: {
          memoryType: {
            type: 'string',
            enum: ['short', 'long', 'context', 'user', 'feedback', 'project', 'reference'],
          },
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

        const keyOrder =
          mt === 'long' ? [...LONG_MEMORY_VAULT_KEYS] : [memoryVaultKey(mt, false)];
        const exts = mt === 'long' || mt === 'user' || mt === 'feedback' || mt === 'project' || mt === 'reference' ? ['json', 'md'] : ['json'];

        for (const key of keyOrder) {
          const resolved = await window.zytrader.vault.resolve(key);
          if (!resolved.ok || !resolved.relative) continue;

          for (const ext of exts) {
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

        for (const key of LONG_MEMORY_VAULT_KEYS) {
          const resolved = await window.zytrader.vault.resolve(key);
          if (!resolved.ok || !resolved.relative) continue;

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
        }

        return { ok: false, error: 'memory not found', id } as unknown as JsonValue;
      },
    },
    {
      name: 'host.open_path',
      description:
        'Open URL in system browser (http/https), or open a file/folder/.exe with the OS (shell.openExternal / shell.openPath). Workspace-relative paths allowed; on Windows, absolute paths under Program Files or AppData may be used to launch installed apps (e.g. Google Chrome: Program Files/Google/Chrome/Application/chrome.exe). Not for embedding pages — use computer.use for that.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async run(input) {
        const p = String((input as Record<string, unknown> | undefined)?.['path'] ?? '').trim();
        if (!p) throw new Error('host.open_path: path is required.');
        return (await window.zytrader.host.openPath(p)) as unknown as JsonValue;
      },
    },
    {
      name: 'host.launch_app',
      description:
        'Launch a known desktop GUI app on Windows (Google Chrome or Edge) in a detached process so the window appears on the user desktop. Prefer this when the user asks to open Chrome/Edge/the browser application — more reliable than terminal.exec or shell.openPath alone. On non-Windows, returns ok:false.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', enum: ['chrome', 'edge', 'google-chrome', 'msedge'] },
        },
        required: ['app'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const app = String(o['app'] ?? '').trim();
        if (!app) throw new Error('host.launch_app: app is required.');
        const z = (window as unknown as { zytrader?: { host?: { launchRegisteredApp: (id: string) => Promise<unknown> } } })
          .zytrader?.host?.launchRegisteredApp;
        if (typeof z !== 'function') {
          return { ok: false, error: 'host.launchRegisteredApp unavailable (not Electron desktop)' } as unknown as JsonValue;
        }
        return (await z(app)) as unknown as JsonValue;
      },
    },
    {
      name: 'tools.list',
      description:
        'List all currently available local tools in this runtime, including name, description and input schema. Use this to answer "当前可用哪些工具" accurately.',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
        },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const keyword = String(o['keyword'] ?? '').trim().toLowerCase();
        const listFn = (window as unknown as { __zyfrontListRuntimeTools?: () => Array<Record<string, unknown>> })
          .__zyfrontListRuntimeTools;

        const runtimeTools = typeof listFn === 'function' ? listFn() : [];
        const tools = runtimeTools.map((t) => ({
          name: String(t['name'] ?? ''),
          description: String(t['description'] ?? ''),
          inputSchema: (t['inputSchema'] ?? null) as unknown,
        }));

        const filtered = keyword
          ? tools.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(keyword))
          : tools;

        return {
          ok: true,
          count: filtered.length,
          tools: filtered,
        } as unknown as JsonValue;
      },
    },
    {
      name: 'files.read',
      description: 'ClaudeCode-compatible alias of fs.read. Read UTF-8 text file by path and scope.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, scope: { type: 'string', enum: ['workspace', 'vault'] } },
        required: ['path'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const p = String(o['path'] ?? '').trim();
        if (!p) throw new Error('files.read: path is required.');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        return (await window.zytrader.fs.read(p, { scope })) as unknown as JsonValue;
      },
    },
    {
      name: 'files.write',
      description: 'ClaudeCode-compatible alias of fs.write. Write UTF-8 content to file.',
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
        if (!p) throw new Error('files.write: path is required.');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        return (await window.zytrader.fs.write(p, String(o['content'] ?? ''), { scope })) as unknown as JsonValue;
      },
    },
    {
      name: 'files.edit',
      description: 'Replace exact string in file content (single occurrence by default, or replaceAll=true).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          oldString: { type: 'string' },
          newString: { type: 'string' },
          replaceAll: { type: 'boolean' },
          scope: { type: 'string', enum: ['workspace', 'vault'] },
        },
        required: ['path', 'oldString', 'newString'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const p = String(o['path'] ?? '').trim();
        const oldString = String(o['oldString'] ?? '');
        const newString = String(o['newString'] ?? '');
        const replaceAll = Boolean(o['replaceAll']);
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        if (!p) throw new Error('files.edit: path is required.');

        const read = await window.zytrader.fs.read(p, { scope });
        if (!read.ok) return read as unknown as JsonValue;

        const src = read.content;
        if (!src.includes(oldString)) {
          return { ok: false, error: 'oldString not found', path: p } as unknown as JsonValue;
        }
        const next = replaceAll ? src.split(oldString).join(newString) : src.replace(oldString, newString);
        return (await window.zytrader.fs.write(p, next, { scope })) as unknown as JsonValue;
      },
    },
    {
      name: 'files.glob',
      description: 'Find files by glob pattern under workspace/vault. Supports *, ?, **.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          root: { type: 'string' },
          scope: { type: 'string', enum: ['workspace', 'vault'] },
          limit: { type: 'number' },
        },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const pattern = String(o['pattern'] ?? '**/*').trim() || '**/*';
        const root = String(o['root'] ?? '.');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        const limit = Math.max(1, Math.min(5000, Number(o['limit'] ?? 500) || 500));
        const rx = globToRegex(pattern);
        const files = await listRecursively(root, scope, Math.max(2000, limit * 3));
        const hits = files.filter((f) => rx.test(f)).slice(0, limit);
        return { ok: true, scope, root, pattern, count: hits.length, hits } as unknown as JsonValue;
      },
    },
    {
      name: 'files.grep',
      description: 'Search text in files under workspace/vault (simple contains matching).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          root: { type: 'string' },
          scope: { type: 'string', enum: ['workspace', 'vault'] },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const query = String(o['query'] ?? '').toLowerCase();
        if (!query) throw new Error('files.grep: query is required.');
        const root = String(o['root'] ?? '.');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        const limit = Math.max(1, Math.min(2000, Number(o['limit'] ?? 200) || 200));
        const files = await listRecursively(root, scope, 4000);

        const hits: Array<{ path: string; line: number; text: string }> = [];
        for (const f of files) {
          if (hits.length >= limit) break;
          const read = await window.zytrader.fs.read(f, { scope });
          if (!read.ok) continue;
          const lines = read.content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i] ?? '';
            if (line.toLowerCase().includes(query)) {
              hits.push({ path: f, line: i + 1, text: line });
              if (hits.length >= limit) break;
            }
          }
        }

        return { ok: true, query, scope, root, count: hits.length, hits } as unknown as JsonValue;
      },
    },
    {
      name: 'files.search',
      description:
        'Search files by glob-like pattern and optional text keyword under workspace/vault. Useful to discover new files quickly.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['workspace', 'vault'] },
          root: { type: 'string' },
          pattern: { type: 'string' },
          keyword: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        const root = String(o['root'] ?? '.');
        const pattern = String(o['pattern'] ?? '*').trim();
        const keyword = String(o['keyword'] ?? '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(500, Number(o['limit'] ?? 100) || 100));

        const regex = new RegExp(
          '^' +
            pattern
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.') +
            '$',
          'i',
        );

        const files = await listRecursively(root, scope, 4000);
        const hits: Array<{ path: string; matchedBy: 'name' | 'content' }> = [];

        for (const f of files) {
          if (hits.length >= limit) break;
          const nameOk = regex.test(f);
          if (!nameOk) continue;
          if (!keyword) {
            hits.push({ path: f, matchedBy: 'name' });
            continue;
          }
          const read = await window.zytrader.fs.read(f, { scope });
          if (!read.ok) continue;
          if (read.content.toLowerCase().includes(keyword)) {
            hits.push({ path: f, matchedBy: 'content' });
          }
        }

        return {
          ok: true,
          scope,
          root,
          pattern,
          keyword,
          count: hits.length,
          hits,
        } as unknown as JsonValue;
      },
    },
    {
      name: 'web.search',
      description:
        'Search the web (DuckDuckGo lightweight HTML) and return raw snippet text. Requires network access from host environment.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const query = String(o['query'] ?? '').trim();
        if (!query) throw new Error('web.search: query is required.');
        const shellCmd = `python -c "import urllib.parse,urllib.request; q='${psSingle(
          query,
        )}'; u='https://duckduckgo.com/html/?q='+urllib.parse.quote(q); print(urllib.request.urlopen(u, timeout=20).read(5000).decode('utf-8','ignore'))"`;
        return (await window.zytrader.terminal.exec(shellCmd, '.', 'workspace')) as unknown as JsonValue;
      },
    },
    {
      name: 'web.fetch',
      description: 'Fetch a URL and return status/title/text snippet in structured JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          timeoutMs: { type: 'number' },
          maxChars: { type: 'number' },
        },
        required: ['url'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const url = String(o['url'] ?? '').trim();
        if (!url) throw new Error('web.fetch: url is required.');
        const timeoutMs = Math.max(1000, Math.min(60000, Number(o['timeoutMs'] ?? 15000) || 15000));
        const maxChars = Math.max(200, Math.min(200000, Number(o['maxChars'] ?? 12000) || 12000));

        const r = await fetchWithTimeout(url, timeoutMs);
        const text = await r.text();
        const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
        return {
          ok: r.ok,
          status: r.status,
          statusText: r.statusText,
          url: r.url,
          title,
          content: text.slice(0, maxChars),
          truncated: text.length > maxChars,
        } as unknown as JsonValue;
      },
    },
    {
      name: 'computer.use',
      description:
        '受控浏览器窗口（仅执行）：open/navigate 加载调用方给出的完整 https URL；evaluate 执行 JS；snapshot 返回当前页信息。意图解析（用户想开哪个站）由上层模型完成，本工具不推断自然语言。本地程序/文件用 host.open_path。无 preload 时 open 退化为新标签。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['open', 'navigate', 'evaluate', 'snapshot'] },
          url: { type: 'string' },
          script: { type: 'string' },
        },
        required: ['action'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const action = String(o['action'] ?? '').trim();
        if (!action) throw new Error('computer.use: action is required.');

        const z = (window as unknown as { zytrader?: { computer?: ZytraderComputer } }).zytrader?.computer;

        if (action === 'open') {
          const target = normalizeComputerUrl(o['url']);
          if (z?.open) return (await z.open(target)) as unknown as JsonValue;
          return openUrlInBrowserTab(target);
        }
        if (action === 'navigate') {
          const raw = String(o['url'] ?? '').trim();
          if (!raw) throw new Error('computer.use(navigate): url is required.');
          const target = normalizeComputerUrl(raw);
          if (z?.navigate) return (await z.navigate(target)) as unknown as JsonValue;
          return openUrlInBrowserTab(target);
        }
        if (action === 'evaluate') {
          const script = String(o['script'] ?? '').trim();
          if (!script) throw new Error('computer.use(evaluate): script is required.');
          if (!z?.evaluate) {
            return {
              ok: false,
              error: 'evaluate 仅在 Electron 桌面版且已打开 Computer Use 窗口时可用。',
            } as unknown as JsonValue;
          }
          return (await z.evaluate(script)) as unknown as JsonValue;
        }
        if (action === 'snapshot') {
          if (!z?.snapshot) {
            return {
              ok: false,
              error: 'snapshot 仅在 Electron 桌面版且已打开 Computer Use 窗口时可用。',
            } as unknown as JsonValue;
          }
          return (await z.snapshot()) as unknown as JsonValue;
        }

        return { ok: false, error: `unsupported action: ${action}` } as unknown as JsonValue;
      },
    },
    {
      name: 'todo.write',
      description: 'Write/merge TODO list into browser localStorage and return current items.',
      inputSchema: {
        type: 'object',
        properties: {
          merge: { type: 'boolean' },
          todos: { type: 'array', items: { type: 'object' } },
        },
        required: ['merge', 'todos'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const merge = Boolean(o['merge']);
        const todos = Array.isArray(o['todos']) ? (o['todos'] as Array<Record<string, unknown>>) : [];
        const key = 'zyfront.todos.runtime';
        const prev = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, unknown>>;
        let next: Array<Record<string, unknown>> = [];
        if (!merge) {
          next = todos;
        } else {
          const byId = new Map<string, Record<string, unknown>>();
          for (const t of prev) {
            const id = String(t['id'] ?? '').trim();
            if (id) byId.set(id, t);
          }
          for (const t of todos) {
            const id = String(t['id'] ?? '').trim();
            if (!id) continue;
            byId.set(id, { ...(byId.get(id) ?? {}), ...t });
          }
          next = [...byId.values()];
        }
        localStorage.setItem(key, JSON.stringify(next));
        return { ok: true, count: next.length, todos: next } as unknown as JsonValue;
      },
    },
    {
      name: 'ask.question',
      description: 'Structured question tool (degraded). Accepts options and returns selected option(s).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          questions: { type: 'array', items: { type: 'object' } },
          simulatedAnswers: { type: 'array', items: { type: 'object' } },
        },
        required: ['questions'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const questions = Array.isArray(o['questions']) ? (o['questions'] as Array<Record<string, unknown>>) : [];
        const simulated = Array.isArray(o['simulatedAnswers']) ? (o['simulatedAnswers'] as Array<Record<string, unknown>>) : [];
        const answers = questions.map((q) => {
          const qid = String(q['id'] ?? 'q');
          const opts = Array.isArray(q['options']) ? (q['options'] as Array<Record<string, unknown>>) : [];
          const sim = simulated.find((x) => String(x['id'] ?? '') === qid);
          const picked = Array.isArray(sim?.['selected']) ? (sim?.['selected'] as unknown[]) : [];
          const fallback = opts[0] ? [String((opts[0] as Record<string, unknown>)['id'] ?? '')] : [];
          return { id: qid, selected: picked.length ? picked.map((x) => String(x)) : fallback };
        });
        return { ok: true, degraded: true, answers } as unknown as JsonValue;
      },
    },
    {
      name: 'plan.enter',
      description: 'Enter plan mode for coordinator runtime.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const fn = (window as unknown as { __zyfrontSetPlanMode?: (mode: 'single' | 'plan' | 'parallel') => unknown })
          .__zyfrontSetPlanMode;
        if (typeof fn !== 'function') return { ok: false, error: 'plan controller unavailable' } as unknown as JsonValue;
        return fn('plan') as JsonValue;
      },
    },
    {
      name: 'plan.exit',
      description: 'Exit plan mode (switch to single mode).',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const fn = (window as unknown as { __zyfrontSetPlanMode?: (mode: 'single' | 'plan' | 'parallel') => unknown })
          .__zyfrontSetPlanMode;
        if (typeof fn !== 'function') return { ok: false, error: 'plan controller unavailable' } as unknown as JsonValue;
        return fn('single') as JsonValue;
      },
    },
    {
      name: 'task.stop',
      description: 'Request stopping current task/stream execution.',
      inputSchema: { type: 'object', properties: { reason: { type: 'string' } } },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const fn = (window as unknown as { __zyfrontRequestTaskStop?: (reason?: string) => unknown }).__zyfrontRequestTaskStop;
        if (typeof fn !== 'function') return { ok: false, error: 'task stop controller unavailable' } as unknown as JsonValue;
        return fn(String(o['reason'] ?? 'user requested stop')) as JsonValue;
      },
    },
    {
      name: 'tool.search',
      description: 'Search registered runtime tools by keyword.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const query = String(o['query'] ?? '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(200, Number(o['limit'] ?? 40) || 40));
        if (!query) throw new Error('tool.search: query is required.');
        const listFn = (window as unknown as { __zyfrontListRuntimeTools?: () => Array<Record<string, unknown>> })
          .__zyfrontListRuntimeTools;
        const all = typeof listFn === 'function' ? listFn() : [];
        const hits = all
          .filter((t) => `${String(t['name'] ?? '')} ${String(t['description'] ?? '')}`.toLowerCase().includes(query))
          .slice(0, limit);
        return { ok: true, query, count: hits.length, tools: hits } as unknown as JsonValue;
      },
    },
    {
      name: 'tools.doctor',
      description: 'Report runtime tool health summary (total/native/degraded) and per-tool status.',
      inputSchema: {
        type: 'object',
        properties: {
          includeTools: { type: 'boolean' },
        },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const includeTools = Boolean(o['includeTools'] ?? true);
        const listFn = (window as unknown as { __zyfrontListRuntimeTools?: () => Array<Record<string, unknown>> })
          .__zyfrontListRuntimeTools;
        const all = typeof listFn === 'function' ? listFn() : [];

        const degraded = new Set([
          'web.search',
          'ask.question',
          'files.edit',
          'files.glob',
          'files.grep',
          'skill.run',
          'lsp.query',
          'mcp.list_resources',
          'mcp.read_resource',
          'workflow.run',
          'remote.trigger',
          'monitor.snapshot',
          'worktree.enter',
          'worktree.exit',
          'terminal.capture',
          'ctx.inspect',
          'agent.run',
          'notify.push',
          'userfile.send',
          'pr.subscribe',
        ]);

        const referenceToolSet = new Set([
          'agent.run',
          'task.output',
          'terminal.exec',
          'files.glob',
          'files.grep',
          'plan.exit',
          'files.read',
          'files.edit',
          'files.write',
          'notebook.edit',
          'web.fetch',
          'todo.write',
          'web.search',
          'task.stop',
          'ask.question',
          'skill.run',
          'plan.enter',
          'config.set',
          'task.create',
          'task.get',
          'task.update',
          'task.list',
          'terminal.capture',
          'lsp.query',
          'worktree.enter',
          'worktree.exit',
          'send.message',
          'team.create',
          'team.delete',
          'workflow.run',
          'sleep',
          'cron.create',
          'cron.delete',
          'cron.list',
          'remote.trigger',
          'monitor.snapshot',
          'brief.generate',
          'userfile.send',
          'notify.push',
          'pr.subscribe',
          'powershell.exec',
          'snip.create',
          'mcp.list_resources',
          'mcp.read_resource',
          'tool.search',
        ]);

        const runtimeNames = new Set(all.map((t) => String(t['name'] ?? '').trim()).filter(Boolean));
        const missingList = [...referenceToolSet].filter((name) => !runtimeNames.has(name));

        const toolStatuses = all.map((t) => {
          const name = String(t['name'] ?? '');
          return {
            name,
            capability: degraded.has(name) ? 'degraded' : 'native',
            enabled: t['enabled'] !== false,
            description: String(t['description'] ?? ''),
            inReferenceSet: referenceToolSet.has(name),
          };
        });

        const total = toolStatuses.length;
        const nativeCount = toolStatuses.filter((x) => x.capability === 'native').length;
        const degradedCount = toolStatuses.filter((x) => x.capability === 'degraded').length;

        return {
          ok: true,
          total,
          native: nativeCount,
          degraded: degradedCount,
          referenceTotal: referenceToolSet.size,
          missing: missingList.length,
          missingTools: missingList,
          tools: includeTools ? toolStatuses : undefined,
        } as unknown as JsonValue;
      },
    },
    {
      name: 'task.create',
      description: 'Create a task record for collaboration/task-tracking runtime.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string' },
          assignee: { type: 'string' },
          priority: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['title'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const title = String(o['title'] ?? '').trim();
        if (!title) throw new Error('task.create: title is required.');
        const key = 'zyfront:runtime:tasks';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const task = {
          id: makeId('task'),
          title,
          description: String(o['description'] ?? ''),
          status: String(o['status'] ?? 'open'),
          assignee: String(o['assignee'] ?? ''),
          priority: String(o['priority'] ?? 'normal'),
          metadata: (o['metadata'] as Record<string, unknown> | undefined) ?? {},
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        items.unshift(task);
        stateWriteJson(key, items);
        return { ok: true, task } as unknown as JsonValue;
      },
    },
    {
      name: 'task.get',
      description: 'Get one task by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const id = String(o['id'] ?? '').trim();
        if (!id) throw new Error('task.get: id is required.');
        const key = 'zyfront:runtime:tasks';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const task = items.find((x) => String(x['id'] ?? '') === id) ?? null;
        return { ok: Boolean(task), task, error: task ? undefined : 'task not found' } as unknown as JsonValue;
      },
    },
    {
      name: 'task.update',
      description: 'Update task fields by id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['id', 'patch'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const id = String(o['id'] ?? '').trim();
        const patch = (o['patch'] as Record<string, unknown> | undefined) ?? {};
        if (!id) throw new Error('task.update: id is required.');
        const key = 'zyfront:runtime:tasks';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        let updated: Record<string, unknown> | null = null;
        const next = items.map((x) => {
          if (String(x['id'] ?? '') !== id) return x;
          updated = { ...x, ...patch, id, updatedAt: nowIso() };
          return updated;
        });
        stateWriteJson(key, next);
        return { ok: Boolean(updated), task: updated, error: updated ? undefined : 'task not found' } as unknown as JsonValue;
      },
    },
    {
      name: 'task.list',
      description: 'List tasks with optional status/assignee filters.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          assignee: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const status = String(o['status'] ?? '').trim();
        const assignee = String(o['assignee'] ?? '').trim();
        const limit = Math.max(1, Math.min(500, Number(o['limit'] ?? 100) || 100));
        const key = 'zyfront:runtime:tasks';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const filtered = items
          .filter((x) => (!status ? true : String(x['status'] ?? '') === status))
          .filter((x) => (!assignee ? true : String(x['assignee'] ?? '') === assignee))
          .slice(0, limit);
        return { ok: true, count: filtered.length, tasks: filtered } as unknown as JsonValue;
      },
    },
    {
      name: 'send.message',
      description: 'Send a collaboration message to channel/session (local runtime bus).',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          message: { type: 'string' },
          from: { type: 'string' },
        },
        required: ['channel', 'message'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const channel = String(o['channel'] ?? '').trim();
        const message = String(o['message'] ?? '').trim();
        if (!channel || !message) throw new Error('send.message: channel and message are required.');
        const key = 'zyfront:runtime:messages';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const entry = { id: makeId('msg'), channel, message, from: String(o['from'] ?? 'assistant'), at: nowIso() };
        items.unshift(entry);
        stateWriteJson(key, items.slice(0, 1000));
        return { ok: true, message: entry } as unknown as JsonValue;
      },
    },
    {
      name: 'team.create',
      description: 'Create a collaboration team with members.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          members: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: ['name'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const name = String(o['name'] ?? '').trim();
        if (!name) throw new Error('team.create: name is required.');
        const key = 'zyfront:runtime:teams';
        const teams = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const team = {
          id: makeId('team'),
          name,
          description: String(o['description'] ?? ''),
          members: Array.isArray(o['members']) ? (o['members'] as unknown[]).map((x) => String(x)) : [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        teams.unshift(team);
        stateWriteJson(key, teams);
        return { ok: true, team } as unknown as JsonValue;
      },
    },
    {
      name: 'team.delete',
      description: 'Delete a collaboration team by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const id = String(o['id'] ?? '').trim();
        if (!id) throw new Error('team.delete: id is required.');
        const key = 'zyfront:runtime:teams';
        const teams = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const next = teams.filter((x) => String(x['id'] ?? '') !== id);
        stateWriteJson(key, next);
        return { ok: true, deleted: teams.length - next.length, id } as unknown as JsonValue;
      },
    },
    {
      name: 'config.set',
      description: 'Set runtime config key/value in local storage.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: {},
        },
        required: ['key', 'value'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const k = String(o['key'] ?? '').trim();
        if (!k) throw new Error('config.set: key is required.');
        const key = 'zyfront:runtime:config';
        const cfg = stateReadJson<Record<string, unknown>>(key, {});
        cfg[k] = o['value'] as unknown;
        stateWriteJson(key, cfg);
        return { ok: true, key: k, value: cfg[k] } as unknown as JsonValue;
      },
    },
    {
      name: 'notebook.edit',
      description: 'Edit a Jupyter notebook cell by index (minimal JSON ipynb support).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          cellIndex: { type: 'number' },
          newSource: { type: 'string' },
          scope: { type: 'string', enum: ['workspace', 'vault'] },
        },
        required: ['path', 'cellIndex', 'newSource'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const p = String(o['path'] ?? '').trim();
        const cellIndex = Number(o['cellIndex']);
        const newSource = String(o['newSource'] ?? '');
        const scope = o['scope'] === 'vault' ? 'vault' : 'workspace';
        if (!p) throw new Error('notebook.edit: path is required.');
        if (!Number.isFinite(cellIndex) || cellIndex < 0) throw new Error('notebook.edit: cellIndex must be >= 0');
        const read = await window.zytrader.fs.read(p, { scope });
        if (!read.ok) return read as unknown as JsonValue;
        const nb = JSON.parse(read.content) as { cells?: Array<Record<string, unknown>> };
        if (!Array.isArray(nb.cells) || cellIndex >= nb.cells.length) {
          return { ok: false, error: 'cell index out of range', path: p, cellIndex } as unknown as JsonValue;
        }
        const target = nb.cells[cellIndex] ?? {};
        nb.cells[cellIndex] = { ...target, source: [newSource] };
        return (await window.zytrader.fs.write(p, JSON.stringify(nb, null, 2), { scope })) as unknown as JsonValue;
      },
    },
    {
      name: 'brief.generate',
      description: 'Generate a concise brief/summary from provided text.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          maxChars: { type: 'number' },
        },
        required: ['text'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const text = String(o['text'] ?? '').trim();
        if (!text) throw new Error('brief.generate: text is required.');
        const maxChars = Math.max(60, Math.min(4000, Number(o['maxChars'] ?? 500) || 500));
        const normalized = text.replace(/\s+/g, ' ').trim();
        const brief = normalized.length > maxChars ? `${normalized.slice(0, maxChars)}…` : normalized;
        return { ok: true, brief, length: brief.length } as unknown as JsonValue;
      },
    },
    {
      name: 'skill.run',
      description: 'Run a stored skill template with prompt (runtime-local degraded implementation).',
      inputSchema: {
        type: 'object',
        properties: {
          skillId: { type: 'string' },
          prompt: { type: 'string' },
        },
        required: ['skillId', 'prompt'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const skillId = String(o['skillId'] ?? '').trim();
        const prompt = String(o['prompt'] ?? '').trim();
        if (!skillId || !prompt) throw new Error('skill.run: skillId and prompt are required.');
        return {
          ok: true,
          mode: 'degraded',
          skillId,
          output: `Skill(${skillId}) received prompt: ${prompt}`,
        } as unknown as JsonValue;
      },
    },
    {
      name: 'mcp.list_resources',
      description: 'List MCP resources (runtime-local registry fallback).',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const key = 'zyfront:runtime:mcp:resources';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        return { ok: true, count: items.length, resources: items } as unknown as JsonValue;
      },
    },
    {
      name: 'mcp.read_resource',
      description: 'Read one MCP resource by id (runtime-local registry fallback).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const id = String(o['id'] ?? '').trim();
        if (!id) throw new Error('mcp.read_resource: id is required.');
        const key = 'zyfront:runtime:mcp:resources';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const item = items.find((x) => String(x['id'] ?? '') === id) ?? null;
        return { ok: Boolean(item), resource: item, error: item ? undefined : 'resource not found' } as unknown as JsonValue;
      },
    },
    {
      name: 'lsp.query',
      description: 'LSP capability placeholder: returns structured unavailable response until LSP bridge is connected.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          character: { type: 'number' },
        },
        required: ['action'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        return {
          ok: true,
          mode: 'degraded',
          action: String(o['action'] ?? ''),
          reason: 'LSP bridge not connected in current host runtime',
          hint: 'Use files.grep/files.search as fallback; wire host LSP IPC in P3 for full capability.',
        } as unknown as JsonValue;
      },
    },
    {
      name: 'powershell.exec',
      description: 'Run PowerShell command (fallback to terminal.exec).',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const command = String(o['command'] ?? '').trim();
        if (!command) throw new Error('powershell.exec: command is required.');
        return (await window.zytrader.terminal.exec(`powershell -Command "${command.replace(/"/g, '""')}"`, '.', 'workspace')) as unknown as JsonValue;
      },
    },
    {
      name: 'workflow.run',
      description: 'Run a workflow script (degraded placeholder).',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, input: { type: 'object' } },
        required: ['name'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const name = String(o['name'] ?? '').trim();
        if (!name) throw new Error('workflow.run: name is required.');
        return { ok: true, mode: 'degraded', name, input: o['input'] ?? {} } as unknown as JsonValue;
      },
    },
    {
      name: 'cron.create',
      description: 'Create a cron trigger (runtime-local registry).',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, cron: { type: 'string' }, payload: { type: 'object' } },
        required: ['name', 'cron'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const name = String(o['name'] ?? '').trim();
        const cron = String(o['cron'] ?? '').trim();
        if (!name || !cron) throw new Error('cron.create: name and cron are required.');
        const key = 'zyfront:runtime:cron';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const entry = { id: makeId('cron'), name, cron, payload: o['payload'] ?? {}, createdAt: nowIso() };
        items.unshift(entry);
        stateWriteJson(key, items);
        return { ok: true, cron: entry } as unknown as JsonValue;
      },
    },
    {
      name: 'cron.delete',
      description: 'Delete a cron trigger by id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const id = String(o['id'] ?? '').trim();
        if (!id) throw new Error('cron.delete: id is required.');
        const key = 'zyfront:runtime:cron';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const next = items.filter((x) => String(x['id'] ?? '') !== id);
        stateWriteJson(key, next);
        return { ok: next.length !== items.length, id } as unknown as JsonValue;
      },
    },
    {
      name: 'cron.list',
      description: 'List cron triggers.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const key = 'zyfront:runtime:cron';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        return { ok: true, count: items.length, crons: items } as unknown as JsonValue;
      },
    },
    {
      name: 'remote.trigger',
      description: 'Register a remote trigger request (runtime-local queue).',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, payload: { type: 'object' } },
        required: ['name'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const name = String(o['name'] ?? '').trim();
        if (!name) throw new Error('remote.trigger: name is required.');
        const key = 'zyfront:runtime:remote-triggers';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const entry = { id: makeId('remote'), name, payload: o['payload'] ?? {}, at: nowIso() };
        items.unshift(entry);
        stateWriteJson(key, items);
        return { ok: true, trigger: entry } as unknown as JsonValue;
      },
    },
    {
      name: 'monitor.snapshot',
      description: 'Capture a lightweight runtime snapshot (uptime, storage stats).',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const keys = Object.keys(localStorage);
        return {
          ok: true,
          at: nowIso(),
          uptimeMs: Math.round(performance.now()),
          localStorageKeys: keys.length,
        } as unknown as JsonValue;
      },
    },
    {
      name: 'worktree.enter',
      description: 'Enter worktree mode (degraded placeholder).',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        return { ok: true, mode: 'degraded', path: String(o['path'] ?? '') } as unknown as JsonValue;
      },
    },
    {
      name: 'worktree.exit',
      description: 'Exit worktree mode (degraded placeholder).',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        return { ok: true, mode: 'degraded' } as unknown as JsonValue;
      },
    },
    {
      name: 'terminal.capture',
      description: 'Capture terminal output (degraded placeholder).',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        return { ok: true, mode: 'degraded', id: String(o['id'] ?? '') } as unknown as JsonValue;
      },
    },
    {
      name: 'ctx.inspect',
      description: 'Inspect runtime context summary (degraded placeholder).',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const keys = Object.keys(localStorage);
        return { ok: true, mode: 'degraded', localStorageKeys: keys.length } as unknown as JsonValue;
      },
    },
    {
      name: 'snip.create',
      description: 'Create a snippet record in runtime storage.',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, content: { type: 'string' } },
        required: ['content'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const content = String(o['content'] ?? '').trim();
        if (!content) throw new Error('snip.create: content is required.');
        const key = 'zyfront:runtime:snips';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        const entry = { id: makeId('snip'), title: String(o['title'] ?? ''), content, at: nowIso() };
        items.unshift(entry);
        stateWriteJson(key, items);
        return { ok: true, snip: entry } as unknown as JsonValue;
      },
    },
    {
      name: 'sleep',
      description: 'Sleep for given milliseconds.',
      inputSchema: {
        type: 'object',
        properties: { ms: { type: 'number' } },
        required: ['ms'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const ms = Math.max(0, Number(o['ms'] ?? 0));
        await new Promise((resolve) => window.setTimeout(resolve, ms));
        return { ok: true, ms } as unknown as JsonValue;
      },
    },
    {
      name: 'agent.run',
      description: 'Agent tool placeholder (degraded).',
      inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const task = String(o['task'] ?? '').trim();
        if (!task) throw new Error('agent.run: task is required.');
        return { ok: true, mode: 'degraded', task } as unknown as JsonValue;
      },
    },
    {
      name: 'task.output',
      description: 'Append task output to runtime log storage.',
      inputSchema: {
        type: 'object',
        properties: { taskId: { type: 'string' }, output: { type: 'string' } },
        required: ['taskId', 'output'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const taskId = String(o['taskId'] ?? '').trim();
        const output = String(o['output'] ?? '').trim();
        if (!taskId || !output) throw new Error('task.output: taskId and output are required.');
        const key = 'zyfront:runtime:task-output';
        const items = stateReadJson<Array<Record<string, unknown>>>(key, []);
        items.unshift({ id: makeId('output'), taskId, output, at: nowIso() });
        stateWriteJson(key, items);
        return { ok: true } as unknown as JsonValue;
      },
    },
    {
      name: 'notify.push',
      description: 'Send a push notification (degraded placeholder).',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, body: { type: 'string' } },
        required: ['title', 'body'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        return { ok: true, mode: 'degraded', title: String(o['title'] ?? ''), body: String(o['body'] ?? '') } as unknown as JsonValue;
      },
    },
    {
      name: 'userfile.send',
      description: 'Send user file (degraded placeholder).',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const path = String(o['path'] ?? '').trim();
        if (!path) throw new Error('userfile.send: path is required.');
        return { ok: true, mode: 'degraded', path } as unknown as JsonValue;
      },
    },
    {
      name: 'pr.subscribe',
      description: 'Subscribe to PR webhook (degraded placeholder).',
      inputSchema: {
        type: 'object',
        properties: { repo: { type: 'string' } },
        required: ['repo'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const repo = String(o['repo'] ?? '').trim();
        if (!repo) throw new Error('pr.subscribe: repo is required.');
        return { ok: true, mode: 'degraded', repo } as unknown as JsonValue;
      },
    },
    {
      name: 'tools.register',
      description:
        'Register a new runtime tool immediately. Supports metadata registration for manually/LLM generated tools so they become discoverable by tools.list and runtime registry.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          inputSchema: { type: 'object' },
          executor: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['echo', 'terminal.exec', 'fs.read', 'fs.write', 'host.open_path', 'web.search'],
              },
              commandTemplate: { type: 'string' },
              cwdTemplate: { type: 'string' },
              cwdScope: { type: 'string', enum: ['workspace', 'vault'] },
              pathTemplate: { type: 'string' },
              contentTemplate: { type: 'string' },
              queryTemplate: { type: 'string' },
              scope: { type: 'string', enum: ['workspace', 'vault'] },
            },
            required: ['kind'],
          },
        },
        required: ['name'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const name = String(o['name'] ?? '').trim();
        if (!name) throw new Error('tools.register: name is required.');
        const description = String(o['description'] ?? 'Dynamic runtime tool').trim();
        const inputSchema = (o['inputSchema'] as Record<string, unknown> | undefined) ?? {
          type: 'object',
          properties: {},
        };
        const executor = (o['executor'] as Record<string, unknown> | undefined) ?? { kind: 'echo' };

        const registerFn = (window as unknown as {
          __zyfrontRegisterRuntimeTool?: (tool: {
            name: string;
            description: string;
            inputSchema?: Record<string, unknown>;
            executor?: Record<string, unknown>;
          }) => { ok: boolean; error?: string };
        }).__zyfrontRegisterRuntimeTool;

        if (typeof registerFn !== 'function') {
          return { ok: false, error: 'runtime register function unavailable' } as unknown as JsonValue;
        }

        return registerFn({ name, description, inputSchema, executor }) as unknown as JsonValue;
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

        const runtimeGlobal = window as unknown as {
          __zyfrontListRuntimeTools?: () => Array<Record<string, unknown>>;
          __zyfrontRegisterRuntimeTool?: (tool: {
            name: string;
            description: string;
            inputSchema?: Record<string, unknown>;
            executor?: Record<string, unknown>;
          }) => { ok: boolean; error?: string };
          __zyfrontSetPlanMode?: (mode: 'single' | 'plan' | 'parallel') => { ok: boolean; mode: string };
          __zyfrontRequestTaskStop?: (reason?: string) => { ok: boolean; reason: string; at: string };
        };

        runtimeGlobal.__zyfrontListRuntimeTools = () =>
          tools.list().map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: (t.inputSchema ?? null) as unknown,
            enabled: t.enabled !== false,
          }));

        runtimeGlobal.__zyfrontSetPlanMode = (mode) => {
          coordinator.setMode(mode);
          return { ok: true, mode };
        };

        runtimeGlobal.__zyfrontRequestTaskStop = (reason = 'user requested stop') => {
          return { ok: true, reason, at: new Date().toISOString() };
        };

        runtimeGlobal.__zyfrontRegisterRuntimeTool = (tool) => {
          const name = String(tool.name ?? '').trim();
          if (!name) return { ok: false, error: 'name is required' };

          const description = String(tool.description ?? 'Dynamic runtime tool').trim();
          const executor = (tool.executor ?? { kind: 'echo' }) as Record<string, unknown>;
          const kind = String(executor['kind'] ?? 'echo').trim();
          const rtRenderTemplate = (tpl: string, vars: Record<string, unknown>): string =>
            tpl.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
              const v = vars[key];
              return v === undefined || v === null ? '' : String(v);
            });
          const rtPsSingle = (s: string): string => s.replace(/'/g, "''");

          const rawSchema = tool.inputSchema as Record<string, unknown> | undefined;
          const inputSchema =
            rawSchema && rawSchema['type'] === 'object' && typeof rawSchema['properties'] === 'object'
              ? {
                  type: 'object' as const,
                  properties: rawSchema['properties'] as Record<string, unknown>,
                  required: Array.isArray(rawSchema['required'])
                    ? rawSchema['required'].map((x) => String(x))
                    : undefined,
                }
              : undefined;

          tools.register({
            name,
            description,
            inputSchema,
            async run(input) {
              const vars = (input ?? {}) as Record<string, unknown>;

              if (kind === 'terminal.exec') {
                const commandTemplate = String(executor['commandTemplate'] ?? '').trim();
                if (!commandTemplate) throw new Error(`${name}: executor.commandTemplate is required`);
                const command = rtRenderTemplate(commandTemplate, vars);
                const cwd = rtRenderTemplate(String(executor['cwdTemplate'] ?? '.'), vars) || '.';
                const cwdScope = executor['cwdScope'] === 'vault' ? 'vault' : 'workspace';
                return (await window.zytrader.terminal.exec(command, cwd, cwdScope)) as unknown as JsonValue;
              }

              if (kind === 'web.search') {
                const qTemplate = String(executor['queryTemplate'] ?? '{{query}}').trim();
                const query = rtRenderTemplate(qTemplate, vars).trim();
                if (!query) throw new Error(`${name}: executor.queryTemplate produced empty query`);
                const shellCmd = `python -c "import urllib.parse,urllib.request; q='${rtPsSingle(
                  query,
                )}'; u='https://duckduckgo.com/html/?q='+urllib.parse.quote(q); print(urllib.request.urlopen(u, timeout=20).read(5000).decode('utf-8','ignore'))"`;
                return (await window.zytrader.terminal.exec(shellCmd, '.', 'workspace')) as unknown as JsonValue;
              }

              if (kind === 'fs.read') {
                const pathTemplate = String(executor['pathTemplate'] ?? '').trim();
                if (!pathTemplate) throw new Error(`${name}: executor.pathTemplate is required`);
                const path = rtRenderTemplate(pathTemplate, vars);
                const scope = executor['scope'] === 'vault' ? 'vault' : 'workspace';
                return (await window.zytrader.fs.read(path, { scope })) as unknown as JsonValue;
              }

              if (kind === 'fs.write') {
                const pathTemplate = String(executor['pathTemplate'] ?? '').trim();
                if (!pathTemplate) throw new Error(`${name}: executor.pathTemplate is required`);
                const contentTemplate = String(executor['contentTemplate'] ?? '{{content}}');
                const path = rtRenderTemplate(pathTemplate, vars);
                const content = rtRenderTemplate(contentTemplate, vars);
                const scope = executor['scope'] === 'vault' ? 'vault' : 'workspace';
                return (await window.zytrader.fs.write(path, content, { scope })) as unknown as JsonValue;
              }

              if (kind === 'host.open_path') {
                const pathTemplate = String(executor['pathTemplate'] ?? '').trim();
                if (!pathTemplate) throw new Error(`${name}: executor.pathTemplate is required`);
                const path = rtRenderTemplate(pathTemplate, vars);
                return (await window.zytrader.host.openPath(path)) as unknown as JsonValue;
              }

              return {
                ok: true,
                tool: name,
                mode: 'echo',
                note: 'No executor or unknown executor kind; returned input directly.',
                receivedInput: input,
              } as unknown as JsonValue;
            },
          });

          return { ok: true };
        };

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
