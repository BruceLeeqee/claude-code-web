# zyfront-desktop 多智能体底层架构重构详细设计文档

> 版本：v1.0
> 
> 范围：`zyfront-desktop` / `zyfront-core` / `zyfront-web` 中与多智能体、子智能体、团队协作、提示词模板、命令路由相关的底层架构重构。
> 
> 参考来源：
> - 现有 `zyfront-desktop` 实现（尤其是 `workbench.page.ts`、`multi-agent`、`model-catalog.ts`、命令执行与流式协作链路）
> - `claude-code/restored-src` 中的团队与子智能体源码（`TeamCreateTool`、`teamHelpers`、`teammateMailbox`、`teamMemoryOps`、`teammatePromptAddendum`、`teamDiscovery` 等）
> - 用户提出的命令与工作流需求

---

## 1. 背景与目标

当前系统已经具备较多「多智能体」相关能力，但能力分散在工作台、命令执行、团队侧边栏、提示词构建、模型设置等多个层面，存在以下问题：

1. **概念混杂**
   - 子智能体（Subagent）与智能体团队（Agent Team）混在一起，能力边界不清晰。
   - 命令、提示词模板、团队运行时、任务分配、消息通信没有统一抽象。

2. **命令能力不完整**
   - 需要支持：
     - `/team-role new "角色提示词"`
     - `/team-role list`
     - `/team-role info 角色名`
     - `/team-struct new "角色协作流程"`
     - `/team-struct list`
     - `/team-struct info 协作结构名`
     - `/team run struct "智能体结构" "团队任务"`
     - `/team-subagent frontend,backend "实现模块"`
     - `/team-agent frontend,backend,qa "解决登录 500 错误"`
   - 这些命令需要统一纳入工作台指令体系，而不是散落在单个页面或单个服务中。

3. **团队协作缺少「Claude Code 风格」基础设施**
   - 需要角色文件、协作结构文件、团队状态文件、共享任务列表、邮箱系统、会话清理、提示词注入与模板生成。
   - 需要把「隔离执行」与「沟通协作」变成可切换、可组合的架构，而不是单一模式。

4. **需要支持混合编排**
   - 编码开发要用 Subagent 做并行隔离执行。
   - 集成验证、联调、bug 排查、PR 评审要用 Agent Team 做共享上下文协作。
   - 团队结构要支持阶段切换：并行开发 → 协作排查 → 回归验证。

本次重构目标是：**建立统一的多智能体底层架构，让角色定义、协作结构、团队运行时、子智能体调用、团队通信、命令解析与 UI 展示全部围绕同一套模型运行。**

---

## 2. 设计原则

### 2.1 角色与结构分离
- **角色文件（Role）**：定义单个 agent 的职责、边界、工具、模型、权限、提示词。
- **协作结构文件（Struct）**：定义一组角色如何协同、按什么阶段运行、谁先谁后、是否并行、如何切换模式。
- **团队实例（Team Runtime）**：由命令启动后的运行态，承载任务、状态、消息、执行日志。

### 2.2 子智能体与团队的统一建模
- 角色文件同一份定义可以同时被：
  - `team-subagent` 作为一次性工具化子智能体调用
  - `team-agent` 作为团队成员加入长期协作团队
- 区别不是「角色定义」不同，而是「运行模式」不同。

### 2.3 命令驱动 + 结构化文件驱动
- 所有复杂能力必须通过可解析命令触发。
- 命令触发后，优先落盘结构化文件，确保可追溯、可编辑、可复用、可恢复。

### 2.4 面向 Claude Code 经验对齐
参考 `claude-code/restored-src`，团队系统必须具备以下核心能力：
- 团队文件
- 团队成员注册
- 任务目录/共享任务列表
- 收件箱/发件箱消息系统
- 角色提示词附加内容
- 团队记忆同步与状态跟踪
- 会话发现与清理

---

## 3. 现状分析

### 3.1 `zyfront-desktop` 当前可见基础
从现有实现可见以下基础已存在：

- `zyfront-desktop/src/app/features/prototype/workbench/workbench.page.ts`
  - 已存在复杂的工作台主流程、命令路由、流式执行、终端呈现、多智能体状态展示等逻辑。
- `zyfront-desktop/src/app/core/multi-agent/multi-agent.types.ts`
  - 已定义 `WorkbenchTeamVm`、`WorkbenchTeammateVm`、`TeamLifecycleStatus`、`TaskLifecycleStatus` 等数据模型。
- `zyfront-desktop/src/app/core/model-catalog.ts`
  - 已有模型目录和 provider 配置，适合作为团队/角色模型选择基础。
