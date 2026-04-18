# Zyfront Desktop 多智能体操作系统 - 待开发详细计划文档

> 适用项目：`zyfront-desktop`
> 
> 文档版本：v2.0
> 
> 生成日期：2026-04-18
> 
> 目标：打通所有流程，实现所有预定目标，形成完整的"可编排、可对抗、可观测、可恢复、可视化"的多智能体操作系统

---

## 1. 文档整合说明

本文档整合了以下4个核心文档的内容：

1. **AI-MultiAgent-OS-Plan.md** - 桌面端AI多智能体操作系统重构计划
2. **agent-architecture-and-orchestration-separation.md** - 智能体构建与编排分层设计
3. **collaboration-page-realtime-integration-plan.md** - 协作页实时接入与重构计划
4. **multi-agent-optimization-final.md** - 当前协作页接入多智能体系统的最终优化

同时结合了当前 `zyfront-desktop` 的实际实现现状。

---

## 2. 当前实现现状分析

### 2.1 已实现功能

#### 2.1.1 协作页 (collaboration.page)
- ✅ 四个视图标签页：arena（竞技场）、network（网络）、cognitive（认知）、monitor（监控）
- ✅ 模式选择器组件（5种模式：coop、pipeline、storm、contest、battle）
- ✅ 智能体构建模态框（创建Agent，选择角色、技能、模式）
- ✅ 团队构建模态框（创建团队，选择成员Agent）
- ✅ 任务编排模态框（创建任务、分配Agent、设置优先级和依赖）
- ✅ 智能体看板模态框（查看统计、团队信息、Agent列表）
- ✅ 状态服务（CollaborationStateService）统一管理页面状态
- ✅ WebSocket服务集成（MultiAgentWebSocketService）
- ✅ 编排服务集成（MultiAgentOrchestratorService）
- ✅ 底部播放控制（暂停、重置、速度调节）
- ✅ 快捷键支持（P暂停、R重置、M模式、TAB切换视图）

#### 2.1.2 工作台页 (workbench.page)
- ✅ 终端会话管理（xterm集成）
- ✅ 多Agent Tab支持
- ✅ 代码编辑器集成（Monaco Editor）
- ✅ 命令路由服务
- ✅ 指令注册系统
- ✅ 技能索引服务
- ✅ Agent记忆服务
- ✅ 多智能体编排服务集成

#### 2.1.3 核心服务层
- ✅ MultiAgentOrchestratorService（编排服务）
- ✅ MultiAgentWebSocketService（WebSocket通信）
- ✅ MultiAgentEventBusService（事件总线）
- ✅ MultiAgentSessionService（会话管理）
- ✅ MultiAgentInProcessBackend（进程内后端）
- ✅ MultiAgentTmuxBackend（tmux后端）
- ✅ MultiAgentITermBackend（iTerm后端）
- ✅ CollaborationStateService（协作状态服务）
- ✅ ModeManagerService（模式管理服务）

### 2.2 待完善功能

#### 2.2.1 数据流打通
- ❌ 创建Agent后未同步到编排服务的真实Agent列表
- ❌ 创建团队后未同步到编排服务的真实团队列表
- ❌ 任务编排数据未与编排服务联动
- ❌ WebSocket消息未完全映射到状态更新
- ❌ Mock数据未完全替换为真实数据

#### 2.2.2 5种对抗模式实现
- ❌ 辩论对抗模式（完整流程）
- ❌ 红蓝攻防模式（完整流程）
- ❌ 竞赛冲刺模式（完整流程）
- ❌ 回合博弈模式（完整流程）
- ❌ 混合评审模式（完整流程）

#### 2.2.3 手动编排能力
- ❌ 可视化编排画布
- ❌ 任务节点拖拽
- ❌ 依赖关系可视化
- ❌ 执行控制（启动、暂停、跳过、重新分配）

#### 2.2.4 自动编排能力
- ❌ 目标解析与意图识别
- ❌ 自动团队生成
- ❌ 自动任务拆分
- ❌ 自动调度策略
- ❌ 自动收敛策略

#### 2.2.5 可视化增强
- ❌ 团队图谱可视化
- ❌ 任务流时间轴
- ❌ 对抗竞技场动画
- ❌ 结果对比面板

#### 2.2.6 异常恢复机制
- ❌ 快照保存与恢复
- ❌ tmux异常修复
- ❌ 任务失败恢复
- ❌ 自动fallback机制

---

## 3. 总体架构设计

### 3.1 三层架构

