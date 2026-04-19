import { Injectable, signal, computed } from '@angular/core';

// 辩论角色类型
export type DebateRole = 'affirmative' | 'negative' | 'judge';

// 辩论阶段
export type DebatePhase = 'preparation' | 'opening' | 'main' | 'rebuttal' | 'closing' | 'voting' | 'result';

// 辩论状态接口
export interface DebateState {
  phase: DebatePhase;
  currentRound: number;
  totalRounds: number;
  currentSpeaker: string | null;
  speakerOrder: string[];
  teams: DebateTeam[];
  arguments: DebateArgument[];
  votes: Vote[];
  result: DebateResult | null;
  isActive: boolean;
  startTime: Date | null;
  endTime: Date | null;
  judgeIds: string[]; // 添加这个字段
}

// 辩论团队接口
export interface DebateTeam {
  id: string;
  name: string;
  role: 'affirmative' | 'negative';
  members: string[];
  agentIds: string[]; // 添加这个字段，与members相同但提供更明确的语义
  score: number;
}

// 辩论论点接口
export interface DebateArgument {
  id: string;
  teamId: string;
  agentId: string;
  content: string;
  round: number;
  phase: DebatePhase;
  timestamp: Date;
  scores: ArgumentScore[];
  isRebuttal: boolean;
  respondsTo?: string;
}

// 论点评分接口
export interface ArgumentScore {
  judgeId: string;
  score: number;
  feedback: string;
}

// 投票接口
export interface Vote {
  judgeId: string;
  winningTeamId: string;
  reasoning: string;
  timestamp: Date;
}

// 辩论结果接口
export interface DebateResult {
  winningTeamId: string;
  finalScores: { [teamId: string]: number };
  summary: string;
  judgeComments: string[];
}

// 辩论配置接口
export interface DebateConfig {
  topic: string;
  totalRounds: number;
  timePerArgument: number;
  scoringCriteria: string[];
  requireUnanimous: boolean;
}

@Injectable({ providedIn: 'root' })
export class DebateModeService {
  // 辩论状态信号
  private _debateState = signal<DebateState>({
    phase: 'preparation',
    currentRound: 0,
    totalRounds: 5,
    currentSpeaker: null,
    speakerOrder: [],
    teams: [],
    arguments: [],
    votes: [],
    result: null,
    isActive: false,
    startTime: null,
    endTime: null,
    judgeIds: [],
  });

  // 辩论配置信号
  private _debateConfig = signal<DebateConfig>({
    topic: '人工智能是否会取代人类的大多数工作',
    totalRounds: 5,
    timePerArgument: 300,
    scoringCriteria: ['逻辑严密性', '论据充分性', '表达清晰度', '创新性'],
    requireUnanimous: false,
  });

  // 公开的只读信号
  readonly debateState = this._debateState.asReadonly();
  readonly debateConfig = this._debateConfig.asReadonly();

  // 计算属性
  readonly currentTeam = computed(() => {
    const state = this._debateState();
    if (!state.currentSpeaker) return null;
    const speaker = state.currentSpeaker;
    return state.teams.find(team => team.members.includes(speaker));
  });

  readonly isPreparing = computed(() => this._debateState().phase === 'preparation');
  readonly isDebating = computed(() => ['opening', 'main', 'rebuttal', 'closing'].includes(this._debateState().phase));
  readonly isVoting = computed(() => this._debateState().phase === 'voting');
  readonly isFinished = computed(() => this._debateState().phase === 'result');
  readonly isActive = computed(() => this._debateState().isActive);

