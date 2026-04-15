# 多智能体能力完全复刻实施计划（ClaudeCode → Zyfront Desktop）

> 目标：参考 `E:\AGENT-ROOT\04-PROJECTS\claude-code\restored-src\src` 的多智能体实现，在 `zyfront-desktop` 中**完整复刻**多智能体能力；
> 要求：至少覆盖 3 种多智能体模式，并将分屏可视化落在当前协作页（`workbench.page`）而非新建独立页面。

## 当前进展快照（2026-04-14）

- 已完成：`multi-agent` 类型与事件契约落地（`multi-agent.types.ts` / `multi-agent.events.ts`）。
- 已完成：`MultiAgentOrchestratorService` + `InProcessBackend` 基础闭环（spawn/message/stop）。
- 已完成：`workbench.page` 接入多智能体状态、模式切换、基础操作与事件时间线。
- 已完成：`collaboration.page` 接入共享 `events$` 时间线，并与 workbench 共享格式化逻辑。
- 已完成：Collaboration -> Workbench 跳转并聚焦指定 agent（`focusAgent` query）。
- 进行中（Phase 2 起步）：tmux/iTerm2 能力检测、显式 blocking、UI 阻断提示与 `setupHints` 指引。
- 未开始：真实 tmux/iTerm2 pane 执行链（create pane / send command / kill pane）。

---

## 1. 范围与复刻标准

## 1.1 复刻范围（In Scope）

1. **多智能体运行模式（3+）**
   - `in-process`：同进程子智能体
   - `tmux`：外部 pane 后端
   - `iterm2`：原生 iTerm2 pane 后端（Windows 端可先做兼容占位，能力探测后降级）
   - 同步保留 `auto` 选择策略（自动选后端并可回落）

2. **多智能体基础能力**
   - 团队创建/删除、成员加入/退出
   - 子智能体 spawn/stop/kill
   - 主从消息路由（leader ↔ teammate）
   - teammate 上下文与身份追踪（agentId、teamName、color、model、cwd、planModeRequired）

3. **分屏可视化（使用现有协作页）**
   - 基于 `workbench.page.html/.ts/.scss` 扩展：
     - 中央区域保留主终端 + 编辑器
     - 右侧协作区升级为「团队拓扑 + 子智能体状态 + 消息流 + 任务态」
     - 支持“逻辑分屏”（UI 面板）与“终端分屏映射状态”（tmux/iterm2）

4. **模式切换与快照机制**
   - 会话启动快照：会话期间配置变更不影响当前运行模式
   - 显式切换：支持手动改 mode 并在下一会话生效（或定义即时生效策略）

5. **可靠性与治理**
   - 权限桥接（leader/worker）
   - 失败回退（pane backend 不可用 → in-process）
   - 生命周期可观测（任务、日志、事件）

---

## 1.2 非目标（Out of Scope，第一阶段）

- 复刻 ClaudeCode 所有 CLI/TUI 交互细节（仅复刻多智能体核心能力）
- 一次性补齐所有跨平台终端特性（先 Windows 优先，macOS/Linux 按能力开关）
- 完全一致的视觉样式（优先能力一致与状态一致）

---

## 1.3 完全复刻判定标准（Definition of Done）

满足以下条件视为“多智能体已完成复刻”：

1. 3 种模式可被明确选择并稳定运行（或自动回退可解释）；
2. `spawn / message / stop / kill / status` 全链路可用；
3. 协作页可视化可反映真实运行态（非静态 mock）；
4. 模式探测、回退、权限、异常处理有日志与 UI 反馈；
5. 通过回归用例（模式、并发、异常、恢复）≥ 95%。

---

## 2. 参考源码对齐基线（ClaudeCode）

关键参考模块（以语义复刻为目标）：

- 多智能体生成入口：`src/tools/shared/spawnMultiAgent.ts`
- 模式快照：`src/utils/swarm/backends/teammateModeSnapshot.ts`
- 后端类型与抽象：`src/utils/swarm/backends/types.ts`
- 运行初始化：`src/hooks/useSwarmInitialization.ts`
- 相关补充（后续实现需跟进）：
  - `utils/swarm/backends/*`
  - `utils/swarm/teammateLayoutManager.ts`
  - `utils/swarm/reconnection.ts`
  - `tasks/InProcessTeammateTask/*`

对齐原则：
- **先抽象，再接入**：先在 Zyfront 建立统一 TeammateBackend/Executor 接口，再按模式落实现。
- **语义优先**：保持“模式选择、spawn 生命周期、回退策略、状态投影”一致。

---

## 3. 现状评估（Zyfront Desktop）

基于当前 `workbench.page.ts/html` 可复用基础：

