# Obsidian-Agent-Vault 整合系统：终端页与 Agent 记忆对接 — 详细实施计划

> 依据：`Obsidian+Claude Code记忆+人类笔记 整合系统：目录统一管理与文件规则化处理方案.pdf`（以下简称「设计 PDF」）。  
> 范围：先落实 **终端/工作台侧「固定结构化目录」** 与 **Agent 记忆目录对接与体验优化**；规则引擎与 Obsidian 全量解析可作为后续迭代。

---

## 1. 背景与目标

### 1.1 设计 PDF 核心意图（摘要）

- **统一载体**：以本地文件系统为根，人类笔记（Obsidian 友好）与 Agent 记忆（Claude Code 友好）分层存储、通过规则引擎关联。
- **固定目录**：根目录 `Obsidian-Agent-Vault`（路径可配置），其下 `00-INBOX` … `05-SYSTEM` 等标准子树；配置由 `05-SYSTEM/directory.config.json`、`rule.config.json`、`agent.config.json` 描述。
- **服务拆分**：`DirectoryManagerService`、`FileClassifierService`、`FileRuleEngineService`、`AgentMemoryService`、`ObsidianParserService`（Angular 可落地）。

### 1.2 本项目当前状态（代码事实）

| 项目 | 说明 |
|------|------|
| 工作区根 | Electron `main.js`：`workspaceRoot = process.env.ZYTRADER_WORKSPACE ? resolve(env) : resolve(__dirname, '..')`，即默认指向 **仓库上级目录**（ monorepo 根的上级），而非「Vault」概念。 |
| 工作台 | `workbench.page.ts`：`workspaceRoot` 来自 `window.zytrader.workspace.info()`；文件树 `loadDir('.')` 从工作区根 **任意** 列出子项，无「标准 Vault 子树」约束。 |
| 终端 cwd | PTY / `terminal.exec` 使用 `resolveSafePath(relativePath)`，相对路径均相对于 **当前 workspaceRoot**；与 Vault 子目录未绑定。 |
| Agent 工具 | `zyfront-core.providers.ts` 等已提供 list/read/write/delete/exec/open_path，操作范围限于 workspaceRoot（及 open_path 对用户主目录的限制）。 |

### 1.3 本阶段目标（可验收）

1. **终端页 / 工作台文件树**：在 UI 与逻辑上体现 **固定结构化目录**（与设计 PDF 一致或可映射），用户能一眼识别 INBOX、人类笔记、Agent 记忆、项目、资源、系统配置区。
2. **对接 Agent 记忆**：应用内可通过统一服务读写 `02-AGENT-MEMORY` 下短/长/上下文/元数据路径；与现有 `zytrader` IPC 能力衔接（必要时增加「初始化 Vault」「按 key 解析路径」类 IPC）。
3. **优化**：首次启动或检测到缺少标准树时 **幂等 bootstrap**（创建目录与默认 JSON 配置）；终端默认 cwd 建议落在 Vault 根或 `03-PROJECTS/<当前项目>`（可配置）。

非本阶段必达（可列入二期）：完整 `rule.config.json`  cron 规则执行、双链解析、PDF 中「match 为函数字符串」的配置热更新（需在渲染进程用声明式规则替代 eval）。

---

## 2. 标准目录与配置契约（与设计 PDF 对齐）

### 2.1 物理目录树（约定）

根目录记为 `VAULT_ROOT`（默认文件夹名建议 `Obsidian-Agent-Vault`，实际路径由配置指定）。

```
{VAULT_ROOT}/
├── 00-INBOX/
│   ├── human/
│   └── agent/
├── 01-HUMAN-NOTES/
│   ├── 01-Daily/
│   ├── 02-Knowledge/
│   ├── 03-Notes/
│   └── 04-Tags/
├── 02-AGENT-MEMORY/
│   ├── 01-Short-Term/
│   ├── 02-Long-Term/
│   ├── 03-Context/
│   └── 04-Meta/
├── 03-PROJECTS/
├── 04-RESOURCES/
│   ├── images/
│   ├── files/
│   ├── media/
│   └── templates/
└── 05-SYSTEM/
    ├── directory.config.json
    ├── rule.config.json
    └── agent.config.json
```

