# `/debug` 命令与调试 Tab 设计文档

> 目标：为 `zyfront-desktop` 新增统一的 `/debug` 调试入口，通过“命令路由 + 独立调试 Tab + 专用报告服务”展示 `prompt` / `memory` / `workbench` 三类诊断信息。
>
> Tab 命名规则采用 `/` 分隔，例如：`Debug / Prompt`、`Debug / Memory`、`Debug / Workbench`。

---

## 1. 背景与目标

当前系统已经具备：

- Prompt 构建链路
- Memory pipeline / dream / telemetry
- Workbench 终端展示与思考块状态机
- 命令路由与执行分层

但这些调试信息仍然分散在：

- 终端临时输出
- 页面级状态
- 调试服务快照
- 业务日志

导致的问题是：

1. 调试信息不集中。
2. 主终端容易被 debug 内容污染。
3. 不同调试域之间缺少统一入口。
4. 无法快速切换到“只读、可验证、可复用”的诊断视图。

本设计目标是把调试能力收敛成一个统一的 `/debug` 命令体系，并将结果展示到独立的调试 Tab 中。

---

## 2. 设计原则

### 2.1 统一入口

所有调试都从 `/debug` 进入，不再散落成多个顶层命令。

### 2.2 子域分流

`/debug` 后面通过子参数区分诊断域：

- `prompt`
- `memory`
- `workbench`

### 2.3 默认只读

`/debug` 默认只展示，不修改系统状态。

若需要触发动作，必须显式加子命令，例如：

- `/debug memory run`
- `/debug prompt rebuild`
- `/debug workbench restore`

### 2.4 Tab 命名必须可读

统一采用 `/` 分隔的可视化标签：

- `Debug / Prompt`
- `Debug / Memory`
- `Debug / Workbench`

这样既符合“命令路径”的层级感，也方便用户快速定位。

### 2.5 报告必须可验证

每个调试 Tab 都必须给出：

- 数据来源
- 生成时间
- 核心状态摘要
- 关键判定结果
- 可复现的验证项

---

## 3. 命令语义设计

### 3.1 顶层命令

```text
/debug <domain> [action] [args...]
```

### 3.2 支持的 domain

#### `/debug prompt`
用于查看 prompt 构建、上下文裁剪、token/char 预算、记忆层拼装结果。

#### `/debug memory`
用于查看记忆 pipeline、extract/session/dream 状态、telemetry、状态文件、锁文件、失败原因。

#### `/debug workbench`
用于查看终端宿主、思考块状态机、锚点、回放、恢复状态、展示调试报告。

### 3.3 推荐子命令

#### prompt 域
- `/debug prompt`
- `/debug prompt latest`
- `/debug prompt rebuild`

#### memory 域
- `/debug memory`
- `/debug memory pipeline`
- `/debug memory dream`
- `/debug memory sync`
- `/debug memory run`

#### workbench 域
- `/debug workbench`
- `/debug workbench thinking`
- `/debug workbench replay`
- `/debug workbench restore`
- `/debug workbench context`

---

## 4. Tab 设计

### 4.1 命名规则

调试 Tab 命名使用统一格式：

```text
Debug / <Domain>
```

例如：

- `Debug / Prompt`
- `Debug / Memory`
- `Debug / Workbench`

### 4.2 Tab 行为

每个调试 Tab 都应满足：

1. 打开后显示最近一次或当前会话的诊断信息。
2. 支持刷新。
3. 支持固定当前会话 ID。
4. 默认只读，不直接执行副作用。
5. 可在主终端之外独立查看。

### 4.3 建议 UI 结构

每个 Tab 统一采用三段式布局：

- **Header**：标题、会话 ID、生成时间、刷新按钮
- **Body**：分块报告内容
- **Footer**：验证结果、错误摘要、最近动作

---

## 5. 各域报告内容设计

## 5.1 `Debug / Prompt`

### 展示内容

- 当前会话 ID
- 当前 user prompt
- system prompt 摘要
- Prompt build report
- 各层 token / char 统计
- 是否截断
- 最近一次构建时间

### 核心判定

- 哪一层被截断
- 哪一层被省略
- 哪一层占用最多
- 是否超过预算

### 建议验证项

- 输入一段长 prompt，检查是否进入 report。
- 修改 system prompt 后，检查 report 是否更新。
- 检查 prompt 层裁剪是否符合预算。

---

## 5.2 `Debug / Memory`

### 展示内容

- Memory config 是否开启
- extract/session/dream 三条管线状态
- 最近 gate 结果
- 最近 telemetry
- 最近写入结果
- dream 是否触发
- dream 被跳过的原因
- 状态文件 / 锁文件信息

### 核心判定

