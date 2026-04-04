/**
 * Assistant 运行时：串联技能、历史、工具、可选压缩与协调器，
 * 提供非流式 `chatWithMeta` 与流式 `stream`（含多轮 tool 调用循环）。
 */
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamResponse,
  JsonArray,
  JsonObject,
  JsonValue,
  ModelConfig,
  StorageAdapter,
  StreamChunk,
  ToolCall,
} from '../types/index.js';
import {
  ANTHROPIC_WIRE_KEY,
  toolResultBlocks,
  toolsFromAgentTools,
} from '../api/anthropic-messages.js';
import { ClaudeApiClient } from '../api/index.js';
import { ContextManager } from '../context/index.js';
import { InMemoryHistoryStore, type HistoryStore } from '../history/index.js';
import { SkillRegistry } from '../skills/index.js';
import { ToolRegistry } from '../tools/index.js';
import { SessionCompactor, type AutoCompactPolicy } from '../compact/index.js';
import { CoordinatorEngine } from '../coordinator/index.js';
import { SimpleIdGenerator } from '../utils/index.js';

/** 构造 `AssistantRuntime` 所需的依赖 */
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

/** 单次用户输入 + 可选上下文键值，由运行时拼成完整 `ChatRequest` */
export interface AssistantChatInput extends Omit<ChatRequest, 'messages'> {
  userInput: string;
  contextValues?: JsonObject;
}

const MAX_TOOL_ROUNDS = 16;

export class AssistantRuntime {
  /** 会话上下文持久化（与 history 分离存储键空间） */
  readonly context: ContextManager;
  /** 会话消息存储（内存或持久化实现） */
  readonly history: HistoryStore;
  /** 用户输入前置技能管道 */
  readonly skills: SkillRegistry;
  /** 模型可调用的工具注册表 */
  readonly tools: ToolRegistry;
  /** UI/计划模式协调状态 */
  readonly coordinator: CoordinatorEngine;
  private readonly ids = new SimpleIdGenerator();

  constructor(private readonly opts: AssistantRuntimeOptions) {
    this.context = new ContextManager(opts.storage);
    this.history = opts.history ?? new InMemoryHistoryStore();
    this.skills = opts.skills ?? new SkillRegistry();
    this.tools = opts.tools ?? new ToolRegistry();
    this.coordinator = opts.coordinator ?? new CoordinatorEngine();
  }

  /** 非流式对话，仅返回最终助手消息 */
  async chat(sessionId: string, request: AssistantChatInput): Promise<ChatMessage> {
    const response = await this.chatWithMeta(sessionId, request);
    return response.message;
  }

  /**
   * 非流式对话（含 usage/toolCalls）：循环执行 tool 直至无 tool_calls 或达到轮数上限。
   */
  async chatWithMeta(sessionId: string, request: AssistantChatInput): Promise<ChatResponse> {
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

    await this.history.append(sessionId, userMessage);

    const combinedPrompt = [request.systemPrompt, promptPatch].filter(Boolean).join('\n');
    const toolDefs = toolsFromAgentTools(this.tools.list());

    let lastResponse: ChatResponse | undefined;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const hist = await this.history.list(sessionId);
      const autoCompacted = this.opts.autoCompactPolicy
        ? this.opts.compactor?.autoCompact(hist, this.opts.autoCompactPolicy)
        : null;
      const compacted = autoCompacted?.kept ?? this.opts.compactor?.compact(hist).kept ?? hist;

      const payload: Omit<ChatRequest, 'config'> & { config?: ChatRequest['config'] } = {
        messages: compacted,
      };
      if (request.contextId) payload.contextId = request.contextId;
      if (request.metadata) payload.metadata = request.metadata;
      if (combinedPrompt) payload.systemPrompt = combinedPrompt;
      if (toolDefs.length > 0) payload.tools = toolDefs;

      const response = await this.opts.api.createMessage({
        ...payload,
        config: request.config,
      });

      lastResponse = response;
      await this.history.append(sessionId, response.message);
      this.coordinator.ingestAssistantMessage(response.message);

      const calls = response.toolCalls ?? [];
      if (calls.length === 0) break;

      const rows: Array<{ toolCallId: string; ok: boolean; output: JsonValue; error?: string }> = [];
      for (const tc of calls) {
        const tr = await this.executeTool(sessionId, tc);
        const row: { toolCallId: string; ok: boolean; output: JsonValue; error?: string } = {
          toolCallId: tr.toolCallId,
          ok: tr.ok,
          output: tr.output,
        };
        if (tr.error !== undefined) row.error = tr.error;
        rows.push(row);
      }

      const toolUserMsg: ChatMessage = {
        id: this.ids.next('msg'),
        role: 'user',
        content: '（工具结果）',
        timestamp: Date.now(),
        metadata: {
          [ANTHROPIC_WIRE_KEY]: { role: 'user', content: toolResultBlocks(rows) },
        },
      };
      await this.history.append(sessionId, toolUserMsg);
    }

    if (!lastResponse) {
      throw new Error('Assistant chat produced no model response');
    }

