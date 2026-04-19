import { Injectable } from '@angular/core';
import { DebateArgument, ArgumentScore, DebateState, DebateTeam } from './debate-mode.service';

// 辩论Agent角色类型
export type DebateAgentType = 'affirmative' | 'negative' | 'judge';

// 辩论Agent角色接口
export interface DebateAgent {
  id: string;
  name: string;
  type: DebateAgentType;
  role: 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product' | 'judge';
  skills: string[];
  strengths: string[];
  style: 'aggressive' | 'defensive' | 'neutral' | 'analytical';
}

// 论点评分标准
export interface ScoringCriterion {
  name: string;
  weight: number;
  maxScore: number;
  description: string;
}

// 裁判评分结果
export interface JudgeScoring {
  argumentId: string;
  judgeId: string;
  criterionScores: { [criterion: string]: number };
  totalScore: number;
  feedback: string;
  timestamp: Date;
}

// 论点分析结果
export interface ArgumentAnalysis {
  logicalStrength: number;
  evidenceStrength: number;
  clarityScore: number;
  innovationScore: number;
  overallScore: number;
  suggestions: string[];
}

@Injectable({ providedIn: 'root' })
export class DebateAgentService {
  // 预设的辩论Agent
  private presetAgents: DebateAgent[] = [
    { id: 'agent-1', name: 'Architect', type: 'affirmative', role: 'architect', skills: ['系统设计', '架构分析', '战略思维'], strengths: ['大局观强', '逻辑严密', '善于提炼'], style: 'analytical' },
    { id: 'agent-2', name: 'Analyst', type: 'negative', role: 'analyst', skills: ['数据分析', '风险评估', '批判性思维'], strengths: ['细致入微', '善于发现漏洞', '数据驱动'], style: 'defensive' },
    { id: 'agent-3', name: 'Developer', type: 'affirmative', role: 'developer', skills: ['问题解决', '快速迭代', '实践经验'], strengths: ['实践导向', '善于举例', '思维敏捷'], style: 'aggressive' },
    { id: 'agent-4', name: 'Tester', type: 'negative', role: 'tester', skills: ['缺陷查找', '边缘情况', '用户视角'], strengths: ['善于找茬', '关注细节', '逆向思维'], style: 'defensive' },
    { id: 'agent-5', name: 'DevOps', type: 'affirmative', role: 'devops', skills: ['流程优化', '效率提升', '自动化'], strengths: ['务实高效', '工程思维', '成本意识'], style: 'neutral' },
    { id: 'agent-6', name: 'Product', type: 'negative', role: 'product', skills: ['用户价值', '市场洞察', '产品思维'], strengths: ['用户至上', '商业视角', '创新思维'], style: 'analytical' },
    { id: 'judge-1', name: 'Judge A', type: 'judge', role: 'judge', skills: ['公正裁决', '逻辑判断', '价值评估'], strengths: ['经验丰富', '客观公正', '善于总结'], style: 'neutral' },
    { id: 'judge-2', name: 'Judge B', type: 'judge', role: 'judge', skills: ['辩论分析', '策略评估', '平衡考量'], strengths: ['深思熟虑', '全面分析', '平衡各方'], style: 'analytical' },
  ];

  // 评分标准
  private scoringCriteria: ScoringCriterion[] = [
    { name: '逻辑严密性', weight: 0.3, maxScore: 10, description: '论点的逻辑结构是否完整、推理是否合理' },
    { name: '论据充分性', weight: 0.25, maxScore: 10, description: '是否有足够的证据和例子支持论点' },
    { name: '表达清晰度', weight: 0.2, maxScore: 10, description: '论点表达是否清楚易懂、有条理' },
    { name: '创新性', weight: 0.15, maxScore: 10, description: '论点是否有新意、是否有独特的见解' },
    { name: '回应质量', weight: 0.1, maxScore: 10, description: '回应是否切题、是否有针对性' },
  ];

  // 获取所有辩论Agent
  getAllAgents(): DebateAgent[] {
    return [...this.presetAgents];
  }

