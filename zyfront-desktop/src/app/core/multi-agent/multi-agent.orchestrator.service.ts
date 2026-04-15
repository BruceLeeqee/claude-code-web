import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MultiAgentEventBusService } from './multi-agent.event-bus.service';
import { MultiAgentInProcessBackend } from './multi-agent.in-process.backend';
import { MultiAgentITermBackend } from './multi-agent.iterm.backend';
import { MultiAgentSessionService } from './multi-agent.session';
import { MultiAgentTmuxBackend } from './multi-agent.tmux.backend';
import type { BackendDetectionResult, TeammateBackend } from './multi-agent.backend';
import type { TeammateMode, TeammateSpawnConfig, TeammateSpawnResult, WorkbenchTeamVm, WorkbenchTeammateVm } from './multi-agent.types';
import { buildBackendBlockingReason, buildBackendSetupHints } from './multi-agent.backend-setup';

@Injectable({ providedIn: 'root' })
export class MultiAgentOrchestratorService {
  private configuredMode: TeammateMode = 'auto';
  private teamName = 'default';
  private leadAgentId = 'leader@default';
  private version = 0;
  private readonly teammates = new Map<string, TeammateSpawnResult>();
  private readonly lastMessagePreviewByAgent = new Map<string, string>();
  private readonly backendHealth$ = new BehaviorSubject<BackendDetectionResult>(this.detectBackend(this.configuredMode));
  private readonly teamVm$ = new BehaviorSubject<WorkbenchTeamVm>(this.buildVm(this.backendHealth$.value));

  constructor(
    private readonly session: MultiAgentSessionService,
    private readonly eventBus: MultiAgentEventBusService,
    private readonly inProcessBackend: MultiAgentInProcessBackend,
    private readonly tmuxBackend: MultiAgentTmuxBackend,
    private readonly itermBackend: MultiAgentITermBackend,
  ) {}

  readonly workbenchTeamVm$ = this.teamVm$.asObservable();
  readonly events$ = this.eventBus.events$;

  setMode(mode: TeammateMode): BackendDetectionResult {
    this.configuredMode = mode;
    const detection = this.detectBackend(mode);
    this.backendHealth$.next(detection);
    this.emitModeEvents(detection);
    this.refreshVm();
    return detection;
  }

  getMode(): TeammateMode {
    return this.configuredMode;
  }

  async spawnTeammate(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    const snapshot = this.session.captureModeIfNeeded(this.configuredMode);
    this.eventBus.emit({
      type: 'multiagent.mode.captured',
      sessionId: this.session.getSessionId(),
      source: 'system',
      payload: {
        configuredMode: snapshot.configuredMode,
        snapshotAt: snapshot.capturedAt,
      },
    });

    const detection = this.detectBackend(snapshot.configuredMode);
    this.backendHealth$.next(detection);
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
            platform: detection.health.capabilities.platform,
            setupHints,
          },
        },
      });
      throw new Error(reason);
    }

    this.teamName = config.teamName;
    this.leadAgentId = `leader@${this.teamName}`;

    const backend = this.resolveBackend(detection);
    const spawned = await backend.spawn(config);
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
    return spawned;
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

  private detectBackend(mode: TeammateMode): BackendDetectionResult {
    const platform = this.detectPlatform();
    const isWindows = platform.includes('win');
    const isMac = platform.includes('mac');
    const tmuxEnv = this.getEnvValue('TMUX');
    const termProgram = this.getEnvValue('TERM_PROGRAM');
    const term = this.getEnvValue('TERM');

    const tmuxAvailable = !isWindows && Boolean((tmuxEnv && tmuxEnv.trim()) || (term && term.toLowerCase().includes('tmux')));
    const itermAvailable = isMac && termProgram.toLowerCase() === 'iterm.app';
    const inProcessAvailable = true;

    const baseHealth = {
      configuredMode: mode,
      isNative: false,
      blocking: false,
      capabilities: {
        platform,
        tmuxAvailable,
        itermAvailable,
        inProcessAvailable,
      },
      needsSetup: false,
      updatedAt: Date.now(),
    };

    if (mode === 'in-process') {
      return { configuredMode: mode, effectiveBackend: 'in-process', blocking: false, health: { ...baseHealth, effectiveBackend: 'in-process' } };
    }

    if (mode === 'tmux') {
      if (!tmuxAvailable) {
        const reason = buildBackendBlockingReason({ mode: 'tmux', platform });
        const setupHints = buildBackendSetupHints({ mode: 'tmux', platform });
        return {
          configuredMode: mode,
          blocking: true,
          fallbackReason: reason,
          health: { ...baseHealth, blocking: true, needsSetup: true, fallbackReason: reason, setupHints },
        };
      }
      return {
        configuredMode: mode,
        effectiveBackend: 'tmux',
        blocking: false,
        health: { ...baseHealth, isNative: true, effectiveBackend: 'tmux' },
      };
    }

    if (mode === 'iterm2') {
      if (!itermAvailable) {
        const reason = buildBackendBlockingReason({ mode: 'iterm2', platform });
        const setupHints = buildBackendSetupHints({ mode: 'iterm2', platform });
        return {
          configuredMode: mode,
          blocking: true,
          fallbackReason: reason,
          health: { ...baseHealth, blocking: true, needsSetup: true, fallbackReason: reason, setupHints },
        };
      }
      return {
        configuredMode: mode,
        effectiveBackend: 'iterm2',
        blocking: false,
        health: { ...baseHealth, isNative: true, effectiveBackend: 'iterm2' },
      };
    }

    if (tmuxAvailable) {
      return {
        configuredMode: mode,
        effectiveBackend: 'tmux',
        blocking: false,
        health: { ...baseHealth, isNative: true, effectiveBackend: 'tmux' },
      };
    }
    if (itermAvailable) {
      return {
        configuredMode: mode,
        effectiveBackend: 'iterm2',
        blocking: false,
        health: { ...baseHealth, isNative: true, effectiveBackend: 'iterm2' },
      };
    }

    return {
      configuredMode: mode,
      effectiveBackend: 'in-process',
      fallbackFromMode: 'auto',
      fallbackReason: 'No pane backend available; fallback to in-process',
      blocking: false,
      health: {
        ...baseHealth,
        effectiveBackend: 'in-process',
        fallbackReason: 'No pane backend available; fallback to in-process',
      },
    };
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
          platform: detection.health.capabilities.platform,
          capabilities: {
            tmuxAvailable: detection.health.capabilities.tmuxAvailable,
            itermAvailable: detection.health.capabilities.itermAvailable,
            inProcessAvailable: detection.health.capabilities.inProcessAvailable,
          },
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
      const setupHints = detection.health.setupHints ?? [];
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
            platform: detection.health.capabilities.platform,
            setupHints,
          },
        },
      });
    }
  }

  private detectPlatform(): string {
    const fromNavigator = (typeof navigator !== 'undefined' ? navigator.platform : '').toLowerCase();
    if (fromNavigator) return fromNavigator;
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
    const teammates = [...this.teammates.values()].map<WorkbenchTeammateVm>((x) => ({
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
    }));

    const runningCount = teammates.filter((x) => x.status === 'running').length;
    const stoppedCount = teammates.filter((x) => x.status === 'stopped').length;
    const errorCount = teammates.filter((x) => x.status === 'error').length;

    return {
      teamName: this.teamName,
      leadAgentId: this.leadAgentId,
      mode: this.configuredMode,
      effectiveBackend: detection.effectiveBackend,
      health: detection.health,
      teammates,
      runningCount,
      stoppedCount,
      errorCount,
      updatedAt: Date.now(),
    };
  }
}
