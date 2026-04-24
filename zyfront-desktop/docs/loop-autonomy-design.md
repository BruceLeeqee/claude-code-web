# Loop 自治开发设计文档

## 1. 目标
构建一个**不中断运行**的自治开发循环，用于持续完成复杂开发任务。系统应支持：
- 自动编译、构建、测试与类型检查
- 自动打开并验证页面、终端和沙箱浏览器
- 自动检查 UI 效果、页面功能、后端接口与数据一致性
- 每一步都产出文档、状态和证据
- 失败后自动重试与修复
- 开发项目默认进入 `/mode-dev` 团队模式
- 支持通过命令为 loop 指定团队来完成不同任务

## 2. 设计原则
### 2.1 先需求，后设计，再开发
对于开发任务，流程必须严格遵守：
1. 先与用户头脑风暴需求
2. 再整理需求文档
3. 再整理设计文档
4. 只有在设计文档细节确认后，才开始进入开发实现

也就是说，**不要先改代码**。当任务是开发类任务时，必须先完成需求与设计的确认，再动手实现。

### 2.2 文档驱动
每个 loop 任务都要同步产出文档：
- 需求文档
- 设计文档
- 执行文档
- 验证文档
- 失败文档
- 总结文档

### 2.3 团队驱动
loop 不只是单体执行器，而是任务编排器。它可以根据命令为任务指定团队，并由团队协同完成任务。

## 3. 当前状态
现有实现已经具备：
- 命令入口与路由
- loop 状态持久化
- 基础执行器
- 基础验证器
- 启发式/结构化补丁能力
- 终端与文件工具访问
- debug 结果输出

当前不足：
- ~~还没有把"先需求后设计再开发"的流程作为强约束~~ ✅ 已实现（LoopVerifier 门禁 + LoopTaskRouter 路由）
- ~~`/mode-dev` 还没有完全整合进 loop 编排~~ ✅ 已实现（LoopTeamManagerService）
- ~~loop 还没有作为"多任务、多团队"的统一入口~~ ✅ 已实现（LoopTaskRouterService + /task 命令）
- ~~编译、UI、接口、数据的验证矩阵还不够完整~~ ✅ 已实现（check/api:check/data:check/ui:check 脚本 + TerminalSandboxService）
- ~~沙箱浏览器与终端虚拟环境还没有统一编排~~ ✅ 已实现（LoopSandboxRunnerService + LoopTerminalSandboxService）
- ~~每一步的文档产出还不够标准化~~ ✅ 已实现（7 个 loop-templates + LoopDocWriterService）
- ~~还缺少一份专门的多智能体团队重构文档来指导无人值守开发~~ → 参见 multi-agent-autonomous-dev-team-redesign.md

## 4. 目标架构

### 4.1 总体流程
1. 用户通过命令提交任务
2. loop 判断任务类型
3. 如果是开发类任务，先进入需求讨论阶段
4. 需求确认后生成需求文档
5. 再生成设计文档
6. 设计确认后才进入 `/mode-dev`
7. `/mode-dev` 创建开发团队并分配子任务
8. loop 负责统一编排各团队执行
9. 执行后进入编译、UI、接口、数据验证
10. 若失败则修复与重试
11. 直到收敛或达到上限

### 4.2 核心模块
- **Loop Orchestrator**：总编排器，负责任务分流、阶段控制、状态推进 → `LoopExecutorService`
- **Requirement Builder**：需求整理器，负责将用户想法整理成需求文档 → `LoopDocWriterService` + `requirements-template.md`
- **Design Builder**：设计整理器，负责把需求转成设计文档 → `LoopDocWriterService` + `design-template.md`
- **Team Manager**：负责 `/mode-dev` 团队创建、角色分配与任务派发 → `LoopTeamManagerService`
- **Task Router**：根据命令将任务分配给合适团队 → `LoopTaskRouterService`
- **Execution Runner**：负责代码、构建、测试、浏览器、接口、数据执行 → `LoopExecutorService` + `LoopTerminalSandboxService`
- **Sandbox Browser Runner**：负责虚拟浏览器或沙箱页面验证 → `LoopSandboxRunnerService`
- **Verifier Matrix**：负责多维度验证 → `LoopVerifierService` + check 脚本
- **Patch Engine**：负责修复补丁生成与应用 → `LoopPatchEngineService`
- **Doc Writer**：负责每一步文档输出 → `LoopDocWriterService` + `loop-templates/`
- **State Store**：负责状态、证据、历史与工件持久化 → `LoopCommandService` + `LoopArtifactStoreService`
- **Release Gate**：负责发布前收敛检查与审批门禁 → `LoopReleaseGateService`
- **Dashboard**：负责仪表盘与团队任务看板 → `LoopDashboardService`

