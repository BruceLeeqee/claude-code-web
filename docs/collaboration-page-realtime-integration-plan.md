# 协作页实时接入与重构计划

## 1. 目标

将当前协作页重构为“数据驱动的运行页”，使四个视图不再依赖空数据或散落 mock，而是统一从状态层获取可运行数据，并逐步对接真实系统。

## 2. 当前目标状态

- 页面不是空壳
- 按钮具备真实动作入口
- 状态统一由服务管理
- 后端智能体能力使用本项目既有实现
- 真实 WebSocket / 编排服务可逐步接入

## 3. 重构原则

- 页面只负责展示和交互，不直接拼装业务状态
- 状态由统一的数据服务提供，便于对接真实系统
- 视图职责清晰，避免重复承载同一类信息
- 先建立前端可接入结构，再逐步替换为真实后端数据
- 保留现有布局与视觉节奏，不做激进 UI 重做

## 4. 页面职责

### 4.1 智能体看板
负责呈现结果态与运行概览：
- 团队战局
- Agent 运行状态
- 回合/轮次
- 全局协作摘要

### 4.2 任务编排
负责呈现任务拆分、编排决策与编排结果：
- 任务拆分
- Agent 分配
- 拓扑/流向结果
- 人工确认点

### 4.3 智能体管理
负责呈现 Agent 创建、能力配置与资源控制：
- Agent 在线状态
- 技能/插件
- 资源负载
- 恢复入口

## 5. 数据分层设计

### 5.1 页面状态层
新增统一状态服务作为页面唯一状态入口：
- 当前页签
- 当前模式
- 协作摘要
- 编排快照
- 运行快照
- 自动编排预留区
- 战局数据
- Agent 列表
- 监控数据

### 5.2 动作层
按钮和快捷键不再直接操作页面局部变量，而是调用：
- `MultiAgentOrchestratorService`
- `MultiAgentWebSocketService`
- `CollaborationStateService`

### 5.3 适配层
WebSocket 或 REST 数据先进入适配层，再转成页面状态：
- Agent 状态事件
- 编排状态事件
- 模式切换事件
- 监控状态事件
- 恢复状态事件

### 5.4 视图层
视图组件只消费状态服务输出的数据，不直接处理协议细节。

## 6. 统一状态模型

建议统一状态模型包含以下部分：

- `activeTab`
- `mode`
- `modeLabel`
- `modeDescription`
- `modeStatus`
- `collaborationSummary`
- `orchestration`
- `runtime`
- `autoOrchestration`
- `battleStage`
- `agents`
- `monitor`
- `pageStatus`

## 7. 已接入按钮

### 7.1 智能体管理
- `新建Agent`：调用 `spawnTeammate`
- `扩容建议`：基于当前 VM 计算建议
- `资源告警设置`：发出监控告警打开事件
- `+ / -`：调整 Agent 负载展示

### 7.2 任务编排
- `重连会话`：尝试对 tmux Agent 执行 attach
- `重新分配`：发出任务重分配事件
- `同步至本地`：保存页面快照到 localStorage

### 7.3 底部控制
- `⏮`：重置会话
- `▶ / ⏸`：播放/暂停
- `⏭`：当前保留为后续动作位，可接扩容或步进控制

## 8. 接入流程

### 8.1 第一阶段：前端数据驱动化
- 引入统一状态服务
- 将页面中的散落状态迁移到状态服务
- 页面改为从状态服务读取
- 保证页面可运行、可切换、可响应状态变化

### 8.2 第二阶段：对接真实事件流
- 接入 WebSocket 消息
- 统一映射为页面状态更新
- Agent 状态、战局、编排、监控信息实时更新

### 8.3 第三阶段：对接真实接口
- Agent 列表接口
- 编排接口
- 模式切换接口
- 恢复入口接口
- 技能/插件接口

### 8.4 第四阶段：补齐交互动作
- 创建 Agent
- 分配任务
- 启动/停止/恢复
- 自动编排推荐
- 结果确认

## 9. 组件拆分建议

### 建议保留的组件
- `ModeSelectorComponent`
- `AgentNodeComponent`
- `BattleStageComponent`
- `DebatePanelComponent`
- `NetworkGraphComponent`
- `SankeyDiagramComponent`
- `SharedWorkspaceComponent`
- `TimelineComponent`

### 建议新增的能力
- `CollaborationStateService`
- `CollaborationDataAdapter`
- `CollaborationEventMapper`
- `CollaborationActionService`

## 10. 页面重构步骤

### Step 1
把协作页中的散落状态迁移到统一状态服务。

### Step 2
把四个视图页签改成只从状态服务读取。

### Step 3
把 WebSocket 消息接入状态适配层。

### Step 4
把操作按钮接到动作服务。

### Step 5
逐步替换 mock 数据为真实数据。

## 11. 风险点

- 当前页面中仍有少量静态演示数据，替换时要避免影响 UI
- 事件协议如果不稳定，适配层要单独隔离
- 若真实后端接口未准备好，应保留 fallback 数据
- 模式切换与 Agent 状态变化需要统一节流，避免频繁重绘

## 12. 验收标准

- 页面不再直接依赖散落 mock 数据
- 四个视图均从统一状态层读取
- 真实事件进入后页面可更新
- 页面结构与视觉风格保持稳定
- 后续接后端时无需大改 UI
