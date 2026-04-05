import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NgFor, NgIf, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { AppSettingsService } from '../../../core/app-settings.service';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import type { CoordinationMode, CoordinationStep, StreamChunk } from 'zyfront-core';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../../core/zyfront-core.providers';
import { CommandRouterService } from './command-router.service';
import { DIRECTIVE_REGISTRY, isCoordinationMode, parseDirective, type DirectiveDefinition } from './directive-registry';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markup';

const RECENT_STORAGE_KEY_V2 = 'zytrader-workbench-recent-turns:v2';
const RECENT_STORAGE_KEY_V1 = 'zytrader-workbench-recent-turns:v1';
const SESSION_ID = 'workbench-terminal-ai';
/** 最近会话写入 localStorage；v2 含 transcript 便于完整回放 */
const MAX_TRANSCRIPT_ENTRIES = 120;
/** 回放时单条助手内容最大字符数 */
const REPLAY_ASSISTANT_MAX = 12000;

interface RecentTranscriptLine {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

interface RecentTurn {
  id: string;
  title: string;
  prompt: string;
  at: number;
  /** 该会话完整消息序列（点击「最近会话」时按序回放） */
  transcript?: RecentTranscriptLine[];
}

/** 右侧「捕获的记忆」列表项（角色 + 摘要） */
interface MemoryVm {
  id: string;
  kind: 'user' | 'assistant' | 'tool';
  label: string;
  snippet: string;
  at: number;
}

interface FileNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  expanded?: boolean;
  loaded?: boolean;
  children?: FileNode[];
}

/** 从助手正文中抽取计划步骤（编号列表、Markdown 列表、「步骤n：」） */
function parsePlanStepsFromText(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const steps: string[] = [];
  const patterns: RegExp[] = [
    /^\s*(?:\d+[\.\u3001\)\]\uFF09]\s*)(.+)$/u,
    /^\s*[\-\*\u2022]\s+(.+)$/u,
    /^\s*\u6B65\u9AA4\s*\d+\s*(?::|\uFF1A|\uFF0E|\.)\s*(.+)$/u,
    /^\s*\d+\.\s+(.+)$/u,
  ];
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m?.[1]) {
        const t = m[1].trim();
        if (t.length > 1 && !/^\x60{3}/.test(t)) {
          steps.push(t);
          break;
        }
      }
    }
  }
  return steps;
}

