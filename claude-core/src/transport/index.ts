export type TransportKind = 'remoteIO' | 'sse' | 'websocket';

export interface TransportEnvelope {
  id: string;
  type: string;
  payload?: unknown;
  ts: number;
}

export interface TransportClient {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: TransportEnvelope): Promise<void>;
  onMessage(handler: (message: TransportEnvelope) => void): () => void;
}

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

export class RemoteIOClient extends BaseTransportClient {
  readonly kind: TransportKind = 'remoteIO';
}

export class SSETransportClient extends BaseTransportClient {
  readonly kind: TransportKind = 'sse';
}

export class WebSocketTransportClient extends BaseTransportClient {
  readonly kind: TransportKind = 'websocket';
}

export class UnifiedTransport {
  constructor(private readonly client: TransportClient) {}

  connect(): Promise<void> {
    return this.client.connect();
  }

  disconnect(): Promise<void> {
    return this.client.disconnect();
  }

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
