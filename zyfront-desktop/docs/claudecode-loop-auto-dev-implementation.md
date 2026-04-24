# Claude Code `/loop` 大任务自动拆解 / 自动开发 / 自动测试 / 自动验证 实现文档

> 目标：在 `zyfront-desktop` 中实现一套接近 Claude Code 风格的自动开发工作流，使 `/loop` 能够接收一个大任务后，自动完成任务拆解、代码开发、测试执行、结果验证、失败修复、状态收敛与上线前检查。
>
> 说明：本文档强调“高自治 + 强约束”。即系统可以尽量自动推进，但所有高风险动作（如破坏性文件修改、自动提交、自动推送、自动发布）必须具有可配置门禁与确认策略。

---

## 1. 总体目标

### 1.1 用户期望
用户输入一个大目标，例如：

- 实现某个新功能
- 重构某个模块
- 补齐一组测试
- 修复一批缺陷
- 自动推进直到可以验收上线

系统应自动完成：

1. 任务拆解
2. 技术方案规划
3. 代码定位与修改
4. 自动测试
5. 自动验证
6. 失败修复
7. 进度摘要与状态记录
8. 达到上线门槛后的收敛输出

### 1.2 设计原则

- **自动推进**：尽量减少人工干预
- **阶段验证**：每一轮都必须可校验
- **可中断**：用户可以随时暂停、接管、改目标
- **可回退**：错误修改后可以撤销或重试
- **可追踪**：每一步都要有摘要、状态、日志
- **可门禁**：高风险动作必须有明确授权

---

## 2. 关键结论

`/loop` 不是“无限循环直到把所有事情都做完”，而是一个 **自治开发工作流控制器**。它会在“完成 / 阻塞 / 暂停 / 需要确认 / 达到轮次上限”这些收敛条件之间迭代，更像：

```text
Goal -> Plan -> Execute -> Test -> Verify -> Repair -> Re-plan -> Continue / Stop
```

要做到“自动开发直到任务完成并准备上线”，需要把系统拆成 5 个核心层：

1. **命令入口层**：识别 `/loop`
2. **任务规划层**：把目标拆成任务树
3. **执行层**：调用工具、改代码、跑测试
4. **验证层**：判断结果、决定继续或停止
5. **记忆与收敛层**：记录状态、摘要、可追踪引用

---

## 3. 功能范围

### 3.1 必须实现

- `/loop <goal>` 命令
- 自动任务拆解
- 自动开发执行
- 自动测试执行
- 自动验证与修复
- 自动循环直到完成、阻塞、暂停或需要用户确认
- 任务状态持久化
- 结果摘要输出

### 3.2 可选增强

- 自动 git 提交
- 自动生成变更说明
- 自动打开 PR 草稿
- 自动生成上线检查清单
- 多 Agent 协作（Planner / Developer / Tester / Reviewer）

---

## 4. 模式定义

建议将 `/loop` 定义成三种协作模式的统一入口：

### 4.1 `plan`
仅做任务拆解与方案规划，不执行写操作。

### 4.2 `dev`
执行代码修改、测试与修复。

### 4.3 `loop`
全自动模式，默认包含：

- 计划
- 开发
- 测试
- 验证
- 修复
- 收敛

`loop` 是最高级模式，它会自动在 `plan/dev/test/verify` 之间切换，直到任务达到完成态，或者命中阻塞、暂停、确认门禁、轮次上限等收敛条件。

---

## 5. 高层架构

```text
CommandRouter
  -> LoopCommandService
  -> LoopSessionService
  -> LoopPlannerService
  -> LoopExecutorService
  -> LoopVerifierService
  -> LoopMemoryService
  -> LoopController
```

### 5.1 责任划分

#### `LoopCommandService`
- 解析 `/loop`
- 提取目标文本
- 创建 loop session
- 触发控制器

#### `LoopSessionService`
- 维护 loop 生命周期
- 保存 LoopState
- 管理轮次、状态、摘要、阻塞信息

#### `LoopPlannerService`
- 目标归一化
- 子任务树生成
- 依赖关系排序
- 验收标准生成

#### `LoopExecutorService`
- 文件读写
- 代码修改
- 命令执行
- 测试运行

#### `LoopVerifierService`
- 校验修改结果
- 运行 lint / build / test
- 判断是否通过

#### `LoopMemoryService`
- 写入总结
- 保存任务轨迹
- 维护可追踪引用

