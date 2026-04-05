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

function buildLocalTools(): AgentTool[] {
  return [
    {
      name: 'fs.list',
      description: 'List files and folders under workspace root. Use dir="." for root.',
      inputSchema: { type: 'object', properties: { dir: { type: 'string' } } },
      async run(input) {
        const dir = String((input as Record<string, unknown> | undefined)?.['dir'] ?? '.');
        return (await window.zytrader.fs.list(dir)) as unknown as JsonValue;
      },
    },
    {
      name: 'fs.read',
      description: 'Read a UTF-8 text file under workspace root.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async run(input) {
        const p = String((input as Record<string, unknown> | undefined)?.['path'] ?? '').trim();
        if (!p) throw new Error('fs.read: path is required.');
        return (await window.zytrader.fs.read(p)) as unknown as JsonValue;
      },
    },
    {
      name: 'fs.write',
      description: 'Write UTF-8 text to file under workspace root.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        const p = String(o['path'] ?? '').trim();
        if (!p) throw new Error('fs.write: path is required.');
        return (await window.zytrader.fs.write(p, String(o['content'] ?? ''))) as unknown as JsonValue;
      },
    },
    {
      name: 'fs.delete',
      description: 'Delete file or directory under workspace root.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async run(input) {
        const p = String((input as Record<string, unknown> | undefined)?.['path'] ?? '').trim();
        if (!p) throw new Error('fs.delete: path is required.');
        return (await window.zytrader.fs.remove(p)) as unknown as JsonValue;
      },
    },
    {
      name: 'terminal.exec',
      description:
        'Run shell command in workspace root. On Windows you can start apps: e.g. `notepad`, `notepad C:\\\\Users\\\\Name\\\\Desktop\\\\x.txt`, `start msedge https://...`.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' }, cwd: { type: 'string' } },
        required: ['command'],
      },
      async run(input) {
        const o = (input as Record<string, unknown>) ?? {};
        return (await window.zytrader.terminal.exec(String(o['command'] ?? ''), String(o['cwd'] ?? '.'))) as unknown as JsonValue;
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
