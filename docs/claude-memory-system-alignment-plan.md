# Zyfront 记忆系统对齐计划（以参考源码架构为准）

> 目标：以 `E:\AGENT-ROOT\04-PROJECTS\claude-code\restored-src\src` 的真实架构思路为主线，参考 `E:\AGENT-ROOT\00-HUMAN-TEMP\human\prompt2.md`，完成 zyfront-desktop 多 Agent 记忆系统与提示词组装体系的工程化落地。

---

## 1. 结论先行：`prompt2.md` 与参考源码是否一致？

### 1.1 一致的部分
- 都强调“多层记忆 + 会话历史 + 当前输入”进入模型上下文。
- 都强调长期记忆与会话记忆需要持久化。
- 都强调每轮对话后应更新记忆（自动提取/摘要/归并）。

### 1.2 不完全一致的部分（关键）
`prompt2.md` 将“完整拼接串”描述为固定模板；但参考源码并非只有“简单拼接字符串”这一步，而是完整系统：

1. **触发链路**：stop hook 触发 extract / dream / session memory（异步后台）。
2. **多级 gate**：开关、节流、并发互斥、游标推进、重复写跳过。
3. **安全沙箱**：自动记忆写入受路径白名单约束。
4. **索引与归并**：topic/time 索引 + auto-dream consolidation。
5. **团队同步**：可选 team memory watcher + push/pull。
6. **提示注入**：不仅是拼接，还包括规则注入、记忆入口管理、长度控制与去重。

### 1.3 结论
- “记忆拼接到提示词”是必要但不充分条件。
- 应以参考源码为准：**提示词构建层 + 记忆生命周期管理层** 必须一起实现。

---

## 2. 当前 zyfront-desktop 现状评估

### 2.1 已具备能力
- `extract.service.ts`：短期摘要写入、长期四类记忆提取、索引更新。
- `session-memory.service.ts`：会话级摘要持续写入。
- `auto-dream.service.ts` / scheduler / orchestrator：具备周期巩固框架。
- workbench 中已在回复后触发 memory pipeline。

### 2.2 主要差距
1. **提示词构建规范不完整**：虽有拼接服务雏形，但缺少统一 token 预算、截断策略、去重策略。
2. **会话隔离粒度不足**：extract 内部分状态（cursor/fingerprint/eligibleTurns）为服务级，应会话级。
3. **历史裁剪规则不标准**：需明确“最近 10~15 轮”而非仅按消息条数。
4. **参考记忆接入弱**：缺用户手动挂载 reference 的标准入口。
5. **可观测性不够**：缺“本次构建 prompt 的层大小、截断原因、命中率”遥测。

---

## 3. 目标架构（对齐参考源码，系统化管线）

```text
用户输入
  -> PromptBuilder(分层拉取 + 去重 + 预算裁剪 + 顺序组装 + 构建报告)
  -> assistant.stream
  -> 历史落盘
  -> StopHook风格触发 MemoryPipeline
       ├─ Gate层(总开关/remote禁用/feature flag/主子agent判定)
       ├─ 调度层(节流everyNTurns/扫描间隔/最小会话数)
       ├─ 并发层(inProgress锁 + trailing coalesced context)
       ├─ Extract(增量提取, 游标推进, 重复写跳过)
       ├─ SessionMemory(会话摘要更新)
       ├─ AutoDream(跨会话归并与低置信清理)
       ├─ Index层(topic-index/time-index/manifest维护)
       └─ TeamSync(可选 push/pull + debounce)
  -> 可观测层(构建报告 + pipeline telemetry + 失败原因)
```

### 3.1 提示词最终顺序（保留 `prompt2` 的可读模板）
1. System Prompt
2. User Memory
3. Feedback Memory
4. Project Memory
5. Reference Memory
6. Session Short-term Memory
7. Conversation History
8. User Query

> 注：顺序遵循 `prompt2`；但每层内容来源、预算控制、去重和安全规则遵循参考源码思想。

---

## 4. 详细实施计划

## Phase 0：基线冻结与回归样本（0.5 天）
- [ ] 冻结当前内存目录结构与关键文件清单。
- [ ] 采集 5~10 条真实会话，作为改造前后对比样本。
- [ ] 定义验收指标（见第 6 节）。

交付物：
- baseline 清单
- 对比样本集（匿名化）

---

## Phase 1：Prompt Builder V2（1 天）

### 任务
1. 新建/升级 `PromptMemoryBuilderService`：
   - [ ] 分层加载器（user/feedback/project/reference/session/history）。
   - [ ] 层级去重（topicKey、内容 hash、相似句合并）。
   - [ ] token 预算管理（全局预算 + 分层软/硬上限）。
   - [ ] 截断策略（优先保留新近与高置信内容）。
   - [ ] 输出构建报告（每层字符数、截断数、丢弃原因）。
2. `workbench.askAssistant` 只调用一个入口：
   - [ ] `buildFullPromptForInput(sessionId, userQuery, systemPrompt)`。

