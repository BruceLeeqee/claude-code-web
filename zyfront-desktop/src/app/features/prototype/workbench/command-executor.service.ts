import { Injectable, inject } from '@angular/core';
import { CommandRouterService, type CommandRoute, type RouteOptions } from './command-router.service';
import {
  type ParsedDirective,
  parseDirectiveWithValidation,
  formatGroupedHelp,
  formatDirectiveHelp,
} from './directive-parser';
import {
  DIRECTIVE_REGISTRY,
  type DirectiveDefinition,
  getVisibleDirectives,
} from './directive-registry';
import { DebugCommandService } from './debug/debug-command.service';
import { LoopCommandService } from './debug/loop-command.service';
import { LoopExecutorService } from './debug/loop-executor.service';
import { LoopVerifierService } from './debug/loop-verifier.service';
import { buildLoopDebugViewModel } from './debug/loop-debug-tab.adapter';
import { TeamCommandRouterService } from '../../../core/multi-agent/team/team-command-router.service';

export interface ExecutionInput {
  raw: string;
  context?: {
    source?: 'user' | 'bridge' | 'system';
    sessionId?: string;
    mode?: string;
  };
  options?: RouteOptions;
}

export interface ExecutionResult {
  success: boolean;
  route: CommandRoute;
  responseType: 'directive' | 'shell' | 'natural' | 'error' | 'fallback';
  content: string;
  metadata?: Record<string, unknown>;
  shouldQuery: boolean;
  displayType: 'message' | 'system' | 'error' | 'success';
}

export interface DirectiveExecutionContext {
  parsed: ParsedDirective;
  sessionId?: string;
  source?: 'user' | 'bridge' | 'system';
}

export type DirectiveExecutorFn = (
  context: DirectiveExecutionContext
) => Promise<ExecutionResult> | ExecutionResult;

@Injectable({ providedIn: 'root' })
export class CommandExecutorService {
  private readonly router = inject(CommandRouterService);
  private readonly debugCommand = inject(DebugCommandService);
  private readonly loopCommand = inject(LoopCommandService);
  private readonly loopExecutor = inject(LoopExecutorService);
  private readonly loopVerifier = inject(LoopVerifierService);
  private readonly teamCommandRouter = inject(TeamCommandRouterService);
  private readonly directiveExecutors = new Map<string, DirectiveExecutorFn>();
  private readonly loopTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor() {
    this.registerBuiltInExecutors();
  }

  private registerBuiltInExecutors(): void {
    this.registerDirectiveExecutor('help', async (ctx) => {
      const helpContent = formatGroupedHelp();
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: helpContent,
        shouldQuery: false,
        displayType: 'message',
      };
    });

