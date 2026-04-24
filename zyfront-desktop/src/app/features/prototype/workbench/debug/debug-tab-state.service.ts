import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DebugTabStateService {
  private readonly activeByDomain = new Map<string, string>();
  private readonly pinnedSessions = new Map<string, string>();

  getTabKey(domain: string): string {
    return `Debug / ${this.titleFor(domain)}`;
  }

  setActive(domain: string, sessionId: string): void {
    this.activeByDomain.set(domain, sessionId);
  }

  getActiveSession(domain: string): string | undefined {
    return this.activeByDomain.get(domain);
  }

  pinSession(domain: string, sessionId: string): void {
    this.pinnedSessions.set(domain, sessionId);
  }

  getPinnedSession(domain: string): string | undefined {
    return this.pinnedSessions.get(domain);
  }

  private titleFor(domain: string): string {
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  }
}
