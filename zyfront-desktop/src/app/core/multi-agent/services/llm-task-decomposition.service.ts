import { Injectable, inject } from '@angular/core';
import type { TaskNode, TaskType, AgentRole } from '../domain/types';
import { v4 as uuidv4 } from 'uuid';

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

@Injectable({ providedIn: 'root' })
export class LLMTaskDecompositionService {
  private config: LLMServiceConfig = {
    enabled: true,
    temperature: 0.3,
    maxTokens: 2000,
  };

  private readonly systemPrompt = `You are an expert task decomposition AI. Your job is to break down complex software engineering tasks into actionable subtasks.

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

Return a JSON object with:
- reasoning: Brief explanation of your decomposition strategy
- subtasks: Array of subtask objects
- suggestedAgents: Array of agent suggestions with task assignments
- parallelizable: Whether tasks can run in parallel
- overallStrategy: High-level approach summary

## Examples

Input: "分析当前项目"
Output:
{
  "reasoning": "Project analysis requires systematic examination of structure, code quality, and dependencies. This is a read-only analysis task best suited for researcher agents.",
  "subtasks": [
    {"title": "Scan project structure", "description": "Analyze directory layout, file organization, and module structure", "type": "analysis", "priority": "high", "dependencies": [], "estimatedDuration": "10min"},
    {"title": "Evaluate code quality", "description": "Check code style, patterns, and potential issues", "type": "analysis", "priority": "high", "dependencies": [], "estimatedDuration": "15min"},
    {"title": "Analyze dependencies", "description": "Review package dependencies and their relationships", "type": "analysis", "priority": "medium", "dependencies": [], "estimatedDuration": "10min"},
    {"title": "Generate report", "description": "Compile findings into a comprehensive analysis report", "type": "documentation", "priority": "high", "dependencies": ["Scan project structure", "Evaluate code quality", "Analyze dependencies"], "estimatedDuration": "15min"}
  ],
  "suggestedAgents": [
    {"role": "researcher", "taskIndices": [0, 1, 2], "reason": "Research agents excel at analysis and investigation tasks"},
    {"role": "researcher", "taskIndices": [3], "reason": "Documentation compilation requires research skills"}
  ],
  "parallelizable": true,
  "overallStrategy": "Parallel analysis of different aspects, followed by synthesis into a comprehensive report"
}

Input: "实现用户登录功能"
Output:
{
  "reasoning": "User login is a full-stack feature requiring backend API, frontend UI, and security considerations. This needs a coordinated team approach.",
  "subtasks": [
    {"title": "Design authentication architecture", "description": "Plan the auth flow, token management, and security measures", "type": "planning", "priority": "high", "dependencies": [], "estimatedDuration": "20min"},
    {"title": "Implement backend auth API", "description": "Create login, logout, token refresh endpoints", "type": "coding", "priority": "high", "dependencies": ["Design authentication architecture"], "estimatedDuration": "45min"},
    {"title": "Create login UI components", "description": "Build login form, password reset flow", "type": "coding", "priority": "high", "dependencies": ["Design authentication architecture"], "estimatedDuration": "30min"},
    {"title": "Add security measures", "description": "Implement rate limiting, CSRF protection, secure cookies", "type": "coding", "priority": "high", "dependencies": ["Implement backend auth API"], "estimatedDuration": "20min"},
    {"title": "Write auth tests", "description": "Unit and integration tests for auth flow", "type": "testing", "priority": "high", "dependencies": ["Implement backend auth API", "Create login UI components"], "estimatedDuration": "30min"},
    {"title": "Security review", "description": "Review implementation for security vulnerabilities", "type": "review", "priority": "high", "dependencies": ["Write auth tests"], "estimatedDuration": "15min"}
  ],
  "suggestedAgents": [
    {"role": "planner", "taskIndices": [0], "reason": "Architecture design requires planning expertise"},
    {"role": "executor", "taskIndices": [1, 2, 3], "reason": "Implementation tasks need coding skills"},
    {"role": "validator", "taskIndices": [4], "reason": "Testing requires validation expertise"},
    {"role": "reviewer", "taskIndices": [5], "reason": "Security review needs review skills"}
  ],
  "parallelizable": false,
  "overallStrategy": "Sequential planning followed by parallel frontend/backend implementation, then testing and review"
}`;

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
    
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const decomposition = this.simulateLLMResponse(request);
          resolve(decomposition);
        } catch (error) {
          reject(error);
        }
      }, 100);
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

  private simulateLLMResponse(request: LLMTaskDecompositionRequest): LLMTaskDecompositionResponse {
    const { userRequest, complexityLevel } = request;
    
    if (/分析.*项目|项目.*分析|当前项目|整个项目/i.test(userRequest)) {
      return {
        reasoning: '项目分析需要系统性地检查结构、代码质量和依赖关系。这是只读分析任务，最适合研究员智能体。',
        subtasks: [
          { title: '扫描项目结构', description: '分析目录布局、文件组织和模块结构', type: 'analysis' as TaskType, priority: 'high', dependencies: [], estimatedDuration: '10min' },
          { title: '评估代码质量', description: '检查代码风格、模式和潜在问题', type: 'analysis' as TaskType, priority: 'high', dependencies: [], estimatedDuration: '15min' },
          { title: '分析依赖关系', description: '审查包依赖及其关系', type: 'analysis' as TaskType, priority: 'medium', dependencies: [], estimatedDuration: '10min' },
          { title: '识别架构模式', description: '识别项目使用的架构和设计模式', type: 'analysis' as TaskType, priority: 'medium', dependencies: [], estimatedDuration: '10min' },
          { title: '生成分析报告', description: '将发现汇总成综合分析报告', type: 'documentation' as TaskType, priority: 'high', dependencies: ['扫描项目结构', '评估代码质量', '分析依赖关系', '识别架构模式'], estimatedDuration: '15min' },
        ],
        suggestedAgents: [
          { role: 'researcher' as AgentRole, taskIndices: [0, 1, 2, 3], reason: '研究员擅长分析和调查任务' },
          { role: 'researcher' as AgentRole, taskIndices: [4], reason: '文档编制需要研究技能' },
        ],
        parallelizable: true,
        overallStrategy: '并行分析不同方面，然后综合成全面报告',
      };
    }

    if (/实现|开发|编写|创建|构建/i.test(userRequest) && /登录|认证|auth|login/i.test(userRequest)) {
      return {
        reasoning: '用户登录是一个全栈功能，需要后端API、前端UI和安全考虑。这需要协调的团队方法。',
        subtasks: [
          { title: '设计认证架构', description: '规划认证流程、令牌管理和安全措施', type: 'planning' as TaskType, priority: 'high', dependencies: [], estimatedDuration: '20min' },
          { title: '实现后端认证API', description: '创建登录、登出、令牌刷新端点', type: 'coding' as TaskType, priority: 'high', dependencies: ['设计认证架构'], estimatedDuration: '45min' },
          { title: '创建登录UI组件', description: '构建登录表单、密码重置流程', type: 'coding' as TaskType, priority: 'high', dependencies: ['设计认证架构'], estimatedDuration: '30min' },
          { title: '添加安全措施', description: '实现速率限制、CSRF保护、安全Cookie', type: 'coding' as TaskType, priority: 'high', dependencies: ['实现后端认证API'], estimatedDuration: '20min' },
          { title: '编写认证测试', description: '认证流程的单元和集成测试', type: 'testing' as TaskType, priority: 'high', dependencies: ['实现后端认证API', '创建登录UI组件'], estimatedDuration: '30min' },
          { title: '安全审查', description: '审查实现的安全漏洞', type: 'review' as TaskType, priority: 'high', dependencies: ['编写认证测试'], estimatedDuration: '15min' },
        ],
        suggestedAgents: [
          { role: 'planner' as AgentRole, taskIndices: [0], reason: '架构设计需要规划专业知识' },
          { role: 'executor' as AgentRole, taskIndices: [1, 2, 3], reason: '实现任务需要编码技能' },
          { role: 'validator' as AgentRole, taskIndices: [4], reason: '测试需要验证专业知识' },
          { role: 'reviewer' as AgentRole, taskIndices: [5], reason: '安全审查需要审查技能' },
        ],
        parallelizable: false,
        overallStrategy: '顺序规划后并行前后端实现，然后测试和审查',
      };
    }

    if (/重构|优化|改进/i.test(userRequest)) {
      return {
        reasoning: '重构需要先评估现状，设计方案，然后安全地实施变更。',
        subtasks: [
          { title: '评估当前状态', description: '分析现有代码结构和问题点', type: 'analysis' as TaskType, priority: 'high', dependencies: [], estimatedDuration: '15min' },
          { title: '设计重构方案', description: '制定重构策略和步骤', type: 'planning' as TaskType, priority: 'high', dependencies: ['评估当前状态'], estimatedDuration: '20min' },
          { title: '实施重构', description: '执行代码重构', type: 'coding' as TaskType, priority: 'high', dependencies: ['设计重构方案'], estimatedDuration: '45min' },
          { title: '回归测试', description: '验证重构后功能正确性', type: 'testing' as TaskType, priority: 'high', dependencies: ['实施重构'], estimatedDuration: '20min' },
        ],
        suggestedAgents: [
          { role: 'researcher' as AgentRole, taskIndices: [0], reason: '现状评估需要分析能力' },
          { role: 'planner' as AgentRole, taskIndices: [1], reason: '方案设计需要规划技能' },
          { role: 'executor' as AgentRole, taskIndices: [2], reason: '重构实施需要编码能力' },
          { role: 'validator' as AgentRole, taskIndices: [3], reason: '测试验证需要测试技能' },
        ],
        parallelizable: false,
        overallStrategy: '评估→设计→实施→验证的顺序流程',
      };
    }

    if (/修复|bug|问题|错误/i.test(userRequest)) {
      return {
        reasoning: '问题修复需要定位根因，制定方案，然后验证修复效果。',
        subtasks: [
          { title: '问题定位', description: '定位问题根源', type: 'debugging' as TaskType, priority: 'high', dependencies: [], estimatedDuration: '15min' },
          { title: '制定修复方案', description: '设计解决方案', type: 'planning' as TaskType, priority: 'high', dependencies: ['问题定位'], estimatedDuration: '10min' },
          { title: '实施修复', description: '执行修复操作', type: 'coding' as TaskType, priority: 'high', dependencies: ['制定修复方案'], estimatedDuration: '20min' },
          { title: '验证修复', description: '确认问题已解决', type: 'testing' as TaskType, priority: 'high', dependencies: ['实施修复'], estimatedDuration: '10min' },
        ],
        suggestedAgents: [
          { role: 'executor' as AgentRole, taskIndices: [0, 2], reason: '调试和修复需要执行能力' },
          { role: 'planner' as AgentRole, taskIndices: [1], reason: '方案制定需要规划技能' },
          { role: 'validator' as AgentRole, taskIndices: [3], reason: '验证需要测试技能' },
        ],
        parallelizable: false,
        overallStrategy: '定位→方案→修复→验证的顺序流程',
      };
    }

    return this.getDefaultDecomposition(userRequest, complexityLevel);
  }

  private getDefaultDecomposition(request: string, complexity: string): LLMTaskDecompositionResponse {
    const subtasks = complexity === 'simple' 
      ? [
          { title: '执行任务', description: request, type: 'coding' as TaskType, priority: 'high' as const, dependencies: [], estimatedDuration: '30min' },
        ]
      : [
          { title: '分析需求', description: '理解任务需求', type: 'research' as TaskType, priority: 'high' as const, dependencies: [], estimatedDuration: '10min' },
          { title: '设计方案', description: '制定实现方案', type: 'planning' as TaskType, priority: 'high' as const, dependencies: ['分析需求'], estimatedDuration: '15min' },
          { title: '实施开发', description: '执行主要开发任务', type: 'coding' as TaskType, priority: 'high' as const, dependencies: ['设计方案'], estimatedDuration: '45min' },
          { title: '测试验证', description: '验证实现正确性', type: 'testing' as TaskType, priority: 'high' as const, dependencies: ['实施开发'], estimatedDuration: '20min' },
        ];

    return {
      reasoning: `根据任务复杂度(${complexity})生成标准分解方案`,
      subtasks,
      suggestedAgents: [
        { role: 'executor' as AgentRole, taskIndices: subtasks.map((_, i) => i), reason: '执行智能体可以处理此任务' },
      ],
      parallelizable: false,
      overallStrategy: complexity === 'simple' ? '直接执行' : '分析→设计→实施→验证',
    };
  }

  private getFallbackDecomposition(request: LLMTaskDecompositionRequest): LLMTaskDecompositionResponse {
    return this.getDefaultDecomposition(request.userRequest, request.complexityLevel);
  }

  private validateAndFixResponse(
    response: LLMTaskDecompositionResponse,
    request: LLMTaskDecompositionRequest,
  ): LLMTaskDecompositionResponse {
    if (!response.subtasks || response.subtasks.length === 0) {
      return this.getFallbackDecomposition(request);
    }

    response.subtasks = response.subtasks.map((task, index) => ({
      ...task,
      priority: task.priority || 'medium',
      dependencies: task.dependencies || [],
      estimatedDuration: task.estimatedDuration || '15min',
    }));

    return response;
  }

  convertToTaskNodes(response: LLMTaskDecompositionResponse): TaskNode[] {
    const taskMap = new Map<string, TaskNode>();

    response.subtasks.forEach((subtask, index) => {
      const taskId = `task-${uuidv4()}`;
      const taskNode: TaskNode = {
        taskId,
        title: subtask.title,
        description: subtask.description,
        type: subtask.type,
        status: 'pending',
        priority: subtask.priority,
        dependencies: [],
        dependents: [],
      };
      taskMap.set(subtask.title, taskNode);
    });

    response.subtasks.forEach(subtask => {
      const task = taskMap.get(subtask.title);
      if (task && subtask.dependencies.length > 0) {
        subtask.dependencies.forEach(depTitle => {
          const depTask = taskMap.get(depTitle);
          if (depTask) {
            task.dependencies.push(depTask.taskId);
            depTask.dependents.push(task.taskId);
          }
        });
      }
    });

    return Array.from(taskMap.values());
  }
}
