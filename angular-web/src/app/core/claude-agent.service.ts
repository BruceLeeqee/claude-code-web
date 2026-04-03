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
  type CoordinationMode,
  type CoordinationStep,
  type CostBreakdown,
  type StreamChunk,
  type ToolCall,
} from 'claude-core';
import { CLAUDE_CORE_CONFIG, CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './claude-core.providers';

export type AgentStatus = 'idle' | 'streaming' | 'error';

export interface UiMcpServer {
  id: string;
  name: string;
  endpoint: string;
  status: 'online' | 'offline';
  enabled: boolean;
}

export interface UiToolLog {
  id: string;
  ts: number;
  toolName: string;
  action: string;
  result: 'success' | 'skipped' | 'failed';
  detail?: string;
}

export interface UiToggleItem {
  id: string;
  name: string;
  enabled: boolean;
  scope: 'skill' | 'plugin';
}

@Injectable({ providedIn: 'root' })
export class ClaudeAgentService {
  private readonly sessionId: string;

  private readonly messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private readonly planModeSubject = new BehaviorSubject<CoordinationMode>('single');
  private readonly planStepsSubject = new BehaviorSubject<CoordinationStep[]>([]);
  private readonly toolsSubject = new BehaviorSubject<string[]>([]);
  private readonly costSubject = new BehaviorSubject<CostBreakdown>({
    inputCostUsd: 0,
    outputCostUsd: 0,
    cacheCostUsd: 0,
    totalCostUsd: 0,
  });
  private readonly statusSubject = new BehaviorSubject<AgentStatus>('idle');
  private readonly streamErrorSubject = new Subject<string>();

  private readonly mcpServersSubject = new BehaviorSubject<UiMcpServer[]>([
    { id: 'official', name: 'Official Registry', endpoint: 'https://mcp.claude.ai/registry', status: 'online', enabled: true },
    { id: 'internal', name: 'Internal Gateway', endpoint: 'https://proxy.local/mcp', status: 'offline', enabled: false },
  ]);
  private readonly toolLogsSubject = new BehaviorSubject<UiToolLog[]>([]);
  private readonly togglesSubject = new BehaviorSubject<UiToggleItem[]>([
    { id: 'plan-writer', name: 'Plan Writer', enabled: true, scope: 'skill' },
    { id: 'context-booster', name: 'Context Booster', enabled: true, scope: 'skill' },
    { id: 'analytics-hook', name: 'Analytics Hook', enabled: true, scope: 'plugin' },
    { id: 'promo-overlay', name: 'Promo Overlay', enabled: false, scope: 'plugin' },
  ]);

  readonly messages$ = this.messagesSubject.asObservable();
  readonly planMode$ = this.planModeSubject.asObservable();
  readonly planSteps$ = this.planStepsSubject.asObservable();
  readonly tools$ = this.toolsSubject.asObservable();
  readonly cost$ = this.costSubject.asObservable();
  readonly status$ = this.statusSubject.asObservable();
  readonly streamError$ = this.streamErrorSubject.asObservable();
  readonly mcpServers$ = this.mcpServersSubject.asObservable();
  readonly toolLogs$ = this.toolLogsSubject.asObservable();
  readonly toggles$ = this.togglesSubject.asObservable();

  readonly vm$: Observable<{
    messages: ChatMessage[];
    mode: CoordinationMode;
    planSteps: CoordinationStep[];
    tools: string[];
    cost: CostBreakdown;
    status: AgentStatus;
    mcpServers: UiMcpServer[];
    toolLogs: UiToolLog[];
    toggles: UiToggleItem[];
  }> = combineLatest([
    this.messages$,
    this.planMode$,
    this.planSteps$,
    this.tools$,
    this.cost$,
    this.status$,
    this.mcpServers$,
    this.toolLogs$,
    this.toggles$,
  ]).pipe(
    map(([messages, mode, planSteps, tools, cost, status, mcpServers, toolLogs, toggles]) => ({
      messages,
      mode,
      planSteps,
      tools,
      cost,
      status,
      mcpServers,
      toolLogs,
      toggles,
    })),
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

    const state = this.runtime.coordinator.getState();
    this.planModeSubject.next(state.mode);
    this.planStepsSubject.next(state.steps);

    this.toolsSubject.next(this.runtime.tools.list().map((t) => t.name));
  }

  setPlanMode(mode: CoordinationMode): void {
    this.runtime.coordinator.setMode(mode);
    this.planModeSubject.next(mode);
    this.appendLog({ toolName: 'coordinator', action: `set-mode:${mode}`, result: 'success' });
  }

  generatePlanFromText(raw: string): void {
    const steps = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((title, idx) => ({
        id: `step_${Date.now()}_${idx + 1}`,
        title,
        status: 'pending' as const,
      }));

    if (steps.length === 0) return;

    this.runtime.coordinator.setMode('plan');
    this.runtime.coordinator.setSteps(steps);
    this.planModeSubject.next('plan');
    this.planStepsSubject.next(steps);
    this.appendLog({ toolName: 'coordinator', action: 'plan-generated', result: 'success', detail: `${steps.length} steps` });
  }

  async executeStep(stepId: string): Promise<void> {
    this.runtime.coordinator.updateStep(stepId, { status: 'in_progress' });
    this.syncPlanState();

    await new Promise((resolve) => setTimeout(resolve, 300));

    this.runtime.coordinator.updateStep(stepId, { status: 'completed' });
    this.syncPlanState();
    this.appendLog({ toolName: 'coordinator', action: `step-execute:${stepId}`, result: 'success' });
  }

  skipStep(stepId: string): void {
    this.runtime.coordinator.updateStep(stepId, { status: 'cancelled', detail: 'Skipped by user' });
    this.syncPlanState();
    this.appendLog({ toolName: 'coordinator', action: `step-skip:${stepId}`, result: 'skipped' });
  }

  retryStep(stepId: string): void {
    this.runtime.coordinator.updateStep(stepId, { status: 'pending', detail: 'Retry queued' });
    this.syncPlanState();
    this.appendLog({ toolName: 'coordinator', action: `step-retry:${stepId}`, result: 'success' });
  }

  cancelStep(stepId: string): void {
    this.runtime.coordinator.updateStep(stepId, { status: 'cancelled', detail: 'Cancelled by user' });
    this.syncPlanState();
    this.appendLog({ toolName: 'coordinator', action: `step-cancel:${stepId}`, result: 'skipped' });
  }

  toggleMcpServer(serverId: string): void {
    const next: UiMcpServer[] = this.mcpServersSubject.value.map((server) =>
      server.id === serverId ? { ...server, enabled: !server.enabled } : server,
    );
    this.mcpServersSubject.next(next);

    const server = next.find((s) => s.id === serverId);
    this.appendLog({
      toolName: 'mcp',
      action: `server-toggle:${server?.name ?? serverId}`,
      result: 'success',
      detail: `enabled=${server?.enabled ?? false}`,
    });
  }

  refreshMcpStatus(serverId: string): void {
    const next: UiMcpServer[] = this.mcpServersSubject.value.map((server) =>
      server.id === serverId
        ? {
            ...server,
            status: (server.status === 'online' ? 'offline' : 'online') as UiMcpServer['status'],
          }
        : server,
    );
    this.mcpServersSubject.next(next);

    const server = next.find((s) => s.id === serverId);
    this.appendLog({
      toolName: 'mcp',
      action: `server-refresh:${server?.name ?? serverId}`,
      result: 'success',
      detail: `status=${server?.status ?? 'unknown'}`,
    });
  }

  toggleCapability(itemId: string): void {
    const next = this.togglesSubject.value.map((item) =>
      item.id === itemId ? { ...item, enabled: !item.enabled } : item,
    );
    this.togglesSubject.next(next);
    const item = next.find((x) => x.id === itemId);
    this.appendLog({
      toolName: item?.scope ?? 'capability',
      action: `toggle:${item?.name ?? itemId}`,
      result: 'success',
      detail: `enabled=${item?.enabled ?? false}`,
    });
  }

  clearToolLogs(): void {
    this.toolLogsSubject.next([]);
  }

  async replayDemoScript(): Promise<void> {
    this.setPlanMode('plan');
    this.generatePlanFromText('需求澄清\n方案设计\n实现与联调\n结果复盘');

    const steps = this.planStepsSubject.value;
    for (const step of steps) {
      await this.executeStep(step.id);
      await new Promise((resolve) => setTimeout(resolve, 260));
    }

    this.appendLog({ toolName: 'demo', action: 'replay-finished', result: 'success' });
  }

  async clearSession(): Promise<void> {
    await this.runtime.history.clear(this.sessionId);
    this.messagesSubject.next([]);

    this.runtime.coordinator.setMode('single');
    this.runtime.coordinator.setSteps([]);
    this.planModeSubject.next('single');
    this.planStepsSubject.next([]);

    this.costSubject.next({
      inputCostUsd: 0,
      outputCostUsd: 0,
      cacheCostUsd: 0,
      totalCostUsd: 0,
    });
    this.statusSubject.next('idle');
    this.appendLog({ toolName: 'session', action: 'clear-session', result: 'success' });
  }

  exportHistory(): string {
    return JSON.stringify(
      {
        sessionId: this.sessionId,
        exportedAt: new Date().toISOString(),
        mode: this.planModeSubject.value,
        messages: this.messagesSubject.value,
        planSteps: this.planStepsSubject.value,
        cost: this.costSubject.value,
      },
      null,
      2,
    );
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
        this.appendCost(response.usage.inputTokens, response.usage.outputTokens);
      }

      if (this.planModeSubject.value === 'single' && userInput.toLowerCase().includes('plan')) {
        this.runtime.coordinator.setMode('plan');
      }

      await this.hydrate();
      this.statusSubject.next('idle');
      this.appendLog({ toolName: 'assistant', action: 'chat-send', result: 'success' });
    } catch (error) {
      this.statusSubject.next('error');
      this.streamErrorSubject.next(error instanceof Error ? error.message : '请求失败');
      this.appendLog({ toolName: 'assistant', action: 'chat-send', result: 'failed' });
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
        if (value.type === 'delta') partial += value.textDelta;
      }

      await this.hydrate();
      this.statusSubject.next('idle');
      this.appendLog({ toolName: 'assistant', action: 'chat-stream', result: 'success' });
    } catch (error) {
      this.statusSubject.next('error');
      this.streamErrorSubject.next(error instanceof Error ? error.message : '流式请求失败');
      this.appendLog({ toolName: 'assistant', action: 'chat-stream', result: 'failed' });
    } finally {
      reader.releaseLock();
    }
  }

  async executeTool(toolCall: ToolCall): Promise<void> {
    await this.runtime.tools.execute(toolCall, { sessionId: this.sessionId });
    this.appendLog({ toolName: toolCall.toolName, action: 'tool-execute', result: 'success' });
  }

  private syncPlanState(): void {
    const state = this.runtime.coordinator.getState();
    this.planModeSubject.next(state.mode);
    this.planStepsSubject.next(state.steps);
  }

  private appendCost(inputTokens: number, outputTokens: number): void {
    const input = Number((inputTokens / 1_000_000).toFixed(6));
    const output = Number((outputTokens / 1_000_000).toFixed(6));
    const current = this.costSubject.value;

    this.costSubject.next({
      inputCostUsd: Number((current.inputCostUsd + input).toFixed(6)),
      outputCostUsd: Number((current.outputCostUsd + output).toFixed(6)),
      cacheCostUsd: current.cacheCostUsd,
      totalCostUsd: Number((current.totalCostUsd + input + output).toFixed(6)),
    });
  }

  private appendLog(log: Omit<UiToolLog, 'id' | 'ts'>): void {
    const next: UiToolLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      ...log,
    };

    this.toolLogsSubject.next([next, ...this.toolLogsSubject.value].slice(0, 100));
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
      this.appendLog({ toolName: 'assistant', action: 'stream-error', result: 'failed', detail: chunk.error });
    }
  }
}
