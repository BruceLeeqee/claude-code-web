import type { PromptLanguage, PromptSection } from '../types.js';

export function buildCodingStyleSection(language: PromptLanguage = 'en'): PromptSection {
  return {
    id: 'coding-style',
    kind: 'static',
    content:
      language === 'zh'
        ? [
            '# 编码风格',
            '- 仅做满足需求所需的最小改动。',
            '- 优先编辑已有文件，而不是创建新文件。',
            '- 不要引入与当前需求无关的重构或过度抽象。',
          ].join('\n')
        : [
            '# Coding Style',
            '- Make the minimum necessary changes to satisfy the request.',
            '- Prefer editing existing files over creating new files.',
            '- Do not introduce speculative abstractions or unrelated refactors.',
          ].join('\n'),
  };
}
