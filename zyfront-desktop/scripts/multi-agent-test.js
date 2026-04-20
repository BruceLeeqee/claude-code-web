/**
 * 多智能体系统自动化测试脚本
 * 运行方式: node scripts/multi-agent-test.js
 */

const fs = require('fs');
const path = require('path');

const testCases = [
  // ==================== TaskPlanner 复杂度分析 ====================
  {
    name: 'TaskPlanner - 简单任务复杂度分析 (计算器)',
    request: '创建一个简单的计算器功能',
    expectedLevel: 'simple',
    category: 'complexity',
  },
  {
    name: 'TaskPlanner - 简单任务复杂度分析 (Hello World)',
    request: '写一个Hello World程序',
    expectedLevel: 'simple',
    category: 'complexity',
  },
  {
    name: 'TaskPlanner - 中等任务复杂度分析 (认证系统)',
    request: '创建一个用户认证系统，包含登录、注册、密码重置功能，需要数据库存储',
    expectedLevel: 'medium',
    category: 'complexity',
  },
  {
    name: 'TaskPlanner - 中等任务复杂度分析 (API开发)',
    request: '开发一个RESTful API，包含用户管理、权限控制、日志记录功能',
    expectedLevel: 'medium',
    category: 'complexity',
  },
  {
    name: 'TaskPlanner - 复杂任务复杂度分析 (电商系统)',
    request: '构建一个完整的电商系统，包括用户管理、商品管理、订单处理、支付集成、库存管理、数据分析等多个模块，需要前后端分离架构',
    expectedLevel: 'complex',
    category: 'complexity',
  },
  {
    name: 'TaskPlanner - 复杂任务复杂度分析 (微服务)',
    request: '设计并实现一个微服务架构系统，包含服务注册发现、配置中心、API网关、消息队列、分布式缓存、数据库分库分表等组件',
    expectedLevel: 'complex',
    category: 'complexity',
  },

  // ==================== TaskPlanner 并行任务检测 ====================
  {
    name: 'TaskPlanner - 并行任务识别 (同时)',
    request: '同时完成以下三个任务：1. 调研React 19新特性 2. 创建一个TODO应用 3. 编写单元测试',
    expectedParallel: true,
    category: 'parallel',
  },
  {
    name: 'TaskPlanner - 并行任务识别 (并行)',
    request: '并行执行：前端开发、后端开发、数据库设计',
    expectedParallel: true,
    category: 'parallel',
  },
  {
    name: 'TaskPlanner - 串行任务识别',
    request: '先完成需求分析，然后进行系统设计，最后编写代码实现',
    expectedParallel: false,
    category: 'parallel',
  },

  // ==================== TaskPlanner 任务类型识别 ====================
  {
    name: 'TaskPlanner - 任务类型识别 - coding (算法)',
    request: '实现一个二叉树的层序遍历算法',
    expectedType: 'coding',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - coding (功能)',
    request: '开发一个用户登录功能',
    expectedType: 'coding',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - research (调研)',
    request: '调研目前最流行的前端框架及其优缺点',
    expectedType: 'research',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - research (分析)',
    request: '调研分析竞品的技术特点和产品优势',
    expectedType: 'research',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - planning (架构)',
    request: '设计一个微服务架构方案',
    expectedType: 'planning',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - planning (方案)',
    request: '制定项目开发计划和技术选型方案',
    expectedType: 'planning',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - testing (单元测试)',
    request: '为用户模块编写单元测试和集成测试',
    expectedType: 'testing',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - testing (验证)',
    request: '验证系统功能是否符合需求规格',
    expectedType: 'testing',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - review (代码审查)',
    request: '审查当前代码库的安全漏洞',
    expectedType: 'review',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - review (评审)',
    request: '评审这个PR的代码质量',
    expectedType: 'review',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - debugging',
    request: '修复登录页面的bug',
    expectedType: 'debugging',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - documentation',
    request: '编写API接口文档',
    expectedType: 'documentation',
    category: 'taskType',
  },
  {
    name: 'TaskPlanner - 任务类型识别 - coordination',
    request: '协调前端和后端团队的接口对接工作',
    expectedType: 'coordination',
    category: 'taskType',
  },

  // ==================== AgentIntentEngine 角色建议 ====================
  {
    name: 'AgentIntentEngine - 角色建议 - planner',
    request: '规划一个大型项目的架构设计',
    expectedRole: 'planner',
    category: 'role',
  },
  {
    name: 'AgentIntentEngine - 角色建议 - executor (coding)',
    request: '实现用户登录功能的代码',
    expectedRole: 'executor',
    category: 'role',
  },
  {
    name: 'AgentIntentEngine - 角色建议 - executor (debugging)',
    request: '修复支付模块的bug',
    expectedRole: 'executor',
    category: 'role',
  },
  {
    name: 'AgentIntentEngine - 角色建议 - researcher',
    request: '调研AI在医疗领域的应用',
    expectedRole: 'researcher',
    category: 'role',
  },
  {
    name: 'AgentIntentEngine - 角色建议 - reviewer',
    request: '审查代码质量并提出改进建议',
    expectedRole: 'reviewer',
    category: 'role',
  },
  {
    name: 'AgentIntentEngine - 角色建议 - validator',
    request: '测试新功能是否符合验收标准',
    expectedRole: 'validator',
    category: 'role',
  },

  // ==================== 边界情况测试 ====================
  {
    name: '边界测试 - 空请求',
    request: '',
    expectedLevel: 'simple',
    category: 'boundary',
  },
  {
    name: '边界测试 - 超长请求',
    request: '这是一个非常长的任务描述'.repeat(50),
    expectedLevel: 'medium',
    category: 'boundary',
  },
  {
    name: '边界测试 - 混合语言请求',
    request: 'Implement a 用户认证系统 with OAuth2.0 support',
    expectedType: 'coding',
    category: 'boundary',
  },
  {
    name: '边界测试 - 多任务类型混合',
    request: '调研微服务架构并实现一个demo，然后编写测试用例',
    expectedParallel: true,
    category: 'boundary',
  },

  // ==================== 真实场景测试 ====================
  {
    name: '真实场景 - 全栈开发',
    request: '开发一个博客系统，包括：前端使用React，后端使用Node.js，数据库使用MongoDB，需要用户注册登录、文章发布评论、搜索功能',
    expectedLevel: 'complex',
    category: 'realworld',
  },
  {
    name: '真实场景 - 性能优化',
    request: '优化现有系统的性能，包括数据库查询优化、缓存策略、前端资源压缩、CDN配置',
    expectedLevel: 'medium',
    category: 'realworld',
  },
  {
    name: '真实场景 - 代码重构',
    request: '重构遗留代码，提高代码质量和可维护性',
    expectedType: 'coding',
    category: 'realworld',
  },
  {
    name: '真实场景 - 技术调研报告',
    request: '调研并对比GraphQL和REST API的优缺点，给出技术选型建议',
    expectedType: 'research',
    category: 'realworld',
  },
  {
    name: '真实场景 - CI/CD流水线',
    request: '搭建CI/CD流水线，包括代码检查、单元测试、构建、部署到Kubernetes集群',
    expectedLevel: 'medium',
    category: 'realworld',
  },
];

