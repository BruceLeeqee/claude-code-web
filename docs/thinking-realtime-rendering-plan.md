# Thinking 实时展示改造方案（对齐 ClaudeCode 风格）

## 1. 背景与目标

### 目标
- 在流式输出中**实时展示 `thinking_delta` 内容**（逐段追加，低延迟）。
- 默认**不展示工具调用细节**（`tool_call` / `tool_result`）给终端主视图用户。
- 保持工具链仍可执行（仅隐藏展示，不影响执行逻辑）。
- 中断后不残留上一轮 thinking/tool 片段到下一轮。

### 非目标
- 本期不做复杂富文本卡片（先文本流式可见）。
- 本期不改模型策略，仅改解析与展示链路。

---

## 2. 参考实现调研结论（`E:\claude-code\restored-src\src`）

重点参考：
- `components/messages/AssistantThinkingMessage.tsx`
  - 把 thinking 当作独立消息块渲染。
  - 非 verbose 时可折叠，verbose/transcript 时展示完整 thinking。
- 其消息体系将 `thinking` 与 `tool_use` 分离渲染，避免工具过程淹没思考信息。

可迁移原则：
1. **thinking 是一等事件**，不能塞进普通 `delta` 文本里。
2. **展示层可配置**：显示 thinking、隐藏工具调用。
3. **中断/新轮次必须清边界**，避免跨轮拼接。

---

## 3. 当前系统差异（zyfront）

### 现状
- `zyfront-core/src/api/anthropic-stream.ts`
  - 已支持 `text_delta` 与 `tool_use` 输入增量。
  - **未处理 `thinking` / `thinking_delta`**。
- `zyfront-core/src/types/index.ts`
  - `StreamChunk` 无 thinking 专用事件类型。
- `zyfront-desktop/src/app/features/prototype/workbench/workbench.page.ts`
  - 当前用 `handleStreamChunk` 渲染 `delta`/`tool_call`/`tool_result`。
  - 需要改为“thinking 可见，工具细节隐藏”。

### 400 风险相关
- 若错误把 thinking 块当 tool 块拼接，或中断后跨轮串数据，可能诱发上下文不一致。

---

## 4. 详细改造计划

## Phase A：核心协议扩展（core）

### A1. 扩展流式事件类型
文件：`zyfront-core/src/types/index.ts`
- 在 `StreamChunk` 增加：
  - `{ type: 'thinking_delta'; textDelta: string }`
  - （可选）`{ type: 'thinking_start' }`
  - （可选）`{ type: 'thinking_done' }`

建议最小实现先只加 `thinking_delta`，避免前后端大改。

### A2. SSE 累计器支持 thinking
文件：`zyfront-core/src/api/anthropic-stream.ts`
- 在 `consumeLine` 中新增分支：
  - `content_block_start` 且 `content_block.type === 'thinking'` -> 建立 thinking block state。
  - `content_block_delta` 且 `delta.type === 'thinking_delta'` -> 追加文本。
- 保留 tool_use 解析能力，但与 thinking 独立状态机。
- `finalize()` 时：
  - 将 thinking block 纳入 `assistantContentBlocks`（用于历史回放/审计）。
  - 不将 thinking 误转成 `toolCalls`。

### A3. 流式输出通道发出 thinking 事件
文件：`zyfront-core/src/api/index.ts`
- 在 `createMessageStream` 的 Anthropic 分支中：
  - 当前 `push(text)` 只发 `delta`。
  - 增加 `pushThinking(text)` 发 `thinking_delta`。
- 改造 `feedSseChunkWithLines`/累积器回调签名（或在 `AnthropicSseTurnAccumulator` 暴露 thinking hook）以传出 thinking。

---

## Phase B：Assistant 运行时与历史持久化

### B1. 透传 thinking 事件
文件：`zyfront-core/src/assistant/index.ts`
- 在 stream 转发链路中允许 `thinking_delta` 原样向上游 UI 输出。

