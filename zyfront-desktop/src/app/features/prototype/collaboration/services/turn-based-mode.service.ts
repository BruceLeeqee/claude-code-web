import { Injectable, signal } from '@angular/core';

// 回合阶段
export type TurnPhase = 'preparation' | 'playing' | 'turn' | 'result';

// 策略类型
export type StrategyType = 'aggressive' | 'defensive' | 'balanced' | 'random';

// 策略接口
export interface Strategy {
  id: string;
  name: string;
  type: StrategyType;
  description: string;
  payoff: { [key in StrategyType]: number };
}

// 决策树节点
export interface DecisionTreeNode {
  id: string;
  agentId: string;
  strategyId: string;
  strategyType: StrategyType;
  timestamp: Date;
  score: number;
  children: DecisionTreeNode[];
  parentId: string | null;
}

// 玩家状态
export interface Player {
  agentId: string;
  name: string;
  totalScore: number;
  currentStrategy: Strategy | null;
  strategyHistory: Strategy[];
  decisionHistory: DecisionTreeNode[];
}

// 回合状态
export interface TurnBasedState {
  phase: TurnPhase;
  currentTurn: number;
  totalTurns: number;
  players: Player[];
  decisionTree: DecisionTreeNode | null;
  strategies: Strategy[];
  isActive: boolean;
  startTime: Date | null;
  endTime: Date | null;
  result: { winner: string | null; scores: { [key: string]: number } };
}

@Injectable({ providedIn: 'root' })
export class TurnBasedModeService {
  private _state = signal<TurnBasedState>({
    phase: 'preparation',
    currentTurn: 0,
    totalTurns: 10,
    players: [],
    decisionTree: null,
    strategies: [],
    isActive: false,
    startTime: null,
    endTime: null,
    result: { winner: null, scores: {} }
  });

  state = this._state.asReadonly();

  // 预设策略
  private presetStrategies: Strategy[] = [
    {
      id: 'strat1',
      name: '激进策略',
      type: 'aggressive',
      description: '高风险高回报',
      payoff: { aggressive: 5, defensive: 3, balanced: 7, random: 6 },
    },
    {
      id: 'strat2',
      name: '防御策略',
      type: 'defensive',
      description: '保守但稳定',
      payoff: { aggressive: 3, defensive: 4, balanced: 3, random: 2 },
    },
    {
      id: 'strat3',
      name: '平衡策略',
      type: 'balanced',
      description: '平衡的策略',
      payoff: { aggressive: 4, defensive: 5, balanced: 4, random: 5 },
    },
    {
      id: 'strat4',
      name: '随机策略',
      type: 'random',
      description: '随机选择策略',
      payoff: { aggressive: 3, defensive: 3, balanced: 3, random: 3 },
    }
  ];

  // 初始化回合博弈
  initialize(agentIds: string[]): void {
    const players: Player[] = agentIds.map(id => ({
      agentId: id,
      name: `玩家${id}`,
      totalScore: 0,
      currentStrategy: null,
      strategyHistory: [],
      decisionHistory: []
    }));

    this._state.update(state => ({
      ...state,
      phase: 'preparation',
      currentTurn: 0,
      players,
      strategies: [...this.presetStrategies],
      isActive: false,
      startTime: null,
      endTime: null,
      result: { winner: null, scores: {} }
    }));
  }

  // 开始游戏
  startGame(): void {
    this._state.update(state => ({
      ...state,
      phase: 'playing',
      currentTurn: 1,
      isActive: true,
      startTime: new Date(),
      decisionTree: null
    }));

    // 开始游戏循环
    this.simulateGame();
  }

  // 模拟游戏
  private simulateGame(): void {
    for (let turn = 1; turn <= this._state().totalTurns; turn++) {
      setTimeout(() => {
        if (this._state().phase !== 'playing') return;

        this.simulateTurn(turn);

        if (turn === this._state().totalTurns) {
          this.endGame();
        }
      }, turn * 500);
    }
  }

