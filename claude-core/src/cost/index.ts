import type { CostBreakdown, CostPolicy, Usage } from '../types/index.js';

export interface PricingTable {
  inputPer1k: number;
  outputPer1k: number;
  cacheReadPer1k?: number;
  cacheWritePer1k?: number;
}

export class CostTracker {
  private total = 0;

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

    this.total += totalCostUsd;

    return {
      inputCostUsd,
      outputCostUsd,
      cacheCostUsd,
      totalCostUsd,
    };
  }

  sessionTotal(): number {
    return this.total;
  }

  shouldWarn(): boolean {
    return (this.policy.warnThresholdUsd ?? Number.POSITIVE_INFINITY) <= this.total;
  }

  exceeded(): boolean {
    return (this.policy.maxSessionCostUsd ?? Number.POSITIVE_INFINITY) < this.total;
  }
}
