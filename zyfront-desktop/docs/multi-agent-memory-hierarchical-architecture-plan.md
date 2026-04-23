# 多智能体分层记忆系统最终版计划

> 本文整合两个既有方案的核心思想：
> - `docs/memory-system-optimization-plan.md`
> - `zyfront-desktop/docs/multi-agent-memory-hierarchical-architecture-plan.md`
>
> 目标是形成一份面向 `zyfront-desktop` 的最终版记忆系统计划，统一解决：
> 1. 单 Agent 到多 Agent 的记忆治理升级
> 2. 长期记忆四分类落盘与做梦机制
> 3. 共享 / 私有 / 任务 / 系统元数据的分层治理
> 4. 提示词构建的统一 Builder 化
> 5. 权限、索引、审计、归档、检索的工程化落地

---

## 1. 总目标

本计划的核心不是“把记忆拆成更多目录”，而是建立一套可持续运行的记忆治理体系，使 `zyfront-desktop` 在多智能体协作、任务推进、用户偏好保持、项目知识积累、反馈修正、历史归档方面具备稳定可扩展能力。

### 1.1 最终目标

1. **长期记忆可分类、可落盘、可检索、可合并**
   - 记忆不再只是会话内缓存，而是可持续沉淀的资产。

2. **多智能体之间记忆边界清晰**
   - 共享事实、私有经验、任务上下文、系统元数据分层治理。

3. **提示词构建统一由 Builder 控制**
   - Agent 不再自行拼接目录内容，而是消费标准化上下文卡片。

4. **做梦机制真实生效**
   - 能对长期记忆进行 consolidation、去重、压缩、归档。

5. **有可观测、可审计、可恢复的索引系统**
   - 任何记忆条目都能追溯来源、更新时间、所属范围与访问权限。

---

## 2. 统一设计原则

本计划合并两份方案后，形成四条总原则。

### 2.1 统一入口，不让下游自行拼装规则

所有记忆读取、裁剪、注入、排序、去重、引用展开，都必须经过统一 Builder，而不是在每个 Agent 内部分散实现。

### 2.2 权限优先于功能

先判断是否允许访问，再判断是否可以写入，最后才执行具体逻辑。权限控制必须同时具备：

- 应用层校验
- 文件层约束
- 锁与审计机制

### 2.3 引用优先，副本最少化

私有记忆中优先保存共享实体引用，不重复复制全文。长期事实尽量以“实体卡片 + 摘要 + 源路径”形式维护。

### 2.4 长期记忆必须可治理

长期记忆不是无限追加日志，而是一个需要：

- 分类
- 合并
- 去重
- 归档
- 版本化
- 索引维护

的有序系统。

---

## 3. 最终架构：四大逻辑域 + 统一 Builder

### 3.1 四大逻辑域

#### A. `00-SHARED-MEMORY`
全局共享池，只允许协调 Agent 或拥有写权限的系统模块写入。所有 Agent 可读。

#### B. `01-AGENTS`
Agent 私有记忆目录。每个 Agent 独立隔离，保存自身经验、短期上下文、会话历史、局部草稿。

#### C. `02-TASKS`
任务级临时记忆池。任务存在期间用于黑板协同、阶段产物、协作注记。

#### D. `03-SYSTEM-META`
系统元数据、索引、审计、权限、归档与状态文件集中治理。

---

## 4. 目录体系最终版

### 4.1 共享池

```text
03-AGENT-MEMORY/
├─ 00-SHARED-MEMORY/
│  ├─ 01-GLOBAL-KNOWLEDGE/
│  │  ├─ rules/
│  │  ├─ docs/
│  │  ├─ references/
│  │  └─ glossary/
│  ├─ 02-USER-REPOSITORY/
│  │  ├─ users/
│  │  ├─ preferences/
│  │  ├─ facts/
│  │  └─ profile-index.json
│  ├─ 03-PROJECT-CENTER/
│  │  ├─ projects/
│  │  ├─ project-topics/
│  │  ├─ project-decisions/
│  │  └─ project-index.json
│  ├─ 04-FEEDBACK-CENTER/
│  │  ├─ feedback/
│  │  ├─ feedback-index.json
│  │  └─ feedback-rules.md
│  ├─ _LOCKS/
│  ├─ _VERSIONS/
│  └─ _ARCHIVE/
```

