import { Injectable } from '@angular/core';
import type { LoopPlanStep, LoopState, LoopStepDoc, LoopValidationResult } from './loop-command.types';

declare const window: Window & typeof globalThis;

/**
 * Loop 步骤文档写入器
 *
 * 职责：将 LoopStepDoc 从"路径索引"升级为"真实内容落盘"。
 * 读取 docs/loop-templates/ 下的模板，用当前 LoopState / LoopPlanStep / LoopValidationResult
 * 的字段填充占位符，生成完整 markdown 文档内容。
 */
@Injectable({ providedIn: 'root' })
export class LoopDocWriterService {

  /* ── 模板缓存 ────────────────────────────────────────── */
  private templateCache = new Map<string, string>();

  /* ── 公共 API ────────────────────────────────────────── */

  /**
   * 根据 step 类型与 loop 状态，生成真实文档内容并写入磁盘。
   * 返回填充后的 LoopStepDoc（含 content 字段）。
   */
  async writeStepDoc(
    state: LoopState,
    step: LoopPlanStep,
    validation?: LoopValidationResult,
  ): Promise<LoopStepDoc> {
    const docType = this.mapStepTypeToDocType(step.type);
    const template = await this.loadTemplate(docType);
    const content = this.fillTemplate(template, state, step, validation);
    const docId = `${step.id}-${Date.now()}`;
    const docPath = `02-AGENT-MEMORY/01-Short-Term/loop/${docId}.md`;

    const doc: LoopStepDoc = {
      id: docId,
      stepId: step.id,
      type: docType,
      path: docPath,
      title: `step-${step.id}`,
      createdAt: new Date().toISOString(),
      content,
    };

    await this.writeToDisk(docPath, content);

    return doc;
  }

  /**
   * 生成 loop 状态文档
   */
  async writeStatusDoc(state: LoopState): Promise<LoopStepDoc> {
    const template = await this.loadTemplate('status');
    const content = this.fillStatusTemplate(template, state);
    const docId = `status-${state.loopId}-${Date.now()}`;
    const docPath = `02-AGENT-MEMORY/01-Short-Term/loop/${docId}.md`;

    const doc: LoopStepDoc = {
      id: docId,
      stepId: 'status',
      type: 'status',
      path: docPath,
      title: `status-${state.loopId}`,
      createdAt: new Date().toISOString(),
      content,
    };

    await this.writeToDisk(docPath, content);

    return doc;
  }

  /* ── 模板加载 ────────────────────────────────────────── */

  private async loadTemplate(docType: LoopStepDoc['type']): Promise<string> {
    const cached = this.templateCache.get(docType);
    if (cached) return cached;

    const fileName = this.templateFileName(docType);
    // 优先从 workspace scope 读取（模板在项目 docs/ 目录下）
    const templatePath = `docs/loop-templates/${fileName}`;

    if (typeof window !== 'undefined' && window.zytrader?.fs?.read) {
      // 先尝试 workspace scope
      const result1 = await window.zytrader.fs.read(templatePath, { scope: 'workspace' });
      if (result1.ok && result1.content) {
        this.templateCache.set(docType, result1.content);
        return result1.content;
      }
      // 再尝试 vault scope（兼容旧路径）
      const result2 = await window.zytrader.fs.read(templatePath, { scope: 'vault' });
      if (result2.ok && result2.content) {
        this.templateCache.set(docType, result2.content);
        return result2.content;
      }
    }

    // 降级：返回内置最小模板
    const fallback = this.fallbackTemplate(docType);
    this.templateCache.set(docType, fallback);
    return fallback;
  }

  private templateFileName(docType: LoopStepDoc['type']): string {
    const map: Record<LoopStepDoc['type'], string> = {
      requirements: 'requirements-template.md',
      design: 'design-template.md',
      execution: 'execution-template.md',
      verification: 'verification-template.md',
      repair: 'repair-template.md',
      summary: 'summary-template.md',
      status: 'status-template.md',
    };
    return map[docType] ?? 'execution-template.md';
  }

  /* ── 模板填充 ────────────────────────────────────────── */