### B2. 历史消息存储策略
- `thinking_delta` 实时仅用于 UI 渲染，不直接逐条入 history。
- 轮次结束时，从 `anthropic_turn.assistantContentBlocks` 保存 thinking 块（与文本块同轮存储）。
- 中断轮次：
  - 不写入半截 thinking 块到持久化历史（或写入时标记 interrupted）。

---

## Phase C：Workbench UI 渲染改造（desktop）

文件：`zyfront-desktop/src/app/features/prototype/workbench/workbench.page.ts`

### C1. 新增 thinking 缓冲状态
- 增加字段：
  - `private activeThinkingBuffer = ''`
  - `private lastThinkingFlushAt = 0`
- 目的：高频 delta 时做轻微节流写入（例如 30~60ms）避免 xterm 抖动。

### C2. `handleStreamChunk` 新分支
- `value.type === 'thinking_delta'`：
  - 首次到达输出头：`[Thinking]`
  - 后续仅追加 thinking 文本，不输出工具标签。
- `value.type === 'tool_call' | 'tool_result'`：
  - 不写入主终端（静默）
  - 可保留到 debug trace（内存）但默认不显式展示。

### C3. 回放与最近会话
- `replayMainSessionHistory` 与 `replayRecent`：
  - 若历史里含 thinking 块，优先渲染为 `[Thinking]` 段。
  - 不再把 `tool` 角色打印成“步骤/工具”。

### C4. 中断边界
- `Ctrl+C` 或新任务开始前：
  - 清空 `activeThinkingBuffer`。
  - 重置“是否已输出 thinking 头”的标记。
- 防止上一轮 thinking 尾巴串到新轮。

---

## Phase D：配置开关与兼容

### D1. 开关设计
建议新增设置项（默认值）：
- `ui.showThinking = true`
- `ui.showToolActivityInMainTerminal = false`

当前实现已接入 `zyfront:model-request-config-json`：
- `show_thinking` / `showThinking`（默认 `true`）
- `show_tool_activity` / `showToolActivity`（默认 `false`）

示例：
```json
{
  "max_tokens": 81920,
  "show_thinking": true,
  "show_tool_activity": false
}
```

### D2. 兼容策略
- 非 Anthropic 或不返回 thinking 的模型：保持现有 `delta` 渲染。
- 若收到未知 delta type：忽略，不抛错。

---

## 5. 验收标准（DoD）

1. 实时流中看到 `thinking_delta` 内容持续刷新。
2. 同一轮中不再出现工具调用相关显示（主终端）。
3. 工具依然实际执行成功（业务功能不回退）。
4. 用户中断后，新一轮 thinking 不带上轮残留。
5. 无新增 lint/type 错误。
6. 不再因 thinking/tool 混线导致 400（至少回归覆盖）。

---

## 6. 测试计划

### 单元测试（core）
- `anthropic-stream`：
  - 输入 `thinking` start + 多个 `thinking_delta` + stop，断言聚合正确。
  - thinking + tool_use 混合流，断言互不污染。
  - 中断流（无 stop）不产出非法 tool/thinking 拼接。

### 集成测试（assistant stream）
- 模拟 SSE 事件序列（含截图中的事件类型）：
  - `content_block_start(type=thinking)`
  - 多个 `content_block_delta(type=thinking_delta)`
  - 后续 `tool_use` 事件
- 断言 UI 收到 `thinking_delta`，且无工具展示事件落到主终端层。

### 手工回归（desktop）
- 连续提问 3 轮 + 中断 2 次。
- 切换新任务后确认 thinking 从空开始。
- 验证最近会话回放显示 thinking 片段。

---

## 7. 实施顺序与工时估算

1. Core 协议与 SSE 解析（0.5~1 天）
2. Assistant 透传与历史策略（0.5 天）
3. Workbench 渲染改造（0.5~1 天）
4. 测试与回归（0.5 天）

总计：2~3 天。

---

## 8. 风险与回滚

### 风险
- 不同模型厂商的 thinking 事件字段名不一致。
- xterm 高频写入导致卡顿。

