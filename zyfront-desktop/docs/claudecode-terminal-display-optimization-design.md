# Claude Code 终端展示效果优化设计文档

> 基于 `E:/AGENT-ROOT/04-PROJECTS/claude-code/restored-src/src` 的恢复源码，系统分析 Claude Code 的终端展示、思考块、折叠/展开、滚动锚定与 tmux 面板实现细节，并对比 `zyfront-desktop` 当前实现，给出一份可落地的优化设计与里程碑计划。

---

## 1. 目标与范围

### 1.1 目标

本次优化目标不是简单“复刻外观”，而是尽可能复用 Claude Code 的终端行为模型，重点解决以下问题：

1. 思考内容展示更像 Claude Code：默认折叠、可控展开、支持历史回放。
2. 终端内展示不能互相覆盖，展开/收起应当保持结构稳定。
3. 路由、命令执行、思考流、历史恢复、滚动锚点要统一建模。
4. 提供详细的阶段性里程碑，支持分步上线与回归验证。

### 1.2 范围

本文聚焦以下两部分：

- `claude-code/restored-src/src/utils/terminalPanel.ts` 的终端面板展示机制
- `claude-code/restored-src/src/components/messages/AssistantThinkingMessage.tsx` 的思考块呈现逻辑
- `zyfront-desktop` 中 `workbench.page.ts`、`command-router.service.ts`、`command-processing.service.ts`、`prompt-memory-builder.service.ts` 等与终端展示体验相关的实现

不展开讨论完整模型调用、网络层、插件系统的全部业务，只保留与终端展示相关的部分。

---

## 2. Claude Code 恢复源码的关键实现结论

### 2.1 终端面板不是“临时弹层”，而是独立持久会话

恢复源码中最关键的文件是：

```text
claude-code/restored-src/src/utils/terminalPanel.ts
```

它的核心机制是：

- 使用 tmux 维护一个独立 shell 会话
- 每个 Claude Code 实例拥有自己的 tmux socket
- 面板通过 `Meta+J` 进入 / 退出，而不是重新创建 shell
- 没有 tmux 时降级为普通 shell，但不保留会话状态

这带来的直接效果是：

1. 终端内容不会因为 UI 切换而丢失
2. shell 进程可以在面板外继续运行
3. “展示层”和“执行层”是解耦的
4. 终端切回主界面时不会破坏 shell 状态

### 2.2 展示层的核心不是绘制，而是状态切换

`terminalPanel.ts` 的行为模式非常清晰：

- `toggle()` 只是入口
- 真正逻辑在 `showShell()`
- 展开前先切到 alternate screen
- 进入 tmux 会话或直接 shell
- 退出时恢复原先 Ink 终端状态

这说明 Claude Code 倾向于把终端看作“稳定状态容器”，而不是一次性渲染结果。

### 2.3 思考块默认折叠，展开与折叠是同一组件的两种状态

`AssistantThinkingMessage.tsx` 的行为可以概括为：

- 无思考内容时直接返回 `null`
- transcript 模式或 verbose 模式下展示完整思考文本
- 普通模式下只展示一行简洁提示 `Thinking`，并附带 `Ctrl+O` 展开提示
- 展开态与折叠态属于同一逻辑单元，而不是两个完全不同的 UI

这件事非常重要，因为它决定了：

- 折叠态必须保留定位能力
- 展开态必须能回到原始块
- 历史回放中可以只渲染简洁版或完整版

---

## 3. Claude Code 终端展示的实现细节拆解

### 3.1 tmux 面板设计

`terminalPanel.ts` 中的终端面板设计体现了几个关键工程点：

#### 3.1.1 单实例独立 socket

```ts
export function getTerminalPanelSocket(): string {
  const sessionId = getSessionId()
  return `claude-panel-${sessionId.slice(0, 8)}`
}
```

含义：

- 同一个应用实例拥有独立 tmux socket
- 避免多个 Claude Code 实例互相串话
- Socket 命名短而稳定，便于调试和清理

#### 3.1.2 会话创建采用 detached session

```ts
spawnSync('tmux', [
  '-L', socket,
  'new-session',
  '-d',
  '-s',
  TMUX_SESSION,
  '-c',
  cwd,
  shell,
  '-l',
])
```

这说明：