  private fillTemplate(
    template: string,
    state: LoopState,
    step: LoopPlanStep,
    validation?: LoopValidationResult,
  ): string {
    const now = new Date().toISOString();
    const vars: Record<string, string> = {
      // 通用
      loopId: state.loopId,
      stepId: step.id,
      stepType: step.type,
      stepTitle: step.title,
      riskLevel: step.riskLevel,
      createdAt: now,
      objective: state.objective,
      taskName: state.objective,
      taskType: state.taskType,
      teamName: state.teamName,
      lastSummary: state.lastSummary,
      iteration: String(state.iteration),
      maxIterations: String(state.maxIterations),
      retryCount: String(state.retryCount),
      // 验证矩阵
      compileStatus: this.matrixStatus(state, 'compile'),
      compileEvidence: this.matrixEvidence(state, 'compile'),
      compileNote: this.matrixNote(state, 'compile'),
      uiStatus: this.matrixStatus(state, 'ui'),
      uiEvidence: this.matrixEvidence(state, 'ui'),
      uiNote: this.matrixNote(state, 'ui'),
      apiStatus: this.matrixStatus(state, 'api'),
      apiEvidence: this.matrixEvidence(state, 'api'),
      apiNote: this.matrixNote(state, 'api'),
      dataStatus: this.matrixStatus(state, 'data'),
      dataEvidence: this.matrixEvidence(state, 'data'),
      dataNote: this.matrixNote(state, 'data'),
      terminalStatus: this.matrixStatus(state, 'terminal'),
      terminalEvidence: this.matrixEvidence(state, 'terminal'),
      terminalNote: this.matrixNote(state, 'terminal'),
      // 验证
      verificationStage: validation?.stage ?? '',
      passedLabel: validation ? (validation.passed ? '✅ 通过' : '❌ 未通过') : '待验证',
      recommendation: validation?.recommendation ?? '',
      errorsSection: validation?.errors.length ? validation.errors.map((e) => `- ${e}`).join('\n') : '无',
      warningsSection: validation?.warnings.length ? validation.warnings.map((w) => `- ${w}`).join('\n') : '无',
      blockersSection: validation?.blockers.length ? validation.blockers.map((b) => `- ${b}`).join('\n') : '无',
    };

    return this.replaceVars(template, vars);
  }

  private fillStatusTemplate(template: string, state: LoopState): string {
    const now = new Date().toISOString();
    const currentStep = state.currentPlan[0];
    const nextStep = state.currentPlan[1];

    const vars: Record<string, string> = {
      loopId: state.loopId,
      objective: state.objective,
      stage: state.phase,
      status: state.status,
      teamName: state.teamName,
      taskType: state.taskType,
      iteration: String(state.iteration),
      maxIterations: String(state.maxIterations),
      retryCount: String(state.retryCount),
      currentStepTitle: currentStep?.title ?? '无',
      nextStepTitle: nextStep?.title ?? '无',
      createdAt: now,
      compileStatus: this.matrixStatus(state, 'compile'),
      compileEvidence: this.matrixEvidence(state, 'compile'),
      compileNote: this.matrixNote(state, 'compile'),
      uiStatus: this.matrixStatus(state, 'ui'),
      uiEvidence: this.matrixEvidence(state, 'ui'),
      uiNote: this.matrixNote(state, 'ui'),
      apiStatus: this.matrixStatus(state, 'api'),
      apiEvidence: this.matrixEvidence(state, 'api'),
      apiNote: this.matrixNote(state, 'api'),
      dataStatus: this.matrixStatus(state, 'data'),
      dataEvidence: this.matrixEvidence(state, 'data'),
      dataNote: this.matrixNote(state, 'data'),
      terminalStatus: this.matrixStatus(state, 'terminal'),
      terminalEvidence: this.matrixEvidence(state, 'terminal'),
      terminalNote: this.matrixNote(state, 'terminal'),
      documentsList: state.artifacts.filter((a) => a.kind === 'document').map((a) => a.path).join(', ') || '无',
      screenshotsList: state.artifacts.filter((a) => a.kind === 'screenshot').map((a) => a.path).join(', ') || '无',
      logsList: state.artifacts.filter((a) => a.kind === 'log').map((a) => a.path).join(', ') || '无',
      patchesList: state.artifacts.filter((a) => a.kind === 'patch').map((a) => a.path).join(', ') || '无',
      blockersList: state.blockedReasons.length ? state.blockedReasons.map((b) => `- ${b}`).join('\n') : '无',
      nextStepSuggestions: currentStep ? `执行步骤：${currentStep.title}` : '计划已收敛',
    };

    return this.replaceVars(template, vars);
  }

