import { Injectable, inject, signal } from '@angular/core';
import { TaskPlannerService, type SimplePlan, type TaskValidationResult } from './task-planner.service';
import { PlanModeTriggerService, type ExecutionConstraint } from './plan-mode-trigger.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import type { TaskType, TaskNode } from '../domain/types';

export interface SingleAgentExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  taskType: TaskType;
  validation?: TaskValidationResult;
  paused?: boolean;
  pauseReason?: string;
}

export interface SingleAgentExecutionLog {
  id: string;
  request: string;
  taskType: TaskType;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'paused';
  output?: string;
  error?: string;
  toolCallCount: number;
  tokenUsage: number;
  fileModifications: string[];
}

@Injectable({ providedIn: 'root' })
export class SingleAgentExecutionService {
  private readonly planner = inject(TaskPlannerService);
  private readonly planModeTrigger = inject(PlanModeTriggerService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly executionLogs = signal<SingleAgentExecutionLog[]>([]);
  private readonly currentExecution = signal<SingleAgentExecutionLog | null>(null);
  private readonly isPaused = signal(false);
  private readonly pauseReason = signal<string | null>(null);

  readonly logs = this.executionLogs;
  readonly current = this.currentExecution;
  readonly paused = this.isPaused;
  readonly currentPauseReason = this.pauseReason;

  async execute(
    request: string,
    executor: (request: string, taskType: TaskType) => Promise<string>,
    options?: {
      skipValidation?: boolean;
      onToolCall?: () => void;
      onTokenUsage?: (tokens: number) => void;
      onFileModification?: (path: string) => void;
    },
  ): Promise<SingleAgentExecutionResult> {
    const plan = this.planner.planSimple(request);
    const complexity = this.planner.analyzeComplexity(request);
    const constraints = this.planModeTrigger.getExecutionConstraints(complexity.level);
    const startTime = Date.now();

    if (this.planModeTrigger.isExecutionPaused()) {
      return {
        success: false,
        error: '执行已暂停，需要用户确认后继续',
        durationMs: 0,
        taskType: plan.task.type,
        paused: true,
        pauseReason: this.planModeTrigger.getExecutionState().pauseReason,
      };
    }

    const log: SingleAgentExecutionLog = {
      id: `single-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      request,
      taskType: plan.task.type,
      startTime,
      status: 'running',
      toolCallCount: 0,
      tokenUsage: 0,
      fileModifications: [],
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
        constraints,
      },
    });

    try {
      const output = await this.executeWithConstraints(
        request,
        plan.task.type,
        executor,
        constraints,
        log,
        options,
      );

      const endTime = Date.now();
      let validation: TaskValidationResult | undefined;

      if (!options?.skipValidation) {
        const mockTask: TaskNode = {
          taskId: log.id,
          title: plan.task.title,
          description: plan.task.description,
          type: plan.task.type,
          status: 'completed',
          priority: 'high',
          dependencies: [],
          dependents: [],
        };
        validation = this.planner.validateTaskResult(mockTask, output);
      }

      log.status = validation?.isValid === false ? 'failed' : 'completed';
      log.endTime = endTime;
      log.output = output;

      this.executionLogs.update(logs =>
        logs.map(l => l.id === log.id ? log : l)
      );

      return {
        success: validation?.isValid !== false,
        output,
        durationMs: endTime - startTime,
        taskType: plan.task.type,
        validation,
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

  private async executeWithConstraints(
    request: string,
    taskType: TaskType,
    executor: (request: string, taskType: TaskType) => Promise<string>,
    constraints: ExecutionConstraint,
    log: SingleAgentExecutionLog,
    options?: {
      onToolCall?: () => void;
      onTokenUsage?: (tokens: number) => void;
      onFileModification?: (path: string) => void;
    },
  ): Promise<string> {
    const wrappedExecutor = async () => {
      const result = await executor(request, taskType);
      
      options?.onToolCall?.();
      const toolCallResult = this.planModeTrigger.recordToolCall();
      log.toolCallCount = this.planModeTrigger.getExecutionState().toolCallCount;

      if (toolCallResult.warning) {
        this.eventBus.emit({
          type: EVENT_TYPES.EXECUTION_WARNING,
          sessionId: 'single-agent-execution',
          source: 'constraint',
          payload: {
            warning: toolCallResult.warning,
            currentCount: log.toolCallCount,
            maxCount: constraints.maxToolCalls,
          },
        });
      }

      if (toolCallResult.shouldPause) {
        log.status = 'paused';
        this.isPaused.set(true);
        this.pauseReason.set(toolCallResult.warning || '执行约束触发暂停');
        
        this.eventBus.emit({
          type: EVENT_TYPES.EXECUTION_PAUSED,
          sessionId: 'single-agent-execution',
          source: 'constraint',
          payload: {
            reason: toolCallResult.warning ?? undefined,
            state: this.planModeTrigger.getExecutionState(),
          },
        });

        throw new Error(`执行暂停: ${toolCallResult.warning}`);
      }

      return result;
    };

    return wrappedExecutor();
  }

  recordTokenUsage(tokens: number): { warning: string | null; shouldPause: boolean } {
    const result = this.planModeTrigger.recordTokenUsage(tokens);
    
    const current = this.currentExecution();
    if (current) {
      this.executionLogs.update(logs =>
        logs.map(l => l.id === current.id ? { ...l, tokenUsage: this.planModeTrigger.getExecutionState().tokenUsage } : l)
      );
    }

    if (result.warning) {
      this.eventBus.emit({
        type: EVENT_TYPES.EXECUTION_WARNING,
        sessionId: 'single-agent-execution',
        source: 'constraint',
        payload: {
          warning: result.warning,
          type: 'token_usage',
        },
      });
    }

    return result;
  }

  recordFileModification(filePath: string): { warning: string | null; shouldPause: boolean } {
    const result = this.planModeTrigger.recordFileModification(filePath);
    
    const current = this.currentExecution();
    if (current) {
      this.executionLogs.update(logs =>
        logs.map(l => l.id === current.id ? { ...l, fileModifications: [...l.fileModifications, filePath] } : l)
      );
    }

    if (result.warning) {
      this.eventBus.emit({
        type: EVENT_TYPES.EXECUTION_WARNING,
        sessionId: 'single-agent-execution',
        source: 'constraint',
        payload: {
          warning: result.warning,
          type: 'file_modification',
        },
      });
    }

    return result;
  }

  resume(): void {
    this.planModeTrigger.resumeExecution();
    this.isPaused.set(false);
    this.pauseReason.set(null);

    this.eventBus.emit({
      type: EVENT_TYPES.EXECUTION_RESUMED,
      sessionId: 'single-agent-execution',
      source: 'user',
      payload: {
        timestamp: Date.now(),
      },
    });
  }

  getExecutionStats(): {
    total: number;
    completed: number;
    failed: number;
    paused: number;
    avgDurationMs: number;
    totalToolCalls: number;
    totalTokens: number;
  } {
    const logs = this.executionLogs();
    const completed = logs.filter(l => l.status === 'completed');
    const failed = logs.filter(l => l.status === 'failed');
    const paused = logs.filter(l => l.status === 'paused');

    const totalDuration = completed.reduce((sum, l) => {
      return sum + (l.endTime && l.startTime ? l.endTime - l.startTime : 0);
    }, 0);

    const totalToolCalls = logs.reduce((sum, l) => sum + l.toolCallCount, 0);
    const totalTokens = logs.reduce((sum, l) => sum + l.tokenUsage, 0);

    return {
      total: logs.length,
      completed: completed.length,
      failed: failed.length,
      paused: paused.length,
      avgDurationMs: completed.length > 0 ? totalDuration / completed.length : 0,
      totalToolCalls,
      totalTokens,
    };
  }

  clearLogs(): void {
    this.executionLogs.set([]);
  }

  resetExecutionState(): void {
    this.planModeTrigger.resetExecutionState();
    this.isPaused.set(false);
    this.pauseReason.set(null);
  }
}