### 4.2 Agent 私有池

```text
├─ 01-AGENTS/
│  ├─ {agent_id}/
│  │  ├─ 00-AGENT-CONFIG/
│  │  │  ├─ agent-profile.json
│  │  │  ├─ capabilities.json
│  │  │  ├─ permissions.json
│  │  │  └─ prompt-policy.md
│  │  ├─ 01-WORKSPACE/
│  │  │  ├─ drafts/
│  │  │  ├─ scratch/
│  │  │  └─ temp-links.json
│  │  ├─ 02-AGENT-MEMORY/
│  │  │  ├─ 01-SHORT-TERM/
│  │  │  ├─ 02-LONG-USER/
│  │  │  ├─ 03-CONTEXT/
│  │  │  ├─ 04-FEEDBACK/
│  │  │  ├─ 05-PROJECTS/
│  │  │  ├─ 06-REFERENCE/
│  │  │  └─ 07-META/
│  │  ├─ 03-SESSION-STATE/
│  │  │  ├─ current-session.json
│  │  │  ├─ session-history/
│  │  │  └─ session-index.json
│  │  └─ _ARCHIVE/
```

### 4.3 任务池

```text
├─ 02-TASKS/
│  ├─ {task_id}/
│  │  ├─ TASK-CONTEXT.md
│  │  ├─ TASK-METADATA.json
│  │  ├─ outputs/
│  │  ├─ blackboard/
│  │  ├─ checkpoints/
│  │  └─ _LOCK/
│  ├─ ARCHIVED-TASKS/
│  └─ task-index.json
```

### 4.4 系统元数据

```text
└─ 03-SYSTEM-META/
   ├─ AGENT-REGISTRY.md
   ├─ AGENT-REGISTRY.json
   ├─ MEMORY-INDEX.db
   ├─ MEMORY-INDEX.json
   ├─ ARCHIVE-RULES.md
   ├─ PERMISSION-MAP.json
   └─ AUDIT-LOGS/
      ├─ write-log.jsonl
      ├─ read-log.jsonl
      └─ archive-log.jsonl
```

---

## 5. 记忆类型与语义映射

### 5.1 长期记忆四分类

对齐 `memory-system-optimization-plan.md`，长期记忆必须明确四类：

1. `user`
2. `feedback`
3. `project`
4. `reference`

### 5.2 分类语义

#### user
用户偏好、用户事实、稳定性需求、交互习惯。

#### feedback
用户纠正、负反馈、模式回退、质量标准。

#### project
项目状态、里程碑、决策记录、依赖关系。

#### reference
规则、资料、文档、可复用参考、外部知识。

### 5.3 目录映射

#### `Long-User`
映射到：

- `00-SHARED-MEMORY/02-USER-REPOSITORY/`
- `01-AGENTS/{agent_id}/02-AGENT-MEMORY/02-LONG-USER/`

#### `Long-Feedback`
映射到：

- `00-SHARED-MEMORY/04-FEEDBACK-CENTER/`
- `01-AGENTS/{agent_id}/02-AGENT-MEMORY/04-FEEDBACK/`

#### `Long-Projects`
映射到：

- `00-SHARED-MEMORY/03-PROJECT-CENTER/`
- `01-AGENTS/{agent_id}/02-AGENT-MEMORY/05-PROJECTS/`

#### `Long-Reference`
映射到：

- `00-SHARED-MEMORY/01-GLOBAL-KNOWLEDGE/`
- `01-AGENTS/{agent_id}/02-AGENT-MEMORY/06-REFERENCE/`

---

## 6. 终极数据治理模型

### 6.1 私有记忆只存引用，不存副本

Agent 私有目录只保存：

- 共享实体 ID
- 源路径
- 摘要
- 访问级别
- 标签
- 必要的轻量备注

不要复制共享池全文。

### 6.2 共享池只保存单源事实

共享池中的同类信息必须保持单源维护：

- 用户偏好同一份
- 项目事实同一份
- 反馈规则同一份
- 参考资料同一份

