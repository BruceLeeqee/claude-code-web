import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  color: string;
  quota: number;
  currentCount: number;
  roleGroups: RoleGroup[];
}

export interface RoleGroup {
  id: string;
  name: string;
  role: string;
  color: string;
  agents: TeamAgent[];
}

export interface TeamAgent {
  id: string;
  name: string;
  role: string;
  status: 'idle' | 'running' | 'busy';
  load: number;
  currentTaskId: string | null;
}

@Component({
  selector: 'app-resource-scheduler',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="resource-scheduler-container">
      <div class="panel-header">
        <span class="panel-title">资源调度中心</span>
        <span class="panel-badge">{{ totalAgents() }} Agents</span>
      </div>

      <div class="team-list">
        @for (team of teams; track team.id) {
          <div class="team-item" [style.border-color]="team.color">
            <div class="team-header" (click)="toggleTeam(team.id)">
              <span class="team-expand-icon">{{ isTeamExpanded(team.id) ? '▼' : '▶' }}</span>
              <span class="team-color-dot" [style.background]="team.color"></span>
              <span class="team-name">{{ team.name }}</span>
              <span class="team-quota">{{ team.currentCount }}/{{ team.quota }}</span>
            </div>

            @if (isTeamExpanded(team.id)) {
              <div class="role-groups">
                @for (group of team.roleGroups; track group.id) {
                  <div class="role-group" [style.border-color]="group.color">
                    <div class="role-group-header" (click)="toggleRoleGroup(group.id)">
                      <span class="role-expand-icon">{{ isRoleGroupExpanded(group.id) ? '▼' : '▶' }}</span>
                      <span class="role-name">{{ group.name }}</span>
                      <span class="role-count">{{ group.agents.length }}</span>
                    </div>

                    @if (isRoleGroupExpanded(group.id)) {
                      <div class="agents-list">
                        @for (agent of group.agents; track agent.id) {
                          <div 
                            class="agent-item" 
                            [class.agent-item-selected]="selectedAgentId() === agent.id"
                            [draggable]="true"
                            (dragstart)="onAgentDragStart($event, agent.id)"
                            (click)="selectAgent(agent.id)">
                            <div class="agent-info">
                              <span class="agent-status-dot" [class]="getStatusClass(agent.status)"></span>
                              <span class="agent-name">{{ agent.name }}</span>
                            </div>
                            <div class="agent-meta">
                              <span class="agent-load">负载: {{ agent.load }}%</span>
                              @if (agent.currentTaskId) {
                                <span class="agent-task">任务: {{ agent.currentTaskId }}</span>
                              }
                            </div>
                            <div class="agent-progress-bar">
                              <div class="agent-progress-fill" [style.width.%]="agent.load"></div>
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <div class="panel-footer">
        <button class="btn btn-primary" (click)="createAgentRequested.emit()">+ 创建Agent</button>
        <button class="btn btn-secondary" (click)="refreshTeams()">↻ 刷新</button>
      </div>
    </div>
  `,
  styles: [`
    .resource-scheduler-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #0a0a0a;
      font-family: 'Courier New', monospace;
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%);
      border-bottom: 2px solid #00ff41;
    }

    .panel-title {
      font-size: 14px;
      color: #00ff41;
      font-weight: bold;
    }

    .panel-badge {
      font-size: 11px;
      color: #888;
      background: #1a1a1a;
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid #333;
    }

    .team-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .team-item {
      margin-bottom: 12px;
      border: 1px solid;
      border-radius: 4px;
      background: #0a0a0a;
    }

    .team-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      cursor: pointer;
      background: linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%);
      transition: all 0.2s;
    }

    .team-header:hover {
      background: #1a1a1a;
    }

    .team-expand-icon {
      font-size: 10px;
      color: #00ff41;
      width: 12px;
    }

    .team-color-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      box-shadow: 0 0 5px currentColor;
    }

    .team-name {
      flex: 1;
      font-size: 12px;
      color: #00ff41;
      font-weight: bold;
    }

    .team-quota {
      font-size: 10px;
      color: #888;
      background: #1a1a1a;
      padding: 2px 6px;
      border-radius: 3px;
      border: 1px solid #333;
    }

    .role-groups {
      padding: 8px;
    }

    .role-group {
      margin-bottom: 8px;
      border: 1px solid;
      border-radius: 3px;
      background: #0a0a0a;
    }

    .role-group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px;
      cursor: pointer;
      background: #111;
      transition: all 0.2s;
    }

    .role-group-header:hover {
      background: #1a1a1a;
    }

    .role-expand-icon {
      font-size: 9px;
      color: #888;
      width: 10px;
    }

    .role-name {
      flex: 1;
      font-size: 11px;
      color: #ccc;
    }

    .role-count {
      font-size: 10px;
      color: #666;
      background: #1a1a1a;
      padding: 1px 5px;
      border-radius: 2px;
    }

    .agents-list {
      padding: 6px;
    }

    .agent-item {
      padding: 8px;
      margin-bottom: 6px;
      background: #111;
      border: 1px solid #333;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .agent-item:hover {
      background: #1a1a1a;
      border-color: #00ff41;
    }

    .agent-item-selected {
      border-color: #00ff41 !important;
      background: rgba(0, 255, 65, 0.1) !important;
      box-shadow: 0 0 10px rgba(0, 255, 65, 0.3);
    }

    .agent-info {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .agent-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .agent-status-dot.status-idle {
      background: #22c55e;
      box-shadow: 0 0 5px #22c55e;
    }

    .agent-status-dot.status-running {
      background: #3b82f6;
      box-shadow: 0 0 5px #3b82f6;
      animation: pulse 1.5s infinite;
    }

    .agent-status-dot.status-busy {
      background: #ef4444;
      box-shadow: 0 0 5px #ef4444;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .agent-name {
      flex: 1;
      font-size: 11px;
      color: #00ff41;
    }

    .agent-meta {
      display: flex;
      gap: 12px;
      margin-bottom: 4px;
    }

    .agent-load, .agent-task {
      font-size: 9px;
      color: #888;
    }

    .agent-progress-bar {
      height: 3px;
      background: #1a1a1a;
      border-radius: 2px;
      overflow: hidden;
    }

    .agent-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00ff41, #22c55e);
      transition: width 0.3s;
    }

    .panel-footer {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #333;
      background: #0a0a0a;
    }

    .btn {
      flex: 1;
      padding: 8px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-family: 'Courier New', monospace;
      transition: all 0.2s;
      border: 1px solid;
    }

    .btn-primary {
      background: #00ff41;
      border-color: #00ff41;
      color: #0a0a0a;
      font-weight: bold;
    }

    .btn-primary:hover {
      background: #00cc33;
    }

    .btn-secondary {
      background: #1a1a1a;
      border-color: #333;
      color: #00ff41;
    }

    .btn-secondary:hover {
      background: #333;
    }
  `]
})
export class ResourceSchedulerComponent {
  @Input() teams: AgentTeam[] = [];
  @Output() createAgentRequested = new EventEmitter<void>();
  @Output() agentSelected = new EventEmitter<string>();

  private expandedTeams = signal<Set<string>>(new Set(['team-1']));
  private expandedRoleGroups = signal<Set<string>>(new Set());
  private selectedAgentIdState = signal<string | null>(null);
  selectedAgentId = computed(() => this.selectedAgentIdState());

  totalAgents = computed(() => {
    return this.teams.reduce((sum, team) => {
      return sum + team.roleGroups.reduce((groupSum, group) => {
        return groupSum + group.agents.length;
      }, 0);
    }, 0);
  });

  isTeamExpanded(teamId: string): boolean {
    return this.expandedTeams().has(teamId);
  }

  isRoleGroupExpanded(groupId: string): boolean {
    return this.expandedRoleGroups().has(groupId);
  }

  toggleTeam(teamId: string): void {
    const current = this.expandedTeams();
    const next = new Set(current);
    if (next.has(teamId)) {
      next.delete(teamId);
    } else {
      next.add(teamId);
    }
    this.expandedTeams.set(next);
  }

  toggleRoleGroup(groupId: string): void {
    const current = this.expandedRoleGroups();
    const next = new Set(current);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    this.expandedRoleGroups.set(next);
  }

  selectAgent(agentId: string): void {
    this.selectedAgentIdState.set(agentId);
    this.agentSelected.emit(agentId);
  }

  getStatusClass(status: string): string {
    return `status-${status}`;
  }

  onAgentDragStart(event: DragEvent, agentId: string): void {
    event.dataTransfer!.effectAllowed = 'copy';
    event.dataTransfer!.setData('text/plain', agentId);
  }

  refreshTeams(): void {
    // 触发刷新事件
  }
}
