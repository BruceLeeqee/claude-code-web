import { Injectable, inject } from '@angular/core';
import type { LoopPlanStep, LoopState, LoopValidationResult } from './loop-command.types';
import { LoopTeamManagerService, type LoopTeam, type TeamTaskAssignment } from './loop-team-manager.service';
import { LoopArtifactStoreService, type ArtifactIndex } from './loop-artifact-store.service';

/**
 * Loop 仪表盘与团队任务看板
 *
 * 职责（对应文档 P2）：
 * - Loop 仪表盘：稳定展示当前状态与证据
 * - 团队任务看板：展示各团队任务状态与阶段流转
 * - 统一系统状态报告入口
 */

export interface DashboardViewModel {
  loopId: string;
  objective: string;
  status: LoopState['status'];
  stage: LoopState['phase'];
  iteration: number;
  maxIterations: number;
  team: TeamSummary | null;
  verificationMatrix: MatrixRow[];
  planOverview: PlanStepSummary[];
  recentActivity: ActivityEntry[];
  artifactSummary: ArtifactSummary;
  releaseStatus: ReleaseStatus;
}

export interface TeamSummary {
  name: string;
  status: LoopTeam['status'];
  members: Array<{ name: string; role: string }>;
  activeTasks: number;
  completedTasks: number;
}

export interface MatrixRow {
  dimension: string;
  passed: boolean;
  evidence: string;
  note: string;
}

export interface PlanStepSummary {
  id: string;
  title: string;
  type: LoopPlanStep['type'];
  status: LoopPlanStep['status'];
  assignee: string;
}

export interface ActivityEntry {
  timestamp: string;
  action: string;
  detail: string;
}

export interface ArtifactSummary {
  documents: number;
  screenshots: number;
  logs: number;
  patches: number;
  reports: number;
  totalSize: number;
}

export interface ReleaseStatus {
  canRelease: boolean;
  requiresApproval: boolean;
  summary: string;
}

@Injectable({ providedIn: 'root' })
export class LoopDashboardService {
  private readonly teamManager = inject(LoopTeamManagerService);
  private readonly artifactStore = inject(LoopArtifactStoreService);

  /**
   * 构建仪表盘视图
   */
  buildDashboard(state: LoopState, validation?: LoopValidationResult): DashboardViewModel {
    const team = this.buildTeamSummary(state);
    const verificationMatrix = this.buildMatrixRows(state);
    const planOverview = this.buildPlanOverview(state);
    const recentActivity = this.buildRecentActivity(state);
    const artifactSummary = this.buildArtifactSummary(state);

    return {
      loopId: state.loopId,
      objective: state.objective,
      status: state.status,
      stage: state.phase,
      iteration: state.iteration,
      maxIterations: state.maxIterations,
      team,
      verificationMatrix,
      planOverview,
      recentActivity,
      artifactSummary,
      releaseStatus: {
        canRelease: ['ready_for_release', 'completed'].includes(state.status),
        requiresApproval: state.status === 'ready_for_release',
        summary: state.lastSummary,
      },
    };
  }

  /**
   * 渲染仪表盘为可读 markdown
   */
  renderDashboard(dashboard: DashboardViewModel): string {
    const lines: string[] = [
      `# Loop 仪表盘：${dashboard.loopId}`,
      '',
      `## 概要`,
      '',
      `| 字段 | 值 |`,
      `|------|------|`,
      `| 目标 | ${dashboard.objective} |`,
      `| 状态 | ${dashboard.status} |`,
      `| 阶段 | ${dashboard.stage} |`,
      `| 轮次 | ${dashboard.iteration}/${dashboard.maxIterations} |`,
      `| 可发布 | ${dashboard.releaseStatus.canRelease ? '✅' : '❌'} |`,
      `| 需审批 | ${dashboard.releaseStatus.requiresApproval ? '是' : '否'} |`,
      '',
    ];

    // 团队信息
    if (dashboard.team) {
      lines.push('## 团队', '');
      lines.push(`| 字段 | 值 |`);
      lines.push(`|------|------|`);
      lines.push(`| 团队名 | ${dashboard.team.name} |`);
      lines.push(`| 状态 | ${dashboard.team.status} |`);
      lines.push(`| 活跃任务 | ${dashboard.team.activeTasks} |`);
      lines.push(`| 完成任务 | ${dashboard.team.completedTasks} |`);
      lines.push('', '### 成员', '');
      for (const m of dashboard.team.members) {
        lines.push(`- ${m.name} (${m.role})`);
      }
      lines.push('');
    }

    // 验证矩阵
    lines.push('## 验证矩阵', '');
    lines.push('| 维度 | 状态 | 证据 | 备注 |');
    lines.push('|------|------|------|------|');
    for (const row of dashboard.verificationMatrix) {
      lines.push(`| ${row.dimension} | ${row.passed ? '✅' : '❌'} | ${row.evidence} | ${row.note} |`);
    }
    lines.push('');

    // 计划概览
    lines.push('## 计划概览', '');
    lines.push('| ID | 标题 | 类型 | 状态 | 负责人 |');
    lines.push('|---|------|------|------|--------|');
    for (const step of dashboard.planOverview) {
      lines.push(`| ${step.id} | ${step.title} | ${step.type} | ${step.status} | ${step.assignee} |`);
    }
    lines.push('');

    // 最近活动
    if (dashboard.recentActivity.length > 0) {
      lines.push('## 最近活动', '');
      for (const activity of dashboard.recentActivity) {
        lines.push(`- [${activity.timestamp}] ${activity.action}: ${activity.detail}`);
      }
      lines.push('');
    }

    // 工件摘要
    lines.push('## 工件摘要', '');
    lines.push(`| 类型 | 数量 |`);
    lines.push(`|------|------|`);
    lines.push(`| 文档 | ${dashboard.artifactSummary.documents} |`);
    lines.push(`| 截图 | ${dashboard.artifactSummary.screenshots} |`);
    lines.push(`| 日志 | ${dashboard.artifactSummary.logs} |`);
    lines.push(`| 补丁 | ${dashboard.artifactSummary.patches} |`);
    lines.push(`| 报告 | ${dashboard.artifactSummary.reports} |`);

    return lines.join('\n');
  }

