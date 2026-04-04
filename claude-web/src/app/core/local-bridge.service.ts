import { Injectable } from '@angular/core';

/** 本地 Bridge 列目录接口返回结构 */
export interface BridgeListResponse {
  ok: boolean;
  dir: string;
  entries: Array<{ name: string; type: 'dir' | 'file' }>;
}

/** 本地 Bridge 读文件接口返回结构 */
export interface BridgeReadResponse {
  ok: boolean;
  path: string;
  content: string;
}

/** 本地 Bridge 执行终端命令的返回结构 */
export interface BridgeExecResponse {
  ok: boolean;
  command: string;
  cwd: string;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 本地 Bridge HTTP/WebSocket 客户端。
 * 与 `local-bridge/server.js` 通信，提供文件、终端、工具调用与健康检查等能力。
 * 基址与令牌默认来自 localStorage（`bridge.baseUrl` / `bridge.token`）。
 */
@Injectable({ providedIn: 'root' })
export class LocalBridgeService {
  private readonly baseUrl = localStorage.getItem('bridge.baseUrl') || 'http://127.0.0.1:8787';
  private readonly token = localStorage.getItem('bridge.token') || 'change-me-bridge-token';

  /** 写入 Bridge 地址与鉴权令牌（持久化到 localStorage） */
  setBridgeConfig(baseUrl: string, token: string): void {
    localStorage.setItem('bridge.baseUrl', baseUrl);
    localStorage.setItem('bridge.token', token);
  }

  /** 健康检查：确认 Bridge 可达并返回允许的根目录等信息 */
  async health(): Promise<{ ok: boolean; root: string; now: number }> {
    return this.request('/api/health');
  }

  /** 列出指定相对目录下的文件与子目录 */
  async list(dir = '.'): Promise<BridgeListResponse> {
    return this.request(`/api/fs/list?dir=${encodeURIComponent(dir)}`);
  }

  /** 读取 UTF-8 文本文件内容 */
  async read(path: string): Promise<BridgeReadResponse> {
    return this.request(`/api/fs/read?path=${encodeURIComponent(path)}`);
  }

  /** 写入或覆盖 UTF-8 文本文件 */
  async write(path: string, content: string): Promise<{ ok: boolean; path: string }> {
    return this.request('/api/fs/write', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 删除文件或目录（递归，与 Bridge 行为一致） */
  async remove(path: string): Promise<{ ok: boolean; path: string }> {
    return this.request(`/api/fs?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  }

  /** 在沙箱内执行允许列表中的 shell 命令 */
  async exec(command: string, cwd = '.'): Promise<BridgeExecResponse> {
    return this.request('/api/terminal/exec', {
      method: 'POST',
      body: JSON.stringify({ command, cwd }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 调用 Bridge 统一工具入口（如 fs.read、terminal.exec） */
  async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/tools/call', {
      method: 'POST',
      body: JSON.stringify({ tool, args }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 通过 Bridge 代理探测上游大模型 API 是否可用（不经过浏览器直连，避免 CORS） */
  async testModelConnection(payload: {
    baseUrl: string;
    apiKey: string;
    model: string;
    provider?: string;
  }): Promise<{ ok: boolean; status: number; body: string }> {
    return this.request('/api/model/test', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * 建立终端 WebSocket 会话，用于交互式 shell（需 Bridge 开启且 token 正确）。
   * @param onMessage 收到服务端 JSON 消息时的回调
   * @param sessionId 可选会话 id，便于多标签区分
   */
  connectTerminalWebSocket(
    onMessage: (evt: { type: string; data?: string; code?: number; sessionId?: string }) => void,
    sessionId = `s_${Math.random().toString(36).slice(2, 10)}`,
  ): WebSocket {
    const http = new URL(this.baseUrl);
    const wsProto = http.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${http.host}/ws/terminal?token=${encodeURIComponent(this.token)}&sessionId=${encodeURIComponent(sessionId)}`;

    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        onMessage(JSON.parse(String(event.data)));
      } catch {
        onMessage({ type: 'stdout', data: String(event.data), sessionId });
      }
    };
    return ws;
  }

  /** 统一 fetch：自动附加 `x-bridge-token`，并将非 ok 响应转为异常 */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers || {});
    headers.set('x-bridge-token', this.token);

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const data = await res.json();
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error ?? `Bridge request failed: ${res.status}`);
    }
    return data as T;
  }
}
