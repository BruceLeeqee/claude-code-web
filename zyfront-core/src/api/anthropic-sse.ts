/**
 * Anthropic Messages SSE 帧解析：`text/event-stream` 下 `data: {json}` 行。
 * 仅抽取助手可见的 `content_block_delta` + `text_delta`（忽略 thinking_delta、ping 等）。
 * 核心功能：SSE (Server-Sent Events) 协议的解码器与封装。
 * 关联场景：流式调用时处理底层网络数据流的解析。
 */

function parseSsePayload(line: string): Record<string, unknown> | null {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 从单条流事件对象提取可展示的文本增量，无时返回 null */
function extractTextFromStreamEvent(obj: Record<string, unknown>): string | null {
  if (obj['type'] === 'content_block_delta' && obj['delta'] && typeof obj['delta'] === 'object') {
    const d = obj['delta'] as Record<string, unknown>;
    if (d['type'] === 'text_delta' && typeof d['text'] === 'string') return d['text'];
    return null;
  }

  if (obj['type'] === 'message_delta' && obj['delta'] && typeof obj['delta'] === 'object') {
    const d = obj['delta'] as Record<string, unknown>;
    if (typeof d['text'] === 'string') return d['text'];
  }

  return null;
}

function extractThinkingFromStreamEvent(obj: Record<string, unknown>): string | null {
  if (obj['type'] !== 'content_block_delta' || !obj['delta'] || typeof obj['delta'] !== 'object') return null;
  const d = obj['delta'] as Record<string, unknown>;
  if (d['type'] === 'thinking_delta') {
    if (typeof d['thinking'] === 'string') return d['thinking'];
    if (typeof d['text'] === 'string') return d['text'];
    return null;
  }
  // 部分网关/兼容层在 thinking 块上仍带 `thinking` 字段但 type 命名不一致
  if (typeof d['thinking'] === 'string' && d['thinking'].length > 0) return d['thinking'];
  return null;
}

/** 解析单行 `data:` 为文本增量 */
export function tryExtractTextDeltaFromSseLine(line: string): string | null {
  const payload = parseSsePayload(line);
  if (!payload) return null;
  return extractTextFromStreamEvent(payload);
}

/** 解析单行 `data:` 为 thinking 增量 */
export function tryExtractThinkingDeltaFromSseLine(line: string): string | null {
  const payload = parseSsePayload(line);
  if (!payload) return null;
  return extractThinkingFromStreamEvent(payload);
}

/** 未完结的半行缓冲 */
export type SseLineBuffer = { remainder: string };

/** 喂入一块 chunk，按换行切分并回调文本增量 */
export function feedSseChunk(buffer: SseLineBuffer, chunk: string, onTextDelta: (t: string) => void): void {
  buffer.remainder += chunk;
  const parts = buffer.remainder.split('\n');
  buffer.remainder = parts.pop() ?? '';
  for (const line of parts) {
    const piece = tryExtractTextDeltaFromSseLine(line);
    if (piece) onTextDelta(piece);
  }
}

/** 流结束时冲刷 remainder 中剩余行 */
export function flushSseBuffer(buffer: SseLineBuffer, onTextDelta: (t: string) => void): void {
  const tail = buffer.remainder;
  buffer.remainder = '';
  if (!tail.trim()) return;
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    const piece = tryExtractTextDeltaFromSseLine(line);
    if (piece) onTextDelta(piece);
  }
}

/** 同时转发每一完整行给 `onSseLine`（供 tool_use 累计）并派发文本增量 */
export function feedSseChunkWithLines(
  buffer: SseLineBuffer,
  chunk: string,
  onTextDelta: (t: string) => void,
  onThinkingDelta: (t: string) => void,
  onSseLine: (line: string) => void,
): void {
  buffer.remainder += chunk;
  const parts = buffer.remainder.split('\n');
  buffer.remainder = parts.pop() ?? '';
  for (const line of parts) {
    onSseLine(line);
    const piece = tryExtractTextDeltaFromSseLine(line);
    if (piece) onTextDelta(piece);
    const thinking = tryExtractThinkingDeltaFromSseLine(line);
    if (thinking) onThinkingDelta(thinking);
  }
}

/** 带行转发的缓冲区冲刷 */
export function flushSseBufferWithLines(
  buffer: SseLineBuffer,
  onTextDelta: (t: string) => void,
  onThinkingDelta: (t: string) => void,
  onSseLine: (line: string) => void,
): void {
  const tail = buffer.remainder;
  buffer.remainder = '';
  if (!tail.trim()) return;
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    onSseLine(line);
    const piece = tryExtractTextDeltaFromSseLine(line);
    if (piece) onTextDelta(piece);
    const thinking = tryExtractThinkingDeltaFromSseLine(line);
    if (thinking) onThinkingDelta(thinking);
  }
}