### 6.3 任务黑板用于临时协作

任务池只做临时协作，不承载最终事实。任务完成后需提炼长期记忆并归档黑板。

### 6.4 系统元数据负责治理

所有条目必须至少包含：

- `entity_id`
- `tags`
- `access_level`
- `created_at`
- `updated_at`
- `source`
- `owner`
- `scope`

---

## 7. 统一提示词 Builder 设计

### 7.1 Builder 的职责

Builder 是唯一负责构建模型上下文的组件，职责包括：

- 读取权限判断
- 相关性排序
- 去重
- 预算裁剪
- 摘要压缩
- 引用展开
- 输出结构化上下文卡片

### 7.2 拼装顺序

统一按以下顺序构建提示词：

1. System Policy
2. Agent Identity
3. Task Context
4. Shared Facts References
5. Private Memory Summary
6. Recent Interaction
7. User Query
8. Execution Constraints

### 7.3 统一上下文输出形式

不要直接将目录树输入模型，而是输入：

- 可访问范围
- 任务黑板摘要
- 共享实体卡片
- 私有记忆摘要
- 记忆来源链接
- 执行约束

### 7.4 Builder 的预算控制

必须支持：

- token budget
- char budget
- 层级预算
- 超长摘要
- 重复内容裁剪

---

## 8. 长期记忆落盘机制

### 8.1 记忆写入流程

每轮对话结束后：

1. 收集本轮输入与输出
2. 提取候选记忆
3. 类型判定
4. 去重或合并
5. 写入对应长期目录
6. 更新索引与元数据
7. 必要时触发 team sync

### 8.2 记忆文件格式

建议统一为 `*.md + frontmatter`：

```md
---
name: <slug>
description: <one-line>
type: user|feedback|project|reference
createdAt: <ISO>
updatedAt: <ISO>
sourceSession: <sessionId>
sourceTurn: <turnId>
status: active|stale|archived
fingerprint: <hash>
---

正文内容。
```

### 8.3 去重与合并

长期记忆不得无限创建重复文件。命中同主题时优先：

- update 现有条目
- 合并相近主题
- 保留原始来源与版本历史

---

## 9. 做梦机制最终方案

### 9.1 做梦的定义

“做梦”不是简单写一个报告，而是对长期记忆进行周期性 consolidation：

- 合并重复
- 压缩冗余
- 标记过时
- 提升信息密度
- 产出可追踪的梦境报告

### 9.2 触发条件

建议综合以下阈值：

- 时间阈值：例如 24h
- 会话阈值：例如 1 或 2
- turn 阈值：例如 20
- 扫描节流：例如 10min
- 手动触发：支持显式命令

### 9.3 做梦流程

1. 检查 gate
2. 获取锁
3. 扫描四类长期目录
4. 分析重复主题与陈旧条目
5. 执行 consolidation
6. 更新索引与状态文件
7. 输出 dream 报告
8. 释放锁

### 9.4 做梦产物

建议产物包括：

- `07-Meta/dream-reports/YYYY-MM-DDTHH-mm-ss.md`
- `07-Meta/.dream.state.json`
- `07-Meta/time-index.json`
- `07-Meta/topic-index.json`

---

## 10. 索引、审计与恢复

### 10.1 索引系统

必须至少具备：

- topic index
- time index
- manifest
- memory registry
- archive index

### 10.2 审计系统

写入、读取、归档都应产生审计日志，支持后续排障与治理。

### 10.3 恢复能力

系统需要可恢复运行，至少保留：

- 最近一次 consolidation 时间
- 最近扫描游标
- 锁状态
- 失败重试信息

---

## 11. 权限与安全模型

### 11.1 权限优先于功能

访问任何记忆目录前，必须先判断：

1. 角色是否允许
2. 目录层级是否允许
3. 任务范围是否允许
4. 是否允许写共享池
5. 是否需要审计记录

### 11.2 逻辑权限与文件权限双层控制

Windows 环境下不能只依赖文件 ACL，必须由应用层再做一次校验。

### 11.3 共享写必须加锁

对共享池写入时必须加锁，避免并发冲突和脏写。

---

