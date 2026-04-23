# Claude Code 终端展示改进 Git 提交粒度任务清单

> 目标：把终端展示改进拆成可按 Git 提交推进的最小任务单元。每个任务尽量对应一个清晰 commit，便于回滚、审查和阶段验收。

---

## 1. 拆分原则

每个 commit 粒度任务应满足：

1. 只解决一个明确问题。
2. 修改文件数量尽量少，最好 1~5 个核心文件。
3. 不同时做“抽服务 + 改逻辑 + 改 UI + 改测试”。
4. 每个 commit 都应可独立验证。
5. 优先先抽象、再迁移、最后清理。

---

## 2. 建议提交顺序

### Commit 1：抽出终端宿主基础服务骨架

**目标**：建立终端宿主抽象的第一层框架，不迁移业务逻辑，只搭结构。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/services/terminal-host.service.ts`
- 新建 `src/app/features/prototype/workbench/services/terminal-session.service.ts`
- 必要时补 `src/app/features/prototype/workbench/services/terminal-keybinding.service.ts`

**内容**：

- 定义终端宿主接口
- 定义 session 生命周期接口
- 先保留空实现或薄封装
- 不改现有页面行为

**标准 commit message**：

```text
feat(workbench): scaffold terminal host and session services
```

**验收**：

- 工程能编译
- 服务可注入
- 旧逻辑未受影响

---

### Commit 2：把 xterm 初始化与销毁迁移到 session 服务

**目标**：终端会话生命周期独立化。

**改动范围**：

- `src/app/features/prototype/workbench/workbench.page.ts`
- `src/app/features/prototype/workbench/services/terminal-session.service.ts`

**内容**：

- 抽出 xterm 创建、dispose、focus
- 页面改为调用 session service
- 不改终端展示语义

**标准 commit message**：

```text
refactor(workbench): move xterm lifecycle into session service
```

**验收**：

- 终端行为不变
- 页面职责开始下降
- 没有明显回归

---

### Commit 3：抽出快捷键注册与解绑

**目标**：把终端相关快捷键从页面剥离。

**改动范围**：

- `src/app/features/prototype/workbench/workbench.page.ts`
- `src/app/features/prototype/workbench/services/terminal-keybinding.service.ts`

**内容**：

- 抽取 `Ctrl+O`、`Ctrl+Shift+O`、相关终端快捷键绑定
- 集中管理事件监听器
- 统一销毁

**标准 commit message**：

```text
refactor(workbench): extract terminal keybinding management
```

**验收**：

- 快捷键仍可用
- 解绑行为正确
- 页面事件监听减少

---

### Commit 4：抽出思考块模型与状态枚举

**目标**：让思考块状态有正式数据模型。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/models/thinking-block.model.ts`
- 新建 `src/app/features/prototype/workbench/models/thinking-block-state.enum.ts`
- 新建 `src/app/features/prototype/workbench/types/terminal-render.types.ts`（如需要）

**内容**：

- 定义 block 字段
- 定义 collapsed / expanded / inline-expanded / historical-hidden 状态
- 不迁移逻辑

**标准 commit message**：

```text
feat(workbench): introduce thinking block model and state enum
```

**验收**：

- 类型清晰
- 后续重构可引用
- 编译通过

---

### Commit 5：抽出思考块管理器基础能力

**目标**：统一注册、查找、恢复、清理。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/services/thinking-block-manager.service.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 把 `thinkingBlocksById`、`thinkingBlockMarkers` 迁移到 manager
- 暴露只读查询接口
- 页面保留调用，不再直接维护内部结构

**标准 commit message**：

```text
refactor(workbench): centralize thinking block management
```

**验收**：

- 块索引来源统一
- 页面内部状态减少
- 行为不回退

---

### Commit 6：统一 sessionStorage 恢复逻辑

**目标**：让思考块恢复有统一入口。

**改动范围**：

- `src/app/features/prototype/workbench/workbench.page.ts`
- `src/app/features/prototype/workbench/utils/thinking-block-serializer.ts`
- `src/app/features/prototype/workbench/services/thinking-block-manager.service.ts`

**内容**：

- 把 `mergeThinkingBlocksFromSession()` 相关逻辑下沉
- 增加序列化/反序列化
- 加版本校验

