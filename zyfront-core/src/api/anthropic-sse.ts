/**
 * Anthropic Messages SSE 帧解析：`text/event-stream` 下 `data: {json}` 行。
 * 仅抽取助手可见的 `content_block_delta` + `text_delta`（忽略 thinking_delta、ping 等）。
 * 核心功能：SSE (Server-Sent Events) 协议的解码器与封装。
 * 关联场景：流式调用时处理底层网络数据流的解析。
 */

/** 从单条流事件对象提取可展示的文本增量，无时返回 null */
function extractTextFromStreamEvent(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  if (o['type'] === 'content_block_delta' && o['delta'] && typeof o['delta'] === 'object') {
    const d = o['delta'] as Record<string, unknown>;
    if (d['type'] === 'text_delta' && typeof d['text'] === 'string') return d['text'];
    return null;
  }

  if (o['type'] === 'message_delta' && o['delta'] && typeof o['delta'] === 'object') {
    const d = o['delta'] as Record<string, unknown>;
    if (typeof d['text'] === 'string') return d['text'];
  }

  return null;
}

/** 解析单行 `data:` 为文本增量 */
export function tryExtractTextDeltaFromSseLine(line: string): string | null {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    return extractTextFromStreamEvent(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
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
  onSseLine: (line: string) => void,
): void {
  buffer.remainder += chunk;
  const parts = buffer.remainder.split('\n');
  buffer.remainder = parts.pop() ?? '';
  for (const line of parts) {
    onSseLine(line);
    const piece = tryExtractTextDeltaFromSseLine(line);
    if (piece) onTextDelta(piece);
  }
}

/** 带行转发的缓冲区冲刷 */
export function flushSseBufferWithLines(
  buffer: SseLineBuffer,
  onTextDelta: (t: string) => void,
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
  }
}
