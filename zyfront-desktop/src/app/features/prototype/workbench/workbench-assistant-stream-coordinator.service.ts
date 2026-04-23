import { Injectable, inject } from '@angular/core';
import { WorkbenchModeService } from '../../../core/multi-agent/services/workbench-mode.service';
import { ModelUsageLedgerService } from '../../../core/model-usage-ledger.service';
import type { StreamChunk } from 'zyfront-core';

export interface StreamRenderContext {
  showThinking: boolean;
  layoutSplitThinkingAnswer: boolean;
  showToolActivity: boolean;
}

export interface StreamRenderState {
  thinkingBuffer: string;
  thinkingPrintedLen: number;
  thinkingHasNonChinese: boolean;
  thinkingHeaderShown: boolean;
  answerHeaderShown: boolean;
  streamRouteDeltaToThinking: boolean;
  streamRequestStartMs: number;
}

export interface StreamRenderCallbacks {
  write: (text: string) => void;
  budget: (text: string) => void;
  ensureMarker: () => void;
  onThinkingBlockStart: (blockId: number) => void;
  onToolMemory: (text: string) => void;
  onToolStart: (name: string) => void;
  onToolDone: (ok: boolean, error?: string) => void;
  onAnswerText: (text: string) => void;
}

@Injectable({ providedIn: 'root' })
export class WorkbenchAssistantStreamCoordinatorService {
  private readonly modeService = inject(WorkbenchModeService);
  private readonly usageLedger = inject(ModelUsageLedgerService);

  appendThinkingDelta(
    state: StreamRenderState,
    ctx: StreamRenderContext,
    textDelta: string,
    cb: StreamRenderCallbacks,
    nextThinkingBlockId: () => number,
    sanitizeThinkingForDisplay: (text: string) => string,
    highlightThinkingSteps: (text: string) => string,
  ): StreamRenderState {
    if (!ctx.showThinking) return state;
    const next = { ...state };
    next.thinkingBuffer += textDelta;
    if (/[A-Za-z]{3,}/.test(textDelta)) next.thinkingHasNonChinese = true;

    if (!next.thinkingHeaderShown) {
      const id = nextThinkingBlockId();
      cb.onThinkingBlockStart(id);
      next.thinkingHeaderShown = true;
      cb.ensureMarker();
    }

    const rest = next.thinkingBuffer.slice(next.thinkingPrintedLen);
    if (rest) {
      const visible = next.thinkingHasNonChinese ? sanitizeThinkingForDisplay(rest) : rest;
      const out = highlightThinkingSteps(visible);
      cb.write(out);
      cb.budget(out);
      next.thinkingPrintedLen = next.thinkingBuffer.length;
    }

    return next;
  }

  handleChunk(
    state: StreamRenderState,
    ctx: StreamRenderContext,
    value: StreamChunk,
    cb: StreamRenderCallbacks,
    nextThinkingBlockId: () => number,
    sanitizeThinkingForDisplay: (text: string) => string,
    highlightThinkingSteps: (text: string) => string,
    getModel: () => string,
  ): StreamRenderState {
    const next = { ...state };

    if (value.type === 'delta') {
      const routeThinking = ctx.showThinking && ctx.layoutSplitThinkingAnswer && next.streamRouteDeltaToThinking;
      if (routeThinking) {
        return this.appendThinkingDelta(next, ctx, value.textDelta, cb, nextThinkingBlockId, sanitizeThinkingForDisplay, highlightThinkingSteps);
      }
      cb.onAnswerText(value.textDelta);
      return next;
    }

    if (value.type === 'thinking_delta') {
      if (!ctx.showThinking) return next;
      return this.appendThinkingDelta(next, ctx, value.textDelta, cb, nextThinkingBlockId, sanitizeThinkingForDisplay, highlightThinkingSteps);
    }

    if (value.type === 'tool_call') {
      next.streamRouteDeltaToThinking = false;
      cb.onToolStart(value.toolCall.toolName ?? 'tool');
      cb.ensureMarker();
      return next;
    }

    if (value.type === 'tool_result') {
      const { ok, error } = value.toolResult;
      cb.onToolDone(ok, error);
      cb.ensureMarker();
      return next;
    }

    if (value.type === 'done' && value.usage) {
      this.usageLedger.record(value.usage, getModel(), Date.now() - next.streamRequestStartMs);
    }

    return next;
  }
}
