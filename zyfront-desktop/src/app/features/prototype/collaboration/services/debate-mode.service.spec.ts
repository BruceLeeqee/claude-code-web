import { TestBed } from '@angular/core/testing';
import { DebateModeService } from './debate-mode.service';

describe('DebateModeService', () => {
  let service: DebateModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DebateModeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have initial state', () => {
    const state = service.debateState();
    expect(state).toBeTruthy();
    expect(state.phase).toBe('preparation');
    expect(state.teams).toEqual([]);
  });

  it('should initialize debate', () => {
    const topic = '测试辩论主题';
    service.initializeDebate({ topic }, ['agent1'], ['agent2'], ['judge1']);
    expect(service.debateState().teams.length).toBe(2);
  });

  it('should transition phases', () => {
    service.initializeDebate({ topic: '测试主题' }, ['agent1'], ['agent2'], ['judge1']);
    service.nextPhase();
    expect(service.debateState().phase).toBe('opening');
  });
});
