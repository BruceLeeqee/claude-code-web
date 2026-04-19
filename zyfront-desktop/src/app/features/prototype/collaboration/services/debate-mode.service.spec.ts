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
    const state = service.state();
    expect(state).toBeTruthy();
    expect(state.phase).toBe('idle');
    expect(state.teams).toEqual([]);
  });

  it('should initialize debate', () => {
    const topic = '测试辩论主题';
    service.initializeDebate(topic);
    expect(service.state().topic).toBe(topic);
    expect(service.state().phase).toBe('preparation');
  });

  it('should transition phases', () => {
    service.initializeDebate('测试主题');
    service.nextPhase();
    expect(service.state().phase).toBe('opening_statements');
  });
});
