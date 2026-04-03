import type { JsonValue } from '../../types/index.js';

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
  send(request: ProxyRequest): Promise<ProxyResponse>;
}

export class FetchUpstreamProxy implements UpstreamProxy {
  constructor(private readonly baseUrl = '') {}

  async send(request: ProxyRequest): Promise<ProxyResponse> {
    const init: RequestInit = {
      method: request.method,
    };

    if (request.headers) init.headers = request.headers;
    if (request.body !== undefined) init.body = JSON.stringify(request.body);

    const res = await fetch(`${this.baseUrl}${request.url}`, init);

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
