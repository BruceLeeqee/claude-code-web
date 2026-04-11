# 记忆与自动做梦：参考实现对比、现状与演进计划

本文档对照 **分层记忆设计说明**（如 `AGENT-ROOT/00-HUMAN-TEMP/prompt.md` 中的会话 / 短期 / 长期与四类长期桶）、**Claude Code 风格参考源码**（`E:\claude-code\restored-src\src\services\` 下的 `autoDream`、`extractMemories`、`SessionMemory` 等），以及 **zyfront-desktop** 当前实现，说明机制是否一致、差距在哪，并给出可执行的优化路线图。模型配置页已暴露做梦相关参数（见下文「UI 与持久化」）。

---

## 1. 三层对照总览

| 维度 | 设计 / 参考意图 | zyfront-desktop 现状 | 一致性 |
|------|-----------------|----------------------|--------|
| **短期记忆** | 回合级摘要，可建索引 | `ExtractService` 写入 `agent-short-term` 下 JSON + `MEMORY.md` 索引行 | **路径与「每轮后写入」语义一致**；内容为本地拼接摘要，**非**参考里的 fork LLM 抽取 |
| **会话记忆** | 当前会话滚动上下文或侧车文件 | `SessionMemoryService` 写 `agent-context/sessions/{sessionId}.md` | **有会话侧车文件**；未实现参考中的 token / tool-call 动态阈值门控 |
| **长期记忆** | 多桶（用户/反馈/项目/参考）+ 07-Meta 索引 | 做梦输出写在 `agent-long-user/AUTO_DREAM.md`；`memory.query` 等走 07-Meta 索引（见 core providers） | **索引与目录键**与 Vault 布局对齐；**自动做梦未**写入四类长期 JSON 或调用 manifest 重建 |
| **做梦（巩固）** | 间隔 + 多会话门控 + 锁 + 子代理用工具整理/清理 | `AutoDreamService`：`minHours`（读 `.dream.state.json`）、`minSessions`（进程内 Set）、`scanThrottleMinutes`、`.dream.lock`、追加 Markdown 摘要 | **门控与锁、时间戳持久化**部分对齐；**无 fork LLM、无 consolidation prompt、无工具白名单** |

---

## 2. 短期 / 长期文件管理：对不对？

### 2.1 短期（extract）

- **做得对的**：每轮（受 `everyNTurns` 与 gate 控制）把本轮新消息切片生成摘要，写入 Vault 内 **短期目录**（`directory.config.json` 的 `agent-short-term`），并维护 `MEMORY.md` 时间线索引，与「回合后 extract」一致。
- **与参考的差距**：参考 `extractMemories` 通常为 **子代理 + 受控工具** 写入结构化记忆；本机为 **确定性文本摘要**，不产出参考同构的 memory 条目类型。

### 2.2 会话（session）

- **做得对的**：按 `sessionId` 追加块到 `agent-context/sessions/*.md`，符合「会话级侧车」。
- **与参考的差距**：`MemoryConfigService` 中 `session.minTokenDelta` / `minToolCalls` **尚未接入** `SessionMemoryService`（`TurnContext` 当前无 token / tool-call 计数）；参考 `sessionMemory` 会按动态配置决定何时抽取。

### 2.3 长期与索引

- **做得对的**：长期桶与 07-Meta 由 `DirectoryManager` / `directory.config.json` 与 `zyfront-core.providers` 中 `memory.query` 等工具路径描述对齐。
- **做梦输出位置**：`AUTO_DREAM.md` 放在 **长期用户目录**（`agent-long-user`）是合理的产品选择；与设计文档「巩固不写全新知识、只整理」相比，当前实现是 **轻量日志式摘要**，尚未做到「整理四类长期 + 索引更新」。

---

## 3. 做梦机制：与参考源码是否一致？

### 3.1 已对齐或接近的部分

- **时间门控**：参考侧依赖「上次巩固时间」；zyfront 使用 Vault 内 **`02-AGENT-MEMORY/07-Meta/.dream.state.json`** 的 `lastConsolidatedAtMs`，应用重启后仍有效（优于仅内存 `lastRunAtMs`）。
- **节流**：参考有 `SESSION_SCAN_INTERVAL`（如 10 分钟）；zyfront 使用可配置的 **`scanThrottleMinutes`**（默认 10），限制做梦管线评估频率。
- **锁文件**：`.dream.lock` 防止并发；失败路径会 **尽力清空锁**。
- **默认阈值**：`minHours: 24`、`minSessions: 5` 与参考 GrowthBook 默认值方向一致（产品可在模型页改）。

### 3.2 仍不一致的核心差距

| 项目 | 参考（autoDream） | zyfront |
|------|-------------------|---------|
| **巩固主体** | fork 子代理 + `buildConsolidationPrompt` + 受限工具 | 本地拼接 `buildDreamSummary`，无 LLM |
| **会话数统计** | 基于会话存储 / `listSessionsTouchedSince`（可跨进程、跨重启） | **`recentSessionIds` 仅进程内**；重启后需重新累积 |
| **其他门控** | Kairos、remote、auto-memory 等特性开关 | 仅 `MemoryGatesService` 的 enabled / dream.enabled |
| **产出** | 对长期记忆与索引的 **整理 / 去重 / 清理** | 向 `AUTO_DREAM.md` **追加**调试式摘要 |

结论：**机制上属于「简化版做梦」**——门控与持久化时间轴在向参考靠拢，但 **语义上不等价**于参考的 LLM 巩固任务。

---

## 4. UI 与持久化（已实现）

- **模型配置页**：区块「记忆管道与自动做梦」可配置：
  - 记忆管道总开关 `enabled`
  - `dream.enabled`、`dream.minHours`、`dream.minSessions`、`dream.scanThrottleMinutes`
- **localStorage**：`zyfront:memory-pipeline-config-v1`，由 `MemoryConfigService.applyPartial` / `resetToDefaults` 读写。
- **Vault**：`.dream.state.json`（巩固时间）、`AUTO_DREAM.md`（摘要）、`.dream.lock`（锁）。

---

## 5. 优化路线图（按优先级）

### 阶段 A — 低风险、高可读性（1–2 天）

1. **会话计数持久化（可选）**  
   - 在 `.dream.state.json` 中增加 `sessionIdsSinceConsolidation: string[]`（或只存 count + hash），在每轮 `run` 开头合并当前 `sessionId`，成功巩固后清空。  
   - 避免仅进程内 Set 导致重启后行为与参考差异过大。

2. **遥测与可观测性**  
   - 在 UI 或开发者面板暴露最近一次做梦 `skip_reason`（已有 telemetry 事件时可绑定）。

3. **文档与提示**  
   - 模型页文案已说明进程内 `minSessions` 含义；若实现 A1，改为「自上次巩固以来的会话集合」。

### 阶段 B — 与参考行为对齐（中等工作量）

4. **Session 门控**  
   - 扩展 `TurnContext`：带上本轮 `tokenDelta`、`toolCallCount`（工作台发 turn 时填入）。  
   - `SessionMemoryService` / gate 读取 `memory.config` 的 `minTokenDelta`、`minToolCalls`。

5. **Extract 可选 LLM 模式（开关）**  
   - 默认保持本地摘要；开启时走 IPC 调用当前模型配置，模仿 `extractMemories` 的 fork 流程（需注意成本与超时）。

### 阶段 C — 真·巩固（大功能）

6. **Dream 子任务**  
   - 使用与参考类似的 consolidation 提示词 + 允许 `memory.*` / 只读长期路径的工具集，在 Electron 主进程或专用 runner 中执行，写回四类长期与 07-Meta（或触发 `build-manifest`）。  
   - 与 `TeamMemorySyncService`、锁、以及失败重试策略统一设计。

7. **特性门控**  
   - 按需引入 remote-only、计划任务窗口等，与产品策略一致即可。

---

## 6. 验证清单

- [ ] 修改模型页做梦参数后，重启应用，`MemoryConfigService` 仍读取同一 localStorage。  
- [ ] 成功做梦后 `07-Meta/.dream.state.json` 更新，且 `minHours` 内不再触发写 `AUTO_DREAM.md`。  
- [ ] 并发两轮对话：第二路看到 `lock_held` 或顺序执行，且无残留锁（异常路径手动测）。  
- [ ] `dream_scan_throttled` 在节流窗口内出现，符合 `scanThrottleMinutes`。

---

## 7. 相关源码索引（zyfront-desktop）

- `src/app/core/memory/memory.config.ts` — 默认与 localStorage 持久化  
- `src/app/core/memory/memory.scheduler.ts` — turn 结束顺序：extract → session → dream  
- `src/app/core/memory/dream/auto-dream.service.ts` — 做梦实现  
- `src/app/core/memory/extract/extract.service.ts` — 短期写入  
- `src/app/core/memory/session/session-memory.service.ts` — 会话文件  
- `src/app/features/prototype/models/models.page.*` — 模型配置 UI  

---

*文档版本：与「模型配置页记忆管道区块」及 `AutoDreamService` 状态文件逻辑同步维护。*
