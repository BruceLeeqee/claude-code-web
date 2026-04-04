/**
 * 会话消息历史：`HistoryStore` 抽象 + 内存实现与带版本迁移的持久化实现。
 */
import type { ChatMessage, IdGenerator, StorageAdapter } from '../types/index.js';
import type { Migration } from '../migrations/index.js';

/** 按 sessionId 隔离的消息存储契约 */
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

/** 进程内 Map 存储，重启即丢失 */
export class InMemoryHistoryStore implements HistoryStore {
  private readonly map = new Map<string, ChatMessage[]>();

  /** 追加一条消息到会话尾部 */
  async append(sessionId: string, message: ChatMessage): Promise<void> {
    const list = this.map.get(sessionId) ?? [];
    list.push(message);
    this.map.set(sessionId, list);
  }

  /** 返回会话消息列表副本 */
  async list(sessionId: string): Promise<ChatMessage[]> {
    return [...(this.map.get(sessionId) ?? [])];
  }

  /** 按消息 id 合并 patch */
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

  /** 删除指定消息，未找到返回 false */
  async remove(sessionId: string, messageId: string): Promise<boolean> {
    const list = this.map.get(sessionId) ?? [];
    const next = list.filter((m) => m.id !== messageId);
    if (next.length === list.length) return false;
    this.map.set(sessionId, next);
    return true;
  }

  /** 清空该会话全部消息 */
  async clear(sessionId: string): Promise<void> {
    this.map.delete(sessionId);
  }
}

/** 将历史文档 JSON 持久化到 `StorageAdapter`，并在读取时跑迁移链 */
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

  /** 读取存储文档，必要时从 v1 迁移到 v2 并写回 */
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

  /** 保存文档并刷新 updatedAt */
  private async saveDoc(sessionId: string, doc: HistoryDocumentV2): Promise<void> {
    await this.storage.set(this.key(sessionId), {
      ...doc,
      updatedAt: Date.now(),
    });
  }

  /** 追加消息；若 id 为空则用 IdGenerator 生成 */
  async append(sessionId: string, message: ChatMessage): Promise<void> {
    const doc = await this.loadDoc(sessionId);
    doc.messages.push({ ...message, id: message.id || this.ids.next('msg') });
    await this.saveDoc(sessionId, doc);
  }

  /** 列出持久化会话中的全部消息 */
  async list(sessionId: string): Promise<ChatMessage[]> {
    const doc = await this.loadDoc(sessionId);
    return [...doc.messages];
  }

  /** 更新持久化文档中的单条消息 */
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

  /** 从持久化文档删除一条消息 */
  async remove(sessionId: string, messageId: string): Promise<boolean> {
    const doc = await this.loadDoc(sessionId);
    const next = doc.messages.filter((m) => m.id !== messageId);
    if (next.length === doc.messages.length) return false;
    doc.messages = next;
    await this.saveDoc(sessionId, doc);
    return true;
  }

  /** 删除整个会话存储键 */
  async clear(sessionId: string): Promise<void> {
    await this.storage.remove(this.key(sessionId));
  }
}
