import { Injectable, inject, signal } from '@angular/core';
import { TaskPlannerService, type TaskValidationResult } from './task-planner.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import type { TaskGraph, TaskNode, AgentRole, TaskType } from '../domain/types';

export interface ParallelExecutionConfig {
  maxParallelAgents: number;
  taskTimeoutMs: number;
  retryCount: number;
  enableAutoParallel: boolean;
}

export interface ParallelExecutionState {
  isRunning: boolean;
  activeAgents: number;
  completedTasks: number;
  failedTasks: number;
  totalTasks: number;
}

export interface ParallelTaskResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  validation?: TaskValidationResult;
}

@Injectable({ providedIn: 'root' })
export class ParallelExecutionService {
  private readonly planner = inject(TaskPlannerService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly config = signal<ParallelExecutionConfig>({
    maxParallelAgents: 3,
    taskTimeoutMs: 5 * 60 * 1000,
    retryCount: 2,
    enableAutoParallel: true,
  });

  private readonly state = signal<ParallelExecutionState>({
    isRunning: false,
    activeAgents: 0,
    completedTasks: 0,
    failedTasks: 0,
    totalTasks: 0,
  });

  readonly currentState = this.state;

  setConfig(newConfig: Partial<ParallelExecutionConfig>): void {
    this.config.update(c => ({ ...c, ...newConfig }));
  }

  findParallelizableTasks(taskGraph: TaskGraph): TaskNode[][] {
    const tasks = Object.values(taskGraph.tasks);
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    
    if (pendingTasks.length === 0) return [];

    const dependencyGraph = this.buildDependencyGraph(pendingTasks);
    const levels = this.computeExecutionLevels(dependencyGraph, pendingTasks);
    
    return levels.filter(level => level.length > 1);
  }

  canExecuteInParallel(taskGraph: TaskGraph): boolean {
    if (!this.config().enableAutoParallel) return false;
    
    const parallelizableGroups = this.findParallelizableTasks(taskGraph);
    return parallelizableGroups.some(group => group.length > 1);
  }

  async executeTaskGraph(
    taskGraph: TaskGraph,
    executor: (task: TaskNode, agentRole: AgentRole) => Promise<string>,
    onProgress?: (taskId: string, status: 'started' | 'completed' | 'failed') => void,
  ): Promise<ParallelTaskResult[]> {
    const results: ParallelTaskResult[] = [];
    const tasks = Object.values(taskGraph.tasks);
    
    this.state.set({
      isRunning: true,
      activeAgents: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalTasks: tasks.length,
    });

    const dependencyGraph = this.buildDependencyGraph(tasks);
    const levels = this.computeExecutionLevels(dependencyGraph, tasks);

    for (const level of levels) {
      const pendingInLevel = level.filter(t => t.status === 'pending');
      
      if (pendingInLevel.length === 0) continue;

      if (pendingInLevel.length > 1 && this.config().enableAutoParallel) {
        const levelResults = await this.executeLevelInParallel(
          pendingInLevel,
          executor,
          onProgress,
        );
        results.push(...levelResults);
      } else {
        for (const task of pendingInLevel) {
          const result = await this.executeSingleTask(task, executor, onProgress);
          results.push(result);
        }
      }
    }

    this.state.update(s => ({ ...s, isRunning: false }));
    return results;
  }

  private async executeLevelInParallel(
    tasks: TaskNode[],
    executor: (task: TaskNode, agentRole: AgentRole) => Promise<string>,
    onProgress?: (taskId: string, status: 'started' | 'completed' | 'failed') => void,
  ): Promise<ParallelTaskResult[]> {
    const config = this.config();
    const batchSize = Math.min(tasks.length, config.maxParallelAgents);
    
    this.state.update(s => ({ ...s, activeAgents: batchSize }));

    this.eventBus.emit({
      type: EVENT_TYPES.MODE_MULTI,
      sessionId: 'parallel-execution',
      source: 'system',
      payload: {
        mode: 'multi',
        reason: `检测到 ${tasks.length} 个可并行任务，启动 ${batchSize} 个并行Agent执行`,
        timestamp: Date.now(),
      },
    });

    const results: ParallelTaskResult[] = [];
    
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      
      const batchPromises = batch.map(task => 
        this.executeSingleTask(task, executor, onProgress)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          const failedTask = batch[batchResults.indexOf(result)];
          results.push({
            taskId: failedTask.taskId,
            agentId: 'unknown',
            success: false,
            error: result.reason?.message || 'Unknown error',
            durationMs: 0,
          });
        }
      }
    }

