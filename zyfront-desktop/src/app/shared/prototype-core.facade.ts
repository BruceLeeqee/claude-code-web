import { Injectable, computed, inject, signal } from '@angular/core';
import { AppSettingsService, type AppSettings } from '../core/app-settings.service';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../core/zyfront-core.providers';

export type AgentStatus = 'preparing' | 'executing' | 'waiting' | 'completed' | 'error' | 'paused';

export type AgentCardIconKey = 'code' | 'security' | 'architecture' | 'doc';

export interface AgentLogLine {
  time: string;
  text: string;
}

export interface UiAgent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  progress: number;
  /** 原型：卡片左侧图标类型 */
  iconKey: AgentCardIconKey;
  /** 原型：任务摘要引语 */
  taskHint: string;
  /** 原型：预计剩余秒数（展示用） */
  etaSec: number;
  logs: AgentLogLine[];
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
    {
      id: 'AG-01',
      name: '代码审查专家 #100',
      role: '代码审查专家',
      status: 'executing',
      progress: 21,
      iconKey: 'code',
      taskHint: '执行任务核心逻辑：审查 PR 与静态分析结果对齐…',
      etaSec: 46,
      logs: [
        { time: '17:11:33', text: 'Agent 启动成功' },
        { time: '17:11:35', text: '连接至协同网络...' },
      ],
    },
    {
      id: 'AG-02',
      name: '安全审计员 #101',
      role: '安全审计员',
      status: 'executing',
      progress: 26,
      iconKey: 'security',
      taskHint: '扫描依赖与许可证风险，生成审计条目…',
      etaSec: 38,
      logs: [
        { time: '17:12:01', text: 'Agent 启动成功' },
        { time: '17:12:04', text: '扫描依赖中...' },
      ],
    },
    {
      id: 'AG-03',
      name: '架构分析师 #102',
      role: '架构分析师',
      status: 'waiting',
      progress: 36,
      iconKey: 'architecture',
      taskHint: '等待上游代码审查结论以继续分层评估…',
      etaSec: 120,
      logs: [
        { time: '17:10:22', text: '建立上下文' },
        { time: '17:10:58', text: '等待上游结果' },
      ],
    },
    {
      id: 'AG-04',
      name: '文档生成器 #103',
      role: '文档生成器',
      status: 'paused',
      progress: 12,
      iconKey: 'doc',
      taskHint: '根据当前变更生成变更说明与 API 摘要…',
      etaSec: 0,
      logs: [
        { time: '17:09:10', text: '已载入模板' },
        { time: '17:09:45', text: '人工暂停' },
      ],
    },
  ]);

  readonly skills = signal([
    { id: 'skill.smart-refactor', name: '智能代码重构', desc: '识别并修复代码坏味道', active: true },
    { id: 'skill.auto-cr', name: '自动代码审查 (Auto-CR)', desc: 'Git Push 前分析安全漏洞和逻辑缺陷', active: false },
    { id: 'skill.tests', name: '深度单元测试生成', desc: '模拟复杂场景自动填充测试用例', active: false },
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
    const line = (text: string): AgentLogLine => ({
      time: PrototypeCoreFacade.logTimeNow(),
      text,
    });
    this.agents.update((list) =>
      list.map((a) =>
        a.id !== id
          ? a
          : {
              ...a,
              status: a.status === 'paused' ? 'executing' : 'paused',
              logs: [...a.logs, line(a.status === 'paused' ? '任务已恢复执行' : '任务已手动暂停')],
            },
      ),
    );
  }

  advanceAgent(id: string): void {
    const line = (text: string): AgentLogLine => ({
      time: PrototypeCoreFacade.logTimeNow(),
      text,
    });
    this.agents.update((list) =>
      list.map((a) => {
        if (a.id !== id) return a;
        const next = Math.min(100, a.progress + 10);
        return {
          ...a,
          progress: next,
          status: next >= 100 ? 'completed' : 'executing',
          etaSec: next >= 100 ? 0 : Math.max(5, (a.etaSec * 0.7) | 0),
          logs: [...a.logs, line(`进度更新到 ${next}%`)],
        };
      }),
    );
  }

  private static logTimeNow(): string {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  toggleSkill(id: string): void {
    // 技能页为单选激活：点击某个技能后，仅该技能保持 active=true
    this.skills.update((items) => items.map((it) => ({ ...it, active: it.id === id })));
  }

  addSkill(payload: { name: string; desc: string }): void {
    const base = payload.name.trim() || '新技能';
    const id = `skill.custom.${Date.now().toString(36)}`;
    const desc = payload.desc.trim() || '由向导创建';
    this.skills.update((items) => [{ id, name: base, desc, active: true }, ...items.map((it) => ({ ...it, active: false }))]);
  }

  togglePlugin(id: string): void {
    this.plugins.update((items) => items.map((it) => (it.id === id ? { ...it, installed: !it.installed } : it)));
  }
}
