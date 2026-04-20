# Zyfront Desktop 多智能体系统优化计划

> 基于 Claude Code 源码分析，优化当前多智能体系统，实现"默认单 Agent，复杂任务自动触发多智能体"的智能执行模式。

---

## 1. 核心设计理念

### 1.1 执行模式分层

```
┌─────────────────────────────────────────────────────────────┐
│                    用户提示词输入                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   复杂度分析器 (新增)                          │
│  - 分析任务复杂度 (simple/medium/complex)                     │
│  - 检测并行任务、跨领域依赖                                     │
│  - 评估是否需要多智能体协作                                     │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌───────────────────────┐       ┌───────────────────────────────┐
│   单 Agent 模式        │       │     多智能体模式 (高级)         │
│   (默认)               │       │     (条件触发)                  │
│                       │       │                               │
│  - 直接执行            │       │  - 任务拆分                    │
│  - 工具调用            │       │  - 角色分配                    │
│  - 结果返回            │       │  - 并行/串行调度               │
│                       │       │  - 结果汇总                    │
│  适用场景：            │       │                               │
│  - 查文档              │       │  适用场景：                     │
│  - 改一行代码          │       │  - 多模块开发                   │
│  - 跑测试              │       │  - 并行任务                     │
│  - 简单问答            │       │  - 跨领域协作                   │
└───────────────────────┘       └───────────────────────────────┘
```

### 1.2 Claude Code 参考要点

从 Claude Code 源码中提取的关键设计模式：

| 模式 | Claude Code 实现 | 当前状态 | 优化方向 |
|------|-----------------|---------|---------|
| Coordinator Mode | `isCoordinatorMode()` 环境变量控制 | ❌ 缺失 | 新增模式切换机制 |
| Agent Tool | LLM 自主决定调用 `AgentTool` | ⚠️ 部分 | 优化触发决策 |
| Team Create | `TeamCreateTool` 显式创建团队 | ⚠️ 部分 | 自动化创建流程 |
| Worker 生命周期 | `LocalAgentTask` / `RemoteAgentTask` | ⚠️ 部分 | 完善生命周期管理 |
| 权限控制 | `handleCoordinatorPermission` | ❌ 缺失 | 新增权限层 |
| 消息传递 | `SendMessageTool` + Mailbox | ⚠️ 部分 | 完善通信机制 |

---

## 2. 优化目标

### 2.1 核心目标

1. **默认单 Agent 执行**：简单任务直接由主 Agent 完成，不拆分、不派生子 Agent
2. **智能触发多智能体**：复杂任务自动判断并触发多智能体协作
3. **LLM 自主决策**：模型主动决定是否需要拆分任务
4. **可配置控制**：支持强制关闭/手动开启多智能体模式

### 2.2 用户体验目标

```
简单任务流程：
用户: "帮我查一下 README.md 的内容"
系统: [单Agent直接读取文件] → 返回结果

复杂任务流程：
用户: "实现一个用户认证系统，包括登录、注册、密码重置功能"
系统: 
  1. 复杂度分析 → complex
  2. 自动创建 Team
  3. 拆分任务：认证核心 / API设计 / 测试编写
  4. 分配智能体：executor / planner / validator
  5. 并行执行 → 汇总结果
```

---

## 3. 架构优化方案

### 3.1 新增模块：执行模式决策器

