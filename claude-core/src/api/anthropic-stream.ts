/**
 * Accumulates one Anthropic Messages API streaming turn (SSE `data:` JSON lines)
 * into assistant content blocks + tool calls, mirroring restored-src's tool_use / tool_result flow.
 */

import type { AnthropicTurnSnapshot, JsonArray, JsonValue, ToolCall, Usage } from '../types/index.js';

type MutableAnthropicTurn = AnthropicTurnSnapshot & { usage?: Usage };

type TextBlock = { kind: 'text'; text: string };
type ToolBlock = { kind: 'tool_use'; id: string; name: string; jsonBuf: string };
type BlockState = TextBlock | ToolBlock;

function roughUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as Record<string, unknown>;
  const input = o['input_tokens'];
  const output = o['output_tokens'];
  if (typeof input !== 'number' || typeof output !== 'number') return undefined;
  return { inputTokens: input, outputTokens: output };
}

export class AnthropicSseTurnAccumulator {
  private readonly blocks = new Map<number, BlockState>();
  private stopReason: string | null = null;
  private usage: Usage | undefined;

  /** Feed one full SSE line (including `data: {...}`). */
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

  finalize(): AnthropicTurnSnapshot {
    const indices = [...this.blocks.keys()].sort((a, b) => a - b);
    const assistantContentBlocks: JsonArray = [];
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const idx of indices) {
      const b = this.blocks.get(idx);
      if (!b) continue;
      if (b.kind === 'text') {
        assistantContentBlocks.push({ type: 'text', text: b.text } as JsonValue);
        if (b.text) textParts.push(b.text);
      } else {
        let input: JsonValue = {};
        try {
          if (b.jsonBuf.trim()) input = JSON.parse(b.jsonBuf) as JsonValue;
        } catch {
          input = {};
        }
        assistantContentBlocks.push({
          type: 'tool_use',
          id: b.id,
          name: b.name,
          input,
        } as JsonValue);
        if (b.id && b.name) {
          toolCalls.push({ id: b.id, toolName: b.name, input });
        }
      }
    }

    const snap: MutableAnthropicTurn = {
      stopReason: this.stopReason,
      assistantText: textParts.join(''),
      assistantContentBlocks,
      toolCalls,
    };
    if (this.usage !== undefined) snap.usage = this.usage;
    return snap;
  }
}
