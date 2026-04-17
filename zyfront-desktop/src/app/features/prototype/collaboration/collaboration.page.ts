import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MultiAgentOrchestratorService } from '../../../core/multi-agent/multi-agent.orchestrator.service';
import type { MultiAgentEvent } from '../../../core/multi-agent/multi-agent.events';
import type { TeammateMode, WorkbenchTeamVm, WorkbenchTeammateVm, WorkbenchTaskVm } from '../../../core/multi-agent/multi-agent.types';
import { summarizeMultiAgentEvent, type MultiAgentTimelineTier } from '../../../core/multi-agent/multi-agent.timeline';

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, NzSelectModule, NzIconModule],
  templateUrl: './collaboration.page.html',
  styleUrls: ['../prototype-page.scss', './collaboration.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent implements OnDestroy {
  private readonly multiAgent = inject(MultiAgentOrchestratorService);
  private readonly router = inject(Router);
  private readonly sub = new Subscription();
  private readonly recoveryStorageKey = 'zyfront.collab.recovery.v1';

  /** Teammate 数量目标：用于一键补齐执行者 */
  protected agentCount = '4';
  protected readonly gitBranch = signal('');
  protected readonly dashboardSyncedAt = signal(this.formatDashboardTime(new Date()));
  protected readonly teamVm = signal<WorkbenchTeamVm | null>(null);
  protected readonly draftTeamName = signal('collaboration-team');
  protected readonly flowStep = signal(1);
  protected readonly activeTab = signal<'arena' | 'network' | 'cognitive' | 'monitor'>('arena');
  protected readonly flowSteps = [
    { id: 1, title: '竞技舞台' },
    { id: 2, title: '协作网络' },
    { id: 3, title: '认知实验室' },
    { id: 4, title: '系统监控' },
  ] as const;
  protected readonly workflowStages = [
    { id: 'stage-arena', title: '竞技舞台', hint: 'Agent 交锋与回合展示' },
    { id: 'stage-network', title: '协作网络', hint: '关系图与数据流展示' },
    { id: 'stage-cognitive', title: '认知实验室', hint: '思维链与技能可视化' },
    { id: 'stage-monitor', title: '系统监控', hint: '资源与成本监控' },
  ] as const;
  protected readonly selectedStageId = signal<number>(1);
  protected readonly selectedTaskId = signal<string>('');
  protected readonly currentWizardStep = computed(() => {
    if (this.backendBlockingHint()) return 4;
    if (this.selectedTaskCard()) return 3;
    if (this.agents().length > 0) return this.flowStep() >= 2 ? 2 : 1;
    return 1;
  });
  protected readonly tabs = [
    { id: 'arena', label: '竞技舞台' },
    { id: 'network', label: '协作网络' },
    { id: 'cognitive', label: '认知实验室' },
    { id: 'monitor', label: '系统监控' },
  ] as const;
  protected readonly tabByStage = computed(() => {
    if (this.currentWizardStep() === 1) return 'arena';
    if (this.currentWizardStep() === 2) return 'network';
    if (this.currentWizardStep() === 3) return 'cognitive';
    return 'monitor';
  });
  protected readonly workflowNodes = computed(() => {
    const agents = this.agents();
    const tasks = this.taskCards();
    return [
      {
        id: 'prepare',
        type: 'control',
        title: '创建 Team',
        status: this.teamVm()?.teammates?.length ? 'done' : 'active',
        summary: this.teamSkillSummary().teamName,
        owner: '系统',
      },
      {
        id: 'orchestrate',
        type: 'task',
        title: '任务编排',
        status: tasks.some((task) => task.status === 'running') ? 'active' : tasks.some((task) => task.status === 'assigned') ? 'done' : 'pending',
        summary: `${tasks.length} 个任务 · ${this.taskSummary().unassigned} 待分配`,
        owner: tasks.find((task) => task.ownerAgentId)?.ownerAgentId ? this.ownerName(tasks.find((task) => task.ownerAgentId)?.ownerAgentId ?? '') : '未分配',
      },
      {
        id: 'execute',
        type: 'agent',
        title: 'Agent 执行',
        status: agents.some((agent) => agent.status === 'running') ? 'active' : agents.length ? 'done' : 'pending',
        summary: `${this.agentStats().online} 在线 · ${this.agentStats().executing} 执行中`,
        owner: agents[0]?.name ?? '等待创建',
      },
      {
        id: 'aggregate',
        type: 'recovery',
        title: '事件汇总',
        status: this.backendBlockingHint() ? 'blocked' : this.recentEvents().length ? 'done' : 'pending',
        summary: this.backendBlockingHint() || `${this.filteredRecentEvents().length} 条最近事件`,
        owner: '回收与恢复',
      },
    ] as const;
  });
  protected readonly selectedWorkflowNode = computed(() => {
    const selectedStage = this.selectedStageId();
    const nodes = this.workflowNodes();
    return nodes[Math.min(nodes.length - 1, Math.max(0, selectedStage - 1))];
  });
  protected readonly activeTabId = computed(() => this.activeTab());
  protected readonly networkAgents = computed(() => [
    { id: 'ag1', name: '架构师', x: 22, y: 18, color: '#AA44FF' },
    { id: 'ag2', name: '分析师', x: 62, y: 15, color: '#EEDDFF' },
    { id: 'ag3', name: '开发者', x: 38, y: 52, color: '#7722CC' },
    { id: 'ag4', name: '测试员', x: 76, y: 46, color: '#EEDDFF' },
    { id: 'ag5', name: '产品', x: 52, y: 78, color: '#AA44FF' },
  ]);
  protected readonly pixelParticles = computed(() => [
    { id: 'p1', x: 12, y: 16, size: 4, delay: '0s', phase: 'rise' },
    { id: 'p2', x: 76, y: 9, size: 3, delay: '0.6s', phase: 'glow' },
    { id: 'p3', x: 18, y: 70, size: 5, delay: '1.2s', phase: 'burst' },
    { id: 'p4', x: 88, y: 63, size: 4, delay: '0.2s', phase: 'rise' },
    { id: 'p5', x: 48, y: 24, size: 3, delay: '1.8s', phase: 'glow' },
    { id: 'p6', x: 58, y: 84, size: 5, delay: '1s', phase: 'burst' },
    { id: 'p7', x: 32, y: 42, size: 4, delay: '1.4s', phase: 'rise' },
    { id: 'p8', x: 68, y: 52, size: 3, delay: '0.4s', phase: 'glow' },
  ]);
  protected readonly cognitiveSignals = computed(() => [
    { label: '思维链', value: '82%' },
    { label: '知识检索', value: '74%' },
    { label: '角色一致性', value: '91%' },
    { label: '冲突检测', value: '28%' },
  ]);
  protected readonly systemMetrics = computed(() => [
    { label: 'CPU', value: `${this.mockCpu}%` },
    { label: 'GPU', value: '35%' },
    { label: 'NET', value: '1.2GB/s' },
    { label: 'MEM', value: '64%' },
  ]);
  protected readonly recentEvents = signal<Array<{ at: number; text: string; userText: string; tier: MultiAgentTimelineTier }>>([]);
  protected readonly eventReadableMode = signal<'user' | 'technical'>('user');
  protected readonly eventTierFilter = signal<'all' | MultiAgentTimelineTier>('all');
  protected readonly actionFeedback = signal<{
    tier: MultiAgentTimelineTier;
    text: string;
    reason?: string;
    impact?: string;
    suggestion?: string;
  } | null>(null);
  protected readonly taskCards = signal<WorkbenchTaskVm[]>([
    {
      id: 'task-1',
      title: '统一反馈层',
      goal: '梳理 Spawn/Stop/Kill/Send 的成功失败反馈，并补充恢复建议',
      ownerAgentId: '',
      status: 'unassigned',
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
      status: 'unassigned',
      due: '明天 12:00',
      latestConclusion: '等待分派',
      blocker: '',
      nextStep: '完成事件字段映射',
    },
  ]);
  protected readonly skillCards = computed(() => {
    const vm = this.teamVm();
    const teamName = vm?.teamName?.trim() || this.draftTeamName().trim() || 'collaboration-team';
    const agents = vm?.teammates ?? [];
    return [
      {
        id: 'skill-orchestrate',
        title: '团队编排技能',
        badge: 'Team Init',
        description: '负责创建 team、分配默认执行者，并把协作流推进到可执行状态。',
        accent: 'linear-gradient(135deg, rgba(16,185,129,.35), rgba(96,165,250,.35))',
        tone: 'success',
        summary: `Team：${teamName} · 成员：${agents.length}`,
        status: agents.length > 0 ? '已激活' : '待初始化',
        hint: agents.length > 0 ? '点击可继续补齐执行者并分派任务。' : '点击“创建 Team”开始初始化。',
      },
      {
        id: 'skill-plan',
        title: '任务分解技能',
        badge: 'Plan',
        description: '将目标拆成可分派任务卡，并维护 owner / deadline / next step。',
        accent: 'linear-gradient(135deg, rgba(96,165,250,.35), rgba(192,132,252,.35))',
        tone: 'info',
        summary: `任务卡：${this.taskSummary().total} · 未分配：${this.taskSummary().unassigned}`,
        status: this.taskSummary().unassigned > 0 ? '待分派' : '已分派',
        hint: '完成 Team 初始化后可继续补任务卡。',
      },
      {
        id: 'skill-observe',
        title: '观察回传技能',
        badge: 'Observe',
        description: '跟踪事件流、失败重试、恢复快照和多 Agent 状态变化。',
        accent: 'linear-gradient(135deg, rgba(244,114,182,.25), rgba(245,158,11,.35))',
        tone: 'warning',
        summary: `在线：${this.agentStats().online} · 执行中：${this.agentStats().executing}`,
        status: this.backendBlockingHint() ? '受阻' : '可观察',
        hint: this.backendBlockingHint() || '协作完成后在事件流查看每次状态变化。',
      },
    ];
  });

  protected readonly teamSkillSummary = computed(() => {
    const vm = this.teamVm();
    const teamName = vm?.teamName?.trim() || this.draftTeamName().trim() || 'collaboration-team';
    return {
      teamName,
      totalAgents: vm?.teammates.length ?? 0,
      runningAgents: vm?.runningCount ?? 0,
      stoppedAgents: vm?.stoppedCount ?? 0,
      status: vm?.health?.blocking ? 'blocked' : vm?.teammates.length ? 'ready' : 'empty',
      backend: vm?.effectiveBackend ?? vm?.mode ?? 'auto',
    };
  });

  protected readonly draftTaskTitle = signal('');
  protected readonly draftTaskGoal = signal('');
  protected readonly draftTaskDue = signal('');
  protected readonly agentDrafts = signal(
    Array.from({ length: 8 }, (_, index) => ({
      slot: index + 1,
      name: `agent-${index + 1}`,
      role: index === 0 ? 'Leader' : index === 1 ? 'Planner' : index === 2 ? 'Reviewer' : 'Executor',
      prompt:
        index === 0
          ? '请作为团队首个执行者，建立协作节奏并回传关键结论。'
          : index === 1
            ? '请负责拆解任务、推进依赖，并同步关键里程碑。'
            : index === 2
              ? '请负责复核执行结果、发现风险，并补充改进建议。'
              : '请接手一个可独立完成的子任务并回传关键结论。',
    })),
  );
  protected readonly retryCount = signal(0);
  protected readonly actionAttemptCount = signal(0);
  protected readonly actionFailureCount = signal(0);
  protected readonly actionLatencyMs = signal<number[]>([]);
  protected readonly activeAgentTrend = signal<number[]>([]);
  protected readonly lastRecoveryAt = signal('');
  protected readonly hasRecoverySnapshot = signal(false);
  protected readonly createTeamBusy = signal(false);
  protected readonly createTeamState = signal<{ phase: 'idle' | 'creating' | 'success' | 'error'; text: string } | null>(null);
  protected readonly newAgentModalOpen = signal(false);
  protected readonly skillModalOpen = signal(false);

  protected readonly agentStats = computed(() => {
    const vm = this.teamVm();
    return {
      online: vm ? vm.teammates.filter((a) => a.status !== 'error' && a.status !== 'stopped').length : 0,
      executing: vm?.runningCount ?? 0,
      waiting: vm ? vm.teammates.filter((a) => a.status === 'waiting' || a.status === 'idle').length : 0,
    };
  });

  protected readonly agents = computed(() => this.teamVm()?.teammates ?? []);
  protected readonly targetAgentCount = computed(() => Math.max(1, Number(this.agentCount) || 4));
  protected readonly visibleAgentDrafts = computed(() => this.agentDrafts().slice(0, this.targetAgentCount()));
  protected readonly agentBoardCards = computed(() => {
    const currentAgents = this.agents();
    return this.visibleAgentDrafts().map((draft, index) => ({
      slot: draft.slot,
      draft,
      agent: currentAgents[index] ?? null,
      isPending: index >= currentAgents.length,
    }));
  });
  protected readonly backendBlockingHint = computed(() => {
    const health = this.teamVm()?.health;
    if (!health?.blocking) return '';
    return health.fallbackReason ?? '';
  });
  protected readonly backendSetupHints = computed(() => this.teamVm()?.health?.setupHints ?? []);
  protected tabClass(tabId: 'arena' | 'network' | 'cognitive' | 'monitor'): 'pending' | 'active' | 'done' {
    const order = this.tabs.findIndex((tab) => tab.id === tabId);
    const activeOrder = this.tabs.findIndex((tab) => tab.id === this.activeTab());
    if (order < activeOrder) return 'done';
    if (order === activeOrder) return 'active';
    return 'pending';
  }
  protected readonly nextRecommendation = computed(() => {
    if (this.backendBlockingHint()) {
      return '当前模式不可用，先切换为静默模式或自动模式。';
    }
    if (this.agents().length === 0) {
      return '先创建第一个 Teammate。';
    }
    const unassigned = this.taskCards().find((task) => task.status === 'unassigned');
    if (unassigned) {
      return `任务「${unassigned.title}」尚未分配，建议先指定负责人。`;
    }
    const blocked = this.taskCards().find((task) => task.status === 'blocked');
    if (blocked) {
      return `任务「${blocked.title}」处于阻塞，优先处理。`;
    }
    return '当前任务已在推进，继续观察回传即可。';
  });
  protected readonly taskSummary = computed(() => {
    const cards = this.taskCards();
    return {
      total: cards.length,
      unassigned: cards.filter((x) => x.status === 'unassigned').length,
      assigned: cards.filter((x) => x.status === 'assigned').length,
      running: cards.filter((x) => x.status === 'running').length,
      blocked: cards.filter((x) => x.status === 'blocked').length,
      done: cards.filter((x) => x.status === 'done').length,
      failed: cards.filter((x) => x.status === 'failed').length,
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

  protected readonly filteredRecentEvents = computed(() => {
    const events = this.recentEvents();
    const tier = this.eventTierFilter();
    return tier === 'all' ? events : events.filter((item) => item.tier === tier);
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

  protected currentFlowStepClass(id: number): 'pending' | 'active' | 'done' {
    const cur = this.flowStep();
    if (id < cur) return 'done';
    if (id === cur) return 'active';
    return 'pending';
  }

  protected selectStage(stageId: number): void {
    this.selectedStageId.set(stageId);
    this.flowStep.set(stageId);
    const tabMap: Record<number, 'arena' | 'network' | 'cognitive' | 'monitor'> = {
      1: 'arena',
      2: 'network',
      3: 'cognitive',
      4: 'monitor',
    };
    this.activeTab.set(tabMap[stageId] ?? 'arena');
  }

  protected selectTask(taskId: string): void {
    this.selectedTaskId.set(taskId);
    this.selectedStageId.set(3);
    this.activeTab.set('cognitive');
    this.flowStep.set(3);
  }

  protected selectedTaskCard(): WorkbenchTaskVm | null {
    return this.taskCards().find((task) => task.id === this.selectedTaskId()) ?? null;
  }

  protected selectedTaskLabel(): string {
    return this.selectedTaskCard()?.title ?? '尚未选择任务';
  }

  protected workflowStageClass(id: number): 'pending' | 'active' | 'done' {
    if (id < this.flowStep()) return 'done';
    if (id === this.flowStep()) return 'active';
    return 'pending';
  }

  protected stageNodeClass(stageIndex: number): 'pending' | 'active' | 'done' {
    const mapStep = stageIndex + 1;
    if (mapStep < this.flowStep()) return 'done';
    if (mapStep === this.flowStep()) return 'active';
    return 'pending';
  }

  protected eventTierClass(tier: MultiAgentTimelineTier): 'info' | 'success' | 'warning' | 'error' {
    return tier;
  }

  protected nextFlowStep(): void {
    if (this.flowStep() < this.flowSteps.length) this.flowStep.update((v) => v + 1);
  }

  protected prevFlowStep(): void {
    if (this.flowStep() > 1) this.flowStep.update((v) => v - 1);
  }


  protected async addAgent(): Promise<void> {
    const vm = this.teamVm();
    if (vm?.health?.blocking) return;
    const target = Math.max(1, Number(this.agentCount) || 1);
    const existing = vm?.teammates.length ?? 0;
    if (existing >= target) {
      this.setActionFeedback('info', `当前已达到 ${target} 个执行者，无需补齐`);
      return;
    }
    const teamName = vm?.teamName?.trim() || this.draftTeamName().trim() || 'collaboration-team';
    this.createTeamBusy.set(true);
    try {
      await this.initializeTeam(teamName, target);
      if ((this.teamVm()?.teammates.length ?? 0) >= target) {
        this.flowStep.set(2);
        this.activeTab.set('network');
      }
      this.setActionFeedback('success', `已补齐执行者到 ${target} 个`);
      this.saveRecoverySnapshot();
    } catch (error) {
      console.error('[collaboration] addAgent failed', error);
      this.setActionFeedback('error', '补齐执行者失败', {
        reason: String((error as Error)?.message ?? error),
        impact: '无法继续创建或补齐多 Agent 团队',
        suggestion: '检查后端模式后重试',
      });
    } finally {
      this.createTeamBusy.set(false);
    }
  }

  protected async createTeam(): Promise<void> {
    const name = this.draftTeamName().trim() || 'collaboration-team';
    const target = Math.max(1, Number(this.agentCount) || 4);
    this.draftTeamName.set(name);
    this.flowStep.set(1);
    this.activeTab.set('arena');
    this.createTeamBusy.set(true);
    this.createTeamState.set({ phase: 'creating', text: `正在创建 Team：${name}（目标 ${target} 个成员）` });
    this.setActionFeedback('info', `正在创建 Team：${name}（目标 ${target} 个成员）`);

    try {
      await this.initializeTeam(name, target);
      const actual = this.teamVm()?.teammates.length ?? 0;
      if (actual <= 0) {
        throw new Error('Team 创建后没有返回任何成员，可能是后端创建请求未真正执行。');
      }
      this.seedTeamTasks(name);
      this.flowStep.set(2);
      this.activeTab.set('network');
      this.selectedStageId.set(2);
      this.selectedTaskId.set('');
      this.createTeamState.set({ phase: 'success', text: `Team 已创建：${name}（${actual} 个成员）` });
      this.setActionFeedback('success', `Team 已创建：${name}（${actual} 个成员）`);
      this.saveRecoverySnapshot();
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      console.error('[collaboration] createTeam failed', error);
      this.createTeamState.set({ phase: 'error', text: `Team 创建失败：${message}` });
      this.setActionFeedback('error', 'Team 创建失败', {
        reason: message,
        impact: '无法完成多 Agent 编排初始化',
        suggestion: '检查后端模式是否可用，或切换为自动/静默模式后重试',
      });
    } finally {
      this.createTeamBusy.set(false);
    }
  }

  private async initializeTeam(teamName: string, targetCount: number): Promise<void> {
    await this.multiAgent.setMode('auto');
    const existing = this.teamVm()?.teammates.length ?? 0;
    const toCreate = Math.max(1, targetCount - existing);
    const startCount = existing;
    for (let i = 0; i < toCreate; i += 1) {
      const slotIndex = startCount + i;
      const draft = this.agentDrafts()[slotIndex] ?? {
        slot: slotIndex + 1,
        name: `agent-${slotIndex + 1}`,
        role: 'Executor',
        prompt: '请接手一个可独立完成的子任务并回传关键结论。',
      };
      const index = slotIndex + 1;
      await this.withRetry(
        () =>
          this.multiAgent.spawnTeammate({
            name: draft.name.trim() || `agent-${index}`,
            prompt: draft.prompt.trim() || '请接手一个可独立完成的子任务并回传关键结论。',
            teamName,
          }),
        `创建 Team 成员 ${draft.name.trim() || `agent-${index}`}`,
      );
    }
    this.flowStep.set(2);
    this.refreshDashboard();
  }

  protected updateAgentDraft(slot: number, field: 'name' | 'role' | 'prompt', value: string): void {
    this.agentDrafts.update((drafts) =>
      drafts.map((draft) => (draft.slot === slot ? { ...draft, [field]: value } : draft)),
    );
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

  protected openAgentTerminal(agent: WorkbenchTeammateVm): void {
    this.jumpToWorkbench(agent);
  }

  protected openNewAgentModal(): void {
    this.newAgentModalOpen.set(true);
  }

  protected closeNewAgentModal(): void {
    this.newAgentModalOpen.set(false);
  }

  protected openSkillModal(): void {
    this.skillModalOpen.set(true);
  }

  protected closeSkillModal(): void {
    this.skillModalOpen.set(false);
  }

  protected switchArenaView(view: 'arena' | 'network' | 'cognitive' | 'monitor'): void {
    this.activeTab.set(view);
  }

  protected createTaskCard(): void {
    const title = window.prompt('任务标题：', this.draftTaskTitle());
    if (!title?.trim()) return;
    const goal = window.prompt('任务目标：', this.draftTaskGoal()) ?? '';
    const due = window.prompt('截止时间：', this.draftTaskDue()) ?? '未设置';
    this.addTaskCard(title.trim(), goal.trim(), due.trim());
    this.flowStep.set(3);
    this.setActionFeedback('success', `任务卡片已创建：${title.trim()}`);
  }

  private addTaskCard(title: string, goal: string, due: string, ownerAgentId = ''): void {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.taskCards.update((cards) => [
      ...cards,
      {
        id,
        title,
        goal: goal || '请补充任务目标',
        ownerAgentId,
        status: ownerAgentId ? 'assigned' : 'unassigned',
        due: due || '未设置',
        latestConclusion: '尚未开始',
        blocker: '',
        nextStep: ownerAgentId ? '等待 agent 首次回传' : '请选择执行者并分配任务',
      },
    ]);
    this.selectedTaskId.set(id);
    this.draftTaskTitle.set(title);
    this.draftTaskGoal.set(goal);
    this.draftTaskDue.set(due);
  }

  private seedTeamTasks(teamName: string): void {
    const agents = this.teamVm()?.teammates ?? [];
    if (this.taskCards().length > 2) return;
    const planner = agents[0]?.agentId ?? '';
    const executor = agents[1]?.agentId ?? planner;
    const reviewer = agents[2]?.agentId ?? executor;
    this.addTaskCard(`规划 ${teamName}`, '拆解目标、确认执行路径与依赖', '今天 18:00', planner);
    this.addTaskCard('执行子任务', '落实拆解后的首个可执行动作并回传进展', '今天 20:00', executor);
    this.addTaskCard('结果复核', '检查回传质量、风险与下一步建议', '今天 22:00', reviewer);
  }

  protected statusPill(agent: WorkbenchTeammateVm): { label: string; icon: string; mod: string; spin?: boolean } {
    const map: Record<string, { label: string; icon: string; mod: string; spin?: boolean }> = {
      starting: { label: '重连中', icon: 'loading-3-quarters', mod: 'st-prep', spin: true },
      running: { label: '运行中', icon: 'loading-3-quarters', mod: 'st-exec', spin: true },
      waiting: { label: '后台保活', icon: 'clock-circle', mod: 'st-wait' },
      idle: { label: '已停止', icon: 'pause', mod: 'st-pause' },
      stopping: { label: '已停止', icon: 'pause', mod: 'st-pause' },
      stopped: { label: '已停止', icon: 'check', mod: 'st-done' },
      error: { label: '异常', icon: 'close', mod: 'st-err' },
      detached: { label: '后台保活', icon: 'clock-circle', mod: 'st-wait' },
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

  protected setEventTierFilter(tier: 'all' | MultiAgentTimelineTier): void {
    this.eventTierFilter.set(tier);
  }

  protected renderEventText(item: { text: string; userText: string }): string {
    return this.eventReadableMode() === 'user' ? item.userText : item.text;
  }

  protected ownerName(agentId: string): string {
    if (!agentId) return '未分配';
    return this.agents().find((agent) => agent.agentId === agentId)?.name ?? agentId;
  }

  protected stageSummary(stageId: number): string {
    switch (stageId) {
      case 1:
        return 'Team 初始化与模式确认';
      case 2:
        return '执行者补齐与角色映射';
      case 3:
        return '任务创建、分派与执行';
      case 4:
        return '事件回收、汇总与恢复';
      default:
        return '协作推进中';
    }
  }

  protected statusLabel(status: WorkbenchTaskVm['status']): string {
    const map: Record<WorkbenchTaskVm['status'], string> = {
      unassigned: '待分配',
      assigned: '已分配',
      running: '执行中',
      blocked: '阻塞',
      done: '完成',
      failed: '失败',
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
              status: agentId ? 'assigned' : 'unassigned',
              nextStep: agentId ? '已分派，等待首次回传' : '请选择负责人',
            }
          : task,
      ),
    );
    if (agentId) {
      this.flowStep.set(3);
      this.activeTab.set('cognitive');
      this.selectedTaskId.set(taskId);
    }
  }

  protected async dispatchTask(taskId: string): Promise<void> {
    const task = this.taskCards().find((item) => item.id === taskId);
    if (!task) return;
    if (!task.ownerAgentId) {
      this.setActionFeedback('warning', `任务「${task.title}」未分配负责人`, {
        reason: '缺少负责人',
        impact: '无法发送任务指令',
        suggestion: '先选择一个 Teammate 再点击分配任务',
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
                status: 'running',
                latestConclusion: '任务已下发，等待 agent 首次回传。',
                blocker: '',
                nextStep: '跟踪事件回传并更新结论',
              }
            : item,
        ),
      );
      this.setActionFeedback('success', `任务「${task.title}」已分配给 ${this.ownerName(task.ownerAgentId)}`);
      this.flowStep.set(4);
      this.saveRecoverySnapshot();
    } catch {
      this.taskCards.update((cards) =>
        cards.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: 'failed',
                blocker: '消息投递失败',
                nextStep: '检查 agent 状态后重试分派',
              }
            : item,
        ),
      );
      this.setActionFeedback('error', `任务「${task.title}」分配失败`, {
        reason: '消息通道异常或 Agent 已离线',
        impact: '任务进入阻塞状态',
        suggestion: '检查 Agent 状态后重试，必要时重新分配',
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
        taskCards?: WorkbenchTaskVm[];
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
    for (let attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex += 1) {
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
        if (attemptIndex < maxAttempts) {
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
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown error'));
  }

  private formatDashboardTime(d: Date): string {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private async refreshGitBranch(): Promise<void> {
    const cwd = '.';
    const firstLine = (out: string) => (out ?? '').trim().split(/\r?\n/)[0]?.trim() ?? '';
    try {
      const z = (window as typeof window & { zytrader?: { terminal?: { exec?: (cmd: string, dir: string) => Promise<{ stdout?: string }> } } }).zytrader;
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