- shell 生命周期独立于 UI
- 通过 detach 模式创建后台会话
- 当前工作目录由 `pwd()` 提供，保证上下文一致

#### 3.1.3 Meta+J 绑定为 detach-client

```ts
spawnSync('tmux', [
  '-L', socket,
  'bind-key', '-n', 'M-j', 'detach-client', ';',
  'set-option', '-g', 'status-style', 'bg=default', ';',
  'set-option', '-g', 'status-left', '', ';',
  'set-option', '-g', 'status-right', ' Alt+J to return to Claude ', ';',
  'set-option', '-g', 'status-right-style', 'fg=brightblack',
])
```

这一段体现出两个展示设计思想：

1. 交互提示直接嵌入 shell 状态栏
2. 用户能在 terminal 内部自然返回主应用

#### 3.1.4 alternate screen 的进入与退出

```ts
inkInstance.enterAlternateScreen()
try {
  ...
} finally {
  inkInstance.exitAlternateScreen()
}
```

其作用是避免 shell 输出污染主渲染上下文，并确保切回时屏幕状态可恢复。

---

### 3.2 思考块呈现的组件化设计

`AssistantThinkingMessage.tsx` 体现了 Claude Code 在终端中的“低噪音、强提示”策略。

#### 3.2.1 折叠态

非 verbose / transcript 场景：

- 只显示单行提示
- 通过 `Ctrl+O` 暗示用户可展开
- 不直接刷出完整思考内容

#### 3.2.2 展开态

verbose / transcript 场景：

- 显示完整 thinking 内容
- 使用 Markdown 渲染
- 仍保持一个简洁标题行，帮助用户理解上下文

#### 3.2.3 组件层面的设计价值

这个组件的核心不是“文本漂亮”，而是：

- 思考内容具备状态
- 状态与渲染严格绑定
- 有明确的折叠默认值
- 展开行为不是额外创建一个新节点，而是切换展示层级

---

## 4. `zyfront-desktop` 当前实现分析

### 4.1 终端展示的主入口已经存在，但结构更复杂

在 `zyfront-desktop` 中，与终端相关的核心逻辑集中在：

- `src/app/features/prototype/workbench/workbench.page.ts`
- `src/app/features/prototype/workbench/command-router.service.ts`
- `src/app/features/prototype/workbench/command-processing.service.ts`
- `src/app/features/prototype/workbench/command-executor.service.ts`
- `src/app/core/memory/prompt-memory-builder.service.ts`
- `src/app/core/route-reuse.strategy.ts`

其中，`workbench.page.ts` 已经具备：

- xterm 集成
- 思考块编号与状态持久化
- buffer marker 定位
- 展开 / 收起逻辑
- sessionStorage 恢复
- 滚动与选中管理

### 4.2 当前思考块展开实现依赖“覆盖式写回 + 插入行”混合策略

在 `workbench.page.ts` 中，关键逻辑是：

- `expandThinkingViaOverlay()`
- `insertVisualRowsAfterFold()`
- `collapseThinkingInline()`
- `disposeAllThinkingOverlays()`
- `mergeThinkingBlocksFromSession()`
- `findThinkingFoldBufferLines()`

这套方案的特征：

1. 先在折叠块后插入空行，尝试为思考内容腾空间
2. 再用 xterm 装饰层或 ANSI 写回内容
3. 收起时通过删除空行或清空行内区域恢复

这比简单覆盖更好，但仍存在一些风险：

- 依赖 buffer 行号和 viewport 的同步状态
- 对滚动位置非常敏感
- 在历史回放、重绘、热更新时容易出现定位偏移
- 叠加多轮展开后，维护成本较高

### 4.3 当前命令路由与处理已经模块化，但仍偏“功能分散”

`command-router.service.ts` 负责：

- 自然语言 / shell / directive 的路由判断
- 路由置信度与理由输出
- slash 命令识别

`command-processing.service.ts` 负责：

- 预处理输入
- 路由
- directive 解析
- 执行委派

`command-executor.service.ts` 负责：

- 具体 directive 执行
- shell / natural 的结果输出

这一套结构的优点是清晰，但与终端展示直接耦合时还缺少一个统一“展示状态机”。

### 4.4 提示词记忆构建与展示关系较弱

