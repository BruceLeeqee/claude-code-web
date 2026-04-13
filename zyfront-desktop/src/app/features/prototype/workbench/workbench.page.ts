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
import { DirectoryManagerService } from '../../../core/directory-manager.service';
import { REQUEST_CFG_JSON_KEY } from '../../../core/runtime-settings-sync.service';
import { ModelUsageLedgerService } from '../../../core/model-usage-ledger.service';
import { AgentMemoryService } from '../../../core/agent-memory.service';
import { SkillIndexService, type SkillRecord } from '../../../core/skill-index.service';
import { Terminal, type IDisposable, type IMarker } from 'xterm';
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

/**
 * Electron 下附加给模型的系统提示：工具能力与「参考映射」均为决策提示，不由客户端代执行意图解析。
 * 复杂说法（如「打开我做 PPT 常用的工具」）须由模型结合上下文决定 URL 或是否调用 web.search。
 */
const WORKBENCH_ELECTRON_TOOLS_SYSTEM_PROMPT = `【运行环境】ZyTrader 桌面客户端（Electron），已挂载本地工具（含 host.launch_app、computer.use、host.open_path、terminal.exec、powershell.exec、web.search、web.fetch 等）。

【职责划分】
- 意图理解、歧义消解、个性化指代由你完成；客户端不做自然语言规则代执行。
- computer.use：仅用于在受控窗口内打开 **网页 URL**（https）。不是「启动本机安装的浏览器程序」。
- **启动本机 Chrome / Edge 应用程序**：优先调用工具 **host.launch_app**，传入 JSON 且字段 app 为字符串 chrome 或 edge（见工具 schema；由主进程 detach 启动，确保窗口出现在用户桌面）。不要仅依赖 terminal.exec / powershell.exec 的 Start-Process（历史上曾出现「工具显示成功但未见窗口」）。
- 若 host.launch_app 不可用或非 Windows，再尝试 host.open_path 指向 chrome.exe，或 powershell.exec。
- host.open_path：http(s) URL、文件/文件夹、或上述 exe 路径。
- 需要检索信息时用 web.search / web.fetch。

【参考（打开网页时）】百度→https://www.baidu.com/ | 谷歌网站→https://www.google.com/ — 与「启动 Chrome 应用程序」不同，请勿混淆。

【工具结果一致性】当工具返回 JSON 中 ok 为 true 时，该步已在客户端成功执行；你必须向用户如实确认成功，不得再声称「工具不可用」「环境无浏览器控制」等，除非后续工具返回 ok 为 false。

【诚实性】仅当工具返回 ok 为 false 时如实转述 error。`;

const SESSION_ID = 'workbench-terminal-ai';
const MAX_AUTO_HIT_SKILLS_PER_TURN = 3;
/** 技能检测横幅里最多展示几条逐技能诊断，避免已安装技能多时刷屏 */
const MAX_SKILL_DIAGNOSTIC_LINES_IN_BANNER = 8;

/** 主终端各轮 [Thinking#N] 折叠块元数据（与 SESSION_ID 绑定，供多轮对话后仍可 Ctrl+O） */
const WORKBENCH_THINKING_BLOCKS_SESSION_KEY = `zyfront-workbench-thinking-blocks:v1:${SESSION_ID}`;

/** 资源管理器：AGENT-ROOT 标准顶层目录（顺序固定） */
const VAULT_EXPLORER_TOP = [
  { name: '00-HUMAN-TEMP', path: '00-HUMAN-TEMP' },
  { name: '01-HUMAN-NOTES', path: '01-HUMAN-NOTES' },
  { name: '02-AGENT-MEMORY', path: '02-AGENT-MEMORY' },
  { name: '03-AGENT-TOOLS', path: '03-AGENT-TOOLS' },
  { name: '04-PROJECTS', path: '04-PROJECTS' },
  { name: '05-RESOURCES', path: '05-RESOURCES' },
  { name: '06-SYSTEM', path: '06-SYSTEM' },
] as const;

/**
 * 工程根与 Vault 根相同时，从「工程目录」树隐藏的库层文件夹（与 Vault 根下自动生成的 Cursor files.exclude 一致）。
 * 保留 04-PROJECTS 作为唯一工程根；记忆与其它库请用「记忆目录」视图。
 */
const WORKSPACE_AT_VAULT_HIDDEN_DIRS = new Set([
  '00-HUMAN-TEMP',
  '01-HUMAN-NOTES',
  '02-AGENT-MEMORY',
  '03-AGENT-TOOLS',
  '03-PROJECTS',
  '04-RESOURCES',
  '05-RESOURCES',
  '05-SYSTEM',
  '06-SYSTEM',
]);

const VAULT_EXPLORER_FIXED_CHILDREN: Record<string, Array<{ name: string; path: string }>> = {
  '00-HUMAN-TEMP': [
    { name: 'human', path: '00-HUMAN-TEMP/human' },
    { name: 'agent', path: '00-HUMAN-TEMP/agent' },
  ],
  '01-HUMAN-NOTES': [
    { name: '01-Daily', path: '01-HUMAN-NOTES/01-Daily' },
    { name: '02-Knowledge', path: '01-HUMAN-NOTES/02-Knowledge' },
    { name: '03-Notes', path: '01-HUMAN-NOTES/03-Notes' },
    { name: '04-Tags', path: '01-HUMAN-NOTES/04-Tags' },
  ],
  '02-AGENT-MEMORY': [
    { name: '01-Short-Term', path: '02-AGENT-MEMORY/01-Short-Term' },
    { name: '02-Long-User', path: '02-AGENT-MEMORY/02-Long-User' },
    { name: '03-Long-Feedback', path: '02-AGENT-MEMORY/03-Long-Feedback' },
    { name: '04-Long-Projects', path: '02-AGENT-MEMORY/04-Long-Projects' },
    { name: '05-Long-Reference', path: '02-AGENT-MEMORY/05-Long-Reference' },
    { name: '06-Context', path: '02-AGENT-MEMORY/06-Context' },
    { name: '07-Meta', path: '02-AGENT-MEMORY/07-Meta' },
  ],
  '03-AGENT-TOOLS': [
    { name: '01-Skills', path: '03-AGENT-TOOLS/01-Skills' },
    { name: '02-Plugins', path: '03-AGENT-TOOLS/02-Plugins' },
  ],
  '05-RESOURCES': [
    { name: 'images', path: '05-RESOURCES/images' },
    { name: 'files', path: '05-RESOURCES/files' },
    { name: 'media', path: '05-RESOURCES/media' },
    { name: 'templates', path: '05-RESOURCES/templates' },
  ],
};
/** 最近会话写入 localStorage；v2 含 transcript 便于完整回放 */

/** 历史中的 user 正文常含技能注入补丁；回放时只保留真人输入段 */
function stripUserContentForHistoryReplay(content: string): string {
  const t = String(content ?? '');
  const m = t.match(/\n【(?:已命中技能|技能强制命中)/);
  if (m && m.index !== undefined && m.index > 0) return t.slice(0, m.index).trim();
  const m2 = t.indexOf('\n\n【技能强制命中】');
  if (m2 > 0) return t.slice(0, m2).trim();
  return t.trim();
}

/** 历史回放 / 落盘 transcript：从助手正文中去掉思考、工具步骤痕迹，与主终端折叠态一致 */
function stripAssistantContentForHistoryReplay(content: string): string {
  let t = String(content ?? '');
  t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  t = t.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '');
  t = t.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  t = t.replace(/```(?:thinking|reasoning|analysis)[\s\S]*?```/gi, '');
  // 与主终端 [回答] 头重复时去掉，回放已用 [助手] 前缀
  t = t.replace(/^\[回答\]\s*/m, '');
  const lines = t.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (/^\[用户\]\s*[（(]?工具结果/.test(s)) continue;
    if (/^[（(]工具结果[）)]\s*$/.test(s)) continue;
    if (/^工具结果\s*[:：]/.test(s)) continue;
    if (/^\*\*Step\s*\d+/i.test(s)) continue;
    kept.push(line);
  }
  t = kept.join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

interface RecentTranscriptLine {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  at?: number;
}

interface RecentContextSnapshot {
  mode: CoordinationMode;
  stepTotal: number;
  stepDone: number;
  stepInProgress: number;
  stepPending: number;
  toolCallCount: number;
  sessionCostUsd: number;
  capturedAt: number;
}

interface RecentTurn {
  id: string;
  title: string;
  prompt: string;
  at: number;
  /** 该会话完整消息序列（点击「最近会话」时按序回放） */
  transcript?: RecentTranscriptLine[];
  /** transcript 详情文件路径（vault 相对路径） */
  transcriptPath?: string;
  /** Agent 到当前时刻的上下文状态快照 */
  contextSnapshot?: RecentContextSnapshot;
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
  private readonly directoryManager = inject(DirectoryManagerService);
  private readonly skillIndex = inject(SkillIndexService);
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
  /** 是否已检测到 06-SYSTEM / 05-SYSTEM（或已完成 bootstrap） */
  protected readonly vaultReady = signal(false);
  /** 工程根与 Vault 根是否为同一路径（此时工程树隐藏记忆库顶层目录） */
  protected readonly workspaceRootEqualsVaultRoot = signal(false);
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
  protected readonly visibleDirectives = computed(() => this.directives);

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

