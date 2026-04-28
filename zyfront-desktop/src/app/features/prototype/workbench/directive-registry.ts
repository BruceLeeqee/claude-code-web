import type { CoordinationMode } from 'zyfront-core';

export type DirectiveKind =
  | 'help'
  | 'status'
  | 'debug'
  | 'mode'
  | 'mode_solo'
  | 'mode_plan'
  | 'mode_dev'
  | 'team'
  | 'team_role'
  | 'team_struct'
  | 'team_run'
  | 'team_subagent'
  | 'team_agent'
  | 'loop'
  | 'task'
  | 'plugin_list'
  | 'plugin_run'
  | 'superpower'
  | 'doctor';

export type DirectiveGroup = 'system' | 'mode' | 'plugin' | 'development' | 'utility';

export interface DirectiveConstraint {
  mode?: CoordinationMode | CoordinationMode[];
  platform?: 'windows' | 'macos' | 'linux' | 'all';
  requiresAuth?: boolean;
  featureFlag?: string;
}

export interface DirectiveAliases {
  primary: string;
  alternatives: string[];
}

export interface DirectiveDefinition {
  name: string;
  desc: string;
  template: string;
  kind: DirectiveKind;
  usage?: string;
  group?: DirectiveGroup;
  aliases?: string[];
  enabledWhen?: DirectiveConstraint;
  visibleInHelp?: boolean;
  bridgeSafe?: boolean;
  requiresArgs?: boolean;
}

export interface ParsedDirective {
  raw: string;
  name: string;
  args: string;
  def: DirectiveDefinition | null;
  isMcp: boolean;
  confidence: number;
}

export const DIRECTIVE_REGISTRY: DirectiveDefinition[] = [
  {
    name: '/help',
    desc: '显示帮助与快捷键',
    template: '/help',
    kind: 'help',
    group: 'system',
    aliases: ['/h', '/?'],
    visibleInHelp: true,
    bridgeSafe: true,
  },
  {
    name: '/status',
    desc: '查看当前模式/模型/任务状态',
    template: '/status',
    kind: 'status',
    group: 'system',
    aliases: ['/st'],
    visibleInHelp: true,
    bridgeSafe: true,
  },
  {
    name: '/debug',
    desc: '查看调试报告与诊断 Tab',
    template: '/debug <domain>',
    kind: 'debug',
    group: 'system',
    usage: '/debug prompt  /debug memory  /debug workbench',
    visibleInHelp: true,
    bridgeSafe: true,
  },
  {
    name: '/mode',
    desc: '切换到单智能体模式（默认）',
    template: '/mode',
    kind: 'mode_solo',
    group: 'mode',
    usage: '/mode 切换到单智能体模式',
    visibleInHelp: true,
    bridgeSafe: true,
  },
  {
    name: '/mode-plan',
    desc: '切换到计划模式，只生成计划文档',
    template: '/mode-plan',
    kind: 'mode_plan',
    group: 'mode',
    usage: '/mode-plan 切换到计划模式',
    visibleInHelp: true,
  },
  {
    name: '/mode-dev',
    desc: '切换到开发者模式，不自动创建团队',
    template: '/mode-dev',
    kind: 'mode_dev',
    group: 'mode',
    usage: '/mode-dev 切换到开发者模式',
    visibleInHelp: true,
  },
  {
    name: '/team',
    desc: '显式创建多智能体团队',
    template: '/team <objective>',
    kind: 'team',
    group: 'development',
    usage: '/team <目标> [--members=planner,executor,validator]',
    visibleInHelp: true,
    requiresArgs: true,
  },
  {
    name: '/team-role',
    desc: '管理角色定义（new/list/info）',
    template: '/team-role <new|list|info> [args]',
    kind: 'team_role',
    group: 'development',
    usage: '/team-role new "角色提示词"  /team-role list  /team-role info <角色名>',
    visibleInHelp: true,
    requiresArgs: true,
  },
  {
    name: '/team-struct',
    desc: '管理协作结构（new/list/info）',
    template: '/team-struct <new|list|info> [args]',
    kind: 'team_struct',
    group: 'development',
    usage: '/team-struct new "协作流程"  /team-struct list  /team-struct info <结构名>',
    visibleInHelp: true,
    requiresArgs: true,
  },
  {
    name: '/team run',
    desc: '按协作结构启动团队执行',
    template: '/team run <struct> <task>',
    kind: 'team_run',
    group: 'development',
    usage: '/team run <结构名> <团队任务>',
    visibleInHelp: true,
    requiresArgs: true,
  },
  {
    name: '/team-subagent',
    desc: '并行隔离执行多角色子智能体',
    template: '/team-subagent <roles> <task>',
    kind: 'team_subagent',
    group: 'development',
    usage: '/team-subagent frontend,backend "实现模块"',
    visibleInHelp: true,
    requiresArgs: true,
  },
  {
    name: '/team-agent',
    desc: '多角色协作运行（共享上下文）',
    template: '/team-agent <roles> <task>',
    kind: 'team_agent',
    group: 'development',
    usage: '/team-agent frontend,backend,qa "解决登录 500 错误"',
    visibleInHelp: true,
    requiresArgs: true,
  },
  {
    name: '/loop',
    desc: '自动拆解并循环执行任务，直到完成或阻塞',
    template: '/loop <goal> [--every=10s]',
    kind: 'loop',
    group: 'development',
    usage: '/loop <目标描述> [--every=10s|1m|500ms]',
    visibleInHelp: true,
  },
  {
    name: '/task',
    desc: '将任务派发给指定团队（默认触发 loop）',
    template: '/task team=<teamName> objective=<objective>',
    kind: 'task',
    group: 'development',
    usage: '/task team=dev objective=实现登录页',
    visibleInHelp: true,
    requiresArgs: true,
  },
  {
    name: '/plugin:list',
    desc: '查看插件指令列表',
    template: '/plugin:list',
    kind: 'plugin_list',
    group: 'plugin',
    aliases: ['/plugins', '/plugin:ls'],
    visibleInHelp: true,
    bridgeSafe: true,
  },
  {
    name: '/plugin:run',
    desc: '运行插件指令（参数透传 shell）',
    template: '/plugin:run <shell command>',
    kind: 'plugin_run',
    group: 'plugin',
    usage: '/plugin:run <shell command>',
    requiresArgs: true,
  },
  {
    name: '/superpowers:brainstorm',
    desc: '触发头脑风暴模板',
    template: '/superpowers:brainstorm',
    kind: 'superpower',
    group: 'development',
  },
  {
    name: '/doctor',
    desc: '执行 tools.doctor 并输出工具健康度',
    template: '/doctor',
    kind: 'doctor',
    group: 'utility',
    usage: '/doctor 检查工具健康状态',
    visibleInHelp: true,
    bridgeSafe: true,
  },
];

