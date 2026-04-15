import type { TeammateMode } from './multi-agent.types';

export interface BackendSetupInput {
  mode: Extract<TeammateMode, 'tmux' | 'iterm2'>;
  platform: string;
  wslStatusAvailable?: boolean;
  tmuxVersionAvailable?: boolean;
  termProgram?: string;
}

export function buildBackendBlockingReason(input: BackendSetupInput): string {
  if (input.mode === 'tmux') {
    if (input.platform.includes('win')) {
      return 'tmux backend unavailable on Windows: WSL2 + Ubuntu + tmux required';
    }
    return 'tmux backend unavailable: tmux -V / TMUX environment not detected';
  }
  return 'iterm2 backend unavailable: TERM_PROGRAM=iTerm.app not detected';
}

export function buildBackendSetupHints(input: BackendSetupInput): string[] {
  const isWindows = input.platform.includes('win');
  const isMac = input.platform.includes('mac');
  const hints: string[] = [];

  if (input.mode === 'tmux') {
    if (isWindows) {
      if (input.wslStatusAvailable === false) {
        hints.push('先启用 Windows Subsystem for Linux (WSL2)。');
      }
      if (input.tmuxVersionAvailable === false) {
        hints.push('在 WSL Ubuntu 中安装 tmux：`sudo apt install tmux`。');
      }
      hints.push('安装 Ubuntu 发行版后，在 WSL 中再次确认 `wsl tmux -V` 可用。');
      hints.push('tmux 模式只在 WSL2 环境中可用，桌面端仍运行在 Windows 原生 Electron。');
      return hints;
    }
    hints.push('先执行 `tmux -V` 确认可用；若缺失请先安装 tmux。');
    hints.push('从 tmux 会话内启动应用，确保环境变量 `TMUX` 可见。');
    hints.push('若仍失败，可先切换到 auto 或 in-process 继续执行任务。');
    return hints;
  }

  if (!isMac) {
    hints.push('iTerm2 仅在 macOS 可用；当前平台请改用 in-process 或 auto。');
    return hints;
  }
  hints.push('请使用 iTerm2 启动应用，并确保 `TERM_PROGRAM=iTerm.app`。');
  hints.push('可在终端执行 `echo $TERM_PROGRAM` 自检。');
  hints.push('若仍失败，可先切换到 auto 或 in-process。');
  return hints;
}
