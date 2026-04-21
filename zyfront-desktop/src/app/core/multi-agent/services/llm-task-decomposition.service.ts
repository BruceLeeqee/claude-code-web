import { Injectable, inject } from '@angular/core';
import type { TaskNode, TaskType, AgentRole } from '../domain/types';
import { v4 as uuidv4 } from 'uuid';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../zyfront-core.providers';

export interface LLMTaskDecompositionRequest {
  userRequest: string;
  context?: {
    projectType?: string;
    existingFiles?: string[];
    relatedTasks?: string[];
  };
  complexityLevel: 'simple' | 'medium' | 'complex';
}

export interface LLMTaskDecompositionResponse {
  reasoning: string;
  subtasks: Array<{
    title: string;
    description: string;
    type: TaskType;
    priority: 'high' | 'medium' | 'low';
    dependencies: string[];
    estimatedDuration: string;
  }>;
  suggestedAgents: Array<{
    role: AgentRole;
    taskIndices: number[];
    reason: string;
  }>;
  parallelizable: boolean;
  overallStrategy: string;
}

export interface LLMServiceConfig {
  enabled: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const DECOMPOSITION_SYSTEM_PROMPT = `You are an expert task decomposition AI. Your job is to break down complex software engineering tasks into actionable subtasks.

## Task Types
- research: Investigation, analysis, documentation review
- planning: Design, architecture, strategy
- coding: Implementation, development, coding
- testing: Test writing, verification, validation
- debugging: Bug fixing, troubleshooting
- review: Code review, quality check
- documentation: Writing docs, comments, README
- analysis: Performance analysis, metrics, evaluation
- coordination: Team coordination, synchronization

## Agent Roles
- leader: Coordinates team, makes high-level decisions
- planner: Creates plans, designs architecture
- executor: Implements code, fixes bugs
- reviewer: Reviews code, ensures quality
- researcher: Researches, analyzes, documents
- validator: Tests, validates, verifies
- coordinator: Synchronizes work between agents

## Decomposition Guidelines

1. **Granularity**: Each subtask should be completable in 15-60 minutes
2. **Independence**: Tasks should have minimal dependencies
3. **Clarity**: Each task should have a clear deliverable
4. **Parallelization**: Identify tasks that can run in parallel
5. **Agent Assignment**: Match tasks to agent capabilities

## Response Format

Return ONLY a valid JSON object with no additional text:
{
  "reasoning": "Brief explanation of your decomposition strategy",
  "subtasks": [
    {"title": "Task title", "description": "Task description", "type": "task_type", "priority": "high|medium|low", "dependencies": ["dependent task title"], "estimatedDuration": "Xmin"}
  ],
  "suggestedAgents": [
    {"role": "agent_role", "taskIndices": [0, 1], "reason": "Why this agent"}
  ],
  "parallelizable": true|false,
  "overallStrategy": "High-level approach summary"
}

## Important Rules
- Dependencies should reference task titles exactly
- For simple tasks (single command, quick lookup), return only ONE subtask
- For complex tasks, break down into logical phases
- Consider which tasks can run in parallel
- Assign appropriate agent roles based on task type`;

@Injectable({ providedIn: 'root' })
export class LLMTaskDecompositionService {
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  
  private config: LLMServiceConfig = {
    enabled: true,
    temperature: 0.3,
    maxTokens: 2000,
  };