- `zyfront-desktop/src/app/core/multi-agent/services/workbench-mode.service.ts`
  - 已存在工作台模式管理能力，可作为团队模式与普通模式切换基础。
- `zyfront-desktop/src/app/core/multi-agent/multi-agent-sidebar.component.ts`
  - 已存在团队侧边栏展示基础。

### 3.2 当前问题推断
结合代码结构与用户需求，当前实现大概率存在：
- 团队命令与普通指令混在一起，解析层不够结构化。
- 角色提示词与协作结构缺少专门管理，不利于复用。
- 子智能体与团队成员在运行模式、生命周期、权限模型上未完全分层。
- 缺少类似 Claude Code 的 mailbox / team file / memory sync 机制。

---

## 4. 来自 claude-code 源码的关键可借鉴机制

### 4.1 团队创建与团队文件
参考 `TeamCreateTool` 与 `teamHelpers`：
- 团队创建会生成唯一团队名。
- 团队文件落盘到团队目录。
- 团队文件中记录：
  - 团队名称
  - lead agent id
  - 领导 session id
  - members 列表
  - hidden pane ids
  - allowed paths
- 团队创建后会注册 session cleanup，避免残留。

### 4.2 邮箱系统
参考 `teammateMailbox.ts`：
- 每个团队成员有独立 inbox 文件。
- 支持写消息、读取未读、标记已读。
- 使用文件锁保证并发安全。
- 适合实现 agent-to-agent 的直接通信。

### 4.3 角色附加提示词与记忆系统
参考 `teammatePromptAddendum.ts`、`teamMemoryOps.ts`、`teamMemPrompts.ts`：
- 角色提示词不是单独静态模板，而是可动态拼接的 addendum。
- 团队运行时可附加：
  - 角色职责
  - 任务目标
  - 工具约束
  - 允许修改范围
  - 协作协议

### 4.4 团队发现与会话恢复
参考 `teamDiscovery.ts`：
- 团队可以被发现、恢复、重连。
- 团队状态需要可序列化并可恢复。

### 4.5 团队生命周期与清理
参考 `TeamDeleteTool`、`collapseTeammateShutdowns` 等：
- 支持团队结束、资源清理、成员退出、会话恢复与 shutdown 通知。
- 这对桌面端稳定性非常重要。

---

## 5. 目标能力清单

### 5.1 角色管理命令 `/team-role`

#### 5.1.1 `/team-role new "角色提示词"`
功能：
1. 根据用户输入的自然语言描述，生成「角色提示词模板」。
2. 创建角色文件。
3. 自动打开该文件 tab。
4. 允许用户继续编辑。

建议行为：
- 自动生成文件头部 YAML frontmatter。
- 自动生成正文结构：
  - 角色定义
  - 职责范围
  - 工具权限
  - 工作流
  - 质量标准
  - 交付物
- 文件路径建议：`03-AGENT-TOOLS/01-Roles/{slug}.md`

#### 5.1.2 `/team-role list`
功能：列出所有角色文件。

输出建议：
- 角色名
- 类型（subagent / agent-team）
- 适用模型
- 最近修改时间
- 描述

#### 5.1.3 `/team-role info 角色名`
功能：查看并编辑角色提示词文件。

建议行为：
- 如果文件存在，打开编辑 tab。
- 如果不存在，提示用户可创建。
- 支持从文件 frontmatter 读取元数据并展示摘要。

---

### 5.2 协作结构管理命令 `/team-struct`

#### 5.2.1 `/team-struct new "角色协作流程"`
功能：
1. 根据用户输入的协作描述生成协作结构模板。
2. 创建协作结构文件。
3. 自动打开该文件 tab。

协作结构文件建议包含：
- struct 名称
- 适用场景
- 参与角色列表
- 阶段定义
- 并行/串行规则
- 触发条件
- 切换条件
- 失败处理与回退策略
- 产物汇总策略

建议文件路径：`03-AGENT-TOOLS/02-Structs/{slug}.md`

#### 5.2.2 `/team-struct list`
功能：列出所有角色协作提示词文件。

#### 5.2.3 `/team-struct info 协作结构名`
功能：查看编辑协作结构提示词文件。

---

### 5.3 团队运行命令 `/team run`

#### 5.3.1 `/team run struct "智能体结构" "团队任务"`
功能：
- 基于指定 struct 启动一个预定义团队任务。
- 系统根据 struct 定义自动创建成员、任务阶段与通信渠道。

建议流程：
1. 读取 struct 文件。
2. 根据 struct 解析参与角色与阶段。
3. 创建团队实例。
4. 初始化共享任务列表、邮箱、运行状态。
5. 将「团队任务」作为主目标写入团队上下文。
6. 如果 struct 定义为 hybrid，则自动按照阶段执行：
   - stage 1：subagent 并行
   - stage 2：team 协作
   - stage 3：subagent 回归

