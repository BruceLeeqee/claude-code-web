import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MultiAgentEventBusService } from './multi-agent.event-bus.service';
import { MultiAgentInProcessBackend } from './multi-agent.in-process.backend';
import { MultiAgentITermBackend } from './multi-agent.iterm.backend';
import { MultiAgentSessionService } from './multi-agent.session';
import { MultiAgentTmuxBackend } from './multi-agent.tmux.backend';
import type { BackendDetectionResult, TeammateBackend } from './multi-agent.backend';
import type {
  BackendCapability,
  TeammateMode,
  TeammateSpawnConfig,
  TeammateSpawnResult,
  WorkbenchTeamVm,
  WorkbenchTeammateVm,
} from './multi-agent.types';
import { buildBackendBlockingReason, buildBackendSetupHints } from './multi-agent.backend-setup';

@Injectable({ providedIn: 'root' })
export class MultiAgentOrchestratorService {
  private configuredMode: TeammateMode = 'auto';
  private teamName = 'default';
  private leadAgentId = 'leader@default';
  private version = 0;
  private readonly teammates = new Map<string, TeammateSpawnResult>();
  private readonly lastMessagePreviewByAgent = new Map<string, string>();
  private readonly backendHealth$ = new BehaviorSubject<BackendDetectionResult>(this.createFallbackDetection(this.configuredMode));
  private readonly teamVm$ = new BehaviorSubject<WorkbenchTeamVm>(this.buildVm(this.backendHealth$.value));

  constructor(
    private readonly session: MultiAgentSessionService,
    private readonly eventBus: MultiAgentEventBusService,
    private readonly inProcessBackend: MultiAgentInProcessBackend,
    private readonly tmuxBackend: MultiAgentTmuxBackend,
    private readonly itermBackend: MultiAgentITermBackend,
  ) {
    void this.refreshBackendHealth();
  }

  readonly workbenchTeamVm$ = this.teamVm$.asObservable();
  readonly events$ = this.eventBus.events$;

  async setMode(mode: TeammateMode): Promise<BackendDetectionResult> {
    this.configuredMode = mode;
    const detection = await this.refreshBackendHealth();
    this.emitModeEvents(detection);
    this.refreshVm();
    return detection;
  }

  getMode(): TeammateMode {
    return this.configuredMode;
  }

  async spawnTeammate(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    const before = this.teammates.size;
    const snapshot = this.session.captureModeIfNeeded(this.configuredMode);
    this.eventBus.emit({
      type: 'multiagent.mode.captured',
      sessionId: this.session.getSessionId(),
      source: 'system',
      payload: {
        configuredMode: snapshot.configuredMode,
        effectiveBackend: snapshot.effectiveBackend,
        snapshotAt: snapshot.capturedAt ?? snapshot.snapshotAt,
        capturedAt: snapshot.capturedAt ?? snapshot.snapshotAt,
      },
    });

    const detection = await this.refreshBackendHealth();
    this.emitModeEvents(detection);
    if (detection.blocking || !detection.effectiveBackend) {
      const reason = detection.fallbackReason || `Backend mode "${snapshot.configuredMode}" is blocked in current environment`;
      const setupHints = detection.health.setupHints ?? [];
      this.eventBus.emit({
        type: 'multiagent.error',
        sessionId: this.session.getSessionId(),
        source: 'backend',
        payload: {
          scope: 'backend',
          code: 'BACKEND_BLOCKING',
          message: reason,
          details: {
            configuredMode: snapshot.configuredMode,
            platform: detection.capability.platform,
            setupHints,
          },
        },
      });
      throw new Error(reason);
    }

    if (config.mode === 'in-process' && this.configuredMode === 'auto') {
      config = { ...config, mode: 'in-process' };
    }

    this.teamName = config.teamName;
    this.leadAgentId = `leader@${this.teamName}`;

    const backend = this.resolveBackend(detection);
    const spawned = await backend.spawn(config);
    if (!spawned?.identity?.agentId) {
      const reason = `Backend ${backend.backendType} returned an invalid teammate spawn result`;
      this.eventBus.emit({
        type: 'multiagent.error',
        sessionId: this.session.getSessionId(),
        source: 'backend',
        payload: {
          scope: 'backend',
          code: 'SPAWN_INVALID_RESULT',
          message: reason,
          details: { teamName: config.teamName, backend: backend.backendType },
        },
      });
      throw new Error(reason);
    }
    this.teammates.set(spawned.identity.agentId, spawned);
    this.version += 1;

    this.eventBus.emit({
      type: 'multiagent.teammate.spawned',
      sessionId: this.session.getSessionId(),
      source: 'backend',
      payload: {
        identity: spawned.identity,
        backend: spawned.backend,
        paneId: spawned.paneId,
        windowId: spawned.windowId,
      },
    });

    this.eventBus.emit({
      type: 'multiagent.team.updated',
      sessionId: this.session.getSessionId(),
      source: 'system',
      payload: {
        teamName: this.teamName,
        leadAgentId: this.leadAgentId,
        teammateIds: [...this.teammates.keys()],
        version: this.version,
      },
    });

    this.refreshVm();
    const after = this.teammates.size;
    if (after <= before) {
      const reason = 'Team updated without increasing teammate count';
      this.eventBus.emit({
        type: 'multiagent.error',
        sessionId: this.session.getSessionId(),
        source: 'system',
        payload: {
          scope: 'team',
          code: 'TEAM_NOT_CREATED',
          message: reason,
          details: {
            teamName: this.teamName,
            before,
            after,
            backend: spawned.backend,
          },
        },
      });
      throw new Error(reason);
    }
    return spawned;
  }

