# 提示词工程模块复刻计划（对标 ClaudeCode 源码）

> 参考源码：`E:\claude-code\restored-src\src`
> 
> 目标项目：`E:\AGENT-ROOT\03-PROJECTS\zyfront-agent`
> 
> 聚焦范围：**静态提示词**与**动态提示词**（构建、拼装、注入、缓存边界、运行时更新）

---

## 1. 结论先行（Executive Summary）

当前 `zyfront-agent` 已具备基础 Prompt 注入能力（`systemPrompt` 字段 + `skills.promptPatch` 追加），但与 ClaudeCode 的完整提示词工程体系相比，仍处于「最小可用」阶段，主要缺失：

1. **静态提示词体系化不足**：缺少分段化（System/Tools/Tone/Safety）与可维护 section registry。
2. **动态提示词治理不足**：缺少动态边界标记、动态段缓存策略、会话态/env/mcp 指令的结构化拼装。
3. **多上下文注入链路不足**：缺少 Plan Mode、Agent Mode、Proactive Mode 等模式化 prompt 变体管理。
4. **可观测性不足**：缺少 prompt 版本、diff、token 占比、缓存命中、回放能力。

建议采用“三层复刻”路线：
- **P0/P1：Prompt 架构与最小复刻**（先跑通 section + boundary + composer）
- **P2/P3：高级动态策略与多模式**（MCP/环境/模式化 Prompt）
- **P4：治理与评估闭环**（测试、观测、灰度、回滚）

---

## 2. 参考源码（ClaudeCode）提示词工程拆解

## 2.1 关键文件与职责

1. `src/constants/prompts.ts`
   - 负责主系统提示词构建（静态 + 动态段）
   - 包含环境信息、工具使用规则、风格约束、安全规则
   - 支持 feature flag、用户类型、模式切换（如 proactive）

2. `src/utils/systemPrompt.ts`
   - 负责“有效系统提示词”决策链：
   - override > coordinator > agent > custom > default
   - 支持 appendSystemPrompt 尾部追加

3. `src/constants/systemPromptSections.ts`（由 `prompts.ts` 使用）
   - 提供 section 注册与解析机制（可缓存/不可缓存分段）

4. `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`（在 `prompts.ts`）
   - 明确静态前缀和动态后缀边界，用于 prompt cache 策略

## 2.2 ClaudeCode 的“静态提示词”特征

- 大块规则固定、跨会话复用（System、Doing tasks、Tool policy、Tone style）
- 强约束性（尤其工具调用、风险动作、输出风格、反幻觉）
- 结构清晰（标题 + bullet），便于演进和 A/B
- 静态段强调“缓存友好”，减少每轮重复 token 开销

## 2.3 ClaudeCode 的“动态提示词”特征

动态内容来自：
- 环境态（OS、shell、cwd、git、model）
- 会话态（session guidance、language、output style、token budget）
- 能力态（MCP 连接、skills 可用性、agent 可用性）
- 模式态（proactive、coordinator、agent memory）

关键做法：
- 将动态段显式后置到 boundary 之后
- 对会导致缓存抖动的段做单独治理（甚至 `uncached`）
- 避免把高波动信息放入静态前缀

---

## 3. 当前项目（zyfront-agent）提示词工程现状

基于以下核心文件分析：
- `zyfront-core/src/assistant/index.ts`
- `zyfront-core/src/api/index.ts`
- `zyfront-core/src/api/anthropic-messages.ts`
- `zyfront-core/src/context/index.ts`
- `zyfront-core/src/skills/index.ts`
- `zyfront-web/src/app/core/zyfront-core.providers.ts`
- `zyfront-web/src/app/core/claude-agent.service.ts`

## 3.1 已有能力（可复用资产）

1. **系统提示词透传能力已具备**
   - `AssistantRuntime.chatWithMeta/stream` 支持 `request.systemPrompt`