**标准 commit message**：

```text
refactor(workbench): unify thinking block session restore
```

**验收**：

- 刷新可恢复
- 旧数据兼容
- 不重复恢复

---

### Commit 7：抽出展开 / 收起状态机

**目标**：统一单块与全局的展开收起逻辑。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/services/thinking-block-state-machine.service.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 将 `Ctrl+O` / `Ctrl+Shift+O` 收敛到状态机
- 明确状态迁移
- 页面仅调用状态机

**标准 commit message**：

```text
refactor(workbench): consolidate thinking block expansion state machine
```

**验收**：

- 展开/收起行为稳定
- 单块和全局逻辑统一
- 无循环分支散落

---

### Commit 8：抽出统一锚点服务

**目标**：消除 marker / buffer 行号的分散逻辑。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/services/terminal-anchor.service.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 统一 marker 创建与失效判断
- 统一 block 定位策略
- 统一滚动恢复

**标准 commit message**：

```text
refactor(workbench): centralize terminal anchor resolution
```

**验收**：

- 块定位逻辑单一
- 回放和重绘定位更稳

---

### Commit 9：抽出终端渲染协调层

**目标**：把“怎么显示”从页面和执行器里分离出去。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/services/terminal-block-renderer.service.ts`
- 新建 `src/app/features/prototype/workbench/services/terminal-render-coordinator.service.ts`
- `src/app/features/prototype/workbench/command-executor.service.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 定义 message / success / error / system 展示协议
- 统一 ANSI / 摘要 / 占位输出
- 执行结果先交由协调层

**标准 commit message**：

```text
refactor(workbench): add terminal render coordination layer
```

**验收**：

- 展示语义统一
- 页面不再直接拼输出

---

### Commit 10：把展开主路径切换为块级重绘优先

**目标**：减少 overlay 残留和布局错位。

**改动范围**：

- `src/app/features/prototype/workbench/workbench.page.ts`
- `src/app/features/prototype/workbench/services/terminal-block-renderer.service.ts`
- `src/app/features/prototype/workbench/services/terminal-layout.service.ts`

**内容**：

- 保留兼容展开逻辑
- 新主路径改为重绘优先
- 收起逻辑也走统一布局清理

**标准 commit message**：

```text
refactor(workbench): prefer block re-render for thinking expansion
```

**验收**：

- 展开不覆盖后续内容
- 收起不留空白
- 状态更稳定

---

### Commit 11：抽出历史回放协调层

**目标**：统一实时流和历史回放模型。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/services/session-replay.service.ts`
- 新建 `src/app/features/prototype/workbench/services/turn-history.service.ts`
- 新建 `src/app/features/prototype/workbench/models/turn-record.model.ts`
- 新建 `src/app/features/prototype/workbench/models/replay-mode.enum.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 统一 turn 结构
- 支持 compact / full / interactive 回放模式
- 统一恢复和重放流程

**标准 commit message**：

```text
refactor(workbench): unify live stream and replay flow
```

**验收**：

- 回放与实时语义一致
- 恢复后不乱序

---

### Commit 12：把 prompt 记忆构建报告暴露到终端调试视图

**目标**：让终端能解释“为什么记忆没显示”。

**改动范围**：

- `src/app/core/memory/prompt-memory-builder.service.ts`
- 新建 `src/app/core/memory/prompt-build-context.service.ts`
- 新建 `src/app/core/memory/prompt-debug-report.service.ts`
- 新建 `src/app/features/prototype/workbench/services/workbench-context.service.ts`

**内容**：

- 记忆构建报告绑定 session / turn
- 提供可视化调试数据
- 让终端查看构建摘要

**标准 commit message**：

```text
feat(memory): expose prompt build reports to terminal diagnostics
```

**验收**：

- 可解释 prompt 构建结果
- 记忆层可见性增强

---

### Commit 13：统一命令结果展示语义

**目标**：directive / shell / natural 输出风格统一。

**改动范围**：

- `src/app/features/prototype/workbench/command-executor.service.ts`
- `src/app/features/prototype/workbench/command-processing.service.ts`
- `src/app/features/prototype/workbench/command-router.service.ts`

**内容**：

- 输出分类映射
- 展示协议统一
- 结果处理下沉到协调层

**标准 commit message**：