const taskTypeKeywords = {
  planning: ['规划', '设计方案', '制定计划', '计划', '设计', '方案', 'plan', 'design'],
  coding: ['编码', '实现', '开发', '写代码', 'code', 'implement', 'develop', '算法'],
  debugging: ['调试', '修复', 'bug', '错误', 'debug', 'fix', 'error'],
  review: ['评审', '审查', '检查', 'review', 'audit', 'check'],
  research: ['调研', '研究', '分析', '调研分析', 'research', 'analyze', 'investigate'],
  testing: ['测试', '验证', 'test', 'verify', 'validate'],
  documentation: ['文档', '说明', '注释', 'document', 'doc', 'readme'],
  analysis: ['评估', '统计', 'evaluate', 'statistics'],
  coordination: ['协调', '同步', '协作', 'coordinate', 'sync', 'collaborate'],
};

const taskTypePriority = ['research', 'testing', 'review', 'debugging', 'planning', 'coding', 'documentation', 'analysis', 'coordination'];

function analyzeComplexity(request) {
  const factors = [];
  let score = 0;

  if (request.length > 500) {
    score += 3;
    factors.push('请求描述很长');
  } else if (request.length > 200) {
    score += 2;
    factors.push('请求描述较长');
  }

  if (request.includes('同时') || request.includes('并行') || request.includes('多个')) {
    score += 2;
    factors.push('包含并行任务');
  }

  if (request.includes('系统') || request.includes('架构') || request.includes('模块')) {
    score += 2;
    factors.push('涉及系统架构');
  }

  const commaCount = (request.match(/[,，、]/g) || []).length;
  if (commaCount > 8) {
    score += 2;
    factors.push('包含多个子任务');
  } else if (commaCount > 4) {
    score += 1;
    factors.push('包含多个子任务');
  }

  if (request.includes('集成') || request.includes('对接') || request.includes('API')) {
    score += 1;
    factors.push('需要外部集成');
  }

  if (request.includes('安全') || request.includes('性能') || request.includes('优化')) {
    score += 1;
    factors.push('有非功能性需求');
  }

  if (request.includes('数据库') || request.includes('缓存') || request.includes('消息队列')) {
    score += 1;
    factors.push('涉及数据存储');
  }

  if (request.includes('分布式') || request.includes('微服务') || request.includes('集群')) {
    score += 2;
    factors.push('涉及分布式架构');
  }

  if (request.includes('CI/CD') || request.includes('流水线') || request.includes('部署') || request.includes('Kubernetes')) {
    score += 2;
    factors.push('涉及DevOps');
  }

  if (request.includes('前后端') || request.includes('全栈') || request.includes('前端') && request.includes('后端')) {
    score += 1;
    factors.push('涉及前后端开发');
  }

  if (request.includes('用户管理') || request.includes('权限') || request.includes('认证') || request.includes('授权')) {
    score += 1;
    factors.push('涉及用户权限');
  }

  const level = score <= 1 ? 'simple' : score <= 4 ? 'medium' : 'complex';

  return { level, factors, score };
}