---

### 5.4 子智能体命令 `/team-subagent`

#### 5.4.1 `/team-subagent frontend,backend "实现模块"`
功能：
- 指定具体 agent 智能体工具执行。
- 用于一轮或一次性的隔离任务。
- 调度时每个角色各自拿到独立上下文，执行完成后回收。

建议输出：
- 每个 subagent 的结果摘要
- 文件修改列表
- 风险提示
- 是否需要进入 team 协作阶段

适用：
- 代码生成
- 代码搜索
- 单元测试生成
- 单角色重构

---

### 5.5 团队协作命令 `/team-agent`

#### 5.5.1 `/team-agent frontend,backend,qa "解决登录 500 错误"`
功能：
- 启动一个 Agent Team。
- 指定多个角色组成长期协作会话。
- 支持实时通信、任务分配、共同排障。

建议行为：
- 自动生成 team file。
- 自动生成 lead agent。
- 自动绑定共享任务列表。
- 自动打开团队侧边栏和各成员标签页（如需要）。
- 支持成员间消息发送与收件箱查看。

适用：
- 联调排障
- 安全审查
- 复杂 PR 评审
- 多角色需求讨论

---

## 6. 统一概念模型设计

### 6.1 核心实体

#### 6.1.1 Role
单个角色定义文件。

字段建议：
- `name`
- `type: subagent | agent-team`
- `description`
- `model`
- `tools`
- `disallowedTools`
- `permissionMode`
- `maxTurns`
- `promptTemplate`
- `capabilities`
- `constraints`

#### 6.1.2 Struct
协作结构文件，描述团队如何运转。

字段建议：
- `name`
- `type: subagent | agent-team | hybrid`
- `description`
- `roles`
- `stages`
- `handoffRules`
- `communicationRules`
- `completionCriteria`
- `failurePolicy`

#### 6.1.3 TeamRuntime
团队运行时。

字段建议：
- `teamId`
- `leadAgentId`
- `structName`
- `status`
- `members`
- `tasks`
- `inboxes`
- `logs`
- `artifacts`
- `createdAt`
- `updatedAt`

#### 6.1.4 Task
团队任务。

字段建议：
- `id`
- `title`
- `assignee`
- `status`
- `dependencies`
- `inputs`
- `outputs`
- `blockers`
- `nextStep`

#### 6.1.5 Message
成员间通信消息。

字段建议：
- `from`
- `to`
- `content`
- `summary`
- `timestamp`
- `read`
- `relatedTaskId`

---

## 7. 文件系统设计

### 7.1 建议目录结构

```text
03-AGENT-TOOLS/
  01-Roles/
    frontend-developer.md
    backend-developer.md
    qa-engineer.md
  02-Structs/
    fullstack-dev-with-fix.md
    security-review.md
    pr-verification.md
  03-Teams/
    {team-id}/
      team.json
      tasks.json
      inboxes/
        {agent}.json
      logs/
      artifacts/
```

### 7.2 Role 文件模板
建议沿用用户提供模板，并增强为可生成模板：
- frontmatter 保留机器可读元数据。
- 正文保留人类可读策略。
- 文件应支持直接编辑。

### 7.3 Struct 文件模板
Struct 文件应明确描述「阶段编排」而不只是静态说明。

示例字段：
- `stages:`
  - `name`
  - `mode` (`subagent` / `agent-team`)
  - `roles`
  - `parallel`
  - `trigger`
  - `max_rounds`
  - `output`

---

## 8. 命令解析与工作流设计

### 8.1 命令统一入口
建议建立统一的 Team Command Router，处理以下命令族：
- `/team-role`
- `/team-struct`
- `/team run`
- `/team-subagent`
- `/team-agent`

解析策略：
1. 先识别命令族。
2. 再识别子命令（new/list/info/run）。
3. 提取参数（名称、角色列表、任务文本）。
4. 校验是否存在文件或团队。
5. 路由到对应服务。

### 8.2 解析规则建议
- 角色列表支持逗号分隔：`frontend,backend,qa`。
- 名称支持中文或英文，但落盘建议统一 slug 化。
- 所有 `new` 命令支持「自然语言生成模板」与「自动打开 tab」。

### 8.3 自动打开 tab
在命令执行结果中，如果创建了角色或结构文件：
- 通过桌面端打开对应编辑 tab
- 聚焦到新文件
- 若用户在已有工作区内操作，则保持当前上下文不丢失

---

