import type { ChatMessage, JsonObject, StorageAdapter } from '../types/index.js';

export interface SessionContext {
  id: string;
  title?: string;
  systemPrompt?: string;
  metadata: JsonObject;
  pinnedMessages: ChatMessage[];
  updatedAt: number;
}

export class ContextManager {
  constructor(private readonly storage: StorageAdapter) {}

  private key(id: string): string {
    return `context:${id}`;
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
}