```
┌─────────────────────────────────────────┐
│           用户界面层 (UI Layer)          │
│  ┌──────────┐ ┌────────── ┌──────────┐ │
│  │ 协作页   │ │ 工作台页 │ │ 看板页   │ │
│  │ (Arena)  │ │(Workbench)│ │(Dashboard)│ │
│  └──────────┘ └──────────┘ └──────────┘ │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         业务逻辑层 (Service Layer)       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 编排服务 │ │ 状态服务 │ │ WebSocket│ │
│  │(Orchestrator)│(State)│ (WS)    │ │
│  └────────── └──────────┘ ──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 模式管理 │ │ 事件总线 │ │ 会话管理 │ │
│  │(Mode)    │ │(EventBus)│ │(Session) │ │
│  └──────────┘ └──────────┘ └──────────┘ │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         执行后端层 (Backend Layer)       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 进程内   │ │  tmux    │ │  iTerm   │ │
│  │(In-Process)│ (WSL2)  │ │(macOS)   │ │
│  └──────────┘ └──────────┘ └──────────┘ │
└─────────────────────────────────────────┘
```

### 3.2 核心设计原则

1. **智能体构建与编排分离**
   - 构建：能力资产沉淀（角色、技能、权限）
   - 编排：任务执行调度（分工、顺序、依赖）
   - 前台统一入口，后台逻辑分离

2. **任务优先，编排自动化**
   - 输入任务 → 系统推荐编排 → 用户确认 → 执行
   - 避免每次任务都手工构建智能体

3. **统一状态管理**
   - 所有视图从统一状态服务读取数据
   - WebSocket消息统一映射到状态更新
   - 避免散落mock数据

4. **可观测、可恢复**
   - 所有状态变化可追踪
   - 所有异常有恢复入口
   - 快照保存与恢复机制

---

## 4. 详细开发计划

### 阶段 1：数据流打通与状态同步（优先级：P0）

#### 目标
打通前端UI与后端服务的真实数据流，替换所有mock数据。

#### 任务清单

##### 1.1 智能体创建数据流打通
- [ ] 修改 `submitAgentBuild()` 方法，调用编排服务真实创建Agent
- [ ] 创建Agent后同步更新状态服务的Agent列表
- [ ] 同步更新编排服务的团队虚拟机（TeamVm）
- [ ] 通过WebSocket广播Agent创建事件

**涉及文件：**
- `collaboration.page.ts` - submitAgentBuild方法
- `collaboration-state.service.ts` - addAgent方法
- `multi-agent.orchestrator.service.ts` - spawnTeammate方法

##### 1.2 团队创建数据流打通
- [ ] 修改 `submitTeamBuild()` 方法，调用编排服务真实创建团队
- [ ] 创建团队后同步更新状态服务的团队列表
- [ ] 同步更新编排服务的团队虚拟机
- [ ] 通过WebSocket广播团队创建事件

**涉及文件：**
- `collaboration.page.ts` - submitTeamBuild方法
- `collaboration-state.service.ts` - addTeam方法
- `multi-agent.orchestrator.service.ts` - 新增createTeam方法

##### 1.3 任务编排数据流打通
- [ ] 修改 `addTask()` 方法，调用编排服务真实创建任务
- [ ] 任务状态变更同步到编排服务
- [ ] 通过WebSocket广播任务状态事件
- [ ] 实现任务依赖关系验证

**涉及文件：**
- `collaboration.page.ts` - addTask、startTask、completeTask方法
- `collaboration-state.service.ts` - 新增addTask、updateTaskStatus方法
- `multi-agent.orchestrator.service.ts` - 新增createTask、assignTask方法

##### 1.4 WebSocket消息完整映射
- [ ] 定义完整的WebSocket消息类型枚举
- [ ] 实现所有消息类型的处理器
- [ ] 消息统一映射到状态服务更新
- [ ] 添加消息日志和调试功能

**涉及文件：**
- `collaboration.page.ts` - handleWebSocketMessage方法
- `multi-agent.websocket.service.ts` - 消息类型定义
- `collaboration-state.service.ts` - 状态更新方法

##### 1.5 Mock数据替换
- [ ] 替换协作页所有mock数据为真实数据
- [ ] 替换工作台页所有mock数据为真实数据
- [ ] 添加数据加载中的空状态处理
- [ ] 添加数据加载失败的错误处理

**涉及文件：**
- `collaboration.page.ts` - 初始化数据
- `collaboration-state.service.ts` - 初始状态
- `workbench.page.ts` - 初始化数据

#### 验收标准
- [ ] 创建Agent后，Agent列表实时显示新Agent
- [ ] 创建团队后，竞技场视图显示新团队
- [ ] 创建任务后，任务编排列表显示新任务
- [ ] WebSocket消息能正确更新页面状态
- [ ] 页面不再依赖任何mock数据

---