`prompt-memory-builder.service.ts` 已经做了：

- 多层记忆读取
- 并行 I/O
- 字符预算
- 报告统计

但它和终端展示层之间没有足够强的“信息流闭环”：

- 思考展示看不到记忆建构的可解释摘要
- 展开/折叠状态没有参与 prompt 说明
- 历史回放和 prompt 生成缺少统一的结构索引

---

## 5. Claude Code 与 Zyfront Desktop 的关键差异

### 5.1 终端展示层差异

| 维度 | Claude Code 恢复源码 | Zyfront Desktop 当前实现 |
|---|---|---|
| shell 承载 | tmux 持久会话 | xterm 前端展示为主 |
| 终端状态切换 | alternate screen + attach/detach | 以页面内状态和覆盖式写回为主 |
| 思考块渲染 | 单组件两态切换 | 多段 buffer 操作 + overlay 混合 |
| 展开策略 | 模式切换、低噪音 | 插入空行 + 装饰层/ANSI 组合 |
| 回放/恢复 | 倾向会话状态持久 | sessionStorage + 内存块恢复 |
| 定位锚点 | tmux/Ink 的会话语义 | xterm marker + buffer 行号 |

### 5.2 架构差异

Claude Code 更像：

- 执行环境与 UI 环境分离
- 终端面板是一个持久 shell 宿主
- 思考块是 UI 状态的一部分

Zyfront Desktop 更像：

- UI、命令解析、终端绘制、历史记忆都在同一个页面层持续协同
- 展示问题容易变成状态同步问题
- 功能更丰富，但耦合度更高

### 5.3 体验差异

Claude Code 的体验偏向：

- 简洁
- 稳定
- 一致
- 可预测

Zyfront Desktop 目前更偏向：

- 功能强
- 模块多
- 可扩展
- 但终端展示稳定性还可以继续强化

---

## 6. 优化方向总览

建议将优化工作拆成四条主线：

1. **终端宿主抽象化**
   - 把“显示 shell / 进入 shell / 返回主界面”的逻辑从页面中抽离
   - 建立统一的 terminal host / terminal session abstraction

2. **思考块展示状态机化**
   - 将 thinking block 从“局部操作”升级为“可恢复状态对象”
   - 明确 collapsed / expanded / inline-expanded / historical-replay 四种状态

3. **锚点与重绘机制统一**
   - 避免多个地方各自计算 buffer 位置
   - 统一使用 marker + block id + snapshot 三层定位

4. **历史回放与实时流一致化**
   - 回放和实时共用同一套 block 元数据
   - 折叠态与展开态共享同一数据结构，只是不同渲染策略

---

## 7. 推荐的目标架构

### 7.1 分层结构

建议将终端展示拆为 5 层：

#### A. 输入层

负责接收：

- 用户输入
- slash directive
- shell 命令
- 自然语言
- bridge 来源输入

职责：标准化、预处理、分类。

#### B. 路由层

负责判断：

- directive
- shell
- natural
- fallback

当前 `CommandRouterService` 已具备雏形，可继续扩展。

#### C. 执行层

负责：

- directive 执行
- shell 执行
- 自然语言查询代理

当前 `CommandExecutorService` 可以作为核心执行单元。

#### D. 展示层

负责：

- xterm / panel 显示
- thinking block 折叠/展开
- 滚动锚定
- 状态提示
- 历史回放可见性

#### E. 状态存储层

负责：

- sessionStorage / localStorage / vault 持久化
- 思考块索引
- 最近输入 / 最近 turn
- 展开状态缓存

---

## 8. 展示状态模型设计

建议将思考块定义为如下结构：

- `id`：全局唯一编号
- `sessionId`：归属会话
- `turnId`：归属轮次
- `text`：原始思考内容
- `summary`：折叠态摘要
- `status`：`collapsed | expanded | inline-expanded | historical-hidden`
- `anchor`：marker / buffer / logical block 三层锚点
- `collapsedRows`：折叠时占用行数
- `expandedRows`：展开时占用行数
- `foldSuffixAnsi`：折叠尾部 ANSI 片段
- `version`：用于兼容旧数据

### 8.1 状态迁移

建议状态迁移如下：

