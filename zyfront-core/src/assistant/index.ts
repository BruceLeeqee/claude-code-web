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
  ToolResult,
} from '../types/index.js';
import {
  ANTHROPIC_WIRE_KEY,
  getAnthropicWire,
  toolResultBlocks,
  toolsFromAgentTools,
} from '../api/anthropic-messages.js';
import { ClaudeApiClient } from '../api/index.js';
import { ContextManager } from '../context/index.js';
import { InMemoryHistoryStore, type HistoryStore } from '../history/index.js';
import { SkillRegistry } from '../skills/index.js';
import { ToolRegistry } from '../tools/index.js';
import { SessionCompactor, autoCompactIfNeededV2, type AutoCompactPolicy, type CompactV2Policy } from '../compact/index.js';
import { CoordinatorEngine } from '../coordinator/index.js';
import { composePrompt } from '../prompt/composer.js';
import { buildEffectiveSystemPrompt } from '../prompt/effective-system-prompt.js';
import { loadPromptGlobalConfig, resolveGlobalPromptByLanguage } from '../prompt/global-config.js';
import { resolveModelCountry, resolvePromptLanguage } from '../prompt/language.js';
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
  /**
   * 单次工具执行上限（毫秒）。超时则返回 `ok: false` 的工具结果并进入下一轮，避免 SSL/页面脚本等导致整轮对话永久挂起。
   * 默认 120000（2 分钟）。
   */
  toolTimeoutMs?: number;
}

/** 单次用户输入 + 可选上下文键值，由运行时拼成完整 `ChatRequest` */
export interface AssistantChatInput extends Omit<ChatRequest, 'messages'> {
  userInput: string;
  contextValues?: JsonObject;
}

