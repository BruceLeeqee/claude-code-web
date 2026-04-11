# 技能自动触发 + 技能页展示 + 目录迁移 详细实施计划

> 目标：参考 `E:\claude-code\restored-src\src` 的技能加载/发现机制，改造当前 `zyfront-desktop` 与 `zyfront-core`，实现：
> 1) 用户在终端创建技能后可自动触发；
> 2) 技能页左侧能看到“已安装技能”；
> 3) 将技能主目录从 `03-PROJECTS/zyfront-agent/skills` 迁移到 `02-AGENT-MEMORY/04-Skill`；
> 4) 保持向后兼容与可回滚。

---

## 1. 现状与差距

## 1.1 参考实现（restored-src）关键能力

参考文件：`src/skills/loadSkillsDir.ts`

已具备能力：
- 多来源技能加载（managed/user/project/legacy commands）
- `skill-name/SKILL.md` 标准结构
- 动态发现（根据文件路径向上发现 `.claude/skills`）
- 去重（realpath）
- 条件激活（`paths` frontmatter）
- 缓存清理与动态通知（`skillsLoaded.emit()`）

## 1.2 当前项目（zyfront-agent）现状

- `zyfront-desktop/src/app/features/prototype/skills/skills.page.ts`
  - 本地技能读取硬编码为 `workspace/skills/*/SKILL.md`
  - 技能页“已安装”状态来自 facade 的内存状态，不等价于真实“已安装目录索引”
- `zyfront-core/src/prompt/dynamic/skills.ts`
  - 仅有 prompt patch 拼接，不具备“技能发现/激活/自动触发”能力
- 终端创建技能后
  - 尚无统一“技能目录 watcher + 索引更新 + 自动触发路由”闭环

结论：当前是“展示层可读本地目录 + 运行层手动调用”为主，缺少“统一技能索引服务”和“自动触发策略”。

---

## 2. 目标范围（本期）

### 2.1 必达目标

1. **自动触发**：用户在终端创建技能后，不重启即可进入索引，并可被路由自动触发。  
2. **技能页左侧可见已安装**：左侧列表展示来自统一索引（而非仅 facade 临时态）。  
3. **目录迁移**：主目录切换至 `E:/AGENT-ROOT/02-AGENT-MEMORY/04-Skill`，并兼容旧目录读取。  
4. **模型可读的技能补丁**：将“可触发技能摘要（name/when_to_use/desc）”注入 prompt。  

### 2.2 非本期（后续）

- 条件激活（`paths`）精细匹配
- 远程 skill hub 全量协议统一
- 技能评分、签名、可信源校验

---

## 3. 目标架构（建议）

新增“技能索引中心”作为唯一事实源：

- **Desktop 层**（文件系统）
  - 扫描主目录：`02-AGENT-MEMORY/04-Skill`
  - 兼容扫描旧目录：`03-PROJECTS/zyfront-agent/skills`
  - 规范化为 `SkillRecord[]`
  - 通过 bridge/IPC 提供查询与变更通知

- **Core 层**（路由与触发）
  - 消费 `SkillRecord[]`
  - 构建触发候选（关键词 / when_to_use / 描述）
  - 在对话入口进行自动匹配与优先触发
  - 回退：未命中时走原有自然语言路径

- **UI 层**（技能页）
  - 左侧列表绑定 `SkillRecord[]`
  - 区分来源：`memory-main`、`legacy-workspace`
  - 显示安装状态、冲突状态、最近更新时间

---

## 4. 目录迁移方案

## 4.1 新目录标准

- 主目录：`E:/AGENT-ROOT/02-AGENT-MEMORY/04-Skill`
- 结构：`<skill-id>/SKILL.md`

## 4.2 迁移策略（双读单写）

- **读**：新目录 + 旧目录同时扫描
- **写**：新建技能只写入新目录
- **冲突**：同名技能优先新目录（记录 warning）

## 4.3 数据迁移步骤

1. 预扫描旧目录技能（ID、mtime、hash）
2. 复制到新目录（不存在才复制；可选覆盖策略）
3. 生成 `migration-report.json`
4. 保留旧目录只读（至少一个版本周期）

## 4.4 回滚

- 开关 `skills.useMemorySkillDir=false` 切回旧目录优先
- 不删除旧目录原始文件

---

## 5. 自动触发设计

## 5.1 触发输入

- 用户输入文本（终端自然语言）
- 技能 frontmatter：`name`、`description`、`when_to_use`、`tags`（若有）

## 5.2 匹配规则（分层）

1. **显式调用优先**：`/skill-id` 或 `@skill-id`
2. **高置信关键词命中**：输入与 `when_to_use`/name 关键短语匹配
3. **语义近似（可选）**：后续可加 embedding；本期先关键词 + 规则分