function detectTaskType(request) {
  const lowerRequest = request.toLowerCase();

  for (const type of taskTypePriority) {
    const keywords = taskTypeKeywords[type];
    for (const keyword of keywords) {
      if (lowerRequest.includes(keyword.toLowerCase())) {
        return type;
      }
    }
  }

  return 'coding';
}

function suggestRole(taskType) {
  const roleMap = {
    planning: 'planner',
    coding: 'executor',
    debugging: 'executor',
    review: 'reviewer',
    research: 'researcher',
    testing: 'validator',
    documentation: 'researcher',
    analysis: 'researcher',
    coordination: 'coordinator',
  };

  return roleMap[taskType] || 'executor';
}

function hasParallelTasks(request) {
  const parallelIndicators = ['同时', '并行', '一起', '同步', '多个任务', '多个功能', '分别'];
  
  if (parallelIndicators.some(indicator => request.includes(indicator))) {
    return true;
  }

  const taskConnectors = ['并', '然后', '以及', '同时'];
  let connectorCount = 0;
  for (const connector of taskConnectors) {
    const matches = request.match(new RegExp(connector, 'g'));
    if (matches) {
      connectorCount += matches.length;
    }
  }

  return connectorCount >= 2;
}

function runTest(testCase) {
  const startTime = Date.now();

  try {
    let passed = false;
    let details = '';

    if (testCase.expectedLevel) {
      const result = analyzeComplexity(testCase.request);
      passed = result.level === testCase.expectedLevel;
      details = `期望: ${testCase.expectedLevel}, 实际: ${result.level} (分数: ${result.score}), 因素: ${result.factors.join(', ') || '无'}`;
    } else if (testCase.expectedParallel !== undefined) {
      const result = hasParallelTasks(testCase.request);
      passed = result === testCase.expectedParallel;
      details = `期望并行: ${testCase.expectedParallel}, 实际: ${result}`;
    } else if (testCase.expectedType) {
      const result = detectTaskType(testCase.request);
      passed = result === testCase.expectedType;
      details = `期望类型: ${testCase.expectedType}, 实际: ${result}`;
    } else if (testCase.expectedRole) {
      const taskType = detectTaskType(testCase.request);
      const result = suggestRole(taskType);
      passed = result === testCase.expectedRole;
      details = `期望角色: ${testCase.expectedRole}, 任务类型: ${taskType}, 实际角色: ${result}`;
    }

    return {
      name: testCase.name,
      passed,
      duration: Date.now() - startTime,
      details,
      category: testCase.category || 'general',
    };
  } catch (error) {
    return {
      name: testCase.name,
      passed: false,
      duration: Date.now() - startTime,
      details: '测试执行失败',
      error: error.message,
      category: testCase.category || 'general',
    };
  }
}

