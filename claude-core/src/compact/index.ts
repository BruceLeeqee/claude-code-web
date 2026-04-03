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

export interface AutoCompactPolicy {
  enabled: boolean;
  maxMessagesBeforeCompact: number;
  compactToMessages: number;
}

export class SessionCompactor {
  constructor(private readonly strategy: CompactStrategy) {}

  compact(messages: ChatMessage[]): CompactResult {
    const system = this.strategy.keepSystemMessages ? messages.filter((m) => m.role === 'system') : [];
    const nonSystem = this.strategy.keepSystemMessages ? messages.filter((m) => m.role !== 'system') : messages;
    const keptTail = nonSystem.slice(-this.strategy.maxMessages);
    const kept = [...system, ...keptTail];
    const droppedCount = Math.max(messages.length - kept.length, 0);

    if (droppedCount === 0) {
      return { kept, droppedCount };
    }

    return {
      kept,
      droppedCount,
      summary: `Compacted ${droppedCount} messages`,
    };
  }

  autoCompact(messages: ChatMessage[], policy: AutoCompactPolicy): CompactResult | null {
    if (!policy.enabled) return null;
    if (messages.length < policy.maxMessagesBeforeCompact) return null;

    const temp = new SessionCompactor({
      ...this.strategy,
      maxMessages: policy.compactToMessages,
    });

    return temp.compact(messages);
  }
}
