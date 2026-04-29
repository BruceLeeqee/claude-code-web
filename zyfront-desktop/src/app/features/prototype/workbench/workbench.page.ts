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
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NgFor, NgIf, NgTemplateOutlet, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { ActivatedRoute } from '@angular/router';
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
import { MODEL_CATALOG, findCatalogEntry, type ModelCatalogEntry } from '../../../core/model-catalog';
import { ModelUsageLedgerService } from '../../../core/model-usage-ledger.service';
import { AgentMemoryService } from '../../../core/agent-memory.service';
import { SkillIndexService, type SkillRecord } from '../../../core/skill-index.service';
import { PromptMemoryBuilderService } from '../../../core/memory/prompt-memory-builder.service';
import { PromptBuildContextService } from '../../../core/memory/prompt-build-context.service';
import { PromptDebugReportService } from '../../../core/memory/prompt-debug-report.service';
import { Terminal, type IDisposable, type IMarker } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import type { ChatMessage, CoordinationMode, CoordinationStep, StreamChunk } from 'zyfront-core';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../../core/zyfront-core.providers';
import { TerminalMemoryGraphService } from '../../../core/terminal-memory-graph.service';
import { CommandRouterService } from './command-router.service';
import { CommandProcessingService } from './command-processing.service';
import { CommandExecutorService } from './command-executor.service';
import { InputPreprocessorService } from './input-preprocessor.service';
import { WorkbenchAssistantFlowService } from './workbench-assistant-flow.service';
import { WorkbenchAssistantStreamService } from './workbench-assistant-stream.service';
import { WorkbenchAssistantStreamCoordinatorService } from './workbench-assistant-stream-coordinator.service';
import { WorkbenchAssistantModeExecutorService } from './workbench-assistant-mode-executor.service';
import { WorkbenchAssistantModeFlowService } from './workbench-assistant-mode-flow.service';
import { DIRECTIVE_REGISTRY, isCoordinationMode, parseDirective, getModeDirectives, type DirectiveDefinition } from './directive-registry';
import { Subscription } from 'rxjs';
import { type TurnContext } from '../../../core/memory/memory.types';
import { MultiAgentOrchestratorService } from '../../../core/multi-agent/multi-agent.orchestrator.service';
import type { TeammateMode, WorkbenchTeamVm } from '../../../core/multi-agent/multi-agent.types';
import type { MultiAgentEvent } from '../../../core/multi-agent/multi-agent.events';
import { MultiAgentSidebarComponent } from '../../../core/multi-agent/multi-agent-sidebar.component';
import { WorkbenchModeService } from '../../../core/multi-agent/services/workbench-mode.service';
import { MultiAgentEventBusService } from '../../../core/multi-agent/multi-agent.event-bus.service';
import { EVENT_TYPES } from '../../../core/multi-agent/multi-agent.events';
import { TerminalSessionHostService } from './services/terminal/terminal-session-host.service';
import { ThinkingBlockStateMachineService } from './services/terminal/thinking-block-state-machine.service';
import { TerminalBlockRendererService } from './services/terminal/terminal-block-renderer.service';
import { SessionReplayCoordinatorService } from './services/terminal/session-replay-coordinator.service';
import { TurnMetadataService } from './services/terminal/turn-metadata.service';
import { CommandPresentationService } from './services/terminal/command-presentation.service';
import { TerminalDisplayDebugService } from './services/terminal/terminal-display-debug.service';
import { WorkbenchContextService } from './services/workbench-context.service';
import { DebugTabStateService } from './debug/debug-tab-state.service';
import { DebugCommandService } from './debug/debug-command.service';
import { LoopCommandService } from './debug/loop-command.service';
import { LoopExecutorService } from './debug/loop-executor.service';
import { restoreWorkbenchSessionState } from './utils/workbench-session-restore';

type MultiAgentTimelineTier = 'info' | 'success' | 'warning' | 'error';

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

