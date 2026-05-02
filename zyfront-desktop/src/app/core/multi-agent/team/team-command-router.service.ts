import { Injectable, inject } from '@angular/core';
import type { ParsedTeamCommand, CommandResult } from './team.types';
import { TeamRoleCommandService } from './team-role-command.service';
import { TeamStructCommandService } from './team-struct-command.service';
import { TeamSubagentCommandService } from './team-subagent-command.service';
import { TeamAgentCommandService } from './team-agent-command.service';
import { TeamRunCommandService } from './team-run-command.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface TokenizedArg {
  value: string;
  quoted: boolean;
  index: number;
}

export interface TokenizeResult {
  tokens: TokenizedArg[];
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class TeamCommandRouterService {
  private readonly roleCmd = inject(TeamRoleCommandService);
  private readonly structCmd = inject(TeamStructCommandService);
  private readonly subagentCmd = inject(TeamSubagentCommandService);
  private readonly agentCmd = inject(TeamAgentCommandService);
  private readonly runCmd = inject(TeamRunCommandService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  tokenize(input: string): TokenizeResult {
    const tokens: TokenizedArg[] = [];
    const errors: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    let index = 0;
    let tokenStartIndex = 0;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];

      if (inQuote) {
        if (ch === quoteChar) {
          inQuote = false;
          if (current.length > 0) {
            tokens.push({ value: current, quoted: true, index: tokenStartIndex });
            current = '';
            index++;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"' || ch === "'") {
          if (current.length > 0) {
            tokens.push({ value: current, quoted: false, index: tokenStartIndex });
            current = '';
            index++;
          }
          inQuote = true;
          quoteChar = ch;
          tokenStartIndex = index;
        } else if (ch === ' ' || ch === '\t') {
          if (current.length > 0) {
            tokens.push({ value: current, quoted: false, index: tokenStartIndex });
            current = '';
            index++;
          }
        } else {
          if (current.length === 0) {
            tokenStartIndex = index;
          }
          current += ch;
        }
      }
    }

    if (inQuote) {
      errors.push(`未闭合的引号：缺少结束 ${quoteChar}`);
      if (current.length > 0) {
        tokens.push({ value: current, quoted: true, index: tokenStartIndex });
      }
    } else if (current.length > 0) {
      tokens.push({ value: current, quoted: false, index: tokenStartIndex });
    }

    return { tokens, errors };
  }

  parse(raw: string): ParsedTeamCommand | null {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/team')) return null;

    const { tokens, errors } = this.tokenize(trimmed);

    if (tokens.length < 1) return null;

    const commandToken = tokens[0].value;

    if (commandToken === '/team-role') {
      const subcommand = tokens[1]?.value || '';
      const args = tokens.slice(2).map(t => t.value);
      return {
        family: 'team-role',
        subcommand,
        args,
        raw: trimmed,
        tokenErrors: errors.length > 0 ? errors : undefined,
      };
    }

    if (commandToken === '/team-struct') {
      const subcommand = tokens[1]?.value || '';
      const args = tokens.slice(2).map(t => t.value);
      return {
        family: 'team-struct',
        subcommand,
        args,
        raw: trimmed,
        tokenErrors: errors.length > 0 ? errors : undefined,
      };
    }

    if (commandToken === '/team-subagent') {
      const roleList = tokens[1]?.value || '';
      const task = tokens.slice(2).map(t => t.value).join(' ');
      return {
        family: 'team-subagent',
        subcommand: 'run',
        args: [roleList, task],
        raw: trimmed,
        tokenErrors: errors.length > 0 ? errors : undefined,
      };
    }

    if (commandToken === '/team-agent') {
      const roleList = tokens[1]?.value || '';
      const task = tokens.slice(2).map(t => t.value).join(' ');
      return {
        family: 'team-agent',
        subcommand: 'run',
        args: [roleList, task],
        raw: trimmed,
        tokenErrors: errors.length > 0 ? errors : undefined,
      };
    }

    if (commandToken === '/team-run') {
      const subcommand = tokens[1]?.value || '';
      const args = tokens.slice(2).map(t => t.value);
      return {
        family: 'team-run',
        subcommand,
        args,
        raw: trimmed,
        tokenErrors: errors.length > 0 ? errors : undefined,
      };
    }

    if (commandToken === '/team') {
      const subcommand = tokens[1]?.value || '';
      const args = tokens.slice(2).map(t => t.value);
      return {
        family: 'team',
        subcommand,
        args,
        raw: trimmed,
        tokenErrors: errors.length > 0 ? errors : undefined,
      };
    }

    return null;
  }

  async execute(raw: string): Promise<CommandResult> {
    const parsed = this.parse(raw);
    if (!parsed) {
      return {
        ok: false,
        command: raw,
        message: '无法解析团队命令',
        errors: ['无效的团队命令格式。输入 /team help 查看支持的命令'],
      };
    }

    if (parsed.tokenErrors && parsed.tokenErrors.length > 0) {
      return {
        ok: false,
        command: raw,
        message: '命令解析错误',
        errors: parsed.tokenErrors,
      };
    }

    let result: CommandResult;

    switch (parsed.family) {
      case 'team-role':
        result = await this.executeRoleCommand(parsed);
        break;
      case 'team-struct':
        result = await this.executeStructCommand(parsed);
        break;
      case 'team-subagent':
        result = await this.executeSubagentCommand(parsed);
        break;
      case 'team-agent':
        result = await this.executeAgentCommand(parsed);
        break;
      case 'team-run':
        result = await this.executeTeamRunCommand(parsed);
        break;
      case 'team':
        result = await this.executeTeamCommand(parsed);
        break;
      default:
        result = {
          ok: false,
          command: raw,
          message: `未知的命令族：${parsed.family}`,
          errors: [`未知命令族：${parsed.family}`],
        };
    }

    const normalizedResult = {
      ...result,
      message: this.formatTeamLabel(result.message),
      errors: result.errors?.map((msg) => this.formatTeamLabel(msg)),
      warnings: result.warnings?.map((msg) => this.formatTeamLabel(msg)),
      metadata: result.metadata,
    };

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_COMMAND_EXECUTED,
      sessionId: 'team-command-router',
      source: 'user',
      payload: { command: raw, result: normalizedResult },
    });

