import { CommandRouterService, type RouteResult } from './command-router.service';
import { parseDirectiveWithValidation, parseSlashCommand, formatGroupedHelp, getCommandSuggestions } from './directive-parser';
import { InputPreprocessorService, type PreprocessedInput } from './input-preprocessor.service';
import { CommandExecutorService } from './command-executor.service';
import { LoopCommandService } from './debug/loop-command.service';
import { parseLoopCommand } from './debug/loop-command-parser';

interface TestCase {
  input: string;
  expectedRoute: 'directive' | 'shell' | 'natural';
  description: string;
}

interface DirectiveTestCase {
  input: string;
  shouldSucceed: boolean;
  expectedCommand?: string;
  expectedArgs?: string;
  description: string;
}

describe('CommandRouterService', () => {
  let service: CommandRouterService;

  beforeEach(() => {
    service = new CommandRouterService();
  });

  describe('Basic Routing', () => {
    const testCases: TestCase[] = [
      { input: '/help', expectedRoute: 'directive', description: 'Slash command' },
      { input: '/mode-solo', expectedRoute: 'directive', description: 'Mode command' },
      { input: '/loop build the workbench loop', expectedRoute: 'directive', description: 'Loop command' },
      { input: '/task team=dev objective=实现登录页', expectedRoute: 'directive', description: 'Task dispatch command' },
      { input: '/plugin:list', expectedRoute: 'directive', description: 'Plugin command with colon' },
      { input: '!ls -la', expectedRoute: 'shell', description: 'Exclamation prefix forces shell' },
      { input: '?What is the weather', expectedRoute: 'natural', description: 'Question mark prefix forces natural' },
      { input: '帮我写一个函数', expectedRoute: 'natural', description: 'Chinese input routes to natural' },
      { input: 'how do I install npm', expectedRoute: 'natural', description: 'Question words route to natural' },
      { input: 'git commit -m "fix"', expectedRoute: 'shell', description: 'Git command routes to shell' },
      { input: '/unknowncmd', expectedRoute: 'directive', description: 'Unknown slash still routes to directive' },
    ];

    testCases.forEach(({ input, expectedRoute, description }) => {
      it(`should route "${description}" correctly`, () => {
        const result = service.route(input);
        expect(result).toBe(expectedRoute);
      });
    });
  });

  describe('Route Explanation', () => {
    it('should provide confidence scores', () => {
      const result = service.routeWithExplanation('/help');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('should suggest fallback for ambiguous inputs', () => {
      const result = service.routeWithExplanation('git status');
      if (result.route === 'shell' && result.confidence < 0.9) {
        expect(result.suggestedFallback).toBeDefined();
      }
    });
  });

  describe('Shell Detection', () => {
    const shellInputs = [
      'ls -la',
      'cd /home',
      'git status',
      'npm install',
      'docker ps',
      'cat /etc/passwd',
      'grep -r "pattern" .',
      './script.sh',
      'C:\\Users\\file.txt',
      'echo $PATH',
      'cmd /c dir',
      'ps aux | grep node',
    ];

    shellInputs.forEach(input => {
      it(`should route "${input}" as shell`, () => {
        const result = service.route(input);
        expect(result).toBe('shell');
      });
    });
  });

  describe('Natural Language Detection', () => {
    const naturalInputs = [
      '帮我分析这个代码',
      '请解释什么是闭包',
      'how do I become a better programmer',
      'what is the meaning of life',
      'Can you help me fix this bug please',
      '请帮我写一段 Python 代码',
      '我想学习机器学习',
      '为什么天是蓝色的',
    ];

    naturalInputs.forEach(input => {
      it(`should route "${input}" as natural`, () => {
        const result = service.route(input);
        expect(result).toBe('natural');
      });
    });
  });
});

describe('InputPreprocessorService', () => {
  let service: InputPreprocessorService;

  beforeEach(() => {
    service = new InputPreprocessorService();
  });

  describe('Basic Preprocessing', () => {
    it('should normalize input by trimming', () => {
      const result = service.preprocess('  /help  ');
      expect(result.normalized).toBe('/help');
    });

    it('should detect user source by default', () => {
      const result = service.preprocess('/help');
      expect(result.source).toBe('user');
    });

    it('should mark slash commands for bridge source', () => {
      const result = service.preprocess('/help', { source: 'bridge' });
      expect(result.shouldSkipSlashCommands).toBe(true);
    });

    it('should allow bridge-safe commands', () => {
      const result = service.preprocess('/help', {
        source: 'bridge',
        allowBridgeSlashCommands: true,
      });
      expect(result.shouldSkipSlashCommands).toBe(false);
    });
  });

  describe('Bridge Safety', () => {
    it('should identify bridge-safe directives', () => {
      expect(service.isBridgeSafeDirective('/help')).toBe(true);
      expect(service.isBridgeSafeDirective('/status')).toBe(true);
      expect(service.isBridgeSafeDirective('/doctor')).toBe(true);
      expect(service.isBridgeSafeDirective('/mode-dev')).toBe(false);
    });

    it('should block non-safe bridge commands', () => {
      expect(service.shouldBlockBridgeCommand('/mode-dev')).toBe(true);
      expect(service.shouldBlockBridgeCommand('/help')).toBe(false);
    });
  });

  describe('Input Sanitization', () => {
    it('should remove bridge markers', () => {
      const result = service.sanitizeBridgeInput('[bridge] /help');
      expect(result.wasModified).toBe(true);
      expect(result.sanitized).toBe('/help');
    });

    it('should handle multiple markers', () => {
      const result = service.sanitizeBridgeInput('[bridge] [remote] /help');
      expect(result.sanitized).toBe('/help');
    });
  });
});

describe('DirectiveRegistry and Parser', () => {
  describe('parseDirective', () => {
    const testCases: DirectiveTestCase[] = [
      {
        input: '/help',
        shouldSucceed: true,
        expectedCommand: '/help',
        description: 'Simple help command',
      },
      {
        input: '/mode-solo',
        shouldSucceed: true,
        expectedCommand: '/mode-solo',
        description: 'Mode command',
      },
      {
        input: '/plugin:list arg1 arg2',
        shouldSucceed: true,
        expectedCommand: '/plugin:list',
        expectedArgs: 'arg1 arg2',
        description: 'Command with arguments',
      },
      {
        input: '/task team=dev objective=实现登录页',
        shouldSucceed: true,
        expectedCommand: '/task',
        expectedArgs: 'team=dev objective=实现登录页',
        description: 'Task command with routing args',
      },
      {
        input: '/unknowncmd',
        shouldSucceed: false,
        description: 'Unknown command should fail',
      },
      {
        input: 'not a command',
        shouldSucceed: false,
        description: 'Non-command input',
      },
    ];

    testCases.forEach(({ input, shouldSucceed, expectedCommand, expectedArgs, description }) => {
      it(`should parse "${description}"`, () => {
        const result = parseSlashCommand(input);
        
        if (!shouldSucceed && !input.trim().startsWith('/')) {
          expect(result).toBeNull();
          return;
        }

        if (!result) {
          if (!shouldSucceed) {
            expect(result).toBeNull();
            return;
          }
          fail('Expected parseSlashCommand to return a result');
          return;
        }

        expect(result.raw).toBe(input.trim());

        if (shouldSucceed) {
          expect(result.def).not.toBeNull();
          if (expectedCommand !== undefined) {
            expect(result.name).toBe(expectedCommand);
          }
          if (expectedArgs !== undefined) {
            expect(result.args).toBe(expectedArgs);
          }
        } else {
          expect(result.def).toBeNull();
        }
      });
    });
  });

  describe('parseDirectiveWithValidation', () => {
    it('should validate required args', () => {
      const result = parseDirectiveWithValidation('/plugin:run');
      expect(result.success).toBe(false);
      expect(result.shouldFallbackToNatural).toBe(false);
    });

    it('should handle skip unknown commands', () => {
      const result = parseDirectiveWithValidation('/unknowncmd', {
        skipUnknownCommands: true,
      });
      expect(result.success).toBe(false);
      expect(result.shouldFallbackToNatural).toBe(true);
    });
  });

  describe('Command Suggestions', () => {
    it('should suggest commands for partial input', () => {
      const suggestions = getCommandSuggestions('mod');
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(d => d.name.includes('mode'))).toBe(true);
    });
  });
});

describe('CommandExecutorService', () => {
  let service: CommandExecutorService;

  beforeEach(() => {
    service = new CommandExecutorService();
  });

  describe('Help Command', () => {
    it('should execute help command', async () => {
      const result = await service.execute({
        raw: '/help',
        context: { source: 'user' },
      });
      expect(result.success).toBe(true);
      expect(result.responseType).toBe('directive');
      expect(result.content).toContain('可用命令');
    });
  });

  describe('Status Command', () => {
    it('should execute status command', async () => {
      const result = await service.execute({
        raw: '/status',
        context: { source: 'user' },
      });
      expect(result.success).toBe(true);
      expect(result.content).toContain('当前状态');
    });
  });

  describe('Doctor Command', () => {
    it('should execute doctor command', async () => {
      const result = await service.execute({
        raw: '/doctor',
        context: { source: 'user' },
      });
      expect(result.success).toBe(true);
      expect(result.content).toContain('工具健康度');
    });
  });

  describe('Natural Language Fallback', () => {
    it('should pass through natural language', async () => {
      const result = await service.execute({
        raw: '帮我写一个函数',
        context: { source: 'user' },
      });
      expect(result.success).toBe(true);
      expect(result.shouldQuery).toBe(true);
    });
  });

  describe('Shell Fallback', () => {
    it('should pass through shell commands', async () => {
      const result = await service.execute({
        raw: 'ls -la',
        context: { source: 'user' },
      });
      expect(result.success).toBe(true);
      expect(result.shouldQuery).toBe(true);
    });
  });
});

describe('Integration', () => {
  let router: CommandRouterService;
  let preprocessor: InputPreprocessorService;
  let executor: CommandExecutorService;

  beforeEach(() => {
    router = new CommandRouterService();
    preprocessor = new InputPreprocessorService();
    executor = new CommandExecutorService();
  });

  describe('Full Processing Pipeline', () => {
    it('should process directive end-to-end', async () => {
      const input = '/help';

      const preprocessed = preprocessor.preprocess(input);
      expect(preprocessed.source).toBe('user');

      const routeResult = router.routeWithExplanation(preprocessed.normalized);
      expect(routeResult.route).toBe('directive');

      const execResult = await executor.execute({
        raw: preprocessed.normalized,
        context: { source: preprocessed.source === 'unknown' ? 'user' : preprocessed.source },
      });
      expect(execResult.success).toBe(true);
    });

    it('should process natural language end-to-end', async () => {
      const input = '请帮我分析代码';

      const preprocessed = preprocessor.preprocess(input);
      const routeResult = router.routeWithExplanation(preprocessed.normalized);
      expect(routeResult.route).toBe('natural');

      const execResult = await executor.execute({
        raw: preprocessed.normalized,
        context: { source: preprocessed.source === 'unknown' ? 'user' : preprocessed.source },
      });
      expect(execResult.shouldQuery).toBe(true);
    });

    it('should protect bridge sources from unsafe commands', async () => {
      const input = '/mode-dev';

      const preprocessed = preprocessor.preprocess(input, { source: 'bridge' });
      expect(preprocessed.shouldSkipSlashCommands).toBe(true);

      const execResult = await executor.execute({
        raw: preprocessed.normalized,
        context: { source: 'bridge' },
      });
      expect(execResult.success).toBe(false);
      expect(execResult.content).toContain('Remote Control');
    });
  });
});

describe('Loop Command Parser', () => {
  it('should parse schedule interval from --every', () => {
    const parsed = parseLoopCommand('/loop 修复回归测试 --every=15s');
    expect(parsed).not.toBeNull();
    expect(parsed?.objective).toBe('修复回归测试');
    expect(parsed?.scheduleEveryMs).toBe(15_000);
  });

  it('should parse max iterations and keep objective clean', () => {
    const parsed = parseLoopCommand('/loop 优化工作流 --max-iterations=8 --every=1m');
    expect(parsed).not.toBeNull();
    expect(parsed?.objective).toBe('优化工作流');
    expect(parsed?.maxIterations).toBe(8);
    expect(parsed?.scheduleEveryMs).toBe(60_000);
  });

  it('should parse team and task type flags', () => {
    const parsed = parseLoopCommand('/loop 实现登录页 --team=dev --task-type=development');
    expect(parsed).not.toBeNull();
    expect(parsed?.objective).toBe('实现登录页');
    expect(parsed?.teamName).toBe('dev');
    expect(parsed?.taskType).toBe('development');
  });
});
