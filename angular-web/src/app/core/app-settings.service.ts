import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AppTheme = 'dark' | 'light';

export interface ProxySettings {
  enabled: boolean;
  baseUrl: string;
  authToken: string;
}

export interface CompressionSettings {
  enabled: boolean;
  maxMessagesBeforeCompact: number;
  compactToMessages: number;
}

export interface CostSettings {
  maxSessionCostUsd: number;
  warnThresholdUsd: number;
}

export interface AppSettings {
  apiKey: string;
  model: string;
  proxy: ProxySettings;
  compression: CompressionSettings;
  cost: CostSettings;
  theme: AppTheme;
}

const STORAGE_KEY = 'claude-web:settings:v1';

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  model: 'claude-3-5-sonnet-latest',
  proxy: {
    enabled: false,
    baseUrl: '',
    authToken: '',
  },
  compression: {
    enabled: true,
    maxMessagesBeforeCompact: 50,
    compactToMessages: 20,
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
  readonly settings$ = this.settingsSubject.asObservable();

  constructor() {
    this.applyTheme(this.settingsSubject.value.theme);
  }

  get value(): AppSettings {
    return this.settingsSubject.value;
  }

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

  reset(): void {
    this.settingsSubject.next(DEFAULT_SETTINGS);
    this.persist(DEFAULT_SETTINGS);
    this.applyTheme(DEFAULT_SETTINGS.theme);
  }

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

  private persist(settings: AppSettings): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  private applyTheme(theme: AppTheme): void {
    document.documentElement.dataset['theme'] = theme;
  }
}
