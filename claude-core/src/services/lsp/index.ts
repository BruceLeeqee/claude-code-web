/**
 * LSP 相关类型、协调器与会话，以及浏览器内无操作的 Stub 客户端。
 */
import type { JsonObject } from '../../types/index.js';

/** 零基行列位置 */
export interface LspPosition {
  line: number;
  character: number;
}

/** 闭开区间范围 */
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** 单条诊断 */
export interface LspDiagnostic {
  range: LspRange;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

/** Hover 内容 */
export interface LspHover {
  contents: string;
  range?: LspRange;
}

/** 与真实语言服务器交互的客户端接口 */
export interface LspClient {
  initialize(projectId: string): Promise<void>;
  diagnostics(uri: string): Promise<LspDiagnostic[]>;
  hover(uri: string, position: LspPosition): Promise<LspHover | null>;
  shutdown(): Promise<void>;
}

/** 本地打开的 LSP 会话元数据 */
export interface LspSession {
  id: string;
  projectId: string;
  createdAt: number;
}

/** 多会话引用计数：最后一扇关闭时 shutdown 底层 client */
export class LspCoordinator {
  private readonly sessions = new Map<string, LspSession>();

  constructor(private readonly client: LspClient) {}

  /** 初始化 project 并登记会话 */
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

  /** 移除会话；若无剩余会话则 shutdown */
  async close(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) {
      await this.client.shutdown();
    }
  }
}

/** 浏览器占位：所有 LSP 调用为空操作 */
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

/** UI 层展示用的服务器描述 */
export interface LspServerDescriptor extends JsonObject {
  id: string;
  label: string;
  enabled: boolean;
}