  setConfig(config: Partial<LLMServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async decomposeTask(request: LLMTaskDecompositionRequest): Promise<LLMTaskDecompositionResponse> {
    if (!this.config.enabled) {
      return this.getFallbackDecomposition(request);
    }

    try {
      const response = await this.callLLM(request);
      return this.validateAndFixResponse(response, request);
    } catch (error) {
      console.warn('LLM decomposition failed, using fallback:', error);
      return this.getFallbackDecomposition(request);
    }
  }

  private async callLLM(request: LLMTaskDecompositionRequest): Promise<LLMTaskDecompositionResponse> {
    const userPrompt = this.buildUserPrompt(request);
    const fullPrompt = `${DECOMPOSITION_SYSTEM_PROMPT}\n\n## User Request\n\n${userPrompt}\n\n## Response\n\nReturn ONLY the JSON object:`;
    
    return new Promise((resolve, reject) => {
      try {
        const { stream, cancel } = this.runtime.assistant.stream('task-decomposition', {
          userInput: fullPrompt,
          config: this.runtime.client.getModel(),
        });

        const reader = stream.getReader();
        let accumulated = '';

        const readChunk = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                const parsed = this.parseLLMResponse(accumulated);
                resolve(parsed);
                return;
              }
              if (value.type === 'error') {
                reject(new Error(value.error || 'LLM stream error'));
                return;
              }
              if (value.type === 'delta' && value.textDelta) {
                accumulated += value.textDelta;
              }
            }
          } catch (err) {
            reject(err);
          }
        };

        readChunk();
      } catch (error) {
        reject(error);
      }
    });
  }

  private buildUserPrompt(request: LLMTaskDecompositionRequest): string {
    let prompt = `Decompose the following task:\n\n**User Request**: ${request.userRequest}\n\n**Complexity**: ${request.complexityLevel}`;
    
    if (request.context) {
      if (request.context.projectType) {
        prompt += `\n\n**Project Type**: ${request.context.projectType}`;
      }
      if (request.context.existingFiles?.length) {
        prompt += `\n\n**Related Files**: ${request.context.existingFiles.slice(0, 10).join(', ')}`;
      }
      if (request.context.relatedTasks?.length) {
        prompt += `\n\n**Related Tasks**: ${request.context.relatedTasks.join(', ')}`;
      }
    }
    
    return prompt;
  }

  private parseLLMResponse(raw: string): LLMTaskDecompositionResponse {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in LLM response');
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reasoning: parsed.reasoning || 'LLM-based task decomposition',
        subtasks: (parsed.subtasks || []).map((t: any) => ({
          title: String(t.title || 'Task'),
          description: String(t.description || ''),
          type: this.validateTaskType(t.type),
          priority: this.validatePriority(t.priority),
          dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(String) : [],
          estimatedDuration: String(t.estimatedDuration || '15min'),
        })),
        suggestedAgents: (parsed.suggestedAgents || []).map((a: any) => ({
          role: this.validateAgentRole(a.role),
          taskIndices: Array.isArray(a.taskIndices) ? a.taskIndices.map(Number) : [],
          reason: String(a.reason || ''),
        })),
        parallelizable: Boolean(parsed.parallelizable),
        overallStrategy: String(parsed.overallStrategy || 'Sequential execution'),
      };
    } catch (e) {
      throw new Error(`Failed to parse LLM response: ${e}`);
    }
  }

  private validateTaskType(type: unknown): TaskType {
    const validTypes: TaskType[] = ['research', 'planning', 'coding', 'testing', 'debugging', 'review', 'documentation', 'analysis', 'coordination'];
    if (typeof type === 'string' && validTypes.includes(type as TaskType)) {
      return type as TaskType;
    }
    return 'coding';
  }

  private validatePriority(priority: unknown): 'high' | 'medium' | 'low' {
    if (priority === 'high' || priority === 'medium' || priority === 'low') {
      return priority;
    }
    return 'medium';
  }

  private validateAgentRole(role: unknown): AgentRole {
    const validRoles: AgentRole[] = ['leader', 'planner', 'executor', 'reviewer', 'researcher', 'validator'];
    if (typeof role === 'string' && validRoles.includes(role as AgentRole)) {
      return role as AgentRole;
    }
    return 'executor';
  }

  private getFallbackDecomposition(request: LLMTaskDecompositionRequest): LLMTaskDecompositionResponse {
    const { userRequest, complexityLevel } = request;

    if (complexityLevel === 'simple') {
      return {
        reasoning: '简单任务，直接执行',
        subtasks: [
          {
            title: '执行任务',
            description: userRequest,
            type: 'coding',
            priority: 'high',
            dependencies: [],
            estimatedDuration: '5min',
          },
        ],
        suggestedAgents: [
          { role: 'executor', taskIndices: [0], reason: '执行智能体可以直接处理此简单任务' },
        ],
        parallelizable: false,
        overallStrategy: '直接执行',
      };
    }

    const subtasks = this.generateGenericSubtasks(userRequest, complexityLevel);
    
    return {
      reasoning: `基于复杂度(${complexityLevel})的标准分解方案`,
      subtasks,
      suggestedAgents: this.suggestAgentsForSubtasks(subtasks),
      parallelizable: complexityLevel === 'complex',
      overallStrategy: complexityLevel === 'medium' ? '顺序执行' : '并行分析后综合',
    };
  }

  private generateGenericSubtasks(request: string, complexity: string): LLMTaskDecompositionResponse['subtasks'] {
    const baseTasks: LLMTaskDecompositionResponse['subtasks'] = [
      { title: '分析需求', description: '理解任务需求和技术约束', type: 'research', priority: 'high', dependencies: [], estimatedDuration: '10min' },
      { title: '设计方案', description: '制定实现方案', type: 'planning', priority: 'high', dependencies: ['分析需求'], estimatedDuration: '15min' },
    ];

    if (complexity === 'complex') {
      baseTasks.push(
        { title: '实现核心功能', description: '执行主要开发任务', type: 'coding', priority: 'high', dependencies: ['设计方案'], estimatedDuration: '45min' },
        { title: '实现辅助功能', description: '完成辅助模块开发', type: 'coding', priority: 'medium', dependencies: ['设计方案'], estimatedDuration: '30min' },
        { title: '集成测试', description: '验证功能正确性', type: 'testing', priority: 'high', dependencies: ['实现核心功能', '实现辅助功能'], estimatedDuration: '20min' },
        { title: '代码审查', description: '确保代码质量', type: 'review', priority: 'medium', dependencies: ['集成测试'], estimatedDuration: '15min' }
      );
    } else {
      baseTasks.push(
        { title: '实施开发', description: '执行主要开发任务', type: 'coding', priority: 'high', dependencies: ['设计方案'], estimatedDuration: '30min' },
        { title: '测试验证', description: '验证实现正确性', type: 'testing', priority: 'high', dependencies: ['实施开发'], estimatedDuration: '15min' }
      );
    }

    return baseTasks;
  }

  private suggestAgentsForSubtasks(subtasks: LLMTaskDecompositionResponse['subtasks']): LLMTaskDecompositionResponse['suggestedAgents'] {
    const roleMap: Record<TaskType, AgentRole> = {
      research: 'researcher',
      planning: 'planner',
      coding: 'executor',
      testing: 'validator',
      debugging: 'executor',
      review: 'reviewer',
      documentation: 'researcher',
      analysis: 'researcher',
      coordination: 'planner',
    };

    const tasksByRole = new Map<AgentRole, number[]>();
    
    subtasks.forEach((task, index) => {
      const role = roleMap[task.type] || 'executor';
      const indices = tasksByRole.get(role) || [];
      indices.push(index);
      tasksByRole.set(role, indices);
    });

    return Array.from(tasksByRole.entries()).map(([role, indices]) => ({
      role,
      taskIndices: indices,
      reason: `${role}角色适合处理${indices.length}个任务`,
    }));
  }

  private validateAndFixResponse(
    response: LLMTaskDecompositionResponse,
    request: LLMTaskDecompositionRequest,
  ): LLMTaskDecompositionResponse {
    if (!response.subtasks || response.subtasks.length === 0) {
      return this.getFallbackDecomposition(request);
    }

    response.subtasks = response.subtasks.map((task) => ({
      ...task,
      priority: task.priority || 'medium',
      dependencies: task.dependencies || [],
      estimatedDuration: task.estimatedDuration || '15min',
    }));

    return response;
  }

  convertToTaskNodes(response: LLMTaskDecompositionResponse): TaskNode[] {
    const taskIdMap = new Map<string, string>();
    
    response.subtasks.forEach((task) => {
      taskIdMap.set(task.title, uuidv4());
    });

    return response.subtasks.map((task) => {
      const taskId = taskIdMap.get(task.title)!;
      const dependencyIds = task.dependencies
        .map((depTitle) => taskIdMap.get(depTitle))
        .filter((id): id is string => id !== undefined);

      return {
        taskId,
        title: task.title,
        description: task.description,
        type: task.type,
        priority: task.priority,
        status: 'pending' as TaskNodeStatus,
        dependencies: dependencyIds,
        dependents: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
  }
}

type TaskNodeStatus = 'pending' | 'running' | 'completed' | 'failed';
