import { Injectable, computed, signal } from '@angular/core';
import { WorkbenchState, SessionItem, AgentStateItem, OutputItem, InputSubmittedPayload, Attachment, TaskGraph } from '../types/workbench.types';
import { DraftService } from './draft.service';
import { MultiAgentEventBusService } from '../../../../core/multi-agent/multi-agent.event-bus.service';
import { EVENT_TYPES } from '../../../../core/multi-agent/multi-agent.events';
import type { AgentDescriptor } from '../../../../core/multi-agent/domain/types';

@Injectable({ providedIn: 'root' })
export class WorkbenchStateService {
  private readonly state = signal<WorkbenchState>({
    layout: {
      leftPanelVisible: true,
      rightPanelVisible: true,
      leftPanelWidth: 280,
      rightPanelWidth: 320,
      responsiveMode: 'wide'
    },
    session: {
      currentSessionId: '',
      sessions: [],
      isLoading: false
    },
    input: {
      draftText: '',
      attachments: [],
      isExpanded: false,
      isFocused: false
    },
    task: {
      agentStates: [],
      isLoading: false
    },
    output: {
      items: [],
      scrollToBottom: true
    }
  });

  // Selectors
  readonly state$ = this.state.asReadonly();
  readonly layout$ = computed(() => this.state().layout);
  readonly session$ = computed(() => this.state().session);
  readonly input$ = computed(() => this.state().input);
  readonly task$ = computed(() => this.state().task);
  readonly output$ = computed(() => this.state().output);

  constructor(
    private eventBus: MultiAgentEventBusService,
    private draftService: DraftService
  ) {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // 监听会话事件
    this.eventBus.on('session.created', (event) => {
      this.addSession(event.payload as any);
    });

    this.eventBus.on('session.resumed', (event) => {
      this.setCurrentSession((event.payload as any).session?.id);
    });

    // 监听任务事件
    this.eventBus.on('task.planned', (event) => {
      this.updateTaskGraph((event.payload as any).taskGraph);
    });

    this.eventBus.on('task.started', (event) => {
      this.updateTaskStatus((event.payload as any).taskId, 'running');
    });

    this.eventBus.on('task.completed', (event) => {
      this.updateTaskStatus((event.payload as any).taskId, 'completed');
    });

    // 监听 Agent 事件
    this.eventBus.on('agent.created', (event) => {
      this.addAgentState((event.payload as any).descriptor);
    });

    this.eventBus.on('agent.started', (event) => {
      this.updateAgentStatus((event.payload as any).agentId, 'running');
    });

    this.eventBus.on('agent.idle', (event) => {
      this.updateAgentStatus((event.payload as any).agentId, 'idle');
    });
  }

  // Layout actions
  setLeftPanelVisible(visible: boolean) {
    this.state.update(s => ({
      ...s,
      layout: { ...s.layout, leftPanelVisible: visible }
    }));
  }

  setRightPanelVisible(visible: boolean) {
    this.state.update(s => ({
      ...s,
      layout: { ...s.layout, rightPanelVisible: visible }
    }));
  }

  // Session actions
  selectSession(sessionId: string) {
    const currentSessionId = this.state().session.currentSessionId;
    if (currentSessionId) {
      const currentInput = this.state().input;
      this.draftService.saveDraft(currentSessionId, currentInput.draftText, currentInput.attachments);
    }

    const draft = this.draftService.getDraft(sessionId);
    this.state.update(s => ({
      ...s,
      session: {
        ...s.session,
        currentSessionId: sessionId
      },
      input: {
        draftText: draft.text,
        attachments: draft.attachments,
        isExpanded: false,
        isFocused: false
      }
    }));

    this.eventBus.emit({
      type: EVENT_TYPES.SESSION_RESUMED,
      sessionId,
      ts: Date.now(),
      source: 'user',
      payload: {
        session: {
          sessionId,
          sessionName: sessionId,
          status: 'active',
          teamId: '',
          teamName: '',
          planVersion: 0,
          agentIds: [],
          memoryScope: 'isolated',
          modelPolicyId: '',
          backendPolicy: 'auto',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any,
        restoredFromSnapshot: false,
      },
    });
  }

  setSessions(sessions: SessionItem[]) {
    this.state.update(s => ({
      ...s,
      session: { ...s.session, sessions }
    }));
  }

  addSession(session: SessionItem) {
    this.state.update(s => ({
      ...s,
      session: {
        ...s.session,
        sessions: [session, ...s.session.sessions]
      }
    }));
  }

  setCurrentSession(sessionId: string) {
    this.state.update(s => ({
      ...s,
      session: { ...s.session, currentSessionId: sessionId }
    }));
  }

  // Input actions
  setDraftText(text: string) {
    this.state.update(s => ({
      ...s,
      input: { ...s.input, draftText: text }
    }));
  }

  setAttachments(attachments: Attachment[]) {
    this.state.update(s => ({
      ...s,
      input: { ...s.input, attachments }
    }));
  }

  addAttachment(attachment: Attachment) {
    this.state.update(s => ({
      ...s,
      input: {
        ...s.input,
        attachments: [...s.input.attachments, attachment]
      }
    }));
  }

  removeAttachment(attachmentId: string) {
    this.state.update(s => ({
      ...s,
      input: {
        ...s.input,
        attachments: s.input.attachments.filter(a => a.id !== attachmentId)
      }
    }));
  }

  submitInput(payload: InputSubmittedPayload) {
    this.state.update(s => ({
      ...s,
      input: {
        ...s.input,
        draftText: '',
        attachments: []
      }
    }));

    this.eventBus.emit({
      type: EVENT_TYPES.INPUT_SUBMITTED,
      sessionId: this.state().session.currentSessionId,
      ts: Date.now(),
      source: 'user',
      payload: {
        ...payload,
        sessionId: this.state().session.currentSessionId,
      },
    });
  }

  // Output actions
  addOutputItem(item: OutputItem) {
    this.state.update(s => ({
      ...s,
      output: {
        ...s.output,
        items: [...s.output.items, item]
      }
    }));
  }

  clearOutput() {
    this.state.update(s => ({
      ...s,
      output: { ...s.output, items: [] }
    }));
  }

  // Task actions
  updateTaskGraph(taskGraph: TaskGraph) {
    this.state.update(s => ({
      ...s,
      task: {
        ...s.task,
        currentTaskGraph: taskGraph
      }
    }));
  }

  updateTaskStatus(taskId: string, status: string) {
    // 实现更新任务状态逻辑
  }

  addAgentState(descriptor: AgentDescriptor) {
    const agentItem: AgentStateItem = {
      agentId: descriptor.agentId,
      role: descriptor.role as any,
      name: descriptor.agentName,
      status: 'idle',
      assignedTasks: []
    };

    this.state.update(s => ({
      ...s,
      task: {
        ...s.task,
        agentStates: [...s.task.agentStates, agentItem]
      }
    }));
  }

  updateAgentStatus(agentId: string, status: string) {
    this.state.update(s => ({
      ...s,
      task: {
        ...s.task,
        agentStates: s.task.agentStates.map(agent =>
          agent.agentId === agentId
            ? { ...agent, status: status as any }
            : agent
        )
      }
    }));
  }

  // Helpers
}