  // 模拟回合
  private simulateTurn(turn: number): void {
    this._state.update(state => {
      const updatedPlayers = state.players.map(player => {
        const strategy = this.chooseStrategy(player);
        return {
          ...player,
          currentStrategy: strategy,
          strategyHistory: [...player.strategyHistory, strategy]
        };
      });

      // 计算回合评分
      const scoredPlayers = this.calculateTurnScores(updatedPlayers);

      // 更新决策树
      const newTree = this.updateDecisionTree(scoredPlayers, state.decisionTree, turn);

      return {
        ...state,
        players: scoredPlayers,
        currentTurn: turn,
        decisionTree: newTree
      };
    });
  }

  // 选择策略
  private chooseStrategy(player: Player): Strategy {
    // 简单的策略选择：基于历史学习
    if (player.strategyHistory.length > 0) {
      const last = player.strategyHistory[player.strategyHistory.length - 1];
      // 70%概率延续之前的选择，30%尝试新策略
      if (Math.random() < 0.7) {
        return last;
      }
    }
    return this.presetStrategies[Math.floor(Math.random() * this.presetStrategies.length)];
  }

  // 计算回合评分
  private calculateTurnScores(players: Player[]): Player[] {
    return players.map(player => {
      const strategy = player.currentStrategy;
      if (!strategy) return player;

      let roundScore = 0;

      // 计算与其他玩家策略的互动得分
      players.forEach(otherPlayer => {
        if (otherPlayer.agentId !== player.agentId && otherPlayer.currentStrategy) {
          const otherStrategy = otherPlayer.currentStrategy;
          const payoff = strategy.payoff[otherStrategy.type] || 0;
          roundScore += payoff;
        }
      });

      return {
        ...player,
        totalScore: player.totalScore + roundScore
      };
    });
  }

  // 更新决策树
  private updateDecisionTree(players: Player[], tree: DecisionTreeNode | null, turn: number): DecisionTreeNode {
    const root = tree || {
      id: 'root',
      agentId: 'root',
      strategyId: 'root',
      strategyType: 'balanced',
      timestamp: new Date(),
      score: 0,
      children: [],
      parentId: null
    };

    const turnNode: DecisionTreeNode = {
      id: `turn-${turn}`,
      agentId: `turn-${turn}`,
      strategyId: 'turn',
      strategyType: 'balanced',
      timestamp: new Date(),
      score: 0,
      children: players.map(p => ({
        id: `decision-${p.agentId}-${turn}`,
        agentId: p.agentId,
        strategyId: p.currentStrategy?.id || '',
        strategyType: p.currentStrategy?.type || 'balanced',
        timestamp: new Date(),
        score: p.totalScore,
        children: [],
        parentId: `turn-${turn}`
      })),
      parentId: root.id
    };

    return {
      ...root,
      children: [...root.children, turnNode]
    };
  }

  // 结束游戏
  private endGame(): void {
    const players = this._state().players;
    const scores: { [key: string]: number } = {};
    players.forEach(p => {
      scores[p.agentId] = p.totalScore;
    });

    const winner = players.reduce((prev, current) =>
      prev.totalScore > current.totalScore ? prev : current
    ).agentId;

    this._state.update(state => ({
      ...state,
      phase: 'result',
      isActive: false,
      endTime: new Date(),
      result: { winner, scores }
    }));
  }

  // 获取策略演化历史
  getStrategyEvolution(agentId: string): StrategyType[] {
    const player = this._state().players.find(p => p.agentId === agentId);
    return player?.strategyHistory.map(s => s.type) || [];
  }

  // 检查是否收敛
  hasConverged(): boolean {
    const players = this._state().players;
    if (players.length < 2) return false;

    // 检查最近3回合策略是否稳定
    for (const player of players) {
      if (player.strategyHistory.length < 3) return false;
      const last3 = player.strategyHistory.slice(-3);
      const isStable = last3.every(s => s.type === last3[0].type);
      if (!isStable) return false;
    }
    return true;
  }

  // 获取可用策略
  getAvailableStrategies(): Strategy[] {
    return [...this.presetStrategies];
  }

  // 重置游戏
  reset(): void {
    this._state.update(state => ({
      ...state,
      phase: 'preparation',
      currentTurn: 0,
      players: [],
      decisionTree: null,
      isActive: false,
      startTime: null,
      endTime: null,
      result: { winner: null, scores: {} }
    }));
  }
}
