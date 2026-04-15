# Multi-Agent Event Contract（Phase 0 冻结版）

> 目标：冻结多智能体事件名称、payload 结构、状态语义，确保 runtime 与 workbench 可稳定对接。

---

## 1. 事件命名规范

- 前缀：`multiagent.`
- 资源域：`mode | backend | teammate | team | message | error`
- 动词：过去式或状态变化式（`captured` / `detected` / `spawned` / `state.changed`）
system：系统内部事件
leader：主智能体（领导者）
teammate：协作智能体（队友）
backend：后端服务
user：终端用户
---

## 2. 基础事件信封

```ts
interface MultiAgentEventEnvelope<TType extends string, TPayload> {
  type: TType;
  ts: number; // epoch ms
  sessionId: string;
  requestId?: string;
  source: 'system' | 'leader' | 'teammate' | 'backend' | 'user';
  payload: TPayload;
}
```

---

## 3. 事件列表（冻结）

## 3.1 模式与后端

### `multiagent.mode.captured`
```ts
本地调试、想看终端 → iterm2（GUI可视化窗口，关掉终端终止运行）                   → 本地开发
服务器、长期任务 → tmux（CLI后台终端，关掉终端继续运行，可以切回去继续看）         → 服务器长期任务
自动化、无交互、快速 → in-process（不弹窗）                                    → 自动化脚本
不知道选啥 → auto（自动选）                                                    → 自动运行
{
  configuredMode: 'auto' | 'in-process' | 'tmux' | 'iterm2';
  snapshotAt: number;
}
```

### `multiagent.backend.detected`
```ts
{
  configuredMode: 'auto' | 'in-process' | 'tmux' | 'iterm2';
  effectiveBackend: 'in-process' | 'tmux' | 'iterm2';
  platform: string;
  capabilities: {
    tmuxAvailable: boolean;
    itermAvailable: boolean;
    inProcessAvailable: boolean;
  };
}
```

### `multiagent.backend.fallback`
```ts
{
  fromMode: 'auto' | 'in-process' | 'tmux' | 'iterm2';
  toBackend: 'in-process' | 'tmux' | 'iterm2';
  reason: string;
  blocking: boolean; // true 表示显式模式失败导致阻断
}
```

---

## 3.2 teammate 生命周期

### `multiagent.teammate.spawned`
```ts
{
  identity: TeammateIdentity;
  backend: 'in-process' | 'tmux' | 'iterm2';
  paneId?: string;
  windowId?: string;
}
```

### `multiagent.teammate.state.changed`
```ts
{
  agentId: string;
  prev: 'starting' | 'running' | 'idle' | 'waiting' | 'stopping' | 'stopped' | 'error';
  next: 'starting' | 'running' | 'idle' | 'waiting' | 'stopping' | 'stopped' | 'error';
  reason?: string;
}
```

### `multiagent.teammate.stopped`
```ts
{
  agentId: string;
  graceful: boolean;
  reason?: string;
}
```

### `multiagent.teammate.killed`
```ts
{
  agentId: string;
  signal?: string;
  reason?: string;
}
```

### `multiagent.teammate.failed`
```ts
{
  agentId?: string;
  stage: 'spawn' | 'message' | 'stop' | 'kill' | 'detect';
  code?: string;
  message: string;
  retriable: boolean;
}
```

---

## 3.3 消息与团队

### `multiagent.teammate.message`
```ts
{
  direction: 'leader_to_teammate' | 'teammate_to_leader' | 'teammate_to_teammate';
  fromAgentId: string;
  toAgentId?: string;
  teamName: string;
  text: string;
  textPreview: string;
}
```

### `multiagent.team.updated`
```ts
{
  teamName: string;
  leadAgentId: string;
  teammateIds: string[];
  version: number;
}
```

### `multiagent.error`
```ts
{
  scope: 'backend' | 'lifecycle' | 'message' | 'ui';
  code?: string;
  message: string;
  details?: Record<string, unknown>;
}
```

---

## 4. Workbench 投影规则

1. Workbench 只消费事件流构建 VM，不直接调用 backend 内部对象。
2. `spawned` 一定先于同 agent 的 `state.changed(next=running)`。
3. 同一 agent 的事件按 `ts` 单调处理；若乱序，以最新 `ts` 覆盖状态。
4. `failed` 不一定伴随 `stopped`；由生命周期管理器决定是否补发终态。

---

## 5. 向后兼容规则

1. 增字段只能“追加可选字段”，不可修改现有字段语义。
2. 删除事件需先经历一版 deprecated（至少 1 个小版本）。
3. 文档版本号与代码常量版本同步。

---

文档版本：v1.0-phase0
更新日期：2026-04-14
