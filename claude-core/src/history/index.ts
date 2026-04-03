import type { ChatMessage, IdGenerator, StorageAdapter } from '../types/index.js';

export interface HistoryStore {
  append(sessionId: string, message: ChatMessage): Promise<void>;
  list(sessionId: string): Promise<ChatMessage[]>;
  clear(sessionId: string): Promise<void>;
}

export class InMemoryHistoryStore implements HistoryStore {
  private readonly map = new Map<string, ChatMessage[]>();

  async append(sessionId: string, message: ChatMessage): Promise<void> {
    const list = this.map.get(sessionId) ?? [];
    list.push(message);
    this.map.set(sessionId, list);
  }

  async list(sessionId: string): Promise<ChatMessage[]> {
    return [...(this.map.get(sessionId) ?? [])];
  }

  async clear(sessionId: string): Promise<void> {
    this.map.delete(sessionId);
  }
}

export class PersistentHistoryStore implements HistoryStore {
  constructor(private readonly storage: StorageAdapter, private readonly ids: IdGenerator) {}

  private key(sessionId: string): string {
    return `history:${sessionId}`;
  }

  async append(sessionId: string, message: ChatMessage): Promise<void> {
    const existing = (await this.storage.get<ChatMessage[]>(this.key(sessionId))) ?? [];
    existing.push({ ...message, id: message.id || this.ids.next('msg') });
    await this.storage.set(this.key(sessionId), existing);
  }

  async list(sessionId: string): Promise<ChatMessage[]> {
    return (await this.storage.get<ChatMessage[]>(this.key(sessionId))) ?? [];
  }

  async clear(sessionId: string): Promise<void> {
    await this.storage.remove(this.key(sessionId));
  }
}