@Component({
  selector: 'app-workbench-page',
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    RouterLinkActive,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzProgressModule,
  ],
  templateUrl: './workbench.page.html',
  styleUrls: ['../prototype-page.scss', './workbench.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkbenchPageComponent implements AfterViewInit, OnDestroy {
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly router = inject(CommandRouterService);
  private readonly appSettings = inject(AppSettingsService);
  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('xtermHost', { static: false })
  private xtermHost?: ElementRef<HTMLDivElement>;

  protected readonly workspaceRoot = signal('workspace');
  protected readonly tree = signal<FileNode[]>([]);
  protected readonly selectedPath = signal('');
  protected readonly selectedContent = signal('在左侧资源管理器中点击文件以在此预览。');

  protected readonly tabs = signal<string[]>(['Terminal - Main']);
  protected readonly activeTab = signal('Terminal - Main');
  protected readonly terminalBusy = signal(false);

  private readonly inputHistory = signal<string[]>([]);

  protected readonly directives: DirectiveDefinition[] = DIRECTIVE_REGISTRY;

  protected readonly coordinatorMode = signal<'single' | 'plan' | 'parallel'>('single');
  protected readonly stepTotal = signal(0);
  protected readonly stepDone = signal(0);
  protected readonly stepInProgress = signal(0);
  protected readonly stepPending = signal(0);
  protected readonly toolCallCount = signal(0);
  protected readonly sessionCostUsd = signal(0);
  protected readonly planSteps = signal<CoordinationStep[]>([]);
  protected readonly memoryItems = signal<MemoryVm[]>([]);

  protected readonly planProgressPercent = computed(() => {
    const total = this.stepTotal();
    if (total <= 0) return 0;
    return Math.min(100, Math.round((this.stepDone() / total) * 100));
  });

  protected readonly recentTurns = signal<RecentTurn[]>(this.loadRecentTurns());

  /** 非「主终端」标签：Prism 语法高亮预览 */
  protected readonly filePreviewHtml = computed<SafeHtml>(() => {
    const tab = this.activeTab();
    const code = this.selectedContent();
    if (tab === 'Terminal - Main') {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    const ext = tab.includes('.') ? (tab.split('.').pop() ?? '').toLowerCase() : '';
    const lang = this.prismLangForExt(ext);
    const L = Prism.languages as Record<string, Prism.Grammar | undefined>;
    const grammar = L[lang] ?? L['markup'] ?? L['typescript'] ?? L['javascript'];
    let html: string;
    if (!grammar) {
      html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    } else {
      try {
        html = Prism.highlight(code, grammar, lang);
      } catch {
        html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
    }
    const safe = `<pre class="language-${lang} file-preview-pre"><code class="language-${lang}">${html}</code></pre>`;
    return this.sanitizer.bypassSecurityTrustHtml(safe);
  });

  private xterm?: Terminal;
  private fitAddon?: FitAddon;
  private resizeObserver?: ResizeObserver;
  /** ??? Backspace?????????? xterm/?? IME ? onData ????? */
  private xtermBackspaceKeydown?: (e: Event) => void;
  /** ? onData ? \\b ????????? */
  private backspaceHandledTs = 0;

  private mainLineBuffer = '';
  private mainEscSkip = false;
  private mainEscAcc = '';
  /** 输入 / 指令时：下一行显示同前缀补全，避免刷屏 */
  private slashHintRowActive = false;

  /** 流式对话取消（与 zyfront-core assistant.stream 的 cancel 对应） */
  private streamStop?: () => void;
  private streamReader: ReadableStreamDefaultReader<StreamChunk> | null = null;
  private streamInterruptRequested = false;
  private directiveTabCycle = 0;

  protected readonly rightPanelVisible = signal(true);

  private syncTimer?: number;
  /** 工具调用轨迹，与历史消息合并为右栏「记忆」 */
  private readonly toolMemoryTrace = signal<MemoryVm[]>([]);

  constructor() {
    void this.bootstrapWorkspace();
    this.syncCoordinatorState();
    void this.rebuildMemoryPanel();
    this.syncTimer = window.setInterval(() => {
      this.syncCoordinatorState();
      void this.rebuildMemoryPanel();
    }, 500);
  }

  async ngAfterViewInit(): Promise<void> {
    this.initAiXterm();
  }

  ngOnDestroy(): void {
    if (this.xtermBackspaceKeydown) {
      window.removeEventListener('keydown', this.xtermBackspaceKeydown, true);
      this.xtermBackspaceKeydown = undefined;
    }
    this.resizeObserver?.disconnect();
    this.xterm?.dispose();

    if (this.syncTimer) window.clearInterval(this.syncTimer);
  }

  private prismLangForExt(ext: string): string {
    const m: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      json: 'json',
      md: 'markdown',
      css: 'css',
      scss: 'scss',
      less: 'css',
      html: 'markup',
      htm: 'markup',
      vue: 'markup',
      xml: 'markup',
      svg: 'markup',
      yml: 'yaml',
      yaml: 'yaml',
      py: 'python',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
    };
    return m[ext] ?? 'typescript';
  }

  private syncCoordinatorState(): void {
    const state = this.runtime.coordinator.getState();
    this.coordinatorMode.set(state.mode);
    this.planSteps.set([...state.steps]);
    this.stepTotal.set(state.steps.length);
    this.stepDone.set(state.steps.filter((s) => s.status === 'completed').length);
    this.stepInProgress.set(state.steps.filter((s) => s.status === 'in_progress').length);
    this.stepPending.set(state.steps.filter((s) => s.status === 'pending').length);
  }

  /** 将历史消息与工具轨迹合并为右栏「捕获的记忆」 */
  private async rebuildMemoryPanel(): Promise<void> {
    try {
      const msgs = await this.runtime.history.list(SESSION_ID);
      const fromHist: MemoryVm[] = msgs.slice(-18).map((m) => {
        const raw = typeof m.content === 'string' ? m.content : '';
        const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 140);
        const label =
          m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role === 'tool' ? '工具' : '系统';
        return {
          id: m.id,
          kind: m.role === 'user' || m.role === 'assistant' || m.role === 'tool' ? m.role : 'assistant',
          label,
          snippet: snippet || '（空消息）',
          at: m.timestamp,
        };
      });
      const tools = this.toolMemoryTrace();
      const merged = [...fromHist, ...tools].sort((a, b) => b.at - a.at).slice(0, 28);
      this.memoryItems.set(merged);
    } catch {
      this.memoryItems.set([...this.toolMemoryTrace()].sort((a, b) => b.at - a.at).slice(0, 28));
    }
  }

  private pushToolMemory(snippet: string): void {
    const row: MemoryVm = {
      id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'tool',
      label: '工具',
      snippet,
      at: Date.now(),
    };
    this.toolMemoryTrace.update((prev) => [row, ...prev].slice(0, 16));
  }

  /** 有计划步骤时：首个工具调用将一步标为进行中 */
  private bumpPlanOnToolStart(): void {
    const { steps } = this.runtime.coordinator.getState();
    if (steps.length === 0) return;
    if (steps.some((s) => s.status === 'in_progress')) return;
    const pending = steps.find((s) => s.status === 'pending');
    if (pending) this.runtime.coordinator.updateStep(pending.id, { status: 'in_progress' });
  }

  /** 工具成功返回：当前进行中步骤标为完成并启动下一步 */
  private bumpPlanOnToolDone(ok: boolean): void {
    if (!ok) return;
    const { steps } = this.runtime.coordinator.getState();
    const cur = steps.find((s) => s.status === 'in_progress');
    if (cur) {
      this.runtime.coordinator.updateStep(cur.id, { status: 'completed' });
      const next = this.runtime.coordinator.getState().steps.find((s) => s.status === 'pending');
      if (next) this.runtime.coordinator.updateStep(next.id, { status: 'in_progress' });
    }
  }

  private async bootstrapWorkspace(): Promise<void> {
    const info = await window.zytrader.workspace.info();
    if (info.ok) this.workspaceRoot.set(info.root);
    await this.loadDir('.');
  }

  protected setTab(tab: string): void {
    this.activeTab.set(tab);
    queueMicrotask(() => this.fitAddon?.fit());
  }

  protected closeEditorTab(tab: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (tab === 'Terminal - Main') return;
    const cur = this.tabs().filter((t) => t !== tab);
    this.tabs.set(cur);
    if (this.activeTab() === tab) {
      const fallback = cur.includes('Terminal - Main') ? 'Terminal - Main' : cur[0] ?? 'Terminal - Main';
      this.setTab(fallback);
    }
  }

  private updateEditorTab(label: string): void {
    const cur = this.tabs();
    if (!cur.includes(label)) {
      this.tabs.set([...cur, label]);
    }
    this.setTab(label);
  }

  protected treeIcon(node: FileNode): string {
    return node.type === 'dir' ? 'folder' : 'file-text';
  }

  protected statusLabel(status: CoordinationStep['status']): string {
    const map: Record<CoordinationStep['status'], string> = {
      pending: '待处理',
      in_progress: '进行中',
      completed: '已完成',
      cancelled: '已取消',
    };
    return map[status] ?? status;
  }

  protected formatRecentTime(at: number): string {
    const sec = Math.floor((Date.now() - at) / 1000);
    if (sec < 60) return '刚刚';
    if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
    return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  protected replayRecent(r: RecentTurn): void {
    if (this.terminalBusy()) return;
    this.clearSlashHintRow();
    this.mainLineBuffer = '';
    this.mainEscSkip = false;
    this.mainEscAcc = '';
    this.directiveTabCycle = 0;
    this.xterm?.clear();

    const rows =
      r.transcript && r.transcript.length > 0
        ? r.transcript
        : [{ role: 'user' as const, content: r.prompt }];

    for (const row of rows) {
      const raw = typeof row.content === 'string' ? row.content : '';
      const text = raw.replace(/\r\n/g, '\n').replace(/\n+/g, '\n').trim();
      if (!text) continue;

      if (row.role === 'user') {
        const oneLine = text.split('\n').map((l) => l.trim()).join(' ');
        this.aiXtermWrite(`\r\n\x1b[32m>\x1b[0m ${oneLine}\r\n`);
        continue;
      }
      if (row.role === 'assistant') {
        const body =
          text.length > REPLAY_ASSISTANT_MAX ? `${text.slice(0, REPLAY_ASSISTANT_MAX)}\n…` : text;
        this.aiXtermWrite(`\x1b[35m[助手]\x1b[0m\r\n`);
        this.aiXtermWrite(`${body}\r\n`);
        continue;
      }
      const toolPreview = text.length > 800 ? `${text.slice(0, 800)}…` : text;
      this.aiXtermWrite(`\x1b[36m[工具]\x1b[0m ${toolPreview.replace(/\r?\n/g, ' ')}\r\n`);
    }

    this.writeMainTerminalPrompt();
  }

  protected refreshPlanPanel(): void {
    this.syncCoordinatorState();
    void this.rebuildMemoryPanel();
  }

  protected toggleRightPanel(): void {
    this.rightPanelVisible.update((v) => !v);
    queueMicrotask(() => this.fitAddon?.fit());
  }

  /** 右侧展示：对话 / 计划 / 执行（parallel） */
  protected formatWorkbenchModeLabel(mode: CoordinationMode): string {
    const map: Record<CoordinationMode, string> = {
      single: '对话模式',
      plan: '计划模式',
      parallel: '执行模式',
    };
    return map[mode] ?? mode;
  }

  protected syncPlanFromPrompt(): void {
    const text = window.prompt('每行一条计划步骤，粘贴后确定保存：');
    if (!text?.trim()) return;
    const lines = text
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const now = Date.now();
    const steps: CoordinationStep[] = lines.map((title, i) => ({
      id: `wb-step-${now}-${i}`,
      title,
      status: 'pending' as const,
    }));
    this.runtime.coordinator.setSteps(steps);
    if (this.runtime.coordinator.getState().mode === 'single') {
      this.runtime.coordinator.setMode('plan');
    }
    this.syncCoordinatorState();
  }

  private loadRecentTurns(): RecentTurn[] {
    try {
      let raw = localStorage.getItem(RECENT_STORAGE_KEY_V2);
      if (!raw) raw = localStorage.getItem(RECENT_STORAGE_KEY_V1);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as RecentTurn[];
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, 30).map((x) => ({
        id: x.id,
        title: x.title,
        prompt: x.prompt,
        at: x.at,
        transcript: Array.isArray(x.transcript) ? x.transcript : undefined,
      }));
    } catch {
      return [];
    }
  }

  private persistRecentTurns(list: RecentTurn[]): void {
    localStorage.setItem(RECENT_STORAGE_KEY_V2, JSON.stringify(list.slice(0, 30)));
  }

  /** 助手回复成功后：拉取完整 history 写入最近会话的 transcript */
  private async appendRecentTurnAfterSuccess(userPrompt: string): Promise<void> {
    const trimmed = userPrompt.trim();
    if (!trimmed) return;

    const transcript: RecentTranscriptLine[] = [];
    try {
      const msgs = await this.runtime.history.list(SESSION_ID);
      for (const m of msgs) {
        if (m.role === 'system') continue;
        const role: RecentTranscriptLine['role'] =
          m.role === 'user' || m.role === 'assistant' || m.role === 'tool' ? m.role : 'assistant';
        const content = typeof m.content === 'string' ? m.content : '';
        transcript.push({ role, content });
      }
    } catch {
      transcript.push({ role: 'user', content: trimmed });
    }

    const cap = transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
    const title = trimmed.length > 56 ? `${trimmed.slice(0, 53)}…` : trimmed;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const entry: RecentTurn = { id, title, prompt: trimmed, at: Date.now(), transcript: cap };
    const next = [entry, ...this.recentTurns()].slice(0, 30);
    this.recentTurns.set(next);
    this.persistRecentTurns(next);
  }

  /** plan 模式：从最近一条助手消息解析步骤并写入协调器 */
  private async syncPlanStepsFromLastAssistant(): Promise<void> {
    if (this.runtime.coordinator.getState().mode !== 'plan') return;
    const msgs = await this.runtime.history.list(SESSION_ID);
    const last = [...msgs].reverse().find((m) => m.role === 'assistant');
    const content = typeof last?.content === 'string' ? last.content : '';
    if (!content.trim()) return;
    const titles = parsePlanStepsFromText(content);
    if (titles.length === 0) return;
    const now = Date.now();
    const steps: CoordinationStep[] = titles.map((title, i) => ({
      id: `plan-ai-${now}-${i}`,
      title,
      status: 'pending' as const,
    }));
    this.runtime.coordinator.setSteps(steps);
    this.syncCoordinatorState();
  }

  private handleStreamChunk(value: StreamChunk): void {
    if (value.type === 'delta') {
      this.aiXtermWrite(value.textDelta);
      return;
    }
    if (value.type === 'tool_call') {
      this.toolCallCount.update((v) => v + 1);
      const name = value.toolCall.toolName ?? 'tool';
      this.bumpPlanOnToolStart();
      this.pushToolMemory(`调用 ${name}`);
      this.aiXtermWrite(`\r\n\x1b[36m[工具]\x1b[0m \x1b[1m${name}\x1b[0m\x1b[90m …\x1b[0m`);
      return;
    }
    if (value.type === 'tool_result') {
      const { ok, error } = value.toolResult;
      const tag = ok ? '\x1b[32m完成\x1b[0m' : '\x1b[31m失败\x1b[0m';
      const detail = !ok && error ? ` \x1b[90m${error.slice(0, 200)}\x1b[0m` : '';
      this.bumpPlanOnToolDone(ok);
      this.pushToolMemory(ok ? '工具调用完成' : `工具失败：${(error ?? '').slice(0, 80)}`);
      this.aiXtermWrite(`\r\n\x1b[36m[工具结果]\x1b[0m ${tag}${detail}\r\n`);
      return;
    }
    if (value.type === 'done') {
      return;
    }
    if (value.type === 'anthropic_turn') {
      return;
    }
    if (value.type === 'error') {
      return;
    }
  }

  private initAiXterm(): void {
    const host = this.xtermHost?.nativeElement;
    if (!host) return;

    this.fitAddon = new FitAddon();
    this.xterm = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily:
        "'JetBrains Mono', 'Fira Code', Consolas, 'Cascadia Mono', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      theme: {
        background: '#0d0d12',
        foreground: '#e2e4f0',
        cursor: '#8b5cf6',
        cursorAccent: '#0d0d12',
        selectionBackground: '#2a1f4e',
        black: '#1a1a2e',
        red: '#ff6b9d',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
        brightBlack: '#3f3f5a',
        brightRed: '#f472b6',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      convertEol: true,
    });

    this.xterm.loadAddon(this.fitAddon);
    this.xterm.open(host);
    this.fitAddon.fit();

    this.xterm.onData((data) => {
      this.feedMainTerminalInput(data);
    });

    this.xtermBackspaceKeydown = (e: Event) => {
      const ke = e as KeyboardEvent;
      const t = ke.target;
      if (!(t instanceof Node) || !host.contains(t)) return;
      if (this.terminalBusy()) return;
      if (ke.key !== 'Backspace') return;
      if (this.mainLineBuffer.length === 0) return;
      ke.preventDefault();
      this.backspaceHandledTs = performance.now();
      this.mainLineBuffer = this.popLastUserGrapheme(this.mainLineBuffer);
      this.redrawInputLine();
    };
    window.addEventListener('keydown', this.xtermBackspaceKeydown, true);

    host.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.code === 'Tab') {
        e.preventDefault();
        this.cycleWorkbenchCoordinationMode();
        return;
      }
      if (e.ctrlKey && e.code === 'KeyC' && !e.shiftKey) {
        e.preventDefault();
        this.handleTerminalControlC();
        return;
      }
      if (e.ctrlKey && e.code === 'KeyF') {
        e.preventDefault();
        this.aiXtermWrite(
          '\r\n\x1b[33m[提示]\x1b[0m Ctrl+C 中断 · Ctrl+Shift+C 复制 · Ctrl+Shift+V 粘贴 · Ctrl+L 清屏 · Shift+Tab 切换模式\r\n',
        );
        this.writeMainTerminalPrompt();
        this.redrawInputLine();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        const selected = this.xterm?.getSelection() ?? '';
        if (selected) void navigator.clipboard.writeText(selected);
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        void navigator.clipboard.readText().then((t) => {
          this.feedMainTerminalInput(t);
        });
      }
      if (e.ctrlKey && e.code === 'KeyL') {
        e.preventDefault();
        this.clearSlashHintRow();
        this.directiveTabCycle = 0;
        this.mainLineBuffer = '';
        this.mainEscSkip = false;
        this.mainEscAcc = '';
        this.xterm?.clear();
        this.printMainTerminalWelcome();
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.fitAddon?.fit();
    });
    this.resizeObserver.observe(host);

    this.printMainTerminalWelcome();
  }

  private printMainTerminalWelcome(): void {
    this.aiXtermWrite(
      '\x1b[90m主终端：shell；前加 ! 显式执行。输入 / 时下一行实时显示同前缀指令；Tab 补全；Shift+Tab 切换 对话/计划/执行；流式时 Ctrl+C 中断。\x1b[0m\r\n',
    );
    this.writeMainTerminalPrompt();
  }

  private writeMainTerminalPrompt(): void {
    this.aiXtermWrite(`\r\n\x1b[32m>\x1b[0m `);
  }

  private feedMainTerminalInput(data: string): void {
    for (const ch of data) {
      if (ch === '\x03') {
        this.handleTerminalControlC();
        continue;
      }

      if (this.terminalBusy()) {
        continue;
      }

      if (ch === '\t') {
        if (this.mainLineBuffer.startsWith('/')) {
          this.tryDirectiveTabComplete();
        }
        continue;
      }

      if (this.mainEscSkip) {
        this.mainEscAcc += ch;
        const acc = this.mainEscAcc;
        if ((/[A-Za-z~]/.test(ch) && acc.length >= 2) || acc.length > 48) {
          this.mainEscSkip = false;
          this.mainEscAcc = '';
        }
        continue;
      }
      if (ch === '\x1b') {
        this.mainEscSkip = true;
        this.mainEscAcc = '\x1b';
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        this.directiveTabCycle = 0;
        this.clearSlashHintRow();
        const line = this.mainLineBuffer;
        this.mainLineBuffer = '';
        this.aiXtermWrite('\r\n');
        void this.dispatchMainTerminalLine(line);
        continue;
      }
      if (ch === '\x7f' || ch === '\b') {
        if (performance.now() - this.backspaceHandledTs < 45) continue;
        if (this.mainLineBuffer.length > 0) {
          this.backspaceHandledTs = performance.now();
          this.mainLineBuffer = this.popLastUserGrapheme(this.mainLineBuffer);
          this.redrawInputLine();
        }
        continue;
      }
      const cp = ch.codePointAt(0);
      if (cp !== undefined && cp < 32) continue;

      this.directiveTabCycle = 0;
      this.mainLineBuffer += ch;
      this.xterm?.write(ch);
      this.syncSlashCompletionRow();
    }
  }

  private clearSlashHintRow(): void {
    if (!this.slashHintRowActive) return;
    this.xterm?.write('\x1b[s\r\n\x1b[2K\x1b[u');
    this.slashHintRowActive = false;
  }

  /** ?????????????emoji????????? xterm ???? */
  private popLastUserGrapheme(s: string): string {
    if (!s) return s;
    try {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const parts = [...seg.segment(s)];
      if (parts.length === 0) return '';
      parts.pop();
      return parts.map((p) => p.segment).join('');
    } catch {
      return s.slice(0, -1);
    }
  }

  /** 输入 `/` 前缀时：在下一行实时刷新「同前缀指令」，不追加多行说明 */
  private syncSlashCompletionRow(): void {
    const line = this.mainLineBuffer;
    const show = line.startsWith('/') && !line.includes(' ');
    if (!show) {
      this.clearSlashHintRow();
      return;
    }
    const matches = DIRECTIVE_REGISTRY.filter((d) => d.name.startsWith(line));
    const hint =
      matches.length > 0
        ? `\x1b[90m${matches.map((d) => d.name).join('  ')}\x1b[0m`
        : '\x1b[90m(无匹配)\x1b[0m';
    this.xterm?.write(`\x1b[s\r\n\x1b[2K${hint}\x1b[u`);
    this.slashHintRowActive = true;
  }

  /** Ctrl+C：取消流式请求；空闲时清空当前输入行 */
  private handleTerminalControlC(): void {
    if (this.streamStop) {
      this.streamInterruptRequested = true;
      try {
        this.streamStop();
      } catch {
        /* ignore */
      }
      this.streamStop = undefined;
      void this.streamReader?.cancel();
      return;
    }

    if (this.terminalBusy()) {
      this.terminalBusy.set(false);
      this.aiXtermWrite('\r\n\x1b[33m[中断]\x1b[0m\r\n');
      this.mainLineBuffer = '';
      this.writeMainTerminalPrompt();
      return;
    }

    this.mainLineBuffer = '';
    this.aiXtermWrite('^C\r\n');
    this.writeMainTerminalPrompt();
  }

  private redrawInputLine(): void {
    this.clearSlashHintRow();
    this.aiXtermWrite(`\r\x1b[2K\x1b[32m>\x1b[0m ${this.mainLineBuffer}`);
    this.syncSlashCompletionRow();
  }

  private tryDirectiveTabComplete(): void {
    const line = this.mainLineBuffer;
    if (!line.startsWith('/') || line.includes(' ')) return;
    const matches = DIRECTIVE_REGISTRY.filter((d) => d.name.startsWith(line));
    if (matches.length === 0) return;
    const pick = matches[this.directiveTabCycle % matches.length]!;
    this.directiveTabCycle = (this.directiveTabCycle + 1) % matches.length;
    this.mainLineBuffer = pick.name;
    this.redrawInputLine();
  }

  private cycleWorkbenchCoordinationMode(): void {
    if (this.terminalBusy()) return;
    const order: CoordinationMode[] = ['single', 'plan', 'parallel'];
    const cur = this.runtime.coordinator.getState().mode;
    const i = Math.max(0, order.indexOf(cur));
    const next = order[(i + 1) % order.length]!;
    this.runtime.coordinator.setMode(next);
    this.syncCoordinatorState();
    const label = this.formatWorkbenchModeLabel(next);
    this.aiXtermWrite(`\r\n\x1b[36m[模式]\x1b[0m ${label} (${next})\r\n`);
    this.writeMainTerminalPrompt();
    this.redrawInputLine();
  }

  private async dispatchMainTerminalLine(raw: string): Promise<void> {
    const t = raw.trim();
    if (!t) {
      this.writeMainTerminalPrompt();
      return;
    }
    if (this.terminalBusy()) {
      this.aiXtermWrite('\x1b[33m(busy)\x1b[0m\r\n');
      this.writeMainTerminalPrompt();
      return;
    }

    this.pushHistory(t);
    const route = this.router.route(t);

    try {
      if (route === 'directive') {
        await this.runDirective(t);
        return;
      }
      if (route === 'natural') {
        await this.askAssistant(t.startsWith('?') ? t.slice(1).trim() : t);
        return;
      }
      await this.runShell(t.startsWith('!') ? t.slice(1).trim() : t);
    } finally {
      if (!this.terminalBusy()) this.writeMainTerminalPrompt();
    }
  }

  protected async loadDir(path: string, parent?: FileNode): Promise<void> {
    const result = await window.zytrader.fs.list(path);
    if (!result.ok) return;

    const nodes: FileNode[] = result.entries
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      .map((entry) => ({
        name: entry.name,
        type: entry.type,
        path: path === '.' ? entry.name : `${path}/${entry.name}`,
        expanded: false,
        loaded: false,
        children: [],
      }));

    if (!parent) {
      this.tree.set(nodes);
      return;
    }

    parent.children = nodes;
    parent.loaded = true;
    parent.expanded = true;
    this.tree.set([...this.tree()]);
  }

  protected async toggleDir(node: FileNode): Promise<void> {
    if (node.type !== 'dir') return;
    if (!node.loaded) {
      await this.loadDir(node.path, node);
      return;
    }
    node.expanded = !node.expanded;
    this.tree.set([...this.tree()]);
  }

  protected async openFile(node: FileNode): Promise<void> {
    if (node.type !== 'file') return;
    this.selectedPath.set(node.path);
    this.updateEditorTab(node.name);

    const result = await window.zytrader.fs.read(node.path);
    if (!result.ok) {
      this.selectedContent.set('无法读取该文件。');
      return;
    }
    this.selectedContent.set(result.content.slice(0, 20000));
  }

  private async runDirective(raw: string): Promise<void> {
    const parsed = parseDirective(raw);

    if (!parsed.def) {
      this.aiXtermWrite(`\r\n[warn] 未知指令：${parsed.name}\r\n`);
      return;
    }

    switch (parsed.def.kind) {
      case 'help':
        this.aiXtermWrite('\r\n[help] 可用指令（自然语言直接回车即可提问助手）：\r\n');
        this.directives.forEach((d) => this.aiXtermWrite(` - ${d.name.padEnd(20)} ${d.desc}\r\n`));
        return;

      case 'plugin_list': {
        const plugins = this.runtime.plugins.list();
        this.aiXtermWrite(`\r\n[plugins] count=${plugins.length}\r\n`);
        plugins.forEach((p) => this.aiXtermWrite(` - ${p.id} :: v${p.version}\r\n`));
        return;
      }

      case 'mode': {
        if (!isCoordinationMode(parsed.args)) {
          this.aiXtermWrite(`\r\n[error] ${parsed.def.usage ?? '/mode <single|plan|parallel>'}\r\n`);
          return;
        }
        this.runtime.coordinator.setMode(parsed.args);
        this.syncCoordinatorState();
        this.aiXtermWrite(`\r\n[ok] coordinator mode => ${parsed.args}\r\n`);
        if (parsed.args === 'plan') {
          this.aiXtermWrite(
            '\x1b[90m已切换为 plan：助手若回复带编号列表，会自动同步到右侧「计划步骤」。\x1b[0m\r\n',
          );
        }
        return;
      }

      case 'status': {
        const state = this.runtime.coordinator.getState();
        this.aiXtermWrite(
          `\r\n[status] mode=${state.mode} steps=${state.steps.length} done=${this.stepDone()} running=${this.stepInProgress()} toolCalls=${this.toolCallCount()} cost=$${this.sessionCostUsd().toFixed(4)}\r\n`,
        );
        return;
      }

      case 'superpower': {
        await this.askAssistant('请根据当前 workspace 根目录，简要分析项目结构与关键入口。');
        return;
      }

      case 'plugin_run': {
        if (!parsed.args) {
          this.aiXtermWrite(`\r\n[error] ${parsed.def.usage ?? '/plugin:run <shell command>'}\r\n`);
          return;
        }
        const start = performance.now();
        await this.runShell(parsed.args);
        const ms = Math.round(performance.now() - start);
        this.aiXtermWrite(`\r\n[plugin:run] done in ${ms}ms\r\n`);
        return;
      }
    }
  }

  private async runShell(raw: string): Promise<void> {
    const cmd = raw.trim();
    if (!cmd) return;
    this.terminalBusy.set(true);
    try {
      const r = await window.zytrader.terminal.exec(cmd, '.');
      if (r.stdout) this.aiXtermWrite(r.stdout + (/\n$/.test(r.stdout) ? '' : '\r\n'));
      if (r.stderr) this.aiXtermWrite(`\x1b[31m${r.stderr}\x1b[0m` + (/\n$/.test(r.stderr) ? '' : '\r\n'));
      if (!r.ok) this.aiXtermWrite(`\x1b[33m[exit ${r.code}]\x1b[0m\r\n`);
    } finally {
      this.terminalBusy.set(false);
    }
  }

  private hintIfUnauthorized(text: string): string {
    if (/\b401\b/.test(text) || /unauthorized/i.test(text)) {
      return '\r\n\x1b[90m提示：疑似未授权（401）。请到「API 设置」检查 API Key。\x1b[0m';
    }
    return '';
  }

  private async askAssistant(raw: string): Promise<void> {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.aiXtermWrite('\r\n\x1b[31m[error]\x1b[0m 请输入内容。\r\n');
      return;
    }

    if (!this.appSettings.value.apiKey?.trim()) {
      this.aiXtermWrite(
        '\r\n\x1b[31m[error]\x1b[0m 未配置 API Key。\x1b[90m 请打开「API 设置」填写密钥后再试。\x1b[0m\r\n',
      );
      return;
    }

    this.streamInterruptRequested = false;
    this.terminalBusy.set(true);
    this.aiXtermWrite('\x1b[90m正在请求助手…\x1b[0m\r\n');

    const { stream, cancel } = this.runtime.assistant.stream(SESSION_ID, {
      userInput: trimmed,
      config: this.runtime.client.getModel(),
    });
    this.streamStop = cancel;
    const reader = stream.getReader();
    this.streamReader = reader;

    let streamFailed = false;
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<StreamChunk>;
        try {
          chunk = await reader.read();
        } catch {
          if (!this.streamInterruptRequested) {
            streamFailed = true;
            this.aiXtermWrite('\r\n[error] 流被异常终止\r\n');
          }
          break;
        }
        const { done, value } = chunk;
        if (done) break;
        if (value.type === 'error' && value.error) {
          streamFailed = true;
          this.aiXtermWrite(`\r\n[error] ${value.error}${this.hintIfUnauthorized(value.error)}`);
        } else {
          this.handleStreamChunk(value);
        }
      }
    } catch (error) {
      streamFailed = true;
      const msg = error instanceof Error ? error.message : '未知错误';
      this.aiXtermWrite(`\r\n[error] ${msg}${this.hintIfUnauthorized(msg)}\r\n`);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      this.streamReader = null;
      this.streamStop = undefined;
      this.terminalBusy.set(false);

      if (this.streamInterruptRequested) {
        this.aiXtermWrite('\r\n\x1b[33m[已中断]\x1b[0m\r\n');
        this.streamInterruptRequested = false;
      } else if (!streamFailed) {
        this.aiXtermWrite('\r\n\x1b[90m本轮结束。\x1b[0m\r\n');
        await this.appendRecentTurnAfterSuccess(trimmed);
        await this.syncPlanStepsFromLastAssistant();
        this.syncCoordinatorState();
      } else {
        this.aiXtermWrite('\r\n\x1b[90m本轮结束。\x1b[0m\r\n');
      }
    }
  }

  private pushHistory(input: string): void {
    const current = this.inputHistory();
    const next = [...current.filter((x) => x !== input), input].slice(-100);
    this.inputHistory.set(next);
  }

  private aiXtermWrite(text: string): void {
    this.xterm?.write(text.replaceAll('\n', '\r\n'));
  }
}
