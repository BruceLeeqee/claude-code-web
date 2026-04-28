import { Injectable, inject } from '@angular/core';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../zyfront-core.providers';
import { AppSettingsService } from '../../app-settings.service';

export type UserIntent = 'question' | 'task';

export interface IntentClassificationResult {
  intent: UserIntent;
  confidence: number;
  reasoning: string;
}

const INTENT_CLASSIFICATION_PROMPT = `你是一个用户意图分类器。判断用户请求属于哪种类型：

A. 问题咨询 — 用户只是在提问、寻求解释、了解信息，只需要回答即可。例如：
   - "什么是依赖注入？"
   - "这个函数为什么报错？"
   - "Angular 信号和 BehaviorSubject 有什么区别？"
   - "解释一下这段代码的作用"
   - "你好"
   - "今天天气怎么样"

B. 执行任务 — 用户明确要求你去做某件事、实现功能、修改代码、创建文件等，需要步骤或规划。例如：
   - "帮我实现一个登录页面"
   - "修复这个 bug"
   - "重构这个服务"
   - "创建一个新的组件"
   - "帮我写一个单元测试"
   - "优化这段代码的性能"

只输出 A 或 B，不要输出其他内容。`;

@Injectable({ providedIn: 'root' })
export class IntentClassifierService {
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly appSettings = inject(AppSettingsService);

  async classify(userRequest: string): Promise<IntentClassificationResult> {
    const trimmed = userRequest.trim();
    if (!trimmed) {
      return { intent: 'question', confidence: 1, reasoning: '空请求' };
    }

    if (this.isGreeting(trimmed)) {
      return { intent: 'question', confidence: 1, reasoning: '问候语' };
    }

    if (this.isShortQuestion(trimmed)) {
      return { intent: 'question', confidence: 0.9, reasoning: '短问题' };
    }

    const apiKey = this.appSettings.value?.apiKey;
    if (!apiKey?.trim()) {
      return this.fallbackClassify(trimmed);
    }

    try {
      const raw = await this.callLLM(trimmed);
      const parsed = this.parseResponse(raw);
      return parsed;
    } catch {
      return this.fallbackClassify(trimmed);
    }
  }

  private isGreeting(text: string): boolean {
    const greetings = ['你好', 'hello', 'hi', 'hey', '在吗', '嗨', '哈喽', '早上好', '下午好', '晚上好', '您好'];
    const lower = text.toLowerCase();
    return greetings.some(g => lower === g || lower === g + '!' || lower === g + '！');
  }

  private isShortQuestion(text: string): boolean {
    if (text.length <= 15 && /^[？?。.！!]*$/.test(text.replace(/[\u4e00-\u9fa5a-zA-Z0-9\s]/g, ''))) {
      return !this.hasTaskKeywords(text);
    }
    return false;
  }

  private hasTaskKeywords(text: string): boolean {
    const taskKeywords = ['帮我', '实现', '创建', '修复', '重构', '优化', '编写', '开发', '部署', '安装', '配置'];
    return taskKeywords.some(k => text.includes(k));
  }

  private async callLLM(userRequest: string): Promise<string> {
    const fullPrompt = `${INTENT_CLASSIFICATION_PROMPT}\n\n用户请求：${userRequest}`;

    return new Promise((resolve, reject) => {
      try {
        const { stream, cancel } = this.runtime.assistant.stream('intent-classification', {
          userInput: fullPrompt,
          config: this.runtime.client.getModel(),
        });

        const reader = stream.getReader();
        let accumulated = '';
        const timeout = setTimeout(() => {
          cancel();
          reject(new Error('Intent classification timeout'));
        }, 10000);

        const readChunk = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                clearTimeout(timeout);
                resolve(accumulated);
                return;
              }
              if (value.type === 'error') {
                clearTimeout(timeout);
                reject(new Error(value.error || 'LLM stream error'));
                return;
              }
              if (value.type === 'delta' && value.textDelta) {
                accumulated += value.textDelta;
              }
            }
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        };

        readChunk();
      } catch (error) {
        reject(error);
      }
    });
  }

  private parseResponse(raw: string): IntentClassificationResult {
    const cleaned = raw.trim().toUpperCase();

    if (cleaned.startsWith('A') || cleaned.includes('A') && !cleaned.includes('B')) {
      return { intent: 'question', confidence: 0.9, reasoning: 'LLM分类: 问题咨询' };
    }

    if (cleaned.startsWith('B') || cleaned.includes('B')) {
      return { intent: 'task', confidence: 0.9, reasoning: 'LLM分类: 执行任务' };
    }

    return { intent: 'question', confidence: 0.5, reasoning: `LLM响应模糊: ${raw.slice(0, 50)}` };
  }

  private fallbackClassify(request: string): IntentClassificationResult {
    const taskPatterns = [
      /帮我|请帮我|帮我做|帮我写|帮我创建|帮我实现|帮我修复|帮我重构|帮我优化|帮我添加|帮我删除|帮我修改|帮我更新/i,
      /实现|开发|编写|创建|构建|部署|安装|配置/i,
      /修复|解决|fix|debug|调试/i,
      /重构|优化|改进|升级|迁移|改造/i,
      /添加|删除|修改|更新|替换/i,
    ];

    const isTask = taskPatterns.some(p => p.test(request));

    if (isTask) {
      return { intent: 'task', confidence: 0.6, reasoning: 'fallback: 匹配到任务关键词' };
    }

    return { intent: 'question', confidence: 0.6, reasoning: 'fallback: 未匹配到任务关键词' };
  }
}
