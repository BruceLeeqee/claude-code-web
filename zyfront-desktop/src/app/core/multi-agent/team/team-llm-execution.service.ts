import { Injectable, inject } from '@angular/core';
import { AppSettingsService } from '../../app-settings.service';
import { MODEL_ENDPOINTS, getModelForRole, findCatalogEntry } from '../../model-catalog';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import type { RoleDefinition } from './team.types';

export interface LLMExecutionResult {
  success: boolean;
  content: string;
  reasoningContent?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
  error?: string;
}

export interface LLMExecutionOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
}

export interface ChatMessageLike {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ModelConfigLike {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  thinking?: { type: 'enabled' | 'disabled' };
}

@Injectable({ providedIn: 'root' })
export class TeamLLMExecutionService {
  private readonly settings = inject(AppSettingsService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  async executeForRole(
    role: RoleDefinition,
    task: string,
    teamId: string,
    options: LLMExecutionOptions = {},
  ): Promise<LLMExecutionResult> {
    console.log('[TeamLLMExecution] executeForRole called:', { 
      roleName: role.name, 
      teamId, 
      taskLength: task.length,
      hasModel: !!role.model 
    });
    
    const startTime = Date.now();
    const appSettings = this.settings.value;

    const modelEntry = role.model
      ? findCatalogEntry(role.model.trim())
      : getModelForRole(role.name);

    const finalModelEntry = modelEntry || getModelForRole(role.name);

    const provider = finalModelEntry?.provider || appSettings.modelProvider;
    const model = finalModelEntry?.id || appSettings.model;
    
    console.log('[TeamLLMExecution] Model config:', { 
      provider, 
      model, 
      modelEntryName: finalModelEntry?.name,
      hasApiKey: !!appSettings.apiKey 
    });

    const endpoint = MODEL_ENDPOINTS[provider] || MODEL_ENDPOINTS['minimax'];
    const baseUrl = appSettings.proxy.enabled
      ? appSettings.proxy.baseUrl
      : endpoint.baseUrl;

    const apiKey = this.getApiKeyForProvider(provider, appSettings);
    if (!apiKey) {
      console.error('[TeamLLMExecution] No API Key configured for provider:', provider);
      return {
        success: false,
        content: '',
        durationMs: Date.now() - startTime,
        error: `未配置 ${provider} 的 API Key，请在设置中配置`,
      };
    }

    const systemPrompt = options.systemPrompt || this.buildSystemPrompt(role, task);
    const messages: ChatMessageLike[] = [
      {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: task,
        timestamp: Date.now(),
      },
    ];

    const config: ModelConfigLike = {
      provider,
      model,
      maxTokens: options.maxTokens || finalModelEntry?.maxTokens || (role.maxTurns ? role.maxTurns * 500 : 4096),
      temperature: options.temperature ?? 0.3,
    };

    if (provider === 'deepseek' && model.includes('pro')) {
      config.thinking = { type: 'enabled' };
    }

    this.eventBus.emit({
      type: EVENT_TYPES.AGENT_THINKING,
      sessionId: teamId,
      source: 'system',
      payload: {
        agentId: role.slug,
        thinking: `正在调用 ${modelEntry?.name || model} 处理任务...`,
      },
    });

    console.log('[TeamLLMExecution] Starting API call:', { 
      baseUrl, 
      provider, 
      model, 
      stream: options.stream,
      systemPromptLength: systemPrompt.length,
      messagesCount: messages.length 
    });

    try {
      let result: LLMExecutionResult;
      if (options.stream) {
        result = await this.executeStream(
          baseUrl,
          apiKey,
          provider,
          systemPrompt,
          messages,
          config,
          teamId,
          role.slug,
          options,
          startTime,
        );
      } else {
        result = await this.executeNonStream(
          baseUrl,
          apiKey,
          provider,
          systemPrompt,
          messages,
          config,
          startTime,
        );
      }
      
      console.log('[TeamLLMExecution] API call completed:', { 
        success: result.success, 
        contentLength: result.content.length,
        durationMs: result.durationMs,
        error: result.error 
      });
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[TeamLLMExecution] API call failed:', errorMessage);
      
      this.eventBus.emit({
        type: EVENT_TYPES.AGENT_FAILED,
        sessionId: teamId,
        source: 'system',
        payload: {
          agentId: role.slug,
          stage: 'execute',
          errorMessage,
          retriable: true,
        },
      });

      return {
        success: false,
        content: '',
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  private async executeNonStream(
    baseUrl: string,
    apiKey: string,
    provider: string,
    systemPrompt: string,
    messages: ChatMessageLike[],
    config: ModelConfigLike,
    startTime: number,
  ): Promise<LLMExecutionResult> {
    const headers = this.buildHeaders(provider, apiKey);
    const body = this.buildRequestBody(provider, systemPrompt, messages, config, false);

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const result = this.parseResponse(data);

    return {
      success: true,
      content: result.content,
      reasoningContent: result.reasoningContent,
      usage: result.usage,
      durationMs: Date.now() - startTime,
    };
  }

  private async executeStream(
    baseUrl: string,
    apiKey: string,
    provider: string,
    systemPrompt: string,
    messages: ChatMessageLike[],
    config: ModelConfigLike,
    teamId: string,
    agentId: string,
    options: LLMExecutionOptions,
    startTime: number,
  ): Promise<LLMExecutionResult> {
    const headers = this.buildHeaders(provider, apiKey);
    headers['Accept'] = 'text/event-stream';
    const body = this.buildRequestBody(provider, systemPrompt, messages, config, true);

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder();
    let content = '';
    let reasoningContent = '';
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;

          try {
            const event = JSON.parse(jsonStr);
            this.processStreamEvent(event, {
              onContentDelta: (text) => {
                content += text;
                options.onDelta?.(text);
              },
              onThinkingDelta: (text) => {
                reasoningContent += text;
                options.onThinkingDelta?.(text);
              },
              onUsage: (u) => {
                usage = u;
              },
            });
          } catch {
            // 忽略解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    this.eventBus.emit({
      type: EVENT_TYPES.AGENT_OUTPUT,
      sessionId: teamId,
      source: 'system',
      payload: {
        agentId,
        output: content,
      },
    });

    return {
      success: true,
      content,
      reasoningContent,
      usage,
      durationMs: Date.now() - startTime,
    };
  }

  private processStreamEvent(
    event: any,
    handlers: {
      onContentDelta: (text: string) => void;
      onThinkingDelta: (text: string) => void;
      onUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
    },
  ): void {
    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        handlers.onContentDelta(delta.text);
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        handlers.onThinkingDelta(delta.thinking);
      }
    } else if (event.type === 'message_delta' && event.usage) {
      handlers.onUsage({
        inputTokens: event.usage.input_tokens || 0,
        outputTokens: event.usage.output_tokens || 0,
      });
    } else if (event.type === 'message_start' && event.message?.usage) {
      handlers.onUsage({
        inputTokens: event.message.usage.input_tokens || 0,
        outputTokens: event.message.usage.output_tokens || 0,
      });
    }
  }

  private buildHeaders(provider: string, apiKey: string): Record<string, string> {
    const base: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (provider === 'anthropic') {
      base['x-api-key'] = apiKey;
      base['anthropic-version'] = '2023-06-01';
    } else {
      base['Authorization'] = `Bearer ${apiKey}`;
      if (provider === 'deepseek' || provider === 'minimax') {
        base['anthropic-version'] = '2023-06-01';
      }
    }

    return base;
  }

  private buildRequestBody(
    provider: string,
    systemPrompt: string,
    messages: ChatMessageLike[],
    config: ModelConfigLike,
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.3,
    };

    if (systemPrompt) {
      body['system'] = systemPrompt;
    }

    if (stream) {
      body['stream'] = true;
    }

    if (config.topP !== undefined) {
      body['top_p'] = config.topP;
    }

    if (config.thinking) {
      body['thinking'] = config.thinking;
      if (provider === 'deepseek' && config.thinking.type === 'enabled') {
        body['output_config'] = { effort: 'max' };
      }
      if (provider === 'minimax' && config.thinking.type === 'enabled') {
        body['reasoning_split'] = true;
      }
    }

    return body;
  }

