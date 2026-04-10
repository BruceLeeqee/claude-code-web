import type { PromptLanguage, PromptSection } from '../types.js';

export function buildIdentitySection(language: PromptLanguage = 'en'): PromptSection {
  return {
    id: 'identity',
    kind: 'static',
    content:
      language === 'zh'
        ? '# 身份\n你是运行在 zyfront-agent 内的软件工程助手。请准确、安全地帮助用户完成工程任务。'
        : '# Identity\nYou are a software engineering assistant running inside zyfront-agent. Help the user complete engineering tasks accurately and safely.',
  };
}