### 2.2 `directory.config.json`（位于 `{VAULT_ROOT}/05-SYSTEM/`，建议最小 schema）

- `version`: number  
- `keys`: 与设计 PDF 一致的 **逻辑 key → 相对 VAULT_ROOT 的路径**，例如 `agent-short-term` → `02-AGENT-MEMORY/01-Short-Term`，供 `DirectoryManagerService.getFullPath(key)` 使用。  
- （可选）`displayNames`: 中文/英文 UI 标签，供工作台树节点展示。  

说明：**Vault 盘位**（嵌套 vs 全局）由 **3.4 应用侧配置** 决定；本文件不重复存储 `vaultRoot` 绝对路径，避免与 `userData` 配置漂移。

### 2.3 文件类型与命名（对接 `FileClassifierService`）

严格遵循设计 PDF「四维识别」中的路径与后缀约定，便于后续规则引擎与 Agent 读取：

| 类型 | 路径特征 | 命名/后缀 |
|------|-----------|-----------|
| Agent 短期记忆 | `02-AGENT-MEMORY/01-Short-Term` | `short-term-*.json` |
| Agent 长期记忆 | `02-AGENT-MEMORY/02-Long-Term` | `long-term-*.json` / `.md` |
| Agent 上下文 | `02-AGENT-MEMORY/03-Context` | `context-*.json` |
| 元数据 | `02-AGENT-MEMORY/04-Meta` | `.json` |
| 系统配置 | `05-SYSTEM` | `.json` |

TypeScript 中定义 `FileType` 枚举与设计 PDF 一致，避免魔法字符串。

---

## 3. 架构调整：Workspace 与 Vault 的关系

### 3.1 已定稿：代码工作区 vs Vault（多项目开发 + 部署）

**原则**：**代码工作区（Workspace）** 与 **Vault 根（Obsidian + Agent 记忆）** 职责分离；多项目通过切换 Workspace 解决；Vault 支持「嵌套在仓库内」或「全局单库」两种模式，由应用配置决定，不把一种模式写死在代码里。

| 概念 | 含义 | 多项目时 |
|------|------|-----------|
| `workspaceRoot` | 当前 **Git 仓库 / 工程根**，终端、`list/read/write/exec`、相对路径解析均相对此根（在安全校验范围内） | 每打开一个项目切一次；与 Cursor「打开文件夹」一致。 |
| `vaultRoot` | **标准目录树**（`00-INBOX` … `05-SYSTEM`）所在根目录 | `nested`：`join(workspaceRoot, nestedRelative)`；`global`：用户配置的绝对路径 + 可选 `03-PROJECTS/<projectKey>`。 |

**Vault 模式（二选一，配置驱动）**：

- **`nested`（推荐作本地开发默认）**：`vaultRoot = path.join(workspaceRoot, nestedRelative)`，典型 `nestedRelative = 'Obsidian-Agent-Vault'`。可进 `.gitignore`。项目记忆与仓库强绑定。  
- **`global`（适合 Obsidian 单库统筹多仓库）**：`vaultRoot = globalRoot`（绝对路径，如 `~/Documents/Obsidian-Agent-Vault`）。工程相关笔记/记忆落在 `03-PROJECTS/<projectKey>/`；`projectKey` 由用户填写或从 `workspaceRoot` 目录名自动生成 slug。

若将 `workspaceRoot` 直接设为 Vault（只做笔记、代码在别处），则 `nested` 下可将 `nestedRelative` 设为 `.`，并在 Vault 的 `05-SYSTEM/directory.config.json` 中维护 key 映射即可。

**`workspaceRoot` 解析优先级（开发与部署统一规则）**：

1. **用户在本应用内持久化的「当前工程目录」**（首次运行向导或「打开文件夹」写入 Electron `userData`，见 3.4）。  
2. **环境变量** `ZYTRADER_WORKSPACE`（脚本、CI、运维显式注入）。  
3. **仅开发构建**：回退 `path.resolve(__dirname, '..')`（或当前 monorepo 约定路径）；**安装版不得依赖此项**，须在文档与构建脚本中标注。