## 9. Prompt 生成与模板策略

### 9.1 角色提示词生成器
当用户执行 `/team-role new "角色提示词"` 时：
1. 将输入描述转换成系统化角色定义。
2. 自动生成 frontmatter。
3. 自动填充模板段落。
4. 生成可读、可编辑、可复用的 markdown 文件。

生成模板应包含：
- 角色目标
- 职责边界
- 工具限制
- 协作方式
- 输出标准
- 失败处理

### 9.2 协作结构生成器
当用户执行 `/team-struct new "角色协作流程"` 时：
1. 识别输入中的角色组合、阶段、触发条件。
2. 生成结构模板。
3. 给出可执行的阶段编排建议。

### 9.3 模板生成策略
- 使用统一提示词模板骨架。
- 允许用模型补全，避免人工逐条编写。
- 若用户输入含场景（如登录 bug、PR 审查），自动注入常见阶段。

---

## 10. 运行时编排设计

### 10.1 Subagent 编排
Subagent 模式强调隔离：
- 每个角色独立上下文。
- 不共享 mailbox。
- 不共享任务列表。
- 只返回摘要与产物路径。

适合：
- 搜索
- 生成
- 单点修复
- 独立验证

### 10.2 Agent Team 编排
Agent Team 模式强调协作：
- 共享任务列表。
- 共享 mailbox。
- 共享团队状态。
- 成员间可直接发消息。

适合：
- 多角色互相确认
- 联调排障
- 安全/性能/测试三方审查
- 需要多轮讨论的工作

### 10.3 Hybrid 编排
针对复杂研发任务，推荐混合模式：

#### 阶段 1：并行开发
- `mode: subagent`
- 多角色各自处理独立模块
- 强调速度与隔离

#### 阶段 2：集成协作
- `mode: agent-team`
- 针对联调失败、接口不一致、bug 排查等问题进行协作
- 强调沟通与收敛

#### 阶段 3：回归验证
- `mode: subagent`
- QA 或验证角色单独执行回归测试

这正是用户提出的「编码开发分工隔离 + 集成问题协作闭环」的最佳解。

---

## 11. 与现有 `zyfront-desktop` 组件的集成建议

### 11.1 `workbench.page.ts`
建议拆分职责：
- 命令解析层
- 团队生命周期层
- 提示词构建层
- 终端/流式输出层
- UI 状态层

目标：减少巨型文件中职责耦合。

### 11.2 `multi-agent.types.ts`
建议扩展：
- `RoleDefinition`
- `StructDefinition`
- `TeamRuntimeState`
- `TeamMessage`
- `TeamTask`
- `TeamRunMode`
- `TeamStageDefinition`

### 11.3 `model-catalog.ts`
建议增加：
- 团队角色默认模型映射
- 场景模型推荐策略
- 子智能体/团队模式下的模型建议

### 11.4 `workbench-mode.service.ts`
建议扩展为：
- team 模式
- subagent 模式
- hybrid 模式
- 结构化命令执行模式

### 11.5 `multi-agent-sidebar.component.ts`
建议增强展示：
- 角色列表
- struct 当前阶段
- mailbox 未读数
- 任务列表
- 成员状态
- 运行日志摘要

---

## 12. 与 Claude Code 机制的对齐映射

| Claude Code 机制 | zyfront-desktop 重构映射 |
|---|---|
| TeamCreateTool | `/team-agent` 或 `/team run` 启动团队 |
| teamHelpers.ts | 团队目录、团队文件、生命周期管理 |
| teammateMailbox.ts | 成员间消息系统 |
| teamMemoryOps.ts | 团队记忆与上下文持久化 |
| teammatePromptAddendum.ts | 角色提示词附加片段生成 |
| teamDiscovery.ts | 团队发现与恢复 |
| TeamDeleteTool | 团队关闭与清理 |
| InProcessTeammateTask | Subagent/本地执行器模式 |

---

## 13. 安全与权限设计

### 13.1 角色权限
每个角色文件必须声明：
- 可用工具
- 禁用工具
- 文件修改范围
- 允许访问目录
- 允许写入范围

### 13.2 团队权限
团队级别应有：
- 共享允许路径
- 任务目录写权限
- 邮箱读写权限
- 终端权限

### 13.3 风险控制
- 默认禁止跨角色越权编辑。
- `team-subagent` 默认严格隔离。
- `team-agent` 允许协作，但需记录消息与任务轨迹。
- 团队结束时自动清理临时状态。

---

## 14. UI/UX 设计建议

### 14.1 角色/结构文件编辑器
- 新建后自动打开 tab。
- 提供模板预览与可编辑正文。
- frontmatter 与正文分区显示更清晰。