  async createTeam(config: TeammateSpawnConfig, teammateCount = 4): Promise<WorkbenchTeamVm> {
    const target = Math.max(1, teammateCount);
    this.teamName = config.teamName;
    this.leadAgentId = `leader@${this.teamName}`;
    this.teammates.clear();
    this.version += 1;
    this.refreshVm();

    for (let i = 0; i < target; i += 1) {
      await this.spawnTeammate({
        ...config,
        name: i === 0 ? config.name : `${config.name}-${i + 1}`,
        prompt: i === 0 ? config.prompt : '请协作补位并回传关键结论。',
      });
    }

    const vm = this.getCurrentVm();
    if (!vm.teammates.length) {
      throw new Error('createTeam finished without teammates');
    }
    return vm;
  }

  async sendMessage(agentId: string, text: string): Promise<void> {
    const t = this.teammates.get(agentId);
    if (!t) throw new Error(`teammate not found: ${agentId}`);
    const backend = this.resolveBackendByType(t.backend);

    await backend.sendMessage({
      teamName: t.identity.teamName,
      fromAgentId: this.leadAgentId,
      toAgentId: agentId,
      text,
    });

    this.lastMessagePreviewByAgent.set(agentId, text.slice(0, 120));

    this.eventBus.emit({
      type: 'multiagent.teammate.message',
      sessionId: this.session.getSessionId(),
      source: 'leader',
      payload: {
        direction: 'leader_to_teammate',
        fromAgentId: this.leadAgentId,
        toAgentId: agentId,
        teamName: t.identity.teamName,
        text,
        textPreview: text.slice(0, 120),
      },
    });
  }

  async stopTeammate(agentId: string, reason?: string): Promise<void> {
    const t = this.teammates.get(agentId);
    if (!t) return;
    const backend = this.resolveBackendByType(t.backend);

    this.eventBus.emit({
      type: 'multiagent.teammate.state.changed',
      sessionId: this.session.getSessionId(),
      source: 'system',
      payload: {
        agentId,
        prev: t.status,
        next: 'stopping',
        reason,
      },
    });

    const terminateResult = await backend.terminate({ agentId, reason });
    this.teammates.set(agentId, { ...t, status: 'stopped' });

    this.eventBus.emit({
      type: 'multiagent.teammate.stopped',
      sessionId: this.session.getSessionId(),
      source: 'backend',
      payload: {
        agentId,
        graceful: terminateResult.graceful,
        reason,
      },
    });

    this.refreshVm();
  }

  async killTeammate(agentId: string, reason?: string, signal = 'SIGKILL'): Promise<void> {
    const t = this.teammates.get(agentId);
    if (!t) return;
    const backend = this.resolveBackendByType(t.backend);

    this.eventBus.emit({
      type: 'multiagent.teammate.state.changed',
      sessionId: this.session.getSessionId(),
      source: 'system',
      payload: {
        agentId,
        prev: t.status,
        next: 'stopping',
        reason: reason ?? 'force kill',
      },
    });

    await backend.kill({ agentId, reason });
    this.teammates.set(agentId, { ...t, status: 'stopped' });

    this.eventBus.emit({
      type: 'multiagent.teammate.killed',
      sessionId: this.session.getSessionId(),
      source: 'backend',
      payload: {
        agentId,
        signal,
        reason,
      },
    });

    this.refreshVm();
  }