**部署（生产安装包）**：默认 Workspace 使用 `userData` 下子目录或通过 **首次启动选择文件夹** 持久化；不依赖开发者本机盘符。`ZYTRADER_WORKSPACE` 仍为可选覆盖。

**多 Vault**：单应用实例绑定 **一对** `(workspaceRoot, vaultRoot)`；不强制「同一进程挂载多个 Vault」。多项目 = 切换 Workspace 后重算 `vaultRoot`（必要时提示尚未 bootstrap）。

**`vaultRoot` 解析（在确定 `workspaceRoot` 之后）**：

1. 读应用侧 `vault.*`（3.4）。  
2. `nested` → `join(workspaceRoot, nestedRelative)`。  
3. `global` → `globalRoot`；若启用项目子树，Agent/项目落地路径为 `join(vaultRoot, '03-PROJECTS', projectKey, …)`（与 PDF 中项目目录一致）。

**终端默认 cwd**：优先 `vaultRoot`；需跑仓库脚本时提供「切换到 workspaceRoot」快捷项（见第 4 节）。

### 3.2 与上一版文档的对应关系

- 原「`vaultRoot = join(workspaceRoot, directoryConfig.vaultRootRelative)`」仅覆盖 **`nested` 模式**；全局 Vault 需 **`vault.globalRoot` + `projectKey`**，不能单靠 Vault 内的 `directory.config.json` 反推根路径（因 Vault 内配置不包含「本机绝对根」来源）。  
- Vault 内的 `directory.config.json` 仍负责 **标准子目录 key → 相对 VAULT_ROOT 路径**（2.2），不负责选择 Vault 落在哪块盘上。

### 3.3 Electron 主进程职责

| 能力 | 说明 |
|------|------|
| `zytrader:vault:bootstrap`（新） | 在 `vaultRoot` 下创建 2.1 节整棵树，并写入默认 `directory.config.json` / `rule.config.json` / `agent.config.json`（若不存在则创建）。 |
| `zytrader:vault:resolve`（新） | 入参逻辑 key（如 `agent-short-term`），返回绝对路径（需落在 `vaultRoot` 内）。 |
| 现有 `workspace:info` | 扩展返回字段，见 **3.5**。 |
| （可选）`workspace:setRoot` / `vault:setConfig` | 由 UI 写入持久化配置并校验路径，避免渲染进程直接写文件分散。 |

路径安全：任何 Vault 操作必须 `realpath`|`resolve` 后校验前缀为 `vaultRoot`（及允许的 `workspaceRoot`），与现有 `resolveSafePath` 一致。

### 3.4 应用侧持久化配置（建议命名：`zytrader-workspace.json`，位于 `app.getPath('userData')`）

与 Vault 内 `05-SYSTEM/*.json` 区分：**本文件只描述「当前工程根在哪、Vault 用哪种模式」**；标准子树 key 映射仍在 Vault 内 `directory.config.json`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | `number` | 配置结构版本。 |
| `workspaceRoot` | `string` | 当前代码工作区绝对路径；可由「打开文件夹」更新。 |
| `vault.mode` | `'nested' \| 'global'` | 见 3.1。 |
| `vault.nestedRelative` | `string` | `nested` 时相对 `workspaceRoot`，默认 `Obsidian-Agent-Vault`。 |
| `vault.globalRoot` | `string?` | `global` 时 Vault 绝对路径。 |
| `vault.projectKey` | `string?` | `global` 时建议在 `03-PROJECTS` 下的目录名；可默认从 `workspaceRoot` 最后一段 sanitize。 |

开发阶段若尚未实现 UI 持久化，可仅用 `ZYTRADER_WORKSPACE` + 默认 `vault` 块占位。

### 3.5 IPC：`zytrader:workspace:info` 扩展返回（建议形状）

渲染进程与工作台据此展示「工程根 / Vault 根」，并与工具描述对齐。

```ts
interface WorkspaceInfoOk {
  ok: true;
  /** 当前代码工作区（文件工具、Git、工程脚本语义） */
  root: string;
  /** 解析后的 Vault 根目录（标准树顶层） */
  vaultRoot: string;
  vaultMode: 'nested' | 'global';
  /** 是否已检测到可用 Vault（例如 05-SYSTEM 或 bootstrap 完成） */
  vaultConfigured: boolean;
  /** global 模式下的项目 slug；nested 时也可带回，便于 UI 展示 */
  projectKey?: string;
  /** root 是否来自 ZYTRADER_WORKSPACE（便于调试） */
  workspaceFromEnv?: boolean;
}
```