- `collapsed → expanded`
- `expanded → collapsed`
- `collapsed → inline-expanded`
- `inline-expanded → collapsed`
- `collapsed → historical-hidden`
- `historical-hidden → collapsed`

### 8.2 状态不变量

1. 一个 thinking block 在同一时刻只能有一个展示状态。
2. 展开/收起不应改变 block 的语义顺序。
3. 历史回放不得破坏当前会话 block 的编号连续性。
4. 任何重绘都必须可从 block 元数据恢复。

---

## 9. 终端展示实现建议

### 9.1 由“覆盖式”改为“块级重绘式”

当前方案中最脆弱的是局部 overlay 写回。建议把主路径改为：

1. 记录 block 起止位置
2. 更新 block 状态
3. 触发局部重绘或局部布局刷新
4. 由统一渲染器输出折叠态或展开态

这样可以减少：

- 行号错位
- 滚动后定位丢失
- overlay 残留
- 多轮展开互相污染

### 9.2 统一滚动锚点策略

建议优先级：

1. block marker
2. block id
3. 最近一次已知 buffer range
4. 文本前缀匹配

不要再让多个函数各自推断“这个块在哪一行”。

### 9.3 展开布局建议

展开时不要直接在原位置覆盖全文，而是：

- 先确认可见区域
- 预估展开高度
- 为展开内容预留行位
- 再写入内容
- 收起时恢复占位行

这个模式最接近 Claude Code 的“占位让位”思路。

### 9.4 历史回放策略

历史回放建议区分两种模式：

- **紧凑回放**：只展示折叠摘要和关键状态
- **完整回放**：展示展开后的全部内容

在 UI 上应该让用户明确当前是哪个模式，而不是混在同一套展示逻辑里。

---

## 10. 对 Zyfront Desktop 的具体落地改造建议

### 10.1 终端主面板能力重构

建议新增一个独立的终端展示协调层，负责：

- panel 进入 / 退出
- shell session 保持
- 终端状态切换
- 状态恢复

它的职责应接近 Claude Code 的 `terminalPanel.ts`。

### 10.2 思考块管理器独立化

建议从 `workbench.page.ts` 中拆出：

- block 注册
- block 查找
- block 持久化
- block 展开/收起
- block 回放恢复

这样可以降低页面组件复杂度。

### 10.3 路由与展示分离

`command-router.service.ts` 与 `command-executor.service.ts` 已经具备基础结构，但建议再增加：

- `CommandPresentationService`
- `TerminalBlockRenderer`
- `SessionReplayCoordinator`

让“如何解释”与“如何显示”分离。

### 10.4 统一 prompt / memory / terminal 的上下文来源

建议把 prompt 记忆层、终端展示层、历史回放层都映射到同一份 turn metadata：

- 当前轮次
- 当前思考块列表
- 当前命令执行结果
- 当前记忆快照
- 当前滚动锚点

这样可以显著降低“显示和语义不同步”的风险。

---

## 11. 分阶段里程碑计划

### M0. 需求冻结与基线确认

**目标**：统一范围，冻结当前行为基线。

**产出**：

- 终端展示行为清单
- 现有 xterm / thinking block 的状态图
- 关键 bug 清单
- 回归测试清单

**验收标准**：

- 能明确指出当前展示效果的 3~5 个核心问题
- 能回放一条完整输入 -> 思考 -> 展开 -> 收起流程

---

### M1. 终端宿主抽象

**目标**：把“进入 shell 面板 / 退出 shell 面板”的逻辑抽离成独立协调层。

**任务**：

- 抽出 terminal session host
- 定义持久与非持久会话模式
- 统一快捷键进入 / 退出逻辑
- 规范状态恢复流程

**验收标准**：

- 面板切换不破坏 shell 状态
- 主 UI 与终端展示互不污染

---

### M2. 思考块状态机重构

**目标**：将 thinking block 从“多处判断”升级为“单一状态机”。

**任务**：

- 设计 block 元数据结构
- 定义状态迁移
- 统一 block 注册、查找、持久化
- 将展开/收起动作统一入口

**验收标准**：

- 折叠 / 展开 / 收起三态可稳定切换
- 会话恢复后仍能找到历史 block
- 编号不会错乱

---

### M3. 展示渲染改造

**目标**：把 overlay 主路径升级为块级重绘主路径。

**任务**：

