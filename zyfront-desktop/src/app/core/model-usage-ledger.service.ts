/**
 * 模型用量账本：根据助手流式响应中的真实 usage 与耗时写入，持久化到 localStorage。
 * 用于模型配置页的上下文占用、累计成本估算、7 日趋势与平均响应时间（均来自本机记录，非演示假数据）。
 */
import { Injectable, computed, signal } from '@angular/core';
import type { Usage } from 'zyfront-core';
import { defaultCatalogEntry, findCatalogEntry } from './model-catalog';

const STORAGE_KEY = 'zyfront:model-usage-ledger:v1';

export interface DailyBucket {
  in: number;
  out: number;
}

export interface UsageLedgerState {
  /** YYYY-MM-DD -> 当日累计 input/output tokens */
  daily: Record<string, DailyBucket>;
  /** 按目录价估算的累计美元（非官方账单） */
  lifetimeCostUsd: number;
  /** 最近若干次请求的耗时（ms），用于平均响应时间 */
  latenciesMs: number[];
  lastInputTokens: number;
  lastOutputTokens: number;
  lastModelId: string;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadState(): UsageLedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const p = JSON.parse(raw) as Partial<UsageLedgerState>;
    return {
      daily: typeof p.daily === 'object' && p.daily !== null ? p.daily : {},
      lifetimeCostUsd: typeof p.lifetimeCostUsd === 'number' ? p.lifetimeCostUsd : 0,
      latenciesMs: Array.isArray(p.latenciesMs) ? p.latenciesMs.filter((x) => typeof x === 'number' && x >= 0).slice(-50) : [],
      lastInputTokens: typeof p.lastInputTokens === 'number' ? p.lastInputTokens : 0,
      lastOutputTokens: typeof p.lastOutputTokens === 'number' ? p.lastOutputTokens : 0,
      lastModelId: typeof p.lastModelId === 'string' ? p.lastModelId : '',
    };
  } catch {
    return emptyState();
  }
}

function emptyState(): UsageLedgerState {
  return {
    daily: {},
    lifetimeCostUsd: 0,
    latenciesMs: [],
    lastInputTokens: 0,
    lastOutputTokens: 0,
    lastModelId: '',
  };
}

function persist(s: UsageLedgerState): void {
  try {
    const daily = { ...s.daily };
    const cutoff = Date.now() - 90 * 86400000;
    for (const k of Object.keys(daily)) {
      const t = Date.parse(`${k}T12:00:00`);
      if (Number.isFinite(t) && t < cutoff) delete daily[k];
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...s,
        daily,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

function estimateCostUsd(usage: Usage, modelId: string): number {
  const cat = findCatalogEntry(modelId) ?? defaultCatalogEntry();
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (input / 1e6) * cat.usdPer1MInput + (output / 1e6) * cat.usdPer1MOutput;
}

@Injectable({ providedIn: 'root' })
export class ModelUsageLedgerService {
  private readonly state = signal<UsageLedgerState>(loadState());

  readonly stateRo = computed(() => this.state());

  /** 最近一轮 API 返回的 input/output（用于「上下文使用率」分子） */
  readonly lastTurnTokens = computed(() => {
    const s = this.state();
    return { in: s.lastInputTokens, out: s.lastOutputTokens, sum: s.lastInputTokens + s.lastOutputTokens };
  });

  readonly avgLatencyMs = computed(() => {
    const arr = this.state().latenciesMs;
    if (arr.length === 0) return null;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  });

  readonly lifetimeCostUsd = computed(() => this.state().lifetimeCostUsd);

  /** 近 7 日（含今天）每日总 token，无数据则为 0 */
  readonly last7DaysSeries = computed(() => {
    const daily = this.state().daily;
    const rows: { label: string; tokens: number; key: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const b = daily[key] ?? { in: 0, out: 0 };
      rows.push({
        key,
        label: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        tokens: b.in + b.out,
      });
    }
    return rows;
  });

  /** 记录一次成功返回的用量（通常来自流末尾 `done.usage`） */
  record(usage: Usage, modelId: string, latencyMs?: number): void {
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const cost = estimateCostUsd(usage, modelId);
    const key = todayKey();
    const s = this.state();
    const prev = s.daily[key] ?? { in: 0, out: 0 };
    const nextDaily = { ...s.daily, [key]: { in: prev.in + input, out: prev.out + output } };
    let lat = [...s.latenciesMs];
    if (typeof latencyMs === 'number' && latencyMs >= 0 && latencyMs < 3600000) {
      lat.push(latencyMs);
      lat = lat.slice(-50);
    }
    const next: UsageLedgerState = {
      daily: nextDaily,
      lifetimeCostUsd: s.lifetimeCostUsd + cost,
      latenciesMs: lat,
      lastInputTokens: input,
      lastOutputTokens: output,
      lastModelId: modelId,
    };
    this.state.set(next);
    persist(next);
  }
}
