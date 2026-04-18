import { Injectable, signal } from '@angular/core';

// 协作模式类型
export type CollaborationMode = 'battle' | 'coop' | 'pipeline' | 'storm' | 'contest';

// 模式配置接口
interface ModeConfig {
  id: CollaborationMode;
  name: string;
  description: string;
  icon: string;
  color: string;
  minAgents: number;
  maxAgents: number;
  rules: string[];
  scoringMethod: string;
  turnBased: boolean;
  debateRounds?: number;
}

// 模式状态接口
interface ModeState {
  currentMode: CollaborationMode;
  modes: ModeConfig[];
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class ModeManagerService {
  // 模式状态信号
  private modeState = signal<ModeState>({
    currentMode: 'battle',
    modes: [
      {
        id: 'battle',
        name: '对抗模式',
        description: '智能体之间的辩论和竞争',
        icon: '▣',
        color: '#ff4444',
        minAgents: 2,
        maxAgents: 10,
        rules: ['轮流发言', '互相质疑', '投票表决', '胜者得分'],
        scoringMethod: '辩论胜率',
        turnBased: true,
        debateRounds: 5,
      },
      {
        id: 'coop',
        name: '协作模式',
        description: '智能体共同解决问题',
        icon: '◎',
        color: '#4488ff',
        minAgents: 2,
        maxAgents: 20,
        rules: ['共享上下文', '并行工作', '实时同步', '共同目标'],
        scoringMethod: '团队总分',
        turnBased: false,
      },
      {
        id: 'pipeline',
        name: '流水线模式',
        description: '智能体按顺序处理任务',
        icon: '◇',
        color: '#44ff88',
        minAgents: 2,
        maxAgents: 10,
        rules: ['顺序处理', '依赖传递', '质量检查', '阶段验收'],
        scoringMethod: '流水线效率',
        turnBased: true,
      },
      {
        id: 'storm',
        name: '脑暴模式',
        description: '智能体自由提出想法',
        icon: '✦',
        color: '#ffdd00',
        minAgents: 3,
        maxAgents: 15,
        rules: ['自由发言', '无批评环境', '数量优先', '组合改进'],
        scoringMethod: '创意评分',
        turnBased: false,
      },
      {
        id: 'contest',
        name: '竞赛模式',
        description: '智能体竞争完成任务',
        icon: '⚄',
        color: '#ff66aa',
        minAgents: 2,
        maxAgents: 10,
        rules: ['同时开始', '独立完成', '结果对比', '最优获胜'],
        scoringMethod: '任务完成度',
        turnBased: false,
      }
    ],
    isActive: false
  });

  // 公开的状态信号
  currentMode = this.modeState.asReadonly();

  // 切换模式
  switchMode(mode: CollaborationMode): void {
    this.modeState.update(state => ({
      ...state,
      currentMode: mode
    }));
  }

  // 启动模式
  startMode(): void {
    this.modeState.update(state => ({
      ...state,
      isActive: true
    }));
  }

  // 停止模式
  stopMode(): void {
    this.modeState.update(state => ({
      ...state,
      isActive: false
    }));
  }

  // 切换运行状态
  toggleMode(): void {
    const state = this.modeState();
    this.modeState.update(current => ({
      ...current,
      isActive: !state.isActive
    }));
  }

  // 获取当前模式配置
  getCurrentModeConfig(): ModeConfig {
    const state = this.modeState();
    return state.modes.find(mode => mode.id === state.currentMode) || state.modes[0];
  }

  // 获取所有模式配置
  getAllModes(): ModeConfig[] {
    return this.modeState().modes;
  }

  // 验证当前模式的Agent数量是否符合要求
  validateAgentCount(count: number): boolean {
    const state = this.modeState();
    const currentMode = state.modes.find(mode => mode.id === state.currentMode);
    if (!currentMode) return false;
    return count >= currentMode.minAgents && count <= currentMode.maxAgents;
  }

  // 获取当前模式的Agent数量建议
  getAgentCountRecommendation(): { min: number; max: number; optimal: number } {
    const state = this.modeState();
    const currentMode = state.modes.find(mode => mode.id === state.currentMode);
    if (!currentMode) return { min: 2, max: 10, optimal: 5 };
    return {
      min: currentMode.minAgents,
      max: currentMode.maxAgents,
      optimal: Math.floor((currentMode.minAgents + currentMode.maxAgents) / 2),
    };
  }

  // 获取当前模式是否为轮流制
  isTurnBased(): boolean {
    const state = this.modeState();
    const currentMode = state.modes.find(mode => mode.id === state.currentMode);
    return currentMode?.turnBased ?? false;
  }

  // 获取当前模式的辩论轮数
  getDebateRounds(): number {
    const state = this.modeState();
    const currentMode = state.modes.find(mode => mode.id === state.currentMode);
    return currentMode?.debateRounds ?? 3;
  }
}