- 局部刷新策略统一
- 可见区域布局预估
- 展开后占位与回收逻辑优化
- 处理滚动与锚点漂移

**验收标准**：

- 展开不覆盖后续内容
- 收起不留下空白
- 滚动后仍能准确定位 block

---

### M4. 历史回放与实时流统一

**目标**：历史回放和实时输出共用同一套 block 模型。

**任务**：

- 统一 transcript 与 live stream 数据格式
- 分离紧凑回放 / 完整回放
- 增加回放模式标识
- 对 sessionStorage 恢复进行一致化处理

**验收标准**：

- 历史内容不重复、不串台
- 回放模式下的展开状态可预测

---

### M5. Prompt / Memory / Terminal 三方联动

**目标**：建立展示层和 prompt 层的上下文闭环。

**任务**：

- 让 prompt builder 输出可解释摘要
- 将当前展示态纳入上下文调试信息
- 统一 turn metadata
- 为调试提供一键导出报告

**验收标准**：

- 终端看到的状态与 prompt 构建报告一致
- 能快速追踪某轮输出为何被截断或折叠

---

### M6. 稳定性与体验收敛

**目标**：全链路打磨。

**任务**：

- 性能优化
- 内存泄漏检查
- 热更新兼容
- 视图切换兼容
- 快捷键冲突处理

**验收标准**：

- 长会话不崩溃
- 多轮展开/收起无明显错位
- 体验与 Claude Code 接近

---

## 12. 风险点与规避方案

### 12.1 风险：buffer 行号与实际视觉位置不同步

**规避**：

- 优先 marker
- 增加 block snapshot
- 避免以单一行号作为最终定位依据

### 12.2 风险：局部 overlay 残留

**规避**：

- 统一清理入口
- 每次展开前先检查已有展开状态
- 收起时强制回收相关装饰和插入行

### 12.3 风险：历史回放与实时流冲突

**规避**：

- 分离 replay / live 状态
- block 数据带版本号
- 恢复时只合并必要字段

### 12.4 风险：路由与展示逻辑继续膨胀

**规避**：

- 把路由、执行、展示三层明确分开
- 仅通过事件与状态对象传递，不直接互相操作

---

## 13. 推荐的最终交付物

建议最终形成以下交付物：

1. 终端宿主抽象服务
2. 思考块状态机服务
3. 展示渲染协调服务
4. 历史回放协调服务
5. 统一的调试 / 导出文档
6. 回归测试用例集

---

## 14. 结论

Claude Code 的终端展示本质上不是“更复杂的绘制”，而是“更稳定的会话语义 + 更清晰的状态切换”。

`zyfront-desktop` 已经拥有较好的基础：

- xterm 能力
- 思考块编号
- marker 定位
- sessionStorage 恢复
- command router / executor 分层
- prompt memory builder 的预算与报告机制

下一步的关键，不是继续堆功能，而是把这些能力统一为一个更稳定的终端展示状态机。

如果按本文的里程碑逐步推进，`zyfront-desktop` 可以在保留自身多智能体与工作台能力的同时，把终端展示体验显著拉近 Claude Code。

---

## 15. 面向实现落地的文件级改造方案

本章把前述里程碑进一步拆成“文件级任务”，方便直接进入开发排期。

### 15.1 M1 终端宿主抽象：切换与会话保持

#### 目标

把终端面板的进入、退出、会话保持、恢复逻辑从 `workbench.page.ts` 中剥离，形成独立宿主层。

#### 建议新增文件

1. `src/app/features/prototype/workbench/services/terminal-host.service.ts`
2. `src/app/features/prototype/workbench/services/terminal-session.service.ts`
3. `src/app/features/prototype/workbench/services/terminal-keybinding.service.ts`

#### 现有文件改造

- `src/app/features/prototype/workbench/workbench.page.ts`
  - 只保留页面级生命周期与 UI 绑定
  - 删除或下沉终端进入/退出、焦点恢复、面板状态切换逻辑
  - 改为调用 `TerminalHostService`

- `src/app/app.config.ts`
  - 若需要新增全局快捷键注入或平台服务注册，在这里统一提供依赖

#### 具体任务拆分