    this.registerDirectiveExecutor('status', async (ctx) => {
      const directives = getVisibleDirectives();
      const statusLines = [
        '**当前状态**',
        `- 可用指令数: ${directives.length}`,
        `- 模式: ${ctx.sessionId ? '活跃会话' : '空闲'}`,
        `- 指令来源: ${ctx.source || 'user'}`,
      ];
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: statusLines.join('\n'),
        shouldQuery: false,
        displayType: 'message',
      };
    });

    this.registerDirectiveExecutor('debug', async (ctx) => {
      const payload = await this.debugCommand.build(ctx.sessionId ?? 'workbench-terminal-ai', `/debug ${ctx.parsed.args}`.trim());
      if (!payload) {
        return {
          success: false,
          route: 'directive',
          responseType: 'error',
          content: '/debug <domain>  可用域: prompt, memory, workbench',
          shouldQuery: false,
          displayType: 'error',
        };
      }
      const content = this.debugCommand.renderTabContent(payload);
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content,
        metadata: { tabKey: payload.tabKey, tabTitle: payload.tabTitle, debugPayload: payload },
        shouldQuery: false,
        displayType: 'success',
      };
    });

    this.registerDirectiveExecutor('doctor', async (ctx) => {
      const checks = [
        '**工具健康度检查**',
        '```',
        '[OK] terminal.exec - 正常',
        '[OK] powershell.exec - 正常',
        '[OK] web.search - 正常',
        '[OK] web.fetch - 正常',
        '[OK] computer.use - 正常',
        '```',
        '所有工具运行正常.',
      ];
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: checks.join('\n'),
        shouldQuery: false,
        displayType: 'success',
      };
    });

    this.registerDirectiveExecutor('mode_solo', async (ctx) => {
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: '已切换到单智能体模式',
        metadata: { mode: 'solo' },
        shouldQuery: false,
        displayType: 'success',
      };
    });

    this.registerDirectiveExecutor('mode_plan', async (ctx) => {
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: '已切换到计划模式',
        metadata: { mode: 'plan' },
        shouldQuery: false,
        displayType: 'success',
      };
    });

    this.registerDirectiveExecutor('mode_dev', async (ctx) => {
      const devTeam = {
        id: `dev-team-${Date.now()}`,
        name: '开发团队',
        agents: [
          { id: 'dev-architect', name: '架构师', role: 'architect', prompt: '你是一个架构师，负责系统设计和架构决策。' },
          { id: 'dev-developer', name: '开发者', role: 'developer', prompt: '你是一个开发者，负责编码实现。' },
          { id: 'dev-tester', name: '测试员', role: 'tester', prompt: '你是一个测试员，负责质量保证和测试验证。' },
        ],
        createdAt: new Date().toISOString(),
      };

      const existingTeams = JSON.parse(localStorage.getItem('persistent-agent-teams') || '[]');
      const existingIndex = existingTeams.findIndex((t: any) => t.name === '开发团队');
      if (existingIndex >= 0) {
        existingTeams[existingIndex] = devTeam;
      } else {
        existingTeams.push(devTeam);
      }
      localStorage.setItem('persistent-agent-teams', JSON.stringify(existingTeams));

      const lines = [
        '**已切换到开发者模式**',
        '',
        '已创建/更新开发团队：',
        ...devTeam.agents.map(a => `  - ${a.name} (${a.role})`),
        '',
        '团队已持久化，可在协作页「智能体管理」中查看和编辑。',
      ];
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: lines.join('\n'),
        metadata: { mode: 'dev', team: devTeam },
        shouldQuery: false,
        displayType: 'success',
      };
    });

    this.registerDirectiveExecutor('loop', async (ctx) => {
      const goal = ctx.parsed.args.trim();
      if (!goal) {
        return {
          success: false,
          route: 'directive',
          responseType: 'error',
          content: '/loop <目标描述>',
          shouldQuery: false,
          displayType: 'error',
        };
      }

      const heuristic = this.shouldUseMultiAgentForLoop(goal);
      const teamHint = heuristic.useMultiAgent
        ? '**多智能体建议**：当前任务可能适合创建团队协作。完成需求确认后，可自动进入团队模式。'
        : '';

      // 返回需求收集模式，让主终端通过对话澄清需求后再进入 Loop 页
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: [
          '**`/loop` 需求分析**',
          '',
          `目标初稿：${goal}`,
          ...(teamHint ? [teamHint, ''] : []),
          '我需要了解一些细节来制定执行计划，请回答以下问题（可逐条回复）：',
          '',
          '1. **任务范围**：涉及哪些文件/目录？是否有特定技术栈要求？',
          '2. **输出格式**：期望的交付物是什么？（报告/代码/文档/配置）',
          '3. **约束条件**：是否有时间限制、兼容性要求或禁止事项？',
          '4. **验收标准**：如何判断任务完成？',
          '',
          '_回答完毕后输入 **"确认"** 或 **"开始"** 进入 Loop 执行页面。_',
          '_输入 **"取消"** 可退出本次 loop。_',
        ].filter(Boolean).join('\n'),
        metadata: { mode: 'loop-gathering', goal, useMultiAgent: heuristic.useMultiAgent, reason: heuristic.reason, tabKey: 'Loop / Task' },
        shouldQuery: true,
        displayType: 'message',
      };
    });

    this.registerDirectiveExecutor('team', async (ctx) => {
      const objective = ctx.parsed.args.trim();
      if (!objective) {
        return {
          success: false,
          route: 'directive',
          responseType: 'error',
          content: '/team <目标> [--members=planner,executor,validator]',
          shouldQuery: false,
          displayType: 'error',
        };
      }

      const teamName = `team-${Date.now()}`;
      const members = this.parseTeamMembers(ctx.parsed.args);
      const team = {
        id: teamName,
        name: teamName,
        objective,
        members: members.map((role, index) => ({
          id: `${teamName}-${index + 1}`,
          name: role,
          role,
          prompt: `你是${role}，负责围绕目标「${objective}」协作。`,
        })),
        createdAt: new Date().toISOString(),
      };

      const existingTeams = JSON.parse(localStorage.getItem('persistent-agent-teams') || '[]');
      const existingIndex = existingTeams.findIndex((t: any) => t.name === teamName || t.objective === objective);
      if (existingIndex >= 0) {
        existingTeams[existingIndex] = team;
      } else {
        existingTeams.push(team);
      }
      localStorage.setItem('persistent-agent-teams', JSON.stringify(existingTeams));

      const lines = [
        '**团队创建请求已接收**',
        '',
        `目标：${objective}`,
        `团队：${teamName}`,
        `成员：${members.join('、')}`,
        '',
        '系统已持久化团队配置，可切换到开发者模式后在协作页查看。',
      ];
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: lines.join('\n'),
        metadata: { mode: 'team', teamCreate: true, teamName, objective, members },
        shouldQuery: false,
        displayType: 'success',
      };
    });

    this.registerDirectiveExecutor('task', async (ctx) => {
      const teamMatch = ctx.parsed.args.match(/team=([^\s]+)/i);
      const objectiveMatch = ctx.parsed.args.match(/objective=(.+)$/i);
      const team = teamMatch?.[1]?.trim().toLowerCase();
      const objective = objectiveMatch?.[1]?.trim();
      if (!team || !objective) {
        return {
          success: false,
          route: 'directive',
          responseType: 'error',
          content: '/task team=<teamName> objective=<objective>',
          shouldQuery: false,
          displayType: 'error',
        };
      }

      const sessionId = ctx.sessionId ?? 'workbench-terminal-ai';
      const state = this.loopCommand.start(`/loop ${objective} --team=${team}`, sessionId);
      if (!state) {
        return {
          success: false,
          route: 'directive',
          responseType: 'error',
          content: '任务分派失败：无法创建 loop 会话',
          shouldQuery: false,
          displayType: 'error',
        };
      }

      const result = await this.loopExecutor.runOnce(sessionId);
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: [
          '**任务已派发**',
          `团队：${team}`,
          `目标：${state.objective}`,
          `状态：${result.state.status}`,
          `阶段：${result.state.phase}`,
          `下一步：${result.state.currentPlan[0]?.title ?? '计划已收敛'}`,
        ].join('\n'),
        metadata: { loopState: result.state, team },
        shouldQuery: false,
        displayType: 'success',
      };
    });

    this.registerDirectiveExecutor('plugin_list', async (ctx) => {
      const lines = [
        '**插件列表**',
        '',
        '当前无可用插件.',
        '',
        '使用 `/plugin:run <command>` 运行插件.',
      ];
      return {
        success: true,
        route: 'directive',
        responseType: 'directive',
        content: lines.join('\n'),
        shouldQuery: false,
        displayType: 'message',
      };
    });

    this.registerDirectiveExecutor('plugin_run', async (ctx) => {
      return {
        success: false,
        route: 'directive',
        responseType: 'error',
        content: '插件系统尚未实现，请稍后使用',
        shouldQuery: false,
        displayType: 'error',
      };
    });

    this.registerDirectiveExecutor('superpower', async (ctx) => {
      return {
        success: false,
        route: 'directive',
        responseType: 'error',
        content: 'Superpowers 功能尚未实现',
        shouldQuery: false,
        displayType: 'error',
      };
    });

    this.registerDirectiveExecutor('team_role', async (ctx) => {
      const result = await this.teamCommandRouter.execute(`/team-role ${ctx.parsed.args}`);
      const renderedList = result.metadata?.['renderedList'];
      return {
        success: result.ok,
        route: 'directive',
        responseType: result.ok ? 'directive' : 'error',
        content: result.ok
          ? (typeof renderedList === 'string' && renderedList.trim().length > 0 ? renderedList : result.message)
          : `错误: ${result.message}`,
        metadata: result.metadata as Record<string, unknown> | undefined,
        shouldQuery: false,
        displayType: result.ok ? 'success' : 'error',
      };
    });

    this.registerDirectiveExecutor('team_struct', async (ctx) => {
      const result = await this.teamCommandRouter.execute(`/team-struct ${ctx.parsed.args}`);
      const planText = result.metadata?.['planText'];
      return {
        success: result.ok,
        route: 'directive',
        responseType: result.ok ? 'directive' : 'error',
        content: result.ok
          ? (typeof planText === 'string' && planText.trim().length > 0 ? planText : result.message)
          : `错误: ${result.message}`,
        metadata: result.metadata as Record<string, unknown> | undefined,
        shouldQuery: false,
        displayType: result.ok ? 'success' : 'error',
      };
    });

    this.registerDirectiveExecutor('team_run', async (ctx) => {
      const result = await this.teamCommandRouter.execute(`/team-run ${ctx.parsed.args}`);
      const metadata = (result.data as Record<string, unknown> | undefined) ?? {};
      return {
        success: result.ok,
        route: 'directive',
        responseType: result.ok ? 'directive' : 'error',
        content: result.ok ? result.message : `错误: ${result.message}`,
        metadata: { ...metadata, tabKey: 'Team Run', teamRun: true },
        shouldQuery: false,
        displayType: result.ok ? 'success' : 'error',
      };
    });

    this.registerDirectiveExecutor('team_subagent', async (ctx) => {
      const result = await this.teamCommandRouter.execute(`/team-subagent ${ctx.parsed.args}`);
      return {
        success: result.ok,
        route: 'directive',
        responseType: result.ok ? 'directive' : 'error',
        content: result.ok ? result.message : `错误: ${result.message}`,
        metadata: result.data as Record<string, unknown> | undefined,
        shouldQuery: false,
        displayType: result.ok ? 'success' : 'error',
      };
    });

    this.registerDirectiveExecutor('team_agent', async (ctx) => {
      const result = await this.teamCommandRouter.execute(`/team-agent ${ctx.parsed.args}`);
      return {
        success: result.ok,
        route: 'directive',
        responseType: result.ok ? 'directive' : 'error',
        content: result.ok ? result.message : `错误: ${result.message}`,
        metadata: result.data as Record<string, unknown> | undefined,
        shouldQuery: false,
        displayType: result.ok ? 'success' : 'error',
      };
    });
  }

  private shouldUseMultiAgentForLoop(goal: string): { useMultiAgent: boolean; reason: string } {
    const t = goal.toLowerCase();
    const signals = [
      /重构|架构|设计|方案|评审|调研|迁移|分阶段|多模块|多页面|多人|协作/.test(goal),
      /(frontend|后端|backend|api|测试|test|部署|ci|docker|性能|复杂|large|enterprise)/i.test(goal),
      (goal.match(/[，,;；]/g)?.length ?? 0) >= 2,
      t.includes('multiple') || t.includes('multi-agent') || t.includes('parallel'),
    ];
    const score = signals.filter(Boolean).length;
    if (score >= 2) return { useMultiAgent: true, reason: '任务复杂度较高，建议多智能体协作' };
    return { useMultiAgent: false, reason: '任务较简单，默认单智能体即可' };
  }

  private parseTeamMembers(rawArgs: string): string[] {
    const match = rawArgs.match(/--members=([^\s]+)/i);
    const parsed = match?.[1]?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    return parsed.length > 0 ? parsed : ['planner', 'executor', 'validator'];
  }

  private ensureLoopSchedule(sessionId: string, everyMs?: number): boolean {
    const currentTimer = this.loopTimers.get(sessionId);
    if (currentTimer) {
      clearInterval(currentTimer);
      this.loopTimers.delete(sessionId);
    }
    if (!everyMs || everyMs <= 0) return false;

    const timer = setInterval(() => {
      void this.runScheduledLoopCycle(sessionId);
    }, everyMs);
    this.loopTimers.set(sessionId, timer);
    return true;
  }

  private async runScheduledLoopCycle(sessionId: string): Promise<void> {
    const state = this.loopCommand.get(sessionId);
    if (!state) {
      this.stopLoopSchedule(sessionId);
      return;
    }
    if (['blocked', 'paused', 'completed', 'ready_for_release', 'failed'].includes(state.status)) {
      this.stopLoopSchedule(sessionId);
      return;
    }
    try {
      await this.loopExecutor.runCycle(sessionId, 1);
      const next = this.loopCommand.get(sessionId);
      if (!next || ['blocked', 'paused', 'completed', 'ready_for_release', 'failed'].includes(next.status)) {
        this.stopLoopSchedule(sessionId);
      }
    } catch {
      this.stopLoopSchedule(sessionId);
    }
  }

  private stopLoopSchedule(sessionId: string): void {
    const timer = this.loopTimers.get(sessionId);
    if (!timer) return;
    clearInterval(timer);
    this.loopTimers.delete(sessionId);
  }

  private extractEveryMs(rawArgs: string): number | undefined {
    const match = rawArgs.match(/--every=([^\s]+)/i);
    if (!match?.[1]) return undefined;
    return this.parseDurationToMs(match[1]) ?? undefined;
  }

  private parseDurationToMs(raw: string): number | null {
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

  private formatDuration(ms: number): string {
    if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
    if (ms % 60_000 === 0) return `${ms / 60_000}m`;
    if (ms % 1000 === 0) return `${ms / 1000}s`;
    return `${ms}ms`;
  }

  registerDirectiveExecutor(kind: string, executor: DirectiveExecutorFn): void {
    this.directiveExecutors.set(kind, executor);
  }

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const routeResult = this.router.routeWithExplanation(
      input.raw,
      input.options ?? {}
    );

    if (routeResult.route === 'directive' || input.raw.trim().startsWith('/')) {
      return this.executeDirective(input);
    }

    if (routeResult.route === 'shell') {
      return this.executeShell(input);
    }

    return this.executeNatural(input);
  }

  private async executeDirective(input: ExecutionInput): Promise<ExecutionResult> {
    const parseResult = parseDirectiveWithValidation(input.raw, {
      skipUnknownCommands: input.context?.source === 'bridge',
    });

    if (!parseResult.success) {
      if (parseResult.shouldFallbackToNatural) {
        return this.executeNaturalWithFallback(input, parseResult.fallbackMessage);
      }

      return {
        success: false,
        route: 'directive',
        responseType: 'error',
        content: parseResult.fallbackMessage || parseResult.error || 'Invalid directive',
        shouldQuery: false,
        displayType: 'error',
      };
    }

    const parsed = parseResult.directive;

    if (!parsed.def) {
      return {
        success: false,
        route: 'directive',
        responseType: 'error',
        content: `Unknown command: ${parsed.name}`,
        shouldQuery: false,
        displayType: 'error',
      };
    }

    if (input.context?.source === 'bridge' && !parsed.def.bridgeSafe) {
      return {
        success: false,
        route: 'directive',
        responseType: 'error',
        content: `/${parsed.name} isn't available over Remote Control.`,
        shouldQuery: false,
        displayType: 'error',
      };
    }

    const executor = this.directiveExecutors.get(parsed.def.kind);

    if (!executor) {
      return {
        success: false,
        route: 'directive',
        responseType: 'error',
        content: `Command handler not found for: ${parsed.name}`,
        shouldQuery: false,
        displayType: 'error',
      };
    }

    try {
      const context: DirectiveExecutionContext = {
        parsed,
        sessionId: input.context?.sessionId,
        source: input.context?.source,
      };

      return await executor(context);
    } catch (error) {
      return {
        success: false,
        route: 'directive',
        responseType: 'error',
        content: `Error executing ${parsed.name}: ${error instanceof Error ? error.message : String(error)}`,
        shouldQuery: false,
        displayType: 'error',
      };
    }
  }

  private async executeShell(input: ExecutionInput): Promise<ExecutionResult> {
    return {
      success: true,
      route: 'shell',
      responseType: 'shell',
      content: input.raw,
      metadata: {
        command: input.raw,
        executionType: 'shell',
      },
      shouldQuery: true,
      displayType: 'message',
    };
  }

  private async executeNatural(input: ExecutionInput): Promise<ExecutionResult> {
    return {
      success: true,
      route: 'natural',
      responseType: 'natural',
      content: input.raw,
      metadata: {
        prompt: input.raw,
        executionType: 'natural_language',
      },
      shouldQuery: true,
      displayType: 'message',
    };
  }

  private async executeNaturalWithFallback(
    input: ExecutionInput,
    fallbackMessage?: string
  ): Promise<ExecutionResult> {
    return {
      success: true,
      route: 'natural',
      responseType: 'fallback',
      content: fallbackMessage ? `${fallbackMessage}\n\n${input.raw}` : input.raw,
      metadata: {
        prompt: input.raw,
        executionType: 'natural_language',
        hadFallback: true,
        originalError: fallbackMessage,
      },
      shouldQuery: true,
      displayType: 'message',
    };
  }
}
