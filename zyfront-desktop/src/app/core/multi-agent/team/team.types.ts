export type TeamRunMode = 'subagent' | 'agent-team' | 'hybrid';

export type RoleType = 'subagent' | 'agent-team';

export type StructType = 'subagent' | 'agent-team' | 'hybrid';

export type TeamRuntimeStatus =
  | 'created'
  | 'initializing'
  | 'running'
  | 'awaiting-handoff'
  | 'blocked'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cleaning-up'
  | 'closed';

export type TeamTaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'blocked'
  | 'reviewing'
  | 'done'
  | 'rejected'
  | 'cancelled';

export type RoleFileStatus = 'draft' | 'ready' | 'deprecated' | 'archived';

export type StructFileStatus = 'draft' | 'ready' | 'experimental' | 'archived';

export interface RoleDefinition {
  name: string;
  slug: string;
  type: RoleType;
  description: string;
  model?: string;
  tools: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  prompt: string;
  capabilities?: string[];
  constraints?: string[];
  allowedPaths?: string[];
  allowedWritePaths?: string[];
  status: RoleFileStatus;
  filePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamStageDefinition {
  name: string;
  mode: TeamRunMode;
  roles: string[];
  parallel?: boolean;
  trigger?: string;
  maxRounds?: number;
  output?: string;
  handoffCondition?: string;
  failurePolicy?: 'retry' | 'escalate' | 'abort';
  completionCondition?: string;
  regressionTest?: string;
}

export interface StructDefinition {
  name: string;
  slug: string;
  type: StructType;
  description: string;
  roles: string[];
  stages: TeamStageDefinition[];
  handoffRules?: string[];
  communicationRules?: string[];
  completionCriteria?: string[];
  failurePolicy?: string;
  artifactAggregationStrategy?: string;
  status: StructFileStatus;
  filePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamTask {
  id: string;
  title: string;
  assignee: string;
  status: TeamTaskStatus;
  dependencies: string[];
  inputs?: string;
  outputs?: string;
  blockers?: string[];
  nextStep?: string;
  stageName?: string;
  createdAt: number;
  updatedAt: number;
}

export type TeamMessagePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TeamMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  summary?: string;
  timestamp: number;
  read: boolean;
  relatedTaskId?: string;
  type: 'info' | 'request' | 'response' | 'alert' | 'handoff';
  priority?: TeamMessagePriority;
  metadata?: Record<string, unknown>;
}

export interface TeamRuntimeState {
  id: string;
  structName: string;
  status: TeamRuntimeStatus;
  leadAgentId: string;
  members: TeamMemberState[];
  tasks: TeamTask[];
  messages: TeamMessage[];
  currentStageIndex: number;
  currentStageName?: string;
  logs: TeamLogEntry[];
  artifacts: string[];
  allowedPaths: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TeamMemberState {
  agentId: string;
  roleName: string;
  status: 'joining' | 'active' | 'idle' | 'waiting' | 'leaving' | 'left' | 'error';
  unreadCount: number;
  lastMessageAt?: number;
  joinedAt: number;
}

export interface TeamLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  details?: Record<string, unknown>;
  teamId?: string;
  stageName?: string;
  taskId?: string;
  agentId?: string;
  correlationId?: string;
}

export interface CommandResult<T = unknown> {
  ok: boolean;
  command: string;
  message: string;
  data?: T;
  warnings?: string[];
  errors?: string[];
  openedFiles?: string[];
  createdFiles?: string[];
  metadata?: Record<string, unknown>;
}

export interface GeneratedRoleDocument {
  role: RoleDefinition;
  markdown: string;
}

export interface ParsedTeamCommand {
  family: 'team-role' | 'team-struct' | 'team' | 'team-subagent' | 'team-agent' | 'team-run';
  subcommand: string;
  args: string[];
  raw: string;
  tokenErrors?: string[];
}

export const AGENT_TOOLS_SUBDIRS = [
  { name: '01-Skills', key: 'agent-skills', path: '03-AGENT-TOOLS/01-Skills' },
  { name: '02-Plugins', key: 'agent-plugins', path: '03-AGENT-TOOLS/02-Plugins' },
  { name: '03-Roles', key: 'roles', path: '03-AGENT-TOOLS/03-Roles' },
  { name: '04-Structs', key: 'structs', path: '03-AGENT-TOOLS/04-Structs' },
  { name: '05-Teams', key: 'teams', path: '03-AGENT-TOOLS/05-Teams' },
  { name: '06-Tasks', key: 'tasks', path: '03-AGENT-TOOLS/06-Tasks' },
  { name: '07-Messages', key: 'messages', path: '03-AGENT-TOOLS/07-Messages' },
  { name: '08-Docs', key: 'agent-docs', path: '03-AGENT-TOOLS/08-Docs' },
] as const;

export const TEAM_FILE_PATHS = {
  roles: '03-AGENT-TOOLS/03-Roles',
  structs: '03-AGENT-TOOLS/04-Structs',
  teams: '03-AGENT-TOOLS/05-Teams',
  tasks: '03-AGENT-TOOLS/06-Tasks',
  messages: '03-AGENT-TOOLS/07-Messages',
  docs: '03-AGENT-TOOLS/08-Docs',
} as const;

const PINYIN_MAP: Record<string, string> = {
  '前': 'qian', '端': 'duan', '后': 'hou', '测': 'ce', '试': 'shi',
  '架': 'jia', '构': 'gou', '安': 'an', '全': 'quan', '运': 'yun',
  '维': 'wei', '产': 'chan', '品': 'pin', '设': 'she', '计': 'ji',
  '开': 'kai', '发': 'fa', '审': 'shen', '查': 'cha', '验': 'yan',
  '评': 'ping', '估': 'gu', '监': 'jian', '控': 'kong', '数': 'shu',
  '据': 'ju', '接': 'jie', '口': 'kou', '界': 'jie', '面': 'mian',
  '组': 'zu', '件': 'jian', '服': 'fu', '务': 'wu', '配': 'pei',
  '置': 'zhi', '部': 'bu', '署': 'shu', '流': 'liu', '程': 'cheng',
  '协': 'xie', '作': 'zuo', '调': 'diao', '度': 'du', '执': 'zhi',
  '行': 'xing', '管': 'guan', '理': 'li', '分': 'fen', '析': 'xi',
  '优': 'you', '化': 'hua', '集': 'ji', '成': 'cheng', '回': 'hui',
  '归': 'gui', '排': 'pai', '障': 'zhang', '修': 'xiu', '复': 'fu',
  '升': 'sheng', '级': 'ji', '并': 'bing', '独': 'du', '立': 'li',
};

const COMPOUND_MAP: Record<string, string> = {
  '前端': 'frontend', '后端': 'backend', '测试': 'qa', '架构': 'architect',
  '安全': 'security', '运维': 'devops', '产品': 'pm', '设计': 'designer',
  '开发': 'developer', '审查': 'reviewer', '验证': 'validator',
  '回归': 'regression', '排障': 'troubleshoot', '修复': 'fix',
  '集成': 'integration', '并行': 'parallel', '协作': 'collaboration',
  '部署': 'deploy', '监控': 'monitor', '分析': 'analyst',
  '优化': 'optimizer', '管理': 'manager', '接口': 'api',
  '界面': 'ui', '组件': 'component', '服务': 'service',
  '配置': 'config', '流程': 'workflow', '调度': 'scheduler',
  '执行': 'executor', '数据': 'data', '评估': 'evaluator',
};

export function slugify(name: string): string {
  let result = name.toLowerCase().trim();

  for (const [cn, en] of Object.entries(COMPOUND_MAP)) {
    result = result.replace(new RegExp(cn, 'g'), en);
  }

  result = result.replace(/[\u4e00-\u9fa5]/g, (ch) => {
    return PINYIN_MAP[ch] || ch;
  });

  return result
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}
