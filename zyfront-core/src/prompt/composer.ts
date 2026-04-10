import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './constants.js';
import { buildEnvironmentSection } from './dynamic/environment.js';
import { buildSessionSection } from './dynamic/session.js';
import { buildSkillsPatchSection } from './dynamic/skills.js';
import { computePromptHashes } from './hash.js';
import { buildCodingStyleSection } from './static/coding-style.js';
import { buildIdentitySection } from './static/identity.js';
import { buildSystemPolicySection } from './static/system-policy.js';
import { buildToneStyleSection } from './static/tone-style.js';
import { buildToolPolicySection } from './static/tool-policy.js';
import { buildGlobalConfigSection } from './static/global-config.js';
import type { PromptBuildContext, PromptBuildResult, PromptLanguage, PromptSection } from './types.js';

function asOptionalSection(id: string, kind: PromptSection['kind'], content?: string): PromptSection | null {
  const normalized = content?.trim();
  if (!normalized) return null;
  return { id, kind, content: normalized };
}

export function composePrompt(ctx: PromptBuildContext): PromptBuildResult {
  const language: PromptLanguage = ctx.language ?? 'en';
  const staticSections: PromptSection[] = [
    buildIdentitySection(language),
    buildSystemPolicySection(language),
    buildCodingStyleSection(language),
    buildToolPolicySection(language),
    buildToneStyleSection(language),
    buildGlobalConfigSection(ctx),
    asOptionalSection('base-system-prompt', 'static', ctx.baseSystemPrompt),
  ].filter((s): s is PromptSection => s !== null);

  const dynamicSections: PromptSection[] = [
    buildEnvironmentSection(ctx),
    buildSessionSection(ctx),
    buildSkillsPatchSection(ctx),
  ].filter((s): s is PromptSection => s !== null);

  const chunks = [
    ...staticSections.map((s) => s.content),
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    ...dynamicSections.map((s) => s.content),
  ];

  const sections = [...staticSections, ...dynamicSections];
  const finalPrompt = chunks.join('\n\n');
  const hashes = computePromptHashes(sections, finalPrompt);

  return {
    sections,
    chunks,
    finalPrompt,
    debug: {
      language,
      sectionIds: sections.map((s) => s.id),
      staticSectionIds: staticSections.map((s) => s.id),
      dynamicSectionIds: dynamicSections.map((s) => s.id),
      staticHash: hashes.staticHash,
      dynamicHash: hashes.dynamicHash,
      fullHash: hashes.fullHash,
    },
  };
}