## 12. 分阶段实施计划

### Phase 0：目录与配置基线修正

**目标**：统一目录基线、记忆根路径、默认阈值与状态文件位置。

**产出**：

- 记忆根目录规范
- 配置默认值修订
- 状态文件规范

**验收**：

- 单 session 也能进入稳定记忆流程
- 状态文件可恢复

---

### Phase 1：四分类长期记忆落盘

**目标**：实现 `user / feedback / project / reference` 四分类写入。

**产出**：

- 分类器
- 去重器
- 长期写入器
- 长期记忆文件规范

**验收**：

- 每轮对话可写入正确类型目录
- 不再只停留在短期目录

---

### Phase 2：Meta 索引系统

**目标**：建立可查询、可追踪、可校验的索引层。

**产出**：

- topic index
- time index
- manifest
- registry

**验收**：

- 可按类型与时间查询
- 索引与磁盘一致

---

### Phase 3：做梦机制实装

**目标**：让长期记忆能自动 consolidation。

**产出**：

- dream service
- state file
- dream report
- 重复主题合并逻辑

**验收**：

- 达阈值后稳定触发
- consolidation 后信息密度提升

---

### Phase 4：团队同步与协作治理

**目标**：让多 Agent 之间的共享/私有/任务池协同起来。

**产出**：

- team sync 机制
- blackboard 协同
- 共享引用卡片

**验收**：

- 多 Agent 可通过共享实体协作
- 私有记忆不会污染共享池

---

### Phase 5：可观测性与清理

**目标**：让系统可监控、可调试、可归档。

**产出**：

- telemetry
- audit logs
- archive rules
- 清理任务

**验收**：

- 能定位某条记忆来源
- 能追踪 dream 触发原因

---

## 13. 与现有方案的合并结论

这份最终版计划合并了两份方案的核心：

### 来自 `memory-system-optimization-plan.md`

- 四分类长期记忆：`user / feedback / project / reference`
- 做梦机制：定时 consolidation、去重、压缩、归档
- 状态文件与索引文件可恢复
- 写入路径白名单与锁机制

### 来自 `multi-agent-memory-hierarchical-architecture-plan.md`

- 四大逻辑域：共享池、私有池、任务池、系统元数据
- 权限优先、引用优先、单源维护
- 多 Agent 协作的分层治理
- 统一 Builder 拼装提示词

### 最终统一后的核心判断

记忆系统应当同时满足两件事：

1. **纵向上可沉淀**：从短期到长期，从长期到归档，从碎片到知识。
2. **横向上可协作**：共享池、私有池、任务池、系统元数据明确分层，且通过统一 Builder 连接。

---

## 14. 最终落地标准

一个合格的最终版记忆系统，至少要满足以下标准：

1. 能把有效长期知识写入正确类型目录。
2. 能防止重复写入和无序膨胀。
3. 能按权限读取和写入。
4. 能通过 Builder 生成稳定的上下文。
5. 能做梦并产出 consolidation 结果。
6. 能通过索引和审计追溯来源。
7. 能支持单 Agent 与多 Agent 两种工作模式。

---

## 15. 面向执行的任务拆解表

下面是更适合直接进入开发排期的任务拆解。每条任务均按“可交付、可验证、可追踪”的方式拆分。

### 15.1 总表

| 任务编号 | 阶段 | 目标 | 主要文件 | 交付物 | 验收标准 |
|---|---|---|---|---|---|
| T0-01 | Phase 0 | 确认记忆根目录与配置基线 | `src/app/core/...`、配置文件 | 目录规范与默认配置 | 启动后可正确定位记忆根目录 |
| T0-02 | Phase 0 | 定义统一状态文件格式 | `03-SYSTEM-META/` 相关文件 | state schema | 状态可恢复、可审计 |
| T1-01 | Phase 1 | 实现长期记忆分类器 | 新增 service | 分类结果 | 能稳定识别 `user/feedback/project/reference` |
| T1-02 | Phase 1 | 实现长期记忆写入器 | 新增 service | 写入结果 | 正确落盘到目标目录 |
| T1-03 | Phase 1 | 实现去重与合并 | 新增 util/service | 合并结果 | 不重复写入同主题内容 |
| T2-01 | Phase 2 | 建立索引生成器 | 新增 service | topic/time index | 可按类型与时间检索 |
| T2-02 | Phase 2 | 建立审计日志 | 新增 service | audit logs | 每次读写都有记录 |
| T3-01 | Phase 3 | 实现 consolidation gate | 新增 service | gate 判定 | 达阈值自动触发 |
| T3-02 | Phase 3 | 实现做梦执行器 | 新增 service | dream report | 输出 consolidation 结果 |
| T4-01 | Phase 4 | 实现 team sync | 新增 service | 共享引用卡片 | 多 Agent 可共享事实 |
| T5-01 | Phase 5 | 实现 Builder 接入 | 现有 memory builder 改造 | 统一上下文输出 | 上下文预算可控 |

