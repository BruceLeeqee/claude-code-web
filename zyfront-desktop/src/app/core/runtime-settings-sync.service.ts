import { Inject, Injectable } from '@angular/core';
import { AppSettingsService } from './app-settings.service';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './zyfront-core.providers';

@Injectable({ providedIn: 'root' })
export class RuntimeSettingsSyncService {
  constructor(
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
    private readonly appSettings: AppSettingsService,
  ) {
    this.appSettings.settings$.subscribe((settings) => {
      this.runtime.client.configureRuntime({
        apiKey: settings.apiKey,
        model: {
          provider: settings.modelProvider,
          model: settings.model,
          temperature: this.runtime.client.getModel().temperature ?? 0.2,
          maxTokens: this.runtime.client.getModel().maxTokens ?? 4096,
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
}
