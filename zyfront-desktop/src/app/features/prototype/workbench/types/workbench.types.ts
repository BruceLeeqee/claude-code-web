import type { Attachment as CoreAttachment, InputSubmittedPayload as CoreInputSubmittedPayload } from '../../../../core/multi-agent/multi-agent.events';

export type Attachment = CoreAttachment;
export type InputSubmittedPayload = CoreInputSubmittedPayload;

export interface WorkbenchState {
  layout: LayoutState;
  session: SessionState;
  input: InputState;
  task: TaskState;
  output: OutputState;
}

export interface LayoutState {
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  responsiveMode: 'wide' | 'medium' | 'narrow';
}

export interface SessionState {
  currentSessionId: string;
  sessions: SessionItem[];
  isLoading: boolean;
}

export interface SessionItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  taskCount: number;
  tags: string[];
  summary?: string;
  isPinned: boolean;
  isArchived: boolean;
}

export interface InputState {
  draftText: string;
  attachments: Attachment[];
  isExpanded: boolean;
  isFocused: boolean;
}

export interface TaskState {
  currentTaskGraph?: TaskGraph;
  agentStates: AgentStateItem[];
  isLoading: boolean;
}

export interface AgentStateItem {
  agentId: string;
  role: 'leader' | 'planner' | 'executor' | 'reviewer' | 'researcher';
  name: string;
  status: 'idle' | 'running' | 'blocked' | 'failed';
  modelId?: string;
  lastHeartbeat?: number;
  assignedTasks: string[];
}

export interface OutputState {
  items: OutputItem[];
  scrollToBottom: boolean;
}

export interface OutputItem {
  id: string;
  type: 'terminal' | 'card' | 'diff' | 'image' | 'file' | 'error';
  timestamp: number;
  content: any;
  sessionId: string;
  taskId?: string;
  agentId?: string;
}

export interface TaskGraph {
  rootTask: TaskNode;
  version: number;
}

export interface TaskNode {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  progress?: number;
  agentId?: string;
  children?: TaskNode[];
  dependsOn?: string[];
}
