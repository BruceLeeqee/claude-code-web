/**
 * Anthropic Messages API streams `text/event-stream` frames with `data: {json}` lines.
 * We only surface assistant-visible text from `content_block_delta` + `text_delta` (skip thinking_delta, ping, etc.).
 */

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

export type SseLineBuffer = { remainder: string };

export function feedSseChunk(buffer: SseLineBuffer, chunk: string, onTextDelta: (t: string) => void): void {
  buffer.remainder += chunk;
  const parts = buffer.remainder.split('\n');
  buffer.remainder = parts.pop() ?? '';
  for (const line of parts) {
    const piece = tryExtractTextDeltaFromSseLine(line);
    if (piece) onTextDelta(piece);
  }
}

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

/** Emit text deltas and forward every SSE line to `onSseLine` (for tool_use accumulation). */
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
