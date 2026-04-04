/**
 * 聊天 Agent 门面（RxJS）：统一管理消息流、计划步骤、工具日志、MCP 占位 UI、成本估算与流式分片渲染。
 * 设置变更会通过 `AppSettingsService` 同步到 `ClaudeClient`。
 */
import { Inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, combineLatest, map } from 'rxjs';
import {
  type ChatMessage,
  type CoordinationMode,
  type CoordinationStep,
  type CostBreakdown,
  type StreamChunk,
  type ToolCall,
} from 'claude-core';
import { CLAUDE_CORE_CONFIG, CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './claude-core.providers';
import { AppSettingsService } from './app-settings.service';

/** 当前对话请求生命周期状态 */
export type AgentStatus = 'idle' | 'streaming' | 'error';

/** 设置页展示的 MCP 服务器占位项 */
export interface UiMcpServer {
  id: string;
  name: string;
  endpoint: string;
  status: 'online' | 'offline';
  enabled: boolean;
}

/** 工具/MCP 等操作的一条审计日志（供聊天侧栏展示） */
export interface UiToolLog {
  id: string;
  ts: number;
  toolName: string;
  action: string;
  result: 'success' | 'skipped' | 'failed';
  detail?: string;
}

/** 技能/插件类能力的开关占位项 */
export interface UiToggleItem {
  id: string;
  name: string;
  enabled: boolean;
  scope: 'skill' | 'plugin';
}

@Injectable({ providedIn: 'root' })
export class ClaudeAgentService {
  /** 与 `InMemoryHistoryStore` 绑定的会话 id */
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

  /** 消息列表流（不做防抖，保证流式每个 token 及时到 UI） */
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

  /** 聚合视图模型：一次订阅拿到聊天页所需的大部分状态 */
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
  );

  constructor(
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
    @Inject(CLAUDE_CORE_CONFIG) private readonly config: { defaultSessionId?: string },
    private readonly appSettings: AppSettingsService,
  ) {
    this.sessionId = config.defaultSessionId ?? 'default';
    this.toolsSubject.next(this.runtime.tools.list().map((t) => t.name));

    this.appSettings.settings$.subscribe((settings) => {
      this.runtime.client.configureRuntime({
        apiKey: settings.apiKey,
        model: {
          provider: settings.modelProvider,
          model: settings.model,
          temperature: this.runtime.client.getModel().temperature ?? 0.2,
          maxTokens: this.runtime.client.getModel().maxTokens ?? 4096,
        },
      });
    });

    void this.hydrate();
  }

  /** 从 core 拉取历史、计划与工具列表并推送到各 Subject */
  async hydrate(): Promise<void> {
    const history = await this.runtime.history.list(this.sessionId);
    this.messagesSubject.next(history);

    const state = this.runtime.coordinator.getState();
    this.planModeSubject.next(state.mode);
    this.planStepsSubject.next(state.steps);

    this.toolsSubject.next(this.runtime.tools.list().map((t) => t.name));
  }

  /** 设置协调模式（单轮 / 计划 / 并行） */
  setPlanMode(mode: CoordinationMode): void {
    this.runtime.coordinator.setMode(mode);
    this.planModeSubject.next(mode);
    this.appendLog({ toolName: 'coordinator', action: `set-mode:${mode}`, result: 'success' });
  }

  /** 将多行文本解析为计划步骤并切换到 plan 模式 */
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

  /** 模拟执行某一步计划（演示用短延迟） */
  async executeStep(stepId: string): Promise<void> {
    this.runtime.coordinator.updateStep(stepId, { status: 'in_progress' });
    this.syncPlanState();

    await new Promise((resolve) => setTimeout(resolve, 300));

    this.runtime.coordinator.updateStep(stepId, { status: 'completed' });
    this.syncPlanState();
    this.appendLog({ toolName: 'coordinator', action: `step-execute:${stepId}`, result: 'success' });
  }

  /** 将步骤标为已跳过 */
  skipStep(stepId: string): void {
    this.runtime.coordinator.updateStep(stepId, { status: 'cancelled', detail: 'Skipped by user' });
    this.syncPlanState();
    this.appendLog({ toolName: 'coordinator', action: `step-skip:${stepId}`, result: 'skipped' });
  }

  /** 将步骤重置为待执行 */
  retryStep(stepId: string): void {
    this.runtime.coordinator.updateStep(stepId, { status: 'pending', detail: 'Retry queued' });
    this.syncPlanState();
    this.appendLog({ toolName: 'coordinator', action: `step-retry:${stepId}`, result: 'success' });
  }

  /** 取消某步骤 */
  cancelStep(stepId: string): void {
    this.runtime.coordinator.updateStep(stepId, { status: 'cancelled', detail: 'Cancelled by user' });
    this.syncPlanState();
    this.appendLog({ toolName: 'coordinator', action: `step-cancel:${stepId}`, result: 'skipped' });
  }

  /** 切换 MCP 服务器占位项的启用状态 */
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

  /** 模拟刷新 MCP 在线状态（在 online/offline 间切换） */
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

  /** 切换技能/插件占位开关 */
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

  /** 清空工具日志列表 */
  clearToolLogs(): void {
    this.toolLogsSubject.next([]);
  }

  /** 演示用：自动生成计划并逐步执行 */
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

  /** 清空本会话历史与计划，并重置成本与状态 */
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

  /** 导出当前会话 JSON（含消息、计划、成本） */
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

  /** 非流式发送用户消息并刷新状态 */
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

  /** 流式发送：处理文本增量、工具调用/结果与错误分片 */
  async sendStream(userInput: string): Promise<void> {
    if (!userInput.trim()) return;

    this.statusSubject.next('streaming');

    const result = this.runtime.assistant.stream(this.sessionId, {
      userInput,
      config: this.runtime.client.getModel(),
    });

    const reader = result.stream.getReader();
    let partial = '';
    let firstChunk = true;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Core appends the user message inside the stream start; sync once before applying
        // deltas so the last row is "user", not the previous turn's assistant.
        if (firstChunk) {
          firstChunk = false;
          await this.hydrate();
        }
        this.applyChunk(value, partial);
        if (value.type === 'delta') partial += value.textDelta;
        else if (value.type === 'tool_result') partial = '';
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

  /** 执行单次工具调用并写入工具日志 */
  async executeTool(toolCall: ToolCall): Promise<void> {
    await this.runtime.tools.execute(toolCall, { sessionId: this.sessionId });
    this.appendLog({ toolName: toolCall.toolName, action: 'tool-execute', result: 'success' });
  }

  /** 从协调器同步计划模式与步骤到 Subject */
  private syncPlanState(): void {
    const state = this.runtime.coordinator.getState();
    this.planModeSubject.next(state.mode);
    this.planStepsSubject.next(state.steps);
  }

  /** 按极简倍率累加 token 成本（演示用，非精确账单） */
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

  /** 前置追加一条工具日志，最多保留 100 条 */
  private appendLog(log: Omit<UiToolLog, 'id' | 'ts'>): void {
    const next: UiToolLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      ...log,
    };

    this.toolLogsSubject.next([next, ...this.toolLogsSubject.value].slice(0, 100));
  }

  /** 将流式分片映射到消息列表与工具日志 */
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

    if (chunk.type === 'anthropic_turn') {
      return;
    }

    if (chunk.type === 'tool_call' && chunk.toolCall) {
      this.appendLog({
        toolName: chunk.toolCall.toolName,
        action: `tool:${chunk.toolCall.toolName}`,
        result: 'success',
        detail: chunk.toolCall.id,
      });
      return;
    }

    if (chunk.type === 'tool_result' && chunk.toolResult) {
      this.appendLog({
        toolName: 'bridge',
        action: 'tool-result',
        result: chunk.toolResult.ok ? 'success' : 'failed',
        detail: chunk.toolResult.error ?? JSON.stringify(chunk.toolResult.output).slice(0, 200),
      });
      return;
    }

    if (chunk.type === 'error' && chunk.error) {
      this.statusSubject.next('error');
      this.streamErrorSubject.next(chunk.error);
      this.appendLog({ toolName: 'assistant', action: 'stream-error', result: 'failed', detail: chunk.error });
    }
  }
}
