import type {
  ChatMessage,
  ChatRequest,
  ChatStreamResponse,
  JsonObject,
  StorageAdapter,
  StreamChunk,
} from '../types/index.js';
import { ClaudeApiClient } from '../api/index.js';
import { ContextManager } from '../context/index.js';
import { InMemoryHistoryStore, type HistoryStore } from '../history/index.js';
import { SkillRegistry } from '../skills/index.js';
import { ToolRegistry } from '../tools/index.js';
import { SessionCompactor } from '../compact/index.js';
import { CoordinatorEngine } from '../coordinator/index.js';

export interface AssistantRuntimeOptions {
  api: ClaudeApiClient;
  storage: StorageAdapter;
  history?: HistoryStore;
  skills?: SkillRegistry;
  tools?: ToolRegistry;
  compactor?: SessionCompactor;
  coordinator?: CoordinatorEngine;
}

export class AssistantRuntime {
  readonly context: ContextManager;
  readonly history: HistoryStore;
  readonly skills: SkillRegistry;
  readonly tools: ToolRegistry;
  readonly coordinator: CoordinatorEngine;

  constructor(private readonly opts: AssistantRuntimeOptions) {
    this.context = new ContextManager(opts.storage);
    this.history = opts.history ?? new InMemoryHistoryStore();
    this.skills = opts.skills ?? new SkillRegistry();
    this.tools = opts.tools ?? new ToolRegistry();
    this.coordinator = opts.coordinator ?? new CoordinatorEngine();
  }

  async chat(sessionId: string, request: Omit<ChatRequest, 'messages'> & { userInput: string }): Promise<ChatMessage> {
    const history = await this.history.list(sessionId);

    const skillOutputs = await this.skills.runAll({
      userInput: request.userInput,
      context: {} as JsonObject,
    });

    const promptPatch = skillOutputs.map((s) => s.promptPatch).filter(Boolean).join('\n');

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: request.userInput,
      timestamp: Date.now(),
    };

    const messages = [...history, userMessage];
    const compacted = this.opts.compactor?.compact(messages).kept ?? messages;

    const response = await this.opts.api.createMessage({
      ...request,
      messages: compacted,
      systemPrompt: [request.systemPrompt, promptPatch].filter(Boolean).join('\n'),
    });

    await this.history.append(sessionId, userMessage);
    await this.history.append(sessionId, response.message);

    this.coordinator.ingestAssistantMessage(response.message);
    return response.message;
  }

  stream(sessionId: string, request: Omit<ChatRequest, 'messages'> & { userInput: string }): ChatStreamResponse {
    const stream = new ReadableStream<StreamChunk>({
      start: async (controller) => {
        const history = await this.history.list(sessionId);
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: request.userInput,
          timestamp: Date.now(),
        };

        await this.history.append(sessionId, userMessage);

        const upstream = this.opts.api.createMessageStream({
          ...request,
          messages: [...history, userMessage],
        });

        const reader = upstream.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }

        controller.close();
      },
    });

    return {
      stream,
      cancel: () => undefined,
    };
  }
}