## 5. `/mode-dev` 与 loop 的整合

### 5.1 作用
`/mode-dev` 不再只是一个独立模式，而是 loop 中的一个**开发团队编排入口**。

### 5.2 推荐职责划分
- **架构师**：负责需求澄清后输出设计方案
- **开发者**：负责实现代码变更
- **测试员**：负责编写与执行详细测试案例
- **验证员**：负责编译、UI、接口、数据验证
- **修复员**：负责失败后的修补与重试建议

### 5.3 整合方式
当 loop 判断任务属于开发类任务时：
1. 先进入需求整理阶段
2. 再进入设计确认阶段
3. 确认完成后自动调用 `/mode-dev`
4. 将任务拆成子任务并分配给团队角色
5. 由 loop 统一监督执行状态和验证结果

## 6. 命令驱动的任务分派

### 6.1 设计目标
loop 必须支持"通过命令指定团队完成任务"。

### 6.2 建议命令形式
- `/loop <目标>`：启动自治循环
- `/mode-dev`：创建开发团队
- `/task team=<teamName> objective=<objective>`：将任务派给指定团队
- `/task team=dev objective=实现登录页`：示例
- `/task team=test objective=补充测试案例`：示例

### 6.3 分派规则
- 命令解析后先识别任务类型
- 若是开发类任务，必须先进行需求/设计确认
- 若任务适合某个团队，则派发给对应团队执行
- loop 负责追踪各团队任务状态并收集产出

## 7. 验证矩阵
每轮执行都应至少覆盖以下维度：
- **编译验证**：build / typecheck / lint
- **UI 验证**：页面打开、组件显示、交互、截图、console 错误
- **接口验证**：API 状态码、schema、字段完整性、错误处理
- **数据验证**：持久化、一致性、缓存同步、读写正确性
- **终端验证**：命令输出、退出码、测试断言

每个验证器都应返回：
- `passed`
- `errors`
- `warnings`
- `blockers`
- `evidence`
- `recommendation`

## 8. 沙箱浏览器与终端验证

### 8.1 沙箱浏览器
系统应支持在隔离环境中运行页面验证，包括：
- 打开页面
- 导航
- 点击与输入
- 读取 DOM
- 记录 console
- 记录 network
- 截图
- 失败后重试

### 8.2 终端沙箱
系统应支持在终端 tab 中运行自动化验证：
- 编译
- 测试
- 构建
- 接口模拟调用
- 数据检查脚本

## 9. 模板

> **已落盘**：以下模板已生成到 `docs/loop-templates/` 目录，并由 `LoopDocWriterService` 在 loop 执行时自动读取和填充。
> 模板列表：
> - `requirements-template.md` — 需求文档模板
> - `design-template.md` — 设计文档模板
> - `execution-template.md` — 执行文档模板
> - `verification-template.md` — 验证文档模板
> - `repair-template.md` — 修复文档模板
> - `summary-template.md` — 总结文档模板
> - `status-template.md` — Loop 状态文档模板

### 9.1 需求文档模板
```markdown
# 需求文档：<任务名称>

## 1. 背景
- 为什么要做这个任务
- 当前问题是什么

## 2. 目标
- 目标 1
- 目标 2
- 目标 3

## 3. 范围
### 包含
- ...

### 不包含
- ...

## 4. 约束
- 技术约束
- 时间约束
- 交互约束
- 安全/权限约束

## 5. 成功标准
- ...

## 6. 关键问题（待澄清）
- 问题 1
- 问题 2

## 7. 讨论结论
- 结论 1
- 结论 2

## 8. 版本记录
- v0.1
```

### 9.2 设计文档模板
```markdown
# 设计文档：<任务名称>

## 1. 设计目标
- ...

## 2. 总体架构
- 模块 A
- 模块 B
- 模块 C

## 3. 关键流程
1. ...
2. ...
3. ...

## 4. 接口/命令设计
- 命令格式
- 输入输出
- 错误处理

## 5. 状态模型
- 字段说明
- 状态流转

## 6. 验证方案
- 编译验证
- UI 验证
- 接口验证
- 数据验证

## 7. 风险与回退方案
- 风险 1
- 缓解措施

## 8. 待确认细节
- 细节 1
- 细节 2

## 9. 最终确认
- 已确认项
- 未确认项
```

