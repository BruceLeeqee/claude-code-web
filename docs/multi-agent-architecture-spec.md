# Multi-Agent Architecture Spec（Phase 0 冻结版）

> 基线：`claude-code/restored-src/src` 多智能体语义 + `zyfront-desktop` 当前 workbench 实现
> 目标：冻结 Zyfront 的多智能体核心架构、分层职责、模式探测与回退矩阵，作为 Phase 1~4 实施唯一参考。

---

## 1. 架构目标

1. 在 Zyfront 中复刻 ClaudeCode 多智能体核心语义：
   - mode snapshot（会话级） 模式快照
   - backend detection（auto） 后端探测程序自检
   - spawn / message / stop / kill 生命周期   启动/发消息/正常停止/强制停止
   - leader/team/teammate 身份追踪 队长/队员/小队
2. 执行后端至少覆盖：`in-process` / `tmux` / `iterm2`（能力不足时可回退）。
3. UI 必须复用现有 `workbench.page`，不新增独立“多智能体页”。

User → 发任务
Leader 收到 → 分析、拆分子任务
Leader 发消息给 Teammate
Teammate 执行命令（spawn 进程、调用工具）
Teammate 把结果发回 Leader
Leader 汇总 → 回复用户
---

## 2. 双层模式模型（冻结）

### 2.1 协作策略层（已有）
- `single`
- `plan`
- `parallel`

### 2.2 执行后端层（新增）
- 用户配置模式：`auto | in-process | tmux | iterm2`
- 实际运行后端：`in-process | tmux | iterm2`

### 2.3 会话快照规则
1. 会话启动时捕获一次 `configuredMode`。
2. 当前会话内 `effectiveMode` 只受检测/回退影响，不受设置页即时改动影响。
3. 用户改 mode 后，默认“下次会话生效”；如后续支持即时切换，需先 stop 全部 worker 并重新建队。

---

## 3. 分层与职责（冻结）

## 3.1 Domain 层（状态与规则）
- `TeammateModeSnapshotService`
  - 捕获配置模式、输出会话快照
- `TeammateRegistryService`
  - 维护 teammate 索引、状态、元数据
- `TeamContextService`
  - 维护 teamName、leadAgentId、teammates、最近事件

## 3.2 Backend 层（执行器）
- 抽象：`TeammateBackend`
- 实现：
  - `InProcessBackend`
  - `TmuxBackend`
  - `ITermBackend`
- 探测器：`BackendDetectionService`
  - 负责 auto 选择与 fallback reason 产出

## 3.3 Orchestration 层（编排）
- `MultiAgentSpawnService`
  - 处理 spawn 参数、模式决策、调用 backend
- `TeammateLifecycleService`
  - stop / kill / active 查询
- `MessageBridgeService`
  - leader ↔ teammate 消息桥
- `PermissionBridgeService`
  - worker 权限模式映射与高危动作拦截

## 3.4 Presentation 层（Workbench）
- mode 条（策略层 + 后端层）
- team 拓扑（leader + workers）
- status 卡片（running/idle/waiting/error/stopped）
- timeline（spawn/message/tool/error）

---

## 4. 数据流（冻结）

1. UI 发起 `spawnTeammate(config)`。
2. SpawnService 读取 mode snapshot。
3. 若 mode=auto：DetectionService 给出 `selectedBackend` 或 `fallback`。
4. Backend 执行 spawn，返回 identity + runtime handle。
5. Registry/TeamContext 更新状态并发布 `multiagent.teammate.spawned`。
6. Workbench 仅订阅事件并投影 VM，不自行猜测状态。

同理：message/stop/kill 都以“事件驱动单向流”同步 UI。

---

## 5. 模式探测与回退矩阵（Phase 0 冻结）
不同电脑、不同设置，最终到底怎么运行命令


| OS / 环境 | configuredMode | 检测结果 | effectiveBackend | 行为 |
|---|---|---|---|---|
| Windows | auto | tmux/iterm2 均不可用 | in-process | 自动回退并记录 reason |
| Windows | tmux | tmux 不可用 | 无 | 报错 + 引导安装（不静默回退） |
| Windows | iterm2 | iterm2 不可用 | 无 | 报错 + 引导切换 mode |
| 任意 | auto | tmux 可用 | tmux | 使用 tmux |
| macOS | auto | iterm2 可用且优先 | iterm2 | 使用 iterm2 |
| 任意 | in-process | 始终可用 | in-process | 直接使用 |

补充规则：
- 仅 `auto` 允许静默回退到 in-process。
- 显式模式（tmux/iterm2）失败必须向用户暴露错误，不自动改配置。

Windows 环境：
- 不支持 iterm2（Mac 专属）
- 不支持 tmux（原生 Windows 无）
- 也没有单独适配 Windows Terminal / PowerShell

所以：
- 你选 auto → 自动 fallback 到 in-process
- 你强行选 tmux / iterm2 → 直接报错

---

## 6. 状态模型约束

1. teammate 状态机（最小）：`starting -> running -> idle -> stopping -> stopped | error`
2. 每个 teammate 必须具备 identity：
   - `agentId`、`agentName`、`teamName`、`color`
   - `model`、`cwd`、`planModeRequired`
3. 所有状态变更必须附带 `timestamp` 与 `source`（backend/system/user）。

---

## 7. Workbench 集成边界

1. 本阶段不改视觉大布局，仅增加可插拔区域数据源。
2. Workbench 读取 `WorkbenchTeamVm` + `WorkbenchTeammateVm`，不直接读取 backend 内部对象。
3. Timeline 使用统一事件 contract（见 `docs/multi-agent-event-contract.md`）。

---

## 8. Phase 1 准入条件（由 Phase 0 产物保证）

1. 类型文件冻结（`multi-agent.types.ts`）
2. 事件协议冻结（`multi-agent.events.ts` + 文档）
3. 回退矩阵已落文档并获确认
4. Workbench VM 结构冻结（仅可增字段，不改已发布字段语义）

---

文档版本：v1.0-phase0
更新日期：2026-04-14
