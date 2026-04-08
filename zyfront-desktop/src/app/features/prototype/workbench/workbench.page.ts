import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NgFor, NgIf, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { RouterLink } from '@angular/router';
import { GlobalShellFrameComponent } from '../../../shared/global-shell-frame.component';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';
import {
  WorkbenchMonacoEditorComponent,
  type WorkbenchEditorDiagnosticRow,
} from './workbench-monaco-editor.component';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { AppSettingsService } from '../../../core/app-settings.service';
import { ModelUsageLedgerService } from '../../../core/model-usage-ledger.service';
import { AgentMemoryService } from '../../../core/agent-memory.service';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import type { ChatMessage, CoordinationMode, CoordinationStep, StreamChunk } from 'zyfront-core';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../../core/zyfront-core.providers';
import { TerminalMemoryGraphService } from '../../../core/terminal-memory-graph.service';
import { CommandRouterService } from './command-router.service';
import { DIRECTIVE_REGISTRY, isCoordinationMode, parseDirective, type DirectiveDefinition } from './directive-registry';
import { Subscription } from 'rxjs';
import { type TurnContext } from '../../../core/memory/memory.types';

/** 自动提交：主终端发给助手的固定提示（中文以走自然语言路由） */
const AUTO_COMMIT_PROMPT =
  '请根据当前工作区未提交的变更生成详细的中文提交说明（含文件与要点），然后依次执行 git add、git commit、git push 到远程仓库。';

const RECENT_STORAGE_KEY_V2 = 'zytrader-workbench-recent-turns:v2';
const RECENT_STORAGE_KEY_V1 = 'zytrader-workbench-recent-turns:v1';
const SESSION_ID = 'workbench-terminal-ai';

/** 资源管理器：Obsidian-Agent 标准顶层目录（顺序固定） */
const VAULT_EXPLORER_TOP = [
  { name: '00-INBOX', path: '00-INBOX' },
  { name: '01-HUMAN-NOTES', path: '01-HUMAN-NOTES' },
  { name: '02-AGENT-MEMORY', path: '02-AGENT-MEMORY' },
  { name: '03-PROJECTS', path: '03-PROJECTS' },
  { name: '04-RESOURCES', path: '04-RESOURCES' },
  { name: '05-SYSTEM', path: '05-SYSTEM' },
] as const;

const VAULT_EXPLORER_FIXED_CHILDREN: Record<string, Array<{ name: string; path: string }>> = {
  '00-INBOX': [
    { name: 'human', path: '00-INBOX/human' },
    { name: 'agent', path: '00-INBOX/agent' },
  ],
  '01-HUMAN-NOTES': [
    { name: '01-Daily', path: '01-HUMAN-NOTES/01-Daily' },
    { name: '02-Knowledge', path: '01-HUMAN-NOTES/02-Knowledge' },
    { name: '03-Notes', path: '01-HUMAN-NOTES/03-Notes' },
    { name: '04-Tags', path: '01-HUMAN-NOTES/04-Tags' },
  ],
  '02-AGENT-MEMORY': [
    { name: '01-Short-Term', path: '02-AGENT-MEMORY/01-Short-Term' },
    { name: '02-Long-Term', path: '02-AGENT-MEMORY/02-Long-Term' },
    { name: '03-Context', path: '02-AGENT-MEMORY/03-Context' },
    { name: '04-Meta', path: '02-AGENT-MEMORY/04-Meta' },
  ],
  '04-RESOURCES': [
    { name: 'images', path: '04-RESOURCES/images' },
    { name: 'files', path: '04-RESOURCES/files' },
    { name: 'media', path: '04-RESOURCES/media' },
    { name: 'templates', path: '04-RESOURCES/templates' },
  ],
};
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
  /** 相对 workspace 或 vault 根；资源管理器节点均为 vault */
  fsScope?: 'workspace' | 'vault';
  /** 归属哪棵资源树（用于刷新 signal） */
  treeRoot?: 'vault' | 'workspace';
}

interface PsSessionVm {
  id: string;
  name: string;
  shell: 'powershell' | 'cmd' | 'git-bash';
  output: string;
  exited: boolean;
}

type PsCwdPresetId = 'vault-root' | 'workspace-root' | 'inbox-human' | 'agent-short-term' | 'projects';

/** 每个编辑器标签页缓存的内容（切换 Tab 时恢复，避免共用 selectedContent 导致串台） */
interface TabEditorState {
  relPath: string;
  content: string;
  previewKind: 'code' | 'diff';
  dirty: boolean;
  fsScope?: 'workspace' | 'vault';
}

interface PendingAutoSave {
  tab: string;
  relPath: string;
  content: string;
  fsScope: 'workspace' | 'vault';
}

/** 左侧活动栏视图（对齐 VS Code） */
type SidebarView = 'explorer' | 'search' | 'git' | 'plugins';
type ExplorerRootView = 'project' | 'memory';

/** git grep 单条结果 */
interface SearchHit {
  path: string;
  line: number;
  text: string;
}

/** 分支下拉：展示名 + 传给 git 的 ref */
interface GitBranchRef {
  label: string;
  ref: string;
}

interface GitChangedFile {
  path: string;
  status: string;
}

