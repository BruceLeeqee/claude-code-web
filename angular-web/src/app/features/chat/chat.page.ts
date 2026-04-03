import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectionStrategy,
  OnDestroy,
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AsyncPipe } from '@angular/common';
import { combineLatest, map } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { marked } from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import monacoLoader from '@monaco-editor/loader';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import type { CoordinationMode, CoordinationStep } from 'claude-core';
import { ClaudeAgentService, type UiMcpServer, type UiToggleItem } from '../../core/claude-agent.service';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, FormsModule, AsyncPipe],
  templateUrl: './chat.page.html',
  styleUrl: './chat.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPageComponent implements AfterViewInit, AfterViewChecked, OnDestroy {
  private readonly agent = inject(ClaudeAgentService);
  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('monacoHost', { static: true })
  monacoHost!: ElementRef<HTMLDivElement>;

  @ViewChild('terminalHost', { static: true })
  terminalHost!: ElementRef<HTMLDivElement>;

  @ViewChild('messageList', { static: false })
  messageList?: ElementRef<HTMLUListElement>;

  private monacoInstance?: import('monaco-editor').editor.IStandaloneCodeEditor;
  private term?: Terminal;
  private fitAddon?: FitAddon;
  private ws?: WebSocket;

  readonly wsUrl = signal('ws://localhost:8787/terminal');
  readonly wsState = signal<'disconnected' | 'connecting' | 'connected'>('disconnected');

  readonly input = signal('');
  readonly planDraft = signal('需求分析\n拆解任务\n实现代码\n验证输出');

  readonly vm$ = this.agent.vm$;
  readonly logFilter = signal<'all' | 'success' | 'skipped' | 'failed'>('all');
  readonly capabilityQuery = signal('');

  readonly status$ = this.vm$.pipe(
    map(
      (vm) =>
        `${vm.status === 'streaming' ? 'Streaming' : vm.status === 'error' ? 'Error' : 'Ready'} · Mode: ${vm.mode}`,
    ),
  );

  readonly filteredLogs$ = combineLatest([this.vm$, toObservable(this.logFilter)]).pipe(
    map(([vm, filter]) => (filter === 'all' ? vm.toolLogs : vm.toolLogs.filter((log) => log.result === filter))),
  );

  readonly filteredToggles$ = combineLatest([this.vm$, toObservable(this.capabilityQuery)]).pipe(
    map(([vm, query]) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return vm.toggles;
      return vm.toggles.filter((item) => item.name.toLowerCase().includes(needle) || item.scope.includes(needle));
    }),
  );

  constructor() {
    const renderer = new marked.Renderer();
    renderer.code = (code: string, language?: string) => {
      const lang = language || 'plaintext';
      const escaped = this.escapeHtml(code);
      return `
<div class="code-block" data-language="${lang}">
  <div class="code-toolbar">
    <span>${lang}</span>
    <div class="actions">
      <button type="button" class="copy-code">Copy</button>
      <button type="button" class="edit-code">Edit</button>
      <button type="button" class="save-code hidden">Save</button>
      <button type="button" class="cancel-code hidden">Cancel</button>
    </div>
  </div>
  <pre><code class="language-${lang}">${escaped}</code></pre>
  <textarea class="code-editor hidden">${escaped}</textarea>
</div>`;
    };
    marked.setOptions({ renderer, gfm: true, breaks: true });
  }

  async ngAfterViewInit(): Promise<void> {
    this.initMonaco();
    this.initTerminal();
    await this.agent.hydrate();
  }

  ngOnDestroy(): void {
    this.ws?.close();
    this.ws = undefined;
    this.wsState.set('disconnected');
    this.monacoInstance?.dispose();
    this.term?.dispose();
  }

  ngAfterViewChecked(): void {
    if (this.messageList?.nativeElement) {
      Prism.highlightAllUnder(this.messageList.nativeElement);
    }
  }

  async send(): Promise<void> {
    const text = this.input().trim();
    if (!text) return;
    this.input.set('');
    this.writeTerminal(`> ${text}`);
    await this.agent.send(text);
  }

  async sendStream(): Promise<void> {
    const text = this.input().trim();
    if (!text) return;
    this.input.set('');
    this.writeTerminal(`> ${text}`);
    await this.agent.sendStream(text);
  }

  async clearSession(): Promise<void> {
    await this.agent.clearSession();
    this.writeTerminal('Session cleared.');
  }

  exportHistory(): void {
    const blob = new Blob([this.agent.exportHistory()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.writeTerminal('History exported.');
  }

  setMode(mode: CoordinationMode): void {
    this.agent.setPlanMode(mode);
    this.writeTerminal(`Coordinator mode -> ${mode}`);
  }

  buildPlan(): void {
    this.agent.generatePlanFromText(this.planDraft());
    this.writeTerminal('Plan generated from draft.');
  }

  async executeStep(step: CoordinationStep): Promise<void> {
    await this.agent.executeStep(step.id);
    this.writeTerminal(`Step executed: ${step.title}`);
  }

  skipStep(step: CoordinationStep): void {
    this.agent.skipStep(step.id);
    this.writeTerminal(`Step skipped: ${step.title}`);
  }

  retryStep(step: CoordinationStep): void {
    this.agent.retryStep(step.id);
    this.writeTerminal(`Step retry queued: ${step.title}`);
  }

  cancelStep(step: CoordinationStep): void {
    this.agent.cancelStep(step.id);
    this.writeTerminal(`Step cancelled: ${step.title}`);
  }

  toggleMcp(server: UiMcpServer): void {
    this.agent.toggleMcpServer(server.id);
    this.writeTerminal(`MCP ${server.name} toggled`);
  }

  refreshMcp(server: UiMcpServer): void {
    this.agent.refreshMcpStatus(server.id);
    this.writeTerminal(`MCP ${server.name} status refreshed`);
  }

  toggleCapability(item: UiToggleItem): void {
    this.agent.toggleCapability(item.id);
    this.writeTerminal(`${item.scope} ${item.name} toggled`);
  }

  clearLogs(): void {
    this.agent.clearToolLogs();
    this.writeTerminal('Tool logs cleared.');
  }

  async replayDemo(): Promise<void> {
    this.writeTerminal('Demo replay started...');
    await this.agent.replayDemoScript();
    this.writeTerminal('Demo replay finished.');
  }

  loadPromptFromEditor(): void {
    const value = this.monacoInstance?.getValue() ?? '';
    this.input.set(value);
    this.writeTerminal('Prompt loaded from Monaco editor.');
  }

  connectWebSocket(): void {
    if (this.wsState() === 'connected' || this.wsState() === 'connecting') return;

    this.wsState.set('connecting');
    this.writeTerminal(`[WS] connecting -> ${this.wsUrl()}`);

    try {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;

      ws.onopen = () => {
        this.wsState.set('connected');
        this.writeTerminal('[WS] connected (reserved for backend integration)');
      };

      ws.onmessage = (event) => {
        this.writeTerminal(`[WS] ${String(event.data)}`);
      };

      ws.onerror = () => {
        this.wsState.set('disconnected');
        this.writeTerminal('[WS] connection error (no local backend expected in browser-only mode)');
      };

      ws.onclose = () => {
        this.wsState.set('disconnected');
        this.writeTerminal('[WS] disconnected');
      };
    } catch {
      this.wsState.set('disconnected');
      this.writeTerminal('[WS] invalid websocket url');
    }
  }

  disconnectWebSocket(): void {
    this.ws?.close();
    this.ws = undefined;
    this.wsState.set('disconnected');
    this.writeTerminal('[WS] manual disconnect');
  }

  renderMarkdown(content: string): SafeHtml {
    const html = marked.parse(content) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  onMessageAction(event: Event): void {
    const target = event.target as HTMLElement;
    const block = target.closest('.code-block') as HTMLElement | null;
    if (!block) return;

    const code = block.querySelector('code');
    const editor = block.querySelector('.code-editor') as HTMLTextAreaElement | null;
    const pre = block.querySelector('pre');
    const copy = block.querySelector('.copy-code');
    const edit = block.querySelector('.edit-code');
    const save = block.querySelector('.save-code');
    const cancel = block.querySelector('.cancel-code');

    if (target.classList.contains('copy-code') && code) {
      void navigator.clipboard.writeText(code.textContent ?? '');
      return;
    }

    if (target.classList.contains('edit-code') && editor && pre) {
      editor.classList.remove('hidden');
      pre.classList.add('hidden');
      edit?.classList.add('hidden');
      copy?.classList.add('hidden');
      save?.classList.remove('hidden');
      cancel?.classList.remove('hidden');
      return;
    }

    if (target.classList.contains('save-code') && editor && code && pre) {
      const escaped = this.escapeHtml(editor.value);
      code.textContent = editor.value;
      const lang = block.dataset['language'] ?? 'plaintext';
      code.className = `language-${lang}`;
      editor.value = escaped;
      editor.classList.add('hidden');
      pre.classList.remove('hidden');
      edit?.classList.remove('hidden');
      copy?.classList.remove('hidden');
      save?.classList.add('hidden');
      cancel?.classList.add('hidden');
      Prism.highlightElement(code);
      return;
    }

    if (target.classList.contains('cancel-code') && editor && pre) {
      editor.classList.add('hidden');
      pre.classList.remove('hidden');
      edit?.classList.remove('hidden');
      copy?.classList.remove('hidden');
      save?.classList.add('hidden');
      cancel?.classList.add('hidden');
    }
  }

  private initMonaco(): void {
    void monacoLoader.init().then((monaco) => {
      this.monacoInstance = monaco.editor.create(this.monacoHost.nativeElement, {
        value: '// Prompt Draft\n// 你可以在这里编写系统提示词或工具调用脚本\n',
        language: 'typescript',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        theme: 'vs-dark',
        scrollBeyondLastLine: false,
      });
    });
  }

  private initTerminal(): void {
    this.term = new Terminal({
      rows: 10,
      fontSize: 12,
      theme: {
        background: '#0b1220',
        foreground: '#d4d4d8',
      },
      convertEol: true,
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.terminalHost.nativeElement);
    this.fitAddon.fit();
    this.writeTerminal('Claude Agent Terminal (simulated)');
  }

  private writeTerminal(text: string): void {
    this.term?.writeln(text);
  }

  private escapeHtml(v: string): string {
    return v
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
