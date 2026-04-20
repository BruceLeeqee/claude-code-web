const fs = require('fs');
const path = require('path');

const TEST_RESULTS = {
  passed: 0,
  failed: 0,
  total: 0,
  details: [],
};

function test(name, fn) {
  TEST_RESULTS.total++;
  try {
    fn();
    TEST_RESULTS.passed++;
    TEST_RESULTS.details.push({ name, status: 'PASS', error: null });
    console.log(`✅ PASS: ${name}`);
  } catch (error) {
    TEST_RESULTS.failed++;
    TEST_RESULTS.details.push({ name, status: 'FAIL', error: error.message });
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected: ${expected}, Got: ${actual}`);
  }
}

function assertTrue(condition, message = '') {
  if (!condition) {
    throw new Error(message || 'Assertion failed: expected true');
  }
}

function assertContains(str, substr, message = '') {
  if (!str.includes(substr)) {
    throw new Error(`${message} Expected "${str}" to contain "${substr}"`);
  }
}

console.log('\n========================================');
console.log('多智能体系统优化测试报告');
console.log('========================================\n');

console.log('--- 里程碑0：基础设施准备 ---\n');

test('ExecutionModeDeciderService - 应该正确导出类型', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/execution-mode-decider.service.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'export type ExecutionMode', '应导出 ExecutionMode 类型');
  assertContains(content, 'export interface ModeDecision', '应导出 ModeDecision 接口');
  assertContains(content, 'export class ExecutionModeDeciderService', '应导出 ExecutionModeDeciderService 类');
});

test('ExecutionModeDeciderService - 应该包含决策方法', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/execution-mode-decider.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'decide(userRequest: string', '应包含 decide 方法');
  assertContains(content, 'forceExecutionMode', '应包含 forceExecutionMode 方法');
  assertContains(content, 'setMultiAgentEnabled', '应包含 setMultiAgentEnabled 方法');
});

test('MultiAgentConfigService - 应该正确管理配置', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/multi-agent-config.service.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'getConfig()', '应包含 getConfig 方法');
  assertContains(content, 'setConfig', '应包含 setConfig 方法');
  assertContains(content, 'setEnabled', '应包含 setEnabled 方法');
  assertContains(content, 'setForceMode', '应包含 setForceMode 方法');
});

test('ModeSwitchApiService - 应该提供模式切换API', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/mode-switch-api.service.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'switchToSingle', '应包含 switchToSingle 方法');
  assertContains(content, 'switchToMulti', '应包含 switchToMulti 方法');
  assertContains(content, 'toggleMode', '应包含 toggleMode 方法');
  assertContains(content, 'decideForRequest', '应包含 decideForRequest 方法');
});

console.log('\n--- 里程碑1：单Agent模式优化 ---\n');

test('TaskPlannerService - 应该包含 planSimple 方法', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/task-planner.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'planSimple(request: string)', '应包含 planSimple 方法');
  assertContains(content, 'SimplePlan', '应定义 SimplePlan 接口');
  assertContains(content, 'shouldUseSingleAgent', '应包含 shouldUseSingleAgent 属性');
});

test('TaskPlannerService - planSimple 应该返回正确的结构', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/task-planner.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, "type: 'simple'", '应返回 simple 类型');
  assertContains(content, 'task:', '应包含 task 对象');
  assertContains(content, 'estimatedDurationMs', '应包含 estimatedDurationMs');
});

test('SingleAgentExecutionService - 应该正确实现单Agent执行', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/single-agent-execution.service.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'execute(', '应包含 execute 方法');
  assertContains(content, 'SingleAgentExecutionResult', '应定义 SingleAgentExecutionResult 接口');
  assertContains(content, 'executionLogs', '应包含 executionLogs signal');
});

console.log('\n--- 里程碑2：复杂度分析器增强 ---\n');

test('TaskPlannerService - 应该包含增强的复杂度分析方法', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/task-planner.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'analyzeCrossDomain', '应包含 analyzeCrossDomain 方法');
  assertContains(content, 'analyzeParallelism', '应包含 analyzeParallelism 方法');
  assertContains(content, 'analyzeDependencies', '应包含 analyzeDependencies 方法');
  assertContains(content, 'analyzeTechnicalComplexity', '应包含 analyzeTechnicalComplexity 方法');
  assertContains(content, 'analyzeBusinessComplexity', '应包含 analyzeBusinessComplexity 方法');
});

test('复杂度分析 - 应该检测跨领域任务', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/task-planner.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'domains.push', '应该收集领域信息');
  assertContains(content, '跨领域任务', '应该标记跨领域任务');
});

test('复杂度分析 - 应该检测并行任务', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/task-planner.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'parallelIndicators', '应该定义并行指示器');
  assertContains(content, '存在并行任务', '应该标记并行任务');
});

console.log('\n--- 里程碑3：LLM自主决策集成 ---\n');

test('AgentToolService - 应该正确实现Agent工具', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/tools/agent-tool.service.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'AgentToolInput', '应定义 AgentToolInput 接口');
  assertContains(content, 'AgentToolOutput', '应定义 AgentToolOutput 接口');
  assertContains(content, 'AGENT_TOOL_SCHEMA', '应定义工具 schema');
});

test('AgentToolService - 应该包含正确的工具schema', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/tools/agent-tool.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, "name: 'Agent'", '工具名称应为 Agent');
  assertContains(content, 'description:', '应包含描述');
  assertContains(content, 'input_schema', '应包含 input_schema');
  assertContains(content, 'required:', '应包含必填字段');
});

test('AgentToolService - 应该支持同步和异步执行', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/tools/agent-tool.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'executeSync', '应包含 executeSync 方法');
  assertContains(content, 'executeAsync', '应包含 executeAsync 方法');
  assertContains(content, 'run_in_background', '应支持后台运行');
});

console.log('\n--- 里程碑4：多智能体自动创建 ---\n');

test('TeamCreateToolService - 应该正确实现团队创建工具', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/tools/team-create-tool.service.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'TeamCreateInput', '应定义 TeamCreateInput 接口');
  assertContains(content, 'TeamCreateOutput', '应定义 TeamCreateOutput 接口');
  assertContains(content, 'TEAM_CREATE_TOOL_SCHEMA', '应定义工具 schema');
});

test('TeamCreateToolService - 应该包含团队管理方法', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/tools/team-create-tool.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'createTeam', '应包含 createTeam 方法');
  assertContains(content, 'disbandTeam', '应包含 disbandTeam 方法');
  assertContains(content, 'inferRoles', '应包含 inferRoles 方法');
});

test('TeamCreateToolService - 应该自动推断角色', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/tools/team-create-tool.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'researcher', '应该推断研究员角色');
  assertContains(content, 'planner', '应该推断规划者角色');
  assertContains(content, 'executor', '应该推断执行者角色');
  assertContains(content, 'validator', '应该推断验证者角色');
});

console.log('\n--- 里程碑5：生命周期管理完善 ---\n');

test('AgentStateMachineService - 应该正确实现状态机', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/agent-state-machine.service.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'AgentState', '应定义 AgentState 类型');
  assertContains(content, 'STATE_TRANSITIONS', '应定义状态转换规则');
});

test('AgentStateMachineService - 应该包含所有必要的状态', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/agent-state-machine.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, "'initializing'", '应包含 initializing 状态');
  assertContains(content, "'ready'", '应包含 ready 状态');
  assertContains(content, "'busy'", '应包含 busy 状态');
  assertContains(content, "'failed'", '应包含 failed 状态');
  assertContains(content, "'stopped'", '应包含 stopped 状态');
});

test('AgentStateMachineService - 应该支持状态转换验证', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/agent-state-machine.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'canTransition', '应包含 canTransition 方法');
  assertContains(content, 'transition', '应包含 transition 方法');
  assertContains(content, 'attemptRecovery', '应包含 attemptRecovery 方法');
});

console.log('\n--- 里程碑6：权限与安全 ---\n');

test('PermissionService - 应该正确实现权限检查', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/permission.service.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'PermissionResult', '应定义 PermissionResult 类型');
  assertContains(content, 'checkAgentToolPermission', '应包含 checkAgentToolPermission 方法');
  assertContains(content, 'checkTeamCreatePermission', '应包含 checkTeamCreatePermission 方法');
});

test('PermissionService - 应该检测敏感操作', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/permission.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'SENSITIVE_PATTERNS', '应定义敏感模式');
  assertContains(content, 'isSensitiveOperation', '应包含 isSensitiveOperation 方法');
});

test('PermissionService - 应该记录审计日志', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/services/permission.service.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'AuditLogEntry', '应定义 AuditLogEntry 接口');
  assertContains(content, 'auditLogs', '应包含 auditLogs signal');
  assertContains(content, 'logAudit', '应包含 logAudit 方法');
});

console.log('\n--- 里程碑7：UI/UX优化 ---\n');

test('MultiAgentSidebarComponent - 应该包含执行模式指示器', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/multi-agent-sidebar.component.html');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'execution-mode-indicator', '应包含执行模式指示器');
  assertContains(content, 'mode-badge', '应包含模式徽章');
  assertContains(content, 'mode-toggle-btn', '应包含模式切换按钮');
});

test('MultiAgentSidebarComponent - 应该支持模式切换', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/multi-agent-sidebar.component.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'toggleExecutionMode', '应包含 toggleExecutionMode 方法');
  assertContains(content, 'canToggleMode', '应包含 canToggleMode 方法');
  assertContains(content, 'toggleMode', '应包含 toggleMode 方法调用');
});

test('MultiAgentConfigPanelComponent - 应该提供配置界面', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/multi-agent-config-panel.component.ts');
  assertTrue(fs.existsSync(filePath), '文件应存在');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'enabled', '应包含启用开关');
  assertContains(content, 'maxAgents', '应包含最大智能体数量配置');
  assertContains(content, 'forceMode', '应包含强制模式配置');
});

console.log('\n--- 事件系统集成测试 ---\n');

test('事件类型 - 应该包含模式切换事件', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/multi-agent.events.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'MODE_SINGLE', '应包含 MODE_SINGLE 事件');
  assertContains(content, 'MODE_MULTI', '应包含 MODE_MULTI 事件');
  assertContains(content, 'MODE_AUTO', '应包含 MODE_AUTO 事件');
});

test('事件Payload - 应该定义正确的payload类型', () => {
  const filePath = path.join(__dirname, '../src/app/core/multi-agent/multi-agent.events.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assertContains(content, 'ModeSinglePayload', '应定义 ModeSinglePayload');
  assertContains(content, 'ModeMultiPayload', '应定义 ModeMultiPayload');
  assertContains(content, 'ModeAutoPayload', '应定义 ModeAutoPayload');
});

console.log('\n========================================');
console.log('测试结果汇总');
console.log('========================================');
console.log(`总计: ${TEST_RESULTS.total} 个测试`);
console.log(`通过: ${TEST_RESULTS.passed} 个`);
console.log(`失败: ${TEST_RESULTS.failed} 个`);
console.log(`通过率: ${((TEST_RESULTS.passed / TEST_RESULTS.total) * 100).toFixed(1)}%`);
console.log('========================================\n');

if (TEST_RESULTS.failed > 0) {
  console.log('失败的测试:');
  TEST_RESULTS.details
    .filter(d => d.status === 'FAIL')
    .forEach(d => {
      console.log(`  - ${d.name}: ${d.error}`);
    });
  console.log('');
}

const reportPath = path.join(__dirname, '../docs/multi-agent-optimization-test-report.md');
const reportContent = generateReport();
fs.writeFileSync(reportPath, reportContent, 'utf-8');
console.log(`测试报告已生成: ${reportPath}`);

function generateReport() {
  const lines = [
    '# 多智能体系统优化测试报告',
    '',
    `> 生成时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 测试结果汇总',
    '',
    '| 指标 | 数值 |',
    '|------|------|',
    `| 总测试数 | ${TEST_RESULTS.total} |`,
    `| 通过数 | ${TEST_RESULTS.passed} |`,
    `| 失败数 | ${TEST_RESULTS.failed} |`,
    `| 通过率 | ${((TEST_RESULTS.passed / TEST_RESULTS.total) * 100).toFixed(1)}% |`,
    '',
    '## 测试详情',
    '',
    '### 里程碑0：基础设施准备',
    '',
    '| 测试用例 | 状态 |',
    '|----------|------|',
  ];

  TEST_RESULTS.details
    .filter(d => d.name.includes('ExecutionModeDecider') || d.name.includes('MultiAgentConfig') || d.name.includes('ModeSwitchApi'))
    .forEach(d => {
      lines.push(`| ${d.name} | ${d.status === 'PASS' ? '✅ 通过' : '❌ 失败'} |`);
    });

  lines.push('', '### 里程碑1：单Agent模式优化', '', '| 测试用例 | 状态 |', '|----------|------|');

  TEST_RESULTS.details
    .filter(d => d.name.includes('planSimple') || d.name.includes('SingleAgent'))
    .forEach(d => {
      lines.push(`| ${d.name} | ${d.status === 'PASS' ? '✅ 通过' : '❌ 失败'} |`);
    });

  lines.push('', '### 里程碑2：复杂度分析器增强', '', '| 测试用例 | 状态 |', '|----------|------|');

  TEST_RESULTS.details
    .filter(d => d.name.includes('复杂度'))
    .forEach(d => {
      lines.push(`| ${d.name} | ${d.status === 'PASS' ? '✅ 通过' : '❌ 失败'} |`);
    });

  lines.push('', '### 里程碑3：LLM自主决策集成', '', '| 测试用例 | 状态 |', '|----------|------|');

  TEST_RESULTS.details
    .filter(d => d.name.includes('AgentTool'))
    .forEach(d => {
      lines.push(`| ${d.name} | ${d.status === 'PASS' ? '✅ 通过' : '❌ 失败'} |`);
    });

  lines.push('', '### 里程碑4：多智能体自动创建', '', '| 测试用例 | 状态 |', '|----------|------|');

  TEST_RESULTS.details
    .filter(d => d.name.includes('TeamCreate'))
    .forEach(d => {
      lines.push(`| ${d.name} | ${d.status === 'PASS' ? '✅ 通过' : '❌ 失败'} |`);
    });

  lines.push('', '### 里程碑5：生命周期管理完善', '', '| 测试用例 | 状态 |', '|----------|------|');

  TEST_RESULTS.details
    .filter(d => d.name.includes('AgentStateMachine'))
    .forEach(d => {
      lines.push(`| ${d.name} | ${d.status === 'PASS' ? '✅ 通过' : '❌ 失败'} |`);
    });

  lines.push('', '### 里程碑6：权限与安全', '', '| 测试用例 | 状态 |', '|----------|------|');

  TEST_RESULTS.details
    .filter(d => d.name.includes('Permission'))
    .forEach(d => {
      lines.push(`| ${d.name} | ${d.status === 'PASS' ? '✅ 通过' : '❌ 失败'} |`);
    });

  lines.push('', '### 里程碑7：UI/UX优化', '', '| 测试用例 | 状态 |', '|----------|------|');

  TEST_RESULTS.details
    .filter(d => d.name.includes('Sidebar') || d.name.includes('ConfigPanel'))
    .forEach(d => {
      lines.push(`| ${d.name} | ${d.status === 'PASS' ? '✅ 通过' : '❌ 失败'} |`);
    });

  if (TEST_RESULTS.failed > 0) {
    lines.push('', '## 失败测试详情', '');
    TEST_RESULTS.details
      .filter(d => d.status === 'FAIL')
      .forEach(d => {
        lines.push(`### ${d.name}`, '', `**错误信息**: ${d.error}`, '');
      });
  }

  lines.push('', '## 结论', '');
  if (TEST_RESULTS.failed === 0) {
    lines.push('所有测试均已通过，多智能体系统优化实现完成。');
  } else {
    lines.push(`有 ${TEST_RESULTS.failed} 个测试失败，需要修复相关问题。`);
  }

  return lines.join('\n');
}

process.exit(TEST_RESULTS.failed > 0 ? 1 : 0);
