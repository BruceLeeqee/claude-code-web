# Zyfront Desktop 多智能体设计文档

> 参考基线：`E:/AGENT-ROOT/04-PROJECTS/claude-code/restored-src/src` 的 Claude Code 多智能体语义，以及当前 `zyfront-desktop` 的 workbench / collaboration / memory / model 路由实现。
>
> 文档目的：系统梳理当前多智能体实现的优点、差距与重构方向，重点覆盖智能体动态自动创建、任务规划器、智能体工厂、生命周期管理、多会话管理、模型路由等核心能力，并给出可落地的里程碑计划。

---

## 1. 背景与目标

### 1.1 背景

当前 `zyfront-desktop` 已经具备多智能体协作的雏形，包括：

- `multi-agent` 后端抽象与不同执行器
- workbench 侧的 team / teammate 视图投影
- 基于事件总线的状态同步
- memory / session / model 相关的配套能力
- collaboration 页面上的多模式编排探索

但从“Claude Code 级多智能体系统”视角看，当前实现仍偏向“功能聚合”，距离完整的**自治式多智能体运行时**还有较大差距，尤其在以下方面：

- 动态创建智能体的决策机制不够完整
- 任务规划与拆解缺少统一的规划器
- 智能体工厂与运行时生命周期耦合度偏高
- 多会话与多队列任务的隔离与恢复能力不足
- 模型路由规则还未形成统一的策略层
- 事件、状态、执行结果之间缺少严格的领域模型约束

### 1.2 文档目标

本设计文档要回答以下问题：

1. 当前已有实现的优点是什么，哪些能力可以直接继承？
2. 参考 Claude Code 语义后，哪些能力需要补齐？
3. 动态自动创建智能体的触发条件与决策链路是什么？
4. 任务规划器如何和智能体工厂、生命周期管理协作？
5. 多会话如何隔离、恢复、并发运行？
6. 模型路由如何在成本、能力、上下文长度与任务类型之间取平衡？
7. 如何分阶段落地，避免一次性重构失控？

---

## 2. 现有实现优点梳理

基于当前 `zyfront-desktop` 代码和文档，可归纳出以下可复用优势。

### 2.1 架构分层意识较强

当前实现已存在较明确的分层：

- `core/multi-agent`：后端、事件、会话、类型、编排服务
- `features/prototype/collaboration`：可视化展示、模式切换、协作探索
- `core/memory`：会话记忆、团队记忆、抽取、梦境/压缩等支撑能力
- `core/model-*`：模型目录、模型使用台账、路由相关基础设施

这说明系统已经具备向“领域驱动 + 编排驱动”演进的基础。

### 2.2 后端抽象已经成型

`TeammateBackend` 已经将执行后端抽象为统一接口：

- `spawn`
- `sendMessage`
- `terminate`
- `kill`
- `isActive`

并进一步支持 `in-process`、`tmux`、`iterm2` 多后端模式。这为未来增加更多运行环境提供了良好基础。

### 2.3 事件总线机制有利于可观测性

`MultiAgentEventBusService` 统一承载事件封装，包含：

- `type`
- `sessionId`
- `requestId`
- `source`
- `ts`
- `payload`

这是一套非常重要的基础设施，因为多智能体系统的复杂性本质上来自“状态变化频繁且分散”，统一事件模型是后续做回放、审计、恢复、观测的前提。

### 2.4 Memory / Session 相关能力有基础积累

当前系统已经有：

- `session-memory.service`
- `team-memory-sync.service`
- `prompt-memory-builder.service`
- `memory.orchestrator`
- `memory.scheduler`
- `memory.telemetry`

这些能力说明系统不只是“发消息执行任务”，还在朝“长期上下文管理”方向发展，这是 Claude Code 类系统非常关键的一环。

### 2.5 多模式协作探索较完整

collaboration / battle-arena / workbench 相关文档和页面，已经覆盖了：

- 单 agent / 多 agent 协作
- 模式切换
- 战斗 / 辩论 / 评审 / sprint 等模式
- 可视化拓扑与 timeline

