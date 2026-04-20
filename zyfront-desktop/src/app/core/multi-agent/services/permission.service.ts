import { Injectable, inject, signal } from '@angular/core';
import { MultiAgentConfigService } from './multi-agent-config.service';
import { SessionRegistryService } from './session-registry.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import type { AgentToolInput } from '../tools/agent-tool.service';

export type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string }
  | { allowed: 'ask'; reason: string; confirmationMessage: string };

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  action: string;
  agentId?: string;
  details: Record<string, unknown>;
  result: 'allowed' | 'denied' | 'pending';
  reason?: string;
}

export interface PermissionConfig {
  multiAgentEnabled: boolean;
  maxAgents: number;
  sensitiveOperations: string[];
  requireConfirmationFor: string[];
}

const SENSITIVE_PATTERNS = [
  /删除|delete|remove|drop/i,
  /格式化|format/i,
  /清空|clear|truncate/i,
  /修改密码|change\s*password/i,
  /授权|authorize|grant/i,
  /root|admin|superuser/i,
  /生产环境|production/i,
  /数据库|database/i,
];

const DEFAULT_CONFIG: PermissionConfig = {
  multiAgentEnabled: true,
  maxAgents: 5,
  sensitiveOperations: ['delete', 'format', 'truncate', 'drop'],
  requireConfirmationFor: ['create_agent', 'disband_team', 'force_mode'],
};

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly configService = inject(MultiAgentConfigService);
  private readonly sessionRegistry = inject(SessionRegistryService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly config = signal<PermissionConfig>(DEFAULT_CONFIG);
  private readonly auditLogs = signal<AuditLogEntry[]>([]);
  private readonly pendingConfirmations = signal<Map<string, { resolve: (value: boolean) => void; message: string }>>(new Map());

  readonly logs = this.auditLogs;

  async checkAgentToolPermission(input: AgentToolInput): Promise<PermissionResult> {
    const config = this.config();

    if (!config.multiAgentEnabled) {
      this.logAudit('agent_tool_call', { input }, 'denied', '多智能体模式已禁用');
      return { allowed: false, reason: '多智能体模式已禁用' };
    }

    const currentAgents = this.getActiveAgentCount();
    if (currentAgents >= config.maxAgents) {
      this.logAudit('agent_tool_call', { input, currentAgents }, 'denied', '已达到最大智能体数量限制');
      return { allowed: false, reason: `已达到最大智能体数量限制 (${config.maxAgents})` };
    }

    if (this.isSensitiveOperation(input.prompt)) {
      this.logAudit('agent_tool_call', { input }, 'pending', '敏感操作需要用户确认');
      return {
        allowed: 'ask',
        reason: '敏感操作需要用户确认',
        confirmationMessage: `检测到敏感操作: "${input.description}"，是否继续？`,
      };
    }

    this.logAudit('agent_tool_call', { input }, 'allowed');
    return { allowed: true };
  }

  async checkTeamCreatePermission(teamName: string): Promise<PermissionResult> {
    const config = this.config();

    if (!config.multiAgentEnabled) {
      this.logAudit('team_create', { teamName }, 'denied', '多智能体模式已禁用');
      return { allowed: false, reason: '多智能体模式已禁用' };
    }

    this.logAudit('team_create', { teamName }, 'allowed');
    return { allowed: true };
  }

  async checkModeSwitchPermission(mode: 'single' | 'multi'): Promise<PermissionResult> {
    if (mode === 'multi' && !this.config().multiAgentEnabled) {
      this.logAudit('mode_switch', { mode }, 'denied', '多智能体模式已禁用');
      return { allowed: false, reason: '多智能体模式已禁用' };
    }

    this.logAudit('mode_switch', { mode }, 'allowed');
    return { allowed: true };
  }

  async checkResourcePermission(resource: string, action: string): Promise<PermissionResult> {
    const config = this.config();

    if (config.sensitiveOperations.some(op => action.toLowerCase().includes(op))) {
      this.logAudit('resource_access', { resource, action }, 'pending', '敏感操作需要确认');
      return {
        allowed: 'ask',
        reason: '敏感操作需要确认',
        confirmationMessage: `确认执行敏感操作: ${action} on ${resource}?`,
      };
    }

    this.logAudit('resource_access', { resource, action }, 'allowed');
    return { allowed: true };
  }

  isSensitiveOperation(prompt: string): boolean {
    return SENSITIVE_PATTERNS.some(pattern => pattern.test(prompt));
  }

  setConfig(config: Partial<PermissionConfig>): void {
    this.config.update(current => ({ ...current, ...config }));
  }

  private getActiveAgentCount(): number {
    return this.sessionRegistry.getActiveSessionCount();
  }

  private logAudit(
    action: string,
    details: Record<string, unknown>,
    result: 'allowed' | 'denied' | 'pending',
    reason?: string,
  ): void {
    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      action,
      details,
      result,
      reason,
    };

    this.auditLogs.update(logs => [entry, ...logs].slice(0, 1000));

    if (result === 'denied') {
      this.eventBus.emit({
        type: EVENT_TYPES.ERROR,
        sessionId: 'permission-service',
        source: 'system',
        payload: {
          scope: 'team',
          code: 'PERMISSION_DENIED',
          message: reason || `Permission denied for action: ${action}`,
          retriable: false,
        },
      });
    }
  }

  getAuditLogs(filter?: {
    action?: string;
    result?: 'allowed' | 'denied' | 'pending';
    since?: number;
  }): AuditLogEntry[] {
    let logs = this.auditLogs();

    if (filter) {
      if (filter.action) {
        logs = logs.filter(l => l.action.includes(filter.action!));
      }
      if (filter.result) {
        logs = logs.filter(l => l.result === filter.result);
      }
      if (filter.since) {
        logs = logs.filter(l => l.timestamp >= filter.since!);
      }
    }

    return logs;
  }

  getPermissionStats(): {
    totalChecks: number;
    allowed: number;
    denied: number;
    pending: number;
  } {
    const logs = this.auditLogs();
    return {
      totalChecks: logs.length,
      allowed: logs.filter(l => l.result === 'allowed').length,
      denied: logs.filter(l => l.result === 'denied').length,
      pending: logs.filter(l => l.result === 'pending').length,
    };
  }

  clearAuditLogs(): void {
    this.auditLogs.set([]);
  }
}