### 阶段 2：5种对抗模式完整实现（优先级：P0）

#### 目标
实现5种对抗模式的完整流程，包括模式切换、执行流程、结果输出。

#### 任务清单

##### 2.1 模式管理服务增强
- [ ] 扩展ModeManagerService支持5种模式
- [ ] 实现模式切换的状态同步
- [ ] 实现模式配置的持久化
- [ ] 添加模式切换的历史记录

**涉及文件：**
- `mode-manager.service.ts` - 模式配置
- `collaboration-state.service.ts` - 模式状态

##### 2.2 辩论对抗模式
- [ ] 实现辩论流程状态机
- [ ] 创建正方/反方/裁判Agent角色
- [ ] 实现轮次控制和发言顺序
- [ ] 实现论点评分和裁决逻辑
- [ ] 可视化：辩题卡、阵营面板、轮次进度、裁决结果

**涉及文件：**
- 新增 `debate-mode.service.ts`
- `debate-panel.component.ts` - 辩论面板
- `battle-stage.component.ts` - 竞技场舞台

##### 2.3 红蓝攻防模式
- [ ] 实现攻防流程状态机
- [ ] 创建红队/蓝队/裁判Agent角色
- [ ] 实现攻击策略生成和防御方案生成
- [ ] 实现漏洞记录和风险评估
- [ ] 可视化：红蓝阵营、风险等级、攻击路径、防御覆盖

**涉及文件：**
- 新增 `redblue-mode.service.ts`
- `battle-stage.component.ts` - 竞技场舞台

##### 2.4 竞赛冲刺模式
- [ ] 实现竞赛流程状态机
- [ ] 实现多Agent并行执行
- [ ] 实现评分模型和排名逻辑
- [ ] 实现时间消耗和质量评估
- [ ] 可视化：跑道排名、实时分数、阶段进度、冠军结果

**涉及文件：**
- 新增 `sprint-mode.service.ts`
- `battle-stage.component.ts` - 竞技场舞台

##### 2.5 回合博弈模式
- [ ] 实现回合流程状态机
- [ ] 实现轮次控制和策略继承
- [ ] 实现策略演化和收敛判断
- [ ] 实现决策树记录
- [ ] 可视化：回合时间轴、当前轮次、决策树、历史策略

**涉及文件：**
- 新增 `turnbased-mode.service.ts`
- `battle-stage.component.ts` - 竞技场舞台

##### 2.6 混合评审模式
- [ ] 实现评审流程状态机
- [ ] 实现多方案提交和讨论
- [ ] 实现投票和评分机制
- [ ] 实现分歧记录和最终裁定
- [ ] 可视化：方案卡片墙、投票条形图、分歧点、推荐摘要

**涉及文件：**
- 新增 `review-mode.service.ts`
- `debate-panel.component.ts` - 辩论面板

#### 验收标准
- [ ] 5种模式都能正常切换和执行
- [ ] 每种模式有完整的流程状态机
- [ ] 每种模式有对应的可视化展示
- [ ] 模式切换后页面状态正确更新
- [ ] 模式执行结果能正确输出和归档

---

### 阶段 3：手动编排能力完整实现（优先级：P1）

#### 目标
实现完整的手动编排能力，支持可视化编排、任务拖拽、依赖管理。

#### 任务清单

##### 3.1 可视化编排画布
- [ ] 创建编排画布组件
- [ ] 实现Agent节点拖拽
- [ ] 实现任务节点拖拽
- [ ] 实现节点连线（依赖关系）
- [ ] 实现画布缩放和平移

**涉及文件：**
- 新增 `orchestration-canvas.component.ts`
- 新增 `orchestration-canvas.component.html`
- 新增 `orchestration-canvas.component.scss`

##### 3.2 任务节点管理
- [ ] 实现任务节点创建
- [ ] 实现任务节点配置（标题、描述、执行者、优先级）
- [ ] 实现任务节点删除
- [ ] 实现任务节点复制
- [ ] 实现任务节点状态显示

**涉及文件：**
- 新增 `task-node.component.ts`
- `orchestration-canvas.component.ts`

##### 3.3 依赖关系管理
- [ ] 实现依赖关系创建（连线）
- [ ] 实现依赖关系删除
- [ ] 实现依赖关系验证（循环依赖检测）
- [ ] 实现依赖关系可视化
- [ ] 实现依赖关系导出

**涉及文件：**
- 新增 `dependency-manager.service.ts`
- `orchestration-canvas.component.ts`

##### 3.4 执行控制
- [ ] 实现编排启动
- [ ] 实现编排暂停
- [ ] 实现编排继续
- [ ] 实现编排停止
- [ ] 实现任务跳过
- [ ] 实现任务重新分配
- [ ] 实现任务重试