  // 初始化辩论
  initializeDebate(
    config: Partial<DebateConfig> = {},
    affirmativeAgents: string[],
    negativeAgents: string[],
    judges: string[]
  ): void {
    // 更新配置
    this._debateConfig.update(current => ({ ...current, ...config }));

    // 创建团队
    const teams: DebateTeam[] = [
      {
        id: 'affirmative',
        name: '正方',
        role: 'affirmative',
        members: affirmativeAgents,
        agentIds: affirmativeAgents,
        score: 0,
      },
      {
        id: 'negative',
        name: '反方',
        role: 'negative',
        members: negativeAgents,
        agentIds: negativeAgents,
        score: 0,
      },
    ];

    // 创建发言顺序
    const speakerOrder = [
      ...affirmativeAgents,
      ...negativeAgents,
      ...judges
    ];

    // 重置状态
    this._debateState.set({
      phase: 'preparation',
      currentRound: 0,
      totalRounds: this._debateConfig().totalRounds,
      currentSpeaker: null,
      speakerOrder,
      teams,
      arguments: [],
      votes: [],
      result: null,
      isActive: false,
      startTime: null,
      endTime: null,
      judgeIds: judges,
    });
  }

  // 开始辩论
  startDebate(): void {
    this._debateState.update(state => ({
      ...state,
      phase: 'opening',
      currentRound: 1,
      currentSpeaker: state.speakerOrder[0] || null,
      isActive: true,
      startTime: new Date(),
    }));
  }

  // 提交论点
  submitArgument(agentId: string, content: string, isRebuttal = false, respondsTo?: string): string {
    const argumentId = `arg-${Date.now()}`;
    const state = this._debateState();
    const team = this.getAgentTeam(agentId);

    const autoScore = this.calculateArgumentScore(content, state.phase);
    const autoScores: ArgumentScore[] = state.judgeIds.map(judgeId => ({
      judgeId,
      score: autoScore,
      feedback: `自动评分: ${autoScore.toFixed(1)} 分`,
    }));

    const argument: DebateArgument = {
      id: argumentId,
      teamId: team?.id || '',
      agentId,
      content,
      round: state.currentRound,
      phase: state.phase,
      timestamp: new Date(),
      isRebuttal,
      scores: autoScores,
    };

    this._debateState.update(state => {
      const updatedArguments = [...state.arguments, argument];
      
      let updatedTeams = [...state.teams];
      updatedTeams = updatedTeams.map(t => {
        const teamArguments = updatedArguments.filter(arg => arg.teamId === t.id);
        const totalScore = teamArguments.reduce((sum, arg) => {
          const avgScore = arg.scores.length > 0 
            ? arg.scores.reduce((s, sc) => s + sc.score, 0) / arg.scores.length 
            : 0;
          return sum + avgScore;
        }, 0);
        return { ...t, score: totalScore };
      });

      console.log(`[DebateMode] Argument submitted by ${agentId}, score: ${autoScore.toFixed(1)}, team ${team?.name} total: ${updatedTeams.find(t => t.id === team?.id)?.score.toFixed(1) || 0}`);

      return {
        ...state,
        arguments: updatedArguments,
        teams: updatedTeams,
      };
    });

    return argumentId;
  }

  private calculateArgumentScore(content: string, phase: DebatePhase): number {
    let score = 5.0;
    
    const length = content.length;
    if (length > 200) score += 1.0;
    if (length > 300) score += 0.5;
    if (length > 400) score += 0.5;
    
    const logicalKeywords = ['因此', '所以', '因为', '由于', '首先', '其次', '最后', '总之', '综上所述'];
    const logicalCount = logicalKeywords.filter(kw => content.includes(kw)).length;
    score += Math.min(logicalCount * 0.3, 1.5);
    
    const evidenceKeywords = ['数据', '研究', '调查', '报告', '统计', '案例', '实例', '证明'];
    const evidenceCount = evidenceKeywords.filter(kw => content.includes(kw)).length;
    score += Math.min(evidenceCount * 0.2, 1.0);
    
    if (phase === 'opening') score *= 1.1;
    if (phase === 'rebuttal') score *= 1.2;
    
    return Math.min(Math.max(score, 3.0), 10.0);
  }

