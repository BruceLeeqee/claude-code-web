import type { CostBreakdown, Usage } from '../../types/index.js';

export interface AnalyticsEvent {
  name: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface AnalyticsSink {
  track(event: AnalyticsEvent): Promise<void>;
}

export class NoopAnalyticsSink implements AnalyticsSink {
  async track(_event: AnalyticsEvent): Promise<void> {
    return;
  }
}

export class InMemoryAnalyticsSink implements AnalyticsSink {
  private readonly events: AnalyticsEvent[] = [];

  async track(event: AnalyticsEvent): Promise<void> {
    this.events.push(event);
  }

  list(): AnalyticsEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}

export function usageToAnalytics(usage: Usage, cost?: CostBreakdown): AnalyticsEvent {
  return {
    name: 'usage.recorded',
    timestamp: Date.now(),
    payload: {
      usage,
      cost,
    },
  };
}
