import type { PromptLanguage } from './types.js';

export interface EffectiveSystemPromptInput {
  mode?: string | undefined;
  language?: PromptLanguage | undefined;
  overrideSystemPrompt?: string | undefined;
  coordinatorSystemPrompt?: string | undefined;
  customSystemPrompt?: string | undefined;
  baseSystemPrompt?: string | undefined;
  appendSystemPrompt?: string | undefined;
}

export interface EffectiveSystemPromptResult {
  prompt: string;
  source: 'override' | 'coordinator' | 'custom' | 'base' | 'empty';
}

function normalize(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function defaultCoordinatorPrompt(mode: string | undefined, language: PromptLanguage): string | null {
  if (mode === 'plan') {
    return language === 'zh'
      ? [
          '# 协调模式：计划',
          '- 在深入实现前，将任务拆分为清晰有序的步骤。',
          '- 进度更新必须绑定到明确的步骤状态变化。',
        ].join('\n')
      : [
          '# Coordinator Mode: Plan',
          '- Break work into clear, ordered steps before deep implementation.',
          '- Keep progress updates tied to concrete step transitions.',
        ].join('\n');
  }

  if (mode === 'parallel') {
    return language === 'zh'
      ? [
          '# 协调模式：并行',
          '- 将独立工作流拆分并避免跨线程耦合。',
          '- 先按工作流汇报结果，再给出简明合并摘要。',
        ].join('\n')
      : [
          '# Coordinator Mode: Parallel',
          '- Split independent workstreams and avoid cross-thread coupling.',
          '- Report outcomes per workstream, then provide a concise merge summary.',
        ].join('\n');
  }

  return null;
}

export function buildEffectiveSystemPrompt(input: EffectiveSystemPromptInput): EffectiveSystemPromptResult {
  const language = input.language ?? 'en';
  const override = normalize(input.overrideSystemPrompt);
  if (override) {
    return { prompt: override, source: 'override' };
  }

  const coordinator = normalize(input.coordinatorSystemPrompt) ?? defaultCoordinatorPrompt(input.mode, language);
  if (coordinator) {
    return {
      prompt: input.appendSystemPrompt?.trim()
        ? `${coordinator}\n\n${input.appendSystemPrompt.trim()}`
        : coordinator,
      source: 'coordinator',
    };
  }

  const custom = normalize(input.customSystemPrompt);
  if (custom) {
    return {
      prompt: input.appendSystemPrompt?.trim() ? `${custom}\n\n${input.appendSystemPrompt.trim()}` : custom,
      source: 'custom',
    };
  }

  const base = normalize(input.baseSystemPrompt);
  if (base) {
    return {
      prompt: input.appendSystemPrompt?.trim() ? `${base}\n\n${input.appendSystemPrompt.trim()}` : base,
      source: 'base',
    };
  }

  const appended = normalize(input.appendSystemPrompt);
  if (appended) {
    return { prompt: appended, source: 'empty' };
  }

  return { prompt: '', source: 'empty' };
}