这意味着未来的设计可以直接建立在现有“模式系统”之上，而不需要推倒重来。

---

## 3. 现状差距与需要补强的点

### 3.1 智能体动态自动创建

目前智能体创建更偏显式触发，缺少“系统自动决定何时需要新智能体”的规则层。

#### 主要缺口

- 没有统一的“创建建议器”或“自动扩容器”
- 缺少基于任务复杂度、依赖图、上下文长度、并行度的动态决策
- 缺少创建前的资源预算评估
- 缺少创建后的角色绑定与回收策略

### 3.2 任务规划器不够独立

当前任务的拆分、分派、执行、汇总往往与 orchestrator 逻辑交织在一起。

#### 主要缺口

- 没有独立的 `TaskPlanner`
- 没有标准化任务树 / 依赖图 / 优先级 / 里程碑结构
- 没有规划结果的可解释输出
- 没有规划版本与重规划机制

### 3.3 智能体工厂缺少统一生命周期入口

智能体创建流程中通常要做很多事：

- 角色模板选取
- 模型选择
- prompt 拼装
- cwd / session 绑定
- 权限配置
- backend 选择
- 资源登记

这些步骤目前有分散实现，但还缺少统一的“工厂”抽象。

### 3.4 生命周期管理粒度不足

当前后端虽然有 spawn / stop / kill，但从产品级能力看还需支持：

- 初始化中 / 就绪 / 忙碌 / 退避 / 冻结 / 背景运行 / 恢复中 / 失败重试
- 心跳监测
- 会话断连恢复
- 任务完成后的自动回收
- 异常熔断与降级

### 3.5 多会话管理仍需增强

需要把“会话”从简单的对话记录升级为真正的多运行上下文容器。

#### 需要补齐

- 一个用户同时运行多个团队会话
- 一个会话中多个任务流并行
- 会话快照与恢复
- 会话级 memory、prompt、model、backend 绑定
- 失联后重连和状态重建

### 3.6 模型路由需要从配置项升级为策略层

当前模型选择更多像配置字段，未来要升级为“路由器”：

- 按任务类型选择模型
- 按上下文长度和成本预算选择模型
- 按 agent 角色选择模型
- 按阶段选择模型（规划/执行/复核/总结）
- 支持回退和降级

---

## 4. 目标总体架构

### 4.1 设计原则

1. **规划与执行分离**：先规划，再创建，再执行，再回收。
2. **工厂与运行时分离**：工厂负责构建，运行时负责维护。
3. **状态与事件分离**：事件驱动状态投影，避免 UI 猜状态。
4. **会话与任务分离**：会话是容器，任务是流，智能体是执行单元。
5. **模型与角色分离**：角色定义能力边界，模型路由决定实现方式。
6. **自动化优先，手动兜底**：系统优先自动决策，用户始终保留干预入口。

### 4.2 核心模块划分

建议将多智能体系统拆为 7 个核心模块：

1. **Task Planner**：任务规划器
2. **Agent Factory**：智能体工厂
3. **Agent Lifecycle Manager**：生命周期管理器
4. **Session Orchestrator**：多会话编排器
5. **Model Router**：模型路由器
6. **Context Manager**：上下文与 memory 管理器
7. **Event & State Projection**：事件投影与状态投影层

---

## 5. 智能体动态自动创建设计

### 5.1 设计目标

让系统在面对复杂任务时，可以自动判断：

- 是否需要新增智能体
- 需要创建多少个
- 每个智能体的职责是什么
- 何时回收不再需要的智能体

### 5.2 自动创建触发条件

建议至少支持以下触发：

#### 1. 任务复杂度触发
- 任务包含多个独立子目标
- 子任务间耦合度较低，适合并行
- 规划器判断单智能体处理成本过高

#### 2. 上下文压力触发
- 当前上下文接近上限
- 主智能体需要保留更多思考空间
- 通过拆分子任务降低单 agent 负载

#### 3. 并行度触发
- 某些任务天然可并行，例如调研、测试、代码审查、文档生成
- 规划器希望提升吞吐量

