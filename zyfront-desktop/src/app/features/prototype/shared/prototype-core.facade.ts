import { Injectable, computed, inject, signal } from '@angular/core';
import { AppSettingsService, type AppSettings } from '../../../core/app-settings.service';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../../core/zyfront-core.providers';

export type AgentStatus = 'preparing' | 'executing' | 'waiting' | 'completed' | 'error' | 'paused';

export interface UiAgent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  progress: number;
  logs: string[];
}

export interface UiNode {
  id: string;
  name: string;
  group: 'logic' | 'data' | 'view' | 'project' | 'issue';
  links: string[];
}

@Injectable({ providedIn: 'root' })
export class PrototypeCoreFacade {
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly settingsService = inject(AppSettingsService);

  readonly settings = signal<AppSettings>(this.settingsService.value);
  readonly activeModel = signal(this.runtime.client.getModel().model);

  readonly tokenUsed = signal(14204);
  readonly tokenMax = signal(200000);
  readonly estimatedCostUsd = signal(12.45);

  readonly nodes = signal<UiNode[]>([
    { id: 'n1', name: 'Auth Module', group: 'logic', links: ['n2', 'n3'] },
    { id: 'n2', name: 'SQLite Sync', group: 'data', links: ['n5'] },
    { id: 'n3', name: 'React UI', group: 'view', links: ['n4'] },
    { id: 'n4', name: 'Project A', group: 'project', links: ['n6'] },
    { id: 'n5', name: 'Electron IPC', group: 'view', links: ['n4'] },
    { id: 'n6', name: 'Bug: Memory Leak', group: 'issue', links: ['n4'] },
  ]);
  readonly selectedNodeId = signal<string | null>(null);

  readonly agents = signal<UiAgent[]>([
    { id: 'AG-01', name: '代码审查专家 #100', role: '代码审查专家', status: 'executing', progress: 21, logs: ['Agent 启动成功', '连接至协同网络...'] },
    { id: 'AG-02', name: '安全审计员 #101', role: '安全审计员', status: 'executing', progress: 26, logs: ['Agent 启动成功', '扫描依赖中...'] },
    { id: 'AG-03', name: '架构分析师 #102', role: '架构分析师', status: 'waiting', progress: 36, logs: ['建立上下文', '等待上游结果'] },
    { id: 'AG-04', name: '文档生成器 #103', role: '文档生成器', status: 'paused', progress: 12, logs: ['已载入模板', '人工暂停'] },
  ]);

  readonly skills = signal([
    { id: 'skill.auto-cr', name: '自动代码审查 (Auto-CR)', desc: 'Git Push 前分析安全漏洞和逻辑缺陷', active: true },
    { id: 'skill.docs-sync', name: '文档自动化同步', desc: '根据代码变更自动更新 README 和 API 文档', active: false },
    { id: 'skill.tests', name: '深度单元测试生成', desc: '模拟复杂场景自动填充测试用例', active: true },
    { id: 'skill.cicd', name: 'CI/CD Pipeline 优化', desc: '分析构建日志并优化流水线速度', active: false },
  ]);

  readonly plugins = signal([
    { id: 'plugin.github', name: 'GitHub Context', desc: '实时访问仓库/PR/Issues', installed: false },
    { id: 'plugin.jira', name: 'Jira Integration', desc: '同步任务进度并建议更新 Stories', installed: true },
    { id: 'plugin.pg', name: 'Postgres Explorer', desc: '查询 Schema 并建议 SQL 优化', installed: false },
  ]);

  readonly modelUsagePercent = computed(() => Math.min(100, Math.round((this.tokenUsed() / this.tokenMax()) * 100)));
  readonly selectedNode = computed(() => this.nodes().find((n) => n.id === this.selectedNodeId()) ?? null);

  constructor() {
    this.settingsService.settings$.subscribe((s) => {
      this.settings.set(s);
      this.activeModel.set(s.model);
    });
  }

  saveModelSettings(patch: Partial<AppSettings>): void {
    this.settingsService.update(patch);
  }

  resetModelSettings(): void {
    this.settingsService.reset();
  }

  selectNode(id: string): void {
    this.selectedNodeId.set(id);
  }

  toggleAgent(id: string): void {
    this.agents.update((list) =>
      list.map((a) =>
        a.id !== id
          ? a
          : {
              ...a,
              status: a.status === 'paused' ? 'executing' : 'paused',
              logs: [...a.logs, a.status === 'paused' ? '任务已恢复执行' : '任务已手动暂停'],
            },
      ),
    );
  }

  advanceAgent(id: string): void {
    this.agents.update((list) =>
      list.map((a) => {
        if (a.id !== id) return a;
        const next = Math.min(100, a.progress + 10);
        return {
          ...a,
          progress: next,
          status: next >= 100 ? 'completed' : 'executing',
          logs: [...a.logs, `进度更新到 ${next}%`],
        };
      }),
    );
  }

  toggleSkill(id: string): void {
    this.skills.update((items) => items.map((it) => (it.id === id ? { ...it, active: !it.active } : it)));
  }

  togglePlugin(id: string): void {
    this.plugins.update((items) => items.map((it) => (it.id === id ? { ...it, installed: !it.installed } : it)));
  }
}
