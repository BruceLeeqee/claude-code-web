import { Injectable } from '@angular/core';
import type { LoopState, LoopValidationResult } from './loop-command.types';

/**
 * Loop 发布前收敛检查与审批门禁
 *
 * 职责（对应文档第 12-13 章）：
 * - 发布前收敛条件检查
 * - 高风险操作审批门禁
 * - 自动提交/推送/发布权限控制
 * - 变更摘要与发布检查清单
 */

export interface ReleaseCheckResult {
  canRelease: boolean;
  checklist: ReleaseChecklistItem[];
  summary: string;
  requiresApproval: boolean;
  approvalReasons: string[];
}

export interface ReleaseChecklistItem {
  category: 'function' | 'test' | 'build' | 'security' | 'change' | 'approval';
  label: string;
  passed: boolean;
  evidence: string;
  required: boolean;
}

export interface GateDecision {
  allowed: boolean;
  reason: string;
  requiresUserConfirmation: boolean;
}

@Injectable({ providedIn: 'root' })
export class LoopReleaseGateService {

  /**
   * 执行发布前收敛检查
   */
  checkReadiness(state: LoopState, validation?: LoopValidationResult): ReleaseCheckResult {
    const checklist: ReleaseChecklistItem[] = [];
    const approvalReasons: string[] = [];
    let requiresApproval = false;

    // 功能实现完成
    const implementationDone = state.completedSteps.some((s) => s.type === 'implementation' && s.status === 'done');
    checklist.push({
      category: 'function',
      label: '功能实现完成',
      passed: implementationDone,
      evidence: implementationDone ? '存在已完成的 implementation 步骤' : '缺少已完成的 implementation 步骤',
      required: true,
    });

    // 关键测试通过
    const testDone = state.completedSteps.some((s) => s.type === 'test' && s.status === 'done');
    const verificationPassed = !validation || validation.passed;
    checklist.push({
      category: 'test',
      label: '关键测试通过',
      passed: testDone && verificationPassed,
      evidence: testDone ? (verificationPassed ? '测试完成且验证通过' : '测试完成但验证未通过') : '缺少已完成的测试步骤',
      required: true,
    });

    // build 成功
    const buildPassed = state.buildStatus === 'passed';
    checklist.push({
      category: 'build',
      label: 'Build 成功',
      passed: buildPassed,
      evidence: `buildStatus=${state.buildStatus}`,
      required: true,
    });

    // 编译验证矩阵通过
    const compilePassed = state.verificationMatrix.find((e) => e.dimension === 'compile')?.passed ?? false;
    checklist.push({
      category: 'build',
      label: '编译验证通过',
      passed: compilePassed,
      evidence: `compile matrix=${compilePassed ? 'passed' : 'pending/failed'}`,
      required: true,
    });

    // 无已知 blocker
    const noBlockers = state.blockedReasons.length === 0;
    checklist.push({
      category: 'security',
      label: '无已知阻塞项',
      passed: noBlockers,
      evidence: noBlockers ? '无阻塞项' : `阻塞项: ${state.blockedReasons.join(', ')}`,
      required: true,
    });

    // 变更摘要已记录
    const hasSummary = state.lastSummary.trim().length > 0;
    checklist.push({
      category: 'change',
      label: '变更摘要已记录',
      passed: hasSummary,
      evidence: hasSummary ? `摘要: ${state.lastSummary.slice(0, 100)}` : '无变更摘要',
      required: true,
    });

    // 文件变更检查
    const hasFileChanges = state.fileChanges.length > 0;
    checklist.push({
      category: 'change',
      label: '文件变更已记录',
      passed: true,
      evidence: `${state.fileChanges.length} 个文件变更`,
      required: false,
    });

    // 高风险文件变更门禁
    const highRiskFiles = state.fileChanges.filter((f) =>
      /\.(config|module|routing)\.(ts|js)$/i.test(f) ||
      /\/(main|index|app)\.(ts|js)$/i.test(f),
    );
    if (highRiskFiles.length > 0) {
      checklist.push({
        category: 'approval',
        label: '高风险文件变更需确认',
        passed: false,
        evidence: `高风险文件: ${highRiskFiles.join(', ')}`,
        required: false,
      });
      requiresApproval = true;
      approvalReasons.push(`涉及高风险文件: ${highRiskFiles.join(', ')}`);
    }

    // 大范围变更门禁
    if (state.fileChanges.length > 10) {
      checklist.push({
        category: 'approval',
        label: '大范围变更需确认',
        passed: false,
        evidence: `${state.fileChanges.length} 个文件变更（阈值: 10）`,
        required: false,
      });
      requiresApproval = true;
      approvalReasons.push(`变更文件数 ${state.fileChanges.length} 超过阈值 10`);
    }

    // 必要项全部通过才能发布
    const canRelease = checklist.filter((c) => c.required).every((c) => c.passed) && !requiresApproval;

    const passedCount = checklist.filter((c) => c.passed).length;
    const totalCount = checklist.length;
    const summary = `发布检查: ${passedCount}/${totalCount} 项通过${canRelease ? '，可以发布' : requiresApproval ? '，需要审批' : '，未达标'}`;

    return { canRelease, checklist, summary, requiresApproval, approvalReasons };
  }