2. **动态 patch 注入链路已具备**
   - `SkillRegistry.runAll()` 输出 `promptPatch`
   - 与 `request.systemPrompt` 合并：`combinedPrompt`

3. **工具定义与消息协议已可承载复刻后的 Prompt 规则**
   - 已有 Anthropic tools/message wire 结构
   - 多轮 tool_call/tool_result 闭环已存在

4. **前端已有设置与运行时同步通道**
   - `AppSettingsService` → `runtime.client.configureRuntime`

## 3.2 主要差距（与 ClaudeCode 对比）

1. 缺少独立 `PromptComposer` / `PromptSections` 模块。
2. `systemPrompt` 当前为“单字符串拼接”，缺少可治理分段模型。
3. 缺少静态/动态边界标记与缓存策略。
4. 缺少 mode-aware prompt（single/plan/parallel 仅协调器状态，不影响系统提示词策略）。
5. 缺少环境/能力动态段（mcp instructions、shell policy、safety policy）标准化注入。
6. 缺少 prompt 观测与版本化（无法追踪 prompt 改动效果）。

---

## 4. 复刻目标定义（Prompt Engineering Scope）

## 4.1 静态提示词复刻目标

建立可维护的静态段：
- Identity（你是谁）
- Safety（安全边界）
- Tooling policy（工具优先级与禁用策略）
- Coding policy（代码修改风格约束）
- Communication style（简洁/格式规范）

## 4.2 动态提示词复刻目标

动态段至少覆盖：
- Environment（cwd / git / os / shell / model）
- Session guidance（当前模式、当前任务状态）
- Skills patch（已有）
- MCP instructions（如果连接了）
- User settings（language / output-style）

## 4.3 工程化目标

- Prompt 分段可测试（单测）
- Prompt 拼装可观测（日志、hash、长度）
- Prompt 变更可灰度（feature flag）

---

## 5. 分阶段复刻计划（详细）

## Phase 0：基线与规范冻结（1-2 天）

### 任务
1. 建立提示词工程目录：
   - `zyfront-core/src/prompt/`
2. 定义核心类型：
   - `PromptSection`
   - `PromptBuildContext`
   - `PromptBuildResult`
3. 定义段分类：
   - `static` / `dynamic` / `uncached-dynamic`

### 交付
- `prompt/types.ts`
- `prompt/constants.ts`（含 boundary 常量）
- 提示词规范文档（本文件 + README 小节）

### 验收
- 现有流程不变（兼容）
- 新模块可被 AssistantRuntime 引用（但可先不启用）

---

## Phase 1：静态提示词模块化（2-4 天）

### 任务
1. 抽离静态 section 构建器（对应 ClaudeCode 主骨架）：
   - `buildIdentitySection()`
   - `buildSystemPolicySection()`
   - `buildCodingStyleSection()`
   - `buildToolPolicySection()`
   - `buildToneStyleSection()`

2. 建立 `PromptComposer`：
   - 输入：`PromptBuildContext`
   - 输出：`string[]`（段数组）+ `finalPrompt`

3. AssistantRuntime 改造：
   - 由 `request.systemPrompt + promptPatch` 改为 `PromptComposer` 统一产出

### 交付
- `prompt/static/*.ts`
- `prompt/composer.ts`
- `assistant/index.ts` 对接改造

### 验收
- 非流式与流式路径输出一致
- 同样输入下 Prompt 可重现

---

## Phase 2：动态提示词与边界策略（3-5 天）