  async attachTeammate(agentId: string): Promise<boolean> {
    if (this.teammates.get(agentId)?.backend !== 'tmux') return false;
    return this.tmuxBackend.attach(agentId);
  }

  async detachTeammate(agentId: string): Promise<boolean> {
    if (this.teammates.get(agentId)?.backend !== 'tmux') return false;
    return this.tmuxBackend.detach(agentId);
  }

  getTmuxSessionState(agentId: string): ReturnType<MultiAgentTmuxBackend['getSessionState']> {
    return this.tmuxBackend.getSessionState(agentId);
  }

  getCurrentVm(): WorkbenchTeamVm {
    return this.teamVm$.value;
  }

  private resolveBackend(detection: BackendDetectionResult): TeammateBackend {
    if (!detection.effectiveBackend) return this.inProcessBackend;
    return this.resolveBackendByType(detection.effectiveBackend);
  }

  private resolveBackendByType(backend: 'in-process' | 'tmux' | 'iterm2'): TeammateBackend {
    if (backend === 'tmux') return this.tmuxBackend;
    if (backend === 'iterm2') return this.itermBackend;
    return this.inProcessBackend;
  }

  private async refreshBackendHealth(): Promise<BackendDetectionResult> {
    const detection = await this.detectBackend(this.configuredMode);
    this.backendHealth$.next(detection);
    return detection;
  }

  private async detectBackend(mode: TeammateMode): Promise<BackendDetectionResult> {
    const platform = this.detectPlatform();
    const isWindows = platform.includes('win');
    const isMac = platform.includes('mac');

    const capability = await this.detectCapability(platform, isWindows, isMac);
    const baseHealth = {
      configuredMode: mode,
      isNative: false,
      blocking: false,
      capabilities: {
        platform,
        tmuxAvailable: capability.tmuxAvailable,
        itermAvailable: capability.itermAvailable,
        inProcessAvailable: capability.inProcessAvailable,
      },
      needsSetup: false,
      updatedAt: Date.now(),
    };

    if (mode === 'in-process') {
      return {
        configuredMode: mode,
        effectiveBackend: 'in-process',
        blocking: false,
        capability,
        snapshotAt: Date.now(),
        health: { ...baseHealth, effectiveBackend: 'in-process' },
      };
    }

    if (mode === 'tmux') {
      if (!capability.tmuxAvailable) {
        const reason = buildBackendBlockingReason({ mode: 'tmux', platform });
        const setupHints = capability.setupHints.length ? capability.setupHints : buildBackendSetupHints({ mode: 'tmux', platform });
        return {
          configuredMode: mode,
          blocking: true,
          fallbackReason: reason,
          capability: { ...capability, setupHints },
          snapshotAt: Date.now(),
          health: { ...baseHealth, blocking: true, needsSetup: true, fallbackReason: reason, setupHints },
        };
      }
      return {
        configuredMode: mode,
        effectiveBackend: 'tmux',
        blocking: false,
        capability,
        snapshotAt: Date.now(),
        health: { ...baseHealth, isNative: true, effectiveBackend: 'tmux' },
      };
    }

    if (mode === 'iterm2') {
      if (!capability.itermAvailable) {
        const reason = buildBackendBlockingReason({ mode: 'iterm2', platform });
        const setupHints = capability.setupHints.length ? capability.setupHints : buildBackendSetupHints({ mode: 'iterm2', platform });
        return {
          configuredMode: mode,
          blocking: true,
          fallbackReason: reason,
          capability: { ...capability, setupHints },
          snapshotAt: Date.now(),
          health: { ...baseHealth, blocking: true, needsSetup: true, fallbackReason: reason, setupHints },
        };
      }
      return {
        configuredMode: mode,
        effectiveBackend: 'iterm2',
        blocking: false,
        capability,
        snapshotAt: Date.now(),
        health: { ...baseHealth, isNative: true, effectiveBackend: 'iterm2' },
      };
    }

    if (capability.tmuxAvailable) {
      return {
        configuredMode: mode,
        effectiveBackend: 'tmux',
        blocking: false,
        capability,
        snapshotAt: Date.now(),
        health: { ...baseHealth, isNative: true, effectiveBackend: 'tmux' },
      };
    }

    if (capability.itermAvailable) {
      return {
        configuredMode: mode,
        effectiveBackend: 'iterm2',
        blocking: false,
        capability,
        snapshotAt: Date.now(),
        health: { ...baseHealth, isNative: true, effectiveBackend: 'iterm2' },
      };
    }

    const reason = 'No pane backend available; fallback to in-process';
    return {
      configuredMode: mode,
      effectiveBackend: 'in-process',
      fallbackFromMode: 'auto',
      fallbackReason: reason,
      blocking: false,
      capability,
      snapshotAt: Date.now(),
      health: {
        ...baseHealth,
        effectiveBackend: 'in-process',
        fallbackReason: reason,
      },
    };
  }

