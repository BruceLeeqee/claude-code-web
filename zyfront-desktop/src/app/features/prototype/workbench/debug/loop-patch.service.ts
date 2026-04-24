import { Injectable } from '@angular/core';

declare const window: Window & typeof globalThis;

export interface LoopPatchPlan {
  targetPath: string;
  previousText: string;
  nextText: string;
  reason: string;
  scope?: 'workspace' | 'vault';
}

export interface LoopPatchResult {
  ok: boolean;
  targetPath: string;
  appliedText?: string;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class LoopPatchService {
  async apply(plan: LoopPatchPlan): Promise<LoopPatchResult> {
    try {
      if (typeof window === 'undefined' || !window.zytrader?.fs?.read || !window.zytrader?.fs?.write) {
        return { ok: false, targetPath: plan.targetPath, error: 'filesystem unavailable' };
      }

      const scope = plan.scope ?? 'workspace';
      const read = await window.zytrader.fs.read(plan.targetPath, { scope });
      if (!read.ok) {
        return { ok: false, targetPath: plan.targetPath, error: `cannot read ${plan.targetPath}` };
      }

      const current = read.content;
      const next = this.patchText(current, plan.previousText, plan.nextText);
      if (next === current) {
        return { ok: false, targetPath: plan.targetPath, error: 'no matching text to patch' };
      }

      const write = await window.zytrader.fs.write(plan.targetPath, next, { scope });
      if (!write.ok) {
        return { ok: false, targetPath: plan.targetPath, error: `cannot write ${plan.targetPath}` };
      }

      return { ok: true, targetPath: plan.targetPath, appliedText: next };
    } catch (error) {
      return {
        ok: false,
        targetPath: plan.targetPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  inferRepairPlan(output: string, workspaceHint = '.'): LoopPatchPlan | null {
    const text = output.trim();
    if (!text) return null;

    const fileMatch = text.match(/([\w./\\-]+\.(?:ts|tsx|js|jsx|json|html|scss|css))(?::(\d+))?/i);
    const lineHints = this.extractLineHints(text);

    if (fileMatch) {
      const targetPath = fileMatch[1]!;
      const reason = lineHints[0]?.reason ?? 'test failure file hint';
      const previousText = this.extractSnippet(text, fileMatch[2]);
      const nextText = this.proposeFix(text, previousText);
      return {
        targetPath,
        previousText,
        nextText,
        reason,
        scope: targetPath.startsWith('02-AGENT-MEMORY') ? 'vault' : 'workspace',
      };
    }

    if (lineHints.length > 0) {
      const hint = lineHints[0]!;
      return {
        targetPath: workspaceHint,
        previousText: hint.before,
        nextText: hint.after,
        reason: hint.reason,
        scope: 'workspace',
      };
    }

    const codeMatch = text.match(/(?:Expected|Received|actual|expected)[\s\S]{0,400}/i);
    if (!codeMatch) return null;

    return {
      targetPath: workspaceHint,
      previousText: codeMatch[0].slice(0, 80),
      nextText: this.proposeFix(text, codeMatch[0].slice(0, 80)),
      reason: 'heuristic repair placeholder',
      scope: 'workspace',
    };
  }

  private patchText(source: string, previousText: string, nextText: string): string {
    if (!previousText) return source;
    const index = source.indexOf(previousText);
    if (index < 0) return source;
    return `${source.slice(0, index)}${nextText}${source.slice(index + previousText.length)}`;
  }

  private extractLineHints(text: string): Array<{ before: string; after: string; reason: string }> {
    const hints: Array<{ before: string; after: string; reason: string }> = [];
    const match = text.match(/(Expected|expected|received|Received)[\s\S]{0,160}/g);
    for (const item of match ?? []) {
      hints.push({
        before: item.slice(0, 60),
        after: this.proposeFix(text, item.slice(0, 60)),
        reason: 'test failure hint',
      });
    }
    return hints;
  }

  private extractSnippet(text: string, line?: string): string {
    if (!line) return text.slice(0, 80);
    const idx = Number.parseInt(line, 10);
    if (!Number.isFinite(idx)) return text.slice(0, 80);
    const lines = text.split(/\r?\n/);
    return lines[Math.max(0, idx - 2)]?.slice(0, 80) ?? text.slice(0, 80);
  }

  private proposeFix(output: string, snippet: string): string {
    const lower = `${output}\n${snippet}`.toLowerCase();
    if (lower.includes('cannot find module') || lower.includes('module not found')) return snippet.replace(/from\s+['"][^'"]+['"]/, (m) => m);
    if (lower.includes('expected') && lower.includes('received')) return snippet.replace(/received/gi, 'expected');
    if (lower.includes('is not defined')) return snippet.replace(/is not defined/gi, 'is defined');
    if (lower.includes('strict inequality') || lower.includes('to be')) return snippet;
    return snippet;
  }
}
