/**
 * 可用模型目录：与设置表单中的「模型」选项 id 一致，用于展示名称、描述与上下文上限（公开文档中的典型值）。
 * 价格仅用于根据 token 用量估算美元成本，非官方账单。
 */
export interface ModelCatalogEntry {
  id: string;
  name: string;
  shortName: string;
  description: string;
  provider: ModelProvider;
  providerLabel: string;
  /** 典型上下文窗口（tokens） */
  maxContextTokens: number;
  /** 单次请求最大输出 tokens */
  maxTokens: number;
  /** 估算：输入 $ / 1M tokens */
  usdPer1MInput: number;
  /** 估算：输出 $ / 1M tokens */
  usdPer1MOutput: number;
  kind: 'cloud' | 'local';
}

export type ModelProvider = 'anthropic' | 'openai' | 'minimax' | 'deepseek' | 'custom';

export interface ModelEndpointConfig {
  baseUrl: string;
  apiFormat: 'anthropic' | 'openai';
  supportsThinking?: boolean;
}

export const MODEL_ENDPOINTS: Record<ModelProvider, ModelEndpointConfig> = {
  anthropic: { baseUrl: 'https://api.anthropic.com', apiFormat: 'anthropic' },
  openai: { baseUrl: 'https://api.openai.com', apiFormat: 'openai' },
  minimax: { baseUrl: 'https://api.minimaxi.com/anthropic', apiFormat: 'anthropic' },
  deepseek: { baseUrl: 'https://api.deepseek.com/anthropic', apiFormat: 'anthropic', supportsThinking: true },
  custom: { baseUrl: '', apiFormat: 'anthropic' },
};

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: 'MiniMax-M2.7',
    name: 'MiniMax M2.7',
    shortName: 'M2.7',
    description: 'MiniMax 对话模型，适合日常编码与多轮对话。',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    maxContextTokens: 200_000,
    maxTokens: 81920,
    usdPer1MInput: 0.15,
    usdPer1MOutput: 0.6,
    kind: 'cloud',
  },
  {
    id: 'abab6.5s-chat',
    name: 'abab6.5s-chat',
    shortName: 'abab6.5s',
    description: '较快响应，适合短指令与简单任务。',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    maxContextTokens: 200_000,
    maxTokens: 81920,
    usdPer1MInput: 0.1,
    usdPer1MOutput: 0.4,
    kind: 'cloud',
  },
  {
    id: 'abab6.5g-chat',
    name: 'abab6.5g-chat',
    shortName: 'abab6.5g',
    description: '通用对话，兼顾速度与质量。',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    maxContextTokens: 200_000,
    maxTokens: 81920,
    usdPer1MInput: 0.12,
    usdPer1MOutput: 0.5,
    kind: 'cloud',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    shortName: 'V4 Flash',
    description: 'DeepSeek 快速对话模型，适合日常编码与多轮对话。',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    maxContextTokens: 128_000,
    maxTokens: 128000,
    usdPer1MInput: 0.5,
    usdPer1MOutput: 2,
    kind: 'cloud',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    shortName: 'V4 Pro',
    description: 'DeepSeek 推理增强模型，支持 thinking 模式与深度推理，适合复杂编码与逻辑分析。',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    maxContextTokens: 128_000,
    maxTokens: 128000,
    usdPer1MInput: 2,
    usdPer1MOutput: 8,
    kind: 'cloud',
  },
];

export function findCatalogEntry(modelId: string): ModelCatalogEntry | undefined {
  const trimmed = modelId.trim();
  
  const exactMatch = MODEL_CATALOG.find((m) => m.id === trimmed);
  if (exactMatch) return exactMatch;
  
  const normalizedInput = trimmed.toLowerCase().replace(/[\s-_]/g, '');
  const fuzzyMatch = MODEL_CATALOG.find((m) => {
    const normalizedId = m.id.toLowerCase().replace(/[\s-_]/g, '');
    return normalizedId === normalizedInput;
  });
  if (fuzzyMatch) return fuzzyMatch;
  
  const partialMatch = MODEL_CATALOG.find((m) => 
    m.id.toLowerCase().includes(normalizedInput) || 
    normalizedInput.includes(m.id.toLowerCase().replace(/[\s-_]/g, ''))
  );
  if (partialMatch) return partialMatch;
  
  return undefined;
}

export function defaultCatalogEntry(): ModelCatalogEntry {
  return MODEL_CATALOG[0]!;
}

export const ROLE_MODEL_MAP: Record<string, string> = {
  'frontend-developer': 'MiniMax-M2.7',
  'backend-developer': 'MiniMax-M2.7',
  'qa-engineer': 'abab6.5s-chat',
  'architect': 'deepseek-v4-pro',
  'security-reviewer': 'MiniMax-M2.7',
  'devops': 'abab6.5s-chat',
  'reviewer': 'deepseek-v4-pro',
  'researcher': 'MiniMax-M2.7',
  'planner': 'deepseek-v4-pro',
  'executor': 'MiniMax-M2.7',
  'validator': 'abab6.5s-chat',
  'leader': 'deepseek-v4-pro',
};

export function getModelForRole(roleName: string): ModelCatalogEntry {
  const modelId = ROLE_MODEL_MAP[roleName];
  if (modelId) {
    return findCatalogEntry(modelId) ?? defaultCatalogEntry();
  }

  if (/前端|frontend|ui/i.test(roleName)) return findCatalogEntry('MiniMax-M2.7')!;
  if (/后端|backend|api/i.test(roleName)) return findCatalogEntry('MiniMax-M2.7')!;
  if (/测试|qa|test|验证/i.test(roleName)) return findCatalogEntry('abab6.5s-chat')!;
  if (/架构|architect/i.test(roleName)) return findCatalogEntry('deepseek-v4-pro')!;
  if (/安全|security/i.test(roleName)) return findCatalogEntry('MiniMax-M2.7')!;
  if (/运维|devops/i.test(roleName)) return findCatalogEntry('abab6.5s-chat')!;

  return defaultCatalogEntry();
}
