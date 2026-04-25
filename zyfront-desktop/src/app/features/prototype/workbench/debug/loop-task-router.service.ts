import { Injectable } from '@angular/core';
import type { LoopPlanStep, LoopRequest, LoopState, LoopTaskType } from './loop-command.types';

/**
 * Loop 任务路由器
 *
 * 职责（对应文档第 6 章）：
 * - 根据命令将任务分配给合适团队
 * - 解析 /task team=<teamName> objective=<objective> 命令
 * - 若是开发类任务，必须先进行需求/设计确认
 * - loop 负责追踪各团队任务状态并收集产出
 */

export interface TaskRoutingResult {
  teamName: string;
  taskType: LoopTaskType;
  phase: LoopState['phase'];
  gatePassed: boolean;
  gateReason?: string;
}

@Injectable({ providedIn: 'root' })
export class LoopTaskRouterService {

  /**
   * 根据请求和当前状态，决定任务路由
   */
  route(request: LoopRequest, state?: LoopState): TaskRoutingResult {
    const taskType = request.taskType ?? this.inferTaskType(request.objective);
    const teamName = request.teamName ?? this.defaultTeamName(taskType);

    // 开发类任务强制需求/设计门禁
    if (taskType === 'development') {
      return this.routeDevelopmentTask(request, state, teamName);
    }

    return {
      teamName,
      taskType,
      phase: 'development',
      gatePassed: true,
    };
  }

  /**
   * 解析 /task 命令
   */
  parseTaskCommand(input: string): { teamName: string; objective: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/task')) return null;

    const body = trimmed.slice('/task'.length).trim();
    if (!body) return null;

    const teamMatch = body.match(/team=(\S+)/i);
    const objectiveMatch = body.match(/objective=(.+?)(?:\s+--|\s*$)/i);

    return {
      teamName: teamMatch?.[1]?.toLowerCase() ?? 'general',
      objective: objectiveMatch?.[1]?.trim() ?? body.replace(/team=\S+/i, '').trim(),
    };
  }

  /**
   * 检查开发任务门禁：是否已通过需求/设计阶段
   */
  checkDevelopmentGate(state: LoopState): { passed: boolean; reason?: string } {
    // 检查需求阶段是否完成
    const requirementsStep = state.completedSteps.find((s) => s.id === 'requirements');
    if (!requirementsStep) {
      return { passed: false, reason: '开发任务必须先完成需求阶段' };
    }

    // 检查设计阶段是否完成
    const designStep = state.completedSteps.find((s) => s.id === 'design');
    if (!designStep) {
      return { passed: false, reason: '开发任务必须先完成设计阶段' };
    }

    // 检查需求文档路径
    if (!state.requirementsDocPath) {
      return { passed: false, reason: '开发任务缺少需求文档路径' };
    }

    // 检查设计文档路径
    if (!state.designDocPath) {
      return { passed: false, reason: '开发任务缺少设计文档路径' };
    }

    return { passed: true };
  }

  /**
   * 根据任务类型生成默认步骤模板
   */
  buildStepsForTaskType(taskType: LoopTaskType, objective: string): LoopPlanStep[] {
    switch (taskType) {
      case 'development':
        return this.buildDevelopmentSteps(objective);
      case 'testing':
        return this.buildTestingSteps(objective);
      case 'docs':
        return this.buildDocsSteps(objective);
      case 'ops':
        return this.buildOpsSteps(objective);
      case 'analysis':
        return this.buildAnalysisSteps(objective);
      default:
        return this.buildGeneralSteps(objective);
    }
  }

  /* ── 内部方法 ────────────────────────────────────────── */

  private routeDevelopmentTask(
    request: LoopRequest,
    state: LoopState | undefined,
    teamName: string,
  ): TaskRoutingResult {
    // 如果没有状态，进入需求阶段
    if (!state) {
      return {
        teamName,
        taskType: 'development',
        phase: 'requirements',
        gatePassed: false,
        gateReason: '开发任务需先进入需求阶段',
      };
    }

    // 检查门禁
    const gate = this.checkDevelopmentGate(state);

    if (!gate.passed) {
      // 判断应进入哪个阶段
      const hasRequirements = state.completedSteps.some((s) => s.id === 'requirements');
      const phase = hasRequirements ? 'design' : 'requirements';
      return {
        teamName,
        taskType: 'development',
        phase,
        gatePassed: false,
        gateReason: gate.reason,
      };
    }

    return {
      teamName,
      taskType: 'development',
      phase: 'development',
      gatePassed: true,
    };
  }

