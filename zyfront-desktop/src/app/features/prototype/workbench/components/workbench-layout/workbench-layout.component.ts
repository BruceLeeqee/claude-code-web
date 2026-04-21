import { Component, effect, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { SessionPanelComponent } from '../session-panel/session-panel.component';
import { InputBarComponent } from '../input-bar/input-bar.component';
import { TaskPanelComponent } from '../task-panel/task-panel.component';
import { TerminalMainComponent } from '../terminal-main/terminal-main.component';
import { WorkbenchStateService } from '../../services/workbench-state.service';
import { InputSubmittedPayload } from '../../types/workbench.types';

@Component({
  selector: 'app-workbench-layout',
  standalone: true,
  imports: [
    NgIf,
    NzIconModule,
    NzButtonModule,
    SessionPanelComponent,
    InputBarComponent,
    TaskPanelComponent,
    TerminalMainComponent
  ],
  template: `
    <div class="workbench-layout">
      <!-- 左侧面板 -->
      <div 
        class="left-panel"
        [class.hidden]="!layout().leftPanelVisible"
        [style.width.px]="layout().leftPanelWidth"
      >
        <app-session-panel
          [sessions]="session().sessions"
          [currentSessionId]="session().currentSessionId"
          (sessionSelected)="onSessionSelected($event)"
        ></app-session-panel>
      </div>
      
      <!-- 左面板切换按钮 -->
      <button 
        class="panel-toggle left-toggle"
        *ngIf="!layout().leftPanelVisible"
        nz-button
        nzType="text"
        nzSize="small"
        (click)="toggleLeftPanel()"
      >
        <span nz-icon nzType="right"></span>
      </button>
      
      <!-- 中央区域 -->
      <div class="center-area">
        <!-- 顶部标签栏 -->
        <div class="tab-bar">
          <div class="tabs">
            <div class="tab active">终端 - Main</div>
          </div>
        </div>
        
        <!-- 终端主区 -->
        <div class="terminal-area">
          <app-terminal-main
            [outputItems]="output().items"
            [scrollToBottom]="output().scrollToBottom"
          ></app-terminal-main>
        </div>
        
        <!-- 底部输入栏 -->
        <div class="input-area">
          <app-input-bar
            [draftText]="input().draftText"
            [attachments]="input().attachments"
            (submitted)="onInputSubmitted($event)"
            (draftChanged)="onDraftChanged($event)"
            (attachmentsChanged)="onAttachmentsChanged($event)"
          ></app-input-bar>
        </div>
      </div>
      
      <!-- 右面板切换按钮 -->
      <button 
        class="panel-toggle right-toggle"
        *ngIf="!layout().rightPanelVisible"
        nz-button
        nzType="text"
        nzSize="small"
        (click)="toggleRightPanel()"
      >
        <span nz-icon nzType="left"></span>
      </button>
      
      <!-- 右侧面板 -->
      <div 
        class="right-panel"
        [class.hidden]="!layout().rightPanelVisible"
        [style.width.px]="layout().rightPanelWidth"
      >
        <app-task-panel
          [agentStates]="task().agentStates"
          [taskGraph]="task().currentTaskGraph"
        ></app-task-panel>
      </div>
    </div>
  `,
  styles: [`
    .workbench-layout {
      display: flex;
      height: 100vh;
      background: #0a0a0a;
    }
    
    .left-panel {
      border-right: 1px solid #2a2a2a;
      transition: width 0.2s, opacity 0.2s;
      overflow: hidden;
    }
    
    .left-panel.hidden {
      width: 0;
      opacity: 0;
    }
    
    .center-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    
    .tab-bar {
      background: #141414;
      border-bottom: 1px solid #2a2a2a;
      padding: 8px 12px;
    }
    
    .tabs {
      display: flex;
      gap: 4px;
    }
    
    .tab {
      padding: 6px 14px;
      background: #1e1e1e;
      border-radius: 4px 4px 0 0;
      font-size: 13px;
      color: #8c8c8c;
      cursor: pointer;
    }
    
    .tab.active {
      background: #0a0a0a;
      color: #fff;
      border: 1px solid #2a2a2a;
      border-bottom: none;
      margin-bottom: -1px;
    }
    
    .terminal-area {
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    
    .input-area {
      flex-shrink: 0;
    }
    
    .right-panel {
      border-left: 1px solid #2a2a2a;
      transition: width 0.2s, opacity 0.2s;
      overflow: hidden;
    }
    
    .right-panel.hidden {
      width: 0;
      opacity: 0;
    }
    
    .panel-toggle {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: #1e1e1e;
      border: 1px solid #2a2a2a;
      border-radius: 0 4px 4px 0;
      padding: 20px 8px;
      z-index: 10;
    }
    
    .left-toggle {
      left: 0;
      border-radius: 0 4px 4px 0;
    }
    
    .right-toggle {
      right: 0;
      border-radius: 4px 0 0 4px;
    }
    
    .panel-toggle span {
      color: #8c8c8c;
    }
  `]
})
export class WorkbenchLayoutComponent {
  private stateService = inject(WorkbenchStateService);

  protected layout = this.stateService.layout$;
  protected session = this.stateService.session$;
  protected input = this.stateService.input$;
  protected task = this.stateService.task$;
  protected output = this.stateService.output$;

  constructor() {
    this.initializeDemoData();
  }

  private initializeDemoData() {
    const demoSessions = [
      {
        id: 'session-1',
        name: '重构数据解析模块',
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 1800000,
        status: 'completed' as const,
        taskCount: 5,
        tags: ['refactor', 'parser'],
        isPinned: true,
        isArchived: false
      },
      {
        id: 'session-2',
        name: '修复 WebGL 内存溢出',
        createdAt: Date.now() - 7200000,
        updatedAt: Date.now() - 3600000,
        status: 'running' as const,
        taskCount: 3,
        tags: ['bug', 'webgl'],
        isPinned: false,
        isArchived: false
      }
    ];

    const demoAgents = [
      {
        agentId: 'agent-1',
        role: 'leader' as const,
        name: 'Leader',
        status: 'idle' as const,
        assignedTasks: []
      },
      {
        agentId: 'agent-2',
        role: 'executor' as const,
        name: 'Code Reviewer',
        status: 'running' as const,
        assignedTasks: ['task-1']
      }
    ];

    const demoOutputs = [
      {
        id: 'output-1',
        type: 'terminal' as const,
        timestamp: Date.now() - 10000,
        content: '> Claude: 我已完成对项目的深度扫描。以下是分析报告：\n\n项目规模：约 12,400 行 TypeScript 代码\n架构模式：模块化架构，基于 Electron 渲染进程\n',
        sessionId: 'session-2'
      },
      {
        id: 'output-2',
        type: 'card' as const,
        timestamp: Date.now() - 5000,
        content: '<div style="padding: 10px;"><h4 style="margin:0 0 8px 0;color:#52c41a;">✅ 分析完成</h4><p style="margin:0;color:#8c8c8c;font-size:13px;">发现 3 个潜在性能瓶颈点</p></div>',
        sessionId: 'session-2'
      }
    ];

    this.stateService.setSessions(demoSessions);
    this.stateService.selectSession('session-2');
    demoAgents.forEach(agent => {
      this.stateService['state'].update(s => ({
        ...s,
        task: {
          ...s.task,
          agentStates: [...s.task.agentStates, agent]
        }
      }));
    });
    demoOutputs.forEach(item => {
      this.stateService.addOutputItem(item);
    });
  }

  toggleLeftPanel() {
    this.stateService.setLeftPanelVisible(!this.layout().leftPanelVisible);
  }

  toggleRightPanel() {
    this.stateService.setRightPanelVisible(!this.layout().rightPanelVisible);
  }

  onSessionSelected(sessionId: string) {
    this.stateService.selectSession(sessionId);
  }

  onInputSubmitted(payload: InputSubmittedPayload) {
    this.stateService.submitInput(payload);
  }

  onDraftChanged(text: string) {
    this.stateService.setDraftText(text);
  }

  onAttachmentsChanged(attachments: any[]) {
    this.stateService.setAttachments(attachments);
  }
}

