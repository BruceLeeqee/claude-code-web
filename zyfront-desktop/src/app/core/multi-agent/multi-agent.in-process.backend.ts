import { Inject, Injectable } from '@angular/core';
import type { TeammateBackend, TeammateSendMessageInput, TeammateTerminateInput } from './multi-agent.backend';
import type { TeammateSpawnConfig, TeammateSpawnResult } from './multi-agent.types';
import { MultiAgentEventBusService } from './multi-agent.event-bus.service';
import { MultiAgentSessionService } from './multi-agent.session';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../zyfront-core.providers';

@Injectable({ providedIn: 'root' })
export class MultiAgentInProcessBackend implements TeammateBackend {
  readonly backendType = 'in-process' as const;

  private readonly active = new Map<string, TeammateSpawnResult>();
  private readonly history = new Map<string, TeammateSpawnResult>();
  private readonly configs = new Map<string, TeammateSpawnConfig>();

  constructor(
    private readonly eventBus: MultiAgentEventBusService,
    private readonly session: MultiAgentSessionService,
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
  ) {}

  async spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    const now = Date.now();
    const safeName = config.name.trim() || 'teammate';
    const agentId = `${safeName.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}@${config.teamName}`;
    const existing = this.history.get(agentId);

    const result: TeammateSpawnResult = {
      identity: {
        agentId,
        agentName: safeName,
        teamName: config.teamName,
        color: existing?.identity.color ?? this.assignColor(agentId),
        model: config.model,
        cwd: config.cwd,
        planModeRequired: config.planModeRequired,
        agentType: config.agentType,
        parentSessionId: existing?.identity.parentSessionId,
      },
      backend: 'in-process',
      status: 'running',
      startedAt: existing?.startedAt ?? now,
      lastUpdatedAt: now,
      lastError: undefined,
      lastStoppedAt: undefined,
      fallbackFromMode: config.mode && config.mode !== 'in-process' ? config.mode : existing?.fallbackFromMode,
      fallbackReason: config.mode && config.mode !== 'in-process' ? 'in-process backend selected as stable fallback' : existing?.fallbackReason,
    };

    this.active.set(agentId, result);
    this.history.set(agentId, result);
    this.configs.set(agentId, config);

