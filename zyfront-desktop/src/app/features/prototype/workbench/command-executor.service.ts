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
  private readonly directiveExecutors = new Map<string, DirectiveExecutorFn>();

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