    this.state.update(s => ({ ...s, activeAgents: 0 }));
    return results;
  }

  private async executeSingleTask(
    task: TaskNode,
    executor: (task: TaskNode, agentRole: AgentRole) => Promise<string>,
    onProgress?: (taskId: string, status: 'started' | 'completed' | 'failed') => void,
  ): Promise<ParallelTaskResult> {
    const startTime = Date.now();
    const agentRole = this.suggestRoleForTask(task);
    
    onProgress?.(task.taskId, 'started');
    
    this.eventBus.emit({
      type: EVENT_TYPES.TASK_STARTED,
      sessionId: 'parallel-execution',
      source: 'executor',
      payload: {
        taskId: task.taskId,
        agentId: `agent-${task.taskId}`,
        startedAt: startTime,
      },
    });

    try {
      const output = await this.executeWithTimeout(
        task,
        agentRole,
        executor,
        this.config().taskTimeoutMs,
      );

      const validation = this.planner.validateTaskResult(task, output);
      const endTime = Date.now();

      if (validation.isValid) {
        this.state.update(s => ({ ...s, completedTasks: s.completedTasks + 1 }));
        onProgress?.(task.taskId, 'completed');
        
        this.eventBus.emit({
          type: EVENT_TYPES.TASK_COMPLETED,
          sessionId: 'parallel-execution',
          source: 'executor',
          payload: {
            taskId: task.taskId,
            agentId: `agent-${task.taskId}`,
            result: output,
            durationMs: endTime - startTime,
          },
        });
      } else {
        this.state.update(s => ({ ...s, failedTasks: s.failedTasks + 1 }));
        onProgress?.(task.taskId, 'failed');
        
        this.eventBus.emit({
          type: EVENT_TYPES.TASK_FAILED,
          sessionId: 'parallel-execution',
          source: 'validator',
          payload: {
            taskId: task.taskId,
            agentId: `agent-${task.taskId}`,
            error: validation.issues.join('; '),
            retriable: !validation.needsReplan,
          },
        });
      }

      return {
        taskId: task.taskId,
        agentId: `agent-${task.taskId}`,
        success: validation.isValid,
        output,
        durationMs: endTime - startTime,
        validation,
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.state.update(s => ({ ...s, failedTasks: s.failedTasks + 1 }));
      onProgress?.(task.taskId, 'failed');
      
      this.eventBus.emit({
        type: EVENT_TYPES.TASK_FAILED,
        sessionId: 'parallel-execution',
        source: 'executor',
        payload: {
          taskId: task.taskId,
          agentId: `agent-${task.taskId}`,
          error: errorMessage,
          retriable: true,
        },
      });

      return {
        taskId: task.taskId,
        agentId: `agent-${task.taskId}`,
        success: false,
        error: errorMessage,
        durationMs: endTime - startTime,
      };
    }
  }

  private async executeWithTimeout(
    task: TaskNode,
    agentRole: AgentRole,
    executor: (task: TaskNode, agentRole: AgentRole) => Promise<string>,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`任务执行超时 (${timeoutMs}ms)`));
      }, timeoutMs);

      executor(task, agentRole)
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private buildDependencyGraph(tasks: TaskNode[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    
    for (const task of tasks) {
      graph.set(task.taskId, new Set(task.dependencies));
    }
    
    return graph;
  }

  private computeExecutionLevels(
    dependencyGraph: Map<string, Set<string>>,
    tasks: TaskNode[],
  ): TaskNode[][] {
    const levels: TaskNode[][] = [];
    const taskMap = new Map(tasks.map(t => [t.taskId, t]));
    const assigned = new Set<string>();
    
    let remaining = tasks.filter(t => t.status === 'pending');
    
    while (remaining.length > 0) {
      const level: TaskNode[] = [];
      
      for (const task of remaining) {
        const deps = dependencyGraph.get(task.taskId) || new Set();
        const allDepsAssigned = [...deps].every(depId => 
          assigned.has(depId) || !taskMap.has(depId)
        );
        
        if (allDepsAssigned) {
          level.push(task);
        }
      }
      
      if (level.length === 0) {
        const circularDeps = remaining.filter(t => !assigned.has(t.taskId));
        if (circularDeps.length > 0) {
          level.push(circularDeps[0]);
        } else {
          break;
        }
      }
      
      levels.push(level);
      level.forEach(t => assigned.add(t.taskId));
      remaining = remaining.filter(t => !assigned.has(t.taskId));
    }
    
    return levels;
  }

  private suggestRoleForTask(task: TaskNode): AgentRole {
    const mapping: Record<TaskType, AgentRole> = {
      planning: 'planner',
      coding: 'executor',
      debugging: 'executor',
      review: 'reviewer',
      research: 'researcher',
      testing: 'validator',
      documentation: 'researcher',
      analysis: 'researcher',
      coordination: 'planner',
    };
    return mapping[task.type] || 'executor';
  }

  getExecutionStats(): ParallelExecutionState {
    return this.state();
  }

  reset(): void {
    this.state.set({
      isRunning: false,
      activeAgents: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalTasks: 0,
    });
  }
}
