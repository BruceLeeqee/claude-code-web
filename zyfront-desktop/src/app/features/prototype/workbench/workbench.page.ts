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
import { NgFor, NgIf, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { AppSettingsService } from '../../../core/app-settings.service';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import type { CoordinationStep } from 'zyfront-core';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../../core/zyfront-core.providers';
import { CommandRouterService } from './command-router.service';
import { DIRECTIVE_REGISTRY, isCoordinationMode, parseDirective, type DirectiveDefinition } from './directive-registry';

const RECENT_STORAGE_KEY = 'zytrader-workbench-recent-turns:v1';

interface RecentTurn {
  id: string;
  title: string;
  prompt: string;
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

interface TaskCardVm {
  title: string;
  detail: string;
  percent: number;
  status: 'active' | 'success' | 'exception';
  tag: string;
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
    NzCardModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzProgressModule,
    NzTagModule,
  ],
  templateUrl: './workbench.page.html',
  styleUrl: '../prototype-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkbenchPageComponent implements AfterViewInit, OnDestroy {
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly router = inject(CommandRouterService);
  private readonly appSettings = inject(AppSettingsService);

  @ViewChild('xtermHost', { static: false })
  private xtermHost?: ElementRef<HTMLDivElement>;

  protected readonly workspaceRoot = signal('workspace');
  protected readonly tree = signal<FileNode[]>([]);
  protected readonly selectedPath = signal('');
  protected readonly selectedContent = signal('请选择左侧文件');

  protected readonly tabs = signal(['Terminal - Main', 'main.ts']);
  protected readonly activeTab = signal('Terminal - Main');
  protected readonly terminalBusy = signal(false);

  /** 是否已在设置中填写 API Key（用于顶部状态提示） */
  protected readonly apiKeyConfigured = signal(!!this.appSettings.value.apiKey?.trim());
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

  protected readonly taskCards = computed<TaskCardVm[]>(() => {
    const total = this.stepTotal();
    const done = this.stepDone();
    const running = this.stepInProgress();
    const pending = this.stepPending();

    const donePercent = total === 0 ? 0 : Math.round((done / total) * 100);
    const runPercent = total === 0 ? 0 : Math.round((running / total) * 100);

    return [
      {
        title: `已完成 (${done})`,
        detail: `Plan steps 已完成 ${done}/${total}`,
        percent: donePercent,
        status: done > 0 ? 'success' : 'active',
        tag: 'DONE',
      },
      {
        title: `进行中 (${running})`,
        detail: `当前协调模式 ${this.coordinatorMode()}，正在执行中的步骤。`,
        percent: runPercent,
        status: running > 0 ? 'active' : 'success',
        tag: 'RUNNING',
      },
      {
        title: `待处理 (${pending})`,
        detail: `待执行步骤 ${pending}，工具调用 ${this.toolCallCount()} 次。`,
        percent: total === 0 ? 0 : Math.round((pending / total) * 100),
        status: pending > 0 ? 'exception' : 'success',
        tag: 'TODO',
      },
    ];
  });

  protected readonly recentTurns = signal<RecentTurn[]>(this.loadRecentTurns());

  private xterm?: Terminal;
  private fitAddon?: FitAddon;
  private resizeObserver?: ResizeObserver;

  /** 主终端为「对话 + 单次 shell」模式，非 PTY；行编辑缓冲 */
  private mainLineBuffer = '';
  private mainEscSkip = false;
  private mainEscAcc = '';

  private syncTimer?: number;

  constructor() {
    void this.bootstrapWorkspace();
    this.syncCoordinatorState();
    this.syncTimer = window.setInterval(() => this.syncCoordinatorState(), 500);
    this.appSettings.settings$.subscribe((s) => {
      this.apiKeyConfigured.set(!!s.apiKey?.trim());
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.initAiXterm();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.xterm?.dispose();

    if (this.syncTimer) window.clearInterval(this.syncTimer);
  }

  private syncCoordinatorState(): void {
    const state = this.runtime.coordinator.getState();
    this.coordinatorMode.set(state.mode);
    this.stepTotal.set(state.steps.length);
    this.stepDone.set(state.steps.filter((s) => s.status === 'completed').length);
    this.stepInProgress.set(state.steps.filter((s) => s.status === 'in_progress').length);
    this.stepPending.set(state.steps.filter((s) => s.status === 'pending').length);
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

  protected toggleRoutePreference(): void {
    this.preferNatural.update((v) => !v);
  }

  protected toggleSysTerminalVisible(): void {
    this.sysTerminalVisible.update((v) => !v);
    queueMicrotask(() => this.sysFitAddon?.fit());
  }

  protected async switchSystemShell(shell: 'git-bash' | 'powershell'): Promise<void> {
    if (this.sysShell() === shell) return;
    this.sysShell.set(shell);
    await this.initSysPtySession();
    this.sysXtermWrite(`\r\n\x1b[33m[shell]\x1b[0m switched to ${shell}\r\n`);
  }

  protected async dispatchSystemInput(): Promise<void> {
    const raw = this.sysCommandInput().trim();
    if (!raw) return;
    this.sysCommandInput.set('');
    const line = raw.endsWith('\n') || raw.endsWith('\r') ? raw : `${raw}\r`;
    await window.zytrader.terminal.write({ id: this.sysTerminalId, data: line });
  }

  protected async onSystemInputKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await this.dispatchSystemInput();
  }

  private initAiXterm(): void {
    const host = this.xtermHost?.nativeElement;
    if (!host) return;

    this.fitAddon = new FitAddon();
    this.xterm = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
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

    host.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.code === 'KeyF') {
        e.preventDefault();
        this.aiXtermWrite('\r\n\x1b[33m[hint]\x1b[0m Ctrl+Shift+C 复制 · Ctrl+Shift+V 粘贴 · Ctrl+L 清屏并重绘提示符\r\n');
        this.writeMainTerminalPrompt();
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
      `\x1b[90m在此直接输入：自然语言（如「你好」）、shell 命令，或以 / 开头的指令（/help）。流式回复走应用内已配置的模型 API。完整交互式 shell 请用下方 System Terminal。\x1b[0m\r\n`,
    );
    this.writeMainTerminalPrompt();
  }

  private writeMainTerminalPrompt(): void {
    this.aiXtermWrite(`\r\n\x1b[32m>\x1b[0m `);
  }

  private feedMainTerminalInput(data: string): void {
    if (this.terminalBusy()) return;
    for (const ch of data) {
      if (this.mainEscSkip) {
        this.mainEscAcc += ch;
        if (/[A-Za-z]/.test(ch) || this.mainEscAcc.length > 32) {
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
        const line = this.mainLineBuffer;
        this.mainLineBuffer = '';
        this.aiXtermWrite('\r\n');
        void this.dispatchMainTerminalLine(line);
        continue;
      }
      if (ch === '\x7f' || ch === '\b') {
        if (this.mainLineBuffer.length > 0) {
          this.mainLineBuffer = this.mainLineBuffer.slice(0, -1);
          this.xterm?.write('\b \b');
        }
        continue;
      }
      if (ch === '\x03') {
        this.mainLineBuffer = '';
        this.aiXtermWrite('^C\r\n');
        this.writeMainTerminalPrompt();
        continue;
      }
      const cp = ch.codePointAt(0);
      if (cp !== undefined && cp < 32 && ch !== '\t') continue;
      this.mainLineBuffer += ch;
      this.xterm?.write(ch);
    }
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
    const route = this.router.route(t, { preferNaturalLanguage: this.preferNatural() });

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

  private initSysXterm(): void {
    const host = this.sysXtermHost?.nativeElement;
    if (!host) return;

    this.sysFitAddon = new FitAddon();
    this.sysXterm = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      theme: {
        background: '#0b0c11',
        foreground: '#dbe1f7',
        cursor: '#60a5fa',
        cursorAccent: '#0b0c11',
        selectionBackground: '#243247',
      },
      convertEol: true,
    });

    this.sysXterm.loadAddon(this.sysFitAddon);
    this.sysXterm.open(host);
    this.sysFitAddon.fit();

    this.sysXterm.onData((data) => {
      void window.zytrader.terminal.write({ id: this.sysTerminalId, data });
    });

    host.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        const selected = this.sysXterm?.getSelection() ?? '';
        if (selected) void navigator.clipboard.writeText(selected);
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        void navigator.clipboard.readText().then((t) => {
          void window.zytrader.terminal.write({ id: this.sysTerminalId, data: t });
        });
      }
      if (e.ctrlKey && e.code === 'KeyL') {
        e.preventDefault();
        this.sysXterm?.clear();
      }
    });

    this.sysResizeObserver = new ResizeObserver(() => {
      this.sysFitAddon?.fit();
      if (!this.sysXterm) return;
      void window.zytrader.terminal.resize({
        id: this.sysTerminalId,
        cols: this.sysXterm.cols,
        rows: this.sysXterm.rows,
      });
    });
    this.sysResizeObserver.observe(host);
  }

  private async initSysPtySession(): Promise<void> {
    if (!this.sysXterm) return;

    this.disposeSysPtyData?.();
    this.disposeSysPtyExit?.();

    const created = await window.zytrader.terminal.create({
      id: this.sysTerminalId,
      cwd: '.',
      cols: this.sysXterm.cols,
      rows: this.sysXterm.rows,
      shell: this.sysShell(),
    });

    if (!created.ok) {
      this.sysXtermWrite(`\r\n[system terminal error] ${created.error ?? 'create session failed'}\r\n`);
      return;
    }

    this.disposeSysPtyData = window.zytrader.terminal.onData((payload) => {
      if (payload.id !== this.sysTerminalId) return;
      this.sysXterm?.write(payload.data);
    });

    this.disposeSysPtyExit = window.zytrader.terminal.onExit((payload) => {
      if (payload.id !== this.sysTerminalId) return;
      this.sysXtermWrite(`\r\n\x1b[31m[session exited ${payload.exitCode}]\x1b[0m\r\n`);
    });
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
    this.setTab('main.ts');

    const result = await window.zytrader.fs.read(node.path);
    if (!result.ok) {
      this.selectedContent.set('文件读取失败');
      return;
    }
    this.selectedContent.set(result.content.slice(0, 20000));
  }

  private async runDirective(raw: string): Promise<void> {
    const parsed = parseDirective(raw);

    if (!parsed.def) {
      this.aiXtermWrite(`\r\n[warn] 未识别指令: ${parsed.name}\r\n`);
      return;
    }

    switch (parsed.def.kind) {
      case 'help':
        this.aiXtermWrite('\r\n[help] 输入 shell 命令、自然语言，或使用以下指令：\r\n');
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
        await this.askAssistant('请以资深架构师视角，围绕当前 workspace 进行多方案头脑风暴，并给出优先级。');
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
      return '\r\n\x1b[90m提示：点击顶部「API 设置」填写并保存有效的 API Key。\x1b[0m';
    }
    return '';
  }

  private async askAssistant(raw: string): Promise<void> {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.aiXtermWrite('\r\n\x1b[31m[error]\x1b[0m 请输入有效内容\r\n');
      return;
    }

    if (!this.appSettings.value.apiKey?.trim()) {
      this.aiXtermWrite(
        '\r\n\x1b[31m[error]\x1b[0m 未配置 API Key。\x1b[90m 请点击顶部「API 设置」填写并保存。\x1b[0m\r\n',
      );
      return;
    }

    this.terminalBusy.set(true);

    try {
      const result = this.runtime.assistant.stream('workbench-terminal-ai', {
        userInput: trimmed,
        config: this.runtime.client.getModel(),
      });
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === 'delta') this.aiXtermWrite(value.textDelta);
        if (value.type === 'tool_call') this.toolCallCount.update((v) => v + 1);
        if (value.type === 'error' && value.error) {
          this.aiXtermWrite(`\r\n[error] ${value.error}${this.hintIfUnauthorized(value.error)}`);
        }
      }
      reader.releaseLock();
      this.aiXtermWrite('\r\n');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '执行失败';
      this.aiXtermWrite(`\r\n[error] ${msg}${this.hintIfUnauthorized(msg)}\r\n`);
    } finally {
      this.terminalBusy.set(false);
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

  private sysXtermWrite(text: string): void {
    this.sysXterm?.write(text.replaceAll('\n', '\r\n'));
  }
}
