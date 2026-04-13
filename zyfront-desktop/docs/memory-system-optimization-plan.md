# 记忆系统优化详细计划（对齐 claude-code 四分类落盘 + 做梦机制）

> 目标：参考 `E:\AGENT-ROOT\04-PROJECTS\claude-code\restored-src\src` 的记忆架构，修复当前“长期记忆未按类型落盘 / 做梦不生效”问题。  
> 记忆目录基准：`E:\AGENT-ROOT\02-AGENT-MEMORY`。

---

## 1. 对标结论（来自 claudecode 源码）

### 1.1 长期记忆类型（四分类）

`memdir/memoryTypes.ts` 明确四类：

- `user`
- `feedback`
- `project`
- `reference`

并要求：

- 记忆要带类型语义（frontmatter `type`）
- 按类型组织与检索
- 避免把可从代码/仓库推导的信息写进长期记忆

### 1.2 自动触发链路（关键）

- 每轮结束触发 Extract（有 gate + 节流 + 去重 + 并发保护）
- 周期触发 AutoDream（时间阈值 + 会话数阈值 + 扫描节流 + 锁）
- 成功后会反馈“已保存/已改进记忆”

### 1.3 目录与安全约束

- 写入路径必须在 memory root 白名单内
- 防路径穿越、防并发冲突
- 有状态文件（游标、锁、最近 consolidation 时间）支持可恢复执行

---

## 2. 当前 zyfront 现状与问题清单

## 2.1 已具备能力

- 有 pipeline 框架：`extract / session / dream`
- 有 gate/config/telemetry 基础
- 已能持续写短期记忆到 `01-Short-Term`

## 2.2 关键缺口（需优化）

### A. 长期记忆未实现“四分类按目录落盘”

当前 `ExtractService` 只写 `agent-short-term`，未将每轮有效长期知识路由到：

- `02-Long-User`
- `03-Long-Feedback`
- `04-Long-Projects`
- `05-Long-Reference`

结果：长期目录中缺少随对话增长的结构化记忆文件。

### B. 缺少“类型判定 + 去重/合并”策略

当前无稳定的“候选记忆 -> 类型判定 -> 同主题合并更新”流程，易造成：

- 不该进长期的信息进入长期
- 应更新旧记忆时反复新增新文件

### C. 做梦机制触发条件与状态设计不完善

`AutoDreamService` 当前问题：

1. `recentSessionIds` 仅内存集合，重启丢失；
2. `minSessions` 默认 5，但工作台通常单 session，长期达不到；
3. 仅写 `agent-long-user/AUTO_DREAM.md`，未真正对四类长期记忆做 consolidation；
4. 缺少“上次扫描会话基线”持久化，导致评估质量偏低。

### D. 团队同步仍为 stub

`TeamMemorySyncService` 目前是占位逻辑（telemetry + 时间戳），未完成真实 pull/push，影响协作场景一致性。

### E. 缺少统一索引与可观测文件

目前没有完整的长期记忆索引体系（topic/time/index），难以：

- 查询某类型最新记忆
- 校验重复与陈旧
- 评估 dream 的归并收益

---

## 3. 目标架构（本项目落地版本）

## 3.1 目录映射（严格对齐 `02-AGENT-MEMORY`）

- `01-Short-Term`：轮次摘要（短期）
- `02-Long-User`：`type=user`
- `03-Long-Feedback`：`type=feedback`
- `04-Long-Projects`：`type=project`
- `05-Long-Reference`：`type=reference`
- `07-Meta`：状态、索引、锁、dream 元数据

## 3.2 每轮流水线（目标）

1. 收集本轮新增消息（基于 cursor）
2. 提取候选记忆事实（候选条目）
3. 分类到四类型之一（或丢弃）
4. 去重与合并（命中既有主题则 update，不命中则 create）
5. 写入对应长期目录 + 更新 `07-Meta` 索引
6. 触发 team sync（若启用）

## 3.3 做梦流水线（目标）

1. 满足 gate（开关/时间/会话数/扫描节流）
2. 获取锁
3. 扫描四类长期目录
4. 执行 consolidation（合并重复、压缩冗余、标记过时）
5. 回写四类目录 + 更新索引 + 更新 dream state
6. 释放锁并记录 telemetry

---

## 4. 详细实施计划（分阶段）

## Phase 0：基线与开关修正（1 天）

### 改动点

- `memory.config.ts`
  - 新增/调整 dream 默认：
    - `minSessions` 下调（建议默认 1 或 2）
    - 增加 `minTurns`（替代单纯 session 数）
- `auto-dream.service.ts`
  - 将 `recentSessionIds`、`lastProbeAtMs` 持久化到 `07-Meta/.dream.state.json`

### 验收

- 单 session 连续对话也能在阈值内触发 dream 评估（不再“永不触发”）

---

## Phase 1：四分类长期记忆落盘（核心，2~3 天）

### 新增组件