  private parseResponse(data: any): {
    content: string;
    reasoningContent?: string;
    usage?: { inputTokens: number; outputTokens: number };
  } {
    const content: string[] = [];
    let reasoningContent = '';

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          content.push(block.text);
        } else if (block.type === 'thinking') {
          reasoningContent += block.thinking || '';
        }
      }
    }

    const usage = data.usage
      ? {
          inputTokens: data.usage.input_tokens || 0,
          outputTokens: data.usage.output_tokens || 0,
        }
      : undefined;

    return {
      content: content.join('\n'),
      reasoningContent: reasoningContent || undefined,
      usage,
    };
  }

  private buildSystemPrompt(role: RoleDefinition, task: string): string {
    const parts: string[] = [];

    parts.push(`# 角色定义`);
    parts.push(`你是 ${role.name}。`);
    parts.push('');
    parts.push(`## 职责`);
    parts.push(role.description);
    parts.push('');

    if (role.capabilities && role.capabilities.length > 0) {
      parts.push(`## 能力范围`);
      role.capabilities.forEach((cap) => parts.push(`- ${cap}`));
      parts.push('');
    }

    if (role.constraints && role.constraints.length > 0) {
      parts.push(`## 约束条件`);
      role.constraints.forEach((con) => parts.push(`- ${con}`));
      parts.push('');
    }

    if (role.tools && role.tools.length > 0) {
      parts.push(`## 可用工具`);
      parts.push(role.tools.join(', '));
      parts.push('');
    }

    parts.push(`## 工作流程`);
    parts.push(`1. 理解任务需求`);
    parts.push(`2. 制定执行计划`);
    parts.push(`3. 执行具体操作`);
    parts.push(`4. 验证结果`);
    parts.push(`5. 输出执行摘要`);
    parts.push('');

    parts.push(`## 输出格式`);
    parts.push(`请以清晰的格式输出你的工作成果，包括：`);
    parts.push(`- 任务理解`);
    parts.push(`- 执行步骤`);
    parts.push(`- 关键发现/变更`);
    parts.push(`- 结论与建议`);

    return parts.join('\n');
  }

  private getApiKeyForProvider(
    provider: string,
    settings: { apiKey: string; api_keys?: { [key: string]: { api_key: string } | undefined } }
  ): string {
    const providerKey = provider === 'minimax' ? 'MiniMax' : provider === 'deepseek' ? 'DeepSeek' : null;
    
    console.log('[TeamLLMExecution] getApiKeyForProvider:', {
      provider,
      providerKey,
      hasApiKeys: !!settings.api_keys,
      apiKeysData: settings.api_keys ? {
        MiniMax: settings.api_keys['MiniMax'] ? '***' + settings.api_keys['MiniMax'].api_key.slice(-4) : undefined,
        DeepSeek: settings.api_keys['DeepSeek'] ? '***' + settings.api_keys['DeepSeek'].api_key.slice(-4) : undefined,
      } : undefined,
      globalApiKey: settings.apiKey ? '***' + settings.apiKey.slice(-4) : undefined,
    });
    
    if (providerKey && settings.api_keys?.[providerKey]?.api_key) {
      const key = settings.api_keys[providerKey]!.api_key.trim();
      if (key) {
        console.log(`[TeamLLMExecution] Using API Key from api_keys.${providerKey}:`, '***' + key.slice(-4));
        return key;
      }
    }
    
    if (settings.apiKey?.trim()) {
      console.log('[TeamLLMExecution] Using global API Key:', '***' + settings.apiKey.slice(-4));
      return settings.apiKey.trim();
    }
    
    return '';
  }
}