  /**
   * 检查自动提交权限
   */
  checkGitCommitGate(state: LoopState): GateDecision {
    // 开发任务需要需求和设计文档
    if (state.taskType === 'development') {
      if (!state.requirementsDocPath || !state.designDocPath) {
        return {
          allowed: false,
          reason: '开发任务必须先完成需求和设计文档，才允许自动提交',
          requiresUserConfirmation: true,
        };
      }
    }

    // 有阻塞项时不允许提交
    if (state.blockedReasons.length > 0) {
      return {
        allowed: false,
        reason: `存在 ${state.blockedReasons.length} 个阻塞项，不允许提交`,
        requiresUserConfirmation: false,
      };
    }

    return {
      allowed: true,
      reason: '通过提交门禁',
      requiresUserConfirmation: false,
    };
  }

  /**
   * 检查自动推送权限
   */
  checkGitPushGate(state: LoopState): GateDecision {
    // 自动推送默认需要确认
    return {
      allowed: false,
      reason: '自动推送默认需要用户确认',
      requiresUserConfirmation: true,
    };
  }

  /**
   * 检查自动发布权限
   */
  checkReleaseGate(state: LoopState): GateDecision {
    // 自动发布默认需要确认
    const readiness = this.checkReadiness(state);

    if (!readiness.canRelease && !readiness.requiresApproval) {
      return {
        allowed: false,
        reason: `未满足发布条件: ${readiness.summary}`,
        requiresUserConfirmation: false,
      };
    }

    if (readiness.requiresApproval) {
      return {
        allowed: false,
        reason: `需要审批: ${readiness.approvalReasons.join('; ')}`,
        requiresUserConfirmation: true,
      };
    }

    return {
      allowed: true,
      reason: '满足发布条件',
      requiresUserConfirmation: true, // 即使满足条件也需确认
    };
  }

  /**
   * 渲染发布检查清单为 markdown
   */
  renderChecklist(result: ReleaseCheckResult): string {
    const lines: string[] = [
      '# 发布前检查清单',
      '',
      `> 结果: ${result.canRelease ? '✅ 可以发布' : '❌ 未达标'}`,
      `> ${result.summary}`,
      '',
    ];

    lines.push('| 类别 | 检查项 | 结果 | 证据 | 必要 |');
    lines.push('|------|--------|------|------|------|');

    for (const item of result.checklist) {
      const status = item.passed ? '✅' : '❌';
      const required = item.required ? '是' : '否';
      lines.push(`| ${item.category} | ${item.label} | ${status} | ${item.evidence} | ${required} |`);
    }

    if (result.approvalReasons.length > 0) {
      lines.push('', '## 需要审批', '');
      for (const reason of result.approvalReasons) {
        lines.push(`- ${reason}`);
      }
    }

    return lines.join('\n');
  }
}
