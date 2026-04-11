import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
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

export interface UiTool {
  id: string;
  name: string;
  desc: string;
  category: 'file' | 'search' | 'web' | 'terminal' | 'planning' | 'analysis' | 'question';
  enabled: boolean;
  source: 'builtin' | 'hub';
}

export interface UiSkill {
  id: string;
  name: string;
  desc: string;
  active: boolean;
  source: 'builtin' | 'custom' | 'clawhub' | 'vault';
  status?: 'ok' | 'invalid';
  installedAt?: number;
  updatedAt?: number;
}

@Injectable({ providedIn: 'root' })
export class PrototypeCoreFacade implements OnDestroy {
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

  readonly skills = signal<UiSkill[]>([
    { id: 'skill.smart-refactor', name: '智能代码重构', desc: '识别并修复代码坏味道', active: true, source: 'builtin' },
    { id: 'skill.auto-cr', name: '自动代码审查 (Auto-CR)', desc: 'Git Push 前分析安全漏洞和逻辑缺陷', active: false, source: 'builtin' },
    { id: 'skill.tests', name: '深度单元测试生成', desc: '模拟复杂场景自动填充测试用例', active: false, source: 'builtin' },
    { id: 'skill.cicd', name: 'CI/CD Pipeline 优化', desc: '分析构建日志并优化流水线速度', active: false, source: 'builtin' },
  ]);

  readonly plugins = signal([
    { id: 'plugin.github', name: 'GitHub Context', desc: '实时访问仓库/PR/Issues', installed: false },
    { id: 'plugin.jira', name: 'Jira Integration', desc: '同步任务进度并建议更新 Stories', installed: true },
    { id: 'plugin.pg', name: 'Postgres Explorer', desc: '查询 Schema 并建议 SQL 优化', installed: false },
  ]);

  /** 展示用列表：仅由 syncToolsFromRuntime 从 CLAUDE_RUNTIME.tools（buildLocalTools 真实 IPC）同步，不再注入 echo 占位工具 */
  readonly tools = signal<UiTool[]>([]);

  readonly modelUsagePercent = computed(() => Math.min(100, Math.round((this.tokenUsed() / this.tokenMax()) * 100)));
  readonly selectedNode = computed(() => this.nodes().find((n) => n.id === this.selectedNodeId()) ?? null);

  private _runtimeToolSyncTimer?: number;

  ngOnDestroy(): void {
    if (this._runtimeToolSyncTimer) {
      window.clearInterval(this._runtimeToolSyncTimer);
      this._runtimeToolSyncTimer = undefined;
    }
  }

  constructor() {
    this.settingsService.settings$.subscribe((s) => {
      this.settings.set(s);
      this.activeModel.set(s.model);
    });
    this.syncToolsFromRuntime();
    this._runtimeToolSyncTimer = window.setInterval(() => this.syncToolsFromRuntime(), 3000);
  }