#### `LoopController`
- 协调各服务
- 控制循环
- 判断继续、暂停、终止

---

## 6. 核心状态模型

### 6.1 Loop 状态机

```ts
type LoopStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'repairing'
  | 'blocked'
  | 'paused'
  | 'ready_for_review'
  | 'ready_for_release'
  | 'completed'
  | 'failed';
```

### 6.2 状态说明

- `idle`：未启动
- `planning`：拆解任务中
- `executing`：修改代码或执行工具中
- `verifying`：运行测试和校验中
- `repairing`：根据验证结果修复中
- `blocked`：需要用户介入或缺少资源
- `paused`：用户暂停
- `ready_for_review`：开发完成，等待审阅
- `ready_for_release`：达到发布门槛，等待发布确认
- `completed`：任务完成
- `failed`：失败终止

### 6.3 LoopState

```ts
interface LoopState {
  loopId: string;
  taskId: string;
  objective: string;
  status: LoopStatus;
  iteration: number;
  maxIterations: number;
  currentPlan: LoopPlanStep[];
  completedSteps: LoopPlanStep[];
  blockedReasons: string[];
  validationHistory: LoopValidationResult[];
  toolHistory: LoopToolRecord[];
  fileChanges: LoopFileChangeRecord[];
  memoryRefs: string[];
  lastSummary: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## 7. 任务拆解设计

### 7.1 输入规范化

用户目标会被转成结构化输入：

```ts
interface LoopRequest {
  objective: string;
  scope?: string;
  constraints?: string[];
  successCriteria?: string[];
  maxIterations?: number;
  allowGitCommit?: boolean;
  allowGitPush?: boolean;
  requireUserApprovalForRelease?: boolean;
}
```

### 7.2 拆解策略

拆解时建议生成以下类型步骤：

- `analysis`
- `design`
- `implementation`
- `test`
- `verification`
- `repair`
- `summary`
- `release_check`

### 7.3 任务树结构

```ts
interface LoopPlanStep {
  id: string;
  title: string;
  type: 'analysis' | 'design' | 'implementation' | 'test' | 'verification' | 'repair' | 'summary' | 'release_check';
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  dependencies: string[];
  acceptance: string[];
  riskLevel: 'low' | 'medium' | 'high';
  outputs: string[];
}
```

### 7.4 拆解原则

- 每个步骤要足够小
- 每个步骤都能验证
- 每个步骤都要有明确输出
- 每个步骤都要尽量独立
- 高风险步骤必须标记

---

## 8. 自动执行设计

### 8.1 执行循环

每一轮 loop 只推进一个“最有价值的动作”：

1. 找相关文件
2. 定位修改点
3. 修改实现
4. 运行局部测试
5. 观察结果
6. 必要时修复
7. 更新状态
8. 决定下一轮

### 8.2 执行器输入

```ts
interface LoopExecutionInput {
  loopId: string;
  step: LoopPlanStep;
  context: {
    objective: string;
    files: string[];
    lastSummary: string;
    toolBudget: number;
  };
}
```

### 8.3 执行器输出

```ts
interface LoopExecutionResult {
  success: boolean;
  changedFiles: string[];
  toolCalls: LoopToolRecord[];
  notes: string[];
  nextHints: string[];
  needsVerification: boolean;
}
```

### 8.4 自动开发执行策略

#### 规则 1：先理解后修改
先读再写，不要盲改。

#### 规则 2：先局部后全局
优先最小影响范围。

#### 规则 3：先验证再继续
每轮输出都要经过验证。

#### 规则 4：失败先修复
若测试失败，优先修复失败，而不是继续下一步。

---

## 9. 自动测试设计

### 9.1 测试触发时机

- 修改文件后
- 完成一个子任务后
- 进入发布前验证时
- 出现关键错误时

### 9.2 测试类型

- `lint`
- `typecheck`
- `unit`
- `integration`
- `build`
- `smoke`

### 9.3 测试策略

#### 第一层：快速验证
- lint
- typecheck

#### 第二层：功能验证
- 单元测试
- 局部集成测试

#### 第三层：发布验证
- build
- smoke test

### 9.4 自动测试流程

1. 识别变更类型
2. 选择对应测试集合
3. 执行测试命令
4. 收集错误
5. 映射到修改区域
6. 若失败则进入修复轮次

---

## 10. 自动验证设计

### 10.1 验证内容

验证不仅是测试是否通过，还包括：

- 功能是否达标
- 是否符合预期设计
- 是否引入副作用
- 是否满足安全约束
- 是否具备发布条件

### 10.2 验证结果

```ts
interface LoopValidationResult {
  passed: boolean;
  stage: 'lint' | 'typecheck' | 'unit' | 'integration' | 'build' | 'smoke' | 'review';
  errors: string[];
  warnings: string[];
  blockers: string[];
  recommendation: 'continue' | 'repair' | 'pause' | 'stop' | 'release';
}
```

### 10.3 验证判定规则

- 若 lint/typecheck 失败：进入 repair
- 若单元测试失败：进入 repair 或 blocked
- 若 build 失败：进入 repair
- 若 smoke 通过：进入 review 或 release
- 若存在 blocker：暂停并请求用户介入

---

## 11. 修复策略设计

### 11.1 失败修复闭环

当验证失败时，系统应：

1. 读取错误信息
2. 定位错误来源
3. 重新生成修复计划
4. 修改最小必要文件
5. 再次执行测试
6. 直到通过或达到阈值

### 11.2 修复优先级

- 语法错误 > 类型错误 > 低级 lint 错误 > 业务逻辑错误 > 风格问题

### 11.3 连续失败处理

- 同一错误连续失败达到阈值 -> `blocked`
- 多轮无进展 -> `failed`
- 需要重大架构变更 -> `pause` 并请求确认

---

## 12. 自动收敛与上线门槛

### 12.1 收敛条件

任务可以进入“可上线”状态，需要满足：

- 功能实现完成
- 关键测试通过
- build 成功
- 无已知 blocker
- 变更摘要已记录

### 12.2 发布前检查

- 是否有未提交变更
- 是否有危险性操作
- 是否需要用户确认提交 / 推送
- 是否满足 release checklist

### 12.3 上线状态

```text
completed -> ready_for_release -> user_confirmed -> released
```

如果不允许自动发布，则停在 `ready_for_release`。

---

## 13. 权限与门禁设计

### 13.1 自动开发权限

建议将自动权限分为：

- `read`
- `write`
- `test`
- `verify`
- `git_commit`
- `git_push`
- `release`

### 13.2 门禁原则

- 读写代码：默认允许
- 运行测试：默认允许
- 自动提交：可配置
- 自动推送：默认需要确认
- 自动发布：默认需要确认
- 删除文件 / 重命名大量文件：高风险，建议确认

### 13.3 用户确认点

以下场景应要求用户确认：

- 删除关键文件
- 大范围重构
- 自动 git push
- 自动创建 PR / 发布
- 跨模块大改

---

## 14. 记忆与审计

### 14.1 每轮摘要

每轮 loop 结束必须记录：

- 本轮目标
- 执行结果
- 修改文件
- 测试结果
- 下一步建议

### 14.2 审计记录

建议保存：

- 工具调用日志
- 文件改动记录
- 验证结果
- 错误历史
- 用户确认历史

### 14.3 存储建议

- 会话级摘要：短期记忆
- 任务级摘要：任务目录
- 关键事实：共享池或项目记忆
- 归档摘要：历史归档

---

## 15. 推荐目录结构

```text
zyfront-desktop/
├─ src/app/features/prototype/workbench/
│  ├─ loop/
│  │  ├─ loop-command.service.ts
│  │  ├─ loop-controller.service.ts
│  │  ├─ loop-session.service.ts
│  │  ├─ loop-planner.service.ts
│  │  ├─ loop-executor.service.ts
│  │  ├─ loop-verifier.service.ts
│  │  ├─ loop-memory.service.ts
│  │  ├─ loop-state.types.ts
│  │  └─ loop.constants.ts
│  └─ ...
└─ docs/
   └─ claudecode-loop-auto-dev-implementation.md
