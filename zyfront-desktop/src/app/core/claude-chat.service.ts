/**
 * 轻量聊天服务（Signal 版）：封装 `AssistantRuntime` 的发送、流式输出与历史同步。
 * 与 `ClaudeAgentService` 二选一使用场景不同：本服务更偏简洁状态，Agent 服务带 RxJS 与更多 UI 状态。
 */
import { Inject, Injectable, signal } from '@angular/core';
import {
  type ChatMessage,
  type StreamChunk,
  type ToolCall,
} from 'zyfront-core';
import { CLAUDE_CORE_CONFIG, CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './zyfront-core.providers';

@Injectable({ providedIn: 'root' })
export class ClaudeChatService {
  /** 是否处于流式生成中 */
  readonly isStreaming = signal(false);
  /** 当前会话 id，与历史存储键一致 */
  readonly sessionId = signal('default');
  /** 当前会话消息列表（与 core 历史对齐） */
  readonly messages = signal<ChatMessage[]>([]);
  /** 协调器模式：单轮 / 计划 / 并行 */
  readonly planMode = signal<'single' | 'plan' | 'parallel'>('single');

  constructor(
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
    @Inject(CLAUDE_CORE_CONFIG) private readonly config: { defaultSessionId?: string },
  ) {
    this.sessionId.set(config.defaultSessionId ?? 'default');
    this.hydrate();
  }

  /** 从 core 历史与协调器拉取最新状态到 Signal */
  async hydrate(): Promise<void> {
    const history = await this.runtime.history.list(this.sessionId());
    this.messages.set(history);
    this.planMode.set(this.runtime.coordinator.getState().mode);
  }

  /** 非流式发送一轮用户消息并刷新历史 */
  async send(userInput: string): Promise<void> {
    if (!userInput.trim()) return;

    const response = await this.runtime.assistant.chatWithMeta(this.sessionId(), {
      userInput,
      config: this.runtime.client.getModel(),
    });

    const history = await this.runtime.history.list(this.sessionId());
    this.messages.set(history);
    this.planMode.set(this.runtime.coordinator.getState().mode);

    if (response.usage) {
      // extension point for cost tracker UI binding
    }
  }

  /** 流式发送：边读 SSE chunk 边更新最后一条助手消息 */
  async sendStream(userInput: string): Promise<void> {
    if (!userInput.trim()) return;

    this.isStreaming.set(true);

    const streamResult = this.runtime.assistant.stream(this.sessionId(), {
      userInput,
      config: this.runtime.client.getModel(),
    });

    const reader = streamResult.stream.getReader();
    let partial = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.applyChunk(value, partial);
        if (value.type === 'delta') {
          partial += value.textDelta;
        }
      }
    } finally {
      reader.releaseLock();
      this.isStreaming.set(false);
      const history = await this.runtime.history.list(this.sessionId());
      this.messages.set(history);
      this.planMode.set(this.runtime.coordinator.getState().mode);
    }
  }

  /** 执行模型下发的一次工具调用（如本地 Bridge 工具） */
  async executeTool(toolCall: ToolCall): Promise<void> {
    await this.runtime.tools.execute(toolCall, { sessionId: this.sessionId() });
  }

  /** 将流式分片应用到 `messages`：文本增量或触发工具执行 */
  private applyChunk(chunk: StreamChunk, partial: string): void {
    if (chunk.type === 'delta') {
      const current = this.messages();
      const last = current[current.length - 1];
      if (last?.role === 'assistant') {
        const updated: ChatMessage = {
          ...last,
          content: partial + chunk.textDelta,
        };
        this.messages.set([...current.slice(0, -1), updated]);
      } else {
        this.messages.set([
          ...current,
          {
            id: `stream_${Date.now()}`,
            role: 'assistant',
            content: chunk.textDelta,
            timestamp: Date.now(),
          },
        ]);
      }
      return;
    }

    if (chunk.type === 'tool_call' && chunk.toolCall) {
      void this.executeTool(chunk.toolCall);
    }
  }
}
