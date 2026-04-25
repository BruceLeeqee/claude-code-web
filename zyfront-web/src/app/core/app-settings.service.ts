/**
 * 应用全局设置：模型、代理、压缩、成本与主题等，持久化到 localStorage。
 */
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/** 界面主题 */
export type AppTheme = 'dark' | 'light';

/** API 代理相关配置 */
export interface ProxySettings {
  enabled: boolean;
  baseUrl: string;
  authToken: string;
}

/** 对话历史压缩策略 */
export interface CompressionSettings {
  enabled: boolean;
  maxMessagesBeforeCompact: number;
  compactToMessages: number;
  maxEstimatedTokens: number;
}

/** 会话成本告警阈值（美元） */
export interface CostSettings {
  maxSessionCostUsd: number;
  warnThresholdUsd: number;
}

/** 聚合后的应用设置快照 */
export interface AppSettings {
  apiKey: string;
  modelProvider: 'anthropic' | 'openai' | 'minimax' | 'deepseek' | 'custom';
  model: string;
  proxy: ProxySettings;
  compression: CompressionSettings;
  cost: CostSettings;
  theme: AppTheme;
}

const STORAGE_KEY = 'claude-web:settings:v1';

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  modelProvider: 'minimax',
  model: 'MiniMax-M2.7',
  proxy: {
    enabled: false,
    baseUrl: '',
    authToken: '',
  },
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
};

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private readonly settingsSubject = new BehaviorSubject<AppSettings>(this.load());
  /** 设置变更流，供各页面订阅 */
  readonly settings$ = this.settingsSubject.asObservable();

  constructor() {
    this.applyTheme(this.settingsSubject.value.theme);
  }

  /** 当前设置快照（同步读取） */
  get value(): AppSettings {
    return this.settingsSubject.value;
  }

  /** 合并更新设置并写回 localStorage；若包含 theme 则同步到 DOM */
  update(patch: Partial<AppSettings>): void {
    const current = this.settingsSubject.value;
    const next: AppSettings = {
      ...current,
      ...patch,
      proxy: {
        ...current.proxy,
        ...(patch.proxy ?? {}),
      },
      compression: {
        ...current.compression,
        ...(patch.compression ?? {}),
      },
      cost: {
        ...current.cost,
        ...(patch.cost ?? {}),
      },
    };

    this.settingsSubject.next(next);
    this.persist(next);

    if (patch.theme) {
      this.applyTheme(patch.theme);
    }
  }

  /** 恢复为内置默认值 */
  reset(): void {
    this.settingsSubject.next(DEFAULT_SETTINGS);
    this.persist(DEFAULT_SETTINGS);
    this.applyTheme(DEFAULT_SETTINGS.theme);
  }

  /** 从 localStorage 读取并与安全默认值合并 */
  private load(): AppSettings {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        proxy: {
          ...DEFAULT_SETTINGS.proxy,
          ...(parsed.proxy ?? {}),
        },
        compression: {
          ...DEFAULT_SETTINGS.compression,
          ...(parsed.compression ?? {}),
        },
        cost: {
          ...DEFAULT_SETTINGS.cost,
          ...(parsed.cost ?? {}),
        },
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  /** 序列化写入 localStorage */
  private persist(settings: AppSettings): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  /** 将主题写入 `document.documentElement.dataset.theme` 供 CSS 使用 */
  private applyTheme(theme: AppTheme): void {
    document.documentElement.dataset['theme'] = theme;
  }
}
