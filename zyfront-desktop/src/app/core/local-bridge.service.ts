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
  async health(): Promise<{ ok: boolean; root: string; now: number }> {
    const info = await window.zytrader.workspace.info();
    return { ok: info.ok && info.exists, root: info.root, now: Date.now() };
  }

  /** 列出目录 */
  async list(dir = '.'): Promise<BridgeListResponse> {
    return window.zytrader.fs.list(dir);
  }

  /** 读取文本文件 */
  async read(path: string): Promise<BridgeReadResponse> {
    return window.zytrader.fs.read(path);
  }

  /** 写入文本文件 */
  async write(path: string, content: string): Promise<{ ok: boolean; path: string }> {
    return window.zytrader.fs.write(path, content);
  }

  /** 删除文件/目录 */
  async remove(path: string): Promise<{ ok: boolean; path: string }> {
    return window.zytrader.fs.remove(path);
  }

  /** 执行命令 */
  async exec(command: string, cwd = '.'): Promise<BridgeExecResponse> {
    return window.zytrader.terminal.exec(command, cwd);
  }

  /** 桌面模式下直接调用本地 API */
  async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (tool === 'fs.list') return this.list(String(args['dir'] ?? '.'));
    if (tool === 'fs.read') return this.read(String(args['path'] ?? ''));
    if (tool === 'fs.write') return this.write(String(args['path'] ?? ''), String(args['content'] ?? ''));
    if (tool === 'fs.delete') return this.remove(String(args['path'] ?? ''));
    if (tool === 'terminal.exec') return this.exec(String(args['command'] ?? ''), String(args['cwd'] ?? '.'));
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
