import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MultiAgentOrchestratorService } from '../../../core/multi-agent/multi-agent.orchestrator.service';
import type { MultiAgentEvent } from '../../../core/multi-agent/multi-agent.events';
import type { TeammateMode, WorkbenchTeamVm, WorkbenchTeammateVm } from '../../../core/multi-agent/multi-agent.types';
import { summarizeMultiAgentEvent, type MultiAgentTimelineTier } from '../../../core/multi-agent/multi-agent.timeline';

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [NgClass, NgFor, NgIf, DatePipe, FormsModule, NzButtonModule, NzSelectModule, NzIconModule],
  templateUrl: './collaboration.page.html',
  styleUrls: ['../prototype-page.scss', './collaboration.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent implements OnDestroy {
  private readonly multiAgent = inject(MultiAgentOrchestratorService);
  private readonly router = inject(Router);
  private readonly sub = new Subscription();
  private readonly recoveryStorageKey = 'zyfront.collab.recovery.v1';

  /** Agent 数量目标：用于一键补齐 worker */
  protected agentCount = '4';
  protected readonly gitBranch = signal('');
  protected readonly dashboardSyncedAt = signal(this.formatDashboardTime(new Date()));
  protected readonly teamVm = signal<WorkbenchTeamVm | null>(null);
  protected readonly recentEvents = signal<Array<{ at: number; text: string; userText: string; tier: MultiAgentTimelineTier }>>([]);
  protected readonly eventReadableMode = signal<'user' | 'technical'>('user');
  protected readonly actionFeedback = signal<{
    tier: MultiAgentTimelineTier;
    text: string;
    reason?: string;
    impact?: string;
    suggestion?: string;
  } | null>(null);
  protected readonly taskCards = signal<
    Array<{
      id: string;
      title: string;
      goal: string;
      ownerAgentId: string;
      status: 'todo' | 'doing' | 'blocked' | 'done';
      due: string;
      latestConclusion: string;
      blocker: string;
      nextStep: string;
    }>
  >([
    {
      id: 'task-1',
      title: '统一反馈层',
      goal: '梳理 Spawn/Stop/Kill/Send 的成功失败反馈，并补充恢复建议',
      ownerAgentId: '',
      status: 'todo',
      due: '今天 18:00',
      latestConclusion: '尚未开始',
      blocker: '',
      nextStep: '指派给前端执行 Agent',
    },
    {
      id: 'task-2',
      title: '事件分级展示',
      goal: '区分用户可读事件与技术事件，并提供切换',
      ownerAgentId: '',
      status: 'todo',
      due: '明天 12:00',
      latestConclusion: '等待分派',
      blocker: '',
      nextStep: '完成事件字段映射',
    },
  ]);
  protected readonly retryCount = signal(0);
  protected readonly actionAttemptCount = signal(0);
  protected readonly actionFailureCount = signal(0);
  protected readonly actionLatencyMs = signal<number[]>([]);
  protected readonly activeAgentTrend = signal<number[]>([]);
  protected readonly lastRecoveryAt = signal('');
  protected readonly hasRecoverySnapshot = signal(false);

  protected readonly agentStats = computed(() => {
    const vm = this.teamVm();
    return {
      online: vm ? vm.teammates.filter((a) => a.status !== 'error' && a.status !== 'stopped').length : 0,
      executing: vm?.runningCount ?? 0,
      waiting: vm ? vm.teammates.filter((a) => a.status === 'waiting' || a.status === 'idle').length : 0,
    };
  });

  protected readonly agents = computed(() => this.teamVm()?.teammates ?? []);
  protected readonly backendBlockingHint = computed(() => {
    const health = this.teamVm()?.health;
    if (!health?.blocking) return '';
    return health.fallbackReason ?? '';
  });
  protected readonly backendSetupHints = computed(() => this.teamVm()?.health?.setupHints ?? []);
  protected readonly nextRecommendation = computed(() => {
    if (this.backendBlockingHint()) {
      return '后端当前阻断，先切换到 auto/in-process 并按提示完成环境检查。';
    }
    if (this.agents().length === 0) {
      return '先创建首个 Agent，再从任务卡选择 1 个任务并一键分派。';
    }
    const unassigned = this.taskCards().find((task) => !task.ownerAgentId);
    if (unassigned) {
      return `任务「${unassigned.title}」尚未分配，建议先指定负责人。`;
    }
    const blocked = this.taskCards().find((task) => task.status === 'blocked');
    if (blocked) {
      return `任务「${blocked.title}」处于阻塞，优先清理阻塞再推进。`;
    }
    return '当前任务已在推进中，建议观察事件回传并更新任务结论。';
  });
  protected readonly taskSummary = computed(() => {
    const cards = this.taskCards();
    return {
      total: cards.length,
      todo: cards.filter((x) => x.status === 'todo').length,
      doing: cards.filter((x) => x.status === 'doing').length,
      blocked: cards.filter((x) => x.status === 'blocked').length,
      done: cards.filter((x) => x.status === 'done').length,
    };
  });
  protected readonly observability = computed(() => {
    const attempts = this.actionAttemptCount();
    const failures = this.actionFailureCount();
    const latencies = this.actionLatencyMs();
    const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length) : 0;
    const failureRate = attempts > 0 ? Math.round((failures / attempts) * 100) : 0;
    return {
      retries: this.retryCount(),
      attempts,
      failures,
      failureRate,
      avgLatency,
      active: this.agentStats().online,
      trend: this.activeAgentTrend().join(' / ') || '-',
    };
  });

  constructor() {
    this.sub.add(
      this.multiAgent.workbenchTeamVm$.subscribe((vm) => {
        this.teamVm.set(vm);
      }),
    );
    this.sub.add(
      this.multiAgent.events$.subscribe((ev) => this.pushEvent(ev)),
    );

    this.multiAgent.setMode('auto');
    void this.refreshGitBranch();
    this.loadRecoverySnapshotMeta();
    this.sub.add(
      this.multiAgent.workbenchTeamVm$.subscribe((vm) => {
        this.activeAgentTrend.update((trend) => [...trend.slice(-9), vm.runningCount]);
      }),
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  protected refreshDashboard(): void {
    this.dashboardSyncedAt.set(this.formatDashboardTime(new Date()));
    void this.refreshGitBranch();
    this.saveRecoverySnapshot();
  }

  protected setMode(mode: TeammateMode): void {
    this.multiAgent.setMode(mode);
    this.dashboardSyncedAt.set(this.formatDashboardTime(new Date()));
  }

  protected async addAgent(): Promise<void> {
    const vm = this.teamVm();
    if (vm?.health?.blocking) return;
    const target = Math.max(1, Number(this.agentCount) || 1);
    const existing = vm?.teammates.length ?? 0;
    const toCreate = Math.max(1, target - existing);

    for (let i = 0; i < toCreate; i += 1) {
      const index = (this.teamVm()?.teammates.length ?? 0) + 1;
      await this.withRetry(
        () =>
          this.multiAgent.spawnTeammate({
            name: `agent-${index}`,
            prompt: '请接手一个可独立完成的子任务并汇报关键结论。',
            teamName: vm?.teamName || 'collaboration-team',
          }),
        `创建 Agent agent-${index}`,
      );
      this.setActionFeedback('success', `已创建 Agent：agent-${index}`);
    }
    this.saveRecoverySnapshot();
  }

  protected async toggleAgent(agent: WorkbenchTeammateVm): Promise<void> {
    if (agent.status === 'stopped' || agent.status === 'error') return;
    await this.withRetry(() => this.multiAgent.stopTeammate(agent.agentId, 'dashboard toggle stop'), `停止 ${agent.name}`);
    this.setActionFeedback('info', '已请求停止 Agent');
    this.saveRecoverySnapshot();
  }

  protected async advanceAgent(agent: WorkbenchTeammateVm): Promise<void> {
    try {
      await this.withRetry(() => this.multiAgent.sendMessage(agent.agentId, '继续推进并仅回传关键进展。'), `推进 ${agent.name}`);
      this.setActionFeedback('success', '推进消息已发送');
    } catch {
      this.setActionFeedback('error', '推进消息发送失败', {
        reason: 'Agent 不在线或消息通道异常',
        impact: '当前任务不会继续推进',
        suggestion: '检查 Agent 状态后重试，必要时重新创建 Agent',
      });
    }
  }

  protected jumpToWorkbench(agent: WorkbenchTeammateVm): void {
    void this.router.navigate(['/workbench'], {
      queryParams: { focusAgent: agent.agentId, from: 'collaboration' },
    });
  }

  protected statusPill(agent: WorkbenchTeammateVm): { label: string; icon: string; mod: string; spin?: boolean } {
    const map: Record<string, { label: string; icon: string; mod: string; spin?: boolean }> = {
      starting: { label: '准备中', icon: 'loading-3-quarters', mod: 'st-prep', spin: true },
      running: { label: '执行中', icon: 'loading-3-quarters', mod: 'st-exec', spin: true },
      waiting: { label: '等待响应', icon: 'clock-circle', mod: 'st-wait' },
      idle: { label: '空闲', icon: 'pause', mod: 'st-pause' },
      stopping: { label: '停止中', icon: 'pause', mod: 'st-pause' },
      stopped: { label: '已停止', icon: 'check', mod: 'st-done' },
      error: { label: '异常', icon: 'close', mod: 'st-err' },
    };
    return map[agent.status] ?? map['idle'];
  }

  private pushEvent(ev: MultiAgentEvent): void {
    const s = summarizeMultiAgentEvent(ev);
    const item = {
      at: ev.ts,
      text: s.technicalText,
      userText: s.userText,
      tier: s.tier,
    };
    this.recentEvents.set([item, ...this.recentEvents()].slice(0, 40));
  }

  protected setEventReadableMode(mode: 'user' | 'technical'): void {
    this.eventReadableMode.set(mode);
  }

  protected renderEventText(item: { text: string; userText: string }): string {
    return this.eventReadableMode() === 'user' ? item.userText : item.text;
  }

  protected ownerName(agentId: string): string {
    if (!agentId) return '未分配';
    return this.agents().find((agent) => agent.agentId === agentId)?.name ?? agentId;
  }

  protected statusLabel(status: 'todo' | 'doing' | 'blocked' | 'done'): string {
    const map: Record<'todo' | 'doing' | 'blocked' | 'done', string> = {
      todo: '待开始',
      doing: '进行中',
      blocked: '阻塞',
      done: '已完成',
    };
    return map[status];
  }

  protected onAssignTask(taskId: string, agentId: string): void {
    this.taskCards.update((cards) =>
      cards.map((task) =>
        task.id === taskId
          ? {
              ...task,
              ownerAgentId: agentId,
              nextStep: agentId ? '已分派，等待首次回传' : '请选择负责人',
            }
          : task,
      ),
    );
  }

  protected async dispatchTask(taskId: string): Promise<void> {
    const task = this.taskCards().find((item) => item.id === taskId);
    if (!task) return;
    if (!task.ownerAgentId) {
      this.setActionFeedback('warning', `任务「${task.title}」未分配负责人`, {
        reason: '缺少 owner agent',
        impact: '无法发送任务指令',
        suggestion: '先在任务卡中选择一个 Agent 再点击一键分派',
      });
      return;
    }
    try {
      await this.withRetry(
        () => this.multiAgent.sendMessage(task.ownerAgentId, `任务目标：${task.goal}。请开始执行，并回传结论/风险/下一步。`),
        `分派任务 ${task.title}`,
      );
      this.taskCards.update((cards) =>
        cards.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: 'doing',
                latestConclusion: '任务已下发，等待 agent 首次回传。',
                blocker: '',
                nextStep: '跟踪事件回传并更新结论',
              }
            : item,
        ),
      );
      this.setActionFeedback('success', `任务「${task.title}」已分派给 ${this.ownerName(task.ownerAgentId)}`);
      this.saveRecoverySnapshot();
    } catch {
      this.taskCards.update((cards) =>
        cards.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: 'blocked',
                blocker: '消息投递失败',
                nextStep: '检查 agent 状态后重试分派',
              }
            : item,
        ),
      );
      this.setActionFeedback('error', `任务「${task.title}」分派失败`, {
        reason: '消息通道异常或 Agent 已离线',
        impact: '任务进入阻塞状态',
        suggestion: '切换到 Workbench 聚焦该 Agent，确认状态后重试',
      });
    }
  }

  protected saveRecoverySnapshot(): void {
    try {
      const payload = {
        at: Date.now(),
        mode: this.teamVm()?.mode ?? 'auto',
        taskCards: this.taskCards(),
        eventReadableMode: this.eventReadableMode(),
      };
      localStorage.setItem(this.recoveryStorageKey, JSON.stringify(payload));
      this.lastRecoveryAt.set(this.formatDashboardTime(new Date(payload.at)));
      this.hasRecoverySnapshot.set(true);
      this.setActionFeedback('success', '恢复快照已保存');
    } catch {
      this.setActionFeedback('warning', '恢复快照保存失败', {
        reason: '本地存储不可用',
        impact: '页面重开后可能无法恢复任务状态',
        suggestion: '请检查浏览器存储权限',
      });
    }
  }

  protected restoreRecoverySnapshot(): void {
    try {
      const raw = localStorage.getItem(this.recoveryStorageKey);
      if (!raw) {
        this.setActionFeedback('warning', '未找到可恢复快照');
        return;
      }
      const parsed = JSON.parse(raw) as {
        at?: number;
        mode?: TeammateMode;
        taskCards?: Array<{
          id: string;
          title: string;
          goal: string;
          ownerAgentId: string;
          status: 'todo' | 'doing' | 'blocked' | 'done';
          due: string;
          latestConclusion: string;
          blocker: string;
          nextStep: string;
        }>;
        eventReadableMode?: 'user' | 'technical';
      };
      if (parsed.mode) this.multiAgent.setMode(parsed.mode);
      if (parsed.taskCards?.length) this.taskCards.set(parsed.taskCards);
      if (parsed.eventReadableMode) this.eventReadableMode.set(parsed.eventReadableMode);
      if (parsed.at) this.lastRecoveryAt.set(this.formatDashboardTime(new Date(parsed.at)));
      this.hasRecoverySnapshot.set(true);
      this.setActionFeedback('success', '恢复快照已应用');
    } catch {
      this.setActionFeedback('error', '恢复快照损坏，无法恢复');
    }
  }

  private setActionFeedback(
    tier: MultiAgentTimelineTier,
    text: string,
    extras?: { reason?: string; impact?: string; suggestion?: string },
  ): void {
    this.actionFeedback.set({ tier, text, ...extras });
    window.setTimeout(() => {
      if (this.actionFeedback()?.text === text) this.actionFeedback.set(null);
    }, 3500);
  }

  private loadRecoverySnapshotMeta(): void {
    try {
      const raw = localStorage.getItem(this.recoveryStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { at?: number };
      this.hasRecoverySnapshot.set(true);
      if (parsed.at) this.lastRecoveryAt.set(this.formatDashboardTime(new Date(parsed.at)));
    } catch {
      this.hasRecoverySnapshot.set(false);
    }
  }

  private async withRetry<T>(action: () => Promise<T>, actionName: string): Promise<T> {
    const maxAttempts = 2;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.actionAttemptCount.update((v) => v + 1);
      const start = Date.now();
      try {
        const result = await action();
        this.actionLatencyMs.update((list) => [...list.slice(-29), Date.now() - start]);
        return result;
      } catch (error) {
        lastError = error;
        this.actionFailureCount.update((v) => v + 1);
        this.actionLatencyMs.update((list) => [...list.slice(-29), Date.now() - start]);
        if (attempt < maxAttempts) {
          this.retryCount.update((v) => v + 1);
          this.setActionFeedback('warning', `${actionName} 失败，正在自动重试`, {
            reason: String((error as Error)?.message ?? 'unknown'),
            impact: '当前动作短暂中断',
            suggestion: '等待自动重试完成',
          });
          continue;
        }
      }
    }
    throw lastError;
  }

  private formatDashboardTime(d: Date): string {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private async refreshGitBranch(): Promise<void> {
    const cwd = '.';
    const firstLine = (out: string) => (out ?? '').trim().split(/\r?\n/)[0]?.trim() ?? '';
    try {
      const z = window.zytrader;
      if (!z?.terminal?.exec) {
        this.gitBranch.set('');
        return;
      }
      let line = firstLine((await z.terminal.exec('cmd.exe /c git branch --show-current 2>nul', cwd)).stdout ?? '');
      if (!line) {
        line = firstLine((await z.terminal.exec('cmd.exe /c git rev-parse --abbrev-ref HEAD 2>nul', cwd)).stdout ?? '');
      }
      this.gitBranch.set(line);
    } catch {
      this.gitBranch.set('');
    }
  }

  /** 原型底部栏：模拟资源占用 */
  protected readonly mockCpu = 12;
  protected readonly mockMemGb = 1.4;
  protected readonly mockMemTotalGb = 8;
  protected readonly mockUptime = '14h 22m';
}
