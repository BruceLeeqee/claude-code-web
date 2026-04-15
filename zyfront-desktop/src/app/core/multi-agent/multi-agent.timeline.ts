import type { MultiAgentEvent } from './multi-agent.events';
export type MultiAgentTimelineTier = 'info' | 'success' | 'warning' | 'error';

function setupHintCountFromErrorEvent(ev: MultiAgentEvent): number {
  if (ev.type !== 'multiagent.error') return 0;
  const raw = (ev as MultiAgentEvent<'multiagent.error'>).payload.details?.['setupHints'];
  if (!Array.isArray(raw)) return 0;
  return raw.filter((x) => typeof x === 'string' && x.trim().length > 0).length;
}

function eventBrief(ev: MultiAgentEvent): string {
  if (ev.type === 'multiagent.teammate.spawned') return (ev as MultiAgentEvent<'multiagent.teammate.spawned'>).payload.identity.agentName;
  if (ev.type === 'multiagent.teammate.stopped') return (ev as MultiAgentEvent<'multiagent.teammate.stopped'>).payload.agentId;
  if (ev.type === 'multiagent.teammate.killed') {
    const p = (ev as MultiAgentEvent<'multiagent.teammate.killed'>).payload;
    return `${p.agentId}${p.signal ? ` (${p.signal})` : ''}`;
  }
  if (ev.type === 'multiagent.teammate.message') {
    const p = (ev as MultiAgentEvent<'multiagent.teammate.message'>).payload;
    return `${p.fromAgentId} -> ${p.toAgentId ?? 'team'}`;
  }
  if (ev.type === 'multiagent.backend.detected') {
    const p = (ev as MultiAgentEvent<'multiagent.backend.detected'>).payload;
    return `${p.configuredMode} => ${p.effectiveBackend}`;
  }
  if (ev.type === 'multiagent.backend.fallback') {
    const p = (ev as MultiAgentEvent<'multiagent.backend.fallback'>).payload;
    return `${p.fromMode} => ${p.toBackend}`;
  }
  if (ev.type === 'multiagent.teammate.state.changed') {
    const p = (ev as MultiAgentEvent<'multiagent.teammate.state.changed'>).payload;
    return `${p.agentId}: ${p.prev} -> ${p.next}`;
  }
  if (ev.type === 'multiagent.error') {
    const p = (ev as MultiAgentEvent<'multiagent.error'>).payload;
    const count = setupHintCountFromErrorEvent(ev);
    if (count > 0) return `${p.message} (setup hints: ${count})`;
    return p.message;
  }
  return 'state update';
}

function userReadable(ev: MultiAgentEvent): string {
  if (ev.type === 'multiagent.teammate.spawned') {
    const p = (ev as MultiAgentEvent<'multiagent.teammate.spawned'>).payload;
    return `已创建 Agent：${p.identity.agentName}`;
  }
  if (ev.type === 'multiagent.teammate.stopped') return 'Agent 已停止';
  if (ev.type === 'multiagent.teammate.killed') return 'Agent 已强制终止';
  if (ev.type === 'multiagent.teammate.state.changed') {
    const p = (ev as MultiAgentEvent<'multiagent.teammate.state.changed'>).payload;
    if (p.next === 'stopping') return 'Agent 正在停止';
    return `Agent 状态更新为 ${p.next}`;
  }
  if (ev.type === 'multiagent.teammate.message') {
    const p = (ev as MultiAgentEvent<'multiagent.teammate.message'>).payload;
    if (p.direction === 'leader_to_teammate') return '已发送消息给 Agent';
    if (p.direction === 'teammate_to_leader') return 'Agent 已回复消息';
    return 'Agent 之间正在传递消息';
  }
  if (ev.type === 'multiagent.backend.detected') return '后端检测完成';
  if (ev.type === 'multiagent.backend.fallback') return '后端已回退';
  if (ev.type === 'multiagent.error') return '多智能体发生错误';
  return '状态已更新';
}

function eventTier(ev: MultiAgentEvent): MultiAgentTimelineTier {
  if (ev.type === 'multiagent.error') return 'error';
  if (ev.type === 'multiagent.backend.fallback') return 'warning';
  if (ev.type === 'multiagent.teammate.killed') return 'warning';
  if (ev.type === 'multiagent.teammate.state.changed') return 'info';
  if (ev.type === 'multiagent.teammate.spawned' || ev.type === 'multiagent.teammate.stopped') return 'success';
  return 'info';
}

export function summarizeMultiAgentEvent(ev: MultiAgentEvent): {
  technicalText: string;
  userText: string;
  tier: MultiAgentTimelineTier;
} {
  return {
    technicalText: `${ev.type} · ${eventBrief(ev)}`,
    userText: userReadable(ev),
    tier: eventTier(ev),
  };
}

export function formatMultiAgentTimelineLine(ev: MultiAgentEvent): string {
  return summarizeMultiAgentEvent(ev).technicalText;
}
