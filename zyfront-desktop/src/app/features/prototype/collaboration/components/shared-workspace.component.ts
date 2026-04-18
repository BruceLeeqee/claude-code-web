import { ChangeDetectionStrategy, Component, OnInit, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModeManagerService } from '../services/mode-manager.service';

interface WorkspaceItem {
  id: string;
  title: string;
  type: 'task' | 'document' | 'resource' | 'note';
  status: 'pending' | 'in_progress' | 'completed' | 'archived';
  assignee: string;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
  updatedAt: Date;
  content: string;
}

@Component({
  selector: 'app-shared-workspace',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="workspace-container">
      <div class="workspace-header">
        <span class="workspace-title">共享工作区</span>
        <span class="workspace-subtitle">SHARED WORKSPACE</span>
        <span class="workspace-badge">{{ workspaceItems().length }} 项</span>
      </div>
      <div class="workspace-content">
        <div class="workspace-tabs">
          <button 
            class="tab-btn" 
            [class.tab-active]="activeTab() === 'all'" 
            (click)="activeTab.set('all')"
          >
            全部
          </button>
          <button 
            class="tab-btn" 
            [class.tab-active]="activeTab() === 'tasks'" 
            (click)="activeTab.set('tasks')"
          >
            任务
          </button>
          <button 
            class="tab-btn" 
            [class.tab-active]="activeTab() === 'documents'" 
            (click)="activeTab.set('documents')"
          >
            文档
          </button>
          <button 
            class="tab-btn" 
            [class.tab-active]="activeTab() === 'resources'" 
            (click)="activeTab.set('resources')"
          >
            资源
          </button>
        </div>
        <div class="workspace-items">
          @for (item of filteredItems(); track item.id) {
            <div class="workspace-item" [class."item-" + item.priority]>
              <div class="item-header">
                <div class="item-title">{{ item.title }}</div>
                <div class="item-meta">
                  <span class="item-type">{{ getItemTypeLabel(item.type) }}</span>
                  <span class="item-status">{{ getItemStatusLabel(item.status) }}</span>
                </div>
              </div>
              <div class="item-content">{{ item.content }}</div>
              <div class="item-footer">
                <span class="item-assignee">{{ item.assignee }}</span>
                <span class="item-date">{{ formatDate(item.updatedAt) }}</span>
              </div>
            </div>
          }
          @empty {
            <div class="workspace-empty">
              <span class="empty-icon">📋</span>
              <span class="empty-text">暂无项目</span>
            </div>
          }
        </div>
      </div>
      <div class="workspace-controls">
        <button class="control-btn" (click)="addItem()">添加项目</button>
        <button class="control-btn" (click)="clearCompleted()">清除已完成</button>
      </div>
    </div>
  `,
  styles: [
    `
      .workspace-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #000000;
        border: 2px solid #333;
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.1);
      }
      
      .workspace-header {
        padding: 12px 16px;
        border-bottom: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .workspace-title {
        font-family: 'Press Start 2P', cursive;
        color: #ff00ff;
        font-size: 12px;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .workspace-subtitle {
        font-size: 8px;
        color: #888;
        letter-spacing: 2px;
      }
      
      .workspace-badge {
        font-size: 10px;
        color: #ff00ff;
        background: rgba(255, 0, 255, 0.1);
        padding: 2px 8px;
        border: 1px solid #ff00ff;
        border-radius: 4px;
      }
      
      .workspace-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      
      .workspace-tabs {
        display: flex;
        border-bottom: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
      }
      
      .tab-btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: #ccc;
        font-family: 'VT323', monospace;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.3s;
        border-bottom: 2px solid transparent;
      }
      
      .tab-btn:hover {
        color: #ff00ff;
        background: rgba(255, 0, 255, 0.05);
      }
      
      .tab-active {
        color: #ff00ff !important;
        border-bottom-color: #ff00ff !important;
        background: rgba(255, 0, 255, 0.1) !important;
      }
      
      .workspace-items {
        flex: 1;
        padding: 12px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .workspace-item {
        padding: 12px;
        border: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 4px;
        transition: all 0.3s;
      }
      
      .workspace-item:hover {
        border-color: #ff00ff;
        box-shadow: 0 0 8px rgba(255, 0, 255, 0.2);
      }
      
      .item-high {
        border-left: 4px solid #ff4444;
      }
      
      .item-medium {
        border-left: 4px solid #ffdd00;
      }
      
      .item-low {
        border-left: 4px solid #44ff88;
      }
      
      .item-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
      }
      
      .item-title {
        font-family: 'VT323', monospace;
        color: #ffffff;
        font-size: 14px;
        font-weight: bold;
      }
      
      .item-meta {
        display: flex;
        gap: 8px;
      }
      
      .item-type,
      .item-status {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
      }
      
      .item-type {
        background: rgba(255, 0, 255, 0.1);
        color: #ff00ff;
        border: 1px solid #ff00ff;
      }
      
      .item-status {
        background: rgba(0, 255, 0, 0.1);
        color: #00ff00;
        border: 1px solid #00ff00;
      }
      
      .item-content {
        color: #aaa;
        font-size: 12px;
        line-height: 1.4;
        margin-bottom: 8px;
      }
      
      .item-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10px;
        color: #888;
      }
      
      .item-assignee {
        font-family: 'VT323', monospace;
      }
      
      .workspace-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        color: #888;
      }
      
      .empty-icon {
        font-size: 24px;
        margin-bottom: 8px;
      }
      
      .empty-text {
        font-family: 'VT323', monospace;
        font-size: 14px;
      }
      
      .workspace-controls {
        padding: 12px 16px;
        border-top: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
        display: flex;
        gap: 8px;
        justify-content: center;
      }
      
      .control-btn {
        padding: 8px 16px;
        border: 1px solid #333;
        background: rgba(255, 255, 255, 0.05);
        color: #ccc;
        font-family: 'VT323', monospace;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.3s;
      }
      
      .control-btn:hover {
        border-color: #ff00ff;
        box-shadow: 0 0 8px rgba(255, 0, 255, 0.4);
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SharedWorkspaceComponent implements OnInit {
  @Input() items: WorkspaceItem[] = [];
  
  activeTab = signal('all');
  workspaceItems = signal<WorkspaceItem[]>([]);

  constructor(private modeManager: ModeManagerService) {}

  ngOnInit() {
    if (this.items.length > 0) {
      this.workspaceItems.set(this.items);
    } else {
      this.workspaceItems.set(this.getDefaultItems());
    }
  }

  filteredItems() {
    const tab = this.activeTab();
    const items = this.workspaceItems();
    
    if (tab === 'all') {
      return items;
    } else if (tab === 'tasks') {
      return items.filter(item => item.type === 'task');
    } else if (tab === 'documents') {
      return items.filter(item => item.type === 'document');
    } else if (tab === 'resources') {
      return items.filter(item => item.type === 'resource' || item.type === 'note');
    }
    
    return items;
  }

  private getDefaultItems(): WorkspaceItem[] {
    const now = new Date();
    return [
      {
        id: '1',
        title: '架构设计文档',
        type: 'document',
        status: 'completed',
        assignee: '架构师',
        priority: 'high',
        createdAt: new Date(now.getTime() - 86400000), // 1 day ago
        updatedAt: new Date(now.getTime() - 3600000), // 1 hour ago
        content: '系统架构设计文档，包含技术选型和架构图'
      },
      {
        id: '2',
        title: '并发控制模块开发',
        type: 'task',
        status: 'in_progress',
        assignee: '开发者',
        priority: 'high',
        createdAt: new Date(now.getTime() - 7200000), // 2 hours ago
        updatedAt: new Date(now.getTime() - 300000), // 5 minutes ago
        content: '实现并发控制模块，确保多智能体协作时的数据一致性'
      },
      {
        id: '3',
        title: '测试用例编写',
        type: 'task',
        status: 'pending',
        assignee: '测试员',
        priority: 'medium',
        createdAt: new Date(now.getTime() - 3600000), // 1 hour ago
        updatedAt: new Date(now.getTime() - 3600000), // 1 hour ago
        content: '编写系统集成测试用例，覆盖主要功能场景'
      },
      {
        id: '4',
        title: '市场趋势分析报告',
        type: 'document',
        status: 'completed',
        assignee: '分析师',
        priority: 'medium',
        createdAt: new Date(now.getTime() - 172800000), // 2 days ago
        updatedAt: new Date(now.getTime() - 7200000), // 2 hours ago
        content: '2026年Q2市场趋势分析报告，包含竞争对手分析'
      },
      {
        id: '5',
        title: '部署环境配置',
        type: 'resource',
        status: 'completed',
        assignee: '运维',
        priority: 'medium',
        createdAt: new Date(now.getTime() - 43200000), // 12 hours ago
        updatedAt: new Date(now.getTime() - 1800000), // 30 minutes ago
        content: '生产环境部署配置文件，包含环境变量和服务配置'
      },
      {
        id: '6',
        title: '产品需求文档',
        type: 'document',
        status: 'in_progress',
        assignee: '产品',
        priority: 'high',
        createdAt: new Date(now.getTime() - 259200000), // 3 days ago
        updatedAt: new Date(now.getTime() - 1200000), // 20 minutes ago
        content: '产品需求文档 v1.0，包含功能需求和用户故事'
      }
    ];
  }

  getItemTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      task: '任务',
      document: '文档',
      resource: '资源',
      note: '笔记'
    };
    return labels[type] || type;
  }

  getItemStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: '待处理',
      in_progress: '进行中',
      completed: '已完成',
      archived: '已归档'
    };
    return labels[status] || status;
  }

  formatDate(date: Date): string {
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  addItem() {
    const now = new Date();
    const newItem: WorkspaceItem = {
      id: (this.workspaceItems().length + 1).toString(),
      title: '新项目',
      type: 'task',
      status: 'pending',
      assignee: '未分配',
      priority: 'medium',
      createdAt: now,
      updatedAt: now,
      content: '请输入项目内容'
    };
    this.workspaceItems.update(items => [...items, newItem]);
  }

  clearCompleted() {
    this.workspaceItems.update(items => items.filter(item => item.status !== 'completed'));
  }
}
