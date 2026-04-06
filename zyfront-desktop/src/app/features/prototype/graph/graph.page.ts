import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { TerminalMemoryGraphService } from '../../../core/terminal-memory-graph.service';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';

interface SimNode {
  id: string;
  name: string;
  kind: string;
  /** 原型演示节点分组 */
  group?: string;
  snippet?: string;
  at?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fill: string;
}

@Component({
  selector: 'app-graph-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, FormsModule, NzButtonModule, NzIconModule],
  templateUrl: './graph.page.html',
  styleUrls: ['../prototype-page.scss', './graph.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphPrototypePageComponent implements AfterViewInit, OnDestroy {
  protected readonly facade = inject(PrototypeCoreFacade);
  private readonly memoryGraph = inject(TerminalMemoryGraphService);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly graphHost = viewChild<ElementRef<HTMLDivElement>>('graphHost');

  protected readonly width = signal(800);
  protected readonly height = signal(520);
  protected readonly physicsDrag = signal(0.42);
  protected readonly showLabels = signal(true);
  protected readonly showEdges = signal(true);
  protected readonly selectedId = signal<string | null>(null);

  protected readonly simNodes = signal<SimNode[]>([]);
  private readonly edgePairs = signal<Array<{ source: string; target: string }>>([]);

  protected readonly viewBox = computed(() => `0 0 ${this.width()} ${this.height()}`);

  protected readonly displayLines = computed(() => {
    if (!this.showEdges()) return [];
    const nodes = this.simNodes();
    const m = new Map(nodes.map((n) => [n.id, n]));
    const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const e of this.edgePairs()) {
      const a = m.get(e.source);
      const b = m.get(e.target);
      if (!a || !b) continue;
      out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return out;
  });

  protected readonly stats = computed(() => ({
    entities: this.simNodes().filter((n) => n.kind !== 'hub').length,
    links: this.edgePairs().length,
  }));

  protected readonly selectedDetail = computed(() => {
    const id = this.selectedId();
    if (!id) return null;
    const n = this.simNodes().find((x) => x.id === id);
    if (!n) return null;
    const neigh = new Set<string>();
    for (const e of this.edgePairs()) {
      if (e.source === id) neigh.add(e.target);
      else if (e.target === id) neigh.add(e.source);
    }
    const labels = [...neigh]
      .map((nid) => this.simNodes().find((s) => s.id === nid)?.name)
      .filter(Boolean) as string[];
    return { node: n, neighbors: labels };
  });

  private ro?: ResizeObserver;
  private layoutScheduled = false;

  constructor() {
    effect(
      () => {
        this.memoryGraph.nodes();
        this.memoryGraph.edges();
        this.facade.nodes();
        this.width();
        this.height();
        this.physicsDrag();
        this.scheduleLayout();
      },
      { allowSignalWrites: true },
    );
  }

  ngAfterViewInit(): void {
    const host = this.graphHost()?.nativeElement;
    if (!host) return;
    const apply = () => {
      const r = host.getBoundingClientRect();
      const w = Math.max(200, Math.floor(r.width));
      const h = Math.max(200, Math.floor(r.height));
      this.width.set(w);
      this.height.set(h);
    };
    apply();
    this.ro = new ResizeObserver(() => apply());
    this.ro.observe(host);
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
  }

  private scheduleLayout(): void {
    if (this.layoutScheduled) return;
    this.layoutScheduled = true;
    queueMicrotask(() => {
      this.layoutScheduled = false;
      this.runLayout();
      this.cdr.markForCheck();
    });
  }

  protected fitView(): void {
    this.scheduleLayout();
  }

  protected refreshLayout(): void {
    this.scheduleLayout();
  }

  protected toggleLabels(): void {
    this.showLabels.update((v) => !v);
  }

  protected toggleEdges(): void {
    this.showEdges.update((v) => !v);
  }

  protected onPhysicsChange(percent: number): void {
    this.physicsDrag.set(Math.min(100, Math.max(0, percent)) / 100);
  }

  protected onSelectNode(id: string): void {
    this.selectedId.set(id);
    if (this.facade.nodes().some((n) => n.id === id)) {
      this.facade.selectNode(id);
    }
  }

  protected formatAt(at?: number): string {
    if (at == null) return '';
    const d = new Date(at);
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  private buildGraph(): { nodes: Omit<SimNode, 'x' | 'y' | 'vx' | 'vy'>[]; edges: Array<{ source: string; target: string }> } {
    const memN = this.memoryGraph.nodes();
    const memE = this.memoryGraph.edges();
    if (memN.length > 1) {
      const nodes = memN.map((n) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        group: n.kind === 'hub' ? undefined : n.kind,
        snippet: n.snippet,
        at: n.at,
        r: n.kind === 'hub' ? 26 : 14,
        fill: this.fillForKind(n.kind, undefined),
      }));
      return { nodes, edges: memE.map((e) => ({ source: e.source, target: e.target })) };
    }

    const ui = this.facade.nodes();
    const nodes: Omit<SimNode, 'x' | 'y' | 'vx' | 'vy'>[] = ui.map((u) => ({
      id: u.id,
      name: u.name,
      kind: 'facade',
      group: u.group,
      r: 16,
      fill: this.fillForKind('facade', u.group),
    }));
    const edges: Array<{ source: string; target: string }> = [];
    for (const u of ui) {
      for (const lid of u.links) {
        if (ui.some((x) => x.id === lid)) edges.push({ source: u.id, target: lid });
      }
    }
    return { nodes, edges };
  }

  private fillForKind(kind: string, group?: string): string {
    if (kind === 'hub') return '#7c3aed';
    if (kind === 'user') return '#38bdf8';
    if (kind === 'assistant') return '#a78bfa';
    if (kind === 'tool') return '#34d399';
    const g = group ?? 'logic';
    const map: Record<string, string> = {
      logic: '#f97316',
      data: '#3b82f6',
      view: '#22c55e',
      project: '#eab308',
      issue: '#ef4444',
    };
    return map[g] ?? '#94a3b8';
  }

  private runLayout(): void {
    const w = this.width();
    const h = this.height();
    if (w < 80 || h < 80) return;

    const { nodes: raw, edges: rawEdges } = this.buildGraph();
    this.edgePairs.set(rawEdges);

    const cx = w / 2;
    const cy = h / 2;
    const drag = this.physicsDrag();
    const ideal = 48 + (1 - drag) * 72;
    const rep = 650 * (0.35 + drag);
    const spring = 0.09 * (0.45 + drag);

    const nodes: SimNode[] = raw.map((n, i, arr) => {
      const angle = (i / Math.max(arr.length, 1)) * Math.PI * 2;
      const rad = n.kind === 'hub' ? 0 : 56 + (i % 5) * 8;
      return {
        ...n,
        x: cx + Math.cos(angle) * rad,
        y: cy + Math.sin(angle) * rad,
        vx: 0,
        vy: 0,
      };
    });

    for (let iter = 0; iter < 200; iter++) {
      const damp = 0.82 - iter * 0.00035;
      for (const n of nodes) {
        if (n.kind === 'hub') {
          n.x = cx;
          n.y = cy;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        let fx = 0;
        let fy = 0;
        for (const m of nodes) {
          if (m === n) continue;
          const dx = n.x - m.x;
          const dy = n.y - m.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const minD = n.r + m.r + 6;
          if (dist < minD) {
            const push = (minD - dist) * 0.35;
            fx += (dx / dist) * push;
            fy += (dy / dist) * push;
          }
          const rf = rep / (dist * dist);
          fx += (dx / dist) * rf;
          fy += (dy / dist) * rf;
        }
        for (const e of rawEdges) {
          const otherId = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
          if (!otherId) continue;
          const m = nodes.find((q) => q.id === otherId);
          if (!m) continue;
          const dx = m.x - n.x;
          const dy = m.y - n.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const diff = dist - ideal;
          fx += (dx / dist) * spring * diff;
          fy += (dy / dist) * spring * diff;
        }
        n.vx = (n.vx + fx) * damp;
        n.vy = (n.vy + fy) * damp;
        n.x += n.vx;
        n.y += n.vy;
        const pad = 24;
        n.x = Math.max(pad + n.r, Math.min(w - pad - n.r, n.x));
        n.y = Math.max(pad + n.r, Math.min(h - pad - n.r, n.y));
      }
    }

    this.simNodes.set(nodes);
  }
}
