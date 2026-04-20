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
import type { TaskGraph, TaskNode, AgentDescriptor, AgentRuntimeState, TaskNodeStatus } from './domain/types';
import type { ExecutionMode } from './services/execution-mode-decider.service';
import { EVENT_TYPES, MultiAgentEvent, TaskPlannedPayload, AgentCreatedPayload, TaskStartedPayload, TaskCompletedPayload, TaskFailedPayload, AgentStateChangedPayload, AgentThinkingPayload, AgentOutputPayload } from './multi-agent.events';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

interface TaskNodeVm {
  taskId: string;
  title: string;
  description: string;
  taskType: string;
  priority: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  assignedAgentId?: string;
  dependencies: string[];
  depth: number;
  progress?: number;
  output?: string;
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

  protected readonly executionMode = signal<ExecutionMode>('single');
  protected readonly modeReason = signal('');
  protected readonly isForcedMode = computed(() => this.modeSwitchApi.isForced());

  protected readonly taskGraph = signal<TaskGraph | null>(null);
  protected readonly agents = signal<AgentVm[]>([]);
  protected readonly agentDescriptors = signal<Map<string, AgentDescriptor>>(new Map());
  protected readonly agentStates = signal<Map<string, AgentRuntimeState>>(new Map());
  protected readonly isProcessing = signal(false);
  protected readonly currentRequest = signal('');

  private subscriptions: Subscription[] = [];
  private taskProgressMap = new Map<string, number>();
  private taskOutputMap = new Map<string, string>();
  private agentThinkingMap = new Map<string, string>();
  private agentOutputMap = new Map<string, string>();

  protected readonly taskNodes = computed(() => {
    const graph = this.taskGraph();
    if (!graph) return [];

    const nodes: TaskNodeVm[] = [];
    const taskMap = graph.tasks;
    const depths = this.calculateDepths(graph);

    Object.values(taskMap).forEach((task: TaskNode) => {
      nodes.push({
        taskId: task.taskId,
        title: task.title,
        description: task.description,
        taskType: task.type,
        priority: task.priority,
        status: task.status as TaskNodeVm['status'],
        assignedAgentId: task.assignedAgentId,
        dependencies: task.dependencies,
        depth: depths[task.taskId] || 0,
        progress: this.taskProgressMap.get(task.taskId),
        output: this.taskOutputMap.get(task.taskId),
      });
    });

    return nodes.sort((a, b) => a.depth - b.depth);
  });

  constructor() {
    this.subscribeToEvents();
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
      const taskCount = taskGraph
        ? Object.values(taskGraph.tasks).filter(t => t.assignedAgentId === agentId).length
        : 0;

      const agentTasks = taskGraph
        ? Object.values(taskGraph.tasks).filter(t => t.assignedAgentId === agentId)
        : [];
      
      const hasRunningTask = agentTasks.some(t => t.status === 'running');
      const allCompleted = agentTasks.length > 0 && agentTasks.every(t => t.status === 'completed');

      let status: AgentVm['status'] = 'idle';
      if (hasRunningTask) {
        status = 'thinking';
      } else if (allCompleted) {
        status = 'completed';
      }

      agentList.push({
        agentId,
        agentName: descriptor.agentName,
        role: descriptor.role,
        status,
        modelId: descriptor.modelId,
        taskCount,
        lastHeartbeat: state?.lastSeenAt || Date.now(),
        thinking: this.agentThinkingMap.get(agentId),
        output: this.agentOutputMap.get(agentId),
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

    try {
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

      if (output.agentIntents.length > 0) {
        const roleToAgentId = new Map<string, string>();

        for (const intent of output.agentIntents) {
          const agentId = `agent-${intent.suggestedRole}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

      const task = sortedTasks[currentIndex];
      
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

        this.agentThinkingMap.set(task.assignedAgentId, `正在执行任务: ${task.title}`);
        this.eventBus.emit({
          type: EVENT_TYPES.AGENT_THINKING,
          ts: Date.now(),
          sessionId: 'sidebar-session',
          source: 'executor',
          payload: { agentId: task.assignedAgentId, thinking: `正在执行任务: ${task.title}` },
        } as MultiAgentEvent<'agent.thinking'>);
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

        this.taskOutputMap.set(task.taskId, '执行成功');

        this.eventBus.emit({
          type: EVENT_TYPES.TASK_COMPLETED,
          ts: Date.now(),
          sessionId: 'sidebar-session',
          source: 'executor',
          payload: { taskId: task.taskId, agentId: task.assignedAgentId || '', result: '执行成功', durationMs: 1500 },
        } as MultiAgentEvent<'task.completed'>);

        if (task.assignedAgentId) {
          this.agentThinkingMap.delete(task.assignedAgentId);
          this.agentOutputMap.set(task.assignedAgentId, `任务 "${task.title}" 已完成`);

          this.eventBus.emit({
            type: EVENT_TYPES.AGENT_OUTPUT,
            ts: Date.now(),
            sessionId: 'sidebar-session',
            source: 'executor',
            payload: { agentId: task.assignedAgentId, output: `任务 "${task.title}" 已完成` },
          } as MultiAgentEvent<'agent.output'>);

          this.eventBus.emit({
            type: EVENT_TYPES.AGENT_STOPPED,
            ts: Date.now(),
            sessionId: 'sidebar-session',
            source: 'executor',
            payload: { agentId: task.assignedAgentId, previousStatus: 'running', newStatus: 'idle' },
          } as MultiAgentEvent<'agent.stopped'>);
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

  private getAgentNameByRole(role: string): string {
    const roleNames: Record<string, string> = {
      leader: '团队领导',
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
      coordination: 'coordinator',
    };
    return mapping[type] || 'executor';
  }
}
