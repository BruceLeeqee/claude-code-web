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
  type ClaudeApiBootstrapConfig,
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

export function provideClaudeCore(config: ClaudeCoreConfig): Provider[] {
  return [
    { provide: CLAUDE_CORE_CONFIG, useValue: config },
    { provide: CLAUDE_DEFAULT_MODEL, useValue: config.api.defaultModel },
    {
      provide: CLAUDE_CLIENT,
      useFactory: () => {
        return bootstrapClaudeApi(config.api);
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