- 管线是否真的运行
- 是配置关闭，还是 gate 阻断，还是写入失败
- dream 无效的根因是阈值未到，还是状态文件异常

### 建议验证项

- 触发一轮对话后检查 pipeline run 记录。
- 人为降低 dream 阈值后检查是否触发。
- 检查 lock/state 文件是否被正确读写。

---

## 5.3 `Debug / Workbench`

### 展示内容

- 终端宿主状态
- 当前 panel mode
- thinking block 数量
- 当前展开态 / 收起态
- 当前锚点
- 回放模式
- session restore 状态
- command presentation 汇总

### 核心判定

- 展开/收起是否稳定
- 锚点是否准确
- 回放和实时是否统一
- 恢复是否符合版本

### 建议验证项

- 刷新页面后检查 session restore 结果。
- 执行展开/收起后检查 block 状态是否一致。
- 切换回放模式检查 frame 与 block 对应关系。

---

## 6. 路由设计

### 6.1 命令解析流程

建议把 `/debug` 当成一个顶层 directive，内部再二次解析：

1. 识别 `debug`
2. 提取 domain
3. 提取 action
4. 调用对应诊断服务
5. 打开或切换对应 Debug Tab

### 6.2 路由优先级

如果输入符合以下结构，应优先路由到 debug 系统：

- `/debug ...`

避免被普通 shell 或自然语言误判。

### 6.3 可扩展性

后续可以自然扩展为：

- `/debug terminal`
- `/debug replay`
- `/debug agent`
- `/debug sync`

---

## 7. 推荐实现结构

### 7.1 新增文件

#### 命令与路由
- `src/app/features/prototype/workbench/debug/debug-command.service.ts`
- `src/app/features/prototype/workbench/debug/debug-command.types.ts`
- `src/app/features/prototype/workbench/debug/debug-command-parser.ts`

#### 调试 tab
- `src/app/features/prototype/workbench/components/debug-tab/debug-tab.component.ts`
- `src/app/features/prototype/workbench/components/debug-tab/debug-tab.component.html`
- `src/app/features/prototype/workbench/components/debug-tab/debug-tab.component.scss`

#### 域服务适配
- `src/app/features/prototype/workbench/debug/debug-prompt.adapter.ts`
- `src/app/features/prototype/workbench/debug/debug-memory.adapter.ts`
- `src/app/features/prototype/workbench/debug/debug-workbench.adapter.ts`

#### 状态与会话
- `src/app/features/prototype/workbench/debug/debug-tab-state.service.ts`

---

## 8. 文件级职责拆分

### `debug-command.service.ts`

职责：

- 解析 `/debug` 命令
- 根据 domain / action 路由
- 返回 tab key、标题、渲染数据

### `debug-tab-state.service.ts`

职责：

- 管理打开的 debug tab
- 记录当前激活 tab
- 保存最近会话 ID
- 支持刷新当前 tab

### `debug-tab.component.*`

职责：

- 呈现报告数据
- 支持切换 domain
- 支持刷新
- 支持复制报告

### `debug-*.adapter.ts`

职责：

- 分别适配 prompt / memory / workbench 的数据结构
- 把各域服务输出转成统一 view model

---

## 9. 交互流程设计

### 9.1 打开调试 Tab

用户输入：

```text
/debug prompt
```

流程：

1. 命令解析器识别 `/debug`。
2. domain = `prompt`。
3. 调用 prompt debug adapter。
4. 生成 `Debug / Prompt` tab。
5. 打开或激活该 tab。

### 9.2 刷新调试 Tab

用户输入：

```text
/debug memory run
```

流程：

1. 解析 domain = `memory`，action = `run`。
2. 触发 memory pipeline。
3. 重新采集 telemetry 和 state。
4. 刷新 `Debug / Memory` tab。

### 9.3 查看 workbench 状态

用户输入：

```text
/debug workbench
```

流程：

1. 读取 workbench context snapshot。
2. 读取 terminal debug report。
3. 展示 `Debug / Workbench` tab。

---

## 10. 可验证 TODO 列表

下面的 TODO 按“可验证”标准编写，每项都应能在完成后明确检查。

### P0：命令入口与路由

- [ ] 新增 `/debug` 顶层 directive 解析。
  - 验证：输入 `/debug prompt` 不会被当成 shell 或普通自然语言。

- [ ] 实现 debug domain 解析器。
  - 验证：`prompt` / `memory` / `workbench` 可被稳定识别。

- [ ] 定义 debug 命令返回结构。
  - 验证：返回包含 `tabKey`、`tabTitle`、`viewModel`、`timestamp`。

- [ ] 将 `/debug` 命令加入帮助与提示列表。
  - 验证：`/help` 或命令列表能看到 `/debug`。

