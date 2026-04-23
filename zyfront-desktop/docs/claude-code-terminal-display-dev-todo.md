# Claude Code 终端展示改进开发 TODO 清单

> 基于 `claude-code/restored-src/src` 的终端面板思路，以及当前 `zyfront-desktop` 的 `workbench.page.ts`、`command-router.service.ts`、`command-processing.service.ts`、`prompt-memory-builder.service.ts` 等实现，整理成可直接执行的开发 TODO 清单。

---

## 1. 开发目标

将当前终端展示能力从“页面内混合实现”逐步升级为：

- 独立终端宿主
- 独立思考块状态机
- 独立锚点与滚动协调
- 独立渲染协调层
- 独立历史回放协调层
- 与记忆 / 命令 / 路由形成统一上下文闭环

---

## 2. TODO 总览

### P0 - 先做

- [ ] 抽出独立终端宿主服务
- [ ] 抽出思考块管理器
- [ ] 统一思考块展开 / 收起状态机
- [ ] 抽出统一锚点服务
- [ ] 将覆盖式展开主路径改为块级重绘主路径

### P1 - 紧接着做

- [ ] 抽出终端渲染协调层
- [ ] 抽出历史回放协调层
- [ ] 将记忆构建结果暴露到终端调试视图
- [ ] 统一命令结果展示语义
- [ ] 提升 sessionStorage 恢复鲁棒性

### P2 - 优化与收敛

- [ ] 增加终端调试面板
- [ ] 拆分 `workbench.page.ts` 职责
- [ ] 增加长会话回归测试
- [ ] 补齐“当前会话上下文面板”
- [ ] 统一系统状态报告入口

---

## 3. 任务拆解

### Task 1：抽出独立终端宿主服务

**目标**：把终端宿主生命周期、显示切换、恢复逻辑从 `workbench.page.ts` 剥离出来。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/terminal-host.service.ts`
- `src/app/features/prototype/workbench/services/terminal-session.service.ts`
- `src/app/features/prototype/workbench/services/terminal-keybinding.service.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`
- `src/app/app.config.ts`（如需注册全局终端相关提供器）

**工作内容**：

1. 将 xterm 初始化和销毁抽离到 `terminal-session.service.ts`
2. 将面板 show/hide、进入/退出逻辑抽离到 `terminal-host.service.ts`
3. 将快捷键绑定 / 解绑抽离到 `terminal-keybinding.service.ts`
4. 让 `workbench.page.ts` 只保留 UI 绑定与调用入口

**验收标准**：

- 终端生命周期不再依赖页面大组件直接维护
- 切页 / 刷新后终端恢复逻辑仍可工作
- 快捷键绑定不再散落在页面内

---

### Task 2：抽出思考块管理器

**目标**：统一思考块注册、恢复、展开、收起、清理。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/thinking-block-manager.service.ts`
- `src/app/features/prototype/workbench/models/thinking-block.model.ts`
- `src/app/features/prototype/workbench/models/thinking-block-state.enum.ts`
- `src/app/features/prototype/workbench/utils/thinking-block-serializer.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`
- `src/app/features/prototype/workbench/components/task-panel/task-panel.component.ts`

**工作内容**：

1. 把 `thinkingBlocksById`、`thinkingBlockMarkers`、`thinkingInlineExpandedRanges` 等状态收敛到 manager
2. 统一 `mergeThinkingBlocksFromSession()` 的恢复逻辑
3. 统一 block 的注册与去重规则
4. 统一 block 的序列化与反序列化 schema

**验收标准**：

- 思考块状态来源单一
- 刷新 / 重绘后可恢复
- 编号、marker、状态不会互相打架

---

### Task 3：统一思考块展开 / 收起状态机

**目标**：把 `Ctrl+O`、`Ctrl+Shift+O` 的行为收敛成单一状态机。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/thinking-block-state-machine.service.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`

**工作内容**：

1. 定义折叠、展开、全部展开、全部收起的状态迁移
2. 把单块展开 / 收起与全局展开 / 收起统一入口
3. 明确状态切换前后的不变量
4. 统一展开状态与恢复状态的处理

**验收标准**：

- 不同快捷键不会走散落分支
- 展开 / 收起逻辑可预测
- 多次切换后状态仍稳定

---

### Task 4：抽出统一锚点服务

**目标**：统一 marker、buffer 行号、最近块定位和滚动恢复。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/terminal-anchor.service.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`

