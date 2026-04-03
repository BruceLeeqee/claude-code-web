export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  cacheCostUsd: number;
  totalCostUsd: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  metadata?: JsonObject;
}

export interface ToolCall {
  id: string;
  toolName: string;
  input: JsonValue;
}

export interface ToolResult {
  toolCallId: string;
  ok: boolean;
  output: JsonValue;
  error?: string;
}

export type StreamChunk =
  | { type: 'delta'; textDelta: string }
  | { type: 'done'; message?: ChatMessage; usage?: Usage }
  | { type: 'error'; error: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolResult: ToolResult };

export interface ProxyConfig {
  enabled: boolean;
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'custom';
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  config: ModelConfig;
  systemPrompt?: string;
  contextId?: string;
  metadata?: JsonObject;
}

export interface ChatResponse {
  message: ChatMessage;
  usage?: Usage;
  raw?: JsonValue;
}

export interface ChatStreamResponse {
  stream: ReadableStream<StreamChunk>;
  cancel: () => void;
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  next(prefix?: string): string;
}

export interface CoreEvent {
  type: string;
  ts: number;
  payload?: JsonValue;
}

export interface EventBus {
  publish(event: CoreEvent): void;
  subscribe(type: string, handler: (event: CoreEvent) => void): () => void;
}

export interface PluginContext {
  events: EventBus;
  storage: StorageAdapter;
  exposeService: (name: string, service: unknown) => void;
  getService: <T>(name: string) => T | null;
}

export interface Plugin {
  id: string;
  version: string;
  setup(ctx: PluginContext): Promise<void> | void;
  teardown?(): Promise<void> | void;
}

export interface SkillInput {
  userInput: string;
  context: JsonObject;
}

export interface SkillOutput {
  promptPatch?: string;
  toolHints?: string[];
  metadata?: JsonObject;
}

export interface Skill {
  id: string;
  description: string;
  run(input: SkillInput): Promise<SkillOutput>;
}

export interface MCPRequest {
  id: string;
  method: string;
  params?: JsonValue;
}

export interface MCPResponse {
  id: string;
  result?: JsonValue;
  error?: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

export interface MCPRegistryServer {
  id: string;
  label: string;
  endpoint: string;
  authType?: 'none' | 'bearer' | 'apiKey';
}

export interface CostPolicy {
  maxSessionCostUsd?: number;
  warnThresholdUsd?: number;
}

export interface SessionSnapshot {
  id: string;
  contextId: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
}
