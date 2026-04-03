import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { AppSettingsService, type AppTheme } from '../../core/app-settings.service';
import { AdvancedArchitectureService } from '../../core/advanced-architecture.service';
import { LocalBridgeService } from '../../core/local-bridge.service';

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
  private readonly architecture = inject(AdvancedArchitectureService);
  private readonly bridge = inject(LocalBridgeService);
  private readonly fb = inject(FormBuilder);

  readonly settings$ = this.settingsService.settings$;
  readonly testStatus = signal<'idle' | 'testing' | 'ok' | 'error'>('idle');
  readonly testMessage = signal('');

  readonly voiceState$ = this.architecture.voiceState$;
  readonly vimState$ = this.architecture.vimState$;
  readonly memFiles$ = this.architecture.memFiles$;
  readonly transportKind$ = this.architecture.transportKind$;
  readonly transportLog$ = this.architecture.transportLog$;
  readonly analytics$ = this.architecture.analytics$;

  readonly form = this.fb.group({
    apiKey: [''],
    modelProvider: ['minimax', Validators.required],
    model: ['abab6.5s-chat', Validators.required],
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
          modelProvider: settings.modelProvider,
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
      modelProvider: (value.modelProvider ?? 'minimax') as 'anthropic' | 'openai' | 'minimax' | 'custom',
      model: value.model ?? 'MiniMax-M2.7',
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

  async testConnection(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.testStatus.set('testing');
    this.testMessage.set('正在连接模型...');

    try {
      const apiKey = value.apiKey ?? '';
      if (!apiKey.trim()) {
        throw new Error('请先填写 API Key');
      }

      const baseUrl = value.proxyEnabled && value.proxyBaseUrl
        ? value.proxyBaseUrl
        : 'https://api.minimaxi.com/anthropic';

      const result = await this.bridge.testModelConnection({
        baseUrl,
        apiKey,
        model: value.model ?? 'abab6.5s-chat',
        provider: value.modelProvider ?? 'minimax',
      });

      if (!result.ok) {
        throw new Error(`HTTP ${result.status}: ${result.body?.slice(0, 220) ?? 'unknown error'}`);
      }

      this.testStatus.set('ok');
      this.testMessage.set('连接成功：大模型可用');
    } catch (error) {
      this.testStatus.set('error');
      this.testMessage.set(`连接失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  reset(): void {
    this.settingsService.reset();
  }

  setTransport(kind: 'remoteIO' | 'sse' | 'websocket'): void {
    this.architecture.setTransport(kind);
  }

  async connectTransport(): Promise<void> {
    await this.architecture.connectTransport();
  }

  async disconnectTransport(): Promise<void> {
    await this.architecture.disconnectTransport();
  }

  async pingTransport(): Promise<void> {
    await this.architecture.sendTransportMessage('ping', { source: 'settings-page' });
  }

  startVoice(): void {
    this.architecture.startListening();
  }

  speakVoice(): void {
    this.architecture.startSpeaking();
  }

  stopVoice(): void {
    this.architecture.stopVoice();
  }

  vimKey(key: string): void {
    this.architecture.sendVimKey(key);
  }

  writeMemFile(): void {
    this.architecture.writeFile('/demo/notes.md', '# Demo\nThis is a browser memory file.');
  }

  removeMemFile(): void {
    this.architecture.removeFile('/demo/notes.md');
  }

  encodeSample(): string {
    return this.architecture.encodeBase64('claude-core-browser');
  }

  decodeSample(value: string): string {
    return this.architecture.decodeBase64(value);
  }
}
