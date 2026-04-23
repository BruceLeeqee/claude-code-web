import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { NgIf, NgFor, NgClass, NgTemplateOutlet } from '@angular/common';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { AgentStateItem, TaskGraph, TaskNode } from '../../types/workbench.types';

interface ExpandedState {
  [taskId: string]: boolean;
}

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
        <div class="task-header" (click)="toggleTask(task)">
          <span nz-icon [nzType]="getTaskIcon(task.status)" class="task-icon" [ngClass]="task.status"></span>
          <span class="task-title">{{ task.title }}</span>
          <span nz-icon [nzType]="isExpanded(task) ? 'up' : 'down'" *ngIf="task.children?.length" class="expand-icon"></span>
        </div>
        <div class="task-progress" *ngIf="task.progress !== undefined && task.progress !== null">
          <nz-progress [nzPercent]="task.progress" [nzSize]="'small'"></nz-progress>
        </div>
        <div class="task-children" *ngIf="task.children?.length && isExpanded(task)">
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
      font-size: 13px;
      font-weight: 500;
      color: #fff;
    }
    
    .agents-section {
      margin-bottom: 20px;
    }
    
    .agents-section h4 {
      margin: 0 0 10px 0;
      font-size: 11px;
      font-weight: 500;
      color: #8c8c8c;
    }
    
    .agent-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .agent-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: #1e1e1e;
      border-radius: 6px;
    }
    
    .agent-card.active {
      background: #1890ff10;
      border: 1px solid #1890ff30;
    }
    
    .agent-icon {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1890ff20;
      border-radius: 50%;
      color: #1890ff;
      font-size: 14px;
    }
    
    .agent-info {
      flex: 1;
    }
    
    .agent-name {
      font-size: 12px;
      color: #fff;
      font-weight: 500;
    }
    
    .agent-status {
      font-size: 10px;
      margin-top: 2px;
    }
    
    .agent-status.idle { color: #52c41a; }
    .agent-status.running { color: #1890ff; }
    .agent-status.blocked { color: #faad14; }
    .agent-status.failed { color: #ff4d4f; }
    
    .tasks-section h4 {
      margin: 0 0 10px 0;
      font-size: 11px;
      font-weight: 500;
      color: #8c8c8c;
    }
    
    .task-tree {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .task-node {
      padding: 8px 10px;
      background: #1e1e1e;
      border-radius: 6px;
    }
    
    .task-header {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    
    .task-header:hover {
      background: #2a2a2a;
      margin: -8px -10px;
      padding: 8px 10px;
      border-radius: 6px;
    }
    
    .task-icon {
      font-size: 12px;
    }
    
    .task-icon.pending { color: #8c8c8c; }
    .task-icon.running { color: #1890ff; }
    .task-icon.completed { color: #52c41a; }
    .task-icon.failed { color: #ff4d4f; }
    .task-icon.blocked { color: #faad14; }
    
    .task-title {
      font-size: 12px;
      color: #d9d9d9;
      flex: 1;
    }
    
    .expand-icon {
      font-size: 10px;
      color: #8c8c8c;
      transition: transform 0.2s;
    }
    
    .task-progress {
      margin-top: 6px;
    }
    
    .task-children {
      margin-top: 6px;
      margin-left: 16px;
      border-left: 1px solid #2a2a2a;
      padding-left: 10px;
    }
  `]
})
export class TaskPanelComponent implements OnInit, OnChanges {
  @Input() agentStates: AgentStateItem[] = [];
  @Input() taskGraph?: TaskGraph;
  @Output() taskSelected = new EventEmitter<string>();

  private expandedState: ExpandedState = {};
  private previousStatuses: { [taskId: string]: string } = {};

  ngOnInit() {
    // 初始化展开状态
    if (this.taskGraph) {
      this.initExpandedState(this.taskGraph.rootTask);
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['taskGraph'] && this.taskGraph) {
      // 检查任务状态变化，自动展开/折叠
      this.checkStatusChanges(this.taskGraph.rootTask);
      this.previousStatuses = this.collectStatuses(this.taskGraph.rootTask);
    }
  }

  private initExpandedState(task: TaskNode) {
    // 默认展开所有任务
    this.expandedState[task.id] = true;
    if (task.children) {
      task.children.forEach(child => this.initExpandedState(child));
    }
  }

  private collectStatuses(task: TaskNode): { [taskId: string]: string } {
    const statuses: { [taskId: string]: string } = {};
    statuses[task.id] = task.status;
    if (task.children) {
      task.children.forEach(child => {
        Object.assign(statuses, this.collectStatuses(child));
      });
    }
    return statuses;
  }

  private checkStatusChanges(task: TaskNode) {
    const previousStatus = this.previousStatuses[task.id];
    if (previousStatus !== task.status) {
      // 状态发生变化
      if (task.status === 'running') {
        // 任务开始运行，展开该任务及其所有父任务
        this.expandTaskAndParents(task.id);
      } else if (task.status === 'completed' && this.areAllChildrenCompleted(task)) {
        // 任务完成且所有子任务都完成，折叠该任务
        this.expandedState[task.id] = false;
      }
    }
    if (task.children) {
      task.children.forEach(child => this.checkStatusChanges(child));
    }
  }

  private expandTaskAndParents(taskId: string) {
    // 展开指定任务
    this.expandedState[taskId] = true;
    // 如果有任务图，找到所有父任务并展开
    if (this.taskGraph) {
      const parentIds = this.findParentIds(this.taskGraph.rootTask, taskId);
      parentIds.forEach(parentId => {
        this.expandedState[parentId] = true;
      });
    }
  }

  private findParentIds(root: TaskNode, targetId: string, parents: string[] = []): string[] {
    if (root.children) {
      for (const child of root.children) {
        if (child.id === targetId) {
          return [...parents, root.id];
        }
        const found = this.findParentIds(child, targetId, [...parents, root.id]);
        if (found.length > 0) {
          return found;
        }
      }
    }
    return [];
  }

  private areAllChildrenCompleted(task: TaskNode): boolean {
    if (!task.children || task.children.length === 0) {
      return true;
    }
    return task.children.every(child => 
      child.status === 'completed' && this.areAllChildrenCompleted(child)
    );
  }

  isExpanded(task: TaskNode): boolean {
    return this.expandedState[task.id] !== false; // 默认展开
  }

  toggleTask(task: TaskNode) {
    this.expandedState[task.id] = !this.isExpanded(task);
  }

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

