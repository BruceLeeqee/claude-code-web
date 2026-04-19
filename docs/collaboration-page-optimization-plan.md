# 协作页逻辑梳理与优化详细方案

> 项目：`zyfront-desktop`
>
> 模块：`src/app/features/prototype/collaboration`
>
> 文档版本：v1.0
>
> 生成日期：2026-04-19
>
> 目标：梳理当前协作页的状态、数据流、交互入口与风险点，并给出可落地的优化路线，提升一致性、可维护性、稳定性与扩展性。

---

## 1. 当前协作页逻辑总览

协作页当前已经从“演示型页面”发展为一个集成多种协作/对抗/编排能力的综合控制台，核心由 `collaboration.page.ts`、`collaboration.page.html`、`collaboration.page.scss` 以及一组服务和可视化组件组成。

### 1.1 主要组成

#### 页面容器
- `CollaborationPrototypePageComponent`
- 负责：视图切换、模态框开关、任务/Agent/团队创建、快照、自动编排、恢复、快捷键、与编排服务同步。

#### 状态中心
- `CollaborationStateService`
- 负责：统一维护页面的 Agent、Team、Task、battleStage、monitor、runtime、summary、orchestration 等信号状态。

#### 模式与对抗能力
- `ModeManagerService`
- `DebateModeService`
- `DebateAgentService`
- `RedBlueModeService`
- `SprintModeService`
- `TurnBasedModeService`
- `ReviewModeService`
- 负责：模式配置、切换、对抗流程状态机、辩论评分、竞赛/回合/评审等业务逻辑。

#### 编排与恢复
- `MultiAgentOrchestratorService`
- `AutoOrchestrationService`
- `OrchestrationTemplatesService`
- `SnapshotService`
- `ErrorRecoveryService`
- 负责：Agent 实例创建、编排建议、模板落地、快照管理、错误翻译与恢复。

#### 视觉组件
- `BattleStageComponent`
- `DebatePanelComponent`
- `ModeSelectorComponent`
- `TimelineComponent`
- `OrchestrationCanvasComponent`
- `ResourceSchedulerComponent`
- 负责：展示状态、交互、图形化编排与看板。

---

## 2. 当前逻辑梳理

### 2.1 页面入口与视图结构

当前协作页使用四种视图：
- `arena`：智能体看板与竞技场视图
- `network`：当前模板中尚未成为主入口，偏预留
- `cognitive`：可视化编排画布
- `monitor`：资源监控、Agent 管理、恢复入口

页面通过 `activeTab` 驱动布局切换，中心区域在不同视图中渲染不同内容。

### 2.2 页面状态

`collaboration.page.ts` 中维护了多组 UI 状态：
- 模态框：`showAgentBuildModal`、`showTeamBuildModal`、`showTaskOrchestrationModal`、`showAgentDashboardModal`
- 播放状态：`isPlaying`、`speed`、`speeds`
- 表单状态：`agentBuildForm`、`teamBuildForm`、任务创建字段
- 本地列表：`taskOrchestrationList`

此外，`pageSnapshot` 与 `modeSnapshot` 通过 computed 方式读取服务状态。

### 2.3 核心业务流程

#### Agent 创建流程
1. 打开 Agent 模态框
2. 填写名称、角色、描述、技能、模式
3. 调用 `orchestrator.spawnTeammate()`
4. 本地生成 `CollaborationAgentVm`
5. 写入 `CollaborationStateService`
6. 调用 `syncFromOrchestrator()` 更新运行时摘要

#### Team 创建流程
1. 打开 Team 模态框
2. 选择 Agent 成员
3. 生成 Team VM
4. 写入 `CollaborationStateService`
5. 调用同步方法刷新概要数据

#### 任务创建与编排流程
1. 打开任务模态框
2. 录入标题、描述、优先级、执行者
3. 创建任务对象并推入 `taskOrchestrationList`
4. 同步写入 `CollaborationStateService`
5. 启动/完成/失败通过局部方法修改状态
6. 再通过 `syncFromOrchestrator()` 刷新协作摘要和编排摘要

