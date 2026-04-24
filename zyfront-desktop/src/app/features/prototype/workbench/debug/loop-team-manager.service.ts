import { Injectable } from '@angular/core';
import type { LoopPlanStep, LoopState, LoopTeamMember, LoopTaskType } from './loop-command.types';

/**
 * Loop 团队管理器
 *
 * 职责（对应文档第 5 章）：
 * - 管理 `/mode-dev` 团队的创建、角色分配与任务派发
 * - 将 /mode-dev 从独立模式变为 loop 中的开发团队编排入口
 * - 支持架构师/开发者/测试员/验证员/修复员五种角色
 */

export interface LoopTeam {
  name: string;
  taskType: LoopTaskType;
  members: LoopTeamMember[];
  assignedSteps: string[];
  status: 'forming' | 'active' | 'idle' | 'disbanded';
}

export interface TeamTaskAssignment {
  stepId: string;
  assigneeRole: LoopTeamMember['role'];
  assigneeName: string;
  instructions: string;
}

@Injectable({ providedIn: 'root' })
export class LoopTeamManagerService {

  /**
   * 根据 loop 状态创建团队
   */
  createTeam(state: LoopState): LoopTeam {
    const teamName = state.teamName || this.defaultTeamName(state.taskType);
    const members = this.buildTeamMembers(teamName);
    const assignedSteps = state.currentPlan.map((s) => s.id);

    return {
      name: teamName,
      taskType: state.taskType,
      members,
      assignedSteps,
      status: 'forming',
    };
  }

  /**
   * 激活团队（需求/设计门禁通过后调用）
   */
  activateTeam(team: LoopTeam): LoopTeam {
    return { ...team, status: 'active' };
  }

  /**
   * 将步骤分配给团队中最合适的角色
   */
  assignSteps(team: LoopTeam, steps: LoopPlanStep[]): TeamTaskAssignment[] {
    return steps.map((step) => {
      const role = this.mapStepToRole(step.type);
      const member = team.members.find((m) => m.role === role) ?? team.members[0]!;
      return {
        stepId: step.id,
        assigneeRole: member.role,
        assigneeName: member.name,
        instructions: this.buildInstruction(step, member.role),
      };
    });
  }

  /**
   * 获取团队状态摘要
   */
  getTeamSummary(team: LoopTeam): string {
    const roleList = team.members.map((m) => `${m.name}(${m.role})`).join(', ');
    return `团队 ${team.name} [${team.status}] — 成员: ${roleList} — 已分配步骤: ${team.assignedSteps.length}`;
  }

  /**
   * 解散团队
   */
  disbandTeam(team: LoopTeam): LoopTeam {
    return { ...team, status: 'disbanded' };
  }

  /* ── 内部方法 ────────────────────────────────────────── */

  private defaultTeamName(taskType: LoopTaskType): string {
    if (taskType === 'development') return 'dev';
    if (taskType === 'testing') return 'test';
    if (taskType === 'docs') return 'docs';
    if (taskType === 'ops') return 'ops';
    return 'general';
  }

  /**
   * 根据团队名构建成员列表（公共入口，供 LoopCommandService 复用）
   */
  buildTeamMembers(teamName: string): LoopTeamMember[] {
    if (teamName === 'dev') {
      return [
        { id: 'architect', name: '架构师', role: 'architect' },
        { id: 'developer', name: '开发者', role: 'developer' },
        { id: 'tester', name: '测试员', role: 'tester' },
        { id: 'verifier', name: '验证员', role: 'verifier' },
        { id: 'fixer', name: '修复员', role: 'fixer' },
      ];
    }
    if (teamName === 'test') {
      return [
        { id: 'tester', name: '测试员', role: 'tester' },
        { id: 'verifier', name: '验证员', role: 'verifier' },
      ];
    }
    if (teamName === 'docs') {
      return [
        { id: 'coordinator', name: '文档协调员', role: 'coordinator' },
      ];
    }
    return [{ id: 'coordinator', name: '协调员', role: 'coordinator' }];
  }

  private mapStepToRole(stepType: LoopPlanStep['type']): LoopTeamMember['role'] {
    const map: Record<LoopPlanStep['type'], LoopTeamMember['role']> = {
      analysis: 'architect',
      design: 'architect',
      implementation: 'developer',
      test: 'tester',
      verification: 'verifier',
      repair: 'fixer',
      summary: 'coordinator',
      release_check: 'verifier',
    };
    return map[stepType] ?? 'coordinator';
  }

  private buildInstruction(step: LoopPlanStep, role: LoopTeamMember['role']): string {
    const base = `[${role}] 执行步骤 "${step.title}"`;
    const acceptance = step.acceptance.length > 0
      ? `，验收标准: ${step.acceptance.join('; ')}`
      : '';
    const risk = step.riskLevel !== 'low'
      ? `，风险等级: ${step.riskLevel}`
      : '';
    return `${base}${acceptance}${risk}`;
  }
}
