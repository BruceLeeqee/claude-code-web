export interface VimState {
  mode: 'normal' | 'insert' | 'visual' | 'command';
  commandBuffer: string;
}

export interface VimKeyEvent {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * Lightweight Vim-key simulation layer for browser editor integration.
 */
export class VimKeymapSimulator {
  private state: VimState = {
    mode: 'normal',
    commandBuffer: '',
  };

  getState(): VimState {
    return { ...this.state };
  }

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
