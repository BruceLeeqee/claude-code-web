import { Injectable, inject } from '@angular/core';
import { LoopPatchService, type LoopPatchPlan, type LoopPatchResult } from './loop-patch.service';
import { LoopAstPatcherService, type LoopAstPatchPlan, type LoopAstPatchResult } from './loop-ast-patcher.service';

declare const window: Window & typeof globalThis;

/**
 * Loop 结构化修补引擎
 *
 * 职责（对应文档 P2 和第 11 章修复策略）：
 * - 统一启发式修补和 AST 结构化修补
 * - 修复优先级：语法错误 > 类型错误 > 低级 lint 错误 > 业务逻辑错误 > 风格问题
 * - 修复范围限制：仅修改最小必要文件
 * - 证据驱动：修复必须有明确的错误输出支撑
 * - 连续失败阈值：同一错误连续失败 3 次升级为 blocked
 * - 修补策略选择：根据错误类型自动选择 exact/brace/fallback 模式
 */

export type PatchStrategy = 'exact' | 'brace' | 'heuristic' | 'ast-structured' | 'none';
export type ErrorCategory = 'syntax' | 'type' | 'lint' | 'logic' | 'style' | 'unknown';

export interface StructuredPatchPlan {
  targetPath: string;
  searchPattern: string;
  replaceText: string;
  reason: string;
  strategy: PatchStrategy;
  errorCategory: ErrorCategory;
  scope?: 'workspace' | 'vault';
  priority: number;
}

export interface StructuredPatchResult {
  ok: boolean;
  targetPath: string;
  strategy: PatchStrategy;
  appliedText?: string;
  error?: string;
  errorCategory: ErrorCategory;
}

export interface RepairAnalysis {
  errorCategory: ErrorCategory;
  priority: number;
  suggestedStrategy: PatchStrategy;
  targetFiles: string[];
  reason: string;
  consecutiveFailures: number;
  shouldEscalate: boolean;
}

@Injectable({ providedIn: 'root' })
export class LoopPatchEngineService {
  private readonly patchService = inject(LoopPatchService);
  private readonly astPatcher = inject(LoopAstPatcherService);

  private consecutiveFailures = new Map<string, number>();
  private readonly maxConsecutiveFailures = 3;

  /**
   * 分析错误输出并生成修复计划
   */
  analyzeError(errorOutput: string, workspaceHint = '.'): RepairAnalysis {
    const category = this.categorizeError(errorOutput);
    const strategy = this.selectStrategy(category, errorOutput);
    const targetFiles = this.extractTargetFiles(errorOutput);
    const key = targetFiles[0] ?? errorOutput.slice(0, 80);
    const failures = (this.consecutiveFailures.get(key) ?? 0) + 1;
    this.consecutiveFailures.set(key, failures);

    return {
      errorCategory: category,
      priority: this.categoryPriority(category),
      suggestedStrategy: strategy,
      targetFiles: targetFiles.length > 0 ? targetFiles : [workspaceHint],
      reason: this.buildRepairReason(category, errorOutput),
      consecutiveFailures: failures,
      shouldEscalate: failures >= this.maxConsecutiveFailures,
    };
  }

  /**
   * 执行结构化修复
   */
  async applyStructuredPatch(plan: StructuredPatchPlan): Promise<StructuredPatchResult> {
    try {
      // 根据策略选择执行路径
      switch (plan.strategy) {
        case 'ast-structured':
        case 'brace':
          return await this.applyAstPatch(plan);
        case 'exact':
        case 'heuristic':
          return await this.applyHeuristicPatch(plan);
        case 'none':
        default:
          return {
            ok: false,
            targetPath: plan.targetPath,
            strategy: 'none',
            error: 'no applicable patch strategy',
            errorCategory: plan.errorCategory,
          };
      }
    } catch (error) {
      this.recordFailure(plan.targetPath);
      return {
        ok: false,
        targetPath: plan.targetPath,
        strategy: plan.strategy,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: plan.errorCategory,
      };
    }
  }

  /**
   * 从错误输出自动生成并执行修复
   */
  async autoRepair(errorOutput: string, workspaceHint = '.'): Promise<StructuredPatchResult> {
    const analysis = this.analyzeError(errorOutput, workspaceHint);

    if (analysis.shouldEscalate) {
      return {
        ok: false,
        targetPath: analysis.targetFiles[0] ?? workspaceHint,
        strategy: 'none',
        error: `同一错误已连续失败 ${analysis.consecutiveFailures} 次，升级为 blocked`,
        errorCategory: analysis.errorCategory,
      };
    }

    // 优先尝试 AST 结构化修补
    const astPlan = this.astPatcher.inferRepairPlan(errorOutput, workspaceHint);
    if (astPlan) {
      const structuredPlan: StructuredPatchPlan = {
        targetPath: astPlan.targetPath,
        searchPattern: astPlan.searchPattern,
        replaceText: astPlan.replaceText,
        reason: astPlan.reason,
        strategy: 'ast-structured',
        errorCategory: analysis.errorCategory,
        scope: astPlan.scope,
        priority: analysis.priority,
      };
      const result = await this.applyStructuredPatch(structuredPlan);
      if (result.ok) {
        this.resetFailures(analysis.targetFiles[0] ?? workspaceHint);
        return result;
      }
    }

    // 回退到启发式修补
    const heuristicPlan = this.patchService.inferRepairPlan(errorOutput, workspaceHint);
    if (heuristicPlan) {
      const structuredPlan: StructuredPatchPlan = {
        targetPath: heuristicPlan.targetPath,
        searchPattern: heuristicPlan.previousText,
        replaceText: heuristicPlan.nextText,
        reason: heuristicPlan.reason,
        strategy: 'heuristic',
        errorCategory: analysis.errorCategory,
        scope: heuristicPlan.scope,
        priority: analysis.priority,
      };
      const result = await this.applyStructuredPatch(structuredPlan);
      if (result.ok) {
        this.resetFailures(analysis.targetFiles[0] ?? workspaceHint);
      }
      return result;
    }

    return {
      ok: false,
      targetPath: workspaceHint,
      strategy: 'none',
      error: '无法从错误输出推断修复计划',
      errorCategory: analysis.errorCategory,
    };
  }

