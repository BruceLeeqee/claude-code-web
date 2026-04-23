import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgentNodeComponent } from './components/agent-node.component';
import { BattleStageComponent } from './components/battle-stage.component';
import { DebatePanelComponent } from './components/debate-panel.component';
import { TimelineComponent } from './components/timeline.component';
import { OrchestrationCanvasComponent } from './components/orchestration-canvas.component';
import { MultiAgentOrchestratorService } from '../../../core/multi-agent/multi-agent.orchestrator.service';
import { CollaborationStateService, CollaborationAgentVm, CollaborationTeamVm } from './services/collaboration-state.service';
import { ModeManagerService } from './services/mode-manager.service';
import { DebateModeService } from './services/debate-mode.service';
import { DebateAgentService } from './services/debate-agent.service';
import { RedBlueModeService } from './services/red-blue-mode.service';
import { SprintModeService } from './services/sprint-mode.service';
import { TurnBasedModeService } from './services/turn-based-mode.service';
import { ReviewModeService } from './services/review-mode.service';
import { AutoOrchestrationService } from './services/auto-orchestration.service';
import { OrchestrationTemplatesService } from './services/orchestration-templates.service';
import { SnapshotService } from './services/snapshot.service';
import { ErrorRecoveryService } from './services/error-recovery.service';
import { DEBATE_ORCHESTRATION_MOCKS } from './services/debate-orchestration.mock';
import { DebateTopicBridgeService } from './services/debate-topic-bridge.service';

type ViewType = 'arena' | 'network' | 'cognitive';

interface AgentBuildForm {
  name: string;
  role: 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product';
  description: string;
  skills: string[];
  mode: 'coop' | 'pipeline' | 'storm' | 'contest' | 'battle';
  prompt: string;
}

interface AgentEditForm {
  id: string;
  name: string;
  role: 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product';
  prompt: string;
}

interface TeamBuildForm {
  name: string;
  description: string;
  agentIds: string[];
  mode: 'coop' | 'pipeline' | 'storm' | 'contest' | 'battle';
}