export function parseDirective(raw: string): ParsedDirective {
  const trimmed = raw.trim();

  if (!trimmed.startsWith('/')) {
    return { raw: trimmed, name: '', args: '', def: null, isMcp: false, confidence: 0 };
  }

  const withoutSlash = trimmed.slice(1);
  const words = withoutSlash.split(/\s+/);

  if (!words[0]) {
    return { raw: trimmed, name: '', args: '', def: null, isMcp: false, confidence: 0 };
  }

  let commandName = words[0];
  let isMcp = false;
  let argsStartIndex = 1;

  if (words.length > 1 && words[1] === '(MCP)') {
    commandName = commandName + ' (MCP)';
    isMcp = true;
    argsStartIndex = 2;
  }

  let def: DirectiveDefinition | null = null;

  if (words.length > argsStartIndex) {
    const twoWordName = `${words[0]} ${words[argsStartIndex]}`;
    const twoWordDef = findDirectiveDefinition(twoWordName);
    if (twoWordDef) {
      commandName = twoWordName;
      argsStartIndex += 1;
      def = twoWordDef;
    }
  }

  if (!def) {
    def = findDirectiveDefinition(commandName);
  }

  const args = words.slice(argsStartIndex).join(' ');

  let confidence = 0;
  if (def) {
    confidence = 1.0;
  } else if (looksLikeCommand(commandName)) {
    confidence = 0.5;
  }

  return { raw: trimmed, name: commandName, args, def, isMcp, confidence };
}

export function findDirectiveDefinition(name: string): DirectiveDefinition | null {
  const normalizedName = name.startsWith('/') ? name : `/${name}`;

  for (const def of DIRECTIVE_REGISTRY) {
    if (def.name === normalizedName) return def;

    if (def.aliases?.some(alias => {
      const normAlias = alias.startsWith('/') ? alias : `/${alias}`;
      return normAlias === normalizedName;
    })) {
      return def;
    }
  }

  return null;
}

export function getDirectiveDefinition(name: string): DirectiveDefinition | null {
  return findDirectiveDefinition(name);
}

export function isBridgeSafeDirectiveName(name: string): boolean {
  const def = findDirectiveDefinition(name);
  return def?.bridgeSafe ?? false;
}

function looksLikeCommand(name: string): boolean {
  return /^[a-zA-Z0-9:_\-]+$/.test(name);
}

export function isCoordinationMode(v: string): v is CoordinationMode {
  return v === 'single' || v === 'plan' || v === 'parallel';
}

export function getModeDirectives(): DirectiveDefinition[] {
  return DIRECTIVE_REGISTRY.filter(d => d.kind.startsWith('mode'));
}

export function getVisibleDirectives(): DirectiveDefinition[] {
  return DIRECTIVE_REGISTRY.filter(d => d.visibleInHelp !== false);
}

export function getDirectivesByGroup(group: DirectiveGroup): DirectiveDefinition[] {
  return DIRECTIVE_REGISTRY.filter(d => d.group === group);
}

export function formatDirectiveUsage(def: DirectiveDefinition): string {
  if (def.usage) return def.usage;
  return def.template;
}

