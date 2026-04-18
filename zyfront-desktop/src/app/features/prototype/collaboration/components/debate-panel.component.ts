import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DebateService } from '../services/debate.service';
import { DebateEffectComponent } from './debate-effect.component';

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
  selector: 'app-debate-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, DebateEffectComponent],
  template: `
    <div class="debate-panel">
      <div class="panel-header panel-header-pink">
        <span class="panel-title">对抗辩论</span>
        <span class="panel-subtitle">DEBATE ARENA</span>
      </div>

      @if (currentDebate.status === 'idle') {
        <div class="debate-setup">
          <div class="setup-header">选择辩论主题</div>
          <div class="topic-list">
            <div 
              *ngFor="let topic of debateTopics" 
              class="topic-item"
              (click)="selectTopic(topic)"
              [class.topic-selected]="selectedTopic?.id === topic.id"
            >
              <div class="topic-title">{{ topic.title }}</div>
              <div class="topic-description">{{ topic.description }}</div>
              <div class="topic-sides">
                <div class="side-item">
                  <span class="side-name">正方:</span>
                  <span class="side-description">{{ topic.sides[0].description }}</span>
                </div>
                <div class="side-item">
                  <span class="side-name">反方:</span>
                  <span class="side-description">{{ topic.sides[1].description }}</span>
                </div>
              </div>
            </div>
          </div>
          <button 
            class="start-debate-btn"
            [disabled]="!selectedTopic"
            (click)="startDebate()"
          >
            开始辩论
          </button>
        </div>
      } @else {
        <app-debate-effect [debate]="currentDebate"></app-debate-effect>
        
        <div class="debate-input">
          <textarea 
            class="speech-input"
            placeholder="输入你的观点..."
            [(ngModel)]="speechInput"
          ></textarea>
          <button 
            class="submit-speech-btn"
            [disabled]="!speechInput.trim()"
            (click)="submitSpeech()"
          >
            提交观点
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .debate-panel {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      
      .debate-setup {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
      }
      
      .setup-header {
        font-family: 'Press Start 2P', cursive;
        color: #ff00ff;
        font-size: 12px;
        text-align: center;
        margin-bottom: 8px;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .topic-list {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
      }
      
      .topic-item {
        border: 2px solid #333;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s;
        background: rgba(255, 0, 255, 0.05);
      }
      
      .topic-item:hover {
        border-color: #ff00ff;
        box-shadow: 0 0 12px rgba(255, 0, 255, 0.4);
      }
      
      .topic-selected {
        border-color: #ff00ff;
        background: rgba(255, 0, 255, 0.15);
        box-shadow: 0 0 12px rgba(255, 0, 255, 0.6);
      }
      
      .topic-title {
        font-family: 'VT323', monospace;
        color: #ff00ff;
        font-size: 14px;
        margin-bottom: 4px;
        text-shadow: 0 0 6px rgba(255, 0, 255, 0.8);
      }
      
      .topic-description {
        color: #ccc;
        font-size: 12px;
        margin-bottom: 8px;
        line-height: 1.4;
      }
      
      .topic-sides {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .side-item {
        display: flex;
        gap: 8px;
      }
      
      .side-name {
        color: #888;
        font-size: 11px;
        min-width: 60px;
      }
      
      .side-description {
        color: #aaa;
        font-size: 11px;
        flex: 1;
      }
      
      .start-debate-btn {
        height: 40px;
        border: 2px solid #ff00ff;
        background: rgba(255, 0, 255, 0.2);
        color: #ff00ff;
        font-family: 'VT323', monospace;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .start-debate-btn:hover:not(:disabled) {
        background: rgba(255, 0, 255, 0.3);
        box-shadow: 0 0 16px rgba(255, 0, 255, 0.6);
      }
      
      .start-debate-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .debate-active {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
        overflow-y: auto;
      }
      
      .debate-topic {
        border-bottom: 1px solid #333;
        padding-bottom: 12px;
      }
      
      .debate-round {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px;
        background: rgba(255, 0, 255, 0.1);
        border: 1px solid #333;
      }
      
      .round-label {
        font-family: 'Press Start 2P', cursive;
        color: #ff00ff;
        font-size: 10px;
        text-shadow: 0 0 6px rgba(255, 0, 255, 0.8);
      }
      
      .round-status {
        color: #00ff00;
        font-size: 12px;
        text-shadow: 0 0 6px rgba(0, 255, 0, 0.8);
      }
      
      .debate-speeches {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
      }
      
      .speech-item {
        border: 1px solid #333;
        padding: 12px;
        background: rgba(0, 0, 0, 0.5);
      }
      
      .speech-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      
      .speaker-name {
        font-family: 'VT323', monospace;
        color: #ff00ff;
        font-size: 12px;
        text-shadow: 0 0 6px rgba(255, 0, 255, 0.8);
      }
      
      .speech-time {
        color: #888;
        font-size: 10px;
      }
      
      .speech-content {
        color: #ccc;
        font-size: 12px;
        line-height: 1.4;
        margin-bottom: 8px;
      }
      
      .speech-actions {
        display: flex;
        gap: 8px;
      }
      
      .vote-btn {
        width: 24px;
        height: 24px;
        border: 2px solid #333;
        background: #000;
        color: #888;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .vote-btn:hover {
        border-color: #ff00ff;
        color: #ff00ff;
        box-shadow: 0 0 8px rgba(255, 0, 255, 0.4);
      }
      
      .vote-agree:hover {
        border-color: #00ff00;
        color: #00ff00;
        box-shadow: 0 0 8px rgba(0, 255, 0, 0.4);
      }
      
      .vote-disagree:hover {
        border-color: #ff4444;
        color: #ff4444;
        box-shadow: 0 0 8px rgba(255, 68, 68, 0.4);
      }
      
      .debate-input {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      
      .speech-input {
        flex: 1;
        min-height: 80px;
        padding: 8px;
        border: 2px solid #333;
        background: #000;
        color: #ccc;
        font-family: 'VT323', monospace;
        font-size: 12px;
        resize: vertical;
      }
      
      .speech-input:focus {
        outline: none;
        border-color: #ff00ff;
        box-shadow: 0 0 12px rgba(255, 0, 255, 0.4);
      }
      
      .submit-speech-btn {
        height: 80px;
        padding: 0 16px;
        border: 2px solid #ff00ff;
        background: rgba(255, 0, 255, 0.2);
        color: #ff00ff;
        font-family: 'VT323', monospace;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .submit-speech-btn:hover:not(:disabled) {
        background: rgba(255, 0, 255, 0.3);
        box-shadow: 0 0 16px rgba(255, 0, 255, 0.6);
      }
      
      .submit-speech-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DebatePanelComponent implements OnInit {
  debateTopics: DebateTopic[] = [];
  selectedTopic: DebateTopic | null = null;
  currentDebate: DebateState = {
    messages: [],
    currentSpeaker: '',
    round: 1,
    status: 'idle'
  };
  speechInput = '';

  constructor(private debateService: DebateService) {}

  ngOnInit() {
    this.debateTopics = this.debateService.getMockDebateTopics();
    const debate = this.debateService.getCurrentDebate();
    if (debate) {
      // Convert DebateRound to DebateState
      this.currentDebate = {
        messages: debate.speakers.map(speaker => ({
          id: speaker.timestamp.toString(),
          agentId: speaker.agentId,
          agentName: this.getAgentName(speaker.agentId),
          role: 'unknown',
          content: speaker.speech,
          timestamp: speaker.timestamp,
          score: 0,
          sentiment: 'neutral'
        })),
        currentSpeaker: debate.speakers.length > 0 ? debate.speakers[debate.speakers.length - 1].agentId : '',
        round: debate.roundNumber || 1,
        status: debate.status === 'completed' ? 'finished' : debate.status === 'in_progress' ? 'debating' : 'idle'
      };
    }
  }

  selectTopic(topic: any) {
    this.selectedTopic = topic;
  }

  startDebate() {
    if (this.selectedTopic) {
      this.debateService.startDebate(this.selectedTopic);
      const debate = this.debateService.getCurrentDebate();
      if (debate) {
        // Convert DebateRound to DebateState
        this.currentDebate = {
          messages: debate.speakers.map(speaker => ({
            id: speaker.timestamp.toString(),
            agentId: speaker.agentId,
            agentName: this.getAgentName(speaker.agentId),
            role: 'unknown',
            content: speaker.speech,
            timestamp: speaker.timestamp,
            score: 0,
            sentiment: 'neutral'
          })),
          currentSpeaker: debate.speakers.length > 0 ? debate.speakers[debate.speakers.length - 1].agentId : '',
          round: debate.roundNumber || 1,
          status: debate.status === 'completed' ? 'finished' : debate.status === 'in_progress' ? 'debating' : 'idle'
        };
      } else {
        // Start a mock debate
        this.currentDebate = {
          messages: [],
          currentSpeaker: 'agent-1',
          round: 1,
          status: 'debating'
        };
      }
    }
  }

  submitSpeech() {
    if (this.speechInput.trim()) {
      // For demo purposes, we'll submit the speech as the current user
      this.debateService.submitSpeech('user-1', this.speechInput);
      
      // Add the speech to the current debate state
      const newMessage: DebateMessage = {
        id: `message-${Date.now()}`,
        agentId: 'user-1',
        agentName: 'You',
        role: 'user',
        content: this.speechInput,
        timestamp: Date.now(),
        score: Math.floor(Math.random() * 50) + 10,
        sentiment: 'neutral'
      };
      this.currentDebate.messages.push(newMessage);
      this.speechInput = '';
    }
  }

  voteOnSpeech(speech: any, vote: 'agree' | 'disagree' | 'neutral') {
    this.debateService.voteOnSpeech(speech.id || speech.timestamp.toString(), vote);
  }

  getStatusText(status: string): string {
    const statusMap = {
      idle: '待开始',
      debating: '进行中',
      paused: '已暂停',
      finished: '已完成'
    };
    return statusMap[status as keyof typeof statusMap] || status;
  }

  getAgentName(agentId: string): string {
    const agentMap = {
      'agent-1': 'Architect',
      'agent-2': 'Developer',
      'agent-3': 'Analyst',
      'agent-4': 'Tester',
      'agent-5': 'DevOps',
      'agent-6': 'Product',
      'user-1': 'You'
    };
    return agentMap[agentId as keyof typeof agentMap] || agentId;
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }
}