#### 4. 角色缺口触发
- 当前团队缺少专门角色，例如 reviewer、executor、validator、researcher
- 任务需要特定视角或专门能力

#### 5. 异常恢复触发
- 某个 agent 失败、阻塞、长时间无响应
- 系统创建替代 agent 接管任务

### 5.3 自动创建流程

建议流程如下：

1. Planner 生成任务图
2. Agent Suggestion Engine 计算是否需要扩容
3. 若需要，则生成 `AgentIntent`
4. Factory 根据 intent 选择模板、模型、backend、权限和 prompt
5. Lifecycle Manager 注册新 agent
6. Event Bus 广播 `agent.created`
7. Session Orchestrator 将 agent 挂到当前会话/团队/任务树上

### 5.4 需要定义的核心概念

#### AgentIntent
表示“系统为什么要创建这个 agent”。

应包含：
- `reason`
- `taskId`
- `role`
- `expectedInputs`
- `expectedOutputs`
- `priority`
- `lifetimePolicy`
- `resourceBudget`

#### AgentTemplate
表示“要创建什么类型的 agent”。

应包含：
- 角色名
- 默认 prompt 模板
- 默认权限
- 推荐模型族
- 推荐 backend
- 是否允许自动回收

#### AgentSlot
表示“这个 agent 在团队中的位置”。

应包含：
- leader / worker / reviewer / researcher / executor 等定位
- 与任务图节点的绑定关系

### 5.5 自动回收策略

自动创建的智能体必须能自动回收，避免资源泄漏。

建议回收条件：

- 相关任务已完成
- 超过 idle timeout
- 被替代 agent 接管
- 团队进入收敛阶段
- 用户手动关闭会话

---

## 6. 任务规划器设计

### 6.1 设计目标

把“用户输入的一句话”转化为可执行的结构化任务计划。

### 6.2 规划器职责

任务规划器应负责：

- 任务理解
- 目标拆解
- 依赖分析
- 角色分配建议
- 并行/串行判断
- 风险识别
- 产出计划版本

### 6.3 规划输入输出

#### 输入
- 用户请求
- 当前会话上下文
- 团队状态
- 已有智能体能力
- 模型预算
- 工具可用性

#### 输出
- 任务树 / DAG
- 每个任务节点的优先级
- 每个节点建议执行 agent
- 预估模型与成本
- 阻塞风险提示
- 是否需要创建新 agent 的建议

### 6.4 规划器分层

建议分成 3 层：

#### 1. 意图解析层
- 识别目标、约束、输出形式
- 判断是调研、编码、执行、审查还是总结

#### 2. 结构化拆解层
- 将目标拆成里程碑、子任务、检查点
- 形成依赖关系图

#### 3. 编排建议层
- 决定是否并行
- 决定分配给哪些角色
- 决定是否需要自动创建 agent

### 6.5 规划版本管理

每一次规划应生成版本号：

- `planVersion`
- `parentPlanVersion`
- `replanReason`

支持：
- 初次规划
- 基于失败/新信息重规划
- 用户干预后重规划

---

## 7. 智能体工厂设计

### 7.1 设计目标

将智能体创建从“散落在各服务中的逻辑”变成统一工厂流程。

### 7.2 工厂职责

工厂负责：

- 选模板
- 拼 prompt
- 配模型
- 配 backend
- 配权限
- 注入上下文
- 创建 identity
- 注册元数据

### 7.3 工厂输入输出

#### 输入
- `AgentIntent`
- `TaskNode`
- `SessionContext`
- `ModelPolicy`
- `BackendPolicy`

#### 输出
- `AgentDescriptor`
- `AgentRuntimeHandle`
- `SpawnResult`

### 7.4 工厂模式

建议支持三种创建模式：

1. **显式创建**：用户主动创建 agent
2. **规划驱动创建**：planner 建议后创建
3. **运行时自愈创建**：失败接管或扩容创建

### 7.5 关键约束

- 工厂只负责“构建”，不直接负责长期运行状态
- 创建结果必须可序列化
- 每个 agent 都必须具备可回放元信息
- 工厂必须支持 dry-run，用于预览创建结果

