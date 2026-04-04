/**
 * 浏览器内 Vim 按键状态机（极简）：模式切换与命令行缓冲演示。
 */
/** 当前模式与命令缓冲 */
export interface VimState {
  mode: 'normal' | 'insert' | 'visual' | 'command';
  commandBuffer: string;
}

/** 按键事件（修饰键占位） */
export interface VimKeyEvent {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** 极简 Vim 模式模拟器 */
export class VimKeymapSimulator {
  private state: VimState = {
    mode: 'normal',
    commandBuffer: '',
  };

  /** 返回当前状态副本 */
  getState(): VimState {
    return { ...this.state };
  }

  /** 处理单键并返回新状态（i/Escape/: 等） */
  handle(event: VimKeyEvent): VimState {
    if (event.key === 'i' && this.state.mode === 'normal') {
      this.state.mode = 'insert';
      return this.getState();
    }

    if (event.key === 'Escape') {
      this.state.mode = 'normal';
      this.state.commandBuffer = '';
      return this.getState();
    }

    if (event.key === ':' && this.state.mode === 'normal') {
      this.state.mode = 'command';
      this.state.commandBuffer = ':';
      return this.getState();
    }

    if (this.state.mode === 'command') {
      if (event.key === 'Enter') {
        this.state.mode = 'normal';
        this.state.commandBuffer = '';
      } else {
        this.state.commandBuffer += event.key;
      }
    }

    return this.getState();
  }
}
