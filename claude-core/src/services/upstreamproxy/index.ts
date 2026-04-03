import type { JsonValue, ProxyConfig } from '../../types/index.js';

export interface ProxyRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: JsonValue;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: JsonValue;
}

export interface UpstreamProxy {
  send(request: ProxyRequest, signal?: AbortSignal): Promise<ProxyResponse>;
}

export class FetchUpstreamProxy implements UpstreamProxy {
  constructor(private readonly config: ProxyConfig) {}

  async send(request: ProxyRequest, signal?: AbortSignal): Promise<ProxyResponse> {
    const init: RequestInit = {
      method: request.method,
      signal: signal ?? null,
    };

    init.headers = {
      ...(this.config.headers ?? {}),
      ...(request.headers ?? {}),
    };

    if (request.body !== undefined) {
      init.body = JSON.stringify(request.body);
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.config.baseUrl}${request.url}`, init);
    const body = (await res.json().catch(() => null)) as JsonValue;
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: res.status,
      headers,
      body,
    };
  }
}
