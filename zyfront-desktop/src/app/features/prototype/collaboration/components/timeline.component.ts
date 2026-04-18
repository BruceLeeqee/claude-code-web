import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, ViewChild, ElementRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as vis from 'vis-timeline';
import { ModeManagerService } from '../services/mode-manager.service';

interface TimelineItem {
  id: string;
  content: string;
  start: string;
  end?: string;
  group: string;
  className: string;
  type: 'point' | 'range';
}

interface TimelineGroup {
  id: string;
  content: string;
  className: string;
}

@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="timeline-container">
      <div class="timeline-header">
        <span class="timeline-title">工作流时间轴</span>
        <span class="timeline-subtitle">WORKFLOW TIMELINE</span>
        <span class="timeline-badge">{{ status }}</span>
      </div>
      <div #timelineContainer class="timeline-content"></div>
      <div class="timeline-controls">
        <button class="control-btn" (click)="zoomIn()">放大</button>
        <button class="control-btn" (click)="zoomOut()">缩小</button>
        <button class="control-btn" (click)="fitView()">适应视图</button>
      </div>
    </div>
  `,
  styles: [
    `
      .timeline-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #000000;
        border: 2px solid #333;
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.1);
      }
      
      .timeline-header {
        padding: 12px 16px;
        border-bottom: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .timeline-title {
        font-family: 'Press Start 2P', cursive;
        color: #ff00ff;
        font-size: 12px;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .timeline-subtitle {
        font-size: 8px;
        color: #888;
        letter-spacing: 2px;
      }
      
      .timeline-badge {
        font-size: 10px;
        color: #ff00ff;
        background: rgba(255, 0, 255, 0.1);
        padding: 2px 8px;
        border: 1px solid #ff00ff;
        border-radius: 4px;
      }
      
      .timeline-content {
        flex: 1;
        position: relative;
      }
      
      .timeline-controls {
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
      
      /* Timeline item styles */
      .vis-item.vis-dot {
        border-color: #ff00ff !important;
        border-width: 3px !important;
      }
      
      .vis-item.vis-line {
        background-color: #ff00ff !important;
      }
      
      .vis-item.vis-range {
        background-color: rgba(255, 0, 255, 0.2) !important;
        border-color: #ff00ff !important;
      }
      
      .vis-item-content {
        font-family: 'VT323', monospace !important;
        font-size: 12px !important;
        color: #ffffff !important;
      }
      
      /* Group styles */
      .vis-group {
        background-color: rgba(255, 255, 255, 0.03) !important;
      }
      
      .vis-group-label {
        font-family: 'VT323', monospace !important;
        font-size: 12px !important;
        color: #cccccc !important;
      }
      
      /* Timeline axis */
      .vis-time-axis .vis-text {
        color: #888888 !important;
        font-family: 'VT323', monospace !important;
        font-size: 10px !important;
      }
      
      .vis-time-axis .vis-grid.vis-minor {
        border-color: rgba(255, 255, 255, 0.1) !important;
      }
      
      .vis-time-axis .vis-grid.vis-major {
        border-color: rgba(255, 255, 255, 0.2) !important;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TimelineComponent implements OnInit, OnDestroy {
  @ViewChild('timelineContainer') timelineContainer!: ElementRef;
  @Input() items: TimelineItem[] = [];
  @Input() groups: TimelineGroup[] = [];
  
  private timeline!: vis.Timeline;
  private container!: HTMLElement;
  status = '运行中';

  constructor(private modeManager: ModeManagerService) {}

  ngOnInit() {
    this.container = this.timelineContainer.nativeElement;
    this.initializeTimeline();
  }

  ngOnDestroy() {
    if (this.timeline) {
      this.timeline.destroy();
    }
  }

  private initializeTimeline() {
    // Default items and groups if none provided
    const defaultItems = this.items.length > 0 ? this.items : this.getDefaultItems();
    const defaultGroups = this.groups.length > 0 ? this.groups : this.getDefaultGroups();

    const data = {
      items: defaultItems,
      groups: defaultGroups
    };

    const options: any = {
      editable: true,
      multiselect: true,
      zoomable: true,
      zoomMin: 1000 * 60, // 1 minute
      zoomMax: 1000 * 60 * 60 * 24, // 1 day
      stack: true,
      showCurrentTime: true,
      showMajorLabels: true,
      showMinorLabels: true,
      format: {
        minorLabels: {
          minute: 'HH:mm',
          hour: 'HH:mm'
        },
        majorLabels: {
          day: 'YYYY-MM-DD',
          month: 'YYYY-MM',
          year: 'YYYY'
        }
      },
      groupOrder: 'content',
      groupWidthMode: 'fixed',
      groupHeight: 40,
      itemHeight: 20,
      minHeight: 300
    };

    this.timeline = new vis.Timeline(this.container, data.items, data.groups, options);
    this.setupEventListeners();
  }

  private getDefaultGroups(): TimelineGroup[] {
    return [
      { id: 'alpha', content: 'Alpha Team', className: 'group-alpha' },
      { id: 'beta', content: 'Beta Team', className: 'group-beta' },
      { id: 'system', content: 'System', className: 'group-system' }
    ];
  }

  private getDefaultItems(): TimelineItem[] {
    const now = new Date();
    const items: TimelineItem[] = [];
    
    // Alpha team items
    items.push({
      id: '1',
      content: '架构师 分解任务为 5 个子项',
      start: new Date(now.getTime() - 600000).toISOString(), // 10 minutes ago
      group: 'alpha',
      className: 'item-red',
      type: 'point'
    });
    
    items.push({
      id: '2',
      content: '分析师 启动市场趋势关联检索',
      start: new Date(now.getTime() - 540000).toISOString(), // 9 minutes ago
      group: 'alpha',
      className: 'item-blue',
      type: 'point'
    });
    
    items.push({
      id: '3',
      content: '开发者 开始生成并发控制模块代码',
      start: new Date(now.getTime() - 480000).toISOString(), // 8 minutes ago
      end: new Date(now.getTime() - 240000).toISOString(), // 4 minutes ago
      group: 'alpha',
      className: 'item-green',
      type: 'range'
    });
    
    // Beta team items
    items.push({
      id: '4',
      content: '测试员 识别出 2 处边界逻辑风险',
      start: new Date(now.getTime() - 360000).toISOString(), // 6 minutes ago
      group: 'beta',
      className: 'item-yellow',
      type: 'point'
    });
    
    items.push({
      id: '5',
      content: '运维 部署测试环境',
      start: new Date(now.getTime() - 300000).toISOString(), // 5 minutes ago
      end: new Date(now.getTime() - 180000).toISOString(), // 3 minutes ago
      group: 'beta',
      className: 'item-gray',
      type: 'range'
    });
    
    items.push({
      id: '6',
      content: '产品 确认需求变更',
      start: new Date(now.getTime() - 240000).toISOString(), // 4 minutes ago
      group: 'beta',
      className: 'item-pink',
      type: 'point'
    });
    
    // System items
    items.push({
      id: '7',
      content: '系统自检：资源消耗 82%... 触发告警',
      start: new Date(now.getTime() - 120000).toISOString(), // 2 minutes ago
      group: 'system',
      className: 'item-red',
      type: 'point'
    });
    
    items.push({
      id: '8',
      content: '系统优化：调整资源分配',
      start: new Date(now.getTime() - 60000).toISOString(), // 1 minute ago
      end: new Date().toISOString(),
      group: 'system',
      className: 'item-green',
      type: 'range'
    });
    
    return items;
  }

  private setupEventListeners() {
    this.timeline.on('select', (properties) => {
      console.log('Selected items:', properties.items);
    });

    this.timeline.on('doubleClick', (properties) => {
      if (properties.item) {
        console.log('Item double clicked:', properties.item);
      }
    });

    this.timeline.on('contextmenu', (properties) => {
      console.log('Context menu event:', properties);
    });
  }

  zoomIn() {
    this.timeline.zoomIn(0.5);
  }

  zoomOut() {
    this.timeline.zoomOut(0.5);
  }

  fitView() {
    this.timeline.fit();
  }
}
