# 命令系统复刻实施计划（对齐 `claude-code/restored-src/src`）

> 目标：参考 `E:\AGENT-ROOT\04-PROJECTS\claude-code\restored-src\src` 中的真实命令系统实现，结合当前项目 `zyfront-desktop` 现有 `CommandRouterService` / `directive-registry` / workbench 输入链路，复刻出一套与源码思路一致的命令系统，并形成可分阶段落地的工程计划。

---

## 1. 目标与范围

### 1.1 本次复刻的核心目标
- 让用户输入在进入 workbench 前，具备与参考源码一致的“意图分流”能力。
- 将输入明确划分为三类：
  - `directive`：斜杠指令 / 系统命令
  - `shell`：终端命令
  - `natural`：自然语言请求
- 保持“解析、路由、执行、回显、错误提示”四个层次清晰分离。
- 为后续扩展 `/help`、`/mode`、`/plugin:*`、`/doctor` 等命令留出统一扩展点。

### 1.2 对齐参考源码的范围
重点参考源码中的以下链路与思想：
- `src/utils/processUserInput/processUserInput.ts`
- `src/utils/slashCommandParsing.ts`
- `src/commands.ts`
- `src/commands/*`
- `src/utils/processUserInput/processSlashCommand.tsx`
- `src/utils/processUserInput/processBashCommand.tsx`

重点复刻的不是“某一个函数签名”，而是以下能力模型：
1. **命令识别**：输入前缀与语义特征识别。
2. **安全分流**：桥接消息、远程输入、系统生成提示等特殊来源的隔离。
3. **指令注册**：统一指令注册表，支持模板、说明、usage、kind。
4. **命令执行**：不同类型命令走不同处理器。
5. **失败回退**：未知命令、不可用命令、冲突输入的用户提示。
6. **可扩展性**：新增命令不应修改大量业务分支。

---

## 2. 现状分析

### 2.1 当前项目已有能力
当前 `zyfront-desktop` 已存在以下基础实现：
- `CommandRouterService`
  - 根据输入内容推断 `directive` / `shell` / `natural`
- `directive-registry.ts`
  - 已有部分指令定义：`/help`、`/status`、`/mode-*`、`/plugin:*`、`/superpowers:brainstorm`、`/doctor`
- `workbench.page.ts`
  - 已接入命令路由与指令注册表

### 2.2 现有实现的主要不足
与参考源码相比，当前实现还偏“轻量 heuristics”，缺少以下关键能力：
1. **输入处理链路分层不够完整**
   - 当前主要是路由判断
   - 参考源码是“输入预处理 → 附件/图像/桥接判定 → slash/bash/text 分流 → hook → 执行”的完整链路

2. **命令解析能力较弱**
   - 参考源码中有独立的 `parseSlashCommand`、命令查找、桥接安全命令判断
   - 当前更多依赖字符串前缀和少量静态规则

3. **命令定义信息不够完整**
   - 当前 `DirectiveDefinition` 只有 `name/desc/template/kind/usage`
   - 参考源码通常还会包含 command 的可执行条件、上下文约束、显示分组、是否可在特定模式下使用等信息

4. **shell / directive / natural 之间的边界不够稳定**
   - 当前 heuristics 能满足基础使用，但对中文自然语言、复杂 shell 片段、复合命令的处理还需强化

5. **缺少统一的执行适配层**
   - 参考源码中不同输入会进入不同执行器
   - 当前 workbench 还需要明确“路由结果如何落到实际执行器”

---

## 3. 参考源码的实现思路拆解

### 3.1 输入处理总流程
参考源码的核心思想可以概括为：

1. 接收用户输入
2. 标准化输入（字符串 / 块 / 附件 / 图像）
3. 检查是否为特殊来源
   - 远程桥接消息
   - 系统生成提示
   - 计划模式 / bash 模式 / prompt 模式
4. 对 slash 命令与 bash 命令分别分流
5. 其余内容作为自然语言 prompt

### 3.2 关键决策点
参考源码中比较值得复刻的决策逻辑有：
- 以 `/` 开头默认进入指令处理
- 以 `!` 开头强制 shell
- 以 `?` 开头偏自然语言
- 含中文时偏自然语言
- 含明显 shell 特征时偏 shell
- 对“桥接输入”要区别处理，不允许直接触发本地命令
- 对未知 `/foo` 之类输入要优雅回退，而不是直接报错打断整体链路

### 3.3 指令系统的结构特征
参考源码的命令体系更接近“注册式系统”，而不是简单 if/else：
- 命令名统一登记
- 命令元信息统一管理
- 解析层只做命令识别
- 执行层按命令类型分发
- UI 层只负责展示与输入，不嵌业务逻辑

---

## 4. 目标架构设计

### 4.1 总体架构
建议将当前命令系统拆成四层：

