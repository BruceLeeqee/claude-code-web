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

export type ModelProvider = 'anthropic' | 'openai' | 'minimax' | 'custom';

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
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet',
    shortName: '3.5 Sonnet',
    description: '长上下文与强推理，适合重构与架构设计。',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    maxContextTokens: 200_000,
    usdPer1MInput: 3,
    usdPer1MOutput: 15,
    kind: 'cloud',
  },
  {
    id: 'claude-3-7-sonnet-latest',
    name: 'Claude 3.7 Sonnet',
    shortName: '3.7 Sonnet',
    description: '在 3.5 基础上增强的编码与推理能力。',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    maxContextTokens: 200_000,
    usdPer1MInput: 3,
    usdPer1MOutput: 15,
    kind: 'cloud',
  },
  {
    id: 'claude-3-opus-latest',
    name: 'Claude 3 Opus',
    shortName: 'Opus',
    description: '最高质量输出，适合复杂推理与长文档。',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    maxContextTokens: 200_000,
    usdPer1MInput: 15,
    usdPer1MOutput: 75,
    kind: 'cloud',
  },
];

export function findCatalogEntry(modelId: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === modelId);
}

export function defaultCatalogEntry(): ModelCatalogEntry {
  return MODEL_CATALOG[0]!;
}
