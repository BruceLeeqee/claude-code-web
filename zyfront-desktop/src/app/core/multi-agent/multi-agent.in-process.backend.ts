import { Injectable } from '@angular/core';
import type { TeammateBackend, TeammateSendMessageInput, TeammateTerminateInput } from './multi-agent.backend';
import type { TeammateSpawnConfig, TeammateSpawnResult } from './multi-agent.types';

@Injectable({ providedIn: 'root' })
export class MultiAgentInProcessBackend implements TeammateBackend {
  readonly backendType = 'in-process' as const;

  private readonly active = new Map<string, TeammateSpawnResult>();
  private readonly history = new Map<string, TeammateSpawnResult>();

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
    return result;
  }

  async sendMessage(input: TeammateSendMessageInput): Promise<{ ok: true; deliveredAt: number }> {
    const current = this.active.get(input.toAgentId ?? '');
    if (current) {
      const updated = { ...current, lastUpdatedAt: Date.now(), status: 'running' as const };
      this.active.set(current.identity.agentId, updated);
      this.history.set(current.identity.agentId, updated);
    }
    return { ok: true, deliveredAt: Date.now() };
  }

  async terminate(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number; graceful: boolean }> {
    const stoppedAt = Date.now();
    const current = this.active.get(input.agentId) ?? this.history.get(input.agentId);
    if (current) {
      const updated = { ...current, status: 'stopped' as const, lastUpdatedAt: stoppedAt, lastStoppedAt: stoppedAt, lastError: undefined };
      this.history.set(input.agentId, updated);
    }
    this.active.delete(input.agentId);
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
