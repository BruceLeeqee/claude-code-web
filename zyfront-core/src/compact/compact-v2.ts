import type { ChatMessage, JsonArray } from '../types/index.js';
import { getAnthropicWire } from '../api/anthropic-messages.js';
import { estimateTokens } from '../context/index.js';

function wireContentArray(msg: ChatMessage): JsonArray | null {
  const wire = getAnthropicWire(msg);
  if (!wire) return null;
  return Array.isArray(wire.content) ? (wire.content as JsonArray) : null;
}

function assistantToolUseIds(msg: ChatMessage): string[] {
  const wire = getAnthropicWire(msg);
  if (!wire || wire.role !== 'assistant') return [];
  const arr = Array.isArray(wire.content) ? (wire.content as JsonArray) : [];
  const ids: string[] = [];
  for (const block of arr) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'tool_use' && typeof b['id'] === 'string') ids.push(b['id']);
  }
  return ids;
}

function userToolResultIds(msg: ChatMessage): string[] {
  const wire = getAnthropicWire(msg);
  if (!wire || wire.role !== 'user') return [];
  const arr = Array.isArray(wire.content) ? (wire.content as JsonArray) : [];
  const ids: string[] = [];
  for (const block of arr) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'tool_result' && typeof b['tool_use_id'] === 'string') ids.push(b['tool_use_id']);
  }
  return ids;
}

/** wire 为 user 且仅含 tool_result 块（与 assistant 中 tool_use 配对） */
function userHasOnlyToolResults(msg: ChatMessage): boolean {
  const wire = getAnthropicWire(msg);
  if (!wire || wire.role !== 'user') return false;
  const arr = Array.isArray(wire.content) ? (wire.content as JsonArray) : [];
  if (arr.length === 0) return false;
  for (const block of arr) {
    if (!block || typeof block !== 'object') return false;
    const b = block as Record<string, unknown>;
    if (b['type'] !== 'tool_result') return false;
  }
  return true;
}

/**
 * Anthropic / MiniMax 兼容：assistant(tool_use) 必须紧邻 user(tool_result)；
 * 摘要不可用 assistant（否则与尾部 assistant 连续两条 assistant）。
 */
function isValidAnthropicSequence(msgs: ChatMessage[]): boolean {
  if (msgs.length === 0) return false;

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!;
    const prev = i > 0 ? msgs[i - 1]! : undefined;

    if (prev && m.role === 'assistant' && prev.role === 'assistant') return false;

    if (prev && m.role === 'user' && prev.role === 'user') {
      const prevTr = userHasOnlyToolResults(prev);
      const currTr = userHasOnlyToolResults(m);
      if (!prevTr && !currTr) return false;
      if (!prevTr && currTr) return false;
      if (prevTr && currTr) return false;
    }

    const tUse = m.role === 'assistant' ? assistantToolUseIds(m) : [];
    const tRes =
      m.role === 'user' && userHasOnlyToolResults(m) ? userToolResultIds(m) : [];

    if (tRes.length > 0) {
      if (!prev || prev.role !== 'assistant') return false;
      const prevIds = assistantToolUseIds(prev);
      const ps = new Set(prevIds);
      if (ps.size === 0) return false;
      if (tRes.length !== ps.size) return false;
      for (const id of tRes) if (!ps.has(id)) return false;
    }

    if (tUse.length > 0) {
      const next = msgs[i + 1]!;
      if (!next || next.role !== 'user' || !userHasOnlyToolResults(next)) return false;
      const nextIds = userToolResultIds(next);
      if (nextIds.length !== tUse.length) return false;
      const ts = new Set(tUse);
      for (const id of nextIds) if (!ts.has(id)) return false;
    }
  }
  return true;
}

/** 从左裁掉最短前缀，使剩余序列满足 Anthropic 工具轮次与角色交替 */
function trimLeftUntilAnthropicValid(rest: ChatMessage[]): ChatMessage[] {
  for (let start = 0; start < rest.length; start++) {
    const slice = rest.slice(start);
    if (slice.length > 0 && isValidAnthropicSequence(slice)) return slice;
  }
  return stripToolWireMessagesForCompat(rest);
}

/**
 * 去掉所有带 tool_use / tool_result 的 wire 消息，保证请求可发（压缩截断时的最后手段）。
 */
function stripToolWireMessagesForCompat(rest: ChatMessage[]): ChatMessage[] {
  return rest.filter((m) => {
    if (m.role === 'user' && userHasOnlyToolResults(m)) return false;
    if (m.role === 'assistant' && assistantToolUseIds(m).length > 0) return false;
    return true;
  });
}

export function sanitizeCompactedMessagesForApi(messages: ChatMessage[]): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const trimmed = trimLeftUntilAnthropicValid(rest);
  return [...system, ...trimmed];
}

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
    /** user：避免与保留尾部的 assistant 连续两条 assistant，MiniMax/Anthropic 会拒请求 */
    role: 'user',
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

  const keptRaw = [...systemMessages, ...summary, ...tail];
  const kept = sanitizeCompactedMessagesForApi(keptRaw);
  const estimatedTokensAfter = estimateMessagesTokens(kept);

  return {
    kept,
    droppedCount,
    estimatedTokensBefore,
    estimatedTokensAfter,
    reason: needByTokens ? 'tokens' : 'messages',
  };
}
