# 多智能体系统技术文档

> 版本: 1.0.0  
> 更新日期: 2026-04-20

---

## 目录

1. [系统架构](#1-系统架构)
2. [核心模块](#2-核心模块)
3. [API参考](#3-api参考)
4. [数据结构](#4-数据结构)
5. [事件系统](#5-事件系统)
6. [状态机](#6-状态机)
7. [权限系统](#7-权限系统)
8. [扩展开发](#8-扩展开发)

---

## 1. 系统架构

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         应用层                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    MultiAgentFacade                       │   │
│  │              (统一门面，协调所有服务)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                         服务层                                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │ModeSwitch   │ │TaskPlanner  │ │Permission   │              │
│  │ApiService   │ │Service      │ │Service      │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │ExecutionMode│ │SingleAgent  │ │AgentState   │              │
│  │Decider      │ │Execution    │ │Machine      │              │
│  │Service      │ │Service      │ │Service      │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │MultiAgent   │ │AgentFactory │ │Session      │              │
│  │ConfigService│ │Service      │ │Registry     │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
├─────────────────────────────────────────────────────────────────┤
│                         工具层                                   │
│  ┌─────────────┐ ┌─────────────┐                              │
│  │AgentTool    │ │TeamCreate   │                              │
│  │Service      │ │ToolService  │                              │
│  └─────────────┘ └─────────────┘                              │
├─────────────────────────────────────────────────────────────────┤
│                         基础设施层                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │EventBus     │ │Domain Types │ │Storage      │              │
│  │Service      │ │             │ │             │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 模块依赖关系

```
MultiAgentFacade
    ├── ModeSwitchApiService
    │   └── ExecutionModeDeciderService
    │       └── TaskPlannerService
    ├── TaskPlannerService
    ├── AgentFactoryService
    ├── AgentLifecycleManager
    ├── SessionRegistryService
    ├── ModelRouterService
    ├── AutoScaleOrchestrator
    ├── PermissionService
    ├── AgentStateMachineService
    ├── SingleAgentExecutionService
    ├── AgentToolService
    ├── TeamCreateToolService
    └── MultiAgentEventBusService
```

### 1.3 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Angular | 17+ | 前端框架 |
| TypeScript | 5.0+ | 开发语言 |
| RxJS | 7+ | 响应式编程 |
| Ng-Zorro | 17+ | UI组件库 |
| Signals | - | 状态管理 |

---

## 2. 核心模块

### 2.1 ExecutionModeDeciderService

**职责**：根据任务复杂度决策执行模式

**文件位置**：`src/app/core/multi-agent/services/execution-mode-decider.service.ts`

**核心方法**：

```typescript
@Injectable({ providedIn: 'root' })
export class ExecutionModeDeciderService {
  decide(userRequest: string, context?: PlannerInput): ModeDecision;
  forceExecutionMode(mode: ExecutionMode): void;
  setMultiAgentEnabled(enabled: boolean): void;
  isMultiAgentEnabled(): boolean;
  getForcedMode(): ExecutionMode | null;
  clearForce(): void;
  suggestTeamConfig(request: string): TeamConfig;
  getModeIndicator(decision: ModeDecision): string;
}
```

**决策流程**：

```
输入请求
    │
    ▼
检查强制模式 ──────► 返回强制模式
    │
    ▼ (无强制)
检查多智能体是否启用 ──────► 返回单Agent模式
    │
    ▼ (已启用)
分析复杂度
    │
    ├── 简单任务 ──────► 返回单Agent模式
    │
    └── 复杂任务 ──────► 返回多智能体模式
```

### 2.2 ModeSwitchApiService

**职责**：提供模式切换API

**文件位置**：`src/app/core/multi-agent/services/mode-switch-api.service.ts`

**核心方法**：

```typescript
@Injectable({ providedIn: 'root' })
export class ModeSwitchApiService {
  initialize(): void;
  mode(): ExecutionMode;
  decision(): ModeDecision | null;
  switchToSingle(options?: ModeSwitchOptions): ModeSwitchResult;
  switchToMulti(options?: ModeSwitchOptions): ModeSwitchResult;
  toggleMode(options?: ModeSwitchOptions): ModeSwitchResult;
  forceSingle(): ModeSwitchResult;
  forceMulti(): ModeSwitchResult;
  clearForce(): ModeSwitchResult;
  isForced(): boolean;
  canToggle(): boolean;
  decideForRequest(request: string): ModeDecision;
}
```

### 2.3 TaskPlannerService

**职责**：任务规划与复杂度分析

**文件位置**：`src/app/core/multi-agent/services/task-planner.service.ts`

**核心方法**：

```typescript
@Injectable({ providedIn: 'root' })
export class TaskPlannerService {
  plan(input: PlannerInput): TaskGraph;
  planSimple(request: string): SimplePlan;
  analyzeComplexity(request: string): ComplexityAnalysis;
  shouldUseSingleAgent(request: string): boolean;
  detectTaskType(request: string): TaskType;
  detectParallelTasks(tasks: SubTask[]): ParallelGroup[];
  suggestRoles(taskType: TaskType, subtaskCount: number): AgentRole[];
}
```

**复杂度分析算法**：

```typescript
analyzeComplexity(request: string): ComplexityAnalysis {
  const factors: string[] = [];
  let score = 0;

  // 1. 长度分析
  score += this.analyzeLength(request, factors);

  // 2. 关键词分析
  score += this.analyzeKeywords(request, factors);

  // 3. 跨领域检测
  score += this.analyzeCrossDomain(request, factors);

  // 4. 并行性检测
  score += this.analyzeParallelism(request, factors);

  // 5. 依赖关系分析
  score += this.analyzeDependencies(request, factors);

  // 6. 技术复杂度
  score += this.analyzeTechnicalComplexity(request, factors);

  // 7. 业务复杂度
  score += this.analyzeBusinessComplexity(request, factors);

  // 计算等级
  const level = score <= 2 ? 'simple' : score <= 5 ? 'medium' : 'complex';

  return { level, factors, score, ... };
}
```

### 2.4 SingleAgentExecutionService

**职责**：单Agent任务执行

**文件位置**：`src/app/core/multi-agent/services/single-agent-execution.service.ts`

**核心方法**：

```typescript
@Injectable({ providedIn: 'root' })
export class SingleAgentExecutionService {
  execute(
    request: string,
    executor: (request: string, taskType: TaskType) => Promise<string>
  ): Promise<SingleAgentExecutionResult>;
  getCurrentExecution(): SingleAgentExecutionLog | null;
  getExecutionLogs(): SingleAgentExecutionLog[];
  getStatistics(): { total: number; success: number; failed: number };
  clearLogs(): void;
}
```

### 2.5 AgentStateMachineService

**职责**：智能体状态机管理

**文件位置**：`src/app/core/multi-agent/services/agent-state-machine.service.ts`

**状态定义**：

```typescript
export type AgentState =
  | 'initializing'  // 初始化中
  | 'ready'         // 就绪
  | 'busy'          // 执行中
  | 'waiting'       // 等待中
  | 'recovering'    // 恢复中
  | 'stopping'      // 停止中
  | 'stopped'       // 已停止
  | 'failed';       // 失败
```

**状态转换规则**：

```typescript
const STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  initializing: ['ready', 'failed'],
  ready: ['busy', 'stopping', 'failed'],
  busy: ['ready', 'waiting', 'failed'],
  waiting: ['busy', 'ready', 'stopping'],
  recovering: ['ready', 'failed'],
  stopping: ['stopped'],
  stopped: [],
  failed: ['recovering', 'stopping'],
};
```

### 2.6 PermissionService

**职责**：权限检查与审计日志

**文件位置**：`src/app/core/multi-agent/services/permission.service.ts`

**核心方法**：

```typescript
@Injectable({ providedIn: 'root' })
export class PermissionService {
  checkAgentToolPermission(input: AgentToolInput): Promise<PermissionResult>;
  checkTeamCreatePermission(teamName: string): Promise<PermissionResult>;
  checkModeSwitchPermission(mode: ExecutionMode): Promise<PermissionResult>;
  checkResourcePermission(resource: string, action: string): Promise<PermissionResult>;
  isSensitiveOperation(prompt: string): boolean;
  getAuditLogs(filter?: AuditFilter): AuditLogEntry[];
  getPermissionStats(): PermissionStats;
  clearAuditLogs(): void;
}
```

### 2.7 AgentToolService

**职责**：LLM Agent工具

**文件位置**：`src/app/core/multi-agent/tools/agent-tool.service.ts`

**工具Schema**：

```typescript
const AGENT_TOOL_SCHEMA = {
  name: 'Agent',
  description: '启动一个专门的代理来完成任务',
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: '任务描述',
      },
      prompt: {
        type: 'string',
        description: '给代理的详细指令',
      },
      subagent_type: {
        type: 'string',
        enum: ['researcher', 'planner', 'executor', 'reviewer', 'validator'],
        description: '代理类型',
      },
      model: {
        type: 'string',
        enum: ['sonnet', 'opus', 'haiku'],
        description: '使用的模型',
      },
      run_in_background: {
        type: 'boolean',
        description: '是否后台运行',
      },
    },
    required: ['description', 'prompt'],
  },
};
```

### 2.8 TeamCreateToolService

**职责**：团队创建与管理

**文件位置**：`src/app/core/multi-agent/tools/team-create-tool.service.ts`

**核心方法**：

```typescript
@Injectable({ providedIn: 'root' })
export class TeamCreateToolService {
  createTeam(input: TeamCreateInput): Promise<TeamCreateOutput>;
  disbandTeam(): Promise<void>;
  getCurrentTeam(): TeamInfo | null;
  inferRoles(taskDescription: string): AgentRole[];
  generateTeamName(description: string): string;
  getStatistics(): TeamStatistics;
}
```

---

## 3. API参考

### 3.1 模式决策API

#### decide

决策执行模式

```typescript
decide(userRequest: string, context?: PlannerInput): ModeDecision
```

**参数**：
- `userRequest`: 用户请求文本
- `context`: 可选的规划上下文

**返回值**：

```typescript
interface ModeDecision {
  mode: ExecutionMode;           // 'single' | 'multi'
  reason: string;                // 决策原因
  complexity: ComplexityAnalysis; // 复杂度分析
  suggestedTeamConfig?: TeamConfig; // 建议的团队配置
}
```

### 3.2 任务规划API

#### plan

规划复杂任务

```typescript
plan(input: PlannerInput): TaskGraph
```

**参数**：

```typescript
interface PlannerInput {
  userRequest: string;
  context?: {
    files?: string[];
    projectType?: string;
    existingCode?: string;
  };
}
```

**返回值**：

```typescript
interface TaskGraph {
  id: string;
  rootTask: SubTask;
  subtasks: SubTask[];
  dependencies: Dependency[];
  parallelGroups: ParallelGroup[];
  estimatedDurationMs: number;
}
```

#### planSimple

规划简单任务

```typescript
planSimple(request: string): SimplePlan
```

**返回值**：

```typescript
interface SimplePlan {
  type: 'simple';
  task: {
    title: string;
    description: string;
    type: TaskType;
  };
  estimatedDurationMs: number;
  shouldUseSingleAgent: boolean;
}
```

### 3.3 复杂度分析API

#### analyzeComplexity

分析任务复杂度

```typescript
analyzeComplexity(request: string): ComplexityAnalysis
```

**返回值**：

```typescript
interface ComplexityAnalysis {
  level: 'simple' | 'medium' | 'complex';
  factors: string[];
  estimatedSubtasks: number;
  requiresMultipleAgents: boolean;
  estimatedDurationMs: number;
  domains?: string[];
  hasParallelism?: boolean;
  dependencyCount?: number;
}
```

### 3.4 权限检查API

#### checkAgentToolPermission

检查Agent工具调用权限

```typescript
checkAgentToolPermission(input: AgentToolInput): Promise<PermissionResult>
```

**返回值**：

```typescript
type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string }
  | { allowed: 'ask'; reason: string; confirmationMessage: string };
```

### 3.5 状态机API

#### transition

转换智能体状态

```typescript
transition(agentId: string, targetState: AgentState, reason: string): boolean
```

**返回值**：转换是否成功

#### attemptRecovery

尝试恢复失败的智能体

```typescript
attemptRecovery(agentId: string, maxAttempts?: number): boolean
```

---

## 4. 数据结构

### 4.1 核心类型

```typescript
// 执行模式
type ExecutionMode = 'single' | 'multi';

// 任务类型
type TaskType =
  | 'coding'
  | 'debugging'
  | 'testing'
  | 'review'
  | 'documentation'
  | 'research'
  | 'analysis'
  | 'planning'
  | 'coordination';

// 智能体角色
type AgentRole =
  | 'leader'
  | 'planner'
  | 'executor'
  | 'reviewer'
  | 'researcher'
  | 'validator'
  | 'coordinator';

// 智能体状态
type AgentState =
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'waiting'
  | 'recovering'
  | 'stopping'
  | 'stopped'
  | 'failed';
```

### 4.2 配置类型

```typescript
interface MultiAgentConfig {
  enabled: boolean;
  maxAgents: number;
  forceMode: ExecutionMode | null;
  defaultBackend: 'in-process' | 'tmux' | 'iterm2';
  complexityThreshold: {
    simple: number;
    medium: number;
  };
  timeouts: {
    agentIdle: number;
    taskExecution: number;
    recovery: number;
  };
}
```

### 4.3 任务类型

```typescript
interface SubTask {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];
  assignedAgentId?: string;
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  result?: unknown;
  error?: string;
}

interface TaskGraph {
  id: string;
  rootTask: SubTask;
  subtasks: SubTask[];
  dependencies: Dependency[];
  parallelGroups: ParallelGroup[];
  estimatedDurationMs: number;
}

interface Dependency {
  from: string;
  to: string;
  type: 'hard' | 'soft';
}

interface ParallelGroup {
  id: string;
  taskIds: string[];
  canRunInParallel: boolean;
}
```

### 4.4 智能体类型

```typescript
interface Agent {
  id: string;
  role: AgentRole;
  status: AgentState;
  capabilities: string[];
  currentTask?: string;
  createdAt: number;
  lastActivityAt: number;
  metadata?: Record<string, unknown>;
}

interface AgentIntent {
  id: string;
  agentId: string;
  type: string;
  payload: unknown;
  createdAt: number;
  expiresAt?: number;
}
```

---

## 5. 事件系统

### 5.1 事件类型

```typescript
type MultiAgentEventType =
  // 模式事件
  | 'mode.single'
  | 'mode.multi'
  | 'mode.auto'
  // 智能体事件
  | 'agent.created'
  | 'agent.initializing'
  | 'agent.started'
  | 'agent.idle'
  | 'agent.waiting'
  | 'agent.blocked'
  | 'agent.reconnecting'
  | 'agent.background'
  | 'agent.stopping'
  | 'agent.stopped'
  | 'agent.failed'
  | 'agent.recovered'
  | 'agent.terminated'
  | 'agent.archived'
  // 任务事件
  | 'task.planned'
  | 'task.assigned'
  | 'task.started'
  | 'task.progress'
  | 'task.blocked'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  // 团队事件
  | 'team.updated'
  | 'multiagent.teammate.spawned'
  | 'multiagent.teammate.state.changed'
  | 'multiagent.teammate.stopped'
  | 'multiagent.teammate.killed'
  | 'multiagent.teammate.failed'
  // 会话事件
  | 'session.created'
  | 'session.resumed'
  | 'session.paused'
  | 'session.closed'
  | 'session.snapshot.created'
  | 'session.snapshot.restored'
  // 其他
  | 'multiagent.error'
  | 'model.routed'
  | 'model.fallback'
  | 'memory.synced'
  | 'recovery.initiated'
  | 'recovery.completed';
```

### 5.2 事件Payload

```typescript
// 模式事件Payload
interface ModeSinglePayload {
  mode: 'single';
  reason: string;
  complexity?: ComplexityAnalysis;
  previousMode?: 'single' | 'multi';
  timestamp?: number;
}

interface ModeMultiPayload {
  mode: 'multi';
  reason: string;
  complexity?: ComplexityAnalysis;
  suggestedTeamConfig?: TeamConfig;
  previousMode?: 'single' | 'multi';
  timestamp?: number;
}

// 智能体事件Payload
interface AgentCreatedPayload {
  agentId: string;
  role: AgentRole;
  template?: string;
  intentId?: string;
}

interface AgentStatusChangedPayload {
  agentId: string;
  previousStatus: AgentState;
  newStatus: AgentState;
  reason?: string;
}

// 任务事件Payload
interface TaskPlannedPayload {
  graphId: string;
  subtaskCount: number;
  parallelGroups: number;
  estimatedDurationMs: number;
}

interface TaskAssignedPayload {
  taskId: string;
  agentId: string;
  taskType: TaskType;
}
```

### 5.3 事件总线

```typescript
@Injectable({ providedIn: 'root' })
export class MultiAgentEventBusService {
  emit(event: MultiAgentEvent): void;
  on<T = unknown>(
    eventType: MultiAgentEventType,
    handler: (payload: T) => void
  ): () => void;
  onAll(handler: (event: MultiAgentEvent) => void): () => void;
  getHistory(): MultiAgentEvent[];
  clearHistory(): void;
}
```

**使用示例**：

```typescript
// 发送事件
eventBus.emit({
  type: 'mode.multi',
  sessionId: 'session-123',
  source: 'user',
  payload: {
    mode: 'multi',
    reason: '任务复杂度高',
  },
});

// 监听事件
const unsubscribe = eventBus.on<ModeMultiPayload>('mode.multi', (payload) => {
  console.log('切换到多智能体模式:', payload.reason);
});

// 取消监听
unsubscribe();
```

---

## 6. 状态机

### 6.1 状态图

```
                    ┌──────────────┐
                    │ initializing │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            │            ▼
         ┌────────┐        │       ┌────────┐
         │ ready  │◄───────┘       │ failed │
         └───┬────┘                └───┬────┘
             │                         │
     ┌───────┼───────┐                 │
     │       │       │                 │
     ▼       │       ▼                 ▼
┌────────┐   │  ┌────────┐       ┌────────────┐
│  busy  │   │  │stopping│       │ recovering │
└───┬────┘   │  └───┬────┘       └─────┬──────┘
    │        │      │                  │
    │        │      ▼                  │
    │        │  ┌────────┐             │
    │        │  │stopped │             │
    │        │  └────────┘             │
    │        │                         │
    └────────►┴─────────────────────────┘
              │
              ▼
         ┌────────┐
         │waiting │
         └───┬────┘
             │
             └──────► ready
```

### 6.2 状态转换表

| 当前状态 | 可转换状态 | 触发条件 |
|----------|------------|----------|
| initializing | ready | 初始化完成 |
| initializing | failed | 初始化失败 |
| ready | busy | 接收任务 |
| ready | stopping | 停止请求 |
| ready | failed | 发生错误 |
| busy | ready | 任务完成 |
| busy | waiting | 等待依赖 |
| busy | failed | 执行失败 |
| waiting | busy | 依赖就绪 |
| waiting | ready | 任务取消 |
| waiting | stopping | 停止请求 |
| recovering | ready | 恢复成功 |
| recovering | failed | 恢复失败 |
| stopping | stopped | 停止完成 |
| failed | recovering | 尝试恢复 |
| failed | stopping | 放弃恢复 |
| stopped | - | 终态 |

### 6.3 使用示例

```typescript
// 初始化状态机
stateMachine.initialize({
  agentId: 'agent-123',
  initialState: 'initializing',
  maxRecoveryAttempts: 3,
});

// 检查转换是否合法
if (stateMachine.canTransition('agent-123', 'ready')) {
  stateMachine.transition('agent-123', 'ready', '初始化完成');
}

// 处理失败
stateMachine.transition('agent-123', 'failed', '执行错误');

// 尝试恢复
if (stateMachine.attemptRecovery('agent-123', 3)) {
  // 恢复中...
  stateMachine.markRecovered('agent-123');
}

// 获取状态统计
const stats = stateMachine.getStateStats();
console.log(stats);
// { total: 5, ready: 2, busy: 2, failed: 1, ... }
```

---

## 7. 权限系统

### 7.1 权限检查流程

```
操作请求
    │
    ▼
┌─────────────────┐
│ 检查多智能体启用 │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  启用      禁用
    │         │
    ▼         ▼
┌─────────┐ ┌─────────┐
│检查数量限制│ │拒绝请求  │
└────┬────┘ └─────────┘
     │
┌────┴────┐
│         │
▼         ▼
未超限   超限
│         │
▼         ▼
┌─────────┐ ┌─────────┐
│检查敏感操作│ │拒绝请求  │
└────┬────┘ └─────────┘
     │
┌────┴────┐
│         │
▼         ▼
非敏感   敏感
│         │
▼         ▼
┌─────────┐ ┌─────────┐
│ 允许执行 │ │请求用户确认│
└─────────┘ └─────────┘
```

### 7.2 敏感操作检测

系统自动检测以下敏感操作：

| 模式 | 说明 |
|------|------|
| `/删除|delete|remove|drop/i` | 删除操作 |
| `/格式化|format/i` | 格式化操作 |
| `/清空|clear|truncate/i` | 清空操作 |
| `/修改密码|change\s*password/i` | 密码修改 |
| `/授权|authorize|grant/i` | 授权操作 |
| `/root|admin|superuser/i` | 特权操作 |
| `/生产环境|production/i` | 生产环境 |
| `/数据库|database/i` | 数据库操作 |

### 7.3 审计日志

```typescript
interface AuditLogEntry {
  id: string;
  timestamp: number;
  action: string;
  agentId?: string;
  details: Record<string, unknown>;
  result: 'allowed' | 'denied' | 'pending';
  reason?: string;
}
```

**查询审计日志**：

```typescript
// 获取所有被拒绝的操作
const deniedLogs = permission.getAuditLogs({
  result: 'denied',
});

// 获取最近24小时的日志
const recentLogs = permission.getAuditLogs({
  since: Date.now() - 24 * 60 * 60 * 1000,
});

// 获取特定操作的日志
const agentLogs = permission.getAuditLogs({
  action: 'agent_tool_call',
});
```

---

## 8. 扩展开发

### 8.1 添加新的智能体角色

1. 在 `domain/types.ts` 中添加角色类型：

```typescript
export type AgentRole =
  | 'leader'
  | 'planner'
  | 'executor'
  | 'reviewer'
  | 'researcher'
  | 'validator'
  | 'coordinator'
  | 'custom_role'; // 新增角色
```

2. 在 `AgentFactoryService` 中添加角色模板：

```typescript
private readonly roleTemplates: Record<AgentRole, AgentTemplate> = {
  // ...
  custom_role: {
    role: 'custom_role',
    capabilities: ['capability1', 'capability2'],
    systemPrompt: '你是一个自定义角色...',
  },
};
```

3. 在 `TeamCreateToolService` 中添加角色推断逻辑：

```typescript
inferRoles(taskDescription: string): AgentRole[] {
  if (/特定关键词/.test(taskDescription)) {
    return ['custom_role', ...];
  }
  // ...
}
```

### 8.2 添加新的任务类型

1. 在 `domain/types.ts` 中添加任务类型：

```typescript
export type TaskType =
  | 'coding'
  | 'debugging'
  // ...
  | 'custom_task'; // 新增类型
```

2. 在 `TaskPlannerService` 中添加检测逻辑：

```typescript
private readonly taskTypeKeywords: Record<TaskType, string[]> = {
  // ...
  custom_task: ['关键词1', '关键词2'],
};
```

### 8.3 添加新的事件类型

1. 在 `multi-agent.events.ts` 中添加事件类型：

```typescript
export type MultiAgentEventType =
  // ...
  | 'custom.event';

export const EVENT_TYPES = {
  // ...
  CUSTOM_EVENT: 'custom.event' as const,
};
```

2. 定义事件Payload：

```typescript
export interface CustomEventPayload {
  // 自定义字段
}
```

3. 发送事件：

```typescript
eventBus.emit({
  type: EVENT_TYPES.CUSTOM_EVENT,
  sessionId: 'session-id',
  source: 'custom',
  payload: { /* ... */ },
});
```

### 8.4 自定义复杂度分析

继承 `TaskPlannerService` 并重写分析方法：

```typescript
@Injectable({ providedIn: 'root' })
export class CustomTaskPlannerService extends TaskPlannerService {
  protected override analyzeComplexity(request: string): ComplexityAnalysis {
    const base = super.analyzeComplexity(request);
    
    // 添加自定义分析逻辑
    const customScore = this.analyzeCustomFactors(request);
    
    return {
      ...base,
      score: base.score + customScore,
    };
  }

  private analyzeCustomFactors(request: string): number {
    // 自定义分析逻辑
    return 0;
  }
}
```

### 8.5 添加新的权限检查

在 `PermissionService` 中添加新的检查方法：

```typescript
checkCustomPermission(input: CustomInput): Promise<PermissionResult> {
  // 自定义权限检查逻辑
  if (/* 条件 */) {
    return { allowed: true };
  }
  
  this.logAudit('custom_action', { input }, 'denied', '原因');
  return { allowed: false, reason: '原因' };
}
```

---

## 附录

### A. 文件结构

```
src/app/core/multi-agent/
├── domain/
│   └── types.ts                    # 核心类型定义
├── services/
│   ├── execution-mode-decider.service.ts
│   ├── mode-switch-api.service.ts
│   ├── task-planner.service.ts
│   ├── single-agent-execution.service.ts
│   ├── agent-state-machine.service.ts
│   ├── permission.service.ts
│   ├── multi-agent-config.service.ts
│   ├── agent-factory.service.ts
│   ├── agent-lifecycle-manager.service.ts
│   ├── session-registry.service.ts
│   ├── model-router.service.ts
│   └── auto-scale-orchestrator.service.ts
├── tools/
│   ├── agent-tool.service.ts
│   └── team-create-tool.service.ts
├── multi-agent.events.ts           # 事件定义
├── multi-agent.event-bus.service.ts
├── multi-agent.facade.ts           # 统一门面
├── multi-agent-sidebar.component.ts
├── multi-agent-config-panel.component.ts
└── index.ts                        # 导出
```

### B. 依赖注入

所有服务都使用 Angular 的依赖注入系统：

```typescript
@Injectable({ providedIn: 'root' })
export class MyService {
  private readonly otherService = inject(OtherService);
}
```

### C. 测试

运行测试：

```bash
node scripts/multi-agent-optimization-test.js
```

测试报告位置：`docs/multi-agent-optimization-test-report.md`

---

*本文档最后更新于 2026-04-20*
