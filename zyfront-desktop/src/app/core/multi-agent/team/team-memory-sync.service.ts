import { Injectable, inject, signal, computed } from '@angular/core';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import { TEAM_FILE_PATHS } from './team.types';

export interface TeamMemoryEntry {
  id: string;
  teamId: string;
  type: 'decision' | 'context' | 'artifact' | 'error' | 'handoff' | 'summary';
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface TeamSessionSnapshot {
  teamId: string;
  structName: string;
  status: string;
  members: Array<{ agentId: string; roleName: string; status: string }>;
  tasks: Array<{ id: string; title: string; status: string; assignee: string }>;
  currentStageIndex: number;
  memoryEntries: TeamMemoryEntry[];
  snapshotAt: number;
}

@Injectable({ providedIn: 'root' })
export class TeamMemorySyncService {
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly memoryStore = signal<Map<string, TeamMemoryEntry[]>>(new Map());
  private readonly snapshots = signal<Map<string, TeamSessionSnapshot>>(new Map());

  readonly allMemories = computed(() => {
    const store = this.memoryStore();
    const result: TeamMemoryEntry[] = [];
    store.forEach(entries => result.push(...entries));
    return result.sort((a, b) => b.createdAt - a.createdAt);
  });

  addEntry(teamId: string, entry: Omit<TeamMemoryEntry, 'id' | 'createdAt' | 'teamId'>): TeamMemoryEntry {
    const full: TeamMemoryEntry = {
      ...entry,
      id: `mem-${teamId}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      teamId,
      createdAt: Date.now(),
    };

    this.memoryStore.update(store => {
      const newStore = new Map(store);
      const entries = [...(newStore.get(teamId) ?? []), full];
      newStore.set(teamId, entries);
      return newStore;
    });

    this.eventBus.emit({
      type: EVENT_TYPES.MEMORY_SYNCED,
      ts: Date.now(),
      sessionId: teamId,
      source: 'system',
      payload: {
        sessionId: teamId,
        pipeline: 'team' as const,
        filesTouched: [`${TEAM_FILE_PATHS.messages}/${teamId}/memory.json`],
      },
    });

    return full;
  }

  getEntries(teamId: string): TeamMemoryEntry[] {
    return this.memoryStore().get(teamId) ?? [];
  }

  getEntriesByType(teamId: string, type: TeamMemoryEntry['type']): TeamMemoryEntry[] {
    return this.getEntries(teamId).filter(e => e.type === type);
  }

  searchEntries(teamId: string, query: string): TeamMemoryEntry[] {
    const lower = query.toLowerCase();
    return this.getEntries(teamId).filter(
      e => e.content.toLowerCase().includes(lower) || e.source.toLowerCase().includes(lower)
    );
  }

  createSnapshot(teamId: string, runtimeData: {
    structName: string;
    status: string;
    members: Array<{ agentId: string; roleName: string; status: string }>;
    tasks: Array<{ id: string; title: string; status: string; assignee: string }>;
    currentStageIndex: number;
  }): TeamSessionSnapshot {
    const snapshot: TeamSessionSnapshot = {
      teamId,
      structName: runtimeData.structName,
      status: runtimeData.status,
      members: runtimeData.members,
      tasks: runtimeData.tasks,
      currentStageIndex: runtimeData.currentStageIndex,
      memoryEntries: [...this.getEntries(teamId)],
      snapshotAt: Date.now(),
    };

    this.snapshots.update(store => {
      const newStore = new Map(store);
      newStore.set(teamId, snapshot);
      return newStore;
    });

    return snapshot;
  }

  getSnapshot(teamId: string): TeamSessionSnapshot | undefined {
    return this.snapshots().get(teamId);
  }

  restoreFromSnapshot(teamId: string): TeamMemoryEntry[] | null {
    const snapshot = this.snapshots().get(teamId);
    if (!snapshot) return null;

    this.memoryStore.update(store => {
      const newStore = new Map(store);
      newStore.set(teamId, [...snapshot.memoryEntries]);
      return newStore;
    });

    return [...snapshot.memoryEntries];
  }

  clearTeamMemory(teamId: string): void {
    this.memoryStore.update(store => {
      const newStore = new Map(store);
      newStore.delete(teamId);
      return newStore;
    });
  }

  getTeamSummary(teamId: string): string {
    const entries = this.getEntries(teamId);
    if (entries.length === 0) return '暂无团队记忆';

    const decisions = entries.filter(e => e.type === 'decision');
    const errors = entries.filter(e => e.type === 'error');
    const handoffs = entries.filter(e => e.type === 'handoff');
    const summaries = entries.filter(e => e.type === 'summary');

    const lines: string[] = [
      `**团队记忆摘要** (${teamId})`,
      `总条目: ${entries.length}`,
    ];

    if (decisions.length > 0) {
      lines.push('', '**决策记录**:');
      decisions.forEach(d => lines.push(`- [${new Date(d.createdAt).toLocaleTimeString()}] ${d.content}`));
    }

    if (errors.length > 0) {
      lines.push('', '**错误记录**:');
      errors.forEach(e => lines.push(`- [${new Date(e.createdAt).toLocaleTimeString()}] ${e.content}`));
    }

    if (handoffs.length > 0) {
      lines.push('', '**交接记录**:');
      handoffs.forEach(h => lines.push(`- [${new Date(h.createdAt).toLocaleTimeString()}] ${h.source}: ${h.content}`));
    }

    if (summaries.length > 0) {
      lines.push('', '**总结**:');
      summaries.forEach(s => lines.push(`- ${s.content}`));
    }

    return lines.join('\n');
  }
}