  private syncToolsFromRuntime(): void {
    const anyTools = this.runtime.tools as unknown as { list?: () => unknown; getAll?: () => unknown };
    const raw = (typeof anyTools.list === 'function' ? anyTools.list() : typeof anyTools.getAll === 'function' ? anyTools.getAll() : []) as unknown;
    if (!Array.isArray(raw) || raw.length === 0) return;

    const normalized = raw
      .map((it): UiTool | null => {
        const rec = it as Record<string, unknown>;
        const name = String(rec['name'] ?? rec['id'] ?? '').trim();
        if (!name) return null;
        const desc = String(rec['description'] ?? rec['desc'] ?? '本地运行时工具').trim();
        return {
          id: `tool.${name}`,
          name,
          desc,
          category: this.inferToolCategory(name, desc),
          enabled: true,
          source: 'builtin',
        };
      })
      .filter((x): x is UiTool => x !== null);

    if (normalized.length === 0) return;

    const merged = [...this.tools()];
    for (const t of normalized) {
      const idx = merged.findIndex((x) => x.name === t.name || x.id === t.id);
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], name: t.name, desc: t.desc, category: t.category, enabled: true };
      } else {
        merged.push(t);
      }
    }
    this.tools.set(merged);
  }

  private inferToolCategory(name: string, desc: string): UiTool['category'] {
    const s = `${name} ${desc}`.toLowerCase();
    if (s.includes('memory') || s.includes('plan') || s.includes('todo')) return 'planning';
    if (s.includes('terminal') || s.includes('shell') || s.includes('exec')) return 'terminal';
    if (s.includes('web') || s.includes('http') || s.includes('fetch')) return 'web';
    if (s.includes('search') || s.includes('grep') || s.includes('glob')) return 'search';
    if (s.includes('question')) return 'question';
    if (s.includes('notebook') || s.includes('analysis')) return 'analysis';
    return 'file';
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

  addSkill(payload: { name: string; desc: string; outputMode?: 'standard' | 'presentation-html' | 'presentation-pptx' }): void {
    const base = payload.name.trim() || '新技能';
    const id = `skill.custom.${Date.now().toString(36)}`;
    const desc = payload.desc.trim() || '由向导创建';
    const mode = payload.outputMode ?? 'standard';
    const modeLabel =
      mode === 'presentation-html' ? '输出模式：网页演示（HTML）' : mode === 'presentation-pptx' ? '输出模式：PPTX 导出' : '输出模式：标准';

    this.skills.update((items) => [
      { id, name: base, desc: `${desc} · ${modeLabel}`, active: true, source: 'custom' as const },
      ...items.map((it) => ({ ...it, active: false })),
    ]);
  }

  togglePlugin(id: string): void {
    this.plugins.update((items) => items.map((it) => (it.id === id ? { ...it, installed: !it.installed } : it)));
  }

  toggleTool(id: string): void {
    this.tools.update((items) => items.map((it) => (it.id === id ? { ...it, enabled: !it.enabled } : it)));
  }

  setToolEnabled(id: string, enabled: boolean): void {
    this.tools.update((items) => items.map((it) => (it.id === id ? { ...it, enabled } : it)));
  }

  upsertTool(payload: Omit<UiTool, 'source'> & { source?: UiTool['source'] }): void {
    const id = payload.id.trim();
    if (!id) return;

    const normalized: UiTool = {
      ...payload,
      id,
      name: payload.name.trim() || id,
      desc: payload.desc.trim() || '自定义工具',
      source: payload.source ?? 'hub',
    };

    this.tools.update((items) => {
      const idx = items.findIndex((it) => it.id === id);
      if (idx < 0) return [normalized, ...items];
      const next = [...items];
      next[idx] = normalized;
      return next;
    });
    // 不向运行时注册无 executor 的 echo 工具；若需可调用工具，应在 zyfront-core 扩展 buildLocalTools 或带 executor 的 tools.register
  }

  installSkillFromHub(payload: {
    id: string;
    name: string;
    desc: string;
    source?: UiSkill['source'];
    status?: UiSkill['status'];
    installedAt?: number;
    updatedAt?: number;
    activate?: boolean;
  }): void {
    const normalizedId = payload.id.trim() || `skill.hub.${Date.now().toString(36)}`;
    const name = payload.name.trim() || '未命名技能';
    const desc = payload.desc.trim() || '来自 ClawHub';
    const source = payload.source ?? 'clawhub';
    const activate = payload.activate ?? true;

    this.skills.update((items) => {
      const exists = items.find((it) => it.id === normalizedId);
      if (exists) {
        return items.map((it) => {
          if (it.id === normalizedId) {
            return {
              ...it,
              name,
              desc,
              active: activate ? true : it.active,
              source,
              status: payload.status,
              installedAt: payload.installedAt,
              updatedAt: payload.updatedAt,
            };
          }
          return activate ? { ...it, active: false } : it;
        });
      }
      return [
        {
          id: normalizedId,
          name,
          desc,
          active: activate,
          source,
          status: payload.status,
          installedAt: payload.installedAt,
          updatedAt: payload.updatedAt,
        },
        ...items.map((it) => (activate ? { ...it, active: false } : it)),
      ];
    });
  }

  async runSkillWithAgent(payload: { skillId: string; skillContent: string; prompt: string }): Promise<string> {
    const assistant = this.runtime.assistant as unknown as Record<string, unknown>;
    const contextPrompt = [
      `【角色】你是技能执行器：必须优先遵守下方 SKILL.md 中的规则、约束与流程；若与用户输入冲突，以 SKILL.md 为准并在输出中简要说明取舍。`,
      `【范围】仅围绕本技能与用户任务作答；不要编造 SKILL.md 未给出的工具或权限；不确定时明确写出假设。`,
      `【解析】若 SKILL.md 含 YAML frontmatter（--- 包裹），先理解其中的 triggers / metadata，再执行正文指令。`,
      ``,
      `技能ID: ${payload.skillId}`,
      ``,
      `--- SKILL.md 全文 ---`,
      payload.skillContent,
      `--- 结束 ---`,
      ``,
      `【用户任务】`,
      payload.prompt,
      ``,
      `【输出】使用 Markdown，固定小节标题（勿省略）：`,
      `## 目标`,
      `## 执行步骤`,
      `## 结果与交付物`,
      `## 风险与待确认（若无写「无」）`,
    ].join('\n');

    const methodNames = ['respond', 'run', 'chat', 'invoke', 'complete'];
    for (const name of methodNames) {
      const fn = assistant[name];
      if (typeof fn !== 'function') continue;
      try {
        const result = await (fn as (...args: unknown[]) => Promise<unknown>).call(assistant, {
          input: contextPrompt,
          prompt: contextPrompt,
          message: contextPrompt,
        });
        const text = this.extractAgentText(result);
        if (text) return text;
      } catch {
        // try next method
      }
    }

    throw new Error('当前运行时未暴露可调用的 assistant 方法，请先在 runtime 中开放对话执行接口。');
  }

  private extractAgentText(result: unknown): string {
    if (typeof result === 'string') return result;
    if (!result || typeof result !== 'object') return '';

    const rec = result as Record<string, unknown>;
    const direct = rec['text'] ?? rec['output'] ?? rec['content'];
    if (typeof direct === 'string') return direct;

    const choices = rec['choices'];
    if (Array.isArray(choices) && choices.length > 0) {
      const c0 = choices[0] as Record<string, unknown>;
      const msg = c0['message'] as Record<string, unknown> | undefined;
      if (msg && typeof msg['content'] === 'string') return String(msg['content']);
    }

    return JSON.stringify(result, null, 2);
  }
}

