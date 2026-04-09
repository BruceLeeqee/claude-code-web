import type { CoordinationMode } from 'zyfront-core';

export type DirectiveKind = 'help' | 'status' | 'mode' | 'plugin_list' | 'plugin_run' | 'superpower' | 'doctor';

export interface DirectiveDefinition {
  name: string;
  desc: string;
  template: string;
  kind: DirectiveKind;
  usage?: string;
}

export interface ParsedDirective {
  raw: string;
  name: string;
  args: string;
  def: DirectiveDefinition | null;
}

export const DIRECTIVE_REGISTRY: DirectiveDefinition[] = [
  { name: '/help', desc: '显示帮助与快捷键', template: '/help', kind: 'help' },
  { name: '/status', desc: '查看当前模式/模型/任务状态', template: '/status', kind: 'status' },
  {
    name: '/mode',
    desc: '切换协调模式 single|plan|parallel',
    template: '/mode plan',
    kind: 'mode',
    usage: '/mode <single|plan|parallel>',
  },
  { name: '/plugin:list', desc: '查看插件指令列表', template: '/plugin:list', kind: 'plugin_list' },
  {
    name: '/plugin:run',
    desc: '运行插件指令（参数透传 shell）',
    template: '/plugin:run dir .',
    kind: 'plugin_run',
    usage: '/plugin:run <shell command>',
  },
  {
    name: '/superpowers:brainstorm',
    desc: '触发头脑风暴模板',
    template: '/superpowers:brainstorm',
    kind: 'superpower',
  },
  {
    name: '/doctor',
    desc: '执行 tools.doctor 并输出工具健康度',
    template: '/doctor',
    kind: 'doctor',
  },
];

export function parseDirective(raw: string): ParsedDirective {
  const trimmed = raw.trim();
  const [name = '', ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ').trim();
  const def = DIRECTIVE_REGISTRY.find((d) => d.name === name) ?? null;
  return { raw: trimmed, name, args, def };
}

export function isCoordinationMode(v: string): v is CoordinationMode {
  return v === 'single' || v === 'plan' || v === 'parallel';
}
