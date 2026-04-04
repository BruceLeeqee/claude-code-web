/**
 * 会话压缩：按条数截断历史，可选保留 system；支持基于阈值的自动压缩策略。
 */
import type { ChatMessage } from '../types/index.js';

/** 截断策略：最多保留非 system 消息条数 */
export interface CompactStrategy {
  maxMessages: number;
  keepSystemMessages?: boolean;
}

/** 压缩结果：保留列表与丢弃条数 */
export interface CompactResult {
  kept: ChatMessage[];
  droppedCount: number;
  summary?: string;
}

/** 当消息数超过 max 时自动压到 compactTo 条 */
export interface AutoCompactPolicy {
  enabled: boolean;
  maxMessagesBeforeCompact: number;
  compactToMessages: number;
}

/** 按策略对消息数组做截断 */
export class SessionCompactor {
  constructor(private readonly strategy: CompactStrategy) {}

  /** 保留尾部 maxMessages 条（及可选的全部 system） */
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

  /** 未达阈值或未启用时返回 null */
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