### 14.2 团队运行面板
展示：
- 当前 struct
- 阶段进度
- 成员状态
- 任务列表
- mailbox 未读数
- 最近消息
- 运行日志

### 14.3 命令反馈
每个命令执行后应给出清晰反馈：
- 文件创建成功
- 文件已打开
- 团队已启动
- 角色已加入
- 协作结构已加载
- 任务已分配

---

## 15. 推荐的数据结构草案

### 15.1 RoleDefinition
```ts
interface RoleDefinition {
  name: string;
  type: 'subagent' | 'agent-team';
  description: string;
  model?: string;
  tools: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  prompt: string;
}
```

### 15.2 StructDefinition
```ts
interface StructDefinition {
  name: string;
  type: 'subagent' | 'agent-team' | 'hybrid';
  description: string;
  roles: string[];
  stages: Array<{
    name: string;
    mode: 'subagent' | 'agent-team';
    roles: string[];
    parallel?: boolean;
    trigger?: string;
    maxRounds?: number;
  }>;
}
```

### 15.3 TeamRuntimeState
```ts
interface TeamRuntimeState {
  id: string;
  structName: string;
  status: 'running' | 'paused' | 'completed' | 'error';
  leadAgentId: string;
  members: string[];
  tasks: TeamTask[];
  messages: TeamMessage[];
  updatedAt: number;
}
```

---

## 16. 落地实施顺序建议

### Phase 1：基础抽象
- 定义 Role / Struct / TeamRuntime / Task / Message 数据模型。
- 拆分命令路由。
- 实现角色文件与协作结构文件的创建/列表/查看/编辑。

### Phase 2：团队运行时
- 实现团队实例创建、成员注册、任务状态、生命周期管理。
- 引入 mailbox 文件系统。
- 引入团队记忆与会话恢复。

### Phase 3：命令编排
- 实现 `/team run`。
- 实现 `/team-subagent`。
- 实现 `/team-agent`。
- 打通文件自动打开与侧边栏联动。

### Phase 4：混合编排
- 支持 struct stages。
- 支持 subagent → team → subagent 的切换。
- 支持 bug 修复、联调、回归流程。

### Phase 5：优化与清理
- 提升 UI 可视化。
- 优化日志、消息、任务聚合。
- 对齐 Claude Code 的 cleanup 和 discovery 机制。

---

## 17. 风险点与对策

### 17.1 命令系统过度复杂
**风险**：指令过多后难以维护。  
**对策**：统一路由、统一 schema、统一输出格式。

### 17.2 角色文件失控膨胀
**风险**：模板不一致、重复角色过多。  
**对策**：提供标准模板与元数据校验。

### 17.3 团队状态与 UI 不同步
**风险**：会话文件、任务文件、界面状态分裂。  
**对策**：建立单一真相源（team runtime state）。

### 17.4 协作过度导致成本升高
**风险**：Agent Team 常驻消耗大。  
**对策**：默认采用 subagent，只有协作场景才升级为 team。

---

## 18. 重构后预期效果

1. 用户可以像 Claude Code 一样先定义角色，再定义协作结构，再运行团队。
2. 子智能体用于快而独立的工作，Agent Team 用于需要沟通的复杂问题。
3. `/team-role` 和 `/team-struct` 形成可复用资产库。
4. `/team run` 让预定义协作结构一键运行。
5. `/team-subagent` 与 `/team-agent` 明确区分隔离执行与协作执行。
6. 桌面端可以直接打开模板文件 tab，提升编辑体验。
7. 架构具备后续扩展到更多模式的能力。

---

## 19. 待办事项（重构 TODO）

### 19.1 核心架构
- [x] 定义 `RoleDefinition`、`StructDefinition`、`TeamRuntimeState`、`TeamTask`、`TeamMessage` 等统一模型。
- [x] 将现有多智能体状态模型升级为「角色 / 结构 / 团队实例」三层模型。
- [x] 拆分 `workbench.page.ts` 中的命令解析、团队调度、流式输出与 UI 状态逻辑。

### 19.2 角色与结构文件
- [x] 实现 `/team-role new`：生成角色提示词模板、落盘、自动打开 tab。
- [x] 实现 `/team-role list`：列出所有角色文件。
- [x] 实现 `/team-role info`：打开并编辑指定角色提示词文件。
- [x] 实现 `/team-struct new`：生成协作结构模板、落盘、自动打开 tab。
- [x] 实现 `/team-struct list`：列出所有协作结构文件。
- [x] 实现 `/team-struct info`：打开并编辑协作结构文件。

