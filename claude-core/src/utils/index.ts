/**
 * 通用工具：时钟、ID、内存事件总线、JSON 请求头；并再导出 `native-ts` 环境辅助函数。
 */
import type { Clock, EventBus, CoreEvent, IdGenerator } from '../types/index.js';

export * from './native-ts.js';

/** 使用 Date.now 的时钟实现 */
export class SystemClock implements Clock {
  /** 当前 Unix 毫秒时间戳 */
  now(): number {
    return Date.now();
  }
}

/** 单调计数 + 随机后缀生成 id */
export class SimpleIdGenerator implements IdGenerator {
  private counter = 0;

  /** 生成 `${prefix}_${n}_${rand}` */
  next(prefix = 'id'): string {
    this.counter += 1;
    return `${prefix}_${this.counter}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** 进程内按事件类型分发的简单总线 */
export class InMemoryEventBus implements EventBus {
  private listeners = new Map<string, Set<(event: CoreEvent) => void>>();

  /** 同步调用该 type 下全部订阅者 */
  publish(event: CoreEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const handler of set) handler(event);
  }

  /** 订阅某类事件，返回取消订阅函数 */
  subscribe(type: string, handler: (event: CoreEvent) => void): () => void {
    const set = this.listeners.get(type) ?? new Set<(event: CoreEvent) => void>();
    set.add(handler);
    this.listeners.set(type, set);
    return () => {
      const current = this.listeners.get(type);
      current?.delete(handler);
      if (current && current.size === 0) this.listeners.delete(type);
    };
  }
}

/** 合并 Content-Type: application/json 与额外头 */
export function createJsonHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}
