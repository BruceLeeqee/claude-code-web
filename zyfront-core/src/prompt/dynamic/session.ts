import type { PromptBuildContext, PromptSection } from '../types.js';

function modeGuidance(mode: string | undefined, language: 'zh' | 'en'): string[] {
  if (mode === 'plan') {
    return language === 'zh'
      ? [
          '- 计划模式策略：先定义清晰的有序步骤，再进入实现。',
          '- 回答应与当前步骤对齐，并显式标记进度变化。',
        ]
      : [
          '- Plan mode strategy: define clear ordered steps before implementation.',
          '- Keep responses aligned to current step and explicitly mark progress changes.',
        ];
  }

  if (mode === 'parallel') {
    return language === 'zh'
      ? [
          '- 并行模式策略：将任务拆为独立轨道并避免耦合。',
          '- 先分轨汇报结果，再给出简明合并结论。',
        ]
      : [
          '- Parallel mode strategy: split work into independent tracks and avoid coupling.',
          '- Summarize outputs per track, then provide a concise merged conclusion.',
        ];
  }

  return language === 'zh'
    ? [
        '- 单轮模式策略：优先直接执行，并保持简洁进度更新。',
        '- 若用户在新一轮提出了不同目标，必须立即切换到最新目标，不得延续旧目标。',
      ]
    : [
        '- Single mode strategy: prioritize direct execution with concise progress updates.',
        '- If the user provides a different goal in a newer turn, immediately switch to the latest goal and stop pursuing the previous one.',
      ];
}

export function buildSessionSection(ctx: PromptBuildContext): PromptSection | null {
  if (!ctx.mode && !ctx.userInput) return null;
  const language = ctx.language ?? 'en';

  const lines =
    language === 'zh'
      ? [
          '# 会话指引',
          ctx.mode ? `- 当前模式: ${ctx.mode}` : null,
          ...modeGuidance(ctx.mode, 'zh'),
          '- 指令优先级：以最新一轮用户请求为最高优先级；若与历史目标冲突，历史目标作废。',
          ctx.userInput ? `- 当前用户请求(最高优先级): ${ctx.userInput}` : null,
        ]
      : [
          '# Session Guidance',
          ctx.mode ? `- Current mode: ${ctx.mode}` : null,
          ...modeGuidance(ctx.mode, 'en'),
          '- Instruction priority: the latest user turn has top priority; if it conflicts with prior goals, prior goals are superseded.',
          ctx.userInput ? `- Current user request (highest priority): ${ctx.userInput}` : null,
        ];

  return {
    id: 'session-guidance',
    kind: 'dynamic',
    content: lines.filter((v): v is string => v !== null).join('\n'),
  };
}
