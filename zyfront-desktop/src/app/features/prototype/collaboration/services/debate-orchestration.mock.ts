import { CollaborationAgentVm, CollaborationTaskVm, CollaborationTeamVm } from './collaboration-state.service';
import { DebateTopic } from './debate.service';

export interface DebateOrchestrationMockCase {
  id: 'debate-manual' | 'debate-auto';
  name: string;
  mode: 'battle';
  description: string;
  agents: CollaborationAgentVm[];
  teams: CollaborationTeamVm[];
  tasks: CollaborationTaskVm[];
  expectedDashboard: {
    totalAgents: number;
    runningAgents: number;
    idleAgents: number;
    errorAgents: number;
  };
}

export const DEBATE_TOPIC_MOCKS: DebateTopic[] = [
  {
    id: 'debate-topic-ai-governance',
    title: '是否应在企业内全面引入 AI 代码审查',
    description: '围绕交付质量、效率、风险与治理成本进行正反对抗。',
    sides: [
      {
        id: 'affirmative',
        name: '正方',
        description: '全面引入可显著提升评审效率，并建立统一质量基线。',
      },
      {
        id: 'negative',
        name: '反方',
        description: '全面引入可能放大误判风险，且会增加治理与审计负担。',
      },
    ],
  },
];

const BASE_DEBATE_AGENTS: CollaborationAgentVm[] = [
  {
    id: 'agent-affirmative-architect',
    name: '正方-架构师',
    role: 'architect',
    status: 'idle',
    load: 18,
    skills: ['System Design', 'Architecture Review'],
  },
  {
    id: 'agent-affirmative-analyst',
    name: '正方-分析师',
    role: 'analyst',
    status: 'idle',
    load: 16,
    skills: ['Impact Analysis', 'Evidence Mining'],
  },
  {
    id: 'agent-negative-developer',
    name: '反方-开发者',
    role: 'developer',
    status: 'idle',
    load: 22,
    skills: ['Code Review', 'Failure Case Design'],
  },
  {
    id: 'agent-negative-tester',
    name: '反方-测试员',
    role: 'tester',
    status: 'idle',
    load: 20,
    skills: ['Risk Testing', 'Regression Design'],
  },
  {
    id: 'agent-judge-product',
    name: '裁判-产品负责人',
    role: 'product',
    status: 'idle',
    load: 12,
    skills: ['Decision Framing', 'Final Verdict'],
  },
];

const BASE_DEBATE_TEAMS: CollaborationTeamVm[] = [
  {
    id: 'team-affirmative',
    name: 'AFFIRMATIVE',
    score: 0,
    agents: [
      {
        id: 'agent-affirmative-architect',
        name: '正方-架构师',
        role: 'architect',
        status: 'idle',
        position: { x: 20, y: 30 },
      },
      {
        id: 'agent-affirmative-analyst',
        name: '正方-分析师',
        role: 'analyst',
        status: 'idle',
        position: { x: 25, y: 55 },
      },
    ],
  },
  {
    id: 'team-negative',
    name: 'NEGATIVE',
    score: 0,
    agents: [
      {
        id: 'agent-negative-developer',
        name: '反方-开发者',
        role: 'developer',
        status: 'idle',
        position: { x: 75, y: 30 },
      },
      {
        id: 'agent-negative-tester',
        name: '反方-测试员',
        role: 'tester',
        status: 'idle',
        position: { x: 70, y: 55 },
      },
    ],
  },
  {
    id: 'team-judge',
    name: 'JUDGE',
    score: 0,
    agents: [
      {
        id: 'agent-judge-product',
        name: '裁判-产品负责人',
        role: 'product',
        status: 'idle',
        position: { x: 50, y: 85 },
      },
    ],
  },
];

export const DEBATE_ORCHESTRATION_MOCKS: DebateOrchestrationMockCase[] = [
  {
    id: 'debate-manual',
    name: '辩论对抗-手动编排打通样例',
    mode: 'battle',
    description: '用于验证 Agent 创建 → Team 组装 → Task 手动编排 → 启动执行 → 智能体看板反馈。',
    agents: BASE_DEBATE_AGENTS,
    teams: BASE_DEBATE_TEAMS,
    tasks: [
      {
        id: 'task-manual-opening-affirmative',
        title: '正方开篇立论',
        description: '围绕效率与质量基线提出核心主张。',
        assignedAgentId: 'agent-affirmative-architect',
        status: 'pending',
        priority: 'high',
        dependencies: [],
      },
      {
        id: 'task-manual-opening-negative',
        title: '反方开篇立论',
        description: '围绕误判风险与治理成本提出反驳。',
        assignedAgentId: 'agent-negative-developer',
        status: 'pending',
        priority: 'high',
        dependencies: [],
      },
      {
        id: 'task-manual-crossfire',
        title: '交叉质询与证据对齐',
        description: '双方依据证据库进行回合制追问。',
        assignedAgentId: 'agent-affirmative-analyst',
        status: 'pending',
        priority: 'medium',
        dependencies: ['task-manual-opening-affirmative', 'task-manual-opening-negative'],
      },
      {
        id: 'task-manual-verdict',
        title: '裁判裁决与总结',
        description: '裁判给出结论与建议下一步。',
        assignedAgentId: 'agent-judge-product',
        status: 'pending',
        priority: 'high',
        dependencies: ['task-manual-crossfire'],
      },
    ],
    expectedDashboard: {
      totalAgents: 5,
      runningAgents: 0,
      idleAgents: 5,
      errorAgents: 0,
    },
  },
  {
    id: 'debate-auto',
    name: '辩论对抗-自动编排打通样例',
    mode: 'battle',
    description: '用于验证输入目标后自动拆分任务、自动分配 Agent 并可在看板观察运行状态。',
    agents: BASE_DEBATE_AGENTS.map(agent => ({
      ...agent,
      load: agent.load + 6,
    })),
    teams: BASE_DEBATE_TEAMS,
    tasks: [
      {
        id: 'task-auto-goal-analysis',
        title: '目标解析与策略建议',
        description: '系统解析辩题并生成推荐攻防策略。',
        assignedAgentId: 'agent-affirmative-analyst',
        status: 'pending',
        priority: 'high',
        dependencies: [],
      },
      {
        id: 'task-auto-affirmative-arguments',
        title: '自动生成正方论据',
        description: '从效率、质量、流程标准化三个方向输出论据。',
        assignedAgentId: 'agent-affirmative-architect',
        status: 'pending',
        priority: 'high',
        dependencies: ['task-auto-goal-analysis'],
      },
      {
        id: 'task-auto-negative-arguments',
        title: '自动生成反方论据',
        description: '从风险、误判与合规治理角度输出反论据。',
        assignedAgentId: 'agent-negative-tester',
        status: 'pending',
        priority: 'high',
        dependencies: ['task-auto-goal-analysis'],
      },
      {
        id: 'task-auto-final-review',
        title: '自动汇总并生成裁决草案',
        description: '裁判 Agent 汇总双方结论并产出裁决草案。',
        assignedAgentId: 'agent-judge-product',
        status: 'pending',
        priority: 'medium',
        dependencies: ['task-auto-affirmative-arguments', 'task-auto-negative-arguments'],
      },
    ],
    expectedDashboard: {
      totalAgents: 5,
      runningAgents: 0,
      idleAgents: 5,
      errorAgents: 0,
    },
  },
];

export const DEBATE_PANEL_AGENT_OPTIONS = BASE_DEBATE_AGENTS.map(agent => ({
  id: agent.id,
  name: agent.name,
}));
