import { Injectable, signal } from '@angular/core';
import { MultiAgentFacade } from './multi-agent.facade';
import type { AgentDescriptor, SessionContext, TaskGraph, TaskNode } from './domain/types';
import type { OrchestrationState } from './services/auto-scale-orchestrator.service';

export interface TestCase {
  name: string;
  description: string;
  userRequest: string;
  expectedTaskCount?: number;
  expectedAgents?: number;
}

export interface TestResult {
  testCase: string;
  success: boolean;
  duration: number;
  sessionId?: string;
  taskGraph?: TaskGraph;
  agents?: AgentDescriptor[];
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class MultiAgentTestService {
  private readonly testResults = signal<TestResult[]>([]);
  private readonly isRunning = signal<boolean>(false);
  private readonly currentTest = signal<string>('');

  readonly results = this.testResults.asReadonly();
  readonly running = this.isRunning.asReadonly();
  readonly current = this.currentTest.asReadonly();

  constructor(private readonly facade: MultiAgentFacade) {}

  getTestCases(): TestCase[] {
    return [
      {
        name: 'simple-coding',
        description: '简单编码任务 - 单智能体',
        userRequest: '创建一个简单的计算器功能，实现加减乘除四个方法',
        expectedTaskCount: 1,
        expectedAgents: 1,
      },
      {
        name: 'complex-research',
        description: '复杂研究任务 - 多智能体协作',
        userRequest: '调研目前最流行的三个前端框架(React, Vue, Angular)的优缺点，并生成一份对比报告，同时创建一个展示对比表格的网页',
        expectedTaskCount: 3,
        expectedAgents: 2,
      },
      {
        name: 'multi-parallel',
        description: '并行任务测试 - 同时执行多个独立任务',
        userRequest: '同时完成以下三个任务：1. 调研TypeScript最新特性 2. 创建一个简单的TODO应用 3. 写一篇关于AI辅助编程的文章草稿',
        expectedTaskCount: 3,
        expectedAgents: 2,
      },
      {
        name: 'full-stack',
        description: '全栈任务 - 前后端协作',
        userRequest: '创建一个简单的博客系统，需要：1. 设计数据库结构 2. 实现后端API 3. 创建前端展示页面',
        expectedTaskCount: 3,
        expectedAgents: 2,
      },
      {
        name: 'code-review',
        description: '代码审查任务 - 多角色协作',
        userRequest: '审查现有代码库中的用户认证模块，识别安全漏洞并提出修复建议，同时编写单元测试覆盖',
        expectedTaskCount: 2,
        expectedAgents: 2,
      },
    ];
  }

  async runTest(testCase: TestCase): Promise<TestResult> {
    const startTime = Date.now();
    this.isRunning.set(true);
    this.currentTest.set(testCase.name);

    try {
      const session = await this.facade.startSession(testCase.userRequest, {
        teamName: `test-${testCase.name}`,
        sessionName: testCase.name,
      });

      const taskGraph = this.facade.getTaskGraph(session.sessionId);
      const agents = this.facade.getAllAgents();

      const result: TestResult = {
        testCase: testCase.name,
        success: true,
        duration: Date.now() - startTime,
        sessionId: session.sessionId,
        taskGraph,
        agents: agents.map(a => a.descriptor),
      };

      this.testResults.update(results => [...results, result]);
      return result;
    } catch (error) {
      const result: TestResult = {
        testCase: testCase.name,
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };

      this.testResults.update(results => [...results, result]);
      return result;
    } finally {
      this.isRunning.set(false);
      this.currentTest.set('');
    }
  }

  async runAllTests(): Promise<TestResult[]> {
    const testCases = this.getTestCases();
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      const result = await this.runTest(testCase);
      results.push(result);
    }

    return results;
  }

  clearResults(): void {
    this.testResults.set([]);
  }

  getState(): OrchestrationState {
    return this.facade.getOrchestrationState();
  }

  getActiveSession(): SessionContext | undefined {
    return this.facade.getActiveSession();
  }

  async analyzeRequest(request: string): Promise<{
    level: 'simple' | 'medium' | 'complex';
    factors: string[];
    estimatedSubtasks: number;
  }> {
    return this.facade.analyzeTaskComplexity(request);
  }

  formatTaskGraph(taskGraph: TaskGraph | undefined): string {
    if (!taskGraph) return 'No task graph available';

    const lines: string[] = [
      `=== Task Graph v${taskGraph.planVersion} ===`,
      `Total Tasks: ${Object.keys(taskGraph.tasks).length}`,
      '',
    ];

    Object.values(taskGraph.tasks).forEach((task, index) => {
      lines.push(`[${index + 1}] ${task.taskId}`);
      lines.push(`    Type: ${task.type}`);
      lines.push(`    Status: ${task.status}`);
      lines.push(`    Priority: ${task.priority}`);
      lines.push(`    Description: ${task.description.substring(0, 50)}...`);
      if (task.dependencies.length > 0) {
        lines.push(`    Dependencies: ${task.dependencies.join(', ')}`);
      }
      if (task.assignedAgentId) {
        lines.push(`    Agent: ${task.assignedAgentId}`);
      }
      lines.push('');
    });

    return lines.join('\n');
  }

  formatAgents(agents: AgentDescriptor[]): string {
    if (agents.length === 0) return 'No agents created';

    const lines: string[] = [
      `=== Agents (${agents.length}) ===`,
      '',
    ];

    agents.forEach((agent, index) => {
      lines.push(`[${index + 1}] ${agent.agentName} (${agent.agentId})`);
      lines.push(`    Role: ${agent.role}`);
      lines.push(`    Model: ${agent.modelId}`);
      lines.push(`    Backend: ${agent.backendType}`);
      lines.push(`    Created by: ${agent.createdBy}`);
      lines.push(`    Lifetime: ${agent.lifetimePolicy}`);
      lines.push('');
    });

    return lines.join('\n');
  }
}