interface GitCommitLine {
  hash: string;
  subject: string;
  author: string;
  date: string;
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
    NzButtonModule,
    GlobalShellFrameComponent,
    NzIconModule,
    NzInputModule,
    NzProgressModule,
    RouterLink,
    WorkbenchMonacoEditorComponent,
  ],
  templateUrl: './workbench.page.html',
  styleUrls: ['../prototype-page.scss', './workbench.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkbenchPageComponent implements AfterViewInit, OnDestroy {
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly router = inject(CommandRouterService);
  private readonly appSettings = inject(AppSettingsService);
  private readonly usageLedger = inject(ModelUsageLedgerService);
  private readonly memoryGraph = inject(TerminalMemoryGraphService);
  private readonly agentMemory = inject(AgentMemoryService);
  protected readonly prototypeFacade = inject(PrototypeCoreFacade);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cdr = inject(ChangeDetectorRef);

  /** 本轮流式请求开始时间，用于估算响应耗时并写入用量账本 */
  private streamRequestStartMs = 0;

  @ViewChild('xtermHost', { static: false })
  private xtermHost?: ElementRef<HTMLDivElement>;

  @ViewChild('psHost', { static: false })
  private psHost?: ElementRef<HTMLDivElement>;

  @ViewChild('tabScrollHost', { static: false })
  private tabScrollHost?: ElementRef<HTMLDivElement>;

  protected readonly workspaceRoot = signal('workspace');
  /** Vault 绝对路径（Electron 解析后） */
  protected readonly vaultPathLabel = signal('');
  /** 是否已检测到 05-SYSTEM（或已完成 bootstrap） */
  protected readonly vaultReady = signal(false);
  protected readonly shortTermMemoryCount = signal(0);
  protected readonly shortTermMemoryLatest = signal<string | null>(null);
  /** 工程（仓库）根目录下列出的节点 */
  protected readonly workspaceTree = signal<FileNode[]>([]);
  /** 记忆目录树（显示时代表原 Vault 树） */
  protected readonly memoryTree = signal<FileNode[]>([]);
  /** 左侧资源管理器当前视图：工程 / 记忆 */
  protected readonly explorerRootView = signal<ExplorerRootView>('project');
  /** 与 selectedPath 配对，区分 Vault / 工程树中高亮 */
  protected readonly selectedFileTreeRoot = signal<'vault' | 'workspace' | null>(null);
  protected readonly selectedPath = signal('');
 protected readonly selectedContent = signal('在左侧资源管理器中点击文件以在此预览。');

  protected readonly tabs = signal<string[]>(['Terminal - Main']);
  protected readonly activeTab = signal('Terminal - Main');
  protected readonly terminalBusy = signal(false);
  protected readonly visibleTabs = computed(() => this.tabs());

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
  protected readonly llmAvailable = signal(this.hasLlmConfigured());

  /** 左侧：资源管理器 / 搜索 / Git */
  protected readonly sidebarView = signal<SidebarView>('explorer');
  protected readonly gitBranch = signal('');
  protected readonly gitBranchRefs = signal<GitBranchRef[]>([]);
  protected readonly gitChangedFiles = signal<GitChangedFile[]>([]);
  protected readonly gitCommits = signal<GitCommitLine[]>([]);
  protected readonly gitBusy = signal(false);
  protected readonly branchMenuOpen = signal(false);
  protected readonly gitCommitDetailOpen = signal(false);
  protected readonly gitCommitDetailText = signal('');
  protected readonly gitUiMessage = signal('');
  /** 中间编辑器：普通高亮 / diff 文本 */
  protected readonly previewKind = signal<'code' | 'diff'>('code');
  /** Monaco 编辑内容与磁盘是否一致 */
  protected readonly editorDirty = signal(false);

  /** 按标签页标题缓存的编辑器状态 */
  private readonly tabEditorState = new Map<string, TabEditorState>();
  /** 防抖自动保存（实时落盘） */
  private autoSaveTimer?: ReturnType<typeof setTimeout>;
  private pendingAutoSave?: PendingAutoSave;
  /** Monaco TypeScript/JavaScript 诊断（当前活动代码页） */
  protected readonly editorDiagnostics = signal<WorkbenchEditorDiagnosticRow[]>([]);
  protected readonly tabContextMenu = signal<{ tab: string; x: number; y: number } | null>(null);

  protected readonly searchQuery = signal('');
  protected readonly searchBusy = signal(false);
  protected readonly searchHits = signal<SearchHit[]>([]);
  protected readonly searchMessage = signal('');

  private gitPollTimer?: number;

  /** Git diff 预览（普通源码由 Monaco 编辑） */
  protected readonly filePreviewHtml = computed<SafeHtml>(() => {
    const tab = this.activeTab();
    const code = this.selectedContent();
    if (tab === 'Terminal - Main') {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    if (this.previewKind() === 'diff') {
      const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const lines = escaped.split('\n');
      const body = lines
        .map((line) => {
          let cls = 'diff-line';
          if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
          else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del';
          else if (line.startsWith('@@')) cls += ' diff-hunk';
          return `<span class="${cls}">${line}</span>`;
        })
        .join('\n');
      return this.sanitizer.bypassSecurityTrustHtml(
        `<div class="diff-preview-wrap"><pre class="diff-preview">${body}</pre></div>`,
      );
    }
    return this.sanitizer.bypassSecurityTrustHtml('');
  });

  /** Monaco 语言 id（由当前标签页文件名推断） */
  protected readonly monacoLanguage = computed(() => {
    const tab = this.activeTab();
    if (tab === 'Terminal - Main') return 'plaintext';
    const ext = tab.includes('.') ? (tab.split('.').pop() ?? '').toLowerCase() : '';
    return this.monacoLangForExt(ext);
  });

  private xterm?: Terminal;
  private fitAddon?: FitAddon;
  private resizeObserver?: ResizeObserver;

  private psTerminal?: Terminal;
  private psFitAddon?: FitAddon;
  private psResizeObserver?: ResizeObserver;
  private detachPsData?: () => void;
  private detachPsExit?: () => void;

  protected readonly psSessions = signal<PsSessionVm[]>([]);
  protected readonly activePsSessionId = signal('');
  protected readonly psCwdPresets = [
    { id: 'vault-root' as const, label: 'Vault 根目录', cwd: '.', cwdScope: 'vault' as const },
    { id: 'workspace-root' as const, label: '工程根目录', cwd: '.', cwdScope: 'workspace' as const },
    { id: 'inbox-human' as const, label: '00-INBOX/human', cwd: '00-INBOX/human', cwdScope: 'vault' as const },
    {
      id: 'agent-short-term' as const,
      label: '02-AGENT-MEMORY/01-Short-Term',
      cwd: '02-AGENT-MEMORY/01-Short-Term',
      cwdScope: 'vault' as const,
    },
    { id: 'projects' as const, label: '03-PROJECTS', cwd: '03-PROJECTS', cwdScope: 'vault' as const },
  ];
  protected readonly activePsCwdPresetId = signal<PsCwdPresetId>('vault-root');
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

  protected readonly leftPanelVisible = signal(true);
  /** 为 true 时渲染底部 PTY；默认开启以便首次进入即可初始化真实 Shell */
  protected readonly terminalMenuVisible = signal(false);
  protected readonly rightPanelVisible = signal(false);

  protected readonly leftPanelWidth = signal(260);
  protected readonly rightPanelWidth = signal(300);
  protected readonly bottomPanelHeight = signal(180);
  protected readonly tabOverflowHiddenTabs = signal<string[]>([]);
  protected readonly tabBarHasOverflow = signal(false);
  protected readonly tabOverflowMenuOpen = signal(false);
  private tabOverflowObserver?: ResizeObserver;

  protected readonly mainGridTemplate = computed(() => {
    const cols: string[] = [];
    if (this.leftPanelVisible()) cols.push(`${this.leftPanelWidth()}px`, '4px');
    cols.push('minmax(0, 1fr)');
    if (this.rightPanelVisible()) cols.push('4px', `${this.rightPanelWidth()}px`);
    return cols.join(' ');
  });

  /** 主内容区 + 可选底部 PowerShell：编辑文件时仍可显示底部 PTY */
  protected readonly centerGridTemplateRows = computed(() => {
    if (!this.terminalMenuVisible()) return 'minmax(0, 1fr)';
    return `minmax(0, 1fr) 4px minmax(120px, ${this.bottomPanelHeight()}px)`;
  });

  private readonly tabOverflowSyncEffect = effect(() => {
    this.visibleTabs();
    this.activeTab();
    queueMicrotask(() => this.updateTabOverflow());
  });

  private syncTimer?: number;
  private memoryStatsTimer?: number;
  private settingsSub?: Subscription;
  /** 工具调用轨迹，与历史消息合并为右栏「记忆」 */
  private readonly toolMemoryTrace = signal<MemoryVm[]>([]);

  constructor() {
    void this.bootstrapWorkspace();
    this.syncCoordinatorState();
    void this.rebuildMemoryPanel();
    this.settingsSub = this.appSettings.settings$.subscribe(() => {
      this.llmAvailable.set(this.hasLlmConfigured());
    });
    this.syncTimer = window.setInterval(() => {
      this.syncCoordinatorState();
      void this.rebuildMemoryPanel();
    }, 500);
    this.memoryStatsTimer = window.setInterval(() => {
      if (this.activeTab() === 'Terminal - Main') void this.refreshShortTermMemoryStats();
    }, 20000);
    this.gitPollTimer = window.setInterval(() => {
      if (this.activeTab() === 'Terminal - Main') void this.refreshGitBranchOnly();
    }, 25000);
  }

  async ngAfterViewInit(): Promise<void> {
    this.initAiXterm();
    await this.initPowerShellTerminal();
    if (!this.psTerminal) {
      setTimeout(() => void this.initPowerShellTerminal(), 0);
    }
    queueMicrotask(() => this.setupTabOverflowObserver());
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer !== undefined) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
    this.pendingAutoSave = undefined;
    if (this.xtermBackspaceKeydown) {
      window.removeEventListener('keydown', this.xtermBackspaceKeydown, true);
      this.xtermBackspaceKeydown = undefined;
    }
    this.resizeObserver?.disconnect();
    this.xterm?.dispose();

    this.psResizeObserver?.disconnect();
    this.detachPsData?.();
    this.detachPsExit?.();
    for (const s of this.psSessions()) {
      void window.zytrader.terminal.kill({ id: s.id });
    }
    this.psTerminal?.dispose();

    this.settingsSub?.unsubscribe();
    if (this.syncTimer) window.clearInterval(this.syncTimer);
    if (this.memoryStatsTimer) window.clearInterval(this.memoryStatsTimer);
    if (this.gitPollTimer) window.clearInterval(this.gitPollTimer);
    this.teardownTabOverflowObserver();
  }

  private hasLlmConfigured(): boolean {
    const s = this.appSettings.value;
    return Boolean(s.apiKey?.trim() && s.model?.trim());
  }

  /** Monaco 语言 id（由当前标签页扩展名推断） */
  private monacoLangForExt(ext: string): string {
    const m: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      mts: 'typescript',
      cts: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      json: 'json',
      md: 'markdown',
      markdown: 'markdown',
      css: 'css',
      scss: 'scss',
      less: 'less',
      html: 'html',
      htm: 'html',
      vue: 'html',
      xml: 'xml',
      svg: 'xml',
      yml: 'yaml',
      yaml: 'yaml',
      py: 'python',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      ps1: 'powershell',
      psd1: 'powershell',
      psm1: 'powershell',
      rs: 'rust',
      go: 'go',
      java: 'java',
      cs: 'csharp',
      cpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      h: 'cpp',
      hpp: 'cpp',
    };
    return m[ext] ?? 'plaintext';
  }

  private persistTabState(tab: string): void {
    if (tab === 'Terminal - Main') return;
    const prev = this.tabEditorState.get(tab);
    this.tabEditorState.set(tab, {
      relPath: this.selectedPath(),
      content: this.selectedContent(),
      previewKind: this.previewKind(),
      dirty: this.editorDirty(),
      fsScope: prev?.fsScope ?? 'workspace',
    });
  }

  private restoreTabState(tab: string): void {
    const st = this.tabEditorState.get(tab);
    if (!st) return;
    this.selectedPath.set(st.relPath);
    if (st.previewKind === 'diff') {
      this.selectedFileTreeRoot.set(null);
    } else {
      this.selectedFileTreeRoot.set(st.fsScope === 'vault' ? 'vault' : 'workspace');
    }
    this.selectedContent.set(st.content);
    this.previewKind.set(st.previewKind);
    this.editorDirty.set(st.dirty);
  }

  private addTabIfMissing(label: string): void {
    const cur = this.tabs();
    if (!cur.includes(label)) {
      this.tabs.set([...cur, label]);
    }
  }

  protected displayTabLabel(tab: string): string {
    if (tab === 'Terminal - Main') return tab;
    let plain = tab.startsWith('↔ ') ? tab.slice(2).trim() : tab;
    if (/^(vault|workspace):/.test(plain)) {
      plain = plain.replace(/^(vault|workspace):/, '');
    }
    return plain.split('/').pop() ?? plain;
  }

  protected tabTooltip(tab: string): string {
    if (tab === 'Terminal - Main') return tab;
    if (tab.startsWith('↔ ')) return `Diff: ${tab.slice(2).trim()}`;
    if (/^vault:/.test(tab)) return `Vault: ${tab.slice('vault:'.length)}`;
    if (/^workspace:/.test(tab)) return `工程: ${tab.slice('workspace:'.length)}`;
    return tab;
  }

  private readonly tabOverflowOnScroll = (): void => {
    this.updateTabOverflow();
  };

  private setupTabOverflowObserver(): void {
    const host = this.tabScrollHost?.nativeElement;
    if (!host) return;
    this.teardownTabOverflowObserver();
    const run = (): void => this.updateTabOverflow();
    this.tabOverflowObserver = new ResizeObserver(run);
    this.tabOverflowObserver.observe(host);
    host.addEventListener('scroll', this.tabOverflowOnScroll, { passive: true });
    run();
  }

  private teardownTabOverflowObserver(): void {
    const host = this.tabScrollHost?.nativeElement;
    if (host) {
      host.removeEventListener('scroll', this.tabOverflowOnScroll);
    }
    this.tabOverflowObserver?.disconnect();
    this.tabOverflowObserver = undefined;
  }

  private updateTabOverflow(): void {
    const host = this.tabScrollHost?.nativeElement;
    if (!host) return;
    const labels = this.visibleTabs();
    const els = host.querySelectorAll<HTMLElement>('.editor-tab');
    const hL = host.scrollLeft;
    const hR = host.scrollLeft + host.clientWidth;
    const hidden: string[] = [];
    els.forEach((el, i) => {
      const tab = labels[i];
      if (!tab) return;
      const left = el.offsetLeft;
      const right = left + el.offsetWidth;
      if (right > hR + 2 || left < hL - 2) {
        hidden.push(tab);
      }
    });
    const hasOverflow = host.scrollWidth > host.clientWidth + 2;
    this.tabOverflowHiddenTabs.set(hidden);
    this.tabBarHasOverflow.set(hasOverflow);
    if (!hasOverflow) this.tabOverflowMenuOpen.set(false);
    this.cdr.markForCheck();
  }

  protected toggleTabOverflowMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.tabOverflowMenuOpen.update((v) => !v);
  }

  protected selectTabFromOverflowMenu(tab: string): void {
    this.setTab(tab);
    this.tabOverflowMenuOpen.set(false);
    queueMicrotask(() => {
      const host = this.tabScrollHost?.nativeElement;
      const els = host?.querySelectorAll<HTMLElement>('.editor-tab');
      const labels = this.visibleTabs();
      const idx = labels.indexOf(tab);
      if (els && idx >= 0 && els[idx]) {
        els[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.updateTabOverflow();
    });
  }

  protected onTabContextMenu(tab: string, event: MouseEvent): void {
    event.preventDefault();
    if (tab === 'Terminal - Main') return;
    this.tabContextMenu.set({ tab, x: event.clientX, y: event.clientY });
    this.cdr.markForCheck();
  }

  protected hideTabContextMenu(): void {
    if (this.tabContextMenu()) {
      this.tabContextMenu.set(null);
    }
    if (this.tabOverflowMenuOpen()) {
      this.tabOverflowMenuOpen.set(false);
    }
    this.cdr.markForCheck();
  }

  protected onEditorContentChange(text: string): void {
    this.selectedContent.set(text);
    this.editorDirty.set(true);
    const tab = this.activeTab();
    if (tab !== 'Terminal - Main') {
      const prev = this.tabEditorState.get(tab);
      if (prev) {
        this.tabEditorState.set(tab, { ...prev, content: text, dirty: true });
      }
    }
    const relPath = this.selectedPath().trim();
    const fsScope = this.tabEditorState.get(tab)?.fsScope ?? 'workspace';
    if (tab !== 'Terminal - Main' && this.previewKind() === 'code' && relPath) {
      this.pendingAutoSave = { tab, relPath, content: text, fsScope };
      if (this.autoSaveTimer !== undefined) {
        clearTimeout(this.autoSaveTimer);
      }
      this.autoSaveTimer = setTimeout(() => {
        const payload = this.pendingAutoSave;
        this.autoSaveTimer = undefined;
        this.pendingAutoSave = undefined;
        if (payload) void this.flushAutoSaveToDisk(payload);
      }, 720);
    }
    this.cdr.markForCheck();
  }

  /** 防抖落盘：默认「实时编译」由 Monaco TS/JS Worker 提供；此处保证磁盘与编辑器一致以便诊断与外部工具 */
  private async flushAutoSaveToDisk(payload: PendingAutoSave): Promise<void> {
    if (!payload.relPath) return;
    try {
      const r = await window.zytrader.fs.write(payload.relPath, payload.content, {
        scope: payload.fsScope,
      });
      if (!r.ok) return;
      const prev = this.tabEditorState.get(payload.tab);
      if (prev) {
        this.tabEditorState.set(payload.tab, { ...prev, content: payload.content, dirty: false });
        if (this.activeTab() === payload.tab) {
          this.selectedContent.set(payload.content);
          this.editorDirty.set(false);
        }
      }
    } finally {
      this.cdr.markForCheck();
    }
  }

  protected onEditorMarkersChange(rows: WorkbenchEditorDiagnosticRow[]): void {
    this.editorDiagnostics.set(rows);
    this.cdr.markForCheck();
  }

  protected async saveCurrentFile(): Promise<void> {
    const tab = this.activeTab();
    const relPath = this.selectedPath().trim();
    if (!relPath || tab === 'Terminal - Main' || this.previewKind() !== 'code') return;
    if (this.autoSaveTimer !== undefined) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
    this.pendingAutoSave = {
      tab,
      relPath,
      content: this.selectedContent(),
      fsScope: this.tabEditorState.get(tab)?.fsScope ?? 'workspace',
    };
    const payload = this.pendingAutoSave;
    this.pendingAutoSave = undefined;
    await this.flushAutoSaveToDisk(payload);
  }

  private syncCoordinatorState(): void {
    const state = this.runtime.coordinator.getState();
    this.coordinatorMode.set(state.mode);
    this.planSteps.set([...state.steps]);
    this.stepTotal.set(state.steps.length);
    this.stepDone.set(state.steps.filter((s: CoordinationStep) => s.status === 'completed').length);
    this.stepInProgress.set(state.steps.filter((s: CoordinationStep) => s.status === 'in_progress').length);
    this.stepPending.set(state.steps.filter((s: CoordinationStep) => s.status === 'pending').length);
  }

  /** 将历史消息与工具轨迹合并为右栏「捕获的记忆」 */
  private async rebuildMemoryPanel(): Promise<void> {
    try {
      const msgs: ChatMessage[] = await this.runtime.history.list(SESSION_ID);
      const fromHist: MemoryVm[] = msgs.slice(-18).map((m: ChatMessage) => {
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
      this.memoryGraph.syncFromMemoryVms(merged);
    } catch {
      const fallback = [...this.toolMemoryTrace()].sort((a, b) => b.at - a.at).slice(0, 28);
      this.memoryItems.set(fallback);
      this.memoryGraph.syncFromMemoryVms(fallback);
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
    if (steps.some((s: CoordinationStep) => s.status === 'in_progress')) return;
    const pending = steps.find((s: CoordinationStep) => s.status === 'pending');
    if (pending) this.runtime.coordinator.updateStep(pending.id, { status: 'in_progress' });
  }

  /** 工具成功返回：当前进行中步骤标为完成并启动下一步 */
  private bumpPlanOnToolDone(ok: boolean): void {
    if (!ok) return;
    const { steps } = this.runtime.coordinator.getState();
    const cur = steps.find((s: CoordinationStep) => s.status === 'in_progress');
    if (cur) {
      this.runtime.coordinator.updateStep(cur.id, { status: 'completed' });
      const next = this.runtime.coordinator.getState().steps.find((s: CoordinationStep) => s.status === 'pending');
      if (next) this.runtime.coordinator.updateStep(next.id, { status: 'in_progress' });
    }
  }

  private async bootstrapWorkspace(): Promise<void> {
    let info = await window.zytrader.workspace.info();
    if (!info.ok) return;

    this.workspaceRoot.set(info.root);
    this.vaultPathLabel.set(info.vaultRoot);
    this.vaultReady.set(info.vaultConfigured);

    if (!info.vaultConfigured) {
      const boot = await window.zytrader.vault.bootstrap();
      if (!boot.ok) {
        console.warn('[workbench] vault bootstrap failed', boot.error ?? boot);
      }
      info = await window.zytrader.workspace.info();
      if (info.ok) {
        this.vaultPathLabel.set(info.vaultRoot);
        this.vaultReady.set(info.vaultConfigured);
      }
    }

    this.initMemoryExplorerTree();
    this.workspaceTree.set([]);
    this.explorerRootView.set('project');
    await this.loadDir('.', undefined, 'workspace');
    await this.refreshShortTermMemoryStats();
    void this.refreshGitState();
  }

  private async refreshShortTermMemoryStats(): Promise<void> {
    try {
      const stats = await this.agentMemory.getShortTermStats();
      this.shortTermMemoryCount.set(stats.count);
      this.shortTermMemoryLatest.set(stats.latestUpdateTime);
    } catch {
      this.shortTermMemoryCount.set(0);
      this.shortTermMemoryLatest.set(null);
    }
  }

  protected formatVaultStatTime(iso: string | null): string {
    if (!iso) return '暂无';
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return '暂无';
    return t.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** 资源管理器：记忆目录（路径相对 memory/vault 根） */
  private initMemoryExplorerTree(): void {
    const nodes: FileNode[] = VAULT_EXPLORER_TOP.map(({ name, path }) => {
      const fixedChildren = VAULT_EXPLORER_FIXED_CHILDREN[path] ?? [];
      return {
        name,
        path,
        type: 'dir',
        expanded: false,
        loaded: fixedChildren.length > 0,
        children: fixedChildren.map((child) => ({
          name: child.name,
          path: child.path,
          type: 'dir',
          expanded: false,
          loaded: false,
          children: [],
          fsScope: 'vault' as const,
          treeRoot: 'vault' as const,
        })),
        fsScope: 'vault' as const,
        treeRoot: 'vault' as const,
      };
    });
    this.memoryTree.set(nodes);
  }

  /** 系统对话框选择工程目录并持久化 */
  protected async pickWorkspaceFolder(): Promise<void> {
    const r = await window.zytrader.workspace.pickRoot();
    if (!r.ok) return;
    await this.bootstrapWorkspace();
    this.cdr.markForCheck();
  }

  /** 顶部目录按钮：隐藏记忆目录，显示工程目录 */
  protected showProjectExplorer(): void {
    this.explorerRootView.set('project');
    if (this.workspaceTree().length === 0) {
      void this.loadDir('.', undefined, 'workspace');
    }
    this.cdr.markForCheck();
  }

  /** 顶部记忆按钮：隐藏工程目录，显示记忆目录 */
  protected showMemoryExplorer(): void {
    this.explorerRootView.set('memory');
    this.cdr.markForCheck();
  }

  protected setSidebarView(v: SidebarView): void {
    this.sidebarView.set(v);
    if (v === 'git') void this.refreshGitState();
    this.cdr.markForCheck();
  }

  private escapePsSingle(s: string): string {
    return s.replace(/'/g, "''");
  }

  /** Windows cmd：路径/分支名安全引用 */
  private quoteCmdArg(s: string): string {
    if (!/[ \t"&<>|]/.test(s)) return s;
    return `"${s.replace(/"/g, '\\"')}"`;
  }

  /** 仅刷新当前分支名（轻量）；兼容 detached HEAD、PowerShell/exec 差异 */
  private async refreshGitBranchOnly(): Promise<void> {
    const cwd = '.';
    const firstLine = (out: string) => (out ?? '').trim().split(/\r?\n/)[0]?.trim() ?? '';
    try {
      let line = firstLine(
        (await window.zytrader.terminal.exec('cmd.exe /c git branch --show-current 2>nul', cwd)).stdout ?? '',
      );
      if (!line) {
        line = firstLine(
          (await window.zytrader.terminal.exec('cmd.exe /c git rev-parse --abbrev-ref HEAD 2>nul', cwd)).stdout ?? '',
        );
      }
      if (line === 'HEAD') {
        const short = firstLine(
          (await window.zytrader.terminal.exec('cmd.exe /c git rev-parse --short HEAD 2>nul', cwd)).stdout ?? '',
        );
        line = short ? `HEAD（分离于 ${short}）` : 'HEAD';
      }
      if (!line) {
        const sb = (await window.zytrader.terminal.exec('cmd.exe /c git status -sb 2>nul', cwd)).stdout ?? '';
        const m = sb.match(/^##\s+([^\s.]+)/m);
        if (m?.[1]) line = m[1].trim();
      }
      this.gitBranch.set(line);
    } catch {
      /* ignore */
    }
  }

  /** 刷新分支、变更文件、时间线 */
  protected async refreshGitState(): Promise<void> {
    this.gitBusy.set(true);
    this.gitUiMessage.set('');
    try {
      await this.refreshGitBranchOnly();

      const br = await window.zytrader.terminal.exec('cmd.exe /c git branch -a --no-color 2>nul', '.');
      const refs: GitBranchRef[] = [];
      if (br.stdout) {
        type Row = { raw: string; short: string; isRemote: boolean };
        const rows: Row[] = [];
        for (const line of br.stdout.split(/\r?\n/)) {
          let t = line.trim();
          if (!t) continue;
          if (t.startsWith('*')) t = t.slice(1).trim();
          const isRemote = /^remotes\//.test(t);
          const short = t.replace(/^remotes\/[^/]+\//, '').trim();
          if (!short || short === 'HEAD') continue;
          rows.push({ raw: t, short, isRemote });
        }
        // 同一分支名只保留一条：本地优先于 remotes/origin/...，避免 feature/x 与 origin/feature/x 各一条
        rows.sort((a, b) => {
          if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
          return a.short.localeCompare(b.short, undefined, { sensitivity: 'base' });
        });
        const byShort = new Map<string, GitBranchRef>();
        for (const { raw, short } of rows) {
          if (byShort.has(short)) continue;
          byShort.set(short, { label: short, ref: raw });
        }
        refs.push(...byShort.values());
      }
      this.gitBranchRefs.set(refs.slice(0, 120));

      const por = await window.zytrader.terminal.exec('cmd.exe /c git status --porcelain=1 -u 2>nul', '.');
      const files: GitChangedFile[] = [];
      if (por.stdout) {
        for (const line of por.stdout.split(/\r?\n/)) {
          const raw = line.trim();
          if (!raw) continue;
          const status = raw.slice(0, 2).trim();
          const pathPart = raw.slice(3).trim();
          const path = pathPart.includes(' -> ') ? pathPart.split(' -> ').pop()?.trim() ?? pathPart : pathPart;
          if (path) files.push({ status: status || '?', path: path.replace(/\\/g, '/') });
        }
      }
      this.gitChangedFiles.set(files);

      const lg = await window.zytrader.terminal.exec(
        'cmd.exe /c git log -n 28 --pretty=format:"%h\t%s\t%an\t%ad" --date=short 2>nul',
        '.',
      );
      const commits: GitCommitLine[] = [];
      if (lg.stdout) {
        for (const line of lg.stdout.split(/\r?\n/)) {
          const p = line.split('\t');
          if (p.length >= 4) {
            commits.push({
              hash: p[0] ?? '',
              subject: p[1] ?? '',
              author: p[2] ?? '',
              date: p[3] ?? '',
            });
          }
        }
      }
      this.gitCommits.set(commits);
    } finally {
      this.gitBusy.set(false);
      this.cdr.markForCheck();
    }
  }

  protected toggleBranchMenu(): void {
    this.branchMenuOpen.update((v) => !v);
    if (this.branchMenuOpen()) void this.refreshGitState();
  }

  protected async checkoutBranch(ref: string): Promise<void> {
    const rname = ref.trim();
    if (!rname) return;
    this.gitBusy.set(true);
    this.gitUiMessage.set('');
    try {
      const arg = this.quoteCmdArg(rname);
      let r = await window.zytrader.terminal.exec(`cmd.exe /c git switch ${arg} 2>&1`, '.');
      let out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      if (!this.isGitCheckoutOk(r, out)) {
        r = await window.zytrader.terminal.exec(`cmd.exe /c git checkout ${arg} 2>&1`, '.');
        out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      }
      this.branchMenuOpen.set(false);
      if (this.isGitCheckoutOk(r, out)) {
        await this.refreshGitState();
      } else {
        this.gitUiMessage.set(out.trim().slice(0, 500) || '切换分支失败');
      }
    } finally {
      this.gitBusy.set(false);
      this.cdr.markForCheck();
    }
  }

  private isGitCheckoutOk(
    r: { ok: boolean; code: number; stdout?: string; stderr?: string },
    combined: string,
  ): boolean {
    if (r.ok && r.code === 0) return true;
    return /Switched to branch|Already on|Your branch is|branch.*set up to track|HEAD is now/i.test(combined);
  }

  /** 源代码管理：本地修改 diff */
  protected async openGitDiffFile(relPath: string): Promise<void> {
    const norm = relPath.replace(/\\/g, '/');
    this.gitBusy.set(true);
    try {
      this.persistTabState(this.activeTab());
      const arg = this.quoteCmdArg(norm);
      const r = await window.zytrader.terminal.exec(`cmd.exe /c git diff --no-color -- ${arg} 2>&1`, '.');
      let text = (r.stdout ?? '').trim();
      if (!text && /fatal|not a git repository/i.test(r.stderr ?? '')) {
        text = r.stderr ?? '无法生成 diff';
      }
      if (!text) {
        const w = await window.zytrader.terminal.exec(`cmd.exe /c git diff --no-color --cached -- ${arg} 2>&1`, '.');
        text = (w.stdout ?? '').trim() || '（无 diff：可能是未跟踪文件，或工作区与暂存区一致）';
      }
      const body = text.slice(0, 240000);
      this.previewKind.set('diff');
      this.selectedPath.set(norm);
      this.selectedFileTreeRoot.set(null);
      this.selectedContent.set(body);
      this.editorDirty.set(false);
      const tabLabel = `↔ ${norm}`;
      this.tabEditorState.set(tabLabel, {
        relPath: norm,
        content: body,
        previewKind: 'diff',
        dirty: false,
        fsScope: 'workspace',
      });
      const all = this.tabs();
      if (!all.includes(tabLabel)) {
        this.tabs.set([...all, tabLabel]);
      }
      this.activeTab.set(tabLabel);
      this.editorDiagnostics.set([]);
      queueMicrotask(() => {
        this.fitAddon?.fit();
        this.psFitAddon?.fit();
      });
    } finally {
      this.gitBusy.set(false);
      this.cdr.markForCheck();
    }
  }

  protected async openCommitDetail(hash: string): Promise<void> {
    const h = hash.trim();
    if (!h) return;
    this.gitBusy.set(true);
    try {
      const arg = this.quoteCmdArg(h);
      const r = await window.zytrader.terminal.exec(`cmd.exe /c git show --no-color --stat ${arg} 2>&1`, '.');
      const body = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      this.gitCommitDetailText.set(body || '（无输出）');
      this.gitCommitDetailOpen.set(true);
    } finally {
      this.gitBusy.set(false);
      this.cdr.markForCheck();
    }
  }

  protected closeCommitDetailModal(): void {
    this.gitCommitDetailOpen.set(false);
  }

  protected async runFileSearch(): Promise<void> {
    const q = this.searchQuery().trim();
    if (!q) {
      this.searchMessage.set('请输入要搜索的内容');
      this.cdr.markForCheck();
      return;
    }
    this.searchBusy.set(true);
    this.searchMessage.set('搜索中…');
    this.searchHits.set([]);
    try {
      const pattern = this.escapePsSingle(q);
      const r = await window.zytrader.terminal.exec(`git grep -n -I --regexp '${pattern}' -- . 2>&1`, '.');
      const err = (r.stderr ?? '').trim();
      if (err && /fatal|not a git repository/i.test(err)) {
        this.searchMessage.set(err.split(/\r?\n/)[0] ?? err);
        this.cdr.markForCheck();
        return;
      }
      const raw = (r.stdout ?? '').trim();
      const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
      const hits: SearchHit[] = [];
      for (const line of lines) {
        if (/^fatal:/i.test(line)) {
          this.searchMessage.set(line);
          this.cdr.markForCheck();
          return;
        }
        const hit = this.parseGitGrepLine(line);
        if (hit) hits.push(hit);
      }
      this.searchHits.set(hits);
      if (hits.length) {
        this.searchMessage.set(`共 ${hits.length} 条匹配`);
      } else if (!r.ok && r.code === 1) {
        this.searchMessage.set('无匹配（git grep 退出码 1）');
      } else {
        this.searchMessage.set('无匹配（未跟踪文件需先 git add，或换关键词）');
      }
    } finally {
      this.searchBusy.set(false);
      this.cdr.markForCheck();
    }
  }

  private parseGitGrepLine(line: string): SearchHit | null {
    const idx = line.indexOf(':');
    if (idx <= 0) return null;
    const rest = line.slice(idx + 1);
    const idx2 = rest.indexOf(':');
    if (idx2 <= 0) return null;
    const path = line.slice(0, idx).replace(/\\/g, '/');
    const lineNo = Number(rest.slice(0, idx2));
    const text = rest.slice(idx2 + 1);
    if (!path || !Number.isFinite(lineNo)) return null;
    return { path, line: lineNo, text };
  }

  protected async openSearchHit(hit: SearchHit): Promise<void> {
    await this.openFileByPath(hit.path);
  }

  private async openFileByPath(rel: string): Promise<void> {
    const norm = rel.replace(/\\/g, '/');
    const tabLabel = `workspace:${norm}`;
    this.persistTabState(this.activeTab());
    const result = await window.zytrader.fs.read(norm, { scope: 'workspace' });
    if (!result.ok) {
      this.previewKind.set('code');
      this.selectedPath.set(norm);
      this.selectedFileTreeRoot.set('workspace');
      this.selectedContent.set('无法读取该文件。');
      this.editorDirty.set(false);
      this.tabEditorState.set(tabLabel, {
        relPath: norm,
        content: '无法读取该文件。',
        previewKind: 'code',
        dirty: false,
        fsScope: 'workspace',
      });
      this.addTabIfMissing(tabLabel);
      this.activeTab.set(tabLabel);
      this.editorDiagnostics.set([]);
      this.sidebarView.set('explorer');
      queueMicrotask(() => {
        this.fitAddon?.fit();
        this.psFitAddon?.fit();
      });
      this.cdr.markForCheck();
      return;
    }
    const content = result.content.slice(0, 800_000);
    this.tabEditorState.set(tabLabel, { relPath: norm, content, previewKind: 'code', dirty: false, fsScope: 'workspace' });
    this.addTabIfMissing(tabLabel);
    this.setTab(tabLabel);
    this.editorDiagnostics.set([]);
    this.sidebarView.set('explorer');
    queueMicrotask(() => {
      this.fitAddon?.fit();
      this.psFitAddon?.fit();
    });
    this.cdr.markForCheck();
  }

  protected setTab(tab: string): void {
    const prev = this.activeTab();
    if (prev !== tab) {
      this.persistTabState(prev);
    }
    this.activeTab.set(tab);
    if (tab === 'Terminal - Main') {
      this.editorDiagnostics.set([]);
    } else {
      this.restoreTabState(tab);
    }
    queueMicrotask(() => {
      this.fitAddon?.fit();
      this.psFitAddon?.fit();
      if (tab === 'Terminal - Main') {
        this.focusAiTerminal();
        if (this.terminalMenuVisible()) this.focusPowerShellTerminal();
      }
    });
    this.cdr.markForCheck();
  }

  protected closeEditorTab(tab: string): void {
    if (tab === 'Terminal - Main') return;
    this.tabEditorState.delete(tab);
    const cur = this.tabs().filter((t) => t !== tab);
    this.tabs.set(cur);
    if (this.activeTab() === tab) {
      const fallback = cur.includes('Terminal - Main') ? 'Terminal - Main' : cur[0] ?? 'Terminal - Main';
      this.setTab(fallback);
    }
    this.hideTabContextMenu();
  }

  protected closeOtherTabs(tab: string): void {
    if (tab === 'Terminal - Main') return;
    const keep = ['Terminal - Main', tab];
    const removed = this.tabs().filter((t) => !keep.includes(t));
    removed.forEach((k) => this.tabEditorState.delete(k));
    this.tabs.set(this.tabs().filter((t) => keep.includes(t)));
    this.setTab(tab);
    this.hideTabContextMenu();
  }

  protected closeTabsToRight(tab: string): void {
    if (tab === 'Terminal - Main') return;
    const cur = this.tabs();
    const idx = cur.indexOf(tab);
    if (idx < 0) return;
    const right = cur.slice(idx + 1).filter((t) => t !== 'Terminal - Main');
    right.forEach((k) => this.tabEditorState.delete(k));
    const next = cur.filter((t, i) => i <= idx || t === 'Terminal - Main');
    this.tabs.set(next);
    this.hideTabContextMenu();
  }

  protected closeTabsToLeft(tab: string): void {
    if (tab === 'Terminal - Main') return;
    const cur = this.tabs();
    const idx = cur.indexOf(tab);
    if (idx < 0) return;
    const left = cur.slice(0, idx).filter((t) => t !== 'Terminal - Main');
    left.forEach((k) => this.tabEditorState.delete(k));
    const next = cur.filter((t, i) => i >= idx || t === 'Terminal - Main');
    this.tabs.set(next);
    this.hideTabContextMenu();
  }

  protected treeIcon(node: FileNode): string {
    if (this.isMemoryProjectEntry(node)) return 'folder-open';
    return node.type === 'dir' ? 'folder' : 'file-text';
  }

  protected isMemoryProjectEntry(node: FileNode): boolean {
    return node.fsScope === 'vault' && node.type === 'dir' && node.path === '03-PROJECTS';
  }

  protected onTreeNodeDblClick(node: FileNode, event: MouseEvent): void {
    if (!this.isMemoryProjectEntry(node)) return;
    event.preventDefault();
    event.stopPropagation();
    this.showProjectExplorer();
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

  protected toggleLeftPanel(): void {
    this.leftPanelVisible.update((v) => !v);
    queueMicrotask(() => {
      this.fitAddon?.fit();
      this.updateTabOverflow();
    });
  }

  protected onLeftResizeStart(event: MouseEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const start = this.leftPanelWidth();
    const move = (ev: MouseEvent) => {
      const next = Math.max(180, Math.min(520, start + (ev.clientX - startX)));
      this.leftPanelWidth.set(next);
      this.fitAddon?.fit();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  protected toggleTerminalMenu(): void {
    this.terminalMenuVisible.update((v) => !v);
    const show = this.terminalMenuVisible();
    const afterLayout = (): void => {
      this.fitAddon?.fit();
      this.psFitAddon?.fit();
      this.syncPowerShellSize();
      setTimeout(() => {
        this.psFitAddon?.fit();
        this.syncPowerShellSize();
      }, 80);
      if (show) {
        this.focusPowerShellTerminal();
      } else {
        this.focusAiTerminal();
      }
    };
    if (show) {
      // *ngIf 展开后再挂载 #psHost，需晚于本轮变更检测再初始化 PTY
      setTimeout(() => {
        void this.initPowerShellTerminal().finally(() => {
          afterLayout();
        });
      }, 0);
    } else {
      queueMicrotask(afterLayout);
    }
  }

  protected focusAiTerminal(): void {
    this.xterm?.focus();
  }

  protected focusPowerShellTerminal(): void {
    this.psTerminal?.focus();
  }

  protected onBottomResizeStart(event: MouseEvent): void {
    event.preventDefault();
    const startY = event.clientY;
    const start = this.bottomPanelHeight();
    const move = (ev: MouseEvent) => {
      const next = Math.max(120, Math.min(420, start - (ev.clientY - startY)));
      this.bottomPanelHeight.set(next);
      this.psFitAddon?.fit();
      this.syncPowerShellSize();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  protected toggleRightPanel(): void {
    this.rightPanelVisible.update((v) => !v);
    queueMicrotask(() => {
      this.fitAddon?.fit();
      this.updateTabOverflow();
    });
  }

  protected onRightResizeStart(event: MouseEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const start = this.rightPanelWidth();
    const move = (ev: MouseEvent) => {
      const next = Math.max(240, Math.min(560, start - (ev.clientX - startX)));
      this.rightPanelWidth.set(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
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

  private async triggerMemoryPipelineFromHistory(userPrompt: string): Promise<void> {
    const prompt = userPrompt.trim();
    if (!prompt) return;

    const now = Date.now();
    const msgs: ChatMessage[] = await this.runtime.history.list(SESSION_ID);
    const turn: TurnContext = {
      sessionId: SESSION_ID,
      turnId: `turn_${now}`,
      timestamp: now,
      messages: msgs.reduce<TurnContext['messages']>((acc: TurnContext['messages'], m: ChatMessage) => {
        if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') return acc;
        acc.push({
          id: m.id,
          role: m.role,
          content: String(m.content ?? ''),
          timestamp: m.timestamp,
        });
        return acc;
      }, []),
    };
    await this.agentMemory.runMemoryPipelineNow(turn);
    await this.refreshShortTermMemoryStats();
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
      if (value.usage) {
        const model = this.runtime.client.getModel().model;
        this.usageLedger.record(value.usage, model, Date.now() - this.streamRequestStartMs);
      }
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
    queueMicrotask(() => this.focusAiTerminal());

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
    void this.replayMainSessionHistory();
    this.writeMainTerminalPrompt();
  }

  private async replayMainSessionHistory(): Promise<void> {
    try {
      const msgs = await this.runtime.history.list(SESSION_ID);
      const recent = msgs.slice(-24);
      if (recent.length === 0) return;
      this.aiXtermWrite('\x1b[90m--- 已恢复最近会话 ---\x1b[0m\r\n');
      for (const m of recent) {
        const content = String(m.content ?? '').trim();
        if (!content) continue;
        if (m.role === 'user') {
          this.aiXtermWrite(`\x1b[32m>\x1b[0m ${content}\r\n`);
        } else if (m.role === 'assistant') {
          this.aiXtermWrite(`\x1b[35m[助手]\x1b[0m\r\n${content}\r\n`);
        } else if (m.role === 'tool') {
          this.aiXtermWrite(`\x1b[36m[工具]\x1b[0m ${content.replace(/\r?\n/g, ' ')}\r\n`);
        }
      }
      this.aiXtermWrite('\x1b[90m--- 恢复结束 ---\x1b[0m\r\n');
    } catch {
      // ignore history replay failures
    }
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

  protected async loadDir(path: string, parent?: FileNode, scope: 'workspace' | 'vault' = 'vault'): Promise<void> {
    const result = await window.zytrader.fs.list(path, { scope });
    if (!result.ok) return;

    if (scope === 'vault' && path === '02-AGENT-MEMORY/01-Short-Term') {
      this.shortTermMemoryCount.set(result.entries.filter((e) => e.type === 'file').length);
    }

    const treeRoot: 'vault' | 'workspace' = scope === 'workspace' ? 'workspace' : 'vault';
    const nodes: FileNode[] = result.entries
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      .map((entry) => ({
        name: entry.name,
        type: entry.type,
        path: path === '.' ? entry.name : `${path}/${entry.name}`,
        expanded: false,
        loaded: false,
        children: [],
        fsScope: scope,
        treeRoot,
      }));

    if (!parent) {
      if (treeRoot === 'workspace') {
        this.workspaceTree.set(nodes);
      } else {
        this.memoryTree.set(nodes);
      }
      return;
    }

    parent.children = nodes;
    parent.loaded = true;
    parent.expanded = true;
    if (parent.treeRoot === 'workspace') {
      this.workspaceTree.set([...this.workspaceTree()]);
    } else {
      this.memoryTree.set([...this.memoryTree()]);
    }
  }

  protected async toggleDir(node: FileNode): Promise<void> {
    if (node.type !== 'dir') return;
    if (!node.loaded) {
      await this.loadDir(node.path, node, node.fsScope ?? 'vault');
      return;
    }
    node.expanded = !node.expanded;
    if (node.treeRoot === 'workspace') {
      this.workspaceTree.set([...this.workspaceTree()]);
    } else {
      this.memoryTree.set([...this.memoryTree()]);
    }
  }

  protected async openFile(node: FileNode): Promise<void> {
    if (node.type !== 'file') return;
    const tr = node.treeRoot ?? 'vault';
    const tabLabel = `${tr}:${node.path}`;
    const scope = node.fsScope ?? 'vault';
    this.persistTabState(this.activeTab());
    const result = await window.zytrader.fs.read(node.path, { scope });
    if (!result.ok) {
      this.tabEditorState.set(tabLabel, {
        relPath: node.path,
        content: '无法读取该文件。',
        previewKind: 'code',
        dirty: false,
        fsScope: scope,
      });
      this.addTabIfMissing(tabLabel);
      this.setTab(tabLabel);
      this.editorDiagnostics.set([]);
      queueMicrotask(() => {
        this.fitAddon?.fit();
        this.psFitAddon?.fit();
      });
      this.cdr.markForCheck();
      return;
    }
    const content = result.content.slice(0, 800_000);
    this.tabEditorState.set(tabLabel, { relPath: node.path, content, previewKind: 'code', dirty: false, fsScope: scope });
    this.addTabIfMissing(tabLabel);
    this.setTab(tabLabel);
    this.editorDiagnostics.set([]);
    queueMicrotask(() => {
      this.fitAddon?.fit();
      this.psFitAddon?.fit();
    });
    this.cdr.markForCheck();
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
        plugins.forEach((p: { id: string; version: string }) => this.aiXtermWrite(` - ${p.id} :: v${p.version}\r\n`));
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
    this.streamRequestStartMs = Date.now();
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
        try {
          await this.triggerMemoryPipelineFromHistory(trimmed);
          const last = this.agentMemory.getPipelineStatus().lastResult;
          this.aiXtermWrite(
            `\x1b[90m[memory] pipeline=${last?.pipeline ?? 'unknown'} status=${last?.status ?? 'unknown'} reason=${last?.reason ?? 'none'}\x1b[0m\r\n`,
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'unknown_error';
          this.aiXtermWrite(`\x1b[31m[memory] pipeline 失败：${msg}\x1b[0m\r\n`);
        }
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

  private async initPowerShellTerminal(): Promise<void> {
    const host = this.psHost?.nativeElement;
    if (!host || this.psTerminal) return;

    this.psFitAddon = new FitAddon();
    this.psTerminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily:
        "'JetBrains Mono', 'Cascadia Mono', Consolas, 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', monospace",
      fontSize: 12,
      lineHeight: 1.35,
      theme: {
        background: '#080b14',
        foreground: '#dbe7ff',
        cursor: '#60a5fa',
        cursorAccent: '#080b14',
        selectionBackground: '#1f2937',
        black: '#0b1020',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e5e7eb',
        brightBlack: '#374151',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#ddd6fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      convertEol: true,
      allowProposedApi: false,
    });

    this.psTerminal.loadAddon(this.psFitAddon);
    this.psTerminal.open(host);
    this.psFitAddon.fit();
    queueMicrotask(() => this.focusPowerShellTerminal());

    this.psTerminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        const sel = this.psTerminal?.getSelection() ?? '';
        if (sel) void navigator.clipboard.writeText(sel);
        return false;
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
        event.preventDefault();
        const id = this.activePsSessionId();
        if (!id) return false;
        void navigator.clipboard.readText().then((t) => {
          if (t) void window.zytrader.terminal.write({ id, data: t });
        });
        return false;
      }
      return true;
    });

    this.detachPsData = window.zytrader.terminal.onData((payload) => {
      if (payload.id !== this.activePsSessionId()) return;
      this.psTerminal?.write(payload.data);
      this.psSessions.update((arr) =>
        arr.map((s) => (s.id === payload.id ? { ...s, output: (s.output + payload.data).slice(-24000) } : s)),
      );
    });

    this.detachPsExit = window.zytrader.terminal.onExit((payload) => {
      this.psSessions.update((arr) => arr.map((s) => (s.id === payload.id ? { ...s, exited: true } : s)));
      if (payload.id === this.activePsSessionId()) {
        this.psTerminal?.writeln(`\r\n\x1b[90m[terminal exited: ${payload.exitCode}]\x1b[0m`);
      }
    });

    this.psTerminal.onData((data) => {
      const id = this.activePsSessionId();
      if (!id) return;
      void window.zytrader.terminal.write({ id, data });
    });

    this.psResizeObserver = new ResizeObserver(() => {
      this.psFitAddon?.fit();
      this.syncPowerShellSize();
    });
    this.psResizeObserver.observe(host);

    await this.createPsSession('powershell');
  }

  private syncPowerShellSize(): void {
    const id = this.activePsSessionId();
    if (!id || !this.psTerminal) return;
    const cols = Math.max(20, this.psTerminal.cols);
    const rows = Math.max(4, this.psTerminal.rows);
    void window.zytrader.terminal.resize({ id, cols, rows });
  }

  protected async createPsSession(shell: 'powershell' | 'cmd' | 'git-bash' = 'powershell'): Promise<void> {
    if (!this.psTerminal) return;
    const preset = this.psCwdPresets.find((p) => p.id === this.activePsCwdPresetId()) ?? this.psCwdPresets[0];
    const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await window.zytrader.terminal.create({
      id,
      cwd: preset?.cwd ?? '.',
      cwdScope: preset?.cwdScope ?? 'vault',
      cols: this.psTerminal.cols,
      rows: this.psTerminal.rows,
      shell,
    });

    if (!created.ok || !created.id) {
      this.psTerminal.writeln(`\x1b[31m[终端启动失败]\x1b[0m ${created.error ?? 'unknown error'}`);
      return;
    }

    const title = shell === 'cmd' ? 'CMD' : shell === 'git-bash' ? 'Git Bash' : 'PowerShell';
    this.psSessions.update((arr) => [...arr, { id: created.id!, name: `${title} ${arr.length + 1}`, shell, output: '', exited: false }]);
    this.switchPsSession(created.id);
    this.schedulePowerShellPromptRefresh();
  }

  /** Windows PowerShell 在 PTY 中有时首屏不刷提示符，补一次尺寸同步与回车以触发 PSReadLine 绘制路径 */
  private schedulePowerShellPromptRefresh(): void {
    setTimeout(() => {
      this.syncPowerShellSize();
      this.psFitAddon?.fit();
    }, 120);
  }

  protected switchPsSession(id: string): void {
    this.activePsSessionId.set(id);
    const target = this.psSessions().find((s) => s.id === id);
    this.psTerminal?.clear();
    if (target?.output) this.psTerminal?.write(target.output);
    queueMicrotask(() => {
      this.psFitAddon?.fit();
      this.focusPowerShellTerminal();
    });
    this.syncPowerShellSize();
    setTimeout(() => {
      this.psFitAddon?.fit();
      this.syncPowerShellSize();
    }, 80);
  }

  protected setPsCwdPreset(id: PsCwdPresetId): void {
    this.activePsCwdPresetId.set(id);
  }

  protected async closePsSession(id: string): Promise<void> {
    await window.zytrader.terminal.kill({ id });
    const left = this.psSessions().filter((s) => s.id !== id);
    this.psSessions.set(left);
    if (this.activePsSessionId() === id) {
      const next = left[0]?.id ?? '';
      this.activePsSessionId.set(next);
      this.psTerminal?.clear();
      if (next) {
        const target = left.find((s) => s.id === next);
        if (target?.output) this.psTerminal?.write(target.output);
      }
    }
  }

  protected runAutomation(kind: 'commit' | 'run' | 'build'): void {
    if (kind === 'commit') {
      if (this.activeTab() !== 'Terminal - Main') {
        this.setTab('Terminal - Main');
      }
      setTimeout(() => void this.runAutoCommitInMainTerminal(), 0);
      return;
    }
    const id = this.activePsSessionId();
    if (!id) return;
    const cmd = kind === 'run' ? 'npm run start\r' : 'npm run build\r';
    void window.zytrader.terminal.write({ id, data: cmd });
  }

  /** 在主终端写入提示词并走助手流（生成提交说明并推送远程） */
  private async runAutoCommitInMainTerminal(): Promise<void> {
    this.focusAiTerminal();
    const line = AUTO_COMMIT_PROMPT;
    if (this.terminalBusy()) {
      this.aiXtermWrite('\x1b[33m(busy)\x1b[0m\r\n');
      this.writeMainTerminalPrompt();
      this.redrawInputLine();
      return;
    }
    this.mainLineBuffer = '';
    this.clearSlashHintRow();
    this.directiveTabCycle = 0;
    this.aiXtermWrite(`\r\n\x1b[32m>\x1b[0m ${line}\r\n`);
    await this.dispatchMainTerminalLine(line);
  }

  private aiXtermWrite(text: string): void {
    this.xterm?.write(text.replaceAll('\n', '\r\n'));
  }
}
