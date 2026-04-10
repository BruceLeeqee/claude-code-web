# 上下文管理与记忆/压缩系统复刻指南（对标 ClaudeCode）

> 参考源码：`E:\claude-code\restored-src\src`
>
> 对标项目：`zyfront-core` + `zyfront-desktop`
>
> 目标：系统梳理并给出可落地的“上下文 + 记忆 + 压缩”复刻方案

---

## 1. 范围与结论

本文聚焦三条主线：

1. **上下文管理（Context Management）**
2. **记忆系统（Session/Short-term/Long-term/Dream）**
3. **压缩系统（Manual/Auto/Partial compact）**

### 结论（先看）

当前 `zyfront` 已具备：
- 基础上下文与历史存储（`ContextManager` / `HistoryStore`）
- 基础消息压缩（按条数截断）
- 桌面端三级记忆流水线雏形（extract/session/dream）

但与 ClaudeCode 的生产级方案相比，关键差距在：
- 压缩仍偏“截断”，缺少“语义总结 + 边界标记 + 附件回注 + 链路修复”
- 记忆抽取尚未深度绑定“token 增量 + tool call 阈值 + forked agent 提取”
- 上下文与压缩、记忆之间的统一状态机和观测闭环不足

---

## 2. ClaudeCode 架构梳理（参考实现）

## 2.1 上下文管理主干

关键模块（参考）：
- `services/compact/autoCompact.ts`
- `services/compact/compact.ts`
- `services/SessionMemory/sessionMemory.ts`

核心思想：
1. **以 token 预算驱动上下文治理**，不是仅按消息条数。
2. **自动压缩由阈值、buffer、保护策略控制**，并内置失败熔断（circuit breaker）。
3. **压缩后不是简单删历史**，而是构造：
   - compact boundary
   - summary message
   - messagesToKeep（可选）
   - 关键附件回注（文件、计划、技能、工具指令差量）

## 2.2 记忆系统主干

`services/SessionMemory/sessionMemory.ts` 体现了：
- 后采样 hook 驱动（post-sampling）
- 阈值触发（初始化阈值 + 更新阈值 + tool calls 阈值）
- 使用 forked subagent 进行记忆提取与更新
- 严格工具权限（仅允许编辑 session memory 文件）

这使“记忆更新”不会污染主对话上下文，也避免高风险工具行为。

## 2.3 压缩系统主干

`compact.ts + autoCompact.ts` 提供三类能力：

1. **全量压缩（compactConversation）**
- 先 summarize 旧消息
- 再重建 post-compact message list
- 处理中断、超长、重试、PTL（prompt-too-long）降载

2. **局部压缩（partialCompactConversation）**
- 围绕 pivot 进行 `from/up_to` 定向总结
- 尽量保留可缓存前缀

3. **自动压缩（autoCompactIfNeeded）**
- 按模型上下文窗口与 buffer 触发
- 支持 SessionMemory 优先压缩实验分支
- 失败连续计数，超过阈值后停止自动重试

---

## 3. zyfront 当前实现梳理

## 3.1 zyfront-core：上下文与压缩

### A. ContextManager
文件：`zyfront-core/src/context/index.ts`

现状：
- 支持 `load/save/patch`
- 支持消息增删改查
- 支持 `buildWindow(maxTokens)`（字符估算 token）

优点：
- 抽象清晰、可扩展

不足：
- 未与压缩结果（boundary/summary）建立显式协议
- token 估算较粗（仅 CJK/Latin 因子）

### B. HistoryStore
文件：`zyfront-core/src/history/index.ts`

现状：
- InMemory + Persistent 两种实现
- 持久化版本迁移（v1->v2）

优点：
- 存储层干净

不足：
- 尚未承载 compact metadata（如 preservedSegment、compact reason）

### C. SessionCompactor
文件：`zyfront-core/src/compact/index.ts`

现状：
- 按消息条数截断
- 支持 autoCompactPolicy（max->compactTo）

优点：
- 成本低、实现简单

不足：
- 无语义摘要
- 无边界消息
- 无附件回注
- 无 PTL 退避与重试机制

