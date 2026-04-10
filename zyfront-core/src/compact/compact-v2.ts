import type { ChatMessage } from '../types/index.js';
import { estimateTokens } from '../context/index.js';

export interface CompactV2Policy {
  enabled: boolean;
  maxMessagesBeforeCompact: number;
  compactToMessages: number;
  maxEstimatedTokens: number;
  keepSystemMessages?: boolean;
}

export interface CompactV2Result {
  kept: ChatMessage[];
  droppedCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  reason: 'threshold_not_met' | 'messages' | 'tokens';
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

function summarizeWindow(messages: ChatMessage[]): {
  userGoals: string[];
  assistantFindings: string[];
  openItems: string[];
} {
  const userGoals: string[] = [];
  const assistantFindings: string[] = [];
  const openItems: string[] = [];

  for (const msg of messages) {
    const text = (msg.content ?? '').trim();
    if (!text) continue;
    const short = text.slice(0, 120);

    if (msg.role === 'user' && userGoals.length < 3) {
      userGoals.push(short);
    }
    if (msg.role === 'assistant' && assistantFindings.length < 3) {
      assistantFindings.push(short);
    }

    const lower = text.toLowerCase();
    if (
      openItems.length < 3 &&
      (lower.includes('todo') ||
        lower.includes('待办') ||
        lower.includes('next') ||
        lower.includes('后续') ||
        lower.includes('需要') ||
        lower.includes('fixme'))
    ) {
      openItems.push(short);
    }
  }

  return { userGoals, assistantFindings, openItems };
}

function buildCompactSummary(droppedMessages: ChatMessage[]): ChatMessage {
  const droppedCount = droppedMessages.length;
  const summary = summarizeWindow(droppedMessages);

  const lines: string[] = [
    '已自动压缩上下文（结构化摘要）',
    `- 折叠消息数: ${droppedCount}`,
  ];

  if (summary.userGoals.length > 0) {
    lines.push('- 用户目标:');
    for (const item of summary.userGoals) lines.push(`  - ${item}`);
  }

  if (summary.assistantFindings.length > 0) {
    lines.push('- 已有结论:');
    for (const item of summary.assistantFindings) lines.push(`  - ${item}`);
  }

  if (summary.openItems.length > 0) {
    lines.push('- 未完成事项:');
    for (const item of summary.openItems) lines.push(`  - ${item}`);
  }

  return {
    id: `compact_v2_${Date.now()}`,
    role: 'assistant',
    content: lines.join('\n'),
    timestamp: Date.now(),
    metadata: {
      compactV2: true,
      compactV2DroppedCount: droppedCount,
    },
  };
}

export function compactMessagesV2(messages: ChatMessage[], policy: CompactV2Policy): CompactV2Result {
  const estimatedTokensBefore = estimateMessagesTokens(messages);
  const needByMessages = messages.length >= policy.maxMessagesBeforeCompact;
  const needByTokens = estimatedTokensBefore >= policy.maxEstimatedTokens;

  if (!needByMessages && !needByTokens) {
    return {
      kept: messages,
      droppedCount: 0,
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
      reason: 'threshold_not_met',
    };
  }

  const keepSystem = Boolean(policy.keepSystemMessages);
  const systemMessages = keepSystem ? messages.filter((m) => m.role === 'system') : [];
  const nonSystem = keepSystem ? messages.filter((m) => m.role !== 'system') : messages;

  const compactTo = Math.max(2, policy.compactToMessages);
  const tail = nonSystem.slice(-compactTo);
  const dropped = nonSystem.slice(0, Math.max(nonSystem.length - tail.length, 0));
  const droppedCount = dropped.length;
  const summary = droppedCount > 0 ? [buildCompactSummary(dropped)] : [];

  const kept = [...systemMessages, ...summary, ...tail];
  const estimatedTokensAfter = estimateMessagesTokens(kept);

  return {
    kept,
    droppedCount,
    estimatedTokensBefore,
    estimatedTokensAfter,
    reason: needByTokens ? 'tokens' : 'messages',
  };
}