```typescript
// src/app/core/multi-agent/services/execution-mode-decider.service.ts

export type ExecutionMode = 'single' | 'multi';

export interface ModeDecision {
  mode: ExecutionMode;
  reason: string;
  complexity: ComplexityAnalysis;
  suggestedTeamConfig?: TeamConfig;
}

@Injectable({ providedIn: 'root' })
export class ExecutionModeDeciderService {
  private readonly multiAgentEnabled = signal(true);
  private readonly forceMode = signal<ExecutionMode | null>(null);

  decide(userRequest: string, context: PlannerInput): ModeDecision {
    // 1. 检查强制模式
    if (this.forceMode()) {
      return this.createForcedDecision(this.forceMode()!);
    }

    // 2. 检查多智能体是否启用
    if (!this.multiAgentEnabled()) {
      return this.createSingleDecision('多智能体模式已禁用');
    }

    // 3. 分析复杂度
    const complexity = this.planner.analyzeComplexity(userRequest);

    // 4. 决策
    if (complexity.level === 'simple' && !complexity.requiresMultipleAgents) {
      return this.createSingleDecision('简单任务，单Agent执行');
    }

    // 5. 复杂任务 → 多智能体
    return this.createMultiDecision(complexity, context);
  }

  setMultiAgentEnabled(enabled: boolean): void {
    this.multiAgentEnabled.set(enabled);
  }

  forceExecutionMode(mode: ExecutionMode | null): void {
    this.forceMode.set(mode);
  }
}
```

### 3.2 优化模块：任务规划器

```typescript
// 优化 TaskPlannerService

export class TaskPlannerService {
  // 新增：简单任务快速路径
  async planSimple(request: string): Promise<SimplePlan> {
    return {
      type: 'simple',
      task: {
        title: '执行任务',
        description: request,
        type: this.detectTaskType(request),
      },
      estimatedDurationMs: 30_000,
    };
  }

  // 优化：复杂任务规划
  async planComplex(input: PlannerInput): Promise<PlannerOutput> {
    const complexity = this.analyzeComplexity(input.userRequest);
    
    // 只有真正复杂才拆分
    if (complexity.level !== 'complex') {
      return this.planMedium(input);
    }

    // 复杂任务：完整拆分流程
    return this.planWithDecomposition(input, complexity);
  }
}
```

### 3.3 新增模块：Agent Tool 集成

```typescript
// src/app/core/multi-agent/tools/agent-tool.service.ts

export interface AgentToolInput {
  description: string;
  prompt: string;
  subagent_type?: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  run_in_background?: boolean;
}

export interface AgentToolOutput {
  status: 'completed' | 'async_launched' | 'teammate_spawned';
  result?: string;
  agentId?: string;
}

@Injectable({ providedIn: 'root' })
export class AgentToolService {
  async call(input: AgentToolInput, context: ToolContext): Promise<AgentToolOutput> {
    // 1. 验证输入
    this.validateInput(input);

    // 2. 选择执行后端
    const backend = this.selectBackend(context);

    // 3. 创建智能体
    const agent = await this.factory.createAgent({
      role: input.subagent_type || 'executor',
      model: input.model,
      description: input.description,
    });

    // 4. 执行任务
    if (input.run_in_background) {
      return this.executeAsync(agent, input.prompt, backend);
    }
    return this.executeSync(agent, input.prompt, backend);
  }
}
```

### 3.4 新增模块：Team Create Tool 集成

```typescript
// src/app/core/multi-agent/tools/team-create-tool.service.ts

export interface TeamCreateInput {
  team_name: string;
  description?: string;
  agent_type?: string;
}

export interface TeamCreateOutput {
  team_name: string;
  team_file_path: string;
  lead_agent_id: string;
}

@Injectable({ providedIn: 'root' })
export class TeamCreateToolService {
  async createTeam(input: TeamCreateInput): Promise<TeamCreateOutput> {
    // 1. 检查是否已在团队中
    if (this.sessionRegistry.getCurrentTeam()) {
      throw new Error('已存在活动团队，请先解散当前团队');
    }

    // 2. 生成唯一团队名
    const teamName = this.generateUniqueName(input.team_name);

    // 3. 创建团队文件
    const teamFile = await this.createTeamFile(teamName, input);

    // 4. 注册团队
    this.sessionRegistry.registerTeam(teamFile);

    // 5. 发送事件
    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_CREATED,
      sessionId: this.sessionRegistry.getCurrentSessionId(),
      source: 'user',
      payload: { team: teamFile },
    });

    return {
      team_name: teamName,
      team_file_path: teamFile.filePath,
      lead_agent_id: teamFile.leadAgentId,
    };
  }
}
```