## 3.2 zyfront-desktop：记忆流水线

相关文件：
- `memory.orchestrator.ts`
- `memory.scheduler.ts`
- `extract/extract.service.ts`
- `session/session-memory.service.ts`
- `dream/auto-dream.service.ts`
- `memory.gates.ts` / `memory.config.ts`

现状：
- 已有 extract/session/dream 三段 pipeline
- gate + telemetry + lock 机制已有雏形
- 可写入 vault 分桶目录

优点：
- 分层合理，接近可生产形态

不足：
- gate 条件偏静态，缺少与实际 token/tool call 深度联动
- extract 目前基于规则摘要，不是 LLM 子代理总结
- session memory 仍是模板化 append，不是“可编辑结构化记忆文件”
- 与 `zyfront-core` 的 compact 决策耦合较弱

---

## 4. 对照差距矩阵（ClaudeCode vs zyfront）

| 能力 | ClaudeCode | zyfront现状 | 差距等级 |
|---|---|---|---|
| Token驱动自动压缩 | 完整（阈值+buffer） | 基础（条数阈值） | 高 |
| 语义压缩摘要 | 有（LLM summarize） | 无 | 高 |
| Compact boundary | 有 | 无 | 高 |
| 部分压缩 | 有（from/up_to） | 无 | 高 |
| PTL重试降载 | 有 | 无 | 高 |
| 自动压缩熔断 | 有 | 无 | 中高 |
| Session memory hook化 | 有 | 桌面侧有简化版 | 中 |
| Forked agent提取记忆 | 有 | 无 | 中高 |
| 压缩后附件回注 | 有 | 无 | 高 |
| Prompt cache联动 | 有 | 初步（prompt工程） | 中高 |

---

## 5. 目标复刻架构（建议）

## 5.1 总体分层

1. **L0 存储层**
- `HistoryStore`
- `ContextStore`
- `MemoryVaultStore`

2. **L1 上下文治理层**
- `TokenBudgetService`
- `ContextWindowPlanner`
- `CompactionPolicyEngine`

3. **L2 压缩执行层**
- `CompactService`（full/partial/auto）
- `CompactSummaryAgent`（forked）
- `PostCompactRehydrator`（文件/计划/技能/工具说明回注）

4. **L3 记忆层**
- `SessionMemoryService`
- `MemoryExtractionService`
- `DreamConsolidationService`

5. **L4 观测与控制层**
- `MemoryTelemetry`
- `CompactMetrics`
- `FeatureFlags + CircuitBreaker`

## 5.2 关键数据结构（建议新增）

```ts
interface CompactBoundaryMeta {
  mode: 'manual' | 'auto' | 'partial';
  preCompactTokens: number;
  summarizedMessages: number;
  preservedHeadUuid?: string;
  preservedTailUuid?: string;
  compactAt: number;
}

interface CompactionResultV2 {
  boundaryMessage: ChatMessage;
  summaryMessages: ChatMessage[];
  keptMessages: ChatMessage[];
  attachments: ChatMessage[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreateTokens?: number;
  };
}
```

---

## 6. 详细复刻实施计划

## Phase A（优先级 P0）：压缩能力升级（2~3 周）

### A1. Token 预算与阈值
- 新增 `token-budget.service.ts`
- 参考 `autoCompact.ts` 引入：
  - `effectiveContextWindow`
  - `autoCompactThreshold`
  - warning/error/blocking 阈值

### A2. 语义压缩主流程
- 在 `zyfront-core/src/compact/` 新增：
  - `compact-v2.ts`
  - `compact-prompt.ts`
  - `compact-boundary.ts`
- 用 LLM summarize 替换纯条数裁剪

### A3. 自动压缩状态机
- 增加 `AutoCompactTrackingState`
- 增加连续失败熔断

### A4. 先保持回退
- 保留现有 `SessionCompactor` 作为 fallback
- feature flag：`compact.v2.enabled`

验收：
- 超上下文时可自动压缩并继续对话
- 有 boundary + summary 可追溯
- 压缩失败不会死循环