---

## 8. 智能体生命周期管理设计

### 8.1 生命周期阶段

建议定义统一生命周期状态：

- `draft`
- `initializing`
- `running`
- `idle`
- `waiting`
- `blocked`
- `reconnecting`
- `background`
- `stopping`
- `stopped`
- `failed`
- `archived`

### 8.2 生命周期职责

生命周期管理器负责：

- 启动跟踪
- 心跳检查
- 状态更新
- 任务绑定
- 错误恢复
- 自动回收
- 资源清理

### 8.3 状态机原则

1. 所有状态变化必须有事件记录
2. 状态变化必须可追踪来源
3. 不允许 UI 直接修改运行态
4. 状态机必须允许恢复和重建

### 8.4 运行时监控

建议增加：

- lastSeenAt
- heartbeatInterval
- activeTaskCount
- blockedReason
- errorCode
- recoveryAttempts

### 8.5 终止与回收

建议区分：

- `stop`：正常结束，保留结果
- `kill`：强制结束，优先释放资源
- `archive`：归档历史记录，保留审计数据

---

## 9. 多会话管理设计

### 9.1 设计目标

让系统支持多个独立会话并行运行，每个会话具有独立上下文、模型策略、智能体集合与任务图。

### 9.2 会话的定义

会话不只是聊天记录，而是一个完整运行单元，包含：

- sessionId
- teamId / teamName
- planVersion
- task graph
- agent registry
- memory scope
- model policy
- backend policy
- event stream

### 9.3 会话隔离原则

- 会话之间上下文隔离
- 会话之间 agent 不共享运行态
- 会话之间 memory 可按需共享，但默认隔离
- 会话之间事件流独立

### 9.4 会话恢复能力

每个会话都应支持：

- snapshot 保存
- 重启恢复
- 断线重连
- 只恢复状态不恢复执行 / 恢复执行两种模式

### 9.5 会话切换策略

用户切换会话时，系统应：

- 先展示快照
- 再选择是否恢复运行态
- 如资源受限，则允许后台挂起

---

## 10. 模型路由设计

### 10.1 设计目标

把模型选择从“人工配置字符串”升级为“基于任务与角色的策略路由”。

### 10.2 路由维度

路由至少考虑以下维度：

- 任务类型：规划 / 编码 / 调试 / 审查 / 总结 / 研究
- Agent 角色：leader / planner / executor / reviewer / researcher
- 上下文长度：短 / 中 / 长
- 成本预算：低 / 中 / 高
- 质量要求：快速 / 平衡 / 高质量
- 工具使用能力：是否需要工具调用、代码生成、长上下文

### 10.3 路由结果

模型路由器输出：

- `primaryModel`
- `fallbackModel`
- `reason`
- `budgetEstimate`
- `confidence`

### 10.4 路由策略

建议支持以下策略：

#### 1. 角色默认路由
- leader 选更强的规划模型
- executor 选擅长代码/工具的模型
- reviewer 选更严格的审查模型

#### 2. 任务阶段路由
- 规划阶段：优先推理和结构化能力
- 执行阶段：优先代码生成和工具调用
- 汇总阶段：优先总结与压缩能力

#### 3. 成本控制路由
- 上下文过长时自动切换更适合长上下文的模型
- 简单任务优先低成本模型
- 关键节点允许升档

#### 4. 回退路由
- 主模型失败后切换 fallback
- 路由失败时保底使用可用模型

### 10.5 模型台账联动

模型路由应和 `model-usage-ledger`、`model-catalog`、`runtime-settings-sync` 联动，形成：

- 可审计
- 可回溯
- 可计费
- 可优化

---

## 11. 事件、状态与数据模型建议

### 11.1 核心领域对象

建议至少定义以下对象：

- `SessionContext`
- `TeamContext`
- `TaskGraph`
- `TaskNode`
- `AgentDescriptor`
- `AgentRuntimeState`
- `AgentIntent`
- `ModelRouteDecision`
- `LifecycleEvent`
- `RecoveryAction`