  /* ── 工具方法 ────────────────────────────────────────── */

  private replaceVars(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  private matrixStatus(state: LoopState, dimension: LoopState['verificationMatrix'][number]['dimension']): string {
    const entry = state.verificationMatrix.find((e) => e.dimension === dimension);
    if (!entry) return '未检查';
    return entry.passed ? '✅ 通过' : '❌ 未通过';
  }

  private matrixEvidence(state: LoopState, dimension: LoopState['verificationMatrix'][number]['dimension']): string {
    const entry = state.verificationMatrix.find((e) => e.dimension === dimension);
    if (!entry) return '-';
    return entry.evidence.join('; ') || '-';
  }

  private matrixNote(state: LoopState, dimension: LoopState['verificationMatrix'][number]['dimension']): string {
    const entry = state.verificationMatrix.find((e) => e.dimension === dimension);
    return entry?.note ?? '-';
  }

  private mapStepTypeToDocType(stepType: LoopPlanStep['type']): LoopStepDoc['type'] {
    const map: Record<LoopPlanStep['type'], LoopStepDoc['type']> = {
      analysis: 'requirements',
      design: 'design',
      implementation: 'execution',
      test: 'verification',
      verification: 'verification',
      repair: 'repair',
      summary: 'summary',
      release_check: 'verification',
    };
    return map[stepType] ?? 'execution';
  }

  private async writeToDisk(docPath: string, content: string): Promise<void> {
    if (typeof window === 'undefined' || !window.zytrader?.fs?.write) return;
    await window.zytrader.fs.write(docPath, content, { scope: 'vault' });
  }

  /* ── 降级模板（模板文件不可用时使用） ──────────────── */

  private fallbackTemplate(docType: LoopStepDoc['type']): string {
    const header = `# {{taskName}} ({{stepType}})\n\n> loopId={{loopId}} · stepId={{stepId}} · {{createdAt}}\n\n---\n\n`;
    switch (docType) {
      case 'requirements':
        return `${header}## 目标\n\n{{objective}}\n\n## 约束\n\n待补充\n\n## 成功标准\n\n待补充\n`;
      case 'design':
        return `${header}## 设计目标\n\n{{objective}}\n\n## 架构\n\n待补充\n\n## 验证方案\n\n编译: {{compileStatus}}\nUI: {{uiStatus}}\n接口: {{apiStatus}}\n数据: {{dataStatus}}\n`;
      case 'verification':
        return `${header}## 验证结果\n\n{{passedLabel}}\n\n## 验证矩阵\n\n编译: {{compileStatus}}\nUI: {{uiStatus}}\n接口: {{apiStatus}}\n数据: {{dataStatus}}\n终端: {{terminalStatus}}\n\n## 错误\n\n{{errorsSection}}\n\n## 建议\n\n{{recommendation}}\n`;
      case 'repair':
        return `${header}## 修复原因\n\n{{lastSummary}}\n\n## 重试次数\n\n{{retryCount}}\n`;
      case 'summary':
        return `${header}## 任务概要\n\n目标: {{objective}}\n状态: {{status}}\n轮次: {{iteration}}/{{maxIterations}}\n\n## 验证矩阵\n\n编译: {{compileStatus}}\nUI: {{uiStatus}}\n接口: {{apiStatus}}\n数据: {{dataStatus}}\n终端: {{terminalStatus}}\n`;
      case 'status':
        return `${header}## 当前状态\n\n阶段: {{stage}}\n状态: {{status}}\n轮次: {{iteration}}/{{maxIterations}}\n\n## 验证矩阵\n\n编译: {{compileStatus}}\nUI: {{uiStatus}}\n接口: {{apiStatus}}\n数据: {{dataStatus}}\n终端: {{terminalStatus}}\n`;
      default:
        return `${header}## 执行记录\n\n步骤: {{stepTitle}}\n类型: {{stepType}}\n\n## 验证矩阵\n\n编译: {{compileStatus}}\nUI: {{uiStatus}}\n接口: {{apiStatus}}\n数据: {{dataStatus}}\n终端: {{terminalStatus}}\n`;
    }
  }
}
