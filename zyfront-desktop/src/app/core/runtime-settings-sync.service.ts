import { Inject, Injectable } from '@angular/core';
import { AppSettingsService } from './app-settings.service';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './zyfront-core.providers';

const REQUEST_CFG_JSON_KEY = 'zyfront:model-request-config-json';
const DEFAULT_MODEL_MAX_TOKENS = 81920;
const LEGACY_DEFAULT_MAX_TOKENS = 32;

@Injectable({ providedIn: 'root' })
export class RuntimeSettingsSyncService {
  constructor(
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
    private readonly appSettings: AppSettingsService,
  ) {
    this.appSettings.settings$.subscribe((settings) => {
      const maxTokens = this.resolveModelMaxTokens();
      this.runtime.client.configureRuntime({
        apiKey: settings.apiKey,
        model: {
          provider: settings.modelProvider,
          model: settings.model,
          temperature: this.runtime.client.getModel().temperature ?? 0.2,
          maxTokens,
        },
      });

      this.runtime.assistant.setAutoCompactPolicy({
        enabled: Boolean(settings.compression.enabled),
        maxMessagesBeforeCompact: Number(settings.compression.maxMessagesBeforeCompact ?? 50),
        compactToMessages: Number(settings.compression.compactToMessages ?? 20),
        maxEstimatedTokens: Number(settings.compression.maxEstimatedTokens ?? 24000),
      });
    });
  }

  private resolveModelMaxTokens(): number {
    try {
      const raw = localStorage.getItem(REQUEST_CFG_JSON_KEY);
      if (!raw?.trim()) return DEFAULT_MODEL_MAX_TOKENS;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const snake = Number(parsed['max_tokens']);
      if (Number.isFinite(snake) && snake > 0) {
        const v = Math.floor(snake);
        return v === LEGACY_DEFAULT_MAX_TOKENS ? DEFAULT_MODEL_MAX_TOKENS : v;
      }
      const camel = Number(parsed['maxTokens']);
      if (Number.isFinite(camel) && camel > 0) {
        const v = Math.floor(camel);
        return v === LEGACY_DEFAULT_MAX_TOKENS ? DEFAULT_MODEL_MAX_TOKENS : v;
      }
      return DEFAULT_MODEL_MAX_TOKENS;
    } catch {
      return DEFAULT_MODEL_MAX_TOKENS;
    }
  }
}