  /**
   * 重置指定目标的连续失败计数
   */
  resetFailures(key: string): void {
    this.consecutiveFailures.delete(key);
  }

  /**
   * 获取指定目标的连续失败次数
   */
  getConsecutiveFailures(key: string): number {
    return this.consecutiveFailures.get(key) ?? 0;
  }

  /**
   * 序列化失败计数为可持久化的 Record
   */
  serializeFailures(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, count] of this.consecutiveFailures) {
      result[key] = count;
    }
    return result;
  }

  /**
   * 从 LoopState 恢复失败计数
   */
  restoreFailures(failureMap: Record<string, number>): void {
    this.consecutiveFailures.clear();
    for (const [key, count] of Object.entries(failureMap)) {
      this.consecutiveFailures.set(key, count);
    }
  }

  /* ── 内部方法 ────────────────────────────────────────── */

  private async applyAstPatch(plan: StructuredPatchPlan): Promise<StructuredPatchResult> {
    const astPlan: LoopAstPatchPlan = {
      targetPath: plan.targetPath,
      searchPattern: plan.searchPattern,
      replaceText: plan.replaceText,
      reason: plan.reason,
      scope: plan.scope,
    };

    const result: LoopAstPatchResult = await this.astPatcher.apply(astPlan);

    if (!result.ok) {
      this.recordFailure(plan.targetPath);
    }

    return {
      ok: result.ok,
      targetPath: result.targetPath,
      strategy: result.mode === 'brace' ? 'brace' : result.mode === 'exact' ? 'exact' : plan.strategy,
      appliedText: result.appliedText,
      error: result.error,
      errorCategory: plan.errorCategory,
    };
  }

  private async applyHeuristicPatch(plan: StructuredPatchPlan): Promise<StructuredPatchResult> {
    const patchPlan: LoopPatchPlan = {
      targetPath: plan.targetPath,
      previousText: plan.searchPattern,
      nextText: plan.replaceText,
      reason: plan.reason,
      scope: plan.scope,
    };

    const result: LoopPatchResult = await this.patchService.apply(patchPlan);

    if (!result.ok) {
      this.recordFailure(plan.targetPath);
    }

    return {
      ok: result.ok,
      targetPath: result.targetPath,
      strategy: 'heuristic',
      appliedText: result.appliedText,
      error: result.error,
      errorCategory: plan.errorCategory,
    };
  }

  private categorizeError(output: string): ErrorCategory {
    const lower = output.toLowerCase();
    if (/syntax\s*error|unexpected\s+token|parse\s*error/i.test(lower)) return 'syntax';
    if (/type\s*error|typeerror|cannot\s+find\s+(name|module)|is\s+not\s+assignable/i.test(lower)) return 'type';
    if (/lint|eslint|tslint|warning\s*\(/i.test(lower)) return 'lint';
    if (/assertion\s+failed|expected.*received|test\s+failed|expect\(/i.test(lower)) return 'logic';
    if (/style|format|prettier|indentation/i.test(lower)) return 'style';
    return 'unknown';
  }

  private categoryPriority(category: ErrorCategory): number {
    const map: Record<ErrorCategory, number> = {
      syntax: 100,
      type: 80,
      lint: 60,
      logic: 40,
      style: 20,
      unknown: 50,
    };
    return map[category] ?? 50;
  }

  private selectStrategy(category: ErrorCategory, _output: string): PatchStrategy {
    switch (category) {
      case 'syntax':
      case 'type':
        return 'ast-structured';
      case 'lint':
      case 'style':
        return 'exact';
      case 'logic':
        return 'heuristic';
      default:
        return 'heuristic';
    }
  }

  private extractTargetFiles(output: string): string[] {
    const matches = output.match(/([\w./\\-]+\.(?:ts|tsx|js|jsx|json|html|scss|css))(?::\d+)?/gi) ?? [];
    return [...new Set(matches)];
  }

  private buildRepairReason(category: ErrorCategory, output: string): string {
    switch (category) {
      case 'syntax': return `语法错误修复：${output.slice(0, 100)}`;
      case 'type': return `类型错误修复：${output.slice(0, 100)}`;
      case 'lint': return `Lint 错误修复：${output.slice(0, 100)}`;
      case 'logic': return `逻辑错误修复：${output.slice(0, 100)}`;
      case 'style': return `风格问题修复：${output.slice(0, 100)}`;
      default: return `未知错误修复：${output.slice(0, 100)}`;
    }
  }

  private recordFailure(key: string): void {
    const current = this.consecutiveFailures.get(key) ?? 0;
    this.consecutiveFailures.set(key, current + 1);
  }
}
