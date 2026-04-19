import { Injectable } from '@angular/core';
import { DebateModeService, DebateState, DebateConfig } from './debate-mode.service';
import { DEBATE_TOPIC_MOCKS } from './debate-orchestration.mock';

// 辩论主题接口
export interface DebateTopic {
  id: string;
  title: string;
  description: string;
  sides: {
    id: string;
    name: string;
    description: string;
  }[];
}

// 辩论轮次接口
export interface DebateRound {
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
  constructor(private debateModeService: DebateModeService) {
  }

  readonly debateState = this.debateModeService.debateState;
  readonly currentTeam = this.debateModeService.currentTeam;
  readonly isActive = this.debateModeService.isActive;

  // 初始化辩论
  initializeDebate(
    topic: DebateTopic,
    affirmativeAgents: string[],
    negativeAgents: string[],
    judges: string[],
    config?: Partial<DebateConfig>
  ): void {
    this.debateModeService.initializeDebate(
      {
        topic: topic.title,
        ...config,
      },
      affirmativeAgents,
      negativeAgents,
      judges
    );
  }

  // 开始辩论
  startDebate(): void {
    this.debateModeService.startDebate();
  }

  // 提交论点
  submitSpeech(agentId: string, speech: string, isRebuttal = false, respondsTo?: string): string {
    return this.debateModeService.submitArgument(agentId, speech, isRebuttal, respondsTo);
  }

  // 评分论点
  scoreArgument(argumentId: string, judgeId: string, score: number, feedback: string): void {
    this.debateModeService.scoreArgument(argumentId, judgeId, score, feedback);
  }

  // 投票
  voteOnWinner(judgeId: string, winningTeamId: string, reasoning: string): void {
    this.debateModeService.castVote(judgeId, winningTeamId, reasoning);
  }

  // 进入下一阶段
  nextPhase(): void {
    this.debateModeService.nextPhase();
  }

  // 下一位发言者
  nextSpeaker(): void {
    this.debateModeService.nextSpeaker();
  }

  // 获取辩论状态
  getDebateState(): DebateState {
    return this.debateModeService.debateState();
  }

  // 获取当前团队
  getCurrentTeam() {
    return this.debateModeService.currentTeam();
  }

  // 检查是否准备阶段
  isPreparing(): boolean {
    return this.debateModeService.isPreparing();
  }

  // 检查是否辩论中
  isDebating(): boolean {
    return this.debateModeService.isDebating();
  }

  // 检查是否投票阶段
  isVoting(): boolean {
    return this.debateModeService.isVoting();
  }

  // 检查是否已完成
  isFinished(): boolean {
    return this.debateModeService.isFinished();
  }

  // 重置辩论
  resetDebate(): void {
    this.debateModeService.resetDebate();
  }

  // Mock辩论主题
  getMockDebateTopics(): DebateTopic[] {
    return DEBATE_TOPIC_MOCKS;
  }
}
