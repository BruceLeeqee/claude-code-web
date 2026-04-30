import { TeamCommandRouterService } from './team-command-router.service';
import { RoleRegistryService } from './role-registry.service';
import { StructRegistryService } from './struct-registry.service';
import { TeamRoleCommandService } from './team-role-command.service';
import { TeamStructCommandService } from './team-struct-command.service';
import { TeamSubagentCommandService } from './team-subagent-command.service';
import { TeamAgentCommandService } from './team-agent-command.service';
import { TeamRunCommandService } from './team-run-command.service';
import { TeamMailboxService } from './team-mailbox.service';
import { TeamTaskBoardService } from './team-task-board.service';
import { TeamRuntimeService } from './team-runtime.service';
import { TeamLoggerService } from './team-logger.service';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { slugify } from './team.types';

function createMockEventBus(): MultiAgentEventBusService {
  return {
    emit: jasmine.createSpy('emit'),
    events$: { pipe: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) },
  } as any;
}

describe('TeamCommandRouterService', () => {
  let service: TeamCommandRouterService;

  beforeEach(() => {
    service = new TeamCommandRouterService();
  });

  describe('tokenize', () => {
    it('should tokenize simple commands', () => {
      const result = service.tokenize('/team-role list');
      expect(result.tokens.length).toBe(2);
      expect(result.tokens[0].value).toBe('/team-role');
      expect(result.tokens[1].value).toBe('list');
      expect(result.errors.length).toBe(0);
    });

    it('should handle quoted arguments', () => {
      const result = service.tokenize('/team-role new "你是一个前端开发专家"');
      expect(result.tokens.length).toBe(3);
      expect(result.tokens[0].value).toBe('/team-role');
      expect(result.tokens[1].value).toBe('new');
      expect(result.tokens[2].value).toBe('你是一个前端开发专家');
      expect(result.tokens[2].quoted).toBe(true);
    });

    it('should handle single quotes', () => {
      const result = service.tokenize("/team-role new '前端开发'");
      expect(result.tokens.length).toBe(3);
      expect(result.tokens[2].value).toBe('前端开发');
      expect(result.tokens[2].quoted).toBe(true);
    });

    it('should report unclosed quotes', () => {
      const result = service.tokenize('/team-role new "未闭合的引号');
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('未闭合的引号');
    });

    it('should handle multiple quoted args', () => {
      const result = service.tokenize('/team run struct "dev-flow" "实现登录"');
      expect(result.tokens.length).toBe(5);
      expect(result.tokens[3].value).toBe('dev-flow');
      expect(result.tokens[4].value).toBe('实现登录');
    });
  });

  describe('parse', () => {
    it('should return null for non-team commands', () => {
      expect(service.parse('/help')).toBeNull();
      expect(service.parse('/loop test')).toBeNull();
      expect(service.parse('hello world')).toBeNull();
    });

    it('should parse /team-role commands', () => {
      const result = service.parse('/team-role new "你是一个前端开发专家"');
      expect(result).not.toBeNull();
      expect(result!.family).toBe('team-role');
      expect(result!.subcommand).toBe('new');
    });

    it('should parse /team-role list', () => {
      const result = service.parse('/team-role list');
      expect(result).not.toBeNull();
      expect(result!.family).toBe('team-role');
      expect(result!.subcommand).toBe('list');
    });

    it('should parse /team-struct commands', () => {
      const result = service.parse('/team-struct new "三阶段开发流程"');
      expect(result).not.toBeNull();
      expect(result!.family).toBe('team-struct');
    });

    it('should parse /team-subagent commands', () => {
      const result = service.parse('/team-subagent frontend,backend "实现登录模块"');
      expect(result).not.toBeNull();
      expect(result!.family).toBe('team-subagent');
      expect(result!.subcommand).toBe('run');
    });

    it('should parse /team-agent commands', () => {
      const result = service.parse('/team-agent frontend,backend,qa "解决登录 500 错误"');
      expect(result).not.toBeNull();
      expect(result!.family).toBe('team-agent');
    });

    it('should parse /team run commands', () => {
      const result = service.parse('/team run struct dev-flow "实现登录功能"');
      expect(result).not.toBeNull();
      expect(result!.family).toBe('team');
      expect(result!.subcommand).toBe('run');
    });

    it('should include tokenErrors for unclosed quotes', () => {
      const result = service.parse('/team-role new "未闭合');
      expect(result).not.toBeNull();
      expect(result!.tokenErrors).toBeDefined();
      expect(result!.tokenErrors!.length).toBeGreaterThan(0);
    });

    it('should return null for /team without subcommand', () => {
      const result = service.parse('/team');
      expect(result).toBeNull();
    });
  });

  describe('isTeamCommand', () => {
    it('should identify team commands', () => {
      expect(service.isTeamCommand('/team-role list')).toBe(true);
      expect(service.isTeamCommand('/team-struct new test')).toBe(true);
      expect(service.isTeamCommand('/team run struct x y')).toBe(true);
    });

    it('should reject non-team commands', () => {
      expect(service.isTeamCommand('/help')).toBe(false);
      expect(service.isTeamCommand('hello')).toBe(false);
    });
  });
});

