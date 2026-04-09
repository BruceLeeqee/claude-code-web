# P0 冻结文档：ClaudeCode 工具对齐矩阵（基于 `E:\claude-code\restored-src\src\tools.ts`）

> 目标：冻结参考工具全集、明确 `zyfront-desktop` 当前实现状态（`native/degraded/missing`），作为 P1 开发基线。
> 生成时间：2026-04-09

---

## 1) 基线来源与判定口径

### 1.1 参考基线
- 来源文件：`E:\claude-code\restored-src\src\tools.ts`
- 以 `getAllBaseTools()` 中可被装配进工具池的工具为主。

### 1.2 状态定义
- **native**：已在 `zyfront` 运行时注册，且具备真实执行路径（不是空壳）。
- **degraded**：已注册，但行为为降级实现（能力/精度/安全性低于参考）。
- **missing**：未注册或无法调用。

### 1.3 依赖字段说明
- `deps`：实现该工具所需的宿主/服务能力（IPC、MCP、LSP、调度等）。
- `risk`：`low / medium / high`，用于排期与权限策略。

---

## 2) 参考工具全集（按 `getAllBaseTools()` 分组）

## A. 核心默认工具
- AgentTool
- TaskOutputTool
- BashTool
- GlobTool（若无 embedded search）
- GrepTool（若无 embedded search）
- ExitPlanModeV2Tool
- FileReadTool
- FileEditTool
- FileWriteTool
- NotebookEditTool
- WebFetchTool
- TodoWriteTool
- WebSearchTool
- TaskStopTool
- AskUserQuestionTool
- SkillTool
- EnterPlanModeTool
- BriefTool
- ListMcpResourcesTool
- ReadMcpResourceTool
- ToolSearchTool（条件）

## B. 条件工具（feature/env）
- ConfigTool
- TungstenTool
- SuggestBackgroundPRTool
- WebBrowserTool
- TaskCreateTool / TaskGetTool / TaskUpdateTool / TaskListTool
- OverflowTestTool
- CtxInspectTool
- TerminalCaptureTool
- LSPTool
- EnterWorktreeTool / ExitWorktreeTool
- SendMessageTool
- ListPeersTool
- TeamCreateTool / TeamDeleteTool
- VerifyPlanExecutionTool
- REPLTool
- WorkflowTool
- SleepTool
- CronCreateTool / CronDeleteTool / CronListTool
- RemoteTriggerTool
- MonitorTool
- SendUserFileTool
- PushNotificationTool
- SubscribePRTool
- PowerShellTool
- SnipTool
- TestingPermissionTool（test）

---

## 3) 当前 `zyfront` 已注册工具（runtime）

> 来源：`zyfront-desktop/src/app/core/zyfront-core.providers.ts` 的 `buildLocalTools()`

- `fs.list`
- `fs.read`
- `fs.write`
- `fs.delete`
- `terminal.exec`
- `memory.write_short_term`
- `memory.write_long_term`
- `memory.read`
- `memory.list`
- `memory.update`
- `memory.relate_note`
- `host.open_path`
- `tools.list`
- `files.read`
- `files.write`
- `files.edit`
- `files.glob`
- `files.grep`
- `files.search`
- `web.search`
- `tools.register`

---

## 4) 对齐矩阵（P0 冻结）

