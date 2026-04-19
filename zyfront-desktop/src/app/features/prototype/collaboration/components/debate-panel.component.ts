import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DebateService, DebateTopic } from '../services/debate.service';
import { DebateState, DebatePhase, DebateArgument } from '../services/debate-mode.service';
import { DEBATE_TOPIC_MOCKS } from '../services/debate-orchestration.mock';
import { CollaborationStateService } from '../services/collaboration-state.service';
import { DebateTopicBridgeService } from '../services/debate-topic-bridge.service';
import { DebateAgentService, DebateAgent } from '../services/debate-agent.service';
import { MultiAgentOrchestratorService } from '../../../../core/multi-agent/multi-agent.orchestrator.service';
import type { TeammateSpawnResult, TeammateMode } from '../../../../core/multi-agent/multi-agent.types';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-debate-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="debate-panel">
      <div class="panel-header panel-header-pink">
        <span class="panel-title">对抗辩论</span>
        <span class="panel-subtitle">DEBATE ARENA</span>
      </div>

      @if (debateState.phase === 'preparation') {
        <div class="debate-setup">
          <div class="setup-header">辩论准备阶段</div>
          
          <div class="setup-section">
            <div class="section-label">选择辩论主题</div>
            <button class="add-topic-btn" (click)="toggleAddTopicForm()">
              {{ showAddTopicForm ? '取消添加' : '+ 添加自定义主题' }}
            </button>
            
            @if (showAddTopicForm) {
              <div class="custom-topic-form">
                <div class="form-group">
                  <label>辩论主题</label>
                  <input type="text" [(ngModel)]="newTopicTitle" placeholder="输入辩论主题">
                </div>
                <div class="form-group">
                  <label>主题描述</label>
                  <textarea [(ngModel)]="newTopicDescription" placeholder="输入主题描述"></textarea>
                </div>
                <div class="form-group">
                  <label>正方观点</label>
                  <textarea [(ngModel)]="newAffirmativeDescription" placeholder="输入正方观点"></textarea>
                </div>
                <div class="form-group">
                  <label>反方观点</label>
                  <textarea [(ngModel)]="newNegativeDescription" placeholder="输入反方观点"></textarea>
                </div>
                <button class="submit-topic-btn" (click)="addCustomTopic()">确认添加</button>
              </div>
            }
            
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
          </div>

          <div class="setup-section">
            <div class="section-label">配置轮数: {{ config.totalRounds }}</div>
            <input 
              type="range" 
              [min]="1" 
              [max]="10" 
              [(ngModel)]="config.totalRounds"
            >
          </div>

          <div class="setup-section">
            <div class="section-label">辩论配置</div>
            <div class="config-options">
              <label>
                <input type="checkbox" [(ngModel)]="config.requireUnanimous">
                需要一致裁决
              </label>
            </div>
          </div>

          <div class="setup-section">
            <div class="section-label">团队配置</div>
            <div class="team-config">
              <div class="team-half">
                <div class="team-title team-affirmative">正方团队</div>
                <select multiple [(ngModel)]="affirmativeAgents" class="agent-select">
                  <option *ngFor="let agent of availableAgents" [value]="agent.id">{{ agent.name }}</option>
                </select>
              </div>
              <div class="team-half">
                <div class="team-title team-negative">反方团队</div>
                <select multiple [(ngModel)]="negativeAgents" class="agent-select">
                  <option *ngFor="let agent of availableAgents" [value]="agent.id">{{ agent.name }}</option>
                </select>
              </div>
            </div>
          </div>

          <button 
            class="start-debate-btn"
            [disabled]="!selectedTopic || affirmativeAgents.length === 0 || negativeAgents.length === 0"
            (click)="startDebate()"
          >
            开始辩论
          </button>
        </div>
      } @else if (debateState.phase === 'result') {
        <div class="debate-result">
          <div class="result-header">🏆 辩论结束 🏆</div>
          @if (debateState.result) {
            <div class="winner-announcement">
              <div class="winner-label">获胜方</div>
              <div class="winner-name">{{ getTeamName(debateState.result.winningTeamId) }}</div>
              <div class="winner-score">{{ debateState.result.finalScores[debateState.result.winningTeamId]?.toFixed(1) || '0' }} 分</div>
            </div>
            <div class="score-display">
              <div class="score-item" *ngFor="let team of debateState.teams">
                <span class="team-name">{{ team.name }}</span>
                <span class="team-score">{{ team.score.toFixed(1) }} 分</span>
              </div>
            </div>
            <div class="summary-display">
              <div class="summary-label">辩论总结</div>
              <div class="summary-text">{{ debateState.result.summary }}</div>
            </div>
            <div class="judge-comments">
              <div class="comments-label">裁判点评</div>
              <div class="comment-item" *ngFor="let comment of debateState.result.judgeComments">
                {{ comment }}
              </div>
            </div>
            <div class="winner-arguments" *ngIf="getWinnerArguments().length > 0">
              <div class="winner-args-title">获胜方精彩观点</div>
              <div class="winner-arg" *ngFor="let arg of getWinnerArguments().slice(0, 3)">
                <div class="arg-phase">{{ getPhaseLabel(arg.phase) }}</div>
                <div class="arg-content">{{ arg.content }}</div>
              </div>
            </div>
          }
          <button class="reset-debate-btn" (click)="resetDebate()">重新开始</button>
        </div>
      } @else {
        <div class="debate-active">
          <div class="debate-topic">
            <div class="topic-title">{{ debateConfig.topic }}</div>
            <div class="topic-info">
              <span class="round-info">第 {{ debateState.currentRound }} / {{ debateState.totalRounds }} 轮</span>
              <span class="phase-info" [class.phase-voting]="debateState.phase === 'voting'">{{ phaseLabel }}</span>
            </div>
          </div>

          <div class="team-scores">
            <div class="score-card" *ngFor="let team of debateState.teams" [class.current-team]="currentTeam?.id === team.id">
              <div class="team-name" [class.affirmative]="team.role === 'affirmative'" [class.negative]="team.role === 'negative'">
                {{ team.name }}
              </div>
              <div class="team-score">{{ team.score.toFixed(1) }}</div>
            </div>
          </div>

          <div class="debate-arguments">
            <div class="argument-item" *ngFor="let arg of debateState.arguments" [class.rebuttal]="arg.isRebuttal">
              <div class="argument-header">
                <span class="agent-name">{{ getAgentName(arg.agentId) }}</span>
                <span class="agent-team">{{ getTeamName(arg.teamId) }}</span>
                <span class="argument-time">{{ arg.timestamp | date: 'HH:mm:ss' }}</span>
              </div>
              <div class="argument-content">{{ arg.content }}</div>
              @if (arg.scores.length > 0) {
                <div class="argument-scores">
                  <div class="score-badge" *ngFor="let score of arg.scores">
                    {{ score.score }}/10 - {{ score.feedback }}
                  </div>
                </div>
              }
            </div>
          </div>

          <div class="debate-controls">
            <button class="next-speaker-btn" (click)="nextSpeaker()">下一位发言者</button>
            <button class="next-phase-btn" (click)="nextPhase()">下一阶段</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
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
      overflow-y: auto;
    }
    
    .setup-header {
      font-family: 'Press Start 2P', cursive;
      color: #ff00ff;
      font-size: 12px;
      text-align: center;
      margin-bottom: 8px;
      text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
    }
    
    .setup-section {
      border: 1px solid #333;
      padding: 12px;
    }
    
    .section-label {
      font-family: 'VT323', monospace;
      color: #ff00ff;
      font-size: 12px;
      margin-bottom: 8px;
    }
    
    .add-topic-btn {
      width: 100%;
      padding: 8px;
      margin-bottom: 12px;
      border: 1px dashed #ff00ff;
      background: transparent;
      color: #ff00ff;
      font-family: 'VT323', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .add-topic-btn:hover {
      background: rgba(255, 0, 255, 0.1);
      border-style: solid;
    }
    
    .custom-topic-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
      margin-bottom: 12px;
      border: 1px solid #333;
      background: rgba(255, 0, 255, 0.05);
    }
    
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .form-group label {
      font-size: 11px;
      color: #aaa;
    }
    
    .form-group input,
    .form-group textarea {
      padding: 8px;
      border: 1px solid #333;
      background: #000;
      color: #ccc;
      font-family: 'VT323', monospace;
      font-size: 12px;
    }
    
    .form-group textarea {
      min-height: 60px;
      resize: vertical;
    }
    
    .submit-topic-btn {
      padding: 8px;
      border: 2px solid #00ff00;
      background: rgba(0, 255, 0, 0.1);
      color: #00ff00;
      font-family: 'VT323', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .submit-topic-btn:hover {
      background: rgba(0, 255, 0, 0.2);
    }
    
    .topic-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 300px;
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
    
    .team-config {
      display: flex;
      gap: 16px;
    }
    
    .team-half {
      flex: 1;
    }
    
    .team-title {
      font-family: 'VT323', monospace;
      font-size: 12px;
      margin-bottom: 8px;
    }
    
    .team-affirmative {
      color: #00ff00;
      text-shadow: 0 0 6px rgba(0, 255, 0, 0.8);
    }
    
    .team-negative {
      color: #ff4444;
      text-shadow: 0 0 6px rgba(255, 68, 68, 0.8);
    }
    
    .agent-select {
      width: 100%;
      height: 100px;
      background: #000;
      border: 2px solid #333;
      color: #ccc;
      font-family: 'VT323', monospace;
      font-size: 12px;
    }
    
    .config-options {
      display: flex;
      gap: 16px;
    }
    
    .config-options label {
      display: flex;
      gap: 8px;
      color: #ccc;
      font-size: 12px;
      cursor: pointer;
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
      gap: 12px;
      padding: 16px;
      overflow-y: hidden;
    }
    
    .debate-topic {
      border-bottom: 1px solid #333;
      padding-bottom: 12px;
    }
    
    .debate-topic .topic-title {
      font-family: 'Press Start 2P', cursive;
      color: #ff00ff;
      font-size: 10px;
      margin-bottom: 8px;
    }
    
    .topic-info {
      display: flex;
      justify-content: space-between;
    }
    
    .round-info {
      color: #00ff00;
      font-size: 12px;
      text-shadow: 0 0 6px rgba(0, 255, 0, 0.8);
    }
    
    .phase-info {
      color: #ffdd00;
      font-size: 12px;
      text-shadow: 0 0 6px rgba(255, 221, 0, 0.8);
    }
    
    .phase-voting {
      color: #ff4444;
      text-shadow: 0 0 6px rgba(255, 68, 68, 0.8);
    }
    
    .team-scores {
      display: flex;
      gap: 16px;
    }
    
    .score-card {
      flex: 1;
      border: 2px solid #333;
      padding: 12px;
      text-align: center;
      background: rgba(0, 0, 0, 0.3);
    }
    
    .score-card.current-team {
      border-color: #ff00ff;
      box-shadow: 0 0 12px rgba(255, 0, 255, 0.4);
    }
    
    .score-card .team-name {
      font-family: 'Press Start 2P', cursive;
      font-size: 10px;
      margin-bottom: 8px;
    }
    
    .score-card .team-name.affirmative {
      color: #00ff00;
      text-shadow: 0 0 6px rgba(0, 255, 0, 0.8);
    }
    
    .score-card .team-name.negative {
      color: #ff4444;
      text-shadow: 0 0 6px rgba(255, 68, 68, 0.8);
    }
    
    .team-score {
      font-family: 'Press Start 2P', cursive;
      font-size: 16px;
      color: #ffdd00;
      text-shadow: 0 0 8px rgba(255, 221, 0, 0.8);
    }
    
    .debate-arguments {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border: 1px solid #333;
      padding: 12px;
    }
    
    .argument-item {
      border: 1px solid #333;
      padding: 12px;
      background: rgba(0, 0, 0, 0.5);
    }
    
    .argument-item.rebuttal {
      border-color: #ff4444;
      background: rgba(255, 68, 68, 0.1);
    }
    
    .argument-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    
    .agent-name {
      font-family: 'VT323', monospace;
      color: #ff00ff;
      font-size: 12px;
    }
    
    .agent-team {
      font-size: 10px;
      color: #888;
    }
    
    .argument-time {
      color: #888;
      font-size: 10px;
    }
    
    .argument-content {
      color: #ccc;
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 8px;
    }
    
    .argument-scores {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    
    .score-badge {
      font-size: 10px;
      padding: 2px 6px;
      background: rgba(0, 255, 0, 0.1);
      border: 1px solid #00ff00;
      color: #00ff00;
    }
    
    .debate-input {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .speech-input, .vote-reason-input {
      min-height: 60px;
      padding: 8px;
      border: 2px solid #333;
      background: #000;
      color: #ccc;
      font-family: 'VT323', monospace;
      font-size: 12px;
      resize: vertical;
    }
    
    .input-actions {
      display: flex;
      gap: 8px;
    }
    
    .submit-speech-btn, .submit-rebuttal-btn, .confirm-vote-btn {
      flex: 1;
      height: 40px;
      border: 2px solid;
      background: rgba(0, 0, 0, 0.2);
      color: inherit;
      font-family: 'VT323', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .submit-speech-btn {
      border-color: #00ff00;
      color: #00ff00;
      text-shadow: 0 0 8px rgba(0, 255, 0, 0.8);
    }
    
    .submit-rebuttal-btn {
      border-color: #ff4444;
      color: #ff4444;
      text-shadow: 0 0 8px rgba(255, 68, 68, 0.8);
    }
    
    .confirm-vote-btn {
      border-color: #ffdd00;
      color: #ffdd00;
      text-shadow: 0 0 8px rgba(255, 221, 0, 0.8);
    }
    
    .submit-speech-btn:hover:not(:disabled), .submit-rebuttal-btn:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.4);
    }
    
    .result-section {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px;
      background: rgba(0, 0, 0, 0.3);
      border: 2px solid #ffdd00;
    }
    
    .result-header {
      text-align: center;
    }
    
    .result-title {
      font-family: 'Press Start 2P', cursive;
      color: #ffdd00;
      font-size: 14px;
      text-shadow: 0 0 12px rgba(255, 221, 0, 0.8);
    }
    
    .result-winner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px;
      background: rgba(255, 221, 0, 0.1);
      border: 2px solid #ffdd00;
    }
    
    .winner-label {
      font-family: 'VT323', monospace;
      color: #aaa;
      font-size: 16px;
    }
    
    .winner-name {
      font-family: 'Press Start 2P', cursive;
      color: #00ff00;
      font-size: 16px;
      text-shadow: 0 0 12px rgba(0, 255, 0, 0.8);
    }
    
    .winner-score {
      font-family: 'Press Start 2P', cursive;
      color: #ffdd00;
      font-size: 14px;
      text-shadow: 0 0 8px rgba(255, 221, 0, 0.8);
    }
    
    .result-scores {
      display: flex;
      gap: 16px;
    }
    
    .team-final-score {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 12px;
      border: 2px solid #333;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .team-score-name {
      font-family: 'VT323', monospace;
      color: #888;
      font-size: 14px;
    }
    
    .team-score-value {
      font-family: 'Press Start 2P', cursive;
      color: #fff;
      font-size: 18px;
    }
    
    .result-summary {
      padding: 12px;
      border: 1px solid #333;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .summary-title {
      font-family: 'Press Start 2P', cursive;
      color: #ff00ff;
      font-size: 10px;
      margin-bottom: 8px;
    }
    
    .summary-content {
      font-family: 'VT323', monospace;
      color: #ccc;
      font-size: 12px;
      white-space: pre-line;
    }
    
    .result-comments {
      padding: 12px;
      border: 1px solid #333;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .comments-title {
      font-family: 'Press Start 2P', cursive;
      color: #4488ff;
      font-size: 10px;
      margin-bottom: 8px;
    }
    
    .comment-item {
      font-family: 'VT323', monospace;
      color: #aaa;
      font-size: 12px;
      padding: 4px 0;
      border-bottom: 1px solid #222;
    }
    
    .comment-item:last-child {
      border-bottom: none;
    }
    
    .winner-arguments {
      padding: 12px;
      border: 1px solid #00ff00;
      background: rgba(0, 255, 0, 0.05);
    }
    
    .winner-args-title {
      font-family: 'Press Start 2P', cursive;
      color: #00ff00;
      font-size: 10px;
      margin-bottom: 8px;
    }
    
    .winner-arg {
      padding: 8px;
      margin-bottom: 8px;
      border: 1px solid #333;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .winner-arg:last-child {
      margin-bottom: 0;
    }
    
    .arg-phase {
      font-family: 'VT323', monospace;
      color: #ff00ff;
      font-size: 10px;
      margin-bottom: 4px;
    }
    
    .arg-content {
      font-family: 'VT323', monospace;
      color: #ccc;
      font-size: 12px;
      line-height: 1.4;
    }
    
    .debate-controls {
      display: flex;
      gap: 8px;
    }
    
    .next-speaker-btn, .next-phase-btn, .reset-debate-btn {
      flex: 1;
      height: 40px;
      border: 2px solid #ffdd00;
      background: rgba(255, 221, 0, 0.1);
      color: #ffdd00;
      font-family: 'VT323', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .next-speaker-btn:hover, .next-phase-btn:hover, .reset-debate-btn:hover {
      background: rgba(255, 221, 0, 0.3);
      box-shadow: 0 0 12px rgba(255, 221, 0, 0.6);
    }
    
    .debate-result {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px;
      overflow-y: auto;
    }
    
    .result-header {
      font-family: 'Press Start 2P', cursive;
      color: #ffdd00;
      font-size: 14px;
      text-align: center;
      text-shadow: 0 0 12px rgba(255, 221, 0, 0.8);
    }
    
    .winner-announcement {
      text-align: center;
      padding: 24px;
      border: 2px solid #ffdd00;
      background: rgba(255, 221, 0, 0.1);
    }
    
    .winner-label {
      font-family: 'VT323', monospace;
      color: #aaa;
      font-size: 12px;
      margin-bottom: 8px;
    }
    
    .winner-name {
      font-family: 'Press Start 2P', cursive;
      color: #ffdd00;
      font-size: 18px;
      text-shadow: 0 0 12px rgba(255, 221, 0, 0.8);
    }
    
    .score-display {
      display: flex;
      gap: 16px;
    }
    
    .score-item {
      flex: 1;
      text-align: center;
      padding: 16px;
      border: 1px solid #333;
    }
    
    .score-item .team-name {
      color: #ccc;
      font-size: 12px;
    }
    
    .score-item .team-score {
      color: #ffdd00;
      font-size: 16px;
      font-family: 'Press Start 2P', cursive;
    }
    
    .summary-display, .judge-comments {
      border: 1px solid #333;
      padding: 12px;
    }
    
    .summary-label, .comments-label {
      font-family: 'VT323', monospace;
      color: #ff00ff;
      font-size: 12px;
      margin-bottom: 8px;
    }
    
    .summary-text {
      color: #ccc;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-line;
    }
    
    .comment-item {
      color: #aaa;
      font-size: 11px;
      padding: 8px;
      border-left: 2px solid #666;
      margin-bottom: 8px;
    }
    
    .reset-debate-btn {
      border-color: #ff00ff;
      color: #ff00ff;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DebatePanelComponent implements OnInit, OnDestroy {
  debateTopics: DebateTopic[] = [];
  selectedTopic: DebateTopic | null = null;
  
  config = {
    totalRounds: 5,
    requireUnanimous: false
  };
  
  availableAgents: Array<{ id: string; name: string }> = [];
  
  affirmativeAgents: string[] = [];
  negativeAgents: string[] = [];
  judges: string[] = [];
  
  private debateAgents: DebateAgent[] = [];
  private autoExecuteInterval: ReturnType<typeof setInterval> | null = null;
  private isAutoExecuting = false;
  private agentsSpawned = false;
  private spawnedTeammates: Map<string, TeammateSpawnResult> = new Map();
  private eventSubscription: Subscription | null = null;
  private agentResponseQueue: Map<string, string[]> = new Map();
  debateMode: TeammateMode = 'in-process';

  constructor(
    private debateService: DebateService, 
    private stateService: CollaborationStateService,
    private debateTopicBridge: DebateTopicBridgeService,
    private debateAgentService: DebateAgentService,
    private orchestrator: MultiAgentOrchestratorService
  ) {
    effect(() => {
      const state = this.debateService.debateState();
      console.log('[DebatePanel] Effect triggered, state:', { isActive: state.isActive, agentsSpawned: this.agentsSpawned });
      if (state.isActive && !this.isAutoExecuting && this.agentsSpawned) {
        this.startAutoExecution();
      } else if (!state.isActive && this.autoExecuteInterval) {
        this.stopAutoExecution();
      }
    });
  }

  ngOnInit() {
    this.debateTopics = this.debateService.getMockDebateTopics();
    
    // 检查是否有从编排画布传递过来的辩论主题
    const bridgedTopic = this.debateTopicBridge.currentTopic();
    if (bridgedTopic) {
      this.selectedTopic = bridgedTopic;
      
      // 使用桥接服务中的团队分配
      const affirmativeAgents = this.debateTopicBridge.affirmativeAgents();
      const negativeAgents = this.debateTopicBridge.negativeAgents();
      const judges = this.debateTopicBridge.judges();
      
      if (affirmativeAgents.length > 0) {
        this.affirmativeAgents = affirmativeAgents;
      }
      if (negativeAgents.length > 0) {
        this.negativeAgents = negativeAgents;
      }
      if (judges.length > 0) {
        this.judges = judges;
      }
    } else if (this.debateTopics.length > 0) {
      this.selectedTopic = this.debateTopics[0];
    }
    
    this.refreshAvailableAgents();
  }

  get debateState(): DebateState {
    return this.debateService.getDebateState();
  }

  get debateConfig() {
    return this.selectedTopic ? 
      { topic: this.selectedTopic.title } : 
      { topic: '请选择辩论主题' };
  }

  get currentTeam() {
    return this.debateService.getCurrentTeam();
  }

  get phaseLabel(): string {
    const phaseMap: Record<DebatePhase, string> = {
      preparation: '准备阶段',
      opening: '开幕立论',
      main: '正辩阶段',
      rebuttal: '驳论阶段',
      closing: '总结陈词',
      voting: '投票阶段',
      result: '结果公布'
    };
    return phaseMap[this.debateState.phase] || this.debateState.phase;
  }

  selectTopic(topic: DebateTopic) {
    this.selectedTopic = topic;
  }

  showAddTopicForm = false;
  newTopicTitle = '';
  newTopicDescription = '';
  newAffirmativeDescription = '';
  newNegativeDescription = '';

  toggleAddTopicForm() {
    this.showAddTopicForm = !this.showAddTopicForm;
    if (!this.showAddTopicForm) {
      this.newTopicTitle = '';
      this.newTopicDescription = '';
      this.newAffirmativeDescription = '';
      this.newNegativeDescription = '';
    }
  }

  addCustomTopic() {
    if (!this.newTopicTitle.trim()) return;

    const customTopic: DebateTopic = {
      id: `custom-topic-${Date.now()}`,
      title: this.newTopicTitle,
      description: this.newTopicDescription || '自定义辩论主题',
      sides: [
        {
          id: 'affirmative',
          name: '正方',
          description: this.newAffirmativeDescription || '正方观点待补充',
        },
        {
          id: 'negative',
          name: '反方',
          description: this.newNegativeDescription || '反方观点待补充',
        },
      ],
    };

    this.debateTopics = [...this.debateTopics, customTopic];
    this.selectedTopic = customTopic;
    this.showAddTopicForm = false;
    this.newTopicTitle = '';
    this.newTopicDescription = '';
    this.newAffirmativeDescription = '';
    this.newNegativeDescription = '';
  }

  refreshAvailableAgents(): void {
    const agents = this.stateService.agents();
    
    if (agents.length === 0) {
      const defaultAgents = [
        { id: 'default-affirmative-1', name: '正方辩手-1 (architect)' },
        { id: 'default-affirmative-2', name: '正方辩手-2 (analyst)' },
        { id: 'default-negative-1', name: '反方辩手-1 (developer)' },
        { id: 'default-negative-2', name: '反方辩手-2 (tester)' },
        { id: 'default-judge-1', name: '裁判-1 (product)' },
      ];
      this.availableAgents = defaultAgents;
      this.affirmativeAgents = ['default-affirmative-1', 'default-affirmative-2'];
      this.negativeAgents = ['default-negative-1', 'default-negative-2'];
      this.judges = ['default-judge-1'];
    } else {
      this.availableAgents = agents.map(agent => ({ id: agent.id, name: `${agent.name} (${agent.role})` }));

      const affirmativePool = agents.filter(agent => agent.role === 'architect' || agent.role === 'analyst' || agent.role === 'developer');
      const negativePool = agents.filter(agent => agent.role === 'tester' || agent.role === 'devops' || agent.role === 'product');
      const judgePool = agents.filter(agent => agent.role === 'product' || agent.role === 'architect');

      this.affirmativeAgents = affirmativePool.length > 0 ? affirmativePool.map(agent => agent.id) : [];
      this.negativeAgents = negativePool.length > 0 ? negativePool.map(agent => agent.id) : [];
      this.judges = judgePool.length > 0 ? [judgePool[0].id] : [];
    }
  }

  startDebate() {
    if (this.selectedTopic) {
      this.refreshAvailableAgents();
      this.debateService.initializeDebate(
        this.selectedTopic,
        this.affirmativeAgents,
        this.negativeAgents,
        this.judges,
        this.config
      );
      
      this.debateAgents = this.debateAgentService.getAllAgents();
      
      this.subscribeToOrchestratorEvents();
      
      this.spawnDebateAgents().then(() => {
        console.log('[DebatePanel] All agents spawned, starting debate now');
        this.debateService.startDebate();
      }).catch(error => {
        console.error('[DebatePanel] Failed to spawn agents:', error);
      });
    }
  }
  
  private async spawnDebateAgents(): Promise<void> {
    try {
      await this.orchestrator.setMode(this.debateMode);
      
      const topic = this.selectedTopic?.title || '辩论主题';
      console.log('[DebatePanel] Spawning debate agents for topic:', topic);
      console.log('[DebatePanel] Affirmative agents:', this.affirmativeAgents);
      console.log('[DebatePanel] Negative agents:', this.negativeAgents);
      console.log('[DebatePanel] Judges:', this.judges);
      
      for (const agentId of this.affirmativeAgents) {
        const agentInfo = this.availableAgents.find(a => a.id === agentId);
        const agent = this.debateAgents.find(a => a.id === agentId);
        
        const prompt = this.buildAgentPrompt(agent, topic, '正方');
        
        try {
          const result = await this.orchestrator.spawnTeammate({
            name: agentInfo?.name || agentId,
            prompt,
            teamName: 'TEAM_AFFIRMATIVE',
            mode: this.debateMode,
            agentType: 'debate-affirmative',
            description: `正方辩论选手 - ${agent?.role || 'debater'}`,
          });
          console.log(`[DebatePanel] Spawned affirmative agent: originalId=${agentId}, spawnedId=${result.identity.agentId}`);
          this.spawnedTeammates.set(agentId, result);
          this.agentResponseQueue.set(agentId, []);
          
          this.stateService.addAgent({
            id: agentId,
            name: agentInfo?.name || agentId,
            role: this.inferRoleFromName(agentInfo?.name || ''),
            status: 'running',
            load: 75,
            skills: agent?.skills || [],
            teamRole: 'affirmative'
          });
        } catch (error) {
          console.error(`Failed to spawn affirmative agent ${agentId}:`, error);
        }
      }
      
      for (const agentId of this.negativeAgents) {
        const agentInfo = this.availableAgents.find(a => a.id === agentId);
        const agent = this.debateAgents.find(a => a.id === agentId);
        
        const prompt = this.buildAgentPrompt(agent, topic, '反方');
        
        try {
          const result = await this.orchestrator.spawnTeammate({
            name: agentInfo?.name || agentId,
            prompt,
            teamName: 'TEAM_NEGATIVE',
            mode: this.debateMode,
            agentType: 'debate-negative',
            description: `反方辩论选手 - ${agent?.role || 'debater'}`,
          });
          console.log(`[DebatePanel] Spawned negative agent: originalId=${agentId}, spawnedId=${result.identity.agentId}`);
          this.spawnedTeammates.set(agentId, result);
          this.agentResponseQueue.set(agentId, []);
          
          this.stateService.addAgent({
            id: agentId,
            name: agentInfo?.name || agentId,
            role: this.inferRoleFromName(agentInfo?.name || ''),
            status: 'running',
            load: 75,
            skills: agent?.skills || [],
            teamRole: 'negative'
          });
        } catch (error) {
          console.error(`Failed to spawn negative agent ${agentId}:`, error);
        }
      }
      
      for (const agentId of this.judges) {
        const agentInfo = this.availableAgents.find(a => a.id === agentId);
        const agent = this.debateAgents.find(a => a.id === agentId);
        
        const prompt = this.buildJudgePrompt(agent, topic);
        
        try {
          const result = await this.orchestrator.spawnTeammate({
            name: agentInfo?.name || agentId,
            prompt,
            teamName: 'TEAM_JUDGE',
            mode: this.debateMode,
            agentType: 'debate-judge',
            description: `裁判 - ${agent?.role || 'judge'}`,
          });
          console.log(`[DebatePanel] Spawned judge agent: originalId=${agentId}, spawnedId=${result.identity.agentId}`);
          this.spawnedTeammates.set(agentId, result);
          this.agentResponseQueue.set(agentId, []);
          
          this.stateService.addAgent({
            id: agentId,
            name: agentInfo?.name || agentId,
            role: this.inferRoleFromName(agentInfo?.name || ''),
            status: 'running',
            load: 75,
            skills: agent?.skills || [],
            teamRole: 'judge'
          });
        } catch (error) {
          console.error(`Failed to spawn judge agent ${agentId}:`, error);
        }
      }
      
      this.stateService.addTeam({
        id: 'team-affirmative',
        name: '正方',
        score: 0,
        agents: this.affirmativeAgents.map(id => {
          const agentInfo = this.availableAgents.find(a => a.id === id);
          return {
            id,
            name: agentInfo?.name || id,
            role: this.inferRoleFromName(agentInfo?.name || ''),
            status: 'running',
            position: { x: 25, y: 30 }
          };
        })
      });
      
      this.stateService.addTeam({
        id: 'team-negative',
        name: '反方',
        score: 0,
        agents: this.negativeAgents.map(id => {
          const agentInfo = this.availableAgents.find(a => a.id === id);
          return {
            id,
            name: agentInfo?.name || id,
            role: this.inferRoleFromName(agentInfo?.name || ''),
            status: 'running',
            position: { x: 75, y: 30 }
          };
        })
      });
      
      const allDebateAgents = [...this.affirmativeAgents, ...this.negativeAgents, ...this.judges];
      this.stateService.updateRuntime({
        teamCount: 2,
        agentCount: allDebateAgents.length,
        activeSessions: 1,
        failedSessions: 0
      });
      
      this.stateService.updateMode(
        'battle',
        '辩论对抗模式',
        '围绕辩题进行正反对抗与裁决',
        '运行中'
      );
      
      this.stateService.updateCollaborationSummary({
        runningAgents: allDebateAgents.length,
        collaborationLevel: 'High'
      });
      
      this.stateService.updateBattleState({
        status: 'playing',
        currentTurn: this.affirmativeAgents[0] || '--',
        round: 1
      });
      
      this.agentsSpawned = true;
      console.log('[DebatePanel] agentsSpawned set to true, spawnedTeammates size:', this.spawnedTeammates.size);
      
    } catch (error) {
      console.error('Failed to spawn debate agents:', error);
      this.stateService.updateMode(
        'battle',
        '辩论对抗模式',
        '围绕辩题进行正反对抗与裁决',
        '错误'
      );
    }
  }
  
  private buildAgentPrompt(agent: DebateAgent | undefined, topic: string, side: string): string {
    return `你是一位专业的辩论选手，角色是${agent?.name || '辩手'}（${side}）。
你的特点是：${agent?.strengths?.join('、') || '逻辑清晰、表达有力'}
你的技能包括：${agent?.skills?.join('、') || '辩论、论证'}
你的辩论风格：${agent?.style || 'analytical'}

当前辩题：${topic}
你的立场：${side}

请根据你的角色特点，围绕辩题发表你的观点。要求：
1. 观点明确，逻辑清晰
2. 论据充分，有理有据
3. 语言精炼，表达有力
4. 符合你${side}的立场

当收到"请发言"的消息时，请发表你的论点（150-300字）。`;
  }
  
  private buildJudgePrompt(agent: DebateAgent | undefined, topic: string): string {
    return `你是一位专业的辩论裁判，角色是${agent?.name || '裁判'}。
你的特点是：${agent?.strengths?.join('、') || '公正客观、经验丰富'}
你的技能包括：${agent?.skills?.join('、') || '评判、分析'}

当前辩题：${topic}

你的职责是：
1. 公正评判双方论点
2. 给出合理的评分
3. 提供建设性的反馈

当收到评判请求时，请给出你的评分和意见。`;
  }
  
  private subscribeToOrchestratorEvents(): void {
    if (this.eventSubscription) {
      this.eventSubscription.unsubscribe();
    }
    
    this.eventSubscription = this.orchestrator.events$.subscribe(event => {
      console.log('[DebatePanel] Received event:', event.type, event);
      
      if (event.type === 'multiagent.teammate.message') {
        const payload = event.payload as { 
          direction?: string;
          toAgentId?: string; 
          fromAgentId?: string; 
          text?: string; 
          textPreview?: string;
          teamName?: string;
        };
        
        console.log('[DebatePanel] Message payload:', payload);
        
        if (payload.direction === 'teammate_to_leader' && payload.fromAgentId && payload.text) {
          const spawnedAgentId = this.findOriginalAgentId(payload.fromAgentId);
          
          if (spawnedAgentId && this.agentResponseQueue.has(spawnedAgentId)) {
            const queue = this.agentResponseQueue.get(spawnedAgentId) || [];
            queue.push(payload.text);
            this.agentResponseQueue.set(spawnedAgentId, queue);
            
            console.log(`[DebatePanel] Received response from ${spawnedAgentId}:`, payload.text.slice(0, 100));
          }
        }
      }
      
      if (event.type === 'multiagent.teammate.state.changed') {
        const payload = event.payload as { agentId?: string; next?: string; prev?: string };
        console.log('[DebatePanel] State changed:', payload);
        
        if (payload.agentId) {
          const spawnedAgentId = this.findOriginalAgentId(payload.agentId);
          if (spawnedAgentId && this.spawnedTeammates.has(spawnedAgentId)) {
            const status = payload.next === 'running' ? 'running' : 
                           payload.next === 'idle' ? 'running' :
                           payload.next === 'stopped' ? 'idle' : 'running';
            this.stateService.updateAgentStatus(spawnedAgentId, status as 'running' | 'idle', 
              status === 'running' ? 75 : 0);
          }
        }
      }
      
      if (event.type === 'multiagent.teammate.failed') {
        const payload = event.payload as { agentId?: string; message?: string; stage?: string };
        console.error('[DebatePanel] Agent failed:', payload);
      }
    });
  }
  
  private findOriginalAgentId(spawnedAgentId: string): string | undefined {
    for (const [originalId, teammate] of this.spawnedTeammates) {
      if (teammate.identity.agentId === spawnedAgentId) {
        return originalId;
      }
    }
    return undefined;
  }
  
  private inferRoleFromName(name: string): 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product' {
    const lower = name.toLowerCase();
    if (lower.includes('architect')) return 'architect';
    if (lower.includes('analyst')) return 'analyst';
    if (lower.includes('developer')) return 'developer';
    if (lower.includes('tester')) return 'tester';
    if (lower.includes('devops')) return 'devops';
    if (lower.includes('product')) return 'product';
    return 'developer';
  }

  submitSpeech(isRebuttal: boolean) {
  }
  
  private startAutoExecution(): void {
    if (this.autoExecuteInterval) return;
    
    console.log('[DebatePanel] Starting auto execution');
    this.isAutoExecuting = true;
    
    const executeTick = () => {
      const state = this.debateService.debateState();
      
      console.log('[DebatePanel] Auto execution tick, state:', { 
        isActive: state.isActive, 
        phase: state.phase, 
        currentSpeaker: state.currentSpeaker,
        currentRound: state.currentRound 
      });
      
      if (!state.isActive || state.phase === 'voting' || state.phase === 'result') {
        this.stopAutoExecution();
        return;
      }
      
      if (state.currentSpeaker) {
        this.autoGenerateAndSubmitArgument(state);
      }
    };
    
    setTimeout(executeTick, 500);
    this.autoExecuteInterval = setInterval(executeTick, 5000);
  }
  
  private stopAutoExecution(): void {
    if (this.autoExecuteInterval) {
      clearInterval(this.autoExecuteInterval);
      this.autoExecuteInterval = null;
    }
    this.isAutoExecuting = false;
  }
  
  private autoGenerateAndSubmitArgument(state: DebateState): void {
    const speakerId = state.currentSpeaker;
    if (!speakerId) return;
    
    console.log(`[DebatePanel] autoGenerateAndSubmitArgument called for speakerId: ${speakerId}`);
    console.log(`[DebatePanel] spawnedTeammates keys:`, [...this.spawnedTeammates.keys()]);
    
    const topic = this.selectedTopic?.title || '辩论主题';
    const side = this.affirmativeAgents.includes(speakerId) ? '正方' : 
                 this.negativeAgents.includes(speakerId) ? '反方' : '裁判';
    
    console.log(`[DebatePanel] Auto generating argument for ${speakerId} (${side})`);
    
    const teammate = this.spawnedTeammates.get(speakerId);
    console.log(`[DebatePanel] Found teammate:`, !!teammate);
    if (!teammate) {
      console.warn(`[DebatePanel] Agent ${speakerId} not found in spawned teammates, using fallback`);
      const fallbackArgument = `[${side}] 关于"${topic}"，我认为这是一个值得深入探讨的问题。作为${side}代表，我将从专业角度进行分析。`;
      this.debateService.submitSpeech(speakerId, fallbackArgument, false);
      setTimeout(() => this.debateService.nextSpeaker(), 500);
      return;
    }
    
    console.log(`[DebatePanel] Found teammate:`, teammate.identity);
    
    const prompt = this.buildExecutionPrompt(topic, side, state.currentRound, state.phase);
    console.log(`[DebatePanel] Sending prompt to ${teammate.identity.agentId}:`, prompt.slice(0, 100));
    
    let responseReceived = false;
    const timeout = 30000;
    const timeoutId = setTimeout(() => {
      if (!responseReceived) {
        console.warn(`[DebatePanel] Timeout waiting for response from ${speakerId}`);
        const fallbackArgument = `[${side}] 关于"${topic}"的第${state.currentRound}轮辩论，我认为需要更多时间思考。`;
        this.debateService.submitSpeech(speakerId, fallbackArgument, false);
        setTimeout(() => this.debateService.nextSpeaker(), 500);
      }
    }, timeout);
    
    this.orchestrator.sendMessage(teammate.identity.agentId, prompt).then(() => {
      console.log(`[DebatePanel] Message sent to ${teammate.identity.agentId}, waiting for response...`);
      
      const checkResponse = () => {
        const queue = this.agentResponseQueue.get(speakerId) || [];
        if (queue.length > 0) {
          responseReceived = true;
          clearTimeout(timeoutId);
          const argument = queue.shift() || '';
          this.agentResponseQueue.set(speakerId, queue);
          
          console.log(`[DebatePanel] Received argument from ${speakerId}:`, argument.slice(0, 100));
          
          this.debateService.submitSpeech(speakerId, argument, false);
          setTimeout(() => this.debateService.nextSpeaker(), 500);
        } else {
          setTimeout(checkResponse, 500);
        }
      };
      
      setTimeout(checkResponse, 1000);
    }).catch(error => {
      console.error('[DebatePanel] Failed to send message to agent:', error);
      clearTimeout(timeoutId);
      const fallbackArgument = `[${side}] 关于"${topic}"，抱歉出现错误：${error instanceof Error ? error.message : String(error)}`;
      this.debateService.submitSpeech(speakerId, fallbackArgument, false);
      setTimeout(() => this.debateService.nextSpeaker(), 500);
    });
  }
  
  private buildExecutionPrompt(topic: string, side: string, round: number, phase: string): string {
    const phaseLabel = this.getPhaseLabel(phase);
    return `辩题：${topic}
当前轮次：第${round}轮
当前阶段：${phaseLabel}
你的立场：${side}

请发言。请发表你的论点（150-300字）：`;
  }
  
  getWinnerName(): string {
    const result = this.debateState.result;
    if (!result) return '';
    const team = this.debateState.teams.find(t => t.id === result.winningTeamId);
    return team?.name || '未知';
  }

  getWinnerScore(): string {
    const result = this.debateState.result;
    if (!result) return '0';
    return result.finalScores[result.winningTeamId]?.toFixed(1) || '0';
  }

  getWinnerArguments(): DebateArgument[] {
    const result = this.debateState.result;
    if (!result) return [];
    const winnerTeamIds = this.debateState.teams
      .filter(t => t.id === result.winningTeamId)
      .flatMap(t => t.agentIds);
    return this.debateState.arguments.filter(arg => winnerTeamIds.includes(arg.agentId));
  }
  
  getPhaseLabel(phase: string): string {
    const phaseMap: Record<string, string> = {
      preparation: '准备阶段',
      opening: '开幕立论',
      main: '正辩阶段',
      rebuttal: '驳论阶段',
      closing: '总结陈词',
      voting: '投票阶段',
      result: '结果公布'
    };
    return phaseMap[phase] || phase;
  }
  
  ngOnDestroy(): void {
    this.stopAutoExecution();
    this.stopAllTeammates();
  }

  nextSpeaker() {
    this.debateService.nextSpeaker();
  }

  nextPhase() {
    this.debateService.nextPhase();
    
    const state = this.debateService.debateState();
    if (state.phase === 'voting' || state.phase === 'result') {
      this.stopAutoExecution();
      
      const allDebateAgents = [...this.affirmativeAgents, ...this.negativeAgents, ...this.judges];
      allDebateAgents.forEach(agentId => {
        this.stateService.updateAgentStatus(agentId, 'idle', 0);
      });
      
      this.stateService.updateCollaborationSummary({
        runningAgents: 0,
        collaborationLevel: 'Low'
      });
    }
  }

  resetDebate() {
    this.stopAutoExecution();
    this.debateService.resetDebate();
    this.selectedTopic = null;
    this.agentsSpawned = false;
    
    this.stopAllTeammates();
    
    const allDebateAgents = [...this.affirmativeAgents, ...this.negativeAgents, ...this.judges];
    allDebateAgents.forEach(agentId => {
      this.stateService.updateAgentStatus(agentId, 'idle', 0);
    });
    
    this.stateService.updateRuntime({
      teamCount: 0,
      agentCount: 0,
      activeSessions: 0,
      failedSessions: 0
    });
    
    this.stateService.updateMode(
      'battle',
      '辩论对抗模式',
      '围绕辩题进行正反对抗与裁决',
      '已停止'
    );
    
    this.stateService.updateCollaborationSummary({
      runningAgents: 0,
      collaborationLevel: 'Low'
    });
    
    this.stateService.updateBattleState({
      status: 'paused',
      currentTurn: '--',
      round: 0,
      teams: []
    });
  }
  
  private async stopAllTeammates(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    
    for (const [agentId, teammate] of this.spawnedTeammates) {
      stopPromises.push(
        this.orchestrator.stopTeammate(teammate.identity.agentId, '辩论结束').catch(error => {
          console.error(`Failed to stop teammate ${agentId}:`, error);
        })
      );
    }
    
    await Promise.all(stopPromises);
    
    this.spawnedTeammates.clear();
    this.agentResponseQueue.clear();
    
    if (this.eventSubscription) {
      this.eventSubscription.unsubscribe();
      this.eventSubscription = null;
    }
  }

  getAgentName(agentId: string): string {
    const agent = this.availableAgents.find(a => a.id === agentId);
    if (agent) {
      return agent.name;
    }
    if (agentId === 'user-1' || agentId === 'user-judge') {
      return 'You';
    }
    return agentId;
  }

  getTeamName(teamId: string): string {
    const team = this.debateState.teams.find(t => t.id === teamId);
    return team?.name || teamId;
  }
}