  // 获取正方Agent
  getAffirmativeAgents(): DebateAgent[] {
    return this.presetAgents.filter(a => a.type === 'affirmative');
  }

  // 获取反方Agent
  getNegativeAgents(): DebateAgent[] {
    return this.presetAgents.filter(a => a.type === 'negative');
  }

  // 获取裁判Agent
  getJudgeAgents(): DebateAgent[] {
    return this.presetAgents.filter(a => a.type === 'judge');
  }

  // 获取特定ID的Agent
  getAgentById(id: string): DebateAgent | undefined {
    return this.presetAgents.find(a => a.id === id);
  }

  // 生成论点
  generateArgument(
    agent: DebateAgent, topic: string, round: number, phase: string, isRebuttal: boolean = false): string {
    const argumentTemplates = this.getArgumentTemplates(agent.type, phase);
    const template = argumentTemplates[Math.floor(Math.random() * argumentTemplates.length)];
    
    // 替换模板中的变量
    let argument = template
      .replace('{AGENT_NAME}', agent.name)
      .replace('{TOPIC}', topic)
      .replace('{ROUND}', round.toString())
      .replace('{SKILL}', agent.skills[Math.floor(Math.random() * agent.skills.length)]);
    
    // 添加Agent的风格调整
    argument = this.adjustArgumentStyle(argument, agent.style);
    
    return argument;
  }

  // 生成反驳论点
  generateRebuttal(agent: DebateAgent, targetArgument: string, topic: string): string {
    const rebuttalTemplates = [
      `我不同意刚才的观点。${agent.name}认为，这个论点存在问题，因为...`,
      `这个论点值得商榷。从我的分析表明，实际情况是...`,
      `这个观点的假设存在缺陷。让我从另一个角度来看待这个问题...`,
      `这个论点忽略了一个关键事实。根据我的经验，...`,
    ];
    
    const rebuttalContent = this.generateRebuttalContent(targetArgument, agent);
    
    return rebuttalTemplates[Math.floor(Math.random() * rebuttalTemplates.length)];
  }

  // 分析论点
  analyzeArgument(argument: DebateArgument): ArgumentAnalysis {
    // 简单的文本分析逻辑
    const content = argument.content;
    const lengthScore = Math.min(10, content.length / 50);
    
    // 分析各个维度
    const logicalStrength = this.evaluateLogicalStrength(content);
    const evidenceStrength = this.evaluateEvidenceStrength(content);
    const clarityScore = this.evaluateClarity(content);
    const innovationScore = this.evaluateInnovation(content);
    
    const overallScore = logicalStrength * 0.3 + evidenceStrength * 0.25 + clarityScore * 0.2 + innovationScore * 0.15 + lengthScore * 0.1;
    
    return {
      logicalStrength,
      evidenceStrength,
      clarityScore,
      innovationScore,
      overallScore,
      suggestions: this.generateSuggestions(argument),
    };
  }

  // 裁判评分论点
  judgeScoreArgument(judge: DebateAgent, argument: DebateArgument): ArgumentScore {
    const analysis = this.analyzeArgument(argument);
    const totalScore = analysis.overallScore;
    
    // 生成评分反馈
    const feedback = this.generateJudgeFeedback(judge, argument, analysis);
    
    return {
      judgeId: judge.id,
      score: Math.round(totalScore),
      feedback,
    };
  }

  // 裁决获胜方
  decideWinner(state: DebateState): { teamId: string; reasoning: string } {
    const teams = state.teams;
    
    // 计算基于分数的权重
    let winnerByScore = this.calculateScoreBasedWinner(teams);
    
    // 计算基于投票的权重
    const winnerByVote = this.calculateVoteBasedWinner(state);
    
    // 综合判断
    let finalWinner = this.combineResults(winnerByScore, winnerByVote, state);
    
    return finalWinner;
  }