建议评分：
- name 命中 +4
- when_to_use 命中 +3
- description 命中 +2
- tags 命中 +1
- 阈值：`score >= 4` 自动触发，否则仅建议

## 5.3 执行策略

- 命中后先走 `skill.run(skillId, prompt)`
- 失败自动回退到普通 assistant 流程
- 将命中/回退记录到 telemetry（便于调参）

## 5.4 防误触

- 黑名单词（通用问候类不触发）
- 冲突时最多展示 Top-3 候选，让用户确认
- 同一会话可“本轮禁用自动触发”

---

## 6. 技能页左侧“已安装技能”改造

## 6.1 现状问题

`skills.page.ts` 当前本地读取固定 `workspace/skills`，与目标主目录不一致。

## 6.2 改造点

1. 新增 facade 方法：`listInstalledSkills()`（来自统一索引）
2. 左侧列表改为索引源驱动（不再仅依赖 `facade.skills()` 内存态）
3. 展示字段：
   - `id`
   - `name`
   - `source`（memory-main / legacy-workspace / hub）
   - `installedAt` / `updatedAt`
   - `status`（ok/conflict/invalid）
4. 预览读取优先新目录，失败回落旧目录

---

## 7. 代码级实施清单（文件维度）

## 7.1 Core

- `zyfront-core/src/prompt/dynamic/skills.ts`
  - 扩展为“技能补丁构建器”：注入可触发技能摘要（限制条数与 token）
- 新增：`zyfront-core/src/skills/skill-index.ts`
  - `SkillRecord` 类型
  - 匹配评分器
  - 自动触发决策器
- 对接 assistant 入口（终端自然语言分流点）
  - 在 `askAssistant`/路由前置调用 trigger evaluator

## 7.2 Desktop

- 新增：`zyfront-desktop/src/app/core/skill-index.service.ts`
  - 双目录扫描
  - 去重与优先级
  - 变更通知（轮询或 watcher）
- `zyfront-desktop/src/app/features/prototype/skills/skills.page.ts`
  - 本地读取路径改为索引服务
  - 左侧列表改为“已安装技能视图模型”
- （如有 preload/bridge）新增 IPC：
  - `skills.listInstalled`
  - `skills.readSkillMd`
  - `skills.migrateToMemoryDir`

## 7.3 迁移脚本

- 新增：`scripts/migrate-skills-to-memory-dir.(ts|js)`
  - dry-run / apply
  - report 输出
  - 冲突策略参数化

---

## 8. 配置与默认值

建议新增统一配置（可放模型配置 JSON 或 app settings）：

```json
{
  "skills": {
    "main_dir": "E:/AGENT-ROOT/02-AGENT-MEMORY/04-Skill",
    "legacy_dir": "E:/AGENT-ROOT/03-PROJECTS/zyfront-agent/skills",
    "enable_auto_trigger": true,
    "auto_trigger_min_score": 4,
    "fallback_to_general_assistant": true,
    "migration_mode": "dual-read-single-write"
  }
}
```

说明：
- 页面默认展示以上默认配置（首次写入）
- 配置变更实时生效

---

## 9. 验收标准（DoD）

1. 在终端创建新技能目录 `<id>/SKILL.md` 后，30 秒内可在技能页左侧看到。  
2. 输入符合 `when_to_use` 的请求时，自动触发该技能；失败可自动回退。  
3. 左侧列表可区分新目录/旧目录来源；同名冲突时新目录优先。  
4. 迁移脚本可生成报告，且回滚开关有效。  
5. 不破坏现有 hub 搜索/安装流程。  

---

## 10. 测试计划

## 10.1 单元测试

- 评分器（命中权重、阈值）
- 双目录去重与优先级
- 配置解析与默认值注入

## 10.2 集成测试

- 创建技能 -> 索引更新 -> 左侧列表出现
- 自动触发成功路径
- 自动触发失败回退路径
- 迁移 dry-run/apply/report 全流程

## 10.3 回归测试

- 旧目录技能仍可显示/运行
- 无技能场景不报错
- 大量技能（100+）列表性能可接受

---

## 11. 工时估算

- 架构与索引服务：1.0 天
- 自动触发接入与回退：0.5~1.0 天
- 技能页左侧改造：0.5 天
- 迁移脚本与报告：0.5 天
- 测试与回归：0.5 天

**总计：3.0~3.5 天**

---

## 12. 交付物

1. 本计划文档（当前文件）  
2. 技能索引服务与自动触发实现代码  
3. 技能页左侧已安装列表改造  
4. 迁移脚本 + 迁移报告模板  
5. 配置默认值与开关文档  