**工作内容**：

1. 封装 marker 创建、更新、失效检测
2. 统一 block id 到 buffer range 的查找策略
3. 统一滚动恢复与当前视口锚定逻辑
4. 统一历史回放时的定位规则

**验收标准**：

- 不再在多个地方重复推断块位置
- 展开后滚动更稳定
- 重绘后定位不丢失

---

### Task 5：把覆盖式展开主路径改为块级重绘主路径

**目标**：降低 overlay 残留、行号错位、滚动漂移风险。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/terminal-block-renderer.service.ts`
- `src/app/features/prototype/workbench/services/terminal-layout.service.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`

**工作内容**：

1. 将 `expandThinkingViaOverlay()` 的主路径逐步替换为 renderer 输出
2. 将 `collapseThinkingInline()` 的清理逻辑统一到 renderer / layout 层
3. 把 ANSI 拼接、换行估算、占位插入集中处理
4. 保留兼容路径，逐步切换主路径

**验收标准**：

- 展开不覆盖后续内容
- 收起不留空白洞
- 多轮展开 / 收起后布局仍正确

---

### Task 6：抽出终端渲染协调层

**目标**：统一终端消息、思考块、系统提示、错误提示的展示协议。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/terminal-render-coordinator.service.ts`
- `src/app/features/prototype/workbench/types/terminal-render.types.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`
- `src/app/features/prototype/workbench/command-executor.service.ts`
- `src/app/features/prototype/workbench/command-processing.service.ts`

**工作内容**：

1. 统一 directive / shell / natural 的输出展示类型
2. 定义 message / success / error / system 等展示协议
3. 将执行结果先交给协调层，再由协调层决定渲染方式
4. 避免页面直接拼接展示逻辑

**验收标准**：

- 各类结果展示风格统一
- 展示逻辑不再散落在执行器里
- 页面不直接决定渲染细节

---

### Task 7：抽出历史回放协调层