1. 已有协调模式状态：`single | plan | parallel`（任务拆解层）
2. 已有右侧协作区（任务、记忆、进度）
3. 已有主终端 + 底部 PowerShell + Monaco 编辑能力
4. 已有 runtime/facade 结构，可承接多智能体服务注入

结论：
- 当前“协调模式”是**工作流层模式**，不是“多智能体执行后端模式”；
- 可采用“双层模式模型”：
  - 上层：协作策略（single/plan/parallel）
  - 下层：执行后端（auto/in-process/tmux/iterm2）

---

## 4. 目标架构设计

## 4.1 双层模式模型

### A. 协作策略层（已有）
- `single`: 单代理
- `plan`: 计划驱动
- `parallel`: 并行任务

### B. 执行后端层（新增，复刻 ClaudeCode）
- `auto`: 自动探测并选择
- `in-process`: 进程内执行
- `tmux`: pane 后端
- `iterm2`: iTerm2 后端（Windows 下默认禁用/降级）

---

## 4.2 核心模块分层

1. **Domain 层**
   - `TeammateModeSnapshotService`
   - `TeammateRegistryService`
   - `TeamContextService`

2. **Backend 层**
   - `TeammateBackend` 接口
   - `InProcessBackend`
   - `TmuxBackend`
   - `ITermBackend`
   - `BackendDetectionService`

3. **Orchestration 层**
   - `MultiAgentSpawnService`
   - `TeammateLifecycleService`
   - `MessageBridgeService`
   - `PermissionBridgeService`

4. **Presentation 层（Workbench）**
   - 团队面板（成员、状态、颜色、模型、cwd）
   - 消息流面板（leader↔teammate）
   - 任务流面板（spawn、执行、完成、失败）
   - 后端状态条（mode、fallback、backend health）

---

## 5. 分阶段实施计划

## Phase 0：设计冻结与映射（2-3 天）

目标：形成唯一实施蓝图，冻结类型与事件协议。

任务：
1. 输出类型定义：
   - `BackendType`, `TeammateIdentity`, `TeammateSpawnConfig`, `TeammateSpawnResult`
2. 输出事件协议：
   - `teammate.spawned / stopped / failed / message / state.changed`
3. 输出 UI 状态模型：
   - `WorkbenchTeammateVm`, `WorkbenchTeamVm`
4. 输出回退矩阵：
   - auto 在不同 OS/环境下的判定与 fallback

交付：
- `docs/multi-agent-architecture-spec.md`
- `docs/multi-agent-event-contract.md`

---

## Phase 1：后端抽象与 in-process 落地（4-6 天）

目标：先打通最稳定路径（in-process），确保功能闭环。

任务（状态化）：
1. `TeammateBackend` 抽象与注册器
   - [x] `TeammateBackend` 接口（spawn/sendMessage/terminate/kill/isActive）
   - [ ] backend registry（当前由 orchestrator 内部解析，待抽离）
2. `InProcessBackend`
   - [x] spawn
   - [x] sendMessage
   - [x] terminate
   - [ ] kill（接口存在，语义需补全到统一生命周期）
   - [ ] isActive（对真实 runtime 活跃态探测待补齐）
3. 模式快照
   - [x] 会话启动模式捕获（`captureModeIfNeeded`）
   - [ ] 独立 `TeammateModeSnapshotService`（当前能力已在 session/orchestrator 内，后续可抽离）
4. `workbench.page.ts` 接线
   - [x] teammates 列表
   - [x] 基础消息流/事件时间线
   - [x] mode 切换与 spawn/stop 操作
   - [ ] send instruction / kill UI 入口细化

验收：
- [x] in-process 主链路可运行（spawn/message/stop）。
- [ ] 并发 3 agent 稳定性压测记录。

---

## Phase 2：tmux/iterm2 后端 + auto 探测（5-8 天）

目标：复刻 pane 模式与自动回退策略。

任务（状态化）：
1. 能力探测（Backend Detection）
   - [x] 检测 tmux/iTerm2 可用性（平台 + 关键环境变量）
   - [x] 输出 `needsSetup` / `isNative` / `fallbackReason`
   - [x] 输出 `blocking` 与 `setupHints`（用于 UI 显式提示）
2. `TmuxBackend`
   - [ ] create pane
   - [ ] send command
   - [ ] kill pane
   - [ ] title / border（可延后）
3. `ITermBackend`
   - [ ] 能力探测（深度）与最小可用执行链
4. `auto` 模式
   - [x] 不可用时落回 in-process（可解释 fallback）
   - [~] fallback telemetry：事件层已接入，指标聚合待补
5. 显式阻断策略（新增明确要求）
   - [x] 显式 `tmux|iterm2` 在不可用时阻断 spawn（不静默改 mode）
   - [x] Workbench/Collaboration UI 展示阻断原因与 setup 指引