#### 快照流程
- `saveSnapshot()`：直接写入 `localStorage`
- `saveCurrentSnapshot()`：调用 `SnapshotService`
- `restoreLatestSnapshot()` / `restoreSnapshot()`：从快照服务恢复，并回写状态服务

#### 自动编排流程
- `runAutoOrchestration()`：根据目标生成 plan、team、tasks，写入任务列表和状态服务
- `startAutoOrchestration()`：从空闲 Agent 与待办任务中进行简单配对
- `suggestAutoOrchestration()`：仅打印建议，没有形成结构化结果

#### 恢复流程
- `tryRecovery()`：尝试错误恢复，并联动快照恢复
- `autoRecovery()`：将 error Agent 改回 idle，failed task 重试

### 2.4 数据同步方式

当前页面存在两类状态来源：
1. **服务状态**：`CollaborationStateService`、`SnapshotService`、`ModeManagerService` 等
2. **页面局部状态**：`taskOrchestrationList`、`agentBuildForm`、`teamBuildForm`

同步主要依赖：
- `syncFromOrchestrator()`
- 手工调用 `stateService.addAgent/addTeam/addTask/updateTaskStatus/updateAgentStatus`
- 视图层直接读取 `stateService` 的 signal

---

## 3. 当前实现的主要问题

### 3.1 状态源分散，存在“双写”风险

目前任务、Agent、Team 既存在页面局部状态，又存在状态服务状态：
- `taskOrchestrationList` 与 `stateService.tasks()` 并不天然一致
- Team 变更由页面写入，但状态服务并未提供统一的 Team 更新接口
- 快照恢复只恢复了部分字段（如 teams、tasks），未覆盖运行时与摘要完整状态

风险：
- 页面局部状态和服务状态漂移
- 某些 UI 读取服务，某些交互写页面数组，容易产生“显示正确但底层不一致”的问题

### 3.2 `syncFromOrchestrator()` 只覆盖了部分核心数据

该方法目前主要更新：
- runtime
- collaborationSummary
- orchestration

但没有统一更新：
- agents 列表
- battleStage
- tasks 之间的派生关系
- monitor 指标

同时其中使用了随机负载与随机延迟，导致：
- 数据不可预测
- 快照/回放与实时状态不一致
- 测试难以稳定断言

### 3.3 事件绑定存在内存泄漏风险

`ngOnInit()` 中使用：
- `window.addEventListener('keydown', this.handleKeyDown.bind(this))`

`ngOnDestroy()` 中又使用一次 `.bind(this)` 进行移除。

问题：
- 两次 bind 返回不同函数引用
- 实际上无法正确移除监听器
- 页面反复进入退出会造成事件泄漏

### 3.4 任务生命周期不完整

当前任务支持：
- pending
- running
- completed
- failed

但缺少：
- 依赖检查
- 待执行任务解锁逻辑
- 取消/暂停/跳过
- 失败重试原因记录
- 任务执行历史

### 3.5 模式系统与页面集成仍较松散

页面已经注入多个模式服务，但主页面逻辑仍主要围绕手动任务和编排摘要：
- 模式切换后，页面只更新模式标签
- 各模式的状态机结果未统一反馈到 `battleStage` / `summary` / `monitor`
- 模式相关 UI 虽已存在，但缺少统一的“模式驱动状态协调层”

### 3.6 模板与自动编排复用不足

- `applyTemplate()` 直接写入 Agent/Team/Task，缺乏统一重置流程
- 模板加载后未保证清理旧任务、旧团队、旧摘要
- 自动编排结果没有结构化落地到“来源/版本/建议理由”

### 3.7 UI 结构较重，单文件职责过多

`collaboration.page.ts` 既承担：
- UI 事件处理
- 状态计算
- 编排逻辑
- 快照逻辑
- 错误恢复
- 模板应用
- 快捷键处理

