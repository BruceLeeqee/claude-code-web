import type { ModelConfig } from '../types/index.js';
import type { PromptLanguage } from './types.js';

export type ModelCountry = 'CN' | 'US';

const CN_MODEL_KEYWORDS = [
  'qwen',
  'tongyi',
  'ernie',
  'wenxin',
  'glm',
  'chatglm',
  'spark',
  'hunyuan',
  'doubao',
  'baichuan',
  'deepseek',
  'moonshot',
  'kimi',
  'minimax',
];

const US_MODEL_KEYWORDS = [
  'gpt',
  'o1',
  'o3',
  'claude',
  'gemini',
  'llama',
  'mistral',
  'command-r',
  'command r',
  'cohere',
  'xai',
  'grok',
];

function includesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

function resolveCustomProviderCountry(model?: string): ModelCountry {
  const normalized = String(model ?? '').trim().toLowerCase();
  if (!normalized) return 'US';

  const hasCn = includesAnyKeyword(normalized, CN_MODEL_KEYWORDS);
  const hasUs = includesAnyKeyword(normalized, US_MODEL_KEYWORDS);

  if (hasCn && !hasUs) return 'CN';
  if (hasUs && !hasCn) return 'US';
  if (hasCn && hasUs) {
    const cnIndex = Math.min(...CN_MODEL_KEYWORDS.map((k) => normalized.indexOf(k)).filter((i) => i >= 0));
    const usIndex = Math.min(...US_MODEL_KEYWORDS.map((k) => normalized.indexOf(k)).filter((i) => i >= 0));
    return cnIndex <= usIndex ? 'CN' : 'US';
  }

  return 'US';
}

export function resolveModelCountry(config?: ModelConfig): ModelCountry {
  const provider = config?.provider;
  if (provider === 'minimax') return 'CN';
  if (provider === 'anthropic' || provider === 'openai') return 'US';
  if (provider === 'custom') return resolveCustomProviderCountry(config?.model);
  return 'US';
}

export function resolvePromptLanguage(config?: ModelConfig): PromptLanguage {
  return resolveModelCountry(config) === 'CN' ? 'zh' : 'en';
}
