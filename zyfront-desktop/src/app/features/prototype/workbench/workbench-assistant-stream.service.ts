import { Injectable, inject } from '@angular/core';
import { ModelUsageLedgerService } from '../../../core/model-usage-ledger.service';
import { WorkbenchModeService } from '../../../core/multi-agent/services/workbench-mode.service';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../../core/zyfront-core.providers';
import type { StreamChunk } from 'zyfront-core';

export interface AssistantStreamRuntime {
  stream: ReadableStream<StreamChunk>;
  cancel: () => void;
}

export interface AssistantStreamContext {
  sessionId: string;
  streamRequestStartMs: number;
  model: string;
}

export interface AssistantStreamCallbacks {
  onDelta?: (text: string, chunk: StreamChunk) => void;
  onChunk?: (chunk: StreamChunk) => void;
  onError?: (errorMessage: string) => void;
  onDone?: (result: AssistantStreamResult) => Promise<void> | void;
  onUsage?: (usage: unknown) => void;
}

export interface AssistantStreamResult {
  ok: boolean;
  failed: boolean;
  collectedText: string;
  interrupted: boolean;
  errorMessage?: string;
}

@Injectable({ providedIn: 'root' })
export class WorkbenchAssistantStreamService {
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly usageLedger = inject(ModelUsageLedgerService);
  private readonly workbenchMode = inject(WorkbenchModeService);

  async consumeStream(
    runtime: AssistantStreamRuntime,
    context: AssistantStreamContext,
    callbacks: AssistantStreamCallbacks = {},
  ): Promise<AssistantStreamResult> {
    const reader = runtime.stream.getReader();
    let collectedText = '';
    let failed = false;
    let errorMessage: string | undefined;
    const interrupted = false;

    try {
      while (true) {
        let chunk: ReadableStreamReadResult<StreamChunk>;
        try {
          chunk = await reader.read();
        } catch {
          failed = true;
          errorMessage = '流被异常终止';
          break;
        }

        const { done, value } = chunk;
        if (done) break;

        if (value.type === 'error' && value.error) {
          failed = true;
          errorMessage = value.error;
          callbacks.onError?.(value.error);
          continue;
        }

        if (value.type === 'delta' && value.textDelta) {
          collectedText += value.textDelta;
          callbacks.onDelta?.(value.textDelta, value);
          continue;
        }

        if (value.type === 'thinking_delta') {
          callbacks.onChunk?.(value);
          continue;
        }

        if (value.type === 'thinking_start' || value.type === 'thinking_done') {
          callbacks.onChunk?.(value);
          continue;
        }

        if (value.type === 'tool_call' || value.type === 'tool_result') {
          callbacks.onChunk?.(value);
          continue;
        }

        if (value.type === 'done' && value.usage) {
          this.usageLedger.record(value.usage, context.model, Date.now() - context.streamRequestStartMs);
          callbacks.onUsage?.(value.usage);
          continue;
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    const result: AssistantStreamResult = {
      ok: !failed,
      failed,
      collectedText,
      interrupted,
      errorMessage,
    };

    await callbacks.onDone?.(result);
    return result;
  }

  getCurrentModel(): string {
    return this.runtime.client.getModel().model;
  }
}
