# ClaudeCode 工具全量可用化实施计划（基于 `E:\claude-code\restored-src\src`）

> 目标：以参考源码 `src/tools.ts` 为基线，把「插件管理页展示的工具」升级为**真实可执行**，并建立可持续的注册、同步、验收机制。  
> 范围：`zyfront-desktop`（Electron + Angular + zyfront-core runtime）。

---

## 1. 基线与差距

## 1.1 参考源码工具池（来源：`src/tools.ts`）

按基础工具与条件工具分层：

### A. 核心基础工具（默认能力）
- AgentTool
- BashTool
- FileReadTool
- FileEditTool
- FileWriteTool
- GlobTool
- GrepTool
- NotebookEditTool
- WebFetchTool
- WebSearchTool
- TodoWriteTool
- AskUserQuestionTool
- EnterPlanModeTool
- ExitPlanModeV2Tool
- TaskStopTool
- SkillTool
- BriefTool
- ListMcpResourcesTool
- ReadMcpResourceTool
- ToolSearchTool（条件启用）

### B. 任务/协同族（条件开关）
- TaskCreateTool / TaskGetTool / TaskUpdateTool / TaskListTool
- SendMessageTool
- TeamCreateTool / TeamDeleteTool
- ConfigTool
- TungstenTool
- VerifyPlanExecutionTool

### C. 运行环境扩展族（feature/env 驱动）
- PowerShellTool
- WorkflowTool
- CronCreate/CronDelete/CronList
- RemoteTriggerTool
- MonitorTool
- WebBrowserTool
- TerminalCaptureTool
- CtxInspectTool
- SnipTool
- SleepTool
- OverflowTestTool
- SendUserFileTool / PushNotificationTool / SubscribePRTool
- REPLTool（以及 REPL_ONLY_TOOLS）
- LSPTool

---

## 1.2 当前项目（zyfront）现状摘要

已具备：
- 运行时注册体系：`ToolSystem + buildLocalTools()`
- 本地执行基础：`window.zytrader.fs.* / terminal.exec / host.openPath`
- 动态注册入口：`tools.register`
- 列表同步：`tools.list + PrototypeCoreFacade.syncToolsFromRuntime()`

缺口：
1. 工具名与 ClaudeCode 对齐度不够（目前有别名/简化版）。
2. 多数高级工具缺“可执行后端”（仅元信息或降级执行）。
3. feature flag 与权限模型缺失（无法像参考源码按上下文启停）。
4. 插件页展示与“真实可调用能力”尚未形成强约束验证。

---

## 2. 总体实施策略

采用“三层落地”避免一次性大爆炸：

1. **兼容层（Tool Alias Layer）**：先对齐工具命名与 schema，保证模型能“识别并路由”。
2. **执行层（Executor Layer）**：逐个工具接入可执行 backend（fs/shell/http/mcp/lsp/pty）。
3. **治理层（Policy & Validation Layer）**：权限、feature、健康检查、回归测试闭环。

---

## 3. 分阶段计划

## 阶段 P0（1-2 天）：工具清单冻结与分组映射

### 目标
形成“参考工具 -> 当前实现策略”的唯一真相表。

### 任务
- 从 `restored-src/src/tools.ts` 导出工具全集（含条件工具）。
- 生成映射矩阵字段：
  - `toolName`
  - `sourceGroup`（core/task/env）
  - `status`（native/degraded/missing）
  - `executorKind`
  - `dependencies`
  - `risk`
- 明确首批上线范围（建议优先 core + task 基础）。

### 交付物
- `docs/claudecode-tool-parity-matrix.md`

### 验收
- 工具矩阵覆盖率 100%（相对 `getAllBaseTools()`）

---

## 阶段 P1（3-5 天）：核心工具 1:1 可执行化（高优先）

### 目标
把插件页中的常用工具全部变成“真实可调用 + 可验证结果”。

### 工具范围（首批）
- 文件族：`Read/Write/Edit/Glob/Grep`
- 终端族：`Bash/Shell/PowerShell(alias)`
- 网络族：`WebSearch/WebFetch`
- 计划族：`TodoWrite`
- 提问族：`AskQuestion`
- 笔记本族：`EditNotebook`
- 基础控制：`EnterPlanMode/ExitPlanMode/TaskStop`

### 任务
1. 为每个工具定义统一注册规范：
   - `name`
   - `description`
   - `inputSchema`
   - `run()` 真实执行路径
2. 统一 executor 适配：
   - `fs.read|write|edit|glob|grep`
   - `terminal.exec`
   - `http.fetch/search`（如 host 无接口则 shell 降级）
3. 修复 Web 工具“不可用”问题：
   - 优先方案：新增 `window.zytrader.web.search/fetch` IPC
   - 过渡方案：标记 degraded 并返回结构化原因
