import { Injectable } from '@angular/core';
import type { TeammateBackend, TeammateSendMessageInput, TeammateTerminateInput } from './multi-agent.backend';
import type { TeammateSpawnConfig, TeammateSpawnResult } from './multi-agent.types';

interface TmuxSessionState {
  sessionName: string;
  paneId?: string;
  cwd?: string;
  attached: boolean;
  lastSeenAt: number;
}

interface ShellExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

interface ResolvedTmuxCommand {
  command: string;
  cwd: string;
  scope: 'workspace' | 'vault';
  shellFlavor: 'windows-wsl' | 'posix';
}

@Injectable({ providedIn: 'root' })
export class MultiAgentTmuxBackend implements TeammateBackend {
  readonly backendType = 'tmux' as const;

  private readonly active = new Map<string, TeammateSpawnResult>();
  private readonly sessions = new Map<string, TmuxSessionState>();

  async spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    const now = Date.now();
    const safeName = config.name.trim() || 'teammate';
    const teamName = config.teamName.trim() || 'workbench-team';
    const agentId = `${safeName.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}@${teamName}`;
    const session = this.sessionName(teamName);
    const cwd = config.cwd?.trim() || '.';

    const quotedCwd = this.quotePath(cwd);
    const bootstrap = await this.execTmux(
      `has-session -t ${this.quoteTmuxArg(session)} || new-session -d -s ${this.quoteTmuxArg(session)} -c ${quotedCwd}`,
      cwd,
    );
    if (!bootstrap.ok && bootstrap.code !== 0 && bootstrap.code !== 1) {
      throw new Error(this.formatTmuxError(`has-session/new-session bootstrap for ${session}`, bootstrap));
    }

    const paneIdOut = await this.execTmux(
      `new-window -d -P -F '#{pane_id}' -t ${this.quoteTmuxArg(session)} -c ${quotedCwd}`,
      cwd,
    );
    let paneId = (paneIdOut.stdout ?? '').trim().split(/\r?\n/)[0]?.trim() || undefined;
    if (!paneId) {
      const attachProbe = await this.execTmux(`list-panes -t ${this.quoteTmuxArg(session)} -F '#{pane_id}'`, cwd);
      paneId = (attachProbe.stdout ?? '').trim().split(/\r?\n/)[0]?.trim() || undefined;
    }
    if (!paneId) throw new Error('tmux spawn failed: pane id missing');

    await this.execTmux(
      `send-keys -t ${this.quoteTmuxArg(paneId)} ${this.quoteTmuxArg(`echo [${safeName}] spawned in tmux pane`)} C-m`,
      cwd,
    );
    if (config.prompt?.trim()) {
      await this.execTmux(
        `send-keys -t ${this.quoteTmuxArg(paneId)} ${this.quoteTmuxArg(config.prompt.trim())} C-m`,
        cwd,
      );
    }

    const result: TeammateSpawnResult = {
      identity: {
        agentId,
        agentName: safeName,
        teamName,
        color: this.assignColor(agentId),
        model: config.model,
        cwd,
        planModeRequired: config.planModeRequired,
        agentType: config.agentType,
      },
      backend: 'tmux',
      status: 'running',
      paneId,
      windowId: session,
      startedAt: now,
      lastUpdatedAt: now,
    };

