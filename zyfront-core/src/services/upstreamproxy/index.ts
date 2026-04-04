/**
 * 上游 HTTP 代理：将相对 url 拼到 ProxyConfig.baseUrl 并用 fetch 转发。
 */
import type { JsonValue, ProxyConfig } from '../../types/index.js';

/** 代理层使用的请求描述 */
export interface ProxyRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: JsonValue;
}

/** 代理响应：状态、头与 JSON 体 */
export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: JsonValue;
}

/** 可替换的代理发送抽象 */
export interface UpstreamProxy {
  send(request: ProxyRequest, signal?: AbortSignal): Promise<ProxyResponse>;
}

/** 基于浏览器 fetch 的默认实现 */
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