  /**
   * 构建团队任务看板视图
   */
  buildTeamKanban(state: LoopState): TeamTaskAssignment[] {
    const team = this.teamManager.createTeam(state);
    const pendingSteps = state.currentPlan.filter(
      (s) => s.status === 'pending' || s.status === 'running',
    );
    return this.teamManager.assignSteps(team, pendingSteps);
  }

  /**
   * 将仪表盘写入磁盘
   */
  async writeDashboardToDisk(dashboard: DashboardViewModel): Promise<boolean> {
    if (typeof window === 'undefined' || !window.zytrader?.fs?.write) return false;

    const content = this.renderDashboard(dashboard);
    const path = `02-AGENT-MEMORY/01-Short-Term/loop/${dashboard.loopId}-dashboard.md`;
    const result = await window.zytrader.fs.write(path, content, { scope: 'vault' });
    return result.ok;
  }

  /* ── 内部方法 ────────────────────────────────────────── */

  private buildTeamSummary(state: LoopState): TeamSummary | null {
    if (!state.teamName) return null;

    const team = this.teamManager.createTeam(state);
    const assignments = this.teamManager.assignSteps(team, state.currentPlan);

    return {
      name: team.name,
      status: team.status,
      members: team.members.map((m) => ({ name: m.name, role: m.role })),
      activeTasks: assignments.length,
      completedTasks: state.completedSteps.length,
    };
  }

  private buildMatrixRows(state: LoopState): MatrixRow[] {
    return state.verificationMatrix.map((e) => ({
      dimension: e.dimension,
      passed: e.passed,
      evidence: e.evidence.join('; ') || '-',
      note: e.note ?? '-',
    }));
  }

  private buildPlanOverview(state: LoopState): PlanStepSummary[] {
    const team = state.teamName ? this.teamManager.createTeam(state) : null;

    return [
      ...state.currentPlan.map((step) => {
        const assignment = team
          ? this.teamManager.assignSteps(team, [step])[0]
          : undefined;
        return {
          id: step.id,
          title: step.title,
          type: step.type,
          status: step.status,
          assignee: assignment?.assigneeName ?? '-',
        };
      }),
      ...state.completedSteps.map((step) => ({
        id: step.id,
        title: step.title,
        type: step.type,
        status: 'done' as const,
        assignee: '-',
      })),
    ];
  }

  private buildRecentActivity(state: LoopState): ActivityEntry[] {
    const activities: ActivityEntry[] = [];

    // 从 toolHistory 提取
    for (const entry of state.toolHistory.slice(-10)) {
      activities.push({
        timestamp: state.updatedAt,
        action: 'tool',
        detail: entry,
      });
    }

    // 从 validationHistory 提取
    for (const v of state.validationHistory.slice(-5)) {
      activities.push({
        timestamp: state.updatedAt,
        action: 'validation',
        detail: `${v.stage}: ${v.passed ? 'passed' : 'failed'}`,
      });
    }

    return activities.slice(-15);
  }

  private buildArtifactSummary(state: LoopState): ArtifactSummary {
    const index = this.artifactStore.buildIndex(state);
    return {
      documents: index.documents.length,
      screenshots: index.screenshots.length,
      logs: index.logs.length,
      patches: index.patches.length,
      reports: index.reports.length,
      totalSize: index.totalSize,
    };
  }
}
