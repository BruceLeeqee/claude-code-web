import { ChangeDetectionStrategy, Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgentNodeComponent } from './components/agent-node.component';
import { BattleStageComponent } from './components/battle-stage.component';
import { DebatePanelComponent } from './components/debate-panel.component';
import { ModeSelectorComponent } from './components/mode-selector.component';
import { NetworkGraphComponent } from './components/network-graph.component';
import { TimelineComponent } from './components/timeline.component';
import { SankeyDiagramComponent } from './components/sankey-diagram.component';
import { SharedWorkspaceComponent } from './components/shared-workspace.component';
import { MultiAgentWebSocketService } from '../../../core/multi-agent/multi-agent.websocket.service';
import { Subscription } from 'rxjs';

type ViewType = 'arena' | 'network' | 'cognitive' | 'monitor';

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [CommonModule, AgentNodeComponent, BattleStageComponent, DebatePanelComponent, ModeSelectorComponent, NetworkGraphComponent, TimelineComponent, SankeyDiagramComponent, SharedWorkspaceComponent],
  templateUrl: './collaboration.page.html',
  styleUrls: ['../prototype-page.scss', './collaboration.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent implements OnInit, OnDestroy {
  protected readonly activeTab = signal<ViewType>('arena');

  // Mock data for BattleStage
  protected battleStageData = {
    teams: [
      {
        id: 'team-alpha',
        name: 'TEAM ALPHA',
        score: 42850,
        agents: [
          {
            id: 'agent-1',
            name: 'Architect',
            role: 'architect',
            status: 'running',
            position: { x: 25, y: 30 }
          },
          {
            id: 'agent-2',
            name: 'Developer',
            role: 'developer',
            status: 'busy',
            position: { x: 35, y: 60 }
          },
          {
            id: 'agent-5',
            name: 'DevOps',
            role: 'devops',
            status: 'idle',
            position: { x: 20, y: 80 }
          }
        ]
      },
      {
        id: 'team-beta',
        name: 'TEAM BETA',
        score: 38120,
        agents: [
          {
            id: 'agent-3',
            name: 'Analyst',
            role: 'analyst',
            status: 'idle',
            position: { x: 75, y: 30 }
          },
          {
            id: 'agent-4',
            name: 'Tester',
            role: 'tester',
            status: 'running',
            position: { x: 65, y: 60 }
          },
          {
            id: 'agent-6',
            name: 'Product',
            role: 'product',
            status: 'busy',
            position: { x: 80, y: 80 }
          }
        ]
      }
    ],
    currentTurn: 'agent-1',
    round: 3,
    status: 'playing' as const
  };

  // Mock data for AgentNode
  protected agents = [
    {
      id: 'agent-1',
      name: 'Architect',
      role: 'architect' as const,
      status: 'running' as const,
      load: 15,
      skills: ['System Design', 'Architecture']
    },
    {
      id: 'agent-2',
      name: 'Analyst',
      role: 'analyst' as const,
      status: 'idle' as const,
      load: 12,
      skills: ['Data Analysis', 'Market Research']
    },
    {
      id: 'agent-3',
      name: 'Developer',
      role: 'developer' as const,
      status: 'busy' as const,
      load: 28,
      skills: ['JavaScript', 'Python', 'React']
    },
    {
      id: 'agent-4',
      name: 'Tester',
      role: 'tester' as const,
      status: 'idle' as const,
      load: 18,
      skills: ['Test Automation', 'Quality Assurance']
    },
    {
      id: 'agent-5',
      name: 'DevOps',
      role: 'devops' as const,
      status: 'idle' as const,
      load: 10,
      skills: ['CI/CD', 'Infrastructure', 'Monitoring']
    },
    {
      id: 'agent-6',
      name: 'Product',
      role: 'product' as const,
      status: 'busy' as const,
      load: 22,
      skills: ['Product Management', 'User Experience', 'Agile']
    }
  ];

  private webSocketSubscription: Subscription | null = null;

  constructor(private webSocketService: MultiAgentWebSocketService) {}

  protected switchTab(tab: ViewType): void {
    this.activeTab.set(tab);
  }

  // Interaction control
  protected isPlaying = false;
  protected speed = 1;
  protected speeds = [1, 2, 4, 8];

  protected togglePlay(): void {
    this.isPlaying = !this.isPlaying;
  }

  protected setSpeed(newSpeed: number): void {
    this.speed = newSpeed;
  }

  protected resetGame(): void {
    // Reset game logic
    console.log('Game reset');
  }

  protected handleKeyDown(event: KeyboardEvent): void {
    switch (event.key.toLowerCase()) {
      case 'p':
        this.togglePlay();
        break;
      case 'r':
        this.resetGame();
        break;
      case 'm':
        // Toggle mode
        console.log('Toggle mode');
        break;
      case 'tab':
        // Cycle through tabs
        event.preventDefault();
        const currentTab = this.activeTab();
        const tabs: ViewType[] = ['arena', 'network', 'cognitive', 'monitor'];
        const currentIndex = tabs.indexOf(currentTab);
        const nextIndex = (currentIndex + 1) % tabs.length;
        this.switchTab(tabs[nextIndex]);
        break;
    }
  }

  ngOnInit() {
    // Add keyboard event listener
    window.addEventListener('keydown', this.handleKeyDown.bind(this));

    try {
      // Connect to WebSocket
      this.webSocketService.connect();

      // Subscribe to WebSocket messages
      this.webSocketSubscription = this.webSocketService.messages$.subscribe(message => {
        this.handleWebSocketMessage(message);
      });

      // Send initial message to server
      this.webSocketService.send({
        type: 'JOIN_ARENA',
        data: {
          userId: 'user-1',
          arenaId: 'arena-1'
        }
      });
    } catch (error) {
      console.error('Error initializing WebSocket:', error);
      // Continue initialization even if WebSocket fails
    }
  }

  ngOnDestroy() {
    // Remove keyboard event listener
    window.removeEventListener('keydown', this.handleKeyDown.bind(this));

    // Disconnect WebSocket
    if (this.webSocketSubscription) {
      this.webSocketSubscription.unsubscribe();
      this.webSocketSubscription = null;
    }
    this.webSocketService.disconnect();
  }

  private handleWebSocketMessage(message: any) {
    switch (message.type) {
      case 'AGENT_STATUS_UPDATE':
        this.updateAgentStatus(message.data);
        break;
      case 'BATTLE_STATE_UPDATE':
        this.updateBattleState(message.data);
        break;
      case 'ROUND_CHANGE':
        this.updateRound(message.data);
        break;
      case 'SCORE_UPDATE':
        this.updateScore(message.data);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  private updateAgentStatus(data: any) {
    const { agentId, status, load } = data;
    // Update agent status in both battleStageData and agents array
    for (const team of this.battleStageData.teams) {
      const agent = team.agents.find(a => a.id === agentId);
      if (agent) {
        agent.status = status;
      }
    }
    const agent = this.agents.find(a => a.id === agentId);
    if (agent) {
      agent.status = status as any;
      agent.load = load;
    }
  }

  private updateBattleState(data: any) {
    this.battleStageData = { ...this.battleStageData, ...data };
  }

  private updateRound(data: any) {
    this.battleStageData.round = data.round;
  }

  private updateScore(data: any) {
    const { teamId, score } = data;
    const team = this.battleStageData.teams.find(t => t.id === teamId);
    if (team) {
      team.score = score;
    }
  }
}
