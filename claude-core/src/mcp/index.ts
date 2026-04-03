import type { MCPRegistryServer, MCPRequest, MCPResponse } from '../types/index.js';

export interface MCPClientConfig {
  endpoint: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface MCPTransport {
  send(payload: string, signal?: AbortSignal): Promise<string>;
}

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

export class MCPRegistry {
  constructor(private readonly servers: MCPRegistryServer[] = []) {}

  list(): MCPRegistryServer[] {
    return [...this.servers];
  }

  get(id: string): MCPRegistryServer | null {
    return this.servers.find((s) => s.id === id) ?? null;
  }
}

export class MCPClient {
  constructor(private readonly transport: MCPTransport, private readonly timeoutMs = 30_000) {}

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