/** 多轮工具调用上限；复杂任务易超过 16 轮导致「Tool round limit exceeded」 */
const MAX_TOOL_ROUNDS = 100;
/** 单轮流式请求失败重试上限（网络抖动/网关偶发错误） */
const MAX_STREAM_REQUEST_RETRIES = 5;

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
  private autoCompactPolicy: AutoCompactPolicy | undefined;
  private static readonly FALLBACK_MAX_MESSAGES = 40;
  private readonly toolTimeoutMs: number;

  constructor(private readonly opts: AssistantRuntimeOptions) {
    this.context = new ContextManager(opts.storage);
    this.history = opts.history ?? new InMemoryHistoryStore();
    this.skills = opts.skills ?? new SkillRegistry();
    this.tools = opts.tools ?? new ToolRegistry();
    this.coordinator = opts.coordinator ?? new CoordinatorEngine();
    this.autoCompactPolicy = opts.autoCompactPolicy;
    this.toolTimeoutMs = opts.toolTimeoutMs ?? 120_000;
  }

  /** 允许运行时动态更新压缩策略（设置即生效） */
  setAutoCompactPolicy(policy: AutoCompactPolicy | undefined): void {
    this.autoCompactPolicy = policy;
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
    await this.reconcileUserGoalByModel(sessionId, request.userInput, request.config);

    const mode = this.coordinator.getState().mode;
    const country = resolveModelCountry(request.config);
    const language = resolvePromptLanguage(request.config);
    const globalConfig = typeof localStorage !== 'undefined' ? await loadPromptGlobalConfig(localStorage) : null;
    const globalConfigPrompt = resolveGlobalPromptByLanguage(globalConfig, language);
    const effective = buildEffectiveSystemPrompt({
      mode,
      language,
      baseSystemPrompt: request.systemPrompt,
    });

    const prompt = composePrompt({
      baseSystemPrompt: effective.prompt,
      promptPatch,
      userInput: request.userInput,
      mode,
      language,
      globalConfigPrompt,
      env: {
        model: request.config?.model,
      },
    });

    const toolDefs = toolsFromAgentTools(this.tools.list());

    let lastResponse: ChatResponse | undefined;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const hist = await this.history.list(sessionId);
      const compactV2 = this.autoCompactPolicy
        ? (() => {
            const p: Partial<CompactV2Policy> = {
              enabled: this.autoCompactPolicy!.enabled,
              maxMessagesBeforeCompact: this.autoCompactPolicy!.maxMessagesBeforeCompact,
              compactToMessages: this.autoCompactPolicy!.compactToMessages,
              keepSystemMessages: true,
            };
            if (this.autoCompactPolicy!.maxEstimatedTokens !== undefined) {
              p.maxEstimatedTokens = this.autoCompactPolicy!.maxEstimatedTokens;
            }
            return autoCompactIfNeededV2({ messages: hist, policy: p });
          })()
        : null;
      const autoCompacted = this.autoCompactPolicy
        ? this.opts.compactor?.autoCompact(hist, this.autoCompactPolicy)
        : null;
      const compacted =
        compactV2?.result.kept ??
        autoCompacted?.kept ??
        this.opts.compactor?.compact(hist).kept ??
        this.fallbackTrimHistory(hist);
      const normalizedMessages = this.dropDanglingToolResults(compacted);

      const payload: Omit<ChatRequest, 'config'> & { config?: ChatRequest['config'] } = {
        messages: normalizedMessages,
      };
      if (request.contextId) payload.contextId = request.contextId;
      payload.metadata = {
        ...(request.metadata ?? {}),
        promptDebug: {
          ...prompt.debug,
          modelCountry: country,
          hasGlobalConfig: Boolean(globalConfigPrompt),
          effectiveSource: effective.source,
          finalPromptLength: prompt.finalPrompt.length,
          compactV2: {
            enabled: Boolean(this.autoCompactPolicy?.enabled),
            reason: compactV2?.result.reason ?? 'threshold_not_met',
            droppedCount: compactV2?.result.droppedCount ?? 0,
            estimatedTokensBefore: compactV2?.result.estimatedTokensBefore ?? null,
            estimatedTokensAfter: compactV2?.result.estimatedTokensAfter ?? null,
          },
        },
      };
      if (prompt.finalPrompt) payload.systemPrompt = prompt.finalPrompt;
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
          const mode = this.coordinator.getState().mode;
          const country = resolveModelCountry(request.config);
          const language = resolvePromptLanguage(request.config);
          const globalConfig = typeof localStorage !== 'undefined' ? await loadPromptGlobalConfig(localStorage) : null;
          const globalConfigPrompt = resolveGlobalPromptByLanguage(globalConfig, language);
          const effective = buildEffectiveSystemPrompt({
            mode,
            language,
            baseSystemPrompt: request.systemPrompt,
          });

          const prompt = composePrompt({
            baseSystemPrompt: effective.prompt,
            promptPatch,
            userInput: request.userInput,
            mode,
            language,
            globalConfigPrompt,
            env: {
              model: request.config?.model,
            },
          });

          const userMessage: ChatMessage = {
            id: this.ids.next('msg'),
            role: 'user',
            content: request.userInput,
            timestamp: Date.now(),
          };
          await this.history.append(sessionId, userMessage);
          await this.reconcileUserGoalByModel(sessionId, request.userInput, request.config);

          const toolDefs = toolsFromAgentTools(this.tools.list());

          toolRound: for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const hist = await this.history.list(sessionId);
            const compactV2 = this.autoCompactPolicy
              ? (() => {
                  const p: Partial<CompactV2Policy> = {
                    enabled: this.autoCompactPolicy!.enabled,
                    maxMessagesBeforeCompact: this.autoCompactPolicy!.maxMessagesBeforeCompact,
                    compactToMessages: this.autoCompactPolicy!.compactToMessages,
                    keepSystemMessages: true,
                  };
                  if (this.autoCompactPolicy!.maxEstimatedTokens !== undefined) {
                    p.maxEstimatedTokens = this.autoCompactPolicy!.maxEstimatedTokens;
                  }
                  return autoCompactIfNeededV2({ messages: hist, policy: p });
                })()
              : null;
            const autoCompacted = this.autoCompactPolicy
              ? this.opts.compactor?.autoCompact(hist, this.autoCompactPolicy)
              : null;
            const compacted =
              compactV2?.result.kept ??
              autoCompacted?.kept ??
              this.opts.compactor?.compact(hist).kept ??
              this.fallbackTrimHistory(hist);
            const normalizedMessages = this.dropDanglingToolResults(compacted);

            const streamReq: Omit<ChatRequest, 'config'> & { config?: ModelConfig } = {
              ...request,
              messages: normalizedMessages,
              config: request.config,
              metadata: {
                ...(request.metadata ?? {}),
                promptDebug: {
                  ...prompt.debug,
                  modelCountry: country,
                  hasGlobalConfig: Boolean(globalConfigPrompt),
                  effectiveSource: effective.source,
                  finalPromptLength: prompt.finalPrompt.length,
                  compactV2: {
                    enabled: Boolean(this.autoCompactPolicy?.enabled),
                    reason: compactV2?.result.reason ?? 'threshold_not_met',
                    droppedCount: compactV2?.result.droppedCount ?? 0,
                    estimatedTokensBefore: compactV2?.result.estimatedTokensBefore ?? null,
                    estimatedTokensAfter: compactV2?.result.estimatedTokensAfter ?? null,
                  },
                },
              },
            };
            if (prompt.finalPrompt) streamReq.systemPrompt = prompt.finalPrompt;
            if (toolDefs.length > 0) streamReq.tools = toolDefs;
            for (let attempt = 1; attempt <= MAX_STREAM_REQUEST_RETRIES; attempt++) {
              const upstream = this.opts.api.createMessageStream(streamReq, {
                signal: cancelController.signal,
              });
              const reader = upstream.stream.getReader();
              let assistantText = '';
              let sawAnthropicTurn = false;
              let pendingToolContinuation = false;
              let retryableError: string | null = null;

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
                        reasoningContent: t.reasoningContent,
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
                      reasoningContent: t.reasoningContent,
                    };
                    await this.history.append(sessionId, finalMsg);
                    this.coordinator.ingestAssistantMessage(finalMsg);
                    if (t.usage) {
                      controller.enqueue({ type: 'done', usage: t.usage });
                    } else {
                      controller.enqueue({ type: 'done' });
                    }
                    controller.close();
                    return;
                  }

                  if (value.type === 'error') {
                    retryableError = value.error || 'Stream request failed';
                    break;
                  }

                  if (value.type !== 'done') {
                    controller.enqueue(value);
                  }
                }
              } catch (error) {
                retryableError = error instanceof Error ? error.message : 'Stream error';
              } finally {
                reader.releaseLock();
              }

              if (pendingToolContinuation) continue toolRound;

              if (!sawAnthropicTurn && assistantText.length > 0) {
                const finalAssistantMessage: ChatMessage = {
                  id: this.ids.next('msg'),
                  role: 'assistant',
                  content: assistantText,
                  timestamp: Date.now(),
                };
                await this.history.append(sessionId, finalAssistantMessage);
                this.coordinator.ingestAssistantMessage(finalAssistantMessage);
                controller.enqueue({ type: 'done' });
                controller.close();
                return;
              }

              if (!retryableError) {
                retryableError = 'Stream ended without a final assistant turn';
              }

              if (cancelController.signal.aborted) {
                controller.enqueue({ type: 'error', error: 'Stream aborted' });
                controller.close();
                return;
              }

              if (attempt < MAX_STREAM_REQUEST_RETRIES) {
                controller.enqueue({
                  type: 'delta',
                  textDelta: `\n[重试] 流式请求失败，正在重试（${attempt}/${MAX_STREAM_REQUEST_RETRIES}）：${retryableError}\n`,
                });
                const waitMs = Math.min(5000, 200 * attempt + Math.floor(Math.random() * 120));
                await new Promise((resolve) => setTimeout(resolve, waitMs));
                continue;
              }

              controller.enqueue({
                type: 'error',
                error: `Stream request failed after ${MAX_STREAM_REQUEST_RETRIES} retries: ${retryableError}`,
              });
              controller.close();
              return;
            }
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

  /**
   * 两层判定：
   * 1) 轻量规则快速裁决（低成本、低延迟）
   * 2) 规则不确定时，再调用模型兜底
   */
  private async reconcileUserGoalByModel(
    sessionId: string,
    currentUserGoal: string,
    config?: ModelConfig,
  ): Promise<void> {
    const _sessionId = sessionId;
    void _sessionId;
    const state = this.coordinator.getState();
    const previousGoal = state.lastUserGoal;

    if (!previousGoal || previousGoal.trim().length === 0) {
      this.coordinator.recordUserGoal(currentUserGoal);
      return;
    }

    const hasActivePlan = state.mode !== 'single' || state.steps.length > 0;
    if (!hasActivePlan) {
      this.coordinator.recordUserGoal(currentUserGoal);
      return;
    }

    const quick = this.quickGoalConflictDecision(previousGoal, currentUserGoal);
    if (quick === 'conflict') {
      this.coordinator.forceResetForNewGoal(currentUserGoal);
      return;
    }
    if (quick === 'same_or_continuation') {
      this.coordinator.recordUserGoal(currentUserGoal);
      return;
    }

    const judgeSystem =
      'You are a strict intent-conflict judge. Output JSON only with shape: {"conflict": boolean, "reason": string}. No markdown.';

    const judgeUser = [
      'Determine whether the new user goal conflicts with the previous goal in a way that requires dropping the current plan and switching target.',
      'Return conflict=true when the new goal is a different target, domain, app, or objective that should supersede the old one.',
      'Return conflict=false when it is a refinement, continuation, or clarification of the same goal.',
      '',
      `previous_goal: ${JSON.stringify(previousGoal)}`,
      `current_goal: ${JSON.stringify(currentUserGoal)}`,
      `current_mode: ${JSON.stringify(state.mode)}`,
      `current_steps_count: ${state.steps.length}`,
    ].join('\n');

    try {
      const judgeReq: Omit<ChatRequest, 'config'> & { config?: ModelConfig } = {
        messages: [
          {
            id: this.ids.next('msg'),
            role: 'user',
            content: judgeUser,
            timestamp: Date.now(),
          },
        ],
        systemPrompt: judgeSystem,
      };
      if (config) {
        judgeReq.config = config;
      }

      const judgeResp = await this.opts.api.createMessage(judgeReq);

      let conflict = false;
      const text = judgeResp.message.content || '';
      try {
        const parsed = JSON.parse(text) as { conflict?: unknown };
        conflict = parsed?.conflict === true;
      } catch {
        const normalized = text.toLowerCase();
        conflict = normalized.includes('"conflict": true') || normalized.includes('conflict=true');
      }

      if (conflict) {
        this.coordinator.forceResetForNewGoal(currentUserGoal);
        return;
      }

      this.coordinator.recordUserGoal(currentUserGoal);
    } catch {
      this.coordinator.recordUserGoal(currentUserGoal);
    }
  }

  private quickGoalConflictDecision(
    previousGoal: string,
    currentGoal: string,
  ): 'conflict' | 'same_or_continuation' | 'uncertain' {
    const prev = previousGoal.trim().toLowerCase();
    const curr = currentGoal.trim().toLowerCase();
    if (!prev || !curr) return 'uncertain';
    if (prev === curr) return 'same_or_continuation';

    const strongSwitchIntent = [
      '打开',
      '去',
      '换',
      '取消',
      '停止',
      '算了',
      '改成',
      '改为',
      '别弄了',
      '不用了',
      'stop',
      'cancel',
      'switch',
      'instead',
      'forget that',
      'never mind',
    ];

    const hasStrongSwitch = strongSwitchIntent.some((kw) => curr.includes(kw));
    if (hasStrongSwitch) {
      if (curr.includes('取消') || curr.includes('停止') || curr.includes('算了') || curr.includes('不用了') || curr.includes('cancel') || curr.includes('stop') || curr.includes('never mind')) {
        return 'conflict';
      }
      if (!(curr.includes(prev) || prev.includes(curr))) {
        return 'conflict';
      }
    }

    if (curr.includes(prev) || prev.includes(curr)) return 'same_or_continuation';

    const prevTokens = this.goalTokens(prev);
    const currTokens = this.goalTokens(curr);
    if (prevTokens.size === 0 || currTokens.size === 0) return 'uncertain';

    let inter = 0;
    for (const t of prevTokens) {
      if (currTokens.has(t)) inter += 1;
    }
    const union = prevTokens.size + currTokens.size - inter;
    const jaccard = union > 0 ? inter / union : 0;

    if (jaccard <= 0.08) return 'conflict';
    if (jaccard >= 0.55) return 'same_or_continuation';
    return 'uncertain';
  }

  private goalTokens(text: string): Set<string> {
    const normalized = text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return new Set<string>();

    const base = normalized.split(' ').filter((v) => v.length >= 2);
    const cjk2: string[] = [];
    for (const token of base) {
      if (/^[\p{Script=Han}]+$/u.test(token) && token.length >= 2) {
        for (let i = 0; i < token.length - 1; i += 1) {
          cjk2.push(token.slice(i, i + 2));
        }
      }
    }

    return new Set([...base, ...cjk2]);
  }

  /** 委托 `ToolRegistry.execute` 执行单次工具（带超时，避免单步卡死整轮） */
  private async executeTool(sessionId: string, toolCall: ToolCall): Promise<ToolResult> {
    const ms = this.toolTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = this.tools.execute(toolCall, { sessionId });
    const timeoutPromise = new Promise<ToolResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            toolCallId: toolCall.id,
            ok: false,
            output: null,
            error: `工具执行超时（${Math.round(ms / 1000)}s）：${toolCall.toolName}。已跳过该步，请根据结果继续或换策略。`,
          }),
        ms,
      );
    });
    try {
      return await Promise.race([run, timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * 在未注入 compactor 的情况下做兜底裁剪，避免历史无限增长导致上游 400（上下文过长/无效）。
   */
  private fallbackTrimHistory(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length <= AssistantRuntime.FALLBACK_MAX_MESSAGES) {
      return messages;
    }
    return messages.slice(-AssistantRuntime.FALLBACK_MAX_MESSAGES);
  }

  /**
   * 规范化工具回放链路，避免 Anthropic 兼容接口 400：
   * - 丢弃无对应 tool_use 的 tool_result
   * - 丢弃“未完成的 tool_use”（没有对应 tool_result）
   */
  private dropDanglingToolResults(messages: ChatMessage[]): ChatMessage[] {
    const SAFE_TOOL_ID_RE = /^[a-z0-9_]+$/;

    const assistantToolUseByMsg = new Map<string, string[]>();
    const resultIds = new Set<string>();

    for (const msg of messages) {
      const wire = getAnthropicWire(msg);
      if (!wire || !Array.isArray(wire.content)) continue;

      if (wire.role === 'assistant') {
        const ids: string[] = [];
        for (const block of wire.content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (b['type'] !== 'tool_use') continue;
          const id = typeof b['id'] === 'string' ? b['id'] : '';
          if (id && SAFE_TOOL_ID_RE.test(id)) ids.push(id);
        }
        if (ids.length > 0) assistantToolUseByMsg.set(msg.id, ids);
        continue;
      }

      if (wire.role === 'user') {
        for (const block of wire.content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (b['type'] !== 'tool_result') continue;
          const toolUseId = typeof b['tool_use_id'] === 'string' ? b['tool_use_id'] : '';
          if (toolUseId && SAFE_TOOL_ID_RE.test(toolUseId)) resultIds.add(toolUseId);
        }
      }
    }

    const completedToolUseIds = new Set<string>();
    for (const ids of assistantToolUseByMsg.values()) {
      for (const id of ids) {
        if (resultIds.has(id)) completedToolUseIds.add(id);
      }
    }

    const kept: ChatMessage[] = [];
    for (const msg of messages) {
      const wire = getAnthropicWire(msg);
      if (!wire || !Array.isArray(wire.content)) {
        kept.push(msg);
        continue;
      }

      if (wire.role === 'assistant') {
        let hasToolUse = false;
        let allCompleted = true;
        for (const block of wire.content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (b['type'] !== 'tool_use') continue;
          hasToolUse = true;
          const id = typeof b['id'] === 'string' ? b['id'] : '';
          if (!id || !SAFE_TOOL_ID_RE.test(id) || !completedToolUseIds.has(id)) {
            allCompleted = false;
            break;
          }
        }
        if (hasToolUse && !allCompleted) {
          continue;
        }
        kept.push(msg);
        continue;
      }

      if (wire.role === 'user') {
        let hasToolResult = false;
        let allMatched = true;
        for (const block of wire.content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (b['type'] !== 'tool_result') continue;
          hasToolResult = true;
          const toolUseId = typeof b['tool_use_id'] === 'string' ? b['tool_use_id'] : '';
          if (!toolUseId || !SAFE_TOOL_ID_RE.test(toolUseId) || !completedToolUseIds.has(toolUseId)) {
            allMatched = false;
            break;
          }
        }
        if (hasToolResult && !allMatched) {
          continue;
        }
      }

      kept.push(msg);
    }

    return kept;
  }
}
