import { Inject, Injectable } from '@angular/core';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../zyfront-core.providers';
import { DirectoryManagerService } from '../directory-manager.service';
import { MemoryTelemetryService } from './memory.telemetry';
import type { ChatMessage } from 'zyfront-core';

type PromptLayerName = 'system' | 'user' | 'feedback' | 'project' | 'reference' | 'session' | 'history' | 'query';

interface PromptLayerSection {
  title: string;
  text: string;
}

interface PromptMemoryLayers {
  userMemory: PromptLayerSection;
  feedbackMemory: PromptLayerSection;
  projectMemory: PromptLayerSection;
  referenceMemory: PromptLayerSection;
  sessionShortTermMemory: PromptLayerSection;
  conversationHistory: PromptLayerSection;
  userQuery: PromptLayerSection;
}

export interface PromptBuildLayerReport {
  name: PromptLayerName;
  charsBefore: number;
  charsAfter: number;
  truncated: boolean;
  droppedItems: number;
}

export interface PromptBuildReport {
  sessionId: string;
  builtAt: number;
  totalChars: number;
  layers: PromptBuildLayerReport[];
}

interface LayerBudget {
  maxChars: number;
  maxItems: number;
}

const DEFAULT_BUDGETS: Record<PromptLayerName, LayerBudget> = {
  system: { maxChars: 2800, maxItems: 1 },
  user: { maxChars: 2200, maxItems: 8 },
  feedback: { maxChars: 2200, maxItems: 8 },
  project: { maxChars: 2600, maxItems: 10 },
  reference: { maxChars: 2600, maxItems: 10 },
  session: { maxChars: 2200, maxItems: 12 },
  history: { maxChars: 4200, maxItems: 30 },
  query: { maxChars: 2400, maxItems: 1 },
};

/** 按规划固定在 10~15 轮内，这里默认 12 轮 */
const HISTORY_TURNS_WINDOW = 12;

@Injectable({ providedIn: 'root' })
export class PromptMemoryBuilderService {
  private readonly cache = new Map<string, string>();
  private readonly reportCache = new Map<string, PromptBuildReport>();

  constructor(
    private readonly directoryManager: DirectoryManagerService,
    private readonly telemetry: MemoryTelemetryService,
    @Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime,
  ) {}

  buildFullPrompt(sessionId: string): string {
    return this.cache.get(sessionId) ?? '';
  }

  getLastBuildReport(sessionId: string): PromptBuildReport | null {
    return this.reportCache.get(sessionId) ?? null;
  }

  async buildFullPromptForInput(sessionId: string, userQuery: string, systemPrompt = ''): Promise<string> {
    await this.directoryManager.ensureVaultReady();

    const layers: PromptMemoryLayers = {
      userMemory: await this.readMemoryBucket('agent-long-user', '===== USER MEMORY =====', DEFAULT_BUDGETS.user),
      feedbackMemory: await this.readMemoryBucket(
        'agent-long-feedback',
        '===== FEEDBACK MEMORY =====',
        DEFAULT_BUDGETS.feedback,
      ),
      projectMemory: await this.readMemoryBucket(
        'agent-long-project',
        '===== PROJECT MEMORY =====',
        DEFAULT_BUDGETS.project,
      ),
      referenceMemory: await this.readMemoryBucket(
        'agent-long-reference',
        '===== REFERENCE MEMORY =====',
        DEFAULT_BUDGETS.reference,
      ),
      sessionShortTermMemory: await this.buildSessionShortTermSummary(sessionId),
      conversationHistory: await this.buildConversationHistory(sessionId),
      userQuery: {
        title: '===== USER QUERY =====',
        text: this.enforceCharBudget(userQuery.trim(), DEFAULT_BUDGETS.query.maxChars),
      },
    };

    const systemText = this.enforceCharBudget(
      systemPrompt.trim() || '你是 Zyfront Desktop 的智能编码助手。请严格遵守系统规则并基于记忆层回答。',
      DEFAULT_BUDGETS.system.maxChars,
    );

    const full = [
      systemText,
      '',
      layers.userMemory.title,
      layers.userMemory.text,
      '',
      layers.feedbackMemory.title,
      layers.feedbackMemory.text,
      '',
      layers.projectMemory.title,
      layers.projectMemory.text,
      '',
      layers.referenceMemory.title,
      layers.referenceMemory.text,
      '',
      layers.sessionShortTermMemory.title,
      layers.sessionShortTermMemory.text,
      '',
      layers.conversationHistory.title,
      layers.conversationHistory.text,
      '',
      layers.userQuery.title,
      layers.userQuery.text || '(empty user query)',
    ].join('\n');

    this.cache.set(sessionId, full);
    const report = this.buildReport(sessionId, {
      systemText,
      userMemory: layers.userMemory,
      feedbackMemory: layers.feedbackMemory,
      projectMemory: layers.projectMemory,
      referenceMemory: layers.referenceMemory,
      sessionShortTermMemory: layers.sessionShortTermMemory,
      conversationHistory: layers.conversationHistory,
      userQuery: layers.userQuery,
    });
    this.reportCache.set(sessionId, report);
    this.trackBuildTelemetry(report);

    return full;
  }