**涉及文件：**
- 新增 `execution-controller.service.ts`
- `orchestration-canvas.component.ts`

##### 3.5 编排模板
- [ ] 创建对抗模板
- [ ] 创建协作模板
- [ ] 创建流水线模板
- [ ] 创建脑暴模板
- [ ] 创建审核模板
- [ ] 实现模板加载和应用

**涉及文件：**
- 新增 `orchestration-templates.service.ts`
- 新增模板配置文件

#### 验收标准
- [ ] 能在画布上拖拽创建Agent和任务节点
- [ ] 能创建和删除依赖关系
- [ ] 能检测循环依赖
- [ ] 能启动、暂停、继续、停止编排
- [ ] 能加载和应用编排模板
- [ ] 编排状态能正确同步到后端

---

### 阶段 4：自动编排能力实现（优先级：P1）

#### 目标
实现自动编排能力，支持目标解析、自动组队、自动任务拆分、自动调度。

#### 任务清单

##### 4.1 目标解析服务
- [ ] 实现目标类型识别
- [ ] 实现复杂度评估
- [ ] 实现所需角色推荐
- [ ] 实现推荐模式选择
- [ ] 实现风险等级评估

**涉及文件：**
- 新增 `goal-parser.service.ts`
- 新增目标解析规则配置

##### 4.2 自动团队生成
- [ ] 根据目标类型生成团队结构
- [ ] 自动创建Leader Agent
- [ ] 自动创建执行Agent
- [ ] 自动创建审核Agent
- [ ] 自动创建裁判Agent（对抗模式）
- [ ] 自动分配角色和能力

**涉及文件：**
- 新增 `auto-team-generator.service.ts`
- `multi-agent.orchestrator.service.ts`

##### 4.3 自动任务拆分
- [ ] 实现大目标拆分成子任务
- [ ] 实现任务依赖关系自动生成
- [ ] 实现任务优先级自动分配
- [ ] 实现任务执行者自动分配
- [ ] 实现任务截止时间自动估算

**涉及文件：**
- 新增 `task-splitter.service.ts`
- `multi-agent.orchestrator.service.ts`

##### 4.4 自动调度策略
- [ ] 实现顺序调度
- [ ] 实现并行调度
- [ ] 实现竞争调度
- [ ] 实现追问调度
- [ ] 实现回合调度
- [ ] 实现调度策略自动选择

**涉及文件：**
- 新增 `auto-scheduler.service.ts`
- `multi-agent.orchestrator.service.ts`

##### 4.5 自动收敛策略
- [ ] 实现分数阈值收敛
- [ ] 实现时间阈值收敛
- [ ] 实现共识阈值收敛
- [ ] 实现裁判决策收敛
- [ ] 实现收敛策略自动选择

**涉及文件：**
- 新增 `auto-convergence.service.ts`
- `multi-agent.orchestrator.service.ts`

##### 4.6 混合编排支持
- [ ] 实现系统推荐方案生成
- [ ] 实现用户微调界面
- [ ] 实现混合编排启动
- [ ] 实现中途人工介入点
- [ ] 实现介入后自动继续

**涉及文件：**
- 新增 `hybrid-orchestration.service.ts`
- `orchestration-canvas.component.ts`

#### 验收标准
- [ ] 输入目标后能自动解析并推荐编排方案
- [ ] 能自动生成团队结构和任务拆分
- [ ] 能自动选择调度策略和收敛策略
- [ ] 支持混合编排（系统推荐+用户微调）
- [ ] 自动编排结果能正确执行

---

### 阶段 5：可视化增强（优先级：P2）

#### 目标
增强可视化效果，提升用户对协作过程的理解和观测能力。

#### 任务清单

##### 5.1 团队图谱可视化
- [ ] 实现团队节点展示
- [ ] 实现Agent节点展示
- [ ] 实现Task节点展示
- [ ] 实现Session节点展示
- [ ] 实现关系边展示（指派、依赖、通信、回传）
- [ ] 实现图谱交互（缩放、平移、节点点击）

**涉及文件：**
- 增强 `network-graph.component.ts`
- 增强 `network-graph.component.html`

##### 5.2 任务流时间轴
- [ ] 实现时间轴组件
- [ ] 实现任务节点展示
- [ ] 实现任务状态颜色编码
- [ ] 实现时间轴回放功能
- [ ] 实现异常点定位
- [ ] 实现时间轴缩放

**涉及文件：**
- 增强 `timeline.component.ts`
- 增强 `timeline.component.html`

##### 5.3 对抗竞技场动画
- [ ] 实现竞技场舞台动画
- [ ] 实现Agent位置动画
- [ ] 实现论点碰撞连线动画
- [ ] 实现分数变化动画
- [ ] 实现轮次切换动画
- [ ] 实现裁决结果高亮动画

