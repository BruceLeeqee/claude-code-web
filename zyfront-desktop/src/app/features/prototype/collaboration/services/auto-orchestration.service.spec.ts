import { TestBed } from '@angular/core/testing';
import { AutoOrchestrationService } from './auto-orchestration.service';

describe('AutoOrchestrationService', () => {
  let service: AutoOrchestrationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AutoOrchestrationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should analyze goals', () => {
    const plan = service.analyzeGoal('开发一个Web应用');
    expect(plan).toBeTruthy();
    expect(plan.type).toBeTruthy();
  });

  it('should generate teams', () => {
    const analysis = service.analyzeGoal('协作开发一个Web应用');
    const team = service.generateTeam(analysis);
    expect(team).toBeTruthy();
    expect(team.length).toBeGreaterThan(0);
  });

  it('should split tasks', () => {
    const testAgents = [
      { id: 'agent1', name: 'Agent1', role: 'developer', skills: [], strategy: 'balanced' },
      { id: 'agent2', name: 'Agent2', role: 'tester', skills: [], strategy: 'balanced' },
    ];
    const tasks = service.splitTasks('测试任务', testAgents as any, 'medium');
    expect(tasks.length).toBeGreaterThan(0);
  });
});
