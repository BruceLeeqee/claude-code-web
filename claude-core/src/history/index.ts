import type { ChatMessage, IdGenerator, StorageAdapter } from '../types/index.js';
import type { Migration } from '../migrations/index.js';

export interface HistoryStore {
  append(sessionId: string, message: ChatMessage): Promise<void>;
  list(sessionId: string): Promise<ChatMessage[]>;
  update(sessionId: string, messageId: string, patch: Partial<ChatMessage>): Promise<ChatMessage | null>;
  remove(sessionId: string, messageId: string): Promise<boolean>;
  clear(sessionId: string): Promise<void>;
}

interface HistoryDocumentV1 {
  version: 1;
  messages: ChatMessage[];
}

interface HistoryDocumentV2 {
  version: 2;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

type HistoryDocument = HistoryDocumentV1 | HistoryDocumentV2;

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

  async update(sessionId: string, messageId: string, patch: Partial<ChatMessage>): Promise<ChatMessage | null> {
    const list = this.map.get(sessionId) ?? [];
    const index = list.findIndex((m) => m.id === messageId);
    if (index < 0) return null;
    const current = list[index];
    if (!current) return null;

    const next: ChatMessage = {
      ...current,
      ...patch,
      id: current.id,
      role: patch.role ?? current.role,
      content: patch.content ?? current.content,
      timestamp: patch.timestamp ?? current.timestamp,
    };
    list[index] = next;
    this.map.set(sessionId, list);
    return next;
  }

  async remove(sessionId: string, messageId: string): Promise<boolean> {
    const list = this.map.get(sessionId) ?? [];
    const next = list.filter((m) => m.id !== messageId);
    if (next.length === list.length) return false;
    this.map.set(sessionId, next);
    return true;
  }

  async clear(sessionId: string): Promise<void> {
    this.map.delete(sessionId);
  }
}

export class PersistentHistoryStore implements HistoryStore {
  private readonly migrations: Migration<HistoryDocument>[] = [
    {
      from: 1,
      to: 2,
      run: (state) => {
        if (state.version !== 1) return state;
        return {
          version: 2,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: state.messages,
        };
      },
    },
  ];

  constructor(
    private readonly storage: StorageAdapter,
    private readonly ids: IdGenerator,
    private readonly targetVersion: 1 | 2 = 2,
  ) {}

  private key(sessionId: string): string {
    return `history:${sessionId}`;
  }

  private async loadDoc(sessionId: string): Promise<HistoryDocumentV2> {
    const raw = await this.storage.get<HistoryDocument>(this.key(sessionId));

    if (!raw) {
      return {
        version: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
    }

    if (raw.version === 2) return raw;

    let current: HistoryDocument = raw;
    while (current.version < this.targetVersion) {
      const step = this.migrations.find((m) => m.from === current.version);
      if (!step) {
        throw new Error(`Missing history migration from v${current.version}`);
      }
      current = step.run(current);
    }

    if (current.version !== 2) {
      throw new Error('History migration failed to reach v2');
    }

    await this.storage.set(this.key(sessionId), current);
    return current;
  }

  private async saveDoc(sessionId: string, doc: HistoryDocumentV2): Promise<void> {
    await this.storage.set(this.key(sessionId), {
      ...doc,
      updatedAt: Date.now(),
    });
  }

  async append(sessionId: string, message: ChatMessage): Promise<void> {
    const doc = await this.loadDoc(sessionId);
    doc.messages.push({ ...message, id: message.id || this.ids.next('msg') });
    await this.saveDoc(sessionId, doc);
  }

  async list(sessionId: string): Promise<ChatMessage[]> {
    const doc = await this.loadDoc(sessionId);
    return [...doc.messages];
  }

  async update(sessionId: string, messageId: string, patch: Partial<ChatMessage>): Promise<ChatMessage | null> {
    const doc = await this.loadDoc(sessionId);
    const idx = doc.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return null;

    const current = doc.messages[idx];
    if (!current) return null;

    const next: ChatMessage = {
      ...current,
      ...patch,
      id: current.id,
      role: patch.role ?? current.role,
      content: patch.content ?? current.content,
      timestamp: patch.timestamp ?? current.timestamp,
    };

    doc.messages[idx] = next;
    await this.saveDoc(sessionId, doc);
    return next;
  }

  async remove(sessionId: string, messageId: string): Promise<boolean> {
    const doc = await this.loadDoc(sessionId);
    const next = doc.messages.filter((m) => m.id !== messageId);
    if (next.length === doc.messages.length) return false;
    doc.messages = next;
    await this.saveDoc(sessionId, doc);
    return true;
  }

  async clear(sessionId: string): Promise<void> {
    await this.storage.remove(this.key(sessionId));
  }
}