**涉及文件：**
- 增强 `battle-stage.component.ts`
- 增强 `battle-stage.component.html`
- 增强 `animation.service.ts`

##### 5.4 结果对比面板
- [ ] 实现方案卡片展示
- [ ] 实现评分对比
- [ ] 实现投票条形图
- [ ] 实现排名展示
- [ ] 实现最终裁定展示
- [ ] 实现结果导出

**涉及文件：**
- 新增 `result-comparison.component.ts`
- 新增 `result-comparison.component.html`

##### 5.5 粒子系统增强
- [ ] 实现状态变化粒子效果
- [ ] 实现任务完成粒子效果
- [ ] 实现错误警告粒子效果
- [ ] 实现模式切换粒子效果
- [ ] 优化粒子性能

**涉及文件：**
- 增强 `particle-system.service.ts`

#### 验收标准
- [ ] 团队图谱能清晰展示协作关系
- [ ] 时间轴能回放任务执行过程
- [ ] 竞技场动画能增强对抗过程理解
- [ ] 结果对比面板能清晰展示评分和排名
- [ ] 粒子效果不卡顿，性能良好

---

### 阶段 6：异常恢复机制（优先级：P1）

#### 目标
实现完整的异常恢复机制，确保所有异常都有恢复入口。

#### 任务清单

##### 6.1 快照系统
- [ ] 实现快照保存
- [ ] 实现快照列表
- [ ] 实现快照恢复
- [ ] 实现快照删除
- [ ] 实现快照自动保存
- [ ] 实现快照版本管理

**涉及文件：**
- 新增 `snapshot.service.ts`
- `collaboration-state.service.ts`

##### 6.2 tmux异常修复
- [ ] 实现tmux会话状态检测
- [ ] 实现tmux异常识别
- [ ] 实现tmux会话重建
- [ ] 实现Agent重新绑定
- [ ] 实现修复后状态同步
- [ ] 实现修复历史记录

**涉及文件：**
- 增强 `multi-agent.tmux.backend.ts`
- 新增 `tmux-recovery.service.ts`

##### 6.3 任务失败恢复
- [ ] 实现任务失败原因分析
- [ ] 实现失败任务重试
- [ ] 实现失败任务重新分配
- [ ] 实现失败任务跳过
- [ ] 实现失败任务标记
- [ ] 实现失败统计和报告

**涉及文件：**
- 新增 `task-recovery.service.ts`
- `execution-controller.service.ts`

##### 6.4 自动fallback机制
- [ ] 实现后端可用性检测
- [ ] 实现fallback策略选择
- [ ] 实现自动切换到备用后端
- [ ] 实现fallback后状态同步
- [ ] 实现fallback历史记录

**涉及文件：**
- 增强 `multi-agent.backend.ts`
- 新增 `fallback.service.ts`

##### 6.5 错误翻译层
- [ ] 实现底层错误捕获
- [ ] 实现错误翻译为用户语言
- [ ] 实现错误分类
- [ ] 实现错误恢复建议
- [ ] 实现错误日志记录

**涉及文件：**
- 新增 `error-translator.service.ts`
- 新增错误消息配置文件

#### 验收标准
- [ ] 能保存和恢复快照
- [ ] tmux异常能自动检测并提供修复入口
- [ ] 任务失败有明确的恢复选项
- [ ] 后端不可用时能自动fallback
- [ ] 所有错误都翻译为用户可理解的语言

---

### 阶段 7：工作台页增强（优先级：P2）

#### 目标
增强工作台页的多智能体协作能力，实现终端页与协作页的联动。

#### 任务清单

##### 7.1 Agent到终端的跳转
- [ ] 实现Agent卡片到终端Tab的跳转
- [ ] 实现终端页显示所属Agent
- [ ] 实现Detach/Attach状态联动
- [ ] 实现重连成功后的自动聚焦

**涉及文件：**
- `workbench.page.ts` - Agent Tab管理
- `collaboration.page.ts` - Agent卡片

##### 7.2 任务流协作区
- [ ] 实现任务创建入口
- [ ] 实现任务分配入口
- [ ] 实现Leader下发入口
- [ ] 实现Teammate回传入口
- [ ] 实现任务状态流转

**涉及文件：**
- `workbench.page.ts` - 任务流区域
- 新增 `task-flow.component.ts`

##### 7.3 观测与恢复区
- [ ] 实现事件流展示
- [ ] 实现重试记录展示
- [ ] 实现快照管理入口
- [ ] 实现tmux异常修复入口
- [ ] 实现恢复动作执行