结果：
- 可读性下降
- 测试成本增加
- 后续新增功能时容易继续膨胀

### 3.8 可观测性不足

当前虽然有监控区，但缺少统一的“操作事件流”：
- Agent 创建事件
- Team 创建事件
- Task 状态变化事件
- 快照保存/恢复事件
- 恢复尝试事件
- 模式切换事件

没有结构化日志后，排查问题主要依赖 console 输出。

---

## 4. 优化目标

### 4.1 一致性
- 所有协作数据以服务状态为唯一事实来源
- 页面局部状态仅保留表单草稿和纯 UI 开关
- 避免重复维护任务和 Agent 列表

### 4.2 可维护性
- 让页面组件只做编排与 UI 交互
- 将业务行为下沉到专门服务
- 减少页面中“成块逻辑”继续增长

### 4.3 可恢复性
- 快照、错误恢复、自动恢复形成统一入口
- 恢复后状态可完全重建
- 支持恢复过程可追踪、可回滚

### 4.4 可测试性
- 剥离随机性
- 统一任务状态流转
- 提供可断言的纯函数或受控服务方法

### 4.5 可扩展性
- 方便后续接入真实后端、WebSocket、多用户协作
- 方便后续新增模式、模板、编排策略

---

## 5. 详细优化方案

## 4. 里程碑拆分（辩论模式优先）

### M1 走通单模式端到端闭环
目标：打通辩论对抗模式下的 `Agent 创建 → Team 创建 → Task 编排 → 启动执行 → 智能体看板反馈`。

交付物：
- 手动编排按钮
- 手动编排 mock 数据
- 智能体看板可见效果
- 任务从 pending 到 running/completed 的完整流转

验收标准：
- 能从协作页一键跑通辩论场景
- 看板能看到创建的 Agent / Team / Task
- 能观察到执行状态变化

### M2 自动编排打通
目标：输入辩题后，自动生成辩论场景的 Agent、Team 与任务链。

交付物：
- 自动编排 mock 数据
- 自动编排入口
- 自动生成任务依赖链
- 自动更新看板统计

验收标准：
- 自动编排后页面可直接观察到完整场景
- 任务与团队关系正确
- 看板统计正确更新

### M3 清理非必要测试数据
目标：只保留辩论模式相关 mock 数据，去掉当前无关测试数据。

交付物：
- 删除其他场景 mock 数据
- 删除不必要的测试入口
- 保留最小可用的辩论模式样例

验收标准：
- 代码中仅保留辩论模式 mock 方案
- 不影响页面主流程

---

## 5.1 状态架构重构

### 方案
将 `CollaborationStateService` 提升为协作页唯一状态中心，页面不再直接维护与业务实体重复的数组。

### 落地措施
1. 新增统一的 state mutation 方法：
   - `upsertAgent()`
   - `removeAgent()`
   - `upsertTeam()`
   - `removeTeam()`
   - `upsertTask()`
   - `removeTask()`
   - `resetState()`

2. 将 `taskOrchestrationList` 改为派生视图：
   - 页面中通过 `stateService.tasks()` 获取任务列表
   - 仅在表单提交时传入创建参数

3. Team/Agent 列表全部通过 service 读取：
   - 模态框、看板、统计面板统一消费同一状态源

4. 引入统一状态重置：
   - 模板应用前清空当前场景
   - 快照恢复时还原完整场景

### 预期收益
- 减少数据漂移
- 让快照与恢复更可靠
- 降低组件之间耦合

---

## 5.2 任务生命周期完善

### 方案
将任务从“简单状态切换”提升为“可编排任务实体”。

### 建议新增能力
- 依赖校验：启动前检查依赖是否已完成
- 状态机：pending → queued → running → completed/failed/cancelled
- 失败信息：记录失败原因、失败次数、最后一次错误
- 重试策略：支持延迟重试、手动重试、自动重试
- 任务审计：记录创建/启动/完成/失败/重试时间线

