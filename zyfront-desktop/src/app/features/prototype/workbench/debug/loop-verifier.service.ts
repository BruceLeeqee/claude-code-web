import { Injectable } from '@angular/core';
import type { LoopState, LoopTaskType, LoopValidationResult } from './loop-command.types';

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

    // 根据任务类型确定哪些验证维度是必需的
    const requiredDimensions = this.getRequiredDimensions(state.taskType);

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
      // 过滤掉与当前任务类型无关的 blocker（如分析任务中的 compile/terminal 验证未通过）
      const irrelevantPatterns = ['compile 验证未通过', 'terminal 验证未通过'];
      const relevantBlockers = state.blockedReasons.filter((reason) => {
        // 如果是验证维度的 blocker，检查是否属于当前任务类型需要的维度
        if (irrelevantPatterns.some((p) => reason.includes(p))) {
          const dimension = reason.startsWith('compile') ? 'compile' : reason.startsWith('terminal') ? 'terminal' : null;
          return dimension ? requiredDimensions.has(dimension) : true;
        }
        return true;
      });
      blockers.push(...relevantBlockers);
    }

    if (state.iteration >= state.maxIterations) {
      warnings.push('已达到最大轮次限制');
    }

    // 验证矩阵失败检查
    // 根据任务类型确定哪些维度是必需的（复用上方已计算的 requiredDimensions）
    const failedMatrix = state.verificationMatrix.filter(
      (entry) => entry.note !== 'pending' && entry.note !== 'skipped' && !entry.passed && requiredDimensions.has(entry.dimension),
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
      // 仅当任务类型需要编译/终端验证时，编译/终端失败才走 repair
      const requiredDimensions = this.getRequiredDimensions(state.taskType);
      const compileOrTerminalFailed = failedMatrix.some(
        (e) => (e.dimension === 'compile' || e.dimension === 'terminal') && !e.passed && requiredDimensions.has(e.dimension),
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

  /**
   * 检测连续出现相同 blocker 的情况。
   * 仅当同一 blocker 在连续的验证记录中反复出现时才触发。
   * 例如：[A, A, A] 连续 3 次出现 blocker A → 触发
   *      [A, B, A] 总共出现 2 次 A 但不连续 → 不触发
   */
  private detectConsecutiveBlockers(state: LoopState): Array<{ reason: string; count: number }> {
    const result: Array<{ reason: string; count: number }> = [];
    const recentValidations = state.validationHistory.slice(-MAX_CONSECUTIVE_BLOCKER * 2);

    if (recentValidations.length < MAX_CONSECUTIVE_BLOCKER) return result;

    // 按顺序遍历，统计每个 blocker 的最大连续出现次数
    const blockerStreak = new Map<string, number>();

    for (const v of recentValidations) {
      const blockers = v.blockers ?? [];
      if (blockers.length === 0) {
        // 清零所有 streak（当前轮无 blocker）
        for (const key of blockerStreak.keys()) {
          blockerStreak.set(key, 0);
        }
        continue;
      }

      // 当前轮的 blocker 集合（去重）
      const currentBlockers = new Set(blockers);

      for (const [reason, streak] of blockerStreak) {
        if (currentBlockers.has(reason)) {
          blockerStreak.set(reason, streak + 1);
        } else {
          blockerStreak.set(reason, 0);
        }
      }

      // 新增的 blocker 初始化 streak
      for (const b of blockers) {
        if (!blockerStreak.has(b)) {
          blockerStreak.set(b, 1);
        }
      }
    }

    for (const [reason, streak] of blockerStreak) {
      if (streak >= MAX_CONSECUTIVE_BLOCKER) {
        result.push({ reason, count: streak });
      }
    }

    return result;
  }

  private detectNoProgress(state: LoopState): boolean {
    const recent = state.validationHistory.slice(-MAX_NO_PROGRESS_RUNS);
    if (recent.length < MAX_NO_PROGRESS_RUNS) return false;

    // 如果最近 N 轮全部失败且 recommendation 未变化，认为无进展
    const allFailed = recent.every((v) => !v.passed);
    const sameRecommendation = new Set(recent.map((v) => v.recommendation)).size === 1;

    return allFailed && sameRecommendation;
  }

  /**
   * 根据任务类型确定哪些验证维度是必需的。
   * analysis / docs / general 类任务不需要 compile / terminal 验证。
   */
  private getRequiredDimensions(taskType: LoopTaskType): Set<string> {
    switch (taskType) {
      case 'development':
      case 'testing':
      case 'ops':
        return new Set(['compile', 'ui', 'api', 'data', 'terminal']);
      case 'docs':
        return new Set(['ui']); // 文档任务只需基本的 UI 检查
      case 'analysis':
      case 'general':
      default:
        return new Set(); // 分析/通用任务不需要编译/终端验证
    }
  }
}
