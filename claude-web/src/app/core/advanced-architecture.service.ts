/**
 * 高级架构演示服务：聚合 claude-core 中的语音、Vim、内存文件系统、传输层与 GrowthBook 特性开关，
 * 主要在设置页用于展示/试用，与真实对话链路解耦。
 */
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  GrowthbookFacade,
  MemoryFileSystem,
  RemoteIOClient,
  SSETransportClient,
  UnifiedTransport,
  VimKeymapSimulator,
  VoiceArchitecture,
  WebSocketTransportClient,
  fromBase64,
  getSafeUserAgent,
  toBase64,
  type TransportKind,
} from 'claude-core';

@Injectable({ providedIn: 'root' })
export class AdvancedArchitectureService {
  private readonly voice = new VoiceArchitecture();
  private readonly vim = new VimKeymapSimulator();
  private readonly memfs = new MemoryFileSystem();
  private readonly growthbook = new GrowthbookFacade();

  private transport = new UnifiedTransport(new SSETransportClient());

  private readonly voiceStateSubject = new BehaviorSubject(this.voice.getState());
  private readonly vimStateSubject = new BehaviorSubject(this.vim.getState());
  private readonly memFilesSubject = new BehaviorSubject(this.memfs.snapshot());
  private readonly transportKindSubject = new BehaviorSubject<TransportKind>('sse');
  private readonly transportLogSubject = new BehaviorSubject<string[]>([]);
  private readonly analyticsSubject = new BehaviorSubject<string[]>([]);

  readonly voiceState$ = this.voiceStateSubject.asObservable();
  readonly vimState$ = this.vimStateSubject.asObservable();
  readonly memFiles$ = this.memFilesSubject.asObservable();
  readonly transportKind$ = this.transportKindSubject.asObservable();
  readonly transportLog$ = this.transportLogSubject.asObservable();
  readonly analytics$ = this.analyticsSubject.asObservable();

  /** 安全的 User-Agent 摘要，用于演示或遥测占位 */
  readonly userAgent = getSafeUserAgent();

  constructor() {
    this.growthbook.registerFeature({
      key: 'new-settings-ui',
      defaultValue: false,
      rules: [{ attribute: 'plan', equals: 'pro', value: true }],
    });

    this.transport.onMessage((message) => {
      this.appendTransportLog(`[${message.type}] ${JSON.stringify(message.payload ?? {})}`);
    });
  }

  /** 切换统一传输层实现（SSE / WebSocket / RemoteIO） */
  setTransport(kind: TransportKind): void {
    this.transportKindSubject.next(kind);
    if (kind === 'remoteIO') this.transport = new UnifiedTransport(new RemoteIOClient());
    if (kind === 'sse') this.transport = new UnifiedTransport(new SSETransportClient());
    if (kind === 'websocket') this.transport = new UnifiedTransport(new WebSocketTransportClient());
    this.transport.onMessage((message) => {
      this.appendTransportLog(`[${message.type}] ${JSON.stringify(message.payload ?? {})}`);
    });
    this.appendTransportLog(`Transport switched to ${kind}`);
  }

  /** 建立传输连接（模拟） */
  async connectTransport(): Promise<void> {
    await this.transport.connect();
    this.appendTransportLog('Transport connected (simulated)');
  }

  /** 断开传输连接 */
  async disconnectTransport(): Promise<void> {
    await this.transport.disconnect();
    this.appendTransportLog('Transport disconnected');
  }

  /** 经当前传输层发送一条消息并记一条分析事件 */
  async sendTransportMessage(type: string, payload: unknown): Promise<void> {
    await this.transport.send(type, payload);
    this.appendAnalytics(`transport.send:${type}`);
  }

  /** 开始语音「监听」状态（演示） */
  startListening(): void {
    this.voice.startListening();
    this.voiceStateSubject.next(this.voice.getState());
  }

  /** 开始语音「播报」状态（演示） */
  startSpeaking(): void {
    this.voice.startSpeaking();
    this.voiceStateSubject.next(this.voice.getState());
  }

  /** 停止语音相关状态 */
  stopVoice(): void {
    this.voice.stop();
    this.voiceStateSubject.next(this.voice.getState());
  }

  /** 将按键交给 Vim 模拟器并推送最新状态 */
  sendVimKey(key: string): void {
    this.vimStateSubject.next(this.vim.handle({ key }));
  }

  /** 写入浏览器内存虚拟文件系统（非本地磁盘） */
  writeFile(path: string, content: string): void {
    this.memfs.write(path, content);
    this.memFilesSubject.next(this.memfs.snapshot());
    this.appendAnalytics(`memfs.write:${path}`);
  }

  /** 从内存虚拟文件系统删除路径 */
  removeFile(path: string): void {
    this.memfs.remove(path);
    this.memFilesSubject.next(this.memfs.snapshot());
    this.appendAnalytics(`memfs.remove:${path}`);
  }

  /** 按用户套餐评估 GrowthBook 特性开关示例 */
  evaluateFeature(plan: 'free' | 'pro'): boolean {
    this.growthbook.setAttributes({ plan });
    return Boolean(this.growthbook.evaluate<boolean>('new-settings-ui'));
  }

  /** Base64 编码（演示） */
  encodeBase64(v: string): string {
    return toBase64(v);
  }

  /** Base64 解码（演示） */
  decodeBase64(v: string): string {
    return fromBase64(v);
  }

  /** 在传输日志中前置追加一行，最多保留 50 条 */
  private appendTransportLog(line: string): void {
    this.transportLogSubject.next([line, ...this.transportLogSubject.value].slice(0, 50));
  }

  /** 记录带时间戳的分析事件，最多保留 50 条 */
  private appendAnalytics(event: string): void {
    this.analyticsSubject.next([`${new Date().toISOString()} ${event}`, ...this.analyticsSubject.value].slice(0, 50));
  }
}
