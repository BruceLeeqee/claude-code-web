import { Injectable, signal } from '@angular/core';
import { SnapshotService } from './snapshot.service';

// 错误级别
export type ErrorLevel = 'info' | 'warning' | 'error' | 'critical';

// 错误记录
export interface ErrorRecord {
  id: string;
  level: ErrorLevel;
  message: string;
  userMessage: string;
  timestamp: Date;
  stack: string | null;
  context: any;
  recoveryActions: RecoveryAction[];
  resolved: boolean;
  resolvedAt: Date | null;
}

// 恢复动作
export interface RecoveryAction {
  id: string;
  name: string;
  description: string;
  type: 'restore_snapshot' | 'retry' | 'reset' | 'custom';
  execute: () => Promise<boolean>;
}

// 错误统计
export interface ErrorStats {
  total: number;
  unresolved: number;
  byLevel: { [key in ErrorLevel]: number };
  recentErrors: ErrorRecord[];
}

@Injectable({ providedIn: 'root' })
export class ErrorRecoveryService {
  readonly errors = signal<ErrorRecord[]>([]);
  private maxErrors = 100;

  constructor(private snapshotService: SnapshotService) {}

  // 记录错误
  recordError(
    level: ErrorLevel,
    message: string,
    userMessage?: string,
    context?: any,
    error?: Error
  ): ErrorRecord {
    const record: ErrorRecord = {
      id: this.generateId(),
      level,
      message,
      userMessage: userMessage || this.translateToUserFriendly(message),
      timestamp: new Date(),
      stack: error?.stack || null,
      context: context || null,
      recoveryActions: this.getRecoveryActions(level, context),
      resolved: false,
      resolvedAt: null
    };

    this.errors.update(prev => {
      const updated = [...prev, record];
      if (updated.length > this.maxErrors) {
        return updated.slice(-this.maxErrors);
      }
      return updated;
    });

    console.error(`[${level.toUpperCase()}] ${message}`, error, context);

    return record;
  }

  // 翻译错误信息为用户友好的
  private translateToUserFriendly(message: string): string {
    const translations: { [key: string]: string } = {
      'NetworkError': '网络连接失败，请检查网络后重试',
      'TimeoutError': '操作超时，请稍后再试',
      'AuthenticationError': '身份验证失败，请重新登录',
      'PermissionError': '权限不足，请联系管理员',
      'UnknownError': '发生未知错误，请尝试刷新页面'
    };

    for (const [key, translation] of Object.entries(translations)) {
      if (message.includes(key)) {
        return translation;
      }
    }

    return '操作遇到问题，请稍后重试或联系技术支持';
  }

  // 获取恢复动作
  private getRecoveryActions(level: ErrorLevel, context: any): RecoveryAction[] {
    const actions: RecoveryAction[] = [];

    // 重试
    actions.push({
      id: 'retry',
      name: '重试',
      description: '重新执行上次失败的操作',
      type: 'retry',
      execute: async () => {
        console.log('Executing retry');
        return true;
      }
    });

    // 恢复快照
    const latestSnapshot = this.snapshotService.getLatestSnapshot();
    if (latestSnapshot) {
      actions.push({
        id: 'restore_snapshot',
        name: '恢复到之前状态',
        description: `恢复到 ${latestSnapshot.name}`,
        type: 'restore_snapshot',
        execute: async () => {
          try {
            this.snapshotService.restoreSnapshot(latestSnapshot.id);
            return true;
          } catch (e) {
            return false;
          }
        }
      });
    }

    // 重置
    actions.push({
      id: 'reset',
      name: '重置',
      description: '恢复到初始状态',
      type: 'reset',
      execute: async () => {
        console.log('Executing reset');
        return true;
      }
    });

    return actions;
  }

  // 解决错误
  resolveError(id: string): void {
    this.errors.update(prev => prev.map(e =>
      e.id === id ? { ...e, resolved: true, resolvedAt: new Date() } : e
    ));
  }

  // 执行恢复动作
  async executeRecoveryAction(errorId: string, actionId: string): Promise<boolean> {
    const error = this.errors().find(e => e.id === errorId);
    const action = error?.recoveryActions.find(a => a.id === actionId);

    if (!action) {
      this.recordError('warning', 'Recovery action not found');
      return false;
    }

    try {
      const success = await action.execute();
      if (success) {
        this.resolveError(errorId);
      }
      return success;
    } catch (e) {
      this.recordError('error', 'Recovery action failed', '恢复动作执行失败', { errorId, actionId }, e as Error);
      return false;
    }
  }

  // 获取错误统计
  getErrorStats(): ErrorStats {
    const allErrors = this.errors();
    const unresolved = allErrors.filter(e => !e.resolved);

    const byLevel = {
      info: allErrors.filter(e => e.level === 'info').length,
      warning: allErrors.filter(e => e.level === 'warning').length,
      error: allErrors.filter(e => e.level === 'error').length,
      critical: allErrors.filter(e => e.level === 'critical').length
    };

    const recentErrors = [...allErrors]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);

    return {
      total: allErrors.length,
      unresolved: unresolved.length,
      byLevel,
      recentErrors
    };
  }

  // 清除已解决的错误
  clearResolvedErrors(): void {
    this.errors.update(prev => prev.filter(e => !e.resolved));
  }

  // 清除所有错误
  clearAllErrors(): void {
    this.errors.set([]);
  }

  // 清除所有错误（别名）
  clearErrors(): void {
    this.clearAllErrors();
  }

  // 尝试恢复
  async tryRecovery(errorId: string): Promise<boolean> {
    const error = this.errors().find(e => e.id === errorId);
    if (!error || error.recoveryActions.length === 0) {
      return false;
    }
    // 尝试第一个恢复动作
    return await this.executeRecoveryAction(errorId, error.recoveryActions[0].id);
  }

  // 生成ID
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 便捷方法
  recordInfo(message: string, context?: any): ErrorRecord {
    return this.recordError('info', message, message, context);
  }

  recordWarning(message: string, context?: any): ErrorRecord {
    return this.recordError('warning', message, undefined, context);
  }

  recordCritical(message: string, context?: any, error?: Error): ErrorRecord {
    return this.recordError('critical', message, undefined, context, error);
  }
}