  private async detectCapability(platform: string, isWindows: boolean, isMac: boolean): Promise<BackendCapability> {
    const setupHints: string[] = [];
    const inProcessAvailable = true;

    let tmuxAvailable = false;
    let wslAvailable: boolean | undefined;
    let tmuxExecutable: string | undefined;

    if (isWindows) {
      const probe = await this.tmuxBackend.detectAvailability();
      wslAvailable = probe.wslAvailable;
      tmuxAvailable = probe.tmuxAvailable;
      tmuxExecutable = tmuxAvailable ? 'wsl.exe -e bash -lc' : undefined;
      setupHints.push(...probe.hints);
      if (tmuxAvailable) {
        setupHints.push('Windows 下 tmux 将通过 wsl.exe 在 WSL2 内执行。');
      }
    } else {
      const tmuxVersion = await this.tryExec('tmux -V');
      tmuxExecutable = tmuxVersion.ok ? 'tmux' : undefined;
      tmuxAvailable = tmuxVersion.ok;
      if (!tmuxAvailable) {
        setupHints.push('请先安装 tmux。');
        setupHints.push('安装完成后请重新启动终端会话。');
      }
    }

    let itermAvailable = false;
    if (isMac) {
      const termProgram = this.getEnvValue('TERM_PROGRAM').toLowerCase();
      itermAvailable = termProgram === 'iterm.app';
      if (!itermAvailable) {
        setupHints.push('iTerm2 仅在使用 iTerm.app 启动时可用。');
      }
    }

    return {
      platform,
      wslAvailable,
      tmuxExecutable,
      tmuxAvailable,
      itermAvailable,
      inProcessAvailable,
      blocking: false,
      setupHints,
    };
  }