### 19.3 团队运行与编排
- [x] 实现 `/team run struct "智能体结构" "团队任务"`。
- [x] 实现 struct 阶段编排（subagent / agent-team / hybrid）。
- [x] 实现 `team-subagent` 的多角色隔离执行。
- [x] 实现 `team-agent` 的多角色协作运行。
- [x] 增强团队状态面板，展示阶段、成员、任务、消息与日志。

### 19.4 参考 Claude Code 的基础设施
- [x] 引入团队文件（team file）落盘机制。
- [x] 引入共享任务列表机制。
- [x] 引入 inbox mailbox 通信机制。
- [x] 引入团队记忆与会话恢复机制。
- [x] 引入团队结束清理机制。

### 19.5 产品体验与稳定性
- [x] 命令执行结果统一化、结构化。
- [x] 新建文件自动打开编辑 tab。
- [x] 支持错误回退与状态恢复。
- [x] 补充针对团队命令的单元测试与集成测试。
- [x] 对关键流程增加日志、诊断与调试入口。

---

## 20. 具体模块拆分建议

### 20.1 命令层
建议新增统一命令入口服务：
- `team-command-router.service.ts`
- `team-role-command.service.ts`
- `team-struct-command.service.ts`
- `team-run-command.service.ts`
- `team-subagent-command.service.ts`
- `team-agent-command.service.ts`

职责划分：
- Router 负责识别命令族与参数。
- Role/Struct 服务负责文件模板、落盘、列表、查看、打开。
- Run/Subagent/Agent 服务负责运行时编排与结果汇总。

### 20.2 资源层
建议把资源文件统一落到工作区的可管理目录，例如：
- `03-AGENT-TOOLS/03-Roles/`
- `03-AGENT-TOOLS/04-Structs/`
- `03-AGENT-TOOLS/05-Teams/`
- `03-AGENT-TOOLS/06-Tasks/`
- `03-AGENT-TOOLS/07-Messages/`

这样可以和现有 Vault/资源目录结构对齐，也便于搜索、编辑与版本管理。

### 20.3 运行态服务层
建议新增：
- `role-registry.service.ts`：扫描与解析角色文件
- `struct-registry.service.ts`：扫描与解析协作结构
- `team-runtime.service.ts`：创建/更新/结束团队实例
- `team-mailbox.service.ts`：消息读写与未读统计
- `team-task-board.service.ts`：共享任务列表
- `team-memory.service.ts`：团队记忆、摘要、恢复
- `team-orchestration.service.ts`：subagent/team/hybrid 编排

### 20.4 UI 层
建议拆分工作台中的多智能体 UI：
- 左侧：角色/结构/团队资产库
- 中间：当前命令执行与团队运行态
- 右侧：任务板、消息、日志、成员状态

---

## 21. 状态机设计

### 21.1 角色文件状态
角色文件本身是静态资源，但编辑态需要支持：
- `draft`
- `ready`
- `deprecated`
- `archived`

### 21.2 协作结构状态
协作结构文件建议支持：
- `draft`
- `ready`
- `experimental`
- `archived`

### 21.3 团队运行状态
团队运行建议显式状态机：
- `created`
- `initializing`
- `running`
- `awaiting-handoff`
- `blocked`
- `paused`
- `completed`
- `failed`
- `cleaning-up`
- `closed`

### 21.4 任务状态
任务建议扩展为：
- `pending`
- `claimed`
- `in_progress`
- `blocked`
- `reviewing`
- `done`
- `rejected`
- `cancelled`

---

## 22. 命令输出规范

所有团队相关命令建议统一返回结构化结果：

```ts
interface CommandResult<T = unknown> {
  ok: boolean;
  command: string;
  message: string;
  data?: T;
  warnings?: string[];
  errors?: string[];
  openedFiles?: string[];
  createdFiles?: string[];
}
```

统一好处：
- UI 更容易渲染
- 自动化测试更容易断言
- 后续命令扩展不会破坏输出协议

---

## 23. 文件模板建议

### 23.1 Role 文件 frontmatter 建议
```md
---
name: frontend-developer
type: agent-team
description: 负责实现UI组件、界面交互和前端状态管理的专家。
model: claude-sonnet-4-20260514
tools: [Read, Write, Edit, Grep, Glob, Bash]
disallowedTools: [WebSearch]
permissionMode: acceptEdits
maxTurns: 40
---
```

### 23.2 Struct 文件 frontmatter 建议
```md
---
name: fullstack-dev-with-fix
type: hybrid
description: 前后端并行开发 + 集成排障 + 回归验证的混合结构。
roles: [frontend-developer, backend-developer, qa-engineer]
stages:
  - name: parallel-development
    mode: subagent
    roles: [frontend-developer, backend-developer, qa-engineer]
    parallel: true
  - name: integration-verification
    mode: agent-team
    roles: [frontend-developer, backend-developer, qa-engineer]
    max_rounds: 3
  - name: regression
    mode: subagent
    roles: [qa-engineer]
---
```