interface TaskOrchestrationItem {
  id: string;
  title: string;
  description: string;
  assignedAgentId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];
}

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [CommonModule, FormsModule, AgentNodeComponent, BattleStageComponent, DebatePanelComponent, TimelineComponent, OrchestrationCanvasComponent],
  templateUrl: './collaboration.page.html',
  styleUrls: ['../prototype-page.scss', './collaboration.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly activeTab = this.stateService.activeTab;
  protected readonly modeSnapshot = computed(() => ({
    id: this.stateService.mode(),
    label: this.stateService.modeLabel(),
    description: this.stateService.modeDescription(),
    status: this.stateService.modeStatus(),
  }));
  protected readonly modePalette = computed(() => {
    const mode = this.stateService.mode();
    switch (mode) {
      case 'coop':
        return { badge: '协作模式', tone: 'blue' };
      case 'pipeline':
        return { badge: '流水线模式', tone: 'green' };
      case 'storm':
        return { badge: '脑暴模式', tone: 'yellow' };
      case 'contest':
        return { badge: '竞赛模式', tone: 'pink' };
      default:
        return { badge: '对抗模式', tone: 'red' };
    }
  });

  protected readonly pageSnapshot = this.stateService.snapshot;
  protected readonly isPlaying = signal(false);
  protected speed = 1;
  protected readonly speeds = [1, 2, 4, 8];

  protected showAgentBuildModal = signal(false);
  protected showTeamBuildModal = signal(false);
  protected showTaskOrchestrationModal = signal(false);
  protected showAgentDashboardModal = signal(false);
  protected showAgentEditModal = signal(false);

  protected agentEditForm: AgentEditForm = {
    id: '',
    name: '',
    role: 'developer',
    prompt: '',
  };

  protected agentBuildForm: AgentBuildForm = {
    name: '',
    role: 'developer',
    description: '',
    skills: [],
    mode: 'coop',
    prompt: '',
  };

  protected teamBuildForm: TeamBuildForm = {
    name: '',
    description: '',
    agentIds: [],
    mode: 'coop',
  };

  protected taskOrchestrationList = signal<TaskOrchestrationItem[]>([]);
  protected newTaskTitle = '';
  protected newTaskDescription = '';
  protected newTaskPriority: 'high' | 'medium' | 'low' = 'medium';
  protected newTaskAssignedAgent = '';

  protected agentDashboardData = computed(() => {
    const agents = this.stateService.agents();
    const runtime = this.stateService.runtime();
    const battleStage = this.stateService.battleStage();
    return {
      totalAgents: agents.length,
      runningAgents: agents.filter(a => a.status === 'running' || a.status === 'busy').length,
      idleAgents: agents.filter(a => a.status === 'idle').length,
      errorAgents: agents.filter(a => a.status === 'error').length,
      teams: battleStage.teams,
      runtime,
      agents,
    };
  });

  constructor(
    private orchestrator: MultiAgentOrchestratorService,
    private modeManager: ModeManagerService,
    protected stateService: CollaborationStateService,
    private debateModeService: DebateModeService,
    private debateAgentService: DebateAgentService,
    private redBlueModeService: RedBlueModeService,
    private sprintModeService: SprintModeService,
    private turnBasedModeService: TurnBasedModeService,
    private reviewModeService: ReviewModeService,
    protected snapshotService: SnapshotService,
    protected errorRecoveryService: ErrorRecoveryService,
    private autoOrchestrationService: AutoOrchestrationService,
    protected orchestrationTemplatesService: OrchestrationTemplatesService,
    private debateTopicBridge: DebateTopicBridgeService,
  ) {}

  protected currentModeBadge(): string {
    return this.modePalette().badge;
  }

  protected currentModeTone(): string {
    return this.modePalette().tone;
  }

  private readonly boundKeyDownHandler = this.handleKeyDown.bind(this);

  protected get manualOrchestrationSteps(): string[] {
    return ['1. 创建Agent', '2. 组建Team', '3. 添加Task', '4. Start', '5. 打开Dashboard'];
  }

  protected get debateFlowStage(): string {
    const agentCount = this.stateService.agents().length;
    const teamCount = this.stateService.battleStage().teams.length;
    const taskCount = this.taskOrchestrationList().length;
    if (taskCount > 0 && this.stateService.battleStage().status === 'playing') return 'dashboard';
    if (taskCount > 0) return 'start';
    if (teamCount > 0) return 'task';
    if (agentCount > 0) return 'team';
    return 'agent';
  }

  protected get battleStageData() {
    return this.stateService.battleStage();
  }

  protected get agents() {
    return this.stateService.agents();
  }

  protected switchTab(tab: ViewType): void {
    this.stateService.setActiveTab(tab);
  }

  protected openAgentBuildModal(): void {
    this.showAgentBuildModal.set(true);
    this.agentBuildForm = {
      name: '',
      role: 'developer',
      description: '',
      skills: [],
      mode: 'coop',
      prompt: '',
    };
  }

  protected closeAgentBuildModal(): void {
    this.showAgentBuildModal.set(false);
  }

  protected openAgentEditModal(agent: CollaborationAgentVm): void {
    this.agentEditForm = {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      prompt: agent.prompt ?? '',
    };
    this.showAgentEditModal.set(true);
  }

  protected closeAgentEditModal(): void {
    this.showAgentEditModal.set(false);
  }

  protected submitAgentEdit(): void {
    if (!this.agentEditForm.name) {
      return;
    }
    this.stateService.updateAgent(this.agentEditForm.id, {
      name: this.agentEditForm.name,
      role: this.agentEditForm.role,
      prompt: this.agentEditForm.prompt,
    });
    this.showAgentEditModal.set(false);
  }

  protected deleteAgent(agentId: string): void {
    this.stateService.removeAgent(agentId);
  }

  protected loadPersistentTeams(): void {
    try {
      const teamsJson = localStorage.getItem('persistent-agent-teams');
      if (!teamsJson) return;

      const teams = JSON.parse(teamsJson);
      for (const team of teams) {
        if (team.agents && Array.isArray(team.agents)) {
          for (const agentDef of team.agents) {
            const existing = this.stateService.agents().find(a => a.id === agentDef.id);
            if (!existing) {
              this.stateService.addAgent({
                id: agentDef.id,
                name: agentDef.name || '超体',
                role: agentDef.role || 'developer',
                status: 'idle',
                load: 0,
                skills: [],
                prompt: agentDef.prompt ?? '',
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('加载持久化团队失败:', e);
    }
  }

  protected submitAgentBuild(): void {
    if (!this.agentBuildForm.name) {
      return;
    }

    const newAgent: CollaborationAgentVm = {
      id: `agent-${Date.now()}`,
      name: this.agentBuildForm.name,
      role: this.agentBuildForm.role,
      status: 'idle',
      load: 0,
      skills: this.agentBuildForm.skills,
      prompt: this.agentBuildForm.prompt,
    };

    this.stateService.addAgent(newAgent);
    this.showAgentBuildModal.set(false);
  }

  protected addSkillToForm(skill: string): void {
    if (!this.agentBuildForm.skills.includes(skill)) {
      this.agentBuildForm.skills.push(skill);
    }
  }

  protected removeSkillFromForm(skill: string): void {
    this.agentBuildForm.skills = this.agentBuildForm.skills.filter(s => s !== skill);
  }

  protected openTeamBuildModal(): void {
    this.showTeamBuildModal.set(true);
    this.teamBuildForm = {
      name: '',
      description: '',
      agentIds: [],
      mode: 'coop',
    };
  }

  protected closeTeamBuildModal(): void {
    this.showTeamBuildModal.set(false);
  }

  protected toggleAgentInTeam(agentId: string): void {
    const index = this.teamBuildForm.agentIds.indexOf(agentId);
    if (index === -1) {
      this.teamBuildForm.agentIds.push(agentId);
    } else {
      this.teamBuildForm.agentIds.splice(index, 1);
    }
  }

  protected isAgentInTeam(agentId: string): boolean {
    return this.teamBuildForm.agentIds.includes(agentId);
  }

  protected submitTeamBuild(): void {
    if (!this.teamBuildForm.name || this.teamBuildForm.agentIds.length === 0) {
      return;
    }

    const selectedAgents = this.stateService.agents().filter(agent => this.teamBuildForm.agentIds.includes(agent.id));
    const teamName = this.teamBuildForm.name.toUpperCase();
    const seedX = [18, 32, 68, 82];
    const seedY = [24, 48, 64, 36];

    const newTeam: CollaborationTeamVm = {
      id: `team-${Date.now()}`,
      name: teamName,
      score: 0,
      agents: selectedAgents.map((agent, index) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        position: {
          x: seedX[index % seedX.length],
          y: seedY[index % seedY.length],
        },
      })),
    };

    this.stateService.addTeam(newTeam);
    this.showTeamBuildModal.set(false);
  }

  protected openTaskOrchestrationModal(): void {
    this.showTaskOrchestrationModal.set(true);
    this.newTaskTitle = '';
    this.newTaskDescription = '';
    this.newTaskPriority = 'medium';
    this.newTaskAssignedAgent = '';
  }

  protected closeTaskOrchestrationModal(): void {
    this.showTaskOrchestrationModal.set(false);
  }

  protected addTask(): void {
    if (!this.newTaskTitle) {
      return;
    }

    const newTask: TaskOrchestrationItem = {
      id: `task-${Date.now()}`,
      title: this.newTaskTitle,
      description: this.newTaskDescription,
      assignedAgentId: this.newTaskAssignedAgent || null,
      status: 'pending',
      priority: this.newTaskPriority,
      dependencies: [],
    };

    this.taskOrchestrationList.update(list => [...list, newTask]);
    this.stateService.addTask({
      id: newTask.id,
      title: newTask.title,
      description: newTask.description,
      assignedAgentId: newTask.assignedAgentId,
      status: newTask.status,
      priority: newTask.priority,
      dependencies: newTask.dependencies,
    });

    this.newTaskTitle = '';
    this.newTaskDescription = '';
    this.newTaskPriority = 'medium';
    this.newTaskAssignedAgent = '';
  }

  protected removeTask(taskId: string): void {
    this.taskOrchestrationList.update(list => list.filter(t => t.id !== taskId));
    this.syncFromOrchestrator();
  }

  protected startTask(taskId: string): void {
    const task = this.taskOrchestrationList().find(item => item.id === taskId);
    if (!task || task.status !== 'pending') {
      return;
    }

    const canStart = task.dependencies.every(depId => {
      const dependency = this.taskOrchestrationList().find(item => item.id === depId);
      return dependency?.status === 'completed';
    });
    if (!canStart) {
      return;
    }

    this.taskOrchestrationList.update(list => {
      const item = list.find(i => i.id === taskId);
      if (item) item.status = 'running';
      return [...list];
    });
    this.stateService.updateTaskStatus(taskId, 'running');

    const assignedAgentId = task.assignedAgentId;
    if (assignedAgentId) {
      this.stateService.updateAgentStatus(assignedAgentId, 'running');
    }
    this.refreshDashboardFromState();
    this.cdr.detectChanges();
  }

  protected completeTask(taskId: string): void {
    const task = this.taskOrchestrationList().find(item => item.id === taskId);
    if (!task || task.status !== 'running') {
      return;
    }

    this.taskOrchestrationList.update(list => {
      const item = list.find(i => i.id === taskId);
      if (item) item.status = 'completed';
      return [...list];
    });
    this.stateService.updateTaskStatus(taskId, 'completed', new Date().toISOString());

    const assignedAgentId = task.assignedAgentId;
    if (assignedAgentId) {
      this.stateService.updateAgentStatus(assignedAgentId, 'idle');
    }
    this.refreshDashboardFromState();
    this.cdr.detectChanges();

    const allCompleted = this.taskOrchestrationList().every(t => t.status === 'completed');
    if (allCompleted) {
      this.showTaskOrchestrationModal.set(false);
    }
  }

  protected failTask(taskId: string, error?: string): void {
    const task = this.taskOrchestrationList().find(item => item.id === taskId);
    if (!task || task.status !== 'running') {
      return;
    }

    this.taskOrchestrationList.update(list => {
      const item = list.find(i => i.id === taskId);
      if (item) {
        item.status = 'failed';
        if (error) item.description += `\n错误: ${error}`;
      }
      return [...list];
    });
    this.stateService.updateTaskStatus(taskId, 'failed');

    const assignedAgentId = task.assignedAgentId;
    if (assignedAgentId) {
      this.stateService.updateAgentStatus(assignedAgentId, 'error');
    }
    this.refreshDashboardFromState();
    this.cdr.detectChanges();
  }

  protected retryTask(taskId: string): void {
    const task = this.taskOrchestrationList().find(item => item.id === taskId);
    if (!task || task.status !== 'failed') {
      return;
    }

    this.taskOrchestrationList.update(list => {
      const item = list.find(i => i.id === taskId);
      if (item) item.status = 'pending';
      return [...list];
    });
    this.stateService.updateTaskStatus(taskId, 'pending');
    this.refreshDashboardFromState();
    this.cdr.detectChanges();
  }

  protected saveSnapshot(): void {
    const snapshot = {
      agents: this.stateService.agents(),
      teams: this.stateService.battleStage().teams,
      tasks: this.taskOrchestrationList(),
      mode: this.stateService.mode(),
      runtime: this.stateService.runtime(),
      savedAt: new Date().toISOString(),
    };
    
    localStorage.setItem('collaboration-snapshot', JSON.stringify(snapshot));
  }

  protected restoreLocalSnapshot(): void {
    try {
      const snapshotStr = localStorage.getItem('collaboration-snapshot');
      if (!snapshotStr) {
        console.warn('没有找到可用的快照');
        return;
      }
      
      const snapshot = JSON.parse(snapshotStr);
      
      this.stateService.updateBattleState({
        teams: snapshot.teams,
      });
      
      this.taskOrchestrationList.set(snapshot.tasks || []);
      this.syncFromOrchestrator();
    } catch (error) {
      console.error('恢复快照失败:', error);
    }
  }

  protected autoRecovery(): void {
    const agents = this.stateService.agents();
    const errorAgents = agents.filter(a => a.status === 'error');
    
    errorAgents.forEach(agent => {
      this.stateService.updateAgentStatus(agent.id, 'idle');
    });
    
    const failedTasks = this.taskOrchestrationList().filter(t => t.status === 'failed');
    failedTasks.forEach(task => {
      this.retryTask(task.id);
    });
  }

  protected async startAutoOrchestration(): Promise<void> {
    const mockCase = DEBATE_ORCHESTRATION_MOCKS.find(item => item.id === 'debate-auto');
    if (!mockCase) {
      return;
    }

    this.resetCollaborationScene();
    mockCase.agents.forEach(agent => this.stateService.addAgent(agent));
    mockCase.teams.forEach(team => this.stateService.addTeam(team));
    mockCase.tasks.forEach(task => this.stateService.addTask(task));
    this.taskOrchestrationList.set(mockCase.tasks.map(task => ({ ...task })));

    const pendingTasks = this.taskOrchestrationList().filter(task => task.status === 'pending');
    const availableAgents = this.stateService.agents().filter(agent => agent.status === 'idle');
    pendingTasks.forEach((task, index) => {
      const agent = availableAgents[index % availableAgents.length];
      if (!agent) {
        return;
      }
      this.taskOrchestrationList.update(list => {
        const item = list.find(i => i.id === task.id);
        if (item) item.assignedAgentId = agent.id;
        return [...list];
      });
      this.stateService.assignTask(task.id, agent.id);
      this.stateService.updateAgentStatus(agent.id, 'running');
    });

    this.stateService.updateBattleState({
      teams: mockCase.teams,
      currentTurn: 'AUTO-DEBATE',
      round: 1,
      status: 'playing',
    });

    this.refreshDashboardFromState();
  }

  protected async stopAutoOrchestration(): Promise<void> {
    this.stateService.agents().forEach(agent => {
      this.stateService.updateAgentStatus(agent.id, 'idle');
    });
    this.refreshDashboardFromState();
  }

  protected async suggestAutoOrchestration(): Promise<void> {
    const pendingTasks = this.taskOrchestrationList().filter(task => task.status === 'pending');
    const runningTasks = this.taskOrchestrationList().filter(task => task.status === 'running');
    const idleAgents = this.stateService.agents().filter(agent => agent.status === 'idle');

    console.log('辩论自动编排建议', {
      idleAgents: idleAgents.length,
      pendingTasks: pendingTasks.length,
      runningTasks: runningTasks.length,
      recommendation: pendingTasks.length > idleAgents.length ? '需要更多裁判/辅助Agent' : '可直接启动自动编排',
    });
  }

  protected openAgentDashboardModal(): void {
    this.refreshDashboardFromState();
    this.showAgentDashboardModal.set(true);
  }

  protected closeAgentDashboardModal(): void {
    this.showAgentDashboardModal.set(false);
  }

  protected getTaskStatusClass(status: string): string {
    switch (status) {
      case 'running': return 'status-running';
      case 'completed': return 'status-completed';
      case 'failed': return 'status-failed';
      default: return 'status-pending';
    }
  }

  protected getPriorityClass(priority: string): string {
    switch (priority) {
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      default: return 'priority-low';
    }
  }

  protected modeLabel(): string {
    return this.stateService.modeLabel();
  }

  protected modeDescription(): string {
    return this.stateService.modeDescription();
  }

  protected modeStatus(): string {
    return this.stateService.modeStatus();
  }

  protected summaryValue(key: 'runningAgents' | 'currentTasks' | 'collaborationLevel' | 'syncLatency'): string | number {
    return this.stateService.collaborationSummary()[key];
  }

  protected currentModeSummary(): string {
    return `${this.modeSnapshot().label} · ${this.modeSnapshot().status}`;
  }

  protected orchestrationValue(key: 'planMode' | 'assignedAgents' | 'activeEdges' | 'convergence'): string | number {
    return this.stateService.orchestration()[key];
  }

  protected runtimeValue(key: 'teamCount' | 'agentCount' | 'activeSessions' | 'failedSessions'): string | number {
    return this.stateService.runtime()[key];
  }

  protected togglePlay(): void {
    this.isPlaying.update(v => !v);
  }

  protected setSpeed(newSpeed: number): void {
    this.speed = newSpeed;
  }

  protected resetGame(): void {
    this.resetCollaborationScene();
  }

  protected async createAgent(): Promise<void> {
    await this.orchestrator.spawnTeammate({
      name: `Agent ${this.agents.length + 1}`,
      prompt: '请进入协作并回传关键结论。',
      teamName: this.stateService.battleStage().teams[0]?.name ?? 'TEAM ALPHA',
      mode: 'auto',
      planModeRequired: true,
      description: '由看板按钮创建的协作智能体',
    });
    this.syncFromOrchestrator();
  }

  protected async suggestScale(): Promise<void> {
    this.syncFromOrchestrator();
  }

  protected openAlertSettings(): void {
    console.log('打开告警设置');
  }

  protected async reconnectSessions(): Promise<void> {
    const vm = this.orchestrator.getCurrentVm();
    await Promise.all(vm.teammates.filter(teammate => teammate.backend === 'tmux').map(teammate => this.orchestrator.attachTeammate(teammate.agentId)));
    this.syncFromOrchestrator();
  }

  protected redistribute(): void {
    const vm = this.orchestrator.getCurrentVm();
    const lead = vm.leader?.agentId;
    if (lead) {
      console.log('重新分配任务，leadAgentId:', lead, 'teammateCount:', vm.teammates.length);
    }
    this.syncFromOrchestrator();
  }

  protected syncLocal(): void {
    localStorage.setItem('collaboration-page-snapshot', JSON.stringify({
      snapshot: this.pageSnapshot(),
      savedAt: Date.now(),
    }));
  }

  protected getRoleName(role: string): string {
    const roleMap: Record<string, string> = {
      architect: '架构师',
      analyst: '分析师',
      developer: '开发者',
      tester: '测试员',
      devops: '运维',
      product: '产品',
    };
    return roleMap[role] || role;
  }

  protected getAgentMemory(agent: CollaborationAgentVm): number {
    return Math.round(agent.load * 12.8);
  }

  protected getAgentToken(agent: CollaborationAgentVm): number {
    return Math.round(agent.load * 0.15);
  }

  protected getAgentTeamName(agentId: string): string {
    const teams = this.stateService.battleStage().teams;
    const teamNames: string[] = [];
    for (const team of teams) {
      if (team.agents?.some(a => a.id === agentId)) {
        teamNames.push(team.name);
      }
    }
    return teamNames.length > 0 ? teamNames.join(', ') : '--';
  }

  protected adjustAgentLoad(agentId: string, delta: number): void {
    const agent = this.agents.find(a => a.id === agentId);
    if (!agent) return;
    this.stateService.updateAgentStatus(agentId, agent.status, Math.max(0, agent.load + delta));
  }

  protected handleKeyDown(event: KeyboardEvent): void {
    switch (event.key.toLowerCase()) {
      case 'p':
        this.togglePlay();
        break;
      case 'r':
        this.resetGame();
        break;
      case 'm':
        this.modeManager.toggleMode?.();
        break;
      case 'tab': {
        event.preventDefault();
        const tabs: ViewType[] = ['arena', 'cognitive', 'network'];
        const currentIndex = tabs.indexOf(this.activeTab());
        const nextIndex = (currentIndex + 1) % tabs.length;
        this.switchTab(tabs[nextIndex]);
        break;
      }
    }
  }

  ngOnInit(): void {
    window.addEventListener('keydown', this.boundKeyDownHandler);
    this.ensureDefaultAgent();
    this.loadPersistentTeams();
    this.refreshDashboardFromState();

    const initialMode = this.modeManager.currentMode();
    this.stateService.updateMode(
      initialMode.currentMode,
      '辩论对抗模式',
      '围绕辩题进行正反对抗与裁决',
      initialMode.isActive ? '运行中' : '已停止',
    );
  }

  private ensureDefaultAgent(): void {
    const agents = this.stateService.agents();
    const hasDefault = agents.some(a => a.id === 'default-agent');
    if (!hasDefault) {
      this.stateService.addAgent({
        id: 'default-agent',
        name: '超体',
        role: 'architect',
        status: 'idle',
        load: 0,
        skills: ['System Design', 'Code Review', 'Architecture'],
        prompt: '你是超体，拥有最高权限，负责系统架构设计和协调其他智能体。你可以实例化其他智能体来协助完成任务。',
      });
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.boundKeyDownHandler);
  }

  // 快照相关方法
  protected saveCurrentSnapshot(): void {
    const state = {
      agents: this.stateService.agents(),
      teams: this.stateService.battleStage().teams,
      tasks: this.taskOrchestrationList(),
      mode: this.stateService.mode(),
      runtime: this.stateService.runtime(),
      battleStage: this.stateService.battleStage(),
      collaborationSummary: this.stateService.collaborationSummary(),
      orchestration: this.stateService.orchestration(),
    };
    this.snapshotService.createSnapshot('辩论场景手动保存', state, 'collaboration', '辩论模式协作状态快照');
  }

  protected restoreLatestSnapshot(): void {
    const latest = this.snapshotService.getLatestSnapshot();
    if (latest) {
      this.restoreSnapshot(latest.id);
    }
  }

  protected restoreSnapshot(snapshotId: string): void {
    const snapshot = this.snapshotService.getSnapshotById(snapshotId);
    if (!snapshot) {
      return;
    }

    this.snapshotService.restoreSnapshot(snapshotId);
    this.stateService.resetCollaborationScene(snapshot.state.mode || 'battle');
    snapshot.state.agents?.forEach((agent: CollaborationAgentVm) => this.stateService.addAgent(agent));
    snapshot.state.teams?.forEach((team: CollaborationTeamVm) => this.stateService.addTeam(team));
    snapshot.state.tasks?.forEach((task: TaskOrchestrationItem) => this.stateService.addTask(task));
    this.taskOrchestrationList.set((snapshot.state.tasks || []).map((task: TaskOrchestrationItem) => ({ ...task })));
    this.stateService.updateBattleState(snapshot.state.battleStage || { teams: snapshot.state.teams || [], currentTurn: '--', round: 0, status: 'paused' });
    this.stateService.updateCollaborationSummary(snapshot.state.collaborationSummary || this.stateService.collaborationSummary());
    this.stateService.updateOrchestration(snapshot.state.orchestration || this.stateService.orchestration());
    this.stateService.updateMode(
      snapshot.state.mode,
      '辩论对抗模式',
      '围绕辩题进行正反对抗与裁决',
      '已恢复'
    );
    this.refreshDashboardFromState();
  }

  // 错误恢复相关方法
  protected clearErrors(): void {
    this.errorRecoveryService.clearErrors();
  }

  protected tryRecovery(): void {
    const latestError = this.errorRecoveryService.errors()[this.errorRecoveryService.errors().length - 1];
    if (latestError) {
      this.errorRecoveryService.tryRecovery(latestError.id);
    }
    // 同时恢复快照（如果有的话）
    this.restoreLatestSnapshot();
  }

  // 自动编排相关方法
  protected runAutoOrchestration(): void {
    const agents = this.stateService.agents();
    if (agents.length === 0) {
      this.resetCollaborationScene();
      return;
    }

    this.prepareManualDebateScene();
    const tasks = this.taskOrchestrationList().map(task => ({ ...task }));
    this.taskOrchestrationList.set(tasks);

    this.stateService.updateCollaborationSummary({
      runningAgents: 0,
      currentTasks: tasks.length,
      collaborationLevel: 'High',
      syncLatency: '12ms',
    });

    this.stateService.updateOrchestration({
      planMode: '辩论预设编排',
      assignedAgents: tasks.filter(task => task.assignedAgentId !== null).length,
      activeEdges: tasks.filter(task => task.dependencies.length > 0).length,
      convergence: '预设已生成',
    });
  }

  protected prepareManualDebateScene(): void {
    const agents = this.stateService.agents();
    if (agents.length === 0) {
      this.resetCollaborationScene();
      return;
    }

    const affirmativeAgents = agents.filter(agent => agent.role === 'architect' || agent.role === 'analyst' || agent.role === 'developer');
    const negativeAgents = agents.filter(agent => agent.role === 'tester' || agent.role === 'devops' || agent.role === 'product');
    const judgeAgents = agents.filter(agent => agent.role === 'product' || agent.role === 'architect').slice(0, 1);

    const teamBlueprints: CollaborationTeamVm[] = [
      {
        id: 'team-affirmative',
        name: 'AFFIRMATIVE',
        score: 0,
        agents: affirmativeAgents.map((agent, index) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          position: { x: 18 + index * 10, y: 24 + index * 8 },
        })),
      },
      {
        id: 'team-negative',
        name: 'NEGATIVE',
        score: 0,
        agents: negativeAgents.map((agent, index) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          position: { x: 70 - index * 10, y: 24 + index * 8 },
        })),
      },
      {
        id: 'team-judge',
        name: 'JUDGE',
        score: 0,
        agents: judgeAgents.map((agent, index) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          position: { x: 50, y: 82 + index * 4 },
        })),
      },
    ];

    const tasks: TaskOrchestrationItem[] = [
      {
        id: 'debate-task-opening-affirmative',
        title: '正方开篇立论',
        description: '由正方 Agent 输出开篇论点',
        assignedAgentId: affirmativeAgents[0]?.id ?? null,
        status: 'pending',
        priority: 'high',
        dependencies: [],
      },
      {
        id: 'debate-task-opening-negative',
        title: '反方开篇立论',
        description: '由反方 Agent 输出开篇论点',
        assignedAgentId: negativeAgents[0]?.id ?? null,
        status: 'pending',
        priority: 'high',
        dependencies: [],
      },
      {
        id: 'debate-task-crossfire',
        title: '交叉质询',
        description: '双方针对对方观点展开质询',
        assignedAgentId: affirmativeAgents[1]?.id ?? affirmativeAgents[0]?.id ?? null,
        status: 'pending',
        priority: 'medium',
        dependencies: ['debate-task-opening-affirmative', 'debate-task-opening-negative'],
      },
      {
        id: 'debate-task-verdict',
        title: '裁判裁决',
        description: '裁判 Agent 生成裁决结果',
        assignedAgentId: judgeAgents[0]?.id ?? null,
        status: 'pending',
        priority: 'high',
        dependencies: ['debate-task-crossfire'],
      },
    ];

    this.stateService.resetCollaborationScene('battle');
    agents.forEach(agent => this.stateService.addAgent(agent));
    teamBlueprints.forEach(team => this.stateService.addTeam(team));
    this.taskOrchestrationList.set(tasks.map(task => ({ ...task })));
    tasks.forEach(task => this.stateService.addTask(task));

    this.stateService.updateBattleState({
      teams: teamBlueprints,
      currentTurn: 'MANUAL-DEBATE',
      round: 1,
      status: 'paused',
    });

    this.stateService.updateRuntime({
      teamCount: teamBlueprints.length,
      agentCount: agents.length,
      activeSessions: 0,
      failedSessions: 0,
      currentTasks: tasks.length,
    });

    this.stateService.updateCollaborationSummary({
      runningAgents: 0,
      currentTasks: tasks.length,
      collaborationLevel: 'Medium',
      syncLatency: '18ms',
    });

    this.stateService.updateOrchestration({
      planMode: '辩论预设编排',
      assignedAgents: tasks.filter(task => task.assignedAgentId !== null).length,
      activeEdges: tasks.filter(task => task.dependencies.length > 0).length,
      convergence: '等待手动启动',
    });
  }

  // 模板相关方法
  protected applyTemplate(templateId: string): void {
    const template = this.orchestrationTemplatesService.getTemplateById(templateId);
    if (!template) {
      console.error('模板不存在:', templateId);
      return;
    }

    this.orchestrationTemplatesService.selectTemplate(template);
    this.stateService.resetCollaborationScene(template.mode);
    this.taskOrchestrationList.set([]);

    template.agents.forEach(templateAgent => {
      const newAgent: CollaborationAgentVm = {
        id: templateAgent.id,
        name: templateAgent.name,
        role: templateAgent.role,
        status: 'idle',
        load: 0,
        skills: templateAgent.skills,
      };
      this.stateService.addAgent(newAgent);
    });

    if (template.agents.length > 0) {
      const newTeam: CollaborationTeamVm = {
        id: `team-${Date.now()}`,
        name: template.name,
        score: 0,
        agents: template.agents.map((a, index) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          status: 'idle',
          position: { x: 20 + index * 15, y: 20 + index * 8 },
        })),
      };
      this.stateService.addTeam(newTeam);
    }

    template.tasks.forEach(templateTask => {
      const newTask: TaskOrchestrationItem = {
        id: templateTask.id,
        title: templateTask.title,
        description: templateTask.description,
        assignedAgentId: templateTask.assignedAgentId,
        status: 'pending',
        priority: templateTask.priority,
        dependencies: [],
      };
      this.taskOrchestrationList.update(list => [...list, newTask]);
      this.stateService.addTask(newTask);
    });

    this.stateService.updateMode(
      template.mode,
      template.name,
      template.description,
      '已加载'
    );

    this.stateService.updateBattleState({
      teams: this.stateService.battleStage().teams,
      currentTurn: template.name,
      round: 1,
      status: 'paused',
    });

    // 如果是辩论模式，传递辩论主题到辩论面板
    if (template.mode === 'battle' && template.debateTopic) {
      const debateTopic = {
        id: templateId,
        title: template.debateTopic.title,
        description: template.debateTopic.description,
        sides: [
          {
            id: 'affirmative',
            name: '正方',
            description: template.debateTopic.affirmativeDescription,
          },
          {
            id: 'negative',
            name: '反方',
            description: template.debateTopic.negativeDescription,
          },
        ],
      };
      this.debateTopicBridge.setDebateTopic(debateTopic);

      // 设置团队分配
      const affirmativeAgents = template.agents
        .filter(a => a.id.includes('affirmative'))
        .map(a => a.id);
      const negativeAgents = template.agents
        .filter(a => a.id.includes('negative'))
        .map(a => a.id);
      const judges = template.agents
        .filter(a => a.id.includes('judge'))
        .map(a => a.id);

      this.debateTopicBridge.setTeamAssignments(affirmativeAgents, negativeAgents, judges);
    }

    this.syncFromOrchestrator();
    console.log('模板应用成功:', template.name);
  }

  private syncFromOrchestrator(): void {
    const vm = this.orchestrator.getCurrentVm();
    this.stateService.updateRuntime({
      teamCount: vm.teammates.length > 0 ? 1 : 0,
      agentCount: vm.teammates.length,
      activeSessions: vm.runningCount,
      failedSessions: vm.errorCount,
    });
    this.refreshDashboardFromState();
  }

  private refreshDashboardFromState(): void {
    const tasks = this.stateService.tasks();
    const agents = this.stateService.agents();
    const teams = this.stateService.battleStage().teams;
    const runningTasks = tasks.filter(task => task.status === 'running').length;
    const assignedAgents = tasks.filter(task => task.assignedAgentId !== null).length;
    const activeEdges = tasks.filter(task => task.dependencies.length > 0).length;
    const runningAgents = agents.filter(agent => agent.status === 'running' || agent.status === 'busy').length;

    this.stateService.updateCollaborationSummary({
      runningAgents,
      currentTasks: runningTasks,
      collaborationLevel: runningAgents > 0 ? 'High' : agents.length > 0 ? 'Medium' : 'Low',
      syncLatency: tasks.length > 0 ? '12ms' : '--',
    });

    this.stateService.updateOrchestration({
      planMode: tasks.length > 0 ? '辩论编排' : '未启动',
      assignedAgents,
      activeEdges,
      convergence: tasks.some(task => task.status === 'failed') ? '存在异常' : tasks.every(task => task.status === 'completed') ? '已收敛' : '进行中',
    });

    this.stateService.updateRuntime({
      teamCount: teams.length,
      agentCount: agents.length,
      activeSessions: runningAgents,
      failedSessions: tasks.filter(task => task.status === 'failed').length,
    });
  }

  private resetCollaborationScene(): void {
    this.stateService.resetCollaborationScene('battle');
    this.taskOrchestrationList.set([]);
  }

  // 画布事件处理
  protected onTaskStarted(taskId: string): void {
    this.startTask(taskId);
  }

  protected onTaskCompleted(taskId: string): void {
    this.completeTask(taskId);
  }
}