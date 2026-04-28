/**
 * Anthropic Messages 流式一轮累计器：解析 SSE `data:` JSON 行，
 * 汇总为助手 content 块与 tool_use（与多轮 tool_result 流程对齐）。
 * 核心功能：流式响应的高层封装与事件发射器。
 * 关联场景：开发者直接使用的 client.messages.stream() 方法，其核心实现就在此文件。
 */

import type { AnthropicTurnSnapshot, JsonArray, JsonValue, ToolCall, Usage } from '../types/index.js';

type MutableAnthropicTurn = AnthropicTurnSnapshot & { usage?: Usage };

type TextBlock = { kind: 'text'; text: string };
type ThinkingBlock = { kind: 'thinking'; thinking: string };
type ToolBlock = { kind: 'tool_use'; id: string; name: string; jsonBuf: string };
type BlockState = TextBlock | ThinkingBlock | ToolBlock;

/** 从流内 usage 对象提取 token 数 */
function roughUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as Record<string, unknown>;
  const input = o['input_tokens'];
  const output = o['output_tokens'];
  if (typeof input !== 'number' || typeof output !== 'number') return undefined;
  return { inputTokens: input, outputTokens: output };
}

const SAFE_TOOL_ID_RE = /^[a-z0-9_]+$/;

function randomLowerAlphaNum(len = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)] ?? 'a';
  }
  return out;
}

function sanitizeToolUseId(raw: string | undefined, seq: number): string {
  const base = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (base && SAFE_TOOL_ID_RE.test(base)) return base;
  return `call_${randomLowerAlphaNum(8)}_${seq}`;
}

export class AnthropicSseTurnAccumulator {
  private readonly blocks = new Map<number, BlockState>();
  private stopReason: string | null = null;
  private usage: Usage | undefined;
  private reasoningShadowIdx = -1;

  private findOrCreateThinkingBlockForReasoning(currentIdx: number): number {
    if (this.reasoningShadowIdx >= 0 && this.blocks.has(this.reasoningShadowIdx)) {
      return this.reasoningShadowIdx;
    }
    const shadowIdx = currentIdx + 10000;
    this.blocks.set(shadowIdx, { kind: 'thinking', thinking: '' });
    this.reasoningShadowIdx = shadowIdx;
    return shadowIdx;
  }

  /** 处理一行完整 SSE（含 `data:` 前缀与 JSON 负载） */
  consumeLine(line: string): void {
    const trimmed = line.replace(/\r$/, '').trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let obj: unknown;
    try {
      obj = JSON.parse(payload) as unknown;
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    const t = o['type'];

    if (t === 'content_block_start') {
      const idx = typeof o['index'] === 'number' ? o['index'] : -1;
      const cb = o['content_block'];
      if (idx < 0 || !cb || typeof cb !== 'object') return;
      const c = cb as Record<string, unknown>;
      if (c['type'] === 'text') {
        this.blocks.set(idx, { kind: 'text', text: '' });
      } else if (c['type'] === 'thinking') {
        this.blocks.set(idx, { kind: 'thinking', thinking: '' });
      } else if (c['type'] === 'tool_use') {
        const id = typeof c['id'] === 'string' ? c['id'] : '';
        const name = typeof c['name'] === 'string' ? c['name'] : '';
        this.blocks.set(idx, { kind: 'tool_use', id, name, jsonBuf: '' });
      }
      return;
    }

    if (t === 'content_block_delta') {
      const idx = typeof o['index'] === 'number' ? o['index'] : -1;
      const delta = o['delta'];
      if (idx < 0 || !delta || typeof delta !== 'object') return;
      const d = delta as Record<string, unknown>;
      const b = this.blocks.get(idx);
      if (!b) return;
      if (b.kind === 'text' && d['type'] === 'text_delta' && typeof d['text'] === 'string') {
        b.text += d['text'];
      }
      if (b.kind === 'text' && typeof d['reasoning_content'] === 'string') {
        const thinkingIdx = this.findOrCreateThinkingBlockForReasoning(idx);
        const tb = this.blocks.get(thinkingIdx);
        if (tb && tb.kind === 'thinking') {
          tb.thinking += d['reasoning_content'];
        }
      }
      if (b.kind === 'thinking' && d['type'] === 'thinking_delta' && typeof d['thinking'] === 'string') {
        b.thinking += d['thinking'];
      }
      if (b.kind === 'thinking' && typeof d['reasoning_content'] === 'string') {
        b.thinking += d['reasoning_content'];
      }
      if (b.kind === 'tool_use' && d['type'] === 'input_json_delta' && typeof d['partial_json'] === 'string') {
        b.jsonBuf += d['partial_json'];
      }
      return;
    }

    if (t === 'message_delta') {
      const delta = o['delta'];
      if (!delta || typeof delta !== 'object') return;
      const d = delta as Record<string, unknown>;
      if (typeof d['stop_reason'] === 'string') this.stopReason = d['stop_reason'];
      const u = d['usage'];
      const mapped = roughUsage(u);
      if (mapped) this.usage = mapped;
      return;
    }
  }

  /** 按 index 排序块，合并文本、解析 tool JSON，生成 `AnthropicTurnSnapshot` */
  finalize(): AnthropicTurnSnapshot {
    const indices = [...this.blocks.keys()].sort((a, b) => a - b);
    const assistantContentBlocks: JsonArray = [];
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    let reasoningContent = '';

    let seq = 1;
    for (const idx of indices) {
      const b = this.blocks.get(idx);
      if (!b) continue;
      if (b.kind === 'text') {
        assistantContentBlocks.push({ type: 'text', text: b.text } as JsonValue);
        if (b.text) textParts.push(b.text);
      } else if (b.kind === 'thinking') {
        assistantContentBlocks.push({ type: 'thinking', thinking: b.thinking } as JsonValue);
        if (b.thinking) reasoningContent += b.thinking;
      } else {
        let input: JsonValue = {};
        try {
          if (b.jsonBuf.trim()) input = JSON.parse(b.jsonBuf) as JsonValue;
        } catch {
          input = {};
        }

        if (!b.name) continue;
        const safeId = sanitizeToolUseId(b.id, seq);
        seq += 1;

        assistantContentBlocks.push({
          type: 'tool_use',
          id: safeId,
          name: b.name,
          input,
        } as JsonValue);

        toolCalls.push({ id: safeId, toolName: b.name, input });
      }
    }

    const snap: MutableAnthropicTurn = {
      stopReason: this.stopReason,
      assistantText: textParts.join(''),
      assistantContentBlocks,
      toolCalls,
    };
    if (this.usage !== undefined) snap.usage = this.usage;
    if (reasoningContent) snap.reasoningContent = reasoningContent;
    return snap;
  }
}