---

## 4. 里程碑计划

### 里程碑 0：基础设施准备 (Week 1)

**目标**：建立优化所需的基础设施

**任务清单**：
- [ ] 创建 `ExecutionModeDeciderService`
- [ ] 定义 `ExecutionMode` 类型和决策接口
- [ ] 添加多智能体启用/禁用配置项
- [ ] 创建强制模式切换 API

**验收标准**：
- 可以通过配置禁用多智能体模式
- 可以强制指定执行模式
- 决策器能正确返回模式决策

---

### 里程碑 1：单 Agent 模式优化 (Week 2)

**目标**：优化单 Agent 执行流程，确保简单任务高效执行

**任务清单**：
- [ ] 实现 `planSimple()` 快速路径
- [ ] 优化 `askAssistant()` 单 Agent 流程
- [ ] 移除简单任务的不必要拆分
- [ ] 添加单 Agent 执行日志

**代码变更**：
```typescript
// workbench.page.ts
private async askAssistant(raw: string): Promise<void> {
  const decision = this.modeDecider.decide(raw, this.buildContext());
  
  if (decision.mode === 'single') {
    // 单 Agent 快速路径
    return this.executeSingleAgent(raw);
  }
  
  // 多智能体路径
  return this.executeMultiAgent(raw, decision);
}
```

**验收标准**：
- 简单任务（如"查文档"）不触发任务拆分
- 单 Agent 执行延迟 < 500ms
- 右侧边栏不显示任务分解（简单任务）

---

### 里程碑 2：复杂度分析器增强 (Week 3)

**目标**：提升复杂度分析的准确性

**任务清单**：
- [ ] 增加更多复杂度因素检测
- [ ] 实现跨领域依赖检测
- [ ] 添加并行任务识别
- [ ] 优化阈值配置

**增强的复杂度分析**：
```typescript
analyzeComplexity(request: string): ComplexityAnalysis {
  const factors: string[] = [];
  let score = 0;

  // 基础因素
  score += this.analyzeLength(request, factors);
  score += this.analyzeKeywords(request, factors);
  
  // 新增：跨领域检测
  score += this.analyzeCrossDomain(request, factors);
  
  // 新增：并行任务检测
  score += this.analyzeParallelism(request, factors);
  
  // 新增：依赖复杂度
  score += this.analyzeDependencies(request, factors);

  return {
    level: this.scoreToLevel(score),
    factors,
    requiresMultipleAgents: score > 3,
  };
}
```

**验收标准**：
- 复杂度分析准确率 > 85%
- 能正确识别跨领域任务
- 能正确识别并行任务

---

### 里程碑 3：LLM 自主决策集成 (Week 4)

**目标**：让 LLM 自主决定是否调用 AgentTool

**任务清单**：
- [ ] 定义 AgentTool 的 prompt 模板
- [ ] 实现 tool schema 暴露
- [ ] 添加 LLM 决策日志
- [ ] 实现决策回退机制

**Tool Schema 定义**：
```typescript
const AGENT_TOOL_SCHEMA = {
  name: 'Agent',
  description: 'Launch a new agent to handle a subtask. Use when task is complex enough to benefit from parallel execution.',
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: '3-5 word task description' },
      prompt: { type: 'string', description: 'Full task prompt for the agent' },
      subagent_type: { type: 'string', description: 'Agent type (executor, researcher, validator)' },
    },
    required: ['description', 'prompt'],
  },
};
```

**验收标准**：
- LLM 能自主调用 AgentTool
- 决策日志可追溯
- 错误决策有回退机制

---

### 里程碑 4：多智能体自动创建 (Week 5-6)

**目标**：实现复杂任务的自动多智能体创建

**任务清单**：
- [ ] 实现 `TeamCreateTool` 服务
- [ ] 实现自动团队创建流程
- [ ] 实现智能体角色分配
- [ ] 实现任务分发机制

