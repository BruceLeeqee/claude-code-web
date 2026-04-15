import { Injectable } from '@angular/core';
import type { TeammateBackend, TeammateSendMessageInput, TeammateTerminateInput } from './multi-agent.backend';
import type { TeammateSpawnConfig, TeammateSpawnResult } from './multi-agent.types';

@Injectable({ providedIn: 'root' })
export class MultiAgentInProcessBackend implements TeammateBackend {
  readonly backendType = 'in-process' as const;

  private readonly active = new Map<string, TeammateSpawnResult>();

  async spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    const now = Date.now();
    const safeName = config.name.trim() || 'teammate';
    const agentId = `${safeName.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}@${config.teamName}`;

    const result: TeammateSpawnResult = {
      identity: {
        agentId,
        agentName: safeName,
        teamName: config.teamName,
        color: this.assignColor(agentId),
        model: config.model,
        cwd: config.cwd,
        planModeRequired: config.planModeRequired,
        agentType: config.agentType,
      },
      backend: 'in-process',
      status: 'running',
      startedAt: now,
    };

    this.active.set(agentId, result);
    return result;
  }

  async sendMessage(_input: TeammateSendMessageInput): Promise<{ ok: true; deliveredAt: number }> {
    return { ok: true, deliveredAt: Date.now() };
  }

  async terminate(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number; graceful: boolean }> {
    this.active.delete(input.agentId);
    return { ok: true, stoppedAt: Date.now(), graceful: true };
  }

  async kill(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number }> {
    this.active.delete(input.agentId);
    return { ok: true, stoppedAt: Date.now() };
  }

  async isActive(agentId: string): Promise<boolean> {
    return this.active.has(agentId);
  }

  private assignColor(agentId: string): string {
    const palette = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee'];
    let hash = 0;
    for (let i = 0; i < agentId.length; i += 1) hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length] ?? '#60a5fa';
  }
}
