import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import monacoLoader from '@monaco-editor/loader';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { ClaudeAgentService } from '../../core/claude-agent.service';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.page.html',
  styleUrl: './chat.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPageComponent implements AfterViewInit {
  private readonly agent = inject(ClaudeAgentService);

  @ViewChild('monacoHost', { static: true })
  monacoHost!: ElementRef<HTMLDivElement>;

  @ViewChild('terminalHost', { static: true })
  terminalHost!: ElementRef<HTMLDivElement>;

  private monacoInstance?: import('monaco-editor').editor.IStandaloneCodeEditor;
  private term?: Terminal;
  private fitAddon?: FitAddon;

  readonly input = signal('');
  readonly vm = toSignal(this.agent.vm$, {
    initialValue: {
      messages: [],
      planSteps: [],
      tools: [],
      cost: null,
      status: 'idle' as const,
    },
  });

  readonly status = computed(() => {
    const vm = this.vm();
    const mode = vm.planSteps.length > 0 ? 'plan' : 'single';
    return `${vm.status === 'streaming' ? 'Streaming' : vm.status === 'error' ? 'Error' : 'Ready'} · Mode: ${mode}`;
  });

  async ngAfterViewInit(): Promise<void> {
    this.initMonaco();
    this.initTerminal();
    await this.agent.hydrate();
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
}
