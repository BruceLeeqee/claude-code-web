import type { JsonObject } from '../../types/index.js';

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

export interface LspClient {
  initialize(projectId: string): Promise<void>;
  diagnostics(uri: string): Promise<LspDiagnostic[]>;
  shutdown(): Promise<void>;
}

export class BrowserLspStubClient implements LspClient {
  async initialize(_projectId: string): Promise<void> {
    return;
  }

  async diagnostics(_uri: string): Promise<LspDiagnostic[]> {
    return [];
  }

  async shutdown(): Promise<void> {
    return;
  }
}

export interface LspServerDescriptor extends JsonObject {
  id: string;
  label: string;
  enabled: boolean;
}
