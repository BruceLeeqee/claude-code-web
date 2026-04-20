import { Injectable, inject, signal } from '@angular/core';
import type { ExecutionMode, MultiAgentConfig } from './execution-mode-decider.service';
import { DEFAULT_MULTI_AGENT_CONFIG } from './execution-mode-decider.service';

const STORAGE_KEY = 'zyfront-multi-agent-config';

@Injectable({ providedIn: 'root' })
export class MultiAgentConfigService {
  private readonly config = signal<MultiAgentConfig>(this.loadConfig());

  getConfig(): MultiAgentConfig {
    return this.config();
  }

  setConfig(config: Partial<MultiAgentConfig>): void {
    this.config.update(current => {
      const newConfig = { ...current, ...config };
      this.saveConfig(newConfig);
      return newConfig;
    });
  }

  setEnabled(enabled: boolean): void {
    this.setConfig({ enabled });
  }

  isEnabled(): boolean {
    return this.config().enabled;
  }

  setMaxAgents(max: number): void {
    this.setConfig({ maxAgents: Math.max(1, Math.min(10, max)) });
  }

  getMaxAgents(): number {
    return this.config().maxAgents;
  }

  setForceMode(mode: ExecutionMode | null): void {
    this.setConfig({ forceMode: mode });
  }

  getForceMode(): ExecutionMode | null {
    return this.config().forceMode;
  }

  clearForceMode(): void {
    this.setConfig({ forceMode: null });
  }

  setDefaultBackend(backend: 'in-process' | 'tmux' | 'iterm2'): void {
    this.setConfig({ defaultBackend: backend });
  }

  getDefaultBackend(): 'in-process' | 'tmux' | 'iterm2' {
    return this.config().defaultBackend;
  }

  setAutoTriggerThreshold(threshold: Partial<MultiAgentConfig['autoTriggerThreshold']>): void {
    this.config.update(current => ({
      ...current,
      autoTriggerThreshold: { ...current.autoTriggerThreshold, ...threshold },
    }));
  }

  resetToDefaults(): void {
    this.config.set(DEFAULT_MULTI_AGENT_CONFIG);
    this.saveConfig(DEFAULT_MULTI_AGENT_CONFIG);
  }

  private loadConfig(): MultiAgentConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_MULTI_AGENT_CONFIG, ...parsed };
      }
    } catch {
      // ignore
    }
    return DEFAULT_MULTI_AGENT_CONFIG;
  }

  private saveConfig(config: MultiAgentConfig): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // ignore
    }
  }
}