### 9.3 Loop 状态文档模板
```markdown
# Loop 状态：<loopId>

## 1. 基本信息
- 任务名称：
- 当前阶段：
- 当前状态：
- 当前团队：
- 当前命令：

## 2. 当前进度
- iteration：
- maxIterations：
- retryCount：
- 当前步骤：
- 下一步：

## 3. 验证矩阵
| 维度 | 状态 | 证据 | 备注 |
|---|---|---|---|
| 编译 |  |  |  |
| UI |  |  |  |
| 接口 |  |  |  |
| 数据 |  |  |  |
| 终端 |  |  |  |

## 4. 工件
- 文档：
- 截图：
- 日志：
- Patch：

## 5. 阻塞项
- ...

## 6. 下一步建议
- ...
```

## 10. 每一步文档要求

> **已实现**：`LoopStepDoc.content` 字段已扩展，`LoopDocWriterService` 已在 `loop-doc-writer.service.ts` 中实现，可自动读取模板、填充状态变量并写入磁盘。

每一步都必须记录文档与状态：
- **需求文档**：用户目标、范围、约束、成功标准
- **设计文档**：架构、模块、流程、验证、风险
- **执行文档**：本步做了什么、输入输出、工件
- **验证文档**：验证方式、结果、证据、失败原因
- **修复文档**：失败原因、修复策略、修复结果
- **总结文档**：本轮总结、下一步建议、是否收敛

## 11. 任务状态模型
建议在 loop state 中增加：
- ~~`stage`~~（已合并到 `phase`）
- `phase`
- `taskType`
- `teamName`
- `teamMembers`
- `sandboxId`
- `browserSessionId`
- `buildStatus`
- `uiStatus`
- `apiStatus`
- `dataStatus`
- `retryCount`
- `lastError`
- `lastEvidence`
- `stepDocs[]`
- `verificationMatrix[]`
- `artifacts[]`
- `requirementsDocPath`
- `designDocPath`

## 12. 推荐执行流程
### 11.1 开发任务
1. 用户提出需求
2. 与用户头脑风暴需求
3. 产出需求文档
4. 产出设计文档
5. 确认设计细节
6. 启动 `/mode-dev`
7. 团队开发
8. 编译验证
9. 沙箱浏览器/UI 验证
10. 接口验证
11. 数据验证
12. 失败修复
13. 重试
14. 收敛并总结

### 11.2 非开发任务
- 可按任务类型直接派发到合适团队
- 依然需要状态、证据和文档

## 13. 优先级 TODO 列表

### P0
- [x] 将 loop 的任务流程改为"先需求、后设计、再开发"的强约束
- [x] 将 `/mode-dev` 整合到 loop 编排中，作为开发任务默认团队入口（已实现 `loop-team-manager.service.ts`）
- [x] 为 loop 增加任务类型与团队分派能力（已实现 `loop-task-router.service.ts`，支持 /task 命令解析 + 开发门禁检查）
- [x] 为每一步增加标准化文档输出（已落盘至 `docs/loop-templates/`，由 `LoopDocWriterService` 自动填充）
- [x] 为 loop 增加验证矩阵状态

### P1
- [x] 增加编译/构建/typecheck 统一执行器
- [x] 增加沙箱浏览器 runner 与页面验证能力（已实现 `loop-sandbox-runner.service.ts`，支持 zytrader.browser API 和 CLI 降级）
- [x] 增加 API 验证与数据验证能力（已落盘 `scripts/api-check.mjs` / `scripts/data-check.mjs` / `scripts/ui-check.mjs` / `scripts/check.mjs`，已在 `package.json` 注册）
- [x] 增加失败修复与重试策略（已增强 `LoopVerifierService`：连续失败 3 次升级 blocked + 多轮无进展检测 + 修复判定规则；已实现 `LoopPatchEngineService`：优先 AST 结构化修补 → 启发式修补 → 连续失败升级）
- [x] 增加终端 tab 级的虚拟验证环境（已实现 `loop-terminal-sandbox.service.ts`，封装编译/lint/类型检查/单元测试/综合验证矩阵）