  /**
   * 根据目标描述推断任务类型（公共入口，供 LoopCommandService 等复用）
   */
  inferTaskType(objective: string): LoopTaskType {
    const content = objective.toLowerCase();
    if (/(页面|接口|实现|开发|功能|重构|fix|bug|feature|refactor|ui|api)/i.test(content)) return 'development';
    if (/(测试|test|spec|case|coverage)/i.test(content)) return 'testing';
    if (/(文档|docs|readme|design)/i.test(content)) return 'docs';
    if (/(部署|发布|运维|monitor|ops|ci|cd)/i.test(content)) return 'ops';
    if (/(分析|调研|research|investigate)/i.test(content)) return 'analysis';
    return 'general';
  }

  /**
   * 根据任务类型返回默认团队名
   */
  defaultTeamName(taskType: LoopTaskType): string {
    const map: Record<LoopTaskType, string> = {
      development: 'dev',
      testing: 'test',
      docs: 'docs',
      ops: 'ops',
      analysis: 'general',
      general: 'general',
    };
    return map[taskType] ?? 'general';
  }

  private buildTestingSteps(objective: string): LoopPlanStep[] {
    return [
      { id: 'analysis', title: `分析测试需求：${objective}`, type: 'analysis', status: 'pending', dependencies: [], acceptance: ['明确测试范围与策略'], riskLevel: 'low', outputs: ['test-plan'] },
      { id: 'implementation', title: '编写测试用例', type: 'implementation', status: 'pending', dependencies: ['analysis'], acceptance: ['用例可运行'], riskLevel: 'medium', outputs: ['test-files'] },
      { id: 'test', title: '运行测试', type: 'test', status: 'pending', dependencies: ['implementation'], acceptance: ['测试执行完毕'], riskLevel: 'medium', outputs: ['test-results'] },
      { id: 'verification', title: '验证测试覆盖', type: 'verification', status: 'pending', dependencies: ['test'], acceptance: ['覆盖率达标'], riskLevel: 'low', outputs: ['coverage-report'] },
      { id: 'summary', title: '总结测试结果', type: 'summary', status: 'pending', dependencies: ['verification'], acceptance: ['产出测试报告'], riskLevel: 'low', outputs: ['summary'] },
    ];
  }

  private buildDocsSteps(objective: string): LoopPlanStep[] {
    return [
      { id: 'analysis', title: `分析文档需求：${objective}`, type: 'analysis', status: 'pending', dependencies: [], acceptance: ['明确文档结构'], riskLevel: 'low', outputs: ['doc-outline'] },
      { id: 'implementation', title: '编写文档内容', type: 'implementation', status: 'pending', dependencies: ['analysis'], acceptance: ['内容完整'], riskLevel: 'low', outputs: ['doc-file'] },
      { id: 'verification', title: '审阅文档质量', type: 'verification', status: 'pending', dependencies: ['implementation'], acceptance: ['通过审阅'], riskLevel: 'low', outputs: ['review-result'] },
      { id: 'summary', title: '总结文档产出', type: 'summary', status: 'pending', dependencies: ['verification'], acceptance: ['归档完毕'], riskLevel: 'low', outputs: ['summary'] },
    ];
  }

  private buildOpsSteps(objective: string): LoopPlanStep[] {
    return [
      { id: 'analysis', title: `分析运维需求：${objective}`, type: 'analysis', status: 'pending', dependencies: [], acceptance: ['明确部署目标'], riskLevel: 'medium', outputs: ['ops-plan'] },
      { id: 'implementation', title: '执行部署操作', type: 'implementation', status: 'pending', dependencies: ['analysis'], acceptance: ['操作完成'], riskLevel: 'high', outputs: ['ops-result'] },
      { id: 'verification', title: '验证部署结果', type: 'verification', status: 'pending', dependencies: ['implementation'], acceptance: ['服务正常'], riskLevel: 'medium', outputs: ['health-check'] },
      { id: 'summary', title: '总结运维结果', type: 'summary', status: 'pending', dependencies: ['verification'], acceptance: ['产出运维报告'], riskLevel: 'low', outputs: ['summary'] },
    ];
  }

