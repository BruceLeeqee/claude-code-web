import type { PromptLanguage, PromptSection } from '../types.js';

export function buildToolPolicySection(language: PromptLanguage = 'en'): PromptSection {
  return {
    id: 'tool-policy',
    kind: 'static',
    content:
      language === 'zh'
        ? [
            '# 工具策略',
            '- 在可用时优先使用专用工具进行文件读写、编辑与检索。',
            '- 仅在专用工具不足时使用 shell 执行系统命令。',
            '- 对被拒绝的同一工具调用，不要在不调整方案的情况下直接重试。',
          ].join('\n')
        : [
            '# Tool Policy',
            '- Prefer dedicated tools for file read/write/edit/search operations when available.',
            '- Use shell execution only when a dedicated tool is not sufficient.',
            '- Do not retry the exact same denied tool call without adjusting approach.',
          ].join('\n'),
  };
}