/** Phase 3-A：每个 Agent Tab 的会话历史/记忆落盘（按 agentId 分区，统一存一个 vault 文件，避免 mkdir 依赖） */
const WORKBENCH_AGENT_SESSIONS_VAULT_PATH = '02-AGENT-MEMORY/01-Short-Term/workbench-agent-sessions.v1.json';

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
  '04-PROJECTS',
  '05-RESOURCES',
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
    { name: '03-Roles', path: '03-AGENT-TOOLS/03-Roles' },
    { name: '04-Structs', path: '03-AGENT-TOOLS/04-Structs' },
    { name: '05-Teams', path: '03-AGENT-TOOLS/05-Teams' },
    { name: '06-Tasks', path: '03-AGENT-TOOLS/06-Tasks' },
    { name: '07-Messages', path: '03-AGENT-TOOLS/07-Messages' },
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
  t = t.replace(/^\[(?:回答|超体|架构师|助手)\]\s*/m, '');
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
function extractReplayThinkingAndAnswer(content: string): { thinking: string; answer: string } {
  const raw = String(content ?? '').replace(/\r\n/g, '\n');
  const thinkingBlocks = [...raw.matchAll(/\[(?:Thinking|思考中)\s*#?\d*\][\s\S]*?(?=(?:\n\[(?:Thinking|回答|超体|助手)|$))/gi)].map((m) => m[0]);
  const latestThinking = thinkingBlocks.length > 0 ? thinkingBlocks[thinkingBlocks.length - 1] : '';
  let thinking = latestThinking || '';
  if (thinking) {
    thinking = thinking.replace(/^\[(?:Thinking|思考中)\s*#?\d*\]\s*/i, '');
    thinking = thinking.replace(/^\s*[-—•·]{2,}\s*/gm, '');
    thinking = thinking.replace(/^(?:\s*\[(?:Answer|回答|超体|助手)\].*)$/gim, '').trim();
  }

  let answer = raw;
  const lastAnswerIdx = Math.max(
    answer.lastIndexOf('[超体]'),
    answer.lastIndexOf('[回答]'),
    answer.lastIndexOf('[助手]'),
  );
  if (lastAnswerIdx >= 0) answer = answer.slice(lastAnswerIdx).replace(/^\[(?:超体|回答|助手)\]\s*/i, '');
  else if (latestThinking) answer = answer.slice(raw.lastIndexOf(latestThinking) + latestThinking.length);
  answer = stripAssistantContentForHistoryReplay(answer);
  if (thinking) {
    const idx = answer.indexOf(thinking);
    if (idx >= 0) answer = answer.slice(idx + thinking.length).trim();
  }
  return { thinking, answer };
}

function splitReplayLines(content: string): string[] {
  return String(content ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''));
}

function renderReplayThinkingBox(thinking: string): string {
  const cleaned = stripAssistantContentForHistoryReplay(thinking);
  const lines = splitReplayLines(cleaned).filter(Boolean).slice(-3);
  const displayLines = lines.length > 0 ? lines : [''];
  const width = Math.max(18, ...displayLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').length));
  const top = `┌${'─'.repeat(width + 2)}┐`;
  const body = displayLines.map((line) => `│ ${line.padEnd(width)} │`);
  const hint = `│ ${'…仅保留最新 3 行'.padEnd(width)} │`;
  const bottom = `└${'─'.repeat(width + 2)}┘`;
  return [top, ...body.slice(0, 3), hint, bottom].join('\n');
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
  /** 该会话完整消息序列（用于回放） */
  transcript?: RecentTranscriptLine[];
  /** transcript 详情文件路径（vault 相对路径） */
  transcriptPath?: string;
  /** 每条最近会话记录对应的 session 记忆文件路径 */
  sessionMemoryPath?: string;
  /** 最近会话摘要（直接展示，替代折叠 transcript） */
  summary?: string;
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

interface RightPanelChangedFile {
  path: string;
  status: string;
  mtime: string;
}

interface GitCommitLine {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

/** 思考块元数据：与终端 buffer 解耦的纯数据模型 */
interface ThinkingBlockRecord {
  text: string;
  hasNonChinese: boolean;
  foldSuffixAnsi: string;
  hintPhysicalRows: number;
  tagEndCol0: number;
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
    WorkbenchMonacoEditorComponent,
    MultiAgentSidebarComponent,
    NgSwitch,
    NgSwitchCase,
    NgSwitchDefault,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workbench.page.html',
  styleUrls: ['../prototype-page.scss', './workbench.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkbenchPageComponent implements AfterViewInit, OnDestroy {
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly router = inject(CommandRouterService);
  private readonly route = inject(ActivatedRoute);
  protected readonly appSettings = inject(AppSettingsService);
  private readonly usageLedger = inject(ModelUsageLedgerService);
  private readonly memoryGraph = inject(TerminalMemoryGraphService);
  private readonly agentMemory = inject(AgentMemoryService);
  private readonly promptMemoryBuilder = inject(PromptMemoryBuilderService);
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

  @ViewChild(MultiAgentSidebarComponent, { static: false })
  private multiAgentSidebar?: MultiAgentSidebarComponent;

  @ViewChild('debugXtermHost', { static: false })
  private debugXtermHost?: ElementRef<HTMLDivElement>;

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
  private readonly debugTabs = ['Debug / Prompt', 'Debug / Memory', 'Debug / Workbench'] as const;
  protected readonly terminalBusy = signal(false);
  protected readonly visibleTabs = computed(() => this.tabs());

  /** Tab=会话 映射（tab label -> sessionId）。 */
  private readonly agentIdByTab = new Map<string, string>();
  private nextAgentTabSeq = 1;
  protected readonly agentChatInput = signal('');

  private readonly inputHistory = signal<string[]>([]);

  protected readonly directives: DirectiveDefinition[] = DIRECTIVE_REGISTRY;
  protected readonly visibleDirectives = computed(() => this.directives);

  protected readonly coordinatorMode = signal<'single' | 'plan' | 'parallel'>('single');

  /** 兼容旧模板/方法名：最近会话与展开状态 */
  protected readonly recentTurns = signal<RecentTurn[]>([]);
  protected readonly selectedRecentTurnId = signal<string | null>(null);
  protected readonly expandedRecentTurnId = signal<string | null>(null);
  protected readonly recentThinkingVisibleIds = signal<string[]>([]);

  /** 兼容旧模板/方法名：计划 / 记忆 / 统计 */
  protected readonly planSteps = signal<string[]>([]);
  protected readonly memoryItems = signal<MemoryVm[]>([]);
  protected readonly stepTotal = signal(0);
  protected readonly stepDone = signal(0);
  protected readonly stepInProgress = signal(0);
  protected readonly stepPending = signal(0);
  protected readonly toolCallCount = signal(0);
  protected readonly sessionCostUsd = signal(0);

  protected readonly teammateTeamVm = signal<WorkbenchTeamVm | null>(null);
  protected readonly teammateBackendMode = signal<TeammateMode>('auto');
  protected readonly focusedTeammateId = signal('');
  protected readonly teammateSpawnName = signal('');
  protected readonly teammateSpawnPrompt = signal('');
  protected readonly eventReadableMode = signal<'user' | 'technical'>('user');
  protected readonly workbenchRecoveryStorageKey = 'zyfront:workbench:recovery:v1';
  protected readonly recoveryAvailable = signal(false);
  protected readonly recoverySyncedAt = signal('');
  protected readonly actionAttemptCount = signal(0);
  protected readonly actionLatencyMs = signal<number[]>([]);
  protected readonly actionFailureCount = signal(0);
  protected readonly retryCount = signal(0);
  protected readonly actionFeedback = signal<{ tier: MultiAgentTimelineTier; text: string } | null>(null);
  protected readonly agentSessionsById = signal<Record<string, { agentId: string; createdAt: number; updatedAt: number; messages: { at: number; role: 'leader' | 'user' | 'teammate' | 'system'; text: string }[] }>>({});

  private readonly multiAgent = inject(MultiAgentOrchestratorService);
  private readonly workbenchMode = inject(WorkbenchModeService);
  private readonly multiAgentEventBus = inject(MultiAgentEventBusService);
  private readonly terminalHost = inject(TerminalSessionHostService);
  private readonly thinkingStateMachine = inject(ThinkingBlockStateMachineService);
  private readonly blockRenderer = inject(TerminalBlockRendererService);
  private readonly replayCoordinator = inject(SessionReplayCoordinatorService);
  private readonly turnMetadata = inject(TurnMetadataService);
  private readonly commandPresentation = inject(CommandPresentationService);
  private readonly displayDebug = inject(TerminalDisplayDebugService);
  private readonly workbenchContext = inject(WorkbenchContextService);
  private readonly promptBuildContext = inject(PromptBuildContextService);
  private readonly promptDebugReport = inject(PromptDebugReportService);
  private readonly debugCommand = inject(DebugCommandService);
  private readonly debugTabState = inject(DebugTabStateService);
  private readonly commandProcessing = inject(CommandProcessingService);
  private readonly commandExecutor = inject(CommandExecutorService);
  private readonly loopCommand = inject(LoopCommandService);
  private readonly loopExecutor = inject(LoopExecutorService);
  private readonly inputPreprocessor = inject(InputPreprocessorService);
  private readonly assistantFlow = inject(WorkbenchAssistantFlowService);
  private readonly assistantStream = inject(WorkbenchAssistantStreamService);
  private readonly assistantStreamCoordinator = inject(WorkbenchAssistantStreamCoordinatorService);
  private readonly assistantModeExecutor = inject(WorkbenchAssistantModeExecutorService);
  private readonly assistantModeFlow = inject(WorkbenchAssistantModeFlowService);

  protected readonly llmAvailable = signal(this.hasLlmConfigured());

  /** 左侧：资源管理器 / 搜索 / Git */
  protected readonly sidebarView = signal<SidebarView>('explorer');
  
  /** 三个可折叠区域的状态 */
  protected readonly projectTreeExpanded = signal(true);
  protected readonly recentSessionsExpanded = signal(false);
  protected readonly memoryVaultExpanded = signal(false);
  protected readonly gitChangesExpanded = signal(true);
  protected readonly gitCommitsExpanded = signal(true);
  
  /** Vault根目录固定目录列表 */
  protected readonly vaultExplorerTop = VAULT_EXPLORER_TOP;
  
  /** 记忆仓库的树节点 */
  protected readonly memoryVaultTree = signal<FileNode[]>([]);
  
  protected readonly gitBranch = signal('');
  protected readonly gitBranchRefs = signal<GitBranchRef[]>([]);
  protected readonly gitChangedFiles = signal<GitChangedFile[]>([]);
  protected readonly gitCommits = signal<GitCommitLine[]>([]);
  protected readonly gitBusy = signal(false);
  protected readonly branchMenuOpen = signal(false);
  protected readonly gitCommitDetailOpen = signal(false);
  protected readonly gitCommitDetailText = signal('');
  protected readonly gitUiMessage = signal('');

  protected readonly taskListExpanded = signal(false);
  protected readonly changedFilesExpanded = signal(true);
  protected readonly rightPanelChangedFiles = signal<RightPanelChangedFile[]>([]);
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
  protected readonly debugTabPinnedSession = signal<Record<string, string | undefined>>({});

  protected readonly searchQuery = signal('');
  protected readonly searchBusy = signal(false);
  protected readonly searchHits = signal<SearchHit[]>([]);
  protected readonly searchMessage = signal('');

  protected readonly composerDraft = signal('');
  protected readonly composerImages = signal<string[]>([]);
  protected readonly recentSessionItems = signal<RecentTurn[]>([]);

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

  /** Debug 终端 xterm 实例 */
  private debugXterm?: Terminal;
  private debugFitAddon?: FitAddon;
  private debugResizeObserver?: ResizeObserver;
  private debugLineBuffer = '';
  private debugTerminalInitialized = false;

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
  protected readonly activePsCwdPresetId = signal<PsCwdPresetId>('workspace-root');
  /** ??? Backspace?????????? xterm/?? IME ? onData ????? */
  private xtermBackspaceKeydown?: (e: Event) => void;
  private aiXtermContextMenu?: (e: Event) => void;
  private psXtermContextMenu?: (e: Event) => void;
  private backspaceHandledTs = 0;
  private lastInputRowCount = 1;

  private mainLineBuffer = '';
  private mainEscSkip = false;
  private mainEscAcc = '';
  /** 输入历史游标（ArrowUp/ArrowDown） */
  private historyNavIndex: number | null = null;
  /** 输入 / 指令时：下一行显示同前缀补全，避免刷屏 */
  private slashHintRowActive = false;
  /** 当前 slash hint 占用的物理行数（用于清除时恢复终端） */
  private slashHintRowCount = 0;

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
  /** 本轮助手回答输出缓冲（避免逐字输出） */
  private answerBuffer = '';
  private answerPrintedLen = 0;
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
  private thinkingBlocksById = new Map<number, ThinkingBlockRecord>();
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
  /** 连续换行过滤状态 */
  private lastAnswerCharWasNewline = false;
  private consecutiveNewlineCount = 0;
  /** 是否已至少完成一轮对话（用于决定是否在 [用户] 前画分隔线） */
  private hasCompletedTurn = false;
  private directiveTabCycle = 0;

  protected readonly leftPanelVisible = signal(true);
  /** 为 true 时渲染底部 PTY；默认开启以便首次进入即可初始化真实 Shell */
  protected readonly terminalMenuVisible = signal(true);
  protected readonly rightPanelVisible = signal(true);

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
  private routeQuerySub?: Subscription;
  private recentTurnsMemoryPath?: string;
  private recentTurnsIndexPath?: string;
  /** 工具调用轨迹，与历史消息合并为右栏「记忆」 */
  private readonly toolMemoryTrace = signal<MemoryVm[]>([]);

  constructor() {
    void this.bootstrapWorkspace();
    void this.loadAgentSessionsFromVault();
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
    this.routeQuerySub = this.route.queryParamMap.subscribe((params) => {
      const focusAgent = (params.get('focusAgent') ?? '').trim();
      if (!focusAgent) return;
      this.focusedTeammateId.set(focusAgent);
      this.rightPanelVisible.set(true);
      this.scrollFocusedTeammateIntoView();
    });
    this.loadWorkbenchRecoveryMeta();
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
    restoreWorkbenchSessionState();
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
    this.routeQuerySub?.unsubscribe();
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

  private ensureDebugTab(domain: 'prompt' | 'memory' | 'workbench'): string {
    const tab = `Debug / ${domain[0].toUpperCase()}${domain.slice(1)}`;
    this.addTabIfMissing(tab);
    return tab;
  }

  protected displayTabLabel(tab: string): string {
    if (tab === 'Terminal - Main') return tab;
    if (tab.startsWith('Debug / ')) return tab;
    let plain = tab.startsWith('↔ ') ? tab.slice(2).trim() : tab;
    if (/^(vault|workspace):/.test(plain)) {
      plain = plain.replace(/^(vault|workspace):/, '');
    }
    return plain.split('/').pop() ?? plain;
  }

  protected isDebugTab(tab: string): boolean {
    return tab.startsWith('Debug / ');
  }

  protected isLoopTab(tab: string): boolean {
    return tab.startsWith('Loop / ');
  }

  /** 是否为终端型 tab（debug 或 loop），共享同一个 xterm 面板 */
  protected isTerminalTab(tab: string): boolean {
    return this.isDebugTab(tab) || this.isLoopTab(tab);
  }

  protected debugTabViewModel(tab: string): import('./debug/debug-command.types').DebugTabViewModel | null {
    const payload = this.currentDebugPayload();
    if (!payload) return null;
    // 当 activeTab 是 debug tab 时直接返回当前 payload
    return payload.viewModel;
  }

  protected async openDebugPromptTab(): Promise<void> {
    await this.openDebugTab('prompt', this.activeDebugSessionId());
  }

  protected async openDebugMemoryTab(): Promise<void> {
    await this.openDebugTab('memory', this.activeDebugSessionId());
  }

  protected async openDebugWorkbenchTab(): Promise<void> {
    await this.openDebugTab('workbench', this.activeDebugSessionId());
  }

  protected currentDebugPayload = signal<import('./debug/debug-command.types').DebugTabPayload | null>(null);

  // ── Loop 需求收集 & 双模式视图状态 ──
  /** 是否正在主终端进行 loop 需求澄清对话 */
  protected readonly loopGatheringMode = signal(false);
  /** loop 需求收集的原始目标 */
  protected readonly loopGatheringGoal = signal('');
  /** /loop 是否建议多智能体协作 */
  protected readonly loopPendingUseMultiAgent = signal(false);
  /** /loop 是否已回显过用户输入，避免重复写入 */
  protected readonly loopInputEchoed = signal(false);
  /** Loop 视图模式：'cards'（卡片，默认）| 'terminal'（命令行） */
  protected readonly loopViewMode = signal<'cards' | 'terminal'>('cards');
  /** 当前 Loop 会话状态（从 LoopCommandService 获取） */
  protected readonly currentLoopState = signal<import('./debug/loop-command.types').LoopState | null>(null);

  // ── Team Struct 确认模式 ──
  /** 是否正在主终端等待 struct 方案确认 */
  protected readonly structConfirmMode = signal(false);
  /** 待确认的 struct 名称 */
  protected readonly structConfirmName = signal('');
  /** struct 确认模式是否已回显过用户输入 */
  protected readonly structConfirmInputEchoed = signal(false);

  // ── 多任务管理 ──
  /** 所有 Loop 任务的摘要列表 */
  protected readonly loopTaskList = signal<import('./debug/loop-command.types').LoopState[]>([]);
  /** 当前活动查看的 Loop 任务 sessionId */
  protected readonly activeLoopSessionId = signal<string>('');
  /** 当前选中的文档 ID（用于高亮） */
  protected readonly selectedDocId = signal<string>('');

  /** Loop 自动调度 interval ID（用于停止调度） */
  private loopScheduleIntervalId: ReturnType<typeof setInterval> | null = null;
  /** 按 sessionId 分组的日志缓冲（支持多任务切换查看） */
  private loopLogBuffers = new Map<string, string[]>();
  /** Loop 日志缓冲的最大行数 */
  private readonly LOOP_LOG_BUFFER_MAX = 100;

  /** 切换 Loop 视图模式 */
  protected toggleLoopViewMode(): void {
    this.loopViewMode.set(this.loopViewMode() === 'cards' ? 'terminal' : 'cards');
    if (this.loopViewMode() === 'terminal') {
      setTimeout(() => {
        this.initDebugXterm();
        this.debugFitAddon?.fit();
        this.debugXterm?.focus();
      }, 0);
    }
  }

  /** 刷新当前 LoopState */
  protected refreshLoopState(): void {
    const state = this.loopCommand.get(SESSION_ID);
    this.currentLoopState.set(state);
    // 同步更新 loopTaskList 中该任务的最新状态
    if (state) {
      this.loopTaskList.update((list) =>
        list.map((t) => t.taskId === state.taskId ? state : t),
      );
    }
  }

  /** 获取 Loop 状态 CSS class */
  protected getLoopStatusClass(): string {
    const status = this.currentLoopState()?.status ?? 'idle';
    switch (status) {
      case 'executing': return 'status-executing';
      case 'verifying': return 'status-verifying';
      case 'completed': return 'status-completed';
      case 'failed': return 'status-failed';
      case 'blocked': return 'status-blocked';
      case 'paused': return 'status-paused';
      case 'planning': return 'status-planning';
      default: return 'status-idle';
    }
  }

  protected getLoopPhaseLabel(): string {
    const phase = this.currentLoopState()?.phase ?? 'planning';
    const map: Record<string, string> = {
      planning: '思考中',
      executing: '执行中',
      verifying: '验证中',
      blocked: '阻塞中',
      paused: '等待中',
      completed: '已完成',
      failed: '失败',
      ready_for_release: '待发布',
      ready_for_review: '待审阅',
    };
    return map[phase] ?? map[this.currentLoopState()?.status ?? ''] ?? '思考中';
  }

  protected getLoopStatusTone(): 'thinking' | 'running' | 'blocked' | 'success' {
    const s = this.currentLoopState()?.status ?? 'idle';
    if (s === 'blocked' || s === 'failed') return 'blocked';
    if (s === 'completed' || s === 'ready_for_release' || s === 'ready_for_review') return 'success';
    if (s === 'executing' || s === 'verifying') return 'running';
    return 'thinking';
  }

  protected getLoopSectionTitle(): string {
    return this.currentLoopState()?.objective ? `Loop · ${this.currentLoopState()!.objective}` : 'Loop';
  }

  protected getLoopActiveStep(): string {
    const state = this.currentLoopState();
    if (!state) return '无';
    return state.currentPlan[0]?.title ?? state.completedSteps[0]?.title ?? '等待计划生成';
  }

  /** 从工具栏执行 Loop step */
  protected async executeLoopStepFromToolbar(): Promise<void> {
    // 切换到终端视图以显示日志
    this.loopViewMode.set('terminal');
    setTimeout(async () => {
      this.initDebugXterm();
      this.debugXtermWrite('\x1b[33m⏳ 执行中...\x1b[0m\r\n');
      try {
        const result = await this.loopExecutor.runOnce(SESSION_ID);
        const state = result.state;
        this.debugXtermWrite(`\x1b[32m✓ 步骤完成\x1b[0m ${result.executedStep?.title ?? '无'}\r\n`);
        this.debugXtermWrite(`  状态: ${state.status}  轮次: ${state.iteration}/${state.maxIterations}\r\n`);
        this.debugXtermWrite(`  验证: ${result.verification.passed ? '\x1b[32m通过\x1b[0m' : '\x1b[31m未通过\x1b[0m'}\r\n`);
        if (result.verification.blockers.length > 0) {
          this.debugXtermWrite(`  \x1b[31m阻塞: ${result.verification.blockers.join('; ')}\x1b[0m\r\n`);
        }
        // 刷新卡片状态
        this.refreshLoopState();
      } catch (e) {
        this.debugXtermWrite(`\x1b[31m执行失败: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
      }
      this.writeDebugTerminalPrompt();
      this.debugFitAddon?.fit();
    }, 100);
  }

  protected pinDebugSession(tab: string, value: string): void {
    const domain = this.debugDomainForTab(tab);
    if (!domain) return;
    const next = { ...this.debugTabPinnedSession() };
    next[domain] = value.trim() || undefined;
    this.debugTabPinnedSession.set(next);
    this.debugTabState.pinSession(domain, value.trim());
  }

  protected debugPinnedSession(tab: string): string {
    const domain = this.debugDomainForTab(tab);
    if (!domain) return '';
    return this.debugTabPinnedSession()[domain] ?? this.debugTabState.getPinnedSession(domain) ?? '';
  }

  protected copyDebugPayload(): void {
    const payload = this.currentDebugPayload();
    if (!payload) return;
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }

  protected refreshDebugTab(tab: string): void {
    const domain = this.debugDomainForTab(tab);
    if (!domain) return;
    void this.openDebugTab(domain, this.debugPinnedSession(tab) || undefined, this.debugActionForTab(tab));
  }

  private debugDomainForTab(tab: string): 'prompt' | 'memory' | 'workbench' | null {
    const m = tab.match(/^Debug \/ (Prompt|Memory|Workbench)$/i);
    return m ? (m[1]!.toLowerCase() as 'prompt' | 'memory' | 'workbench') : null;
  }

  private debugActionForTab(tab: string): string | undefined {
    const domain = this.debugDomainForTab(tab);
    if (!domain) return undefined;
    return this.debugTabState.getActiveSession(domain) ? 'latest' : undefined;
  }

  private async openDebugTab(domain: 'prompt' | 'memory' | 'workbench', sessionId?: string, action?: string): Promise<void> {
    const target = sessionId?.trim() || this.activeDebugSessionId();
    const input = action ? `/debug ${domain} ${action}` : `/debug ${domain}`;
    const result = await this.commandExecutor.execute({
      raw: input,
      context: { source: 'user', sessionId: target || SESSION_ID },
      options: { bridgeOrigin: true },
    });
    const payload = result.metadata?.['debugPayload'] as { tabKey?: string; tabTitle?: string; viewModel?: unknown; sessionId?: string } | undefined;
    if (!payload?.tabKey) return;
    this.currentDebugPayload.set(payload as any);
    this.debugCommand.executeAction(target || SESSION_ID, input).catch(() => {});
    this.addTabIfMissing(payload.tabKey);
    const model = JSON.stringify(payload.viewModel ?? {}, null, 2);
    this.tabEditorState.set(payload.tabKey, {
      relPath: payload.tabKey,
      content: model,
      previewKind: 'code',
      dirty: false,
      fsScope: 'workspace',
    });
    this.activeTab.set(payload.tabKey);
    this.selectedPath.set(payload.tabKey);
    this.selectedContent.set(model);
    this.previewKind.set('code');
    this.editorDirty.set(false);
  }

  protected activeDebugSessionId(): string {
    return this.debugTabPinnedSession()['prompt'] ?? this.debugTabPinnedSession()['memory'] ?? this.debugTabPinnedSession()['workbench'] ?? SESSION_ID;
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
    this.tabContextMenu.set({ tab, x: event.clientX, y: event.clientY });
    this.cdr.markForCheck();
  }

  protected isAgentTab(tab: string): boolean {
    return this.agentIdByTab.has(tab);
  }

  protected activeAgentId(): string {
    return this.agentIdByTab.get(this.activeTab()) ?? '';
  }

  protected activeAgentLabel(): string {
    const id = this.activeAgentId();
    if (!id) return '';
    return this.teammateTeamVm()?.teammates?.find((x) => x.agentId === id)?.name ?? id;
  }

  protected availableModelCatalog(): ModelCatalogEntry[] {
    return [...MODEL_CATALOG];
  }

  protected currentModelEntry(): ModelCatalogEntry | undefined {
    return findCatalogEntry(this.appSettings.value.model?.trim() ?? '') ?? this.availableModelCatalog()[0];
  }

  protected currentModelProviderLabel(): string {
    return this.currentModelEntry()?.providerLabel ?? 'Custom';
  }

  protected currentModelName(): string {
    return this.currentModelEntry()?.shortName ?? this.appSettings.value.model?.trim() ?? 'unknown model';
  }

  protected currentModelLabel(): string {
    const entry = this.currentModelEntry();
    return entry ? `${entry.providerLabel} · ${entry.shortName}` : `${this.currentModelProviderLabel()} · ${this.currentModelName()}`;
  }

  protected currentTaskSummary(): string {
    const task = this.currentLoopState();
    if (!task) return '';
    const done = task.completedSteps.length;
    const total = task.completedSteps.length + task.currentPlan.length;
    const status = task.status === 'paused' ? '暂停中' : task.status === 'blocked' ? '阻塞' : task.status === 'executing' ? '执行中' : task.status === 'completed' ? '已完成' : '进行中';
    return `${status} · ${done}/${total || 0} 步`;
  }

  protected toggleTaskListExpanded(): void {
    this.taskListExpanded.update((v) => !v);
  }

  protected toggleChangedFilesExpanded(): void {
    this.changedFilesExpanded.update((v) => !v);
    if (this.changedFilesExpanded()) {
      void this.refreshRightPanelChangedFiles();
    }
  }

  protected changedFileStatusClass(status: string): string {
    if (status === 'M' || status === 'MM') return 'status-modified';
    if (status === 'A' || status === 'AM') return 'status-added';
    if (status === 'D') return 'status-deleted';
    if (status === 'R') return 'status-renamed';
    if (status === '?' || status === '!!') return 'status-untracked';
    return 'status-other';
  }

  protected async refreshRightPanelChangedFiles(): Promise<void> {
    try {
      const por = await window.zytrader.terminal.exec('cmd.exe /c git status --porcelain=1 -u 2>nul', '.');
      const files: RightPanelChangedFile[] = [];
      if (por.stdout) {
        const rawFiles: { path: string; status: string }[] = [];
        for (const line of por.stdout.split(/\r?\n/)) {
          const raw = line.trim();
          if (!raw) continue;
          const status = raw.slice(0, 2).trim();
          const pathPart = raw.slice(3).trim();
          const path = pathPart.includes(' -> ') ? pathPart.split(' -> ').pop()?.trim() ?? pathPart : pathPart;
          if (path) rawFiles.push({ path: path.replace(/\\/g, '/'), status: status || '?' });
        }
        if (rawFiles.length > 0) {
          const mtimeMap = new Map<string, string>();
          const psScript = rawFiles.map(f => {
            const escaped = f.path.replace(/'/g, "''");
            return `try { $i=Get-Item -LiteralPath '${escaped}' -ErrorAction SilentlyContinue; if($i) { Write-Output ('${f.path}|' + $i.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')) } } catch {}`;
          }).join('; ');
          try {
            const r = await window.zytrader.terminal.exec(
              `powershell -NoProfile -NonInteractive -Command "${psScript}"`,
              '.',
            );
            if (r.stdout) {
              for (const line of r.stdout.split(/\r?\n/)) {
                const t = line.trim();
                if (!t) continue;
                const sepIdx = t.lastIndexOf('|');
                if (sepIdx < 0) continue;
                const fpath = t.slice(0, sepIdx);
                const mtime = t.slice(sepIdx + 1);
                if (fpath && mtime) mtimeMap.set(fpath, mtime);
              }
            }
          } catch {}
          for (const f of rawFiles) {
            files.push({
              path: f.path,
              status: f.status,
              mtime: mtimeMap.get(f.path) || '',
            });
          }
          files.sort((a, b) => {
            if (a.mtime && b.mtime) return b.mtime.localeCompare(a.mtime);
            if (a.mtime) return -1;
            if (b.mtime) return 1;
            return a.path.localeCompare(b.path);
          });
        }
      }
      this.rightPanelChangedFiles.set(files);
    } catch {
      this.rightPanelChangedFiles.set([]);
    }
    this.cdr.markForCheck();
  }

  protected currentModeLabel(): string {
    const mode = this.coordinatorMode();
    const labels: Record<CoordinationMode, string> = {
      single: '单智能体',
      plan: '计划',
      parallel: '并行',
    };
    return labels[mode] ?? mode;
  }

  protected currentModeList(): string[] {
    return ['single', 'plan', 'parallel'].map((mode) => (mode === this.coordinatorMode() ? `● ${this.currentModeLabel()}` : `○ ${mode === 'single' ? '单智能体' : mode === 'plan' ? '计划' : '并行'}`));
  }

  protected setCoordinatorMode(mode: 'single' | 'plan' | 'parallel'): void {
    this.coordinatorMode.set(mode);
  }

  protected currentModelList(): string[] {
    return [
      `${this.currentModelProviderLabel()} · ${this.currentModelName()}`,
      this.appSettings.value.apiKey?.trim() ? 'API Key 已配置' : 'API Key 未配置',
      this.appSettings.value.proxy.enabled ? `代理：${this.appSettings.value.proxy.baseUrl || '已启用'}` : '代理：关闭',
    ];
  }

  protected imageBadgeText(): string {
    return this.composerImages().length > 0 ? `${this.composerImages().length} 张图片` : '无图片';
  }

  protected onAgentChatInput(event: Event): void {
    const value = String((event.target as HTMLInputElement | null)?.value ?? '');
    this.agentChatInput.set(value);
  }

  protected async sendAgentChat(): Promise<void> {
    const agentId = this.activeAgentId();
    const text = this.agentChatInput().trim();
    if (!agentId || !text) return;
    this.agentChatInput.set('');
    this.appendAgentMessage(agentId, { at: Date.now(), role: 'user', text });
    try {
      await this.withTeammateRetry(() => this.multiAgent.sendMessage(agentId, text), '发送消息');
      this.setActionFeedback('success', '消息已发送');
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      this.appendAgentMessage(agentId, { at: Date.now(), role: 'system', text: `发送失败：${message}` });
      this.setActionFeedback('error', message);
    }
  }

  protected focusCurrentAgentInTabs(agentId: string): void {
    this.syncActiveAgentToTabs(agentId);
  }

  protected focusActiveAgentInRightPanel(): void {
    const agentId = this.activeAgentId();
    if (!agentId) return;
    this.focusedTeammateId.set(agentId);
    this.rightPanelVisible.set(true);
    this.scrollFocusedTeammateIntoView();
  }

  protected syncActiveAgentToTabs(agentId: string): void {
    const tab = [...this.agentIdByTab.entries()].find(([, id]) => id === agentId)?.[0];
    if (tab) {
      this.setTab(tab);
    }
  }

  protected async stopActiveAgent(): Promise<void> {
    const agentId = this.activeAgentId();
    if (!agentId) return;
    try {
      await this.withTeammateRetry(() => this.multiAgent.stopTeammate(agentId, 'agent tab stop'), '停止当前 Agent');
      this.setActionFeedback('info', '已请求停止当前 Agent');
    } catch {
      this.setActionFeedback('error', '停止当前 Agent 失败');
    }
  }

  protected async killActiveAgent(): Promise<void> {
    const agentId = this.activeAgentId();
    if (!agentId) return;
    try {
      await this.withTeammateRetry(() => this.multiAgent.killTeammate(agentId, 'agent tab kill', 'SIGKILL'), '终止当前 Agent');
      this.setActionFeedback('warning', '已请求强制终止当前 Agent');
    } catch {
      this.setActionFeedback('error', '强制终止当前 Agent 失败');
    }
  }

  protected setEventReadableMode(mode: 'user' | 'technical'): void {
    this.eventReadableMode.set(mode);
  }

  protected renderEventText(item: { text: string; userText: string }): string {
    return this.eventReadableMode() === 'user' ? item.userText : item.text;
  }

  protected focusFocusedTeammateFromEvent(item: { text: string; userText: string }): void {
    const text = this.eventReadableMode() === 'user' ? item.userText : item.text;
    const match = text.match(/([a-zA-Z0-9_-]+@[^\s·]+)/);
    if (match?.[1]) {
      this.focusedTeammateId.set(match[1]);
      this.rightPanelVisible.set(true);
      this.scrollFocusedTeammateIntoView();
    }
  }

  protected agentNextActionHint(): string {
    const id = this.activeAgentId();
    if (!id) return '先创建 team。';
    const vm = this.teammateTeamVm()?.teammates?.find((x) => x.agentId === id);
    if (!vm) return '该 Agent 不在团队列表，建议重新创建。';
    if (vm.status === 'running') return 'Agent 执行中，建议等待回传或补充指令。';
    if (vm.status === 'waiting' || vm.status === 'idle') return '可发送下一条指令推进任务。';
    if (vm.status === 'stopped') return 'Agent 已停止，可新建 Agent Tab 继续。';
    if (vm.status === 'error') return 'Agent 异常，建议查看事件并重新创建。';
    return '可继续观察事件或补充任务指令。';
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
    this.planSteps.set(state.steps.map((s: CoordinationStep) => `${s.id ?? 'step'} · ${s.status}`));
    this.stepTotal.set(state.steps.length);
    this.stepDone.set(state.steps.filter((s: CoordinationStep) => s.status === 'completed').length);
    this.stepInProgress.set(state.steps.filter((s: CoordinationStep) => s.status === 'in_progress').length);
    this.stepPending.set(state.steps.filter((s: CoordinationStep) => s.status === 'pending').length);
    this.sessionCostUsd.set(0);
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
    this.memoryVaultTree.set([...nodes]);
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

  private async openFileByPath(rel: string, scope: 'workspace' | 'vault' = 'workspace'): Promise<void> {
    const norm = rel.replace(/\\/g, '/');
    const tabLabel = `${scope}:${norm}`;
    this.persistTabState(this.activeTab());
    
    let content = '';
    let readError = false;
    
    try {
      const result = await window.zytrader.fs.read(norm, { scope });
      if (result.ok && result.content) {
        content = result.content.slice(0, 800_000);
      } else {
        readError = true;
        content = `无法读取文件: ${norm}\n\n可能原因:\n- 文件不存在\n- 权限不足\n- 文件系统错误`;
      }
    } catch (e) {
      readError = true;
      content = `读取文件时发生错误: ${e instanceof Error ? e.message : String(e)}`;
    }
    
    this.previewKind.set('code');
    this.selectedPath.set(norm);
    this.selectedFileTreeRoot.set(scope);
    this.selectedContent.set(content);
    this.editorDirty.set(false);
    this.tabEditorState.set(tabLabel, {
      relPath: norm,
      content,
      previewKind: 'code',
      dirty: false,
      fsScope: scope,
    });
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
      }
      if (this.isTerminalTab(tab)) {
        this.focusDebugTerminal();
      }
      if (this.terminalMenuVisible()) {
        this.focusPowerShellTerminal();
      }
    });
    this.cdr.markForCheck();
  }

  protected closeEditorTab(tab: string): void {
    if (tab === 'Terminal - Main') return;
    this.tabEditorState.delete(tab);
    this.agentIdByTab.delete(tab);
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
    removed.forEach((k) => {
      this.tabEditorState.delete(k);
      this.agentIdByTab.delete(k);
    });
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
    right.forEach((k) => {
      this.tabEditorState.delete(k);
      this.agentIdByTab.delete(k);
    });
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
    left.forEach((k) => {
      this.tabEditorState.delete(k);
      this.agentIdByTab.delete(k);
    });
    const next = cur.filter((t, i) => i >= idx || t === 'Terminal - Main');
    this.tabs.set(next);
    this.hideTabContextMenu();
  }

  private extractAgentIdFromMultiAgentEvent(ev: MultiAgentEvent): string {
    if (ev.type === 'multiagent.teammate.spawned') {
      return (ev as MultiAgentEvent<'multiagent.teammate.spawned'>).payload.identity.agentId;
    }
    if (ev.type === 'multiagent.teammate.stopped') {
      return (ev as MultiAgentEvent<'multiagent.teammate.stopped'>).payload.agentId;
    }
    if (ev.type === 'multiagent.teammate.killed') {
      return (ev as MultiAgentEvent<'multiagent.teammate.killed'>).payload.agentId;
    }
    if (ev.type === 'multiagent.teammate.state.changed') {
      return (ev as MultiAgentEvent<'multiagent.teammate.state.changed'>).payload.agentId;
    }
    if (ev.type === 'multiagent.teammate.failed') {
      return (ev as MultiAgentEvent<'multiagent.teammate.failed'>).payload.agentId ?? '';
    }
    if (ev.type === 'multiagent.teammate.message') {
      const p = (ev as MultiAgentEvent<'multiagent.teammate.message'>).payload;
      return p.toAgentId ?? p.fromAgentId;
    }
    return '';
  }

  private ensureAgentSessionExists(agentId: string): void {
    if (!agentId) return;
    const map = this.agentSessionsById();
    if (map[agentId]) return;
    const now = Date.now();
    this.agentSessionsById.set({
      ...map,
      [agentId]: { agentId, createdAt: now, updatedAt: now, messages: [] },
    });
    void this.persistAgentSessionsToVault();
  }

  private appendAgentMessage(agentId: string, msg: { at: number; role: 'leader' | 'user' | 'teammate' | 'system'; text: string }): void {
    if (!agentId) return;
    this.ensureAgentSessionExists(agentId);
    const map = this.agentSessionsById();
    const prev = map[agentId]!;
    const next = {
      ...prev,
      updatedAt: Date.now(),
      messages: [...prev.messages, msg].slice(-400),
    };
    this.agentSessionsById.set({ ...map, [agentId]: next });
    void this.persistAgentSessionsToVault();
  }

  private maybeAppendAgentSessionFromEvent(ev: MultiAgentEvent): void {
    if (ev.type === 'multiagent.teammate.message') {
      const p = (ev as MultiAgentEvent<'multiagent.teammate.message'>).payload;
      const text = p.textPreview || p.text;
      if (p.direction === 'leader_to_teammate') {
        if (!p.toAgentId) return;
        this.appendAgentMessage(p.toAgentId, { at: ev.ts, role: 'leader', text });
        return;
      }
      if (p.direction === 'teammate_to_leader') {
        // 该消息属于 fromAgentId（teammate 自己的会话）
        if (!p.fromAgentId) return;
        this.appendAgentMessage(p.fromAgentId, { at: ev.ts, role: 'teammate', text });
        return;
      }
      // teammate_to_teammate：先同时写入双方会话（最小可观测）
      this.appendAgentMessage(p.fromAgentId, { at: ev.ts, role: 'teammate', text });
      if (p.toAgentId) this.appendAgentMessage(p.toAgentId, { at: ev.ts, role: 'teammate', text });
      return;
    }
    if (ev.type === 'multiagent.teammate.stopped') {
      const id = (ev as MultiAgentEvent<'multiagent.teammate.stopped'>).payload.agentId;
      this.appendAgentMessage(id, { at: ev.ts, role: 'system', text: '已停止' });
      return;
    }
    if (ev.type === 'multiagent.teammate.killed') {
      const p = (ev as MultiAgentEvent<'multiagent.teammate.killed'>).payload;
      this.appendAgentMessage(p.agentId, { at: ev.ts, role: 'system', text: `已强制终止${p.signal ? `（${p.signal}）` : ''}` });
      return;
    }
    if (ev.type === 'multiagent.error') {
      const msg = (ev as MultiAgentEvent<'multiagent.error'>).payload.message;
      this.appendAgentMessage('__global__', { at: ev.ts, role: 'system', text: `multiagent.error: ${msg}` });
    }
  }

  private async loadAgentSessionsFromVault(): Promise<void> {
    try {
      const r = await window.zytrader.fs.read(WORKBENCH_AGENT_SESSIONS_VAULT_PATH, { scope: 'vault' });
      if (!r.ok) return;
      const raw = (r.content ?? '').trim();
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return;
      const map = (parsed as Record<string, any>)['sessionsById'] ?? parsed;
      if (!map || typeof map !== 'object') return;
      this.agentSessionsById.set(map as any);
    } catch {
      // ignore
    }
  }

  private async persistAgentSessionsToVault(): Promise<void> {
    try {
      const payload = JSON.stringify({ version: 1, updatedAt: Date.now(), sessionsById: this.agentSessionsById() }, null, 2);
      await window.zytrader.fs.write(WORKBENCH_AGENT_SESSIONS_VAULT_PATH, payload, { scope: 'vault' });
    } catch {
      // ignore
    }
  }

  private setActionFeedback(tier: MultiAgentTimelineTier, text: string): void {
    this.actionFeedback.set({ tier, text });
    window.setTimeout(() => {
      if (this.actionFeedback()?.text === text) this.actionFeedback.set(null);
    }, 3500);
  }

  protected teammateEvents = signal<Array<{ at: number; text: string; userText: string; tier: MultiAgentTimelineTier }>>([]);

  protected saveWorkbenchRecoverySnapshot(): void {
    try {
      const payload = {
        at: Date.now(),
        mode: this.teammateBackendMode(),
        focusedTeammateId: this.focusedTeammateId(),
        spawnName: this.teammateSpawnName(),
        spawnPrompt: this.teammateSpawnPrompt(),
        eventReadableMode: this.eventReadableMode(),
      };
      localStorage.setItem(this.workbenchRecoveryStorageKey, JSON.stringify(payload));
      this.recoveryAvailable.set(true);
      this.recoverySyncedAt.set(new Date(payload.at).toLocaleString());
      this.setActionFeedback('success', '恢复快照已保存');
    } catch {
      this.setActionFeedback('warning', '恢复快照保存失败');
    }
  }

  protected restoreWorkbenchRecoverySnapshot(): void {
    try {
      const raw = localStorage.getItem(this.workbenchRecoveryStorageKey);
      if (!raw) {
        this.setActionFeedback('warning', '未找到可恢复快照');
        return;
      }
      const parsed = JSON.parse(raw) as {
        at?: number;
        mode?: TeammateMode;
        focusedTeammateId?: string;
        spawnName?: string;
        spawnPrompt?: string;
        eventReadableMode?: 'user' | 'technical';
      };
      if (parsed.mode) this.setTeammateMode(parsed.mode);
      if (typeof parsed.focusedTeammateId === 'string') this.focusedTeammateId.set(parsed.focusedTeammateId);
      if (typeof parsed.spawnName === 'string') this.teammateSpawnName.set(parsed.spawnName);
      if (typeof parsed.spawnPrompt === 'string') this.teammateSpawnPrompt.set(parsed.spawnPrompt);
      if (parsed.eventReadableMode) this.eventReadableMode.set(parsed.eventReadableMode);
      if (parsed.at) this.recoverySyncedAt.set(new Date(parsed.at).toLocaleString());
      this.recoveryAvailable.set(true);
      this.setActionFeedback('success', '恢复快照已应用');
      this.scrollFocusedTeammateIntoView();
    } catch {
      this.setActionFeedback('error', '恢复快照损坏，无法恢复');
    }
  }

  private loadWorkbenchRecoveryMeta(): void {
    try {
      const raw = localStorage.getItem(this.workbenchRecoveryStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { at?: number };
      this.recoveryAvailable.set(true);
      if (parsed.at) this.recoverySyncedAt.set(new Date(parsed.at).toLocaleString());
    } catch {
      this.recoveryAvailable.set(false);
    }
  }

  private async withTeammateRetry<T>(action: () => Promise<T>, actionName: string): Promise<T> {
    const maxAttempts = 2;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.actionAttemptCount.update((v) => v + 1);
      const startedAt = Date.now();
      try {
        const result = await action();
        this.actionLatencyMs.update((list) => [...list.slice(-29), Date.now() - startedAt]);
        return result;
      } catch (error) {
        lastError = error;
        this.actionFailureCount.update((v) => v + 1);
        this.actionLatencyMs.update((list) => [...list.slice(-29), Date.now() - startedAt]);
        if (attempt < maxAttempts) {
          this.retryCount.update((v) => v + 1);
          this.setActionFeedback('warning', `${actionName} 失败，自动重试中`);
          continue;
        }
      }
    }
    throw lastError;
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

  protected setTeammateMode(mode: TeammateMode): void {
    this.teammateBackendMode.set(mode);
    this.multiAgent.setMode(mode);
  }

  protected onTeammateSpawnNameInput(event: Event): void {
    const value = String((event.target as HTMLInputElement | null)?.value ?? '');
    this.teammateSpawnName.set(value);
  }

  protected onTeammateSpawnPromptInput(event: Event): void {
    const value = String((event.target as HTMLInputElement | null)?.value ?? '');
    this.teammateSpawnPrompt.set(value);
  }

  protected async spawnTeammateFromWorkbench(): Promise<void> {
    const name = this.teammateSpawnName().trim();
    const prompt = this.teammateSpawnPrompt().trim();
    if (!name || !prompt) return;
    const health = this.teammateTeamVm()?.health;
    if (health?.blocking) {
      this.teammateEvents.set(
        [
          {
            at: Date.now(),
            text: `multiagent.error · ${health.fallbackReason ?? 'backend mode blocked'}`,
            userText: '后端不可用，无法创建 Agent',
            tier: 'error' as MultiAgentTimelineTier,
          },
          ...this.teammateEvents(),
        ].slice(0, 40),
      );
      this.setActionFeedback('error', health.fallbackReason ?? 'backend mode blocked');
      return;
    }

    const teamName = this.teammateTeamVm()?.teamName || 'workbench-team';
    try {
      await this.withTeammateRetry(
        () =>
          this.multiAgent.spawnTeammate({
            name,
            prompt,
            teamName,
            mode: this.teammateBackendMode(),
          }),
        `创建 Agent ${name}`,
      );
      this.teammateSpawnPrompt.set('请继续处理下一个子任务，并只返回关键结论。');
      this.setActionFeedback('success', `已创建 Agent：${name}`);
      this.saveWorkbenchRecoverySnapshot();
    } catch {
      // 失败时先保持静默，后续接入统一 toast/事件轨迹展示
      this.setActionFeedback('error', '创建 Agent 失败，请查看事件时间线');
    }
  }

  protected async stopTeammateFromWorkbench(agentId: string): Promise<void> {
    if (!agentId) return;
    const t = this.teammateTeamVm()?.teammates?.find((x) => x.agentId === agentId);
    const label = t?.name ?? agentId;
    if (!window.confirm(`确定要停止 ${label} 吗？`)) return;
    try {
      await this.withTeammateRetry(() => this.multiAgent.stopTeammate(agentId, 'workbench stop'), `停止 ${agentId}`);
      this.setActionFeedback('info', '已请求停止 Agent');
      this.saveWorkbenchRecoverySnapshot();
    } catch {
      // 失败时先保持静默，后续接入统一 toast/事件轨迹展示
      this.setActionFeedback('error', '停止 Agent 失败');
    }
  }

  protected async killTeammateFromWorkbench(agentId: string): Promise<void> {
    if (!agentId) return;
    const t = this.teammateTeamVm()?.teammates?.find((x) => x.agentId === agentId);
    const label = t?.name ?? agentId;
    if (!window.confirm(`确定要强制终止 ${label} 吗？该操作不可轻易恢复。`)) return;
    try {
      await this.withTeammateRetry(
        () => this.multiAgent.killTeammate(agentId, 'workbench force kill', 'SIGKILL'),
        `终止 ${agentId}`,
      );
      this.setActionFeedback('warning', '已请求强制终止 Agent');
      this.saveWorkbenchRecoverySnapshot();
    } catch {
      // 失败时先保持静默，后续接入统一 toast/事件轨迹展示
      this.setActionFeedback('error', '强制终止 Agent 失败');
    }
  }

  protected async attachTeammateFromWorkbench(agentId: string): Promise<void> {
    if (!agentId) return;
    try {
      const ok = await this.multiAgent.attachTeammate(agentId);
      this.setActionFeedback(ok ? 'success' : 'warning', ok ? '已请求附着 tmux 会话' : '当前 Agent 不支持附着');
      if (ok) {
        this.focusCurrentAgentInTabs(agentId);
        this.syncAgentSessionState(agentId, 'connected');
      }
      this.saveWorkbenchRecoverySnapshot();
    } catch {
      this.setActionFeedback('error', '附着会话失败');
    }
  }

  protected async detachTeammateFromWorkbench(agentId: string): Promise<void> {
    if (!agentId) return;
    try {
      const ok = await this.multiAgent.detachTeammate(agentId);
      this.setActionFeedback(ok ? 'success' : 'warning', ok ? '已请求分离 tmux 会话' : '当前 Agent 不支持分离');
      if (ok) {
        this.focusCurrentAgentInTabs(agentId);
        this.syncAgentSessionState(agentId, 'background');
      }
      this.saveWorkbenchRecoverySnapshot();
    } catch {
      this.setActionFeedback('error', '分离会话失败');
    }
  }

  protected teammateBackendBadge(t: WorkbenchTeamVm['teammates'][number]): string {
    const pane = t.paneId ? ` · pane ${t.paneId}` : '';
    const win = t.windowId ? ` · win ${t.windowId}` : '';
    const attach = t.attached === true ? ' · attached' : t.attached === false ? ' · detached' : '';
    const role = t.role === 'leader' ? ' · leader' : '';
    const sess = t.sessionStatus ? ` · ${this.sessionStatusLabel(t.sessionStatus)}` : '';
    return `${t.backend}${pane}${win}${attach}${role}${sess}`;
  }

  protected copyTeammateSessionInfo(t: WorkbenchTeamVm['teammates'][number]): void {
    const parts = [
      `agentId=${t.agentId}`,
      t.sessionName ? `session=${t.sessionName}` : '',
      t.paneId ? `pane=${t.paneId}` : '',
      t.windowId ? `window=${t.windowId}` : '',
      t.attached !== undefined ? `attached=${String(t.attached)}` : '',
      t.recoveryState ? `recovery=${t.recoveryState}` : '',
    ].filter(Boolean);
    const text = parts.join(' · ');
    void navigator.clipboard.writeText(text);
    this.setActionFeedback('success', '会话信息已复制');
  }

  protected teammateRuntimeStatusLabel(status: string): string {
    const map: Record<string, string> = {
      starting: '启动中',
      running: '运行中',
      idle: '空闲',
      waiting: '等待',
      stopping: '停止中',
      stopped: '已停止',
      error: '错误',
    };
    return map[status] ?? status;
  }

  protected sessionStatusLabel(status: string): string {
    const map: Record<string, string> = {
      disconnected: '未连接',
      connected: '已连接',
      background: '后台保活',
      reconnecting: '重连中',
      closed: '已关闭',
      error: '异常',
    };
    return map[status] ?? status;
  }

  private syncAgentSessionState(agentId: string, sessionStatus: 'disconnected' | 'connected' | 'background' | 'reconnecting' | 'closed' | 'error'): void {
    const vm = this.teammateTeamVm();
    if (!vm) return;
    const next = vm.teammates.map((t) => (t.agentId === agentId ? { ...t, sessionStatus, updatedAt: Date.now() } : t));
    const leader = next.find((t) => t.role === 'leader') ?? vm.leader;
    const updated = { ...vm, teammates: next, leader };
    this.teammateTeamVm.set(updated);
  }

  protected teammateRecoveryLabel(state?: string): string {
    const map: Record<string, string> = {
      live: '在线',
      detached: '已分离',
      reconnecting: '重连中',
      restored: '已恢复',
      blocked: '受阻',
    };
    return state ? map[state] ?? state : '未知';
  }

  protected teammateSessionStateLabel(agent: WorkbenchTeamVm['teammates'][number]): string {
    const session = agent.sessionStatus ?? 'disconnected';
    const recovery = agent.recoveryState ?? 'live';
    if (session === 'error') return '会话异常';
    if (session === 'reconnecting') return '会话重连中';
    if (session === 'background') return '后台保活';
    if (session === 'connected') return '已连接';
    if (session === 'closed') return '已关闭';
    if (recovery === 'detached') return '已分离';
    return '未连接';
  }

  protected recoveryActionLabel(): string {
    const vm = this.teammateTeamVm();
    if (!vm) return '恢复/修复';
    if (vm.health.blocking) return '修复环境';
    if (vm.errorCount > 0) return '恢复会话';
    if (this.recoveryAvailable()) return '恢复快照';
    return '保存快照';
  }

  protected isTeammateFocused(agentId: string): boolean {
    return !!agentId && this.focusedTeammateId() === agentId;
  }

  protected clearFocusedTeammate(): void {
    this.focusedTeammateId.set('');
  }

  private scrollFocusedTeammateIntoView(): void {
    const focusAgent = this.focusedTeammateId();
    if (!focusAgent) return;
    queueMicrotask(() => {
      const el = document.querySelector(`.ma-item[data-agent-id="${focusAgent}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  protected formatRecentTime(at: number): string {
    const sec = Math.floor((Date.now() - at) / 1000);
    if (sec < 60) return '刚刚';
    if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
    return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  protected recentSessionLabel(item: RecentTurn): string {
    return item.title || item.prompt || '未命名会话';
  }

  protected openRecentSession(item: RecentTurn): void {
    void this.replayRecent(item);
  }

  protected createDraftFromCurrentPrompt(): void {
    this.composerDraft.set(this.mainLineBuffer || this.selectedContent() || '');
  }

  protected sendDraftToMainTerminal(): void {
    const text = this.composerDraft().trim();
    if (!text) return;
    this.composerDraft.set('');
    this.composerImages.set([]);
    this.mainLineBuffer = '';
    this.clearSlashHintRow();
    this.directiveTabCycle = 0;
    this.aiXtermWrite(`\r\n\x1b[90m>\x1b[0m ${text}\r\n`);
    void this.dispatchMainTerminalLine(text);
  }

  protected onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          const reader = new FileReader();
          reader.onload = (e) => {
            const imageData = e.target?.result as string;
            this.composerImages.update(prev => [...prev, imageData]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  }

  protected removeComposerImage(index: number): void {
    this.composerImages.update(prev => prev.filter((_, i) => i !== index));
  }

  protected triggerImageUpload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const imageData = ev.target?.result as string;
          this.composerImages.update(prev => [...prev, imageData]);
        };
        reader.readAsDataURL(file);
      });
    };
    input.click();
  }

  protected onModelSelectChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const selectedId = select.value.trim();
    const selected = findCatalogEntry(selectedId);
    if (!selected) return;

    this.appSettings.update({
      modelProvider: selected.provider,
      model: selected.id,
    });
  }

  /** 切换项目资源展开状态 */
  protected toggleProjectTree(): void {
    this.projectTreeExpanded.set(!this.projectTreeExpanded());
  }

  /** 切换最近会话展开状态 */
  protected toggleRecentSessions(): void {
    this.recentSessionsExpanded.set(!this.recentSessionsExpanded());
  }

  /** 切换记忆仓库展开状态 */
  protected toggleMemoryVault(): void {
    this.memoryVaultExpanded.set(!this.memoryVaultExpanded());
  }

  /** 切换 Git 更改展开状态 */
  protected toggleGitChanges(): void {
    this.gitChangesExpanded.set(!this.gitChangesExpanded());
  }

  /** 切换 Git 提交展开状态 */
  protected toggleGitCommits(): void {
    this.gitCommitsExpanded.set(!this.gitCommitsExpanded());
  }

  /** 记忆仓库的目录展开/收起 */
  protected async toggleMemoryVaultDir(node: FileNode): Promise<void> {
    if (node.type !== 'dir') return;

    const nodes = [...this.memoryVaultTree()];
    const findAndToggle = (arr: FileNode[]): boolean => {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === node) {
          arr[i] = { ...node, expanded: !node.expanded };
          return true;
        }
        if (arr[i].children && findAndToggle(arr[i].children!)) {
          return true;
        }
      }
      return false;
    };
    findAndToggle(nodes);

    if (!node.expanded && !node.loaded) {
      await this.loadDir(node.path, node, 'vault');
    }

    this.memoryVaultTree.set([...this.memoryVaultTree()]);
    this.cdr.markForCheck();
  }

  /** 打开记忆仓库中的文件 */
  protected async openMemoryVaultFile(node: FileNode): Promise<void> {
    if (node.type === 'dir') {
      await this.toggleMemoryVaultDir(node);
      return;
    }

    if (!node.path) return;
    if (node.treeRoot === 'vault') {
      await this.openFileByPath(node.path, 'vault');
    } else {
      await this.openFileByPath(node.path, 'workspace');
    }
  }

  protected async onRecentTurnClick(r: RecentTurn): Promise<void> {
    this.selectedRecentTurnId.set(r.id);
    await this.replayRecent(r);
  }

  protected isRecentTurnSelected(id: string): boolean {
    return this.selectedRecentTurnId() === id;
  }

  protected recentTurnSummary(r: RecentTurn): string {
    const summary = String(r.summary ?? '').trim();
    if (summary.length >= 8) return summary;
    const prompt = String(r.prompt ?? '').trim();
    if (prompt.length > 0) return prompt;
    return '（暂无摘要内容）';
  }

  protected shouldShowRecentTurnSummary(r: RecentTurn): boolean {
    const title = String(r.title ?? '').replace(/\s+/g, ' ').trim();
    const summary = this.recentTurnSummary(r).replace(/\s+/g, ' ').trim();
    if (!summary) return false;
    if (!title) return true;

    const titleCore = title.replace(/…$/, '');
    const summaryCore = summary.replace(/…$/, '');

    if (summaryCore === titleCore) return false;
    if (summaryCore.startsWith(titleCore) || titleCore.startsWith(summaryCore)) return false;
    return true;
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

    const pairs: Array<{ user?: RecentTranscriptLine; assistant?: RecentTranscriptLine }> = [];
    let current: { user?: RecentTranscriptLine; assistant?: RecentTranscriptLine } = {};
    for (const row of rows) {
      const text = String(row.content ?? '').replace(/\r\n/g, '\n').trim();
      if (!text) continue;
      if (row.role === 'user') {
        if (current.user || current.assistant) pairs.push(current);
        current = { user: row };
      } else if (row.role === 'assistant') {
        current.assistant = row;
        pairs.push(current);
        current = {};
      }
    }
    if (current.user || current.assistant) pairs.push(current);

    if (pairs.length === 0) {
      this.writeMainTerminalPrompt();
      return;
    }

    for (const pair of pairs) {
      const userText = stripUserContentForHistoryReplay(String(pair.user?.content ?? '').trim()) || turn.prompt.trim();
      if (!userText) continue;
      this.aiXtermWrite(`\x1b[37m[用户]\x1b[0m ${userText.replaceAll('\n', '\r\n')}\r\n`);

      const assistantRaw = String(pair.assistant?.content ?? '').trim();
      if (!assistantRaw) continue;
      const { thinking, answer } = extractReplayThinkingAndAnswer(assistantRaw);
      if (thinking) {
        this.aiXtermWrite(`\r\n[Thinking #${turn.id}]\r\n`);
        this.aiXtermWrite(`${renderReplayThinkingBox(thinking)}\r\n`);
      }
      if (answer) {
        this.aiXtermWrite(`\r\n[超体] ${answer.replaceAll('\n', '\r\n')}\r\n`);
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
    this.psTerminal?.write('\x1b[?25h');
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
    if (this.rightPanelVisible()) {
      void this.refreshRightPanelChangedFiles();
    }
    queueMicrotask(() => {
      this.fitAddon?.fit();
      this.updateTabOverflow();
    });
  }

  protected onRightResizeStart(event: MouseEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const start = this.rightPanelWidth();
    const HIDE_THRESHOLD = 150; // 拖动小于此值时自动隐藏
    const move = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = start - delta;
      
      if (next < HIDE_THRESHOLD) {
        // 小于阈值时只更新宽度但不限制最小值，以便用户可以继续拖动来隐藏
        this.rightPanelWidth.set(Math.max(60, next));
      } else {
        this.rightPanelWidth.set(Math.max(240, Math.min(560, next)));
      }
    };
    const up = () => {
      const finalWidth = this.rightPanelWidth();
      if (finalWidth < HIDE_THRESHOLD) {
        // 拖动结束时，如果小于阈值，自动隐藏
        this.toggleRightPanel();
      } else {
        // 确保最终宽度在合理范围内
        this.rightPanelWidth.set(Math.max(240, Math.min(560, finalWidth)));
      }
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

  protected workbenchModeLabel(): string {
    const mode = this.runtime.coordinator.getState().mode;
    const map: Record<CoordinationMode, string> = { single: '∞', plan: '◌', parallel: '◫' };
    return map[mode] ?? '?';
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
            sessionMemoryPath:
              typeof x.sessionMemoryPath === 'string' && x.sessionMemoryPath.trim() ? x.sessionMemoryPath : undefined,
            summary: typeof x.summary === 'string' && x.summary.trim() ? x.summary.trim() : normalizedPrompt,
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
        this.recentSessionItems.set([]);
        return;
      }
      const parsed = JSON.parse(read.content);
      const normalized = this.normalizeRecentTurns(parsed);
      this.recentTurns.set(normalized);
      this.recentSessionItems.set(normalized);
      if (!this.selectedRecentTurnId() && normalized.length > 0) {
        this.selectedRecentTurnId.set(normalized[0]!.id);
      }
    } catch {
      this.recentTurns.set([]);
      this.recentSessionItems.set([]);
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
        sessionMemoryPath: x.sessionMemoryPath,
        summary: x.summary,
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
    const now = Date.now();
    const sessionMemoryPath = await this.resolveSessionMemoryPathForRecent();
    const summary = this.buildRecentSummary(transcript, trimmed);
    const entry: RecentTurn = {
      id,
      title,
      prompt: trimmed,
      at: now,
      transcript,
      sessionMemoryPath,
      summary,
      contextSnapshot: {
        mode: this.coordinatorMode(),
        stepTotal: this.stepTotal(),
        stepDone: this.stepDone(),
        stepInProgress: this.stepInProgress(),
        stepPending: this.stepPending(),
        toolCallCount: this.toolCallCount(),
        sessionCostUsd: this.sessionCostUsd(),
        capturedAt: now,
      },
    };
    entry.transcriptPath = await this.persistRecentTurnTranscript(entry);
    const next = [entry, ...this.recentTurns()].slice(0, 30);
    this.recentTurns.set(next);
    this.recentSessionItems.set(next);
    this.selectedRecentTurnId.set(entry.id);
    await this.persistRecentTurns(next);
  }

  private async resolveSessionMemoryPathForRecent(): Promise<string> {
    const relDir = await this.directoryManager.getRelativePathByKey('agent-context');
    return `${relDir}/sessions/${SESSION_ID}.md`;
  }

  private buildRecentSummary(transcript: RecentTranscriptLine[], fallbackPrompt: string): string {
    const turns = transcript
      .filter((x) => x.role === 'user' || x.role === 'assistant')
      .slice(-6)
      .map((x) => {
        if (x.role === 'user') {
          const t = stripUserContentForHistoryReplay(x.content) || x.content.trim();
          return t ? `用户：${t.replace(/\s+/g, ' ').slice(0, 90)}` : '';
        }
        const t = stripAssistantContentForHistoryReplay(x.content) || x.content.trim();
        return t ? `助手：${t.replace(/\s+/g, ' ').slice(0, 140)}` : '';
      })
      .filter(Boolean);

    if (turns.length > 0) return turns.join(' / ');
    return fallbackPrompt.replace(/\s+/g, ' ').slice(0, 180);
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

    await this.promptBuildContext.refreshSessionMemory({
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      timestamp: turn.timestamp,
      messages: turn.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    await this.agentMemory.runMemoryPipelineNow(turn);
    try {
      await this.agentMemory.appendProjectLongTermTurn(turn);
    } catch {
      /* 长期记忆落盘失败不阻断主流程 */
    }
    await this.refreshShortTermMemoryStats();
    await this.refreshWorkbenchContextSnapshot();
  }

  private bumpStreamLineBudgetForWrite(fragment: string): void {
    if (!fragment) return;
    this.streamConsumedLines += this.countPhysicalTerminalLines(fragment.replaceAll('\n', '\r\n'));
  }

  private async capturePromptContextSnapshot(sessionId: string, userQuery: string, systemPrompt?: string): Promise<void> {
    const runtimeModel = this.getActiveRuntimeModelLabel();
    const augmentedSystemPrompt = [
      systemPrompt?.trim() || '',
      runtimeModel ? `【当前运行模型】${runtimeModel}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await this.promptBuildContext.build({
      sessionId,
      userQuery,
      systemPrompt: augmentedSystemPrompt || systemPrompt,
      builtAt: Date.now(),
    });
  }

  private getActiveRuntimeModelLabel(): string {
    try {
      const raw = localStorage.getItem('zyfront:active-model-runtime');
      if (raw?.trim()) {
        const parsed = JSON.parse(raw) as { provider?: string; model?: string };
        const provider = String(parsed.provider ?? '').trim();
        const model = String(parsed.model ?? '').trim();
        if (provider || model) {
          return `${provider || 'unknown'}:${model || 'unknown'}`;
        }
      }
    } catch {
      // ignore
    }

    const settings = this.appSettings.value;
    if (settings.modelProvider || settings.model) {
      return `${settings.modelProvider}:${settings.model}`;
    }
    return '';
  }

  private async refreshWorkbenchContextSnapshot(): Promise<void> {
    this.workbenchContext.capture(SESSION_ID);
    const report = this.promptDebugReport.buildTextReport(SESSION_ID);
    this.workbenchContext.setDebugReport(SESSION_ID, report);
  }

  private presentUnifiedCommandEntry(result: { displayType: 'message' | 'system' | 'error' | 'success'; content: string; route: string; success: boolean; shouldQuery: boolean; metadata?: Record<string, unknown> }): void {
    const presentation = this.commandPresentation.presentAndSync(
      result.route as 'directive' | 'shell' | 'natural' | 'error' | 'fallback',
      result.success,
      result.content,
      SESSION_ID,
    );

    const fragmentText = presentation.fullText || result.content;
    if (!fragmentText) return;
    const normalized = String(result.route) === 'directive' ? 'directive' : String(result.route) === 'shell' ? 'shell' : 'assistant';
    const cleaned = fragmentText
      .replace(/\[\/directive\s+directive\]\s*\[directive\]\s*/gi, '')
      .replace(/\[\/directive\s+team-role\]\s*\[team-role\]\s*/gi, '')
      .replace(/\[\/directive\s+team-struct\]\s*\[team-struct\]\s*/gi, '')
      .replace(/\[\/directive\s+directive\]/gi, '')
      .replace(/\[\/directive\s+team-role\]/gi, '')
      .replace(/\[\/directive\s+team-struct\]/gi, '')
      .replace(/\/directive\s+directive/gi, '')
      .replace(/\/directive\s+team-role/gi, '')
      .replace(/\/directive\s+team-struct/gi, '')
      .replace(/^\s+/, '');
    this.renderCommandPresentation(this.commandPresentation.formatExecutionResult(
      normalized,
      String(result.route),
      result.success,
      cleaned,
    ));
  }

  private renderCommandPresentation(presentation: ReturnType<CommandPresentationService['formatExecutionResult']>): void {
    const text = presentation.fullText || presentation.compactSummary;
    if (!text) return;
    this.aiXtermWrite(`\r\n${text}\r\n`);
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
    const thinkingEligible = cfg.showThinking && !cfg.thinkingVerboseMode;
    if (thinkingEligible) {
      const id = this.ensureStreamingThinkingBlockId();
      const thHeader = `\r\n\x1b[90m[Thinking #${id}]\x1b[0m \x1b[2m思考过程已开始记录\x1b[0m`;
      this.aiXtermWrite(thHeader);
      this.bumpStreamLineBudgetForWrite(thHeader);
      this.thinkingHeaderShown = true;
    }
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

  /**
   * 将思考内容整理成更接近 Claude Code 的终端卡片：
   * - 顶部状态行：突出 [Thinking #N]
   * - 内容主体：保留原始推理，允许折行
   * - 底部收束行：给出“收起/展开”语义，便于快速扫读
   */
  private frameThinkingContent(blockId: number, text: string, cols: number): string {
    const innerWidth = Math.max(24, cols - 6);
    const allLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '').split('\n');
    const lines = allLines;
    
    const titlePlain = `[Thinking #${blockId}]`;
    const sideGap = Math.max(4, Math.floor((innerWidth - titlePlain.length - 2) / 2));
    const topLine = `\x1b[90m┌${'─'.repeat(sideGap)} [Thinking #${blockId}] ${'─'.repeat(Math.max(4, innerWidth - titlePlain.length - 2 - sideGap))}┐\x1b[0m`;

    const contentLines: string[] = [];
    for (const rawLine of lines) {
      const displayW = this.stringDisplayWidth(rawLine);
      if (displayW <= innerWidth) {
        const padLen = Math.max(0, innerWidth - displayW);
        contentLines.push(`\x1b[90m│\x1b[0m ${rawLine}${' '.repeat(padLen)} \x1b[90m│\x1b[0m`);
      } else {
        for (const seg of this.wrapAnsiLine(rawLine, innerWidth)) {
          const segW = this.stringDisplayWidth(seg);
          const padLen = Math.max(0, innerWidth - segW);
          contentLines.push(`\x1b[90m│\x1b[0m ${seg}${' '.repeat(padLen)} \x1b[90m│\x1b[0m`);
        }
      }
    }

    const bottomLine = `\x1b[90m└${'─'.repeat(innerWidth)}┘\x1b[0m`;

    return [topLine, ...contentLines, bottomLine].join('\n');
  }

  /**
   * 对可能包含 ANSI 转义序列的文本行进行折行。
   * 返回每段不超过 maxWidth 显示宽度的字符串数组。
   */
  private wrapAnsiLine(line: string, maxWidth: number): string[] {
    const result: string[] = [];
    let current = '';
    let currentWidth = 0;
    let i = 0;
    while (i < line.length) {
      if (line[i] === '\x1b' && i + 1 < line.length && line[i + 1] === '[') {
        const seqStart = i;
        i += 2;
        while (i < line.length && !((line[i] >= '@' && line[i] <= '~') || (line[i] >= 'a' && line[i] <= 'z'))) {
          i++;
        }
        if (i < line.length) i++;
        current += line.slice(seqStart, i);
        continue;
      }
      const code = line.codePointAt(i) ?? 0;
      const isWide = (code >= 0x4e00 && code <= 0x9fff) ||
                     (code >= 0x3000 && code <= 0x303f) ||
                     (code >= 0xff00 && code <= 0xffef) ||
                     (code >= 0xf900 && code <= 0xfaff);
      const charWidth = isWide ? 2 : 1;
      if (currentWidth + charWidth > maxWidth && current.length > 0) {
        result.push(current);
        current = '';
        currentWidth = 0;
      }
      const char = code > 0xffff ? String.fromCodePoint(code) : line[i]!;
      current += char;
      currentWidth += charWidth;
      i += code > 0xffff ? 2 : 1;
    }
    if (current.length > 0) {
      result.push(current);
    }
    return result.length > 0 ? result : [''];
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
    // 同步重置思考块状态机
    this.thinkingStateMachine.reset();
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
    // 同步合并到思考块状态机
    this.thinkingStateMachine.mergeFromSession();
  }

  private parseStoredThinkingBlock(
    v: unknown,
  ): ThinkingBlockRecord | undefined {
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
    // 同步持久化到思考块状态机
    this.thinkingStateMachine.persistToSession();
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
    // 同步到思考块状态机
    this.thinkingStateMachine.upsertMarker(id, marker);
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
    const buf = this.xterm.buffer.normal;
    // 与 xterm registerMarker 一致：marker.line 为 buffer 绝对行号，等价于 baseY+cursorY（非 viewportY+cursorY）
    const cursorAbs = buf.baseY + buf.cursorY;
    const mk = this.assistantStreamOutputStartMarker;
    /**
     * 擦除行数必须精确：仅擦除本轮 marker 起到光标止的内容。
     * 额外 +2 行用于擦除 marker 上方的用户输入行（sendDraftToMainTerminal 写入的 \r\n> xxx\r\n 占2行），
     * 让 tail() 重绘 [用户] xxx 时替换而非追加。
     */
    const rows = Math.max(1, this.xterm.rows);
    const maxErase = rows * 4;
    let linesToErase: number;
    if (mk && !mk.isDisposed && mk.line >= 0) {
      const top = mk.line;
      const span = cursorAbs - top + 1;
      if (span > 0) {
        linesToErase = Math.min(span + 2, maxErase);
      } else {
        linesToErase = Math.min(Math.max(1, base), maxErase);
      }
    } else {
      linesToErase = Math.min(Math.max(1, base), maxErase);
    }
    this.disposeAssistantStreamOutputStartMarker();

    const blockId =
      this.streamingThinkingBlockId !== null ? this.streamingThinkingBlockId : this.nextThinkingBlockId++;
    this.streamingThinkingBlockId = null;
    const promptText = params.userPrompt.trim();
    const cols = Math.max(40, this.xterm.cols);
    // 生成固定大小的思考内容框（不再支持折叠/展开）
    const plainText = params.thinkingHasNonChinese ? this.sanitizeThinkingForDisplay(params.thinking) : params.thinking.trim();
    const framedBody = plainText ? this.frameThinkingContent(blockId, plainText, cols) : '';
    // 记录思考块信息
    this.thinkingBlocksById.set(blockId, {
      text: params.thinking,
      hasNonChinese: params.thinkingHasNonChinese,
      foldSuffixAnsi: '',
      hintPhysicalRows: 1,
      tagEndCol0: 0,
    });
    this.latestTurnThinkingIds = [blockId];

    const firstThinkingLine = params.thinking
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';

    // 同步注册到思考块状态机
    this.thinkingStateMachine.registerBlock({
      sessionId: SESSION_ID,
      turnId: `turn-${Date.now().toString(36)}`,
      text: params.thinking,
      summary: firstThinkingLine ? `思考 #${blockId}: ${firstThinkingLine.slice(0, 60)}` : `思考 #${blockId}`,
      foldSuffixAnsi: '',
      tagEndCol0: 0,
      hasNonChinese: params.thinkingHasNonChinese,
      collapsedRows: 1,
      expandedRows: 1,
    });

    this.persistThinkingBlocksSession();

    // 擦除：上移到 marker 行，然后 \x1b[0J 清到屏幕底
    const erase = `\x1b[${linesToErase}A\x1b[0J`;
    const xterm = this.xterm;
    const echoes = [...this.streamToolEchoes];
    const answer = params.answer;
    const layoutSplit = params.layoutSplitThinkingAnswer;

    const tail = (): void => {
      if (promptText) {
        const skillSuffix = this.currentTurnHitSkillLabel
          ? ` \x1b[30;43m[Skill: ${this.currentTurnHitSkillLabel}]\x1b[0m`
          : '';
        xterm.write(`\r\x1b[2K\x1b[36m[用户]\x1b[0m ${promptText.replaceAll('\n', '\r\n')}${skillSuffix}`);
      }

      // 固定显示思考内容框（不可折叠）
      if (th && framedBody) {
        xterm.write('\r\n');
        xterm.write(framedBody.replaceAll('\n', '\r\n'));
      }

      if (this.composerDraft().trim()) {
        xterm.write(`\r\n\x1b[90m[草稿]\x1b[0m ${this.composerDraft().trim().replaceAll('\n', '\r\n')}`);
      }

      if (!this.currentTurnSkillEchoedToXterm) {
        for (const skillLine of this.currentTurnSkillLines) {
          xterm.write(`\r\n${skillLine}`);
        }
      }

      for (const echo of echoes) {
        xterm.write(echo.replaceAll('\n', '\r\n'));
      }
      if (params.interrupted) {
        return;
      }
      if (answer) {
        xterm.write('\r\n');
        if (layoutSplit) {
          const answerLabel = this.workbenchMode.isDevMode() ? '架构师' : '超体';
          xterm.write(`\x1b[35m[${answerLabel}]\x1b[0m `);
        }
        const renderedAnswer = answer
          .replace(/\[架构师\]/g, '\x1b[35m[架构师]\x1b[0m')
          .replace(/\[前端开发\]/g, '\x1b[32m[前端开发]\x1b[0m')
          .replace(/\[后端开发\]/g, '\x1b[33m[后端开发]\x1b[0m')
          .replace(/\[测试工程师\]/g, '\x1b[36m[测试工程师]\x1b[0m');
        xterm.write(renderedAnswer.replaceAll('\n', '\r\n'));
      }

      // 安全网：清除从当前光标到屏幕底部的一切残留
      xterm.write('\x1b[J');
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

  private createStreamRenderState(): {
    thinkingBuffer: string;
    thinkingPrintedLen: number;
    thinkingHasNonChinese: boolean;
    thinkingHeaderShown: boolean;
    answerHeaderShown: boolean;
    streamRouteDeltaToThinking: boolean;
    streamRequestStartMs: number;
    currentThinkingBlockIndex: number;
  } {
    return {
      thinkingBuffer: this.thinkingBuffer,
      thinkingPrintedLen: this.thinkingPrintedLen,
      thinkingHasNonChinese: this.thinkingHasNonChinese,
      thinkingHeaderShown: this.thinkingHeaderShown,
      answerHeaderShown: this.answerHeaderShown,
      streamRouteDeltaToThinking: this.streamRouteDeltaToThinking,
      streamRequestStartMs: this.streamRequestStartMs,
      currentThinkingBlockIndex: this.streamingThinkingBlockId ?? -1,
    };
  }

  private syncStreamRenderState(next: {
    thinkingBuffer: string;
    thinkingPrintedLen: number;
    thinkingHasNonChinese: boolean;
    thinkingHeaderShown: boolean;
    answerHeaderShown: boolean;
    streamRouteDeltaToThinking: boolean;
    streamRequestStartMs: number;
    currentThinkingBlockIndex: number;
  }): void {
    if (next.thinkingBuffer.length > 0) {
      this.thinkingBuffer = next.thinkingBuffer;
    }
    this.thinkingPrintedLen = next.thinkingPrintedLen;
    if (next.thinkingHasNonChinese) {
      this.thinkingHasNonChinese = true;
    }
    this.thinkingHeaderShown = next.thinkingHeaderShown;
    this.answerHeaderShown = next.answerHeaderShown;
    this.streamRouteDeltaToThinking = next.streamRouteDeltaToThinking;
    this.streamRequestStartMs = next.streamRequestStartMs;
    if (next.currentThinkingBlockIndex >= 0) {
      this.streamingThinkingBlockId = next.currentThinkingBlockIndex;
    }
  }

  private renderThinkingHeader(blockId: number): void {
    const thHeader = `\r\n\x1b[90m[Thinking #${blockId}]\x1b[0m`;
    this.aiXtermWrite(thHeader);
    this.bumpStreamLineBudgetForWrite(thHeader);
    this.ensureAssistantStreamOutputStartMarker();
  }

  private renderThinkingBlockEnd(blockId: number): void {
  }

  private renderAnswerHeader(): void {
    const label = this.workbenchMode.isDevMode() ? '架构师' : '超体';
    const hdr = `\r\n[${label}] `;
    this.aiXtermWrite(hdr);
    this.bumpStreamLineBudgetForWrite(hdr);
    this.ensureAssistantStreamOutputStartMarker();
  }

  private renderToolLine(line: string): void {
    const decorated = line.replace(/\[Tool\]/g, '[Tool]');
    this.aiXtermWrite(decorated);
    this.streamToolEchoes.push(decorated);
    this.bumpStreamLineBudgetForWrite(decorated);
    this.ensureAssistantStreamOutputStartMarker();
  }

  private filterConsecutiveNewlines(text: string): string {
    if (!text) return text;
    
    let result = '';
    for (const char of text) {
      if (char === '\n' || char === '\r') {
        if (!this.lastAnswerCharWasNewline) {
          result += char;
          this.lastAnswerCharWasNewline = true;
          this.consecutiveNewlineCount = 1;
        } else {
          this.consecutiveNewlineCount++;
          if (this.consecutiveNewlineCount <= 2) {
            result += char;
          }
        }
      } else {
        result += char;
        this.lastAnswerCharWasNewline = false;
        this.consecutiveNewlineCount = 0;
      }
    }
    return result;
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
      const thHeader = `\r\n\x1b[90m[Thinking #${id}]\x1b[0m`;
      this.aiXtermWrite(thHeader);
      this.bumpStreamLineBudgetForWrite(thHeader);
      this.thinkingHeaderShown = true;
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
    const state = this.createStreamRenderState();
    const next = this.assistantStreamCoordinator.handleChunk(
      state,
      {
        showThinking: cfg.showThinking,
        layoutSplitThinkingAnswer: cfg.layoutSplitThinkingAnswer,
        showToolActivity: cfg.showToolActivity,
      },
      value,
      {
        write: (text) => this.aiXtermWrite(text),
        budget: (text) => this.bumpStreamLineBudgetForWrite(text),
        ensureMarker: () => this.ensureAssistantStreamOutputStartMarker(),
        onThinkingBlockStart: (blockId) => this.renderThinkingHeader(blockId),
        onThinkingBlockEnd: (blockId) => this.renderThinkingBlockEnd(blockId),
        onToolMemory: (text) => this.pushToolMemory(text),
        onToolStart: (name) => {
          this.streamRouteDeltaToThinking = false;
          this.toolCallCount.update((v) => v + 1);
          this.bumpPlanOnToolStart();
          this.pushToolMemory(`步骤：准备执行 ${name}`);
          if (cfg.showToolActivity) {
            this.renderToolLine(`\r\n\x1b[90m[Tool]\x1b[0m ${name} ...\r\n`);
          }
        },
        onToolDone: (ok, error) => {
          this.bumpPlanOnToolDone(ok);
          if (ok) {
            this.pushToolMemory('步骤完成');
            if (cfg.showToolActivity) {
              this.renderToolLine(`\x1b[90m[Tool]\x1b[0m done\r\n`);
            }
          } else {
            const detail = error ? `：${error.slice(0, 200)}` : '';
            this.pushToolMemory(`步骤失败${detail.slice(0, 80)}`);
            if (cfg.showToolActivity) {
              this.renderToolLine(`\x1b[90m[Tool]\x1b[0m failed${detail}\r\n`);
            }
          }
        },
        onAnswerText: (text) => {
          this.roundAnswerAccumulator += text;
          if (!this.assistantStreamOutputStartMarker) this.ensureAssistantStreamOutputStartMarker();
          
          this.answerBuffer += text;
          const rest = this.answerBuffer.slice(this.answerPrintedLen);
          // Buffer at least 5 characters to avoid character-by-character output
          if (rest && rest.length >= 5) {
            const filteredText = this.filterConsecutiveNewlines(rest).replace(/\r?\n+/g, ' ');
          if (filteredText) {
            this.aiXtermWrite(filteredText);
            this.bumpStreamLineBudgetForWrite(filteredText);
          }
            this.answerPrintedLen = this.answerBuffer.length;
          }
        },
      },
      () => this.ensureStreamingThinkingBlockId(),
      (text) => this.sanitizeThinkingForDisplay(text),
      (text) => this.highlightThinkingSteps(text),
      () => this.runtime.client.getModel().model,
    );
    this.syncStreamRenderState(next);
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
      if (event.key === 'Delete') return false;
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
      ke.preventDefault();
      ke.stopPropagation();
      if (this.mainLineBuffer.length === 0) return;
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
        this.aiXtermWrite(
          `\r\n\x1b[33m[提示]\x1b[0m Ctrl+C 中断 · Ctrl+Shift+C 复制 · Ctrl+Shift+V 粘贴 · 右键：有选区复制/无选区粘贴 · Ctrl+L 清屏 · Shift+Tab 切换模式\r\n`,
        );
        this.refreshMainTerminalPromptLine();
        return;
      }
      if (e.ctrlKey && e.code === 'KeyO') {
        // Ctrl+O: 不再处理思考折叠/展开
        return;
      }
      // Meta+J / Alt+J: 切换 shell 面板（M1: 终端宿主抽象）
      if ((e.metaKey || e.altKey) && e.code === 'KeyJ') {
        e.preventDefault();
        this.terminalHost.toggleShellPanel();
        return;
      }
      // Ctrl+Shift+R: 切换回放模式（M4: 历史回放）
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        if (this.replayCoordinator.isReplaying()) {
          this.replayCoordinator.toggleReplayMode();
        }
        return;
      }
      // Ctrl+Shift+D: 导出调试报告（M6: 稳定性与体验收敛）
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        const report = this.displayDebug.exportReportAsText(SESSION_ID);
        this.aiXtermWrite(`\r\n\x1b[90m${report.replaceAll('\n', '\r\n')}\x1b[0m\r\n`);
        this.refreshMainTerminalPromptLine({ scrollToBottom: false });
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

  // ── 通用终端面板（Debug / Loop） ────────────────────────────

  /** 销毁当前终端 xterm 实例（切 tab 时调用） */
  private disposeTabXterm(): void {
    if (this.debugXterm) {
      this.debugXterm.dispose();
    }
    this.debugXterm = undefined;
    this.debugFitAddon = undefined;
    this.debugResizeObserver?.disconnect();
    this.debugResizeObserver = undefined;
    this.debugTerminalInitialized = false;
    this.debugLineBuffer = '';
  }

  /** 初始化终端 xterm 实例（debug 或 loop） */
  private initDebugXterm(): void {
    const host = this.debugXtermHost?.nativeElement;
    if (!host) return;

    // 如果 xterm 已初始化但 host 变了（*ngIf 重建 DOM），先销毁旧的
    if (this.debugTerminalInitialized && this.debugXterm) {
      try { this.debugXterm.dispose(); } catch { /* ignore */ }
      this.debugXterm = undefined;
      this.debugFitAddon = undefined;
      this.debugResizeObserver?.disconnect();
      this.debugResizeObserver = undefined;
    }
    this.debugTerminalInitialized = true;
    this.debugLineBuffer = '';

    this.debugFitAddon = new FitAddon();
    this.debugXterm = new Terminal({
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

    this.debugXterm.loadAddon(this.debugFitAddon);
    this.debugXterm.open(host);

    this.debugXterm.onData((data) => {
      this.feedTabTerminalInput(data);
    });

    this.debugResizeObserver = new ResizeObserver(() => {
      this.debugFitAddon?.fit();
    });
    this.debugResizeObserver.observe(host);

    this.printTabTerminalWelcome();
  }

  /** 根据当前 tab 类型打印欢迎信息 */
  private printTabTerminalWelcome(): void {
    const tab = this.activeTab();
    if (this.isLoopTab(tab)) {
      this.debugXtermWrite(
        '\x1b[90mLoop 终端：支持 /loop 和 /debug 命令。\x1b[0m\r\n' +
        '\x1b[90m  /loop step    执行下一步  /loop status  查看状态\x1b[0m\r\n' +
        '\x1b[90m  /loop stop    暂停执行    /loop resume  恢复执行\x1b[0m\r\n' +
        '\x1b[90m  /debug loop   查看 Loop 调试信息\x1b[0m\r\n',
      );
    } else {
      this.debugXtermWrite(
        '\x1b[90mDebug 终端：仅支持 /debug 命令。输入 /debug prompt | /debug memory | /debug workbench 查看诊断信息。\x1b[0m\r\n',
      );
    }
    this.writeDebugTerminalPrompt();
  }

  /** 写入终端 */
  private debugXtermWrite(text: string): void {
    this.debugXterm?.write(text.replaceAll('\n', '\r\n'));
  }

  /** 终端提示符 */
  private writeDebugTerminalPrompt(): void {
    const tab = this.activeTab();
    if (this.isLoopTab(tab)) {
      this.debugXtermWrite('\x1b[36mloop>\x1b[0m ');
    } else {
      this.debugXtermWrite('\x1b[32m>\x1b[0m ');
    }
  }

  /** 聚焦终端 */
  protected focusDebugTerminal(): void {
    if (!this.debugTerminalInitialized) {
      setTimeout(() => {
        this.initDebugXterm();
        this.debugFitAddon?.fit();
        this.debugXterm?.focus();
      }, 0);
    } else {
      this.debugFitAddon?.fit();
      this.debugXterm?.focus();
    }
  }

  /** 处理终端输入（自动根据 tab 类型判断允许的命令） */
  private feedTabTerminalInput(data: string): void {
    if (!this.debugXterm) return;
    const isLoop = this.isLoopTab(this.activeTab());

    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const line = this.debugLineBuffer.trim();
        this.debugLineBuffer = '';
        this.debugXtermWrite('\r\n');

        if (!line) {
          this.writeDebugTerminalPrompt();
          continue;
        }

        if (isLoop) {
          // Loop 终端：允许 /loop 和 /debug 命令
          if (!line.startsWith('/loop') && !line.startsWith('/debug')) {
            this.debugXtermWrite('\x1b[31m仅支持 /loop 或 /debug 命令\x1b[0m\r\n');
            this.writeDebugTerminalPrompt();
            continue;
          }
        } else {
          // Debug 终端：仅允许 /debug 命令
          if (!line.startsWith('/debug')) {
            this.debugXtermWrite('\x1b[31m仅支持 /debug 命令，例如: /debug prompt, /debug memory, /debug workbench\x1b[0m\r\n');
            this.writeDebugTerminalPrompt();
            continue;
          }
        }

        void this.executeTabTerminalCommand(line);
        continue;
      }

      if (ch === '\x7f' || ch === '\b') {
        if (this.debugLineBuffer.length > 0) {
          this.debugLineBuffer = this.debugLineBuffer.slice(0, -1);
          this.debugXterm.write('\b \b');
        }
        continue;
      }

      if (ch === '\x03') {
        this.debugLineBuffer = '';
        this.debugXtermWrite('^C\r\n');
        this.writeDebugTerminalPrompt();
        continue;
      }

      const cp = ch.codePointAt(0);
      if (cp !== undefined && cp < 32) continue;

      this.debugLineBuffer += ch;
      this.debugXterm.write(ch);
    }
  }

  /** 在终端中执行命令 */
  private async executeTabTerminalCommand(raw: string): Promise<void> {
    const isLoop = this.isLoopTab(this.activeTab());

    // Loop 终端中的 /loop step/status/stop/resume 子命令
    if (isLoop && raw.startsWith('/loop')) {
      await this.executeLoopTerminalCommand(raw);
      return;
    }

    // 通用命令执行（/debug 等）
    try {
      const result = await this.commandExecutor.execute({
        raw,
        context: {
          source: 'user',
          sessionId: SESSION_ID,
          mode: this.runtime.coordinator.getState().mode,
        },
        options: { bridgeOrigin: true },
      });

      if (result.success && result.content) {
        this.debugXtermWrite(`${result.content}\r\n`);
      } else if (!result.success && result.content) {
        this.debugXtermWrite(`\x1b[31m${result.content}\x1b[0m\r\n`);
      }
    } catch (e) {
      this.debugXtermWrite(`\x1b[31m执行失败: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
    }
    this.writeDebugTerminalPrompt();
  }

  /** 执行 Loop 终端命令 (/loop step/status/stop/resume) */
  private async executeLoopTerminalCommand(raw: string): Promise<void> {
    const parts = raw.trim().split(/\s+/);
    const sub = parts[1]?.toLowerCase() ?? '';

    try {
      if (sub === 'step') {
        // 执行一步
        this.debugXtermWrite('\x1b[33m⏳ 执行中...\x1b[0m\r\n');
        const result = await this.loopExecutor.runOnce(SESSION_ID);
        const state = result.state;

        // 显示执行结果
        this.debugXtermWrite(`\x1b[32m✓ 步骤完成\x1b[0m ${result.executedStep?.title ?? '无'}\r\n`);
        this.debugXtermWrite(`  状态: ${state.status}  轮次: ${state.iteration}/${state.maxIterations}\r\n`);
        this.debugXtermWrite(`  验证: ${result.verification.passed ? '\x1b[32m通过\x1b[0m' : '\x1b[31m未通过\x1b[0m'}\r\n`);

        if (result.verification.blockers.length > 0) {
          this.debugXtermWrite(`  \x1b[31m阻塞: ${result.verification.blockers.join('; ')}\x1b[0m\r\n`);
        }
        if (state.currentPlan.length > 0) {
          this.debugXtermWrite(`  下一步: ${state.currentPlan[0]!.title}\r\n`);
        } else {
          this.debugXtermWrite('  \x1b[33m计划已收敛\x1b[0m\r\n');
        }

        // 如果到达终态，提示用户
        if (['completed', 'failed', 'blocked', 'ready_for_release'].includes(state.status)) {
          this.debugXtermWrite(`\x1b[36mLoop 已到达终态: ${state.status}\x1b[0m\r\n`);
        }

        // 刷新卡片视图状态
        this.refreshLoopState();
      } else if (sub === 'status') {
        // 显示当前状态（status 本身就是读取最新状态）
        const state = this.loopCommand.get(SESSION_ID);
        if (!state) {
          this.debugXtermWrite('\x1b[31m无活跃 Loop 会话\x1b[0m\r\n');
        } else {
          this.debugXtermWrite(`目标: ${state.objective}\r\n`);
          this.debugXtermWrite(`状态: ${state.status}  阶段: ${state.phase}  轮次: ${state.iteration}/${state.maxIterations}\r\n`);
          this.debugXtermWrite(`团队: ${state.teamName}  类型: ${state.taskType}\r\n`);

          if (state.currentPlan.length > 0) {
            this.debugXtermWrite('\x1b[36m计划:\x1b[0m\r\n');
            for (const s of state.currentPlan) {
              this.debugXtermWrite(`  [${s.type}] ${s.title} (${s.status})\r\n`);
            }
          }
          if (state.blockedReasons.length > 0) {
            this.debugXtermWrite(`\x1b[31m阻塞: ${state.blockedReasons.join('; ')}\x1b[0m\r\n`);
          }
        }
      } else if (sub === 'stop') {
        this.loopCommand.update(SESSION_ID, { status: 'paused' });
        this.debugXtermWrite('\x1b[33mLoop 已暂停\x1b[0m\r\n');
        this.refreshLoopState();
      } else if (sub === 'resume') {
        this.loopCommand.update(SESSION_ID, { status: 'executing' });
        this.debugXtermWrite('\x1b[32mLoop 已恢复\x1b[0m\r\n');
        this.refreshLoopState();
      } else {
        this.debugXtermWrite(`\x1b[31m未知子命令: ${sub || '(空)'}\x1b[0m\r\n`);
        this.debugXtermWrite('可用命令: /loop step | /loop status | /loop stop | /loop resume\r\n');
      }
    } catch (e) {
      this.debugXtermWrite(`\x1b[31m执行失败: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
    }
    this.writeDebugTerminalPrompt();
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
        }
        // tool 角色内容保存但不展示，历史回放只展示用户输入和助手回答
      }
    } catch {
      // ignore history replay failures
    }
  }

  private writeMainTerminalPrompt(): void {
    this.lastInputRowCount = 1;
    const cols = Math.max(40, this.xterm?.cols ?? 80);
    if (this.hasCompletedTurn) {
      const sep = `\x1b[90m${'┄'.repeat(cols)}\x1b[0m`;
      this.aiXtermWrite(`\r\n${sep}\r\n\x1b[36m[用户]\x1b[0m `);
    } else {
      this.aiXtermWrite(`\r\n\x1b[36m[用户]\x1b[0m `);
    }
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
        if (acc === '\x1b[3~') {
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
        this.lastInputRowCount = 1;
        this.aiXtermWrite('\r\n');
        void this.dispatchMainTerminalLine(line);
        continue;
      }
      if (ch === '\x7f' || ch === '\b') {
        if (this.mainLineBuffer.length > 0) {
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

      const cols = this.xterm?.cols ?? 80;
      const promptLen = 7;
      const bufferLen = this.computeDisplayWidth(this.mainLineBuffer);
      this.lastInputRowCount = Math.max(1, Math.ceil((promptLen + bufferLen) / cols));
    }
  }

  private clearSlashHintRow(): void {
    if (!this.slashHintRowActive) return;
    const rows = this.slashHintRowCount;
    // 保存光标 -> 下移 1 行到提示首行 -> 清除 N 行 -> 恢复光标
    this.xterm?.write(`\x1b[s\x1b[1B` +
      Array.from({ length: rows }, () => '\x1b[2K\x1b[1B').join('') +
      `\x1b[${rows + 1}A\x1b[u`);
    this.slashHintRowActive = false;
    this.slashHintRowCount = 0;
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

  /** 输入 `/` 前缀时：在下一行实时刷新「同前缀指令」纵向排列 */
  private syncSlashCompletionRow(): void {
    const line = this.mainLineBuffer;
    const show = line.startsWith('/') && !line.includes(' ');
    if (!show) {
      this.clearSlashHintRow();
      return;
    }
    // 先清除旧提示
    const wasActive = this.slashHintRowActive;
    const oldRows = this.slashHintRowCount;
    if (wasActive && oldRows > 0) {
      this.xterm?.write(`\x1b[s\x1b[1B` +
        Array.from({ length: oldRows }, () => '\x1b[2K\x1b[1B').join('') +
        `\x1b[${oldRows + 1}A\x1b[u`);
      this.slashHintRowActive = false;
    }

    const matches = this.visibleDirectives().filter((d) => d.name.startsWith(line));
    const hint =
      matches.length > 0
        ? matches.map((d) => `\x1b[90m  ${d.name}\x1b[0m`).join('\r\n')
        : '\x1b[90m(无匹配)\x1b[0m';
    this.xterm?.write(`\x1b[s\r\n\x1b[2K${hint}\x1b[u`);
    this.slashHintRowActive = true;
    this.slashHintRowCount = matches.length > 0 ? matches.length : 1;
  }

  /** Ctrl+C：取消流式请求；空闲时清空当前输入行 */
  private handleTerminalControlC(): void {
    if (this.streamStop) {
      // 与正常结束保持一致：仅标记中断并停止流，不在此处提前清空 thinking 状态
      // 最终由 askAssistant finally 中的 finalizeAssistantStreamUi 统一收口，确保思考过程按折叠态隐藏
      this.streamInterruptRequested = true;
      this.terminalBusy.set(false);
      try {
        this.streamStop();
      } catch {
        /* ignore */
      }
      this.streamStop = undefined;
      void this.streamReader?.cancel();
      this.writeMainTerminalPrompt();
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

    const cols = this.xterm?.cols ?? 80;
    const promptLen = 7;
    const bufferLen = this.computeDisplayWidth(this.mainLineBuffer);
    const newRowCount = Math.max(1, Math.ceil((promptLen + bufferLen) / cols));
    const eraseRows = Math.max(this.lastInputRowCount, newRowCount);

    if (eraseRows > 1) {
      this.aiXtermWrite(`\x1b[${eraseRows - 1}A`);
    }
    for (let i = 0; i < eraseRows; i++) {
      if (i > 0) this.aiXtermWrite('\x1b[1B');
      this.aiXtermWrite('\r\x1b[2K');
    }
    if (eraseRows > 1) {
      this.aiXtermWrite(`\x1b[${eraseRows - 1}A`);
    }

    this.aiXtermWrite(`\x1b[36m[用户]\x1b[0m ${this.mainLineBuffer}`);

    this.lastInputRowCount = newRowCount;

    this.syncSlashCompletionRow();
  }

  private computeDisplayWidth(s: string): number {
    let w = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0) ?? 0;
      if (
        (cp >= 0x1100 && cp <= 0x115F) ||
        (cp >= 0x2329 && cp <= 0x232A) ||
        (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) ||
        (cp >= 0xAC00 && cp <= 0xD7A3) ||
        (cp >= 0xF900 && cp <= 0xFAFF) ||
        (cp >= 0xFE10 && cp <= 0xFE19) ||
        (cp >= 0xFE30 && cp <= 0xFE6F) ||
        (cp >= 0xFF01 && cp <= 0xFF60) ||
        (cp >= 0xFFE0 && cp <= 0xFFE6) ||
        (cp >= 0x1F300 && cp <= 0x1FAFF) ||
        (cp >= 0x20000 && cp <= 0x2FFFD) ||
        (cp >= 0x30000 && cp <= 0x3FFFD)
      ) {
        w += 2;
      } else {
        w += 1;
      }
    }
    return w;
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

  protected cycleWorkbenchCoordinationMode(): void {
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
      this.lastInputRowCount = 1;
      this.aiXtermWrite(`\r\x1b[2K\x1b[36m[用户]\x1b[0m `);
      return;
    }
    if (this.terminalBusy()) {
      this.aiXtermWrite('\x1b[33m(busy)\x1b[0m\r\n');
      this.writeMainTerminalPrompt();
      return;
    }

    // ── Loop 需求收集模式：用户正在回答需求澄清问题 ──
    if (this.loopGatheringMode()) {
      await this.handleLoopGatheringInput(t);
      return;
    }

    // ── Team Struct 确认模式：用户正在确认/取消 struct 方案 ──
    if (this.structConfirmMode()) {
      await this.handleStructConfirmInput(t);
      return;
    }

    if (this.activeTab() === 'Loop / Task') {
      const loopHandled = await this.handleLoopTabInput(t);
      if (loopHandled) return;
    }

    if (/^\/team\b/i.test(t)) {
      this.pushHistory(t);
      const processedTeam = await this.commandProcessing.process(t, {
        sessionId: SESSION_ID,
        mode: this.runtime.coordinator.getState().mode,
        source: 'user',
      }, {
        source: 'user',
        preservePrefixes: false,
        allowBridgeSlashCommands: true,
      });
      
      const hasTabKey = !!processedTeam.executionResult.metadata?.['tabKey'];
      const hasOpenInEditor = !!processedTeam.executionResult.metadata?.['openInEditor'];
      const filePath = typeof processedTeam.executionResult.metadata?.['filePath'] === 'string' 
        ? String(processedTeam.executionResult.metadata['filePath']) : '';
      
      const isConfirmationRequired = !!processedTeam.executionResult.metadata?.['confirmationRequired'];
      
      if (isConfirmationRequired) {
        const structName = String(processedTeam.executionResult.metadata?.['structName'] ?? '');
        const planText = String(processedTeam.executionResult.metadata?.['planText'] ?? processedTeam.executionResult.content ?? '');
        
        this.structConfirmMode.set(true);
        this.structConfirmName.set(structName);
        this.structConfirmInputEchoed.set(false);
        
        this.presentUnifiedCommandEntry(processedTeam.executionResult);
        this.writeMainTerminalPrompt();
        return;
      }
      
      if (hasTabKey) {
        const tabKey = String(processedTeam.executionResult.metadata!['tabKey']);
        const isTeamCommand = /^team-(role|struct):/i.test(tabKey);
        
        if (isTeamCommand && filePath) {
          this.addTabIfMissing(tabKey);
          const openScope = processedTeam.executionResult.metadata?.['openScope'] === 'workspace' ? 'workspace' : 'vault';
          
          this.projectTreeExpanded.set(false);
          this.recentSessionsExpanded.set(false);
          this.memoryVaultExpanded.set(true);
          
          const tree = openScope === 'workspace' ? this.workspaceTree() : this.memoryTree();
          this.collapseAllDirNodes(tree);
          if (openScope === 'workspace') {
            this.workspaceTree.set([...tree]);
          } else {
            this.memoryTree.set([...tree]);
          }
          
          const generatedRoleFiles = Array.isArray(processedTeam.executionResult.metadata?.['generatedRoleFiles'])
            ? processedTeam.executionResult.metadata!['generatedRoleFiles'] as string[] : [];
          
          void this.openFileByPath(filePath, openScope).then(async () => {
            await this.expandAndSelectFile(filePath, openScope);
            this.setTab(tabKey);
            const markdown = String(processedTeam.executionResult.metadata?.['markdown'] ?? processedTeam.executionResult.content ?? '');
            if (markdown) {
              this.selectedContent.set(markdown);
            }
            this.editorDirty.set(false);
            this.tabEditorState.set(tabKey, {
              relPath: filePath,
              content: markdown,
              previewKind: 'code',
              dirty: false,
              fsScope: openScope,
            });
            
            if (generatedRoleFiles.length > 0) {
              const rolesDir = '03-AGENT-TOOLS/03-Roles';
              const rolesDirNode = this.memoryTree().find(n => n.type === 'dir' && n.name === '03-AGENT-TOOLS');
              if (rolesDirNode) {
                await this.loadDir('03-AGENT-TOOLS', rolesDirNode, 'vault');
                const rolesNode = (rolesDirNode.children || []).find(n => n.type === 'dir' && n.name === '03-Roles');
                if (rolesNode) {
                  await this.loadDir(rolesDir, rolesNode, 'vault');
                }
                this.memoryTree.set([...this.memoryTree()]);
              }
            }
          });
        } else {
          this.presentUnifiedCommandEntry(processedTeam.executionResult);
        }
      } else {
        this.presentUnifiedCommandEntry(processedTeam.executionResult);
        
        if (hasOpenInEditor && filePath) {
          const openScope = processedTeam.executionResult.metadata?.['openScope'] === 'workspace' ? 'workspace' : 'vault';
          
          this.projectTreeExpanded.set(false);
          this.recentSessionsExpanded.set(false);
          this.memoryVaultExpanded.set(true);
          
          const tree = openScope === 'workspace' ? this.workspaceTree() : this.memoryTree();
          this.collapseAllDirNodes(tree);
          if (openScope === 'workspace') {
            this.workspaceTree.set([...tree]);
          } else {
            this.memoryTree.set([...tree]);
          }
          
          void this.openFileByPath(filePath, openScope).then(async () => {
            await this.expandAndSelectFile(filePath, openScope);
          });
        }
      }
      this.writeMainTerminalPrompt();
      return;
    }

    this.pushHistory(t);

    const processed = await this.commandProcessing.process(t, {
      sessionId: SESSION_ID,
      mode: this.runtime.coordinator.getState().mode,
      source: 'user',
    }, {
      source: 'user',
      preservePrefixes: false,
      allowBridgeSlashCommands: true,
    });

    try {
      // 检测 /loop 命令进入需求收集模式
      if (processed.executionResult.metadata?.['mode'] === 'loop-gathering') {
        this.loopGatheringMode.set(true);
        this.loopGatheringGoal.set(String(processed.executionResult.metadata?.['goal'] ?? ''));
        this.loopPendingUseMultiAgent.set(Boolean(processed.executionResult.metadata?.['useMultiAgent']));
        this.loopInputEchoed.set(false);
        // 展示需求问题到主终端
        this.presentUnifiedCommandEntry(processed.executionResult);
        // 检测是否需要进入 loop 页（已有 tabKey 的情况走原有逻辑）
        if (!processed.executionResult.metadata?.['tabKey']) {
          this.writeMainTerminalPrompt();
          return;
        }
      }

      // debug 命令不在主终端展示任何内容（结果在独立 debug 终端 tab 中展示）
      const isTerminalTabDirective = processed.executionResult.responseType === 'directive' &&
        /^\/debug\b/i.test(processed.preprocessed.normalized.trim());
      
      // 对于 natural 或 fallback 路由，不调用 presentUnifiedCommandEntry，避免重复输出用户输入
      const isNaturalOrFallback = processed.executionResult.responseType === 'fallback' || 
                                  processed.routeResult.route === 'natural' ||
                                  (processed.executionResult.responseType !== 'directive' && 
                                   processed.executionResult.responseType !== 'shell');

      if (!isTerminalTabDirective && !isNaturalOrFallback) {
        this.presentUnifiedCommandEntry(processed.executionResult);
      }

      if (processed.executionResult.responseType === 'directive') {
        await this.runDirective(processed.preprocessed.normalized);
        return;
      }
      if (processed.executionResult.responseType === 'shell') {
        const shell = processed.executionResult.metadata?.['command']
          ? String(processed.executionResult.metadata['command'])
          : (processed.preprocessed.normalized.startsWith('!')
            ? processed.preprocessed.normalized.slice(1).trim()
            : processed.preprocessed.normalized);
        await this.runShell(shell);
        return;
      }
      if (processed.executionResult.responseType === 'fallback') {
        const natural = processed.executionResult.content;
        await this.askAssistant(natural);
        return;
      }
      if (processed.routeResult.route === 'natural') {
        const natural = processed.preprocessed.normalized.startsWith('?')
          ? processed.preprocessed.normalized.slice(1).trim()
          : processed.preprocessed.normalized;
        await this.askAssistant(natural);
        return;
      }
      await this.askAssistant(processed.preprocessed.normalized);
    } catch (error) {
      this.aiXtermWrite(`\r\n\x1b[31m[error]\x1b[0m ${error}\r\n`);
      this.terminalBusy.set(false);
      this.writeMainTerminalPrompt();
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

  private collapseAllDirNodes(nodes: FileNode[]): void {
    for (const n of nodes) {
      if (n.type === 'dir') {
        n.expanded = false;
        if (n.children?.length) this.collapseAllDirNodes(n.children);
      }
    }
  }

  protected async expandAndSelectFile(filePath: string, scope: 'workspace' | 'vault' = 'vault'): Promise<void> {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length === 0) return;

    const tree = scope === 'workspace' ? this.workspaceTree() : this.memoryTree();
    const treeSignal = scope === 'workspace' ? this.workspaceTree : this.memoryTree;
    
    let currentNodes = tree;
    let currentPath = '';
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      const dirNode = currentNodes.find(n => n.type === 'dir' && n.name === part);
      if (!dirNode) break;
      
      dirNode.loaded = false;
      await this.loadDir(currentPath, dirNode, scope);
      
      dirNode.expanded = true;
      currentNodes = dirNode.children || [];
    }
    
    treeSignal.set([...treeSignal()]);
    
    const fileName = parts[parts.length - 1];
    const fileNode = currentNodes.find(n => n.type === 'file' && n.name === fileName);
    if (fileNode) {
      await this.openFile(fileNode);
    }
  }

  // ── Loop 需求收集处理 ────────────────────────────────────

  /** 确认关键词 */
  private static readonly LOOP_CONFIRM_WORDS = /^(确认|开始|go|yes|ok|好|确定|继续|start|confirm)$/i;
  /** 取消关键词 */
  private static readonly LOOP_CANCEL_WORDS = /^(取消|cancel|退出|quit|stop|abort|no)$/i;

  /** 处理 Loop 需求收集阶段的用户输入 */
  private async handleLoopGatheringInput(input: string): Promise<void> {
    if (!this.loopInputEchoed()) {
      this.aiXtermWrite(`\r\n\x1b[90m[用户]\x1b[0m ${input}\r\n`);
      this.loopInputEchoed.set(true);
    }

    if (WorkbenchPageComponent.LOOP_CONFIRM_WORDS.test(input)) {
      await this.confirmAndEnterLoop();
      return;
    }

    if (WorkbenchPageComponent.LOOP_CANCEL_WORDS.test(input)) {
      this.loopGatheringMode.set(false);
      this.loopGatheringGoal.set('');
      this.loopPendingUseMultiAgent.set(false);
      this.loopInputEchoed.set(false);
      this.aiXtermWrite('\x1b[33m[loop] 需求收集已取消。\x1b[0m\r\n');
      this.writeMainTerminalPrompt();
      return;
    }

    this.aiXtermWrite('\x1b[90m[loop] 已记录。继续回答问题，或输入"确认"进入执行页面、"取消"退出。\x1b[0m\r\n');
    this.writeMainTerminalPrompt();
  }

  private static readonly STRUCT_CONFIRM_WORDS = /^(确认|confirm|yes|ok|好|确定|继续|go)$/i;
  private static readonly STRUCT_CANCEL_WORDS = /^(取消|cancel|退出|quit|stop|abort|no|放弃)$/i;

  private async handleStructConfirmInput(input: string): Promise<void> {
    if (!this.structConfirmInputEchoed()) {
      this.aiXtermWrite(`\r\n\x1b[90m[用户]\x1b[0m ${input}\r\n`);
      this.structConfirmInputEchoed.set(true);
    }

    const structName = this.structConfirmName();

    if (WorkbenchPageComponent.STRUCT_CONFIRM_WORDS.test(input)) {
      this.structConfirmMode.set(false);
      this.structConfirmName.set('');
      this.structConfirmInputEchoed.set(false);
      this.aiXtermWrite('\x1b[36m[team-struct] 正在创建协作结构...\x1b[0m\r\n');
      await this.dispatchMainTerminalLine(`/team-struct confirm ${structName}`);
      return;
    }

    if (WorkbenchPageComponent.STRUCT_CANCEL_WORDS.test(input)) {
      this.structConfirmMode.set(false);
      this.structConfirmName.set('');
      this.structConfirmInputEchoed.set(false);
      this.aiXtermWrite('\x1b[33m[team-struct] 方案已取消。\x1b[0m\r\n');
      this.writeMainTerminalPrompt();
      return;
    }

    this.structConfirmMode.set(false);
    this.structConfirmInputEchoed.set(false);
    this.aiXtermWrite('\x1b[36m[team-struct] 正在更新方案...\x1b[0m\r\n');
    await this.dispatchMainTerminalLine(`/team-struct update ${input}`);
  }

  /** Loop tab 中的输入：用于继续执行或回到主终端 */
  private async handleLoopTabInput(input: string): Promise<boolean> {
    const t = input.trim();
    if (!t) return false;

    if (WorkbenchPageComponent.LOOP_CANCEL_WORDS.test(t)) {
      this.aiXtermWrite('\x1b[33m[loop] 已退出当前 Loop 任务。\x1b[0m\r\n');
      this.setTab('Terminal - Main');
      return true;
    }

    if (WorkbenchPageComponent.LOOP_CONFIRM_WORDS.test(t)) {
      this.aiXtermWrite('\x1b[36m[loop] 当前任务继续执行中。\x1b[0m\r\n');
      await this.executeLoopCycleOnce(this.activeLoopSessionId() || SESSION_ID);
      return true;
    }

    if (/^\/team\b/i.test(t)) {
      this.aiXtermWrite('\x1b[36m[team] 将在主终端处理团队创建命令。\x1b[0m\r\n');
      this.setTab('Terminal - Main');
      await this.dispatchMainTerminalLine(t);
      return true;
    }

    await this.dispatchMainTerminalLine(t);
    return true;
  }

  /** 确认需求并创建 Loop 会话，进入 Loop tab，自动立即执行 */
  private async confirmAndEnterLoop(): Promise<void> {
    const goal = this.loopGatheringGoal();
    const sessionId = SESSION_ID;
    const useMultiAgent = this.loopPendingUseMultiAgent();

    const state = this.loopCommand.start(`/loop ${goal}`, sessionId);
    if (!state) {
      this.loopGatheringMode.set(false);
      this.loopPendingUseMultiAgent.set(false);
      this.loopInputEchoed.set(false);
      this.aiXtermWrite('\x1b[31m[loop] 无法启动 Loop 会话。\x1b[0m\r\n');
      this.writeMainTerminalPrompt();
      return;
    }

    this.loopGatheringMode.set(false);
    this.loopGatheringGoal.set('');
    this.loopInputEchoed.set(false);
    this.loopPendingUseMultiAgent.set(false);

    this.loopTaskList.update((list) => {
      if (list.some((t) => t.loopId === state.loopId)) return list;
      return [...list, state];
    });
    this.activeLoopSessionId.set(state.taskId);
    this.currentLoopState.set(state);
    this.loopLogBuffers.set(state.taskId, []);

    const tabKey = 'Loop / Task';
    this.addTabIfMissing(tabKey);
    this.activeTab.set(tabKey);
    this.loopViewMode.set('cards');

    this.aiXtermWrite('\x1b[36m[loop]\x1b[0m 已进入 \x1b[33mLoop 执行页面\x1b[0m，任务自动立即执行...\r\n');
    this.writeMainTerminalPrompt();

    this.renderLoopThoughtBox([
      `目标：${goal}`,
      `任务初稿：${state.taskType}`,
      useMultiAgent ? '路径：多智能体协作' : '路径：单智能体执行',
      '状态：需求已进入分析与调度阶段',
    ]);
    this.renderLoopStatusBox([
      `会话：${state.taskId}`,
      `状态：${state.status}`,
      `阶段：${state.phase}`,
      `轮次：${state.iteration}/${state.maxIterations}`,
      `团队：${state.teamName}`,
    ]);
    this.renderLoopPathBox([
      useMultiAgent ? '复杂度较高，建议多智能体协作。' : '任务较简单，采用单智能体即可。',
      useMultiAgent ? '策略：拆分为规划 / 实现 / 验证' : '策略：直接进入执行与验证',
    ]);
    this.renderLoopExecutionLog(['已创建任务卡片并开始调度执行']);

    if (useMultiAgent && this.multiAgentSidebar) {
      this.multiAgentSidebar.setCurrentRequest(goal);
      this.multiAgentSidebar.setDefaultAgentStatus('thinking');
      this.multiAgentSidebar.processRequest(goal).catch((error) => {
        this.renderLoopExecutionLog([`智能体请求失败：${error instanceof Error ? error.message : String(error)}`]);
      });
    }

    if (!useMultiAgent) {
      this.renderLoopExecutionLog(['已选择单智能体路径，等待主模型生成方案']);
    }

    void this.askAssistant(
      `请根据以下 Loop 目标生成执行方案、必要文档与下一步建议，要求先给出可执行计划，再继续推进：${goal}`,
      { skipTerminalUserLineAnchor: true },
    );

    await this.executeLoopCycleOnce(sessionId);
    this.startLoopAutoSchedule(sessionId);
  }

  /** 执行一次 Loop cycle（1-3 步），并刷新状态和日志 */
  private async executeLoopCycleOnce(sessionId: string): Promise<void> {
    const state = this.loopCommand.get(sessionId);
    if (!state) return;

    // 如果已达终止状态或暂停状态（等待 Agent），停止调度
    if (this.isLoopTerminalStatus(state.status)) {
      this.stopLoopAutoSchedule();
      return;
    }

    // 如果正在等待 Agent（implementation 步骤），暂停调度
    if (state.status === 'paused') {
      const waitingStep = state.currentPlan[0]?.title ?? '未知步骤';
      this.renderLoopStatusBox([
        `会话：${state.taskId}`,
        `状态：${state.status}`,
        `阶段：${state.phase}`,
        `轮次：${state.iteration}/${state.maxIterations}`,
        `当前等待：${waitingStep}`,
      ]);
      this.renderLoopExecutionLog([
        `⏸ 等待 Agent 执行: ${waitingStep}（请等待 Agent 完成后手动触发）`,
      ]);
      this.refreshLoopState();
      this.stopLoopAutoSchedule();
      return;
    }

    // 如果当前计划为空（无待执行步骤），停止调度
    if (state.currentPlan.length === 0 && state.completedSteps.length > 0) {
      this.appendLoopLog(`[${new Date().toLocaleTimeString('zh-CN')}] ✅ 所有任务已完成`);
      this.refreshLoopState();
      this.stopLoopAutoSchedule();
      return;
    }

    try {
      // 执行一轮（最多 3 步）
      const results = await this.loopExecutor.runCycle(sessionId, 3);

      // 无结果（步骤全部被跳过）
      if (results.length === 0) {
        this.renderLoopExecutionLog([`${new Date().toLocaleTimeString('zh-CN')} ⏹ 无可执行步骤，Loop 停止`]);
        this.stopLoopAutoSchedule();
        return;
      }

      for (const result of results) {
        const executedStep = result.executedStep;
        const timestamp = new Date().toLocaleTimeString('zh-CN');
        const stepLine = executedStep
          ? `${timestamp} ${result.state.status === 'paused' ? '⏸' : result.verification.passed ? '✓' : '✗'} ${executedStep.title} → ${result.state.status}`
          : `${timestamp} 执行完成 → ${result.state.status}`;
        this.renderLoopExecutionLog([stepLine, ...(result.verification.blockers.length > 0 ? [`⚠ 阻塞: ${result.verification.blockers.join('; ')}`] : [])]);
      }

      // 刷新卡片状态
      const latestState = this.loopCommand.get(sessionId);
      this.refreshLoopState();

      // 如果已达终止状态或暂停状态，停止调度
      if (latestState && (this.isLoopTerminalStatus(latestState.status) || latestState.status === 'paused')) {
        if (latestState.status === 'paused') {
          this.renderLoopStatusBox([
            `会话：${latestState.taskId}`,
            `状态：${latestState.status}`,
            `当前等待：${latestState.currentPlan[0]?.title ?? '等待下一步'}`,
          ]);
        } else {
          this.renderLoopStatusBox([
            `会话：${latestState.taskId}`,
            `状态：${latestState.status}`,
            `阶段：${latestState.phase}`,
          ]);
        }
        this.stopLoopAutoSchedule();
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.appendLoopSection('执行日志', [`❌ 执行异常: ${errMsg}`]);
      this.refreshLoopState();
    }
  }

  /** 启动 Loop 自动调度 */
  private startLoopAutoSchedule(sessionId: string): void {
    // 先停止已有的调度
    this.stopLoopAutoSchedule();

    this.loopScheduleIntervalId = setInterval(async () => {
      const state = this.loopCommand.get(sessionId);
      if (!state || this.isLoopTerminalStatus(state.status)) {
        this.stopLoopAutoSchedule();
        return;
      }
      await this.executeLoopCycleOnce(sessionId);
    }, 5000);
  }

  /** 停止 Loop 自动调度 */
  private stopLoopAutoSchedule(): void {
    if (this.loopScheduleIntervalId !== null) {
      clearInterval(this.loopScheduleIntervalId);
      this.loopScheduleIntervalId = null;
    }
  }

  /** 判断 Loop 状态是否为终止状态 */
  private isLoopTerminalStatus(status: string): boolean {
    return ['completed', 'ready_for_release', 'failed', 'blocked', 'paused'].includes(status);
  }

  /** 追加一行 Loop 日志到当前活动任务的缓冲 */
  private appendLoopLog(line: string): void {
    const sid = this.activeLoopSessionId();
    if (!sid) return;
    let buf = this.loopLogBuffers.get(sid);
    if (!buf) { buf = []; this.loopLogBuffers.set(sid, buf); }
    buf.push(line);
    if (buf.length > this.LOOP_LOG_BUFFER_MAX) buf.shift();
  }

  private appendLoopSection(title: string, bodyLines: string[]): void {
    const width = 58;
    const header = `╭─ ${title} ${'─'.repeat(Math.max(4, width - title.length - 3))}`;
    this.appendLoopLog(header);
    for (const line of bodyLines) {
      this.appendLoopLog(`│ ${line}`);
    }
    this.appendLoopLog(`╰${'─'.repeat(Math.max(4, width - 1))}`);
  }

  private renderLoopThoughtBox(lines: string[]): void {
    this.appendLoopSection('思考框', lines);
  }

  private renderLoopStatusBox(lines: string[]): void {
    this.appendLoopSection('状态块', lines);
  }

  private renderLoopPathBox(lines: string[]): void {
    this.appendLoopSection('路径判断', lines);
  }

  private renderLoopExecutionLog(lines: string[]): void {
    this.appendLoopSection('执行日志', lines);
  }

  /** 获取当前活动 Loop 任务的日志缓冲（供模板使用） */
  protected getLoopLogBuffer(): string[] {
    const sid = this.activeLoopSessionId();
    return sid ? (this.loopLogBuffers.get(sid) ?? []) : [];
  }

  /** 切换当前查看的 Loop 任务 */
  protected selectLoopTask(sessionId: string): void {
    this.activeLoopSessionId.set(sessionId);
    const task = this.loopTaskList().find((t) => t.taskId === sessionId || t.loopId === sessionId);
    if (task) {
      this.currentLoopState.set(task);
      // 切换到终端视图以显示该任务的日志
      this.loopViewMode.set('terminal');
      this.appendLoopLog(`[${new Date().toLocaleTimeString('zh-CN')}] 🔎 切换任务卡片：${task.objective}`);
      this.appendLoopLog(`[${new Date().toLocaleTimeString('zh-CN')}] ▶ 重新聚焦任务执行上下文，准备渲染思考过程`);
      this.renderTaskTerminalContext(task.taskId);
      setTimeout(() => {
        this.initDebugXterm();
        this.debugFitAddon?.fit();
        // 将该任务的历史日志渲染到 xterm
        const logs = this.loopLogBuffers.get(task.taskId) ?? [];
        for (const line of logs) {
          this.debugXtermWrite(line + '\r\n');
        }
        this.debugXterm?.focus();
      }, 0);
    }
  }

  private renderTaskTerminalContext(sessionId: string): void {
    const task = this.loopTaskList().find((t) => t.taskId === sessionId || t.loopId === sessionId);
    if (!task) return;

    const lines = [
      `[${new Date().toLocaleTimeString('zh-CN')}] ╭─ Loop 任务上下文`,
      `[${new Date().toLocaleTimeString('zh-CN')}] │ 目标：${task.objective}`,
      `[${new Date().toLocaleTimeString('zh-CN')}] │ 类型：${task.taskType}`,
      `[${new Date().toLocaleTimeString('zh-CN')}] │ 状态：${task.status}`,
      `[${new Date().toLocaleTimeString('zh-CN')}] │ 轮次：${task.iteration}/${task.maxIterations}`,
      `[${new Date().toLocaleTimeString('zh-CN')}] │ 当前计划：${task.currentPlan[0]?.title ?? '无'}`,
      `[${new Date().toLocaleTimeString('zh-CN')}] │ 已完成：${task.completedSteps.length}`,
      `[${new Date().toLocaleTimeString('zh-CN')}] │ 文档：${task.stepDocs.length}`,
      `[${new Date().toLocaleTimeString('zh-CN')}] │ 工件：${task.artifacts.length}`,
      `[${new Date().toLocaleTimeString('zh-CN')}] ╰─ 正在等待智能体/终端执行结果`,
    ];
    for (const line of lines) this.appendLoopLog(line);
  }

  /** 获取任务状态对应的 CSS class */
  protected getTaskStatusClass(status: string): string {
    switch (status) {
      case 'executing': return 'status-executing';
      case 'verifying': return 'status-verifying';
      case 'completed': case 'ready_for_release': case 'ready_for_review': return 'status-completed';
      case 'failed': return 'status-failed';
      case 'blocked': return 'status-blocked';
      case 'paused': return 'status-paused';
      case 'planning': return 'status-planning';
      default: return 'status-idle';
    }
  }

  /** 打开 Loop 文档到编辑器 Tab 查看内容 */
  protected async openLoopDoc(doc: import('./debug/loop-command.types').LoopStepDoc): Promise<void> {
    this.selectedDocId.set(doc.id);
    const tabLabel = `📄 ${doc.title}`;
    this.addTabIfMissing(tabLabel);

    let content = doc.content ?? '';
    // 尝试从 vault 文件系统读取最新内容
    if (!content && typeof window !== 'undefined' && window.zytrader?.fs?.read) {
      try {
        const result = await window.zytrader.fs.read(doc.path, { scope: 'vault' });
        if (result.ok && result.content) {
          content = result.content;
        }
      } catch {
        content = `# ${doc.title}\n\n> 文档路径: ${doc.path}\n> 创建时间: ${doc.createdAt}\n\n文档内容正在生成中，请稍候...`;
      }
    }
    if (!content) {
      content = `# ${doc.title}\n\n> 文档路径: ${doc.path}\n> 创建时间: ${doc.createdAt}\n\n（暂无内容）`;
    }

    this.tabEditorState.set(tabLabel, {
      relPath: doc.path,
      content,
      previewKind: 'code',
      dirty: false,
      fsScope: 'vault',
    });
    this.activeTab.set(tabLabel);
    this.selectedPath.set(doc.path);
    this.selectedContent.set(content);
    this.previewKind.set('code');
    this.editorDirty.set(false);
  }

  /** 打开 Loop 工件文件到编辑器 Tab */
  protected async openArtifact(artifact: import('./debug/loop-command.types').LoopArtifact): Promise<void> {
    const tabLabel = `📎 ${artifact.label}`;
    this.addTabIfMissing(tabLabel);

    let content = '';
    if (typeof window !== 'undefined' && window.zytrader?.fs?.read) {
      try {
        const scope = artifact.path.startsWith('02-AGENT-MEMORY') ? ('vault' as const) : ('workspace' as const);
        const result = await window.zytrader.fs.read(artifact.path, { scope });
        if (result.ok && result.content) {
          content = result.content;
        }
      } catch {
        content = `# ${artifact.label}\n\n> 路径: ${artifact.path}\n> 类型: ${artifact.kind}\n\n无法读取文件内容`;
      }
    }
    if (!content) {
      content = `# ${artifact.label}\n\n> 路径: ${artifact.path}\n> 类型: ${artifact.kind}\n\n（空文件或无法读取）`;
    }

    this.tabEditorState.set(tabLabel, {
      relPath: artifact.path,
      content,
      previewKind: 'code',
      dirty: false,
      fsScope: artifact.path.startsWith('02-AGENT-MEMORY') ? 'vault' : 'workspace',
    });
    this.activeTab.set(tabLabel);
    this.selectedPath.set(artifact.path);
    this.selectedContent.set(content);
    this.previewKind.set('code');
    this.editorDirty.set(false);
  }

  /** 获取文档状态 CSS class */
  protected getDocStatusClass(doc: import('./debug/loop-command.types').LoopStepDoc): string {
    if (doc.content) return 'ready';
    return 'pending';
  }

  /** 获取文档状态标签 */
  protected getDocStatusLabel(doc: import('./debug/loop-command.types').LoopStepDoc): string {
    if (doc.content) return '可查看';
    return '生成中';
  }

  private async runDirective(raw: string): Promise<void> {
    const result = await this.commandExecutor.execute({
      raw,
      context: {
        source: 'user',
        sessionId: SESSION_ID,
        mode: this.runtime.coordinator.getState().mode,
      },
      options: {
        bridgeOrigin: true,
      },
    });

    // 有 tabKey 的命令结果展示到独立 tab，主终端不输出重复内容
    const hasTabKey = !!result.metadata?.['tabKey'];
    const hasOpenInEditor = !!result.metadata?.['openInEditor'];
    const filePath = typeof result.metadata?.['filePath'] === 'string' ? String(result.metadata['filePath']) : '';
    
    if (hasTabKey) {
      const tabKey = String(result.metadata!['tabKey']);
      const isLoop = this.isLoopTab(tabKey);

      this.addTabIfMissing(tabKey);

      if (isLoop) {
        this.activeTab.set(tabKey);
        setTimeout(() => {
          this.initDebugXterm();
          this.debugXterm?.clear();
          const modeLine = String(result.metadata?.['useMultiAgent']) === 'true' || result.metadata?.['useMultiAgent'] === true
            ? '\x1b[36m[思考]\x1b[0m 任务复杂度较高，已进入多智能体评估路径\r\n'
            : '\x1b[36m[思考]\x1b[0m 任务复杂度较低，保持单智能体路径\r\n';
          if (result.content) {
            this.debugXtermWrite(`${modeLine}${result.content}\r\n`);
          } else {
            this.debugXtermWrite(modeLine);
          }
          this.writeDebugTerminalPrompt();
          this.debugFitAddon?.fit();
          this.debugXterm?.focus();
        }, 0);
      } else {
        const payload = result.metadata?.['debugPayload'] as import('./debug/debug-command.types').DebugTabPayload | undefined;
        if (payload?.viewModel) {
          this.currentDebugPayload.set(payload);
          this.activeTab.set(tabKey);
          setTimeout(() => {
            this.initDebugXterm();
            if (result.content) {
              this.debugXtermWrite(`${result.content}\r\n`);
            }
            this.writeDebugTerminalPrompt();
            this.debugFitAddon?.fit();
            this.debugXterm?.focus();
          }, 0);
        }
      }

      this.writeMainTerminalPrompt();
      
      if (hasOpenInEditor && filePath) {
        const openScope = result.metadata?.['openScope'] === 'workspace' ? 'workspace' : 'vault';
        void this.openFileByPath(filePath, openScope);
      }
    } else {
      this.renderCommandPresentation(this.commandPresentation.formatExecutionResult(
        'directive',
        raw.trim().startsWith('/') ? raw.trim().slice(1).split(/\s+/)[0] ?? 'directive' : 'directive',
        result.success,
        result.content,
      ));
      
      // 如果有 openInEditor 且有 filePath，打开文件到单独 tab
      if (hasOpenInEditor && filePath) {
        const openScope = result.metadata?.['openScope'] === 'workspace' ? 'workspace' : 'vault';
        void this.openFileByPath(filePath, openScope);
      }
    }

    if (result.metadata?.['mode']) {
      const mode = String(result.metadata['mode']);
      if (mode === 'solo') {
        this.workbenchMode.switchMode('solo', '用户指令切换');
      } else if (mode === 'plan') {
        this.workbenchMode.switchMode('plan', '用户指令切换');
      } else if (mode === 'dev') {
        this.workbenchMode.switchMode('dev', '用户指令切换');
      } else if (mode === 'team') {
        this.workbenchMode.switchMode('dev', 'team 指令创建团队');
        try {
          await this.workbenchMode.initializeDevTeam();
        } catch (e) {
          this.renderCommandPresentation(this.commandPresentation.formatExecutionResult('error', 'directive', false, `创建团队失败: ${e}`));
        }
      }
    }

    if (result.metadata?.['teamCreate']) {
      this.setTab('Loop / Task');
      this.aiXtermWrite(`\r\n\x1b[36m[team]\x1b[0m 团队已创建：${String(result.metadata['teamName'] ?? 'team')}\r\n`);
    }

    if (result.metadata?.['tabKey'] && String(result.metadata['tabKey']) === 'Loop / Task' && this.activeTab() !== 'Loop / Task') {
      this.setTab('Loop / Task');
    }

    if (result.responseType === 'shell') {
      const command = String(result.metadata?.['command'] ?? '');
      if (command) {
        await this.runShell(command);
      }
    }
  }

  private async runShell(raw: string): Promise<void> {
    const cmd = raw.trim();
    if (!cmd) return;
    this.terminalBusy.set(true);
    try {
      const r = await window.zytrader.terminal.exec(cmd, '.');
      const content = [
        r.stdout?.trimEnd(),
        r.stderr?.trimEnd() ? `STDERR:\n${r.stderr.trimEnd()}` : '',
        !r.ok ? `[exit ${r.code}]` : '',
      ].filter(Boolean).join('\n');
      this.renderCommandPresentation(this.commandPresentation.formatExecutionResult(
        'shell',
        cmd,
        r.ok,
        content,
      ));
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
    await this.assistantModeExecutor.execute(
      {
        sessionId: SESSION_ID,
        rawInput: raw,
        skipTerminalUserLineAnchor: opts?.skipTerminalUserLineAnchor,
      },
      {
        write: (text) => this.aiXtermWrite(text),
        warn: (text) => this.aiXtermWrite(text),
        error: (text) => {
          this.aiXtermWrite(text);
          this.terminalBusy.set(false);
          this.writeMainTerminalPrompt();
        },
        commitUserRow: (prompt, skip) => this.commitMainTerminalUserRowForStreamRound(prompt, this.readModelRequestUiConfig(), { skipTerminalUserLineAnchor: skip }),
        onBeforeNormal: (prepared) => {
          this.streamInterruptRequested = false;
          this.resetThinkingStreamState();
          this.mergeThinkingBlocksFromSession();
          this.streamRouteDeltaToThinking = false;
          this.terminalBusy.set(true);
          this.streamRequestStartMs = Date.now();
          this.ensureStreamingThinkingBlockId();
          if (this.multiAgentSidebar) {
            this.multiAgentSidebar.setDefaultAgentStatus('thinking');
            this.multiAgentSidebar.processRequest(prepared.prompt || '').catch(() => {});
          }
        },
        onBeforePlan: () => {
          this.streamInterruptRequested = false;
          this.terminalBusy.set(true);
          this.streamRequestStartMs = Date.now();
        },
        onBeforeDev: () => {
          this.streamInterruptRequested = false;
          this.resetThinkingStreamState();
          this.mergeThinkingBlocksFromSession();
          this.streamRouteDeltaToThinking = false;
          this.terminalBusy.set(true);
          this.streamRequestStartMs = Date.now();
          this.ensureStreamingThinkingBlockId();
          this.renderCommandPresentation(this.commandPresentation.formatExecutionResult('assistant', 'dev-stream', true, '开始开发者模式流式输出'));
        },
        onNormalDelta: (text, chunk) => {
          this.handleStreamChunk(chunk);
        },
        onDevDelta: (text, chunk) => {
          this.handleStreamChunk(chunk);
        },
        onChunk: (chunk) => {
          this.handleStreamChunk(chunk);
        },
        onPlanDone: (text) => {
          if (text.trim()) {
            this.workbenchMode.setPlanDocument(text.trim());
            this.renderCommandPresentation(this.commandPresentation.formatExecutionResult('system', 'plan', true, '计划文档已生成'));
          }
          this.hasCompletedTurn = true;
          this.terminalBusy.set(false);
          if (this.multiAgentSidebar) {
            this.multiAgentSidebar.setDefaultAgentStatus('idle');
          }
          this.writeMainTerminalPrompt();
        },
        onNormalDone: async () => {
          await this.finalizeStreamTurn(raw, false);
        },
        onDevDone: async () => {
          await this.finalizeStreamTurn(raw, true);
        },
      },
      typeof (window as unknown as { zytrader?: unknown }).zytrader !== 'undefined'
        ? WORKBENCH_ELECTRON_TOOLS_SYSTEM_PROMPT
        : '',
      Boolean(this.appSettings.value.apiKey?.trim()),
      () => this.runtime.client.getModel(),
      () => this.streamRequestStartMs,
    );
  }

  private async executePlanMode(
    raw: string,
    opts?: { skipTerminalUserLineAnchor?: boolean },
  ): Promise<void> {
    this.aiXtermWrite('\r\n\x1b[36m[计划模式]\x1b[0m 正在生成计划文档...\r\n');
    
    const planPrompt = `请为以下任务生成详细的计划文档。计划文档应包含：

## 任务概述
简要描述任务目标和背景

## 分析阶段
- 需要收集哪些信息
- 需要分析哪些现有代码/系统
- 潜在的风险和挑战

## 设计阶段
- 技术方案概述
- 架构设计要点
- 关键决策点

## 实施阶段
- 分步骤的实施计划
- 每个步骤的预期产出
- 步骤之间的依赖关系

## 验证阶段
- 测试策略
- 验收标准
- 回滚方案

---

用户任务：${raw}

请生成结构化的计划文档（仅生成计划，不执行任何操作）：`;

    const planSystemPrompt = `你是一个专业的项目规划师。你的职责是根据用户需求生成详细的计划文档。
重要规则：
1. 只生成计划文档，不执行任何实际操作
2. 计划应该具体、可执行、有明确的验收标准
3. 识别潜在风险并提供缓解措施
4. 计划应该分阶段，每个阶段有明确的里程碑
5. 使用 Markdown 格式输出`;

    if (!this.appSettings.value.apiKey?.trim()) {
      this.aiXtermWrite(
        '\r\n\x1b[31m[error]\x1b[0m 未配置 API Key。\x1b[90m 请打开「API 设置」填写密钥后再试。\x1b[0m\r\n',
      );
      return;
    }

    this.streamInterruptRequested = false;
    this.resetThinkingStreamState();
    this.terminalBusy.set(true);
    this.streamRequestStartMs = Date.now();

    const cfg = this.readModelRequestUiConfig();
    this.commitMainTerminalUserRowForStreamRound(raw, cfg, {
      skipTerminalUserLineAnchor: opts?.skipTerminalUserLineAnchor,
    });

    const fullPrompt = await this.promptMemoryBuilder.buildFullPromptForInput(
      SESSION_ID,
      planPrompt,
      planSystemPrompt,
    );
    await this.capturePromptContextSnapshot(SESSION_ID, planPrompt, planSystemPrompt);

    const { stream, cancel } = this.runtime.assistant.stream(SESSION_ID, {
      userInput: fullPrompt,
      config: this.runtime.client.getModel(),
    });
    this.streamStop = cancel;
    const reader = stream.getReader();
    this.streamReader = reader;

    let planDocument = '';
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
        } else if (value.type === 'thinking_delta' && value.textDelta) {
          const cfg = this.readModelRequestUiConfig();
          if (cfg.showThinking && !this.thinkingHeaderShown) {
            this.renderThinkingHeader(this.ensureStreamingThinkingBlockId());
            this.thinkingHeaderShown = true;
          }
          if (cfg.showThinking) {
            this.thinkingBuffer += value.textDelta;
            const rest = this.thinkingBuffer.slice(this.thinkingPrintedLen);
            if (rest && rest.length > 0) {
              const visible = this.thinkingHasNonChinese ? this.sanitizeThinkingForDisplay(rest) : rest;
              const out = this.highlightThinkingSteps(visible);
              this.aiXtermWrite(out);
              this.bumpStreamLineBudgetForWrite(out);
              this.thinkingPrintedLen = this.thinkingBuffer.length;
            }
          }
        } else if (value.type === 'delta' && value.textDelta) {
          planDocument += value.textDelta;
          this.aiXtermWrite(value.textDelta);
        }
      }
    } catch (error) {
      streamFailed = true;
      const msg = error instanceof Error ? error.message : '未知错误';
      this.aiXtermWrite(`\r\n[error] ${msg}\r\n`);
    } finally {
      try {
        reader.releaseLock();
      } catch { /* ignore */ }
      this.streamReader = null;
      this.streamStop = undefined;
      this.terminalBusy.set(false);

      if (!streamFailed) {
        const cfg = this.readModelRequestUiConfig();
        this.finalizeAssistantStreamUi({
          ok: true,
          interrupted: false,
          userPrompt: raw,
          thinking: this.thinkingBuffer,
          thinkingHasNonChinese: this.thinkingHasNonChinese,
          answer: planDocument,
          layoutSplitThinkingAnswer: cfg.layoutSplitThinkingAnswer,
          thinkingToggleShortcut: cfg.thinkingToggleShortcut,
          thinkingToggleAllShortcut: cfg.thinkingToggleAllShortcut,
        });

        this.resetThinkingStreamState();

        if (planDocument) {
          this.workbenchMode.setPlanDocument(planDocument);
          this.aiXtermWrite('\r\n\r\n\x1b[32m[计划文档已生成]\x1b[0m 计划已保存，可随时查看或修改。\r\n');
        }
      }

      if (!streamFailed) this.hasCompletedTurn = true;
      await this.refreshWorkbenchContextSnapshot();
      this.writeMainTerminalPrompt();
    }
  }

  private async finalizeStreamTurn(raw: string, isDev: boolean): Promise<void> {
    const cfg = this.readModelRequestUiConfig();
    this.finalizeAssistantStreamUi({
      ok: true,
      interrupted: this.streamInterruptRequested,
      userPrompt: raw,
      thinking: this.thinkingBuffer,
      thinkingHasNonChinese: this.thinkingHasNonChinese,
      answer: this.roundAnswerAccumulator,
      layoutSplitThinkingAnswer: cfg.layoutSplitThinkingAnswer,
      thinkingToggleShortcut: cfg.thinkingToggleShortcut,
      thinkingToggleAllShortcut: cfg.thinkingToggleAllShortcut,
    });
    if (!this.streamInterruptRequested) {
      await this.appendRecentTurnAfterSuccess(raw);
      try {
        await this.triggerMemoryPipelineFromHistory(raw);
      } catch {
        /* ignore */
      }
    }
    await this.syncPlanStepsFromLastAssistant();
    this.syncCoordinatorState();
    this.hasCompletedTurn = true;
    this.terminalBusy.set(false);
    if (this.multiAgentSidebar) {
      this.multiAgentSidebar.setDefaultAgentStatus('idle');
    }
    await this.refreshWorkbenchContextSnapshot();
    this.writeMainTerminalPrompt();
  }

  private async executeDevMode(
    raw: string,
    opts?: { skipTerminalUserLineAnchor?: boolean },
  ): Promise<void> {
    let devTeam = this.workbenchMode.devTeam();
    
    if (!devTeam) {
      this.aiXtermWrite('\r\n\x1b[33m[warn]\x1b[0m 开发团队未初始化，正在初始化...\r\n');
      try {
        devTeam = await this.workbenchMode.initializeDevTeam();
      } catch (error) {
        this.aiXtermWrite(`\r\n\x1b[31m[error]\x1b[0m 初始化开发团队失败: ${error}\r\n`);
        return;
      }
    }

    this.aiXtermWrite('\r\n\x1b[36m[开发者模式]\x1b[0m 开发团队已就绪\r\n');
    this.aiXtermWrite('\x1b[90m┌──────────────────────────────────────────────────────────┐\x1b[0m\r\n');
    this.aiXtermWrite('\x1b[90m│ 主从多智能体协作模式                                      │\x1b[0m\r\n');
    this.aiXtermWrite('\x1b[90m│ 架构师(协调者): 统一任务队列、状态机、任务分配            │\x1b[0m\r\n');
    this.aiXtermWrite('\x1b[90m│ 专业 Worker: 前端开发、后端开发、测试工程师              │\x1b[0m\r\n');
    this.aiXtermWrite('\x1b[90m│ 执行串行，能力并行                                        │\x1b[0m\r\n');
    this.aiXtermWrite('\x1b[90m└──────────────────────────────────────────────────────────┘\x1b[0m\r\n');
    this.aiXtermWrite('\r\n');

    const agentIdMap: Record<string, string> = {
      '架构师': devTeam.architect.agentId,
      '前端开发': devTeam.frontend.agentId,
      '后端开发': devTeam.backend.agentId,
      '测试工程师': devTeam.tester.agentId,
    };

    this.emitAgentThinking(devTeam.architect.agentId, '正在分析任务需求...');

    if (this.multiAgentSidebar) {
      this.multiAgentSidebar.setCurrentRequest(raw);
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
    this.streamRouteDeltaToThinking = false;
    this.terminalBusy.set(true);
    this.streamRequestStartMs = Date.now();

    const cfg = this.readModelRequestUiConfig();
    this.commitMainTerminalUserRowForStreamRound(raw, cfg, {
      skipTerminalUserLineAnchor: opts?.skipTerminalUserLineAnchor,
    });

    const devSystemPrompt = `你是开发团队的架构师和协调者。你必须严格按照以下流程执行任务。

## 强制执行流程（必须按顺序执行）

### 阶段1: 架构师分析
[架构师] 分析用户需求，分解任务

### 阶段2: 开发执行
根据任务类型分配给对应开发者执行：
- 前端任务 -> [前端开发]
- 后端任务 -> [后端开发]
- 通用任务 -> [前端开发] 或 [后端开发]

### 阶段3: 测试验证（必须执行）
[测试工程师] 对所有完成的任务进行测试验证

### 阶段4: 架构师汇总
[架构师] 汇总结果并报告

## 团队成员
- [架构师]：系统架构设计、技术决策、任务协调、结果汇总
- [前端开发]：前端界面、Angular/TypeScript、UI交互
- [后端开发]：后端服务、API、Node.js/Python
- [测试工程师]：测试用例、质量验证、问题检测

## 输出格式（严格遵循）

[架构师] 任务分析完成，共N个子任务：
1. [任务名] -> 分配给: 前端开发/后端开发
...

[前端开发/后端开发] 执行任务: xxx
[前端开发/后端开发] 完成: xxx

[测试工程师] 开始测试验证...
[测试工程师] 测试结果: 通过/发现问题: xxx

[架构师] 任务完成汇总: xxx

## 重要规则
1. 必须包含[测试工程师]的测试验证阶段
2. 测试必须在所有开发任务完成后执行
3. 如果测试发现问题，必须返回修复后重新测试
4. 最终由架构师汇总结果`;

    const fullPrompt = await this.promptMemoryBuilder.buildFullPromptForInput(
      SESSION_ID,
      raw,
      devSystemPrompt,
    );
    await this.capturePromptContextSnapshot(SESSION_ID, raw, devSystemPrompt);

    const { stream, cancel } = this.runtime.assistant.stream(SESSION_ID, {
      userInput: fullPrompt,
      config: this.runtime.client.getModel(),
    });
    this.streamStop = cancel;
    const reader = stream.getReader();
    this.streamReader = reader;

    let streamFailed = false;
    let lastAgent = '';
    let currentThinkingAgent: string | null = null;
    const agentColors: Record<string, string> = {
      '架构师': '36',
      '前端开发': '32',
      '后端开发': '33',
      '测试工程师': '35',
    };

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
        } else if (value.type === 'thinking_delta' && value.textDelta) {
          // 思考内容路由到思考过程框，不混入回答
          const cfg = this.readModelRequestUiConfig();
          if (cfg.showThinking && !this.thinkingHeaderShown) {
            this.renderThinkingHeader(this.ensureStreamingThinkingBlockId());
            this.thinkingHeaderShown = true;
          }
          if (cfg.showThinking) {
            this.thinkingBuffer += value.textDelta;
            const rest = this.thinkingBuffer.slice(this.thinkingPrintedLen);
            // 立即输出思考内容，不等待缓冲，支持多段思考
            if (rest && rest.length > 0) {
              const visible = this.thinkingHasNonChinese ? this.sanitizeThinkingForDisplay(rest) : rest;
              const out = this.highlightThinkingSteps(visible);
              this.aiXtermWrite(out);
              this.bumpStreamLineBudgetForWrite(out);
              this.thinkingPrintedLen = this.thinkingBuffer.length;
            }
          }
        } else if (value.type === 'delta' && value.textDelta) {
          let text = value.textDelta;

          // 检测 [agent] 标签切换，同时从文本中剔除避免重复
          for (const [agent, color] of Object.entries(agentColors)) {
            const tag = `[${agent}]`;
            if (text.includes(tag) && lastAgent !== agent) {
              if (currentThinkingAgent && currentThinkingAgent !== agent) {
                const prevAgentId = agentIdMap[currentThinkingAgent];
                if (prevAgentId) {
                  this.emitAgentOutput(prevAgentId, `已完成任务`);
                }
              }

              lastAgent = agent;
              currentThinkingAgent = agent;
              // 写一次彩色标签作为段落标题
              this.aiXtermWrite(`\r\n\x1b[${color}m${tag}\x1b[0m `);

              const agentId = agentIdMap[agent];
              if (agentId) {
                this.emitAgentThinking(agentId, `正在执行任务...`);
              }

              // 从当前文本中剔除刚检测到的标签，避免后续重复输出
              text = text.replace(tag, '');
            }
          }

          this.roundAnswerAccumulator += text;
          const colored = text
            .replace(/\[架构师\]/g, '\x1b[35m[架构师]\x1b[0m')
            .replace(/\[前端开发\]/g, '\x1b[32m[前端开发]\x1b[0m')
            .replace(/\[后端开发\]/g, '\x1b[33m[后端开发]\x1b[0m')
            .replace(/\[测试工程师\]/g, '\x1b[36m[测试工程师]\x1b[0m')
            .replace(/分配给:/g, '\x1b[90m分配给:\x1b[0m\x1b[1m')
            .replace(/(前端开发|后端开发|测试工程师|架构师)\x1b\[0m\x1b\[1m/g, '$1\x1b[0m');
          if (colored) {
            this.aiXtermWrite(colored);
          }
        }
      }
    } catch (error) {
      streamFailed = true;
      const msg = error instanceof Error ? error.message : '未知错误';
      this.aiXtermWrite(`\r\n[error] ${msg}\r\n`);
    } finally {
      try {
        reader.releaseLock();
      } catch { /* ignore */ }
      this.streamReader = null;
      this.streamStop = undefined;
      this.terminalBusy.set(false);

      if (this.streamInterruptRequested) {
        this.aiXtermWrite('\r\n\x1b[33m[已中断]\x1b[0m\r\n');
        this.streamInterruptRequested = false;
      } else if (!streamFailed) {
        const cfg = this.readModelRequestUiConfig();
        this.finalizeAssistantStreamUi({
          ok: true,
          interrupted: false,
          userPrompt: raw,
          thinking: this.thinkingBuffer,
          thinkingHasNonChinese: this.thinkingHasNonChinese,
          answer: this.roundAnswerAccumulator,
          layoutSplitThinkingAnswer: cfg.layoutSplitThinkingAnswer,
          thinkingToggleShortcut: cfg.thinkingToggleShortcut,
          thinkingToggleAllShortcut: cfg.thinkingToggleAllShortcut,
        });

        this.resetThinkingStreamState();

        this.aiXtermWrite('\r\n\r\n\x1b[35m[架构师]\x1b[0m 任务执行完成\r\n');
        
        if (currentThinkingAgent) {
          const agentId = agentIdMap[currentThinkingAgent];
          if (agentId) {
            this.emitAgentOutput(agentId, '任务执行完成');
          }
        }
        
        if (!this.streamInterruptRequested) {
          await this.appendRecentTurnAfterSuccess(raw);
          try {
            await this.triggerMemoryPipelineFromHistory(raw);
          } catch { /* 记忆管道失败不向主终端刷屏 */ }
        }
        await this.syncPlanStepsFromLastAssistant();
        this.syncCoordinatorState();
      }

      if (!streamFailed) this.hasCompletedTurn = true;
      await this.refreshWorkbenchContextSnapshot();
      this.writeMainTerminalPrompt();
    }
  }

  private emitAgentThinking(agentId: string, thinking: string): void {
    this.multiAgentEventBus.emit({
      type: EVENT_TYPES.AGENT_THINKING,
      ts: Date.now(),
      sessionId: SESSION_ID,
      source: 'executor',
      payload: { agentId, thinking },
    } as MultiAgentEvent<'agent.thinking'>);
  }

  private emitAgentOutput(agentId: string, output: string): void {
    this.multiAgentEventBus.emit({
      type: EVENT_TYPES.AGENT_OUTPUT,
      ts: Date.now(),
      sessionId: SESSION_ID,
      source: 'executor',
      payload: { agentId, output },
    } as MultiAgentEvent<'agent.output'>);
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
      cursorStyle: 'underline',
      cursorWidth: 2,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Mono', Consolas, 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', monospace",
      fontSize: 12,
      lineHeight: 1.35,
      theme: {
        background: '#080b14',
        foreground: '#dbe7ff',
        cursor: '#93c5fd',
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
    this.psTerminal.focus();
    this.psTerminal.write('\x1b[?25h');

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
      const data = payload.data.replace(/\x1b\[\?25l/g, '\x1b[?25h');
      this.psTerminal?.write(data);
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

    const ensurePsFocus = (delay: number): void => {
      setTimeout(() => {
        this.psFitAddon?.fit();
        this.syncPowerShellSize();
        this.focusPowerShellTerminal();
      }, delay);
    };
    ensurePsFocus(100);
    ensurePsFocus(300);
    ensurePsFocus(600);
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
      this.focusPowerShellTerminal();
    }, 120);
    setTimeout(() => {
      const id = this.activePsSessionId();
      if (id) {
        void window.zytrader.terminal.write({ id, data: '\r' });
      }
    }, 300);
    setTimeout(() => {
      const id = this.activePsSessionId();
      if (id) {
        void window.zytrader.terminal.write({ id, data: 'Set-Location .\r' });
      }
    }, 600);
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
      thinkingCollapsedByDefault: false,
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
    this.answerBuffer = '';
    this.answerPrintedLen = 0;
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
      .replace(/(第\s*[一二三四五六七八九十\d]+\s*步)/g, '$1')
      .replace(/(step\s*\d+)/gi, '$1')
      .replace(/\b(TODO|FIXME|WIP|NOTE)\b/g, '$1');
  }

  private decorateDevModeText(text: string): string {
    if (!text) return text;
    return text
      .replace(/\[架构师\]/g, '\x1b[35m[架构师]\x1b[0m')
      .replace(/\[前端开发\]/g, '\x1b[34m[前端开发]\x1b[0m')
      .replace(/\[后端开发\]/g, '\x1b[33m[后端开发]\x1b[0m')
      .replace(/\[测试工程师\]/g, '\x1b[32m[测试工程师]\x1b[0m');
  }

  private sanitizeThinkingForDisplay(text: string): string {
    if (!text) return text;
    const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const segments: Array<{ tag: 'user' | 'skill' | 'thinking' | 'answer' | 'other'; lines: string[] }> = [];
    let cur: Array<{ tag: 'user' | 'skill' | 'thinking' | 'answer' | 'other'; lines: string[] }> | null = null;
    let curTag: string = '';

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      let tag: 'user' | 'skill' | 'thinking' | 'answer' | 'other' = 'other';
      if (/^\[用户\]/.test(trimmed) || /^\[超体\]/.test(trimmed) || /^\[架构师\]/.test(trimmed)) {
        tag = trimmed.startsWith('[用户]') ? 'user' : 'answer';
      } else if (/^【已命中技能/.test(trimmed) || /^【技能强制命中】/.test(trimmed) || /^\[命中技能/.test(trimmed) || /^技能文件：/.test(trimmed) || /^\[SKILL\.md/.test(trimmed)) {
        tag = 'skill';
      } else if (/^\[Thinking\s*#\d+/.test(trimmed) || /^\[Thinking\s*#\d+.*完成\]/.test(trimmed) || /^思考过程已开始/.test(trimmed)) {
        tag = 'thinking';
      }
      if (tag !== curTag || !cur) {
        const seg = { tag, lines: [rawLine] };
        segments.push(seg);
        cur = segments;
        curTag = tag;
      } else {
        segments[segments.length - 1].lines.push(rawLine);
      }
    }

    const seenStepKeys = new Set<string>();
    const seenContentHashes = new Set<string>();
    const outputLines: string[] = [];
    let lastStepNum = 0;
    let prevWasBlank = false;

    for (const seg of segments) {
      if (seg.tag === 'user') {
        continue;
      }
      if (seg.tag === 'skill') {
        if (!seenContentHashes.has('skill')) {
          seenContentHashes.add('skill');
          const skillNameMatch = seg.lines.join('\n').match(/已命中技能[：:]\s*(.+?)】/);
          if (skillNameMatch) {
            outputLines.push(`\x1b[33m▸ 命中技能：${skillNameMatch[1].trim()}\x1b[0m`);
          }
        }
        continue;
      }
      if (seg.tag === 'thinking') {
        continue;
      }
      for (const rawLine of seg.lines) {
        let line = rawLine;
        const trimmed = line.trim();
        if (!trimmed) {
          if (!prevWasBlank) { outputLines.push(''); prevWasBlank = true; }
          continue;
        }
        prevWasBlank = false;

        const stepMatch = trimmed.match(/^\*?\*?\s*(?:步骤|Step)\s*(\d+|\d*[一二三四五六七八九十]+)\s*[:：\.。]?\s*/i);
        if (stepMatch) {
          const stepNum = stepMatch[1];
          const stepKey = `step_${stepNum}`;
          if (seenStepKeys.has(stepKey)) continue;
          seenStepKeys.add(stepKey);
          const num = isNaN(parseInt(stepNum)) ? ++lastStepNum : parseInt(stepNum);
          lastStepNum = num;
          const rest = trimmed.slice(stepMatch[0].length);
          const contentHash = `step_content_${rest.slice(0, 40)}`;
          if (seenContentHashes.has(contentHash)) continue;
          seenContentHashes.add(contentHash);
          outputLines.push(`\x1b[33m**${num}.\x1b[0m ${rest}`);
          continue;
        }

        const contentHash = `line_${trimmed.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 60)}`;
        if (seenContentHashes.has(contentHash)) continue;
        seenContentHashes.add(contentHash);

        if (this.isNoiseLine(trimmed)) continue;

        outputLines.push(line);
      }
    }

    let result = outputLines.join('\n');
    result = result.replace(/\n{3,}/g, '\n\n');
    return result;
  }

  private isNoiseLine(line: string): boolean {
    const t = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!t) return false;
    if (/^ok:\s*(true|false)$/i.test(t)) return true;
    if (/^The page has loaded$/i.test(t)) return true;
    if (/^Good, the navigation was successful/i.test(t)) return true;
    if (/^Let me\s+(start|take|execute|report|wait|check|try|now|begin|proceed)\b/i.test(t)) return true;
    if (/^Now I need to\b/i.test(t)) return true;
    if (/^Let's\b/i.test(t)) return true;
    if (/^I\s+(will|need to|should|can|have to|am going to|shall)\b/i.test(t)) return true;
    if (/^This\s+(is|means|indicates|shows|suggests|confirms)\b/i.test(t)) return true;
    if (/^The\s+(video|page|result|output|data|text|content|user|skill|navigation|search|current|next|following|above|below)\b/i.test(t)) return true;
    if (/^Following the skill/i.test(t)) return true;
    if (/has been\s+(命中|triggered|hit)/i.test(t)) return true;
    if (/^The skill\b.*has been/i.test(t)) return true;
    if (/^Let me report/i.test(t)) return true;
    if (/^用户想要/i.test(t)) return true;
    if (/^技能步骤/i.test(t)) return true;
    if (/^让我开始/i.test(t)) return true;
    if (/^关键词是/i.test(t)) return true;
    if (/^页面已打开/i.test(t)) return true;
    if (/^页面已加载/i.test(t)) return true;
    if (/^确认视频/i.test(t)) return true;
    if (/^找到视频链接/i.test(t)) return true;
    if (/^任务完成/i.test(t)) return true;
    if (/^视频已打开/i.test(t)) return true;
    if (/^视频数据加载中/i.test(t)) return true;
    if (/^正在加载/i.test(t)) return true;
    if (/^正在跳转/i.test(t)) return true;
    if (/^JS执行成功/i.test(t)) return true;
    if (/^当前页面：/i.test(t)) return true;
    return false;
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
