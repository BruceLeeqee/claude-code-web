import type { MCPRequest, MCPResponse } from '../types/index.js';

export interface MCPTransport {
  send(payload: string): Promise<string>;
}

export class HttpMCPTransport implements MCPTransport {
  constructor(private readonly endpoint: string, private readonly headers?: Record<string, string>) {}

  async send(payload: string): Promise<string> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.headers ?? {}),
      },
      body: payload,
    });

    if (!res.ok) {
      throw new Error(`MCP transport failed with ${res.status}`);
    }

    return await res.text();
  }
}

export class MCPClient {
  constructor(private readonly transport: MCPTransport) {}

  async call(request: MCPRequest): Promise<MCPResponse> {
    const raw = await this.transport.send(JSON.stringify(request));
    return JSON.parse(raw) as MCPResponse;
  }
}
