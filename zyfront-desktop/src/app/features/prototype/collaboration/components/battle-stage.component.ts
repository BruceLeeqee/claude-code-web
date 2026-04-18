import { ChangeDetectionStrategy, Component, Input, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ParticleSystemService } from '../services/particle-system.service';

interface BattleStageState {
  teams: {
    id: string;
    name: string;
    score: number;
    agents: {
      id: string;
      name: string;
      role: string;
      status: string;
      position: { x: number; y: number };
    }[];
  }[];
  currentTurn: string;
  round: number;
  status: 'idle' | 'playing' | 'paused' | 'finished';
}

@Component({
  selector: 'app-battle-stage',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="battle-stage" [class.battle-stage-playing]="stage.status === 'playing'" [class.battle-stage-paused]="stage.status === 'paused'" #battleStage>
      <!-- Scoreboard -->
      <div class="stage-scoreboard">
        <div class="team-score" *ngFor="let team of stage.teams">
          <span class="team-name">{{ team.name }}</span>
          <span class="team-value">{{ team.score.toLocaleString() }}</span>
        </div>
        <div class="round-info">
          <span class="round-label">ROUND</span>
          <span class="round-value">{{ stage.round }}</span>
        </div>
      </div>

      <!-- Grid Background -->
      <div class="stage-grid"></div>

      <!-- Agents -->
      <div class="stage-agents">
        <div 
          *ngFor="let team of stage.teams"
          class="team-agents"
        >
          <div 
            *ngFor="let agent of team.agents"
            class="stage-agent"
            [class.stage-agent-active]="agent.id === stage.currentTurn"
            [style.left]="agent.position.x + '%'"
            [style.top]="agent.position.y + '%'"
            (click)="onAgentClick(agent)"
          >
            <div class="agent-body" [class.agent-body-architect]="agent.role === 'architect'" [class.agent-body-analyst]="agent.role === 'analyst'" [class.agent-body-developer]="agent.role === 'developer'" [class.agent-body-tester]="agent.role === 'tester'" [class.agent-body-devops]="agent.role === 'devops'" [class.agent-body-product]="agent.role === 'product'">
              <div class="agent-eyes"></div>
            </div>
            <div class="agent-name">{{ agent.name }}</div>
          </div>
        </div>
      </div>

      <!-- Status Card -->
      <div class="status-card">
        <div class="status-title">{{ getCurrentAgent()?.name }} ({{ getCurrentAgent()?.role }}) THINKING...</div>
        <div class="status-progress">
          <div class="progress-bar" [style.width]="progress + '%'" [class.progress-bar-running]="stage.status === 'playing'" [class.progress-bar-paused]="stage.status === 'paused'"></div>
        </div>
        <div class="status-desc">Analyzing code vulnerability #829...</div>
      </div>
    </div>
  `,
  styles: [
    `
      .battle-stage {
        position: relative;
        height: 100%;
        overflow: hidden;
        background: #000000;
        border: 2px solid #333;
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.1);
      }
      
      .battle-stage-playing {
        box-shadow: 0 0 24px rgba(0, 255, 0, 0.3);
      }
      
      .battle-stage-paused {
        box-shadow: 0 0 24px rgba(255, 221, 0, 0.3);
      }
      
      .stage-scoreboard {
        position: absolute;
        top: 16px;
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 48px;
        z-index: 10;
      }
      
      .team-score {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }
      
      .team-name {
        font-family: 'Press Start 2P', cursive;
        font-size: 12px;
        letter-spacing: 1px;
        color: #888;
        text-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
      }
      
      .team-value {
        font-family: 'Press Start 2P', cursive;
        font-size: 24px;
        color: #fff;
        text-shadow: 0 0 12px rgba(255, 255, 255, 0.8), 0 0 24px rgba(255, 255, 255, 0.4);
        letter-spacing: 2px;
      }
      
      .round-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      
      .round-label {
        font-family: 'Press Start 2P', cursive;
        font-size: 8px;
        color: #ff00ff;
        text-shadow: 0 0 6px rgba(255, 0, 255, 0.8);
      }
      
      .round-value {
        font-family: 'Press Start 2P', cursive;
        font-size: 16px;
        color: #ff00ff;
        text-shadow: 0 0 10px rgba(255, 0, 255, 0.8), 0 0 20px rgba(255, 0, 255, 0.4);
      }
      
      .stage-grid {
        position: absolute;
        inset: 0;
        background-image: 
          linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
        background-size: 32px 32px;
        pointer-events: none;
        image-rendering: pixelated;
      }
      
      .stage-agents {
        position: absolute;
        inset: 0;
      }
      
      .team-agents {
        position: relative;
        height: 100%;
      }
      
      .stage-agent {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        transition: all 0.3s ease;
      }
      
      .stage-agent-active {
        transform: translate(-50%, -50%) scale(1.1);
      }
      
      .agent-body {
        width: 40px;
        height: 40px;
        border: 2px solid;
        display: flex;
        align-items: center;
        justify-content: center;
        image-rendering: pixelated;
        box-shadow: 0 0 12px currentColor, 0 0 24px currentColor;
        animation: agent-pulse 2s infinite;
      }
      
      @keyframes agent-pulse {
        0%, 100% {
          box-shadow: 0 0 12px currentColor, 0 0 24px currentColor;
        }
        50% {
          box-shadow: 0 0 16px currentColor, 0 0 32px currentColor, 0 0 48px currentColor;
        }
      }
      
      .agent-eyes {
        width: 16px;
        height: 8px;
        display: flex;
        gap: 4px;
      }
      
      .agent-eyes::before,
      .agent-eyes::after {
        content: '';
        width: 4px;
        height: 4px;
        background: #000;
        border-radius: 50%;
      }
      
      .agent-body-architect {
        color: #ff4444;
        border-color: #ff4444;
        background: rgba(255, 68, 68, 0.2);
      }
      
      .agent-body-analyst {
        color: #4488ff;
        border-color: #4488ff;
        background: rgba(68, 136, 255, 0.2);
      }
      
      .agent-body-developer {
        color: #44ff88;
        border-color: #44ff88;
        background: rgba(68, 255, 136, 0.2);
      }
      
      .agent-body-tester {
        color: #ffdd44;
        border-color: #ffdd44;
        background: rgba(255, 221, 68, 0.2);
      }
      
      .agent-body-devops {
        color: #ff66aa;
        border-color: #ff66aa;
        background: rgba(255, 102, 170, 0.2);
      }
      
      .agent-body-product {
        color: #aa66ff;
        border-color: #aa66ff;
        background: rgba(170, 102, 255, 0.2);
      }
      
      .agent-name {
        font-family: 'VT323', monospace;
        font-size: 12px;
        color: #ccc;
        text-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
        text-align: center;
        min-width: 80px;
      }
      
      .status-card {
        position: absolute;
        bottom: 16px;
        left: 16px;
        border: 2px solid #00ff00;
        background: rgba(0, 0, 0, 0.95);
        padding: 12px;
        min-width: 240px;
        box-shadow: 0 0 12px rgba(0, 255, 0, 0.6), inset 0 0 8px rgba(0, 255, 0, 0.15);
        z-index: 10;
      }
      
      .status-title {
        font-family: 'VT323', monospace;
        color: #00ff00;
        font-size: 14px;
        letter-spacing: 1px;
        margin-bottom: 8px;
        text-shadow: 0 0 8px rgba(0, 255, 0, 0.8), 0 0 16px rgba(0, 255, 0, 0.4);
      }
      
      .status-progress {
        height: 8px;
        background: #1a1a2e;
        margin-bottom: 8px;
        border: 1px solid #333;
      }
      
      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #00ff00, #44ff88);
        box-shadow: 0 0 6px rgba(0, 255, 0, 0.8);
        transition: width 0.3s, background 0.3s, box-shadow 0.3s;
      }
      
      .progress-bar-running {
        background: linear-gradient(90deg, #00ff00, #44ff88);
        box-shadow: 0 0 8px rgba(0, 255, 0, 1);
        animation: progress-pulse 1s infinite;
      }
      
      .progress-bar-paused {
        background: linear-gradient(90deg, #ffdd00, #ffcc00);
        box-shadow: 0 0 8px rgba(255, 221, 0, 0.8);
        animation: progress-pulse 2s infinite;
      }
      
      @keyframes progress-pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
      
      .status-desc {
        color: #888;
        font-size: 12px;
        text-shadow: 0 0 2px rgba(255, 255, 255, 0.2);
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BattleStageComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() stage!: BattleStageState;
  @ViewChild('battleStage') battleStage!: ElementRef<HTMLElement>;
  progress = 0;
  private previousTurn: string = '';

  constructor(private particleSystem: ParticleSystemService) {}

  ngAfterViewInit() {
    if (this.battleStage) {
      this.particleSystem.initialize(this.battleStage.nativeElement);
    }
  }

  ngOnInit() {
    // Simulate thinking progress
    setInterval(() => {
      this.progress = (this.progress + 5) % 100;
      
      // Create spark effect when progress reaches 100%
      if (this.progress === 0) {
        this.createTurnEffect();
      }
    }, 200);
  }

  ngOnDestroy() {
    this.particleSystem.destroy();
  }

  onAgentClick(agent: any) {
    // Create explosion effect on agent click
    const agentElement = document.querySelector(`[style*="left: ${agent.position.x}%"]`);
    if (agentElement) {
      const rect = agentElement.getBoundingClientRect();
      const stageRect = this.battleStage.nativeElement.getBoundingClientRect();
      const x = rect.left - stageRect.left + rect.width / 2;
      const y = rect.top - stageRect.top + rect.height / 2;
      
      this.particleSystem.createExplosion(x, y, this.getAgentColor(agent.role));
    }
  }

  private createTurnEffect() {
    const currentAgent = this.getCurrentAgent();
    if (currentAgent && currentAgent.id !== this.previousTurn) {
      // Create beam effect between previous and current agent
      if (this.previousTurn) {
        const previousAgent = this.getAgentById(this.previousTurn);
        if (previousAgent) {
          this.createBeamEffect(previousAgent, currentAgent);
        }
      }
      
      // Create score effect for current agent
      const agentElement = document.querySelector(`[style*="left: ${currentAgent.position.x}%"]`);
      if (agentElement) {
        const rect = agentElement.getBoundingClientRect();
        const stageRect = this.battleStage.nativeElement.getBoundingClientRect();
        const x = rect.left - stageRect.left + rect.width / 2;
        const y = rect.top - stageRect.top - 20;
        
        this.particleSystem.createScore(x, y, Math.floor(Math.random() * 100) + 50);
      }
      
      this.previousTurn = currentAgent.id;
    }
  }

  private createBeamEffect(fromAgent: any, toAgent: any) {
    const fromElement = document.querySelector(`[style*="left: ${fromAgent.position.x}%"]`);
    const toElement = document.querySelector(`[style*="left: ${toAgent.position.x}%"]`);
    
    if (fromElement && toElement) {
      const fromRect = fromElement.getBoundingClientRect();
      const toRect = toElement.getBoundingClientRect();
      const stageRect = this.battleStage.nativeElement.getBoundingClientRect();
      
      const fromX = fromRect.left - stageRect.left + fromRect.width / 2;
      const fromY = fromRect.top - stageRect.top + fromRect.height / 2;
      const toX = toRect.left - stageRect.left + toRect.width / 2;
      const toY = toRect.top - stageRect.top + toRect.height / 2;
      
      this.particleSystem.createBeam(fromX, fromY, toX, toY, this.getAgentColor(toAgent.role));
    }
  }

  private getAgentById(agentId: string) {
    for (const team of this.stage.teams) {
      const agent = team.agents.find(a => a.id === agentId);
      if (agent) {
        return agent;
      }
    }
    return null;
  }

  private getAgentColor(role: string): string {
    const roleColors = {
      architect: '#ff4444',
      analyst: '#4488ff',
      developer: '#44ff88',
      tester: '#ffdd44',
      devops: '#ff66aa',
      product: '#aa66ff'
    };
    return roleColors[role as keyof typeof roleColors] || '#ffffff';
  }

  getCurrentAgent() {
    for (const team of this.stage.teams) {
      const agent = team.agents.find(a => a.id === this.stage.currentTurn);
      if (agent) {
        return agent;
      }
    }
    return null;
  }
}