### 落地措施
1. 在 `CollaborationTaskVm` 中增加：
   - `createdAt`
   - `startedAt`
   - `completedAt`
   - `failedReason`
   - `attempts`

2. 在 `CollaborationStateService` 中增加：
   - `canStartTask(taskId)`
   - `setTaskAssignedAgent(taskId, agentId)`
   - `recordTaskFailure(taskId, reason)`

3. 页面层启动任务前先校验依赖。

### 预期收益
- 任务执行逻辑更贴近真实编排系统
- 失败恢复与自动调度更容易接入

---

## 5.3 `syncFromOrchestrator()` 重构

### 问题
当前同步仅更新局部统计，且带随机数，难以作为权威同步入口。

### 优化原则
同步函数应满足：
- 可重复
- 无随机副作用
- 只做“从编排器读取并映射到状态服务”的工作

### 落地建议
1. 把随机 load、随机 latency 替换为确定性计算或从实际运行时读取。
2. 同步时刷新：
   - `runtime`
   - `collaborationSummary`
   - `orchestration`
   - `monitor`
3. 提取映射函数：
   - `mapVmToAgents()`
   - `mapVmToSummary()`
   - `mapVmToRuntime()`

### 预期收益
- 稳定可测
- 恢复后不会出现“抖动状态”
- 更适合接入真实运行数据

---

## 5.4 快照与恢复体系升级

### 现状问题
- `saveSnapshot()` 与 `saveCurrentSnapshot()` 并行存在
- 恢复逻辑只恢复部分状态
- 缺少快照版本与差异信息

### 优化方案
1. 统一快照入口：
   - 页面只保留一个保存动作
   - `SnapshotService` 负责所有持久化/恢复逻辑

2. 快照内容补全：
   - agents
   - teams
   - tasks
   - mode
   - runtime
   - battleStage
   - collaborationSummary
   - orchestration
   - monitor

3. 快照版本化：
   - 增加 `version`
   - 增加 `source`
   - 增加 `createdBy`
   - 增加 `scene`

4. 恢复前后校验：
   - 恢复成功后检查关键实体是否齐全
   - 恢复失败时回滚到上一个稳定快照

### 预期收益
- 恢复更完整
- 便于排查历史问题
- 能支撑后续导入导出

---

## 5.5 快捷键与全局事件治理

### 现状问题
- `keydown` 监听的绑定/解绑不一致
- 当前快捷键逻辑散落在页面类里

### 优化方案
1. 在构造阶段或字段层保存稳定函数引用：
   - `private readonly boundKeyDownHandler = this.handleKeyDown.bind(this);`

2. 增加统一快捷键管理方法：
   - `registerGlobalShortcuts()`
   - `unregisterGlobalShortcuts()`

3. 若后续快捷键增多，拆出独立 `KeyboardShortcutService`

### 预期收益
- 避免内存泄漏
- 方便扩展更多快捷键
- 改善页面生命周期清理

---

## 5.6 模式系统与页面联动增强

### 现状问题
- 模式切换后更多是“标签变化”
- 各模式的行为未完全驱动页面结构和状态摘要

### 优化方案
1. 统一模式事件：
   - `onModeChanged`
   - `onModeStarted`
   - `onModeStopped`
   - `onModeResultReady`

2. 让模式切换触发：
   - 页面状态摘要更新
   - 视图默认标签调整
   - 监控区恢复建议更新

3. 为每种模式定义统一输出：
   - `modeLabel`
   - `modeDescription`
   - `modeStatus`
   - `modeResult`
   - `recommendedNextStep`

### 预期收益
- 模式体验更完整
- 协作页更像一个“模式运行台”而非静态页面

---

## 5.7 自动编排能力增强

### 现状问题
- 自动编排更像“批量创建任务”的辅助功能
- 缺少建议解释、调度过程可视化、人工介入点

### 优化方案
1. 自动编排输出结构化结果：
   - 目标解析结果
   - 角色推荐
   - 任务拆分树
   - 调度策略
   - 收敛策略
   - 风险说明

