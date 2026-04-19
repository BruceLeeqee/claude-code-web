import { Injectable, signal } from '@angular/core';

// 评审阶段
export type ReviewPhase = 'preparation' | 'submission' | 'discussion' | 'voting' | 'result';

// 评审方案
export interface Proposal {
  id: string;
  authorId: string;
  title: string;
  description: string;
  category: string;
  createdAt: Date;
  score: number;
  votes: number;
  comments: Comment[];
}

// 评论
export interface Comment {
  id: string;
  authorId: string;
  content: string;
  timestamp: Date;
  type: 'positive' | 'negative' | 'neutral' | 'suggestion';
}

// 投票记录
export interface Vote {
  id: string;
  voterId: string;
  proposalId: string;
  score: number;
  timestamp: Date;
  comment: string;
}

// 评审员
export interface Reviewer {
  agentId: string;
  name: string;
  role: 'proposer' | 'reviewer' | 'judge';
  submittedProposals: number;
  castVotes: number;
}

// 评审结果
export interface ReviewResult {
  winner: Proposal | null;
  rankings: Proposal[];
  summary: string;
  divergences: string[];
}

// 评审状态
export interface ReviewState {
  phase: ReviewPhase;
  topic: string | null;
  proposals: Proposal[];
  reviewers: Reviewer[];
  votes: Vote[];
  result: ReviewResult | null;
  isActive: boolean;
  startTime: Date | null;
  endTime: Date | null;
}

@Injectable({ providedIn: 'root' })
export class ReviewModeService {
  private _state = signal<ReviewState>({
    phase: 'preparation',
    topic: null,
    proposals: [],
    reviewers: [],
    votes: [],
    result: null,
    isActive: false,
    startTime: null,
    endTime: null
  });

  state = this._state.asReadonly();

  // 预设方案类别
  private proposalCategories = [
    '架构设计',
    '流程优化',
    '新技术引入',
    '问题解决方案',
    '产品改进',
    '性能优化'
  ];

  // 预设方案模板
  private proposalTemplates = [
    { title: '模块化架构方案', category: '架构设计', description: '将系统拆分为独立的微服务模块' },
    { title: 'CI/CD流程优化', category: '流程优化', description: '改进构建和部署流程' },
    { title: 'AI技术整合', category: '新技术引入', description: '引入机器学习能力增强系统' },
    { title: '性能优化方案', category: '性能优化', description: '提升系统响应速度和吞吐量' }
  ];

  // 初始化评审
  initialize(topic: string, agentIds: string[]): void {
    const reviewers: Reviewer[] = agentIds.map(id => ({
      agentId: id,
      name: `评审员${id}`,
      role: this.assignRandomRole(),
      submittedProposals: 0,
      castVotes: 0
    }));

    this._state.update(state => ({
      ...state,
      phase: 'preparation',
      topic,
      proposals: [],
      reviewers,
      votes: [],
      result: null,
      isActive: false,
      startTime: null,
      endTime: null
    }));
  }

  // 分配随机角色
  private assignRandomRole(): 'proposer' | 'reviewer' | 'judge' {
    const roles: ('proposer' | 'reviewer' | 'judge')[] = ['proposer', 'reviewer', 'judge'];
    return roles[Math.floor(Math.random() * roles.length)];
  }

  // 开始评审流程
  start(): void {
    this._state.update(state => ({
      ...state,
      phase: 'submission',
      isActive: true,
      startTime: new Date()
    }));

    // 自动生成方案
    this.generateProposals();
  }

  // 生成方案
  private generateProposals(): void {
    const proposers = this._state().reviewers.filter(r => r.role === 'proposer');
    const numProposals = Math.max(3, proposers.length);

    for (let i = 0; i < numProposals; i++) {
      setTimeout(() => {
        if (this._state().phase !== 'submission') return;

        const proposer = proposers[i % proposers.length];
        const template = this.proposalTemplates[i % this.proposalTemplates.length];

        this.submitProposal(
          proposer.agentId,
          template.title,
          template.description,
          template.category
        );
      }, (i + 1) * 500);
    }

    setTimeout(() => this.nextPhase(), numProposals * 500 + 500);
  }

  // 提交方案
  submitProposal(authorId: string, title: string, description: string, category: string): void {
    const proposal: Proposal = {
      id: `proposal-${Date.now()}`,
      authorId,
      title,
      description,
      category,
      createdAt: new Date(),
      score: 0,
      votes: 0,
      comments: []
    };

    this._state.update(state => ({
      ...state,
      proposals: [...state.proposals, proposal],
      reviewers: state.reviewers.map(r =>
        r.agentId === authorId ? { ...r, submittedProposals: r.submittedProposals + 1 } : r
      )
    }));
  }