失败分支：保留现有 `ok: false` + `error` 字符串约定。

### 3.6 Angular 渲染进程职责

| 服务 | 职责 |
|------|------|
| `DirectoryManagerService` | 加载/缓存 `directory.config.json`；`getVaultPath(key)`；与主进程 `vault:resolve` 或本地拼接策略二选一（推荐主进程单点解析，避免双端漂移）。 |
| `VaultBootstrapService` | 应用启动时调用 `vault:bootstrap`；向 `AppSettingsService` 或 signal 发布「Vault 就绪」。 |
| `AgentMemoryService` | 封装设计 PDF 中的 `writeShortTermMemory` / `writeLongTermMemory` / `readMemory`；底层使用现有 `list/read/write` IPC 或新增批量接口。 |
| `FileClassifierService` | 对 `IFileItem`（来自 list_dir 结果）分类，供工作台图标、过滤器、后续规则使用。 |

工作台 **文件树数据源**：

- **方案 A（推荐）**：树固定为「标准顶级节点」+ 懒加载子节点；不完全依赖根目录 `readdir` 的扁平顺序，避免用户在工作区根看到杂乱列表。  
- **方案 B**：仍以 `readdir` 为主，但插入「虚拟分组」节点映射到标准路径（实现复杂且易混淆，不推荐）。

---

## 4. 终端页 / 工作台 UI 改造清单

### 4.1 文件树

- 左侧树顶部显示 **Vault 根** 名称与「打开系统配置目录」快捷入口（`05-SYSTEM`）。  
- 顶级节点固定顺序：`00-INBOX` → `01-HUMAN-NOTES` → `02-AGENT-MEMORY` → `03-PROJECTS` → `04-RESOURCES` → `05-SYSTEM`。  
- `02-AGENT-MEMORY` 下四级子目录固定展示，即使为空也显示占位（与 PDF「Agent 友好」一致）。  
- 对 `03-PROJECTS`：子项为动态项目文件夹；每个项目下可选展示 `notes/`、`memory/`、`resources/`（若不存在则 grey 提示「未初始化」+ 一键创建）。

### 4.2 终端（PTY）

- 新建会话时 **默认 cwd**：`vaultRoot`（或配置项）。  
- 在终端区域提供下拉：**快速切换 cwd** 至 `00-INBOX/human`、`02-AGENT-MEMORY/01-Short-Term`、`03-PROJECTS/...`。  
- 与 `workspaceRoot` 不同的路径：若终端需进入代码仓库，保留「工作区根」快捷项，避免 Obsidian 用户与开发者场景冲突。

### 4.3 与「Agent 记忆优化」相关的交互

- 在 `02-AGENT-MEMORY` 节点上：显示最近一次写入时间、短期记忆数量（轻量统计：IPC `list` + 计数，或主进程汇总）。  
- （可选）右侧面板增加「本会话已写入短期记忆」列表，调用 `AgentMemoryService.readMemory({ type: 'short', keyword: sessionId })`。

---

## 5. 与 Claude Code / 现有 Agent 工具的衔接

- **工具描述层**：在 `zyfront-core.providers.ts`（或等价处）为模型补充说明：「结构化记忆请写入 `02-AGENT-MEMORY` 对应子目录，文件名遵循 `short-term-` / `long-term-` / `context-` 前缀」。  
- **任选增强**：提供专用 tool `memory.write_short_term` / `memory.list`，内部调用 `AgentMemoryService`，减少模型拼路径错误。  
- **会话关联**：短期记忆 JSON 增加 `sessionId` 字段（与设计 PDF 示例一致），与当前桌面会话 id 对齐（若已有则复用）。

---

## 6. 分阶段实施计划（建议排期）

### 阶段 0：契约与文档（0.5～1 天）

