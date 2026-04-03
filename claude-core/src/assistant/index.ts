import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamResponse,
  JsonObject,
  StorageAdapter,
  StreamChunk,
  ToolCall,
} from '../types/index.js';
import { ClaudeApiClient } from '../api/index.js';
import { ContextManager } from '../context/index.js';
import { InMemoryHistoryStore, type HistoryStore } from '../history/index.js';
import { SkillRegistry } from '../skills/index.js';
import { ToolRegistry } from '../tools/index.js';
import { SessionCompactor, type AutoCompactPolicy } from '../compact/index.js';
import { CoordinatorEngine } from '../coordinator/index.js';
import { SimpleIdGenerator } from '../utils/index.js';

export interface AssistantRuntimeOptions {
  api: ClaudeApiClient;
  storage: StorageAdapter;
  history?: HistoryStore;
  skills?: SkillRegistry;
  tools?: ToolRegistry;
  compactor?: SessionCompactor;
  autoCompactPolicy?: AutoCompactPolicy;
  coordinator?: CoordinatorEngine;
}

export interface AssistantChatInput extends Omit<ChatRequest, 'messages'> {
  userInput: string;
  contextValues?: JsonObject;
}

export class AssistantRuntime {
  readonly context: ContextManager;
  readonly history: HistoryStore;
  readonly skills: SkillRegistry;
  readonly tools: ToolRegistry;
  readonly coordinator: CoordinatorEngine;
  private readonly ids = new SimpleIdGenerator();

  constructor(private readonly opts: AssistantRuntimeOptions) {
    this.context = new ContextManager(opts.storage);
    this.history = opts.history ?? new InMemoryHistoryStore();
    this.skills = opts.skills ?? new SkillRegistry();
    this.tools = opts.tools ?? new ToolRegistry();
    this.coordinator = opts.coordinator ?? new CoordinatorEngine();
  }

  async chat(sessionId: string, request: AssistantChatInput): Promise<ChatMessage> {
    const response = await this.chatWithMeta(sessionId, request);
    return response.message;
  }

  async chatWithMeta(sessionId: string, request: AssistantChatInput): Promise<ChatResponse> {
    const history = await this.history.list(sessionId);

    const skillOutputs = await this.skills.runAll({
      userInput: request.userInput,
      context: request.contextValues ?? {},
    });

    const promptPatch = skillOutputs
      .map((s) => s.output.promptPatch)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join('\n');

    const userMessage: ChatMessage = {
      id: this.ids.next('msg'),
      role: 'user',
      content: request.userInput,
      timestamp: Date.now(),
    };

    const messages = [...history, userMessage];
    const autoCompacted = this.opts.autoCompactPolicy
      ? this.opts.compactor?.autoCompact(messages, this.opts.autoCompactPolicy)
      : null;
    const compacted = autoCompacted?.kept ?? this.opts.compactor?.compact(messages).kept ?? messages;

    const payload: Omit<ChatRequest, 'config'> & { config?: ChatRequest['config'] } = {
      messages: compacted,
    };

    if (request.contextId) payload.contextId = request.contextId;
    if (request.metadata) payload.metadata = request.metadata;

    const combinedPrompt = [request.systemPrompt, promptPatch].filter(Boolean).join('\n');
    if (combinedPrompt) {
      payload.systemPrompt = combinedPrompt;
    }

    const response = await this.opts.api.createMessage({
      ...payload,
      config: request.config,
    });

    await this.history.append(sessionId, userMessage);
    await this.history.append(sessionId, response.message);
    this.coordinator.ingestAssistantMessage(response.message);

    return response;
  }

  stream(sessionId: string, request: AssistantChatInput): ChatStreamResponse {
    const cancelController = new AbortController();

    const stream = new ReadableStream<StreamChunk>({
      start: async (controller) => {
        const history = await this.history.list(sessionId);
        const userMessage: ChatMessage = {
          id: this.ids.next('msg'),
          role: 'user',
          content: request.userInput,
          timestamp: Date.now(),
        };

        await this.history.append(sessionId, userMessage);

        const upstream = this.opts.api.createMessageStream(
          {
            ...request,
            messages: [...history, userMessage],
          },
          { signal: cancelController.signal },
        );

        let assistantText = '';
        const reader = upstream.stream.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value.type === 'delta') {
            assistantText += value.textDelta;
          }

          if (value.type === 'tool_call') {
            const toolResult = await this.executeTool(sessionId, value.toolCall);
            controller.enqueue(value);
            controller.enqueue({ type: 'tool_result', toolResult });
            continue;
          }

          controller.enqueue(value);
        }

        if (assistantText.length > 0) {
          const finalAssistantMessage: ChatMessage = {
            id: this.ids.next('msg'),
            role: 'assistant',
            content: assistantText,
            timestamp: Date.now(),
          };
          await this.history.append(sessionId, finalAssistantMessage);
        }

        controller.close();
      },
      cancel: () => cancelController.abort(),
    });

    return {
      stream,
      cancel: () => cancelController.abort(),
    };
  }

  private async executeTool(sessionId: string, toolCall: ToolCall) {
    return this.tools.execute(toolCall, {
      sessionId,
    });
  }
}