  // 评分论点
  scoreArgument(argumentId: string, judgeId: string, score: number, feedback: string): void {
    this._debateState.update(state => {
      const updatedArguments = state.arguments.map(arg => {
        if (arg.id === argumentId) {
          const existingScoreIndex = arg.scores.findIndex(s => s.judgeId === judgeId);
          const newScore: ArgumentScore = { judgeId, score, feedback };
          
          if (existingScoreIndex >= 0) {
            const newScores = [...arg.scores];
            newScores[existingScoreIndex] = newScore;
            return { ...arg, scores: newScores };
          } else {
            return { ...arg, scores: [...arg.scores, newScore] };
          }
        }
        return arg;
      });

      // 更新团队分数
      let updatedTeams = [...state.teams];
      updatedTeams.forEach(team => {
        const teamArguments = updatedArguments.filter(arg => arg.teamId === team.id);
        const totalScore = teamArguments.reduce((sum, arg) => {
          const avgScore = arg.scores.length > 0 
            ? arg.scores.reduce((s, sc) => s + sc.score, 0) / arg.scores.length 
            : 0;
          return sum + avgScore;
        }, 0);
        team.score = totalScore;
      });

      return {
        ...state,
        arguments: updatedArguments,
        teams: updatedTeams,
      };
    });
  }

  // 进入下一阶段
  nextPhase(): void {
    this._debateState.update(state => {
      let newPhase: DebatePhase;
      let newRound = state.currentRound;

      switch (state.phase) {
        case 'preparation':
          newPhase = 'opening';
          break;
        case 'opening':
          newPhase = 'main';
          break;
        case 'main':
          newPhase = 'rebuttal';
          break;
        case 'rebuttal':
          if (state.currentRound < state.totalRounds) {
            newPhase = 'main';
            newRound = state.currentRound + 1;
          } else {
            newPhase = 'closing';
          }
          break;
        case 'closing':
          newPhase = 'voting';
          break;
        case 'voting':
          newPhase = 'result';
          break;
        default:
          newPhase = state.phase;
      }

      // 进入结果阶段时生成结果
      if (newPhase === 'result') {
        return {
          ...state,
          phase: newPhase,
          currentRound: newRound,
          endTime: new Date(),
          result: this.generateResult(state),
        };
      }

      return {
        ...state,
        phase: newPhase,
        currentRound: newRound,
      };
    });
  }

  // 下一位发言者
  nextSpeaker(): void {
    this._debateState.update(state => {
      if (!state.speakerOrder.length) return state;
      
      const currentIndex = state.currentSpeaker 
        ? state.speakerOrder.indexOf(state.currentSpeaker) 
        : -1;
      const nextIndex = currentIndex + 1;
      
      // 检查是否完成一轮（所有发言者都已发言）
      if (nextIndex >= state.speakerOrder.length) {
        // 完成一轮，检查是否需要进入下一阶段或下一轮
        const currentPhase = state.phase;
        const currentRound = state.currentRound;
        const totalRounds = state.totalRounds;
        
        let newPhase: DebatePhase = currentPhase;
        let newRound = currentRound;
        let isActive = true;
        let endTime: Date | null = null;
        let result: DebateResult | null = null;
        
        // 根据当前阶段决定下一步
        switch (currentPhase) {
          case 'opening':
            // 开幕立论完成，进入主要辩论
            newPhase = 'main';
            newRound = 1;
            break;
          case 'main':
            // 主要辩论，检查是否完成所有轮次
            if (currentRound >= totalRounds) {
              newPhase = 'rebuttal';
              newRound = 1;
            } else {
              newRound = currentRound + 1;
            }
            break;
          case 'rebuttal':
            newPhase = 'result';
            isActive = false;
            endTime = new Date();
            result = this.generateResultFromScores(state);
            break;
          default:
            break;
        }
        
        console.log(`[DebateMode] Round complete. Phase: ${currentPhase} -> ${newPhase}, Round: ${currentRound} -> ${newRound}`);
        
        return {
          ...state,
          currentSpeaker: state.speakerOrder[0], // 重置到第一个发言者
          currentRound: newRound,
          phase: newPhase,
          isActive,
          endTime,
          result,
        };
      }
      
      // 继续下一位发言者
      return {
        ...state,
        currentSpeaker: state.speakerOrder[nextIndex],
      };
    });
  }

