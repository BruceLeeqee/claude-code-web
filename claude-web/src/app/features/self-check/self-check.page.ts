import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LocalBridgeService } from '../../core/local-bridge.service';
import { AppSettingsService } from '../../core/app-settings.service';

type CheckState = 'idle' | 'checking' | 'ok' | 'error';

@Component({
  selector: 'app-self-check-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './self-check.page.html',
  styleUrl: './self-check.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelfCheckPageComponent {
  private readonly bridge = inject(LocalBridgeService);
  private readonly settings = inject(AppSettingsService);

  readonly bridgeState = signal<CheckState>('idle');
  readonly tokenState = signal<CheckState>('idle');
  readonly upstreamState = signal<CheckState>('idle');
  readonly detail = signal('');

  async runAll(): Promise<void> {
    this.bridgeState.set('checking');
    this.tokenState.set('checking');
    this.upstreamState.set('checking');
    this.detail.set('');

    try {
      const health = await this.bridge.health();
      this.bridgeState.set(health.ok ? 'ok' : 'error');
      this.tokenState.set('ok');

      const cfg = this.settings.value;
      const result = await this.bridge.testModelConnection({
        baseUrl: cfg.proxy.enabled && cfg.proxy.baseUrl ? cfg.proxy.baseUrl : 'https://api.minimaxi.com/anthropic',
        apiKey: cfg.apiKey,
        model: cfg.model,
        provider: cfg.modelProvider,
      });

      if (result.ok) {
        this.upstreamState.set('ok');
        this.detail.set('上游模型连通正常');
      } else {
        this.upstreamState.set('error');
        this.detail.set(`上游失败 HTTP ${result.status}: ${result.body?.slice(0, 200) ?? ''}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('unauthorized')) {
        this.bridgeState.set('ok');
        this.tokenState.set('error');
      } else {
        this.bridgeState.set('error');
      }
      this.upstreamState.set('error');
      this.detail.set(msg);
    }
  }

  badge(state: CheckState): string {
    if (state === 'ok') return 'GREEN';
    if (state === 'error') return 'RED';
    if (state === 'checking') return 'YELLOW';
    return 'GRAY';
  }
}