  // 生成辩论总结
  generateDebateSummary(state: DebateState): string {
    const winner = state.result?.winningTeamId ? 
      state.teams.find(t => t.id === state.result?.winningTeamId) : null;
    
    const totalArguments = state.arguments.length;
    const debateDuration = state.startTime && state.endTime 
      ? Math.floor((state.endTime.getTime() - state.startTime.getTime()) / 60000)
      : 0;
    
    const topArguments = this.getTopArguments(state.arguments, 3);
    
    return `
辩论主题: ${state.teams.map(t => t.name).join(' vs ')}
获胜方: ${winner?.name || '待定'}
总论点数: ${totalArguments}
辩论时长: ${debateDuration} 分钟
总轮数: ${state.currentRound}

精彩论点:
${topArguments.map((arg, idx) => `${idx + 1}. ${arg.content.substring(0, 100)}...`).join('\n')}

裁判评语:
${state.votes.map(v => v.reasoning).join('\n')}
    `.trim();
  }

  // 私有方法
  private getArgumentTemplates(type: DebateAgentType, phase: string): string[] {
    const templates: { [key: string]: string[] } = {
      affirmative: [
        `我认为，{TOPIC}。从{SKILL}的角度来看，这是正确的，因为...`,
        `在第{ROUND}轮，{AGENT_NAME}将证明了{TOPIC}的观点是站得住脚的...`,
        `基于我们的分析，{TOPIC}，这支持了我们的立场...`,
      ],
      negative: [
        `我不认为{TOPIC}。从{SKILL}的角度来看，这个观点有问题...`,
        `在第{ROUND}轮，{AGENT_NAME}要指出{TOPIC}观点的缺陷...`,
        `这个观点忽略了一个关键问题：{TOPIC}实际上是不正确的...`,
      ],
      judge: [
        `从裁判点评：双方的论点都很有价值...`,
        `让我需要仔细评估双方的论点...`,
      ],
    };
    
    return templates[type] || [];
  }

  private adjustArgumentStyle(argument: string, style: string): string {
    switch (style) {
      case 'aggressive':
        return argument + ' 这一点非常明确，不容置疑！';
      case 'defensive':
        return '虽然我们需要谨慎看待这个问题，' + argument;
      case 'analytical':
        return '让我们来分析一下：' + argument;
      default:
        return argument;
    }
  }

  private generateRebuttalContent(targetArgument: string, agent: DebateAgent): string {
    // 简单的反驳内容生成
    const rebuttalPoints = [
      '这个论点的前提假设过于简单化了实际情况',
      '缺乏足够的证据支持这一论断',
      '忽略了关键的反例和实际情况',
      '逻辑推理存在明显的跳跃',
    ];
    return rebuttalPoints[Math.floor(Math.random() * rebuttalPoints.length)];
  }

  private evaluateLogicalStrength(content: string): number {
    // 简单的逻辑强度评估
    const keywords = ['因为', '所以', '因此', '然而', '但是'];
    let score = 5;
    keywords.forEach(keyword => {
      if (content.includes(keyword)) {
        score += 1;
      }
    });
    return Math.min(10, score);
  }

  private evaluateEvidenceStrength(content: string): number {
    // 简单的论据强度评估
    const evidenceKeywords = ['例如', '比如', '数据显示', '研究表明', '根据'];
    let score = 5;
    evidenceKeywords.forEach(keyword => {
      if (content.includes(keyword)) {
        score += 1.5;
      }
    });
    return Math.min(10, score);
  }

  private evaluateClarity(content: string): number {
    // 简单的表达清晰度评估
    const clarityKeywords = ['首先', '其次', '最后', '总之', '因此'];
    let score = 5;
    clarityKeywords.forEach(keyword => {
      if (content.includes(keyword)) {
        score += 1;
      }
    });
    return Math.min(10, score);
  }

  private evaluateInnovation(content: string): number {
    // 简单的创新性评估
    const innovationKeywords = ['创新', '新的', '独特', '创新', '创新'];
    let score = 5;
    innovationKeywords.forEach(keyword => {
      if (content.includes(keyword)) {
        score += 1;
      }
    });
    return Math.min(10, score);
  }

