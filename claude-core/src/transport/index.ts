/**
 * 传输层抽象与演示实现：统一信封格式，默认客户端在本地回环 emit（无真实网络）。
 */
/** 传输后端种类占位 */
export type TransportKind = 'remoteIO' | 'sse' | 'websocket';

/** 一条通用传输消息 */
export interface TransportEnvelope {
  id: string;
  type: string;
  payload?: unknown;
  ts: number;
}

/** 传输客户端契约 */
export interface TransportClient {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: TransportEnvelope): Promise<void>;
  onMessage(handler: (message: TransportEnvelope) => void): () => void;
}

/** 带订阅列表的基类：send 即本地 emit */
abstract class BaseTransportClient implements TransportClient {
  abstract readonly kind: TransportKind;

  private readonly listeners = new Set<(message: TransportEnvelope) => void>();

  async connect(): Promise<void> {
    return;
  }

  async disconnect(): Promise<void> {
    return;
  }

  async send(message: TransportEnvelope): Promise<void> {
    this.emit(message);
  }

  onMessage(handler: (message: TransportEnvelope) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  protected emit(message: TransportEnvelope): void {
    for (const handler of this.listeners) handler(message);
  }
}

/** RemoteIO 占位实现 */
export class RemoteIOClient extends BaseTransportClient {
  readonly kind: TransportKind = 'remoteIO';
}

/** SSE 占位实现 */
export class SSETransportClient extends BaseTransportClient {
  readonly kind: TransportKind = 'sse';
}

/** WebSocket 占位实现 */
export class WebSocketTransportClient extends BaseTransportClient {
  readonly kind: TransportKind = 'websocket';
}

/** 对 TransportClient 的薄封装，自动生成信封 id 与时间戳 */
export class UnifiedTransport {
  constructor(private readonly client: TransportClient) {}

  connect(): Promise<void> {
    return this.client.connect();
  }

  disconnect(): Promise<void> {
    return this.client.disconnect();
  }

  /** 发送一条带 type/payload 的信封 */
  send(type: string, payload?: unknown): Promise<void> {
    return this.client.send({
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      ts: Date.now(),
    });
  }

  onMessage(handler: (message: TransportEnvelope) => void): () => void {
    return this.client.onMessage(handler);
  }
}