### 11.2 状态同步原则

所有 UI 和外部观测层必须依赖统一投影结果，而不是直接读内部执行对象。

### 11.3 事件最小集

建议具备以下事件：

- `session.created`
- `session.resumed`
- `session.closed`
- `task.planned`
- `task.assigned`
- `task.started`
- `task.blocked`
- `task.completed`
- `agent.intent.created`
- `agent.created`
- `agent.started`
- `agent.idle`
- `agent.failed`
- `agent.recovered`
- `agent.terminated`
- `model.routed`
- `model.fallback`
- `memory.synced`

---

## 12. 当前实现到目标架构的映射

### 12.1 可直接保留的部分

- `TeammateBackend` 抽象
- `MultiAgentEventBusService`
- multi-agent types 中关于 team / teammate / lifecycle 的定义
- memory/session 基础服务
- model catalog / ledger / sync 基础设施
- workbench 投影层

### 12.2 需要重构的部分

- 后端执行逻辑与编排逻辑混合的服务
- 智能体创建散点逻辑
- 会话上下文与团队上下文的边界不清
- 模型选择逻辑分布在多个调用点
- 任务拆解与 agent 选择没有独立策略层

### 12.3 需要新增的部分

- `TaskPlannerService`
- `AgentFactoryService`
- `AgentLifecycleManager`
- `SessionRegistryService`
- `ModelRouterService`
- `AgentIntentEngine`
- `RecoveryOrchestrator`

---

## 13. 分阶段实施计划

### Phase 0：现状冻结与基线确认

**目标**：冻结当前能力边界，统一术语、数据模型、事件协议。

#### 关键工作
- 对现有多智能体类型进行整理
- 统一生命周期术语
- 固化事件最小集合
- 输出当前优缺点清单

#### 交付物
- 架构基线文档
- 术语表
- 事件协议草案
- 模型路由草案

#### 验收标准
- 所有参与者对“会话 / 团队 / 智能体 / 任务 / 模型 / backend”的定义一致

---

### Phase 1：任务规划器落地

**目标**：先把“任务如何拆”独立出来。

#### 关键工作
- 建立任务树 / DAG 数据结构
- 实现意图解析与子任务拆解
- 输出规划版本和依赖关系
- 支持重规划

#### 交付物
- `TaskPlannerService`
- 规划结果数据模型
- 规划 UI 预览层

#### 验收标准
- 任意复杂用户请求都能输出结构化计划
- 规划结果可审计、可重放

---

### Phase 2：智能体工厂与意图系统

**目标**：将 agent 创建统一入口化。

#### 关键工作
- 定义 `AgentIntent`
- 定义 `AgentTemplate`
- 建立 `AgentFactoryService`
- 将 prompt / model / backend /权限注入标准化

#### 交付物
- 工厂 API
- agent 模板库
- 创建预览能力

#### 验收标准
- 创建 agent 不再散落在多个服务中
- 支持 dry-run 和模板化创建

---

### Phase 3：生命周期管理与自动回收

**目标**：让 agent 真正成为可管理的运行单元。

#### 关键工作
- 实现统一状态机
- 增加 heartbeat 与 lastSeen
- 支持 stop / kill / archive
- 自动回收 idle agent

#### 交付物
- `AgentLifecycleManager`
- 状态机定义
- 回收策略

#### 验收标准
- agent 可稳定启动、运行、停止、回收
- 异常可恢复，资源不泄漏

---

### Phase 4：多会话管理与快照恢复

**目标**：支持多个独立会话运行与恢复。

#### 关键工作
- 会话注册表
- 会话快照
- 恢复机制
- 会话切换与后台挂起

#### 交付物
- `SessionRegistryService`
- 会话快照格式
- 恢复流程

#### 验收标准
- 多会话并行不串上下文
- 刷新 / 重启后可恢复关键状态

---

### Phase 5：模型路由与预算控制

**目标**：把模型选型升级为策略系统。

