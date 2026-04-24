import { Injectable, inject } from '@angular/core';
import { PromptMemoryBuilderService, type PromptBuildReport } from './prompt-memory-builder.service';
import { AgentMemoryService } from '../agent-memory.service';

export interface PromptBuildContext {
  sessionId: string;
  userQuery: string;
  systemPrompt?: string;
  builtAt: number;
}

export interface PromptBuildContextSnapshot {
  sessionId: string;
  userQuery: string;
  systemPrompt: string;
  prompt: string;
  report: PromptBuildReport | null;
  generatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class PromptBuildContextService {
  private readonly promptBuilder = inject(PromptMemoryBuilderService);
  private readonly agentMemory = inject(AgentMemoryService);

  private readonly snapshots = new Map<string, PromptBuildContextSnapshot>();

  async build(context: PromptBuildContext): Promise<PromptBuildContextSnapshot> {
    const prompt = await this.promptBuilder.buildFullPromptForInput(
      context.sessionId,
      context.userQuery,
      context.systemPrompt ?? '',
    );

    const report = this.promptBuilder.getLastBuildReport(context.sessionId);
    const snapshot: PromptBuildContextSnapshot = {
      sessionId: context.sessionId,
      userQuery: context.userQuery,
      systemPrompt: context.systemPrompt ?? '',
      prompt,
      report,
      generatedAt: Date.now(),
    };

    this.snapshots.set(context.sessionId, snapshot);
    return snapshot;
  }

  getSnapshot(sessionId: string): PromptBuildContextSnapshot | null {
    return this.snapshots.get(sessionId) ?? null;
  }

  getLastPrompt(sessionId: string): string {
    return this.snapshots.get(sessionId)?.prompt ?? this.promptBuilder.buildFullPrompt(sessionId);
  }

  getLastReport(sessionId: string): PromptBuildReport | null {
    return this.snapshots.get(sessionId)?.report ?? this.promptBuilder.getLastBuildReport(sessionId);
  }

  async refreshSessionMemory(turn: { sessionId: string; turnId: string; timestamp: number; messages: Array<{ role: string; content: unknown }> }): Promise<void> {
    const lastUser = [...turn.messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...turn.messages].reverse().find((m) => m.role === 'assistant');
    const summary = [
      `turn=${turn.turnId}`,
      `user=${String(lastUser?.content ?? '').slice(0, 240)}`,
      `assistant=${String(lastAssistant?.content ?? '').slice(0, 360)}`,
    ].join('\n');

    await this.agentMemory.appendProjectLongTermTurn({
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      timestamp: turn.timestamp,
      messages: turn.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: unknown }>,
    } as any);

    this.snapshots.set(turn.sessionId, {
      sessionId: turn.sessionId,
      userQuery: summary,
      systemPrompt: '',
      prompt: this.promptBuilder.buildFullPrompt(turn.sessionId),
      report: this.promptBuilder.getLastBuildReport(turn.sessionId),
      generatedAt: Date.now(),
    });
  }
}