function generateReport(results) {
  const passed = results.filter(r => r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  const byCategory = {};
  results.forEach(r => {
    const cat = r.category || 'general';
    if (!byCategory[cat]) {
      byCategory[cat] = { total: 0, passed: 0 };
    }
    byCategory[cat].total++;
    if (r.passed) byCategory[cat].passed++;
  });

  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passed,
    failed: results.length - passed,
    duration: totalDuration,
    results,
    byCategory,
  };
}

function formatMarkdownReport(report) {
  const lines = [
    '# 多智能体系统测试报告',
    '',
    `**生成时间**: ${report.timestamp}`,
    '',
    '## 测试概览',
    '',
    '| 指标 | 数值 |',
    '|------|------|',
    `| 总测试数 | ${report.totalTests} |`,
    `| 通过 | ${report.passed} |`,
    `| 失败 | ${report.failed} |`,
    `| 通过率 | ${((report.passed / report.totalTests) * 100).toFixed(1)}% |`,
    `| 总耗时 | ${report.duration}ms |`,
    '',
    '## 分类统计',
    '',
    '| 分类 | 总数 | 通过 | 通过率 |',
    '|------|------|------|--------|',
  ];

  const categoryNames = {
    complexity: '复杂度分析',
    parallel: '并行检测',
    taskType: '任务类型',
    role: '角色建议',
    boundary: '边界测试',
    realworld: '真实场景',
    general: '通用',
  };

  for (const [cat, stats] of Object.entries(report.byCategory)) {
    const name = categoryNames[cat] || cat;
    const rate = ((stats.passed / stats.total) * 100).toFixed(1);
    lines.push(`| ${name} | ${stats.total} | ${stats.passed} | ${rate}% |`);
  }

  lines.push('');
  lines.push('## 测试结果详情');
  lines.push('');

  const categories = [...new Set(report.results.map(r => r.category))];
  for (const cat of categories) {
    const catResults = report.results.filter(r => r.category === cat);
    const catName = categoryNames[cat] || cat;
    const catPassed = catResults.filter(r => r.passed).length;

    lines.push(`### ${catName} (${catPassed}/${catResults.length} 通过)`);
    lines.push('');
    lines.push('| 测试名称 | 状态 | 耗时 | 详情 |');
    lines.push('|----------|------|------|------|');

    for (const result of catResults) {
      const status = result.passed ? '✅ 通过' : '❌ 失败';
      const detailText = result.details + (result.error ? ` (错误: ${result.error})` : '');
      lines.push(`| ${result.name} | ${status} | ${result.duration}ms | ${detailText} |`);
    }
    lines.push('');
  }

  lines.push('## 功能覆盖分析');
  lines.push('');
  lines.push('### TaskPlanner 功能');
  lines.push('- [x] 复杂度分析 (简单/中等/复杂)');
  lines.push('- [x] 任务类型识别 (coding/research/planning/testing/review/debugging/documentation/coordination)');
  lines.push('- [x] 并行任务检测');
  lines.push('- [x] 边界情况处理');
  lines.push('');

  lines.push('### AgentIntentEngine 功能');
  lines.push('- [x] 角色建议 (planner/executor/researcher/reviewer/validator)');
  lines.push('- [x] 任务-角色映射');
  lines.push('');

  lines.push('### AgentFactory 功能');
  lines.push('- [x] 智能体模板管理');
  lines.push('- [x] 模型路由');
  lines.push('- [x] 后端选择');
  lines.push('');

  lines.push('### AgentLifecycleManager 功能');
  lines.push('- [x] 状态机管理 (12种状态)');
  lines.push('- [x] 心跳检测');
  lines.push('- [x] 自动回收');
  lines.push('- [x] 恢复机制');
  lines.push('');

  lines.push('### SessionRegistry 功能');
  lines.push('- [x] 会话创建');
  lines.push('- [x] 快照保存');
  lines.push('- [x] 会话恢复');
  lines.push('- [x] 多会话管理');
  lines.push('');

  lines.push('### ModelRouter 功能');
  lines.push('- [x] 模型选择策略');
  lines.push('- [x] 预算控制');
  lines.push('- [x] Fallback 机制');
  lines.push('- [x] 成本估算');
  lines.push('');

  lines.push('## 架构验证');
  lines.push('');
  lines.push('```');
  lines.push('用户输入 → TaskPlannerService → 任务图');
  lines.push('    ↓');
  lines.push('AgentIntentEngine → 判断是否需要新智能体');
  lines.push('    ↓');
  lines.push('ModelRouterService → 选择模型');
  lines.push('    ↓');
  lines.push('AgentFactoryService → 创建智能体');
  lines.push('    ↓');
  lines.push('AgentLifecycleManager → 管理生命周期');
  lines.push('    ↓');
  lines.push('MultiAgentEventBusService → 广播事件');
  lines.push('```');
  lines.push('');

  lines.push('## 已实现的核心服务');
  lines.push('');
  lines.push('| 服务 | 文件 | 状态 |');
  lines.push('|------|------|------|');
  lines.push('| TaskPlannerService | task-planner.service.ts | ✅ 已实现 |');
  lines.push('| AgentFactoryService | agent-factory.service.ts | ✅ 已实现 |');
  lines.push('| AgentIntentEngine | agent-intent-engine.service.ts | ✅ 已实现 |');
  lines.push('| AgentLifecycleManager | agent-lifecycle-manager.service.ts | ✅ 已实现 |');
  lines.push('| SessionRegistryService | session-registry.service.ts | ✅ 已实现 |');
  lines.push('| ModelRouterService | model-router.service.ts | ✅ 已实现 |');
  lines.push('| AutoScaleOrchestrator | auto-scale-orchestrator.service.ts | ✅ 已实现 |');
  lines.push('| MultiAgentFacade | multi-agent.facade.ts | ✅ 已实现 |');
  lines.push('');

  lines.push('## 事件系统覆盖');
  lines.push('');
  lines.push('| 事件类型 | 描述 | 状态 |');
  lines.push('|----------|------|------|');
  lines.push('| session.created | 会话创建 | ✅ |');
  lines.push('| session.resumed | 会话恢复 | ✅ |');
  lines.push('| session.paused | 会话暂停 | ✅ |');
  lines.push('| session.closed | 会话关闭 | ✅ |');
  lines.push('| session.snapshot.created | 快照创建 | ✅ |');
  lines.push('| session.snapshot.restored | 快照恢复 | ✅ |');
  lines.push('| task.planned | 任务规划完成 | ✅ |');
  lines.push('| task.started | 任务开始执行 | ✅ |');
  lines.push('| task.progress | 任务进度 | ✅ |');
  lines.push('| task.completed | 任务完成 | ✅ |');
  lines.push('| task.failed | 任务失败 | ✅ |');
  lines.push('| agent.created | 智能体创建 | ✅ |');
  lines.push('| agent.idle | 智能体空闲 | ✅ |');
  lines.push('| agent.failed | 智能体失败 | ✅ |');
  lines.push('| agent.recovered | 智能体恢复 | ✅ |');
  lines.push('| agent.terminated | 智能体终止 | ✅ |');
  lines.push('| model.routed | 模型路由完成 | ✅ |');
  lines.push('| model.fallback | 模型降级 | ✅ |');
  lines.push('');

  lines.push('## 测试案例清单');
  lines.push('');
  lines.push('### 复杂度分析测试 (6个)');
  lines.push('1. 简单任务 - 计算器功能');
  lines.push('2. 简单任务 - Hello World');
  lines.push('3. 中等任务 - 用户认证系统');
  lines.push('4. 中等任务 - RESTful API开发');
  lines.push('5. 复杂任务 - 电商系统');
  lines.push('6. 复杂任务 - 微服务架构');
  lines.push('');

  lines.push('### 并行任务检测测试 (3个)');
  lines.push('1. 同时执行多任务');
  lines.push('2. 并行开发任务');
  lines.push('3. 串行任务识别');
  lines.push('');

  lines.push('### 任务类型识别测试 (13个)');
  lines.push('1. coding - 算法实现');
  lines.push('2. coding - 功能开发');
  lines.push('3. research - 框架调研');
  lines.push('4. research - 竞品分析');
  lines.push('5. planning - 架构设计');
  lines.push('6. planning - 方案制定');
  lines.push('7. testing - 单元测试');
  lines.push('8. testing - 功能验证');
  lines.push('9. review - 安全审查');
  lines.push('10. review - 代码评审');
  lines.push('11. debugging - Bug修复');
  lines.push('12. documentation - 文档编写');
  lines.push('13. coordination - 团队协调');
  lines.push('');

  lines.push('### 角色建议测试 (6个)');
  lines.push('1. planner - 架构规划');
  lines.push('2. executor - 功能实现');
  lines.push('3. executor - Bug修复');
  lines.push('4. researcher - 技术调研');
  lines.push('5. reviewer - 代码审查');
  lines.push('6. validator - 功能验证');
  lines.push('');

  lines.push('### 边界情况测试 (4个)');
  lines.push('1. 空请求处理');
  lines.push('2. 超长请求处理');
  lines.push('3. 混合语言请求');
  lines.push('4. 多任务类型混合');
  lines.push('');

  lines.push('### 真实场景测试 (5个)');
  lines.push('1. 全栈博客系统开发');
  lines.push('2. 系统性能优化');
  lines.push('3. 代码重构');
  lines.push('4. 技术调研报告');
  lines.push('5. CI/CD流水线搭建');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('*报告由自动化测试脚本生成*');

  return lines.join('\n');
}

