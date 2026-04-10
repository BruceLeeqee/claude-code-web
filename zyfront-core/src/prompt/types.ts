export type PromptSectionKind = 'static' | 'dynamic' | 'uncached-dynamic';
export type PromptLanguage = 'zh' | 'en';

export interface PromptSection {
  id: string;
  kind: PromptSectionKind;
  content: string;
}

export interface PromptBuildContext {
  baseSystemPrompt?: string | undefined;
  promptPatch?: string | undefined;
  userInput?: string | undefined;
  mode?: string | undefined;
  language?: PromptLanguage | undefined;
  globalConfigPrompt?: string | undefined;
  env?: {
    cwd?: string | undefined;
    shell?: string | undefined;
    os?: string | undefined;
    model?: string | undefined;
    isGitRepo?: boolean | undefined;
  } | undefined;
}

export interface PromptBuildResult {
  sections: PromptSection[];
  chunks: string[];
  finalPrompt: string;
  debug: {
    language: PromptLanguage;
    sectionIds: string[];
    staticSectionIds: string[];
    dynamicSectionIds: string[];
    staticHash: string;
    dynamicHash: string;
    fullHash: string;
  };
}
