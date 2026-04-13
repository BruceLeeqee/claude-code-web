/**
 * 聊天主页面：绑定 `ClaudeAgentService` 的聚合 vm$、Markdown 渲染、代码块交互与计划/MCP 侧栏。
 */
import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AsyncPipe } from '@angular/common';
import { Subscription, combineLatest, map } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { marked } from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import { AppSettingsService } from '../../core/app-settings.service';
import type { ChatMessage, CoordinationMode, CoordinationStep, JsonObject } from 'zyfront-core';
import { ClaudeAgentService, type UiMcpServer, type UiToggleItem } from '../../core/claude-agent.service';

interface ChatTurnVm {
  userPrompt: string;
  assistant: ChatMessage;
}

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, FormsModule, AsyncPipe],
  templateUrl: './chat.page.html',
  styleUrl: './chat.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPageComponent implements OnInit, AfterViewChecked, OnDestroy {
  private readonly agent = inject(ClaudeAgentService);
  private readonly appSettings = inject(AppSettingsService);
  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('thread', { static: false })
  threadRef?: ElementRef<HTMLDivElement>;

  @ViewChild('messageList', { static: false })
  messageList?: ElementRef<HTMLUListElement>;

  private scrollSub?: Subscription;

  readonly input = signal('');
  readonly planDraft = signal('需求分析\n拆解任务\n实现代码\n验证输出');
  readonly advancedOpen = signal(false);

  readonly vm$ = this.agent.vm$;
  readonly settings$ = this.appSettings.settings$;
  readonly logFilter = signal<'all' | 'success' | 'skipped' | 'failed'>('all');
  readonly capabilityQuery = signal('');

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
    // 自定义 Markdown 代码块 HTML，便于 Prism 高亮与内联编辑/复制
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

  /** 拉取历史并在新消息时滚动到底部 */
  async ngOnInit(): Promise<void> {
    await this.agent.hydrate();
    this.scrollSub = this.agent.messages$.subscribe(() => this.scheduleScrollThread());
  }

  /** 取消消息订阅 */
  ngOnDestroy(): void {
    this.scrollSub?.unsubscribe();
  }

  /** 每次变更检测后对消息列表下的代码块跑 Prism 着色 */
  ngAfterViewChecked(): void {
    if (this.messageList?.nativeElement) {
      Prism.highlightAllUnder(this.messageList.nativeElement);
    }
  }

  /** 将对话线程滚动条置底（微任务中执行避免布局抖动） */
  private scheduleScrollThread(): void {
    queueMicrotask(() => {
      const el = this.threadRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  /** Enter 发送，Shift+Enter 换行 */
  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void this.sendStream();
  }

  /** 非流式发送 */
  async send(): Promise<void> {
    const text = this.input().trim();
    if (!text) return;
    this.input.set('');
    await this.agent.send(text);
    this.scheduleScrollThread();
  }

  /** 流式发送（默认主路径） */
  async sendStream(): Promise<void> {
    const text = this.input().trim();
    if (!text) return;
    this.input.set('');
    await this.agent.sendStream(text);
    this.scheduleScrollThread();
  }

  /** 清空会话与计划 */
  async clearSession(): Promise<void> {
    await this.agent.clearSession();
  }

  /** 下载当前会话 JSON */
  exportHistory(): void {
    const blob = new Blob([this.agent.exportHistory()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** 切换协调模式 */
  setMode(mode: CoordinationMode): void {
    this.agent.setPlanMode(mode);
  }

  /** 根据草稿文本生成计划步骤 */
  buildPlan(): void {
    this.agent.generatePlanFromText(this.planDraft());
  }

  /** 执行单个计划步骤 */
  async executeStep(step: CoordinationStep): Promise<void> {
    await this.agent.executeStep(step.id);
  }

  /** 跳过步骤 */
  skipStep(step: CoordinationStep): void {
    this.agent.skipStep(step.id);
  }

  /** 重试步骤 */
  retryStep(step: CoordinationStep): void {
    this.agent.retryStep(step.id);
  }

  /** 取消步骤 */
  cancelStep(step: CoordinationStep): void {
    this.agent.cancelStep(step.id);
  }

  /** 切换 MCP 服务器启用 */
  toggleMcp(server: UiMcpServer): void {
    this.agent.toggleMcpServer(server.id);
  }

  /** 刷新 MCP 状态占位 */
  refreshMcp(server: UiMcpServer): void {
    this.agent.refreshMcpStatus(server.id);
  }

  /** 切换技能/插件开关 */
  toggleCapability(item: UiToggleItem): void {
    this.agent.toggleCapability(item.id);
  }

  /** 清空工具日志 */
  clearLogs(): void {
    this.agent.clearToolLogs();
  }

  /** 运行内置演示脚本 */
  async replayDemo(): Promise<void> {
    await this.agent.replayDemoScript();
  }

  /** Markdown → HTML 并标记为可信（已由 escape 与 sanitizer 约束场景） */
  renderMarkdown(content: string): SafeHtml {
    const html = marked.parse(content) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /** 将消息序列折叠为“用户提示词 + assistant 回答”的展示单元 */
  buildTurns(messages: ChatMessage[]): ChatTurnVm[] {
    const turns: ChatTurnVm[] = [];
    let pendingUserPrompt = '';

    for (const msg of messages) {
      if (msg.role === 'user') {
        pendingUserPrompt = msg.content;
        continue;
      }

      if (msg.role === 'assistant') {
        turns.push({
          userPrompt: pendingUserPrompt || '（无）',
          assistant: msg,
        });
      }
    }

    return turns;
  }

  /** 思考过程预览：默认只展示一行，超出以省略号表示 */
  getThinkingPreview(content: string, metadata?: JsonObject): string {
    const thinking = this.extractThinking(content, metadata);
    if (!thinking.trim()) return '（无思考内容）';
    const lines = thinking.replace(/\r/g, '').split('\n').filter((line) => line.trim().length > 0);
    const first = (lines[0] ?? thinking).trim();
    if (lines.length > 1) return `${first} …`;
    return first;
  }

  /** 思考过程全文（details 展开后可见） */
  getThinkingFull(content: string, metadata?: JsonObject): string {
    const thinking = this.extractThinking(content, metadata);
    return thinking.trim() || '（无思考内容）';
  }

  private extractThinking(content: string, metadata?: JsonObject): string {
    const metaThinking = metadata && typeof metadata['thinkingText'] === 'string' ? (metadata['thinkingText'] as string) : '';
    if (metaThinking.trim()) return metaThinking;

    const lines = content.replace(/\r/g, '').split('\n');
    const thinkingLines = lines.filter((line) => /^\s*\[(thinking|思考)/i.test(line));
    return thinkingLines.join('\n');
  }

  /** 代码块内 Copy / Edit / Save / Cancel 的事件委托 */
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

  /** 将纯文本转为可安全插入 HTML 的转义串 */
  private escapeHtml(v: string): string {
    return v
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
