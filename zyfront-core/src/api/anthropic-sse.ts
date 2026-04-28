/**
 * Anthropic Messages SSE 帧解析：`text/event-stream` 下 `data: {json}` 行。
 * 抽取助手可见的 `content_block_delta` + `text_delta` 与 `thinking_delta`。
 * 支持 MiniMax <think1> 标签流式分段解析、DeepSeek reasoning_content、
 * 以及多轮思考多轮回答场景下的 thinking_start/thinking_done 边界事件。
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
  if (obj['type'] === 'content_block_delta' && obj['delta'] && typeof obj['delta'] === 'object') {
    const d = obj['delta'] as Record<string, unknown>;
    if (d['type'] === 'thinking_delta') {
      if (typeof d['thinking'] === 'string') return d['thinking'];
      if (typeof d['text'] === 'string') return d['text'];
      return null;
    }
    if (typeof d['thinking'] === 'string' && d['thinking'].length > 0) return d['thinking'];
    if (typeof d['reasoning_content'] === 'string' && d['reasoning_content'].length > 0) return d['reasoning_content'];
    if (typeof d['reasoning_details'] === 'string' && d['reasoning_details'].length > 0) return d['reasoning_details'];
    if (Array.isArray(d['reasoning_details']) && d['reasoning_details'].length > 0) {
      const details = d['reasoning_details'] as Array<Record<string, unknown>>;
      const textParts: string[] = [];
      for (const detail of details) {
        if (typeof detail['text'] === 'string') textParts.push(detail['text']);
      }
      if (textParts.length > 0) return textParts.join('');
    }
  }
  if (obj['type'] === 'reasoning_content' && typeof obj['content'] === 'string') {
    return obj['content'];
  }
  if (obj['type'] === 'reasoning_details' && typeof obj['content'] === 'string') {
    return obj['content'];
  }
  if (typeof obj['reasoning_content'] === 'string' && obj['reasoning_content'].length > 0) {
    return obj['reasoning_content'];
  }
  if (typeof obj['reasoning_details'] === 'string' && obj['reasoning_details'].length > 0) {
    return obj['reasoning_details'];
  }
  if (Array.isArray(obj['reasoning_details']) && obj['reasoning_details'].length > 0) {
    const details = obj['reasoning_details'] as Array<Record<string, unknown>>;
    const textParts: string[] = [];
    for (const detail of details) {
      if (typeof detail['text'] === 'string') textParts.push(detail['text']);
    }
    if (textParts.length > 0) return textParts.join('');
  }
  if (obj['type'] === 'message_delta' && obj['delta'] && typeof obj['delta'] === 'object') {
    const d = obj['delta'] as Record<string, unknown>;
    if (typeof d['reasoning_content'] === 'string' && d['reasoning_content'].length > 0) {
      return d['reasoning_content'];
    }
    if (typeof d['reasoning_details'] === 'string' && d['reasoning_details'].length > 0) {
      return d['reasoning_details'];
    }
    if (Array.isArray(d['reasoning_details']) && d['reasoning_details'].length > 0) {
      const details = d['reasoning_details'] as Array<Record<string, unknown>>;
      const textParts: string[] = [];
      for (const detail of details) {
        if (typeof detail['text'] === 'string') textParts.push(detail['text']);
      }
      if (textParts.length > 0) return textParts.join('');
    }
  }
  if (obj['choices'] && Array.isArray(obj['choices']) && obj['choices'].length > 0) {
    const choice = obj['choices'][0] as Record<string, unknown>;
    if (choice && typeof choice === 'object' && choice['delta'] && typeof choice['delta'] === 'object') {
      const delta = choice['delta'] as Record<string, unknown>;
      if (typeof delta['reasoning_content'] === 'string' && delta['reasoning_content'].length > 0) {
        return delta['reasoning_content'];
      }
      if (typeof delta['reasoning_details'] === 'string' && delta['reasoning_details'].length > 0) {
        return delta['reasoning_details'];
      }
      if (Array.isArray(delta['reasoning_details']) && delta['reasoning_details'].length > 0) {
        const details = delta['reasoning_details'] as Array<Record<string, unknown>>;
        const textParts: string[] = [];
        for (const detail of details) {
          if (typeof detail['text'] === 'string') textParts.push(detail['text']);
        }
        if (textParts.length > 0) return textParts.join('');
      }
    }
  }
  return null;
}

export type ThinkingBlockBoundary = 'thinking_start' | 'thinking_done';

export interface ThinkingBoundaryEvent {
  type: ThinkingBlockBoundary;
  blockIndex: number;
}

export class ThinkingTagTracker {
  private inThink = false;
  private inResult = false;
  private pendingTag = '';
  private blockIndex = 0;

  feed(text: string): { thinking: string; answer: string; boundaries: ThinkingBoundaryEvent[] } {
    let thinking = '';
    let answer = '';
    const boundaries: ThinkingBoundaryEvent[] = [];
    const combined = this.pendingTag + text;
    this.pendingTag = '';

    let i = 0;
    while (i < combined.length) {
      if (this.inThink) {
        const closeIdx = combined.indexOf('</think1>', i);
        if (closeIdx === -1) {
          const tailLen = combined.length - i;
          if (tailLen < '</think1>'.length) {
            this.pendingTag = combined.slice(i);
          } else {
            thinking += combined.slice(i);
          }
          break;
        }
        thinking += combined.slice(i, closeIdx);
        i = closeIdx + '</think1>'.length;
        this.inThink = false;
        boundaries.push({ type: 'thinking_done', blockIndex: this.blockIndex });
        this.blockIndex++;
      } else if (this.inResult) {
        const closeIdx = combined.indexOf('</result>', i);
        if (closeIdx === -1) {
          const tailLen = combined.length - i;
          if (tailLen < '</result>'.length) {
            this.pendingTag = combined.slice(i);
          } else {
            answer += combined.slice(i);
          }
          break;
        }
        answer += combined.slice(i, closeIdx);
        i = closeIdx + '</result>'.length;
        this.inResult = false;
      } else {
        const thinkOpenIdx = combined.indexOf('<think1>', i);
        const resultOpenIdx = combined.indexOf('<result>', i);

        let nextTagIdx = -1;
        let nextTag: 'think' | 'result' | null = null;

        if (thinkOpenIdx !== -1 && (resultOpenIdx === -1 || thinkOpenIdx <= resultOpenIdx)) {
          nextTagIdx = thinkOpenIdx;
          nextTag = 'think';
        } else if (resultOpenIdx !== -1) {
          nextTagIdx = resultOpenIdx;
          nextTag = 'result';
        }

        if (nextTagIdx === -1) {
          const remaining = combined.slice(i);
          const thinkPartial = remaining.lastIndexOf('<');
          if (thinkPartial !== -1 && combined.length - i - thinkPartial < 10) {
            const tail = combined.slice(i + thinkPartial);
            if (couldBePartialTag(tail)) {
              answer += combined.slice(i, i + thinkPartial);
              this.pendingTag = tail;
              break;
            }
          }
          answer += remaining;
          break;
        }

        if (nextTagIdx > i) {
          answer += combined.slice(i, nextTagIdx);
        }

        if (nextTag === 'think') {
          this.inThink = true;
          boundaries.push({ type: 'thinking_start', blockIndex: this.blockIndex });
          i = nextTagIdx + '<think1>'.length;
        } else {
          this.inResult = true;
          i = nextTagIdx + '<result>'.length;
        }
      }
    }

    return { thinking, answer, boundaries };
  }

  flush(): { thinking: string; answer: string; boundaries: ThinkingBoundaryEvent[] } {
    const result: { thinking: string; answer: string; boundaries: ThinkingBoundaryEvent[] } = {
      thinking: '',
      answer: '',
      boundaries: [],
    };
    if (this.pendingTag) {
      if (this.inThink) {
        result.thinking = this.pendingTag;
        result.boundaries.push({ type: 'thinking_done', blockIndex: this.blockIndex });
        this.blockIndex++;
      } else if (this.inResult) {
        result.answer = this.pendingTag;
      } else {
        result.answer = this.pendingTag;
      }
      this.pendingTag = '';
    }
    if (this.inThink) {
      result.boundaries.push({ type: 'thinking_done', blockIndex: this.blockIndex });
      this.blockIndex++;
      this.inThink = false;
    }
    if (this.inResult) {
      this.inResult = false;
    }
    return result;
  }

  reset(): void {
    this.inThink = false;
    this.inResult = false;
    this.pendingTag = '';
    this.blockIndex = 0;
  }

  isInThinking(): boolean {
    return this.inThink;
  }
}

function couldBePartialTag(tail: string): boolean {
  const lower = tail.toLowerCase();
  return (
    lower.startsWith('<') &&
    (lower.length < '<think1>'.length + 2)
  );
}

function detectThinkingBlockBoundary(obj: Record<string, unknown>): ThinkingBoundaryEvent | null {
  const t = obj['type'];
  if (t === 'content_block_start') {
    const cb = obj['content_block'];
    if (cb && typeof cb === 'object') {
      const c = cb as Record<string, unknown>;
      if (c['type'] === 'thinking') {
        const idx = typeof obj['index'] === 'number' ? obj['index'] : 0;
        return { type: 'thinking_start', blockIndex: idx };
      }
    }
  }
  if (t === 'content_block_stop') {
    const idx = typeof obj['index'] === 'number' ? obj['index'] : 0;
    return { type: 'thinking_done', blockIndex: idx };
  }
  return null;
}

export function tryExtractTextDeltaFromSseLine(line: string): string | null {
  const payload = parseSsePayload(line);
  if (!payload) return null;
  return extractTextFromStreamEvent(payload);
}

export function tryExtractThinkingDeltaFromSseLine(line: string): string | null {
  const payload = parseSsePayload(line);
  if (!payload) return null;
  return extractThinkingFromStreamEvent(payload);
}

export function tryExtractThinkingBoundaryFromSseLine(line: string): ThinkingBoundaryEvent | null {
  const payload = parseSsePayload(line);
  if (!payload) return null;
  return detectThinkingBlockBoundary(payload);
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

export interface SseStreamCallbacks {
  onTextDelta: (t: string) => void;
  onThinkingDelta: (t: string) => void;
  onThinkingBoundary: (e: ThinkingBoundaryEvent) => void;
  onSseLine: (line: string) => void;
}

export function feedSseChunkWithLines(
  buffer: SseLineBuffer,
  chunk: string,
  onTextDelta: (t: string) => void,
  onThinkingDelta: (t: string) => void,
  onSseLine: (line: string) => void,
): void {
  feedSseChunkWithLinesExtended(buffer, chunk, {
    onTextDelta,
    onThinkingDelta,
    onThinkingBoundary: () => {},
    onSseLine,
  });
}

export function feedSseChunkWithLinesExtended(
  buffer: SseLineBuffer,
  chunk: string,
  callbacks: SseStreamCallbacks,
): void {
  buffer.remainder += chunk;
  const parts = buffer.remainder.split('\n');
  buffer.remainder = parts.pop() ?? '';
  for (const line of parts) {
    callbacks.onSseLine(line);

    const boundary = tryExtractThinkingBoundaryFromSseLine(line);
    if (boundary) {
      callbacks.onThinkingBoundary(boundary);
    }

    const thinking = tryExtractThinkingDeltaFromSseLine(line);
    if (thinking) callbacks.onThinkingDelta(thinking);

    const piece = tryExtractTextDeltaFromSseLine(line);
    if (piece) {
      callbacks.onTextDelta(piece);
    }
  }
}

export function flushSseBufferWithLines(
  buffer: SseLineBuffer,
  onTextDelta: (t: string) => void,
  onThinkingDelta: (t: string) => void,
  onSseLine: (line: string) => void,
): void {
  flushSseBufferWithLinesExtended(buffer, {
    onTextDelta,
    onThinkingDelta,
    onThinkingBoundary: () => {},
    onSseLine,
  });
}

export function flushSseBufferWithLinesExtended(
  buffer: SseLineBuffer,
  callbacks: SseStreamCallbacks,
): void {
  const tail = buffer.remainder;
  buffer.remainder = '';
  if (!tail.trim()) return;
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    callbacks.onSseLine(line);

    const boundary = tryExtractThinkingBoundaryFromSseLine(line);
    if (boundary) {
      callbacks.onThinkingBoundary(boundary);
    }

    const thinking = tryExtractThinkingDeltaFromSseLine(line);
    if (thinking) callbacks.onThinkingDelta(thinking);

    const piece = tryExtractTextDeltaFromSseLine(line);
    if (piece) {
      callbacks.onTextDelta(piece);
    }
  }
}