**自动创建流程**：
```typescript
async executeMultiAgent(request: string, decision: ModeDecision): Promise<void> {
  // 1. 创建团队
  const team = await this.teamCreate.createTeam({
    team_name: this.generateTeamName(request),
    description: request,
  });

  // 2. 创建智能体
  for (const role of decision.suggestedTeamConfig.roles) {
    await this.agentTool.call({
      description: role.task,
      prompt: this.buildPrompt(role, request),
      subagent_type: role.type,
    });
  }

  // 3. 监控执行
  await this.monitorExecution(team);
}
```

**验收标准**：
- 复杂任务自动创建团队
- 智能体角色分配合理
- 任务分发正确

---

### 里程碑 5：生命周期管理完善 (Week 7)

**目标**：完善智能体生命周期管理

**任务清单**：
- [ ] 实现智能体状态机
- [ ] 添加心跳检测
- [ ] 实现异常恢复
- [ ] 实现自动回收

**状态机定义**：
```typescript
type AgentState = 
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'waiting'
  | 'recovering'
  | 'stopping'
  | 'stopped'
  | 'failed';

const STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  initializing: ['ready', 'failed'],
  ready: ['busy', 'stopping'],
  busy: ['ready', 'waiting', 'failed'],
  waiting: ['busy', 'ready', 'stopping'],
  recovering: ['ready', 'failed'],
  stopping: ['stopped'],
  stopped: [],
  failed: ['recovering', 'stopping'],
};
```

**验收标准**：
- 状态转换正确
- 异常能自动恢复
- 完成任务能自动回收

---

### 里程碑 6：权限与安全 (Week 8)

**目标**：添加权限控制和安全检查

**任务清单**：
- [ ] 实现权限检查层
- [ ] 添加操作审计日志
- [ ] 实现敏感操作确认
- [ ] 添加资源限制

**权限检查**：
```typescript
async checkPermission(input: AgentToolInput): Promise<PermissionResult> {
  // 1. 检查多智能体是否启用
  if (!this.config.multiAgentEnabled) {
    return { allowed: false, reason: '多智能体模式已禁用' };
  }

  // 2. 检查资源限制
  const currentAgents = this.registry.getActiveAgents();
  if (currentAgents.length >= this.config.maxAgents) {
    return { allowed: false, reason: '已达到最大智能体数量限制' };
  }

  // 3. 检查敏感操作
  if (this.isSensitiveOperation(input.prompt)) {
    return { allowed: 'ask', reason: '敏感操作需要用户确认' };
  }

  return { allowed: true };
}
```

**验收标准**：
- 权限检查覆盖所有关键操作
- 敏感操作需要确认
- 资源限制有效

---

### 里程碑 7：UI/UX 优化 (Week 9)

**目标**：优化用户界面体验

**任务清单**：
- [ ] 优化右侧边栏显示逻辑
- [ ] 添加执行模式指示器
- [ ] 实现模式切换 UI
- [ ] 添加执行日志可视化

**UI 变更**：
```html
<!-- 执行模式指示器 -->
<div class="execution-mode-indicator">
  <span class="mode-badge" [class.single]="mode() === 'single'" [class.multi]="mode() === 'multi'">
    {{ mode() === 'single' ? '单Agent' : '多智能体' }}
  </span>
  <button (click)="toggleMode()" *ngIf="canToggleMode()">
    切换模式
  </button>
</div>
```

**验收标准**：
- 用户能清楚看到当前执行模式
- 模式切换直观
- 执行日志清晰

---

### 里程碑 8：测试与文档 (Week 10)

**目标**：完善测试和文档

**任务清单**：
- [ ] 单元测试覆盖
- [ ] 集成测试
- [ ] E2E 测试
- [ ] 用户文档
- [ ] API 文档

