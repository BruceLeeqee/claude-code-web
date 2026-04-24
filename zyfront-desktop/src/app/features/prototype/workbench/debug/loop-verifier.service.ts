import { Injectable } from '@angular/core';
import type { LoopState, LoopValidationResult } from './loop-command.types';

/**
 * Loop 验证器
 *
 * 职责（对应文档第 10、11 章）：
 * - 校验修改结果
 * - 判断是否通过
 * - 修复判定与连续失败阈值
 * - 编译失败 → repair；单元测试失败 → repair/blocked；build 失败 → repair
 * - smoke 通过 → review/release；存在 blocker → pause
 * - 同一错误连续失败 3 次 → blocked
 * - 多轮无进展 → failed
 */

/** 同一阻塞原因连续出现的最大次数 */
const MAX_CONSECUTIVE_BLOCKER = 3;
/** 最近验证历史无进展的最大次数 */
const MAX_NO_PROGRESS_RUNS = 5;

@Injectable({ providedIn: 'root' })
export class LoopVerifierService {
  verify(state: LoopState): LoopValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const blockers: string[] = [];

    if (!state.objective.trim()) {
      errors.push('目标描述为空');
      blockers.push('missing-objective');
    }

    // 开发任务门禁：必须有需求和设计文档
    if (state.taskType === 'development' && !state.requirementsDocPath) {
      blockers.push('missing-requirements-doc');
    }
    if (state.taskType === 'development' && !state.designDocPath) {
      blockers.push('missing-design-doc');
    }

    if (state.currentPlan.length === 0 && state.completedSteps.length === 0) {
      warnings.push('尚未生成可执行计划');
    }

    if (state.blockedReasons.length > 0) {
      blockers.push(...state.blockedReasons);
    }

    if (state.iteration >= state.maxIterations) {
      warnings.push('已达到最大轮次限制');
    }

    // 验证矩阵失败检查
    const failedMatrix = state.verificationMatrix.filter(
      (entry) => entry.note !== 'pending' && !entry.passed,
    );
    for (const entry of failedMatrix) {
      if (entry.dimension === 'ui' || entry.dimension === 'api' || entry.dimension === 'data') {
        warnings.push(`${entry.dimension} 验证未通过`);
      } else {
        blockers.push(`${entry.dimension} 验证未通过`);
      }
    }

    // 连续失败阈值检测：同一阻塞原因反复出现
    const consecutiveBlockers = this.detectConsecutiveBlockers(state);
    if (consecutiveBlockers.length > 0) {
      for (const cb of consecutiveBlockers) {
        blockers.push(`连续失败(${cb.count}次): ${cb.reason}`);
      }
    }

    // 多轮无进展检测
    if (this.detectNoProgress(state)) {
      warnings.push(`最近 ${MAX_NO_PROGRESS_RUNS} 轮验证无进展`);
    }

    // 重试次数过多检测
    if (state.retryCount >= MAX_CONSECUTIVE_BLOCKER * 2) {
      warnings.push(`重试次数已达 ${state.retryCount}，可能需要人工介入`);
    }

    const passed = blockers.length === 0;

    // 修复判定规则（对应文档第 10.3 章）
    const recommendation = this.determineRecommendation(state, passed, blockers, failedMatrix);

    return {
      passed,
      stage: state.status === 'planning' ? 'review' : 'integration',
      errors,
      warnings,
      blockers,
      recommendation,
    };
  }

  /* ── 修复判定与连续失败检测 ────────────────────────── */

  private determineRecommendation(
    state: LoopState,
    passed: boolean,
    blockers: string[],
    failedMatrix: LoopState['verificationMatrix'],
  ): LoopValidationResult['recommendation'] {
    if (!passed) {
      // 编译/终端失败 → repair
      const compileOrTerminalFailed = failedMatrix.some(
        (e) => (e.dimension === 'compile' || e.dimension === 'terminal') && !e.passed,
      );
      if (compileOrTerminalFailed) return 'repair';

      // 同一阻塞原因连续失败达到阈值 → pause
      if (this.detectConsecutiveBlockers(state).length > 0) return 'pause';

      // blocker 过多 → pause
      if (blockers.length >= 3) return 'pause';

      return 'repair';
    }

    // 通过的情况
    if (state.currentPlan.length === 0) return 'release';
    if (state.iteration + 1 >= state.maxIterations) return 'stop';
    return 'continue';
  }

  private detectConsecutiveBlockers(state: LoopState): Array<{ reason: string; count: number }> {
    const result: Array<{ reason: string; count: number }> = [];
    const recentValidations = state.validationHistory.slice(-MAX_CONSECUTIVE_BLOCKER);

    if (recentValidations.length < MAX_CONSECUTIVE_BLOCKER) return result;

    // 检查最近 N 次验证是否有相同的 blocker
    const allBlockers = recentValidations.flatMap((v) => v.blockers);
    const blockerCounts = new Map<string, number>();

    for (const b of allBlockers) {
      blockerCounts.set(b, (blockerCounts.get(b) ?? 0) + 1);
    }

    for (const [reason, count] of blockerCounts) {
      if (count >= MAX_CONSECUTIVE_BLOCKER) {
        result.push({ reason, count });
      }
    }

    return result;
  }

  private detectNoProgress(state: LoopState): boolean {
    const recent = state.validationHistory.slice(-MAX_NO_PROGRESS_RUNS);
    if (recent.length < MAX_NO_PROGRESS_RUNS) return false;

    // 如果最近 N 轮全部失败且状态未变化，认为无进展
    const allFailed = recent.every((v) => !v.passed);
    const sameStatus = new Set(recent.map((v) => v.recommendation)).size === 1;

    return allFailed && sameStatus;
  }
}
