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
        color: '#ff4444'
      },
      {
        id: 'coop',
        name: '协作模式',
        description: '智能体共同解决问题',
        icon: '◎',
        color: '#4488ff'
      },
      {
        id: 'pipeline',
        name: '流水线模式',
        description: '智能体按顺序处理任务',
        icon: '◇',
        color: '#44ff88'
      },
      {
        id: 'storm',
        name: '脑暴模式',
        description: '智能体自由提出想法',
        icon: '✦',
        color: '#ffdd00'
      },
      {
        id: 'contest',
        name: '竞赛模式',
        description: '智能体竞争完成任务',
        icon: '⚄',
        color: '#ff66aa'
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

  // 获取当前模式配置
  getCurrentModeConfig(): ModeConfig {
    const state = this.modeState();
    return state.modes.find(mode => mode.id === state.currentMode) || state.modes[0];
  }

  // 获取所有模式配置
  getAllModes(): ModeConfig[] {
    return this.modeState().modes;
  }
}
