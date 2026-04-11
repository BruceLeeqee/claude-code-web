/**
 * zyfront-core 领域类型：JSON 子类型、对话与工具、流式事件、模型与代理、存储与插件等。
 */

/** JSON 原子类型 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

/** 对话参与方角色 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** 单次 API 调用的 token 用量 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/** 按输入/输出/缓存拆分的美元成本估算 */
export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  cacheCostUsd: number;
  totalCostUsd: number;
}

/** 一条聊天消息（可带 anthropicWire 元数据用于多轮工具回放） */
export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  /** Optional API-shaped payload for Anthropic replay (`anthropicWire`); see zyfront-core `api/anthropic-messages`. */
  metadata?: JsonObject;
}

/** 模型发起的工具调用 */
export interface ToolCall {
  id: string;
  toolName: string;
  input: JsonValue;
}

/** 工具执行结果（成功输出或错误信息） */
export interface ToolResult {
  toolCallId: string;
  ok: boolean;
  output: JsonValue;
  error?: string;
}

/** SSE 一轮结束后的助手快照（可含 tool_use 块） */
export interface AnthropicTurnSnapshot {
  stopReason: string | null;
  assistantText: string;
  assistantContentBlocks: JsonArray;
  toolCalls: ToolCall[];
  usage?: Usage;
}

/** 流式通道向下游推送的分片类型联合 */
export type StreamChunk =
  | { type: 'delta'; textDelta: string }
  | { type: 'thinking_delta'; textDelta: string }
  | { type: 'done'; message?: ChatMessage; usage?: Usage }
  | { type: 'error'; error: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolResult: ToolResult }
  | { type: 'anthropic_turn'; turn: AnthropicTurnSnapshot };

/** 是否经同源/Bridge 代理转发 API */
export interface ProxyConfig {
  enabled: boolean;
  baseUrl: string;
  headers?: Record<string, string>;
}

/** 模型提供方与采样参数 */
export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'minimax' | 'custom';
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
}

/** 发往 LLM 的聊天请求体（含历史消息与可选 tools） */
export interface ChatRequest {
  messages: ChatMessage[];
  config: ModelConfig;
  systemPrompt?: string;
  contextId?: string;
  metadata?: JsonObject;
  /** Anthropic `tools` array; when set (Anthropic-compatible providers), enables tool_use / tool_result rounds. */
  tools?: JsonArray;
}

/** 非流式单次模型响应 */
export interface ChatResponse {
  message: ChatMessage;
  usage?: Usage;
  raw?: JsonValue;
  /** Present for Anthropic-compatible non-stream turns when the model returns tool_use. */
  stopReason?: string | null;
  toolCalls?: ToolCall[];
}

/** 流式响应：ReadableStream + 取消函数 */
export interface ChatStreamResponse {
  stream: ReadableStream<StreamChunk>;
  cancel: () => void;
}

/** 键值持久化抽象（浏览器 localStorage、内存等） */
export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/** 可注入时钟（便于测试） */
export interface Clock {
  now(): number;
}

/** 生成带前缀的唯一 id */
export interface IdGenerator {
  next(prefix?: string): string;
}

/** 核心事件总线载荷 */
export interface CoreEvent {
  type: string;
  ts: number;
  payload?: JsonValue;
}

/** 发布/订阅事件总线 */
export interface EventBus {
  publish(event: CoreEvent): void;
  subscribe(type: string, handler: (event: CoreEvent) => void): () => void;
}

/** 插件初始化时注入的上下文 */
export interface PluginContext {
  events: EventBus;
  storage: StorageAdapter;
  exposeService: (name: string, service: unknown) => void;
  getService: <T>(name: string) => T | null;
}

/** 插件生命周期：setup / teardown */
export interface Plugin {
  id: string;
  version: string;
  setup(ctx: PluginContext): Promise<void> | void;
  teardown?(): Promise<void> | void;
}

/** 技能管道输入 */
export interface SkillInput {
  userInput: string;
  context: JsonObject;
}

/** 技能可对系统提示与工具提示做的补丁 */
export interface SkillOutput {
  promptPatch?: string;
  toolHints?: string[];
  metadata?: JsonObject;
}

/** 可注册的技能单元 */
export interface Skill {
  id: string;
  description: string;
  run(input: SkillInput): Promise<SkillOutput>;
}

/** MCP JSON-RPC 风格请求 */
export interface MCPRequest {
  id: string;
  method: string;
  params?: JsonValue;
}

/** MCP 响应或错误 */
export interface MCPResponse {
  id: string;
  result?: JsonValue;
  error?: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

/** 注册表中的 MCP 服务端描述 */
export interface MCPRegistryServer {
  id: string;
  label: string;
  endpoint: string;
  authType?: 'none' | 'bearer' | 'apiKey';
}

/** 会话成本告警与上限策略 */
export interface CostPolicy {
  maxSessionCostUsd?: number;
  warnThresholdUsd?: number;
}

/** 会话元信息快照 */
export interface SessionSnapshot {
  id: string;
  contextId: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
}
