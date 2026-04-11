import { SessionMemoryService } from './session-memory.service';
import { type TurnContext } from '../memory.types';

describe('SessionMemoryService', () => {
  function createFsMock() {
    const store = new Map<string, string>();
    return {
      store,
      read: jasmine.createSpy('read').and.callFake(async (path: string) => {
        if (store.has(path)) return { ok: true, content: store.get(path)! };
        return { ok: false, error: 'not_found' };
      }),
      write: jasmine.createSpy('write').and.callFake(async (path: string, content: string) => {
        store.set(path, content);
        return { ok: true, path };
      }),
    };
  }

  it('should append session memory content on repeated runs', async () => {
    const fs = createFsMock();
    (window as any).zytrader = { fs };

    const directoryManager = {
      ensureVaultReady: jasmine.createSpy('ensureVaultReady').and.resolveTo(),
      getRelativePathByKey: jasmine.createSpy('getRelativePathByKey').and.resolveTo('02-AGENT-MEMORY/06-Context'),
    } as any;
    const telemetry = { track: jasmine.createSpy('track') } as any;
    const teamSync = { notifyWrite: jasmine.createSpy('notifyWrite') } as any;

    const service = new SessionMemoryService(directoryManager, telemetry, teamSync);

    const turn1: TurnContext = {
      sessionId: 's1',
      turnId: 't1',
      timestamp: Date.now(),
      messages: [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
      ],
    };
    const turn2: TurnContext = {
      sessionId: 's1',
      turnId: 't2',
      timestamp: Date.now() + 1000,
      messages: [
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
      ],
    };

    const r1 = await service.run(turn1);
    const r2 = await service.run(turn2);

    expect(r1.status).toBe('succeeded');
    expect(r2.status).toBe('succeeded');
    expect(teamSync.notifyWrite).toHaveBeenCalledTimes(2);

    const path = '02-AGENT-MEMORY/06-Context/sessions/s1.md';
    const content = fs.store.get(path) ?? '';
    expect(content).toContain('t1');
    expect(content).toContain('t2');
  });
});
