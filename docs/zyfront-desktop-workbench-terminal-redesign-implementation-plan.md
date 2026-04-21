# Zyfront Desktop Workbench 终端页面重构 - 实施计划

> 基于设计文档的可落地实施计划

## 项目现状分析

### 现有基础
- ✅ 已有的 workbench 页面实现
- ✅ 已有的事件总线系统 (`multi-agent.events.ts`)
- ✅ 已有的多智能体架构
- ✅ Angular + Electron 技术栈
- ✅ ng-zorro-antd UI 组件库

### 现状评估
| 模块 | 状态 | 说明 |
|------|------|------|
| 事件系统 | 部分完成 | 已有大部分事件类型定义，需补充 input.submitted 事件 |
| 会话管理 | 基础可用 | recentTurns 已有实现，需增强为左侧面板 |
| 输入系统 | 基础可用 | agentChatInput 已有，需增强为底部固定输入框 |
| 输出系统 | 基础可用 | 基于 xterm 的终端，需增强卡片渲染 |
| 任务面板 | 部分完成 | MultiAgentSidebarComponent 已有，需重构 |

---

## Phase 0: 终端工作台基线冻结

**目标**: 冻结布局职责、统一事件协议

### 0.1 定义布局职责划分

#### 文件结构
```
zyfront-desktop/src/app/features/prototype/workbench/
├── components/
│   ├── workbench-layout/
│   │   ├── workbench-layout.component.ts
│   │   ├── workbench-layout.component.html
│   │   └── workbench-layout.component.scss
│   ├── session-panel/
│   ├── terminal-main/
│   ├── input-bar/
│   └── task-panel/
├── services/
│   ├── workbench-state.service.ts
│   └── input-event.service.ts
├── types/
│   └── workbench.types.ts
└── workbench.page.ts
```

#### 工作项
- [ ] 创建 `workbench.types.ts` - 定义核心类型
- [ ] 创建 `WorkbenchStateService` - 统一状态管理
- [ ] 创建 `WorkbenchLayoutComponent` - 布局容器
- [ ] 更新现有 workbench 页面结构

### 0.2 补充缺失事件

#### 需要添加的事件

在 `multi-agent.events.ts` 中补充：

```typescript
// 添加到 MultiAgentEventType
| 'input.submitted'

// 添加 InputSubmittedPayload
export interface InputSubmittedPayload {
  sessionId: string;
  text: string;
  attachments?: Attachment[];
  command?: string;
  timestamp: number;
  source: 'user' | 'shortcut' | 'script';
}

export interface Attachment {
  id: string;
  type: 'file' | 'image' | 'code' | 'link';
  name: string;
  path?: string;
  url?: string;
  content?: string;
  size?: number;
  mimeType?: string;
}
```

### 0.3 定义核心状态模型

创建 `workbench.types.ts`：

```typescript
export interface WorkbenchState {
  layout: LayoutState;
  session: SessionState;
  input: InputState;
  task: TaskState;
  output: OutputState;
}

export interface LayoutState {
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  responsiveMode: 'wide' | 'medium' | 'narrow';
}

export interface SessionState {
  currentSessionId: string;
  sessions: SessionItem[];
  isLoading: boolean;
}

export interface SessionItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  taskCount: number;
  tags: string[];
  summary?: string;
  isPinned: boolean;
  isArchived: boolean;
}

export interface InputState {
  draftText: string;
  attachments: Attachment[];
  isExpanded: boolean;
  isFocused: boolean;
}

export interface TaskState {
  currentTaskGraph?: TaskGraph;
  agentStates: AgentStateItem[];
  isLoading: boolean;
}

export interface AgentStateItem {
  agentId: string;
  role: 'leader' | 'planner' | 'executor' | 'reviewer' | 'researcher';
  name: string;
  status: 'idle' | 'running' | 'blocked' | 'failed';
  modelId?: string;
  lastHeartbeat?: number;
  assignedTasks: string[];
}

export interface OutputState {
  items: OutputItem[];
  scrollToBottom: boolean;
}

export interface OutputItem {
  id: string;
  type: 'terminal' | 'card' | 'diff' | 'image' | 'file' | 'error';
  timestamp: number;
  content: any;
  sessionId: string;
  taskId?: string;
  agentId?: string;
}
```

---

## Phase 1: 左侧最近会话 + 底部输入框 MVP

### 1.1 左侧会话面板

#### 组件: SessionPanelComponent

```typescript
// workbench/components/session-panel/session-panel.component.ts
@Component({
  selector: 'app-session-panel',
  standalone: true,
  imports: [NgIf, NgFor, NzInputModule, NzButtonModule, NzIconModule],
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
          <input type="text" nz-input placeholder="搜索会话...">
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
  `
})
export class SessionPanelComponent {
  @Input() sessions: SessionItem[] = [];
  @Input() currentSessionId: string = '';
  @Output() sessionSelected = new EventEmitter<string>();
  