**涉及文件：**
- `workbench.page.ts` - 观测恢复区域
- 新增 `observation-panel.component.ts`

##### 7.4 默认路径优化
- [ ] 实现新建Team的默认初始化
- [ ] 实现首个Leader自动创建
- [ ] 实现添加Teammate的最少操作路径
- [ ] 实现任务创建时的默认字段
- [ ] 实现模式推荐规则
- [ ] 实现"下一步建议"机制

**涉及文件：**
- `workbench.page.ts` - 初始化逻辑
- 新增 `onboarding.service.ts`

#### 验收标准
- [ ] 能从协作页跳转到对应终端Tab
- [ ] 终端页能显示所属Agent信息
- [ ] 任务流协作区功能完整
- [ ] 观测与恢复区功能完整
- [ ] 新用户5步内能跑通首个任务

---

### 阶段 8：测试与优化（优先级：P1）

#### 目标
完善测试覆盖，优化性能，确保系统稳定可靠。

#### 任务清单

##### 8.1 单元测试
- [ ] 状态服务单元测试
- [ ] 编排服务单元测试
- [ ] 模式管理服务单元测试
- [ ] WebSocket服务单元测试
- [ ] 各模式服务单元测试
- [ ] 恢复服务单元测试

**涉及文件：**
- 新增各服务的 `.spec.ts` 文件

##### 8.2 集成测试
- [ ] 智能体创建流程集成测试
- [ ] 团队创建流程集成测试
- [ ] 任务编排流程集成测试
- [ ] 模式切换流程集成测试
- [ ] 异常恢复流程集成测试

**涉及文件：**
- 新增集成测试文件

##### 8.3 端到端测试
- [ ] 完整协作流程E2E测试
- [ ] 完整对抗流程E2E测试
- [ ] 完整编排流程E2E测试
- [ ] 完整恢复流程E2E测试

**涉及文件：**
- 新增E2E测试文件

##### 8.4 性能优化
- [ ] 状态更新性能优化（防抖、节流）
- [ ] 组件渲染性能优化（OnPush、trackBy）
- [ ] WebSocket消息处理优化
- [ ] 粒子系统性能优化
- [ ] 图谱渲染性能优化
- [ ] 内存泄漏检测与修复

**涉及文件：**
- 各组件和服务文件

##### 8.5 用户体验优化
- [ ] 加载状态优化
- [ ] 错误提示优化
- [ ] 空状态优化
- [ ] 动画过渡优化
- [ ] 快捷键完善
- [ ] 响应式布局优化

**涉及文件：**
- 各组件文件

#### 验收标准
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试覆盖所有核心流程
- [ ] E2E测试覆盖主要用户路径
- [ ] 页面加载时间 < 2秒
- [ ] 状态更新延迟 < 100ms
- [ ] 无明显内存泄漏
- [ ] 用户操作流畅无卡顿

---

## 5. 数据模型定义

### 5.1 核心实体

```typescript
// Agent实体
interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  load: number;
  skills: string[];
  backend: AgentBackend;
  sessionId?: string;
  teamId?: string;
  createdAt: Date;
  updatedAt: Date;
}

type AgentRole = 'leader' | 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product' | 'judge' | 'red' | 'blue' | 'reviewer';
type AgentStatus = 'idle' | 'running' | 'busy' | 'error' | 'disconnected';
type AgentBackend = 'in-process' | 'tmux' | 'embedded-gui';

// Team实体
interface Team {
  id: string;
  name: string;
  description: string;
  mode: CollaborationMode;
  score: number;
  agents: Agent[];
  leaderId?: string;
  status: TeamStatus;
  createdAt: Date;
  updatedAt: Date;
}

type TeamStatus = 'created' | 'running' | 'paused' | 'finished' | 'error';

// Task实体
interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgentId?: string;
  teamId?: string;
  dependencies: string[];
  progress: number;
  result?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

type TaskStatus = 'pending' | 'assigned' | 'running' | 'waiting' | 'completed' | 'failed';
type TaskPriority = 'high' | 'medium' | 'low';

// CollaborationMode实体
interface CollaborationMode {
  id: string;
  name: string;
  label: string;
  description: string;
  type: ModeType;
  config: ModeConfig;
  status: ModeStatus;
}

type ModeType = 'coop' | 'pipeline' | 'storm' | 'contest' | 'battle' | 'debate' | 'redblue' | 'sprint' | 'turnbased' | 'review';
type ModeStatus = 'inactive' | 'running' | 'paused' | 'finished';
```

### 5.2 状态模型

