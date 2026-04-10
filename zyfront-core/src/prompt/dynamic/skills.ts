import type { PromptBuildContext, PromptSection } from '../types.js';

export function buildSkillsPatchSection(ctx: PromptBuildContext): PromptSection | null {
  if (!ctx.promptPatch) return null;
  const content = ctx.promptPatch.trim();
  if (!content) return null;
  const language = ctx.language ?? 'en';

  return {
    id: 'skills-patch',
    kind: 'dynamic',
    content: `${language === 'zh' ? '# 技能补丁' : '# Skills Patch'}\n${content}`,
  };
}