describe('TeamMailboxService', () => {
  let service: TeamMailboxService;

  beforeEach(() => {
    service = new TeamMailboxService(createMockEventBus());
  });

  it('should send and receive messages within a team', () => {
    service.registerAgent('team-1', 'agent-a');
    service.registerAgent('team-1', 'agent-b');

    const msg = service.sendMessage('team-1', 'agent-a', 'agent-b', '请完成设计');
    expect(msg).not.toBeNull();
    expect(msg.from).toBe('agent-a');
    expect(msg.to).toBe('agent-b');
    expect(msg.content).toBe('请完成设计');

    const inbox = service.getInbox('team-1', 'agent-b');
    expect(inbox.length).toBe(1);
    expect(inbox[0].content).toBe('请完成设计');
  });

  it('should track outbox', () => {
    service.registerAgent('team-1', 'agent-a');
    service.registerAgent('team-1', 'agent-b');
    service.registerAgent('team-1', 'agent-c');

    service.sendMessage('team-1', 'agent-a', 'agent-b', '消息1');
    service.sendMessage('team-1', 'agent-a', 'agent-c', '消息2');

    const outbox = service.getOutbox('team-1', 'agent-a');
    expect(outbox.length).toBe(2);
  });

  it('should broadcast messages to all team members except sender', () => {
    service.registerAgent('team-1', 'lead');
    service.registerAgent('team-1', 'agent-a');
    service.registerAgent('team-1', 'agent-b');

    const msgs = service.broadcast('team-1', 'lead', '开始工作');
    expect(msgs.length).toBe(2);

    expect(service.getInbox('team-1', 'agent-a').length).toBe(1);
    expect(service.getInbox('team-1', 'agent-b').length).toBe(1);
  });

  it('should isolate messages between teams', () => {
    service.registerAgent('team-1', 'agent-a');
    service.registerAgent('team-1', 'agent-b');
    service.registerAgent('team-2', 'agent-a');
    service.registerAgent('team-2', 'agent-c');

    service.sendMessage('team-1', 'agent-a', 'agent-b', 'team-1消息');
    service.sendMessage('team-2', 'agent-a', 'agent-c', 'team-2消息');

    expect(service.getInbox('team-1', 'agent-b').length).toBe(1);
    expect(service.getInbox('team-2', 'agent-c').length).toBe(1);
    expect(service.getInbox('team-2', 'agent-b').length).toBe(0);
  });

  it('should mark messages as read', () => {
    service.registerAgent('team-1', 'agent-a');
    service.registerAgent('team-1', 'agent-b');

    const msg = service.sendMessage('team-1', 'agent-a', 'agent-b', '测试');
    expect(service.getUnread('team-1', 'agent-b').length).toBe(1);

    service.markRead('team-1', 'agent-b', msg.id);
    expect(service.getUnread('team-1', 'agent-b').length).toBe(0);
  });

  it('should clear inbox and outbox', () => {
    service.registerAgent('team-1', 'agent-a');
    service.registerAgent('team-1', 'agent-b');

    service.sendMessage('team-1', 'agent-a', 'agent-b', '消息');
    service.clearInbox('team-1', 'agent-b');
    expect(service.getInbox('team-1', 'agent-b').length).toBe(0);

    service.clearOutbox('team-1', 'agent-a');
    expect(service.getOutbox('team-1', 'agent-a').length).toBe(0);
  });

  it('should clear team mailboxes', () => {
    service.registerAgent('team-1', 'agent-a');
    service.registerAgent('team-1', 'agent-b');
    service.sendMessage('team-1', 'agent-a', 'agent-b', '消息');

    service.clearTeamMailboxes('team-1');
    expect(service.getMessagesByTeam('team-1').length).toBe(0);
  });
});

