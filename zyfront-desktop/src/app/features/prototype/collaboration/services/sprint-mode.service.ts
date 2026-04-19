import { Injectable, signal } from '@angular/core';

// 冲刺阶段
export type SprintPhase = 'preparation' | 'running' | 'reviewing' | 'result';

// 任务状态
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// 评分标准
export interface ScoringCriteria {
  name: string;
  weight: number;
  maxScore: number;
}

// 选手结果
export interface ContestantResult {
  agentId: string;
  taskId: string;
  completionTime: number; // 毫秒
  qualityScore: number;
  totalScore: number;
  status: TaskStatus;
  startTime: Date | null;
  endTime: Date | null;
}

// 冲刺任务
export interface SprintTask {
  id: string;
  title: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  basePoints: number;
  timeLimit: number; // 秒
}

// 选手
export interface Contestant {
  agentId: string;
  name: string;
  score: number;
  rank: number;
  completedTasks: number;
  totalTime: number;
  results: ContestantResult[];
}

// 冲刺状态
export interface SprintState {
  phase: SprintPhase;
  task: SprintTask | null;
  contestants: Contestant[];
  criteria: ScoringCriteria[];
  startTime: Date | null;
  endTime: Date | null;
  isActive: boolean;
  champion: { agentId: string; name: string; score: number } | null;
}

@Injectable({ providedIn: 'root' })
export class SprintModeService {
  private _state = signal<SprintState>({
    phase: 'preparation',
    task: null,
    contestants: [],
    criteria: [
      { name: '完成速度', weight: 0.4, maxScore: 100 },
      { name: '完成质量', weight: 0.4, maxScore: 100 },
      { name: '创新性', weight: 0.2, maxScore: 100 }
    ],
    startTime: null,
    endTime: null,
    isActive: false,
    champion: null
  });

  state = this._state.asReadonly();

  // 预设任务
  private presetTasks: SprintTask[] = [
    { id: 'task1', title: '代码重构', description: '优化指定代码的性能', difficulty: 'medium', basePoints: 100, timeLimit: 300 },
    { id: 'task2', title: 'Bug修复', description: '快速定位并修复多个Bug', difficulty: 'easy', basePoints: 80, timeLimit: 180 },
    { id: 'task3', title: '架构设计', description: '设计新系统的架构方案', difficulty: 'hard', basePoints: 150, timeLimit: 600 },
    { id: 'task4', title: '性能优化', description: '提升系统性能指标', difficulty: 'hard', basePoints: 120, timeLimit: 480 },
    { id: 'task5', title: '文档编写', description: '编写完整的技术文档', difficulty: 'medium', basePoints: 90, timeLimit: 360 }
  ];

  // 初始化冲刺
  initialize(agentIds: string[], taskId?: string): void {
    const task = taskId ? (this.presetTasks.find(t => t.id === taskId) || this.getRandomTask()) : this.getRandomTask();
    const contestants: Contestant[] = agentIds.map(id => ({
      agentId: id,
      name: `选手${id}`,
      score: 0,
      rank: 0,
      completedTasks: 0,
      totalTime: 0,
      results: []
    }));

    this._state.update(state => ({
      ...state,
      phase: 'preparation',
      task,
      contestants,
      isActive: false,
      startTime: null,
      endTime: null,
      champion: null
    }));
  }

  // 开始冲刺
  start(): void {
    if (!this._state().task) return;

    this._state.update(state => ({
      ...state,
      phase: 'running',
      isActive: true,
      startTime: new Date()
    }));

    // 开始模拟选手执行任务
    this.simulateContestants();
  }

  // 模拟选手执行
  private simulateContestants(): void {
    const contestants = this._state().contestants;
    const task = this._state().task;
    if (!task) return;

    contestants.forEach((contestant, index) => {
      const delay = (index + 1) * 1000;
      setTimeout(() => {
        if (this._state().phase !== 'running') return;

        const timeTaken = Math.random() * task.timeLimit * 1000 + 10000;
        const qualityScore = Math.random() * 60 + 40;
        const innovationScore = Math.random() * 60 + 40;

        const result: ContestantResult = {
          agentId: contestant.agentId,
          taskId: task.id,
          completionTime: timeTaken,
          qualityScore: qualityScore,
          totalScore: this.calculateTotalScore(timeTaken, qualityScore, innovationScore, task),
          status: 'completed',
          startTime: new Date(),
          endTime: new Date(Date.now() + timeTaken)
        };

        this.updateContestantResult(contestant.agentId, result);

        // 检查是否所有选手都完成了
        const allCompleted = this._state().contestants.every(c =>
          c.results.length > 0 && c.results[0].status === 'completed'
        );

        if (allCompleted) {
          this.finishSprint();
        }
      }, delay);
    });
  }

  // 计算总分数
  private calculateTotalScore(timeTaken: number, quality: number, innovation: number, task: SprintTask): number {
    const maxTime = task.timeLimit * 1000;
    const timeScore = Math.max(0, 100 * (1 - timeTaken / maxTime));
    const speedWeight = 0.4;
    const qualityWeight = 0.4;
    const innovationWeight = 0.2;

    return timeScore * speedWeight + quality * qualityWeight + innovation * innovationWeight + task.basePoints;
  }

  // 更新选手结果
  private updateContestantResult(agentId: string, result: ContestantResult): void {
    this._state.update(state => {
      const updatedContestants = state.contestants.map(c => {
        if (c.agentId === agentId) {
          const updatedC: Contestant = {
            ...c,
            score: c.score + result.totalScore,
            completedTasks: c.completedTasks + 1,
            totalTime: c.totalTime + result.completionTime,
            results: [...c.results, result]
          };
          return updatedC;
        }
        return c;
      });

      return {
        ...state,
        contestants: updatedContestants
      };
    });
  }

  // 完成冲刺
  private finishSprint(): void {
    this.calculateRanks();
    this.determineChampion();

    this._state.update(state => ({
      ...state,
      phase: 'result',
      isActive: false,
      endTime: new Date()
    }));
  }

  // 计算排名
  private calculateRanks(): void {
    this._state.update(state => {
      const sortedContestants = [...state.contestants].sort((a, b) => b.score - a.score);
      const rankedContestants = sortedContestants.map((contestant, index) => ({
        ...contestant,
        rank: index + 1
      }));
      return { ...state, contestants: rankedContestants };
    });
  }

  // 确定冠军
  private determineChampion(): void {
    const sorted = [...this._state().contestants].sort((a, b) => b.score - a.score);
    if (sorted.length > 0) {
      this._state.update(state => ({
        ...state,
        champion: {
          agentId: sorted[0].agentId,
          name: sorted[0].name,
          score: sorted[0].score
        }
      }));
    }
  }

  // 获取随机任务
  private getRandomTask(): SprintTask {
    return this.presetTasks[Math.floor(Math.random() * this.presetTasks.length)];
  }

  // 获取所有可用任务
  getAvailableTasks(): SprintTask[] {
    return [...this.presetTasks];
  }

  // 获取排名列表
  getLeaderboard(): Contestant[] {
    return [...this._state().contestants].sort((a, b) => a.rank - b.rank);
  }

  // 重置冲刺
  reset(): void {
    this._state.update(state => ({
      ...state,
      phase: 'preparation',
      task: null,
      contestants: [],
      startTime: null,
      endTime: null,
      isActive: false,
      champion: null
    }));
  }
}