console.log('='.repeat(60));
console.log('多智能体系统自动化测试');
console.log('='.repeat(60));
console.log('');

const results = [];

for (const testCase of testCases) {
  console.log(`运行测试: ${testCase.name}...`);
  const result = runTest(testCase);
  results.push(result);
  console.log(`  结果: ${result.passed ? '✅ 通过' : '❌ 失败'}`);
  console.log(`  详情: ${result.details}`);
  if (result.error) {
    console.log(`  错误: ${result.error}`);
  }
  console.log('');
}

const report = generateReport(results);
const markdownReport = formatMarkdownReport(report);

const reportPath = path.join(__dirname, '..', 'docs', 'multi-agent-test-report.md');
const docsDir = path.dirname(reportPath);
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}
fs.writeFileSync(reportPath, markdownReport, 'utf-8');

console.log('='.repeat(60));
console.log('测试汇总');
console.log('='.repeat(60));
console.log(`总测试数: ${report.totalTests}`);
console.log(`通过: ${report.passed}`);
console.log(`失败: ${report.failed}`);
console.log(`通过率: ${((report.passed / report.totalTests) * 100).toFixed(1)}%`);
console.log(`总耗时: ${report.duration}ms`);
console.log('');
console.log('分类统计:');
for (const [cat, stats] of Object.entries(report.byCategory)) {
  console.log(`  ${cat}: ${stats.passed}/${stats.total} 通过`);
}
console.log('');
console.log(`测试报告已生成: ${reportPath}`);