### 任务
1. 引入 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`。
2. 动态段构建器：
   - `buildEnvironmentSection()`（cwd/git/os/shell/model）
   - `buildSessionSection()`（mode/step）
   - `buildSkillsPatchSection()`（对接现有 promptPatch）
   - `buildMcpSection()`（预留）
3. 生成结构：
   - `[...staticSections, BOUNDARY, ...dynamicSections]`

4. 缓存策略：
   - static hash
   - dynamic hash
   - 总 hash

### 交付
- `prompt/dynamic/*.ts`
- `prompt/hash.ts`
- prompt debug 信息接入日志

### 验收
- static 部分在会话内稳定
- dynamic 变化时可定位变化段

---

## Phase 3：模式化提示词（Plan/Agent/Coordinator）（3-5 天）

### 任务
1. 实现“有效系统提示词决策链”（参考 `utils/systemPrompt.ts`）：
   - override > coordinator > agent > custom > default
2. 将 `CoordinatorEngine.mode` 映射到 Prompt 策略：
   - single：默认
   - plan：强调分解与步骤化输出
   - parallel：强调并发子任务边界
3. 预留 agent-specific prompt 注入点。

### 交付
- `prompt/effective-system-prompt.ts`
- `coordinator` 与 `assistant` 对接

### 验收
- 模式切换引发 Prompt 变更可见
- 不影响既有工具调用稳定性

---

## Phase 4：观测、测试、灰度（2-4 天）

### 任务
1. 测试：
   - section 构建单测
   - composer 快照测试
   - assistant 集成测试（stream/non-stream）
2. 观测：
   - 记录 prompt 长度、hash、section 列表
3. 灰度：
   - `prompt.v2.enabled` 开关
   - 支持一键回退到旧拼接逻辑

### 交付
- 测试文件
- 运行时诊断输出（dev 模式）

### 验收
- 关键路径测试通过
- 线上可灰度/可回滚

---

## 6. 目标代码结构建议

```text
zyfront-core/src/prompt/
  constants.ts
  types.ts
  composer.ts
  effective-system-prompt.ts
  hash.ts
  static/
    identity.ts
    system-policy.ts
    coding-style.ts
    tool-policy.ts
    tone-style.ts
  dynamic/
    environment.ts
    session.ts
    skills.ts
    mcp.ts
```

---

## 7. 与现有模块的改造点清单

1. `zyfront-core/src/assistant/index.ts`
   - 将 `combinedPrompt` 改由 `PromptComposer` 生成

2. `zyfront-web/src/app/core/claude-agent.service.ts`
   - 可选增加 prompt debug 展示（仅 dev）

3. `zyfront-web/src/app/core/claude-chat.service.ts`
   - 与 AgentService 保持一致的 prompt 生成路径

4. `zyfront-core/src/context/index.ts`
   - 可选记录 `lastPromptHash` 用于调试

---

## 8. 风险与规避

1. **Prompt 变更导致模型行为波动**
   - 规避：灰度 + A/B + 回滚开关

2. **动态段过多导致 token 成本上涨**
   - 规避：边界后段精简、短模板、分级启用

3. **前后端提示词策略不一致**
   - 规避：统一在 `zyfront-core` 拼装，前端只消费结果

4. **流式/非流式行为不一致**
   - 规避：统一 composer 输入，双路径复用

---

## 9. 最小可执行里程碑（建议）

- M1：完成 PromptComposer 与静态段（Phase 0-1）
- M2：完成动态段 + boundary + hash（Phase 2）
- M3：完成 mode-aware 有效提示词决策（Phase 3）
- M4：完成测试与灰度（Phase 4）

---

## 10. 本周可立即开工的 TODO（可直接派发）

1. 新建 `zyfront-core/src/prompt/types.ts` 与 `constants.ts`
2. 落地 `composer.ts`，先只接静态段 + skills patch
3. 在 `AssistantRuntime.chatWithMeta/stream` 接入 composer
4. 增加 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 与 `environment dynamic section`
5. 增加快照测试：同输入 Prompt 输出稳定

---

## 附：对当前项目定位建议

`zyfront-agent` 当前的提示词能力已经具备“可工作原型”基础，下一步不建议继续做“散点式字符串拼接增强”，而应直接进入 **Prompt 工程化**：
- 先搭框架（section + composer + boundary）
- 再补能力（mode/mcp/settings）
- 最后做治理（观测/测试/灰度）

这样可以在不破坏现有可用性的前提下，逐步靠近 ClaudeCode 的提示词工程成熟度。