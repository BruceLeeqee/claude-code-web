import { Injectable } from '@angular/core';

/** v2：自该版本起总开关默认开启；从 v1 迁移时会将 `enabled` 置为 true */
const MEMORY_PIPELINE_STORAGE_KEY = 'zyfront:memory-pipeline-config-v2';
const MEMORY_PIPELINE_STORAGE_KEY_V1_LEGACY = 'zyfront:memory-pipeline-config-v1';

export interface MemorySystemConfig {
  enabled: boolean;
  memoryRootKey: string;
  extract: {
    enabled: boolean;
    everyNTurns: number;
    maxTurns: number;
  };
  session: {
    enabled: boolean;
    minTokenDelta: number;
    minToolCalls: number;
  };
  dream: {
    enabled: boolean;
    /** 距上次巩固成功至少间隔的小时数（与参考实现 readLastConsolidatedAt 语义对齐） */
    minHours: number;
    /** 触发 dream 前至少见过的不同 session 数 */
    minSessions: number;
    /** 单 session 场景下的兜底阈值：累计轮次达到后也可触发 */
    minTurns: number;
    /** 两次做梦评估之间的最短间隔（分钟），对应参考实现的 SESSION_SCAN_INTERVAL */
    scanThrottleMinutes: number;
  };
}

export const DEFAULT_MEMORY_SYSTEM_CONFIG: MemorySystemConfig = {
  enabled: true,
  memoryRootKey: 'agent-memory-root',
  extract: {
    enabled: true,
    everyNTurns: 1,
    maxTurns: 5,
  },
  session: {
    enabled: true,
    minTokenDelta: 10,
    minToolCalls: 1,
  },
  dream: {
    enabled: true,
    /** 与 restored autoDream 默认（GrowthBook tengu_onyx_plover）一致 */
    minHours: 24,
    minSessions: 1,
    minTurns: 20,
    scanThrottleMinutes: 10,
  },
};

function cloneDefaults(): MemorySystemConfig {
  return {
    ...DEFAULT_MEMORY_SYSTEM_CONFIG,
    extract: { ...DEFAULT_MEMORY_SYSTEM_CONFIG.extract },
    session: { ...DEFAULT_MEMORY_SYSTEM_CONFIG.session },
    dream: { ...DEFAULT_MEMORY_SYSTEM_CONFIG.dream },
  };
}

export function mergeMemorySystemConfig(
  base: MemorySystemConfig,
  patch: Partial<MemorySystemConfig>,
): MemorySystemConfig {
  return {
    ...base,
    ...patch,
    enabled: patch.enabled ?? base.enabled,
    memoryRootKey: patch.memoryRootKey ?? base.memoryRootKey,
    extract: { ...base.extract, ...(patch.extract ?? {}) },
    session: { ...base.session, ...(patch.session ?? {}) },
    dream: { ...base.dream, ...(patch.dream ?? {}) },
  };
}

@Injectable({ providedIn: 'root' })
export class MemoryConfigService {
  private config: MemorySystemConfig;

  constructor() {
    this.config = this.loadFromStorage();
  }

  getConfig(): MemorySystemConfig {
    return this.config;
  }

  /** 合并写入并持久化到 localStorage（模型配置页等调用） */
  applyPartial(patch: Partial<MemorySystemConfig>): void {
    this.config = mergeMemorySystemConfig(this.config, patch);
    this.persist();
  }

  resetToDefaults(): void {
    this.config = cloneDefaults();
    this.persist();
  }

  private loadFromStorage(): MemorySystemConfig {
    try {
      const v2raw = localStorage.getItem(MEMORY_PIPELINE_STORAGE_KEY);
      if (v2raw?.trim()) {
        const parsed = JSON.parse(v2raw) as Partial<MemorySystemConfig>;
        return mergeMemorySystemConfig(cloneDefaults(), parsed);
      }

      const v1raw = localStorage.getItem(MEMORY_PIPELINE_STORAGE_KEY_V1_LEGACY);
      if (!v1raw?.trim()) {
        return cloneDefaults();
      }

      let merged = mergeMemorySystemConfig(cloneDefaults(), JSON.parse(v1raw) as Partial<MemorySystemConfig>);
      merged = { ...merged, enabled: true };
      try {
        localStorage.setItem(MEMORY_PIPELINE_STORAGE_KEY, JSON.stringify(merged));
        localStorage.removeItem(MEMORY_PIPELINE_STORAGE_KEY_V1_LEGACY);
      } catch {
        /* ignore */
      }
      return merged;
    } catch {
      return cloneDefaults();
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(MEMORY_PIPELINE_STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      /* ignore quota / private mode */
    }
  }
}