```typescript
interface CollaborationStateSnapshot {
  activeTab: ViewType;
  mode: CollaborationMode;
  modeLabel: string;
  modeDescription: string;
  modeStatus: string;
  collaborationSummary: CollaborationSummary;
  orchestration: OrchestrationSnapshot;
  runtime: RuntimeSnapshot;
  autoOrchestration: AutoOrchestrationSnapshot;
  battleStage: BattleStageSnapshot;
  agents: Agent[];
  teams: Team[];
  tasks: Task[];
  monitor: MonitorSnapshot;
  pageStatus: PageStatus;
}
```

---

## 6. WebSocket消息协议

### 6.1 消息类型

```typescript
type WebSocketMessageType =
  | 'AGENT_STATUS_UPDATE'
  | 'AGENT_CREATED'
  | 'TEAM_CREATED'
  | 'TEAM_STATUS_UPDATE'
  | 'TASK_CREATED'
  | 'TASK_STATUS_UPDATE'
  | 'TASK_ASSIGNED'
  | 'BATTLE_STATE_UPDATE'
  | 'ROUND_CHANGE'
  | 'SCORE_UPDATE'
  | 'MODE_STATE_UPDATE'
  | 'MONITOR_UPDATE'
  | 'TEAM_VM_UPDATE'
  | 'SNAPSHOT_SAVED'
  | 'SNAPSHOT_RESTORED'
  | 'ERROR_OCCURRED'
  | 'RECOVERY_ACTION'
  | 'JOIN_ARENA'
  | 'LEAVE_ARENA'
  | 'RESET_SESSION'
  | 'RUNTIME_SUGGESTION'
  | 'MONITOR_ALERT_OPEN'
  | 'TASK_REDISTRIBUTE';
```

### 6.2 消息格式

```typescript
interface WebSocketMessage {
  type: WebSocketMessageType;
  data: any;
  timestamp: number;
  sessionId: string;
}
```

---

## 7. 实施路线图

### 第1-2周：阶段1 - 数据流打通
- 完成智能体创建数据流
- 完成团队创建数据流
- 完成任务编排数据流
- 完成WebSocket消息映射
- 完成Mock数据替换

### 第3-4周：阶段2 - 5种对抗模式
- 完成辩论对抗模式
- 完成红蓝攻防模式
- 完成竞赛冲刺模式
- 完成回合博弈模式
- 完成混合评审模式

### 第5-6周：阶段3 - 手动编排
- 完成可视化编排画布
- 完成任务节点管理
- 完成依赖关系管理
- 完成执行控制
- 完成编排模板

### 第7-8周：阶段4 - 自动编排
- 完成目标解析服务
- 完成自动团队生成
- 完成自动任务拆分
- 完成自动调度策略
- 完成自动收敛策略
- 完成混合编排支持

### 第9-10周：阶段5 - 可视化增强
- 完成团队图谱可视化
- 完成任务流时间轴
- 完成对抗竞技场动画
- 完成结果对比面板
- 完成粒子系统增强

### 第11-12周：阶段6 - 异常恢复
- 完成快照系统
- 完成tmux异常修复
- 完成任务失败恢复
- 完成自动fallback机制
- 完成错误翻译层

### 第13-14周：阶段7 - 工作台增强
- 完成Agent到终端跳转
- 完成任务流协作区
- 完成观测与恢复区
- 完成默认路径优化

### 第15-16周：阶段8 - 测试与优化
- 完成单元测试
- 完成集成测试
- 完成E2E测试
- 完成性能优化
- 完成用户体验优化

---

## 8. 风险与应对

### 8.1 技术风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| WebSocket连接不稳定 | 状态同步失败 | 实现重连机制、消息队列、离线缓存 |
| 后端接口未就绪 | 前端无法联调 | 保留Mock数据、使用适配层隔离 |
| 性能瓶颈 | 页面卡顿 | 提前性能测试、优化渲染逻辑、使用Web Worker |
| 浏览器兼容性 | 部分功能不可用 | 明确支持的浏览器版本、提供降级方案 |

### 8.2 进度风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 需求变更 | 开发延期 | 保持架构灵活性、预留缓冲时间 |
| 人员变动 | 知识断层 | 完善文档、代码审查、知识共享 |
| 技术难点 | 阻塞进度 | 提前技术预研、寻求外部支持 |

### 8.3 质量风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 测试覆盖不足 | 上线后Bug多 | 严格执行测试计划、自动化测试 |
| 代码质量下降 | 维护困难 | 代码审查、静态分析、重构计划 |
| 文档不完善 | 交接困难 | 同步更新文档、代码注释规范 |

---

## 9. 验收标准总结

### 9.1 功能验收