#### 关键工作
- 定义路由规则
- 接入 model catalog
- 加入预算、上下文、角色、阶段维度
- 记录路由决策

#### 交付物
- `ModelRouterService`
- 路由日志
- fallback 策略

#### 验收标准
- 每次模型选择都有原因可查
- 低成本任务不误用高成本模型

---

### Phase 6：自动扩容与自治协作

**目标**：让系统具备更高自治性。

#### 关键工作
- 动态创建 agent
- 异常自动接管
- 根据任务图自动扩缩容
- 将 planner、factory、lifecycle 联动

#### 交付物
- `AgentIntentEngine`
- 自动扩容规则
- 自治协作策略

#### 验收标准
- 复杂任务可自动拉起合适的 agent
- agent 完成后能自动退出，不影响主流程

---

## 14. 里程碑详细计划

### Milestone A：设计冻结

**周期**：1 周

**输出**：
- 多智能体术语表
- 领域模型草图
- 事件协议草案
- 规划 / 工厂 / 生命周期 / 会话 / 路由五大模块职责表

**通过标准**：
- 架构边界清晰，代码改造可以开始拆分

### Milestone B：规划器 MVP

**周期**：1~2 周

**输出**：
- 基础任务树
- 任务拆分结果
- 规划版本
- 可视化预览

**通过标准**：
- 一条用户请求可以稳定输出可执行计划

### Milestone C：工厂 + 生命周期 MVP

**周期**：2 周

**输出**：
- 智能体统一创建入口
- 状态机
- heartbeat
- stop / kill / archive

**通过标准**：
- 新 agent 创建与销毁流程稳定可靠

### Milestone D：会话管理 MVP

**周期**：1~2 周

**输出**：
- 多会话注册表
- 快照与恢复
- 会话切换

**通过标准**：
- 会话恢复后关键上下文不丢失

### Milestone E：模型路由 MVP

**周期**：1 周

**输出**：
- 模型选择策略
- fallback
- 成本与上下文约束

**通过标准**：
- 模型选择可解释、可追踪

### Milestone F：自动扩容与自治协作

**周期**：2 周

**输出**：
- 动态创建规则
- agent 替代接管
- 回收策略

**通过标准**：
- 系统能根据任务复杂度自动调整 agent 数量

---

## 15. 优先级建议

### P0：必须先做

- 统一领域模型
- 任务规划器独立
- 智能体工厂统一入口
- 生命周期管理器
- 会话隔离

### P1：紧接着做

- 模型路由策略层
- 自动创建触发器
- 自动回收
- 快照恢复

### P2：增强项

- 预算优化
- 智能体自学习偏好
- 更细粒度的权限控制
- 更丰富的恢复策略

---

## 16. 风险与对策

### 16.1 风险：规划器过度复杂

**对策**：先输出简单任务树，再逐步引入 DAG、重规划和预算。

### 16.2 风险：自动创建失控

**对策**：必须加预算上限、并发上限、idle timeout、任务绑定和回收策略。

### 16.3 风险：会话膨胀导致内存压力

**对策**：引入 session archive、context compaction、lazy restore。

### 16.4 风险：模型路由策略混乱

**对策**：路由规则集中在一个服务内，所有决策落日志。

### 16.5 风险：生命周期与 UI 状态不一致

**对策**：UI 只订阅事件投影，不直接读运行对象。

---

## 17. 最终建议

如果从实施顺序来看，建议按以下路径推进：

1. 先冻结领域模型和事件协议
2. 再独立出任务规划器
3. 再统一智能体工厂入口
4. 再补生命周期管理和回收
5. 再做多会话恢复
6. 再做模型路由策略
7. 最后实现自动扩容与自治协作

这样可以把复杂系统拆成可验证的阶段，避免“功能有了但无法协同”的问题。

---

## 18. 推荐的接口定义草案

这一部分用于把上面的设计进一步落成可编码的边界。它不是最终代码，但建议作为后续拆模块的标准参照。

### 18.1 TaskPlannerService

职责：将用户输入和会话上下文转换为任务图。

