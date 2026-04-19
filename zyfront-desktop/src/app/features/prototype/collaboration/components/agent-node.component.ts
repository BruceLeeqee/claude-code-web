import { ChangeDetectionStrategy, Component, Input, AfterViewInit, OnChanges, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnimationService } from '../services/animation.service';

interface AgentNodeState {
  id: string;
  name: string;
  role: 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product';
  status: 'idle' | 'running' | 'busy' | 'error';
  load: number;
  skills: string[];
  teamRole?: 'affirmative' | 'negative' | 'judge';
}

@Component({
  selector: 'app-agent-node',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="agent-node" [class.agent-node-running]="agent.status === 'running'" [class.agent-node-busy]="agent.status === 'busy'" [class.agent-node-error]="agent.status === 'error'" #agentNode>
      <div class="agent-avatar" 
        [class.agent-avatar-affirmative]="agent.teamRole === 'affirmative'"
        [class.agent-avatar-negative]="agent.teamRole === 'negative'"
        [class.agent-avatar-judge]="agent.teamRole === 'judge'"
        [class.agent-avatar-architect]="!agent.teamRole && agent.role === 'architect'" 
        [class.agent-avatar-analyst]="!agent.teamRole && agent.role === 'analyst'" 
        [class.agent-avatar-developer]="!agent.teamRole && agent.role === 'developer'" 
        [class.agent-avatar-tester]="!agent.teamRole && agent.role === 'tester'" 
        [class.agent-avatar-devops]="!agent.teamRole && agent.role === 'devops'" 
        [class.agent-avatar-product]="!agent.teamRole && agent.role === 'product'">
        <div class="agent-avatar-inner"></div>
      </div>
      <div class="agent-info">
        <div class="agent-name">{{ agent.name }}</div>
        <div class="agent-role">{{ getRoleName(agent.role) }}</div>
        <div class="agent-status">{{ getStatusName(agent.status) }}</div>
        <div class="agent-load">
          <div class="agent-load-bar">
            <div class="agent-load-fill" [style.width]="agent.load + '%'" [class.agent-load-fill-running]="agent.status === 'running'" [class.agent-load-fill-busy]="agent.status === 'busy'" [class.agent-load-fill-error]="agent.status === 'error'"></div>
          </div>
          <div class="agent-load-text">{{ agent.load }}%</div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .agent-node {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border: 2px solid #333;
        background: #000000;
        box-shadow: 0 0 8px rgba(255, 255, 255, 0.05);
        transition: all 0.2s;
      }
      
      .agent-node:hover {
        border-color: #00ff00;
        box-shadow: 0 0 12px rgba(0, 255, 0, 0.4);
      }
      
      .agent-node-running {
        border-color: #00ff00;
        box-shadow: 0 0 12px rgba(0, 255, 0, 0.4);
      }
      
      .agent-node-busy {
        border-color: #ffdd00;
        box-shadow: 0 0 12px rgba(255, 221, 0, 0.4);
      }
      
      .agent-node-error {
        border-color: #ff4444;
        box-shadow: 0 0 12px rgba(255, 68, 68, 0.4);
      }
      
      .agent-avatar {
        width: 40px;
        height: 40px;
        border: 2px solid;
        display: flex;
        align-items: center;
        justify-content: center;
        image-rendering: pixelated;
      }
      
      .agent-avatar-inner {
        width: 24px;
        height: 24px;
        background: currentColor;
        image-rendering: pixelated;
      }
      
      .agent-avatar-affirmative {
        color: #00ff88;
        border-color: #00ff88;
        box-shadow: 0 0 12px rgba(0, 255, 136, 0.6);
      }
      
      .agent-avatar-negative {
        color: #ff4466;
        border-color: #ff4466;
        box-shadow: 0 0 12px rgba(255, 68, 102, 0.6);
      }
      
      .agent-avatar-judge {
        color: #ffdd00;
        border-color: #ffdd00;
        box-shadow: 0 0 12px rgba(255, 221, 0, 0.6);
      }
      
      .agent-avatar-architect {
        color: #ff4444;
        border-color: #ff4444;
        box-shadow: 0 0 8px rgba(255, 68, 68, 0.6);
      }
      
      .agent-avatar-analyst {
        color: #4488ff;
        border-color: #4488ff;
        box-shadow: 0 0 8px rgba(68, 136, 255, 0.6);
      }
      
      .agent-avatar-developer {
        color: #44ff88;
        border-color: #44ff88;
        box-shadow: 0 0 8px rgba(68, 255, 136, 0.6);
      }
      
      .agent-avatar-tester {
        color: #ffdd44;
        border-color: #ffdd44;
        box-shadow: 0 0 8px rgba(255, 221, 68, 0.6);
      }
      
      .agent-avatar-devops {
        color: #ff66aa;
        border-color: #ff66aa;
        box-shadow: 0 0 8px rgba(255, 102, 170, 0.6);
      }
      
      .agent-avatar-product {
        color: #aa66ff;
        border-color: #aa66ff;
        box-shadow: 0 0 8px rgba(170, 102, 255, 0.6);
      }
      
      .agent-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .agent-name {
        font-family: 'VT323', monospace;
        color: #ccc;
        font-size: 14px;
        text-shadow: 0 0 2px rgba(255, 255, 255, 0.2);
      }
      
      .agent-role {
        font-size: 12px;
        color: #888;
        text-shadow: 0 0 2px rgba(255, 255, 255, 0.1);
      }
      
      .agent-status {
        font-size: 11px;
        color: #666;
        text-shadow: 0 0 2px rgba(255, 255, 255, 0.1);
      }
      
      .agent-load {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
      }
      
      .agent-load-bar {
        flex: 1;
        height: 6px;
        background: #1a1a2e;
        border: 1px solid #222;
      }
      
      .agent-load-fill {
        height: 100%;
        background: linear-gradient(90deg, #00ff00, #44ff88);
        box-shadow: 0 0 4px rgba(0, 255, 0, 0.6);
        transition: width 0.3s, background 0.3s, box-shadow 0.3s;
      }
      
      .agent-load-fill-running {
        background: linear-gradient(90deg, #00ff00, #44ff88);
        box-shadow: 0 0 6px rgba(0, 255, 0, 0.8);
        animation: load-pulse 1s infinite;
      }
      
      .agent-load-fill-busy {
        background: linear-gradient(90deg, #ffdd00, #ffcc00);
        box-shadow: 0 0 6px rgba(255, 221, 0, 0.8);
        animation: load-pulse 0.5s infinite;
      }
      
      .agent-load-fill-error {
        background: linear-gradient(90deg, #ff4444, #ff6666);
        box-shadow: 0 0 6px rgba(255, 68, 68, 0.8);
        animation: load-pulse 0.3s infinite;
      }
      
      @keyframes load-pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
      
      .agent-load-text {
        font-family: 'VT323', monospace;
        font-size: 11px;
        color: #888;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AgentNodeComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() agent!: AgentNodeState;
  @ViewChild('agentNode') agentNode!: ElementRef<HTMLElement>;
  private previousStatus: string = '';

  constructor(private animationService: AnimationService) {}

  ngAfterViewInit() {
    if (this.agentNode && this.agent.status) {
      this.playAnimation();
      this.previousStatus = this.agent.status;
    }
  }

  ngOnChanges() {
    if (this.agentNode && this.agent.status && this.agent.status !== this.previousStatus) {
      // Play status transition animation
      this.animationService.playAnimation(this.agentNode.nativeElement, 'status-transition', `transition-${this.agent.id}`);
      // Play new status animation after transition
      setTimeout(() => {
        this.playAnimation();
      }, 300);
      this.previousStatus = this.agent.status;
    }
  }

  ngOnDestroy() {
    // Stop any running animations
    this.animationService.stopAnimation(`agent-${this.agent.id}`);
    this.animationService.stopAnimation(`transition-${this.agent.id}`);
  }

  private playAnimation() {
    if (this.agentNode) {
      const animationName = this.animationService.getAnimationForStatus(this.agent.status);
      this.animationService.playAnimation(this.agentNode.nativeElement, animationName, `agent-${this.agent.id}`);
    }
  }

  getRoleName(role: string): string {
    const roleNames = {
      architect: '架构师',
      analyst: '分析师',
      developer: '开发者',
      tester: '测试员',
      devops: '运维',
      product: '产品'
    };
    return roleNames[role as keyof typeof roleNames] || role;
  }

  getStatusName(status: string): string {
    const statusNames = {
      idle: '空闲',
      running: '运行中',
      busy: '忙碌',
      error: '错误'
    };
    return statusNames[status as keyof typeof statusNames] || status;
  }
}