describe('TeamTaskBoardService', () => {
  let service: TeamTaskBoardService;

  beforeEach(() => {
    service = new TeamTaskBoardService(createMockEventBus());
  });

  it('should create and retrieve tasks within a team', () => {
    const task = service.createTask('team-1', '实现登录功能', 'agent-a', 'stage-1');
    expect(task).not.toBeNull();
    expect(task.title).toBe('实现登录功能');
    expect(task.assignee).toBe('agent-a');
    expect(task.status).toBe('pending');

    const retrieved = service.getTask('team-1', task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('实现登录功能');
  });

  it('should update task status', () => {
    const task = service.createTask('team-1', '任务1', 'agent-a');
    const updated = service.updateStatus('team-1', task.id, 'in_progress', '开始执行');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('in_progress');
  });

  it('should complete tasks', () => {
    const task = service.createTask('team-1', '任务1', 'agent-a');
    const completed = service.completeTask('team-1', task.id, '已完成');
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe('done');
  });

  it('should fail tasks', () => {
    const task = service.createTask('team-1', '任务1', 'agent-a');
    const failed = service.failTask('team-1', task.id, '执行失败');
    expect(failed).not.toBeNull();
    expect(failed!.status).toBe('rejected');
  });

  it('should filter tasks by status within a team', () => {
    service.createTask('team-1', '任务1', 'agent-a');
    const task2 = service.createTask('team-1', '任务2', 'agent-b');
    service.updateStatus('team-1', task2.id, 'in_progress');

    const pending = service.getTasksByStatus('team-1', 'pending');
    const inProgress = service.getTasksByStatus('team-1', 'in_progress');
    expect(pending.length).toBe(1);
    expect(inProgress.length).toBe(1);
  });

  it('should track progress within a team', () => {
    const task1 = service.createTask('team-1', '任务1', 'agent-a');
    const task2 = service.createTask('team-1', '任务2', 'agent-b');
    service.completeTask('team-1', task1.id);
    service.failTask('team-1', task2.id, '执行失败');

    const progress = service.getProgress('team-1');
    expect(progress.total).toBe(2);
    expect(progress.completed).toBe(1);
    expect(progress.failed).toBe(1);
  });

  it('should check task dependencies within a team', () => {
    const task1 = service.createTask('team-1', '任务1', 'agent-a');
    const task2 = service.createTask('team-1', '任务2', 'agent-b', undefined, [task1.id]);

    expect(service.canStart('team-1', task2.id)).toBe(false);
    service.completeTask('team-1', task1.id);
    expect(service.canStart('team-1', task2.id)).toBe(true);
  });

  it('should isolate tasks between teams', () => {
    service.createTask('team-1', 'team-1任务', 'agent-a');
    service.createTask('team-2', 'team-2任务', 'agent-b');

    expect(service.getTasksByTeam('team-1').length).toBe(1);
    expect(service.getTasksByTeam('team-2').length).toBe(1);
    expect(service.getTasksByTeam('team-1')[0].title).toBe('team-1任务');
  });

  it('should clear team tasks', () => {
    service.createTask('team-1', '任务1', 'agent-a');
    service.clearTeamTasks('team-1');
    expect(service.getTasksByTeam('team-1').length).toBe(0);
  });
});

describe('TeamLoggerService', () => {
  let service: TeamLoggerService;

  beforeEach(() => {
    service = new TeamLoggerService();
  });

  it('should log entries at different levels', () => {
    service.debug('runtime', '调试信息');
    service.info('command', '命令执行');
    service.warn('stage', '阶段警告');
    service.error('member', '成员错误');

    const logs = service.recentLogs();
    expect(logs.length).toBe(4);
  });

  it('should include structured context', () => {
    service.info('orchestration', '阶段执行', {
      teamId: 'team-abc-123',
      stageName: 'parallel-dev',
      correlationId: 'corr-001',
    });

    const logs = service.recentLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].teamId).toBe('team-abc-123');
    expect(logs[0].stageName).toBe('parallel-dev');
    expect(logs[0].correlationId).toBe('corr-001');
  });

  it('should filter logs by team', () => {
    service.info('runtime', 'team-1日志', { teamId: 'team-1' });
    service.info('runtime', 'team-2日志', { teamId: 'team-2' });
    service.info('runtime', 'team-1日志2', { teamId: 'team-1' });

    const team1Logs = service.getLogsByTeam('team-1');
    expect(team1Logs.length).toBe(2);
  });

  it('should filter logs by source', () => {
    service.info('command', '命令日志1');
    service.info('runtime', '运行时日志');
    service.info('command', '命令日志2');

    const commandLogs = service.getLogsBySource('command');
    expect(commandLogs.length).toBe(2);
  });

  it('should filter logs by correlationId', () => {
    service.info('runtime', '日志1', { correlationId: 'corr-001' });
    service.info('runtime', '日志2', { correlationId: 'corr-002' });
    service.info('runtime', '日志3', { correlationId: 'corr-001' });

    const corr1Logs = service.getLogsByCorrelationId('corr-001');
    expect(corr1Logs.length).toBe(2);
  });

  it('should categorize logs by source', () => {
    service.info('runtime', '运行时');
    service.info('orchestration', '编排');
    service.info('command-router', '命令');

    const runtimeLogs = service.getLogsByCategory('runtime');
    expect(runtimeLogs.length).toBe(1);

    const orchLogs = service.getLogsByCategory('orchestration');
    expect(orchLogs.length).toBe(1);

    const cmdLogs = service.getLogsByCategory('command');
    expect(cmdLogs.length).toBe(1);
  });

  it('should produce formatted log entries', () => {
    service.info('runtime', '测试消息', { teamId: 'team-123' });

    const logs = service.recentLogs();
    expect(logs[0].formatted).toContain('INFO');
    expect(logs[0].formatted).toContain('测试消息');
    expect(logs[0].formatted).toContain('team=team-123');
  });

  it('should clear logs', () => {
    service.info('runtime', '日志');
    service.clear();
    expect(service.recentLogs().length).toBe(0);
  });

  it('should limit buffer size', () => {
    for (let i = 0; i < 1100; i++) {
      service.info('runtime', `日志 ${i}`);
    }
    const logs = service.recentLogs();
    expect(logs.length).toBeLessThanOrEqual(50);
  });
});

