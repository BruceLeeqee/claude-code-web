/**
 * 分析事件模型、Sink 实现，以及将用量转为标准事件的辅助函数。
 */
import type { CostBreakdown, Usage } from '../../types/index.js';

/** 一条可上报的分析事件 */
export interface AnalyticsEvent {
  name: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

/** 分析数据落地接口 */
export interface AnalyticsSink {
  track(event: AnalyticsEvent): Promise<void>;
}

/** 空实现，丢弃事件 */
export class NoopAnalyticsSink implements AnalyticsSink {
  async track(_event: AnalyticsEvent): Promise<void> {
    return;
  }
}

/** 内存中保存事件列表，便于测试 */
export class InMemoryAnalyticsSink implements AnalyticsSink {
  private readonly events: AnalyticsEvent[] = [];

  async track(event: AnalyticsEvent): Promise<void> {
    this.events.push(event);
  }

  /** 返回已记录事件副本 */
  list(): AnalyticsEvent[] {
    return [...this.events];
  }

  /** 清空缓冲区 */
  clear(): void {
    this.events.length = 0;
  }
}

/** 构造 `usage.recorded` 事件载荷 */
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
