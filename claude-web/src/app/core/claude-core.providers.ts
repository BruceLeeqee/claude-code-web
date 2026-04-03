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
} from 'claude-core';

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

function getBridgeConfig(): { baseUrl: string; token: string } {
  const baseUrl = localStorage.getItem('bridge.baseUrl') || 'http://127.0.0.1:8787';
  const token = localStorage.getItem('bridge.token') || 'change-me-bridge-token';
  return { baseUrl, token };
}

async function callBridgeTool(tool: string, args: Record<string, unknown>): Promise<JsonValue> {
  const { baseUrl, token } = getBridgeConfig();
  const res = await fetch(`${baseUrl}/api/tools/call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bridge-token': token,
    },
    body: JSON.stringify({ tool, args }),
  });

  const data = await res.json();
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error ?? 'Bridge tool call failed');
  }

  return (data?.data ?? data) as JsonValue;
}

function buildBridgeTools(): AgentTool[] {
  return [
    {
      name: 'fs.list',
      description: 'List files and folders under the bridge sandbox root. Use dir="." for workspace root.',
      inputSchema: {
        type: 'object',
        properties: { dir: { type: 'string', description: 'Relative directory, default "."' } },
      },
      async run(input) {
        return callBridgeTool('fs.list', (input as Record<string, unknown>) ?? {});
      },
    },
    {
      name: 'fs.read',
      description: 'Read a UTF-8 text file under the bridge sandbox root.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative file path' } },
        required: ['path'],
      },
      async run(input) {
        return callBridgeTool('fs.read', (input as Record<string, unknown>) ?? {});
      },
    },
    {
      name: 'fs.write',
      description: 'Write or overwrite a UTF-8 text file under the bridge sandbox root.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          content: { type: 'string', description: 'File contents' },
        },
        required: ['path', 'content'],
      },
      async run(input) {
        return callBridgeTool('fs.write', (input as Record<string, unknown>) ?? {});
      },
    },
    {
      name: 'fs.delete',
      description: 'Delete a file or directory (recursive) under the bridge sandbox root.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative path' } },
        required: ['path'],
      },
      async run(input) {
        return callBridgeTool('fs.delete', (input as Record<string, unknown>) ?? {});
      },
    },
    {
      name: 'terminal.exec',
      description:
        'Run a shell command on the host (allowlisted). On Windows use explorer with a path to open a folder in File Explorer, e.g. explorer "D:\\\\Desktop\\\\my-folder".',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command (first token must be allowlisted)' },
          cwd: { type: 'string', description: 'Working directory relative to bridge root, default "."' },
          timeoutMs: { type: 'number', description: 'Timeout in ms' },
        },
        required: ['command'],
      },
      async run(input) {
        return callBridgeTool('terminal.exec', (input as Record<string, unknown>) ?? {});
      },
    },
    {
      name: 'local.open_app',
      description: 'Open a small allowlisted Windows app: notepad, calc, or mspaint.',
      inputSchema: {
        type: 'object',
        properties: { app: { type: 'string', enum: ['notepad', 'calc', 'mspaint'] } },
        required: ['app'],
      },
      async run(input) {
        return callBridgeTool('local.open_app', (input as Record<string, unknown>) ?? {});
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
      useFactory: () => {
        const bridgeBaseUrl = localStorage.getItem('bridge.baseUrl') || 'http://127.0.0.1:8787';
        const bridgeToken = localStorage.getItem('bridge.token') || 'change-me-bridge-token';

        return bootstrapClaudeApi({
          ...config.api,
          baseUrl: bridgeBaseUrl,
          proxy: {
            enabled: true,
            baseUrl: bridgeBaseUrl,
            headers: {
              'x-bridge-token': bridgeToken,
            },
          },
        });
      },
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

        for (const tool of buildBridgeTools()) {
          tools.register(tool);
        }

        const assistant = new AssistantRuntime({
          api: client,
          storage,
          history,
          tools,
          skills,
          coordinator,
        });

        return {
          client,
          context: assistant.context,
          history,
          tools,
          skills,
          plugins,
          coordinator,
          assistant,
        };
      },
      deps: [CLAUDE_CLIENT],
    },
  ];
}