**测试用例**：
```typescript
describe('ExecutionModeDecider', () => {
  it('should return single mode for simple tasks', () => {
    const decision = decider.decide('读取 README.md');
    expect(decision.mode).toBe('single');
  });

  it('should return multi mode for complex tasks', () => {
    const decision = decider.decide('实现一个完整的用户认证系统');
    expect(decision.mode).toBe('multi');
  });

  it('should respect forced mode', () => {
    decider.forceExecutionMode('single');
    const decision = decider.decide('实现一个完整的用户认证系统');
    expect(decision.mode).toBe('single');
  });
});
```

**验收标准**：
- 测试覆盖率 > 80%
- 文档完整
- 用户指南清晰

---

## 5. 配置项设计

### 5.1 全局配置

```typescript
// src/app/core/multi-agent/multi-agent.config.ts

export interface MultiAgentConfig {
  // 是否启用多智能体模式
  enabled: boolean;
  
  // 最大智能体数量
  maxAgents: number;
  
  // 自动触发阈值
  autoTriggerThreshold: {
    complexityScore: number;
    minSubtasks: number;
    minDuration: number;
  };
  
  // 强制模式（null 表示自动）
  forceMode: 'single' | 'multi' | null;
  
  // 后端选择
  defaultBackend: 'in-process' | 'tmux' | 'iterm2';
  
  // 超时配置
  timeouts: {
    agentStartup: number;
    taskExecution: number;
    teamCreation: number;
  };
}

export const DEFAULT_CONFIG: MultiAgentConfig = {
  enabled: true,
  maxAgents: 5,
  autoTriggerThreshold: {
    complexityScore: 4,
    minSubtasks: 3,
    minDuration: 60_000,
  },
  forceMode: null,
  defaultBackend: 'in-process',
  timeouts: {
    agentStartup: 30_000,
    taskExecution: 300_000,
    teamCreation: 10_000,
  },
};
```

### 5.2 用户配置文件

```yaml
# ~/.zyfront/multi-agent.yaml

# 多智能体模式
multi_agent:
  enabled: true
  max_agents: 5
  
  # 自动触发条件
  auto_trigger:
    complexity_score: 4
    min_subtasks: 3
    
  # 强制模式（可选）
  force_mode: null  # 'single' | 'multi' | null
  
  # 后端配置
  backend: in-process
```

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| LLM 决策不稳定 | 误触发多智能体 | 添加阈值和回退机制 |
| 资源消耗过大 | 系统卡顿 | 实现资源限制和队列 |
| 状态同步复杂 | 数据不一致 | 事件溯源 + 状态快照 |
| 用户理解困难 | 体验下降 | 清晰的 UI 指示和文档 |

---

## 7. 成功指标

### 7.1 性能指标

| 指标 | 目标 | 当前 |
|------|------|------|
| 简单任务响应时间 | < 500ms | ~2s |
| 复杂任务拆分准确率 | > 85% | ~60% |
| 多智能体创建延迟 | < 3s | ~5s |
| 资源利用率 | < 50% | N/A |

### 7.2 体验指标

| 指标 | 目标 |
|------|------|
| 用户满意度 | > 4.5/5 |
| 错误恢复成功率 | > 95% |
| 模式切换成功率 | 100% |

---

## 8. 附录

### A. Claude Code 关键源码参考

| 文件 | 功能 | 参考价值 |
|------|------|---------|
| `coordinator/coordinatorMode.ts` | 协调器模式 | 模式切换机制 |
| `tools/AgentTool/AgentTool.tsx` | 智能体工具 | LLM 自主调用 |
| `tools/TeamCreateTool/TeamCreateTool.ts` | 团队创建 | 自动创建流程 |
| `tools/SendMessageTool/SendMessageTool.ts` | 消息传递 | 智能体通信 |
| `hooks/toolPermission/handlers/coordinatorHandler.ts` | 权限处理 | 安全控制 |

### B. 相关文档

- [zyfront-desktop-multi-agent-design-spec.md](./zyfront-desktop-multi-agent-design-spec.md)
- [multi-agent-test-report.md](./multi-agent-test-report.md)

---

## 更新日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-04-20 | v1.0 | 初始版本 |
