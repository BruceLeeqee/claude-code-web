import type { Clock, EventBus, CoreEvent, IdGenerator } from '../types/index.js';

export * from './native-ts.js';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class SimpleIdGenerator implements IdGenerator {
  private counter = 0;

  next(prefix = 'id'): string {
    this.counter += 1;
    return `${prefix}_${this.counter}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export class InMemoryEventBus implements EventBus {
  private listeners = new Map<string, Set<(event: CoreEvent) => void>>();

  publish(event: CoreEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const handler of set) handler(event);
  }

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

export function createJsonHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}