    return result;
  }

  async sendMessage(input: TeammateSendMessageInput): Promise<{ ok: true; deliveredAt: number }> {
    const agentId = input.toAgentId ?? '';
    console.log(`[InProcessBackend] sendMessage called with toAgentId: ${agentId}`);
    console.log(`[InProcessBackend] active agents:`, [...this.active.keys()]);
    console.log(`[InProcessBackend] configs keys:`, [...this.configs.keys()]);
    
    const current = this.active.get(agentId);
    const config = this.configs.get(agentId);
    
    console.log(`[InProcessBackend] current found:`, !!current);
    console.log(`[InProcessBackend] config found:`, !!config);
    
    if (current) {
      const updated = { ...current, lastUpdatedAt: Date.now(), status: 'running' as const };
      this.active.set(current.identity.agentId, updated);
      this.history.set(current.identity.agentId, updated);
    }

    this.eventBus.emit({
      type: 'multiagent.teammate.message',
      sessionId: this.session.getSessionId(),
      source: 'leader',
      payload: {
        direction: 'leader_to_teammate',
        fromAgentId: input.fromAgentId,
        toAgentId: agentId,
        teamName: input.teamName,
        text: input.text,
        textPreview: input.text.slice(0, 120),
      },
    });

    if (current && config) {
      console.log(`[InProcessBackend] Invoking LLM for ${agentId}`);
      this.invokeLLMAndRespond(agentId, current, config, input.text).catch(error => {
        console.error(`LLM invocation failed for ${agentId}:`, error);
        this.eventBus.emit({
          type: 'multiagent.teammate.failed',
          sessionId: this.session.getSessionId(),
          source: 'backend',
          payload: {
            agentId,
            stage: 'message',
            code: 'LLM_ERROR',
            message: error instanceof Error ? error.message : String(error),
            retriable: true,
          },
        });
      });
    } else {
      console.warn(`[InProcessBackend] No agent or config found for ${agentId}`);
    }

    return { ok: true, deliveredAt: Date.now() };
  }

  private async invokeLLMAndRespond(
    agentId: string,
    teammate: TeammateSpawnResult,
    config: TeammateSpawnConfig,
    userMessage: string,
  ): Promise<void> {
    const assistant = this.runtime.assistant;
    const client = this.runtime.client;
    
    const systemPrompt = config.prompt || '你是一个智能助手，请根据用户的问题给出专业的回答。';
    
    const sessionId = `debate-${agentId}-${Date.now()}`;
    
    console.log(`[InProcessBackend] Calling LLM for ${agentId} with sessionId ${sessionId}`);
    console.log(`[InProcessBackend] System prompt:`, systemPrompt.slice(0, 200));
    console.log(`[InProcessBackend] User message:`, userMessage.slice(0, 200));

    let responseText = '';

    try {
      const modelConfig = client.getModel();
      console.log(`[InProcessBackend] Model config:`, modelConfig);
      
      const response = await assistant.chatWithMeta(sessionId, {
        userInput: userMessage,
        systemPrompt: systemPrompt,
        config: modelConfig,
      });
      
      responseText = response.message?.content || '';
      console.log(`[InProcessBackend] LLM response for ${agentId}:`, responseText.slice(0, 200));
    } catch (error) {
      console.error(`[InProcessBackend] LLM call failed for ${agentId}:`, error);
      responseText = `[${teammate.identity.agentName}] 抱歉，我暂时无法回应。错误：${error instanceof Error ? error.message : String(error)}`;
    }

    if (!responseText) {
      responseText = `[${teammate.identity.agentName}] 收到消息，正在思考中...`;
    }

    this.eventBus.emit({
      type: 'multiagent.teammate.message',
      sessionId: this.session.getSessionId(),
      source: 'teammate',
      payload: {
        direction: 'teammate_to_leader',
        fromAgentId: agentId,
        toAgentId: 'leader',
        teamName: teammate.identity.teamName,
        text: responseText,
        textPreview: responseText.slice(0, 120),
      },
    });

    const updated = { 
      ...teammate, 
      lastUpdatedAt: Date.now(), 
      status: 'idle' as const 
    };
    this.active.set(agentId, updated);
    this.history.set(agentId, updated);

    this.eventBus.emit({
      type: 'multiagent.teammate.state.changed',
      sessionId: this.session.getSessionId(),
      source: 'backend',
      payload: {
        agentId,
        prev: 'running',
        next: 'idle',
        reason: 'Response completed',
      },
    });
  }

  async terminate(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number; graceful: boolean }> {
    const stoppedAt = Date.now();
    const current = this.active.get(input.agentId) ?? this.history.get(input.agentId);
    if (current) {
      const updated = { ...current, status: 'stopped' as const, lastUpdatedAt: stoppedAt, lastStoppedAt: stoppedAt, lastError: undefined };
      this.history.set(input.agentId, updated);
    }
    this.active.delete(input.agentId);
    this.configs.delete(input.agentId);
    return { ok: true, stoppedAt, graceful: true };
  }

  async kill(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number }> {
    const stoppedAt = Date.now();
    const current = this.active.get(input.agentId) ?? this.history.get(input.agentId);
    if (current) {
      const updated = { ...current, status: 'stopped' as const, lastUpdatedAt: stoppedAt, lastStoppedAt: stoppedAt, lastError: input.reason ?? 'killed' };
      this.history.set(input.agentId, updated);
    }
    this.active.delete(input.agentId);
    this.configs.delete(input.agentId);
    return { ok: true, stoppedAt };
  }

  async isActive(agentId: string): Promise<boolean> {
    return this.active.has(agentId);
  }

  getHistory(agentId: string): TeammateSpawnResult | undefined {
    return this.history.get(agentId);
  }

  private assignColor(agentId: string): string {
    const palette = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee'];
    let hash = 0;
    for (let i = 0; i < agentId.length; i += 1) hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length] ?? '#60a5fa';
  }
}