建议输入：
- `userPrompt`
- `sessionContext`
- `teamContext`
- `constraints`

建议输出：
- `planVersion`
- `taskGraph`
- `executionHints`
- `agentSuggestions`
- `riskNotes`

### 18.2 AgentIntentEngine

职责：根据任务图与运行态判断是否要创建、补充或替换 agent。

建议输出：
- `shouldCreate`
- `createCount`
- `intents[]`
- `budgetEstimate`
- `recoveryHint`

### 18.3 AgentFactoryService

职责：把 intent 变成可运行的 agent。

建议输出：
- `identity`
- `runtimeHandle`
- `spawnResult`
- `routingDecision`

### 18.4 AgentLifecycleManager

职责：维护 agent 的状态机和回收逻辑。

建议能力：
- `register`
- `transition`
- `heartbeat`
- `stop`
- `kill`
- `archive`
- `recover`

### 18.5 SessionRegistryService

职责：维护 session 的创建、恢复、挂起、关闭。

建议能力：
- `createSession`
- `resumeSession`
- `snapshotSession`
- `closeSession`
- `listActiveSessions`

### 18.6 ModelRouterService

职责：根据角色、阶段、预算、上下文选择模型。

建议输出：
- `primaryModel`
- `fallbackModel`
- `reason`
- `costEstimate`

---

## 19. 推荐的数据流

建议把系统数据流统一成以下链路：

1. 用户输入进入 `TaskPlannerService`
2. Planner 生成任务图和执行建议
3. `AgentIntentEngine` 判断是否需要创建 agent
4. `ModelRouterService` 为任务节点与 agent 角色选择模型
5. `AgentFactoryService` 创建 agent
6. `AgentLifecycleManager` 维护运行态
7. `MultiAgentEventBusService` 广播事件
8. UI 仅订阅事件投影，不直接参与决策

这样可以最大限度减少耦合，并且方便后续测试、回放和恢复。

---

## 20. 任务分解建议

为了便于落地，建议进一步把实施任务拆成以下几类：

### 20.1 领域建模任务
- 冻结 session / team / agent / task / route 的核心类型
- 统一事件命名
- 定义生命周期状态机

### 20.2 编排能力任务
- 独立任务规划器
- 独立智能体工厂
- 独立生命周期管理器
- 独立会话注册表

### 20.3 策略能力任务
- 自动创建判断
- 自动回收判断
- 模型路由
- 预算控制

### 20.4 观测能力任务
- 事件回放
- 状态投影
- 审计日志
- 恢复面板

### 20.5 产品化任务
- workbench 统一投影
- collaboration 页面打通
- 多会话入口
- 降级和错误提示

---

## 21. 阶段性验收清单

### Phase A 验收
- 类型、事件、术语统一
- 模块边界确定
- 文档冻结

### Phase B 验收
- 任务规划结果可视化
- 能输出规划版本
- 支持最小可执行任务树

### Phase C 验收
- agent 可通过工厂创建
- 生命周期可观测
- stop / kill / archive 正常工作

### Phase D 验收
- 多会话并行
- 会话恢复可用
- 不同 session 的上下文不串线

### Phase E 验收
- 模型路由可解释
- fallback 生效
- 成本和能力可控

### Phase F 验收
- 可以动态自动创建 agent
- 可以自动回收 agent
- 失败后能接管恢复

---

## 22. 结论

当前 `zyfront-desktop` 的多智能体实现已经具备不错的基础，尤其在后端抽象、事件总线、记忆系统和 workbench 投影层方面具备可持续演进的潜力。

下一阶段的关键，不再是“再加几个功能按钮”，而是把系统升级为一个真正可演化的多智能体运行时：

- 任务先规划
- 智能体按需创建
- 生命周期统一管理
- 会话严格隔离
- 模型按策略路由
- 事件驱动全链路可观测

只有这样，系统才能从“多 agent 功能集合”进化为“可自治的多智能体协作平台”。

---

文档版本：v1.1
创建日期：2026-04-20
适用范围：`zyfront-desktop` 多智能体系统 / workbench / collaboration / session / model routing
