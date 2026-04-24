import { Injectable } from '@angular/core';

declare const window: Window & typeof globalThis;

export interface LoopAstPatchPlan {
  targetPath: string;
  searchPattern: string;
  replaceText: string;
  reason: string;
  scope?: 'workspace' | 'vault';
}

export interface LoopAstPatchResult {
  ok: boolean;
  targetPath: string;
  mode: 'exact' | 'brace' | 'fallback' | 'none';
  appliedText?: string;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class LoopAstPatcherService {
  async apply(plan: LoopAstPatchPlan): Promise<LoopAstPatchResult> {
    try {
      if (typeof window === 'undefined' || !window.zytrader?.fs?.read || !window.zytrader?.fs?.write) {
        return { ok: false, targetPath: plan.targetPath, mode: 'none', error: 'filesystem unavailable' };
      }

      const scope = plan.scope ?? 'workspace';
      const read = await window.zytrader.fs.read(plan.targetPath, { scope });
      if (!read.ok) return { ok: false, targetPath: plan.targetPath, mode: 'none', error: `cannot read ${plan.targetPath}` };

      const current = read.content;
      const next = this.applyStructuredPatch(current, plan.searchPattern, plan.replaceText);
      if (next === current) return { ok: false, targetPath: plan.targetPath, mode: 'none', error: 'pattern not found' };

      const write = await window.zytrader.fs.write(plan.targetPath, next, { scope });
      if (!write.ok) return { ok: false, targetPath: plan.targetPath, mode: 'none', error: `cannot write ${plan.targetPath}` };

      return { ok: true, targetPath: plan.targetPath, mode: this.lastMode, appliedText: next };
    } catch (error) {
      return { ok: false, targetPath: plan.targetPath, mode: 'none', error: error instanceof Error ? error.message : String(error) };
    }
  }

  inferRepairPlan(output: string, fallbackPath = '.'): LoopAstPatchPlan | null {
    const text = output.trim();
    if (!text) return null;

    const file = this.extractFilePath(text) ?? fallbackPath;
    const searchPattern = this.extractSearchPattern(text) ?? this.extractFailureSnippet(text) ?? '';
    if (!searchPattern) return null;

    const replaceText = this.proposeReplacement(text, searchPattern);
    return {
      targetPath: file,
      searchPattern,
      replaceText,
      reason: 'heuristic AST-like repair',
      scope: file.startsWith('02-AGENT-MEMORY') ? 'vault' : 'workspace',
    };
  }

  private lastMode: LoopAstPatchResult['mode'] = 'none';

  private applyStructuredPatch(source: string, searchPattern: string, replaceText: string): string {
    this.lastMode = 'fallback';
    if (!searchPattern) return source;

    const exactIndex = source.indexOf(searchPattern);
    if (exactIndex >= 0) {
      this.lastMode = 'exact';
      return `${source.slice(0, exactIndex)}${replaceText}${source.slice(exactIndex + searchPattern.length)}`;
    }

    const braceIndex = this.findBraceBlock(source, searchPattern);
    if (braceIndex) {
      this.lastMode = 'brace';
      return `${source.slice(0, braceIndex.start)}${replaceText}${source.slice(braceIndex.end)}`;
    }

    return source;
  }

  private findBraceBlock(source: string, token: string): { start: number; end: number } | null {
    const start = source.indexOf(token);
    if (start < 0) return null;
    const open = source.indexOf('{', start);
    if (open < 0) return null;

    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return { start, end: i + 1 };
      }
    }
    return null;
  }

  private extractFilePath(text: string): string | null {
    const match = text.match(/([\w./\\-]+\.(?:ts|tsx|js|jsx|json|html|scss|css))(?::\d+)?/i);
    return match?.[1] ?? null;
  }

  private extractSearchPattern(text: string): string | null {
    const codeFence = text.match(/```[\s\S]{0,400}?```/);
    if (codeFence) return codeFence[0].replace(/```/g, '').trim();

    const line = text.match(/(?:Expected|Received|actual|expected)[^\n]{0,180}/i);
    return line?.[0]?.trim() ?? null;
  }

  private extractFailureSnippet(text: string): string | null {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.find((line) => line.length > 10 && line.length < 160) ?? null;
  }

  private proposeReplacement(output: string, searchPattern: string): string {
    const lower = output.toLowerCase();
    if (lower.includes('cannot find module')) return searchPattern;
    if (lower.includes('expected') && lower.includes('received')) return searchPattern.replace(/received/gi, 'expected');
    if (lower.includes('is not defined')) return searchPattern.replace(/is not defined/gi, 'is defined');
    if (lower.includes('type error') || lower.includes('typescript')) return searchPattern;
    return searchPattern;
  }
}