```

---

## 16. `/loop` 命令建议语法

```text
/loop <目标描述>
/loop --max-iterations=20 <目标描述>
/loop --auto-commit <目标描述>
/loop --auto-push <目标描述>
/loop --require-review <目标描述>
/loop --test-only <目标描述>
```

### 参数说明

- `--max-iterations`：最大循环轮次
- `--auto-commit`：允许自动 git commit
- `--auto-push`：允许自动 git push
- `--require-review`：完成后停在审阅态
- `--test-only`：只做测试验证，不修改代码

---

## 17. 建议的执行流程

### 17.1 标准流程

1. 识别 `/loop`
2. 解析参数
3. 创建 LoopState
4. 拆解任务
5. 执行第一轮
6. 运行验证
7. 根据结果决定修复 / 继续 / 暂停 / 完成
8. 写摘要与审计日志

### 17.2 自动修复流程

1. 发现测试失败
2. 定位失败原因
3. 生成修复策略
4. 局部修改
5. 再次验证
6. 直到通过或阻塞

### 17.3 发布收敛流程

1. 功能完成
2. 所有测试通过
3. build 成功
4. 生成变更摘要
5. 等待用户确认提交 / 推送 / 发布

---

## 18. 与当前 `zyfront-desktop` 的结合点

你当前项目已经具备：

- 命令路由层
- 指令注册表
- workbench 输入处理链
- assistant flow / stream / mode executor 分层

因此可以直接在 `workbench` 下增补 loop 模块，复用现有能力：

- `CommandRouterService` 识别 `/loop`
- `CommandExecutorService` 分发 loop 执行
- `workbench.page.ts` 只保留 UI 和回显
- `LoopController` 负责自治工作流
- `LoopMemoryService` 对接任务记忆与摘要

---

## 19. 推荐的实现顺序

### 第一阶段：命令接入
- 新增 `/loop` 指令
- 解析参数
- 进入 loop state

### 第二阶段：规划层
- 实现任务拆解
- 生成子任务树
- 生成验收标准

### 第三阶段：执行层
- 接入文件修改
- 接入测试命令
- 接入 lint / build / unit

### 第四阶段：验证层
- 失败自动修复
- 验证收敛
- 自动摘要

### 第五阶段：收口与上线
- 自动提交策略
- 自动发布门禁
- 完成态收敛

---

## 20. 详细 TODO 任务列表

### 20.1 文档语义修订

- [ ] 明确 `/loop` 不是无限循环，而是带收敛条件的自治工作流
- [ ] 在总目标中补充“完成 / 阻塞 / 暂停 / 需要确认 / 上限”这些终止条件
- [ ] 统一全文中“自动循环”的表述，避免被理解为无条件永远执行
- [ ] 在模式定义里说明 `loop` 的边界与退出条件
- [ ] 在状态机里补充对收敛态的描述

### 20.2 实现拆分任务

- [ ] 实现 `/loop` 命令入口与参数解析
- [ ] 实现 LoopSession 生命周期管理
- [ ] 实现任务拆解与验收标准生成
- [ ] 实现执行器对文件修改、测试命令、验证命令的调度
- [ ] 实现失败修复闭环
- [ ] 实现摘要与记忆持久化
- [ ] 实现高风险操作门禁与确认流程
- [ ] 实现轮次上限与阻塞检测
- [ ] 实现完成态、审阅态、发布态的收敛逻辑

### 20.3 验证任务

- [ ] 验证 `/loop` 能正确识别输入目标
- [ ] 验证任务拆解能输出结构化步骤
- [ ] 验证测试失败后能进入 repair 轮次
- [ ] 验证达到条件后会停止而不是继续循环
- [ ] 验证用户暂停和接管能够立即生效
- [ ] 验证摘要能记录每轮结果和下一步建议

### 20.4 风险控制任务

- [ ] 为自动提交、自动推送、自动发布增加配置门禁
- [ ] 为删除文件和大范围重构增加确认提示
- [ ] 为连续失败增加阈值与阻塞升级策略
- [ ] 为状态回退与撤销增加恢复路径
- [ ] 为审计日志增加可追踪引用

### 20.5 交付顺序建议

1. 命令入口与状态机
2. 任务规划与拆解
3. 执行与测试
4. 验证与修复
5. 摘要、记忆与审计
6. 风险门禁与发布收敛

---

## 21. 最终总结

如果你的目标是“**给全部权限，实现大任务自动拆解、自动开发、自动测试、自动验证**”，那么真正正确的工程实现不是“放开一切限制”，而是：

- 给系统足够的自动执行能力
- 同时保留安全门禁
- 保留用户接管能力
- 保留验证与回退机制

换句话说，正确的实现不是“完全无约束的自动驾驶”，而是：

> **高自治 + 强验证 + 可中断 + 可追踪 + 可上线收敛**

这样才能真正把 `/loop` 做成一个可用于大任务自动开发的系统，而不是一个容易失控的死循环。