---

### 15.2 Phase 0 任务细化：目录与配置基线修正

#### T0-01 目录与配置统一

**目标**：让应用知道记忆根目录、共享池目录、Agent 私有目录、任务目录、系统元数据目录。

**建议文件改造**：

- `src/app/core/directory-manager.service.ts`
- `src/app/core/zyfront-core.providers.ts`
- `src/app/app.config.ts`

**具体工作**：

1. 补充记忆根路径常量。
2. 统一相对路径到绝对路径的解析规则。
3. 新增目录存在性检查与自动初始化。
4. 将记忆目录映射配置化，而不是散落在服务内部。

**验收点**：

- 启动后可稳定获取所有一级目录路径。
- 缺失目录能自动创建。
- 路径在 Windows 下无编码或分隔符问题。

#### T0-02 状态文件格式统一

**目标**：统一 `.state.json`、`index.json`、`registry.json` 的 schema。

**建议文件改造**：

- `src/app/core/memory/*.ts`
- `src/app/core/memory/memory.telemetry.ts`

**具体工作**：

1. 定义状态文件共用接口。
2. 定义版本号字段。
3. 增加失败恢复字段，如 `lastScanAt`、`lastCursor`、`retryCount`。

**验收点**：

- 文件读写格式稳定。
- 断点恢复时不会因 schema 变更而失败。

---

### 15.3 Phase 1 任务细化：四分类长期记忆落盘

#### T1-01 分类器实现

**目标**：把候选记忆分到四类。

**建议新增文件**：

- `src/app/core/memory/memory-classifier.service.ts`
- `src/app/core/memory/memory-classifier.types.ts`

**具体工作**：

1. 输入原始文本、上下文、来源。
2. 输出 `user | feedback | project | reference`。
3. 支持基于规则和简单评分的双层判定。

**验收点**：

- 分类结果可解释。
- 同一输入在相同上下文下稳定命中。

#### T1-02 写入器实现

**目标**：把分类结果写入对应目录。

**建议新增文件**：

- `src/app/core/memory/long-term-memory-writer.service.ts`
- `src/app/core/memory/long-term-memory-paths.ts`

**具体工作**：

1. 根据分类结果获取落盘目录。
2. 生成标准文件名。
3. 写入 frontmatter + 内容。
4. 同步更新索引。

**验收点**：

- 文件落到正确目录。
- 文件元数据完整。
- 写入失败有回滚或重试记录。

#### T1-03 去重与合并

**目标**：避免长期记忆同义重复。

**建议新增文件**：

- `src/app/core/memory/memory-deduper.service.ts`
- `src/app/core/memory/memory-fingerprint.util.ts`

**具体工作**：

1. 使用 fingerprint 检测重复。
2. 根据标题、主题、摘要做近似合并。
3. 保留来源与版本链。

**验收点**：

- 不会持续堆积重复事实。
- 合并动作可追踪。

---

### 15.4 Phase 2 任务细化：Meta 索引系统

#### T2-01 索引生成器

**目标**：建立 topic index、time index、manifest。

**建议新增文件**：

- `src/app/core/memory/memory-index.service.ts`
- `src/app/core/memory/memory-index.types.ts`

**具体工作**：

1. 扫描长期目录生成索引。
2. 记录实体 ID、主题、时间、类型、来源路径。
3. 支持增量更新。

