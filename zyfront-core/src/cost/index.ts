/**
 * 成本追踪：按千 token 单价累计会话费用，并对照策略判断告警与超限。
 */
import type { CostBreakdown, CostPolicy, Usage } from '../types/index.js';

/** 每 1k token 的美元单价表 */
export interface PricingTable {
  inputPer1k: number;
  outputPer1k: number;
  cacheReadPer1k?: number;
  cacheWritePer1k?: number;
}

/** 累计费用与逐条记录快照 */
export interface CostSnapshot {
  totalUsd: number;
  records: Array<{ usage: Usage; cost: CostBreakdown; at: number }>;
}

/** 根据 PricingTable 将 Usage 转为美元并累加 */
export class CostTracker {
  private records: Array<{ usage: Usage; cost: CostBreakdown; at: number }> = [];

  constructor(
    private readonly pricing: PricingTable,
    private readonly policy: CostPolicy = {},
  ) {}

  /** 计算本次用量成本并追加到会话记录 */
  calculate(usage: Usage): CostBreakdown {
    const inputCostUsd = (usage.inputTokens / 1000) * this.pricing.inputPer1k;
    const outputCostUsd = (usage.outputTokens / 1000) * this.pricing.outputPer1k;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheWrite = usage.cacheCreationTokens ?? 0;
    const cacheCostUsd =
      (cacheRead / 1000) * (this.pricing.cacheReadPer1k ?? 0) +
      (cacheWrite / 1000) * (this.pricing.cacheWritePer1k ?? 0);

    const totalCostUsd = inputCostUsd + outputCostUsd + cacheCostUsd;

    const breakdown: CostBreakdown = {
      inputCostUsd,
      outputCostUsd,
      cacheCostUsd,
      totalCostUsd,
    };

    this.records.push({ usage, cost: breakdown, at: Date.now() });
    return breakdown;
  }

  /** 本会话累计总美元 */
  sessionTotal(): number {
    return this.records.reduce((sum, it) => sum + it.cost.totalCostUsd, 0);
  }

  /** 是否达到 warnThresholdUsd */
  shouldWarn(): boolean {
    const threshold = this.policy.warnThresholdUsd ?? Number.POSITIVE_INFINITY;
    return this.sessionTotal() >= threshold;
  }

  /** 是否超过 maxSessionCostUsd */
  exceeded(): boolean {
    const max = this.policy.maxSessionCostUsd ?? Number.POSITIVE_INFINITY;
    return this.sessionTotal() > max;
  }

  /** 导出累计值与历史记录副本 */
  snapshot(): CostSnapshot {
    return {
      totalUsd: this.sessionTotal(),
      records: [...this.records],
    };
  }

  /** 清空累计记录 */
  reset(): void {
    this.records = [];
  }
}
