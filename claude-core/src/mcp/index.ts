/**
 * MCP 客户端：HTTP 传输、服务端注册表与带超时的 JSON 调用封装。
 */
import type { MCPRegistryServer, MCPRequest, MCPResponse } from '../types/index.js';

/** 预留：按端点配置客户端（当前主要用 Transport + MCPClient） */
export interface MCPClientConfig {
  endpoint: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** 发送 JSON 字符串并返回原始响应体 */
export interface MCPTransport {
  send(payload: string, signal?: AbortSignal): Promise<string>;
}

/** 基于 fetch 的 MCP HTTP 传输 */
export class HttpMCPTransport implements MCPTransport {
  constructor(private readonly endpoint: string, private readonly headers?: Record<string, string>) {}

  async send(payload: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.headers ?? {}),
      },
      body: payload,
      signal: signal ?? null,
    });

    if (!res.ok) throw new Error(`MCP transport failed with ${res.status}`);
    return await res.text();
  }
}

/** 内存中的 MCP 服务端目录 */
export class MCPRegistry {
  constructor(private readonly servers: MCPRegistryServer[] = []) {}

  list(): MCPRegistryServer[] {
    return [...this.servers];
  }

  /** 按 id 查找服务端描述 */
  get(id: string): MCPRegistryServer | null {
    return this.servers.find((s) => s.id === id) ?? null;
  }
}

export class MCPClient {
  constructor(private readonly transport: MCPTransport, private readonly timeoutMs = 30_000) {}

  /** 序列化请求、经 Transport 发送并解析 JSON 响应 */
  async call(request: MCPRequest): Promise<MCPResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const raw = await this.transport.send(JSON.stringify(request), controller.signal);
      return JSON.parse(raw) as MCPResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 从注册表项构造 HttpMCPTransport + MCPClient（Bearer 可选） */
export function createMcpClientFromRegistry(registry: MCPRegistry, serverId: string, token?: string): MCPClient {
  const server = registry.get(serverId);
  if (!server) throw new Error(`Unknown MCP server: ${serverId}`);

  const headers =
    server.authType === 'bearer' && token
      ? { Authorization: `Bearer ${token}` }
      : undefined;

  const transport = new HttpMCPTransport(server.endpoint, headers);
  return new MCPClient(transport);
}
