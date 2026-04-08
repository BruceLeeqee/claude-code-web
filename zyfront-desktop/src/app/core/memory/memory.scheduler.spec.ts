import { MemorySchedulerService } from './memory.scheduler';
import { type TurnContext } from './memory.types';

describe('MemorySchedulerService', () => {
  const turn: TurnContext = {
    sessionId: 's1',
    turnId: 't1',
    timestamp: Date.now(),
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ],
  };

  it('runs extract/session/dream when all gates pass', async () => {
    const gates = {
      evaluateExtractGate: jasmine.createSpy().and.returnValue({ pipeline: 'extract', shouldRun: true, reason: 'passed' }),
      evaluateSessionGate: jasmine.createSpy().and.returnValue({ pipeline: 'session', shouldRun: true, reason: 'passed' }),
      evaluateDreamGate: jasmine.createSpy().and.returnValue({ pipeline: 'dream', shouldRun: true, reason: 'passed' }),
    } as any;

    const extractService = {
      run: jasmine.createSpy().and.resolveTo({ pipeline: 'extract', status: 'succeeded', reason: 'ok' }),
    } as any;
    const sessionMemoryService = {
      run: jasmine.createSpy().and.resolveTo({ pipeline: 'session', status: 'succeeded', reason: 'ok' }),
    } as any;
    const autoDreamService = {
      run: jasmine.createSpy().and.resolveTo({ pipeline: 'dream', status: 'succeeded', reason: 'ok' }),
    } as any;
    const telemetry = { track: jasmine.createSpy('track') } as any;

    const scheduler = new MemorySchedulerService(
      gates,
      extractService,
      sessionMemoryService,
      autoDreamService,
      telemetry,
    );

    const results = await scheduler.runOnTurnEnd(turn);

    expect(results.length).toBe(3);
    expect(extractService.run).toHaveBeenCalled();
    expect(sessionMemoryService.run).toHaveBeenCalled();
    expect(autoDreamService.run).toHaveBeenCalled();
    expect(telemetry.track).toHaveBeenCalledTimes(3);
  });

  it('skips pipelines when gates fail and returns skip reasons', async () => {
    const gates = {
      evaluateExtractGate: jasmine.createSpy().and.returnValue({ pipeline: 'extract', shouldRun: false, reason: 'extract_disabled' }),
      evaluateSessionGate: jasmine.createSpy().and.returnValue({ pipeline: 'session', shouldRun: false, reason: 'session_disabled' }),
      evaluateDreamGate: jasmine.createSpy().and.returnValue({ pipeline: 'dream', shouldRun: false, reason: 'dream_disabled' }),
    } as any;

    const extractService = { run: jasmine.createSpy() } as any;
    const sessionMemoryService = { run: jasmine.createSpy() } as any;
    const autoDreamService = { run: jasmine.createSpy() } as any;
    const telemetry = { track: jasmine.createSpy('track') } as any;

    const scheduler = new MemorySchedulerService(
      gates,
      extractService,
      sessionMemoryService,
      autoDreamService,
      telemetry,
    );

    const results = await scheduler.runOnTurnEnd(turn);

    expect(results).toEqual([
      { pipeline: 'extract', status: 'skipped', reason: 'extract_disabled' },
      { pipeline: 'session', status: 'skipped', reason: 'session_disabled' },
      { pipeline: 'dream', status: 'skipped', reason: 'dream_disabled' },
    ]);
    expect(extractService.run).not.toHaveBeenCalled();
    expect(sessionMemoryService.run).not.toHaveBeenCalled();
    expect(autoDreamService.run).not.toHaveBeenCalled();
    expect(telemetry.track).toHaveBeenCalledTimes(3);
  });
});