4. 插件管理页显示“可用性状态”：
   - `native`（可执行）
   - `degraded`（降级）
   - `missing`（未实现）

### 交付物
- `zyfront-core.providers.ts` 完整工具注册
- 插件页工具状态标签 + 详情

### 验收
- 首批工具调用成功率 >= 95%
- `tools.list` 与插件页数量一致（误差 0）

---

## 阶段 P2（4-7 天）：任务协同工具族落地

### 目标
实现参考源码中的 task/team/message 核心协同能力。

### 工具范围
- `TaskCreate/TaskGet/TaskUpdate/TaskList`
- `SendMessage`
- `TeamCreate/TeamDelete`
- `Config`

### 任务
- 建立任务存储（建议先本地 JSON/SQLite）。
- 建立团队与消息的最小实现（本地事件总线 + 会话路由）。
- 统一返回结构，兼容参考工具风格。

### 验收
- 任务 CRUD 全链路可用
- Team + SendMessage 可在单机多会话模拟成功

---

## 阶段 P3（5-10 天）：高级环境工具族（条件启用）

### 目标
按 feature flag 逐步补齐 LSP/MCP/Workflow/REPL 等高依赖工具。

### 工具范围
- `LSPTool`
- `ListMcpResources/ReadMcpResource`
- `WorkflowTool`
- `PowerShellTool`（增强）
- `WebBrowserTool`（若支持浏览器上下文）
- `Cron*/RemoteTrigger/Monitor`

### 依赖前置
- LSP 服务可用
- MCP client 接入
- 调度器（cron）
- 权限与沙箱策略

### 验收
- 条件工具在开关开启时可注册并可调用
- 开关关闭时不进入可用列表

---

## 阶段 P4（2-3 天）：治理、权限、测试与发布

### 目标
形成稳定可维护的工具平台，而非一次性拼装。

### 任务
1. 权限体系
   - 工具级 allow/deny
   - 高危命令二次确认
2. 健康检查
   - 启动时执行 `tool health checks`
3. 自动化测试
   - schema 校验测试
   - 执行器集成测试
   - 回归测试（工具数量、可见性、调用成功率）
4. 文档
   - 工具开发规范
   - executor 扩展指南

### 验收
- 构建通过
- 核心 E2E 用例通过
- 发布说明包含工具变更清单

---

## 4. 技术设计要点

## 4.1 工具注册模型（建议）
```ts
interface RuntimeToolSpec {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  enabledByDefault: boolean;
  featureFlag?: string;
  executor: {
    kind: 'fs' | 'shell' | 'http' | 'mcp' | 'lsp' | 'workflow' | 'internal';
    config: Record<string, unknown>;
  };
  capability: 'native' | 'degraded';
}
```

## 4.2 动态注册来源统一
- 手动创建工具（UI）
- 模型通过 `tools.register`
- 启动时静态内置

三者统一写入 runtime registry，并同步到 facade 展示。

## 4.3 可观测性
每次工具调用记录：
- toolName
- inputDigest
- duration
- success/fail
- errorType

用于插件页“工具健康度”面板。

---

## 5. 风险与应对

1. **参考源码依赖 Bun/内部模块**
   - 应对：不直接搬源码，做语义等价实现。

2. **Web/MCP/LSP 依赖宿主能力**
   - 应对：先实现 native IPC；无能力时明确 degraded 而非假可用。

3. **安全风险（shell/文件写入）**
   - 应对：路径白名单、命令黑名单、确认机制、审计日志。

4. **工具爆炸导致模型选择混乱**
   - 应对：工具分层与 feature gate，默认仅启用稳定工具。

---

## 6. 里程碑与排期（建议）

- M1（第 2 天）：P0 完成，矩阵与范围冻结
- M2（第 7 天）：P1 完成，核心工具可执行
- M3（第 14 天）：P2 完成，任务协同可用
- M4（第 24 天）：P3 完成，高级工具条件可用
- M5（第 27 天）：P4 完成，发布就绪

---

## 7. 验收标准（最终）

1. 插件管理页显示工具 = runtime registry 工具（数量一致）
2. `tools.list` 返回全部可用工具，且每项可执行状态明确
3. 目标工具（P1/P2 范围）调用成功率 >= 95%
4. 对“不可原生实现”的工具有结构化降级说明
5. 文档、测试、权限策略齐备

---

## 8. 本次建议立即执行项（Next Actions）

1. 先落地 `claudecode-tool-parity-matrix.md`（把每个参考工具标注 native/degraded/missing）
2. 把 P1 工具注册改造成统一 `RuntimeToolSpec` 驱动
3. 先打通 `WebSearch/WebFetch` 宿主 IPC（避免长期 degraded）
4. 增加 `/tools:doctor`（输出工具总数、可执行数、降级数、失败原因）

---

文档生成时间：2026-04-09  
参考基线：`E:\claude-code\restored-src\src\tools.ts`
