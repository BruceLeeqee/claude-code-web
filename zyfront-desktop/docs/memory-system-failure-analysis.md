# 记忆系统故障分析文档

> 结论先行：当前 `zyfront-desktop` 的记忆系统并不是“完全没有实现”，而是 **记忆写入链路、做梦调度链路、目录映射链路、状态文件链路和可观测性链路没有形成稳定闭环**。因此表现出来像是“记忆没有更新”“做梦系统无效”“记忆系统没有运行”。

---

## 1. 问题现象

当前观察到的现象包括：

1. 对话结束后，长期记忆文件没有明显新增或更新。
2. 做梦系统没有产生 consolidation 结果，也没有看到归档或压缩痕迹。
3. 记忆管线相关服务似乎存在，但整体表现像是没有运行。
4. 有时 prompt 构建仍能读取到一些记忆层，但无法证明记忆有被持续写回。
5. 记忆 telemetry、状态文件、锁文件即使存在，也没有形成可见的运行闭环。

---

## 2. 已有实现概况

从当前代码来看，记忆系统已经拆成了几层：

### 2.1 写入层

- `src/app/core/agent-memory.service.ts`
- `src/app/core/memory/session/session-memory.service.ts`
- `src/app/core/memory/dream/auto-dream.service.ts`

### 2.2 调度层

- `src/app/core/memory/memory.orchestrator.ts`
- `src/app/core/memory/memory.scheduler.ts`
- `src/app/core/memory/memory.gates.ts`

### 2.3 配置层

- `src/app/core/memory/memory.config.ts`

### 2.4 读取/构建层

- `src/app/core/memory/prompt-memory-builder.service.ts`

### 2.5 同步层

- `src/app/core/memory/team/team-memory-sync.service.ts`

这些服务说明“系统结构是存在的”，但它们是否真正挂接到主会话流程，仍然是问题核心。

---

## 3. 故障链路总览

记忆系统要真正运行，至少需要四步：

1. 主对话流程产生 turn 结束事件。
2. turn 被送入 `MemoryOrchestratorService`。
3. `MemorySchedulerService` 根据 gate 决定是否执行 extract/session/dream。
4. 各写入器完成落盘，并更新状态、telemetry 和索引。

目前问题很可能卡在以下某一段或多段：

- turn 结束事件没有接入 memory orchestrator
- gate 条件不满足，导致所有 pipeline 被跳过
- 目录 key / 路径映射不正确，导致写入落在错误位置
- dream 状态文件或锁文件使自动做梦长期静默跳过
- telemetry 有记录，但没有可视化或没有看对位置

---

## 4. 根因分析

## 4.1 主流程缺少稳定的记忆管线接入点

### 现象

代码中有 `MemoryOrchestratorService.runOnTurnCompleted(turn)`，也有 `runNow(turn)`，但目前没有明确证据表明它已经被主会话结束逻辑稳定调用。

### 影响

如果主流程没有把每轮 turn 交给 orchestrator，那么：

- `MemorySchedulerService` 不会运行
- `SessionMemoryService` 不会追加会话记忆
- `AutoDreamService` 不会做 consolidation
- telemetry 里也不会有完整的 gate/run 记录

### 判断

这是最可能的首要根因。

---

## 4.2 配置层可能将系统静默关闭或半关闭

### 相关代码

`src/app/core/memory/memory.config.ts`

### 关键配置

- `enabled`
- `extract.enabled`
- `session.enabled`
- `dream.enabled`
- `dream.minHours`
- `dream.minSessions`
- `dream.minTurns`
- `dream.scanThrottleMinutes`

### 影响

即使主流程接入了，只要以下任一条件不满足，pipeline 也会被挡住：

- `enabled = false`
- `dream.enabled = false`
- 触发间隔过短
- 轮次不足
- session 数不足

### 说明

尤其是 dream 模块，属于多重 gate 叠加，任何一个条件不满足就会被静默跳过，因此最容易被误判为“没有运行”。

---

## 4.3 目录 key 与实际路径映射可能不一致

### 相关代码

- `DirectoryManagerService`（未在本分析中展开，但所有读写都依赖它）
- `AgentMemoryService`
- `SessionMemoryService`
- `PromptMemoryBuilderService`

### 常见 key

- `agent-short-term`
- `agent-long-user`
- `agent-long-feedback`
- `agent-long-project`
- `agent-long-reference`
- `agent-context`
- `agent-memory-index`

### 风险

如果这些 key 没有和实际 vault 目录严格对应，就会出现：

- 写入成功，但文件写到别的目录
- 读取失败，prompt 以为没有记忆
- 做梦状态文件存在，但读取不到对应长期池

### 判断

这是第二层高概率根因，尤其在目录重构后很常见。

---

## 4.4 做梦系统被状态文件、锁文件和节流机制静默阻断

### 相关代码

推断集中在 `AutoDreamService` 及其依赖的状态文件、锁文件、节流逻辑。

### 典型拦截点

- `.dream.state.json`
- `.dream.lock`
- `lastConsolidatedAtMs`
- `lastProbeAtMs`
- `turnCounter`
- `recentSessionIds`
- `scanThrottleMinutes`
- `minHours`
- `minTurns`

### 影响

只要以下任一问题存在，dream 就不会触发：

1. 上次 consolidate 太近
2. 扫描节流未到
3. 轮次累计不足
4. session 数不足
5. 锁文件未释放
6. 状态文件内容陈旧或异常