  // 进入下一阶段
  nextPhase(): void {
    const phases: ReviewPhase[] = ['preparation', 'submission', 'discussion', 'voting', 'result'];
    const currentIndex = phases.indexOf(this._state().phase);

    if (currentIndex < phases.length - 1) {
      const nextPhase = phases[currentIndex + 1];

      if (nextPhase === 'discussion') {
        this.generateComments();
      } else if (nextPhase === 'voting') {
        this.startVoting();
      } else if (nextPhase === 'result') {
        this.determineWinner();
      }

      this._state.update(state => ({
        ...state,
        phase: nextPhase
      }));
    }
  }

  // 生成评论
  private generateComments(): void {
    const reviewers = this._state().reviewers.filter(r => r.role === 'reviewer');
    const proposals = this._state().proposals;

    proposals.forEach(proposal => {
      reviewers.forEach(reviewer => {
        setTimeout(() => {
          if (this._state().phase !== 'discussion') return;

          this.addComment(
            reviewer.agentId,
            proposal.id,
            this.generateRandomComment(),
            this.getRandomCommentType()
          );
        }, Math.random() * 2000);
      });
    });

    setTimeout(() => this.nextPhase(), 3000);
  }

  // 添加评论
  addComment(authorId: string, proposalId: string, content: string, type: Comment['type']): void {
    const comment: Comment = {
      id: `comment-${Date.now()}`,
      authorId,
      content,
      timestamp: new Date(),
      type
    };

    this._state.update(state => ({
      ...state,
      proposals: state.proposals.map(p =>
        p.id === proposalId ? { ...p, comments: [...p.comments, comment] } : p
      )
    }));
  }

  // 开始投票
  private startVoting(): void {
    const judges = this._state().reviewers.filter(r => r.role === 'judge');
    const proposals = this._state().proposals;

    proposals.forEach(proposal => {
      judges.forEach(judge => {
        setTimeout(() => {
          if (this._state().phase !== 'voting') return;

          const score = Math.floor(Math.random() * 6) + 5;
          this.castVote(judge.agentId, proposal.id, score, '很好的方案');
        }, Math.random() * 1000);
      });
    });

    setTimeout(() => this.nextPhase(), 2000);
  }

  // 投票
  castVote(voterId: string, proposalId: string, score: number, comment: string): void {
    const vote: Vote = {
      id: `vote-${Date.now()}`,
      voterId,
      proposalId,
      score,
      timestamp: new Date(),
      comment
    };

    this._state.update(state => {
      const updatedProposals = state.proposals.map(p =>
        p.id === proposalId ? {
          ...p,
          votes: p.votes + 1,
          score: state.votes.length > 0 ?
            (p.score * state.votes.length + score) / (state.votes.length + 1) : score
        } : p
      );

      return {
        ...state,
        votes: [...state.votes, vote],
        proposals: updatedProposals,
        reviewers: state.reviewers.map(r =>
          r.agentId === voterId ? { ...r, castVotes: r.castVotes + 1 } : r
        )
      };
    });
  }

  // 确定获胜方案
  private determineWinner(): void {
    const sortedProposals = [...this._state().proposals].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.votes - a.votes;
    });

    const divergences = this.identifyDivergences();
    const summary = this.generateSummary(sortedProposals[0]);

    this._state.update(state => ({
      ...state,
      phase: 'result',
      isActive: false,
      endTime: new Date(),
      result: {
        winner: sortedProposals[0] || null,
        rankings: sortedProposals,
        summary,
        divergences
      }
    }));
  }

  // 识别分歧点
  private identifyDivergences(): string[] {
    const divergences: string[] = [];
    const proposals = this._state().proposals;

    if (proposals.length > 0) {
      divergences.push('方案之间在技术路线上有分歧');
      divergences.push('评审员对优先级有不同看法');
    }

    return divergences;
  }

  // 生成总结
  private generateSummary(winner: Proposal | null): string {
    if (!winner) return '没有提交方案';

    return `
评审总结:

获胜方案: ${winner.title}
作者: ${winner.authorId}
评分: ${winner.score.toFixed(1)}
票数: ${winner.votes}

该方案在创新性和可行性方面表现突出。
    `.trim();
  }

  // 生成随机评论
  private generateRandomComment(): string {
    const comments = [
      '这个方案很有创意！',
      '我认为这个方案很实用',
      '建议进一步优化细节',
      '这个方向值得探索',
      '考虑一下成本问题',
      '技术选型很合理',
      '创新点很突出',
      '需要更多的实施细节'
    ];
    return comments[Math.floor(Math.random() * comments.length)];
  }

  // 获取随机评论类型
  private getRandomCommentType(): Comment['type'] {
    const types: Comment['type'][] = ['positive', 'negative', 'neutral', 'suggestion'];
    return types[Math.floor(Math.random() * types.length)];
  }

  // 获取排名
  getRankings(): Proposal[] {
    return [...this._state().proposals].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.votes - a.votes;
    });
  }

  // 重置评审
  reset(): void {
    this._state.update(state => ({
      ...state,
      phase: 'preparation',
      topic: null,
      proposals: [],
      votes: [],
      result: null,
      isActive: false,
      startTime: null,
      endTime: null
    }));
  }
}