- [ ] 智能体管理：能创建、查看、管理智能体
- [ ] 团队管理：能创建、查看、管理团队
- [ ] 任务编排：能创建、分配、执行、监控任务
- [ ] 5种对抗模式：能切换、执行、查看结果
- [ ] 手动编排：能可视化编排、拖拽、依赖管理
- [ ] 自动编排：能自动解析、组队、拆分、调度
- [ ] 可视化：能清晰展示协作关系和执行过程
- [ ] 异常恢复：能保存快照、修复异常、恢复任务

### 9.2 性能验收

- [ ] 页面加载时间 < 2秒
- [ ] 状态更新延迟 < 100ms
- [ ] WebSocket消息处理延迟 < 50ms
- [ ] 图谱渲染帧率 > 30fps
- [ ] 内存占用稳定，无明显泄漏

### 9.3 用户体验验收

- [ ] 新用户5步内能跑通首个任务
- [ ] 所有操作有明确的反馈
- [ ] 所有错误有清晰的提示和恢复入口
- [ ] 快捷键覆盖常用操作
- [ ] 响应式布局适配不同屏幕

### 9.4 代码质量验收

- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试覆盖所有核心流程
- [ ] E2E测试覆盖主要用户路径
- [ ] 代码审查通过率 100%
- [ ] 静态分析无严重问题

---

## 10. 附录

### 10.1 相关文件清单

#### 核心服务
- `multi-agent.orchestrator.service.ts` - 编排服务
- `multi-agent.websocket.service.ts` - WebSocket服务
- `multi-agent.event-bus.service.ts` - 事件总线
- `multi-agent.session.ts` - 会话管理
- `collaboration-state.service.ts` - 协作状态服务
- `mode-manager.service.ts` - 模式管理服务

#### 页面组件
- `collaboration.page.ts` - 协作页
- `workbench.page.ts` - 工作台页
- `battle-stage.component.ts` - 竞技场舞台
- `debate-panel.component.ts` - 辩论面板
- `network-graph.component.ts` - 网络图谱
- `timeline.component.ts` - 时间轴
- `agent-node.component.ts` - Agent节点

#### 新增服务（待实现）
- `debate-mode.service.ts` - 辩论模式服务
- `redblue-mode.service.ts` - 红蓝攻防模式服务
- `sprint-mode.service.ts` - 竞赛冲刺模式服务
- `turnbased-mode.service.ts` - 回合博弈模式服务
- `review-mode.service.ts` - 混合评审模式服务
- `orchestration-canvas.component.ts` - 编排画布
- `goal-parser.service.ts` - 目标解析服务
- `auto-team-generator.service.ts` - 自动团队生成服务
- `task-splitter.service.ts` - 任务拆分服务
- `auto-scheduler.service.ts` - 自动调度服务
- `auto-convergence.service.ts` - 自动收敛服务
- `snapshot.service.ts` - 快照服务
- `tmux-recovery.service.ts` - tmux恢复服务
- `task-recovery.service.ts` - 任务恢复服务
- `fallback.service.ts` - Fallback服务
- `error-translator.service.ts` - 错误翻译服务

### 10.2 术语表

| 术语 | 说明 |
|------|------|
| Agent | 智能体，执行具体任务的单元 |
| Team | 团队，多个Agent的集合 |
| Task | 任务，需要执行的工作单元 |
| Session | 会话，Agent的执行环境 |
| Leader | 领导Agent，负责规划和决策 |
| Teammate | 队友Agent，负责执行任务 |
| Orchestration | 编排，任务分配和调度 |
| Collaboration Mode | 协作模式，5种对抗/协作方式 |
| Snapshot | 快照，系统状态的保存点 |
| Fallback | 降级，后端不可用时的备用方案 |

---

## 11. 总结

本文档整合了4个核心文档的内容，结合当前实现现状，制定了详细的待开发计划。

### 核心目标
1. **打通数据流** - 替换所有mock数据，实现真实的数据同步
2. **实现5种对抗模式** - 完整的模式切换、执行流程、结果输出
3. **完善手动编排** - 可视化编排、任务拖拽、依赖管理
4. **实现自动编排** - 目标解析、自动组队、自动调度
5. **增强可视化** - 团队图谱、时间轴、竞技场动画
6. **完善异常恢复** - 快照、修复、fallback机制

### 实施原则
1. **任务优先** - 先打通核心流程，再完善细节
2. **渐进式开发** - 分阶段实施，每阶段有明确验收标准
3. **质量保障** - 同步编写测试，确保代码质量
4. **用户导向** - 以用户体验为中心，简化操作流程

### 预期成果
完成所有开发后，Zyfront Desktop将成为一个完整的"可编排、可对抗、可观测、可恢复、可视化"的多智能体操作系统，支持从简单任务到复杂协作的各种场景。
