import type { PromptLanguage } from './types.js';

export interface PromptGlobalConfig {
  prompt: {
    zh?: string;
    en?: string;
  };
}

const DEFAULT_FILE_NAME = 'zyfront.md';

function normalizeContent(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trim();
}

/**
 * zyfront.md 约定：仅维护中文全文。
 * - 若写了 ```zh 代码块，则取该块内容作为中文配置
 * - 否则将整个文件视为中文配置
 * - 英文模型不读取该文件内容（返回 undefined）
 */
function parseZhOnlyContent(content: string): { zh?: string; en?: string } {
  const normalized = normalizeContent(content);
  if (!normalized) return {};

  const zhMatch = normalized.match(/```(?:zh|cn)\n([\s\S]*?)```/i);
  const zh = zhMatch?.[1]?.trim() ?? normalized;

  return zh ? { zh } : {};
}

export async function loadPromptGlobalConfig(storage: Storage, fileName = DEFAULT_FILE_NAME): Promise<PromptGlobalConfig | null> {
  const key = `zyfront.globalConfig.${fileName}`;
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { content?: string };
    const content = String(parsed.content ?? '').trim();
    if (!content) return null;
    return { prompt: parseZhOnlyContent(content) };
  } catch {
    return null;
  }
}

export function resolveGlobalPromptByLanguage(config: PromptGlobalConfig | null, language: PromptLanguage): string | undefined {
  if (!config) return undefined;
  if (language !== 'zh') return undefined;
  return config.prompt.zh?.trim() || undefined;
}