### P0：Tab 结构与命名

- [ ] 新建 `Debug / Prompt` tab。
  - 验证：输入 `/debug prompt` 后会打开该 tab。

- [ ] 新建 `Debug / Memory` tab。
  - 验证：输入 `/debug memory` 后会打开该 tab。

- [ ] 新建 `Debug / Workbench` tab。
  - 验证：输入 `/debug workbench` 后会打开该 tab。

- [ ] Tab 标题统一使用 `/` 分隔格式。
  - 验证：标题实际显示为 `Debug / Prompt` 这类形式。

### P1：Prompt 调试

- [ ] 接入 `PromptBuildContextService` 的快照数据。
  - 验证：能显示最近一次 prompt 构建结果。

- [ ] 接入 `PromptDebugReportService` 的文本报告。
  - 验证：能显示各层预算、截断、生成时间。

- [ ] 支持 `debug prompt latest`。
  - 验证：重复执行时可看到最新上下文。

- [ ] 支持 `debug prompt rebuild`。
  - 验证：触发后报告更新时间变化。

### P1：Memory 调试

- [ ] 接入 `MemoryOrchestratorService.getStatus()`。
  - 验证：页面能展示 pipeline 状态。

- [ ] 接入 `MemoryTelemetryService` 最近事件。
  - 验证：tab 中可以看到最近 gate/run/error 记录。

- [ ] 接入 `MemoryConfigService` 配置摘要。
  - 验证：能看见 enabled / dream / session / extract 开关。

- [ ] 支持 `debug memory run`。
  - 验证：执行后 pipeline 状态和 telemetry 发生变化。

- [ ] 支持 `debug memory dream`。
  - 验证：能看到 dream 相关状态或跳过原因。

### P1：Workbench 调试

- [ ] 接入 `WorkbenchContextService` 快照。
  - 验证：能显示当前 turn / prompt / debug report。

- [ ] 接入 `TerminalDisplayDebugService` 报告。
  - 验证：能显示 thinking blocks、panel mode、replay state。

- [ ] 接入 `TurnMetadataService` 的 turn 列表。
  - 验证：能展示当前会话所有 turn。

- [ ] 支持 `debug workbench restore`。
  - 验证：刷新或重新进入页面后恢复状态一致。

### P2：用户体验与稳定性

- [ ] 调试 tab 支持刷新按钮。
  - 验证：点击后报告时间更新。

- [ ] 调试 tab 支持复制内容。
  - 验证：复制后可粘贴到 issue / PR 中。

- [ ] 调试 tab 支持固定 session ID。
  - 验证：切换会话后仍可查看指定 session 的报告。

- [ ] 调试 tab 默认只读。
  - 验证：未显式指定 action 时不会改写数据。

- [ ] 调试 tab 支持关闭与复用。
  - 验证：重复输入同类命令不会无限新增 tab。

---

## 11. 验证标准

### 11.1 功能验证

- `/debug prompt` 能打开 `Debug / Prompt`。
- `/debug memory` 能打开 `Debug / Memory`。
- `/debug workbench` 能打开 `Debug / Workbench`。
- 调试内容与各域服务状态一致。

### 11.2 可靠性验证

- 在主终端执行普通命令时，不会干扰 debug tab。
- 刷新页面后，调试 tab 仍能恢复可读状态。
- 关闭后再次打开，能复用最近一次状态。

### 11.3 可追踪性验证

- 每个 tab 都能显示生成时间。
- 每个报告都能看到数据来源。
- 每个 action 都能在日志或状态中找到对应变化。

---

## 12. 推荐实施顺序

### 阶段 1：命令路由

先实现 `/debug` 入口与 domain 解析。

### 阶段 2：Tab 容器

再实现调试 tab 容器与 `Debug / Domain` 命名。

### 阶段 3：域适配器

接入 prompt / memory / workbench 三类报告。

### 阶段 4：动作命令

实现 `rebuild` / `run` / `restore` 等显式 action。

### 阶段 5：验证与收口

补齐帮助、复用、复制、会话固定、状态恢复。

---

## 13. 结论

这个方案是合理的，而且比较符合当前系统演进方向：

- `/debug` 作为统一入口，降低心智成本。
- `Debug / Prompt`、`Debug / Memory`、`Debug / Workbench` 作为独立诊断 tab，避免污染主终端。
- 调试逻辑从临时输出升级为稳定的只读诊断视图。
- TODO 列表按可验证标准拆分，便于逐项落地。

如果下一步要继续推进，建议先实现：

1. `/debug` 解析器
2. `Debug / Prompt` tab
3. `Debug / Memory` tab
4. `Debug / Workbench` tab

这样可以先把“入口 + 视图”搭起来，再逐步填充各域报告。