    return lastResponse;
  }

  /**
   * 流式对话：推送文本 delta、tool_call/tool_result，并在兼容体下处理多轮工具后继续请求。
   */
  stream(sessionId: string, request: AssistantChatInput): ChatStreamResponse {
    const cancelController = new AbortController();

    const stream = new ReadableStream<StreamChunk>({
      start: async (controller) => {
        try {
          const skillOutputs = await this.skills.runAll({
            userInput: request.userInput,
            context: request.contextValues ?? {},
          });
          const promptPatch = skillOutputs
            .map((s) => s.output.promptPatch)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
            .join('\n');
          const combinedPrompt = [request.systemPrompt, promptPatch].filter(Boolean).join('\n');

          const userMessage: ChatMessage = {
            id: this.ids.next('msg'),
            role: 'user',
            content: request.userInput,
            timestamp: Date.now(),
          };
          await this.history.append(sessionId, userMessage);

          const toolDefs = toolsFromAgentTools(this.tools.list());

          toolRound: for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const hist = await this.history.list(sessionId);
            const autoCompacted = this.opts.autoCompactPolicy
              ? this.opts.compactor?.autoCompact(hist, this.opts.autoCompactPolicy)
              : null;
            const compacted = autoCompacted?.kept ?? this.opts.compactor?.compact(hist).kept ?? hist;

            const streamReq: Omit<ChatRequest, 'config'> & { config?: ModelConfig } = {
              ...request,
              messages: compacted,
              config: request.config,
            };
            if (combinedPrompt) streamReq.systemPrompt = combinedPrompt;
            if (toolDefs.length > 0) streamReq.tools = toolDefs;

            const upstream = this.opts.api.createMessageStream(streamReq, {
              signal: cancelController.signal,
            });

            let assistantText = '';
            const reader = upstream.stream.getReader();
            let sawAnthropicTurn = false;
            let pendingToolContinuation = false;

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (value.type === 'delta') {
                  assistantText += value.textDelta;
                  controller.enqueue(value);
                  continue;
                }

                if (value.type === 'anthropic_turn') {
                  sawAnthropicTurn = true;
                  const t = value.turn;

                  if (t.toolCalls.length > 0) {
                    const assistantMsg: ChatMessage = {
                      id: this.ids.next('msg'),
                      role: 'assistant',
                      content: t.assistantText || '（已调用本地工具）',
                      timestamp: Date.now(),
                      metadata: {
                        [ANTHROPIC_WIRE_KEY]: {
                          role: 'assistant',
                          content:
                            t.assistantContentBlocks.length > 0
                              ? t.assistantContentBlocks
                              : ([{ type: 'text', text: t.assistantText || '' }] as JsonArray),
                        },
                      },
                    };
                    await this.history.append(sessionId, assistantMsg);
                    this.coordinator.ingestAssistantMessage(assistantMsg);

                    const rows: Array<{ toolCallId: string; ok: boolean; output: JsonValue; error?: string }> = [];
                    for (const tc of t.toolCalls) {
                      const toolResult = await this.executeTool(sessionId, tc);
                      controller.enqueue({ type: 'tool_call', toolCall: tc });
                      controller.enqueue({ type: 'tool_result', toolResult });
                      const row: { toolCallId: string; ok: boolean; output: JsonValue; error?: string } = {
                        toolCallId: toolResult.toolCallId,
                        ok: toolResult.ok,
                        output: toolResult.output,
                      };
                      if (toolResult.error !== undefined) row.error = toolResult.error;
                      rows.push(row);
                    }

                    const toolUserMsg: ChatMessage = {
                      id: this.ids.next('msg'),
                      role: 'user',
                      content: '（工具结果）',
                      timestamp: Date.now(),
                      metadata: {
                        [ANTHROPIC_WIRE_KEY]: { role: 'user', content: toolResultBlocks(rows) },
                      },
                    };
                    await this.history.append(sessionId, toolUserMsg);
                    pendingToolContinuation = true;
                    break;
                  }

                  const finalMsg: ChatMessage = {
                    id: this.ids.next('msg'),
                    role: 'assistant',
                    content: t.assistantText || assistantText,
                    timestamp: Date.now(),
                    metadata: {
                      [ANTHROPIC_WIRE_KEY]: {
                        role: 'assistant',
                        content:
                          t.assistantContentBlocks.length > 0
                            ? t.assistantContentBlocks
                            : ([{ type: 'text', text: t.assistantText || assistantText || '' }] as JsonArray),
                      },
                    },
                  };
                  await this.history.append(sessionId, finalMsg);
                  this.coordinator.ingestAssistantMessage(finalMsg);
                  controller.enqueue({ type: 'done' });
                  controller.close();
                  return;
                }

                if (value.type === 'error') {
                  controller.enqueue(value);
                  controller.close();
                  return;
                }

                if (value.type !== 'done') {
                  controller.enqueue(value);
                }
              }
            } finally {
              reader.releaseLock();
            }

            if (pendingToolContinuation) continue toolRound;

            if (!sawAnthropicTurn) {
              if (assistantText.length > 0) {
                const finalAssistantMessage: ChatMessage = {
                  id: this.ids.next('msg'),
                  role: 'assistant',
                  content: assistantText,
                  timestamp: Date.now(),
                };
                await this.history.append(sessionId, finalAssistantMessage);
                this.coordinator.ingestAssistantMessage(finalAssistantMessage);
              }
              controller.enqueue({ type: 'done' });
              controller.close();
              return;
            }

            controller.enqueue({ type: 'error', error: 'Stream ended without a final assistant turn' });
            controller.close();
            return;
          }

          controller.enqueue({ type: 'error', error: 'Tool round limit exceeded' });
          controller.close();
        } catch (error) {
          controller.enqueue({
            type: 'error',
            error: error instanceof Error ? error.message : 'Stream error',
          });
          controller.close();
        }
      },
      cancel: () => cancelController.abort(),
    });

    return {
      stream,
      cancel: () => cancelController.abort(),
    };
  }

  /** 委托 `ToolRegistry.execute` 执行单次工具 */
  private async executeTool(sessionId: string, toolCall: ToolCall) {
    return this.tools.execute(toolCall, {
      sessionId,
    });
  }
}