```text
refactor(workbench): normalize command result presentation
```

**验收**：

- 输出风格一致
- 错误展示清晰

---

### Commit 14：加固终端恢复鲁棒性

**目标**：处理刷新、切页、热更新后的恢复稳定性。

**改动范围**：

- `src/app/features/prototype/workbench/workbench.page.ts`
- 新建 `src/app/features/prototype/workbench/utils/workbench-session-restore.ts`

**内容**：

- 恢复时校验版本和状态
- 防止重复恢复
- 兼容旧数据

**标准 commit message**：

```text
fix(workbench): harden terminal session restore
```

**验收**：

- 刷新后可恢复
- 不重复叠加
- 不丢失状态

---

### Commit 15：增加终端调试面板

**目标**：把状态变化显式展示出来。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/services/terminal-debug.service.ts`
- 新建 `src/app/features/prototype/workbench/components/terminal-debug-panel.component.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 展示思考块状态变化
- 展示锚点和展开历史
- 展示回放恢复结果

**标准 commit message**：

```text
feat(workbench): add terminal debug panel
```

**验收**：

- 调试信息可见
- 排障效率提升

---

### Commit 16：拆分 `workbench.page.ts` 职责

**目标**：把页面降为薄 UI 层。

**改动范围**：

- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 剩余逻辑下沉到服务
- 页面只保留生命周期和绑定

**标准 commit message**：

```text
refactor(workbench): slim down workbench page responsibilities
```

**验收**：

- 页面显著变薄
- 后续维护更轻

---

### Commit 17：补长会话回归测试

**目标**：验证多轮与热更新稳定性。

**改动范围**：

- `src/app/features/prototype/workbench/*.spec.ts`
- `src/app/features/prototype/workbench/services/*.spec.ts`

**内容**：

- 多轮展开/收起测试
- 切页恢复测试
- 热更新恢复测试
- 大量 block 性能测试

**标准 commit message**：

```text
test(workbench): add long session regression coverage
```

**验收**：

- 回归可重复
- 长会话稳定

---

### Commit 18：补当前会话上下文面板

**目标**：提供统一会话状态概览。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/components/workbench-context-panel.component.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 展示 turn / 块数 / 展开态 / 记忆层 / 路由结果

**标准 commit message**：

```text
feat(workbench): add current session context panel
```

**验收**：

- 上下文一眼可见
- 解释问题更容易

---

### Commit 19：统一系统状态报告入口

**目标**：汇总终端、记忆、路由、执行状态。

**改动范围**：

- 新建 `src/app/features/prototype/workbench/services/system-status-report.service.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**内容**：

- 输出统一系统状态
- 供调试面板和日志使用

**标准 commit message**：

```text
feat(workbench): add unified system status report
```

**验收**：

- 单入口查看系统状态
- 定位问题更快

---

## 3. 推荐提交分组

为了避免 commit 过碎，可以按下面分组提交：

### Group A：宿主与状态基础
- Commit 1 ~ 4

### Group B：状态管理与重绘主路径
- Commit 5 ~ 10

### Group C：回放、记忆、展示语义
- Commit 11 ~ 14

### Group D：调试、页面收敛、测试
- Commit 15 ~ 19

---

## 4. 最小可回滚原则

建议每个 commit 都做到：

- 编译通过
- 逻辑单点改动
- 不同时混入太多 UI 和基础设施变化
- 保留兼容路径，直到新路径验证完成

---

## 5. 建议的最终执行顺序

如果要最稳妥地推进，推荐：

1. 先做 Commit 1 ~ 4，确保宿主和状态模型先落地。
2. 再做 Commit 5 ~ 10，完成展示主链路重构。
3. 然后做 Commit 11 ~ 14，打通回放和记忆解释。
4. 最后做 Commit 15 ~ 19，补调试、测试和收敛。

---

## 6. 备注

这份清单的定位是“Git 提交粒度”，因此每项都尽量保持：

- 一个提交一个主题
- 一个提交一个可验证目标
- 一个提交尽量少改动核心文件

如果后续你要，我可以继续把这份清单再拆成：

1. **按 commit message 风格写好的提交说明**
2. **按文件路径分组的执行看板**
3. **按 3 天 / 5 天 / 1 周排期的落地计划**
