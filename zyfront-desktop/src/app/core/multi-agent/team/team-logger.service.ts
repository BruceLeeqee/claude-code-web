import { Injectable, inject, signal, computed } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { TeamLogEntry } from './team.types';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

export interface StructuredLogEntry extends TeamLogEntry {
  formatted: string;
  category: string;
}

@Injectable({ providedIn: 'root' })
export class TeamLoggerService {
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly logBuffer = signal<StructuredLogEntry[]>([]);
  private readonly maxBufferSize = 1000;

  readonly recentLogs = computed(() => this.logBuffer().slice(-50));
  readonly errorLogs = computed(() => this.logBuffer().filter(l => l.level === 'error'));
  readonly warnLogs = computed(() => this.logBuffer().filter(l => l.level === 'warn'));

  log(
    level: TeamLogEntry['level'],
    source: string,
    message: string,
    context?: {
      teamId?: string;
      stageName?: string;
      taskId?: string;
      agentId?: string;
      correlationId?: string;
      details?: Record<string, unknown>;
    },
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      level,
      source,
      message,
      details: context?.details,
      teamId: context?.teamId,
      stageName: context?.stageName,
      taskId: context?.taskId,
      agentId: context?.agentId,
      correlationId: context?.correlationId,
      category: this.categorize(source, message),
      formatted: '',
    };

    entry.formatted = this.formatEntry(entry);

    this.logBuffer.update(buffer => {
      const newBuffer = [...buffer, entry];
      if (newBuffer.length > this.maxBufferSize) {
        return newBuffer.slice(-this.maxBufferSize);
      }
      return newBuffer;
    });

    if (level === 'error') {
      this.eventBus.emit({
        type: EVENT_TYPES.ERROR,
        sessionId: context?.teamId || 'logger',
        source: 'system',
        payload: {
          scope: 'team' as const,
          code: source,
          message,
          details: context?.details,
          retriable: false,
        },
      });
    }

    return entry;
  }

  info(source: string, message: string, context?: Parameters<typeof this.log>[3]): StructuredLogEntry {
    return this.log('info', source, message, context);
  }

  warn(source: string, message: string, context?: Parameters<typeof this.log>[3]): StructuredLogEntry {
    return this.log('warn', source, message, context);
  }

  error(source: string, message: string, context?: Parameters<typeof this.log>[3]): StructuredLogEntry {
    return this.log('error', source, message, context);
  }

  debug(source: string, message: string, context?: Parameters<typeof this.log>[3]): StructuredLogEntry {
    return this.log('debug', source, message, context);
  }

  getLogsByTeam(teamId: string): StructuredLogEntry[] {
    return this.logBuffer().filter(l => l.teamId === teamId);
  }

  getLogsBySource(source: string): StructuredLogEntry[] {
    return this.logBuffer().filter(l => l.source === source);
  }

  getLogsByCorrelationId(correlationId: string): StructuredLogEntry[] {
    return this.logBuffer().filter(l => l.correlationId === correlationId);
  }

  getLogsByCategory(category: string): StructuredLogEntry[] {
    return this.logBuffer().filter(l => l.category === category);
  }

  clearTeamLogs(teamId: string): void {
    this.logBuffer.update(buffer => buffer.filter(l => l.teamId !== teamId));
  }

  clear(): void {
    this.logBuffer.set([]);
  }

  private categorize(source: string, message: string): string {
    if (/runtime|team|status/i.test(source)) return 'runtime';
    if (/orchestrat|stage|machine/i.test(source)) return 'orchestration';
    if (/task|board/i.test(source)) return 'task';
    if (/mailbox|message/i.test(source)) return 'communication';
    if (/role|struct|registry/i.test(source)) return 'registry';
    if (/command|router|parse/i.test(source)) return 'command';
    if (/persist|file|sync/i.test(source)) return 'persistence';
    return 'general';
  }

  private formatEntry(entry: StructuredLogEntry): string {
    const ts = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    const source = entry.source.padEnd(20);
    const ctx = [
      entry.teamId ? `team=${entry.teamId.substring(0, 12)}` : '',
      entry.stageName ? `stage=${entry.stageName}` : '',
      entry.taskId ? `task=${entry.taskId.substring(0, 8)}` : '',
      entry.agentId ? `agent=${entry.agentId.substring(0, 12)}` : '',
    ].filter(Boolean).join(' ');

    return `[${ts}] ${level} [${source}] ${entry.message}${ctx ? ` | ${ctx}` : ''}`;
  }
}
