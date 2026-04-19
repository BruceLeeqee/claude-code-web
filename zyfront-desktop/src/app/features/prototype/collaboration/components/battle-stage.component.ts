import { ChangeDetectionStrategy, Component, Input, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ParticleSystemService } from '../services/particle-system.service';
import { DebateService } from '../services/debate.service';
import { DebateState, DebateTeam, DebatePhase } from '../services/debate-mode.service';

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

// Agent role mapping
const AGENT_ROLE_MAP: Record<string, string> = {
  'agent-1': 'architect',
  'agent-2': 'developer',
  'agent-3': 'analyst',
  'agent-4': 'tester',
  'agent-5': 'devops',
  'agent-6': 'product',
  'judge-1': 'architect',
  'judge-2': 'analyst',
  'user-1': 'developer',
  'user-judge': 'analyst'
};

// Agent name mapping
const AGENT_NAME_MAP: Record<string, string> = {
  'agent-1': 'Architect',
  'agent-2': 'Developer',
  'agent-3': 'Analyst',
  'agent-4': 'Tester',
  'agent-5': 'DevOps',
  'agent-6': 'Product',
  'judge-1': 'Judge A',
  'judge-2': 'Judge B',
  'user-1': 'You',
  'user-judge': 'You (Judge)'
};

@Component({
  selector: 'app-battle-stage',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="battle-stage" [class.battle-stage-playing]="isPlaying()" [class.battle-stage-paused]="isPaused()" #battleStage>
      <!-- Scoreboard -->
      <div class="stage-scoreboard">
        <div class="team-score" *ngFor="let team of battleTeams">
          <span class="team-name" [class.team-name-affirmative]="team.role === 'affirmative'" [class.team-name-negative]="team.role === 'negative'">{{ team.name }}</span>
          <span class="team-value">{{ team.score.toFixed(1) }}</span>
        </div>
        <div class="round-info">
          <span class="round-label">{{ phaseLabel }}</span>
          <span class="round-value">{{ debateState.currentRound }} / {{ debateState.totalRounds }}</span>
        </div>
      </div>

      <!-- Grid Background -->
      <div class="stage-grid"></div>

      <!-- Agents -->
      <div class="stage-agents">
        <div 
          *ngFor="let team of battleTeams"
          class="team-agents"
        >
          <div 
            *ngFor="let agent of team.agents; let i = index"
            class="stage-agent"
            [class.stage-agent-active]="agent.id === currentSpeaker"
            [class.stage-agent-affirmative]="team.role === 'affirmative'"
            [class.stage-agent-negative]="team.role === 'negative'"
            [attr.data-agent-id]="agent.id"
            [style.left]="agent.position.x + '%'"
            [style.top]="agent.position.y + '%'"
            (click)="onAgentClick(agent)"
          >
            <div class="agent-body" 
              [class.agent-body-affirmative]="team.role === 'affirmative'"
              [class.agent-body-negative]="team.role === 'negative'"
            >
              <div class="agent-eyes"></div>
            </div>
            <div class="agent-name">{{ agent.name }}</div>
          </div>
        </div>
        
        <!-- Judge in center -->
        <div 
          *ngFor="let judge of judgeAgents; let i = index"
          class="stage-agent stage-agent-judge"
          [class.stage-agent-active]="judge.id === currentSpeaker"
          [attr.data-agent-id]="judge.id"
          [style.left]="judge.position.x + '%'"
          [style.top]="judge.position.y + '%'"
          (click)="onAgentClick(judge)"
        >
          <div class="agent-body agent-body-judge">
            <div class="agent-eyes"></div>
          </div>
          <div class="agent-name">{{ judge.name }}</div>
        </div>
      </div>

      <!-- Status Card -->
      <div class="status-card">
        <div class="status-title">{{ getStatusTitle() }}</div>
        <div class="status-progress">
          <div class="progress-bar" [style.width]="progress + '%'" [class.progress-bar-running]="isPlaying()" [class.progress-bar-paused]="isPaused()" [class.progress-bar-voting]="isVoting()"></div>
        </div>
        <div class="status-desc">{{ getStatusDescription() }}</div>
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
      
      .team-name-affirmative {
        color: #00ff00;
        text-shadow: 0 0 8px rgba(0, 255, 0, 0.6);
      }
      
      .team-name-negative {
        color: #ff4444;
        text-shadow: 0 0 8px rgba(255, 68, 68, 0.6);
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
        position: absolute;
        inset: 0;
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
      
      .agent-body-affirmative {
        color: #00ff88;
        border-color: #00ff88;
        background: rgba(0, 255, 136, 0.15);
        box-shadow: 0 0 12px rgba(0, 255, 136, 0.5);
      }
      
      .agent-body-negative {
        color: #ff4466;
        border-color: #ff4466;
        background: rgba(255, 68, 102, 0.15);
        box-shadow: 0 0 12px rgba(255, 68, 102, 0.5);
      }
      
      .stage-agent-affirmative .agent-name {
        color: #00ff88;
        text-shadow: 0 0 8px rgba(0, 255, 136, 0.6);
      }
      
      .stage-agent-negative .agent-name {
        color: #ff4466;
        text-shadow: 0 0 8px rgba(255, 68, 102, 0.6);
      }
      
      .stage-agent-affirmative.stage-agent-active .agent-body {
        transform: scale(1.15);
        box-shadow: 0 0 20px rgba(0, 255, 136, 0.8), 0 0 40px rgba(0, 255, 136, 0.4);
        animation: pulse-affirmative 1s infinite;
      }
      
      .stage-agent-negative.stage-agent-active .agent-body {
        transform: scale(1.15);
        box-shadow: 0 0 20px rgba(255, 68, 102, 0.8), 0 0 40px rgba(255, 68, 102, 0.4);
        animation: pulse-negative 1s infinite;
      }
      
      @keyframes pulse-affirmative {
        0%, 100% { box-shadow: 0 0 20px rgba(0, 255, 136, 0.8), 0 0 40px rgba(0, 255, 136, 0.4); }
        50% { box-shadow: 0 0 30px rgba(0, 255, 136, 1), 0 0 60px rgba(0, 255, 136, 0.6); }
      }
      
      @keyframes pulse-negative {
        0%, 100% { box-shadow: 0 0 20px rgba(255, 68, 102, 0.8), 0 0 40px rgba(255, 68, 102, 0.4); }
        50% { box-shadow: 0 0 30px rgba(255, 68, 102, 1), 0 0 60px rgba(255, 68, 102, 0.6); }
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
      
      .agent-body-judge {
        color: #ffdd00;
        border-color: #ffdd00;
        background: rgba(255, 221, 0, 0.2);
        box-shadow: 0 0 16px rgba(255, 221, 0, 0.6), 0 0 32px rgba(255, 221, 0, 0.3);
      }
      
      .stage-agent-judge {
        z-index: 20;
      }
      
      .stage-agent-judge .agent-body {
        width: 48px;
        height: 48px;
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
      
      .progress-bar-voting {
        background: linear-gradient(90deg, #ff4444, #ff6644);
        box-shadow: 0 0 8px rgba(255, 68, 68, 0.8);
        animation: progress-pulse 1.5s infinite;
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
  private previousArgumentCount = 0;
  private intervalId: any;

  constructor(private particleSystem: ParticleSystemService, private debateService: DebateService) {}

  get debateState(): DebateState {
    return this.debateService.getDebateState();
  }

  get battleTeams() {
    return this.debateState.teams.map((team, teamIndex) => {
      const isAffirmative = team.role === 'affirmative';
      const baseX = isAffirmative ? 20 : 80;
      
      return {
        id: team.id,
        name: team.name,
        role: team.role,
        score: team.score,
        agents: team.agentIds.map((agentId, agentIndex) => {
          const agentName = AGENT_NAME_MAP[agentId] || this.extractAgentName(agentId);
          const agentRole = AGENT_ROLE_MAP[agentId] || this.extractAgentRole(agentId);
          const yOffset = agentIndex === 0 ? 35 : 65;
          return {
            id: agentId,
            name: agentName,
            role: agentRole,
            teamRole: team.role,
            status: this.currentSpeaker === agentId ? 'active' : 'waiting',
            position: {
              x: baseX,
              y: yOffset
            }
          };
        })
      };
    });
  }

  get judgeAgents() {
    const judgeIds = this.debateState.judgeIds || [];
    return judgeIds.map((judgeId, index) => {
      const judgeName = AGENT_NAME_MAP[judgeId] || this.extractAgentName(judgeId);
      const judgeRole = AGENT_ROLE_MAP[judgeId] || 'product';
      return {
        id: judgeId,
        name: judgeName,
        role: judgeRole,
        teamRole: 'judge',
        status: this.currentSpeaker === judgeId ? 'active' : 'waiting',
        position: {
          x: 50,
          y: 50
        }
      };
    });
  }

  private extractAgentName(agentId: string): string {
    if (agentId.includes('architect')) return 'Architect';
    if (agentId.includes('analyst')) return 'Analyst';
    if (agentId.includes('developer')) return 'Developer';
    if (agentId.includes('tester')) return 'Tester';
    if (agentId.includes('devops')) return 'DevOps';
    if (agentId.includes('product')) return 'Product';
    if (agentId.includes('judge')) return 'Judge';
    const parts = agentId.split('-');
    return parts[parts.length - 1] || agentId;
  }

  private extractAgentRole(agentId: string): string {
    if (agentId.includes('architect')) return 'architect';
    if (agentId.includes('analyst')) return 'analyst';
    if (agentId.includes('developer')) return 'developer';
    if (agentId.includes('tester')) return 'tester';
    if (agentId.includes('devops')) return 'devops';
    if (agentId.includes('product')) return 'product';
    return 'developer';
  }

  get currentSpeaker(): string | null {
    return this.debateState.currentSpeaker;
  }

  get phaseLabel(): string {
    const phaseMap: Record<DebatePhase, string> = {
      preparation: 'PREPARE',
      opening: 'OPENING',
      main: 'MAIN',
      rebuttal: 'REBUTTAL',
      closing: 'CLOSING',
      voting: 'VOTING',
      result: 'RESULT'
    };
    return phaseMap[this.debateState.phase] || 'WAITING';
  }

  ngAfterViewInit() {
    if (this.battleStage) {
      this.particleSystem.initialize(this.battleStage.nativeElement);
    }
  }

  ngOnInit() {
    // Simulate thinking progress
    this.intervalId = setInterval(() => {
      this.progress = (this.progress + 3) % 100;
      
      // Check for new arguments
      if (this.debateState.arguments.length > this.previousArgumentCount) {
        this.createArgumentEffect();
        this.previousArgumentCount = this.debateState.arguments.length;
      }
      
      // Create spark effect when progress reaches 100%
      if (this.progress === 0 && this.isPlaying()) {
        this.createTurnEffect();
      }
    }, 200);
  }

  ngOnDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.particleSystem.destroy();
  }

  isPlaying(): boolean {
    return this.debateState.phase !== 'preparation' && 
           this.debateState.phase !== 'result' &&
           this.debateState.isActive;
  }

  isPaused(): boolean {
    return !this.debateState.isActive && 
           this.debateState.phase !== 'preparation' &&
           this.debateState.phase !== 'result';
  }

  isVoting(): boolean {
    return this.debateState.phase === 'voting';
  }

  onAgentClick(agent: any) {
    // Create explosion effect on agent click
    const agentElement = this.getAgentElement(agent);
    if (agentElement && this.battleStage) {
      const rect = agentElement.getBoundingClientRect();
      const stageRect = this.battleStage.nativeElement.getBoundingClientRect();
      const x = rect.left - stageRect.left + rect.width / 2;
      const y = rect.top - stageRect.top + rect.height / 2;
      
      this.particleSystem.createExplosion(x, y, this.getAgentColor(agent.teamRole));
    }
  }

  private createArgumentEffect() {
    const lastArgument = this.debateState.arguments[this.debateState.arguments.length - 1];
    if (lastArgument) {
      // Find the agent who made this argument
      let agentToHighlight: any = null;
      for (const team of this.battleTeams) {
        const agent = team.agents.find(a => a.id === lastArgument.agentId);
        if (agent) {
          agentToHighlight = agent;
          break;
        }
      }
      
      if (agentToHighlight) {
        const agentElement = this.getAgentElement(agentToHighlight);
        if (agentElement && this.battleStage) {
          const rect = agentElement.getBoundingClientRect();
          const stageRect = this.battleStage.nativeElement.getBoundingClientRect();
          const x = rect.left - stageRect.left + rect.width / 2;
          const y = rect.top - stageRect.top - 20;
          
          // Create score effect
          const score = lastArgument.scores.length > 0 ? 
            Math.round(lastArgument.scores.reduce((sum, s) => sum + s.score, 0) / lastArgument.scores.length) :
            Math.floor(Math.random() * 10) + 5;
          this.particleSystem.createScore(x, y, score);
        }
      }
    }
  }

  private createTurnEffect() {
    const currentSpeaker = this.currentSpeaker;
    if (currentSpeaker && currentSpeaker !== this.previousTurn) {
      // Find current agent
      let currentAgent: any = null;
      for (const team of this.battleTeams) {
        const agent = team.agents.find(a => a.id === currentSpeaker);
        if (agent) {
          currentAgent = agent;
          break;
        }
      }
      
      if (currentAgent) {
        // Create beam effect between previous and current agent
        if (this.previousTurn) {
          let previousAgent: any = null;
          for (const team of this.battleTeams) {
            const agent = team.agents.find(a => a.id === this.previousTurn);
            if (agent) {
              previousAgent = agent;
              break;
            }
          }
          
          if (previousAgent) {
            this.createBeamEffect(previousAgent, currentAgent);
          }
        }
        
        // Create spark effect for current agent
        const agentElement = this.getAgentElement(currentAgent);
        if (agentElement && this.battleStage) {
          const rect = agentElement.getBoundingClientRect();
          const stageRect = this.battleStage.nativeElement.getBoundingClientRect();
          const x = rect.left - stageRect.left + rect.width / 2;
          const y = rect.top - stageRect.top + rect.height / 2;
          
          this.particleSystem.createExplosion(x, y, this.getAgentColor(currentAgent.teamRole));
        }
      }
      
      this.previousTurn = currentSpeaker;
    }
  }

  private createBeamEffect(fromAgent: any, toAgent: any) {
    const fromElement = this.getAgentElement(fromAgent);
    const toElement = this.getAgentElement(toAgent);
    
    if (fromElement && toElement && this.battleStage) {
      const fromRect = fromElement.getBoundingClientRect();
      const toRect = toElement.getBoundingClientRect();
      const stageRect = this.battleStage.nativeElement.getBoundingClientRect();
      
      const fromX = fromRect.left - stageRect.left + fromRect.width / 2;
      const fromY = fromRect.top - stageRect.top + fromRect.height / 2;
      const toX = toRect.left - stageRect.left + toRect.width / 2;
      const toY = toRect.top - stageRect.top + toRect.height / 2;
      
      this.particleSystem.createBeam(fromX, fromY, toX, toY, this.getAgentColor(toAgent.teamRole));
    }
  }

  private getAgentElement(agent: any): HTMLElement | null {
    const element = document.querySelector(`.stage-agent[data-agent-id="${agent.id}"]`);
    return element as HTMLElement | null;
  }

  private getAgentColor(teamRole: string): string {
    const teamColors = {
      affirmative: '#00ff88',
      negative: '#ff4466',
      judge: '#ffdd00'
    };
    return teamColors[teamRole as keyof typeof teamColors] || '#ffffff';
  }

  getStatusTitle(): string {
    if (this.debateState.phase === 'preparation') {
      return 'WAITING TO START...';
    } else if (this.debateState.phase === 'result') {
      return 'DEBATE CONCLUDED';
    } else if (this.debateState.phase === 'voting') {
      return 'JUDGES VOTING...';
    } else if (this.currentSpeaker) {
      const agent = this.findAgentById(this.currentSpeaker);
      return `${agent?.name || this.currentSpeaker} (${agent?.role || 'unknown'}) THINKING...`;
    } else {
      return 'DEBATE IN PROGRESS...';
    }
  }

  getStatusDescription(): string {
    if (this.debateState.phase === 'preparation') {
      return 'Select a debate topic and team configuration';
    } else if (this.debateState.phase === 'result') {
      const result = this.debateState.result;
      return result ? `Winner: ${this.getTeamName(result.winningTeamId)}` : 'Results pending...';
    } else if (this.debateState.phase === 'voting') {
      return `Votes cast: ${this.debateState.votes.length} / ${this.debateState.judgeIds.length}`;
    } else if (this.debateState.arguments.length > 0) {
      const lastArg = this.debateState.arguments[this.debateState.arguments.length - 1];
      return lastArg.content.length > 40 ? lastArg.content.substring(0, 40) + '...' : lastArg.content;
    } else {
      return 'First argument being crafted...';
    }
  }

  private findAgentById(agentId: string): any {
    for (const team of this.battleTeams) {
      const agent = team.agents.find(a => a.id === agentId);
      if (agent) {
        return agent;
      }
    }
    return null;
  }

  private getTeamName(teamId: string): string {
    const team = this.debateState.teams.find(t => t.id === teamId);
    return team?.name || teamId;
  }
}