```text
用户输入
  -> Command Preprocessor（标准化 / 特殊来源识别 / 前缀保留）
  -> Command Router（directive / shell / natural）
  -> Command Parser（解析 / 识别 / 参数拆分 / 命令查找）
  -> Command Executor（按类型执行并回显）
```

### 4.2 推荐职责划分

#### A. `CommandRouterService`
负责：
- 输入类型初判
- shell / natural / directive 路由
- 只保留“轻规则 + 可配置的优先级”

#### B. `DirectiveRegistry`
负责：
- 所有斜杠指令的元数据注册
- 指令说明、模板、usage、分类
- 后续扩展命令的统一入口

#### C. `DirectiveParser`
负责：
- `/xxx arg1 arg2` 解析
- 命令名与参数提取
- 识别未知命令

#### D. `CommandExecutionAdapter`
负责：
- 把 directive / shell / natural 分发到真正执行器
- 统一错误回显格式
- 统一日志与埋点

---

## 5. 详细复刻计划

## Phase 0：现状基线冻结与命令样本梳理（0.5 天）

### 任务
- [ ] 梳理当前 `zyfront-desktop` 已有命令与入口
- [ ] 记录当前 workbench 输入链路
- [ ] 从参考源码中整理命令样本：
  - slash 命令
  - bash 命令
  - 自然语言命令
  - 远程/桥接输入
- [ ] 定义回归测试样本集

### 交付物
- 当前命令系统基线清单
- 参考源码命令样本清单
- 对比用输入样例表

---

## Phase 1：重构命令识别层（1 天）

### 任务
1. 升级 `CommandRouterService`
   - [ ] 降低硬编码词表耦合
   - [ ] 增加自然语言与 shell 的冲突处理策略
   - [ ] 增加对路径、管道、重定向、变量展开的判断
   - [ ] 增加中文自然语言优先级处理

2. 引入更明确的路由结果类型
   - [ ] `directive`
   - [ ] `shell`
   - [ ] `natural`
   - [ ] `unknown`（可选，用于无法判定场景）

3. 增加路由解释能力
   - [ ] 输出为什么判为 shell / natural / directive
   - [ ] 便于调试与未来遥测

### 验收
- [ ] 常见中文提问不会误判为 shell
- [ ] 常见 shell 命令不会误判为自然语言
- [ ] `/` 开头命令保持强识别

---

## Phase 2：重构指令注册表与解析层（1 天）

### 任务
1. 扩展 `DirectiveDefinition`
   - [ ] 增加 `group`
   - [ ] 增加 `aliases`
   - [ ] 增加 `enabledWhen`
   - [ ] 增加 `platform` / `mode` 约束（如需要）
   - [ ] 增加 `visibleInHelp`

2. 新增统一解析器
   - [ ] 解析 `/command arg1 arg2`
   - [ ] 解析带冒号的指令，如 `/plugin:list`
   - [ ] 解析未知指令并给出友好回退

3. 增加命令查找机制
   - [ ] 从 registry 中按 name/alias 查找
   - [ ] 统一处理模板与 usage 展示

### 验收
- [ ] 新命令可只通过注册表配置接入
- [ ] 解析结果包含 commandName、args、def、raw
- [ ] 未知命令可回退到自然语言或提示

---

## Phase 3：重构执行分发层（1.5 天）

### 任务
1. 明确三类执行器
   - [ ] `DirectiveExecutor`
   - [ ] `ShellExecutor`
   - [ ] `NaturalLanguageExecutor`

2. 为每类执行器定义统一输入输出协议
   - [ ] 输入：原始文本、解析结果、上下文、附加块
   - [ ] 输出：回显消息、工具调用、错误信息、是否继续查询

3. 对齐参考源码的处理风格
   - [ ] directive 输入优先执行本地逻辑
   - [ ] shell 输入明确交给 shell 路径
   - [ ] natural 输入进入对话/模型路径

4. 统一错误与回显格式
   - [ ] 未知命令提示
   - [ ] 不可用命令提示
   - [ ] 权限不足提示
   - [ ] 远程输入禁用提示

### 验收
- [ ] 三类命令路径完全分离
- [ ] 每条输入都有确定的执行落点
- [ ] 错误提示统一且可读

---

## Phase 4：接入参考源码式特殊输入策略（1 天）

### 任务
1. 增加桥接/远程输入保护
   - [ ] 识别远程来源
   - [ ] 禁止远程输入误触发本地 slash 指令
   - [ ] 为允许的安全命令保留白名单

2. 增加模式相关约束
   - [ ] 不同 workbench 模式下允许的命令不同
   - [ ] 计划模式 / 开发模式 / 单智能体模式分别限制命令面

3. 增加前缀保留规则
   - [ ] `/`、`!`、`?` 等前缀行为可配置
   - [ ] 支持“显式覆盖”与“自动推断”共存

### 验收
- [ ] 远程输入不会越权执行本地命令
- [ ] 模式切换不会污染指令处理
- [ ] 显式前缀优先级正确

---

## Phase 5：workbench 输入主链路改造（1.5 天）

