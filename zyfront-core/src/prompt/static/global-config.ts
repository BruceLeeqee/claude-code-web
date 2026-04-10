import type { PromptBuildContext, PromptSection } from '../types.js';

export function buildGlobalConfigSection(ctx: PromptBuildContext): PromptSection | null {
  const normalized = ctx.globalConfigPrompt?.trim();
  if (!normalized) return null;

  return {
    id: 'global-config',
    kind: 'static',
    content: normalized,
  };
}