**验收点**：

- 索引可重建。
- 查询结果与磁盘内容一致。

#### T2-02 审计日志

**目标**：所有记忆操作可追溯。

**建议新增文件**：

- `src/app/core/memory/memory-audit.service.ts`

**具体工作**：

1. 记录 read/write/archive/dedup 事件。
2. 保存操作者、时间、目标路径、结果。
3. 采用 JSONL 便于追加。

**验收点**：

- 任意一条记忆都能回溯来源。
- 审计日志不影响主流程性能。

---

### 15.5 Phase 3 任务细化：做梦机制

#### T3-01 consolidation gate

**目标**：判断是否该触发做梦。

**建议新增文件**：

- `src/app/core/memory/memory-dream-gate.service.ts`

**具体工作**：

1. 读取时间阈值、会话阈值、turn 阈值。
2. 检查最近一次梦境时间。
3. 检查是否有锁冲突。

**验收点**：

- gate 的决策明确、可解释。
- 不会频繁误触发。

#### T3-02 做梦执行器

**目标**：执行 consolidation。

**建议新增文件**：

- `src/app/core/memory/memory-dream.service.ts`
- `src/app/core/memory/memory-dream-report.service.ts`

**具体工作**：

1. 扫描四类长期目录。
2. 聚合同主题条目。
3. 标记 stale / archived。
4. 输出 dream report。

**验收点**：

- 长期记忆密度提高。
- 梦境报告可读且可追踪。

---

### 15.6 Phase 4 任务细化：团队同步与协作治理

#### T4-01 team sync

**目标**：多 Agent 共享事实、私有经验、任务上下文协同。

**建议新增文件**：

- `src/app/core/memory/team-sync.service.ts`
- `src/app/core/memory/shared-entity-card.service.ts`

**具体工作**：

1. 从私有记忆提炼可共享实体。
2. 写入共享池前做权限判断。
3. 生成共享实体卡片供 Builder 消费。

**验收点**：

- 共享池与私有池边界清晰。
- 多 Agent 能基于同一实体协作。

#### T4-02 任务黑板

**目标**：任务期间的协作上下文能独立管理。

**建议新增文件**：

- `src/app/core/memory/task-blackboard.service.ts`

**具体工作**：

1. 任务开始时创建黑板。
2. 任务进行时追加 checkpoints。
3. 任务结束时归档并沉淀长期记忆。

**验收点**：

- 临时协作信息不污染长期库。
- 任务结束后能自动归档。

---

### 15.7 Phase 5 任务细化：Builder 接入

#### T5-01 Builder 改造

**目标**：统一提示词构建入口。

**建议改造文件**：

- `src/app/core/memory/prompt-memory-builder.service.ts`
- `src/app/core/memory/memory.telemetry.ts`

**具体工作**：

1. 接入索引、共享实体卡片、任务黑板摘要。
2. 按层级预算输出。
3. 保持可观测的 build report。

**验收点**：

- 生成的 prompt 可复现。
- 不再由各 Agent 自行拼接。

---

## 16. 建议的开发排期

### Sprint 1

- T0-01
- T0-02
- T1-01

### Sprint 2

- T1-02
- T1-03
- T2-01

### Sprint 3

- T2-02
- T3-01
- T3-02

### Sprint 4

- T4-01
- T4-02
- T5-01

---

## 17. 实施顺序建议

建议按以下依赖顺序推进：

1. 目录与配置基线
2. 分类器与写入器
3. 去重与索引
4. 做梦机制
5. team sync 与黑板
6. Builder 接入

这样可以保证系统从“能存”逐步演进到“能管”“能协作”“能自我整理”。

---

## 18. 结语

这份最终版计划的核心方向非常明确：

- 不再把记忆当作简单文件夹堆积
- 不再把提示词当作临时拼接文本
- 不再让长期记忆只靠“写进去就算完成”

而是把它升级成一套真正可治理的知识与上下文基础设施。

如果后续要继续推进，建议直接按本计划拆分成：

1. 目录与配置实现
2. 分类与写入实现
3. 索引与审计实现
4. 做梦与 consolidation 实现
5. Builder 与 Agent 接入实现