  protected readonly recentTurns = signal<RecentTurn[]>([]);
  protected readonly expandedRecentTurnId = signal<string | null>(null);
  protected readonly recentThinkingVisibleIds = signal<string[]>([]);
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
    { id: 'inbox-human' as const, label: '00-HUMAN-TEMP/human', cwd: '00-HUMAN-TEMP/human', cwdScope: 'vault' as const },
    {
      id: 'agent-short-term' as const,
      label: '02-AGENT-MEMORY/01-Short-Term',
      cwd: '02-AGENT-MEMORY/01-Short-Term',
      cwdScope: 'vault' as const,
    },
    { id: 'projects' as const, label: '04-PROJECTS', cwd: '04-PROJECTS', cwdScope: 'vault' as const },
  ];
  protected readonly activePsCwdPresetId = signal<PsCwdPresetId>('vault-root');
  /** ??? Backspace?????????? xterm/?? IME ? onData ????? */
  private xtermBackspaceKeydown?: (e: Event) => void;
  private aiXtermContextMenu?: (e: Event) => void;
  private psXtermContextMenu?: (e: Event) => void;
  /** ? onData ? \\b ????????? */
  private backspaceHandledTs = 0;

  private mainLineBuffer = '';
  private mainEscSkip = false;
  private mainEscAcc = '';
  /** 输入历史游标（ArrowUp/ArrowDown） */
  private historyNavIndex: number | null = null;
  /** 输入 / 指令时：下一行显示同前缀补全，避免刷屏 */
  private slashHintRowActive = false;

  /** 流式对话取消（与 zyfront-core assistant.stream 的 cancel 对应） */
  private streamStop?: () => void;
  private streamReader: ReadableStreamDefaultReader<StreamChunk> | null = null;
  private streamInterruptRequested = false;
  /** 当前轮 thinking 实时输出状态（仅展示，不入命令行输入缓冲） */
  private thinkingHeaderShown = false;
  private answerHeaderShown = false;
  private thinkingBuffer = '';
  private thinkingPrintedLen = 0;
  private thinkingHasNonChinese = false;
  /** 本轮流式输出占用的物理行数（用于结束后折叠 Thinking 区） */
  private streamConsumedLines = 0;
  /** 本轮助手回答纯文本（用于折叠后重绘） */
  private roundAnswerAccumulator = '';
  /** 本轮主终端中回显的 Tool 行（顺序与流式一致，折叠时一并擦写） */
  private streamToolEchoes: string[] = [];
  /**
   * 当前流式轮次已分配的 [Thinking#N] 编号（首段 thinking/delta 写入前确定，finalize 与此对齐）。
   * 避免终端只出现无编号的 `[Thinking]` 导致 Ctrl+O 无法识别。
   */
  private streamingThinkingBlockId: number | null = null;
  /**
   * 在首个 tool_call 之前，将普通 `delta` 当作思考流写入（解决网关把推理混在 text_delta 里、被标成 [Answer] 的问题）。
   */
  private streamRouteDeltaToThinking = false;
  /** 本轮命中的技能标签（用于在 [用户] 行尾高亮展示） */
  private currentTurnHitSkillLabel: string | null = null;
  /** 本轮 [Skill] 展示行（在 finalize 中插入到 [用户] 下方） */
  private currentTurnSkillLines: string[] = [];
  /** 本轮技能检测横幅是否已写入主终端（避免 finalize 再次插入重复行） */
  private currentTurnSkillEchoedToXterm = false;
  /**
   * 本轮流式写入主终端前一刻的 buffer 行锚点（用于 finalize 擦除行数，避免 streamConsumedLines 与真实换行不一致时
   * CUU 过大把用户提示与历史回答一并清掉）。
   */
  private assistantStreamOutputStartMarker?: IMarker;
  /** 折叠态 Thinking 块编号 → 原文与折叠尾（供行内替换展开/收起） */
  private nextThinkingBlockId = 1;
  private thinkingBlocksById = new Map<
    number,
    {
      text: string;
      hasNonChinese: boolean;
      foldSuffixAnsi: string;
      hintPhysicalRows: number;
      tagEndCol0: number;
    }
  >();
  /** 折叠行写入后注册的 buffer 标记（保留给潜在装饰层/兼容；主路径为行内缓冲区替换） */
  private thinkingBlockMarkers: { id: number; marker: IMarker }[] = [];
  private thinkingAllExpanded = false;
  private thinkingAllExpandDisposables: IDisposable[] = [];
  /** Ctrl+O 单块展开的装饰订阅（兼容路径） */
  private expandedSingleById = new Map<number, IDisposable[]>();
  /** 当前为「行内替换」展开态的 Thinking 块 id */
  private thinkingInlineExpandedIds = new Set<number>();
  /** 行内展开后在 buffer 中占据范围与插入行数（用于二次 Ctrl+O 精确收起） */
  private thinkingInlineExpandedRanges = new Map<number, { first: number; last: number; insertedRows: number }>();
  /** 最近一轮（当前对话）产生的 thinking 块 id（Ctrl+Shift+O 展开后优先选中这一轮） */
  private latestTurnThinkingIds: number[] = [];
  /** 当前可用的已安装技能快照（自动注册/自动使用） */
  private installedSkillsCache: SkillRecord[] = [];
  private detachSkillRootWatcher?: () => void;
  /** 递增以取消尚未完成的「延迟挂装饰」动画帧回调 */
  private thinkingOverlayAttachGen = 0;
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
  private recentTurnsMemoryPath?: string;
  private recentTurnsIndexPath?: string;
  /** 工具调用轨迹，与历史消息合并为右栏「记忆」 */
  private readonly toolMemoryTrace = signal<MemoryVm[]>([]);

  constructor() {
    void this.bootstrapWorkspace();
    this.syncCoordinatorState();
    void this.rebuildMemoryPanel();
    void this.hydrateRecentTurnsFromMemory();
    void this.reloadInstalledSkills();
    this.detachSkillRootWatcher = this.skillIndex.watchVaultSkillRoot(() => {
      void this.reloadInstalledSkills();
    });
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
    if (this.aiXtermContextMenu && this.xtermHost?.nativeElement) {
      this.xtermHost.nativeElement.removeEventListener('contextmenu', this.aiXtermContextMenu);
      this.aiXtermContextMenu = undefined;
    }

    this.resizeObserver?.disconnect();
    this.disposeAllThinkingOverlays();
    this.xterm?.dispose();

    this.psResizeObserver?.disconnect();
    this.detachPsData?.();
    this.detachPsExit?.();
    if (this.psXtermContextMenu && this.psHost?.nativeElement) {
      this.psHost.nativeElement.removeEventListener('contextmenu', this.psXtermContextMenu);
      this.psXtermContextMenu = undefined;
    }
    for (const s of this.psSessions()) {
      void window.zytrader.terminal.kill({ id: s.id });
    }
    this.psTerminal?.dispose();

    this.settingsSub?.unsubscribe();
    this.detachSkillRootWatcher?.();
    this.detachSkillRootWatcher = undefined;
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
    const sameRoot =
      Boolean(info.root && info.vaultRoot) &&
      info.root.replace(/\\/g, '/').toLowerCase() === info.vaultRoot.replace(/\\/g, '/').toLowerCase();
    this.workspaceRootEqualsVaultRoot.set(sameRoot);

    if (!info.vaultConfigured) {
      const boot = await window.zytrader.vault.bootstrap();
      if (!boot.ok) {
        console.warn('[workbench] vault bootstrap failed', boot.error ?? boot);
      }
      info = await window.zytrader.workspace.info();
      if (info.ok) {
        this.vaultPathLabel.set(info.vaultRoot);
        this.vaultReady.set(info.vaultConfigured);
        const same =
          Boolean(info.root && info.vaultRoot) &&
          info.root.replace(/\\/g, '/').toLowerCase() === info.vaultRoot.replace(/\\/g, '/').toLowerCase();
        this.workspaceRootEqualsVaultRoot.set(same);
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
    return node.fsScope === 'vault' && node.type === 'dir' && node.path === '04-PROJECTS';
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

  protected async replayRecent(r: RecentTurn): Promise<void> {
    if (this.terminalBusy()) return;
    const loaded = await this.ensureRecentTurnTranscriptLoaded(r.id);
    const turn = loaded ?? r;
    this.clearSlashHintRow();
    this.mainLineBuffer = '';
    this.mainEscSkip = false;
    this.mainEscAcc = '';
    this.directiveTabCycle = 0;
    this.xterm?.clear();

    let rows: RecentTranscriptLine[] =
      turn.transcript && turn.transcript.length > 0
        ? [...turn.transcript]
        : [{ role: 'user' as const, content: turn.prompt }];
    if (turn.prompt.trim() && !rows.some((x) => x.role === 'user')) {
      rows = [{ role: 'user' as const, content: turn.prompt.trim() }, ...rows];
    }

    const showThinking = this.isRecentThinkingVisible(turn.id);
    for (const row of rows) {
      const raw = typeof row.content === 'string' ? row.content : '';
      const text = raw.replace(/\r\n/g, '\n').trim();
      if (!text) continue;

      if (row.role === 'user') {
        const display = stripUserContentForHistoryReplay(text) || turn.prompt.trim();
        if (!display) continue;
        this.aiXtermWrite(`\x1b[32m>\x1b[0m ${display.replaceAll('\n', '\r\n')}\r\n`);
        continue;
      }
      if (row.role === 'assistant') {
        const cleaned = showThinking ? text : stripAssistantContentForHistoryReplay(text);
        if (!cleaned) continue;
        this.aiXtermWrite(`\r\n\x1b[35m[助手]\x1b[0m\r\n`);
        this.aiXtermWrite(`${cleaned.replaceAll('\n', '\r\n')}\r\n`);
        continue;
      }
      if (row.role === 'tool') {
        this.aiXtermWrite(`\x1b[36m[步骤]\x1b[0m ${text.replaceAll('\n', ' ')}\r\n`);
      }
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

  private normalizeRecentTurns(parsed: unknown): RecentTurn[] {
    try {
      if (!Array.isArray(parsed)) return [];
      return parsed
        .slice(0, 30)
        .map((x: any, idx) => {
          const transcript: RecentTranscriptLine[] | undefined = Array.isArray(x.transcript)
            ? x.transcript
                .map((row: any) => ({
                  role: row?.role === 'user' || row?.role === 'assistant' || row?.role === 'tool' ? row.role : 'assistant',
                  content: typeof row?.content === 'string' ? row.content : '',
                  at: typeof row?.at === 'number' ? row.at : undefined,
                }))
                .filter((row: { content: string }) => row.content.trim().length > 0)
            : undefined;
          const firstUserLine =
            transcript?.find((row: RecentTranscriptLine) => row.role === 'user')?.content?.replace(/\s+/g, ' ').trim() ??
            (typeof x.prompt === 'string' ? x.prompt.replace(/\s+/g, ' ').trim() : '');
          const fallbackTitle = firstUserLine || `会话 ${idx + 1}`;
          const normalizedTitle =
            typeof x.title === 'string' && x.title.trim()
              ? x.title.trim()
              : fallbackTitle.length > 56
                ? `${fallbackTitle.slice(0, 53)}…`
                : fallbackTitle;
          const normalizedPrompt = typeof x.prompt === 'string' && x.prompt.trim() ? x.prompt.trim() : firstUserLine;
          return {
            id: typeof x.id === 'string' && x.id.trim() ? x.id : `${Date.now()}-${idx}`,
            title: normalizedTitle,
            prompt: normalizedPrompt,
            at: typeof x.at === 'number' && x.at > 0 ? x.at : Date.now(),
            transcript,
            transcriptPath: typeof x.transcriptPath === 'string' && x.transcriptPath.trim() ? x.transcriptPath : undefined,
            contextSnapshot:
              x.contextSnapshot && typeof x.contextSnapshot === 'object'
                ? {
                    mode: isCoordinationMode(x.contextSnapshot.mode) ? x.contextSnapshot.mode : 'single',
                    stepTotal: Number(x.contextSnapshot.stepTotal ?? 0) || 0,
                    stepDone: Number(x.contextSnapshot.stepDone ?? 0) || 0,
                    stepInProgress: Number(x.contextSnapshot.stepInProgress ?? 0) || 0,
                    stepPending: Number(x.contextSnapshot.stepPending ?? 0) || 0,
                    toolCallCount: Number(x.contextSnapshot.toolCallCount ?? 0) || 0,
                    sessionCostUsd: Number(x.contextSnapshot.sessionCostUsd ?? 0) || 0,
                    capturedAt: Number(x.contextSnapshot.capturedAt ?? x.at ?? Date.now()) || Date.now(),
                  }
                : undefined,
          };
        })
        .filter((row) => Boolean(row.title.trim() || row.prompt.trim() || row.transcript?.length));
    } catch {
      return [];
    }
  }

  private async resolveRecentTurnsMemoryPath(): Promise<string> {
    if (this.recentTurnsMemoryPath) return this.recentTurnsMemoryPath;
    await this.directoryManager.ensureVaultReady();
    const relDir = await this.directoryManager.getRelativePathByKey('agent-context');
    const relPath = `${relDir}/sessions/${SESSION_ID}.recent-index.json`;
    this.recentTurnsMemoryPath = relPath;
    return relPath;
  }

  private async resolveRecentTurnsIndexPath(): Promise<string> {
    if (this.recentTurnsIndexPath) return this.recentTurnsIndexPath;
    const relPath = await this.resolveRecentTurnsMemoryPath();
    this.recentTurnsIndexPath = relPath;
    return relPath;
  }

  private async hydrateRecentTurnsFromMemory(): Promise<void> {
    try {
      const relPath = await this.resolveRecentTurnsIndexPath();
      const read = await window.zytrader.fs.read(relPath, { scope: 'vault' });
      if (!read.ok) {
        this.recentTurns.set([]);
        return;
      }
      const parsed = JSON.parse(read.content);
      this.recentTurns.set(this.normalizeRecentTurns(parsed));
    } catch {
      this.recentTurns.set([]);
    }
  }

  private async persistRecentTurns(list: RecentTurn[]): Promise<void> {
    try {
      const relPath = await this.resolveRecentTurnsIndexPath();
      const indexList = list.slice(0, 30).map((x) => ({
        id: x.id,
        title: x.title,
        prompt: x.prompt,
        at: x.at,
        transcriptPath: x.transcriptPath,
        contextSnapshot: x.contextSnapshot,
      }));
      await window.zytrader.fs.write(relPath, JSON.stringify(indexList, null, 2), { scope: 'vault' });
    } catch {
      /* ignore persistence failures */
    }
  }

  private async persistRecentTurnTranscript(turn: RecentTurn): Promise<string | undefined> {
    try {
      await this.directoryManager.ensureVaultReady();
      const relDir = await this.directoryManager.getRelativePathByKey('agent-context');
      const stamp = new Date(turn.at).toISOString().replace(/[:.]/g, '-');
      const relPath = `${relDir}/sessions/${SESSION_ID}.recent.${stamp}.${turn.id}.json`;
      const payload = {
        id: turn.id,
        at: turn.at,
        transcript: turn.transcript ?? [],
      };
      const write = await window.zytrader.fs.write(relPath, JSON.stringify(payload, null, 2), { scope: 'vault' });
      return write.ok ? relPath : undefined;
    } catch {
      return undefined;
    }
  }

  private async ensureRecentTurnTranscriptLoaded(id: string): Promise<RecentTurn | undefined> {
    const list = this.recentTurns();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return undefined;
    const cur = list[idx]!;
    if (cur.transcript && cur.transcript.length > 0) return cur;
    if (!cur.transcriptPath) return cur;
    try {
      const read = await window.zytrader.fs.read(cur.transcriptPath, { scope: 'vault' });
      if (!read.ok) return cur;
      const parsed = JSON.parse(read.content) as { transcript?: unknown };
      const transcript = Array.isArray(parsed?.transcript)
        ? (parsed.transcript as any[])
            .map((row: any) => ({
              role: row?.role === 'user' || row?.role === 'assistant' || row?.role === 'tool' ? row.role : 'assistant',
              content: typeof row?.content === 'string' ? row.content : '',
              at: typeof row?.at === 'number' ? row.at : undefined,
            }))
            .filter((row: { content: string }) => row.content.trim().length > 0)
        : [];
      const next = [...list];
      next[idx] = { ...cur, transcript };
      this.recentTurns.set(next);
      return next[idx];
    } catch {
      return cur;
    }
  }

  /** 助手回复成功后：写入最近会话（保存该 Agent 从启动到当前时刻的全量历史快照） */
  private async appendRecentTurnAfterSuccess(userPrompt: string): Promise<void> {
    const trimmed = userPrompt.trim();
    if (!trimmed) return;

    let transcript: RecentTranscriptLine[] = [];
    try {
      const msgs = await this.runtime.history.list(SESSION_ID);
      transcript = msgs
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'tool',
          content: typeof m.content === 'string' ? m.content : '',
          at: m.timestamp,
        }))
        .filter((m) => m.content.trim().length > 0);
    } catch {
      /* ignore and use fallback */
    }
    if (transcript.length === 0) {
      transcript = [{ role: 'user', content: trimmed, at: Date.now() }];
    }

    const title = trimmed.length > 56 ? `${trimmed.slice(0, 53)}…` : trimmed;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const entry: RecentTurn = {
      id,
      title,
      prompt: trimmed,
      at: Date.now(),
      transcript,
      contextSnapshot: {
        mode: this.coordinatorMode(),
        stepTotal: this.stepTotal(),
        stepDone: this.stepDone(),
        stepInProgress: this.stepInProgress(),
        stepPending: this.stepPending(),
        toolCallCount: this.toolCallCount(),
        sessionCostUsd: this.sessionCostUsd(),
        capturedAt: Date.now(),
      },
    };
    entry.transcriptPath = await this.persistRecentTurnTranscript(entry);
    const next = [entry, ...this.recentTurns()].slice(0, 30);
    this.recentTurns.set(next);
    await this.persistRecentTurns(next);
  }

  protected async toggleRecentTurnExpand(id: string): Promise<void> {
    const open = this.expandedRecentTurnId() !== id;
    this.expandedRecentTurnId.update((cur) => (cur === id ? null : id));
    if (open) {
      await this.ensureRecentTurnTranscriptLoaded(id);
    }
  }

  protected isRecentTurnExpanded(id: string): boolean {
    return this.expandedRecentTurnId() === id;
  }

  protected toggleRecentThinkingVisibility(id: string): void {
    this.recentThinkingVisibleIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected isRecentThinkingVisible(id: string): boolean {
    return this.recentThinkingVisibleIds().includes(id);
  }

  protected getRecentTurnTranscriptForView(r: RecentTurn): RecentTranscriptLine[] {
    const list = Array.isArray(r.transcript) ? r.transcript : [];
    return list;
  }

  protected formatRecentTranscriptRole(role: RecentTranscriptLine['role']): string {
    if (role === 'user') return '用户';
    if (role === 'assistant') return '助手';
    return '步骤';
  }

  protected formatRecentTranscriptContent(row: RecentTranscriptLine, showThinking: boolean): string {
    const raw = typeof row.content === 'string' ? row.content : '';
    if (row.role === 'assistant' && !showThinking) {
      return stripAssistantContentForHistoryReplay(raw) || '（思考内容已折叠）';
    }
    if (row.role === 'user') {
      return stripUserContentForHistoryReplay(raw) || raw.trim();
    }
    return raw.trim();
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
    try {
      await this.agentMemory.appendProjectLongTermTurn(turn);
    } catch {
      /* 长期记忆落盘失败不阻断主流程 */
    }
    await this.refreshShortTermMemoryStats();
  }

  private bumpStreamLineBudgetForWrite(fragment: string): void {
    if (!fragment) return;
    this.streamConsumedLines += this.countPhysicalTerminalLines(fragment.replaceAll('\n', '\r\n'));
  }

  /**
   * 自然语言回车后：回到上一行将空心标换为实心，并在同一块区域开始本轮流式输出。
   * 非 verbose 且开启思考展示时，立即写入「思考中」头，避免等首包才出现占位。
   */
  private commitMainTerminalUserRowForStreamRound(
    userPrompt: string,
    cfg: ReturnType<WorkbenchPageComponent['readModelRequestUiConfig']>,
    opts?: { skipTerminalUserLineAnchor?: boolean },
  ): void {
    const term = this.xterm;
    if (!term) return;
    this.disposeAssistantStreamOutputStartMarker();
    if (!opts?.skipTerminalUserLineAnchor) {
      term.write('\x1b[1A');
    }
    const mk = term.registerMarker(0);
    if (mk) this.assistantStreamOutputStartMarker = mk;
    const trimmed = userPrompt.replace(/\r\n/g, '\n').trim();
    const escaped = trimmed.replaceAll('\n', '\r\n');
    let body = `\r\x1b[2K\x1b[36m[用户]\x1b[0m ${escaped}`;
    const thinkingEligible = cfg.showThinking && !cfg.thinkingVerboseMode;
    if (thinkingEligible) {
      const id = this.ensureStreamingThinkingBlockId();
      body += `\r\n\x1b[90m[思考中 #${id}]\x1b[0m `;
      this.thinkingHeaderShown = true;
    }
    this.aiXtermWrite(body);
    this.bumpStreamLineBudgetForWrite(body);
  }

  private disposeAssistantStreamOutputStartMarker(): void {
    try {
      this.assistantStreamOutputStartMarker?.dispose();
    } catch {
      /* ignore */
    }
    this.assistantStreamOutputStartMarker = undefined;
  }

  /** 在本轮首次向主终端写入流式内容之前调用，锚定擦除上界（当前光标所在 buffer 行）。 */
  private ensureAssistantStreamOutputStartMarker(): void {
    if (this.assistantStreamOutputStartMarker || !this.xterm) return;
    const m = this.xterm.registerMarker(0);
    if (m) this.assistantStreamOutputStartMarker = m;
  }

  /** 终端列宽上的近似显示宽度（CJK 等按 2 列计），用于换行估算 */
  private stringDisplayWidth(s: string): number {
    let w = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      if (
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0x9fff) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6)
      ) {
        w += 2;
      } else {
        w += 1;
      }
    }
    return w;
  }

  private countPhysicalTerminalLines(s: string): number {
    const cols = Math.max(40, this.xterm?.cols ?? 100);
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
    let total = 0;
    for (const rawLine of stripped.split(/\r?\n/)) {
      const line = rawLine.replace(/\r/g, '');
      const sw = this.stringDisplayWidth(line);
      total += sw === 0 ? 1 : Math.ceil(sw / cols);
    }
    return total;
  }

  /**
   * 从第 startCol 列（0-based）起，纯文本（无 ANSI）在固定列宽下占用的物理行数（至少 1）。
   */
  private countWrappedLinesFromColumn(plain: string, startCol: number, cols: number): number {
    const t = plain.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!t) return 1;
    let lines = 1;
    let rowWidth = Math.min(Math.max(0, startCol), cols);
    for (const ch of t) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      if (ch === '\n') {
        lines++;
        rowWidth = 0;
        continue;
      }
      const w =
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0x9fff) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6)
          ? 2
          : 1;
      if (rowWidth + w > cols) {
        lines++;
        rowWidth = w;
      } else {
        rowWidth += w;
      }
    }
    return Math.max(1, lines);
  }

  private truncateThinkingToFitRows(plain: string, tagEndCol0: number, cols: number, maxRows: number): string {
    if (maxRows < 1) return '…';
    if (this.countWrappedLinesFromColumn(plain, tagEndCol0, cols) <= maxRows) return plain;
    let lo = 0;
    let hi = plain.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const candidate = plain.slice(0, mid) + (mid < plain.length ? '…' : '');
      if (this.countWrappedLinesFromColumn(candidate, tagEndCol0, cols) <= maxRows) lo = mid;
      else hi = mid - 1;
    }
    if (lo <= 0) return '…';
    return plain.slice(0, lo) + '…';
  }

  /**
   * Ctrl+O 展开思考：用 xterm 装饰层覆盖显示，**不**向 buffer 写入多行正文，避免折行误差覆盖下方 [回答] 且无法恢复。
   */
  private expandThinkingViaOverlay(id: number, preferAbsLine?: number): boolean {
    const term = this.xterm;
    if (!term || this.expandedSingleById.has(id) || this.thinkingInlineExpandedIds.has(id)) return false;
    const fold = this.findThinkingFoldBufferLines(id, preferAbsLine);
    if (!fold) return false;
    const rec = this.thinkingBlocksById.get(id);
    if (!rec) return false;

    const cols = Math.max(20, term.cols);
    const tagEnd0 = Math.min(cols - 1, Math.max(0, rec.tagEndCol0));
    const plain = rec.hasNonChinese ? this.sanitizeThinkingForDisplay(rec.text) : rec.text;
    const expandedRows = Math.max(1, this.countWrappedLinesFromColumn(plain, tagEnd0, cols));
    const collapsedRows = Math.max(1, rec.hintPhysicalRows);
    const insertedRows = Math.max(0, expandedRows - collapsedRows);
    const actualInserted = insertedRows > 0 ? this.insertVisualRowsAfterFold(fold.last, insertedRows) : 0;

    this.thinkingInlineExpandedIds.add(id);
    this.thinkingInlineExpandedRanges.set(id, {
      first: fold.first,
      last: fold.last + actualInserted,
      insertedRows: actualInserted,
    });

    this.pruneDisposedThinkingMarkers();
    const marker = this.rebuildMarkerOnThinkingFoldLine(id, preferAbsLine);
    if (!marker) {
      this.thinkingInlineExpandedIds.delete(id);
      this.thinkingInlineExpandedRanges.delete(id);
      return false;
    }
    this.scheduleThinkingOverlayAttach(id, marker, 'single');
    return true;
  }

  /** 在折叠占位之后插入可视空行，给装饰层腾出空间，避免覆盖下方回答。 */
  private insertVisualRowsAfterFold(foldLast: number, rowsToInsert: number): number {
    const term = this.xterm;
    if (!term || rowsToInsert <= 0) return 0;
    term.scrollToLine(foldLast);
    const buf = term.buffer.normal;
    const rel = foldLast - buf.viewportY;
    if (rel < 0 || rel >= term.rows) return 0;

    const targetRow = Math.min(term.rows, rel + 2);
    let seq = '\x1b7';
    seq += `\x1b[${targetRow};1H`;
    for (let i = 0; i < rowsToInsert; i++) {
      seq += '\x1b[L';
    }
    seq += '\x1b8';
    term.write(seq);
    return rowsToInsert;
  }

  /** 收起行内展开：清掉续行后写回折叠尾 ANSI */
  private collapseThinkingInline(id: number, opts?: { force?: boolean }): void {
    const term = this.xterm;
    if (!term || (!opts?.force && !this.thinkingInlineExpandedIds.has(id))) return;
    const rec = this.thinkingBlocksById.get(id);
    if (!rec) {
      this.thinkingInlineExpandedIds.delete(id);
      return;
    }
    const exp = this.thinkingInlineExpandedRanges.get(id);
    const fold = this.findThinkingFoldBufferLines(id);
    if (!fold) {
      this.thinkingInlineExpandedIds.delete(id);
      return;
    }
    const { first } = fold;
    const insertedRows = Math.max(0, exp?.insertedRows ?? 0);
    const storedLast = exp?.last ?? fold.last;
    const answerY = this.findNextSectionLineAfterFold(first);
    let expLast = storedLast;
    if (answerY !== null) {
      expLast = answerY > first + 1 ? Math.min(storedLast, answerY - 1) : first;
    }
    expLast = Math.max(first, expLast);
    const tagEnd0 = Math.min(term.cols - 1, Math.max(0, rec.tagEndCol0));
    let seq = '\x1b7';

    if (insertedRows > 0) {
      term.scrollToLine(first);
      const r0 = first - term.buffer.normal.viewportY;
      if (r0 >= 0 && r0 < term.rows) {
        const delRow = Math.min(term.rows, r0 + 2);
        seq += `\x1b[${delRow};1H`;
        for (let i = 0; i < insertedRows; i++) seq += '\x1b[M';
      }
    } else {
      for (let y = first + 1; y <= expLast; y++) {
        term.scrollToLine(y);
        const ry = y - term.buffer.normal.viewportY;
        if (ry >= 0 && ry < term.rows) seq += `\x1b[${ry + 1};1H\x1b[2K`;
      }
    }

    term.scrollToLine(first);
    const rf = first - term.buffer.normal.viewportY;
    if (rf >= 0 && rf < term.rows) {
      seq += `\x1b[${rf + 1};${tagEnd0 + 1}H\x1b[K${rec.foldSuffixAnsi}`;
    }
    seq += '\x1b8';
    term.write(seq);
    this.thinkingInlineExpandedIds.delete(id);
    this.thinkingInlineExpandedRanges.delete(id);
    if (!opts?.force) {
      this.thinkingAllExpanded = false;
    }
  }

  private disposeAllThinkingOverlays(): void {
    for (const id of [...this.thinkingInlineExpandedIds]) {
      this.collapseThinkingInline(id, { force: true });
    }
    this.thinkingInlineExpandedIds.clear();
    this.thinkingInlineExpandedRanges.clear();
    this.thinkingOverlayAttachGen++;
    for (const d of this.thinkingAllExpandDisposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    this.thinkingAllExpandDisposables = [];
    for (const [, list] of this.expandedSingleById) {
      for (const d of list) {
        try {
          d.dispose();
        } catch {
          /* ignore */
        }
      }
    }
    this.expandedSingleById.clear();
    this.thinkingAllExpanded = false;
  }

  private resetThinkingBlockRegistry(): void {
    this.disposeAllThinkingOverlays();
    this.thinkingBlocksById.clear();
    this.thinkingInlineExpandedIds.clear();
    this.thinkingBlockMarkers = [];
    this.nextThinkingBlockId = 1;
    try {
      sessionStorage.removeItem(WORKBENCH_THINKING_BLOCKS_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  /** 从 sessionStorage 合并缺失的 Thinking 块（内存被清空或热更新后仍可按编号展开） */
  private mergeThinkingBlocksFromSession(): void {
    try {
      const raw = sessionStorage.getItem(WORKBENCH_THINKING_BLOCKS_SESSION_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(o)) {
        const id = Number.parseInt(k, 10);
        if (!Number.isFinite(id) || id < 1) continue;
        if (this.thinkingBlocksById.has(id)) continue;
        const rec = this.parseStoredThinkingBlock(v);
        if (rec) this.thinkingBlocksById.set(id, rec);
      }
      const keys = [...this.thinkingBlocksById.keys()];
      if (keys.length > 0) {
        const floor = Math.max(...keys) + 1;
        this.nextThinkingBlockId = Math.max(this.nextThinkingBlockId, floor);
      }
    } catch {
      /* ignore */
    }
  }

  private parseStoredThinkingBlock(
    v: unknown,
  ):
    | {
        text: string;
        hasNonChinese: boolean;
        foldSuffixAnsi: string;
        hintPhysicalRows: number;
        tagEndCol0: number;
      }
    | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const r = v as Record<string, unknown>;
    if (typeof r['text'] !== 'string') return undefined;
    const foldSuffixAnsi = typeof r['foldSuffixAnsi'] === 'string' ? r['foldSuffixAnsi'] : undefined;
    if (!foldSuffixAnsi) return undefined;
    const hintPhysicalRows =
      typeof r['hintPhysicalRows'] === 'number' &&
      r['hintPhysicalRows'] >= 1 &&
      r['hintPhysicalRows'] < 200
        ? r['hintPhysicalRows']
        : 1;
    const tagEndCol0 =
      typeof r['tagEndCol0'] === 'number' && r['tagEndCol0'] >= 0 && r['tagEndCol0'] < 4096
        ? r['tagEndCol0']
        : 1;
    return {
      text: r['text'],
      hasNonChinese: Boolean(r['hasNonChinese']),
      foldSuffixAnsi,
      hintPhysicalRows,
      tagEndCol0,
    };
  }

  private persistThinkingBlocksSession(): void {
    try {
      const max = 320;
      const entries = [...this.thinkingBlocksById.entries()].sort((a, b) => a[0] - b[0]).slice(-max);
      sessionStorage.setItem(WORKBENCH_THINKING_BLOCKS_SESSION_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* ignore */
    }
  }

  private pruneDisposedThinkingMarkers(): void {
    // 勿用 line>=0 过滤：新注册的 marker 在同步读 line 时可能仍为 -1，会被误删导致快捷键无效
    this.thinkingBlockMarkers = this.thinkingBlockMarkers.filter((e) => !e.marker.isDisposed);
  }

  private parseThinkingBlockIdFromText(text: string): number | null {
    const stripped = text
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u200b/g, '')
      .trim();
    const m =
      stripped.match(/\[(?:Thinking|思考中|已思考)\s*#(\d+)\]/i) ??
      stripped.match(/\[(?:Thinking|思考中|已思考)#(\d+)\]/i) ??
      stripped.match(/\[(?:Thinking|思考中|已思考)\]\s*#(\d+)/i);
    if (m) return Number.parseInt(m[1]!, 10);
    const m2 = stripped.match(/#(\d+)/);
    if (m2) {
      const n = Number.parseInt(m2[1]!, 10);
      if (this.thinkingBlocksById.has(n)) return n;
    }
    // 旧版流式仅写 `[Thinking]` 无编号：按正文前缀与缓存块匹配（优先较新 id）
    if (/\[Thinking\](?!\s*#)/i.test(stripped) && !/\[Thinking\s*#\d+\]/i.test(stripped)) {
      const after = stripped.replace(/^[\s\S]*?\[Thinking\]\s*/i, '').trim();
      const entries = [...this.thinkingBlocksById.entries()].reverse();
      if (!after) {
        const ids = [...this.thinkingBlocksById.keys()];
        return ids.length ? Math.max(...ids) : null;
      }
      const head = after.slice(0, Math.min(80, after.length));
      for (const [bid, rec] of entries) {
        const t0 = rec.text.trim();
        if (head.length >= 6 && (t0.startsWith(head.slice(0, Math.min(40, head.length))) || t0.includes(head.slice(0, 24)))) {
          return bid;
        }
      }
    }
    if (/\[思考中\](?!\s*#)/i.test(stripped) && !/\[思考中\s*#\d+\]/i.test(stripped)) {
      const after = stripped.replace(/^[\s\S]*?\[思考中\]\s*/i, '').trim();
      const entries = [...this.thinkingBlocksById.entries()].reverse();
      if (!after) {
        const ids = [...this.thinkingBlocksById.keys()];
        return ids.length ? Math.max(...ids) : null;
      }
      const head = after.slice(0, Math.min(80, after.length));
      for (const [bid, rec] of entries) {
        const t0 = rec.text.trim();
        if (head.length >= 6 && (t0.startsWith(head.slice(0, Math.min(40, head.length))) || t0.includes(head.slice(0, 24)))) {
          return bid;
        }
      }
    }
    return null;
  }

  /** 折叠占位符所在逻辑行的首/末 buffer 行号（0-based，含折行） */
  private findThinkingFoldBufferLines(id: number, preferAbsLine?: number): { first: number; last: number } | null {
    const term = this.xterm;
    if (!term) return null;

    // 若当前处于行内展开态，优先使用记录的范围（避免再次匹配到历史同编号/重复内容）
    const expanded = this.thinkingInlineExpandedRanges.get(id);
    if (expanded) return { first: expanded.first, last: expanded.last };

    const needles = [`[Thinking #${id}]`, `[Thinking#${id}]`, `[思考中 #${id}]`, `[思考中#${id}]`, `[已思考 #${id}]`, `[已思考#${id}]`];
    const buf = term.buffer.normal;
    const stripAnsi = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '');
    const candidates: Array<{ first: number; last: number }> = [];
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      if (!line || line.isWrapped) continue;
      let merged = line.translateToString(true);
      let yy = y;
      while (yy + 1 < buf.length && buf.getLine(yy + 1)?.isWrapped) {
        yy++;
        merged += buf.getLine(yy)!.translateToString(true);
      }
      const s = stripAnsi(merged);
      if (needles.some((n) => s.includes(n))) {
        candidates.push({ first: y, last: yy });
        continue;
      }
      const rec = this.thinkingBlocksById.get(id);
      if (rec && /\[Thinking\](?!\s*#)/i.test(s) && !s.includes(`[Thinking #${id}]`) && !s.includes(`[Thinking#${id}]`)) {
        const body = s.replace(/^[\s\S]*?\[Thinking\]\s*/i, '').trimStart();
        const p = rec.text.trim().slice(0, 48);
        if (p.length >= 6 && body.startsWith(p.slice(0, Math.min(24, p.length)))) {
          candidates.push({ first: y, last: yy });
        }
      }
      if (rec && /\[思考中\](?!\s*#)/i.test(s) && !s.includes(`[思考中 #${id}]`) && !s.includes(`[思考中#${id}]`)) {
        const body = s.replace(/^[\s\S]*?\[思考中\]\s*/i, '').trimStart();
        const p = rec.text.trim().slice(0, 48);
        if (p.length >= 6 && body.startsWith(p.slice(0, Math.min(24, p.length)))) {
          candidates.push({ first: y, last: yy });
        }
      }
    }
    if (candidates.length === 0) return null;
    if (preferAbsLine === undefined) return candidates[candidates.length - 1]!;

    let best = candidates[0]!;
    let bestDist = Math.abs(best.first - preferAbsLine);
    for (const c of candidates.slice(1)) {
      const d = Math.abs(c.first - preferAbsLine);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * 从思考折叠块首行之后查找下一段内容起始行（回答 / 工具等），用于收起展开时避免多清行留下大块空白。
   */
  private findNextSectionLineAfterFold(foldFirst: number): number | null {
    const term = this.xterm;
    if (!term) return null;
    const buf = term.buffer.normal;
    const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
    const isSectionStart = (plain: string) =>
      /\[回答\]/.test(plain) ||
      /\[Answer\]/i.test(plain) ||
      /\[Tool\]/.test(plain) ||
      /\[步骤\]/.test(plain);
    let y = foldFirst + 1;
    const cap = Math.min(buf.length, foldFirst + 500);
    while (y < cap) {
      const line = buf.getLine(y);
      if (!line) {
        y++;
        continue;
      }
      if (line.isWrapped) {
        y++;
        continue;
      }
      let merged = line.translateToString(true);
      let yy = y;
      while (yy + 1 < buf.length && buf.getLine(yy + 1)?.isWrapped) {
        yy++;
        merged += buf.getLine(yy)!.translateToString(true);
      }
      if (isSectionStart(strip(merged))) return y;
      y = yy + 1;
    }
    return null;
  }

  /** 在 scrollback 中查找包含某折叠占位符的 buffer 行号（0-based，逻辑行首物理行） */
  private findBufferLineContainingThinkingFold(id: number, preferAbsLine?: number): number | null {
    return this.findThinkingFoldBufferLines(id, preferAbsLine)?.first ?? null;
  }

  /**
   * 在折叠块首行创建/复用 marker，锚定到 buffer 绝对行，避免依赖光标跳转写入导致的异步错位。
   */
  private rebuildMarkerOnThinkingFoldLine(id: number, preferAbsLine?: number): IMarker | undefined {
    const term = this.xterm;
    if (!term) return undefined;
    const fold = this.findThinkingFoldBufferLines(id, preferAbsLine);
    if (!fold) return undefined;
    const { first } = fold;

    const existed = this.thinkingBlockMarkers.find((e) => e.id === id)?.marker;
    if (existed && !existed.isDisposed && existed.line >= 0 && Math.abs(existed.line - first) <= 2) {
      return existed;
    }

    const buf = term.buffer.normal;
    const cursorAbs = buf.baseY + buf.cursorY;
    const offset = first - cursorAbs;
    const mk = term.registerMarker(offset);
    if (mk) this.upsertThinkingBlockMarker(id, mk);
    return mk ?? undefined;
  }

  private upsertThinkingBlockMarker(id: number, marker: IMarker): void {
    const i = this.thinkingBlockMarkers.findIndex((e) => e.id === id);
    if (i >= 0) {
      try {
        this.thinkingBlockMarkers[i]!.marker.dispose();
      } catch {
        /* ignore */
      }
      this.thinkingBlockMarkers[i] = { id, marker };
    } else {
      this.thinkingBlockMarkers.push({ id, marker });
    }
    if (this.thinkingBlockMarkers.length > 80) this.thinkingBlockMarkers = this.thinkingBlockMarkers.slice(-80);
  }

  /** 在折叠行对应的 buffer 位置上挂装饰层展示全文（无 ANSI）；需 marker 已绑定有效 buffer 行 */
  private attachThinkingOverlayAtMarker(id: number, marker: IMarker): IDisposable[] {
    const term = this.xterm;
    if (!term || marker.isDisposed || marker.line < 0) return [];
    const rec = this.thinkingBlocksById.get(id);
    if (!rec) return [];
    const plain = rec.hasNonChinese ? this.sanitizeThinkingForDisplay(rec.text) : rec.text;
    const bodyRows = Math.max(1, this.countPhysicalTerminalLines(plain));
    // 额外 +1 行：正文从 [已思考 #N] 标签下一行开始显示，避免与标签重叠。
    const height = Math.min(60, Math.max(3, bodyRows + 1));
    const opts = {
      marker,
      width: term.cols,
      height,
      backgroundColor: '#12121c',
      foregroundColor: '#e2e4f0',
      layer: 'top' as const,
    };
    let deco = term.registerDecoration(opts);
    if (!deco) {
      deco = term.registerDecoration({ marker, width: term.cols, height, layer: 'top' });
    }
    if (!deco) return [];
    const sub = deco.onRender((el) => {
      el.style.whiteSpace = 'pre-wrap';
      el.style.overflow = 'auto';
      el.style.boxSizing = 'border-box';
      el.style.padding = 'calc(1.45em + 4px) 6px 4px 6px';
      el.style.fontSize = '12px';
      el.style.lineHeight = '1.45';
      el.textContent = plain;
    });
    return [deco, sub];
  }

  /**
   * marker 刚创建时 line 可能仍为 -1，registerDecoration 会失败。
   * 在后续动画帧重试，直到 line 有效或超时；不在缓冲区末尾追加正文。
   */
  private scheduleThinkingOverlayAttach(
    id: number,
    marker: IMarker,
    mode: 'single' | 'all',
    onDone?: () => void,
  ): void {
    const ticket = this.thinkingOverlayAttachGen;
    const maxFrames = 64;
    const step = (frame: number) => {
      if (ticket !== this.thinkingOverlayAttachGen) {
        onDone?.();
        return;
      }
      if (!this.xterm || marker.isDisposed) {
        onDone?.();
        return;
      }
      if (marker.line < 0 && frame < maxFrames) {
        requestAnimationFrame(() => step(frame + 1));
        return;
      }
      if (marker.line < 0) {
        onDone?.();
        return;
      }
      const list = this.attachThinkingOverlayAtMarker(id, marker);
      if (list.length === 0) {
        onDone?.();
        return;
      }
      if (mode === 'single') this.expandedSingleById.set(id, list);
      else for (const d of list) this.thinkingAllExpandDisposables.push(d);

      // 锚点可视校准：若 marker 与折叠行偏差过大，自动重挂一次，避免展开层漂移到 [回答] 区域。
      const target = this.findThinkingFoldBufferLines(id)?.first;
      if (target !== undefined && target !== null && Math.abs(marker.line - target) > 1 && frame < maxFrames) {
        const remount = this.rebuildMarkerOnThinkingFoldLine(id, target);
        if (remount && !remount.isDisposed) {
          for (const d of list) {
            try {
              d.dispose();
            } catch {
              /* ignore */
            }
          }
          if (mode === 'single') this.expandedSingleById.delete(id);
          requestAnimationFrame(() => this.scheduleThinkingOverlayAttach(id, remount, mode, onDone));
          return;
        }
      }

      if (mode === 'single') {
        this.xterm?.clearSelection();
      }
      onDone?.();
    };
    requestAnimationFrame(() => step(0));
  }

  /**
   * 流式结束后：将本轮 Thinking（及同批 Tool 回显、Answer）从终端擦除并重绘为折叠态 + 完整回答。
   */
  private finalizeAssistantStreamUi(params: {
    ok: boolean;
    interrupted: boolean;
    userPrompt: string;
    thinking: string;
    thinkingHasNonChinese: boolean;
    answer: string;
    layoutSplitThinkingAnswer: boolean;
    thinkingToggleShortcut: string;
    thinkingToggleAllShortcut: string;
  }): void {
    if (!params.ok || !this.xterm) return;
    const th = params.thinking.trim();
    const base = this.streamConsumedLines;
    if (base <= 0) {
      this.streamingThinkingBlockId = null;
      return;
    }
    const hasCjk = /[\u4e00-\u9fff]/.test(th);
    const slack = hasCjk ? 14 : 6;
    const buf = this.xterm.buffer.normal;
    // 与 xterm registerMarker 一致：marker.line 为 buffer 绝对行号，等价于 baseY+cursorY（非 viewportY+cursorY）
    const cursorAbs = buf.baseY + buf.cursorY;
    const mk = this.assistantStreamOutputStartMarker;
    /**
     * 擦除上移行数必须与真实 buffer 区间一致。streamConsumedLines 用「按列宽折行」估算物理行，
     * 长段不换行时会被严重高估，若再与 perRoundMax=base+8 联动会导致 CUU 过大、把 [用户] 画到缓冲区顶部。
     * 因此：优先用 marker 与光标的实际跨度，并对总行数做硬上限（与终端高度挂钩）。
     */
    const rows = Math.max(1, this.xterm.rows);
    const maxErase = Math.max(200, rows * 40);
    const cappedBase = Math.min(Math.max(0, base), maxErase);
    const fallbackBudget = Math.max(1, Math.min(cappedBase + Math.min(4, slack), maxErase));
    let lines: number;
    if (mk && !mk.isDisposed && mk.line >= 0) {
      const top = mk.line;
      const span = cursorAbs - top + 1;
      if (span > 0) {
        lines = Math.max(1, Math.min(span + Math.min(3, slack), maxErase));
      } else {
        lines = fallbackBudget;
      }
    } else {
      lines = fallbackBudget;
    }
    this.disposeAssistantStreamOutputStartMarker();

    const blockId =
      this.streamingThinkingBlockId !== null ? this.streamingThinkingBlockId : this.nextThinkingBlockId++;
    this.streamingThinkingBlockId = null;
    const foldHint = `(${params.thinkingToggleShortcut} 展开/收起；${params.thinkingToggleAllShortcut} 全部展开/收起；可选中 [已思考#N] 行指定块)`;
    const foldSuffixAnsi = ` … \x1b[2m${foldHint}\x1b[0m`;
    const cols = Math.max(40, this.xterm.cols);
    const tagEndCol0 = Math.min(cols - 1, this.stringDisplayWidth(`[已思考 #${blockId}]`));
    const hintPhysicalRows = this.countWrappedLinesFromColumn(` … ${foldHint}`, tagEndCol0, cols);
    this.thinkingBlocksById.set(blockId, {
      text: params.thinking,
      hasNonChinese: params.thinkingHasNonChinese,
      foldSuffixAnsi,
      hintPhysicalRows,
      tagEndCol0,
    });
    this.latestTurnThinkingIds = [blockId];
    this.persistThinkingBlocksSession();

    const firstThinkingLine = params.thinking
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
    const interruptedSuffix = firstThinkingLine ? ` … ${firstThinkingLine}` : ' …';
    const interruptedFoldBody = `\r\n\x1b[90m[已思考 #${blockId}]\x1b[0m\x1b[2m${interruptedSuffix}\x1b[0m`;
    const normalFoldBody = `\r\n\x1b[90m[已思考 #${blockId}]\x1b[0m${foldSuffixAnsi}`;
    const foldBody = params.interrupted ? interruptedFoldBody : normalFoldBody;

    const erase = `\x1b[${lines}A\x1b[0J`;
    const xterm = this.xterm;
    const echoes = [...this.streamToolEchoes];
    const answer = params.answer;
    const layoutSplit = params.layoutSplitThinkingAnswer;
    const promptText = params.userPrompt.trim();

    const tail = (): void => {
      if (promptText) {
        const skillSuffix = this.currentTurnHitSkillLabel
          ? ` \x1b[30;43m[Skill: ${this.currentTurnHitSkillLabel}]\x1b[0m`
          : '';
        // 先整行清空再写，避免 CUU 落在欢迎语行时与「主终端：shell」拼在同一行
        xterm.write(`\r\x1b[2K\x1b[36m[用户]\x1b[0m ${promptText.replaceAll('\n', '\r\n')}${skillSuffix}`);
      }

      // 顺序：User -> Skill -> Thinking -> Answer
      if (!this.currentTurnSkillEchoedToXterm) {
        for (const skillLine of this.currentTurnSkillLines) {
          xterm.write(`\r\n${skillLine}`);
        }
      }

      // [Thinking]/[Answer] 紧跟在 user/skill 行后，位于同一块展示区域
      xterm.write(foldBody.replaceAll('\n', '\r\n'));

      for (const echo of echoes) {
        xterm.write(echo.replaceAll('\n', '\r\n'));
      }
      if (params.interrupted) {
        return;
      }
      if (answer) {
        if (layoutSplit) {
          xterm.write(`\r\n\x1b[35m[回答]\x1b[0m `);
        } else {
          // 与装饰锚定行错开，避免无 [Answer] 头时正文压在展开层所在行上
          xterm.write('\r\n');
        }
        xterm.write(answer.replaceAll('\n', '\r\n'));
      }
    };

    xterm.write(erase, () => {
      tail();
      queueMicrotask(() => xterm.scrollToBottom());
    });
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

  private ensureStreamingThinkingBlockId(): number {
    if (this.streamingThinkingBlockId === null) {
      this.streamingThinkingBlockId = this.nextThinkingBlockId++;
    }
    return this.streamingThinkingBlockId;
  }

  /** 将一段文本写入本轮 thinking 缓冲并按流式规则刷终端（含 [Thinking#N] 头） */
  private appendThinkingStreamDelta(
    textDelta: string,
    cfg: ReturnType<WorkbenchPageComponent['readModelRequestUiConfig']>,
  ): void {
    if (!cfg.showThinking) return;
    this.thinkingBuffer += textDelta;
    if (/[A-Za-z]{3,}/.test(textDelta)) {
      this.thinkingHasNonChinese = true;
    }
    if (!this.thinkingHeaderShown) {
      const id = this.ensureStreamingThinkingBlockId();
      const thHeader = `\r\n\x1b[90m[思考中 #${id}]\x1b[0m `;
      this.aiXtermWrite(thHeader);
      this.bumpStreamLineBudgetForWrite(thHeader);
      this.thinkingHeaderShown = true;
      // header 写入后再钉 marker，避免 marker 落在换行前的上一行（用户输入行）
      this.ensureAssistantStreamOutputStartMarker();
    }
    const rest = this.thinkingBuffer.slice(this.thinkingPrintedLen);
    if (rest) {
      const visible = this.thinkingHasNonChinese ? this.sanitizeThinkingForDisplay(rest) : rest;
      const out = this.highlightThinkingSteps(visible);
      this.aiXtermWrite(out);
      this.bumpStreamLineBudgetForWrite(out);
      this.thinkingPrintedLen = this.thinkingBuffer.length;
    }
  }

  private handleStreamChunk(value: StreamChunk): void {
    const cfg = this.readModelRequestUiConfig();

    if (value.type === 'delta') {
      const routeThinking = cfg.showThinking && cfg.layoutSplitThinkingAnswer && this.streamRouteDeltaToThinking;
      if (routeThinking) {
        this.appendThinkingStreamDelta(value.textDelta, cfg);
        return;
      }
      this.roundAnswerAccumulator += value.textDelta;
      if (cfg.layoutSplitThinkingAnswer && !this.answerHeaderShown) {
        const hdr = `\r\n\x1b[35m[回答]\x1b[0m `;
        this.aiXtermWrite(hdr);
        this.bumpStreamLineBudgetForWrite(hdr);
        this.answerHeaderShown = true;
        this.ensureAssistantStreamOutputStartMarker();
      }
      if (!this.assistantStreamOutputStartMarker) {
        this.ensureAssistantStreamOutputStartMarker();
      }
      this.aiXtermWrite(value.textDelta);
      this.bumpStreamLineBudgetForWrite(value.textDelta);
      return;
    }
    if (value.type === 'thinking_delta') {
      if (!cfg.showThinking) return;
      this.appendThinkingStreamDelta(value.textDelta, cfg);
      return;
    }
    if (value.type === 'tool_call') {
      this.streamRouteDeltaToThinking = false;
      this.toolCallCount.update((v) => v + 1);
      const name = value.toolCall.toolName ?? 'tool';
      this.bumpPlanOnToolStart();
      this.pushToolMemory(`步骤：准备执行 ${name}`);
      if (cfg.showToolActivity) {
        const line = `\r\n\x1b[90m[Tool]\x1b[0m ${name} ...\r\n`;
        this.aiXtermWrite(line);
        this.streamToolEchoes.push(line);
        this.bumpStreamLineBudgetForWrite(line);
        this.ensureAssistantStreamOutputStartMarker();
      }
      return;
    }
    if (value.type === 'tool_result') {
      const { ok, error } = value.toolResult;
      this.bumpPlanOnToolDone(ok);
      if (ok) {
        this.pushToolMemory('步骤完成');
        if (cfg.showToolActivity) {
          const line = `\x1b[90m[Tool]\x1b[0m done\r\n`;
          this.aiXtermWrite(line);
          this.streamToolEchoes.push(line);
          this.bumpStreamLineBudgetForWrite(line);
          this.ensureAssistantStreamOutputStartMarker();
        }
      } else {
        const detail = error ? `：${error.slice(0, 200)}` : '';
        this.pushToolMemory(`步骤失败${detail.slice(0, 80)}`);
        if (cfg.showToolActivity) {
          const line = `\x1b[90m[Tool]\x1b[0m failed${detail}\r\n`;
          this.aiXtermWrite(line);
          this.streamToolEchoes.push(line);
          this.bumpStreamLineBudgetForWrite(line);
          this.ensureAssistantStreamOutputStartMarker();
        }
      }
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
      allowProposedApi: true,
    });

    this.xterm.loadAddon(this.fitAddon);
    this.xterm.open(host);
    this.fitAddon.fit();
    queueMicrotask(() => this.focusAiTerminal());

    this.xterm.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;
      const cfg = this.readModelRequestUiConfig();
      if (this.matchesShortcut(event, cfg.thinkingToggleShortcut)) {
        event.preventDefault();
        if (!this.terminalBusy()) this.toggleThinkingCollapse();
        return false;
      }
      if (this.matchesShortcut(event, cfg.thinkingToggleAllShortcut)) {
        event.preventDefault();
        if (!this.terminalBusy()) this.toggleThinkingCollapseAll();
        return false;
      }
      return true;
    });

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

    this.aiXtermContextMenu = (ev: Event) => {
      const e = ev as MouseEvent;
      e.preventDefault();
      const term = this.xterm;
      if (!term) return;
      const sel = term.getSelection();
      if (sel.length > 0) {
        void navigator.clipboard.writeText(sel);
        term.clearSelection();
        return;
      }
      void navigator.clipboard.readText().then((t) => {
        if (t) this.feedMainTerminalInput(t);
      });
    };
    host.addEventListener('contextmenu', this.aiXtermContextMenu);


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
        const cfg = this.readModelRequestUiConfig();
        this.aiXtermWrite(
          `\r\n\x1b[33m[提示]\x1b[0m Ctrl+C 中断 · ${cfg.thinkingToggleShortcut} 展开/收起思考（可选中选块；无选区时切换最近一轮）· ${cfg.thinkingToggleAllShortcut} 全部展开/收起 · Ctrl+Shift+C 复制 · Ctrl+Shift+V 粘贴 · 右键：有选区复制/无选区粘贴 · Ctrl+L 清屏 · Shift+Tab 切换模式\r\n`,
        );
        this.refreshMainTerminalPromptLine();
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
        this.resetThinkingBlockRegistry();
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
    this.mergeThinkingBlocksFromSession();
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
      for (const m of recent) {
        const content = String(m.content ?? '').trim();
        if (!content) continue;
        if (m.role === 'user') {
          this.aiXtermWrite(`\x1b[32m>\x1b[0m ${content}\r\n`);
        } else if (m.role === 'assistant') {
          this.aiXtermWrite(`\x1b[35m[助手]\x1b[0m\r\n${content}\r\n`);
        } else if (m.role === 'tool') {
          this.aiXtermWrite(`\x1b[36m[步骤]\x1b[0m ${content.replace(/\r?\n/g, ' ')}\r\n`);
        }
      }
    } catch {
      // ignore history replay failures
    }
  }

  private writeMainTerminalPrompt(): void {
    this.aiXtermWrite(`\r\n\x1b[36m[用户]\x1b[0m `);
  }

  /**
   * 可选滚到底部后重绘 `>`，不额外写入 `\\r\\n>`。
   * 思考快捷键路径传 `scrollToBottom: false`，避免 Ctrl+O 把视口拉到最新行导致看不到刚展开的思考。
   */
  private refreshMainTerminalPromptLine(opts: { scrollToBottom?: boolean } = {}): void {
    const scroll = opts.scrollToBottom !== false;
    if (scroll) this.xterm?.scrollToBottom();
    this.redrawInputLine();
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

      // 处理方向键 ANSI 序列：Up/Down 切换历史；Left/Right 先忽略（后续可加光标编辑）
      if (this.mainEscSkip) {
        this.mainEscAcc += ch;
        const acc = this.mainEscAcc;
        if (acc === '\x1b[A') {
          this.navigateHistory(-1);
          this.mainEscSkip = false;
          this.mainEscAcc = '';
          continue;
        }
        if (acc === '\x1b[B') {
          this.navigateHistory(1);
          this.mainEscSkip = false;
          this.mainEscAcc = '';
          continue;
        }
        if (acc === '\x1b[C' || acc === '\x1b[D') {
          this.mainEscSkip = false;
          this.mainEscAcc = '';
          continue;
        }
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
      this.historyNavIndex = null;
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
    const matches = this.visibleDirectives().filter((d) => d.name.startsWith(line));
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
      // 与正常结束保持一致：仅标记中断并停止流，不在此处提前清空 thinking 状态
      // 最终由 askAssistant finally 中的 finalizeAssistantStreamUi 统一收口，确保思考过程按折叠态隐藏
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
    this.aiXtermWrite(`\r\x1b[2K\x1b[36m[用户]\x1b[0m ${this.mainLineBuffer}`);
    this.syncSlashCompletionRow();
  }

  private toggleThinkingCollapse(): void {
    if (this.terminalBusy()) return;
    const term = this.xterm;
    if (!term) return;
    this.mergeThinkingBlocksFromSession();

    let preferAbsLine: number | undefined;
    if (term.hasSelection()) {
      const selPos = term.getSelectionPosition();
      preferAbsLine =
        selPos && term.buffer?.normal ? Math.max(0, term.buffer.normal.viewportY + selPos.start.y) : undefined;
    }

    const expandedKeys = [...this.expandedSingleById.keys()];
    if (expandedKeys.length > 0) {
      let collapseId: number | null = null;
      if (term.hasSelection()) {
        const sid = this.parseThinkingBlockIdFromText(term.getSelection());
        if (sid !== null && this.expandedSingleById.has(sid)) collapseId = sid;
      }
      if (collapseId === null) {
        collapseId =
          expandedKeys.length === 1 ? expandedKeys[0]! : Math.max(...expandedKeys);
      }
      const existing = this.expandedSingleById.get(collapseId);
      if (existing) {
        for (const d of existing) {
          try {
            d.dispose();
          } catch {
            /* ignore */
          }
        }
        this.expandedSingleById.delete(collapseId);
        this.collapseThinkingInline(collapseId, { force: true });
        term.clearSelection();
        const fold = this.findThinkingFoldBufferLines(collapseId, preferAbsLine);
        if (fold) {
          term.scrollToLine(fold.first);
          (term as unknown as { selectLines?: (start: number, end: number) => void }).selectLines?.(
            fold.first,
            fold.first,
          );
        }
        this.refreshMainTerminalPromptLine({ scrollToBottom: false });
        return;
      }
    }

    let id: number | null = null;
    if (term.hasSelection()) {
      const parsed = this.parseThinkingBlockIdFromText(term.getSelection());
      if (parsed !== null && this.thinkingBlocksById.has(parsed)) id = parsed;
    }
    if (id === null) {
      for (let i = this.latestTurnThinkingIds.length - 1; i >= 0; i--) {
        const tid = this.latestTurnThinkingIds[i]!;
        if (this.thinkingBlocksById.has(tid) && this.findThinkingFoldBufferLines(tid)) {
          id = tid;
          break;
        }
      }
    }
    if (id === null) {
      const sorted = [...this.thinkingBlocksById.keys()].sort((a, b) => b - a);
      for (const tid of sorted) {
        if (this.findThinkingFoldBufferLines(tid)) {
          id = tid;
          break;
        }
      }
    }
    if (id === null) {
      this.refreshMainTerminalPromptLine({ scrollToBottom: false });
      return;
    }

    if (this.thinkingInlineExpandedIds.has(id)) {
      this.collapseThinkingInline(id);
      term.clearSelection();
      const fold = this.findThinkingFoldBufferLines(id, preferAbsLine);
      if (fold) {
        term.scrollToLine(fold.first);
        (term as unknown as { selectLines?: (start: number, end: number) => void }).selectLines?.(fold.first, fold.first);
      }
      this.refreshMainTerminalPromptLine({ scrollToBottom: false });
      return;
    }

    if (!this.expandThinkingViaOverlay(id, preferAbsLine)) {
      this.refreshMainTerminalPromptLine({ scrollToBottom: false });
      return;
    }

    term.clearSelection();
    const foldAfter = this.findThinkingFoldBufferLines(id, preferAbsLine);
    if (foldAfter) {
      term.scrollToLine(foldAfter.first);
      (term as unknown as { selectLines?: (start: number, end: number) => void }).selectLines?.(
        foldAfter.first,
        foldAfter.first,
      );
    }
    this.refreshMainTerminalPromptLine({ scrollToBottom: false });
  }

  private toggleThinkingCollapseAll(): void {
    if (this.terminalBusy()) return;
    const term = this.xterm;
    if (!term) return;
    this.mergeThinkingBlocksFromSession();
    this.pruneDisposedThinkingMarkers();

    const targetIds = [...this.thinkingBlocksById.keys()].sort((a, b) => a - b);
    if (targetIds.length === 0) {
      this.refreshMainTerminalPromptLine({ scrollToBottom: false });
      return;
    }

    const isExpanded = (id: number) =>
      this.expandedSingleById.has(id) || this.thinkingInlineExpandedIds.has(id);
    const allExpanded = targetIds.length > 0 && targetIds.every((id) => isExpanded(id));
    if (allExpanded) {
      for (const id of targetIds) {
        const list = this.expandedSingleById.get(id);
        if (list) {
          for (const d of list) {
            try {
              d.dispose();
            } catch {
              /* ignore */
            }
          }
          this.expandedSingleById.delete(id);
        }
        this.collapseThinkingInline(id, { force: true });
      }
      this.thinkingAllExpanded = false;
      const latest = targetIds[targetIds.length - 1]!;
      const fold = this.findThinkingFoldBufferLines(latest);
      term.clearSelection();
      if (fold) {
        term.scrollToLine(fold.first);
        (term as unknown as { selectLines?: (start: number, end: number) => void }).selectLines?.(fold.first, fold.first);
      }
      this.refreshMainTerminalPromptLine({ scrollToBottom: false });
      return;
    }

    let any = false;
    for (const id of targetIds) {
      if (this.expandThinkingViaOverlay(id)) any = true;
    }
    if (!any) {
      this.refreshMainTerminalPromptLine({ scrollToBottom: false });
      return;
    }

    const latest = targetIds[targetIds.length - 1]!;
    const fold = this.findThinkingFoldBufferLines(latest);
    term.clearSelection();
    if (fold) {
      term.scrollToLine(fold.first);
      (term as unknown as { selectLines?: (start: number, end: number) => void }).selectLines?.(fold.first, fold.first);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.thinkingAllExpanded = targetIds.every((id) => this.expandedSingleById.has(id) || this.thinkingInlineExpandedIds.has(id));
      });
    });
    this.refreshMainTerminalPromptLine({ scrollToBottom: false });
  }

  private tryDirectiveTabComplete(): void {
    const line = this.mainLineBuffer;
    if (!line.startsWith('/') || line.includes(' ')) return;
    const matches = this.visibleDirectives().filter((d) => d.name.startsWith(line));
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
    this.refreshMainTerminalPromptLine();
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
    // 自然语言路径：回车后由 commitMainTerminalUserRowForStreamRound 固化 [用户] 行；收尾由 finalize 折叠思考块
    const route = this.router.route(t);

    try {
      if (route === 'directive') {
        await this.runDirective(t);
        return;
      }
      if (route === 'natural') {
        const natural = t.startsWith('?') ? t.slice(1).trim() : t;
        // 不再隐藏输入行：保持 [用户] 行固定在原位置，后续 [思考中]/[回答] 从其下方继续输出
        await this.askAssistant(natural);
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
    let entries = result.entries;
    if (
      scope === 'workspace' &&
      path === '.' &&
      treeRoot === 'workspace' &&
      this.workspaceRootEqualsVaultRoot()
    ) {
      entries = entries.filter((e) => !(e.type === 'dir' && WORKSPACE_AT_VAULT_HIDDEN_DIRS.has(e.name)));
    }
    const nodes: FileNode[] = entries
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
        this.visibleDirectives().forEach((d) => this.aiXtermWrite(` - ${d.name.padEnd(20)} ${d.desc}\r\n`));
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
        await this.askAssistant('请根据当前 workspace 根目录，简要分析项目结构与关键入口。', {
          skipTerminalUserLineAnchor: true,
        });
        return;
      }

      case 'doctor': {
        const listFn = (window as unknown as {
          __zyfrontListRuntimeTools?: () => Array<Record<string, unknown>>;
        }).__zyfrontListRuntimeTools;
        const tools = typeof listFn === 'function' ? listFn() : [];

        const degraded = new Set([
          'web.search',
          'ask.question',
          'files.edit',
          'files.glob',
          'files.grep',
          'skill.run',
          'lsp.query',
          'mcp.list_resources',
          'mcp.read_resource',
          'workflow.run',
          'remote.trigger',
          'monitor.snapshot',
          'worktree.enter',
          'worktree.exit',
          'terminal.capture',
          'ctx.inspect',
          'agent.run',
          'notify.push',
          'userfile.send',
          'pr.subscribe',
        ]);

        const total = tools.length;
        const degradedCount = tools.filter((t) => degraded.has(String(t['name'] ?? ''))).length;
        const nativeCount = Math.max(0, total - degradedCount);

        this.aiXtermWrite(`\r\n[doctor] total=${total} native=${nativeCount} degraded=${degradedCount}\r\n`);
        tools
          .slice()
          .sort((a, b) => String(a['name'] ?? '').localeCompare(String(b['name'] ?? '')))
          .forEach((t) => {
            const name = String(t['name'] ?? '');
            const cap = degraded.has(name) ? 'degraded' : 'native';
            this.aiXtermWrite(` - ${name.padEnd(24)} ${cap}\r\n`);
          });
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

  private normalizeForSkillHit(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/[\u3000\s]+/g, ' ')
      .replace(/[\-_./]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 常见中文检索词与技能目录/正文中的英文 id 对齐（如 抖音 ↔ douyin） */
  private expandSkillMatchInput(normalized: string): string {
    if (!normalized) return normalized;
    const extra: string[] = [];
    if ((/抖音|tiktok/).test(normalized) && !/\bdouyin\b/.test(normalized)) extra.push('douyin');
    if ((/抖音|douyin/).test(normalized) && !/tiktok/.test(normalized)) extra.push('tiktok');
    if ((/微信|weixin/).test(normalized) && !/\bwechat\b/.test(normalized)) extra.push('wechat');
    return extra.length ? `${normalized} ${extra.join(' ')}` : normalized;
  }

  /**
   * 从技能元信息中提取可匹配关键词（通用方案，不对具体技能硬编码）。
   * 原则：任何技能都走同一套词元提取，抖音只是其中一个自然命中案例。
   */
  private extractSkillTokens(skill: SkillRecord): string[] {
    const source = `${skill.id} ${skill.name} ${skill.desc ?? ''} ${skill.contentPath ?? ''}`;
    const norm = this.normalizeForSkillHit(source);
    const parts = norm.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((p) => p.length >= 2);
    const out = new Set(parts);
    if (/douyin|tiktok/i.test(source)) out.add('抖音');
    return [...out];
  }

  private scoreSkillHit(userInput: string, skill: SkillRecord): number {
    if (skill.status !== 'ok') return 0;
    const inputNorm = this.expandSkillMatchInput(this.normalizeForSkillHit(userInput));
    if (!inputNorm) return 0;

    const idNorm = this.normalizeForSkillHit(skill.id);
    const nameNorm = this.normalizeForSkillHit(skill.name);
    const descNorm = this.normalizeForSkillHit(skill.desc ?? '');
    const pathNorm = this.normalizeForSkillHit(skill.contentPath ?? '');

    let score = 0;
    if (idNorm && inputNorm.includes(idNorm)) score += 6;
    if (nameNorm && inputNorm.includes(nameNorm)) score += 8;
    if (descNorm && inputNorm.includes(descNorm.slice(0, Math.min(24, descNorm.length)))) score += 2;
    if (pathNorm) {
      const tail = pathNorm.slice(-Math.min(24, pathNorm.length));
      if (tail.length >= 4 && inputNorm.includes(tail)) score += 1;
    }

    const tokens = this.extractSkillTokens(skill);
    for (const t of tokens) {
      if (inputNorm.includes(t)) {
        score += t.length >= 4 ? 3 : 1;
      }
    }

    return score;
  }

  private async reloadInstalledSkills(): Promise<void> {
    try {
      const all = await this.skillIndex.listInstalledSkills();
      this.installedSkillsCache = all.filter((s) => s.status === 'ok');
    } catch {
      this.installedSkillsCache = [];
    }
  }

  private buildSkillPromptPatch(records: SkillRecord[], markdowns: Map<string, string>): string {
    const lines: string[] = [
      '【技能强制命中】',
      `本轮命中技能数量：${records.length}`,
      '你必须优先遵循命中技能中的步骤执行（而不是泛化回复）。',
      '若技能与当前工具能力存在冲突，先说明冲突点，再给可执行替代方案。',
      '',
    ];

    records.forEach((record, idx) => {
      const md = markdowns.get(record.id) ?? '';
      const normalized = md.replace(/\r/g, '').trim();
      const compact = normalized.length > 1600 ? `${normalized.slice(0, 1600)}\n...` : normalized;
      lines.push(`[命中技能 #${idx + 1}] ${record.name}（id=${record.id}）`);
      lines.push(`技能文件：${record.contentPath}`);
      lines.push('[SKILL.md 摘要开始]');
      lines.push(compact || '（技能内容为空）');
      lines.push('[SKILL.md 摘要结束]');
      lines.push('');
    });

    return lines.join('\n');
  }

  private async enrichPromptWithInstalledSkill(userInput: string): Promise<{
    effectiveUserInput: string;
    hitSkills: SkillRecord[];
    debugReason: string;
    diagnostics: string[];
  }> {
    // 强制前置刷新：每轮发送给模型前先做技能检测，避免缓存滞后导致漏命中
    await this.reloadInstalledSkills();
    const all = this.installedSkillsCache;
    if (all.length === 0) {
      return {
        effectiveUserInput: userInput,
        hitSkills: [],
        debugReason: '未发现可用技能',
        diagnostics: ['(无已安装技能)'],
      };
    }

    try {
      const scoredAll = all
        .map((s) => ({ s, score: this.scoreSkillHit(userInput, s) }))
        .sort((a, b) => b.score - a.score || (b.s.updatedAt ?? 0) - (a.s.updatedAt ?? 0));
      const diagnostics = scoredAll.map(({ s, score }) => {
        if (score > 0) return `✅ ${s.name} (${s.id})：命中，score=${score}`;
        return `❌ ${s.name} (${s.id})：未命中（基础评分=0，需内容兜底）`;
      });

      let ranked = scoredAll
        .filter((x) => x.score > 0)
        .slice(0, MAX_AUTO_HIT_SKILLS_PER_TURN)
        .map((x) => x.s);

      // 通用兜底：若基础评分未命中，则重读 SKILL.md 做内容词元匹配（非抖音硬编码）
      if (ranked.length === 0) {
        const inputNorm = this.expandSkillMatchInput(this.normalizeForSkillHit(userInput));
        for (const s of all) {
          const md = await this.skillIndex.readSkillMd(s);
          if (!md.ok || !md.content.trim()) continue;
          const contentNorm = this.normalizeForSkillHit(md.content);
          const metaTokens = this.extractSkillTokens(s);
          const mdTokens = contentNorm
            .split(/[^a-z0-9\u4e00-\u9fff]+/i)
            .filter((p) => p.length >= 2)
            .slice(0, 800);
          const tokenSet = [...new Set([...metaTokens, ...mdTokens])];

          let hits = 0;
          for (const token of tokenSet) {
            if (token.length < 2) continue;
            if (inputNorm.includes(token)) {
              hits += token.length >= 4 ? 2 : 1;
              if (hits >= 3) {
                ranked = [s];
                break;
              }
            }
          }
          if (ranked.length > 0) break;
        }
      }

      if (ranked.length === 0) {
        const debug = all
          .slice(0, 8)
          .map((s) => `${s.name}(${s.id}):${this.scoreSkillHit(userInput, s)}`)
          .join(' | ');
        return {
          effectiveUserInput: userInput,
          hitSkills: [],
          debugReason: `未命中；候选得分：${debug || 'none'}`,
          diagnostics,
        };
      }

      const markdowns = new Map<string, string>();
      const okSkills: SkillRecord[] = [];
      for (const skill of ranked) {
        const md = await this.skillIndex.readSkillMd(skill);
        if (!md.ok || !md.content.trim()) continue;
        markdowns.set(skill.id, md.content);
        okSkills.push(skill);
      }

      if (okSkills.length === 0)
        return {
          effectiveUserInput: userInput,
          hitSkills: [],
          debugReason: '候选技能读取失败或内容为空',
          diagnostics,
        };

      const tail = `【已命中技能：${okSkills.map((s) => `${s.name}（${s.id}）`).join('，')}】`;
      const scoreDebug = okSkills
        .map((s) => `${s.name}(${s.id}):${this.scoreSkillHit(userInput, s)}`)
        .join(' | ');
      const patch = this.buildSkillPromptPatch(okSkills, markdowns);
      return {
        effectiveUserInput: `${userInput}\n${tail}\n\n${patch}`,
        hitSkills: okSkills,
        debugReason: `命中；得分：${scoreDebug}`,
        diagnostics,
      };
    } catch {
      return {
        effectiveUserInput: userInput,
        hitSkills: [],
        debugReason: '检测异常（已回退为不注入技能）',
        diagnostics: all.map((s) => `⚠️ ${s.name} (${s.id})：检测异常`),
      };
    }
  }

  private async askAssistant(
    raw: string,
    opts?: { skipTerminalUserLineAnchor?: boolean },
  ): Promise<void> {
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
    this.resetThinkingStreamState();
    this.mergeThinkingBlocksFromSession();
    // 默认不把普通 delta 归入 Thinking，避免无 tool_call 的轮次把 Answer 吞掉
    this.streamRouteDeltaToThinking = false;
    this.terminalBusy.set(true);
    this.streamRequestStartMs = Date.now();

    const cfg = this.readModelRequestUiConfig();
    this.commitMainTerminalUserRowForStreamRound(trimmed, cfg, {
      skipTerminalUserLineAnchor: opts?.skipTerminalUserLineAnchor,
    });
    const { effectiveUserInput, hitSkills, debugReason, diagnostics } = await this.enrichPromptWithInstalledSkill(trimmed);
    this.currentTurnHitSkillLabel =
      hitSkills.length > 0 ? hitSkills.map((s) => `${s.name} (${s.id})`).join('，') : null;

    this.currentTurnSkillEchoedToXterm = false;
    this.currentTurnSkillLines = [];
    if (cfg.showSkillHitBanner) {
      this.currentTurnSkillLines.push('\x1b[90m[Skill]\x1b[0m 检测摘要（实际最多注入 3 条至模型）：');
      const shown = diagnostics.slice(0, MAX_SKILL_DIAGNOSTIC_LINES_IN_BANNER);
      for (const line of shown) {
        this.currentTurnSkillLines.push(`  ${line}`);
      }
      if (diagnostics.length > shown.length) {
        this.currentTurnSkillLines.push(
          `  \x1b[90m… 其余 ${diagnostics.length - shown.length} 条已省略（列表仅展示；未省略项仍参与评分）\x1b[0m`,
        );
      }
      if (hitSkills.length > 0) {
        this.currentTurnSkillLines.push(`\x1b[32m[Skill]\x1b[0m 命中：${this.currentTurnHitSkillLabel}`);
      } else {
        this.currentTurnSkillLines.push(`\x1b[33m[Skill]\x1b[0m 未命中：${debugReason}`);
      }
      for (const skillLine of this.currentTurnSkillLines) {
        const w = `\r\n${skillLine}`;
        this.aiXtermWrite(w);
        this.bumpStreamLineBudgetForWrite(w);
      }
      this.currentTurnSkillEchoedToXterm = true;
    }
    const hasZytrader = typeof (window as unknown as { zytrader?: unknown }).zytrader !== 'undefined';
    const { stream, cancel } = this.runtime.assistant.stream(SESSION_ID, {
      userInput: effectiveUserInput,
      config: this.runtime.client.getModel(),
      ...(hasZytrader ? { systemPrompt: WORKBENCH_ELECTRON_TOOLS_SYSTEM_PROMPT } : {}),
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

      const cfgSnap = this.readModelRequestUiConfig();
      const thinkingSnap = this.thinkingBuffer;
      const thinkingHasNc = this.thinkingHasNonChinese;
      const answerSnap = this.roundAnswerAccumulator;

      const hadThinkingRound =
        Boolean(thinkingSnap.trim()) ||
        (Boolean(cfgSnap.showThinking) && this.thinkingHeaderShown && !cfgSnap.thinkingVerboseMode);

      if (!streamFailed && hadThinkingRound && !(cfgSnap.showThinking && cfgSnap.thinkingVerboseMode)) {
        this.finalizeAssistantStreamUi({
          ok: true,
          interrupted: this.streamInterruptRequested,
          userPrompt: trimmed,
          thinking: thinkingSnap,
          thinkingHasNonChinese: thinkingHasNc,
          answer: answerSnap,
          layoutSplitThinkingAnswer: cfgSnap.layoutSplitThinkingAnswer,
          thinkingToggleShortcut: cfgSnap.thinkingToggleShortcut,
          thinkingToggleAllShortcut: cfgSnap.thinkingToggleAllShortcut,
        });
      }

      this.resetThinkingStreamState();

      if (this.streamInterruptRequested) {
        this.aiXtermWrite('\r\n\x1b[33m[已中断]\x1b[0m\r\n');
        this.streamInterruptRequested = false;
      } else if (!streamFailed) {
        await this.appendRecentTurnAfterSuccess(trimmed);
        try {
          await this.triggerMemoryPipelineFromHistory(trimmed);
        } catch {
          /* 记忆管道失败不向主终端刷屏 */
        }
        await this.syncPlanStepsFromLastAssistant();
        this.syncCoordinatorState();
      }
    }
  }

  private pushHistory(input: string): void {
    const current = this.inputHistory();
    const next = [...current.filter((x) => x !== input), input].slice(-100);
    this.inputHistory.set(next);
    this.historyNavIndex = null;
  }

  /** 主终端命令历史导航：delta=-1 上一条，delta=1 下一条 */
  private navigateHistory(delta: -1 | 1): void {
    const all = this.inputHistory();
    if (all.length === 0) return;

    let idx = this.historyNavIndex;
    if (idx === null) {
      idx = delta < 0 ? all.length - 1 : all.length;
    } else {
      idx = Math.max(0, Math.min(all.length, idx + delta));
    }

    this.historyNavIndex = idx;
    if (idx >= all.length) {
      this.mainLineBuffer = '';
    } else {
      this.mainLineBuffer = all[idx] ?? '';
    }
    this.redrawInputLine();
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

    this.psXtermContextMenu = (ev: Event) => {
      const e = ev as MouseEvent;
      e.preventDefault();
      const term = this.psTerminal;
      if (!term) return;
      const id = this.activePsSessionId();
      if (!id) return;
      const sel = term.getSelection();
      if (sel.length > 0) {
        void navigator.clipboard.writeText(sel);
        term.clearSelection();
        return;
      }
      void navigator.clipboard.readText().then((t) => {
        if (t) void window.zytrader.terminal.write({ id, data: t });
      });
    };
    host.addEventListener('contextmenu', this.psXtermContextMenu);

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
      this.refreshMainTerminalPromptLine();
      return;
    }
    this.mainLineBuffer = '';
    this.clearSlashHintRow();
    this.directiveTabCycle = 0;
    this.aiXtermWrite(`\r\n\x1b[32m>\x1b[0m ${line}\r\n`);
    await this.dispatchMainTerminalLine(line);
  }

  private readModelRequestUiConfig(): {
    showThinking: boolean;
    showToolActivity: boolean;
    showSkillHitBanner: boolean;
    thinkingCollapsedByDefault: boolean;
    thinkingVerboseMode: boolean;
    layoutSplitThinkingAnswer: boolean;
    thinkingToggleShortcut: string;
    thinkingToggleAllShortcut: string;
  } {
    const defaults = {
      showThinking: true,
      showToolActivity: false,
      showSkillHitBanner: true,
      thinkingCollapsedByDefault: true,
      thinkingVerboseMode: false,
      layoutSplitThinkingAnswer: true,
      thinkingToggleShortcut: 'Ctrl+O',
      thinkingToggleAllShortcut: 'Ctrl+Shift+O',
    };

    try {
      const raw = localStorage.getItem(REQUEST_CFG_JSON_KEY);
      const parsed = raw?.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};

      const showThinking = parsed['show_thinking'] !== false && parsed['showThinking'] !== false;
      const showToolActivity = parsed['show_tool_activity'] === true || parsed['showToolActivity'] === true;
      const showSkillHitBanner = parsed['show_skill_hit_banner'] !== false && parsed['showSkillHitBanner'] !== false;
      const thinkingCollapsedByDefault =
        parsed['thinking_collapsed_by_default'] !== false && parsed['thinkingCollapsedByDefault'] !== false;
      const thinkingVerboseMode =
        parsed['thinking_verbose_mode'] === true || parsed['thinkingVerboseMode'] === true;
      const layoutSplitThinkingAnswer =
        parsed['layout_split_thinking_answer'] !== false && parsed['layoutSplitThinkingAnswer'] !== false;

      const thinkingToggleShortcut =
        typeof parsed['thinking_toggle_shortcut'] === 'string' && parsed['thinking_toggle_shortcut'].trim()
          ? parsed['thinking_toggle_shortcut'].trim()
          : typeof parsed['thinkingToggleShortcut'] === 'string' && parsed['thinkingToggleShortcut'].trim()
            ? parsed['thinkingToggleShortcut'].trim()
            : defaults.thinkingToggleShortcut;

      const thinkingToggleAllShortcut =
        typeof parsed['thinking_toggle_all_shortcut'] === 'string' && parsed['thinking_toggle_all_shortcut'].trim()
          ? parsed['thinking_toggle_all_shortcut'].trim()
          : typeof parsed['thinkingToggleAllShortcut'] === 'string' && parsed['thinkingToggleAllShortcut'].trim()
            ? parsed['thinkingToggleAllShortcut'].trim()
            : defaults.thinkingToggleAllShortcut;

      const next = {
        showThinking,
        showToolActivity,
        showSkillHitBanner,
        thinkingCollapsedByDefault,
        thinkingVerboseMode,
        layoutSplitThinkingAnswer,
        thinkingToggleShortcut,
        thinkingToggleAllShortcut,
      };

      const normalizedForStore = {
        ...(parsed as Record<string, unknown>),
        show_thinking: next.showThinking,
        show_tool_activity: next.showToolActivity,
        show_skill_hit_banner: next.showSkillHitBanner,
        thinking_collapsed_by_default: next.thinkingCollapsedByDefault,
        thinking_verbose_mode: next.thinkingVerboseMode,
        layout_split_thinking_answer: next.layoutSplitThinkingAnswer,
        thinking_toggle_shortcut: next.thinkingToggleShortcut,
        thinking_toggle_all_shortcut: next.thinkingToggleAllShortcut,
      };
      localStorage.setItem(REQUEST_CFG_JSON_KEY, JSON.stringify(normalizedForStore, null, 2));
      return next;
    } catch {
      const fallbackStore = {
        show_thinking: defaults.showThinking,
        show_tool_activity: defaults.showToolActivity,
        show_skill_hit_banner: defaults.showSkillHitBanner,
        thinking_collapsed_by_default: defaults.thinkingCollapsedByDefault,
        thinking_verbose_mode: defaults.thinkingVerboseMode,
        layout_split_thinking_answer: defaults.layoutSplitThinkingAnswer,
        thinking_toggle_shortcut: defaults.thinkingToggleShortcut,
        thinking_toggle_all_shortcut: defaults.thinkingToggleAllShortcut,
      };
      localStorage.setItem(REQUEST_CFG_JSON_KEY, JSON.stringify(fallbackStore, null, 2));
      return defaults;
    }
  }

  private resetThinkingStreamState(): void {
    this.thinkingHeaderShown = false;
    this.answerHeaderShown = false;
    this.thinkingBuffer = '';
    this.thinkingPrintedLen = 0;
    this.thinkingHasNonChinese = false;
    this.streamConsumedLines = 0;
    this.roundAnswerAccumulator = '';
    this.streamToolEchoes = [];
    this.streamingThinkingBlockId = null;
    this.streamRouteDeltaToThinking = false;
    this.currentTurnHitSkillLabel = null;
    this.currentTurnSkillLines = [];
    this.currentTurnSkillEchoedToXterm = false;
    this.disposeAssistantStreamOutputStartMarker();
  }

  private highlightThinkingSteps(text: string): string {
    if (!text) return text;
    return text
      .replace(/(第\s*[一二三四五六七八九十\d]+\s*步)/g, '\x1b[36m$1\x1b[0m')
      .replace(/(step\s*\d+)/gi, '\x1b[36m$1\x1b[0m');
  }

  private sanitizeThinkingForDisplay(text: string): string {
    if (!text) return text;
    const lines = text.split(/\r?\n/);
    const cleaned = lines
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        const hasHan = /[\u4e00-\u9fff]/.test(t);
        const asciiWords = t.match(/[A-Za-z]{3,}/g)?.length ?? 0;
        if (!hasHan && asciiWords >= 4) return '[内容已折叠：英文思考段]';
        return line;
      })
      .join('\n');
    return cleaned;
  }

  private matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
    const norm = shortcut.toLowerCase().replace(/\s+/g, '');
    const parts = norm.split('+').filter(Boolean);
    const wantsCtrl = parts.includes('ctrl') || parts.includes('control');
    const wantsShift = parts.includes('shift');
    const wantsAlt = parts.includes('alt');
    const wantsMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command');
    const keyToken = parts.find((p) => !['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd', 'command'].includes(p));
    if (!keyToken) return false;

    if (Boolean(event.ctrlKey) !== wantsCtrl) return false;
    if (Boolean(event.shiftKey) !== wantsShift) return false;
    if (Boolean(event.altKey) !== wantsAlt) return false;
    if (Boolean(event.metaKey) !== wantsMeta) return false;

    const evtKey = event.key.toLowerCase();
    if (keyToken.length === 1) return evtKey === keyToken;
    return evtKey === keyToken || event.code.toLowerCase() === `key${keyToken}`;
  }

  private aiXtermWrite(text: string): void {
    this.xterm?.write(text.replaceAll('\n', '\r\n'));
  }
}
