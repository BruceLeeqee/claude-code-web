import { Injectable, inject } from '@angular/core';
import { WorkbenchAssistantModeFlowService, type AssistantModePreparation } from './workbench-assistant-mode-flow.service';
import { WorkbenchAssistantStreamService } from './workbench-assistant-stream.service';
import { WorkbenchAssistantFlowService } from './workbench-assistant-flow.service';
import type { ModelConfig, StreamChunk } from 'zyfront-core';

export interface AssistantModeExecutorContext {
  sessionId: string;
  rawInput: string;
  skipTerminalUserLineAnchor?: boolean;
}

export interface AssistantModeExecutorCallbacks {
  write: (text: string) => void;
  warn: (text: string) => void;
  error: (text: string) => void;
  commitUserRow: (prompt: string, skipTerminalUserLineAnchor?: boolean) => void;
  onBeforeNormal?: (prepared: AssistantModePreparation) => void;
  onBeforePlan?: (prepared: AssistantModePreparation) => void;
  onBeforeDev?: (prepared: AssistantModePreparation) => void;
  onNormalDelta: (text: string, chunk: StreamChunk) => void;
  onDevDelta: (text: string, chunk: StreamChunk) => void;
  onPlanDone: (text: string) => void;
  onNormalDone: (text: string) => Promise<void> | void;
  onDevDone: (text: string) => Promise<void> | void;
  onModeTerminalReady?: () => void;
}

@Injectable({ providedIn: 'root' })
export class WorkbenchAssistantModeExecutorService {
  private readonly assistantModeFlow = inject(WorkbenchAssistantModeFlowService);
  private readonly assistantFlow = inject(WorkbenchAssistantFlowService);
  private readonly assistantStream = inject(WorkbenchAssistantStreamService);

  async execute(
    ctx: AssistantModeExecutorContext,
    callbacks: AssistantModeExecutorCallbacks,
    runtimeSystemPrompt: string,
    apiKeyAvailable: boolean,
    getModel: () => ModelConfig,
    getStreamRequestStartMs: () => number,
  ): Promise<void> {
    const prepared = await this.assistantModeFlow.prepare({
      sessionId: ctx.sessionId,
      rawInput: ctx.rawInput,
      runtimeSystemPrompt,
      apiKeyAvailable,
    });

    if (!prepared.ok) {
      callbacks.error(prepared.reason === 'no_api_key'
        ? '\r\n\x1b[31m[error]\x1b[0m 未配置 API Key。\x1b[90m 请打开「API 设置」填写密钥后再试。\x1b[0m\r\n'
        : '\r\n\x1b[31m[error]\x1b[0m 请输入内容。\r\n');
      return;
    }

    const mode = this.assistantModeFlow.resolveMode();
    if (mode === 'plan') {
      callbacks.onBeforePlan?.(prepared);
      await this.executePlan(prepared, ctx, callbacks, getModel, getStreamRequestStartMs);
      return;
    }

    if (mode === 'dev') {
      callbacks.onBeforeDev?.(prepared);
      await this.executeDev(prepared, ctx, callbacks, getModel, getStreamRequestStartMs);
      return;
    }

    callbacks.onBeforeNormal?.(prepared);
    await this.executeNormal(prepared, ctx, callbacks, runtimeSystemPrompt, getModel, getStreamRequestStartMs);
  }

  private async executeNormal(
    prepared: AssistantModePreparation,
    ctx: AssistantModeExecutorContext,
    callbacks: AssistantModeExecutorCallbacks,
    runtimeSystemPrompt: string,
    getModel: () => ModelConfig,
    getStreamRequestStartMs: () => number,
  ): Promise<void> {
    const prompt = String(prepared.prompt ?? '').trim();
    if (!prompt) {
      callbacks.error('\r\n\x1b[31m[error]\x1b[0m 请输入内容。\r\n');
      return;
    }

    const { stream, cancel } = this.assistantModeFlow.runtime.assistant.stream(ctx.sessionId, {
      userInput: prompt,
      config: getModel(),
    });

    await this.assistantStream.consumeStream(
      { stream, cancel },
      {
        sessionId: ctx.sessionId,
        streamRequestStartMs: getStreamRequestStartMs(),
        model: getModel().model,
      },
      {
        onDelta: (text, chunk) => callbacks.onNormalDelta(text, chunk),
        onError: callbacks.error,
        onDone: async (result) => {
          if (result.failed) return;
          await callbacks.onNormalDone(result.collectedText);
        },
      },
    );
  }

  private async executePlan(
    prepared: AssistantModePreparation,
    ctx: AssistantModeExecutorContext,
    callbacks: AssistantModeExecutorCallbacks,
    getModel: () => ModelConfig,
    getStreamRequestStartMs: () => number,
  ): Promise<void> {
    const prompt = String(prepared.prompt ?? '').trim();
    if (!prompt) {
      callbacks.error('\r\n\x1b[31m[error]\x1b[0m 计划模式输入为空。\r\n');
      return;
    }

    const { stream, cancel } = this.assistantModeFlow.runtime.assistant.stream(ctx.sessionId, {
      userInput: prompt,
      config: getModel(),
    });

    await this.assistantStream.consumeStream(
      { stream, cancel },
      {
        sessionId: ctx.sessionId,
        streamRequestStartMs: getStreamRequestStartMs(),
        model: getModel().model,
      },
      {
        onDelta: callbacks.write,
        onError: callbacks.error,
        onDone: async (result) => {
          if (result.failed) return;
          callbacks.onPlanDone(result.collectedText.trim());
        },
      },
    );
  }

  private async executeDev(
    prepared: AssistantModePreparation,
    ctx: AssistantModeExecutorContext,
    callbacks: AssistantModeExecutorCallbacks,
    getModel: () => ModelConfig,
    getStreamRequestStartMs: () => number,
  ): Promise<void> {
    const prompt = String(prepared.prompt ?? '').trim();
    if (!prompt) {
      callbacks.error('\r\n\x1b[31m[error]\x1b[0m 开发模式输入为空。\r\n');
      return;
    }

    const { stream, cancel } = this.assistantModeFlow.runtime.assistant.stream(ctx.sessionId, {
      userInput: prompt,
      config: getModel(),
    });

    await this.assistantStream.consumeStream(
      { stream, cancel },
      {
        sessionId: ctx.sessionId,
        streamRequestStartMs: getStreamRequestStartMs(),
        model: getModel().model,
      },
      {
        onDelta: (text, chunk) => callbacks.onDevDelta(text, chunk),
        onError: callbacks.error,
        onDone: async (result) => {
          if (result.failed) return;
          await callbacks.onDevDone(result.collectedText);
        },
      },
    );
  }
}