- [ ] 冻结 `directory.config.json` / `agent.config.json` 最小字段；在 `docs/` 保留本文档与示例 JSON。  
- [ ] 落地 **3.1 / 3.4 / 3.5**：`userData` 应用配置 + `workspace:info` 扩展字段；安装版 Workspace 默认值与开发回退路径写入 README。

### 阶段 1：Electron Vault Bootstrap + IPC（1～2 天）

- [ ] 实现 `vault:bootstrap`、`vault:resolve`，扩展 `workspace:info`。  
- [ ] 单元级：路径穿越测试、重复 bootstrap 幂等。  
- [ ] 更新 `zytrader-electron.d.ts`。

### 阶段 2：Angular 核心服务（1～2 天）

- [ ] 添加 `DirectoryManagerService`、`AgentMemoryService`、`FileClassifierService`（可先实现分类与路径解析，`RuleEngineService` stub）。  
- [ ] 类型文件 `agent.types.ts`、`file.types.ts` 与 PDF 示例对齐。

### 阶段 3：工作台树 + 终端 cwd（2～3 天）

- [ ] `workbench.page.ts`：`bootstrapWorkspace` 中等待 Vault 就绪；文件树改为固定结构数据源。  
- [ ] PTY 创建处传入默认 `cwd`（主进程 `createPtySession` 已有 `cwd` 参数）。  
- [ ] UI：顶级节点顺序、空目录占位、项目子树初始化按钮。

### 阶段 4：规则引擎与 Obsidian（按需，1～2 周+）

- [ ] `rule.config.json` 使用 **声明式** match（扩展名、相对路径 glob、mtime），由 `FileRuleEngineService` 解释；禁止 `eval`。  
- [ ] 短期记忆 7 天清理：定时器在主进程或后台任务触发，调用已有 delete/move。  
- [ ] `ObsidianParserService`：FrontMatter + `[[wikilink]]` 抽取，服务人类笔记与记忆关联字段。

### 阶段 5：验收与文档（0.5 天）

- [ ] 手工测试矩阵：Windows / 空 Vault / 已有自定义文件混杂 / 大仓库。  
- [ ] 更新 README：如何设置 `ZYTRADER_WORKSPACE`、首次启动行为。

---

## 7. 风险与已定稿问题

| 风险 | 缓解 |
|------|------|
| 默认 `workspaceRoot` 指向 monorepo 上级，Vault 相对路径易混乱 | UI 区分「工程根」与「Vault 根」；持久化配置 + 首次引导；见 3.1 优先级。 |
| 设计 PDF 中规则含 JS 函数字符串 | 仅采用 JSON 可解析子集；复杂逻辑用内置规则 id。 |
| 性能：大目录 list | Agent 记忆按子目录分散；必要时加缓存与 debounce。 |

**已定稿（原开放问题）**：

| 序号 | 问题 | 结论 |
|------|------|------|
| 1 | Vault 必须在仓库内还是用户目录？ | **两种均支持**：`nested`（默认开发友好）与 `global`（Obsidian 单库），由 3.4 配置选择。 |
| 2 | 是否同时多 Vault？ | **单实例一对 `(workspaceRoot, vaultRoot)`**；多项目通过 **切换 workspace** 重算 Vault，不要求同屏多 Vault。 |
| 3 | 与 Cursor / Claude Code 原生记忆双向同步？ | **本期不做**；以 Vault 内文件约定为唯一事实来源；后续如需再评估文件监视或外部 API。 |

---

## 8. 附录：关键代码锚点（便于开发跳转）

- Electron 工作区：`zyfront-desktop/main.js`（`workspaceRoot`、`zytrader:workspace:info`、`resolveSafePath`）。  
- 工作台：`zyfront-desktop/src/app/features/prototype/workbench/workbench.page.ts`（`bootstrapWorkspace`、`loadDir`、`workspaceRoot`）。  
- Agent 工具描述：`zyfront-desktop/src/app/core/zyfront-core.providers.ts`。  
- 类型定义：`zyfront-desktop/src/types/zytrader-electron.d.ts`。

---

*文档版本：2026-04-07（修订：多项目 / 部署定稿 + IPC 字段）· 与 PDF 第 1～14 页架构、目录、分类、规则引擎、AgentMemoryService 章节对齐；实施时可按阶段裁剪。*
