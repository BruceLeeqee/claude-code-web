import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppSettingsService, type AppTheme } from '../../../core/app-settings.service';
import { LocalBridgeService } from '../../../core/local-bridge.service';
import { ModelUsageLedgerService } from '../../../core/model-usage-ledger.service';
import { MODEL_CATALOG, defaultCatalogEntry, findCatalogEntry, type ModelCatalogEntry, type ModelProvider } from '../../../core/model-catalog';
import type { AppSettings } from '../../../core/app-settings.service';
import { DirectoryManagerService } from '../../../core/directory-manager.service';
import { MemoryConfigService } from '../../../core/memory/memory.config';
import { SkillIndexService } from '../../../core/skill-index.service';

/** 连接「请求类型」仅三种：Anthropic 兼容（含 MiniMax 等）、OpenAI、Custom；不再单独出现 MiniMax */
export type UiRequestKind = 'anthropic' | 'openai' | 'custom';

const LAST_MODEL_TEST_KEY = 'claude-web:last-model-test';
const CUSTOM_MODELS_KEY = 'zyfront:custom-model-ids';
const REQUEST_CFG_JSON_KEY = 'zyfront:model-request-config-json';
const DEFAULT_MODEL_MAX_TOKENS = 81920;
const LEGACY_DEFAULT_MAX_TOKENS = 32;
const LATEST_DIRECTORY_KEY_OVERRIDES: Record<string, string> = {
  'agent-short-term': '02-AGENT-MEMORY/01-Short-Term',
  'agent-long-term': '02-AGENT-MEMORY/02-Long-User',
  'agent-long-user': '02-AGENT-MEMORY/02-Long-User',
  'agent-long-feedback': '02-AGENT-MEMORY/03-Long-Feedback',
  'agent-long-project': '02-AGENT-MEMORY/04-Long-Projects',
  'agent-long-reference': '02-AGENT-MEMORY/05-Long-Reference',
  'agent-context': '02-AGENT-MEMORY/06-Context',
  'agent-meta': '02-AGENT-MEMORY/07-Meta',
  'agent-memory-index': '02-AGENT-MEMORY/07-Meta',
  'agent-skills': '03-AGENT-TOOLS/01-Skills',
  'agent-plugins': '03-AGENT-TOOLS/02-Plugins',
};

export type ConnectionIndicator = 'untested' | 'testing' | 'ok' | 'error';