### 验收
- [ ] 每次请求都能输出 8 层完整 prompt。
- [ ] 任意超长场景不爆长度，且能说明截断原因。

---

## Phase 2：会话级状态隔离（1 天）

### 任务
1. `ExtractService` 内部状态改为 `Map<sessionId, ExtractState>`：
   - [ ] `inProgress`
   - [ ] `eligibleTurns`
   - [ ] `lastCursorMessageId`
   - [ ] `lastSummaryFingerprint`
2. 引入 trailing/coalesced 机制：
   - [ ] 本轮在跑，后续仅保留最新上下文，结束后补跑一次。
3. 与 scheduler/orchestrator 打通会话级并发保护。

### 验收
- [ ] 多会话并发时不串记忆、不丢游标。
- [ ] 无重复写爆发。

---

## Phase 3：Conversation History 与 Session Memory 标准化（0.5~1 天）

### 任务
1. 历史窗口改为轮次模型：
   - [ ] 只取最近 10~15 轮（user+assistant 视为一轮）。
2. Session summary 生成优化：
   - [ ] 从近期 turn 自动摘要（目标、进度、阻塞、下一步）。
   - [ ] 同步写 `06-Context/sessions/<session>.md`。
3. 增加“summary 质量回退策略”：摘要失败时使用结构化 fallback。

### 验收
- [ ] 历史长度稳定、上下文相关性提升。
- [ ] 摘要文件可持续更新且可读。

---

## Phase 4：Reference Memory 手动挂载能力（0.5~1 天）

### 任务
1. workbench 增加挂载入口：
   - [ ] 用户可将文件/片段标记为 reference memory。
2. reference 记录标准化：
   - [ ] source path、digest、capturedAt、scope(session/project)。
3. PromptBuilder 引入按会话优先检索：
   - [ ] session reference > project reference。

### 验收
- [ ] 用户手动挂载后，本轮及后续能稳定命中。

---

## Phase 5：可观测性与治理（1 天）

### 任务
1. telemetry 新增事件：
   - [ ] `full_prompt_build`
   - [ ] `memory_layer_loaded`
   - [ ] `memory_layer_truncated`
   - [ ] `memory_dedup_applied`
2. dashboard/日志面板显示：
   - [ ] 本轮各层大小
   - [ ] 截断/去重统计
   - [ ] pipeline 耗时与失败率
3. 增加巡检脚本（索引一致性、孤儿文件、空 frontmatter）。

### 验收
- [ ] 可快速定位“记忆未命中”根因。

---

## 5. 关键接口草案（实施约束）

```ts
interface PromptBuildReport {
  sessionId: string;
  builtAt: number;
  totalChars: number;
  layers: Array<{
    name: 'system'|'user'|'feedback'|'project'|'reference'|'session'|'history'|'query';
    charsBefore: number;
    charsAfter: number;
    truncated: boolean;
    droppedItems: number;
  }>;
}

interface PromptMemoryBuilder {
  buildFullPrompt(sessionId: string): string;
  buildFullPromptForInput(sessionId: string, userQuery: string, systemPrompt?: string): Promise<string>;
  getLastBuildReport(sessionId: string): PromptBuildReport | null;
}
```

---

## 6. 验收标准（DoD）

1. 架构一致性
- [ ] 具备“构建提示词 + 触发提取 + 摘要 + 归并 + 索引/可观测”闭环。

2. 功能正确性
- [ ] 每轮调用前按 8 层顺序拼接。
- [ ] 最近历史按 10~15 轮控制。
- [ ] 会话级状态完全隔离。

3. 稳定性
- [ ] 多会话并发 200 轮回放无串扰。
- [ ] 内存目录无异常膨胀（重复摘要受控）。

4. 可维护性
- [ ] 有构建报告、遥测、巡检脚本。
- [ ] 核心服务有单测（builder/extract/session）。

---

## 7. 风险与缓解

1. **上下文过长导致模型性能下降**
- 缓解：分层预算 + 历史按轮次裁剪 + reference 优先级。

2. **多会话并发写入冲突**
- 缓解：会话级锁 + trailing run + topicKey 去重。

3. **记忆污染（错误事实被长期记住）**
- 缓解：feedback 层增加“可撤销标记”；dream 阶段做低置信清理。

4. **索引不一致**
- 缓解：每次写入后异步校验 + 每日巡检修复。

---

## 8. 推荐实施顺序

`Phase 1 -> Phase 2 -> Phase 3 -> Phase 5 -> Phase 4`

原因：先把“构建与隔离”打稳，再做可观测，最后补 reference 交互入口，避免 UI 先行带来错误记忆写入。

---

## 9. 预计工期

- 核心改造：4 ~ 5.5 人天
- 含测试与回归：6 ~ 7 人天

---

## 10. 立即下一步（可执行）

1. 按 Phase 1 开始：先落地 Prompt Builder V2 的预算与构建报告。
2. 同步开始 Phase 2：将 ExtractService 改为 session-scoped state。
3. 产出第一版回归数据对比（命中率、截断率、重复写率）。
