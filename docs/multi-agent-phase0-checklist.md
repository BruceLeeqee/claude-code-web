# Multi-Agent Phase 0 执行清单与 Phase 1 准入

> 目标：把“设计冻结”从口头计划变成可执行基线，避免 Phase 1 实现期出现协议漂移。

---

## A. Phase 0 交付物（已落地）

- [x] 架构规格文档：`docs/multi-agent-architecture-spec.md`
- [x] 事件协议文档：`docs/multi-agent-event-contract.md`
- [x] 类型草案：`zyfront-desktop/src/app/core/multi-agent/multi-agent.types.ts`
- [x] 事件类型草案：`zyfront-desktop/src/app/core/multi-agent/multi-agent.events.ts`
- [x] auto 检测与 fallback 冻结矩阵（文档内）

---

## B. Phase 0 决策冻结项

1. 双层模式模型冻结：
   - 协作策略层：`single|plan|parallel`
   - 执行后端层：`auto|in-process|tmux|iterm2`
2. 事件命名空间冻结：`multiagent.*`
3. teammate 状态机冻结：
   - `starting -> running -> idle|waiting -> stopping -> stopped|error`
4. 回退策略冻结：
   - 仅 `auto` 允许静默回退到 `in-process`
   - 显式 `tmux|iterm2` 失败必须报错（不静默改 mode）

---

## C. Phase 1 开发入口任务（就绪后可立即执行）

## C1. Backend 抽象
- [ ] 新建 `TeammateBackend` 接口（spawn/sendMessage/terminate/kill/isActive）
- [ ] 新建 backend registry（按 `BackendType` 注册/解析）

## C2. InProcess 最小闭环
- [ ] `InProcessBackend.spawn` 可返回 `TeammateSpawnResult`
- [ ] `sendMessage` 可写入消息桥
- [ ] `terminate/kill` 可更新状态并发事件

## C3. Mode Snapshot + Detection
- [ ] `TeammateModeSnapshotService`（会话级只读快照）
- [ ] `BackendDetectionService`（先给 in-process 保底实现）

## C4. Workbench 接线（最小）
- [ ] 新增 `teamContextVm` 信号
- [ ] 新增 `teammateBackendMode`/`effectiveBackend` 展示字段
- [ ] 右侧面板最小列表：name/status/backend

## C5. 事件总线
- [ ] 定义 `MultiAgentEventBus`（发布/订阅）
- [ ] Workbench 通过订阅构建 VM，不直连 backend 内部状态

---

## D. Phase 1 验收（进入 Phase 2 前）

- [ ] in-process 并发 3 agents 可稳定运行
- [ ] `spawn/message/stop/kill` 主路径跑通
- [ ] workbench 可实时显示 teammate 状态
- [ ] 关键事件完整可见：`spawned/state.changed/stopped/failed`
- [ ] 无阻断编译错误与新增 lint error

---

版本：v1.0-phase0-execution
日期：2026-04-14
