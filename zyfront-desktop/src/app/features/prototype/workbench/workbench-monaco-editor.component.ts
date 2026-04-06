import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import loader from '@monaco-editor/loader';
import 'monaco-editor/min/vs/editor/editor.main.css';

/** loader.init() 返回的 Monaco API（与 editor.api 类型声明不完全一致，此处用宽松类型） */
type MonacoApi = typeof import('monaco-editor');

/** 与工作台底部「问题」条对齐的诊断行 */
export interface WorkbenchEditorDiagnosticRow {
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  line: number;
  column: number;
}

@Component({
  selector: 'app-workbench-monaco-editor',
  standalone: true,
  template: '<div #host class="monaco-host"></div>',
  styles: [
    `
      :host {
        display: flex;
        flex: 1;
        min-height: 0;
        min-width: 0;
        flex-direction: column;
      }
      .monaco-host {
        flex: 1;
        min-height: 0;
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkbenchMonacoEditorComponent implements AfterViewInit, OnDestroy {
  private readonly hostRef = viewChild<ElementRef<HTMLDivElement>>('host');

  readonly value = input.required<string>();
  readonly language = input<string>('typescript');

  readonly valueChange = output<string>();
  readonly saveRequested = output<void>();
  readonly markersChange = output<WorkbenchEditorDiagnosticRow[]>();

  private editor?: import('monaco-editor').editor.IStandaloneCodeEditor;
  private monaco?: MonacoApi;
  private ready = false;
  private markersDisposable?: { dispose: () => void };

  constructor() {
    effect(() => {
      if (!this.ready || !this.editor || !this.monaco) return;
      const v = this.value();
      const cur = this.editor.getValue();
      if (cur !== v) {
        this.editor.setValue(v);
      }
      const lang = this.language();
      const model = this.editor.getModel();
      if (model) {
        this.monaco.editor.setModelLanguage(model, lang);
      }
      queueMicrotask(() => this.pushMarkers());
    });
  }

  private pushMarkers(): void {
    if (!this.monaco) return;
    const model = this.editor?.getModel();
    if (!model) {
      this.markersChange.emit([]);
      return;
    }
    const raw = this.monaco.editor.getModelMarkers({ resource: model.uri });
    const rows: WorkbenchEditorDiagnosticRow[] = raw.map((m) => ({
      severity:
        m.severity === 8 ? 'error' : m.severity === 4 ? 'warning' : m.severity === 2 ? 'info' : 'hint',
      message: m.message,
      line: m.startLineNumber,
      column: m.startColumn,
    }));
    this.markersChange.emit(rows);
  }

  async ngAfterViewInit(): Promise<void> {
    const vs = new URL('assets/monaco/vs', document.baseURI).href.replace(/\/$/, '');
    loader.config({ paths: { vs } });
    const monaco = (await loader.init()) as MonacoApi;
    this.monaco = monaco;
    this.applyTsDefaults(monaco);

    const el = this.hostRef()?.nativeElement;
    if (!el) return;
    this.editor = monaco.editor.create(el, {
      value: this.value(),
      language: this.language(),
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      insertSpaces: true,
      formatOnPaste: true,
      formatOnType: true,
      'semanticHighlighting.enabled': true,
    } as import('monaco-editor').editor.IStandaloneEditorConstructionOptions);

    this.editor.onDidChangeModelContent(() => {
      this.valueChange.emit(this.editor!.getValue());
    });

    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      this.saveRequested.emit();
    });

    this.markersDisposable = monaco.editor.onDidChangeMarkers(() => this.pushMarkers());
    this.pushMarkers();

    this.ready = true;
  }

  private applyTsDefaults(monaco: MonacoApi): void {
    const lt = monaco.languages.typescript as unknown as {
      typescriptDefaults: {
        setCompilerOptions: (o: Record<string, unknown>) => void;
        setDiagnosticsOptions: (o: Record<string, unknown>) => void;
      };
      javascriptDefaults: {
        setCompilerOptions: (o: Record<string, unknown>) => void;
        setDiagnosticsOptions: (o: Record<string, unknown>) => void;
      };
    };
    const opts = {
      target: 99,
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
      moduleResolution: 2,
      module: 99,
      noEmit: true,
      esModuleInterop: true,
      jsx: 2,
    };
    lt.typescriptDefaults.setCompilerOptions(opts);
    lt.javascriptDefaults.setCompilerOptions(opts);
    lt.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    lt.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  }

  ngOnDestroy(): void {
    this.ready = false;
    this.markersDisposable?.dispose();
    this.markersDisposable = undefined;
    this.editor?.dispose();
    this.editor = undefined;
    this.monaco = undefined;
  }
}
