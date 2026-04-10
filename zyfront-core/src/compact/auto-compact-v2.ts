import type { ChatMessage } from '../types/index.js';
import { compactMessagesV2, type CompactV2Policy, type CompactV2Result } from './compact-v2.js';

export interface AutoCompactV2Input {
  messages: ChatMessage[];
  policy?: Partial<CompactV2Policy>;
}

export interface AutoCompactV2Output {
  compacted: boolean;
  result: CompactV2Result;
}

const DEFAULT_POLICY: CompactV2Policy = {
  enabled: true,
  maxMessagesBeforeCompact: 50,
  compactToMessages: 20,
  maxEstimatedTokens: 24_000,
  keepSystemMessages: true,
};

export function autoCompactIfNeededV2(input: AutoCompactV2Input): AutoCompactV2Output {
  const merged: CompactV2Policy = {
    ...DEFAULT_POLICY,
    ...(input.policy ?? {}),
  };

  if (!merged.enabled) {
    const result = compactMessagesV2(input.messages, {
      ...merged,
      maxMessagesBeforeCompact: Number.MAX_SAFE_INTEGER,
      maxEstimatedTokens: Number.MAX_SAFE_INTEGER,
    });
    return { compacted: false, result };
  }

  const result = compactMessagesV2(input.messages, merged);
  return {
    compacted: result.reason !== 'threshold_not_met',
    result,
  };
}
