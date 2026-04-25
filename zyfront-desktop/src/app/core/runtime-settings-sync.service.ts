import { Inject, Injectable } from '@angular/core';
import { findCatalogEntry } from './model-catalog';
import { AppSettingsService } from './app-settings.service';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './zyfront-core.providers';

export const REQUEST_CFG_JSON_KEY = 'zyfront:model-request-config-json';
const DEFAULT_MODEL_MAX_TOKENS = 81920;
const LEGACY_DEFAULT_MAX_TOKENS = 32;

@Injectable({ providedIn: 'root' })
export class RuntimeSettingsSyncService {
  constructor(
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
    private readonly appSettings: AppSettingsService,
  ) {
    this.appSettings.settings$.subscribe((settings) => {
      const maxTokens = this.resolveModelMaxTokens(settings.model);
      const thinking = this.resolveModelThinking();
      const runtimeConfig: Parameters<typeof this.runtime.client.configureRuntime>[0] = {
        apiKey: settings.apiKey,
        model: {
          provider: settings.modelProvider,
          model: settings.model,
          temperature: this.runtime.client.getModel().temperature ?? 0.2,
          maxTokens,
          ...(thinking ? { thinking } : {}),
        },
      };
      // 同步端点 URL：用户在模型配置页保存的 endpoint 存在 proxy.baseUrl 中
      const endpoint = settings.proxy?.baseUrl?.trim();
      if (endpoint) {
        runtimeConfig.baseUrl = endpoint;
      }
      this.runtime.client.configureRuntime(runtimeConfig);

      this.runtime.assistant.setAutoCompactPolicy({
        enabled: Boolean(settings.compression.enabled),
        maxMessagesBeforeCompact: Number(settings.compression.maxMessagesBeforeCompact ?? 50),
        compactToMessages: Number(settings.compression.compactToMessages ?? 20),
        maxEstimatedTokens: Number(settings.compression.maxEstimatedTokens ?? 24000),
      });
    });
  }

  private resolveModelMaxTokens(modelId: string): number {
    const catalog = findCatalogEntry(modelId);
    const modelWindow = catalog?.maxContextTokens;
    const cap = modelWindow ? Math.min(modelWindow, DEFAULT_MODEL_MAX_TOKENS) : DEFAULT_MODEL_MAX_TOKENS;

    try {
      const raw = localStorage.getItem(REQUEST_CFG_JSON_KEY);
      if (!raw?.trim()) return cap;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const snake = Number(parsed['max_tokens']);
      if (Number.isFinite(snake) && snake > 0) {
        const v = Math.floor(snake);
        return v === LEGACY_DEFAULT_MAX_TOKENS ? cap : Math.min(v, cap);
      }
      const camel = Number(parsed['maxTokens']);
      if (Number.isFinite(camel) && camel > 0) {
        const v = Math.floor(camel);
        return v === LEGACY_DEFAULT_MAX_TOKENS ? cap : Math.min(v, cap);
      }
      return cap;
    } catch {
      return cap;
    }
  }

  private resolveModelThinking(): { type: 'enabled' | 'disabled' } | undefined {
    try {
      const raw = localStorage.getItem(REQUEST_CFG_JSON_KEY);
      if (!raw?.trim()) return undefined;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const thinking = parsed['thinking'];
      if (thinking && typeof thinking === 'object' && !Array.isArray(thinking)) {
        const t = thinking as Record<string, unknown>;
        if (t['type'] === 'enabled' || t['type'] === 'disabled') {
          return { type: t['type'] };
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
