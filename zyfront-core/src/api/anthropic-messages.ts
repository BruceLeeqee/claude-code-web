/**
 * Anthropic Messages API 与内部 `ChatMessage` 的互转：wire 元数据、工具定义序列化、
 * 非流式 JSON 响应解析、工具结果块构造。
 * 核心功能：定义 Messages API 的核心请求逻辑与类型。
 * 关联场景：非流式调用 client.messages.create() 的底层实现。
 */
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

/** 存在 `ChatMessage.metadata` 中，用于多轮 tool_use / tool_result 精确回放 */
export const ANTHROPIC_WIRE_KEY = 'anthropicWire';

/** API 形状的 user/assistant 消息（content 为块数组或结构化值） */
export type AnthropicWireMessage = { role: 'user' | 'assistant'; content: JsonValue };

/** 读取消息上的 wire 载荷，格式不合法时返回 null */
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

/** 将单条 `ChatMessage` 转为 API `messages[]` 元素（优先使用已存 wire） */
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

/** 将注册的 `AgentTool` 转为 API `tools` 数组（含 input_schema） */
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

/** 从 usage 对象尽力提取 input/output token 数 */
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

/** 解析非流式完整响应 JSON，抽出文本块与 tool_use */
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

  const rawBlocks = content as JsonArray;
  const assistantContentBlocks: JsonArray = [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  let seq = 1;
  for (const block of rawBlocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;

    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      textParts.push(b['text']);
      assistantContentBlocks.push(block as JsonValue);
      continue;
    }

    if (b['type'] === 'tool_use') {
      const rawId = typeof b['id'] === 'string' ? b['id'] : '';
      const id = sanitizeToolUseId(rawId, seq);
      seq += 1;
      const name = typeof b['name'] === 'string' ? b['name'] : '';
      if (!name) continue;
      const input = (b['input'] ?? {}) as JsonValue;

      assistantContentBlocks.push({
        type: 'tool_use',
        id,
        name,
        input,
      } as JsonValue);

      toolCalls.push({
        id,
        toolName: name,
        input,
      });
      continue;
    }

    assistantContentBlocks.push(block as JsonValue);
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

/** 将多次工具执行结果拼成 user 侧 content 块数组 */
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