- 抽取当前 `xterm` 初始化逻辑到 `terminal-session.service.ts`
- 抽取面板开关、show/hide 状态到 `terminal-host.service.ts`
- 抽取快捷键 `Ctrl+J / Meta+J / Esc` 的注册与解绑到 `terminal-keybinding.service.ts`
- 保持 `workbench.page.ts` 只负责 ViewChild、模板状态和调用入口

#### 验收

- 终端可在页面切换后恢复
- shell / xterm 的生命周期不被 workbench 页面重建打断
- 快捷键处理不再散落在页面大组件中

---

### 15.2 M2 思考块状态机：编号、锚点、持久化统一

#### 目标

将思考块从“散落在页面逻辑中的数组 + map + marker”统一成独立管理器。

#### 建议新增文件

1. `src/app/features/prototype/workbench/services/thinking-block-manager.service.ts`
2. `src/app/features/prototype/workbench/models/thinking-block.model.ts`
3. `src/app/features/prototype/workbench/models/thinking-block-state.enum.ts`
4. `src/app/features/prototype/workbench/utils/thinking-block-serializer.ts`

#### 现有文件改造

- `src/app/features/prototype/workbench/workbench.page.ts`
  - 删除 `thinkingBlocksById`、`thinkingBlockMarkers`、`thinkingInlineExpandedRanges` 这类核心数据结构的直接维护职责
  - 改为通过 manager 暴露的方法：`registerBlock`、`toggleBlock`、`collapseBlock`、`restoreBlocks`

- `src/app/features/prototype/workbench/components/task-panel/task-panel.component.ts`
  - 若展示与思考块状态相关的任务条目，需要改为订阅 manager 的只读状态

#### 具体任务拆分

- 设计 `ThinkingBlockModel`：`id`、`sessionId`、`turnId`、`state`、`markerId`、`bufferRange`、`summary`、`collapsedRows`、`expandedRows`
- 把当前会话思考块注册、恢复、去重逻辑从页面中抽离
- 统一 sessionStorage 结构，避免多个地方各自写一份不同 schema
- 统一展开、收起、全部展开、全部收起的入口

#### 验收

- 单块展开与收起稳定
- 多轮对话下编号仍可追踪
- 刷新后可恢复已存在的思考块索引

---

### 15.3 M3 展示渲染改造：从覆盖式写回到块级重绘

#### 目标

减少 overlay 残留、滚动漂移、行号错位，统一采用可恢复的块级渲染路径。

#### 建议新增文件

1. `src/app/features/prototype/workbench/services/terminal-block-renderer.service.ts`
2. `src/app/features/prototype/workbench/services/terminal-layout.service.ts`
3. `src/app/features/prototype/workbench/services/terminal-anchor.service.ts`
4. `src/app/features/prototype/workbench/types/terminal-render.types.ts`

#### 现有文件改造

- `src/app/features/prototype/workbench/workbench.page.ts`
  - 将 `expandThinkingViaOverlay()`、`collapseThinkingInline()`、`insertVisualRowsAfterFold()` 逐步替换为渲染器调用
  - 页面仅负责触发渲染，不直接拼接 ANSI 和操作 buffer

- `src/app/features/prototype/workbench/components/sankey-diagram.component.ts`
  - 如存在与终端展示同步的图表/辅助视图，需要新增刷新钩子，避免视觉状态和终端状态不一致

#### 具体任务拆分

- 建立 `renderCollapsedBlock()`、`renderExpandedBlock()`、`renderInlineExpandedBlock()` 三个入口
- 将 ANSI 拼接、折叠尾部样式、换行估算放入 renderer
- 将 marker 解析、buffer range 推导、滚动定位放入 anchor service
- 增加“重绘前快照”和“重绘后快照”用于调试

#### 验收

- 展开时不覆盖后续内容
- 收起后不留空洞
- 多次切换后终端内容仍保持顺序正确

---

### 15.4 M4 历史回放统一：实时流与 transcript 共用模型

#### 目标

实时流和历史回放使用同一套块元数据，不再分别维护两套显示逻辑。

#### 建议新增文件

1. `src/app/features/prototype/workbench/services/session-replay.service.ts`
2. `src/app/features/prototype/workbench/services/turn-history.service.ts`
3. `src/app/features/prototype/workbench/models/turn-record.model.ts`
4. `src/app/features/prototype/workbench/models/replay-mode.enum.ts`