验收：
- [x] `auto` 在不可用环境可回退到 in-process，且 UI 有明确提示。
- [ ] tmux/iTerm2 真实 pane 执行链验证通过（本阶段后半段）。

---

## Phase 3：协作页分屏可视化升级（4-6 天）

目标：在现有协作页中完成多智能体可视化，不新开页面。

任务：
1. 右侧面板升级：
   - 团队拓扑树（leader + workers）
   - worker 状态徽标（running/idle/waiting/error/stopped）
2. 中央区增强：
   - 可选“多会话子终端卡片视图”（逻辑分屏）
3. 消息流与任务流：
   - 时间线展示工具调用与消息摘要
4. 操作入口：
   - spawn teammate
   - send instruction
   - stop/kill
   - 切换 backend mode

### Phase 3-A：Workbench Tab 右键菜单 + “Tab = Agent” 独立会话（对齐 ClaudeCode）

背景：
- ClaudeCode 的多智能体语义是 leader + 多个 teammate；**每个 teammate 必须拥有独立的会话历史与上下文**，leader 负责协调与路由。
- 因此在 Workbench UI 上采用 “一个 Tab = 一个独立 Agent（独立记忆/会话历史）” 的容器模型，语义上是合理且贴近 ClaudeCode 的。

目标（本子阶段）：
- 在 Workbench 的 tab 上提供右键菜单：
  - 新建 Agent Tab
  - 关闭 Tab
  -（可选）关闭其他 / 关闭右侧
  -（仅 agent tab）关闭并 stop / 关闭并 kill
- 每个 Agent Tab 对应一个独立 agentId，并具备：
  - 独立会话历史（messages / turns）
  - 独立记忆（至少短期记忆与会话回放隔离；可逐步演进到独立 memory index）
  - 独立 streaming 状态（输出中/取消/中断互不影响）

非目标（本子阶段不做）：
- 不要求先完成 tmux/iTerm2 的完整 pane 执行（Phase 2 后半段继续）
- 不要求每个 agent tab 都绑定真实 PTY（可先以“对话视图/逻辑终端”承载）
- 不做复杂权限治理/恢复（留到 Phase 4）

设计要点（对齐 ClaudeCode 的“隔离/共享”边界）：
- 共享：
  - workspace/vault、工具能力、后端检测与 fallback 策略、事件总线与时间线展示
- 隔离：
  - 每个 agent 的 messages/会话回放、短期记忆、工具调用轨迹、streaming 状态机

实现步骤（建议按优先级）：
1. Tab 右键菜单（UI）：
   - 复用现有 tab context menu 逻辑，新增 “新建 Agent / 关闭”
2. 新建 Agent Tab（Domain + UI）：
   - 右键 → 新建 Agent → 调用 orchestrator `spawnTeammate(...)` → 创建新 tab 并绑定 agentId
3. 会话历史隔离（MVP）：
   - 引入 `AgentSessionState`（按 agentId 分区）存 messages/tool trace/streaming 状态
4. 记忆隔离（MVP 落盘）：
   - 将各 agent 的 history/short-term memory 独立落盘到 vault 子目录（按 agentId 分区）
5. 关闭策略：
   - 默认关闭仅关闭 UI（agent 继续运行），并提供“关闭并 stop/kill”显式动作，避免误杀与资源泄露

验收（本子阶段）：
- 可同时打开 3 个 Agent tab；切换 tab 不互相污染历史/输出
- stop/kill 仅作用于当前 tab 的 agentId
- events$ 时间线可通过 agentId 关联到正确 tab（至少可聚焦/过滤）

验收：
- 10 分钟连续运行中，UI 状态与真实后端状态一致率 ≥ 99%。

---

## Phase 4：治理、权限、恢复、回归（3-5 天）

目标：可上线、可维护。

任务：
1. 权限桥接：高危动作确认、worker 权限继承策略
2. 异常恢复：
   - 会话恢复（resume）
   - 失联 worker 标记与重连
3. 可观测性：
   - 关键事件日志
   - 性能计时（spawn latency / message latency）
4. 测试：
   - 单测、集成、E2E、压力

验收：
- 全回归通过，主路径无 blocker。

---

## 6. 协作页（Workbench）改造清单

## 6.1 `workbench.page.ts`

新增（建议）：
- `teammateBackendMode`（auto/in-process/tmux/iterm2）
- `teammateBackendHealth`
- `teamContextVm`
- `teammateCards`
- `teammateEventTimeline`

新增（Phase 3-A：Tab=Agent）：
- `workbenchTabs`（增强为结构化 tab：main/file/agent）
- `agentSessionsById`：`Map<agentId, AgentSessionState>`
- `activeAgentTabId` / `activeAgentId`（由 active tab 推导）

