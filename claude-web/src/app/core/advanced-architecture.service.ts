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

  async connectTransport(): Promise<void> {
    await this.transport.connect();
    this.appendTransportLog('Transport connected (simulated)');
  }

  async disconnectTransport(): Promise<void> {
    await this.transport.disconnect();
    this.appendTransportLog('Transport disconnected');
  }

  async sendTransportMessage(type: string, payload: unknown): Promise<void> {
    await this.transport.send(type, payload);
    this.appendAnalytics(`transport.send:${type}`);
  }

  startListening(): void {
    this.voice.startListening();
    this.voiceStateSubject.next(this.voice.getState());
  }

  startSpeaking(): void {
    this.voice.startSpeaking();
    this.voiceStateSubject.next(this.voice.getState());
  }

  stopVoice(): void {
    this.voice.stop();
    this.voiceStateSubject.next(this.voice.getState());
  }

  sendVimKey(key: string): void {
    this.vimStateSubject.next(this.vim.handle({ key }));
  }

  writeFile(path: string, content: string): void {
    this.memfs.write(path, content);
    this.memFilesSubject.next(this.memfs.snapshot());
    this.appendAnalytics(`memfs.write:${path}`);
  }

  removeFile(path: string): void {
    this.memfs.remove(path);
    this.memFilesSubject.next(this.memfs.snapshot());
    this.appendAnalytics(`memfs.remove:${path}`);
  }

  evaluateFeature(plan: 'free' | 'pro'): boolean {
    this.growthbook.setAttributes({ plan });
    return Boolean(this.growthbook.evaluate<boolean>('new-settings-ui'));
  }

  encodeBase64(v: string): string {
    return toBase64(v);
  }

  decodeBase64(v: string): string {
    return fromBase64(v);
  }

  private appendTransportLog(line: string): void {
    this.transportLogSubject.next([line, ...this.transportLogSubject.value].slice(0, 50));
  }

  private appendAnalytics(event: string): void {
    this.analyticsSubject.next([`${new Date().toISOString()} ${event}`, ...this.analyticsSubject.value].slice(0, 50));
  }
}
