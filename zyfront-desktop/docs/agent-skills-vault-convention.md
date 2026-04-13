# Vault 技能目录约定（自动生成必读）

技能根默认对应 Vault 键 **`agent-skills`**，相对路径一般为 **`03-AGENT-TOOLS/01-Skills`**（可在「模型」页修改）。

## 1. 目录结构

每个技能占**一个子目录**，目录名即技能 id 片段（如 `douyin`、`text-to-ppt`），可多级嵌套（如 `douyin/text-to-ppt`）。

```
03-AGENT-TOOLS/01-Skills/
  <skill-id>/
    <入口 Markdown 文件>   ← 必须存在，见下节
    （可选）其它资源、子目录
```

## 2. 入口配置文件名（否则检测不到）

桌面端 **`SkillIndexService`** 按顺序尝试读取（任一存在即可被索引）：

1. **`SKILL.md`**（推荐，与 Claude Code / 常见 Agent 资料一致）
2. **`Skill.md`**
3. **`skill.md`**

**自动生成技能时**：请固定生成上述三者之一；**不要**只用 `douyin-search.md`、`README.md` 等任意名作为唯一说明文件——虽然当前实现有「目录内仅一个 `*.md` 时兜底」策略，但依赖兜底不利于工具链、搜索与人工排查，**生产环境务必提供 `SKILL.md` 或 `Skill.md`**。

## 3. 文件内容建议

- 首行或靠前位置使用 Markdown 标题：`# 技能名称`
- 建议在正文或 YAML frontmatter 中写清 **description / 触发场景**（便于用户说「抖音」「做 PPT」时命中）
- 具体步骤、脚本可放在同目录其它 `.md` 中，但**入口文件**必须包含足够让模型执行的摘要或可跳转说明

## 4. 修改路径后

在「模型」页变更技能根后，索引会失效缓存；若列表未更新，重启应用或重新打开技能页触发扫描。

## 5. 实现参考

扫描逻辑：`src/app/core/skill-index.service.ts`（`scanDir` / `skillNameCandidates`）。
