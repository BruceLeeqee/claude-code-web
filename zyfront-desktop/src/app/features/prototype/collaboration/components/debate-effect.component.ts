import { ChangeDetectionStrategy, Component, Input, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ParticleSystemService } from '../services/particle-system.service';

interface DebateMessage {
  id: string;
  agentId: string;
  agentName: string;
  role: string;
  content: string;
  timestamp: number;
  score: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

interface DebateState {
  messages: DebateMessage[];
  currentSpeaker: string;
  round: number;
  status: 'idle' | 'debating' | 'paused' | 'finished';
}

@Component({
  selector: 'app-debate-effect',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="debate-effect" #debateEffect>
      <!-- Debate messages -->
      <div class="debate-messages">
        <div 
          *ngFor="let message of debate.messages"
          class="debate-message"
          [class.debate-message-positive]="message.sentiment === 'positive'"
          [class.debate-message-negative]="message.sentiment === 'negative'"
          [class.debate-message-neutral]="message.sentiment === 'neutral'"
        >
          <div class="message-header">
            <span class="message-speaker">{{ message.agentName }} ({{ message.role }})</span>
            <span class="message-score" [class.score-positive]="message.sentiment === 'positive'" [class.score-negative]="message.sentiment === 'negative'">+{{ message.score }}</span>
          </div>
          <div class="message-content">{{ message.content }}</div>
          <div class="message-timestamp">{{ formatTime(message.timestamp) }}</div>
        </div>
      </div>

      <!-- Debate visualization -->
      <div class="debate-visualization">
        <div class="debate-arena">
          <div 
            *ngFor="let team of teams"
            class="debate-team"
            [class.team-active]="team.id === activeTeam"
          >
            <div class="team-name">{{ team.name }}</div>
            <div class="team-score">{{ team.score }}</div>
            <div class="team-agents">
              <div 
                *ngFor="let agent of team.agents"
                class="team-agent"
                [class.agent-active]="agent.id === debate.currentSpeaker"
                [class.agent-positive]="getAgentSentiment(agent.id) === 'positive'"
                [class.agent-negative]="getAgentSentiment(agent.id) === 'negative'"
              >
                <div class="agent-icon" [class.agent-icon-architect]="agent.role === 'architect'" [class.agent-icon-analyst]="agent.role === 'analyst'" [class.agent-icon-developer]="agent.role === 'developer'" [class.agent-icon-tester]="agent.role === 'tester'" [class.agent-icon-devops]="agent.role === 'devops'" [class.agent-icon-product]="agent.role === 'product'">
                  <div class="agent-eyes"></div>
                </div>
                <div class="agent-name">{{ agent.name }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Energy bar -->
        <div class="energy-bar">
          <div class="energy-fill" [style.width]="energyLevel + '%'" [class.energy-fill-positive]="energyLevel > 50" [class.energy-fill-negative]="energyLevel < 50"></div>
        </div>

        <!-- Round indicator -->
        <div class="round-indicator">
          <span class="round-label">ROUND</span>
          <span class="round-value">{{ debate.round }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .debate-effect {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
        background: #000000;
        border: 2px solid #333;
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.1);
      }
      
      .debate-messages {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .debate-message {
        padding: 12px;
        border: 1px solid #333;
        background: rgba(255, 255, 255, 0.05);
        border-left: 4px solid #888;
        transition: all 0.3s;
      }
      
      .debate-message:hover {
        box-shadow: 0 0 8px rgba(255, 255, 255, 0.1);
      }
      
      .debate-message-positive {
        border-left-color: #00ff00;
        background: rgba(0, 255, 0, 0.05);
      }
      
      .debate-message-negative {
        border-left-color: #ff4444;
        background: rgba(255, 68, 68, 0.05);
      }
      
      .debate-message-neutral {
        border-left-color: #ffdd00;
        background: rgba(255, 221, 0, 0.05);
      }
      
      .message-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      
      .message-speaker {
        font-family: 'VT323', monospace;
        color: #ccc;
        font-size: 14px;
        text-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
      }
      
      .message-score {
        font-family: 'Press Start 2P', cursive;
        font-size: 10px;
        color: #888;
      }
      
      .score-positive {
        color: #00ff00;
        text-shadow: 0 0 6px rgba(0, 255, 0, 0.8);
      }
      
      .score-negative {
        color: #ff4444;
        text-shadow: 0 0 6px rgba(255, 68, 68, 0.8);
      }
      
      .message-content {
        color: #aaa;
        font-size: 12px;
        line-height: 1.4;
        margin-bottom: 8px;
      }
      
      .message-timestamp {
        color: #666;
        font-size: 10px;
        text-align: right;
      }
      
      .debate-visualization {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .debate-arena {
        display: flex;
        justify-content: space-around;
        align-items: center;
        padding: 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid #333;
      }
      
      .debate-team {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 12px;
        border: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
        transition: all 0.3s;
      }
      
      .team-active {
        border-color: #ff00ff;
        background: rgba(255, 0, 255, 0.1);
        box-shadow: 0 0 12px rgba(255, 0, 255, 0.4);
      }
      
      .team-name {
        font-family: 'Press Start 2P', cursive;
        font-size: 10px;
        color: #888;
        text-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
      }
      
      .team-score {
        font-family: 'Press Start 2P', cursive;
        font-size: 16px;
        color: #fff;
        text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
      }
      
      .team-agents {
        display: flex;
        gap: 8px;
      }
      
      .team-agent {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 8px;
        border: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
        transition: all 0.3s;
      }
      
      .agent-active {
        border-color: #00ff00;
        background: rgba(0, 255, 0, 0.1);
        box-shadow: 0 0 8px rgba(0, 255, 0, 0.4);
      }
      
      .agent-positive {
        border-color: #00ff00;
        box-shadow: 0 0 6px rgba(0, 255, 0, 0.4);
      }
      
      .agent-negative {
        border-color: #ff4444;
        box-shadow: 0 0 6px rgba(255, 68, 68, 0.4);
      }
      
      .agent-icon {
        width: 32px;
        height: 32px;
        border: 2px solid;
        display: flex;
        align-items: center;
        justify-content: center;
        image-rendering: pixelated;
      }
      
      .agent-icon-architect {
        color: #ff4444;
        border-color: #ff4444;
        box-shadow: 0 0 6px rgba(255, 68, 68, 0.6);
      }
      
      .agent-icon-analyst {
        color: #4488ff;
        border-color: #4488ff;
        box-shadow: 0 0 6px rgba(68, 136, 255, 0.6);
      }
      
      .agent-icon-developer {
        color: #44ff88;
        border-color: #44ff88;
        box-shadow: 0 0 6px rgba(68, 255, 136, 0.6);
      }
      
      .agent-icon-tester {
        color: #ffdd44;
        border-color: #ffdd44;
        box-shadow: 0 0 6px rgba(255, 221, 68, 0.6);
      }
      
      .agent-icon-devops {
        color: #ff66aa;
        border-color: #ff66aa;
        box-shadow: 0 0 6px rgba(255, 102, 170, 0.6);
      }
      
      .agent-icon-product {
        color: #aa66ff;
        border-color: #aa66ff;
        box-shadow: 0 0 6px rgba(170, 102, 255, 0.6);
      }
      
      .agent-eyes {
        width: 12px;
        height: 6px;
        display: flex;
        gap: 3px;
      }
      
      .agent-eyes::before,
      .agent-eyes::after {
        content: '';
        width: 3px;
        height: 3px;
        background: #000;
        border-radius: 50%;
      }
      
      .agent-name {
        font-family: 'VT323', monospace;
        font-size: 10px;
        color: #ccc;
        text-align: center;
      }
      
      .energy-bar {
        height: 8px;
        background: #1a1a2e;
        border: 1px solid #333;
        overflow: hidden;
      }
      
      .energy-fill {
        height: 100%;
        background: linear-gradient(90deg, #ffdd00, #ffcc00);
        box-shadow: 0 0 6px rgba(255, 221, 0, 0.8);
        transition: width 0.5s ease;
      }
      
      .energy-fill-positive {
        background: linear-gradient(90deg, #00ff00, #44ff88);
        box-shadow: 0 0 8px rgba(0, 255, 0, 1);
      }
      
      .energy-fill-negative {
        background: linear-gradient(90deg, #ff4444, #ff6666);
        box-shadow: 0 0 8px rgba(255, 68, 68, 1);
      }
      
      .round-indicator {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 8px;
        background: rgba(255, 0, 255, 0.05);
        border: 1px solid #333;
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
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DebateEffectComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() debate!: DebateState;
  @ViewChild('debateEffect') debateEffect!: ElementRef<HTMLElement>;
  energyLevel = 50;
  teams = [
    {
      id: 'team-alpha',
      name: 'ALPHA',
      score: 0,
      agents: [
        { id: 'agent-1', name: 'Architect', role: 'architect' },
        { id: 'agent-2', name: 'Developer', role: 'developer' },
        { id: 'agent-5', name: 'DevOps', role: 'devops' }
      ]
    },
    {
      id: 'team-beta',
      name: 'BETA',
      score: 0,
      agents: [
        { id: 'agent-3', name: 'Analyst', role: 'analyst' },
        { id: 'agent-4', name: 'Tester', role: 'tester' },
        { id: 'agent-6', name: 'Product', role: 'product' }
      ]
    }
  ];
  activeTeam = 'team-alpha';
  private messageInterval: ReturnType<typeof setTimeout> | null = null;

  constructor(private particleSystem: ParticleSystemService) {}

  ngAfterViewInit() {
    if (this.debateEffect) {
      this.particleSystem.initialize(this.debateEffect.nativeElement);
    }
  }

  ngOnInit() {
    // Simulate debate messages
    this.simulateDebate();
  }

  ngOnDestroy() {
    if (this.messageInterval) {
      clearInterval(this.messageInterval);
    }
    this.particleSystem.destroy();
  }

  private simulateDebate() {
    const messages = [
      {
        agentId: 'agent-1',
        agentName: 'Architect',
        role: 'architect',
        content: '我认为我们应该采用微服务架构，这样可以提高系统的可扩展性和容错性。',
        sentiment: 'positive' as const
      },
      {
        agentId: 'agent-3',
        agentName: 'Analyst',
        role: 'analyst',
        content: '但微服务架构会增加系统的复杂性和运维成本，我们需要权衡利弊。',
        sentiment: 'negative' as const
      },
      {
        agentId: 'agent-2',
        agentName: 'Developer',
        role: 'developer',
        content: '我们可以使用容器化技术来简化微服务的部署和管理，降低运维成本。',
        sentiment: 'positive' as const
      },
      {
        agentId: 'agent-4',
        agentName: 'Tester',
        role: 'tester',
        content: '从测试角度来看，微服务架构会增加测试的复杂性，需要更多的集成测试。',
        sentiment: 'negative' as const
      },
      {
        agentId: 'agent-5',
        agentName: 'DevOps',
        role: 'devops',
        content: '我们可以使用CI/CD流水线来自动化测试和部署，减少人工干预。',
        sentiment: 'positive' as const
      },
      {
        agentId: 'agent-6',
        agentName: 'Product',
        role: 'product',
        content: '从产品角度来看，微服务架构可以让我们更快地迭代和部署新功能，提高用户满意度。',
        sentiment: 'positive' as const
      }
    ];

    let messageIndex = 0;
    this.messageInterval = setInterval(() => {
      if (messageIndex < messages.length) {
        const message = messages[messageIndex];
        const newMessage: DebateMessage = {
          id: `message-${Date.now()}`,
          ...message,
          timestamp: Date.now(),
          score: Math.floor(Math.random() * 50) + 10
        };

        // Add message to debate state
        this.debate.messages.push(newMessage);
        
        // Update energy level based on sentiment
        if (message.sentiment === 'positive') {
          this.energyLevel = Math.min(100, this.energyLevel + 10);
        } else if (message.sentiment === 'negative') {
          this.energyLevel = Math.max(0, this.energyLevel - 10);
        }

        // Update active team
        this.activeTeam = message.agentId.startsWith('agent-1') || message.agentId.startsWith('agent-2') || message.agentId.startsWith('agent-5') ? 'team-alpha' : 'team-beta';

        // Create debate effect
        this.createDebateEffect(message);

        messageIndex++;
      } else {
        if (this.messageInterval) {
          clearInterval(this.messageInterval);
        }
      }
    }, 3000);
  }

  private createDebateEffect(message: any) {
    if (!this.debateEffect) return;

    const element = this.debateEffect.nativeElement;
    const rect = element.getBoundingClientRect();
    const x = rect.width / 2;
    const y = rect.height / 2;

    // Create beam effect
    this.particleSystem.createBeam(
      x - 100, y,
      x + 100, y,
      message.sentiment === 'positive' ? '#00ff00' : message.sentiment === 'negative' ? '#ff4444' : '#ffdd00'
    );

    // Create score effect
    this.particleSystem.createScore(
      x, y - 50,
      message.score,
      message.sentiment === 'positive' ? '#00ff00' : message.sentiment === 'negative' ? '#ff4444' : '#ffdd00'
    );

    // Create spark effect
    this.particleSystem.createSpark(
      x, y,
      message.sentiment === 'positive' ? '#00ff00' : message.sentiment === 'negative' ? '#ff4444' : '#ffdd00'
    );
  }

  getAgentSentiment(agentId: string): 'positive' | 'negative' | 'neutral' {
    const agentMessages = this.debate.messages.filter(m => m.agentId === agentId);
    if (agentMessages.length === 0) return 'neutral';
    
    const lastMessage = agentMessages[agentMessages.length - 1];
    return lastMessage.sentiment;
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }
}
