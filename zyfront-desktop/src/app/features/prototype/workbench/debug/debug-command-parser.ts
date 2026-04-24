import { type DebugAction, type DebugDomain } from './debug-command.types';

export interface ParsedDebugCommand {
  domain: DebugDomain;
  action?: DebugAction;
  args: string[];
  raw: string;
}

const DOMAINS = new Set<DebugDomain>(['prompt', 'memory', 'workbench', 'loop', 'task']);
const ACTIONS = new Set<DebugAction>(['latest', 'rebuild', 'pipeline', 'dream', 'sync', 'run', 'thinking', 'replay', 'restore', 'context', 'status', 'stop', 'resume', 'step']);

export function parseDebugCommand(input: string): ParsedDebugCommand | null {
  const trimmed = input.trim();

  // /task team=<X> objective=<Y> 命令
  if (trimmed.startsWith('/task')) {
    const body = trimmed.slice('/task'.length).trim();
    return { domain: 'task', action: 'run', args: [body], raw: trimmed };
  }

  // /loop 子命令: /loop status|stop|resume|step [sessionId]
  if (trimmed.startsWith('/loop')) {
    const body = trimmed.slice('/loop'.length).trim();
    if (!body) return null;
    const parts = body.split(/\s+/).filter(Boolean);
    const subcommand = parts[0] as DebugAction | undefined;
    const loopActions: DebugAction[] = ['status', 'stop', 'resume', 'step'];
    if (subcommand && loopActions.includes(subcommand)) {
      return { domain: 'loop', action: subcommand, args: parts.slice(1), raw: trimmed };
    }
    // /loop <objective> 不是 debug 命令，由 loop-command-parser 处理
    return null;
  }

  if (!trimmed.startsWith('/debug')) return null;

  const parts = trimmed.slice('/debug'.length).trim().split(/\s+/).filter(Boolean);
  const domain = parts[0] as DebugDomain | undefined;
  if (!domain || !DOMAINS.has(domain)) return null;

  const maybeAction = parts[1] as DebugAction | undefined;
  const action = maybeAction && ACTIONS.has(maybeAction) ? maybeAction : undefined;
  const args = parts.slice(action ? 2 : 1);

  return { domain, action, args, raw: trimmed };
}
