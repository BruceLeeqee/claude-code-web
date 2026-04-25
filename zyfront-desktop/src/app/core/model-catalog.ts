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
    usdPer1MInput: 2,
    usdPer1MOutput: 8,
    kind: 'cloud',
  },
];

export function findCatalogEntry(modelId: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === modelId);
}

export function defaultCatalogEntry(): ModelCatalogEntry {
  return MODEL_CATALOG[0]!;
}