| 参考工具 | 当前映射/实现 | 状态 | executorKind | deps | risk | 备注 |
|---|---|---|---|---|---|---|
| BashTool | `terminal.exec` | native | shell | terminal IPC | medium | 语义对齐可用 |
| FileReadTool | `files.read` / `fs.read` | native | fs | fs IPC | low | 已可用 |
| FileWriteTool | `files.write` / `fs.write` | native | fs | fs IPC | medium | 已可用 |
| FileEditTool | `files.edit` | degraded | fs | fs IPC | medium | 目前为精确替换；缺结构化 patch 语义 |
| GlobTool | `files.glob` | degraded | fs | fs IPC | low | 自实现 glob，能力低于 rg/fast-glob |
| GrepTool | `files.grep` | degraded | fs | fs IPC | medium | 行扫描实现，缺 rg 高级选项 |
| WebSearchTool | `web.search` | degraded | shell/http | python + network | high | DuckDuckGo HTML 抓取，非官方搜索 API |
| WebFetchTool | 无直接实现 | missing | http/browser | web IPC/browser | high | 需新增 `window.zytrader.web.fetch` |
| NotebookEditTool | 无直接实现 | missing | notebook | notebook IPC | high | 需单元级编辑语义 |
| TodoWriteTool | 无直接实现 | missing | internal | session store | medium | 需任务状态存储 |
| AskUserQuestionTool | 无直接实现 | missing | ui-interaction | 前端交互通道 | medium | 需阻塞式选项交互 |
| EnterPlanModeTool | 无工具实现（仅UI模式） | missing | internal | coordinator API | low | 需工具化接口 |
| ExitPlanModeV2Tool | 无工具实现（仅UI模式） | missing | internal | coordinator API | low | 同上 |
| TaskStopTool | 无工具实现 | missing | internal | runtime task manager | medium | 需中断控制 |
| SkillTool | 无工具实现 | missing | internal | skills runtime | medium | 需技能执行通道 |
| BriefTool | 无工具实现 | missing | internal | summarizer | low | 可先降级为摘要模板 |
| ListMcpResourcesTool | 无工具实现 | missing | mcp | MCP client | high | 需 MCP 接入 |
| ReadMcpResourceTool | 无工具实现 | missing | mcp | MCP client | high | 同上 |
| ToolSearchTool | 无工具实现 | missing | internal/search | tool index/cache | low | 可由 `tools.list + 关键词` 近似 |
| AgentTool | 无工具实现 | missing | internal/orchestration | agent coordinator | high | 架构级能力 |
| TaskOutputTool | 无工具实现 | missing | internal | task runtime | medium | 与任务系统绑定 |
| SendMessageTool | 无工具实现 | missing | internal bus | session/channel bus | medium | 协同依赖 |
| TeamCreateTool | 无工具实现 | missing | internal | swarm/team store | medium | 协同依赖 |
| TeamDeleteTool | 无工具实现 | missing | internal | swarm/team store | medium | 协同依赖 |
| ConfigTool | 无工具实现 | missing | internal | config service | medium | 需白名单更新策略 |
| LSPTool | 无工具实现 | missing | lsp | language server | high | 需 LSP bridge |
| PowerShellTool | `terminal.exec` 部分覆盖 | degraded | shell | terminal IPC | medium | 缺专用 PS 特性 |
| WorkflowTool | 无工具实现 | missing | workflow | workflow engine | high | 需脚本工作流引擎 |
| CronCreate/Delete/List | 无工具实现 | missing | scheduler | cron service | high | 需调度服务 |
| RemoteTriggerTool | 无工具实现 | missing | trigger | webhook/queue | high | 远程依赖 |
| MonitorTool | 无工具实现 | missing | monitor | metrics/observability | high | 监控依赖 |
| WebBrowserTool | 无工具实现 | missing | browser | browser automation | high | 需浏览器上下文 |
| EnterWorktreeTool | 无工具实现 | missing | git | git/worktree mgmt | medium | 可接 terminal.exec |
| ExitWorktreeTool | 无工具实现 | missing | git | git/worktree mgmt | medium | 同上 |
| REPLTool | 无工具实现 | missing | repl | sandbox vm | high | 需安全沙箱 |
| SnipTool | 无工具实现 | missing | internal | history subsystem | low | 可后置 |
| SleepTool | 无工具实现 | missing | internal | timer | low | 简单可补 |
| CtxInspectTool | 无工具实现 | missing | internal | context engine | medium | 依赖上下文压缩模块 |
| TerminalCaptureTool | 无工具实现 | missing | terminal | terminal capture API | medium | 需终端快照接口 |
| VerifyPlanExecutionTool | 无工具实现 | missing | internal | plan verifier | medium | 条件工具 |
| SuggestBackgroundPRTool | 无工具实现 | missing | github | gh integration | high | 条件工具 |
| SendUserFileTool | 无工具实现 | missing | file-transfer | user file channel | high | 条件工具 |
| PushNotificationTool | 无工具实现 | missing | notification | push service | high | 条件工具 |
| SubscribePRTool | 无工具实现 | missing | github webhook | webhook infra | high | 条件工具 |
| ListPeersTool | 无工具实现 | missing | internal | peer discovery | medium | 条件工具 |
| OverflowTestTool | 无工具实现 | missing | test | test flag | low | 测试专用 |
| TestingPermissionTool | 无工具实现 | missing | test | test runtime | low | 测试专用 |
| TungstenTool | 无工具实现 | missing | internal | ant-only backend | high | 条件工具 |

---

## 5) P1 建议范围（从 P0 矩阵导出）

优先纳入：
1. `WebFetchTool`（补齐 web.fetch IPC）
2. `TodoWriteTool`
3. `AskUserQuestionTool`
4. `EnterPlanModeTool / ExitPlanModeV2Tool / TaskStopTool`
5. `ToolSearchTool`
6. `NotebookEditTool`（先最小单元替换）

已可用但需增强：
- `files.edit`（补 patch/上下文替换）
- `files.glob`（支持更完整 glob）
- `files.grep`（升级到 rg）
- `web.search`（从 HTML 抓取切到宿主搜索 IPC）

---

## 6) 验收门槛（P0 -> P1）

- 工具矩阵与 `getAllBaseTools()` 保持同步（覆盖率 100%）。
- P1 范围每个工具都有：
  - 统一 `name/description/inputSchema`
  - 真实 `run` 执行路径
  - 失败时结构化错误码（非泛化报错）。
- 插件页数量与 `tools.list` 数量一致（误差 0）。

---

## 7) 备注

- 本矩阵是 **P0 冻结版本**，后续新增工具或 feature flag 变更应更新本文件。
- 不建议把 `missing` 工具先注册成“空壳可见”；应以 `native/degraded` 可执行为准，避免误导模型与用户。