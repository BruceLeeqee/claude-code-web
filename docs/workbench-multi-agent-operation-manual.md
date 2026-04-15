# Workbench 多智能体页面操作手册（当前实现版）

> 适用范围：`zyfront-desktop` 当前已实现的 Workbench / Collaboration 多智能体功能。
> 文档目的：给产品、测试、实施人员快速上手当前交互与能力边界。

---

## 1. 页面入口

- Workbench：路由 `workbench`
- Collaboration：路由 `prototype/collaboration`

两页都接入了同一条 `multiAgent.events$` 事件流，时间线语义一致。

---

## 2. Workbench 操作说明

## 2.1 右侧多智能体面板（基础控制）

位置：Workbench 右侧「多智能体（Phase 1）」区。

可执行操作：
- 切换后端模式：`auto / in-process / tmux / iterm2`
- Spawn teammate（输入名称 + 首条指令）
- 对列表中的 agent 执行：
  - `Stop`（优雅停止）
  - `Kill`（强制终止）

状态观察：
- 统计项：总数、运行、停止、错误
- 模式信息：`mode=... · backend=...`
- 事件时间线：显示最近多智能体事件

---

## 2.2 Tab 右键菜单（新增）

位置：中间编辑区 Tab 栏，对任意 Tab 右键。

菜单项：
- `新建 Agent Tab`
- `关闭`
- `关闭其他`
- `关闭左侧`
- `关闭右侧`
- 当目标是 Agent Tab 时额外显示：
  - `关闭并 Stop Agent`
  - `关闭并 Kill Agent`

关键行为：
- `新建 Agent Tab` 会直接触发 `spawnTeammate`，并打开一个新 Agent Tab。
- 关闭 Agent Tab 时可选择仅关 Tab，或同时 Stop/Kill 对应 agent。

---

## 2.3 Agent Tab（独立会话窗口）

每个 Agent Tab 绑定一个 `agentId`，并提供独立会话视图：

顶部快捷按钮：
- `聚焦`：将右侧列表聚焦到当前 agent
- `Stop`
- `Kill`

会话区：
- 展示该 agent 的消息历史（role：`user / leader / teammate / system`）
- 输入框发送消息到该 agent（回车或点击发送）

事件区：
- 展示该 agent 的事件时间线（按 agentId 投影）

---

## 2.4 Agent 会话历史持久化

当前实现将所有 agent 会话按 `agentId` 分区写入同一 Vault 文件：

- `02-AGENT-MEMORY/01-Short-Term/workbench-agent-sessions.v1.json`

行为说明：
- 页面初始化时自动读取并恢复
- 会话更新（发消息/事件写入）后自动持久化

---

## 3. Collaboration 操作说明

## 3.1 页面能力

可执行操作：
- 后端模式切换：`auto / in-process / tmux / iterm2`
- 添加新 agent
- 对单卡片 agent：
  - `停止`
  - `推进`
  - `Workbench 聚焦`（跳转并聚焦指定 agent）

---

## 3.2 与 Workbench 联动

`Workbench 聚焦` 按钮会携带 agentId 跳转到 Workbench：
- Workbench 接收参数后自动展开右侧面板并高亮目标 agent

---

## 4. 阻断（blocking）与 setup 提示

当显式选择的后端不可用（例如环境不满足 tmux/iTerm2 要求）时：

- 页面会显示 blocking banner
- 显示不可用原因（fallbackReason）
- 显示 setup 提示（setupHints）
- Spawn/新增操作会被阻断

`auto` 模式下会尽量回退到 `in-process`，并记录 fallback 事件。

---

## 5. 时间线事件说明（两页通用）

常见事件：
- `multiagent.mode.captured`
- `multiagent.backend.detected`
- `multiagent.backend.fallback`
- `multiagent.teammate.spawned`
- `multiagent.teammate.message`
- `multiagent.teammate.stopped`
- `multiagent.teammate.killed`
- `multiagent.error`

补充：
- `multiagent.error` 若包含 `setupHints`，时间线文案会显示 hints 数量。

---

## 6. 当前能力边界（重要）

- `in-process` 主链路可用：spawn/message/stop/kill
- `tmux / iterm2` 处于持续完善阶段：
  - 检测、阻断、提示已接入
  - 执行链仍在持续打磨（尤其 iTerm2）
- Agent Tab 已具备“独立会话视图 + 消息发送 + 会话持久化（按 agentId 分区）”
- 更完整的恢复治理、权限策略、回归体系仍在后续阶段（见 `docs/multi-agent-full-replication-plan.md`）

---

## 7. 建议测试顺序

1. 在 Workbench 用 `in-process` 创建 2~3 个 agent，验证 Stop/Kill 与时间线
2. 右键 Tab 新建 Agent Tab，验证“关闭并 Stop/Kill”动作
3. 在 Agent Tab 发消息，刷新页面后确认会话恢复
4. 在 Collaboration 点击 “Workbench 聚焦”，验证跨页联动
5. 切换 `tmux/iterm2` 到不可用环境，验证 blocking 与 setup hints

