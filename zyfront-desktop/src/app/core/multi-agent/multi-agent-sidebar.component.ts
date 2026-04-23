import { ChangeDetectionStrategy, Component, computed, inject, input, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { TaskPlannerService } from './services/task-planner.service';
import { AgentFactoryService } from './services/agent-factory.service';
import { AgentLifecycleManager } from './services/agent-lifecycle-manager.service';
import { SessionRegistryService } from './services/session-registry.service';
import { MultiAgentEventBusService } from './multi-agent.event-bus.service';
import { ModeSwitchApiService } from './services/mode-switch-api.service';
import { AgentStateMachineService } from './services/agent-state-machine.service';
import { PlanModeTriggerService } from './services/plan-mode-trigger.service';
import type { TaskGraph, TaskNode, AgentDescriptor, AgentRuntimeState, TaskNodeStatus } from './domain/types';
import type { ExecutionMode } from './services/execution-mode-decider.service';
import { EVENT_TYPES, MultiAgentEvent, TaskPlannedPayload, AgentCreatedPayload, TaskStartedPayload, TaskCompletedPayload, TaskFailedPayload, AgentStateChangedPayload, AgentThinkingPayload, AgentOutputPayload } from './multi-agent.events';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

interface TaskNodeVm {
  taskId: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStep?: string;
}

interface AgentVm {
  agentId: string;
  agentName: string;
  role: string;
  status: 'idle' | 'running' | 'thinking' | 'completed' | 'failed';
  modelId: string;
  taskCount: number;
  lastHeartbeat: number;
  thinking?: string;
  output?: string;
  note?: string;
  isDefault?: boolean;
}

@Component({
  selector: 'app-multi-agent-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzTagModule,
    NzTooltipModule,
    NzEmptyModule,
    NzProgressModule,
  ],
  templateUrl: './multi-agent-sidebar.component.html',
  styleUrl: './multi-agent-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiAgentSidebarComponent implements OnDestroy {
  readonly visible = input(true);
  readonly collapsed = signal(false);

  private readonly planner = inject(TaskPlannerService);
  private readonly factory = inject(AgentFactoryService);
  private readonly lifecycle = inject(AgentLifecycleManager);
  private readonly sessionRegistry = inject(SessionRegistryService);
  private readonly eventBus = inject(MultiAgentEventBusService);
  private readonly modeSwitchApi = inject(ModeSwitchApiService);
  private readonly stateMachine = inject(AgentStateMachineService);
  private readonly planModeTrigger = inject(PlanModeTriggerService);

  protected readonly executionMode = signal<ExecutionMode>('single');
  protected readonly modeReason = signal('');
  protected readonly isForcedMode = computed(() => this.modeSwitchApi.isForced());
  protected readonly planModeReason = signal<string | null>(null);
  protected readonly executionConstraints = signal<string | null>(null);

  protected readonly taskGraph = signal<TaskGraph | null>(null);
  protected readonly agents = signal<AgentVm[]>([]);
  protected readonly agentDescriptors = signal<Map<string, AgentDescriptor>>(new Map());
  protected readonly agentStates = signal<Map<string, AgentRuntimeState>>(new Map());
  protected readonly isProcessing = signal(false);
  protected readonly currentRequest = signal('');
  protected readonly taskListExpanded = signal(true);

  /** 默认智能体 ID */
  private static readonly DEFAULT_AGENT_ID = 'agent-default-chaoti';

  /** 编辑中的 agent 备注 */
  protected readonly editingNoteAgentId = signal<string | null>(null);
  protected readonly noteDraft = signal('');

  private subscriptions: Subscription[] = [];
  private taskProgressMap = new Map<string, number>();
  private taskOutputMap = new Map<string, string>();
  private agentThinkingMap = new Map<string, string>();
  private agentOutputMap = new Map<string, string>();
  private visibleTaskIds = signal<Set<string>>(new Set());

  setCurrentRequest(request: string): void {
    this.currentRequest.set(request);
  }

  protected readonly taskNodes = computed(() => {
    const graph = this.taskGraph();
    const visibleIds = this.visibleTaskIds();
    if (!graph) return [];

    const nodes: TaskNodeVm[] = [];
    const depths = this.calculateDepths(graph);

    Object.values(graph.tasks).forEach((task: TaskNode) => {
      if (!visibleIds.has(task.taskId)) return;
      nodes.push({
        taskId: task.taskId,
        title: task.title,
        status: task.status as TaskNodeVm['status'],
        currentStep: task.status === 'running' ? this.getCurrentStepText(task.type) : undefined,
      });
    });

    return nodes.sort((a, b) => (depths[a.taskId] || 0) - (depths[b.taskId] || 0));
  });

  protected readonly completedTaskCount = computed(() => {
    const nodes = this.taskNodes();
    return nodes.filter(t => t.status === 'completed').length;
  });

  constructor() {
    this.subscribeToEvents();
    this.ensureDefaultAgent();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private subscribeToEvents(): void {
    this.subscriptions.push(
      this.eventBus.events$
        .pipe(filter((e: MultiAgentEvent) => e.type === EVENT_TYPES.TASK_PLANNED))
        .subscribe(event => {
          this.handleTaskPlanned(event as MultiAgentEvent<'task.planned'>);
        }),
      this.eventBus.events$
        .pipe(filter((e: MultiAgentEvent) => e.type === EVENT_TYPES.AGENT_CREATED))
        .subscribe(event => {
          this.handleAgentCreated(event as MultiAgentEvent<'agent.created'>);
        }),
      this.eventBus.events$
        .pipe(filter((e: MultiAgentEvent) => e.type === EVENT_TYPES.TASK_STARTED))
        .subscribe(event => {
          this.handleTaskStarted(event as MultiAgentEvent<'task.started'>);
        }),
      this.eventBus.events$
        .pipe(filter((e: MultiAgentEvent) => e.type === EVENT_TYPES.TASK_COMPLETED))
        .subscribe(event => {
          this.handleTaskCompleted(event as MultiAgentEvent<'task.completed'>);
        }),
      this.eventBus.events$
        .pipe(filter((e: MultiAgentEvent) => e.type === EVENT_TYPES.TASK_FAILED))
        .subscribe(event => {
          this.handleTaskFailed(event as MultiAgentEvent<'task.failed'>);
        }),
      this.eventBus.events$
        .pipe(filter((e: MultiAgentEvent) => 
          e.type === EVENT_TYPES.AGENT_STARTED ||
          e.type === EVENT_TYPES.AGENT_IDLE ||
          e.type === EVENT_TYPES.AGENT_STOPPED ||
          e.type === EVENT_TYPES.AGENT_FAILED
        ))
        .subscribe(event => {
          this.handleAgentStateChanged(event as MultiAgentEvent<'agent.started' | 'agent.idle' | 'agent.stopped' | 'agent.failed'>);
        }),
      this.eventBus.events$
        .pipe(filter((e: MultiAgentEvent) => e.type === EVENT_TYPES.AGENT_THINKING))
        .subscribe(event => {
          this.handleAgentThinking(event as MultiAgentEvent<'agent.thinking'>);
        }),
      this.eventBus.events$
        .pipe(filter((e: MultiAgentEvent) => e.type === EVENT_TYPES.AGENT_OUTPUT))
        .subscribe(event => {
          this.handleAgentOutput(event as MultiAgentEvent<'agent.output'>);
        }),
    );
  }

  private handleTaskPlanned(event: MultiAgentEvent<'task.planned'>): void {
    const payload = event.payload as TaskPlannedPayload;
    const taskGraph = payload.taskGraph;
    const userRequest = (payload as any).userRequest as string;
    
    if (taskGraph) {
      this.taskProgressMap.clear();
      this.taskOutputMap.clear();
      this.agentThinkingMap.clear();
      this.agentOutputMap.clear();
      const newVisibleIds = new Set<string>(Object.keys(taskGraph.tasks));
      this.visibleTaskIds.set(newVisibleIds);
      this.taskGraph.set(taskGraph);
      
      if (userRequest) {
        this.currentRequest.set(userRequest);
      }
    }
  }

  private handleAgentCreated(event: MultiAgentEvent<'agent.created'>): void {
    const payload = event.payload as AgentCreatedPayload;
    const descriptor = payload.descriptor;
    const runtimeState = payload.runtimeState;

    if (descriptor) {
      this.agentDescriptors.update(map => {
        const newMap = new Map(map);
        newMap.set(descriptor.agentId, descriptor);
        return newMap;
      });
    }

    if (runtimeState) {
      this.agentStates.update(map => {
        const newMap = new Map(map);
        newMap.set(runtimeState.agentId, runtimeState);
        return newMap;
      });
    }

    this.refreshAgents();
  }

  private handleTaskStarted(event: MultiAgentEvent<'task.started'>): void {
    const payload = event.payload as TaskStartedPayload;
    const taskId = payload.taskId;
    
    if (taskId && this.taskGraph()) {
      this.taskGraph.update(graph => {
        if (!graph) return graph;
        const task = graph.tasks[taskId];
        if (task) {
          task.status = 'running';
        }
        return { ...graph };
      });
      
      this.taskProgressMap.set(taskId, 0);
    }
  }

  private handleTaskCompleted(event: MultiAgentEvent<'task.completed'>): void {
    const payload = event.payload as TaskCompletedPayload;
    const taskId = payload.taskId;
    const output = payload.result;
    
    if (taskId && this.taskGraph()) {
      this.taskGraph.update(graph => {
        if (!graph) return graph;
        const task = graph.tasks[taskId];
        if (task) {
          task.status = 'completed';
        }
        return { ...graph };
      });
      
      this.taskProgressMap.set(taskId, 100);
      if (output) {
        this.taskOutputMap.set(taskId, output);
      }
    }
  }

  private handleTaskFailed(event: MultiAgentEvent<'task.failed'>): void {
    const payload = event.payload as TaskFailedPayload;
    const taskId = payload.taskId;
    const error = payload.error;
    
    if (taskId && this.taskGraph()) {
      this.taskGraph.update(graph => {
        if (!graph) return graph;
        const task = graph.tasks[taskId];
        if (task) {
          task.status = 'failed';
        }
        return { ...graph };
      });
      
      if (error) {
        this.taskOutputMap.set(taskId, `错误: ${error}`);
      }
    }
  }

  private handleAgentStateChanged(event: MultiAgentEvent<'agent.started' | 'agent.idle' | 'agent.stopped' | 'agent.failed'>): void {
    const payload = event.payload as AgentStateChangedPayload;
    const agentId = payload.agentId;
    const eventType = event.type;

    let newState: string = 'idle';
    if (eventType === EVENT_TYPES.AGENT_STARTED) {
      newState = 'running';
    } else if (eventType === EVENT_TYPES.AGENT_IDLE) {
      newState = 'idle';
    } else if (eventType === EVENT_TYPES.AGENT_STOPPED) {
      newState = 'completed';
    } else if (eventType === EVENT_TYPES.AGENT_FAILED) {
      newState = 'failed';
    }

    if (agentId) {
      this.agentStates.update(map => {
        const newMap = new Map(map);
        const state = newMap.get(agentId);
        if (state) {
          state.status = newState as any;
          state.lastStateChangeAt = Date.now();
        }
        return newMap;
      });
      this.refreshAgents();
    }
  }

  private handleAgentThinking(event: MultiAgentEvent<'agent.thinking'>): void {
    const payload = event.payload as AgentThinkingPayload;
    const agentId = payload.agentId;
    const thinking = payload.thinking;
    
    if (agentId && thinking) {
      this.agentThinkingMap.set(agentId, thinking);
      this.refreshAgents();
    }
  }

  private handleAgentOutput(event: MultiAgentEvent<'agent.output'>): void {
    const payload = event.payload as AgentOutputPayload;
    const agentId = payload.agentId;
    const output = payload.output;
    
    if (agentId && output) {
      this.agentOutputMap.set(agentId, output);
      this.refreshAgents();
    }
  }

  private refreshAgents(): void {
    const descriptors = this.agentDescriptors();
    const states = this.agentStates();
    const taskGraph = this.taskGraph();

    const agentList: AgentVm[] = [];
    descriptors.forEach((descriptor, agentId) => {
      const state = states.get(agentId);
      const agentTasks = taskGraph
        ? Object.values(taskGraph.tasks).filter(t => t.assignedAgentId === agentId)
        : [];
      
      const taskCount = agentTasks.length;
      const hasRunningTask = agentTasks.some(t => t.status === 'running');
      const hasPendingTask = agentTasks.some(t => t.status === 'pending');
      const completedTaskCount = agentTasks.filter(t => t.status === 'completed').length;
      const allCompleted = agentTasks.length > 0 && completedTaskCount === agentTasks.length;
      const hasFailedTask = agentTasks.some(t => t.status === 'failed');

      const hasThinking = this.agentThinkingMap.has(agentId);
      const hasOutput = this.agentOutputMap.has(agentId);
      const thinkingContent = this.agentThinkingMap.get(agentId);
      const outputContent = this.agentOutputMap.get(agentId);

      let status: AgentVm['status'] = 'idle';
      if (hasFailedTask) {
        status = 'failed';
      } else if (hasThinking || hasRunningTask) {
        status = 'thinking';
      } else if (allCompleted) {
        status = 'completed';
      } else if (hasOutput && !hasPendingTask) {
        status = 'completed';
      } else if (hasPendingTask && completedTaskCount > 0) {
        status = 'running';
      }

      agentList.push({
        agentId,
        agentName: descriptor.agentName,
        role: descriptor.role,
        status,
        modelId: descriptor.modelId,
        taskCount,
        lastHeartbeat: state?.lastSeenAt || Date.now(),
        thinking: thinkingContent,
        output: outputContent,
        isDefault: agentId === MultiAgentSidebarComponent.DEFAULT_AGENT_ID,
      });
    });

    this.agents.set(agentList);
  }

  private calculateDepths(graph: TaskGraph): Record<string, number> {
    const depths: Record<string, number> = {};
    const visited = new Set<string>();

    const calculateDepth = (taskId: string, depth: number): void => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      depths[taskId] = depth;
      const task = graph.tasks[taskId];
      if (task) {
        task.dependents.forEach(depId => calculateDepth(depId, depth + 1));
      }
    };

    graph.rootTaskIds.forEach(rootId => calculateDepth(rootId, 0));
    return depths;
  }

  toggleCollapse(): void {
    this.collapsed.update(v => !v);
  }

  toggleTaskList(): void {
    this.taskListExpanded.update(v => !v);
  }

  toggleExecutionMode(): void {
    this.modeSwitchApi.toggleMode();
    this.executionMode.update(mode => mode === 'single' ? 'multi' : 'single');
  }

  canToggleMode(): boolean {
    return !this.isProcessing();
  }

  protected getStatusIcon(status: string): string {
    switch (status) {
      case 'pending':
        return 'clock-circle';
      case 'running':
        return 'loading';
      case 'completed':
        return 'check-circle';
      case 'failed':
        return 'close-circle';
      default:
        return 'minus-circle';
    }
  }

  protected getTaskTypeColor(type: string): string {
    const colors: Record<string, string> = {
      research: 'blue',
      planning: 'purple',
      coding: 'green',
      testing: 'orange',
      review: 'cyan',
      debugging: 'red',
      documentation: 'geekblue',
      analysis: 'magenta',
      coordination: 'gold',
    };
    return colors[type] || 'default';
  }

  protected getRoleColor(role: string): string {
    const colors: Record<string, string> = {
      leader: 'red',
      planner: 'purple',
      executor: 'blue',
      reviewer: 'cyan',
      researcher: 'green',
      validator: 'orange',
      coordinator: 'gold',
    };
    return colors[role] || 'default';
  }

  protected getRoleIcon(role: string): string {
    const icons: Record<string, string> = {
      leader: 'crown',
      planner: 'block',
      executor: 'play-circle',
      reviewer: 'eye',
      researcher: 'search',
      validator: 'check-circle',
      coordinator: 'swap',
    };
    return icons[role] || 'user';
  }

  protected getAgentStatusText(status: string): string {
    const texts: Record<string, string> = {
      idle: '空闲',
      running: '运行中',
      thinking: '思考中',
      completed: '已完成',
      failed: '失败',
    };
    return texts[status] || status;
  }

  protected trackByTaskId(index: number, task: TaskNodeVm): string {
    return task.taskId;
  }

  protected trackByAgentId(index: number, agent: AgentVm): string {
    return agent.agentId;
  }

  async processRequest(request: string): Promise<void> {
    if (!request.trim()) return;

    this.isProcessing.set(true);
    this.currentRequest.set(request);

    this.taskProgressMap.clear();
    this.agentThinkingMap.clear();
    this.agentOutputMap.clear();
    this.taskOutputMap.clear();

    // 保留默认智能体，清除其余
    const defaultId = MultiAgentSidebarComponent.DEFAULT_AGENT_ID;
    const defaultDesc = this.agentDescriptors().get(defaultId);
    const defaultState = this.agentStates().get(defaultId);
    const newDescMap = new Map<string, AgentDescriptor>();
    const newStateMap = new Map<string, AgentRuntimeState>();
    if (defaultDesc) newDescMap.set(defaultId, defaultDesc);
    if (defaultState) {
      defaultState.status = 'idle';
      defaultState.lastStateChangeAt = Date.now();
      newStateMap.set(defaultId, defaultState);
    }
    this.agentDescriptors.set(newDescMap);
    this.agentStates.set(newStateMap);
    this.agents.set([]);
    this.planModeTrigger.resetExecutionState();

    try {
      const planModeDecision = this.planner.decidePlanMode(request);
      
      if (planModeDecision.shouldEnterPlanMode) {
        this.planModeReason.set(planModeDecision.trigger.details);
        this.executionConstraints.set(
          `约束: 最大工具调用=${planModeDecision.constraints.maxToolCalls}, ` +
          `最大Token=${planModeDecision.constraints.maxTokenUsage}, ` +
          `最大文件修改=${planModeDecision.constraints.maxFileModifications}`
        );
      } else {
        this.planModeReason.set(null);
        this.executionConstraints.set(null);
      }

      const decision = this.modeSwitchApi.decideForRequest(request);
      this.executionMode.set(decision.mode);
      this.modeReason.set(decision.reason);

      const complexity = this.planner.analyzeComplexity(request);

      const output = await this.planner.plan({
        userRequest: request,
        sessionContext: {
          sessionId: 'sidebar-session',
          sessionName: 'Sidebar Session',
          status: 'active',
          teamId: 'sidebar-team',
          teamName: 'Sidebar Team',
          planVersion: 0,
          agentIds: [],
          memoryScope: 'isolated',
          modelPolicyId: 'default',
          backendPolicy: 'auto',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        teamContext: {
          teamId: 'sidebar-team',
          teamName: 'Sidebar Team',
          status: 'forming',
          leaderAgentId: '',
          agentIds: [],
          sessionIds: ['sidebar-session'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        availableAgents: [],
        toolAvailability: {},
      });

      this.taskGraph.set(output.taskGraph);
      
      console.log('[MultiAgent] Task graph:', output.taskGraph);
      console.log('[MultiAgent] Tasks:', output.taskGraph.tasks);
      
      // Immediately show all tasks in the sidebar
      const allTaskIds = new Set(Object.keys(output.taskGraph.tasks));
      console.log('[MultiAgent] Visible task IDs:', allTaskIds);
      this.visibleTaskIds.set(allTaskIds);

      if (output.agentIntents.length > 0) {
        const roleToAgentId = new Map<string, string>();
        const createdRoles = new Set<string>();
        const existingAgents = this.agents();

        for (const intent of output.agentIntents) {
          if (createdRoles.has(intent.suggestedRole)) {
            continue;
          }
          
          let agentId: string;
          const existingAgent = existingAgents.find(a => a.role === intent.suggestedRole);
          
          if (existingAgent) {
            agentId = existingAgent.agentId;
            roleToAgentId.set(intent.suggestedRole, agentId);
            createdRoles.add(intent.suggestedRole);
            continue;
          }
          
          createdRoles.add(intent.suggestedRole);
          
          agentId = `agent-${intent.suggestedRole}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          roleToAgentId.set(intent.suggestedRole, agentId);

          const descriptor: AgentDescriptor = {
            agentId,
            agentName: this.getAgentNameByRole(intent.suggestedRole),
            role: intent.suggestedRole,
            teamId: 'sidebar-team',
            sessionId: 'sidebar-session',
            modelId: 'MiniMax-M2.7',
            backendType: 'in-process',
            permissions: [],
            createdAt: Date.now(),
            createdBy: 'planner',
            lifetimePolicy: 'task-bound',
          };

          this.agentDescriptors.update(map => {
            const newMap = new Map(map);
            newMap.set(agentId, descriptor);
            return newMap;
          });

          const runtimeState: AgentRuntimeState = {
            agentId,
            status: 'idle',
            lastSeenAt: Date.now(),
            heartbeatInterval: 30000,
            activeTaskIds: [],
            recoveryAttempts: 0,
            totalMessagesProcessed: 0,
            totalTokensUsed: 0,
            startedAt: Date.now(),
            lastStateChangeAt: Date.now(),
          };

          this.agentStates.update(map => {
            const newMap = new Map(map);
            newMap.set(agentId, runtimeState);
            return newMap;
          });

          this.eventBus.emit({
        type: EVENT_TYPES.AGENT_CREATED,
        ts: Date.now(),
        sessionId: 'sidebar-session',
        source: 'planner',
        payload: { descriptor, runtimeState },
      } as MultiAgentEvent<'agent.created'>);
        }

        this.taskGraph.update(graph => {
          if (!graph) return graph;
          Object.values(graph.tasks).forEach(task => {
            const role = this.getRoleForTaskType(task.type);
            const agentId = roleToAgentId.get(role);
            if (agentId) {
              task.assignedAgentId = agentId;
            }
          });
          return { ...graph };
        });

        this.refreshAgents();
      }

      this.eventBus.emit({
        type: EVENT_TYPES.TASK_PLANNED,
        ts: Date.now(),
        sessionId: 'sidebar-session',
        source: 'user',
        payload: { taskGraph: output.taskGraph, planVersion: output.planVersion, userRequest: request },
      } as MultiAgentEvent<'task.planned'>);

      // Start real task execution simulation based on the planned task graph
      this.simulateTaskExecution(output.taskGraph);

    } finally {
      this.isProcessing.set(false);
    }
  }

  private simulateTaskExecution(graph: TaskGraph): void {
    const tasks = Object.values(graph.tasks);
    if (tasks.length === 0) return;

    const sortedTasks = this.topologicalSort(tasks);
    let currentIndex = 0;

    const executeNextTask = () => {
      if (currentIndex >= sortedTasks.length) {
        return;
      }

      if (this.planModeTrigger.isExecutionPaused()) {
        console.warn('[MultiAgent] Execution paused:', this.planModeTrigger.getExecutionState().pauseReason);
        return;
      }

      const task = sortedTasks[currentIndex];
      
      const toolCallResult = this.planModeTrigger.recordToolCall();
      if (toolCallResult.warning) {
        console.warn('[MultiAgent]', toolCallResult.warning);
      }
      if (toolCallResult.shouldPause) {
        console.warn('[MultiAgent] Execution paused due to tool call limit');
        return;
      }

      const tokenResult = this.planModeTrigger.recordTokenUsage(1000);
      if (tokenResult.warning) {
        console.warn('[MultiAgent]', tokenResult.warning);
      }
      if (tokenResult.shouldPause) {
        console.warn('[MultiAgent] Execution paused due to token limit');
        return;
      }
      
      this.taskGraph.update(g => {
        if (!g) return g;
        const t = g.tasks[task.taskId];
        if (t) {
          t.status = 'running';
        }
        return { ...g };
      });

      this.eventBus.emit({
        type: EVENT_TYPES.TASK_STARTED,
        ts: Date.now(),
        sessionId: 'sidebar-session',
        source: 'executor',
        payload: { taskId: task.taskId, agentId: task.assignedAgentId || '', startedAt: Date.now() },
      } as MultiAgentEvent<'task.started'>);

      if (task.assignedAgentId) {
        this.eventBus.emit({
          type: EVENT_TYPES.AGENT_STARTED,
          ts: Date.now(),
          sessionId: 'sidebar-session',
          source: 'executor',
          payload: { agentId: task.assignedAgentId, previousStatus: 'idle', newStatus: 'running' },
        } as MultiAgentEvent<'agent.started'>);

        const thinkingContent = `正在执行任务: ${task.title}`;
        this.agentThinkingMap.set(task.assignedAgentId, thinkingContent);
        this.eventBus.emit({
          type: EVENT_TYPES.AGENT_THINKING,
          ts: Date.now(),
          sessionId: 'sidebar-session',
          source: 'executor',
          payload: { agentId: task.assignedAgentId, thinking: thinkingContent },
        } as MultiAgentEvent<'agent.thinking'>);
        
        this.refreshAgents();
      }

      this.taskProgressMap.set(task.taskId, 50);

      setTimeout(() => {
        this.taskProgressMap.set(task.taskId, 100);

        this.taskGraph.update(g => {
          if (!g) return g;
          const t = g.tasks[task.taskId];
          if (t) {
            t.status = 'completed';
          }
          return { ...g };
        });

        this.taskOutputMap.set(task.taskId, this.generateTaskOutput(task));

        this.eventBus.emit({
          type: EVENT_TYPES.TASK_COMPLETED,
          ts: Date.now(),
          sessionId: 'sidebar-session',
          source: 'executor',
          payload: { taskId: task.taskId, agentId: task.assignedAgentId || '', result: this.generateTaskOutput(task), durationMs: 1500 },
        } as MultiAgentEvent<'task.completed'>);

        if (task.assignedAgentId) {
          const agentOutput = this.generateAgentOutput(task);
          const existingOutput = this.agentOutputMap.get(task.assignedAgentId) || '';
          const accumulatedOutput = existingOutput 
            ? `${existingOutput}\n\n${agentOutput}` 
            : agentOutput;
          this.agentOutputMap.set(task.assignedAgentId, accumulatedOutput);
          
          this.agentThinkingMap.delete(task.assignedAgentId);

          this.eventBus.emit({
            type: EVENT_TYPES.AGENT_OUTPUT,
            ts: Date.now(),
            sessionId: 'sidebar-session',
            source: 'executor',
            payload: { agentId: task.assignedAgentId, output: accumulatedOutput },
          } as MultiAgentEvent<'agent.output'>);

          const allTasks = Object.values(this.taskGraph()?.tasks || {});
          const agentTasks = allTasks.filter(t => t.assignedAgentId === task.assignedAgentId);
          const allAgentTasksCompleted = agentTasks.length > 0 && 
            agentTasks.every(t => t.status === 'completed');
          
          if (allAgentTasksCompleted) {
            this.eventBus.emit({
              type: EVENT_TYPES.AGENT_STOPPED,
              ts: Date.now(),
              sessionId: 'sidebar-session',
              source: 'executor',
              payload: { agentId: task.assignedAgentId, previousStatus: 'running', newStatus: 'stopped' },
            } as MultiAgentEvent<'agent.stopped'>);
          }
        }

        this.refreshAgents();
        currentIndex++;
        executeNextTask();
      }, 1500);
    };

    executeNextTask();
  }

  private topologicalSort(tasks: TaskNode[]): TaskNode[] {
    const sorted: TaskNode[] = [];
    const visited = new Set<string>();
    const taskMap = new Map(tasks.map(t => [t.taskId, t]));

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const task = taskMap.get(taskId);
      if (task) {
        for (const depId of task.dependencies) {
          visit(depId);
        }
        sorted.push(task);
      }
    };

    for (const task of tasks) {
      visit(task.taskId);
    }

    return sorted;
  }

  private generateTaskOutput(task: TaskNode): string {
    const outputsByType: Record<string, string[]> = {
      research: [
        '已完成代码库分析，识别了关键模块和依赖关系...',
        '分析了项目结构，发现了 3 个核心入口点...',
        '调研完成，整理了技术方案对比报告...',
      ],
      analysis: [
        '性能分析完成，识别了 2 个瓶颈点...',
        '依赖关系分析完成，生成了模块依赖图...',
        '代码质量分析完成，发现 5 个改进点...',
      ],
      planning: [
        '架构设计方案已完成，包含 3 个核心模块...',
        '实施计划已制定，预计 4 个迭代周期...',
        '技术选型完成，推荐使用 TypeScript + Angular...',
      ],
      coding: [
        '功能实现完成，新增 150 行代码...',
        '重构完成，代码复杂度降低 30%...',
        'Bug 修复完成，已通过单元测试...',
      ],
      testing: [
        '测试用例编写完成，覆盖率 85%...',
        '集成测试通过，发现 0 个回归问题...',
        '性能测试完成，响应时间 < 100ms...',
      ],
      documentation: [
        'API 文档已更新，新增 5 个接口说明...',
        'README 已完善，包含快速开始指南...',
        '代码注释已补充，关键逻辑已标注...',
      ],
      review: [
        '代码审查完成，提出 3 条优化建议...',
        '安全审计完成，发现 1 个潜在风险...',
        '性能审查完成，建议优化数据库查询...',
      ],
      debugging: [
        '问题定位完成，根因是空指针异常...',
        'Bug 已修复，添加了边界条件检查...',
        '日志分析完成，发现内存泄漏点...',
      ],
      coordination: [
        '任务协调完成，已分配给 3 个智能体...',
        '进度同步完成，当前进度 60%...',
        '资源调度完成，已优化执行顺序...',
      ],
    };

    const outputs = outputsByType[task.type] || ['任务执行完成...'];
    const randomOutput = outputs[Math.floor(Math.random() * outputs.length)];
    
    return randomOutput.length > 30 ? randomOutput.substring(0, 30) + '...' : randomOutput;
  }

  private generateAgentOutput(task: TaskNode): string {
    const role = this.getRoleForTaskType(task.type);
    const agentName = this.getAgentNameByRole(role);
    const output = this.generateTaskOutput(task);
    
    return `[${agentName}] ${output}`;
  }

  private getAgentNameByRole(role: string): string {
    const roleNames: Record<string, string> = {
      leader: '超体',
      planner: '规划师',
      executor: '执行者',
      reviewer: '评审员',
      researcher: '研究员',
      validator: '验证员',
      coordinator: '协调员',
    };
    return roleNames[role] || role;
  }

  private getRoleForTaskType(type: string): string {
    const mapping: Record<string, string> = {
      planning: 'planner',
      coding: 'executor',
      debugging: 'executor',
      review: 'reviewer',
      research: 'researcher',
      testing: 'validator',
      documentation: 'researcher',
      analysis: 'researcher',
      coordination: 'planner',
    };
    return mapping[type] || 'executor';
  }

  private getCurrentStepText(type: string): string {
    const stepsByType: Record<string, string> = {
      research: '正在分析项目结构和关键模块...',
      analysis: '正在分析数据和问题点...',
      planning: '正在制定实施计划...',
      coding: '正在编写核心功能代码...',
      testing: '正在执行测试用例...',
      documentation: '正在更新文档...',
      review: '正在进行代码审查...',
      debugging: '正在定位问题根因...',
      coordination: '正在协调任务分配...',
    };
    
    return stepsByType[type] || '正在执行任务...';
  }

  /** 确保默认智能体（超体）始终存在 */
  private ensureDefaultAgent(): void {
    const id = MultiAgentSidebarComponent.DEFAULT_AGENT_ID;
    if (this.agents().some(a => a.agentId === id)) return;

    this.agentDescriptors.update(map => {
      const newMap = new Map(map);
      newMap.set(id, {
        agentId: id,
        agentName: '超体',
        role: 'leader',
        teamId: 'default',
        sessionId: 'default',
        modelId: 'claude-3-5-sonnet-latest',
        backendType: 'in-process',
        permissions: [],
        createdAt: Date.now(),
        createdBy: 'user',
        lifetimePolicy: 'permanent',
      });
      return newMap;
    });

    this.agentStates.update(map => {
      const newMap = new Map(map);
      newMap.set(id, {
        agentId: id,
        status: 'idle',
        lastSeenAt: Date.now(),
        heartbeatInterval: 30000,
        activeTaskIds: [],
        recoveryAttempts: 0,
        totalMessagesProcessed: 0,
        totalTokensUsed: 0,
        startedAt: Date.now(),
        lastStateChangeAt: Date.now(),
      });
      return newMap;
    });

    this.refreshAgents();
  }

  /** 更新默认智能体运行状态 */
  setDefaultAgentStatus(status: 'idle' | 'running' | 'thinking'): void {
    const id = MultiAgentSidebarComponent.DEFAULT_AGENT_ID;
    const agent = this.agents().find(a => a.agentId === id);
    if (!agent) return;

    this.agentStates.update(map => {
      const newMap = new Map(map);
      const state = newMap.get(id);
      if (state) {
        state.status = status as any;
        state.lastStateChangeAt = Date.now();
        if (status === 'thinking') {
          state.lastSeenAt = Date.now();
        }
      }
      return newMap;
    });
    this.refreshAgents();
  }

  /** 开始编辑 agent 备注 */
  startEditNote(agentId: string): void {
    const agent = this.agents().find(a => a.agentId === agentId);
    this.noteDraft.set(agent?.note ?? '');
    this.editingNoteAgentId.set(agentId);
  }

  /** 保存 agent 备注 */
  saveNote(agentId: string): void {
    const note = this.noteDraft().trim();
    this.agents.update(agents => agents.map(a =>
      a.agentId === agentId ? { ...a, note } : a
    ));
    this.editingNoteAgentId.set(null);
    this.noteDraft.set('');
  }

  /** 取消编辑备注 */
  cancelEditNote(): void {
    this.editingNoteAgentId.set(null);
    this.noteDraft.set('');
  }

  /** 判断 agent 是否为默认智能体 */
  isDefaultAgent(agentId: string): boolean {
    return agentId === MultiAgentSidebarComponent.DEFAULT_AGENT_ID;
  }
}