    this.active.set(agentId, result);
    this.sessions.set(agentId, { sessionName: session, paneId, cwd, attached: false, lastSeenAt: now });
    return result;
  }

  async sendMessage(input: TeammateSendMessageInput): Promise<{ ok: true; deliveredAt: number }> {
    const deliveredAt = Date.now();
    if (!input.toAgentId) return { ok: true, deliveredAt };
    const agent = this.active.get(input.toAgentId);
    if (!agent?.paneId) throw new Error(`tmux teammate pane not found: ${input.toAgentId}`);

    await this.execTmux(
      `send-keys -t ${this.quoteTmuxArg(agent.paneId)} ${this.quoteTmuxArg(input.text)} C-m`,
      agent.identity.cwd,
    );
    this.touchSession(input.toAgentId);
    return { ok: true, deliveredAt };
  }

  async terminate(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number; graceful: boolean }> {
    const stoppedAt = Date.now();
    const agent = this.active.get(input.agentId);
    if (agent?.paneId) {
      await this.execTmux(`send-keys -t ${this.quoteTmuxArg(agent.paneId)} ${this.quoteTmuxArg('exit')} C-m`, agent.identity.cwd);
      await this.execTmux(`kill-pane -t ${this.quoteTmuxArg(agent.paneId)}${this.redirectStderrToNull()}`, agent.identity.cwd);
    }
    this.touchSession(input.agentId, true);
    this.active.delete(input.agentId);
    return { ok: true, stoppedAt, graceful: true };
  }

  async kill(input: TeammateTerminateInput): Promise<{ ok: true; stoppedAt: number }> {
    const stoppedAt = Date.now();
    const agent = this.active.get(input.agentId);
    if (agent?.paneId) {
      await this.execTmux(`kill-pane -t ${this.quoteTmuxArg(agent.paneId)}${this.redirectStderrToNull()}`, agent.identity.cwd);
    }
    this.touchSession(input.agentId, true);
    this.active.delete(input.agentId);
    return { ok: true, stoppedAt };
  }

  async isActive(agentId: string): Promise<boolean> {
    const agent = this.active.get(agentId);
    if (!agent?.paneId) return false;
    const r = await this.execTmux(
      `display-message -p -t ${this.quoteTmuxArg(agent.paneId)} '#{pane_id}'${this.redirectStderrToNull()}`,
      agent.identity.cwd,
    );
    const pane = (r.stdout ?? '').trim();
    return pane === agent.paneId;
  }

  async attach(agentId: string): Promise<boolean> {
    const session = this.sessions.get(agentId);
    if (!session?.sessionName) return false;
    await this.execTmux(`attach-session -t ${this.quoteTmuxArg(session.sessionName)}`, session.cwd);
    session.attached = true;
    session.lastSeenAt = Date.now();
    return true;
  }

  async detach(agentId: string): Promise<boolean> {
    const session = this.sessions.get(agentId);
    if (!session?.sessionName) return false;
    await this.execTmux(`detach-client -t ${this.quoteTmuxArg(session.sessionName)}`, session.cwd);
    session.attached = false;
    session.lastSeenAt = Date.now();
    return true;
  }

  getSessionState(agentId: string): TmuxSessionState | undefined {
    return this.sessions.get(agentId);
  }

  async detectAvailability(): Promise<{ tmuxAvailable: boolean; wslAvailable: boolean; platform: string; hints: string[] }> {
    const platform = this.detectPlatform();
    const isWindows = platform.includes('win');
    const hints: string[] = [];

    if (isWindows) {
      const wslStatus = await this.tryExec('wsl.exe --status');
      const wslInfo = await this.tryExec('wsl.exe -e bash -lc "echo ok"');
      const tmux = await this.tryExec('wsl.exe -e tmux -V');
      const tmuxAvailable = wslStatus.ok && wslInfo.ok && tmux.ok;
      if (!wslStatus.ok) hints.push('Windows 上需要先启用 WSL2。');
      if (!wslInfo.ok) hints.push('wsl.exe 可用性检测失败，请确认 WSL 正常安装。');
      if (!tmux.ok) hints.push('WSL 中需要安装 tmux。');
      return { tmuxAvailable, wslAvailable: wslStatus.ok, platform, hints };
    }

    const tmux = await this.tryExec('tmux -V');
    if (!tmux.ok) hints.push('当前环境未找到 tmux。');
    return { tmuxAvailable: tmux.ok, wslAvailable: false, platform, hints };
  }

  private touchSession(agentId: string, detached = false): void {
    const session = this.sessions.get(agentId);
    if (!session) return;
    session.attached = !detached && session.attached;
    session.lastSeenAt = Date.now();
  }

  private sessionName(teamName: string): string {
    const safe = teamName.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
    return `zyfront-${safe}`;
  }

  private detectPlatform(): string {
    const g = globalThis as unknown as { process?: { platform?: string } };
    const p = (g.process?.platform ?? '').toLowerCase();
    if (p) return p;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    if (ua.includes('windows')) return 'win32';
    if (ua.includes('mac os')) return 'darwin';
    if (ua.includes('linux')) return 'linux';
    return 'unknown';
  }

  private isWindows(): boolean {
    return this.detectPlatform().includes('win');
  }

  private resolveCommand(command: string, cwd?: string): ResolvedTmuxCommand {
    const platform = this.detectPlatform();
    const windows = platform.includes('win');
    return {
      command,
      cwd: cwd?.trim() || '.',
      scope: 'workspace',
      shellFlavor: windows ? 'windows-wsl' : 'posix',
    };
  }

  private async execTmux(subCommand: string, cwd?: string): Promise<ShellExecResult> {
    const resolved = this.resolveCommand(subCommand, cwd);
    const command = this.buildShellCommand(resolved);
    return this.exec(command, resolved.cwd);
  }

  private buildShellCommand(resolved: ResolvedTmuxCommand): string {
    const tmuxCmd = `tmux ${resolved.command}`;

    if (resolved.shellFlavor === 'windows-wsl') {
      const script = `cd . && ${tmuxCmd} 2>/dev/null`;
      return `wsl.exe -e bash -c ${this.quoteDouble(script)}`;
    }

    const script = `cd ${this.quoteDouble(resolved.cwd)} && ${tmuxCmd} 2>/dev/null`;
    return `bash -c ${this.quoteDouble(script)}`;
  }

  private redirectStderrToNull(flavor: 'windows-wsl' | 'posix' = this.isWindows() ? 'windows-wsl' : 'posix'): string {
    return flavor === 'windows-wsl' ? ' 2>$null' : ' 2>/dev/null';
  }

  private quoteDouble(value: string): string {
    return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
  }

  private quoteShellWord(value: string): string {
    const normalized = value.replace(/\\/g, '/');
    return `'${normalized.replace(/'/g, `'"'"'`)}'`;
  }

  private quotePath(value: string): string {
    return this.quoteShellWord(value);
  }

  private quoteTmuxArg(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }

  private async tryExec(command: string, cwd = '.'): Promise<ShellExecResult> {
    const z = window.zytrader;
    if (!z?.terminal?.exec) {
      return { ok: false, stdout: '', stderr: 'terminal.exec unavailable', code: -1 };
    }
    try {
      return await z.terminal.exec(command, cwd, 'workspace');
    } catch (error) {
      return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error), code: -1 };
    }
  }

  private async exec(command: string, cwd?: string): Promise<ShellExecResult> {
    const z = window.zytrader;
    if (!z?.terminal?.exec) {
      throw new Error('terminal.exec unavailable');
    }
    const res = await z.terminal.exec(command, cwd ?? '.', 'workspace');
    if (!res.ok || res.code !== 0) {
      throw new Error(this.formatTmuxError(command, res));
    }
    return res;
  }

  private formatTmuxError(command: string, res: ShellExecResult): string {
    const stderr = res.stderr?.trim();
    const stdout = res.stdout?.trim();
    const body = stderr || stdout || `code=${res.code}`;
    return `tmux command failed: ${command}\n${body}`;
  }

  private assignColor(agentId: string): string {
    const palette = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee'];
    let hash = 0;
    for (let i = 0; i < agentId.length; i += 1) hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length] ?? '#60a5fa';
  }
}
