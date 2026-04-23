import { Injectable, inject } from '@angular/core';
import { WorkbenchModeService } from '../../../core/multi-agent/services/workbench-mode.service';
import { PromptMemoryBuilderService } from '../../../core/memory/prompt-memory-builder.service';
import { SkillIndexService, type SkillRecord } from '../../../core/skill-index.service';
import { WorkbenchAssistantFlowService } from './workbench-assistant-flow.service';
import type { ClaudeCoreRuntime } from '../../../core/zyfront-core.providers';
import { CLAUDE_RUNTIME } from '../../../core/zyfront-core.providers';

export type AssistantMode = 'normal' | 'plan' | 'dev';

export interface AssistantModeContext {
  sessionId: string;
  rawInput: string;
  runtimeSystemPrompt: string;
  apiKeyAvailable: boolean;
}

export interface AssistantModePreparation {
  ok: boolean;
  reason?: 'empty' | 'no_api_key' | 'unsupported';
  mode: AssistantMode;
  prompt?: string;
  systemPrompt?: string;
  shouldUseSkillInjection?: boolean;
  skillEnrichment?: {
    effectiveUserInput: string;
    hitSkills: SkillRecord[];
    debugReason: string;
    diagnostics: string[];
  };
  buildReport?: ReturnType<PromptMemoryBuilderService['getLastBuildReport']>;
}

@Injectable({ providedIn: 'root' })
export class WorkbenchAssistantModeFlowService {
  private readonly workbenchMode = inject(WorkbenchModeService);
  private readonly assistantFlow = inject(WorkbenchAssistantFlowService);
  private readonly _runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);

  get runtime(): ClaudeCoreRuntime {
    return this._runtime;
  }

  async prepare(context: AssistantModeContext): Promise<AssistantModePreparation> {
    const trimmed = context.rawInput.trim();
    if (!trimmed) return { ok: false, reason: 'empty', mode: this.resolveMode() };
    if (!context.apiKeyAvailable) return { ok: false, reason: 'no_api_key', mode: this.resolveMode() };

    const mode = this.resolveMode();
    if (mode === 'plan') {
      const prompt = this.buildPlanPrompt(trimmed);
      const prepared = await this.assistantFlow.preparePrompt(context.sessionId, prompt, this.buildPlanSystemPrompt());
      return { ok: true, mode, prompt: prepared.fullPrompt, buildReport: prepared.buildReport } as AssistantModePreparation;
    }

    if (mode === 'dev') {
      const prompt = this.buildDevPrompt(trimmed);
      const prepared = await this.assistantFlow.preparePrompt(context.sessionId, prompt, this.buildDevSystemPrompt());
      return { ok: true, mode, prompt: prepared.fullPrompt, buildReport: prepared.buildReport } as AssistantModePreparation;
    }

    const normal = await this.assistantFlow.preparePrompt(context.sessionId, trimmed, context.runtimeSystemPrompt);
    return {
      ok: normal.ok,
      mode,
      prompt: normal.fullPrompt,
      skillEnrichment: normal.skillEnrichment,
      buildReport: normal.buildReport,
      reason: normal.reason as any,
    };
  }

  resolveMode(): AssistantMode {
    const current = this.workbenchMode.currentMode();
    if (current === 'plan') return 'plan';
    if (current === 'dev') return 'dev';
    return 'normal';
  }

  private buildPlanPrompt(raw: string): string {
    return `请为以下任务生成详细的计划文档。计划文档应包含：\n\n## 任务概述\n简要描述任务目标和背景\n\n## 分析阶段\n- 需要收集哪些信息\n- 需要分析哪些现有代码/系统\n- 潜在的风险和挑战\n\n## 设计阶段\n- 技术方案概述\n- 架构设计要点\n- 关键决策点\n\n## 实施阶段\n- 分步骤的实施计划\n- 每个步骤的预期产出\n- 步骤之间的依赖关系\n\n## 验证阶段\n- 测试策略\n- 验收标准\n- 回滚方案\n\n---\n\n用户任务：${raw}\n\n请生成结构化的计划文档（仅生成计划，不执行任何操作）：`;
  }

  private buildPlanSystemPrompt(): string {
    return `你是一个专业的项目规划师。你的职责是根据用户需求生成详细的计划文档。\n重要规则：\n1. 只生成计划文档，不执行任何实际操作\n2. 计划应该具体、可执行、有明确的验收标准\n3. 识别潜在风险并提供缓解措施\n4. 计划应该分阶段，每个阶段有明确的里程碑\n5. 使用 Markdown 格式输出`;
  }

  private buildDevPrompt(raw: string): string {
    return raw;
  }

  private buildDevSystemPrompt(): string {
    return `你是开发团队的架构师和协调者。你必须严格按照以下流程执行任务。\n\n## 强制执行流程（必须按顺序执行）\n\n### 阶段1: 架构师分析\n[架构师] 分析用户需求，分解任务\n\n### 阶段2: 开发执行\n根据任务类型分配给对应开发者执行：\n- 前端任务 -> [前端开发]\n- 后端任务 -> [后端开发]\n- 通用任务 -> [前端开发] 或 [后端开发]\n\n### 阶段3: 测试验证（必须执行）\n[测试工程师] 对所有完成的任务进行测试验证\n\n### 阶段4: 架构师汇总\n[架构师] 汇总结果并报告\n\n## 团队成员\n- [架构师]：系统架构设计、技术决策、任务协调、结果汇总\n- [前端开发]：前端界面、Angular/TypeScript、UI交互\n- [后端开发]：后端服务、API、Node.js/Python\n- [测试工程师]：测试用例、质量验证、问题检测\n\n## 输出格式（严格遵循）\n\n[架构师] 任务分析完成，共N个子任务：\n1. [任务名] -> 分配给: 前端开发/后端开发\n...\n\n[前端开发/后端开发] 执行任务: xxx\n[前端开发/后端开发] 完成: xxx\n\n[测试工程师] 开始测试验证...\n[测试工程师] 测试结果: 通过/发现问题: xxx\n\n[架构师] 任务完成汇总: xxx\n\n## 重要规则\n1. 必须包含[测试工程师]的测试验证阶段\n2. 测试必须在所有开发任务完成后执行\n3. 如果测试发现问题，必须返回修复后重新测试\n4. 最终由架构师汇总结果`;
  }
}
