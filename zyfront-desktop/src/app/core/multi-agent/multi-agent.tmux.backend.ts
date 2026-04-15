import { Injectable } from '@angular/core';
import type { TeammateBackend, TeammateSendMessageInput, TeammateTerminateInput } from './multi-agent.backend';
import type { TeammateSpawnConfig, TeammateSpawnResult } from './multi-agent.types';

@Injectable({ providedIn: 'root' })
export class MultiAgentTmuxBackend implements TeammateBackend {
  readonly backendType = 'tmux' as const;

  private readonly active = new Map<string, TeammateSpawnResult>();

  async spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    const now = Date.now();
    const safeName = config.name.trim() || 'teammate';
    const teamName = config.teamName.trim() || 'workbench-team';
    const agentId = `${safeName.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}@${teamName}`;
    const session = this.sessionName(teamName);

    await this.exec(`tmux has-session -t ${session} 2>/dev/null || tmux new-session -d -s ${session}`, config.cwd);
    const paneIdOut = await this.exec(`tmux split-window -d -P -F "#{pane_id}" -t ${session}`, config.cwd);
    const paneId = (paneIdOut.stdout ?? '').trim().split(/\r?\n/)[0]?.trim() || undefined;
    if (!paneId) throw new Error('tmux spawn failed: pane id missing');

    // 在 pane 内留一行标识，便于后续排障与观测。
    await this.exec(`tmux send-keys -t ${paneId} "echo [${safeName}] spawned in tmux pane" C-m`, config.cwd);
    if (config.prompt?.trim()) {
      await this.exec(`tmux send-keys -t ${paneId} ${this.quoteForTmux(config.prompt.trim())} C-m`, config.cwd);
    }

    const result: TeammateSpawnResult = {
      identity: {
        agentId,
        agentName: safeName,
        teamName,
        color: this.assignColor(agentId),
        model: config.model,
        cwd: config.cwd,
        planModeRequired: config.planModeRequired,
        agentType: config.agentType,
      },
      backend: 'tmux',
      status: 'running',
      paneId,
      windowId: session,
      startedAt: now,
    };
    this.active.set(agentId, result);
    return result;
  }

  async sendMessage(input: TeammateSendMessageInput): Promise<{ ok: true; deliveredAt: number }> {
    if (!input.toAgentId) return { ok: true, deliveredAt: Date.now() };
    const agent = this.active.get(input.toAgentId);
    if (!agent?.paneId) throw new Error(`tmux teammate pane not found: ${input.toAgentId}`);
    await this.exec(`tmux send-keys -t ${agent.paneId} ${this.quoteForTmux(input.text)} C-m`, agent.identity.cwd);
    return { ok: true, deliveredAt: Date.now() };
  }

  async terminate(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number; graceful: boolean }> {
    const agent = this.active.get(input.agentId);
    if (agent?.paneId) {
      await this.exec(`tmux send-keys -t ${agent.paneId} "exit" C-m`, agent.identity.cwd);
      await this.exec(`tmux kill-pane -t ${agent.paneId} 2>/dev/null || true`, agent.identity.cwd);
    }
    this.active.delete(input.agentId);
    return { ok: true, stoppedAt: Date.now(), graceful: true };
  }

  async kill(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number }> {
    const agent = this.active.get(input.agentId);
    if (agent?.paneId) {
      await this.exec(`tmux kill-pane -t ${agent.paneId} 2>/dev/null || true`, agent.identity.cwd);
    }
    this.active.delete(input.agentId);
    return { ok: true, stoppedAt: Date.now() };
  }

  async isActive(agentId: string): Promise<boolean> {
    const agent = this.active.get(agentId);
    if (!agent?.paneId) return false;
    const r = await this.exec(`tmux display-message -p -t ${agent.paneId} "#{pane_id}" 2>/dev/null || true`, agent.identity.cwd);
    const pane = (r.stdout ?? '').trim();
    return pane === agent.paneId;
  }

  private sessionName(teamName: string): string {
    const safe = teamName.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
    return `zyfront-${safe}`;
  }

  private async exec(command: string, cwd?: string): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
    const z = window.zytrader;
    if (!z?.terminal?.exec) {
      throw new Error('terminal.exec unavailable');
    }
    const res = await z.terminal.exec(command, cwd ?? '.', 'workspace');
    if (!res.ok || res.code !== 0) {
      throw new Error(`tmux command failed: ${command}\n${res.stderr || res.stdout || `code=${res.code}`}`);
    }
    return res;
  }

  private quoteForTmux(text: string): string {
    return `'${text.replace(/'/g, `'\"'\"'`)}'`;
  }

  private assignColor(agentId: string): string {
    const palette = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee'];
    let hash = 0;
    for (let i = 0; i < agentId.length; i += 1) hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length] ?? '#60a5fa';
  }
}
