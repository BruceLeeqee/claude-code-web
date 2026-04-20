import { Injectable, inject, signal } from '@angular/core';
import { TaskPlannerService, type SimplePlan } from './task-planner.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import type { TaskType } from '../domain/types';

export interface SingleAgentExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  taskType: TaskType;
}

export interface SingleAgentExecutionLog {
  id: string;
  request: string;
  taskType: TaskType;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class SingleAgentExecutionService {
  private readonly planner = inject(TaskPlannerService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly executionLogs = signal<SingleAgentExecutionLog[]>([]);
  private readonly currentExecution = signal<SingleAgentExecutionLog | null>(null);

  readonly logs = this.executionLogs;
  readonly current = this.currentExecution;

  async execute(
    request: string,
    executor: (request: string, taskType: TaskType) => Promise<string>,
  ): Promise<SingleAgentExecutionResult> {
    const plan = this.planner.planSimple(request);
    const startTime = Date.now();

    const log: SingleAgentExecutionLog = {
      id: `single-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      request,
      taskType: plan.task.type,
      startTime,
      status: 'running',
    };

    this.currentExecution.set(log);
    this.executionLogs.update(logs => [log, ...logs].slice(0, 100));

    this.eventBus.emit({
      type: EVENT_TYPES.MODE_SINGLE,
      sessionId: 'single-agent-execution',
      source: 'system',
      payload: {
        mode: 'single',
        reason: '简单任务，使用单Agent执行',
        timestamp: startTime,
      },
    });

    try {
      const output = await executor(request, plan.task.type);
      const endTime = Date.now();

      log.status = 'completed';
      log.endTime = endTime;
      log.output = output;

      this.executionLogs.update(logs =>
        logs.map(l => l.id === log.id ? log : l)
      );

      return {
        success: true,
        output,
        durationMs: endTime - startTime,
        taskType: plan.task.type,
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      log.status = 'failed';
      log.endTime = endTime;
      log.error = errorMessage;

      this.executionLogs.update(logs =>
        logs.map(l => l.id === log.id ? log : l)
      );

      return {
        success: false,
        error: errorMessage,
        durationMs: endTime - startTime,
        taskType: plan.task.type,
      };
    } finally {
      this.currentExecution.set(null);
    }
  }

  getExecutionStats(): {
    total: number;
    completed: number;
    failed: number;
    avgDurationMs: number;
  } {
    const logs = this.executionLogs();
    const completed = logs.filter(l => l.status === 'completed');
    const failed = logs.filter(l => l.status === 'failed');

    const totalDuration = completed.reduce((sum, l) => {
      return sum + (l.endTime && l.startTime ? l.endTime - l.startTime : 0);
    }, 0);

    return {
      total: logs.length,
      completed: completed.length,
      failed: failed.length,
      avgDurationMs: completed.length > 0 ? totalDuration / completed.length : 0,
    };
  }

  clearLogs(): void {
    this.executionLogs.set([]);
  }
}