### 任务
1. 在 workbench 中实现统一输入处理入口
   - [ ] 输入进入前先标准化
   - [ ] 再做路由
   - [ ] 最后分发到对应执行器

2. 去掉输入逻辑分散在组件中的问题
   - [ ] 将命令判断从 UI 层抽出
   - [ ] 让组件只负责交互、状态、展示

3. 增加执行回显统一格式
   - [ ] directive 执行结果
   - [ ] shell 执行结果
   - [ ] natural 执行结果

### 验收
- [ ] workbench 入口代码可读性提升
- [ ] 输入到执行路径清晰可追踪
- [ ] 不同类型输入表现一致

---

## Phase 6：帮助系统与帮助文档联动（0.5~1 天）

### 任务
- [ ] `/help` 自动读取 registry 并生成帮助内容
- [ ] 按 group 分组展示命令
- [ ] 展示 usage / description / example
- [ ] 为后续文档化保留导出接口

### 验收
- [ ] 帮助内容与注册表同步
- [ ] 新增命令后无需手写帮助页

---

## Phase 7：调试、日志与回归测试（1 天）

### 任务
1. 增加命令路由日志
   - [ ] 原始输入
   - [ ] 路由结果
   - [ ] 解析命令名
   - [ ] 执行器类型

2. 增加样本回归测试
   - [ ] 中文自然语言
   - [ ] shell 命令
   - [ ] slash 指令
   - [ ] 混合输入
   - [ ] 远程输入

3. 增加失败场景测试
   - [ ] 未知命令
   - [ ] 参数缺失
   - [ ] 不可执行命令
   - [ ] 冲突前缀输入

### 验收
- [ ] 样本集通过率稳定
- [ ] 路由行为可解释
- [ ] 修改规则后能快速回归

---

## 6. 关键改造点清单

### 6.1 必做项
- [ ] 命令路由结果可解释化
- [ ] 指令注册表结构增强
- [ ] 解析层与执行层解耦
- [ ] workbench 输入链路统一
- [ ] 远程/桥接输入保护
- [ ] `/help` 与 registry 自动同步

### 6.2 可选增强项
- [ ] 命令别名系统
- [ ] 命令分组与权限控制
- [ ] 路由调试面板
- [ ] 命令埋点与统计
- [ ] shell 命令预警与风险提示

---

## 7. 预计输出的代码结构

建议新增或调整如下模块：

```text
src/app/features/prototype/workbench/
  ├── command-router.service.ts
  ├── directive-registry.ts
  ├── directive-parser.ts        # 新增
  ├── command-executor.service.ts # 新增
  ├── command-routing.types.ts    # 新增
  └── workbench.page.ts
```

如果后续需要更彻底地对齐参考源码，可进一步拆出：

```text
src/app/features/prototype/workbench/commands/
  ├── help.command.ts
  ├── status.command.ts
  ├── mode.command.ts
  ├── plugin.command.ts
  └── doctor.command.ts
```

---

## 8. 风险与应对

### 风险 1：过度拟合参考源码，导致当前工程复杂度激增
- 应对：先复刻“能力边界”，再逐步补齐细节，不一次性照搬所有命令。

### 风险 2：shell / natural 的误判仍然存在
- 应对：保留手动显式前缀（`/`、`!`、`?`），并引入路由解释与回归样本。

### 风险 3：命令执行逻辑散落到组件中
- 应对：必须通过统一执行适配层进入执行器，UI 层只做展示。

### 风险 4：远程输入和本地输入混淆
- 应对：在输入预处理阶段强制带上来源上下文，并设置白名单。

---

## 9. 推荐实施顺序

推荐顺序如下：

`Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7`

原因：
1. 先固化样本和边界。
2. 再把路由与解析稳定下来。
3. 然后重构执行分发。
4. 最后统一接入 workbench 与帮助系统。
5. 最终通过日志与测试闭环验证。

---

## 10. 最终验收标准

当以下条件全部满足时，认为命令系统复刻达标：

1. **结构一致性**
- 输入层、路由层、解析层、执行层四层清晰分离。

2. **功能一致性**
- 支持 directive / shell / natural 三路分流。
- 支持 `/help`、`/status`、`/mode*`、`/plugin*`、`/doctor` 等基础指令。
- 支持未知指令回退。

3. **安全一致性**
- 远程输入不会越权触发本地命令。
- 特殊模式下命令行为可控。

4. **可维护性**
- 新增命令只需改 registry 与执行器，不需要到处加分支。
- 具有样本回归与调试日志。

---

## 11. 立即可执行的下一步

1. 先把当前 `CommandRouterService` 升级为“可解释路由”。
2. 把 `DirectiveDefinition` 扩展为更完整的命令元数据结构。
3. 新增 `directive-parser.ts` 与 `command-executor.service.ts`。
4. 将 workbench 输入链路统一到一个总入口。
5. 以参考源码命令样本做第一轮回归验证。