  private async tryExec(command: string): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
    const z = window.zytrader;
    if (!z?.terminal?.exec) {
      return { ok: false, stdout: '', stderr: 'terminal.exec unavailable', code: -1 };
    }
    try {
      return await z.terminal.exec(command, '.', 'workspace');
    } catch (error) {
      return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error), code: -1 };
    }
  }

  private emitModeEvents(detection: BackendDetectionResult): void {
    const sessionId = this.session.getSessionId();

    if (detection.effectiveBackend) {
      this.eventBus.emit({
        type: 'multiagent.backend.detected',
        sessionId,
        source: 'backend',
        payload: {
          configuredMode: detection.configuredMode,
          effectiveBackend: detection.effectiveBackend,
          platform: detection.capability.platform,
          capabilities: detection.capability,
        },
      });
    }

    if (detection.fallbackFromMode && detection.effectiveBackend && detection.fallbackReason) {
      this.eventBus.emit({
        type: 'multiagent.backend.fallback',
        sessionId,
        source: 'backend',
        payload: {
          fromMode: detection.fallbackFromMode,
          toBackend: detection.effectiveBackend,
          reason: detection.fallbackReason,
          blocking: detection.blocking,
        },
      });
    }

    if (detection.blocking && detection.fallbackReason) {
      const setupHints = detection.capability.setupHints ?? [];
      this.eventBus.emit({
        type: 'multiagent.error',
        sessionId,
        source: 'backend',
        payload: {
          scope: 'backend',
          code: 'BACKEND_BLOCKING',
          message: detection.fallbackReason,
          details: {
            configuredMode: detection.configuredMode,
            platform: detection.capability.platform,
            setupHints,
          },
        },
      });
    }
  }

  private createFallbackDetection(mode: TeammateMode): BackendDetectionResult {
    return {
      configuredMode: mode,
      effectiveBackend: 'in-process',
      fallbackFromMode: mode,
      fallbackReason: 'Capability detection pending; using in-process bootstrap backend',
      blocking: false,
      capability: {
        platform: this.detectPlatform(),
        wslAvailable: false,
        tmuxExecutable: undefined,
        tmuxAvailable: false,
        itermAvailable: false,
        inProcessAvailable: true,
        blocking: false,
        setupHints: [],
      },
      snapshotAt: Date.now(),
      health: {
        configuredMode: mode,
        effectiveBackend: 'in-process',
        isNative: false,
        blocking: false,
        capabilities: {
          platform: this.detectPlatform(),
          tmuxAvailable: false,
          itermAvailable: false,
          inProcessAvailable: true,
        },
        needsSetup: false,
        fallbackReason: 'Capability detection pending; using in-process bootstrap backend',
        updatedAt: Date.now(),
      },
    };
  }

  private detectPlatform(): string {
    const g = globalThis as unknown as { process?: { platform?: string } };
    const fromProcess = (g.process?.platform ?? '').toLowerCase();
    if (fromProcess) return fromProcess;

    const fromUserAgent = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase();
    if (fromUserAgent.includes('windows')) return 'win32';
    if (fromUserAgent.includes('mac os')) return 'darwin';
    if (fromUserAgent.includes('linux')) return 'linux';

    return this.getEnvValue('OS').toLowerCase() || 'unknown';
  }

  private getEnvValue(name: string): string {
    const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
    return g.process?.env?.[name] ?? '';
  }

  private refreshVm(): void {
    this.teamVm$.next(this.buildVm(this.backendHealth$.value));
  }

  private buildVm(detection: BackendDetectionResult): WorkbenchTeamVm {
    const teammates = [...this.teammates.values()].map<WorkbenchTeammateVm>((x) => {
      const sessionState = x.backend === 'tmux' ? this.tmuxBackend.getSessionState(x.identity.agentId) : undefined;
      const attached = sessionState ? sessionState.attached : undefined;
      const recoveryState = x.status === 'stopped'
        ? 'detached'
        : sessionState?.attached
          ? 'live'
          : x.backend === 'tmux'
            ? 'reconnecting'
            : 'live';

      return {
        agentId: x.identity.agentId,
        name: x.identity.agentName,
        color: x.identity.color,
        backend: x.backend,
        paneId: x.paneId,
        windowId: x.windowId,
        status: x.status,
        model: x.identity.model,
        cwd: x.identity.cwd,
        planModeRequired: Boolean(x.identity.planModeRequired),
        lastMessagePreview: this.lastMessagePreviewByAgent.get(x.identity.agentId),
        updatedAt: Date.now(),
        attached,
        canAttach: x.backend === 'tmux' && Boolean(sessionState),
        canDetach: x.backend === 'tmux' && Boolean(sessionState),
        recoveryState: x.backend === 'tmux' ? recoveryState : 'live',
        sessionName: sessionState?.sessionName,
        sessionLastSeenAt: sessionState?.lastSeenAt,
        role: x.identity.agentId === this.leadAgentId ? 'leader' : 'teammate',
        sessionStatus: sessionState?.attached === undefined ? 'disconnected' : sessionState.attached ? 'connected' : 'background',
      };
    });

    const leader = teammates.find((x) => x.role === 'leader');

    const runningCount = teammates.filter((x) => x.status === 'running').length;
    const stoppedCount = teammates.filter((x) => x.status === 'stopped').length;
    const errorCount = teammates.filter((x) => x.status === 'error').length;

    return {
      teamName: this.teamName,
      leadAgentId: this.leadAgentId,
      mode: this.configuredMode,
      effectiveBackend: detection.effectiveBackend,
      health: detection.health,
      leader,
      teammates,
      runningCount,
      stoppedCount,
      errorCount,
      teamStatus: errorCount > 0 ? 'error' : runningCount > 0 ? 'running' : stoppedCount > 0 ? 'stopped' : 'background',
      updatedAt: Date.now(),
    };
  }
}