  private buildReport(
    sessionId: string,
    parts: {
      systemText: string;
      userMemory: PromptLayerSection;
      feedbackMemory: PromptLayerSection;
      projectMemory: PromptLayerSection;
      referenceMemory: PromptLayerSection;
      sessionShortTermMemory: PromptLayerSection;
      conversationHistory: PromptLayerSection;
      userQuery: PromptLayerSection;
    },
  ): PromptBuildReport {
    const rows: PromptBuildLayerReport[] = [
      this.buildLayerReport('system', parts.systemText, DEFAULT_BUDGETS.system.maxChars),
      this.buildLayerReport('user', parts.userMemory.text, DEFAULT_BUDGETS.user.maxChars),
      this.buildLayerReport('feedback', parts.feedbackMemory.text, DEFAULT_BUDGETS.feedback.maxChars),
      this.buildLayerReport('project', parts.projectMemory.text, DEFAULT_BUDGETS.project.maxChars),
      this.buildLayerReport('reference', parts.referenceMemory.text, DEFAULT_BUDGETS.reference.maxChars),
      this.buildLayerReport('session', parts.sessionShortTermMemory.text, DEFAULT_BUDGETS.session.maxChars),
      this.buildLayerReport('history', parts.conversationHistory.text, DEFAULT_BUDGETS.history.maxChars),
      this.buildLayerReport('query', parts.userQuery.text, DEFAULT_BUDGETS.query.maxChars),
    ];

    return {
      sessionId,
      builtAt: Date.now(),
      totalChars: rows.reduce((sum, r) => sum + r.charsAfter, 0),
      layers: rows,
    };
  }

  private buildLayerReport(name: PromptLayerName, text: string, maxChars: number): PromptBuildLayerReport {
    const charsAfter = text.length;
    const charsBefore = charsAfter;
    return {
      name,
      charsBefore,
      charsAfter,
      truncated: charsAfter >= maxChars,
      droppedItems: 0,
    };
  }

  private trackBuildTelemetry(report: PromptBuildReport): void {
    const layerStats = report.layers
      .map((x) => `${x.name}:${x.charsAfter}${x.truncated ? 'T' : ''}`)
      .join('|');

    this.telemetry.track({
      event: 'build',
      pipeline: 'prompt_build',
      gate_passed: true,
      skip_reason: 'none',
      timestamp: Date.now(),
      session_id: report.sessionId,
      prompt_total_chars: report.totalChars,
      prompt_layer_stats: layerStats,
    });

    for (const layer of report.layers.filter((x) => x.truncated)) {
      this.telemetry.track({
        event: 'run',
        pipeline: 'prompt_build',
        gate_passed: true,
        skip_reason: `layer_truncated:${layer.name}`,
        timestamp: Date.now(),
        session_id: report.sessionId,
        prompt_total_chars: report.totalChars,
        prompt_layer_stats: layerStats,
      });
    }
  }

  private async readMemoryBucket(directoryKey: string, title: string, budget: LayerBudget): Promise<PromptLayerSection> {
    const relDir = await this.directoryManager.getRelativePathByKey(directoryKey);
    const listed = await window.zytrader.fs.list(relDir, { scope: 'vault' });
    if (!listed.ok) return { title, text: '(no memory)' };

    const files = listed.entries
      .filter((e) => e.type === 'file' && /\.(md|json)$/i.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, Math.max(1, budget.maxItems * 2));

    const seen = new Set<string>();
    const snippets: string[] = [];
    for (const f of files) {
      if (snippets.length >= budget.maxItems) break;
      const relPath = `${relDir}/${f.name}`;
      const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
      if (!read.ok) continue;
      const compact = this.compactMemoryText(read.content);
      if (!compact) continue;
      const dedupKey = this.hashText(compact);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      snippets.push(`- [${f.name}] ${compact}`);
    }

    const merged = snippets.length > 0 ? snippets.join('\n') : '(no memory)';
    return { title, text: this.enforceCharBudget(merged, budget.maxChars) };
  }

