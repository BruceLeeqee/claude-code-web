import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import type { MultiAgentEvent, MultiAgentEventEnvelope, MultiAgentEventMap, MultiAgentEventSource } from './multi-agent.events';

@Injectable({ providedIn: 'root' })
export class MultiAgentEventBusService {
  private readonly subject = new Subject<MultiAgentEvent>();
  readonly events$ = this.subject.asObservable();

  emit<K extends keyof MultiAgentEventMap>(
    event: {
      type: K;
      sessionId: string;
      requestId?: string;
      source?: MultiAgentEventSource;
      ts?: number;
      payload: MultiAgentEventMap[K];
    },
  ): MultiAgentEvent<K> {
    const envelope: MultiAgentEventEnvelope<K, MultiAgentEventMap[K]> = {
      type: event.type,
      sessionId: event.sessionId,
      requestId: event.requestId,
      source: event.source ?? 'system',
      ts: event.ts ?? Date.now(),
      payload: event.payload,
    };
    this.subject.next(envelope as unknown as MultiAgentEvent);
    return envelope as unknown as MultiAgentEvent<K>;
  }
}