- `core/memory/long-term/long-term-classifier.service.ts`
  - 输入：turn messages
  - 输出：`MemoryCandidate[]`（含 `type`、title、body、confidence）

- `core/memory/long-term/long-term-writer.service.ts`
  - 将候选按 type 写入四目录：
    - user -> `agent-long-user`
    - feedback -> `agent-long-feedback`
    - project -> `agent-long-project`
    - reference -> `agent-long-reference`

- `core/memory/long-term/long-term-dedupe.service.ts`
  - 指纹/主题匹配
  - 命中旧记忆时 update（而非无限 create）

### 修改组件

- `extract.service.ts`
  - 保留短期写入
  - 新增长期分流调用：`classifier -> dedupe -> writer`

### 文件规范

每条长期记忆建议 `*.md` + frontmatter：

```md
---
name: <slug>
description: <one-line>
type: user|feedback|project|reference
createdAt: <ISO>
updatedAt: <ISO>
sourceSession: <sessionId>
sourceTurn: <turnId>
---

<正文，feedback/project 带 Why/How to apply>
```

### 验收

- 每轮至少尝试长期提取
- 命中长期候选时，文件落在正确目录
- 四目录均可被实际写入（非样例文件）

---

## Phase 2：Meta 索引系统（1~2 天）

### 新增

- `07-Meta/topic-index.json`
- `07-Meta/time-index.json`
- `07-Meta/manifest.json`
- `07-Meta/MEMORY.md`

由服务统一维护：

- 新建/更新长期记忆后同步更新索引
- 记录 type、path、updatedAt、fingerprint、status(active/stale)

### 验收

- 可以按 type 与时间查询记忆
- 索引与磁盘文件一致性可校验

---

## Phase 3：做梦机制实装（2 天）

### 改造 `auto-dream.service.ts`

当前仅写 `AUTO_DREAM.md`，需升级为：

1. 扫描四类长期目录
2. 识别重复主题和过时条目
3. 执行合并策略：
   - 相近主题合并为一条
   - 旧条目标记 `stale` 或归档
4. 更新 meta 索引
5. 输出 dream 报告到：`07-Meta/dream-reports/YYYY-MM-DDTHH-mm-ss.md`

### 阈值策略（建议）

- 时间阈值：默认 24h
- 会话阈值：默认 1
- turn 阈值：新增默认 20
- 扫描节流：10min

### 验收

- 达阈值后可稳定触发 dream
- dream 后长期记忆总量下降或信息密度提升（可量化）

---

## Phase 4：团队同步与可观测性（并行 1~2 天）

### 改造 `team-memory-sync.service.ts`

- 从 stub 升级为真实 pull/push（可先本地 mock）
- 永久失败 suppression + 手动重试

### 可观测增强

- Pipeline 状态页增加：
  - 每轮长期候选数
  - 分类命中率
  - 去重命中率
  - dream 触发/跳过原因分布

---

## 5. 需要回收的临时方案

为快速修复“长期文件为空”曾加入单文件追加逻辑（`PROJECT-LONG-TERM-MEMORY.md`）。

在 Phase 1 完成后应：

- 迁移该文件内容到 `04-Long-Projects` 标准条目
- 下线“单文件全量日志式追加”路径

避免和四分类体系冲突。

---

## 6. 风险与防护

- **风险：误分类**
  - 防护：低置信度不落长期，仅入短期；支持人工纠正
- **风险：重复膨胀**
  - 防护：指纹 + 主题近似匹配 + dream consolidation
- **风险：写入冲突**
  - 防护：目录级锁（dream lock）+ 单条写原子化
- **风险：性能回退**
  - 防护：每轮候选上限、增量扫描、节流

---

## 7. 验收标准（Definition of Done）

1. 连续 10 轮对话后：
   - `02/03/04/05-Long-*` 均有新增或更新记录（视内容而定）
2. 任意一次 dream 达阈值运行后：
   - 有 dream report
   - `07-Meta` 索引更新时间推进
3. UI 可看到：
   - extract/session/dream 的真实触发结果与跳过原因
4. 重启应用后：
   - dream 状态不丢失（阈值与计数连续）

---

## 8. 建议实施顺序（最小风险）

1. Phase 0（先让 dream 能触发评估）
2. Phase 1（四分类落盘，核心价值）
3. Phase 2（索引与治理）
4. Phase 3（dream 真正做 consolidation）
5. Phase 4（团队同步完善）

---

## 9. 关联源码参考（已对照）

- `claude-code/restored-src/src/memdir/memoryTypes.ts`
- `claude-code/restored-src/src/MEMORY_SYSTEM_ARCHITECTURE_ZH.md`
- `zyfront-desktop/src/app/core/memory/extract/extract.service.ts`
- `zyfront-desktop/src/app/core/memory/dream/auto-dream.service.ts`
- `zyfront-desktop/src/app/core/memory/memory.config.ts`
- `zyfront-desktop/src/app/core/memory/memory.scheduler.ts`

