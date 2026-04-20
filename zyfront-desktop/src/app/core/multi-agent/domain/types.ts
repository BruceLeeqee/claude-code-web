export type AgentLifecycleStatus =
  | 'draft'
  | 'initializing'
  | 'running'
  | 'idle'
  | 'waiting'
  | 'blocked'
  | 'reconnecting'
  | 'background'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'archived';

export type TaskNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SessionStatus =
  | 'created'
  | 'active'
  | 'paused'
  | 'background'
  | 'reconnecting'
  | 'closed'
  | 'error';

export type TeamStatus =
  | 'forming'
  | 'active'
  | 'scaling'
  | 'converging'
  | 'completed'
  | 'stopped'
  | 'error';

export type AgentRole =
  | 'leader'
  | 'planner'
  | 'executor'
  | 'reviewer'
  | 'researcher'
  | 'validator'
  | 'coordinator';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export type TaskType =
  | 'planning'
  | 'coding'
  | 'debugging'
  | 'review'
  | 'research'
  | 'testing'
  | 'documentation'
  | 'analysis'
  | 'coordination';

export interface AgentDescriptor {
  agentId: string;
  agentName: string;
  role: AgentRole;
  teamId: string;
  sessionId: string;
  modelId: string;
  backendType: 'in-process' | 'tmux' | 'iterm2';
  cwd?: string;
  promptTemplate?: string;
  permissions: string[];
  createdAt: number;
  createdBy: 'user' | 'planner' | 'auto-scale' | 'recovery';
  lifetimePolicy: 'permanent' | 'task-bound' | 'idle-timeout';
  maxIdleMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeState {
  agentId: string;
  status: AgentLifecycleStatus;
  lastSeenAt: number;
  heartbeatInterval: number;
  activeTaskIds: string[];
  blockedReason?: string;
  errorCode?: string;
  errorMessage?: string;
  recoveryAttempts: number;
  totalMessagesProcessed: number;
  totalTokensUsed: number;
  startedAt: number;
  lastStateChangeAt: number;
  paneId?: string;
  windowId?: string;
}

export interface AgentIntent {
  intentId: string;
  reason: 'task-complexity' | 'context-pressure' | 'parallelism' | 'role-gap' | 'recovery';
  taskId: string;
  suggestedRole: AgentRole;
  expectedInputs: string[];
  expectedOutputs: string[];
  priority: TaskPriority;
  lifetimePolicy: 'permanent' | 'task-bound' | 'idle-timeout';
  resourceBudget?: {
    maxTokens?: number;
    maxDurationMs?: number;
  };
  createdAt: number;
  expiresAt?: number;
}

export interface AgentTemplate {
  templateId: string;
  roleName: AgentRole;
  displayName: string;
  description: string;
  defaultPromptTemplate: string;
  defaultPermissions: string[];
  recommendedModelFamily: string[];
  recommendedBackend: ('in-process' | 'tmux' | 'iterm2')[];
  allowAutoRecycle: boolean;
  skills: string[];
}

export interface TaskNode {
  taskId: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskNodeStatus;
  priority: TaskPriority;
  assignedAgentId?: string;
  parentTaskId?: string;
  dependencies: string[];
  dependents: string[];
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskGraph {
  graphId: string;
  sessionId: string;
  planVersion: number;
  parentPlanVersion?: number;
  replanReason?: string;
  rootTaskIds: string[];
  tasks: Record<string, TaskNode>;
  createdAt: number;
  updatedAt: number;
  status: 'draft' | 'active' | 'completed' | 'failed' | 'superseded';
}

export interface SessionContext {
  sessionId: string;
  sessionName: string;
  status: SessionStatus;
  teamId: string;
  teamName: string;
  planVersion: number;
  currentTaskGraphId?: string;
  agentIds: string[];
  memoryScope: 'isolated' | 'shared-with-team';
  modelPolicyId: string;
  backendPolicy: 'auto' | 'in-process' | 'tmux' | 'iterm2';
  createdAt: number;
  updatedAt: number;
  snapshot?: SessionSnapshot;
}

export interface SessionSnapshot {
  snapshotId: string;
  sessionId: string;
  capturedAt: number;
  taskGraphSnapshot: TaskGraph;
  agentStates: AgentRuntimeState[];
  memoryReferences: string[];
  pendingEvents: string[];
}

export interface TeamContext {
  teamId: string;
  teamName: string;
  status: TeamStatus;
  leaderAgentId: string;
  agentIds: string[];
  sessionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ModelRouteDecision {
  decisionId: string;
  agentId: string;
  taskId?: string;
  primaryModelId: string;
  fallbackModelId?: string;
  reason: string;
  factors: {
    taskType: TaskType;
    agentRole: AgentRole;
    contextLength: 'short' | 'medium' | 'long';
    costBudget: 'low' | 'medium' | 'high';
    qualityRequirement: 'fast' | 'balanced' | 'high';
    toolUseRequired: boolean;
  };
  budgetEstimate?: {
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCostUsd: number;
  };
  confidence: number;
  createdAt: number;
}

export interface ModelRoutePolicy {
  policyId: string;
  policyName: string;
  description: string;
  rules: ModelRouteRule[];
  defaultModelId: string;
  fallbackModelId: string;
}

export interface ModelRouteRule {
  condition: {
    taskTypes?: TaskType[];
    agentRoles?: AgentRole[];
    contextLengthRange?: ['short' | 'medium' | 'long', 'short' | 'medium' | 'long'];
    maxCostUsd?: number;
    costBudget?: 'low' | 'medium' | 'high';
    qualityRequirement?: 'fast' | 'balanced' | 'high';
    toolUseRequired?: boolean;
  };
  modelId: string;
  priority: number;
}

export interface LifecycleEvent {
  eventId: string;
  entityType: 'agent' | 'task' | 'session' | 'team';
  entityId: string;
  eventType: string;
  previousState?: string;
  newState?: string;
  reason?: string;
  triggeredBy: 'system' | 'user' | 'planner' | 'auto-scale' | 'recovery';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface RecoveryAction {
  actionId: string;
  targetType: 'agent' | 'task' | 'session';
  targetId: string;
  actionType: 'restart' | 'replace' | 'reassign' | 'rollback' | 'snapshot-restore';
  reason: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  createdAt: number;
  executedAt?: number;
  result?: string;
}

export interface PlannerInput {
  userRequest: string;
  sessionContext: SessionContext;
  teamContext: TeamContext;
  availableAgents: AgentDescriptor[];
  modelBudget?: {
    maxTotalCostUsd?: number;
    maxTokensPerTask?: number;
  };
  toolAvailability: Record<string, boolean>;
  constraints?: string[];
}

export interface PlannerOutput {
  planVersion: number;
  taskGraph: TaskGraph;
  agentIntents: AgentIntent[];
  estimatedDurationMs: number;
  estimatedCostUsd: number;
  riskAssessment: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
    mitigations: string[];
  };
  requiresApproval: boolean;
  explanation: string;
}