### P2
- [x] 将启发式补丁升级为更结构化的修补引擎（已实现 `loop-patch-engine.service.ts`：错误分类 → 策略选择 → AST/heuristic 双路径 → 连续失败升级）
- [x] 增加任务级文档索引与工件归档（已实现 `loop-artifact-store.service.ts`：构建 ArtifactIndex + 渲染 markdown + 写入磁盘）
- [x] 增加 loop 仪表盘，稳定展示当前状态与证据（已实现 `loop-dashboard.service.ts`：DashboardViewModel + 团队看板 + 验证矩阵 + 活动记录 + 渲染 markdown）
- [x] 增加团队任务看板与阶段流转视图（已集成到 `loop-dashboard.service.ts`：`buildTeamKanban()` 方法，按角色分配步骤）
- [x] 增加发布前收敛检查与审批门禁（已实现 `loop-release-gate.service.ts`：发布清单 + Git 提交/推送/发布门禁 + 高风险变更确认）

## 14. 成功标准
当系统能够：
- 不中断地完成复杂开发任务
- 先完成需求与设计，再进入开发
- 自动编译、自动验证 UI / 接口 / 数据
- 自动在沙箱中检查页面效果
- 自动产出每一步文档和证据
- 自动重试并收敛
- 通过 `/mode-dev` 团队模式持续推进任务

则认为系统达到目标。

## 15. 风险与缓解
### 风险 1：自动修复过于激进
缓解：限制修补范围，要求证据驱动，设置重试上限。

### 风险 2：需求未确认就进入开发
缓解：对开发任务强制执行"需求 -> 设计 -> 开发"门禁。

### 风险 3：验证结果不稳定
缓解：采用多维验证矩阵，保留证据与历史。

### 风险 4：团队协作混乱
缓解：由 loop 统一编排，明确角色职责与状态转移。

### 风险 5：文档与状态不同步
缓解：文档由状态机驱动生成，避免手工维护漂移。

## 16. 下一步

> 以下 4 项已全部实现：
> 1. ✅ 任务类型识别与团队分派 → `loop-task-router.service.ts`
> 2. ✅ 需求/设计门禁 → `LoopVerifierService` + `LoopTaskRouterService.checkDevelopmentGate()`
> 3. ✅ `/mode-dev` 与 loop 的统一编排 → `loop-team-manager.service.ts` + `LoopExecutorService` 集成
> 4. ✅ 验证矩阵与步骤文档自动生成 → check 脚本 + `LoopDocWriterService` + 7 个 loop-templates

> **优化轮已完成**（详见 `docs/loop-optimization-and-manual.md`）：
> - ✅ O-01: `/task` 命令已接入 `debug-command-parser` + `DebugCommandService`
> - ✅ O-02: 5 个未调用服务已全部集成到 `LoopExecutorService`（TaskRouter / TeamManager / SandboxRunner / TerminalSandbox / ReleaseGate）
> - ✅ O-03: `implementation` 步骤改为 `requires-agent` 模式，暂停等待 AI Agent 对接
> - ✅ O-04: 新增 `/loop status|stop|resume|step` 控制命令
> - ✅ O-05: 删除 `LoopCommandService` 重复 `verify()`，统一使用 `LoopVerifierService`
> - ✅ O-06+07: 去重 `buildTeamMembers` / `defaultTeamName` / `inferTaskType`，统一委托给 `LoopTeamManagerService` / `LoopTaskRouterService`
> - ✅ O-08: 合并 `stage` → `phase`，全局统一为单一字段
> - ✅ O-09: `stepDocs` / `fileChanges` / `blockedReasons` 增加 `.slice()` 上限；验证通过时清空 `blockedReasons`
> - ✅ O-10: `PatchEngine.consecutiveFailures` 持久化到 `LoopState.patchFailureMap`
> - ✅ O-11: Dashboard / ArtifactStore 写入错误 `console.warn` 记录
> - ✅ O-12: 模板路径优先 `workspace` scope 再降级 `vault` scope
> - ✅ O-13: 创建 `zytrader.d.ts` 类型声明
> - ✅ O-14: 跨平台命令前缀 `cmdPrefix()`（Windows → `cmd.exe /c`，其他 → 无前缀）
> - ✅ O-15: `execCommand` 增加超时 120s
> - ✅ O-17: 删除 `LoopCommandService.runCycle()` 死代码
> - ✅ O-18: Debug Tab 增加 Loop 域（团队信息 + 发布门禁 + 验证矩阵 + 工件摘要）

后续可继续推进的方向：
- 与真实 AI Agent 对接，替换 `implementation` 步骤的 requires-agent 占位
- 增加 e2e 测试覆盖
- 增加可视化仪表盘 UI 组件（当前为 markdown 输出）
