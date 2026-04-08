import { Injectable } from '@angular/core';

/** 本地文件系统列目录返回结构 */
export interface BridgeListResponse {
  ok: boolean;
  dir: string;
  entries: Array<{ name: string; type: 'dir' | 'file' }>;
}

/** 本地文件系统读文件返回结构 */
export interface BridgeReadResponse {
  ok: boolean;
  path: string;
  content: string;
}

/** 本地终端命令执行返回结构 */
export interface BridgeExecResponse {
  ok: boolean;
  command: string;
  cwd: string;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Electron 本地能力服务（不再走 HTTP bridge）。
 * 通过 preload 暴露的 IPC API 直接访问本地文件系统与终端。
 */
@Injectable({ providedIn: 'root' })
export class LocalBridgeService {
  /** 兼容旧接口：桌面版无需额外 bridge 配置 */
  setBridgeConfig(_baseUrl: string, _token: string): void {
    // no-op
  }

  /** 健康检查：返回工作区信息 */
  async health(): Promise<{
    ok: boolean;
    root: string;
    vaultRoot?: string;
    vaultConfigured?: boolean;
    now: number;
  }> {
    const info = await window.zytrader.workspace.info();
    const ok = info.ok && 'root' in info && info.exists;
    const vaultRoot = info.ok && 'vaultRoot' in info ? info.vaultRoot : undefined;
    const vaultConfigured = info.ok && 'vaultConfigured' in info ? info.vaultConfigured : undefined;
    return {
      ok,
      root: info.ok && 'root' in info ? info.root : '',
      vaultRoot,
      vaultConfigured,
      now: Date.now(),
    };
  }

  /** 列出目录（scope 默认 workspace；Vault 树用 vault） */
  async list(dir = '.', scope: 'workspace' | 'vault' = 'workspace'): Promise<BridgeListResponse> {
    return window.zytrader.fs.list(dir, { scope });
  }

  /** 读取文本文件 */
  async read(path: string, scope: 'workspace' | 'vault' = 'workspace'): Promise<BridgeReadResponse> {
    return window.zytrader.fs.read(path, { scope });
  }

  /** 写入文本文件 */
  async write(
    path: string,
    content: string,
    scope: 'workspace' | 'vault' = 'workspace',
  ): Promise<{ ok: boolean; path: string }> {
    return window.zytrader.fs.write(path, content, { scope });
  }

  /** 删除文件/目录 */
  async remove(path: string, scope: 'workspace' | 'vault' = 'workspace'): Promise<{ ok: boolean; path: string }> {
    return window.zytrader.fs.remove(path, { scope });
  }

  /** 执行命令 */
  async exec(
    command: string,
    cwd = '.',
    cwdScope: 'workspace' | 'vault' = 'workspace',
  ): Promise<BridgeExecResponse> {
    return window.zytrader.terminal.exec(command, cwd, cwdScope);
  }

  /** 桌面模式下直接调用本地 API */
  async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (tool === 'fs.list') {
      const sc = args['scope'] === 'vault' ? 'vault' : 'workspace';
      return this.list(String(args['dir'] ?? '.'), sc);
    }
    if (tool === 'fs.read') {
      const sc = args['scope'] === 'vault' ? 'vault' : 'workspace';
      return this.read(String(args['path'] ?? ''), sc);
    }
    if (tool === 'fs.write') {
      const sc = args['scope'] === 'vault' ? 'vault' : 'workspace';
      return this.write(String(args['path'] ?? ''), String(args['content'] ?? ''), sc);
    }
    if (tool === 'fs.delete') {
      const sc = args['scope'] === 'vault' ? 'vault' : 'workspace';
      return this.remove(String(args['path'] ?? ''), sc);
    }
    if (tool === 'terminal.exec') {
      const cs = args['cwdScope'] === 'vault' ? 'vault' : 'workspace';
      return this.exec(String(args['command'] ?? ''), String(args['cwd'] ?? '.'), cs);
    }
    throw new Error(`Unsupported tool: ${tool}`);
  }

  /** 模型连通性测试（IPC；仅 Electron preload 注入 `zytrader` 时可用） */
  async testModelConnection(payload: {
    baseUrl: string;
    apiKey: string;
    model: string;
    provider?: string;
  }): Promise<{ ok: boolean; status: number; body: string }> {
    type TestFn = (p: typeof payload) => Promise<{ ok: boolean; status: number; body: string }>;
    const fn = (window as unknown as { zytrader?: { model?: { test: TestFn } } }).zytrader?.model?.test;
    if (!fn) {
      return {
        ok: false,
        status: 503,
        body: '当前页面未运行在 Electron 桌面壳中，无法通过 IPC 测试模型连接。请使用 npm run dev / electron 启动桌面版。',
      };
    }
    return fn(payload);
  }
}