### 结论

做梦系统不是“没有”，而是很可能一直处于 `skip` 状态。

---

## 4.5 记忆写入存在，但写入形式分散，难以被直观看见

### 相关代码

- `appendProjectLongTermTurn()`
- `SessionMemoryService.run()`
- `AutoDreamService.run()`

### 写入特点

系统不是把所有记忆写到一个统一总表，而是分散到多个位置，例如：

- `agent-context/sessions/{sessionId}.md`
- `agent-long-project/PROJECT-LONG-TERM-MEMORY.md`
- `agent-long-user/AUTO_DREAM.md`

### 影响

如果检查路径不对，或者只看某一个文件，就会误以为“没有写入”。

---

## 4.6 Team Sync 仍偏 stub，不构成真正记忆协同闭环

### 相关代码

`src/app/core/memory/team/team-memory-sync.service.ts`

### 现状

当前的 `start()`、`pullNow()`、`pushNow()`、`retryNow()` 更像是“状态与 telemetry stub”，并没有看到完整的跨 Agent 记忆同步实现。

### 影响

这会让“记忆系统运行”的体感进一步变弱，因为：

- 没有真正的共享写入传播
- 没有真正的 pull/push 数据流
- 只有内部状态记录，没有外部可见结果

---

## 4.7 可观测性不足导致“跑了但看不见”

### 相关代码

- `MemoryTelemetryService`
- `MemoryOrchestratorService.getStatus()`

### 问题

即便 pipeline 实际执行了，如果前端没有：

- 状态面板
- 调试日志
- gate 结果展示
- 最近运行记录

用户仍然会觉得“系统没运行”。

### 影响

这类问题会放大上面所有其他问题的负面感知。

---

## 5. 现象与根因对照表

| 现象 | 可能根因 |
|---|---|
| 记忆没有更新 | 主流程未接入 orchestrator，或目录映射错误 |
| 做梦无效 | dream gate 未通过，或被状态/锁/节流静默挡住 |
| 系统没有运行 | 没有 turn completed 事件驱动，或 telemetry 没有曝光 |
| 看不到长期记忆变化 | 写到了分散文件，或只检查了错误路径 |
| 记忆似乎偶尔有变化 | 部分写入器独立运行，但没有统一调度闭环 |

---

## 6. 最可能的故障组合

综合当前代码结构，最可能的故障组合是：

1. **主会话 turn 没有稳定送入 memory orchestrator**
2. **dream gate 在默认配置下长期不满足条件**
3. **部分写入确实发生，但写到分散路径，肉眼不明显**
4. **team sync 仍是 stub，无法体现“系统运行”的完整效果**
5. **缺少统一的可观测 UI，导致实际状态不可见**

这也是为什么系统给人的感觉是：

> 代码有，结构有，但就是“不工作”。

---

## 7. 建议的排查顺序

### Step 1：检查配置

先确认 localStorage 中：

- `zyfront:memory-pipeline-config-v2`

看以下字段：

- `enabled`
- `extract.enabled`
- `session.enabled`
- `dream.enabled`

如果其中任意一个是 false，先修配置。

---

### Step 2：检查主流程是否调用 orchestrator

在主对话结束点搜索：

- `runOnTurnCompleted(`
- `runNow(`

如果没有，先补接入点。

---

### Step 3：检查 vault 路径映射

确认 `DirectoryManagerService` 对以下 key 的映射：

- `agent-short-term`
- `agent-long-user`
- `agent-long-feedback`
- `agent-long-project`
- `agent-long-reference`
- `agent-context`
- `agent-memory-index`

若映射错误，所有写入都会“跑偏”。

---

### Step 4：检查 dream 状态文件

重点看：

- `.dream.state.json`
- `.dream.lock`

确认：

- 锁是否遗留
- `lastConsolidatedAtMs` 是否太近
- `turnCounter` 是否达到阈值

---

### Step 5：检查 telemetry

确认最近 telemetry 中是否存在：

- `pipeline: extract`
- `pipeline: session`
- `pipeline: dream`

如果没有，说明主流程压根没跑到管线。
如果只有 `skipped`，说明 gate 在挡。

---

## 8. 结论

当前记忆系统故障的本质，不是“没有代码”，而是：

1. **缺少稳定的主流程接入**
2. **配置与 gate 太多，导致静默跳过**
3. **写入路径分散，结果不直观**
4. **做梦系统被状态文件 / 锁 / 节流机制阻断**
5. **可观测性不足，导致实际状态看不见**

因此，当前问题应该定义为：

> **记忆系统已部分实现，但未形成稳定的运行闭环。**

---

## 9. 下一步修复建议

建议按以下顺序修复：

1. 把 `MemoryOrchestratorService.runOnTurnCompleted()` 接到主对话完成回调。
2. 输出记忆 pipeline 的可视化状态面板。
3. 核对 `DirectoryManagerService` 的目录 key 映射。
4. 检查并清理 dream 状态文件与锁文件。
5. 降低或临时关闭 dream 节流，确认 consolidation 真的能触发。
6. 把 `TeamMemorySyncService` 从 stub 进一步实现为真实同步流程。

---

## 10. 建议的后续交付

如果继续推进，推荐补三个文件：

1. `docs/memory-system-debug-playbook.md`
2. `docs/memory-system-failure-analysis.md`
3. `docs/memory-system-fix-plan.md`

其中本文件已经覆盖故障分析；后两个可以分别用于排障手册和修复执行计划。
