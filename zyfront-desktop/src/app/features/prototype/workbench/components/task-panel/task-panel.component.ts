import { Component, Input, Output, EventEmitter } from '@angular/core';
import { NgIf, NgFor, NgClass, NgTemplateOutlet } from '@angular/common';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { AgentStateItem, TaskGraph, TaskNode } from '../../types/workbench.types';

@Component({
  selector: 'app-task-panel',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, NgTemplateOutlet, NzIconModule, NzProgressModule],
  template: `
    <div class="task-panel">
      <div class="panel-header">
        <h3>AI 任务</h3>
        <div class="header-actions">
          <!-- 操作按钮 -->
        </div>
      </div>
      
      <!-- Agent 角色状态 -->
      <div class="agents-section">
        <h4>智能体状态</h4>
        <div class="agent-list">
          <div 
            *ngFor="let agent of agentStates"
            class="agent-card"
            [class.active]="isAgentActive(agent)"
          >
            <div class="agent-icon">
              <span nz-icon [nzType]="getAgentIcon(agent.role)"></span>
            </div>
            <div class="agent-info">
              <div class="agent-name">{{ agent.name }}</div>
              <div class="agent-status" [ngClass]="agent.status">
                {{ getAgentStatusText(agent.status) }}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 任务树 -->
      <div class="tasks-section" *ngIf="taskGraph">
        <h4>任务进度</h4>
        <div class="task-tree">
          <ng-container *ngTemplateOutlet="taskNode; context: { $implicit: taskGraph.rootTask }"></ng-container>
        </div>
      </div>
    </div>
    
    <ng-template #taskNode let-task>
      <div class="task-node">
        <div class="task-header">
          <span nz-icon [nzType]="getTaskIcon(task.status)" class="task-icon"></span>
          <span class="task-title">{{ task.title }}</span>
        </div>
        <div class="task-progress" *ngIf="task.progress !== undefined && task.progress !== null">
          <nz-progress [nzPercent]="task.progress" [nzSize]="'small'"></nz-progress>
        </div>
        <div class="task-children" *ngIf="task.children?.length">
          <div *ngFor="let child of task.children">
            <ng-container *ngTemplateOutlet="taskNode; context: { $implicit: child }"></ng-container>
          </div>
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    .task-panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 12px;
      background: #141414;
      overflow-y: auto;
    }
    
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    
    .panel-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
    }
    
    .agents-section {
      margin-bottom: 20px;
    }
    
    .agents-section h4 {
      margin: 0 0 10px 0;
      font-size: 12px;
      font-weight: 500;
      color: #8c8c8c;
    }
    
    .agent-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .agent-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: #1e1e1e;
      border-radius: 6px;
    }
    
    .agent-card.active {
      background: #1890ff10;
      border: 1px solid #1890ff30;
    }
    
    .agent-icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1890ff20;
      border-radius: 50%;
      color: #1890ff;
    }
    
    .agent-info {
      flex: 1;
    }
    
    .agent-name {
      font-size: 13px;
      color: #fff;
      font-weight: 500;
    }
    
    .agent-status {
      font-size: 11px;
      margin-top: 2px;
    }
    
    .agent-status.idle { color: #52c41a; }
    .agent-status.running { color: #1890ff; }
    .agent-status.blocked { color: #faad14; }
    .agent-status.failed { color: #ff4d4f; }
    
    .tasks-section h4 {
      margin: 0 0 10px 0;
      font-size: 12px;
      font-weight: 500;
      color: #8c8c8c;
    }
    
    .task-tree {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .task-node {
      padding: 10px 12px;
      background: #1e1e1e;
      border-radius: 6px;
    }
    
    .task-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .task-icon {
      font-size: 14px;
    }
    
    .task-icon.pending { color: #8c8c8c; }
    .task-icon.running { color: #1890ff; }
    .task-icon.completed { color: #52c41a; }
    .task-icon.failed { color: #ff4d4f; }
    .task-icon.blocked { color: #faad14; }
    
    .task-title {
      font-size: 13px;
      color: #d9d9d9;
    }
    
    .task-progress {
      margin-top: 8px;
    }
    
    .task-children {
      margin-top: 8px;
      margin-left: 20px;
      border-left: 1px solid #2a2a2a;
      padding-left: 12px;
    }
  `]
})
export class TaskPanelComponent {
  @Input() agentStates: AgentStateItem[] = [];
  @Input() taskGraph?: TaskGraph;
  @Output() taskSelected = new EventEmitter<string>();

  isAgentActive(agent: AgentStateItem): boolean {
    return agent.status === 'running';
  }

  getAgentIcon(role: string): string {
    const iconMap: Record<string, string> = {
      leader: 'user',
      planner: 'bulb',
      executor: 'play-circle',
      reviewer: 'check-circle',
      researcher: 'search'
    };
    return iconMap[role] || 'user';
  }

  getAgentStatusText(status: string): string {
    const statusMap: Record<string, string> = {
      idle: '空闲',
      running: '工作中',
      blocked: '阻塞',
      failed: '失败'
    };
    return statusMap[status] || status;
  }

  getTaskIcon(status: string): string {
    const iconMap: Record<string, string> = {
      pending: 'clock-circle',
      running: 'sync',
      completed: 'check-circle',
      failed: 'close-circle',
      blocked: 'pause-circle'
    };
    return iconMap[status] || 'clock-circle';
  }
}

