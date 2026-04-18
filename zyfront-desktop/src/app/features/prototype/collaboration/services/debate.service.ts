import { Injectable } from '@angular/core';
import { MultiAgentWebSocketService } from '../../../../core/multi-agent/multi-agent.websocket.service';

interface DebateTopic {
  id: string;
  title: string;
  description: string;
  sides: {
    id: string;
    name: string;
    description: string;
  }[];
}

interface DebateRound {
  id: string;
  roundNumber: number;
  topic: DebateTopic;
  speakers: {
    agentId: string;
    sideId: string;
    speech: string;
    timestamp: number;
  }[];
  status: 'pending' | 'in_progress' | 'completed';
}

@Injectable({ providedIn: 'root' })
export class DebateService {
  private currentDebate: DebateRound | null = null;
  private debateHistory: DebateRound[] = [];

  constructor(private webSocketService: MultiAgentWebSocketService) {
    // Subscribe to WebSocket messages for debate updates
    this.webSocketService.messages$.subscribe(message => {
      this.handleDebateMessage(message);
    });
  }

  startDebate(topic: DebateTopic): void {
    this.webSocketService.send({
      type: 'START_DEBATE',
      data: {
        topic,
        agents: [
          { id: 'agent-1', role: 'architect' },
          { id: 'agent-2', role: 'developer' }
        ]
      }
    });
  }

  submitSpeech(agentId: string, speech: string): void {
    this.webSocketService.send({
      type: 'SUBMIT_SPEECH',
      data: {
        debateId: this.currentDebate?.id,
        agentId,
        speech,
        timestamp: Date.now()
      }
    });
  }

  voteOnSpeech(speechId: string, vote: 'agree' | 'disagree' | 'neutral'): void {
    this.webSocketService.send({
      type: 'VOTE_ON_SPEECH',
      data: {
        speechId,
        vote,
        timestamp: Date.now()
      }
    });
  }

  getCurrentDebate(): DebateRound | null {
    return this.currentDebate;
  }

  getDebateHistory(): DebateRound[] {
    return this.debateHistory;
  }

  private handleDebateMessage(message: any): void {
    switch (message.type) {
      case 'DEBATE_STARTED':
        this.currentDebate = message.data;
        this.debateHistory.push(message.data);
        break;
      case 'DEBATE_UPDATED':
        if (this.currentDebate && message.data.id === this.currentDebate.id) {
          this.currentDebate = message.data;
        }
        break;
      case 'DEBATE_COMPLETED':
        if (this.currentDebate && message.data.id === this.currentDebate.id) {
          this.currentDebate = { ...this.currentDebate, status: 'completed' };
        }
        break;
      case 'SPEECH_SUBMITTED':
        if (this.currentDebate) {
          this.currentDebate.speakers.push(message.data);
        }
        break;
      case 'VOTE_RECORDED':
        // Handle vote recording
        break;
    }
  }

  // Mock debate topics for testing
  getMockDebateTopics(): DebateTopic[] {
    return [
      {
        id: 'topic-1',
        title: 'Should AI be given legal personhood?',
        description: 'Discuss the implications of granting legal personhood to artificial intelligence systems.',
        sides: [
          {
            id: 'side-1',
            name: 'Pro',
            description: 'AI should be granted legal personhood to recognize their contributions and responsibilities.'
          },
          {
            id: 'side-2',
            name: 'Con',
            description: 'AI should not be granted legal personhood as they lack consciousness and moral agency.'
          }
        ]
      },
      {
        id: 'topic-2',
        title: 'Is remote work better than office work?',
        description: 'Compare the benefits and drawbacks of remote work versus traditional office work.',
        sides: [
          {
            id: 'side-1',
            name: 'Remote Work',
            description: 'Remote work offers more flexibility and work-life balance.'
          },
          {
            id: 'side-2',
            name: 'Office Work',
            description: 'Office work provides better collaboration and team cohesion.'
          }
        ]
      }
    ];
  }
}