2. 在画布中展示：
   - 自动生成来源
   - 任务依赖关系
   - 推荐优先级
   - 手工修改痕迹

3. 引入“混合编排”模式：
   - 系统推荐方案
   - 用户可调整成员、优先级、依赖
   - 调整后重新计算

### 预期收益
- 自动编排不再是黑盒
- 更容易让用户接受推荐结果

---

## 5.8 可观测性增强

### 建议引入统一事件日志
记录：
- Agent 创建
- Team 创建
- Task 创建/启动/完成/失败/重试
- 模式切换
- 快照保存/恢复
- 错误恢复
- 自动编排执行

### 日志结构建议
- `eventId`
- `eventType`
- `timestamp`
- `source`
- `payload`
- `result`
- `severity`

### 预期收益
- 方便定位问题
- 支撑未来审计和回放
- 可直接驱动时间轴与监控 UI

---

## 5.9 UI/UX 优化

### 建议方向
1. **信息分层**
   - 主操作按钮更聚焦
   - 高风险操作增加确认
   - 只显示与当前视图相关的关键指标

2. **空状态优化**
   - Agent、Team、Task 都提供引导空状态
   - 模板加载入口放在首屏更显眼位置

3. **加载与反馈**
   - 编排执行、恢复、模板应用增加 loading
   - 提供成功/失败 toast 或状态条

4. **可读性提升**
   - 减少过多“硬编码百分比/文本”
   - 统一中文术语与英文术语混用规则

5. **响应式与布局**
   - 视图切换时减少跳动
   - 面板内部采用自适应高度

---

## 6. 推荐实施顺序

### 第一阶段：稳定性修复
1. 修复全局键盘监听解绑问题
2. 去除随机同步数据
3. 统一任务列表数据源
4. 补齐快照恢复字段

### 第二阶段：状态架构整理
1. 为状态服务补充统一 CRUD 接口
2. 将页面局部业务数组迁移为服务驱动
3. 统一任务生命周期
4. 抽离通用状态映射函数

### 第三阶段：能力增强
1. 补充任务依赖校验与重试策略
2. 增强模式联动输出
3. 增强自动编排的结构化结果
4. 建立事件日志/审计流

### 第四阶段：体验提升
1. 优化空状态与 loading
2. 统一按钮与面板层级
3. 增加更完整的提示与确认交互
4. 根据事件日志驱动时间轴展示

---

## 7. 风险与注意事项

### 7.1 兼容风险
如果直接重构状态中心，可能影响现有模板、看板、模态框。

**建议**：分步迁移，每次只改一个数据域，并补回归测试。

### 7.2 快照兼容风险
补充快照字段后，旧快照可能无法完整恢复。

**建议**：做版本兼容和默认值兜底。

### 7.3 模式服务耦合风险
多个模式服务同时注入，若缺少协调层，未来会继续膨胀。

**建议**：定义统一 `CollaborationModeFacade` 或协调服务。

### 7.4 性能风险
随着 Agent、Task、事件流增多，模板中大量 `computed()` 可能引发多次派生计算。

**建议**：为大列表引入更精细的派生和 trackBy 策略。

---

## 8. 交付物清单

建议本次优化阶段最终交付以下内容：
- 协作页逻辑梳理文档
- 状态架构优化方案
- 快照与恢复升级方案
- 键盘监听修复
- 任务生命周期增强
- 自动编排结构化输出
- 统一事件日志方案

---

## 9. 总结

当前协作页已经具备较完整的功能骨架，但核心问题不在“能不能用”，而在“能否稳定一致地扩展”。

优先建议先解决以下三件事：
1. **状态单一来源**：消除页面局部数组与服务状态重复维护
2. **同步确定性**：去掉随机同步与不稳定映射
3. **恢复完整性**：让快照与恢复真正覆盖整个协作场景

完成这些后，再继续推进模式联动、自动编排增强和事件审计，将能显著提升整个协作页的可维护性与可扩展性。