@Component({
  selector: 'app-models-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './models.page.html',
  styleUrl: './models.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelsPrototypePageComponent implements OnInit, OnDestroy {
  private readonly settingsService = inject(AppSettingsService);
  private readonly bridge = inject(LocalBridgeService);
  protected readonly usageLedger = inject(ModelUsageLedgerService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly directoryManager = inject(DirectoryManagerService);
  private readonly memoryConfig = inject(MemoryConfigService);
  private readonly skillIndex = inject(SkillIndexService);

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
  private requestJsonAutoSaveTimer?: ReturnType<typeof setTimeout>;

  /** 统一 Vault 根目录（例如 E:/AGENT-ROOT） */
  protected readonly vaultRootPath = signal('');
  protected readonly vaultLayoutMessage = signal('');

  /** 记忆管道 / 做梦：与 MemoryConfigService（localStorage key `zyfront:memory-pipeline-config-v2`）同步 */
  protected readonly memoryPipelineEnabled = signal(true);
  protected readonly dreamEnabled = signal(true);
  protected readonly dreamMinHours = signal(24);
  protected readonly dreamMinSessions = signal(1);
  protected readonly dreamMinTurns = signal(20);
  protected readonly dreamScanThrottleMinutes = signal(10);
  protected readonly memoryPipelineMessage = signal('');

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

  ngOnInit(): void {
    this.hydrateMemoryPipelineUi();
    void this.loadVaultLayoutPaths();
  }

  ngOnDestroy(): void {
    if (this.requestJsonAutoSaveTimer !== undefined) {
      clearTimeout(this.requestJsonAutoSaveTimer);
      this.requestJsonAutoSaveTimer = undefined;
      this.tryAutoSaveRequestConfigJson();
    }
  }

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
      if (!raw?.trim()) {
        const def = this.defaultRequestJsonForUi(uiKind);
        this.requestConfigJson.set(def);
        localStorage.setItem(REQUEST_CFG_JSON_KEY, def);
      } else {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const normalized = this.normalizeRequestConfig(parsed as Record<string, unknown>);
          const text = JSON.stringify(normalized, null, 2);
          this.requestConfigJson.set(text);
          localStorage.setItem(REQUEST_CFG_JSON_KEY, text);
        } else {
          this.requestConfigJson.set(this.defaultRequestJsonForUi(uiKind));
        }
      }
    } catch {
      this.requestConfigJson.set(this.defaultRequestJsonForUi(uiKind));
    }
  }

  private hydrateMemoryPipelineUi(): void {
    const c = this.memoryConfig.getConfig();
    this.memoryPipelineEnabled.set(c.enabled);
    this.dreamEnabled.set(c.dream.enabled);
    this.dreamMinHours.set(c.dream.minHours);
    this.dreamMinSessions.set(c.dream.minSessions);
    this.dreamMinTurns.set(c.dream.minTurns);
    this.dreamScanThrottleMinutes.set(c.dream.scanThrottleMinutes);
  }

  protected saveMemoryPipelineSettings(): void {
    this.memoryPipelineMessage.set('');
    const h = Math.max(1, Math.floor(Number(this.dreamMinHours())) || 1);
    const s = Math.max(1, Math.floor(Number(this.dreamMinSessions())) || 1);
    const mt = Math.max(1, Math.floor(Number(this.dreamMinTurns())) || 1);
    const t = Math.max(1, Math.floor(Number(this.dreamScanThrottleMinutes())) || 1);
    this.dreamMinHours.set(h);
    this.dreamMinSessions.set(s);
    this.dreamMinTurns.set(mt);
    this.dreamScanThrottleMinutes.set(t);
    this.memoryConfig.applyPartial({
      enabled: this.memoryPipelineEnabled(),
      dream: {
        enabled: this.dreamEnabled(),
        minHours: h,
        minSessions: s,
        minTurns: mt,
        scanThrottleMinutes: t,
      },
    });
    this.memoryPipelineMessage.set('记忆管道已保存（localStorage：zyfront:memory-pipeline-config-v2）');
    this.cdr.markForCheck();
  }

  protected resetMemoryPipelineDefaults(): void {
    this.memoryConfig.resetToDefaults();
    this.hydrateMemoryPipelineUi();
    this.memoryPipelineMessage.set('已恢复记忆管道默认参数');
    this.cdr.markForCheck();
  }

  protected onDreamMinHoursInput(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    const n = Math.floor(Number(raw));
    this.dreamMinHours.set(Number.isFinite(n) && n >= 1 ? n : 1);
  }

  protected onDreamMinSessionsInput(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    const n = Math.floor(Number(raw));
    this.dreamMinSessions.set(Number.isFinite(n) && n >= 1 ? n : 1);
  }

  protected onDreamMinTurnsInput(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    const n = Math.floor(Number(raw));
    this.dreamMinTurns.set(Number.isFinite(n) && n >= 1 ? n : 1);
  }

  protected onDreamScanThrottleInput(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    const n = Math.floor(Number(raw));
    this.dreamScanThrottleMinutes.set(Number.isFinite(n) && n >= 1 ? n : 1);
  }

  protected async loadVaultLayoutPaths(): Promise<void> {
    this.vaultLayoutMessage.set('');
    try {
      const info = await this.bridge.health();
      if (!info.ok || !info.vaultRoot) {
        throw new Error('读取 Vault 根目录失败');
      }
      this.vaultRootPath.set(info.vaultRoot);
    } catch (e) {
      this.vaultLayoutMessage.set(e instanceof Error ? e.message : String(e));
    }
    this.cdr.markForCheck();
  }

  protected async saveVaultLayoutPaths(): Promise<void> {
    this.vaultLayoutMessage.set('');
    try {
      const root = this.vaultRootPath().trim();
      if (!root) {
        throw new Error('请先填写 Vault 根目录');
      }
      const set = await window.zytrader.vault.setConfig({ mode: 'global', globalRoot: root });
      if (!set.ok) {
        throw new Error(set.error ?? '设置 Vault 根目录失败');
      }
      await this.directoryManager.ensureVaultReady();
      const candidates = ['06-SYSTEM/directory.config.json', '05-SYSTEM/directory.config.json'];
      let target = '';
      let existing = '';
      for (const p of candidates) {
        const r = await window.zytrader.fs.read(p, { scope: 'vault' });
        if (r.ok && typeof r.content === 'string') {
          target = p;
          existing = r.content;
          break;
        }
      }
      if (!target) target = '06-SYSTEM/directory.config.json';
      const doc =
        existing.trim() !== ''
          ? (JSON.parse(existing) as Record<string, unknown>)
          : { version: 1, keys: {} as Record<string, string> };
      const keys = this.applyLatestDirectoryStructure((doc['keys'] as Record<string, string>) ?? {});
      const next = { ...doc, version: Number(doc['version'] ?? 1), keys };
      const wr = await window.zytrader.fs.write(target, JSON.stringify(next, null, 2), { scope: 'vault' });
      if (!wr.ok) throw new Error('写入 directory.config.json 失败');
      this.directoryManager.invalidateCache();
      this.skillIndex.invalidateSkillRoot();
      this.vaultRootPath.set(set.vaultRoot ?? root);
      this.vaultLayoutMessage.set(`已统一为单一 Vault 根目录，并更新最新目录结构：${this.vaultRootPath()}`);
    } catch (e) {
      this.vaultLayoutMessage.set(e instanceof Error ? e.message : String(e));
    }
    this.cdr.markForCheck();
  }

  private applyLatestDirectoryStructure(current: Record<string, string>): Record<string, string> {
    return {
      ...current,
      ...LATEST_DIRECTORY_KEY_OVERRIDES,
    };
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

  protected onRequestConfigJsonInput(ev: Event): void {
    const raw = (ev.target as HTMLTextAreaElement).value;
    this.requestConfigJson.set(raw);
    this.validationMessage.set('');
    if (this.requestJsonAutoSaveTimer !== undefined) {
      clearTimeout(this.requestJsonAutoSaveTimer);
    }
    this.requestJsonAutoSaveTimer = setTimeout(() => {
      this.requestJsonAutoSaveTimer = undefined;
      this.tryAutoSaveRequestConfigJson();
    }, 700);
  }

  /** 合法 JSON 时静默落盘并同步 AppSettings，不改写文本框（避免打断输入光标）。 */
  private tryAutoSaveRequestConfigJson(): void {
    const raw = this.requestConfigJson().trim();
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as unknown;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return;
      const parsedCfg = this.normalizeRequestConfig(p as Record<string, unknown>);
      this.applyRequestConfigFromParsed(parsedCfg, { syncTextarea: false });
    } catch {
      return;
    }
    this.cdr.markForCheck();
  }

  private applyRequestConfigFromParsed(
    parsedCfg: Record<string, unknown>,
    opts: { syncTextarea: boolean },
  ): void {
    const cur = this.activeCatalogEntry();
    const provider = this.requestType() as AppSettings['modelProvider'];
    const endpoint = this.endpointInput().trim();
    const effectiveModel =
      typeof parsedCfg['model'] === 'string' && parsedCfg['model'].trim()
        ? String(parsedCfg['model']).trim()
        : cur.id;
    const nextCompression = this.resolveCompressionFromConfig(parsedCfg);
    const nextCost = this.resolveCostFromConfig(parsedCfg);
    const nextTheme = this.resolveThemeFromConfig(parsedCfg, this.settings().theme ?? 'dark');

    this.settingsService.update({
      apiKey: this.settings().apiKey,
      model: effectiveModel,
      modelProvider: provider,
      proxy: {
        enabled: Boolean(this.settings().proxy.enabled),
        baseUrl: endpoint,
        authToken: this.settings().proxy.authToken ?? '',
      },
      compression: nextCompression,
      cost: nextCost,
      theme: nextTheme,
    });
    try {
      localStorage.setItem(REQUEST_CFG_JSON_KEY, JSON.stringify(parsedCfg, null, 2));
      if (opts.syncTextarea) {
        this.requestConfigJson.set(JSON.stringify(parsedCfg, null, 2));
      }
    } catch {
      /* ignore */
    }
  }

  protected save(): void {
    this.validationMessage.set('');
    const parsedCfg = this.parseRequestJsonOrSetError();
    if (!parsedCfg) return;
    this.applyRequestConfigFromParsed(parsedCfg, { syncTextarea: true });
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
    this.requestConfigJson.set(this.adaptRequestJsonForType(k));
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
          max_tokens: DEFAULT_MODEL_MAX_TOKENS,
          temperature: 0.2,
        },
        null,
        2,
      );
    }
    return JSON.stringify(
      {
        provider: 'anthropic',
        max_tokens: DEFAULT_MODEL_MAX_TOKENS,
        temperature: 0.2,
      },
      null,
      2,
    );
  }

  protected onApiKeyInput(value: string): void {
    this.settingsService.update({ apiKey: value });
  }

  protected onProxyEnabledChange(enabled: boolean): void {
    this.settingsService.update({
      proxy: {
        ...this.settingsService.value.proxy,
        enabled,
      },
    });
  }

  protected onProxyAuthTokenInput(value: string): void {
    this.settingsService.update({
      proxy: {
        ...this.settingsService.value.proxy,
        authToken: value,
      },
    });
  }

  protected onThemeChange(theme: string): void {
    const next = theme === 'light' ? 'light' : 'dark';
    this.settingsService.update({ theme: next });
  }

  protected onCostNumberChange(key: 'maxSessionCostUsd' | 'warnThresholdUsd', raw: string): void {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const safe = Math.max(0, n);
    this.settingsService.update({
      cost: {
        ...this.settingsService.value.cost,
        [key]: safe,
      },
    });
  }

  protected onCompressionEnabledChange(enabled: boolean): void {
    const cur = this.settingsService.value.compression;
    this.settingsService.update({
      compression: {
        ...cur,
        enabled,
      },
    });
  }

  protected onCompressionNumberChange(
    key: 'maxMessagesBeforeCompact' | 'compactToMessages' | 'maxEstimatedTokens',
    raw: string,
  ): void {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;

    const safeValue =
      key === 'maxEstimatedTokens'
        ? Math.max(500, Math.floor(n))
        : Math.max(1, Math.floor(n));
    const cur = this.settingsService.value.compression;

    this.settingsService.update({
      compression: {
        ...cur,
        [key]: safeValue,
      },
    });
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
    if (!raw) {
      return this.normalizeRequestConfig({});
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.validationMessage.set(`配置 JSON 必须是对象，例如 {"max_tokens":${DEFAULT_MODEL_MAX_TOKENS}}`);
        return null;
      }
      return this.normalizeRequestConfig(parsed as Record<string, unknown>);
    } catch {
      this.validationMessage.set('配置 JSON 不是合法 JSON，请先修正。');
      return null;
    }
  }

  private normalizeRequestConfig(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...input };
    const maxTokensFromSnake = Number(out['max_tokens']);
    const maxTokensFromCamel = Number(out['maxTokens']);
    const snakeValid = Number.isFinite(maxTokensFromSnake) && maxTokensFromSnake > 0;
    const camelValid = Number.isFinite(maxTokensFromCamel) && maxTokensFromCamel > 0;
    const resolvedMaxTokens = snakeValid
      ? Math.floor(maxTokensFromSnake)
      : camelValid
        ? Math.floor(maxTokensFromCamel)
        : DEFAULT_MODEL_MAX_TOKENS;
    out['max_tokens'] = resolvedMaxTokens === LEGACY_DEFAULT_MAX_TOKENS ? DEFAULT_MODEL_MAX_TOKENS : resolvedMaxTokens;
    return out;
  }

  private adaptRequestJsonForType(kind: UiRequestKind): string {
    const raw = this.requestConfigJson().trim();
    if (!raw) return this.defaultRequestJsonForUi(kind);
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return this.defaultRequestJsonForUi(kind);
      }
      const normalized = this.normalizeRequestConfig(parsed as Record<string, unknown>);
      if (kind === 'openai') normalized['provider'] = 'openai';
      else if (kind === 'anthropic') normalized['provider'] = 'anthropic';
      return JSON.stringify(normalized, null, 2);
    } catch {
      return this.defaultRequestJsonForUi(kind);
    }
  }

  private resolveCompressionFromConfig(parsedCfg: Record<string, unknown>): AppSettings['compression'] {
    const current = this.settings().compression;
    const obj = parsedCfg['compression'];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return current;
    const c = obj as Record<string, unknown>;
    const enabled = typeof c['enabled'] === 'boolean' ? c['enabled'] : current.enabled;
    const maxMessagesBeforeCompact = Number.isFinite(Number(c['maxMessagesBeforeCompact']))
      ? Math.max(1, Math.floor(Number(c['maxMessagesBeforeCompact'])))
      : current.maxMessagesBeforeCompact;
    const compactToMessages = Number.isFinite(Number(c['compactToMessages']))
      ? Math.max(1, Math.floor(Number(c['compactToMessages'])))
      : current.compactToMessages;
    const maxEstimatedTokens = Number.isFinite(Number(c['maxEstimatedTokens']))
      ? Math.max(500, Math.floor(Number(c['maxEstimatedTokens'])))
      : current.maxEstimatedTokens;
    return { enabled, maxMessagesBeforeCompact, compactToMessages, maxEstimatedTokens };
  }

  private resolveCostFromConfig(parsedCfg: Record<string, unknown>): AppSettings['cost'] {
    const current = this.settings().cost;
    const obj = parsedCfg['cost'];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return current;
    const c = obj as Record<string, unknown>;
    const maxSessionCostUsd = Number.isFinite(Number(c['maxSessionCostUsd']))
      ? Math.max(0, Number(c['maxSessionCostUsd']))
      : current.maxSessionCostUsd;
    const warnThresholdUsd = Number.isFinite(Number(c['warnThresholdUsd']))
      ? Math.max(0, Number(c['warnThresholdUsd']))
      : current.warnThresholdUsd;
    return { maxSessionCostUsd, warnThresholdUsd };
  }

  private resolveThemeFromConfig(parsedCfg: Record<string, unknown>, fallback: AppTheme): AppTheme {
    const t = parsedCfg['theme'];
    if (t === 'light') return 'light';
    if (t === 'dark') return 'dark';
    return fallback;
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
