import { Inject, Injectable } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  distinctUntilChanged,
  map,
} from 'rxjs';
import {
  type ChatMessage,
  type CoordinationStep,
  type CostBreakdown,
  type StreamChunk,
  type ToolCall,
} from 'claude-core';
import { CLAUDE_CORE_CONFIG, CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './claude-core.providers';

export type AgentStatus = 'idle' | 'streaming' | 'error';

@Injectable({ providedIn: 'root' })
export class ClaudeAgentService {
  private readonly sessionId: string;

  private readonly messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private readonly planStepsSubject = new BehaviorSubject<CoordinationStep[]>([]);
  private readonly toolsSubject = new BehaviorSubject<string[]>([]);
  private readonly costSubject = new BehaviorSubject<CostBreakdown | null>(null);
  private readonly statusSubject = new BehaviorSubject<AgentStatus>('idle');
  private readonly streamErrorSubject = new Subject<string>();

  readonly messages$ = this.messagesSubject.asObservable();
  readonly planSteps$ = this.planStepsSubject.asObservable();
  readonly tools$ = this.toolsSubject.asObservable();
  readonly cost$ = this.costSubject.asObservable();
  readonly status$ = this.statusSubject.asObservable();
  readonly streamError$ = this.streamErrorSubject.asObservable();

  readonly vm$: Observable<{
    messages: ChatMessage[];
    planSteps: CoordinationStep[];
    tools: string[];
    cost: CostBreakdown | null;
    status: AgentStatus;
  }> = combineLatest([this.messages$, this.planSteps$, this.tools$, this.cost$, this.status$]).pipe(
    map(([messages, planSteps, tools, cost, status]) => ({ messages, planSteps, tools, cost, status })),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  );

  constructor(
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
    @Inject(CLAUDE_CORE_CONFIG) private readonly config: { defaultSessionId?: string },
  ) {
    this.sessionId = config.defaultSessionId ?? 'default';
    this.toolsSubject.next(this.runtime.tools.list().map((t) => t.name));
    void this.hydrate();
  }

  async hydrate(): Promise<void> {
    const history = await this.runtime.history.list(this.sessionId);
    this.messagesSubject.next(history);
    this.planStepsSubject.next(this.runtime.coordinator.getState().steps);
    this.toolsSubject.next(this.runtime.tools.list().map((t) => t.name));
  }

  async send(userInput: string): Promise<void> {
    if (!userInput.trim()) return;

    this.statusSubject.next('streaming');

    try {
      const response = await this.runtime.assistant.chatWithMeta(this.sessionId, {
        userInput,
        config: this.runtime.client.getModel(),
      });

      if (response.usage) {
        const estimatedCost: CostBreakdown = {
          inputCostUsd: Number((response.usage.inputTokens / 1_000_000).toFixed(6)),
          outputCostUsd: Number((response.usage.outputTokens / 1_000_000).toFixed(6)),
          cacheCostUsd: 0,
          totalCostUsd: Number(((response.usage.inputTokens + response.usage.outputTokens) / 1_000_000).toFixed(6)),
        };
        this.costSubject.next(estimatedCost);
      }

      await this.hydrate();
      this.statusSubject.next('idle');
    } catch (error) {
      this.statusSubject.next('error');
      this.streamErrorSubject.next(error instanceof Error ? error.message : '请求失败');
    }
  }

  async sendStream(userInput: string): Promise<void> {
    if (!userInput.trim()) return;

    this.statusSubject.next('streaming');

    const result = this.runtime.assistant.stream(this.sessionId, {
      userInput,
      config: this.runtime.client.getModel(),
    });

    const reader = result.stream.getReader();
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

      await this.hydrate();
      this.statusSubject.next('idle');
    } catch (error) {
      this.statusSubject.next('error');
      this.streamErrorSubject.next(error instanceof Error ? error.message : '流式请求失败');
    } finally {
      reader.releaseLock();
    }
  }

  async executeTool(toolCall: ToolCall): Promise<void> {
    await this.runtime.tools.execute(toolCall, { sessionId: this.sessionId });
  }

  private applyChunk(chunk: StreamChunk, partial: string): void {
    const current = this.messagesSubject.value;

    if (chunk.type === 'delta') {
      const last = current[current.length - 1];
      if (last?.role === 'assistant') {
        this.messagesSubject.next([
          ...current.slice(0, -1),
          {
            ...last,
            content: partial + chunk.textDelta,
          },
        ]);
      } else {
        this.messagesSubject.next([
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
      return;
    }

    if (chunk.type === 'error' && chunk.error) {
      this.statusSubject.next('error');
      this.streamErrorSubject.next(chunk.error);
    }
  }
}
