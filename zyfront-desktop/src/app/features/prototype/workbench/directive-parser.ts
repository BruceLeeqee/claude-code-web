import {
  DIRECTIVE_REGISTRY,
  type DirectiveDefinition,
  type ParsedDirective,
  findDirectiveDefinition,
  formatDirectiveUsage,
} from './directive-registry';

export { type ParsedDirective } from './directive-registry';

export interface ParseResult {
  success: boolean;
  directive: ParsedDirective;
  error?: string;
  fallbackMessage?: string;
  shouldFallbackToNatural: boolean;
}

export interface DirectiveParseOptions {
  skipUnknownCommands?: boolean;
  strictValidation?: boolean;
}

export function parseSlashCommand(input: string): ParsedDirective | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const withoutSlash = trimmed.slice(1);
  const words = withoutSlash.split(/\s+/);

  if (!words[0]) {
    return null;
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

  return {
    raw: trimmed,
    name: commandName,
    args,
    def,
    isMcp,
    confidence: def ? 1.0 : 0.5,
  };
}

export function parseDirectiveWithValidation(
  input: string,
  options: DirectiveParseOptions = {}
): ParseResult {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return {
      success: false,
      directive: { raw: trimmed, name: '', args: '', def: null, isMcp: false, confidence: 0 },
      shouldFallbackToNatural: true,
      error: 'Input does not start with /',
    };
  }

  const parsed = parseSlashCommand(trimmed);

  if (!parsed) {
    return {
      success: false,
      directive: { raw: trimmed, name: '', args: '', def: null, isMcp: false, confidence: 0 },
      shouldFallbackToNatural: true,
      error: 'Unable to parse directive',
      fallbackMessage: 'Commands are in the form `/command [args]`',
    };
  }

  if (!parsed.def) {
    if (options.skipUnknownCommands) {
      return {
        success: false,
        directive: parsed,
        shouldFallbackToNatural: true,
        error: `Unknown command: ${parsed.name}`,
        fallbackMessage: `Unknown skill: ${parsed.name}`,
      };
    }

    return {
      success: false,
      directive: parsed,
      shouldFallbackToNatural: true,
      error: `Unknown directive: ${parsed.name}`,
      fallbackMessage: `Unknown skill: ${parsed.name}`,
    };
  }

  if (options.strictValidation && parsed.def && parsed.def.bridgeSafe === false && parsed.name.startsWith('/')) {
    return {
      success: false,
      directive: parsed,
      shouldFallbackToNatural: false,
      error: `Directive ${parsed.name} is not allowed in strict validation mode`,
      fallbackMessage: formatDirectiveUsage(parsed.def),
    };
  }

  if (parsed.def.requiresArgs && !parsed.args.trim()) {
    return {
      success: false,
      directive: parsed,
      shouldFallbackToNatural: false,
      error: `Command ${parsed.name} requires arguments`,
      fallbackMessage: `${formatDirectiveUsage(parsed.def)} - this command requires arguments`,
    };
  }

  return {
    success: true,
    directive: parsed,
    shouldFallbackToNatural: false,
  };
}

export function formatDirectiveHelp(def: DirectiveDefinition): string {
  const lines: string[] = [];
  lines.push(`**${def.name}** - ${def.desc}`);
  lines.push(`  Usage: \`${formatDirectiveUsage(def)}\``);

  if (def.aliases && def.aliases.length > 0) {
    lines.push(`  Aliases: ${def.aliases.join(', ')}`);
  }

  return lines.join('\n');
}

export function formatGroupedHelp(): string {
  const CYAN = '\x1b[36m';
  const GREEN = '\x1b[32m';
  const DIM = '\x1b[2m';
  const BOLD = '\x1b[1m';
  const RESET = '\x1b[0m';

  const groups = new Map<string, DirectiveDefinition[]>();

  for (const def of DIRECTIVE_REGISTRY) {
    if (def.visibleInHelp === false) continue;

    const group = def.group ?? 'utility';
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(def);
  }

  const groupNames: Record<string, string> = {
    system: '系统命令',
    mode: '模式切换',
    plugin: '插件命令',
    development: '开发工具',
    utility: '实用工具',
  };

  const lines: string[] = [];
  lines.push(`${BOLD}${CYAN}可用命令列表${RESET}`);

  for (const [group, defs] of groups) {
    lines.push('');
    lines.push(`  ${CYAN}${groupNames[group] || group}${RESET}`);
    for (const def of defs) {
      const aliases = def.aliases?.length
        ? ` ${DIM}(${def.aliases.join(', ')})${RESET}`
        : '';
      lines.push(`    ${GREEN}${def.name}${RESET}${aliases}`);
      lines.push(`    ${DIM}${def.desc}${RESET}`);
    }
  }

  return lines.join('\r\n');
}

export function resolveCommandName(input: string): string | null {
  const parsed = parseSlashCommand(input);
  if (!parsed) return null;

  if (parsed.def) {
    return parsed.def.name;
  }

  if (looksLikeCommandName(parsed.name)) {
    return parsed.name;
  }

  return null;
}

function looksLikeCommandName(name: string): boolean {
  return /^[a-zA-Z0-9:_\-]+$/.test(name);
}

export function getCommandSuggestions(partial: string): DirectiveDefinition[] {
  const normalizedPartial = partial.toLowerCase().replace(/^\//, '');

  return DIRECTIVE_REGISTRY.filter(def => {
    const normalizedName = def.name.toLowerCase().replace(/^\//, '');
    return normalizedName.includes(normalizedPartial) ||
      def.aliases?.some(alias => alias.toLowerCase().replace(/^\//, '').includes(normalizedPartial));
  });
}
