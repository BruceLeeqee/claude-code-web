/**
 * `StorageAdapter` 实现：进程内 Map 与带命名空间的浏览器 localStorage（JSON 序列化）。
 */
import type { StorageAdapter } from '../types/index.js';

/** 内存键值存储 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(prefix = ''): Promise<string[]> {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
}

/** 使用 localStorage/sessionStorage + 可选 key 前缀 */
export class BrowserLocalStorageAdapter implements StorageAdapter {
  constructor(private readonly storage: Storage = localStorage, private readonly namespace = 'zyfront-core:') {}

  private key(key: string): string {
    return `${this.namespace}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = this.storage.getItem(this.key(key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.storage.setItem(this.key(key), JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.storage.removeItem(this.key(key));
  }

  async keys(prefix = ''): Promise<string[]> {
    const list: string[] = [];
    const fullPrefix = this.namespace + prefix;
    for (let i = 0; i < this.storage.length; i += 1) {
      const k = this.storage.key(i);
      if (!k || !k.startsWith(fullPrefix)) continue;
      list.push(k.slice(this.namespace.length));
    }
    return list;
  }
}
