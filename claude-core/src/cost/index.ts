import type { CostBreakdown, CostPolicy, Usage } from '../types/index.js';

export interface PricingTable {
  inputPer1k: number;
  outputPer1k: number;
  cacheReadPer1k?: number;
  cacheWritePer1k?: number;
}

export interface CostSnapshot {
  totalUsd: number;
  records: Array<{ usage: Usage; cost: CostBreakdown; at: number }>;
}

export class CostTracker {
  private records: Array<{ usage: Usage; cost: CostBreakdown; at: number }> = [];

  constructor(
    private readonly pricing: PricingTable,
    private readonly policy: CostPolicy = {},
  ) {}

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

  sessionTotal(): number {
    return this.records.reduce((sum, it) => sum + it.cost.totalCostUsd, 0);
  }

  shouldWarn(): boolean {
    const threshold = this.policy.warnThresholdUsd ?? Number.POSITIVE_INFINITY;
    return this.sessionTotal() >= threshold;
  }

  exceeded(): boolean {
    const max = this.policy.maxSessionCostUsd ?? Number.POSITIVE_INFINITY;
    return this.sessionTotal() > max;
  }

  snapshot(): CostSnapshot {
    return {
      totalUsd: this.sessionTotal(),
      records: [...this.records],
    };
  }

  reset(): void {
    this.records = [];
  }
}
