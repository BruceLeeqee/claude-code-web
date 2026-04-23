export type CommandRoute = 'directive' | 'shell' | 'natural' | 'unknown';

export interface RouteOptions {
  preferNaturalLanguage?: boolean;
  skipSlashCommands?: boolean;
  bridgeOrigin?: boolean;
}

export interface RouteResult {
  route: CommandRoute;
  confidence: number;
  reasons: string[];
  suggestedFallback?: CommandRoute;
}

export interface RoutingContext {
  hasChinese: boolean;
  hasWhitespace: boolean;
  wordCount: number;
  firstToken: string;
  hasShellOperators: boolean;
  hasPathPattern: boolean;
  endsWithQuestionMark: boolean;
  startsWithSlash: boolean;
  startsWithExclamation: boolean;
  startsWithQuestion: boolean;
}

export const ROUTING_CONSTANTS = {
  SHELL_COMMANDS: new Set([
    'ls', 'dir', 'cd', 'pwd', 'echo', 'cat', 'type', 'findstr', 'rg', 'git',
    'npm', 'pnpm', 'yarn', 'node', 'npx', 'python', 'pip', 'powershell', 'pwsh',
    'cmd', 'curl', 'wget', 'docker', 'kubectl', 'make', 'go', 'java', 'javac',
    'mvn', 'gradle', 'rustc', 'cargo', 'bash', 'sh', 'zsh', 'cp', 'mv', 'rm',
    'mkdir', 'rmdir', 'touch', 'code', 'sudo', 'chmod', 'chown', 'grep', 'sed',
    'awk', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'rsync', 'vim', 'nano', 'less',
    'more', 'head', 'tail', 'sort', 'uniq', 'wc', 'diff', 'patch', 'find',
    'locate', 'which', 'where', 'whoami', 'hostname', 'ps', 'kill', 'killall',
    'top', 'htop', 'df', 'du', 'free', 'uname', 'date', 'cal', 'history',
    'alias', 'export', 'source', 'eval', 'xargs', 'tee', 'xclip', 'curl', 'wget',
  ]) as ReadonlySet<string>,

  NATURAL_LANGUAGE_KEYWORDS: new Set([
    'please', 'how', 'why', 'what', 'when', 'where', 'who', 'which', 'can', 'could',
    'would', 'should', 'help', 'explain', 'tell', 'show', 'give', 'find', 'look',
    'think', 'consider', 'suggest', 'recommend', 'describe', 'define', 'list',
    '帮我', '请', '如何', '为什么', '什么', '怎么', '请问', '我想', '帮我',
    '生成', '解释', '修复', '优化', '重构', '分析', '设计', '实现', '检查',
    '查看', '看看', '有没有', '是不是', '能不能', '会不会', '请帮我',
  ]) as ReadonlySet<string>,

  SHELL_OPERATORS: /[|&><`$\\(){}[\];'"]/,

  PATH_PATTERNS: [
    /^[.]{1,2}[\\/]/,
    /^([a-zA-Z]:)?[\\\/]/,
    /^\/etc\//,
    /^\/usr\//,
    /^\/bin\//,
    /^\/tmp\//,
    /^\/var\//,
    /^\/home\//,
    /^\/[a-zA-Z]/,
  ] as RegExp[],

  QUESTION_MARKS: /[?？.。!！]$/,
} as const;

export function extractRoutingContext(input: string): RoutingContext {
  const trimmed = input.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  return {
    hasChinese: /[\u4e00-\u9fa5]/.test(trimmed),
    hasWhitespace: /\s/.test(trimmed),
    wordCount: words.length,
    firstToken: words[0]?.toLowerCase() ?? '',
    hasShellOperators: ROUTING_CONSTANTS.SHELL_OPERATORS.test(trimmed),
    hasPathPattern: ROUTING_CONSTANTS.PATH_PATTERNS.some(p => p.test(trimmed)),
    endsWithQuestionMark: ROUTING_CONSTANTS.QUESTION_MARKS.test(trimmed),
    startsWithSlash: trimmed.startsWith('/'),
    startsWithExclamation: trimmed.startsWith('!'),
    startsWithQuestion: trimmed.startsWith('?'),
  };
}
