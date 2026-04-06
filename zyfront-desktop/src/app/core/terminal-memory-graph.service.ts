import { Injectable, signal } from '@angular/core';

/** 与 Workbench `MemoryVm` 对齐，供跨页同步 */
export interface MemoryVmSnapshot {
  id: string;
  kind: 'user' | 'assistant' | 'tool';
  label: string;
  snippet: string;
  at: number;
}

export interface MemoryGraphNode {
  id: string;
  name: string;
  kind: 'hub' | MemoryVmSnapshot['kind'];
  snippet?: string;
  at?: number;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
}

const LS_KEY = 'zytrader-memory-graph:v1';

@Injectable({ providedIn: 'root' })
export class TerminalMemoryGraphService {
  readonly nodes = signal<MemoryGraphNode[]>([]);
  readonly edges = signal<MemoryGraphEdge[]>([]);
  readonly updatedAt = signal(0);

  constructor() {
    this.loadFromStorage();
  }

  /** 由工作台「捕获的记忆」定期同步 */
  syncFromMemoryVms(items: MemoryVmSnapshot[]): void {
    const hubId = 'hub-terminal-memory';
    const cap = 48;
    const sorted = [...items].sort((a, b) => b.at - a.at).slice(0, cap);

    const nodes: MemoryGraphNode[] = [
      { id: hubId, name: '主终端记忆', kind: 'hub' },
      ...sorted.map((m) => ({
        id: m.id,
        name: this.titleFor(m),
        kind: m.kind,
        snippet: m.snippet,
        at: m.at,
      })),
    ];

    const edges: MemoryGraphEdge[] = sorted.map((m) => ({ source: hubId, target: m.id }));

    this.nodes.set(nodes);
    this.edges.set(edges);
    this.updatedAt.set(Date.now());
    this.persist();
  }

  private titleFor(m: MemoryVmSnapshot): string {
    const s = m.snippet.replace(/\s+/g, ' ').trim();
    if (m.kind === 'tool' && s.startsWith('调用 ')) {
      const rest = s.slice(3).split(/[\s（(]/)[0]?.trim();
      if (rest && rest.length < 48) return rest;
    }
    const head = s.slice(0, 36);
    return head.length < s.length ? `${head}…` : head || m.label;
  }

  private persist(): void {
    try {
      const payload = {
        nodes: this.nodes(),
        edges: this.edges(),
        at: this.updatedAt(),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as { nodes?: MemoryGraphNode[]; edges?: MemoryGraphEdge[]; at?: number };
      if (Array.isArray(o.nodes) && o.nodes.length && Array.isArray(o.edges)) {
        this.nodes.set(o.nodes);
        this.edges.set(o.edges);
        this.updatedAt.set(typeof o.at === 'number' ? o.at : 0);
      }
    } catch {
      /* ignore */
    }
  }
}