### 缓解
- 事件解析做宽容匹配并加 feature flag。
- thinking 渲染加节流批量刷写。

### 回滚
- 通过 `ui.showThinking=false` 与旧分支渲染回退。
- 保留旧 `delta` 显示路径作为兜底。

---

## 9. 后续增强（非本期）

- Thinking 折叠/展开（对齐 `AssistantThinkingMessage` 的 verbose 体验）。
- Thinking 与最终回答分栏显示。
- 将 thinking 纳入 transcript 导出但默认脱敏。


增强目标（3 点）
Thinking 折叠/展开（默认折叠，支持 verbose 展开）
Thinking 与最终回答分栏显示（思考区 / 回答区）
Transcript 导出包含 thinking（默认脱敏）
Phase 1：Thinking 折叠/展开（1~1.5 天）
1.1 数据模型
在前端引入 ThinkingSegment：
id, turnId, content, collapsed, isStreaming, createdAt
每轮消息状态增加：
hasThinking, thinkingCollapsedByDefault, isVerboseMode
1.2 交互规则
默认：collapsed=true
当 show_thinking=false 时直接隐藏
当用户开启“verbose thinking”时：
新轮默认展开
历史轮次保持用户上次状态（本地缓存）
1.3 UI行为
折叠态显示：[Thinking] ... (Ctrl+O 展开)（或按钮）
展开态显示完整 thinking 文本（支持滚动，不挤压回答区）
流式中：
折叠态仅显示长度/活动指示
展开态实时追加文本
1.4 边界
中断后 isStreaming=false，保留当前 thinking 内容
新轮开始前清空“当前流缓存”，不影响历史轮显示
Phase 2：Thinking/Answer 分栏（1.5~2 天）
2.1 布局
将消息呈现拆成双区块：
左/上：Thinking Panel
右/下：Final Answer Panel
在窄屏下自动降级为上下堆叠（响应式）
2.2 渲染策略
thinking_delta 仅进 Thinking Panel
delta（普通正文）仅进 Answer Panel
tool_call/tool_result 默认不进主视图（可由开关决定是否显示到“活动轨迹”侧栏）
2.3 状态同步
每个 turn 有独立 panel state，避免跨轮污染
切换历史会话时按 turn 恢复分栏内容与折叠状态
2.4 性能
thinking 追加使用 30~60ms 节流 flush
长文本虚拟化或裁剪渲染，防止 xterm/DOM 卡顿
Phase 3：Transcript 导出（thinking 默认脱敏）（1~1.5 天）
3.1 导出结构
新增导出选项：
includeThinking: boolean（默认 true）
redactThinking: boolean（默认 true）
导出 JSON 建议字段：
turns[].assistant.answer
turns[].assistant.thinking（可选）
turns[].assistant.thinkingRedacted（标记）
3.2 脱敏规则（默认）
规则 1：掩码关键段（API key/token/url query 等）
规则 2：超长 thinking 截断并加摘要标记
规则 3：高风险片段（命令参数、凭据模式）替换为 [REDACTED]
3.3 导出渠道
UI导出按钮与现有 transcript 导出兼容
保持老格式可读（向后兼容）
配置与开关（统一）
在 zyfront:model-request-config-json 增加：

{
  "show_thinking": true,
  "show_tool_activity": false,
  "thinking_collapsed_by_default": true,
  "thinking_verbose_mode": false,
  "layout_split_thinking_answer": true,
  "transcript_include_thinking": true,
  "transcript_redact_thinking": true
}
验收标准（DoD）
折叠/展开在流式与历史回放都生效
Thinking 与 Answer 分栏稳定，无串流
导出文件可选包含 thinking，且默认脱敏
中断后无上轮残留
开关全可控、默认值合理
lint/type/test 通过
测试清单（最小）
连续 5 轮（含 2 次中断）检查折叠状态与分栏正确性
show_thinking=false 时完全无 thinking 输出
导出开关组合测试：
包含+脱敏
包含+不脱敏
不包含
大段 thinking（>20KB）性能测试