    return normalizedResult;
  }

  private formatTeamLabel(text: string): string {
    return text.replace(/^\[\/directive\s+team-role\]\s*/i, '[team-role] ')
      .replace(/^\[\/directive\s+team-struct\]\s*/i, '[team-struct] ')
      .replace(/^\/directive\s+team-role\s*/i, '[team-role] ')
      .replace(/^\/directive\s+team-struct\s*/i, '[team-struct] ');
  }

  private async executeRoleCommand(parsed: ParsedTeamCommand): Promise<CommandResult> {
    switch (parsed.subcommand) {
      case 'new': {
        const [name, ...promptParts] = parsed.args;
        const prompt = promptParts.join(' ');
        return this.roleCmd.executeNew(name || '', prompt);
      }
      case 'delete': {
        const name = parsed.args[0] || '';
        return this.roleCmd.executeDelete(name);
      }
      case 'list':
        return this.roleCmd.executeList();
      case 'info': {
        const name = parsed.args[0];
        if (!name) {
          return {
            ok: false,
            command: parsed.raw,
            message: '缺少角色名称',
            errors: ['用法：/team-role info <角色名>'],
          };
        }
        return this.roleCmd.executeInfo(name);
      }
      default:
        return {
          ok: false,
          command: parsed.raw,
          message: `未知的 /team-role 子命令：${parsed.subcommand}`,
          errors: ['支持：new, delete, list, info'],
        };
    }
  }

  private async executeStructCommand(parsed: ParsedTeamCommand): Promise<CommandResult> {
    switch (parsed.subcommand) {
      case 'new': {
        const [name, ...promptParts] = parsed.args;
        const prompt = promptParts.join(' ');
        return this.structCmd.executeNew(name || '', prompt);
      }
      case 'confirm': {
        const name = parsed.args[0] || '';
        return this.structCmd.executeConfirm(name);
      }
      case 'reject': {
        const name = parsed.args[0] || '';
        return this.structCmd.executeReject(name);
      }
      case 'update': {
        const userInput = parsed.args.join(' ');
        return this.structCmd.updatePlanWithUserInput(userInput);
      }
      case 'delete': {
        const name = parsed.args[0] || '';
        return this.structCmd.executeDelete(name);
      }
      case 'list':
        return this.structCmd.executeList();
      case 'info': {
        const name = parsed.args[0];
        if (!name) {
          return {
            ok: false,
            command: parsed.raw,
            message: '缺少协作结构名称',
            errors: ['用法：/team-struct info <结构名>'],
          };
        }
        return this.structCmd.executeInfo(name);
      }
      default:
        return {
          ok: false,
          command: parsed.raw,
          message: `未知的 /team-struct 子命令：${parsed.subcommand}`,
          errors: ['支持：new, confirm, reject, delete, list, info'],
        };
    }
  }

  private async executeSubagentCommand(parsed: ParsedTeamCommand): Promise<CommandResult> {
    const roleList = parsed.args[0];
    const task = parsed.args[1];

    if (!roleList) {
      return {
        ok: false,
        command: parsed.raw,
        message: '缺少角色列表',
        errors: ['用法：/team-subagent frontend,backend "任务描述"'],
      };
    }
    if (!task) {
      return {
        ok: false,
        command: parsed.raw,
        message: '缺少任务描述',
        errors: ['用法：/team-subagent frontend,backend "任务描述"'],
      };
    }

    const roles = roleList.split(',').map(r => r.trim()).filter(Boolean);
    return this.subagentCmd.execute(roles, task);
  }

  private async executeAgentCommand(parsed: ParsedTeamCommand): Promise<CommandResult> {
    const roleList = parsed.args[0];
    const task = parsed.args[1];

    if (!roleList) {
      return {
        ok: false,
        command: parsed.raw,
        message: '缺少角色列表',
        errors: ['用法：/team-agent frontend,backend,qa "任务描述"'],
      };
    }
    if (!task) {
      return {
        ok: false,
        command: parsed.raw,
        message: '缺少任务描述',
        errors: ['用法：/team-agent frontend,backend,qa "任务描述"'],
      };
    }

    const roles = roleList.split(',').map(r => r.trim()).filter(Boolean);
    return this.agentCmd.execute(roles, task);
  }

  private async executeTeamCommand(parsed: ParsedTeamCommand): Promise<CommandResult> {
    if (!parsed.subcommand) {
      return {
        ok: true,
        command: parsed.raw,
        message: '团队命令帮助',
        data: this.getHelpInfo(),
      };
    }

    switch (parsed.subcommand) {
      case 'run': {
        const structSubcommand = parsed.args[0];
        if (structSubcommand === 'struct') {
          const structName = parsed.args[1];
          const task = parsed.args.slice(2).join(' ');
          if (!structName) {
            return {
              ok: false,
              command: parsed.raw,
              message: '缺少协作结构名称',
              errors: ['用法：/team run struct "结构名" "任务描述"'],
            };
          }
          if (!task) {
            return {
              ok: false,
              command: parsed.raw,
              message: '缺少任务描述',
              errors: ['用法：/team run struct "结构名" "任务描述"'],
            };
          }
          return this.runCmd.executeStruct(structName, task);
        }
        return {
          ok: false,
          command: parsed.raw,
          message: `未知的 /team run 子命令：${structSubcommand}`,
          errors: ['支持：struct'],
        };
      }
      case 'status':
        return this.runCmd.status(parsed.args[0]);
      case 'pause':
        return this.runCmd.pauseTeam(parsed.args[0] || '');
      case 'resume':
        return this.runCmd.resumeTeam(parsed.args[0] || '');
      case 'stop':
        return this.runCmd.stopTeam(parsed.args[0] || '');
      case 'help':
        return {
          ok: true,
          command: parsed.raw,
          message: '团队命令帮助',
          data: this.getHelpInfo(),
        };
      default:
        return {
          ok: false,
          command: parsed.raw,
          message: `未知的 /team 子命令：${parsed.subcommand}`,
          errors: ['支持：run, status, pause, resume, stop, help'],
        };
    }
  }

  private async executeTeamRunCommand(parsed: ParsedTeamCommand): Promise<CommandResult> {
    const structName = parsed.subcommand;
    const task = parsed.args.join(' ');

    if (!structName) {
      return {
        ok: false,
        command: parsed.raw,
        message: '缺少协作结构名称',
        errors: ['用法：/team-run <结构名> <任务描述>'],
      };
    }
    if (!task) {
      return {
        ok: false,
        command: parsed.raw,
        message: '缺少任务描述',
        errors: ['用法：/team-run <结构名> <任务描述>'],
      };
    }
    return this.runCmd.executeStruct(structName, task);
  }

  isTeamCommand(input: string): boolean {
    return this.parse(input) !== null;
  }

  getSupportedCommands(): string[] {
    return [
      '/team-role new <role-name> <role-prompt>',
      '/team-role delete <role-name>',
      '/team-role list',
      '/team-role info <role-name>',
      '/team-struct new <struct-name> <struct-prompt>',
      '/team-struct confirm <struct-name>',
      '/team-struct reject <struct-name>',
      '/team-struct delete <struct-name>',
      '/team-struct list',
      '/team-struct info <struct-name>',
      '/team run struct "结构名" "任务"',
      '/team-run <结构名> "任务描述"',
      '/team-subagent frontend,backend "任务"',
      '/team-agent frontend,backend,qa "任务"',
      '/team status [teamId]',
      '/team pause <teamId>',
      '/team resume <teamId>',
      '/team stop <teamId>',
      '/team help',
    ];
  }

  getHelpInfo(): { commands: Array<{ usage: string; description: string }> } {
    return {
      commands: [
        { usage: '/team', description: '显示团队命令帮助' },
        { usage: '/team status [teamId]', description: '查看团队运行状态，不传 teamId 则查看当前活跃团队' },
        { usage: '/team run struct "结构名" "任务"', description: '使用指定协作结构运行团队任务' },
        { usage: '/team-run <结构名> "任务描述"', description: '快捷方式：使用指定协作结构运行团队任务' },
        { usage: '/team pause <teamId>', description: '暂停指定团队的运行' },
        { usage: '/team resume <teamId>', description: '恢复暂停的团队运行' },
        { usage: '/team stop <teamId>', description: '停止并关闭指定团队' },
        { usage: '/team-role new <role-name> <role-prompt>', description: '创建新角色定义' },
        { usage: '/team-role delete <role-name>', description: '删除指定角色定义文件' },
        { usage: '/team-role list', description: '列出所有已定义的角色' },
        { usage: '/team-role info <role-name>', description: '查看指定角色的详细信息' },
        { usage: '/team-struct new <struct-name> <struct-prompt>', description: '创建新的协作结构定义（需确认）' },
        { usage: '/team-struct confirm <struct-name>', description: '确认并正式创建待确认的协作结构' },
        { usage: '/team-struct reject <struct-name>', description: '取消待确认的协作结构方案' },
        { usage: '/team-struct delete <struct-name>', description: '删除指定协作结构定义文件' },
        { usage: '/team-struct list', description: '列出所有已定义的协作结构' },
        { usage: '/team-struct info <struct-name>', description: '查看指定协作结构的详细信息' },
        { usage: '/team-subagent frontend,backend "任务"', description: '以子代理模式运行多角色任务（并行独立执行）' },
        { usage: '/team-agent frontend,backend,qa "任务"', description: '以团队协作模式运行多角色任务（协作执行）' },
      ],
    };
  }
}
