import { AutoDreamService } from './auto-dream.service';
import { type TurnContext } from '../memory.types';

describe('AutoDreamService', () => {
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

  it('should skip when session threshold is not met', async () => {
    const fs = createFsMock();
    (window as any).zytrader = { fs };

    const directoryManager = {
      ensureVaultReady: jasmine.createSpy('ensureVaultReady').and.resolveTo(),
      getRelativePathByKey: jasmine.createSpy('getRelativePathByKey').and.resolveTo('02-AGENT-MEMORY/02-Long-User'),
    } as any;
    const configService = {
      getConfig: () => ({
        enabled: true,
        memoryRootKey: 'agent-memory-root',
        extract: { enabled: true, everyNTurns: 1, maxTurns: 5 },
        session: { enabled: true, minTokenDelta: 8000, minToolCalls: 8 },
        dream: { enabled: true, minHours: 1, minSessions: 3 },
      }),
    } as any;
    const telemetry = { track: jasmine.createSpy('track') } as any;
    const teamSync = { notifyWrite: jasmine.createSpy('notifyWrite') } as any;

    const service = new AutoDreamService(directoryManager, configService, telemetry, teamSync);

    const turn: TurnContext = {
      sessionId: 'single-session',
      turnId: 't1',
      timestamp: Date.now(),
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    };

    const result = await service.run(turn);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('session_threshold_not_met');
    expect(fs.write).not.toHaveBeenCalled();
    expect(teamSync.notifyWrite).not.toHaveBeenCalled();
  });
});
