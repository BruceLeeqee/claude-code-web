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

export interface LspHover {
  contents: string;
  range?: LspRange;
}

export interface LspClient {
  initialize(projectId: string): Promise<void>;
  diagnostics(uri: string): Promise<LspDiagnostic[]>;
  hover(uri: string, position: LspPosition): Promise<LspHover | null>;
  shutdown(): Promise<void>;
}

export interface LspSession {
  id: string;
  projectId: string;
  createdAt: number;
}

export class LspCoordinator {
  private readonly sessions = new Map<string, LspSession>();

  constructor(private readonly client: LspClient) {}

  async open(sessionId: string, projectId: string): Promise<LspSession> {
    await this.client.initialize(projectId);
    const session: LspSession = {
      id: sessionId,
      projectId,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async close(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) {
      await this.client.shutdown();
    }
  }
}

export class BrowserLspStubClient implements LspClient {
  async initialize(_projectId: string): Promise<void> {
    return;
  }

  async diagnostics(_uri: string): Promise<LspDiagnostic[]> {
    return [];
  }

  async hover(_uri: string, _position: LspPosition): Promise<LspHover | null> {
    return null;
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
