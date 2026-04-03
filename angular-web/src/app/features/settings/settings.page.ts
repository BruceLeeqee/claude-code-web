import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { AppSettingsService, type AppTheme } from '../../core/app-settings.service';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AsyncPipe],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPageComponent {
  private readonly settingsService = inject(AppSettingsService);
  private readonly fb = inject(FormBuilder);

  readonly settings$ = this.settingsService.settings$;

  readonly form = this.fb.group({
    apiKey: [''],
    model: ['claude-3-5-sonnet-latest', Validators.required],
    proxyEnabled: [false],
    proxyBaseUrl: [''],
    proxyAuthToken: [''],
    compressionEnabled: [true],
    maxMessagesBeforeCompact: [50, [Validators.required, Validators.min(1)]],
    compactToMessages: [20, [Validators.required, Validators.min(1)]],
    maxSessionCostUsd: [5, [Validators.required, Validators.min(0)]],
    warnThresholdUsd: [3, [Validators.required, Validators.min(0)]],
    theme: ['dark' as AppTheme, Validators.required],
  });

  constructor() {
    this.settings$.subscribe((settings) => {
      this.form.patchValue(
        {
          apiKey: settings.apiKey,
          model: settings.model,
          proxyEnabled: settings.proxy.enabled,
          proxyBaseUrl: settings.proxy.baseUrl,
          proxyAuthToken: settings.proxy.authToken,
          compressionEnabled: settings.compression.enabled,
          maxMessagesBeforeCompact: settings.compression.maxMessagesBeforeCompact,
          compactToMessages: settings.compression.compactToMessages,
          maxSessionCostUsd: settings.cost.maxSessionCostUsd,
          warnThresholdUsd: settings.cost.warnThresholdUsd,
          theme: settings.theme,
        },
        { emitEvent: false },
      );
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.settingsService.update({
      apiKey: value.apiKey ?? '',
      model: value.model ?? 'claude-3-5-sonnet-latest',
      proxy: {
        enabled: Boolean(value.proxyEnabled),
        baseUrl: value.proxyBaseUrl ?? '',
        authToken: value.proxyAuthToken ?? '',
      },
      compression: {
        enabled: Boolean(value.compressionEnabled),
        maxMessagesBeforeCompact: Number(value.maxMessagesBeforeCompact ?? 50),
        compactToMessages: Number(value.compactToMessages ?? 20),
      },
      cost: {
        maxSessionCostUsd: Number(value.maxSessionCostUsd ?? 5),
        warnThresholdUsd: Number(value.warnThresholdUsd ?? 3),
      },
      theme: (value.theme ?? 'dark') as AppTheme,
    });
  }

  reset(): void {
    this.settingsService.reset();
  }
}