## Phase B（优先级 P1）：记忆系统与 compact 联动（1~2 周）

### B1. 统一触发入口
- 在 assistant turn 完成后统一调用：
  - `memoryOrchestrator.runOnTurnCompleted()`
  - `autoCompactIfNeeded()`

### B2. Extract 升级为子代理提取
- 当前规则摘要 -> forked summarizer
- 输出结构化片段（facts/decisions/open-issues）

### B3. Session Memory 升级
- 从 append 文本改为“可编辑块化 markdown”
- 支持定位更新，而非每次追加

### B4. Dream 归并增强
- 跨 session 聚合主题
- 引入基础去重与冲突合并策略

验收：
- memory 文件结构稳定
- 可持续增量更新而不是无限膨胀
- 与 compact 后上下文一致

## Phase C（优先级 P2）：部分压缩与后注入恢复（1~2 周）

### C1. partial compact
- 实现 `from` / `up_to` 两种方向
- 优先保留可缓存前缀

### C2. post-compact rehydration
- 回注清单：
  - 最近关键 read 文件
  - 当前 plan
  - invoked skills
  - 工具/指令差量

### C3. 上下文链路修复
- 为保留段建立 anchor/head/tail 元数据

验收：
- partial compact 可控
- 压缩后模型不丢关键执行上下文

## Phase D（优先级 P3）：观测、测试、运维（持续）

### D1. 指标
- compact 次数、成功率、重试率、熔断次数
- pre/post token 变化
- memory 写入量与增速

### D2. 测试
- 单测：阈值、状态机、路径安全
- 集成：长对话 -> 自动压缩 -> 连续对话不中断
- 回归：stream/non-stream 一致性

### D3. 运维开关
- `compact.v2.enabled`
- `memory.extract.llm.enabled`
- `memory.session.block-edit-mode`

---

## 7. 目录级改造建议（落地）

```text
zyfront-core/src/
  compact/
    index.ts                # 保留旧实现出口
    compact-v2.ts           # 新语义压缩主流程
    auto-compact-v2.ts      # token阈值+熔断
    partial-compact.ts
    compact-boundary.ts
    compact-prompt.ts
    post-compact-rehydrate.ts
  context/
    index.ts
    token-budget.ts
    context-window-planner.ts
  memory/
    orchestrator.ts         # 可与desktop对齐后上移core
    extract-agent.ts
    session-memory.ts
    dream-consolidator.ts
```

---

## 8. 与当前代码的映射关系（关键）

- `zyfront-core/src/compact/index.ts` → 保留为 fallback，新增 v2 路径
- `zyfront-desktop/src/app/core/memory/*` → 逐步下沉到 core（或定义共享协议）
- `zyfront-core/src/assistant/index.ts` → 加入“turn complete hooks”：
  - token usage回填
  - memory pipeline触发
  - auto compact触发

---

## 9. 验收标准（Definition of Done）

1. 超长会话下，系统可自动压缩并继续稳定对话（无循环失败）
2. 压缩后存在可追溯边界消息与摘要消息
3. 记忆系统可增量更新，且具备去重/节流
4. stream 与 non-stream 在 compact/memory 行为一致
5. 有完整观测指标与开关，可灰度可回滚

---

## 10. 建议的首批任务单（可直接执行）

1. 在 `zyfront-core` 增加 `auto-compact-v2.ts`（阈值、buffer、熔断）
2. 在 `zyfront-core` 增加 `compact-v2.ts`（summary + boundary + result）
3. 在 `assistant/index.ts` 挂接 compact v2（feature flag）
4. 在 desktop memory pipeline 增加 token/tool-call gate 输入
5. 增加 `docs/compact-memory-observability.md` 指标文档与埋点清单

---

## 11. 补充说明

- 你当前做的 prompt 工程（section + language + global config）是正确方向。
- 下一阶段要把“提示词工程”与“上下文治理（compact/memory）”闭环起来：
  - Prompt 提供规则
  - Compact 控制上下文体积
  - Memory 承接长期语义
- 三者协同后，才能接近 ClaudeCode 在长会话场景中的稳定性与成本控制能力。
