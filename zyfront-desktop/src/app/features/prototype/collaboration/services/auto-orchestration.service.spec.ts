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
    expect(plan.goalType).toBeTruthy();
  });

  it('should generate teams', () => {
    const team = service.generateTeam('collaboration');
    expect(team).toBeTruthy();
    expect(team.agents.length).toBeGreaterThan(0);
  });

  it('should split tasks', () => {
    const testAgents = [
      { id: 'agent1', name: 'Agent1', role: 'developer' },
      { id: 'agent2', name: 'Agent2', role: 'tester' },
    ];
    const tasks = service.splitTasks('测试任务', testAgents as any);
    expect(tasks.length).toBeGreaterThan(0);
  });
});
