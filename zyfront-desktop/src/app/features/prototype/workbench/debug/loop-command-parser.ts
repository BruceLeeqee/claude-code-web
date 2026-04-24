import type { LoopRequest, LoopTaskType } from './loop-command.types';
import { LoopTaskRouterService } from './loop-task-router.service';

const taskRouter = new LoopTaskRouterService();

function parseDurationToMs(raw: string): number | null {
  const match = raw.trim().match(/^(\d+)(ms|s|m|h)?$/i);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (match[2] ?? 's').toLowerCase();
  if (unit === 'ms') return value;
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60_000;
  if (unit === 'h') return value * 3_600_000;
  return null;
}

export function parseLoopCommand(input: string): LoopRequest | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/loop')) return null;

  const body = trimmed.slice('/loop'.length).trim();
  if (!body) return null;

  const request: LoopRequest = { objective: body };
  const teamMatch = body.match(/--team=([^\s]+)/i);
  if (teamMatch?.[1]) request.teamName = teamMatch[1].trim().toLowerCase();

  const taskTypeMatch = body.match(/--task-type=([^\s]+)/i);
  if (taskTypeMatch?.[1]) {
    const parsedTaskType = taskTypeMatch[1].trim().toLowerCase() as LoopTaskType;
    request.taskType = parsedTaskType;
  }

  const maxIterationsMatch = body.match(/--max-iterations=(\d+)/i);
  if (maxIterationsMatch?.[1]) {
    request.maxIterations = Number.parseInt(maxIterationsMatch[1], 10);
  }

  const everyMatch = body.match(/--every=([^\s]+)/i);
  if (everyMatch?.[1]) {
    request.scheduleEveryMs = parseDurationToMs(everyMatch[1]) ?? undefined;
  }

  if (/--auto-commit\b/i.test(body)) request.allowGitCommit = true;
  if (/--auto-push\b/i.test(body)) request.allowGitPush = true;
  if (/--require-review\b/i.test(body)) request.requireUserApprovalForRelease = true;

  request.objective = body
    .replace(/--max-iterations=\d+/gi, '')
    .replace(/--every=[^\s]+/gi, '')
    .replace(/--auto-commit\b/gi, '')
    .replace(/--auto-push\b/gi, '')
    .replace(/--require-review\b/gi, '')
    .replace(/--team=[^\s]+/gi, '')
    .replace(/--task-type=[^\s]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!request.taskType) {
    request.taskType = taskRouter.inferTaskType(request.objective);
  }

  return request.objective ? request : null;
}