---

## 24. 迁移与兼容策略

### 24.1 兼容现有工作台能力
重构不能一次性推翻现有命令与侧边栏，建议：
- 先保留现有 `multi-agent` 类型与状态展示
- 再在其上叠加 Role / Struct / TeamRuntime 三层模型
- 最后逐步替换旧命令路由

### 24.2 兼容现有模型目录
`model-catalog.ts` 不需要大改，但建议新增：
- 角色默认模型推荐表
- team/subagent 推荐模型策略
- 场景到模型的映射函数

### 24.3 兼容现有终端/流式输出
团队命令的执行结果应复用现有终端流式输出能力，避免重复造轮子。

---

## 25. 验收标准

本次重构完成后，至少应满足：

1. 用户可通过 `/team-role new` 创建新角色文件并自动打开。
2. 用户可通过 `/team-struct new` 创建协作结构文件并自动打开。
3. 用户可通过 `/team run struct ...` 启动预定义团队任务。
4. 用户可通过 `/team-subagent` 调度多个隔离子智能体。
5. 用户可通过 `/team-agent` 创建可沟通的团队协作会话。
6. 团队运行态可展示成员、任务、消息、日志。
7. 命令执行结果可结构化回传并可用于自动测试。
8. 团队结束后能正确清理临时状态与资源。

---

## 26. 结论

本次重构不只是补命令，而是要把 `zyfront-desktop` 的多智能体系统升级为一个完整的「角色定义 - 协作结构 - 团队运行时 - 子智能体执行 - 团队协作」的统一平台。

最重要的设计选择是：
- **Subagent 负责隔离执行，追求效率**
- **Agent Team 负责协作闭环，追求一致性**
- **Hybrid 负责真实研发流程，兼顾隔离与沟通**

只要这三层抽象立住，后续新增角色、结构、命令、消息、任务、日志、记忆都可以在同一底座上自然扩展。

---

## 27. 每个里程碑的具体任务清单

### 27.1 Milestone 0 任务
- [x] 梳理现有 `workbench.page.ts` 中与多智能体、命令解析、终端输出相关的职责边界。
- [x] 标出当前已存在的团队能力、命令能力、文件能力、UI 能力。
- [x] 形成"现状能力矩阵"和"缺口矩阵"。
- [x] 定义本次重构不触碰的稳定接口与兼容约束。

### 27.2 Milestone 1 任务
- [x] 建立角色文件、协作结构文件、团队运行时、任务、消息的统一 TypeScript 类型。
- [x] 明确角色文件和结构文件的目录前缀、命名规则、slug 规则。
- [x] 定义文件 frontmatter schema 与校验规则。
- [x] 预留未来扩展字段，但保持最小必要字段集。

### 27.3 Milestone 2 任务
- [x] 实现角色文件的新建、列出、查看、编辑。
- [x] 实现协作结构文件的新建、列出、查看、编辑。
- [x] 为“新建”流程增加模板生成器。
- [x] 完成“创建后自动打开 tab”的 UI 链路。

### 27.4 Milestone 3 任务
- [x] 实现 `/team-subagent` 命令解析。
- [x] 实现多角色并行调度。
- [x] 为每个 subagent 分配独立上下文和独立结果回收。
- [x] 输出摘要、文件变更、风险提示和下一步建议。

### 27.5 Milestone 4 任务
- [x] 实现 `/team-agent` 命令解析。
- [x] 创建团队运行时与成员注册流程。
- [x] 建立共享任务列表与消息收件箱机制。
- [x] 提供团队生命周期状态展示与恢复能力。

### 27.6 Milestone 5 任务
- [x] 实现 `/team run struct ...`。
- [x] 实现 struct 阶段解析器。
- [x] 实现 subagent 与 agent-team 的阶段切换。
- [x] 加入失败升级、回归验证与自动收敛策略。

### 27.7 Milestone 6 任务
- [x] 将团队运行状态映射到侧边栏与工作台面板。
- [x] 统一命令执行反馈格式。
- [x] 提供成员、任务、消息、日志的可视化。
- [x] 增加文件自动打开与聚焦体验。

### 27.8 Milestone 7 任务
- [x] 为核心命令建立单元测试与端到端测试。
- [x] 增加失败恢复、状态清理和资源回收验证。
- [x] 记录团队运行日志与故障排查入口。
- [x] 完成兼容性回归，确保旧命令与旧状态不被破坏。