**目标**：统一实时流和历史回放的块数据模型与渲染模式。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/session-replay.service.ts`
- `src/app/features/prototype/workbench/services/turn-history.service.ts`
- `src/app/features/prototype/workbench/models/turn-record.model.ts`
- `src/app/features/prototype/workbench/models/replay-mode.enum.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`

**工作内容**：

1. 把实时输出和历史回放统一到同一份 turn 结构
2. 支持 compact / full / interactive 三种回放模式
3. 统一回放恢复与重建流程
4. 避免重放时重新生成不一致状态

**验收标准**：

- 实时和历史回放语义一致
- 恢复后编号和状态不乱
- 回放模式切换可预测

---

### Task 8：将记忆构建结果暴露到终端调试视图

**目标**：让终端可以解释记忆为何被截断、为何未显示、为何未更新。

**建议新增文件**：

- `src/app/core/memory/prompt-build-context.service.ts`
- `src/app/core/memory/prompt-debug-report.service.ts`
- `src/app/features/prototype/workbench/services/workbench-context.service.ts`
- `src/app/features/prototype/workbench/models/workbench-context.model.ts`

**现有文件改造**：

- `src/app/core/memory/prompt-memory-builder.service.ts`
- `src/app/features/prototype/workbench/workbench.page.ts`

**工作内容**：

1. 将 prompt build report 绑定到当前 session / turn
2. 将记忆层状态写入统一上下文
3. 终端调试面板可查看记忆构建结果
4. 解释“为什么这层没出现”

**验收标准**：

- 终端可以解释 prompt 构建过程
- 能查看各层截断 / 去重 / 缺失原因

---

### Task 9：统一命令结果展示语义

**目标**：让命令输出在终端侧有统一语义。

**建议新增文件**：

- 复用 `terminal-render-coordinator.service.ts`
- 视情况新增 `command-display.mapper.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/command-executor.service.ts`
- `src/app/features/prototype/workbench/command-processing.service.ts`
- `src/app/features/prototype/workbench/command-router.service.ts`

**工作内容**：

1. 统一 directive / shell / natural 输出分类
2. 输出统一映射为成功、失败、系统、普通消息
3. 展示协议与执行协议分离

**验收标准**：

- 不同命令类型显示风格一致
- 错误与系统消息更易辨识
- 展示行为可复用

---

### Task 10：提升 sessionStorage 恢复鲁棒性

**目标**：避免刷新、切页、热更新后状态失真。

**建议新增文件**：

- `src/app/features/prototype/workbench/utils/workbench-session-restore.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`

**工作内容**：

1. 恢复时校验版本、编号、状态、marker 一致性
2. 防止重复恢复同一批 block
3. 统一 sessionStorage schema
4. 处理热更新后的兼容字段

**验收标准**：

- 刷新后状态恢复稳定
- 不会重复叠加或丢失 block
- 兼容旧版本数据

---

### Task 11：增加终端调试面板

**目标**：把终端问题显式化，便于排查。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/terminal-debug.service.ts`
- `src/app/features/prototype/workbench/components/terminal-debug-panel.component.ts`

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`

**工作内容**：

1. 展示最近思考块状态变化
2. 展示滚动锚点和展开记录
3. 展示回放恢复结果
4. 展示当前终端宿主状态

**验收标准**：

- 终端状态可视化
- 故障定位速度提升
- 调试信息清晰可读

---

### Task 12：拆分 `workbench.page.ts` 职责

**目标**：把页面从“全能控制器”变成薄 UI 层。

**现有文件改造**：

- `src/app/features/prototype/workbench/workbench.page.ts`

**工作内容**：

1. 只保留模板绑定、生命周期入口、服务调用
2. 移除终端、思考块、回放、锚点的直接实现
3. 通过服务层编排所有核心行为

**验收标准**：

- 页面文件明显变小
- 逻辑更易维护
- 后续扩展风险下降

---

### Task 13：增加长会话回归测试

**目标**：验证多轮使用时的稳定性。

**建议新增文件**：

- `src/app/features/prototype/workbench/workbench.page.spec.ts`
- `src/app/features/prototype/workbench/services/*.spec.ts`

**工作内容**：

1. 多轮思考块展开 / 收起测试
2. 多次切页恢复测试
3. 热更新恢复测试
4. 大量 block 场景性能测试

**验收标准**：

- 长会话不崩
- 恢复不乱
- 性能可接受

---

### Task 14：补齐当前会话上下文面板

**目标**：让用户和调试者看到“当前会话发生了什么”。

**建议新增文件**：

- `src/app/features/prototype/workbench/components/workbench-context-panel.component.ts`

**工作内容**：

1. 展示当前 turn、块数、展开态
2. 展示路由结果与执行结果
3. 展示记忆层状态
4. 作为调试与解释入口

**验收标准**：

- 上下文状态一眼可见
- 有助于解释“记忆为什么没更新”

---

### Task 15：统一系统状态报告入口

**目标**：把终端、记忆、路由、执行状态汇总到统一入口。

**建议新增文件**：

- `src/app/features/prototype/workbench/services/system-status-report.service.ts`

**工作内容**：

1. 汇总终端状态
2. 汇总思考块状态
3. 汇总记忆 pipeline 状态
4. 汇总命令路由与执行状态

**验收标准**：

- 可从一个入口查看系统总体状态
- 排查效率提升

---

## 4. 推荐实施顺序

建议按下面顺序做：

1. Task 1 终端宿主服务
2. Task 2 思考块管理器
3. Task 3 状态机
4. Task 4 锚点服务
5. Task 5 重绘主路径
6. Task 6 渲染协调层
7. Task 7 回放协调层
8. Task 8 记忆调试视图
9. Task 9 命令展示语义统一
10. Task 10 sessionStorage 恢复加固
11. Task 11 终端调试面板
12. Task 12 页面职责拆分
13. Task 13 长会话测试
14. Task 14 会话上下文面板
15. Task 15 系统状态报告入口

---

## 5. 里程碑建议

### Milestone A
完成 Task 1 ~ Task 4，建立稳定宿主和状态基础。

### Milestone B
完成 Task 5 ~ Task 7，建立稳定渲染和回放基础。

### Milestone C
完成 Task 8 ~ Task 10，打通记忆解释与恢复鲁棒性。

### Milestone D
完成 Task 11 ~ Task 15，完成调试、测试与工程收敛。

---

## 6. 备注

这份 TODO 清单的目标是把终端展示从“能用”推进到“稳定、可解释、可维护”。

如果后续要继续执行，建议先从 **Task 1 + Task 2** 开始，因为它们是后续所有优化的前置基础。