  selectSession(sessionId: string) {
    this.sessionSelected.emit(sessionId);
  }
}
```

### 1.2 底部输入框

#### 组件: InputBarComponent

```typescript
// workbench/components/input-bar/input-bar.component.ts
@Component({
  selector: 'app-input-bar',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule, NzInputModule, NzButtonModule, NzIconModule],
  template: `
    <div class="input-bar">
      <div class="attachments-preview" *ngIf="attachments.length > 0">
        <div 
          *ngFor="let attachment of attachments"
          class="attachment-chip"
        >
          <span nz-icon [nzType]="getAttachmentIcon(attachment.type)"></span>
          <span>{{ attachment.name }}</span>
          <button nz-button nzType="text" nzSize="small" (click)="removeAttachment(attachment.id)">
            <span nz-icon nzType="close"></span>
          </button>
        </div>
      </div>
      
      <div class="input-row">
        <div class="input-toolbar">
          <button nz-button nzType="text" nzSize="small" (click)="showFilePicker()">
            <span nz-icon nzType="file"></span>
          </button>
          <button nz-button nzType="text" nzSize="small" (click)="showImagePicker()">
            <span nz-icon nzType="image"></span>
          </button>
        </div>
        
        <textarea 
          class="main-input"
          [(ngModel)]="draftText"
          placeholder="输入你的指令..."
          (keydown.enter)="handleEnter($event)"
          (focus)="onFocus()"
          (blur)="onBlur()"
          [rows]="isExpanded ? 5 : 1"
        ></textarea>
        
        <button 
          class="send-button"
          nz-button
          nzType="primary"
          [disabled]="!canSend"
          (click)="send()"
        >
          发送
        </button>
      </div>
    </div>
  `
})
export class InputBarComponent {
  @Input() draftText: string = '';
  @Input() attachments: Attachment[] = [];
  @Output() submitted = new EventEmitter<InputSubmittedPayload>();
  @Output() draftChanged = new EventEmitter<string>();
  @Output() attachmentsChanged = new EventEmitter<Attachment[]>();
  
  isExpanded: boolean = false;
  
  get canSend(): boolean {
    return this.draftText.trim().length > 0 || this.attachments.length > 0;
  }
  
  send() {
    if (!this.canSend) return;
    
    this.submitted.emit({
      sessionId: '', // 由父组件填充
      text: this.draftText,
      attachments: this.attachments,
      timestamp: Date.now(),
      source: 'user'
    });
    
    this.draftText = '';
    this.attachments = [];
  }
}
```

### 1.3 草稿缓存机制

创建 `DraftService`：

```typescript
@Injectable({ providedIn: 'root' })
export class DraftService {
  private readonly STORAGE_KEY = 'workbench:drafts';
  private drafts: Map<string, { text: string; attachments: Attachment[] }> = new Map();
  
  constructor() {
    this.loadFromStorage();
  }
  
  saveDraft(sessionId: string, text: string, attachments: Attachment[]) {
    this.drafts.set(sessionId, { text, attachments });
    this.persistToStorage();
  }
  
  getDraft(sessionId: string): { text: string; attachments: Attachment[] } {
    return this.drafts.get(sessionId) || { text: '', attachments: [] };
  }
  
  clearDraft(sessionId: string) {
    this.drafts.delete(sessionId);
    this.persistToStorage();
  }
  
