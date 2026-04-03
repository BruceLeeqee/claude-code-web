import type { ChatMessage, JsonObject, StorageAdapter } from '../types/index.js';

export interface SessionContext {
  id: string;
  title?: string;
  systemPrompt?: string;
  metadata: JsonObject;
  pinnedMessages: ChatMessage[];
  updatedAt: number;
}

export interface ContextWindow {
  messages: ChatMessage[];
  estimatedTokens: number;
}

export interface ContextQuery {
  role?: ChatMessage['role'];
  search?: string;
  limit?: number;
}

export class ContextManager {
  constructor(private readonly storage: StorageAdapter) {}

  private key(id: string): string {
    return `context:${id}`;
  }

  private messagesKey(id: string): string {
    return `context:${id}:messages`;
  }

  async load(id: string): Promise<SessionContext | null> {
    return this.storage.get<SessionContext>(this.key(id));
  }

  async save(context: SessionContext): Promise<void> {
    await this.storage.set(this.key(context.id), {
      ...context,
      updatedAt: Date.now(),
    });
  }

  async patch(id: string, patch: Partial<SessionContext>): Promise<SessionContext | null> {
    const existing = await this.load(id);
    if (!existing) return null;

    const next: SessionContext = {
      ...existing,
      ...patch,
      id,
      updatedAt: Date.now(),
      metadata: {
        ...existing.metadata,
        ...(patch.metadata ?? {}),
      },
      pinnedMessages: patch.pinnedMessages ?? existing.pinnedMessages,
    };

    await this.save(next);
    return next;
  }

  async addMessage(contextId: string, message: ChatMessage): Promise<void> {
    const messages = (await this.storage.get<ChatMessage[]>(this.messagesKey(contextId))) ?? [];
    messages.push(message);
    await this.storage.set(this.messagesKey(contextId), messages);
  }

  async updateMessage(contextId: string, messageId: string, patch: Partial<ChatMessage>): Promise<ChatMessage | null> {
    const messages = (await this.storage.get<ChatMessage[]>(this.messagesKey(contextId))) ?? [];
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) return null;

    const current = messages[index];
    if (!current) return null;

    const next: ChatMessage = {
      ...current,
      ...patch,
      id: current.id,
      role: patch.role ?? current.role,
      content: patch.content ?? current.content,
      timestamp: patch.timestamp ?? current.timestamp,
    };
    messages[index] = next;
    await this.storage.set(this.messagesKey(contextId), messages);
    return next;
  }

  async removeMessage(contextId: string, messageId: string): Promise<boolean> {
    const messages = (await this.storage.get<ChatMessage[]>(this.messagesKey(contextId))) ?? [];
    const next = messages.filter((m) => m.id !== messageId);
    if (next.length === messages.length) return false;
    await this.storage.set(this.messagesKey(contextId), next);
    return true;
  }

  async queryMessages(contextId: string, query: ContextQuery = {}): Promise<ChatMessage[]> {
    const messages = (await this.storage.get<ChatMessage[]>(this.messagesKey(contextId))) ?? [];
    let filtered = messages;

    if (query.role) filtered = filtered.filter((m) => m.role === query.role);
    if (query.search) {
      const needle = query.search.toLowerCase();
      filtered = filtered.filter((m) => m.content.toLowerCase().includes(needle));
    }

    const limit = query.limit ?? filtered.length;
    return filtered.slice(-limit);
  }

  async buildWindow(contextId: string, maxTokens: number): Promise<ContextWindow> {
    const messages = (await this.storage.get<ChatMessage[]>(this.messagesKey(contextId))) ?? [];
    const kept: ChatMessage[] = [];
    let tokens = 0;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (!msg) continue;
      const msgTokens = estimateTokens(msg.content);
      if (tokens + msgTokens > maxTokens) break;
      kept.unshift(msg);
      tokens += msgTokens;
    }

    return {
      messages: kept,
      estimatedTokens: tokens,
    };
  }
}

export function estimateTokens(text: string): number {
  const cjkFactor = /[\u4E00-\u9FFF]/.test(text) ? 0.65 : 0.25;
  return Math.max(1, Math.ceil(text.length * cjkFactor));
}
