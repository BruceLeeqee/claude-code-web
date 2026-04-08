import { ExtractService } from './extract.service';
import { type TurnContext } from '../memory.types';

describe('ExtractService', () => {
  function createFsMock() {
    const store = new Map<string, string>();
    return {
      store,
      read: jasmine.createSpy('read').and.callFake(async (path: string) => {
        if (store.has(path)) {
          return { ok: true, content: store.get(path)! };
        }
        return { ok: false, error: 'not_found' };
      }),
      write: jasmine.createSpy('write').and.callFake(async (path: string, content: string) => {
        store.set(path, content);
        return { ok: true, path };
      }),
    };
  }

  it('should write extract memory and MEMORY.md index', async () => {
    const fs = createFsMock();
    (window as any).zytrader = { fs };

    const configService = {
      getConfig: () => ({
        enabled: true,
        memoryRootKey: 'agent-memory-root',
        extract: { enabled: true, everyNTurns: 1, maxTurns: 5 },
        session: { enabled: false, minTokenDelta: 8000, minToolCalls: 8 },
        dream: { enabled: false, minHours: 6, minSessions: 3 },
      }),
    } as any;
    const telemetry = { track: jasmine.createSpy('track') } as any;
    const directoryManager = {
      ensureVaultReady: jasmine.createSpy('ensureVaultReady').and.resolveTo(),
      getRelativePathByKey: jasmine.createSpy('getRelativePathByKey').and.resolveTo('02-AGENT-MEMORY/02-Long-Term'),
    } as any;
    const teamSync = { notifyWrite: jasmine.createSpy('notifyWrite') } as any;

    const service = new ExtractService(configService, telemetry, directoryManager, teamSync);

    const turn: TurnContext = {
      sessionId: 's1',
      turnId: 't1',
      timestamp: Date.now(),
      messages: [
        { id: 'm1', role: 'user', content: '用户问了目录结构' },
        { id: 'm2', role: 'assistant', content: '我回答了目录结构信息' },
      ],
    };

    const result = await service.run(turn);

    expect(result.status).toBe('succeeded');
    expect(result.filesTouched?.length).toBe(2);
    expect(teamSync.notifyWrite).toHaveBeenCalled();

    const writes = fs.write.calls.allArgs().map((a) => a[0] as string);
    expect(writes.some((p) => p.endsWith('.json'))).toBeTrue();
    expect(writes.some((p) => p.endsWith('MEMORY.md'))).toBeTrue();
  });
});
