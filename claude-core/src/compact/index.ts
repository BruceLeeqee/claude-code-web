import type { ChatMessage } from '../types/index.js';

export interface CompactStrategy {
  maxMessages: number;
  keepSystemMessages?: boolean;
}

export interface CompactResult {
  kept: ChatMessage[];
  droppedCount: number;
  summary?: string;
}

export class SessionCompactor {
  constructor(private readonly strategy: CompactStrategy) {}

  compact(messages: ChatMessage[]): CompactResult {
    const system = this.strategy.keepSystemMessages ? messages.filter((m) => m.role === 'system') : [];
    const nonSystem = this.strategy.keepSystemMessages ? messages.filter((m) => m.role !== 'system') : messages;

    const keptTail = nonSystem.slice(-this.strategy.maxMessages);
    const kept = [...system, ...keptTail];

    const droppedCount = Math.max(messages.length - kept.length, 0);
    return droppedCount > 0
      ? {
          kept,
          droppedCount,
          summary: `Compacted ${droppedCount} messages`,
        }
      : {
          kept,
          droppedCount,
        };
  }
}
