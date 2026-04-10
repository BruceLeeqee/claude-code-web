import type { PromptLanguage, PromptSection } from '../types.js';

export function buildToneStyleSection(language: PromptLanguage = 'en'): PromptSection {
  return {
    id: 'tone-style',
    kind: 'static',
    content:
      language === 'zh'
        ? [
            '# 语气与风格',
            '- 除非用户要求详细说明，否则保持表达清晰、直接、简洁。',
            '- 在有帮助时使用 markdown 以提升可读性。',
            '- 除非用户明确要求，否则不要使用表情符号。',
          ].join('\n')
        : [
            '# Tone and Style',
            '- Keep responses clear, direct, and concise unless the user asks for detail.',
            '- Use markdown for readability when helpful.',
            '- Do not use emojis unless the user explicitly requests them.',
          ].join('\n'),
  };
}