  // 投票
  castVote(judgeId: string, winningTeamId: string, reasoning: string): void {
    const vote: Vote = {
      judgeId,
      winningTeamId,
      reasoning,
      timestamp: new Date(),
    };

    this._debateState.update(state => ({
      ...state,
      votes: [...state.votes, vote],
    }));
  }

  // 生成辩论结果
  private generateResult(state: DebateState): DebateResult {
    const { teams, votes } = state;
    
    // 计算每个团队的票数
    const voteCounts: { [teamId: string]: number } = {};
    teams.forEach(team => {
      voteCounts[team.id] = votes.filter(v => v.winningTeamId === team.id).length;
    });

    // 找出获胜团队
    let winningTeamId = teams[0]?.id || '';
    let maxVotes = voteCounts[winningTeamId] || 0;
    
    teams.forEach(team => {
      if ((voteCounts[team.id] || 0) > maxVotes) {
        maxVotes = voteCounts[team.id] || 0;
        winningTeamId = team.id;
      }
    });

    // 计算最终分数
    const finalScores: { [teamId: string]: number } = {};
    teams.forEach(team => {
      finalScores[team.id] = team.score;
    });

    // 生成总结
    const summary = this.generateSummary(state);

    return {
      winningTeamId,
      finalScores,
      summary,
      judgeComments: votes.map(v => v.reasoning),
    };
  }

  private generateResultFromScores(state: DebateState): DebateResult {
    const { teams, arguments: debateArgs } = state;
    
    let winningTeamId = teams[0]?.id || '';
    let maxScore = teams[0]?.score || 0;
    
    teams.forEach(team => {
      if (team.score > maxScore) {
        maxScore = team.score;
        winningTeamId = team.id;
      }
    });

    const finalScores: { [teamId: string]: number } = {};
    teams.forEach(team => {
      finalScores[team.id] = team.score;
    });

    const winner = teams.find(t => t.id === winningTeamId);
    const winnerArgs = debateArgs.filter(a => {
      const team = teams.find(t => t.agentIds.includes(a.agentId));
      return team?.id === winningTeamId;
    });

    const summary = `
辩论主题: ${this._debateConfig().topic}
获胜方: ${winner?.name || '待定'}
最终得分: ${maxScore.toFixed(1)} 分
总论点数: ${debateArgs.length}
获胜方论点数: ${winnerArgs.length}
    `.trim();

    const judgeComments = [
      `根据双方表现，${winner?.name || '获胜方'}以 ${maxScore.toFixed(1)} 分获胜。`,
      `正方得分: ${finalScores[teams[0]?.id]?.toFixed(1) || 0} 分`,
      `反方得分: ${finalScores[teams[1]?.id]?.toFixed(1) || 0} 分`,
    ];

    return {
      winningTeamId,
      finalScores,
      summary,
      judgeComments,
    };
  }

  private generateSummary(state: DebateState): string {
    const winner = state.teams.find(t => t.id === state.result?.winningTeamId);
    const totalArguments = state.arguments.length;
    const debateDuration = state.startTime && state.endTime 
      ? Math.floor((state.endTime.getTime() - state.startTime.getTime()) / 60000)
      : 0;
    
    return `
辩论主题: ${this._debateConfig().topic}
获胜方: ${winner?.name || '待定'}
总论点数: ${totalArguments}
辩论时长: ${debateDuration} 分钟
总轮数: ${state.currentRound}
    `.trim();
  }

  // 获取Agent所属的团队
  getAgentTeam(agentId: string): DebateTeam | undefined {
    const state = this._debateState();
    return state.teams.find(team => team.members.includes(agentId));
  }

  // 重置辩论
  resetDebate(): void {
    this._debateState.update(state => ({
      ...state,
      phase: 'preparation',
      currentRound: 0,
      currentSpeaker: null,
      arguments: [],
      votes: [],
      result: null,
      isActive: false,
      startTime: null,
      endTime: null,
    }));
  }

  // 更新配置
  updateConfig(config: Partial<DebateConfig>): void {
    this._debateConfig.update(current => ({ ...current, ...config }));
  }
}