---

## 21. 按开发阶段拆分的里程碑计划

### Milestone 0：现状盘点与边界冻结
**目标**：确认现有实现边界，避免重构过程中引入行为漂移。

**产出**：
- 现有命令入口与多智能体状态图
- `workbench.page.ts` 职责拆分清单
- Claude Code 机制对照表
- 迁移风险清单

**验收标准**：
- 能明确哪些能力已经存在、哪些是缺失项
- 确认新架构不破坏现有工作台主流程

### Milestone 1：统一模型与文件规范
**目标**：先把数据模型和落盘格式立住。

**范围**：
- `RoleDefinition`
- `StructDefinition`
- `TeamRuntimeState`
- `TeamTask`
- `TeamMessage`
- 角色文件与协作结构文件目录规范

**产出**：
- TypeScript 接口定义
- 目录约定
- 文件模板 schema

**验收标准**：
- 新建的角色/结构文件可被稳定解析
- 目录结构可被统一枚举、读取与编辑

### Milestone 2：角色与协作结构资产化
**目标**：实现 `/team-role` 与 `/team-struct`，让角色和结构成为可管理资产。

**范围**：
- `/team-role new`
- `/team-role list`
- `/team-role info`
- `/team-struct new`
- `/team-struct list`
- `/team-struct info`
- 新文件自动打开 tab

**产出**：
- 角色模板生成器
- 协作结构模板生成器
- 文件打开/聚焦能力

**验收标准**：
- 用户可通过命令创建并编辑角色/结构文件
- 文件内容遵循统一 frontmatter + 正文模板

### Milestone 3：Subagent 隔离执行链路
**目标**：把单次隔离任务跑通。

**范围**：
- `/team-subagent`
- 多角色并行任务调度
- 独立上下文创建与回收
- 摘要回传与产物列表

**产出**：
- Subagent 执行器
- 结果汇总器
- 风险/阻塞提示

**验收标准**：
- 指定 frontend,backend,qa 可并行执行不同任务
- 每个 subagent 的上下文互不污染

### Milestone 4：Agent Team 协作运行时
**目标**：实现长期协作团队和成员通信。

**范围**：
- `/team-agent`
- 团队创建与销毁
- 共享任务列表
- mailbox 收件箱/发件箱
- 成员状态、日志、消息同步

**产出**：
- Team runtime state
- 通信系统
- 团队面板数据源

**验收标准**：
- frontend/backend/qa 能在一个团队里互相发消息
- 团队状态可持续跟踪并可恢复

### Milestone 5：Hybrid 编排与 `/team run`
**目标**：支持“先隔离开发，再协作排障，再回归验证”的真实研发流程。

**范围**：
- `/team run struct "智能体结构" "团队任务"`
- struct stages 解析与执行
- subagent → agent-team → subagent 切换
- 失败自动升级到协作阶段

**产出**：
- 流程编排器
- 阶段状态机
- 回归验证入口

**验收标准**：
- 能按 struct 自动驱动不同阶段执行
- 能处理“开发隔离”和“联调协作”的切换

### Milestone 6：UI 联动与体验完善
**目标**：让命令、文件、团队运行态在界面上形成闭环。

**范围**：
- 自动打开编辑 tab
- 团队侧边栏增强
- 阶段/成员/任务/消息可视化
- 命令反馈统一化

**产出**：
- 更清晰的团队运行面板
- 命令执行反馈规范
- 调试入口与日志聚合

**验收标准**：
- 用户能直观看到角色、结构、团队、消息、任务的关系
- 常见操作无需手动翻目录查文件

### Milestone 7：稳定性、测试与清理
**目标**：补齐工程化能力，进入可持续迭代状态。

**范围**：
- 单元测试与集成测试
- 状态恢复与错误回退
- 团队结束清理
- 与现有多智能体模式兼容

**产出**：
- 回归测试集
- 清理脚本/清理流程
- 兼容性说明

**验收标准**：
- 核心命令与团队流程无明显回归
- 失败场景可恢复、可定位、可清理

### 里程碑排序建议
推荐执行顺序为：
1. Milestone 0：现状盘点与边界冻结
2. Milestone 1：统一模型与文件规范
3. Milestone 2：角色与协作结构资产化
4. Milestone 3：Subagent 隔离执行链路
5. Milestone 4：Agent Team 协作运行时
6. Milestone 5：Hybrid 编排与 `/team run`
7. Milestone 6：UI 联动与体验完善
8. Milestone 7：稳定性、测试与清理

这样可以先把“数据与文件”立住，再实现“执行与协作”，最后做“体验与稳定性”。
