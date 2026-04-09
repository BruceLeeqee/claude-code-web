import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppSettingsService, type AppTheme } from '../../../core/app-settings.service';
import { LocalBridgeService } from '../../../core/local-bridge.service';
import { ModelUsageLedgerService } from '../../../core/model-usage-ledger.service';
import { MODEL_CATALOG, defaultCatalogEntry, findCatalogEntry, type ModelCatalogEntry, type ModelProvider } from '../../../core/model-catalog';
import type { AppSettings } from '../../../core/app-settings.service';

/** 连接「请求类型」仅三种：Anthropic 兼容（含 MiniMax 等）、OpenAI、Custom；不再单独出现 MiniMax */
export type UiRequestKind = 'anthropic' | 'openai' | 'custom';

const LAST_MODEL_TEST_KEY = 'claude-web:last-model-test';
const CUSTOM_MODELS_KEY = 'zyfront:custom-model-ids';
const REQUEST_CFG_JSON_KEY = 'zyfront:model-request-config-json';

export type ConnectionIndicator = 'untested' | 'testing' | 'ok' | 'error';

@Component({
  selector: 'app-models-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './models.page.html',
  styleUrl: './models.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelsPrototypePageComponent {
  private readonly settingsService = inject(AppSettingsService);
  private readonly bridge = inject(LocalBridgeService);
  protected readonly usageLedger = inject(ModelUsageLedgerService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly settings = toSignal(this.settingsService.settings$, {
    initialValue: this.settingsService.value,
  });

  readonly testStatus = signal<'idle' | 'testing' | 'ok' | 'error'>('idle');
  readonly testMessage = signal('');
  readonly saveFeedback = signal<'idle' | 'saved'>('idle');
  readonly validationMessage = signal('');

  private readonly persistedConnection = signal<Exclude<ConnectionIndicator, 'testing'>>('untested');
  protected readonly customModelIds = signal<string[]>(this.loadCustomModelIds());

  protected readonly activeCatalogEntry = computed(() => {
    const modelId = this.settings().model;
    return findCatalogEntry(modelId) ?? this.fallbackEntryForId(modelId, this.settings().modelProvider);
  });

  protected readonly modelLibraryRows = computed((): ModelCatalogEntry[] => {
    const custom = this.customModelIds().map((id) => this.fallbackEntryForId(id, 'custom'));
    const extras = custom.filter((m) => !MODEL_CATALOG.some((x) => x.id === m.id));
    return [...MODEL_CATALOG, ...extras];
  });

  protected readonly chartMaxTokens = computed(() => {
    const s = this.usageLedger.last7DaysSeries();
    return Math.max(1, ...s.map((x) => x.tokens));
  });

  readonly connectionUi = computed<ConnectionIndicator>(() => {
    const t = this.testStatus();
    if (t === 'testing') return 'testing';
    if (t === 'ok') return 'ok';
    if (t === 'error') return 'error';
    return this.persistedConnection();
  });

  readonly connectionUiLabel = computed(() => {
    const u = this.connectionUi();
    if (u === 'testing') return '正在测试连接…';
    if (u === 'ok') return '大模型连接正常';
    if (u === 'error') return '大模型连接异常';
    return '尚未测试连接';
  });

  protected showAddCustomDialog = signal(false);
  protected customModelInput = signal('');
  protected requestType = signal<UiRequestKind>('anthropic');
  protected endpointInput = signal('');
  protected requestConfigJson = signal<string>('{}');

  protected readonly requestAddressOptions = computed(() => {
    const p = this.requestType();
    if (p === 'anthropic') {
      return [
        { id: 'minimax-anth', label: 'MiniMax（Anthropic 兼容）', url: 'https://api.minimaxi.com/anthropic' },
        { id: 'anthropic-official', label: 'Anthropic 官方', url: 'https://api.anthropic.com' },
      ];
    }
    if (p === 'openai') return [{ id: 'openai-default', label: 'OpenAI 官方', url: 'https://api.openai.com' }];
    return [];
  });

  constructor() {
    try {
      const raw = localStorage.getItem(LAST_MODEL_TEST_KEY);
      if (raw) {
        const j = JSON.parse(raw) as { ok?: boolean };
        this.persistedConnection.set(j.ok === true ? 'ok' : j.ok === false ? 'error' : 'untested');
      }
    } catch {
      /* ignore */
    }
    const cfg = this.settingsService.value;
    const uiKind = this.mapSettingsProviderToUi(cfg.modelProvider);
    this.requestType.set(uiKind);
    this.endpointInput.set(cfg.proxy.baseUrl || this.defaultBaseUrlForUi(uiKind));
    try {
      const raw = localStorage.getItem(REQUEST_CFG_JSON_KEY);
      this.requestConfigJson.set(raw?.trim() ? raw : this.defaultRequestJsonForUi(uiKind));
    } catch {
      this.requestConfigJson.set(this.defaultRequestJsonForUi(uiKind));
    }
  }

  protected switchModel(modelId: string): void {
    const next = findCatalogEntry(modelId) ?? this.fallbackEntryForId(modelId, 'custom');
    const storedProvider: AppSettings['modelProvider'] =
      next.provider === 'minimax' ? 'anthropic' : next.provider;
    this.settingsService.update({
      model: next.id,
      modelProvider: storedProvider,
    });
    this.requestType.set(this.mapSettingsProviderToUi(next.provider));
    this.cdr.markForCheck();
  }

  protected save(): void {
    this.validationMessage.set('');
    const cur = this.activeCatalogEntry();
    const provider = this.requestType() as AppSettings['modelProvider'];
    const endpoint = this.endpointInput().trim();
    const parsedCfg = this.parseRequestJsonOrSetError();
    if (!parsedCfg) return;
    const effectiveModel = typeof parsedCfg['model'] === 'string' && parsedCfg['model'].trim() ? String(parsedCfg['model']).trim() : cur.id;
    this.settingsService.update({
      apiKey: this.settings().apiKey,
      model: effectiveModel,
      modelProvider: provider,
      proxy: {
        enabled: endpoint.length > 0,
        baseUrl: endpoint,
        authToken: this.settings().proxy.authToken ?? '',
      },
      theme: (this.settings().theme ?? 'dark') as AppTheme,
    });
    try {
      localStorage.setItem(REQUEST_CFG_JSON_KEY, this.requestConfigJson());
    } catch {
      /* ignore */
    }
    this.saveFeedback.set('saved');
    this.cdr.markForCheck();
    window.setTimeout(() => {
      this.saveFeedback.set('idle');
      this.cdr.markForCheck();
    }, 2000);
  }

  protected resetDefaults(): void {
    this.settingsService.reset();
    const ui: UiRequestKind = 'anthropic';
    this.requestType.set(ui);
    this.endpointInput.set(this.defaultBaseUrlForUi(ui));
    this.requestConfigJson.set(this.defaultRequestJsonForUi(ui));
    this.validationMessage.set('');
    this.testStatus.set('idle');
    this.testMessage.set('已恢复默认配置');
    this.cdr.markForCheck();
  }

  protected async testConnection(): Promise<void> {
    this.validationMessage.set('');
    this.testStatus.set('testing');
    this.testMessage.set('正在连接模型...');
    this.cdr.markForCheck();

    const cfg = this.settingsService.value;
    const apiKey = cfg.apiKey?.trim();
    if (!apiKey) {
      this.testStatus.set('error');
      this.testMessage.set('请先在模型配置中填写 API Key');
      this.cdr.markForCheck();
      return;
    }

    const parsedCfg = this.parseRequestJsonOrSetError();
    if (!parsedCfg) {
      this.testStatus.set('error');
      this.cdr.markForCheck();
      return;
    }
    const baseUrl =
      (typeof parsedCfg['baseUrl'] === 'string' ? String(parsedCfg['baseUrl']) : this.endpointInput()).trim() ||
      this.defaultBaseUrlForUi(this.requestType());
    const model = (typeof parsedCfg['model'] === 'string' ? String(parsedCfg['model']) : this.activeCatalogEntry().id).trim();
    const ipcProvider = this.requestType() === 'openai' ? 'openai' : 'anthropic';

    try {
      const result = await this.bridge.testModelConnection({
        baseUrl,
        apiKey,
        model,
        provider: ipcProvider,
      });
      if (!result.ok) {
        throw new Error(`HTTP ${result.status}: ${result.body?.slice(0, 220) ?? 'unknown error'}`);
      }
      this.testStatus.set('ok');
      this.testMessage.set(`连接成功：${model}`);
      this.persistedConnection.set('ok');
      try {
        localStorage.setItem(LAST_MODEL_TEST_KEY, JSON.stringify({ ok: true, at: Date.now() }));
      } catch {
        /* ignore */
      }
    } catch (error) {
      this.testStatus.set('error');
      this.testMessage.set(`连接失败：${error instanceof Error ? error.message : String(error)}`);
      this.persistedConnection.set('error');
      try {
        localStorage.setItem(LAST_MODEL_TEST_KEY, JSON.stringify({ ok: false, at: Date.now() }));
      } catch {
        /* ignore */
      }
    } finally {
      this.cdr.markForCheck();
    }
  }

  protected openAddCustom(): void {
    this.customModelInput.set('');
    this.showAddCustomDialog.set(true);
  }

  protected cancelAddCustom(): void {
    this.showAddCustomDialog.set(false);
  }

  protected confirmAddCustom(): void {
    const id = this.customModelInput().trim();
    if (!id) return;
    const next = [...new Set([...this.customModelIds(), id])];
    this.customModelIds.set(next);
    try {
      localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    this.showAddCustomDialog.set(false);
    this.switchModel(id);
  }

  protected removeCustomModel(id: string): void {
    const next = this.customModelIds().filter((x) => x !== id);
    this.customModelIds.set(next);
    try {
      localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (this.settings().model === id) {
      this.switchModel(defaultCatalogEntry().id);
    }
    this.cdr.markForCheck();
  }

  protected isCustomModel(id: string): boolean {
    return this.customModelIds().includes(id) && !MODEL_CATALOG.some((m) => m.id === id);
  }

  protected chartLinePoints(): string {
    const series = this.usageLedger.last7DaysSeries();
    const max = this.chartMaxTokens();
    const w = 360;
    const chartH = 72;
    const pad = 8;
    if (series.length === 0) return '';
    return series
      .map((p, i) => {
        const x = pad + (i / Math.max(1, series.length - 1)) * (w - 2 * pad);
        const t = max > 0 ? p.tokens / max : 0;
        const y = pad + (1 - t) * chartH;
        return `${x},${y}`;
      })
      .join(' ');
  }

  protected chartAreaPoints(): string {
    const line = this.chartLinePoints();
    if (!line) return '';
    const pad = 8;
    const chartH = 72;
    return `${line} ${360 - pad},${pad + chartH} ${pad},${pad + chartH}`;
  }

  protected formatUsd(n: number): string {
    return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  protected formatLatency(): string {
    const ms = this.usageLedger.avgLatencyMs();
    if (ms === null) return '—';
    return `${(ms / 1000).toFixed(2)}s`;
  }

  private defaultBaseUrlForUi(kind: UiRequestKind): string {
    if (kind === 'anthropic') return 'https://api.minimaxi.com/anthropic';
    if (kind === 'openai') return 'https://api.openai.com';
    return '';
  }

  protected applyRequestType(kind: string): void {
    const k = kind as UiRequestKind;
    if (k !== 'anthropic' && k !== 'openai' && k !== 'custom') return;
    this.requestType.set(k);
    if (!this.endpointInput().trim()) {
      this.endpointInput.set(this.defaultBaseUrlForUi(k));
    }
    this.requestConfigJson.set(this.defaultRequestJsonForUi(k));
    this.cdr.markForCheck();
  }

  /** 下拉「常用地址」选择后写入输入框，并复位下拉框 */
  protected onEndpointPresetSelect(ev: Event): void {
    const sel = ev.target as HTMLSelectElement;
    const v = sel.value?.trim();
    if (v) {
      this.endpointInput.set(v);
    }
    sel.selectedIndex = 0;
    this.cdr.markForCheck();
  }

  private mapSettingsProviderToUi(p: ModelProvider): UiRequestKind {
    if (p === 'minimax') return 'anthropic';
    if (p === 'anthropic' || p === 'openai' || p === 'custom') return p;
    return 'custom';
  }

  private defaultRequestJsonForUi(kind: UiRequestKind): string {
    if (kind === 'openai') {
      return JSON.stringify(
        {
          provider: 'openai',
          max_tokens: 32,
          temperature: 0.2,
        },
        null,
        2,
      );
    }
    return JSON.stringify(
      {
        provider: 'anthropic',
        max_tokens: 32,
        temperature: 0.2,
      },
      null,
      2,
    );
  }

  protected onApiKeyInput(value: string): void {
    this.settingsService.update({ apiKey: value });
  }

  private loadCustomModelIds(): string[] {
    try {
      const raw = localStorage.getItem(CUSTOM_MODELS_KEY);
      if (!raw) return [];
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
    } catch {
      return [];
    }
  }

  private parseRequestJsonOrSetError(): Record<string, unknown> | null {
    const raw = this.requestConfigJson().trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.validationMessage.set('配置 JSON 必须是对象，例如 {"max_tokens":32}');
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      this.validationMessage.set('配置 JSON 不是合法 JSON，请先修正。');
      return null;
    }
  }

  private fallbackEntryForId(id: string, provider: ModelProvider): ModelCatalogEntry {
    const d = defaultCatalogEntry();
    return {
      ...d,
      id,
      name: id,
      shortName: id.length > 16 ? `${id.slice(0, 14)}…` : id,
      provider,
      providerLabel: provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : provider === 'minimax' ? 'MiniMax' : 'Custom',
      description: '自定义模型标识；价格估算沿用默认目录单价。',
    };
  }
}
