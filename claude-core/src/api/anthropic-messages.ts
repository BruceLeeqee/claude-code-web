import type {
  AnthropicTurnSnapshot,
  ChatMessage,
  JsonArray,
  JsonObject,
  JsonValue,
  ToolCall,
  Usage,
} from '../types/index.js';
import type { AgentTool } from '../tools/Tool.js';

/** Stored on `ChatMessage.metadata` for exact Anthropic replay (tool_use / tool_result rounds). */
export const ANTHROPIC_WIRE_KEY = 'anthropicWire';

export type AnthropicWireMessage = { role: 'user' | 'assistant'; content: JsonValue };

export function getAnthropicWire(msg: ChatMessage): AnthropicWireMessage | null {
  const w = msg.metadata?.[ANTHROPIC_WIRE_KEY];
  if (!w || typeof w !== 'object') return null;
  const o = w as Record<string, unknown>;
  const role = o['role'];
  const content = o['content'];
  if (role !== 'user' && role !== 'assistant') return null;
  if (content === undefined) return null;
  return { role, content: content as JsonValue };
}

export function toAnthropicApiMessage(msg: ChatMessage): { role: string; content: JsonValue } {
  const wire = getAnthropicWire(msg);
  if (wire) {
    return { role: wire.role, content: wire.content };
  }
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: msg.content
        ? ([{ type: 'text', text: msg.content }] as JsonArray)
        : ([{ type: 'text', text: '' }] as JsonArray),
    };
  }
  const r = msg.role === 'assistant' ? 'assistant' : 'user';
  return {
    role: r,
    content: [{ type: 'text', text: msg.content }] as JsonArray,
  };
}

export function toolsFromAgentTools(tools: AgentTool[]): JsonArray {
  const out: JsonArray = [];
  for (const t of tools) {
    if (t.enabled === false) continue;
    const schema =
      t.inputSchema ??
      ({
        type: 'object',
        properties: {
          input: { type: 'string', description: 'JSON-encoded arguments object for this tool' },
        },
      } as JsonObject);
    out.push({
      name: t.name,
      description: t.description,
      input_schema: schema,
    } as JsonValue);
  }
  return out;
}

function roughUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as Record<string, unknown>;
  const input = o['input_tokens'];
  const output = o['output_tokens'];
  if (typeof input !== 'number' || typeof output !== 'number') return undefined;
  return { inputTokens: input, outputTokens: output };
}

export function parseAnthropicMessageJson(raw: unknown): AnthropicTurnSnapshot {
  const empty: AnthropicTurnSnapshot = {
    stopReason: null,
    assistantText: '',
    assistantContentBlocks: [],
    toolCalls: [],
  };
  if (!raw || typeof raw !== 'object') return empty;
  const o = raw as Record<string, unknown>;
  const content = o['content'];
  if (!Array.isArray(content)) return empty;

  const assistantContentBlocks = content as JsonArray;
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      textParts.push(b['text']);
    }
    if (b['type'] === 'tool_use') {
      const id = typeof b['id'] === 'string' ? b['id'] : '';
      const name = typeof b['name'] === 'string' ? b['name'] : '';
      if (!id || !name) continue;
      toolCalls.push({
        id,
        toolName: name,
        input: (b['input'] ?? {}) as JsonValue,
      });
    }
  }

  const stopReason = typeof o['stop_reason'] === 'string' ? o['stop_reason'] : null;
  const usage = roughUsage(o['usage']);

  const snap: AnthropicTurnSnapshot = {
    stopReason,
    assistantText: textParts.join(''),
    assistantContentBlocks,
    toolCalls,
  };
  if (usage !== undefined) snap.usage = usage;
  return snap;
}

export function toolResultBlocks(results: Array<{ toolCallId: string; ok: boolean; output: JsonValue; error?: string }>): JsonArray {
  return results.map((r) => {
    const payload = r.ok ? r.output : { error: r.error ?? 'Tool failed' };
    return {
      type: 'tool_result',
      tool_use_id: r.toolCallId,
      content: typeof payload === 'string' ? payload : JSON.stringify(payload),
    } as JsonValue;
  }) as JsonArray;
}
