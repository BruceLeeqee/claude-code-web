import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, Output, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { WorkbenchTeamVm } from '../../../../core/multi-agent/multi-agent.types';

interface CollaborationNetworkAgentLike {
  agentId?: string;
  id?: string;
  name: string;
  role?: string;
}

@Component({
  selector: 'app-collaboration-network',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './collaboration-network.component.scss',
  template: `
    <main class="network-root">
      <div class="network-team-header">
        <div class="network-team-name">{{ teamName() }}</div>
        <div class="network-team-summary">在线 {{ runningCount() }} / 异常 {{ errorCount() }}</div>
      </div>
      <div class="network-grid" [class.network-grid-maximized]="maximizedIndex !== null">
        <section
          class="network-pane"
          *ngFor="let agent of agents.slice(0, 6); let index = index; trackBy: trackByAgentId"
          [attr.data-agent-id]="resolveAgentId(agent)"
          [class.is-minimized]="minimizedIndices.has(index)"
          [class.is-maximized]="maximizedIndex === index"
        >
          <header class="network-pane-header">
            <div class="network-pane-title-wrap">
              <div class="network-pane-icon" [ngClass]="networkAgentIconClass(agent.role)">
                <iconify-icon [icon]="networkAgentIcon(agent.role)"></iconify-icon>
              </div>
              <div class="network-pane-title">{{ agent.name }}</div>
              <div class="network-pane-subtitle">{{ getRoleName(agent.role) }}</div>
            </div>
            <div class="network-pane-actions">
              <button type="button" class="network-pane-action" (click)="onMinimizeClick(index, $event)">−</button>
              <button type="button" class="network-pane-action" (click)="onMaximizeClick(index, $event)">↗</button>
              <button type="button" class="network-pane-action" (click)="onCloseClick(index, $event)">×</button>
            </div>
          </header>
          <div class="network-pane-body" #paneBody>
            <div class="network-line network-line--system">&gt;&gt; [System] Node {{ agent.name }} connected. Role: {{ getRoleName(agent.role) }}</div>
            <div class="network-line" *ngFor="let message of networkMessages(resolveAgentId(agent))" [ngClass]="'network-line--' + message.type">
              <span class="network-line-time">{{ message.time }}</span>
              <span class="network-line-msg">{{ message.msg }}</span>
            </div>
          </div>
          <div class="network-input-row">
            <span class="network-input-label">CMD&gt;</span>
            <input class="network-input" type="text" placeholder="输入指令..." [value]="networkInputValue(index)" (input)="onCommandInput(index, $event)" (keydown.enter)="submitCommand(index)" />
          </div>
        </section>
      </div>
    </main>
  `,
})
export class CollaborationNetworkComponent {
  private readonly cdr = inject(ChangeDetectorRef);

  @Input() team: WorkbenchTeamVm | null = null;
  @Input() agents: CollaborationNetworkAgentLike[] = [];
  @Input() minimizedIndices = new Set<number>();
  @Input() maximizedIndex: number | null = null;
  @Input() messageOverrides: Map<string, Array<{ time: string; type: string; msg: string }>> = new Map();
  @Input() commandInputs: string[] = [];
  @Output() minimizedChange = new EventEmitter<Set<number>>();
  @Output() maximizedChange = new EventEmitter<number | null>();
  @Output() commandInputChanged = new EventEmitter<{ index: number; value: string }>();
  @Output() commandSubmitted = new EventEmitter<{ index: number; value: string }>();
  @Output() paneClosed = new EventEmitter<number>();

  private previousMsgCounts = new Map<string, number>();

  protected getRoleName(role: CollaborationNetworkAgentLike['role']): string {
    if (!role) return '未知';
    if (role === 'leader') return '组长';
    if (role === 'teammate') return '队员';
    return role;
  }

  protected trackByAgentId(index: number, agent: CollaborationNetworkAgentLike): string {
    return agent.agentId ?? agent.id ?? String(index);
  }

  protected resolveAgentId(agent: CollaborationNetworkAgentLike): string {
    return agent.agentId ?? agent.id ?? '';
  }

  protected teamName(): string {
    return this.team?.teamName ?? 'Team Run';
  }

  protected runningCount(): number {
    return this.team?.runningCount ?? 0;
  }

  protected errorCount(): number {
    return this.team?.errorCount ?? 0;
  }

  protected networkAgentIcon(role: CollaborationNetworkAgentLike['role']): string {
    return role === 'leader' ? 'lucide:crown' : 'lucide:user';
  }

  protected networkAgentIconClass(role: CollaborationNetworkAgentLike['role']): string {
    return role === 'leader' ? 'icon-leader' : 'icon-member';
  }

  protected networkMessages(agentId: string): Array<{ time: string; type: string; msg: string }> {
    const msgs = this.messageOverrides.get(agentId) ?? [];
    const prev = this.previousMsgCounts.get(agentId) ?? 0;
    if (msgs.length !== prev) {
      this.previousMsgCounts.set(agentId, msgs.length);
      queueMicrotask(() => this.scrollPaneToBottom(agentId));
    }
    return msgs;
  }

  private scrollPaneToBottom(agentId: string): void {
    const pane = document.querySelector(`[data-agent-id="${agentId}"] .network-pane-body`);
    if (pane) {
      pane.scrollTop = pane.scrollHeight;
    }
  }

  protected networkInputValue(index: number): string {
    return this.commandInputs[index] ?? '';
  }

  protected onCommandInput(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    this.commandInputs[index] = value;
    this.commandInputChanged.emit({ index, value });
  }

  protected toggleMinimize(index: number): void {
    const next = new Set(this.minimizedIndices);
    next.has(index) ? next.delete(index) : next.add(index);
    this.minimizedChange.emit(next);
  }

  protected toggleMaximize(index: number): void {
    this.maximizedChange.emit(this.maximizedIndex === index ? null : index);
  }

  protected closePane(index: number): void {
    this.paneClosed.emit(index);
  }

  protected onMinimizeClick(index: number, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.toggleMinimize(index);
    this.cdr.markForCheck();
  }

  protected onMaximizeClick(index: number, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.toggleMaximize(index);
    this.cdr.markForCheck();
  }

  protected onCloseClick(index: number, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.closePane(index);
    this.cdr.markForCheck();
  }

  protected submitCommand(index: number): void {
    const value = (this.commandInputs[index] ?? '').trim();
    if (!value) return;
    this.commandSubmitted.emit({ index, value });
    this.commandInputs[index] = '';
  }
}