新增方法：
- `spawnTeammate()`
- `sendTeammateMessage()`
- `stopTeammate()` / `killTeammate()`
- `switchTeammateMode()`

新增方法（Phase 3-A）：
- `createAgentTab()`（右键菜单入口）
- `closeTab()` / `closeOtherTabs()` / `closeTabsToRight()`（复用现有但区分 agent tab）
- `closeTabAndStopAgent()` / `closeTabAndKillAgent()`（仅 agent tab）

## 6.2 `workbench.page.html`

新增区域（在右侧现有“任务拆解”基础上扩展）：
- 模式条（策略层 + 后端层）
- 团队面板（列表/树）
- 事件时间线（消息/工具/异常）
- 快速操作（spawn/stop/message）

新增交互（Phase 3-A）：
- Tab 右键菜单：新建 Agent / 关闭 /（可选）关闭其他/右侧
- agent tab 的未读标记（可选）：streaming 或新消息时高亮

## 6.3 `workbench.page.scss`

新增样式：
- teammate card（颜色继承 agent color）
- 状态 tag（running/idle/error）
- timeline（可折叠）
- Tab 右键菜单（如需独立样式）

---

## 7. 数据与协议设计（最小集合）

## 7.1 关键类型

- `TeammateMode = 'auto' | 'tmux' | 'iterm2' | 'in-process'`
- `BackendType = 'tmux' | 'iterm2' | 'in-process'`
- `TeammateIdentity`
- `TeammateSpawnConfig`
- `TeammateSpawnResult`
- `TeammateMessage`

## 7.2 关键事件

- `multiagent.mode.captured`
- `multiagent.backend.detected`
- `multiagent.backend.fallback`
- `multiagent.teammate.spawned`
- `multiagent.teammate.stopped`
- `multiagent.teammate.killed`
- `multiagent.teammate.message`
- `multiagent.error`

---

## 8. 风险与缓解

1. **平台差异（Windows 无 iTerm2/tmux）**
   - 缓解：auto + in-process 强保障；tmux/iterm2 按能力启用。

2. **状态不一致（UI 与后端脱节）**
   - 缓解：事件驱动单向数据流，禁止 UI 本地猜测状态。

3. **多 worker 并发导致性能抖动**
   - 缓解：限制默认并发数，提供背压与队列。

4. **权限风险（worker 误执行）**
   - 缓解：worker 权限模板 + 高危操作二次确认。

---

## 9. 测试计划

1. **单元测试**
   - mode snapshot
   - backend detection
   - spawn config 校验

2. **集成测试**
   - in-process 全链路
   - auto fallback
   - 消息桥接

3. **E2E 测试（Workbench）**
   - UI spawn/stop/message 操作
   - 状态实时刷新
   - 异常提示可见

4. **压力测试**
   - 5~10 worker 并发 15 分钟稳定性

---

## 10. 里程碑与排期（建议）

- M1（第 3 天）：Phase 0 完成（设计冻结）
- M2（第 9 天）：Phase 1 完成（in-process 可用）
- M3（第 17 天）：Phase 2 完成（tmux/iterm2/auto）
- M4（第 23 天）：Phase 3 完成（协作页可视化）
- M5（第 28 天）：Phase 4 完成（治理+回归）

---

## 11. 下一批执行项（按优先级）

1. 完成 `TmuxBackend` 最小执行链（create/send/kill），打通真实 pane；
2. 完成 `ITermBackend` 最小执行链（先能力探测 + 最小命令注入）；
3. 抽离 `BackendDetectionService` 与 backend registry，降低 orchestrator 职责耦合；
4. 增加 `kill` 与 `send instruction` 的 Workbench 显式入口；
5. 补齐 telemetry 聚合（fallback 计数、spawn latency、message latency）；
6. 增加并发稳定性与回归测试（3~10 agents）。

---

## 12. 验收清单（Checklist）

- [ ] 3 种多智能体后端模式已实现并可切换（当前：in-process 完成；tmux/iterm2 执行链未完成）
- [x] auto 探测与回退可观测（事件 + UI 提示）
- [ ] spawn/message/stop/kill 全链路通过（当前 kill 未完成）
- [x] 协作页可视化显示真实运行态（Workbench + Collaboration 已接入 runtime 事件）
- [x] 错误场景（后端不可用/worker 崩溃）有明确提示（blocking + setupHints）
- [ ] 回归测试通过率 ≥ 95%

---

文档版本：v1.1  
创建日期：2026-04-14  
更新日期：2026-04-14  
基线参考：`claude-code/restored-src/src` + `zyfront-desktop/src/app/features/prototype/workbench/*`