  private loadFromStorage() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        this.drafts = new Map(Object.entries(parsed));
      }
    } catch {
      // ignore
    }
  }
  
  private persistToStorage() {
    const data = Object.fromEntries(this.drafts);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  }
}
```

---

## Phase 2: 右侧 AI 任务分栏 MVP

### 2.1 任务面板组件

#### 组件: TaskPanelComponent

```typescript
// workbench/components/task-panel/task-panel.component.ts
@Component({
  selector: 'app-task-panel',
  standalone: true,
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
                {{ getStatusText(agent.status) }}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 任务树 -->
      <div class="tasks-section">
        <h4>任务进度</h4>
        <div class="task-tree">
          <ng-container *ngTemplateOutlet="taskNode; context: { $implicit: rootTask }"></ng-container>
        </div>
      </div>
    </div>
    
    <ng-template #taskNode let-task>
      <div class="task-node">
        <div class="task-header">
          <span nz-icon [nzType]="getTaskIcon(task.status)"></span>
          <span class="task-title">{{ task.title }}</span>
        </div>
        <div class="task-progress" *ngIf="task.progress !== undefined">
          <nz-progress [nzPercent]="task.progress" [nzSize]="'small'"></nz-progress>
        </div>
        <div class="task-children" *ngIf="task.children?.length">
          <div *ngFor="let child of task.children">
            <ng-container *ngTemplateOutlet="taskNode; context: { $implicit: child }"></ng-container>
          </div>
        </div>
      </div>
    </ng-template>
  `
})
export class TaskPanelComponent {
  @Input() agentStates: AgentStateItem[] = [];
  @Input() taskGraph?: TaskGraph;
  @Output() taskSelected = new EventEmitter<string>();
}
```

---

## Phase 3: 中央终端主区增强

### 3.1 统一输出渲染

#### 组件: TerminalMainComponent

```typescript
// workbench/components/terminal-main/terminal-main.component.ts
@Component({
  selector: 'app-terminal-main',
  standalone: true,
  template: `
    <div class="terminal-main" #scrollContainer>
      <div class="output-list">
        <div 
          *ngFor="let item of outputItems"
          class="output-item"
          [ngClass]="item.type"
        >
          <ng-container [ngSwitch]="item.type">
            <div *ngSwitchCase="'terminal'" class="terminal-output">
              <pre>{{ item.content }}</pre>
            </div>
            
            <div *ngSwitchCase="'card'" class="card-output">
              <div class="card-content" [innerHTML]="item.content"></div>
            </div>
            
            <div *ngSwitchCase="'diff'" class="diff-output">
              <div class="diff-header">{{ item.content.title }}</div>
              <pre class="diff-content">{{ item.content.diff }}</pre>
            </div>
            
            <div *ngSwitchCase="'image'" class="image-output">
              <img [src]="item.content.url" [alt]="item.content.name" />
            </div>
            
            <div *ngSwitchCase="'file'" class="file-output">
              <span nz-icon nzType="file"></span>
              <span>{{ item.content.name }}</span>
              <button nz-button nzSize="small">打开</button>
            </div>
            
            <div *ngSwitchCase="'error'" class="error-output">
              <span nz-icon nzType="warning" nzTheme="twotone" nzTwotoneColor="#ff4d4f"></span>
              <span>{{ item.content.message }}</span>
            </div>
          </ng-container>
        </div>
      </div>
    </div>
  `
})
export class TerminalMainComponent implements AfterViewChecked {
  @Input() outputItems: OutputItem[] = [];
  @Input() scrollToBottom: boolean = true;
  
  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLDivElement>;
  
  ngAfterViewChecked() {
    if (this.scrollToBottom && this.scrollContainer) {
      this.scrollContainer.nativeElement.scrollTop = 
        this.scrollContainer.nativeElement.scrollHeight;
    }
  }
}
```

---

## Phase 4: 事件驱动联动与状态同步

### 4.1 状态服务集成

#### WorkbenchStateService

```typescript
@Injectable({ providedIn: 'root' })
export class WorkbenchStateService {
  private readonly state = signal<WorkbenchState>({
    layout: {
      leftPanelVisible: true,
      rightPanelVisible: true,
      leftPanelWidth: 280,
      rightPanelWidth: 320,
      responsiveMode: 'wide'
    },
    session: {
      currentSessionId: '',
      sessions: [],
      isLoading: false
    },
    input: {
      draftText: '',
      attachments: [],
      isExpanded: false,
      isFocused: false
    },
    task: {
      agentStates: [],
      isLoading: false
    },
    output: {
      items: [],
      scrollToBottom: true
    }
  });
  
  // Selectors
  readonly state$ = this.state.asReadonly();
  readonly layout$ = computed(() => this.state().layout);
  readonly session$ = computed(() => this.state().session);
  readonly input$ = computed(() => this.state().input);
  readonly task$ = computed(() => this.state().task);
  readonly output$ = computed(() => this.state().output);
  
  constructor(
    private eventBus: MultiAgentEventBusService,
    private draftService: DraftService
  ) {
    this.setupEventListeners();
  }
  
  private setupEventListeners() {
    // 监听会话事件
    this.eventBus.on('session.created', (event) => {
      this.addSession(event.payload.session);
    });
    
    this.eventBus.on('session.resumed', (event) => {
      this.setCurrentSession(event.payload.session.id);
    });
    
    // 监听任务事件
    this.eventBus.on('task.planned', (event) => {
      this.updateTaskGraph(event.payload.taskGraph);
    });
    
    this.eventBus.on('task.started', (event) => {
      this.updateTaskStatus(event.payload.taskId, 'running');
    });
    
    this.eventBus.on('task.completed', (event) => {
      this.updateTaskStatus(event.payload.taskId, 'completed');
    });
    
    // 监听 Agent 事件
    this.eventBus.on('agent.created', (event) => {
      this.addAgentState(event.payload.descriptor);
    });
    
    this.eventBus.on('agent.started', (event) => {
      this.updateAgentStatus(event.payload.agentId, 'running');
    });
    
    this.eventBus.on('agent.idle', (event) => {
      this.updateAgentStatus(event.payload.agentId, 'idle');
    });
  }
  
  // Actions
  selectSession(sessionId: string) {
    // 保存当前草稿
    const currentSessionId = this.state().session.currentSessionId;
    if (currentSessionId) {
      const currentInput = this.state().input;
      this.draftService.saveDraft(currentSessionId, currentInput.draftText, currentInput.attachments);
    }
    
    // 更新当前会话
    this.state.update(s => ({
      ...s,
      session: {
        ...s.session,
        currentSessionId: sessionId
      },
      // 恢复会话草稿
      input: this.draftService.getDraft(sessionId)
    }));
    
    // 触发事件
    this.eventBus.emit('session.resumed', {
      sessionId,
      ts: Date.now(),
      source: 'user',
      payload: {
        session: { id: sessionId } as any,
        restoredFromSnapshot: false
      }
    });
  }
  
  submitInput(payload: InputSubmittedPayload) {
    // 清空草稿
    this.state.update(s => ({
      ...s,
      input: {
        ...s.input,
        draftText: '',
        attachments: []
      }
    }));
    
    // 触发输入事件
    this.eventBus.emit('input.submitted', {
      sessionId: this.state().session.currentSessionId,
      ts: Date.now(),
      source: 'user',
      payload: {
        ...payload,
        sessionId: this.state().session.currentSessionId
      }
    });
  }
  
  addOutputItem(item: OutputItem) {
    this.state.update(s => ({
      ...s,
      output: {
        ...s.output,
        items: [...s.output.items, item]
      }
    }));
  }
  
  // Helpers
  private addSession(session: any) {
    // 实现添加会话逻辑
  }
  
  private setCurrentSession(sessionId: string) {
    // 实现设置当前会话逻辑
  }
  
  private updateTaskGraph(taskGraph: TaskGraph) {
    this.state.update(s => ({
      ...s,
      task: {
        ...s.task,
        currentTaskGraph: taskGraph
      }
    }));
  }
  
  private updateTaskStatus(taskId: string, status: string) {
    // 实现更新任务状态逻辑
  }
  
  private addAgentState(descriptor: AgentDescriptor) {
    // 实现添加 Agent 状态逻辑
  }
  
  private updateAgentStatus(agentId: string, status: string) {
    // 实现更新 Agent 状态逻辑
  }
}
```

---

## Phase 5: 自治协作增强

### 5.1 自动规划触发

### 5.2 自动扩容策略

### 5.3 失败自动恢复

---

## 实施顺序建议

### 优先级 1 (必须)
1. Phase 0 - 基线冻结
2. Phase 1 - 左侧会话 + 底部输入
3. Phase 2 - 右侧任务面板

### 优先级 2 (重要)
4. Phase 3 - 中央输出增强
5. Phase 4 - 事件联动

### 优先级 3 (可选)
6. Phase 5 - 自治协作增强

---

## 验收标准清单

### Phase 0 验收
- [ ] 布局职责文档化
- [ ] 核心类型定义完成
- [ ] 事件协议统一
- [ ] 状态服务框架搭建

### Phase 1 验收
- [ ] 左侧会话列表显示正常
- [ ] 会话切换功能正常
- [ ] 底部输入框常驻
- [ ] 文本输入功能正常
- [ ] 文件/图片附件功能正常
- [ ] 草稿缓存功能正常

### Phase 2 验收
- [ ] 任务树可视化
- [ ] Agent 角色状态显示
- [ ] 任务进度条显示
- [ ] 阻塞任务高亮显示

### Phase 3 验收
- [ ] 终端输出正常显示
- [ ] 卡片化结果展示
- [ ] Diff 预览功能
- [ ] 图片/文件预览
- [ ] 虚拟滚动流畅

### Phase 4 验收
- [ ] 会话切换联动所有区域
- [ ] 输入提交触发任务执行
- [ ] 任务状态更新实时
- [ ] 事件延迟 < 200ms

### Phase 5 验收
- [ ] 自动规划触发正常
- [ ] 自动扩容工作正常
- [ ] 失败自动恢复正常

---

## 技术债务追踪

- [ ] 现有 workbench 代码重构
- [ ] xterm 与卡片输出混合渲染
- [ ] 响应式布局适配
- [ ] 性能优化（虚拟滚动等）

---

## 风险缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 布局重构影响现有功能 | 高 | 渐进式迁移，保留旧代码开关 |
| 事件同步复杂度高 | 中 | 先实现核心事件，逐步完善 |
| 性能问题 | 中 | 虚拟滚动、懒加载优化 |