  private buildAnalysisSteps(objective: string): LoopPlanStep[] {
    return [
      { id: 'analysis', title: `调研分析：${objective}`, type: 'analysis', status: 'pending', dependencies: [], acceptance: ['调研结论清晰'], riskLevel: 'low', outputs: ['analysis-report'] },
      { id: 'implementation', title: '指派智能体或团队执行调研', type: 'implementation', status: 'pending', dependencies: ['analysis'], acceptance: ['已创建智能体任务并等待回传'], riskLevel: 'medium', outputs: ['agent-request'] },
      { id: 'summary', title: '输出调研报告', type: 'summary', status: 'pending', dependencies: ['implementation'], acceptance: ['报告可交付'], riskLevel: 'low', outputs: ['summary'] },
    ];
  }

  private buildGeneralSteps(objective: string): LoopPlanStep[] {
    return [
      { id: 'analysis', title: `分析任务：${objective}`, type: 'analysis', status: 'pending', dependencies: [], acceptance: ['明确目标与范围'], riskLevel: 'low', outputs: ['analysis-notes'] },
      { id: 'design', title: '制定方案', type: 'design', status: 'pending', dependencies: ['analysis'], acceptance: ['方案可执行'], riskLevel: 'medium', outputs: ['design-notes'] },
      { id: 'implementation', title: '实现', type: 'implementation', status: 'pending', dependencies: ['design'], acceptance: ['完成最小必要修改'], riskLevel: 'high', outputs: ['changed-files'] },
      { id: 'test', title: '测试', type: 'test', status: 'pending', dependencies: ['implementation'], acceptance: ['测试通过'], riskLevel: 'medium', outputs: ['test-results'] },
      { id: 'verification', title: '验证', type: 'verification', status: 'pending', dependencies: ['test'], acceptance: ['收敛确认'], riskLevel: 'medium', outputs: ['verification-summary'] },
      { id: 'summary', title: '总结', type: 'summary', status: 'pending', dependencies: ['verification'], acceptance: ['产出报告'], riskLevel: 'low', outputs: ['summary-report'] },
    ];
  }

  private buildDevelopmentSteps(objective: string): LoopPlanStep[] {
    return [
      { id: 'requirements', title: `整理需求文档：${objective}`, type: 'analysis', status: 'pending', dependencies: [], acceptance: ['目标、范围、约束、成功标准明确'], riskLevel: 'medium', outputs: ['requirements-doc'] },
      { id: 'design', title: '整理设计文档并确认门禁', type: 'design', status: 'pending', dependencies: ['requirements'], acceptance: ['架构与验证方案可执行'], riskLevel: 'medium', outputs: ['design-doc'] },
      { id: 'mode-dev', title: '进入 /mode-dev 团队编排', type: 'design', status: 'pending', dependencies: ['design'], acceptance: ['开发团队已创建并完成任务分派'], riskLevel: 'low', outputs: ['team-bootstrap'] },
      { id: 'implementation', title: '实现代码修改', type: 'implementation', status: 'pending', dependencies: ['mode-dev'], acceptance: ['完成最小必要修改'], riskLevel: 'high', outputs: ['changed-files'] },
      { id: 'test', title: '运行测试验证', type: 'test', status: 'pending', dependencies: ['implementation'], acceptance: ['测试命令执行并收集结果'], riskLevel: 'medium', outputs: ['test-results'] },
      { id: 'verification', title: '验证收敛结果', type: 'verification', status: 'pending', dependencies: ['test'], acceptance: ['确认是否可继续、修复或停止'], riskLevel: 'medium', outputs: ['verification-summary'] },
      { id: 'release_check', title: '发布前收敛检查', type: 'release_check', status: 'pending', dependencies: ['verification'], acceptance: ['发布清单通过'], riskLevel: 'medium', outputs: ['release-check'] },
      { id: 'summary', title: '输出总结与状态', type: 'summary', status: 'pending', dependencies: ['release_check'], acceptance: ['生成清晰的进度摘要'], riskLevel: 'low', outputs: ['summary-report'] },
    ];
  }
}
