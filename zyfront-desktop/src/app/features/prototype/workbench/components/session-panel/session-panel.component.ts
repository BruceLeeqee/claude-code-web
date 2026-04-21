import { Component, Input, Output, EventEmitter } from '@angular/core';
import { NgFor, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { SessionItem } from '../../types/workbench.types';

@Component({
  selector: 'app-session-panel',
  standalone: true,
  imports: [NgFor, NgClass, FormsModule, NzInputModule, NzButtonModule, NzIconModule],
  template: `
    <div class="session-panel">
      <div class="panel-header">
        <h3>最近会话</h3>
        <button nz-button nzType="text" nzSize="small">
          <span nz-icon nzType="plus"></span>
        </button>
      </div>
      
      <div class="search-box">
        <nz-input-group [nzPrefix]="prefixTemplate">
          <input 
            type="text" 
            nz-input 
            placeholder="搜索会话..."
            [(ngModel)]="searchQuery"
          >
        </nz-input-group>
        <ng-template #prefixTemplate><span nz-icon nzType="search"></span></ng-template>
      </div>
      
      <div class="session-list">
        <div 
          *ngFor="let session of filteredSessions"
          class="session-item"
          [class.active]="session.id === currentSessionId"
          (click)="selectSession(session.id)"
        >
          <div class="session-header">
            <span class="session-name">{{ session.name }}</span>
            <span class="session-status" [ngClass]="session.status">
              {{ getStatusText(session.status) }}
            </span>
          </div>
          <div class="session-meta">
            <span class="session-time">{{ formatTime(session.updatedAt) }}</span>
            <span class="session-tasks">{{ session.taskCount }} 个任务</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .session-panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 12px;
      background: #141414;
    }
    
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    
    .panel-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
    }
    
    .search-box {
      margin-bottom: 12px;
    }
    
    .session-list {
      flex: 1;
      overflow-y: auto;
    }
    
    .session-item {
      padding: 10px 12px;
      margin-bottom: 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.2s;
      background: #1e1e1e;
    }
    
    .session-item:hover {
      background: #2a2a2a;
    }
    
    .session-item.active {
      background: #1890ff20;
      border: 1px solid #1890ff40;
    }
    
    .session-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    
    .session-name {
      font-size: 13px;
      color: #fff;
      font-weight: 500;
    }
    
    .session-status {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    
    .session-status.idle { background: #52c41a20; color: #52c41a; }
    .session-status.running { background: #1890ff20; color: #1890ff; }
    .session-status.paused { background: #faad1420; color: #faad14; }
    .session-status.completed { background: #52c41a20; color: #52c41a; }
    .session-status.failed { background: #ff4d4f20; color: #ff4d4f; }
    
    .session-meta {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #8c8c8c;
    }
  `]
})
export class SessionPanelComponent {
  @Input() sessions: SessionItem[] = [];
  @Input() currentSessionId: string = '';
  @Output() sessionSelected = new EventEmitter<string>();

  searchQuery: string = '';

  get filteredSessions(): SessionItem[] {
    if (!this.searchQuery) {
      return this.sessions.filter(s => !s.isArchived);
    }
    return this.sessions.filter(s => 
      !s.isArchived && 
      s.name.toLowerCase().includes(this.searchQuery.toLowerCase())
    );
  }

  selectSession(sessionId: string) {
    this.sessionSelected.emit(sessionId);
  }

  getStatusText(status: string): string {
    const statusMap: Record<string, string> = {
      idle: '空闲',
      running: '运行中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败'
    };
    return statusMap[status] || status;
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}