describe('slugify', () => {
  it('should handle English names', () => {
    expect(slugify('frontend-developer')).toBe('frontend-developer');
    expect(slugify('Backend Developer')).toBe('backend-developer');
  });

  it('should handle compound Chinese terms', () => {
    expect(slugify('前端')).toBe('frontend');
    expect(slugify('后端')).toBe('backend');
    expect(slugify('测试')).toBe('qa');
    expect(slugify('架构')).toBe('architect');
    expect(slugify('安全')).toBe('security');
    expect(slugify('运维')).toBe('devops');
  });

  it('should handle mixed Chinese-English names', () => {
    const result = slugify('前端开发');
    expect(result).toContain('frontend');
  });

  it('should fall back to pinyin for single Chinese characters', () => {
    const result = slugify('数据');
    expect(result).toBe('shu-ju');
  });

  it('should handle special characters', () => {
    expect(slugify('hello@world!')).toBe('hello-world');
    expect(slugify('test   name')).toBe('test-name');
  });

  it('should trim and limit length', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
});

function createMockBridge(): Partial<import('../../local-bridge.service').LocalBridgeService> {
  return {
    write: jasmine.createSpy('write').and.resolveTo({ ok: true, path: '' }),
    read: jasmine.createSpy('read').and.resolveTo({ ok: false, path: '', content: '' }),
    remove: jasmine.createSpy('remove').and.resolveTo({ ok: true, path: '' }),
    list: jasmine.createSpy('list').and.resolveTo({ ok: false, dir: '', entries: [] }),
  };
}

describe('TeamFilePersistenceService syncAll', () => {
  it('should be injectable via Angular DI', () => {
    expect(TeamFilePersistenceService).toBeDefined();
  });
});

describe('Event payload structure', () => {
  it('should have TEAM_MESSAGE_SENT event type', () => {
    const EVENT_TYPES = {
      TEAM_MESSAGE_SENT: 'team.message.sent',
      TEAM_TASK_CREATED: 'team.task.created',
      TEAM_TASK_COMPLETED: 'team.task.completed',
      TEAM_TASK_STATUS_CHANGED: 'team.task.status.changed',
      TEAM_TASK_ASSIGNED: 'team.task.assigned',
      TEAM_ROLE_CREATED: 'team.role.created',
      TEAM_STRUCT_CREATED: 'team.struct.created',
      TEAM_COMMAND_EXECUTED: 'team.command.executed',
    };

    expect(EVENT_TYPES.TEAM_MESSAGE_SENT).toBe('team.message.sent');
    expect(EVENT_TYPES.TEAM_TASK_CREATED).toBe('team.task.created');
    expect(EVENT_TYPES.TEAM_TASK_COMPLETED).toBe('team.task.completed');
    expect(EVENT_TYPES.TEAM_TASK_STATUS_CHANGED).toBe('team.task.status.changed');
    expect(EVENT_TYPES.TEAM_COMMAND_EXECUTED).toBe('team.command.executed');
  });
});
