import { Injectable } from '@angular/core';

export type CommandRoute = 'directive' | 'shell' | 'natural';

export interface RouteOptions {
  preferNaturalLanguage?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CommandRouterService {
  private readonly shellCommands = new Set([
    'ls', 'dir', 'cd', 'pwd', 'echo', 'cat', 'type', 'findstr', 'rg', 'git', 'npm', 'pnpm', 'yarn', 'node', 'npx',
    'python', 'pip', 'powershell', 'pwsh', 'cmd', 'curl', 'wget', 'docker', 'kubectl', 'make', 'go', 'java', 'javac',
    'mvn', 'gradle', 'rustc', 'cargo', 'bash', 'sh', 'zsh', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'code',
  ]);

  route(input: string, options: RouteOptions = {}): CommandRoute {
    const raw = input.trim();
    if (!raw) return 'shell';

    if (raw.startsWith('/')) return 'directive';
    if (raw.startsWith('!')) return 'shell';
    if (raw.startsWith('?')) return 'natural';

    const hasChinese = /[\u4e00-\u9fa5]/.test(raw);
    if (hasChinese) return 'natural';

    const normalized = raw.toLowerCase();
    const firstToken = normalized.split(/\s+/)[0] ?? '';
    const hasWhitespace = /\s/.test(raw);
    const wordCount = raw.split(/\s+/).filter(Boolean).length;

    const likelyNaturalSentence =
      /[?.!。！？]/.test(raw) ||
      /\b(please|how|why|what|when|where|help|explain|fix|optimize|review|implement|write|生成|解释|修复|优化|重构)\b/i.test(raw) ||
      (wordCount >= 4 && !this.shellCommands.has(firstToken));

    const likelyShell =
      this.shellCommands.has(firstToken) ||
      /^[.]{1,2}[\\/]/.test(raw) ||
      /^([a-zA-Z]:)?[\\/].+/.test(raw) ||
      /[|&><`$]/.test(raw);

    if (options.preferNaturalLanguage && hasWhitespace && !likelyShell) {
      return 'natural';
    }

    if (likelyNaturalSentence && !likelyShell) {
      return 'natural';
    }

    return likelyShell ? 'shell' : 'natural';
  }
}
