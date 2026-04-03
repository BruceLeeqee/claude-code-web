import { Injectable } from '@angular/core';

export interface BridgeListResponse {
  ok: boolean;
  dir: string;
  entries: Array<{ name: string; type: 'dir' | 'file' }>;
}

export interface BridgeReadResponse {
  ok: boolean;
  path: string;
  content: string;
}

export interface BridgeExecResponse {
  ok: boolean;
  command: string;
  cwd: string;
  code: number;
  stdout: string;
  stderr: string;
}

@Injectable({ providedIn: 'root' })
export class LocalBridgeService {
  private readonly baseUrl = localStorage.getItem('bridge.baseUrl') || 'http://127.0.0.1:8787';
  private readonly token = localStorage.getItem('bridge.token') || 'change-me-bridge-token';

  setBridgeConfig(baseUrl: string, token: string): void {
    localStorage.setItem('bridge.baseUrl', baseUrl);
    localStorage.setItem('bridge.token', token);
  }

  async health(): Promise<{ ok: boolean; root: string; now: number }> {
    return this.request('/api/health');
  }

  async list(dir = '.'): Promise<BridgeListResponse> {
    return this.request(`/api/fs/list?dir=${encodeURIComponent(dir)}`);
  }

  async read(path: string): Promise<BridgeReadResponse> {
    return this.request(`/api/fs/read?path=${encodeURIComponent(path)}`);
  }

  async write(path: string, content: string): Promise<{ ok: boolean; path: string }> {
    return this.request('/api/fs/write', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async remove(path: string): Promise<{ ok: boolean; path: string }> {
    return this.request(`/api/fs?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  }

  async exec(command: string, cwd = '.'): Promise<BridgeExecResponse> {
    return this.request('/api/terminal/exec', {
      method: 'POST',
      body: JSON.stringify({ command, cwd }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/tools/call', {
      method: 'POST',
      body: JSON.stringify({ tool, args }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
