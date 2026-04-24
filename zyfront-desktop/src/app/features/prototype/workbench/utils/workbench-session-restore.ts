import { THINKING_BLOCKS_SESSION_KEY, REPLAY_STATE_SESSION_KEY } from '../services/terminal/terminal-display.types';

export interface WorkbenchSessionRestoreState {
  thinkingBlocks?: unknown;
  replayState?: unknown;
}

export interface WorkbenchSessionRestoreResult {
  restoredThinkingBlocks: boolean;
  restoredReplayState: boolean;
  versionMatched: boolean;
}

const CURRENT_SESSION_VERSION = 2;
const SESSION_VERSION_KEY = 'zyfront:workbench:session-restore:v2';

export function restoreWorkbenchSessionState(): WorkbenchSessionRestoreResult {
  const result: WorkbenchSessionRestoreResult = {
    restoredThinkingBlocks: false,
    restoredReplayState: false,
    versionMatched: true,
  };

  try {
    const versionRaw = sessionStorage.getItem(SESSION_VERSION_KEY);
    if (versionRaw && Number.parseInt(versionRaw, 10) !== CURRENT_SESSION_VERSION) {
      result.versionMatched = false;
      return result;
    }

    const thinkingRaw = sessionStorage.getItem(THINKING_BLOCKS_SESSION_KEY);
    if (thinkingRaw) {
      JSON.parse(thinkingRaw);
      result.restoredThinkingBlocks = true;
    }
  } catch {
    result.restoredThinkingBlocks = false;
  }

  try {
    const replayRaw = sessionStorage.getItem(REPLAY_STATE_SESSION_KEY);
    if (replayRaw) {
      JSON.parse(replayRaw);
      result.restoredReplayState = true;
    }
  } catch {
    result.restoredReplayState = false;
  }

  try {
    sessionStorage.setItem(SESSION_VERSION_KEY, String(CURRENT_SESSION_VERSION));
  } catch {
    // ignore
  }

  return result;
}
