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
import { MODEL_CATALOG, MODEL_ENDPOINTS, defaultCatalogEntry, findCatalogEntry, type ModelCatalogEntry, type ModelProvider } from '../../../core/model-catalog';
import type { AppSettings } from '../../../core/app-settings.service';
import { DirectoryManagerService } from '../../../core/directory-manager.service';
import { MemoryConfigService } from '../../../core/memory/memory.config';
import { SkillIndexService } from '../../../core/skill-index.service';

/** 连接「请求类型」仅三种：Anthropic 兼容（含 MiniMax 等）、OpenAI、DeepSeek、Custom；不再单独出现 MiniMax */
export type UiRequestKind = 'anthropic' | 'openai' | 'deepseek' | 'custom';

const LAST_MODEL_TEST_KEY = 'claude-web:last-model-test';
const CUSTOM_MODELS_KEY = 'zyfront:custom-model-ids';
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
    const all = [...MODEL_CATALOG, ...extras].filter(
      (m) => m.provider === 'minimax' || m.provider === 'deepseek',
    );
    const currentModelId = this.settings().model;
    const currentIndex = all.findIndex((m) => m.id === currentModelId);
    if (currentIndex > 0) {
      const [current] = all.splice(currentIndex, 1);
      all.unshift(current!);
    }
    return all;
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
    if (p === 'openai') {
      return [
        { id: 'openai-default', label: 'OpenAI 官方', url: 'https://api.openai.com' },
      ];
    }
    if (p === 'deepseek') {
      return [
        { id: 'deepseek-official', label: 'DeepSeek 官方 (Anthropic)', url: 'https://api.deepseek.com/anthropic' },
      ];
    }
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
    this.loadModelConfigFromFile(uiKind);
  }

  private async loadModelConfigFromFile(uiKind: UiRequestKind): Promise<void> {
    try {
      const fn = (window as unknown as { zytrader?: { model?: { config?: { read: () => Promise<{ ok: boolean; config?: Record<string, unknown>; path?: string; error?: string }> } } } }).zytrader?.model?.config?.read;
      if (!fn) {
        this.requestConfigJson.set(this.defaultRequestJsonForUi(uiKind));
        return;
      }
      const result = await fn();
      if (result?.ok && result.config) {
        const normalized = this.normalizeRequestConfig(result.config as Record<string, unknown>);
        const text = JSON.stringify(normalized, null, 2);
        this.requestConfigJson.set(text);
        try {
          localStorage.setItem('zyfront:model-request-config-json', text);
        } catch {
          /* ignore */
        }
        this.applyRequestConfigFromParsed(normalized, { syncTextarea: false });
      } else {
        const def = this.defaultRequestJsonForUi(uiKind);
        this.requestConfigJson.set(def);
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
    const storedProvider: AppSettings['modelProvider'] = next.provider;
    const endpointConfig = MODEL_ENDPOINTS[next.provider];
    const newBaseUrl = endpointConfig?.baseUrl ?? '';
    const newRequestType = endpointConfig?.apiFormat === 'openai' ? 'openai' : next.provider === 'deepseek' ? 'deepseek' : 'anthropic';
    const profileKey = `${next.provider}:${next.id}`;
    const savedProfile = this.settings().modelProfiles?.[profileKey];
    const newApiKey = savedProfile?.apiKey ?? this.settings().apiKey;
    const newProxy = savedProfile?.proxy ? { ...savedProfile.proxy } : { enabled: false, baseUrl: newBaseUrl, authToken: '' };
    if (!newProxy.baseUrl?.trim()) {
      newProxy.baseUrl = newBaseUrl;
    }
    const nextJson = this.upsertRequestConfigModel(this.requestConfigJson(), next.id, storedProvider, newBaseUrl, newRequestType);
    this.settingsService.update(
      {
        model: next.id,
        modelProvider: storedProvider,
        apiKey: newApiKey,
        proxy: newProxy,
      },
      { profileKey },
    );
    void this.writeModelConfigToFile();
    this.requestType.set(newRequestType);
    this.endpointInput.set(newProxy.baseUrl || newBaseUrl);
    this.requestConfigJson.set(nextJson);
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
      this.writeModelConfigToFile();
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

    let apiKeyFromJson = this.settings().apiKey ?? '';
    let apiKeysFromConfig: AppSettings['api_keys'] = this.settings().api_keys;
    
    const apiKeysObj = parsedCfg['api_keys'];
    if (apiKeysObj && typeof apiKeysObj === 'object' && !Array.isArray(apiKeysObj)) {
      const apiKeys = apiKeysObj as Record<string, Record<string, unknown>>;
      apiKeysFromConfig = apiKeysFromConfig || {};
      
      if (apiKeys['MiniMax']?.['api_key']) {
        apiKeysFromConfig['MiniMax'] = { api_key: String(apiKeys['MiniMax']['api_key']) };
      }
      if (apiKeys['DeepSeek']?.['api_key']) {
        apiKeysFromConfig['DeepSeek'] = { api_key: String(apiKeys['DeepSeek']['api_key']) };
      }
      
      const modelEntry = findCatalogEntry(effectiveModel) ?? cur;
      const providerKey = modelEntry.provider === 'minimax' ? 'MiniMax' : modelEntry.provider === 'deepseek' ? 'DeepSeek' : null;
      if (providerKey && apiKeys[providerKey]) {
        const keyVal = apiKeys[providerKey]['api_key'];
        if (typeof keyVal === 'string' && keyVal.trim()) {
          apiKeyFromJson = keyVal;
        }
      }
    }

    this.settingsService.update({
      apiKey: apiKeyFromJson,
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
      api_keys: apiKeysFromConfig,
    });
    try {
      if (opts.syncTextarea) {
        this.requestConfigJson.set(JSON.stringify(parsedCfg, null, 2));
      }
    } catch {
      /* ignore */
    }
  }

  private async writeModelConfigToFile(): Promise<boolean> {
    try {
      const raw = this.requestConfigJson().trim();
      if (!raw) return false;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const fn = (window as unknown as { zytrader?: { model?: { config?: { write: (c: Record<string, unknown>) => Promise<{ ok: boolean; path?: string; error?: string }> } } } }).zytrader?.model?.config?.write;
      if (!fn) return false;
      const result = await fn(parsed);
      if (result?.ok === true) {
        try {
          localStorage.setItem('zyfront:model-request-config-json', raw);
        } catch {
          /* ignore */
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  protected save(): void {
    this.validationMessage.set('');
    const parsedCfg = this.parseRequestJsonOrSetError();
    if (!parsedCfg) return;
    this.applyRequestConfigFromParsed(parsedCfg, { syncTextarea: true });
    this.writeModelConfigToFile().then(() => {
      this.saveFeedback.set('saved');
      this.cdr.markForCheck();
      window.setTimeout(() => {
        this.saveFeedback.set('idle');
        this.cdr.markForCheck();
      }, 2000);
    });
  }

  /**
   * 保存 JSON 配置到本地存储和应用设置
   * 验证输入内容，解析并规范化 JSON，然后应用到应用配置中
   */
  protected saveJsonConfig(): void {
    // 获取并清理输入的 JSON 字符串
    const raw = this.requestConfigJson().trim();
    if (!raw) {
      this.validationMessage.set('配置内容为空');
      return;
    }
    try {
      // 解析 JSON 字符串为对象
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // 验证解析结果是否为有效的对象（非数组）
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.validationMessage.set('配置 JSON 必须是对象');
        return;
      }
      // 规范化配置对象，填充默认值并处理字段
      const normalized = this.normalizeRequestConfig(parsed);
      // 应用解析后的配置到应用设置，同步更新文本框内容
      this.applyRequestConfigFromParsed(normalized, { syncTextarea: true });
      // 写入文件系统
      this.writeModelConfigToFile().then((ok) => {
        if (ok) {
          this.validationMessage.set('');
          this.saveFeedback.set('saved');
          this.cdr.markForCheck();
          window.setTimeout(() => {
            this.saveFeedback.set('idle');
            this.cdr.markForCheck();
          }, 2000);
        } else {
          this.validationMessage.set('配置文件写入失败');
        }
      });
    } catch {
      // 捕获 JSON 解析异常
      this.validationMessage.set('配置 JSON 格式不正确');
    }
  }


  protected formatJsonConfig(): void {
    const raw = this.requestConfigJson().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const formatted = JSON.stringify(parsed, null, 2);
      this.requestConfigJson.set(formatted);
      this.validationMessage.set('');
    } catch {
      this.validationMessage.set('无法格式化：JSON 格式不正确');
    }
  }

  protected resetDefaults(): void {
    this.settingsService.reset();
    const ui: UiRequestKind = 'anthropic';
    this.requestType.set(ui);
    this.endpointInput.set(this.defaultBaseUrlForUi(ui));
    const defJson = this.defaultRequestJsonForUi(ui);
    this.requestConfigJson.set(defJson);
    this.validationMessage.set('');
    this.testStatus.set('idle');
    this.testMessage.set('已恢复默认配置');
    this.cdr.markForCheck();
    this.writeModelConfigToFile();
  }

  protected clearCache(): void {
    try {
      // 清空所有 localStorage 相关的配置
      const keysToRemove = [
        LAST_MODEL_TEST_KEY,
        'zyfront:app-settings',
        'zyfront:runtime-settings',
        'zyfront:memory-pipeline-config-v2',
      ];
      
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      
      // 重新初始化
      this.settingsService.reset();
      const ui: UiRequestKind = 'anthropic';
      this.requestType.set(ui);
      const defBaseUrl = this.defaultBaseUrlForUi(ui);
      this.endpointInput.set(defBaseUrl);
      const defJson = this.defaultRequestJsonForUi(ui);
      this.requestConfigJson.set(defJson);
      
      this.validationMessage.set('');
      this.testStatus.set('idle');
      this.testMessage.set('缓存已清空，请重新加载页面');
      this.saveFeedback.set('saved');
      this.cdr.markForCheck();
    } catch {
      this.testMessage.set('缓存清空失败');
      this.cdr.markForCheck();
    }
  }

  protected async testConnection(): Promise<void> {
    this.validationMessage.set('');
    this.testStatus.set('testing');
    this.testMessage.set('正在连接模型...');
    this.cdr.markForCheck();

    const parsedCfg = this.parseRequestJsonOrSetError();
    if (!parsedCfg) {
      this.testStatus.set('error');
      this.cdr.markForCheck();
      return;
    }
    
    const model = (typeof parsedCfg['model'] === 'string' ? String(parsedCfg['model']) : this.activeCatalogEntry().id).trim();
    const modelEntry = findCatalogEntry(model) ?? this.activeCatalogEntry();
    const providerKey = modelEntry.provider === 'minimax' ? 'MiniMax' : modelEntry.provider === 'deepseek' ? 'DeepSeek' : null;
    
    let apiKey = '';
    const apiKeysObj = parsedCfg['api_keys'];
    if (apiKeysObj && typeof apiKeysObj === 'object' && !Array.isArray(apiKeysObj)) {
      const apiKeys = apiKeysObj as Record<string, Record<string, unknown>>;
      if (providerKey && apiKeys[providerKey]) {
        const keyVal = apiKeys[providerKey]['api_key'];
        if (typeof keyVal === 'string' && keyVal.trim()) {
          apiKey = keyVal.trim();
        }
      }
    }
    
    if (!apiKey) {
      apiKey = this.settingsService.value.apiKey?.trim() ?? '';
    }
    
    if (!apiKey) {
      this.testStatus.set('error');
      this.testMessage.set(`请先在配置文件的 api_keys.${providerKey ?? 'MiniMax/DeepSeek'}.api_key 中填写 API Key`);
      this.cdr.markForCheck();
      return;
    }

    const baseUrl =
      (typeof parsedCfg['baseUrl'] === 'string' ? String(parsedCfg['baseUrl']) : this.endpointInput()).trim() ||
      this.defaultBaseUrlForUi(this.requestType());
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
    if (kind === 'deepseek') return 'https://api.deepseek.com/anthropic';
    return '';
  }

  protected applyRequestType(kind: string): void {
    const k = kind as UiRequestKind;
    if (k !== 'anthropic' && k !== 'openai' && k !== 'deepseek' && k !== 'custom') return;
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
    if (p === 'deepseek') return 'deepseek';
    if (p === 'anthropic' || p === 'openai' || p === 'custom') return p;
    return 'custom';
  }

  private defaultRequestJsonForUi(kind: UiRequestKind): string {
    const currentModel = this.activeCatalogEntry();
    const endpointConfig = MODEL_ENDPOINTS[currentModel.provider];
    if (kind === 'openai') {
      return JSON.stringify(
        {
          api_keys: {
            MiniMax: { api_key: '' },
            DeepSeek: { api_key: '' },
          },
          provider: 'minimax',
          model: currentModel.id,
          baseUrl: endpointConfig?.baseUrl ?? '',
          max_tokens: DEFAULT_MODEL_MAX_TOKENS,
          temperature: 0.2,
          thinking: endpointConfig?.supportsThinking ? { type: 'enabled' } : undefined,
          compression: {
            enabled: true,
            maxMessagesBeforeCompact: 50,
            compactToMessages: 20,
            maxEstimatedTokens: 24000,
          },
          cost: {
            maxSessionCostUsd: 5,
            warnThresholdUsd: 3,
          },
          theme: 'dark',
          models: {
            'MiniMax-M2.7': {
              enabled: true,
              isActive: currentModel.id === 'MiniMax-M2.7',
              baseUrl: 'https://api.minimaxi.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
            },
            'abab6.5s-chat': {
              enabled: true,
              isActive: currentModel.id === 'abab6.5s-chat',
              baseUrl: 'https://api.minimaxi.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
            },
            'abab6.5g-chat': {
              enabled: true,
              isActive: currentModel.id === 'abab6.5g-chat',
              baseUrl: 'https://api.minimaxi.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
            },
            'deepseek-v4-flash': {
              enabled: true,
              isActive: currentModel.id === 'deepseek-v4-flash',
              baseUrl: 'https://api.deepseek.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
            },
            'deepseek-v4-pro': {
              enabled: true,
              isActive: currentModel.id === 'deepseek-v4-pro',
              baseUrl: 'https://api.deepseek.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
              thinking: { type: 'enabled' },
            },
          },
        },
        null,
        2,
      );
    }
    if (kind === 'deepseek') {
      return JSON.stringify(
        {
          api_keys: {
            MiniMax: { api_key: '' },
            DeepSeek: { api_key: '' },
          },
          provider: 'deepseek',
          model: currentModel.id,
          baseUrl: endpointConfig?.baseUrl ?? '',
          max_tokens: DEFAULT_MODEL_MAX_TOKENS,
          temperature: 0.2,
          thinking: endpointConfig?.supportsThinking ? { type: 'enabled' } : undefined,
          compression: {
            enabled: true,
            maxMessagesBeforeCompact: 50,
            compactToMessages: 20,
            maxEstimatedTokens: 24000,
          },
          cost: {
            maxSessionCostUsd: 5,
            warnThresholdUsd: 3,
          },
          theme: 'dark',
          models: {
            'MiniMax-M2.7': {
              enabled: true,
              isActive: currentModel.id === 'MiniMax-M2.7',
              baseUrl: 'https://api.minimaxi.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
            },
            'abab6.5s-chat': {
              enabled: true,
              isActive: currentModel.id === 'abab6.5s-chat',
              baseUrl: 'https://api.minimaxi.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
            },
            'abab6.5g-chat': {
              enabled: true,
              isActive: currentModel.id === 'abab6.5g-chat',
              baseUrl: 'https://api.minimaxi.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
            },
            'deepseek-v4-flash': {
              enabled: true,
              isActive: currentModel.id === 'deepseek-v4-flash',
              baseUrl: 'https://api.deepseek.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
            },
            'deepseek-v4-pro': {
              enabled: true,
              isActive: currentModel.id === 'deepseek-v4-pro',
              baseUrl: 'https://api.deepseek.com/anthropic',
              max_tokens: 81920,
              temperature: 0.2,
              thinking: { type: 'enabled' },
            },
          },
        },
        null,
        2,
      );
    }
    return JSON.stringify(
      {
        api_keys: {
          MiniMax: { api_key: '' },
          DeepSeek: { api_key: '' },
        },
        provider: 'minimax',
        model: currentModel.id,
        baseUrl: endpointConfig?.baseUrl ?? '',
        max_tokens: DEFAULT_MODEL_MAX_TOKENS,
        temperature: 0.2,
        compression: {
          enabled: true,
          maxMessagesBeforeCompact: 50,
          compactToMessages: 20,
          maxEstimatedTokens: 24000,
        },
        cost: {
          maxSessionCostUsd: 5,
          warnThresholdUsd: 3,
        },
        theme: 'dark',
        models: {
          'MiniMax-M2.7': {
            enabled: true,
            isActive: currentModel.id === 'MiniMax-M2.7',
            baseUrl: 'https://api.minimaxi.com/anthropic',
            max_tokens: 81920,
            temperature: 0.2,
          },
          'abab6.5s-chat': {
            enabled: true,
            isActive: currentModel.id === 'abab6.5s-chat',
            baseUrl: 'https://api.minimaxi.com/anthropic',
            max_tokens: 81920,
            temperature: 0.2,
          },
          'abab6.5g-chat': {
            enabled: true,
            isActive: currentModel.id === 'abab6.5g-chat',
            baseUrl: 'https://api.minimaxi.com/anthropic',
            max_tokens: 81920,
            temperature: 0.2,
          },
          'deepseek-v4-flash': {
            enabled: true,
            isActive: currentModel.id === 'deepseek-v4-flash',
            baseUrl: 'https://api.deepseek.com/anthropic',
            max_tokens: 81920,
            temperature: 0.2,
          },
          'deepseek-v4-pro': {
            enabled: true,
            isActive: currentModel.id === 'deepseek-v4-pro',
            baseUrl: 'https://api.deepseek.com/anthropic',
            max_tokens: 81920,
            temperature: 0.2,
            thinking: { type: 'enabled' },
          },
        },
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
    const currentModel = this.activeCatalogEntry();
    const endpointConfig = MODEL_ENDPOINTS[currentModel.provider];
    
    if (!out['api_keys']) {
      out['api_keys'] = {
        MiniMax: { api_key: '' },
        DeepSeek: { api_key: '' },
      };
    }
    
    if (!out['models']) {
      out['models'] = {
        'MiniMax-M2.7': {
          enabled: true,
          isActive: currentModel.id === 'MiniMax-M2.7',
          baseUrl: 'https://api.minimaxi.com/anthropic',
          max_tokens: 81920,
          temperature: 0.2,
        },
        'abab6.5s-chat': {
          enabled: true,
          isActive: currentModel.id === 'abab6.5s-chat',
          baseUrl: 'https://api.minimaxi.com/anthropic',
          max_tokens: 81920,
          temperature: 0.2,
        },
        'abab6.5g-chat': {
          enabled: true,
          isActive: currentModel.id === 'abab6.5g-chat',
          baseUrl: 'https://api.minimaxi.com/anthropic',
          max_tokens: 81920,
          temperature: 0.2,
        },
        'deepseek-v4-flash': {
          enabled: true,
          isActive: currentModel.id === 'deepseek-v4-flash',
          baseUrl: 'https://api.deepseek.com/anthropic',
          max_tokens: 81920,
          temperature: 0.2,
        },
        'deepseek-v4-pro': {
          enabled: true,
          isActive: currentModel.id === 'deepseek-v4-pro',
          baseUrl: 'https://api.deepseek.com/anthropic',
          max_tokens: 81920,
          temperature: 0.2,
          thinking: { type: 'enabled' },
        },
      };
    } else {
      const models = out['models'] as Record<string, unknown>;
      for (const [modelId, modelCfg] of Object.entries(models)) {
        if (modelCfg && typeof modelCfg === 'object') {
          delete (modelCfg as Record<string, unknown>)['api_key'];
          (modelCfg as Record<string, unknown>)['isActive'] = modelId === currentModel.id;
        }
      }
    }
    
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

    if (!out['model']) {
      out['model'] = currentModel.id;
    }
    const modelId = String(out['model'] ?? currentModel.id);
    const modelEntry = findCatalogEntry(modelId) ?? currentModel;
    const modelEndpointConfig = MODEL_ENDPOINTS[modelEntry.provider];
    if (!out['baseUrl'] || out['baseUrl'] === 'https://api.anthropic.com' || out['baseUrl'] === 'https://api.openai.com') {
      out['baseUrl'] = modelEndpointConfig?.baseUrl ?? '';
    }
    if (modelEntry.provider === 'deepseek') {
      const baseUrlStr = typeof out['baseUrl'] === 'string' ? out['baseUrl'] : '';
      if (!baseUrlStr || baseUrlStr === 'https://api.deepseek.com' || !baseUrlStr.includes('/anthropic')) {
        out['baseUrl'] = modelEndpointConfig?.baseUrl ?? 'https://api.deepseek.com/anthropic';
      }
    }
    if (modelEntry.provider === 'minimax') {
      out['baseUrl'] = modelEndpointConfig?.baseUrl ?? 'https://api.minimaxi.com/anthropic';
    }
    if (!out['compression']) {
      out['compression'] = {
        enabled: true,
        maxMessagesBeforeCompact: 50,
        compactToMessages: 20,
        maxEstimatedTokens: 24000,
      };
    }
    if (!out['cost']) {
      out['cost'] = {
        maxSessionCostUsd: 5,
        warnThresholdUsd: 3,
      };
    }
    if (!out['theme']) {
      out['theme'] = 'dark';
    }
    if (endpointConfig?.supportsThinking && !out['thinking']) {
      out['thinking'] = { type: 'enabled' };
    }

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
      const currentModel = this.activeCatalogEntry();
      const endpointConfig = MODEL_ENDPOINTS[currentModel.provider];
      if (kind === 'openai') normalized['provider'] = 'openai';
      else if (kind === 'deepseek') {
        normalized['provider'] = 'deepseek';
        normalized['baseUrl'] = endpointConfig?.baseUrl ?? 'https://api.deepseek.com/anthropic';
      }
      else if (kind === 'anthropic') normalized['provider'] = 'anthropic';
      return JSON.stringify(normalized, null, 2);
    } catch {
      return this.defaultRequestJsonForUi(kind);
    }
  }

  private upsertRequestConfigModel(
    rawJson: string,
    modelId: string,
    provider: AppSettings['modelProvider'],
    baseUrl: string,
    kind: UiRequestKind,
  ): string {
    if (!rawJson.trim()) return this.defaultRequestJsonForUi(kind);
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return this.defaultRequestJsonForUi(kind);
      }
      const normalized = this.normalizeRequestConfig(parsed as Record<string, unknown>);
      normalized['model'] = modelId;
      normalized['baseUrl'] = baseUrl;
      normalized['provider'] = provider;
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
