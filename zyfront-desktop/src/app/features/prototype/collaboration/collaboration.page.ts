import { ChangeDetectionStrategy, Component, computed, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgentNodeComponent } from './components/agent-node.component';
import { BattleStageComponent } from './components/battle-stage.component';
import { DebatePanelComponent } from './components/debate-panel.component';
import { ModeSelectorComponent } from './components/mode-selector.component';
import { TimelineComponent } from './components/timeline.component';
import { SharedWorkspaceComponent } from './components/shared-workspace.component';
import { MultiAgentOrchestratorService } from '../../../core/multi-agent/multi-agent.orchestrator.service';
import { CollaborationStateService, CollaborationAgentVm, CollaborationTeamVm } from './services/collaboration-state.service';
import { ModeManagerService } from './services/mode-manager.service';

type ViewType = 'arena' | 'network' | 'cognitive' | 'monitor';

interface AgentBuildForm {
  name: string;
  role: 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product';
  description: string;
  skills: string[];
  mode: 'coop' | 'pipeline' | 'storm' | 'contest' | 'battle';
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
  assignedAgentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];
}

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [CommonModule, FormsModule, AgentNodeComponent, BattleStageComponent, DebatePanelComponent, ModeSelectorComponent, TimelineComponent, SharedWorkspaceComponent],
  templateUrl: './collaboration.page.html',
  styleUrls: ['../prototype-page.scss', './collaboration.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent implements OnInit, OnDestroy {
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

  protected agentBuildForm: AgentBuildForm = {
    name: '',
    role: 'developer',
    description: '',
    skills: [],
    mode: 'coop',
  };

  protected teamBuildForm: TeamBuildForm = {
    name: '',
    description: '',
    agentIds: [],
    mode: 'coop',
  };

  protected taskOrchestrationList: TaskOrchestrationItem[] = [];
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
    private stateService: CollaborationStateService,
  ) {}

  protected currentModeBadge(): string {
    return this.modePalette().badge;
  }

  protected currentModeTone(): string {
    return this.modePalette().tone;
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
    };
  }

  protected closeAgentBuildModal(): void {
    this.showAgentBuildModal.set(false);
  }

  protected async submitAgentBuild(): Promise<void> {
    if (!this.agentBuildForm.name) {
      return;
    }
    
    try {
      await this.orchestrator.spawnTeammate({
        name: this.agentBuildForm.name,
        prompt: this.agentBuildForm.description || '请执行分配的任务。',
        teamName: this.stateService.battleStage().teams[0]?.name ?? 'TEAM ALPHA',
        mode: 'auto',
        planModeRequired: true,
        description: `角色: ${this.agentBuildForm.role}, 技能: ${this.agentBuildForm.skills.join(', ')}`,
      });

      const newAgentId = `agent-${Date.now()}`;
      const newAgent: CollaborationAgentVm = {
        id: newAgentId,
        name: this.agentBuildForm.name,
        role: this.agentBuildForm.role,
        status: 'idle',
        load: 0,
        skills: this.agentBuildForm.skills,
      };
      
      this.stateService.addAgent(newAgent);
      this.syncFromOrchestrator();
      
      this.showAgentBuildModal.set(false);
    } catch (error) {
      console.error('创建智能体失败:', error);
      const newAgentId = `agent-${Date.now()}`;
      const newAgent: CollaborationAgentVm = {
        id: newAgentId,
        name: this.agentBuildForm.name,
        role: this.agentBuildForm.role,
        status: 'error',
        load: 0,
        skills: this.agentBuildForm.skills,
      };
      this.stateService.addAgent(newAgent);
      this.showAgentBuildModal.set(false);
    }
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

  protected async submitTeamBuild(): Promise<void> {
    if (!this.teamBuildForm.name || this.teamBuildForm.agentIds.length === 0) {
      return;
    }
    
    try {
      const newTeamId = `team-${Date.now()}`;
      const selectedAgents = this.stateService.agents().filter(a => this.teamBuildForm.agentIds.includes(a.id));
      
      const newTeam: CollaborationTeamVm = {
        id: newTeamId,
        name: this.teamBuildForm.name.toUpperCase(),
        score: 0,
        agents: selectedAgents.map(a => ({
          id: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
          position: { x: Math.random() * 80 + 10, y: Math.random() * 80 + 10 },
        })),
      };
      
      this.stateService.addTeam(newTeam);
      this.syncFromOrchestrator();
      
      this.showTeamBuildModal.set(false);
    } catch (error) {
      console.error('创建团队失败:', error);
      this.showTeamBuildModal.set(false);
    }
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
      assignedAgentId: this.newTaskAssignedAgent || 'unassigned',
      status: 'pending',
      priority: this.newTaskPriority,
      dependencies: [],
    };
    
    this.taskOrchestrationList.push(newTask);
    
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
    this.syncFromOrchestrator();
  }

  protected removeTask(taskId: string): void {
    this.taskOrchestrationList = this.taskOrchestrationList.filter(t => t.id !== taskId);
    this.syncFromOrchestrator();
  }

  protected startTask(taskId: string): void {
    const task = this.taskOrchestrationList.find(t => t.id === taskId);
    if (task && task.status === 'pending') {
      task.status = 'running';
      this.stateService.updateTaskStatus(taskId, 'running');
      
      if (task.assignedAgentId && task.assignedAgentId !== 'unassigned') {
        this.stateService.updateAgentStatus(task.assignedAgentId, 'running');
      }
      this.syncFromOrchestrator();
    }
  }

  protected completeTask(taskId: string): void {
    const task = this.taskOrchestrationList.find(t => t.id === taskId);
    if (task && task.status === 'running') {
      task.status = 'completed';
      this.stateService.updateTaskStatus(taskId, 'completed', new Date().toISOString());
      
      if (task.assignedAgentId && task.assignedAgentId !== 'unassigned') {
        this.stateService.updateAgentStatus(task.assignedAgentId, 'idle');
      }
      this.syncFromOrchestrator();
    }
  }

  protected failTask(taskId: string, error?: string): void {
    const task = this.taskOrchestrationList.find(t => t.id === taskId);
    if (task && task.status === 'running') {
      task.status = 'failed';
      this.stateService.updateTaskStatus(taskId, 'failed');
      
      if (task.assignedAgentId && task.assignedAgentId !== 'unassigned') {
        this.stateService.updateAgentStatus(task.assignedAgentId, 'error');
      }
      this.syncFromOrchestrator();
    }
  }

  protected retryTask(taskId: string): void {
    const task = this.taskOrchestrationList.find(t => t.id === taskId);
    if (task && task.status === 'failed') {
      task.status = 'pending';
      this.stateService.updateTaskStatus(taskId, 'pending');
      this.syncFromOrchestrator();
    }
  }

  protected saveSnapshot(): void {
    const snapshot = {
      agents: this.stateService.agents(),
      teams: this.stateService.battleStage().teams,
      tasks: this.taskOrchestrationList,
      mode: this.stateService.mode(),
      runtime: this.stateService.runtime(),
      savedAt: new Date().toISOString(),
    };
    
    localStorage.setItem('collaboration-snapshot', JSON.stringify(snapshot));
  }

  protected restoreSnapshot(): void {
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
      
      this.taskOrchestrationList = snapshot.tasks || [];
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
    
    const failedTasks = this.taskOrchestrationList.filter(t => t.status === 'failed');
    failedTasks.forEach(task => {
      this.retryTask(task.id);
    });
  }

  protected async startAutoOrchestration(): Promise<void> {
    const agents = this.stateService.agents();
    const tasks = this.taskOrchestrationList;
    
    const idleAgents = agents.filter(a => a.status === 'idle');
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    
    for (let i = 0; i < Math.min(idleAgents.length, pendingTasks.length); i++) {
      const agent = idleAgents[i];
      const task = pendingTasks[i];
      
      task.assignedAgentId = agent.id;
      this.stateService.assignTask(task.id, agent.id);
      this.stateService.updateAgentStatus(agent.id, 'running');
    }
    
    this.syncFromOrchestrator();
  }

  protected async stopAutoOrchestration(): Promise<void> {
    const agents = this.stateService.agents();
    
    const runningAgents = agents.filter(a => a.status === 'running');
    runningAgents.forEach(agent => {
      this.stateService.updateAgentStatus(agent.id, 'idle');
    });
    
    this.syncFromOrchestrator();
  }

  protected async suggestAutoOrchestration(): Promise<void> {
    const agents = this.stateService.agents();
    const tasks = this.taskOrchestrationList;
    
    const idleAgents = agents.filter(a => a.status === 'idle');
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const runningTasks = tasks.filter(t => t.status === 'running');
    
    console.log('编排建议:', {
      idleAgents: idleAgents.length,
      pendingTasks: pendingTasks.length,
      runningTasks: runningTasks.length,
      recommendation: pendingTasks.length > idleAgents.length 
        ? '需要更多Agent' 
        : pendingTasks.length === 0 
          ? '所有任务已分配' 
          : '可以自动分配任务',
    });
  }

  protected openAgentDashboardModal(): void {
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
    this.stateService.updateRuntime({
      teamCount: 0,
      agentCount: 0,
      activeSessions: 0,
      failedSessions: 0,
      currentTasks: 0,
    });
    this.stateService.updateBattleState({
      teams: [],
      currentTurn: '--',
      round: 0,
      status: 'paused',
    });
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

  protected monitorValue(key: 'cpu' | 'memory' | 'network' | 'gpu'): number {
    return this.stateService.monitor()[key];
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
        const tabs: ViewType[] = ['arena', 'cognitive', 'monitor', 'network'];
        const currentIndex = tabs.indexOf(this.activeTab());
        const nextIndex = (currentIndex + 1) % tabs.length;
        this.switchTab(tabs[nextIndex]);
        break;
      }
    }
  }

  ngOnInit(): void {
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    this.syncFromOrchestrator();
    
    const initialMode = this.modeManager.currentMode();
    this.stateService.updateMode(
      initialMode.currentMode,
      this.modeManager.getCurrentModeConfig().name,
      this.modeManager.getCurrentModeConfig().description,
      initialMode.isActive ? '运行中' : '已停止',
    );
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown.bind(this));
  }

  private syncFromOrchestrator(): void {
    const vm = this.orchestrator.getCurrentVm();
    
    const agents = vm.teammates.map(teammate => ({
      id: teammate.agentId,
      name: teammate.name,
      role: 'developer' as const,
      status: teammate.sessionStatus === 'connected' ? 'running' : 'idle',
      load: Math.round(Math.random() * 30),
      skills: ['Auto-generated'],
    }));
    
    this.stateService.updateRuntime({
      teamCount: vm.teammates.length > 0 ? 1 : 0,
      agentCount: vm.teammates.length,
      activeSessions: vm.runningCount,
      failedSessions: vm.errorCount,
    });
    
    this.stateService.updateCollaborationSummary({
      runningAgents: vm.runningCount,
      currentTasks: this.taskOrchestrationList.filter(t => t.status === 'running').length,
      collaborationLevel: vm.runningCount > 0 ? 'High' : 'Low',
      syncLatency: vm.runningCount > 0 ? `${Math.round(Math.random() * 20 + 10)}ms` : '--',
    });
    
    this.stateService.updateOrchestration({
      planMode: this.taskOrchestrationList.length > 0 ? '手动编排' : '未启动',
      assignedAgents: this.taskOrchestrationList.filter(t => t.assignedAgentId !== 'unassigned').length,
      activeEdges: this.taskOrchestrationList.filter(t => t.status === 'running').length,
      convergence: this.taskOrchestrationList.length > 0 ? '进行中' : '待确认',
    });
  }
}