  private generateSuggestions(argument: DebateArgument): string[] {
    const suggestions: string[] = [];
    const analysis = this.analyzeArgument(argument);
    
    if (analysis.logicalStrength < 7) {
      suggestions.push('建议加强论点的逻辑性');
    }
    if (analysis.evidenceStrength < 7) {
      suggestions.push('建议增加更多证据和例子');
    }
    if (analysis.clarityScore < 7) {
      suggestions.push('建议提高表达的清晰度');
    }
    
    return suggestions;
  }

  private generateJudgeFeedback(judge: DebateAgent, argument: DebateArgument, analysis: ArgumentAnalysis): string {
    const feedbackTemplates = [
      `${judge.name}评分：总体来说，这个论点在逻辑方面表现不错，但在表达方面还有提升空间。`,
      `${judge.name}点评：论点的思路值得肯定，但需要更多证据支持。`,
    ];
    
    return feedbackTemplates[Math.floor(Math.random() * feedbackTemplates.length)];
  }

  private calculateScoreBasedWinner(teams: DebateTeam[]): { teamId: string; score: number } {
    let maxScore = -1;
    let winnerId = teams[0]?.id || '';
    
    teams.forEach(team => {
      if (team.score > maxScore) {
        maxScore = team.score;
        winnerId = team.id;
      }
    });
    
    return { teamId: winnerId, score: maxScore };
  }

  private calculateVoteBasedWinner(state: DebateState): { teamId: string; votes: number } {
    const voteCounts: { [teamId: string]: number } = {};
    state.teams.forEach(team => {
      voteCounts[team.id] = state.votes.filter(v => v.winningTeamId === team.id).length;
    });
    
    let maxVotes = -1;
    let winnerId = state.teams[0]?.id || '';
    
    state.teams.forEach(team => {
      if (voteCounts[team.id] > maxVotes) {
        maxVotes = voteCounts[team.id];
        winnerId = team.id;
      }
    });
    
    return { teamId: winnerId, votes: maxVotes };
  }

  private combineResults(winnerByScore: { teamId: string; score: number }, winnerByVote: { teamId: string; votes: number }, state: DebateState): { teamId: string; reasoning: string } {
    // 如果分数和投票结果一致
    if (winnerByScore.teamId === winnerByVote.teamId) {
      return {
        teamId: winnerByScore.teamId, 
        reasoning: '综合评分和投票结果一致'
      };
    }
    
    // 60% 基于分数，40% 基于投票
    const scoreWeight = 0.6;
    const voteWeight = 0.4;
    
    // 归一化分数和投票数
    const teams = state.teams;
    const maxScore = Math.max(...teams.map(t => t.score));
    const maxVotes = Math.max(...teams.map(t => state.votes.filter(v => v.winningTeamId === t.id).length));
    
    let finalWinnerId = winnerByScore.teamId;
    let maxFinalScore = -1;
    
    teams.forEach(team => {
      const normalizedScore = maxScore > 0 ? (team.score / maxScore) : 0;
      const teamVotes = state.votes.filter(v => v.winningTeamId === team.id).length;
      const normalizedVotes = maxVotes > 0 ? (teamVotes / maxVotes) : 0;
      
      const finalScore = normalizedScore * scoreWeight + normalizedVotes * voteWeight;
      
      if (finalScore > maxFinalScore) {
        maxFinalScore = finalScore;
        finalWinnerId = team.id;
      }
    });
    
    return {
      teamId: finalWinnerId,
      reasoning: '综合评分和投票结果',
    };
  }

  private getTopArguments(args: DebateArgument[], count: number): DebateArgument[] {
    // 根据平均分数排序，取前count个
    return [...args]
      .sort((a, b) => {
        const aAvg = a.scores.length > 0 
          ? a.scores.reduce((s, sc) => s + sc.score, 0) / a.scores.length 
          : 0;
        const bAvg = b.scores.length > 0 
          ? b.scores.reduce((s, sc) => s + sc.score, 0) / b.scores.length 
          : 0;
        return bAvg - aAvg;
      })
      .slice(0, count);
  }
}