#### 现有文件改造

- `src/app/features/prototype/workbench/workbench.page.ts`
  - 将历史回放与实时输出拆分为不同入口，但共享同一个 `TurnRecord` 数据结构

- `src/app/features/prototype/workbench/directive-registry.ts`
  - 如果 directive 输出会被回放展示，应提供统一的可序列化结果字段

#### 具体任务拆分

- 定义 `TurnRecord`：输入、路由、执行结果、思考块引用、时间戳、来源
- 新增回放模式枚举：`live | compactReplay | fullReplay`
- 让 session replay 只负责“按模式渲染”，不负责数据转换
- 统一历史恢复、刷新、重放后的块索引重建逻辑

#### 验收

- 实时模式和回放模式输出一致
- 回放后不重复生成思考块编号
- 页面刷新后回放状态可恢复

---

### 15.5 M5 Prompt / Memory / Terminal 联动：调试上下文统一

#### 目标

让 prompt 构建、记忆层、终端展示共用同一份上下文，提升可解释性。

#### 建议新增文件

1. `src/app/core/memory/prompt-build-context.service.ts`
2. `src/app/core/memory/prompt-debug-report.service.ts`
3. `src/app/features/prototype/workbench/services/workbench-context.service.ts`
4. `src/app/features/prototype/workbench/models/workbench-context.model.ts`

#### 现有文件改造

- `src/app/core/memory/prompt-memory-builder.service.ts`
  - 增加上下文输入参数，支持把当前 turn、当前 thinking block 摘要、当前路由信息写入 build report

- `src/app/features/prototype/workbench/workbench.page.ts`
  - 在生成或切换会话时，把当前终端/块状态写入 `WorkbenchContextService`

#### 具体任务拆分

- 定义统一的 `WorkbenchContextModel`
- 将 prompt build report 与终端 block 状态绑定到同一 sessionId
- 增加 debug 导出能力：一键输出最近一轮上下文、思考块摘要、记忆桶加载状态
- 将 `MemoryTelemetryService` 的 telemetry 与终端展示状态关联

#### 验收

- 在调试面板里可以看到 prompt 与终端展示的同一轮上下文
- 能追踪某个块为什么被折叠、为什么被截断

---

### 15.6 M6 稳定性与体验收敛：清理、测试、兼容

#### 目标

解决长会话、热更新、路由切换、快捷键冲突等工程问题。

#### 建议新增文件

1. `src/app/features/prototype/workbench/services/workbench-lifecycle.service.ts`
2. `src/app/features/prototype/workbench/services/workbench-regression.service.ts`
3. `src/app/features/prototype/workbench/services/terminal-debug.service.ts`

#### 现有文件改造

- `src/app/core/route-reuse.strategy.ts`
  - 检查路由复用是否导致终端宿主状态残留
  - 必要时为 workbench 页提供显式刷新策略

- `src/app/features/prototype/collaboration/services/animation.service.ts`
  - 如果动画会影响终端阅读体验，需要加入“低动画模式”或与终端状态联动的暂停策略

- `src/app/features/prototype/collaboration/services/collaboration-state.service.ts`
  - 若协作状态影响终端展示（例如 focus / activity），需要暴露统一状态接口

#### 具体任务拆分

- 对所有新增服务补充单元测试或最小可用 spec
- 清理 `workbench.page.ts` 中的重复订阅、手动解绑、残留定时器
- 把终端相关事件统一走生命周期服务，避免组件销毁时遗漏清理
- 增加回归测试：展开/收起、路由切换、刷新恢复、长会话滚动

#### 验收

- 没有明显内存泄漏
- 长会话稳定
- 页面切换后状态一致

---

## 16. 建议的实施顺序

按依赖关系，建议优先级如下：

1. `M1 终端宿主抽象`
2. `M2 思考块状态机重构`
3. `M3 展示渲染改造`
4. `M4 历史回放统一`
5. `M5 Prompt / Memory / Terminal 联动`
6. `M6 稳定性与体验收敛`

原因是：

- 先把会话宿主稳定下来，才能谈思考块渲染
- 先把思考块状态统一，才能谈历史回放一致性
- 先把渲染与状态分离，才能做调试联动
- 最后再做稳定性收敛，收益最高
