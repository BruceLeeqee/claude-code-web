import { Inject, Injectable, signal } from '@angular/core';
import {
  type ChatMessage,
  type StreamChunk,
  type ToolCall,
} from 'claude-core';
import { CLAUDE_CORE_CONFIG, CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './claude-core.providers';

@Injectable({ providedIn: 'root' })
export class ClaudeChatService {
  readonly isStreaming = signal(false);
  readonly sessionId = signal('default');
  readonly messages = signal<ChatMessage[]>([]);
  readonly planMode = signal<'single' | 'plan' | 'parallel'>('single');

  constructor(
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
    @Inject(CLAUDE_CORE_CONFIG) private readonly config: { defaultSessionId?: string },
  ) {
    this.sessionId.set(config.defaultSessionId ?? 'default');
    this.hydrate();
  }

  async hydrate(): Promise<void> {
    const history = await this.runtime.history.list(this.sessionId());
    this.messages.set(history);
    this.planMode.set(this.runtime.coordinator.getState().mode);
  }

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

  async executeTool(toolCall: ToolCall): Promise<void> {
    await this.runtime.tools.execute(toolCall, { sessionId: this.sessionId() });
  }

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