  private compactMemoryText(raw: string): string {
    const text = String(raw ?? '').trim();
    if (!text) return '';

    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as { content?: unknown };
        const content = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content ?? parsed);
        return content.replace(/\s+/g, ' ').trim();
      } catch {
        return text.replace(/\s+/g, ' ').trim();
      }
    }

    const body = text
      .replace(/^---[\s\S]*?---\s*/m, '')
      .replace(/\s+/g, ' ')
      .trim();
    return body;
  }

  private async buildSessionShortTermSummary(sessionId: string): Promise<PromptLayerSection> {
    const title = '===== SESSION SHORT-TERM MEMORY =====';
    const relDir = await this.directoryManager.getRelativePathByKey('agent-short-term');
    const listed = await window.zytrader.fs.list(relDir, { scope: 'vault' });
    if (!listed.ok) return { title, text: '(no short-term memory)' };

    const rows: Array<{ updateTime: string; summary: string }> = [];
    for (const e of listed.entries.filter((x) => x.type === 'file' && /\.json$/i.test(x.name))) {
      const read = await window.zytrader.fs.read(`${relDir}/${e.name}`, { scope: 'vault' });
      if (!read.ok) continue;
      try {
        const parsed = JSON.parse(read.content) as {
          sessionId?: string;
          updateTime?: string;
          turnId?: string;
          content?: unknown;
        };
        if (parsed.sessionId && parsed.sessionId !== sessionId) continue;
        const contentSummary = this.compactMemoryText(JSON.stringify(parsed.content ?? ''));
        const fallbackSummary = this.buildShortTermFallbackSummary(parsed);
        const summary = contentSummary || fallbackSummary;
        if (!summary) continue;
        rows.push({ updateTime: String(parsed.updateTime ?? ''), summary });
      } catch {
        continue;
      }
    }

    const top = rows
      .sort((a, b) => (a.updateTime < b.updateTime ? 1 : -1))
      .slice(0, DEFAULT_BUDGETS.session.maxItems)
      .map((r) => `- ${r.summary}`)
      .join('\n');

    return {
      title,
      text: this.enforceCharBudget(top || '(no short-term memory)', DEFAULT_BUDGETS.session.maxChars),
    };
  }

  private buildShortTermFallbackSummary(parsed: {
    sessionId?: string;
    updateTime?: string;
    turnId?: string;
  }): string {
    const turn = String(parsed.turnId ?? '').trim();
    const t = String(parsed.updateTime ?? '').trim();
    if (turn && t) return `session turn ${turn} updated at ${t}`;
    if (turn) return `session turn ${turn}`;
    if (t) return `session memory updated at ${t}`;
    return '';
  }

  private async buildConversationHistory(sessionId: string): Promise<PromptLayerSection> {
    const title = '===== CONVERSATION HISTORY =====';
    let msgs: ChatMessage[] = [];
    try {
      msgs = await this.runtime.history.list(sessionId);
    } catch {
      return { title, text: '(no conversation history)' };
    }

    const turns = this.toRecentTurns(msgs, HISTORY_TURNS_WINDOW);
    const lines = turns.flatMap((turn) => {
      const user = turn.user ? `- User: ${turn.user}` : null;
      const assistant = turn.assistant ? `- Assistant: ${turn.assistant}` : null;
      return [user, assistant].filter((x): x is string => Boolean(x));
    });

    const text = lines.length > 0 ? lines.join('\n') : '(no conversation history)';
    return {
      title,
      text: this.enforceCharBudget(text, DEFAULT_BUDGETS.history.maxChars),
    };
  }

  private toRecentTurns(
    messages: ChatMessage[],
    maxTurns: number,
  ): Array<{ user: string; assistant: string }> {
    const turns: Array<{ user: string; assistant: string }> = [];
    let current: { user: string; assistant: string } | null = null;

    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const compact = this.enforceCharBudget(String(m.content ?? '').replace(/\s+/g, ' ').trim(), 260);
      if (!compact) continue;

      if (m.role === 'user') {
        if (current && (current.user || current.assistant)) {
          turns.push(current);
        }
        current = { user: compact, assistant: '' };
      } else {
        if (!current) current = { user: '', assistant: compact };
        else if (!current.assistant) current.assistant = compact;
        else {
          turns.push(current);
          current = { user: '', assistant: compact };
        }
      }
    }

    if (current && (current.user || current.assistant)) turns.push(current);
    return turns.slice(-Math.max(1, maxTurns));
  }

  private enforceCharBudget(text: string, maxChars: number): string {
    const safe = String(text ?? '').trim();
    if (safe.length <= maxChars) return safe;
    return `${safe.slice(0, Math.max(0, maxChars - 1))}…`;
  }

  private hashText(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `fp_${(hash >>> 0).toString(16)}`;
  }
}
