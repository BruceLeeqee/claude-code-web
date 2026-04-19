import { Injectable, signal } from '@angular/core';

export interface OrchestrationTemplate {
  id: string;
  name: string;
  description: string;
  mode: 'coop' | 'pipeline' | 'storm' | 'contest' | 'battle';
  agents: TemplateAgent[];
  tasks: TemplateTask[];
  dependencies: TemplateDependency[];
  teamConfig: TeamConfig;
  debateTopic?: DebateTopicInfo; // 辩论主题信息（仅battle模式使用）
  createdAt: Date;
  lastUsed: Date | null;
  usageCount: number;
}

export interface DebateTopicInfo {
  title: string;
  description: string;
  affirmativeDescription: string;
  negativeDescription: string;
}

export interface TemplateAgent {
  id: string;
  name: string;
  role: 'architect' | 'analyst' | 'developer' | 'tester' | 'devops' | 'product';
  skills: string[];
  description: string;
}

export interface TemplateTask {
  id: string;
  title: string;
  description: string;
  assignedAgentId: string;
  priority: 'high' | 'medium' | 'low';
}

export interface TemplateDependency {
  fromTaskId: string;
  toTaskId: string;
}

export interface TeamConfig {
  teams: TeamDefinition[];
  roleGroups: RoleGroupDefinition[];
  assignmentRules: AssignmentRuleConfig[];
}

export interface TeamDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  quota: number;
  agentIds: string[];
}

export interface RoleGroupDefinition {
  id: string;
  name: string;
  role: string;
  teamId: string;
  agentIds: string[];
  assignmentStrategy: 'fixed' | 'round-robin' | 'load-balance' | 'broadcast';
}

export interface AssignmentRuleConfig {
  taskId: string;
  rule: 'fixed' | 'round-robin' | 'load-balance' | 'broadcast' | 'role-match';
  targetTeamId?: string;
  targetRoleGroupId?: string;
  targetAgentId?: string;
}

@Injectable({ providedIn: 'root' })
export class OrchestrationTemplatesService {
  readonly templates = signal<OrchestrationTemplate[]>([]);
  readonly selectedTemplate = signal<OrchestrationTemplate | null>(null);

  constructor() {
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    const defaultTemplates: OrchestrationTemplate[] = [
      // 辩论对抗模板
      {
        id: 'debate-template',
        name: '辩论对抗模板',
        description: '标准的辩论对抗模式，包含正反方和评委',
        mode: 'battle',
        debateTopic: {
          title: '是否应在企业内全面引入 AI 代码审查',
          description: '围绕交付质量、效率、风险与治理成本进行正反对抗。',
          affirmativeDescription: '全面引入可显著提升评审效率，并建立统一质量基线。',
          negativeDescription: '全面引入可能放大误判风险，且会增加治理与审计负担。',
        },
        agents: [
          { id: 'affirmative-1', name: '正方一辩', role: 'analyst', skills: ['辩论', '逻辑分析'], description: '正方第一发言人' },
          { id: 'affirmative-2', name: '正方二辩', role: 'analyst', skills: ['辩论', '逻辑分析'], description: '正方第二发言人' },
          { id: 'negative-1', name: '反方一辩', role: 'analyst', skills: ['辩论', '逻辑分析'], description: '反方第一发言人' },
          { id: 'negative-2', name: '反方二辩', role: 'analyst', skills: ['辩论', '逻辑分析'], description: '反方第二发言人' },
          { id: 'judge-1', name: '评委', role: 'architect', skills: ['评审', '决策'], description: '主评委' },
        ],
        tasks: [
          { id: 'task-1', title: '正方立论', description: '正方提出观点和论据', assignedAgentId: 'affirmative-1', priority: 'high' },
          { id: 'task-2', title: '反方立论', description: '反方提出观点和论据', assignedAgentId: 'negative-1', priority: 'high' },
          { id: 'task-3', title: '正方攻辩', description: '正方进行攻辩', assignedAgentId: 'affirmative-2', priority: 'medium' },
          { id: 'task-4', title: '反方攻辩', description: '反方进行攻辩', assignedAgentId: 'negative-2', priority: 'medium' },
          { id: 'task-5', title: '自由辩论', description: '双方自由辩论', assignedAgentId: 'affirmative-1', priority: 'high' },
          { id: 'task-6', title: '评委裁决', description: '评委进行评分和裁决', assignedAgentId: 'judge-1', priority: 'high' },
        ],
        dependencies: [
          { fromTaskId: 'task-1', toTaskId: 'task-2' },
          { fromTaskId: 'task-2', toTaskId: 'task-3' },
          { fromTaskId: 'task-3', toTaskId: 'task-4' },
          { fromTaskId: 'task-4', toTaskId: 'task-5' },
          { fromTaskId: 'task-5', toTaskId: 'task-6' },
        ],
        teamConfig: {
          teams: [
            { id: 'affirmative-team', name: '正方团队', description: '支持方辩论团队', color: '#22c55e', quota: 10, agentIds: ['affirmative-1', 'affirmative-2'] },
            { id: 'negative-team', name: '反方团队', description: '反对方辩论团队', color: '#ef4444', quota: 10, agentIds: ['negative-1', 'negative-2'] },
            { id: 'judge-team', name: '评审团队', description: '公共评审团队', color: '#f59e0b', quota: 5, agentIds: ['judge-1'] },
          ],
          roleGroups: [
            { id: 'affirmative-speakers', name: '正方发言人', role: 'analyst', teamId: 'affirmative-team', agentIds: ['affirmative-1', 'affirmative-2'], assignmentStrategy: 'round-robin' },
            { id: 'negative-speakers', name: '反方发言人', role: 'analyst', teamId: 'negative-team', agentIds: ['negative-1', 'negative-2'], assignmentStrategy: 'round-robin' },
            { id: 'judges', name: '评审组', role: 'architect', teamId: 'judge-team', agentIds: ['judge-1'], assignmentStrategy: 'fixed' },
          ],
          assignmentRules: [
            { taskId: 'task-1', rule: 'role-match', targetRoleGroupId: 'affirmative-speakers', targetAgentId: 'affirmative-1' },
            { taskId: 'task-2', rule: 'role-match', targetRoleGroupId: 'negative-speakers', targetAgentId: 'negative-1' },
            { taskId: 'task-3', rule: 'role-match', targetRoleGroupId: 'affirmative-speakers', targetAgentId: 'affirmative-2' },
            { taskId: 'task-4', rule: 'role-match', targetRoleGroupId: 'negative-speakers', targetAgentId: 'negative-2' },
            { taskId: 'task-5', rule: 'broadcast', targetRoleGroupId: 'affirmative-speakers' },
            { taskId: 'task-6', rule: 'fixed', targetRoleGroupId: 'judges', targetAgentId: 'judge-1' },
          ],
        },
        createdAt: new Date(),
        lastUsed: null,
        usageCount: 0,
      },

      // 红蓝攻防模板
      {
        id: 'redblue-template',
        name: '红蓝攻防模板',
        description: '安全攻防演练模式，包含红队、蓝队和裁判',
        mode: 'battle',
        agents: [
          { id: 'red-lead', name: '红队队长', role: 'developer', skills: ['攻击', '渗透'], description: '红队领导者' },
          { id: 'red-agent', name: '红队队员', role: 'developer', skills: ['攻击', '渗透'], description: '红队执行人员' },
          { id: 'blue-lead', name: '蓝队队长', role: 'devops', skills: ['防御', '监控'], description: '蓝队领导者' },
          { id: 'blue-agent', name: '蓝队队员', role: 'devops', skills: ['防御', '监控'], description: '蓝队执行人员' },
          { id: 'referee', name: '裁判', role: 'architect', skills: ['评估', '裁决'], description: '攻防裁判' },
        ],
        tasks: [
          { id: 'task-1', title: '攻击准备', description: '红队准备攻击策略', assignedAgentId: 'red-lead', priority: 'high' },
          { id: 'task-2', title: '防御部署', description: '蓝队部署防御措施', assignedAgentId: 'blue-lead', priority: 'high' },
          { id: 'task-3', title: '发起攻击', description: '红队发起攻击', assignedAgentId: 'red-agent', priority: 'high' },
          { id: 'task-4', title: '防御应对', description: '蓝队进行防御应对', assignedAgentId: 'blue-agent', priority: 'high' },
          { id: 'task-5', title: '漏洞记录', description: '记录发现的漏洞', assignedAgentId: 'referee', priority: 'medium' },
          { id: 'task-6', title: '风险评估', description: '评估安全风险', assignedAgentId: 'referee', priority: 'high' },
        ],
        dependencies: [
          { fromTaskId: 'task-1', toTaskId: 'task-2' },
          { fromTaskId: 'task-2', toTaskId: 'task-3' },
          { fromTaskId: 'task-3', toTaskId: 'task-4' },
          { fromTaskId: 'task-4', toTaskId: 'task-5' },
          { fromTaskId: 'task-5', toTaskId: 'task-6' },
        ],
        teamConfig: {
          teams: [
            { id: 'red-team', name: '红队', description: '攻击方团队', color: '#ef4444', quota: 10, agentIds: ['red-lead', 'red-agent'] },
            { id: 'blue-team', name: '蓝队', description: '防御方团队', color: '#3b82f6', quota: 10, agentIds: ['blue-lead', 'blue-agent'] },
            { id: 'referee-team', name: '裁判团队', description: '公共评审团队', color: '#f59e0b', quota: 5, agentIds: ['referee'] },
          ],
          roleGroups: [
            { id: 'red-attackers', name: '红队攻击组', role: 'developer', teamId: 'red-team', agentIds: ['red-lead', 'red-agent'], assignmentStrategy: 'load-balance' },
            { id: 'blue-defenders', name: '蓝队防御组', role: 'devops', teamId: 'blue-team', agentIds: ['blue-lead', 'blue-agent'], assignmentStrategy: 'load-balance' },
            { id: 'referees', name: '裁判组', role: 'architect', teamId: 'referee-team', agentIds: ['referee'], assignmentStrategy: 'fixed' },
          ],
          assignmentRules: [
            { taskId: 'task-1', rule: 'fixed', targetRoleGroupId: 'red-attackers', targetAgentId: 'red-lead' },
            { taskId: 'task-2', rule: 'fixed', targetRoleGroupId: 'blue-defenders', targetAgentId: 'blue-lead' },
            { taskId: 'task-3', rule: 'load-balance', targetRoleGroupId: 'red-attackers', targetAgentId: 'red-agent' },
            { taskId: 'task-4', rule: 'load-balance', targetRoleGroupId: 'blue-defenders', targetAgentId: 'blue-agent' },
            { taskId: 'task-5', rule: 'fixed', targetRoleGroupId: 'referees', targetAgentId: 'referee' },
            { taskId: 'task-6', rule: 'fixed', targetRoleGroupId: 'referees', targetAgentId: 'referee' },
          ],
        },
        createdAt: new Date(),
        lastUsed: null,
        usageCount: 0,
      },

      // 协作开发模板
      {
        id: 'coop-template',
        name: '协作开发模板',
        description: '标准的协作开发模式，包含多个开发角色',
        mode: 'coop',
        agents: [
          { id: 'arch', name: '架构师', role: 'architect', skills: ['系统设计', '架构'], description: '负责系统架构' },
          { id: 'dev1', name: '前端开发者', role: 'developer', skills: ['前端开发', 'UI'], description: '前端开发' },
          { id: 'dev2', name: '后端开发者', role: 'developer', skills: ['后端开发', 'API'], description: '后端开发' },
          { id: 'tester', name: '测试员', role: 'tester', skills: ['测试', 'QA'], description: '质量保证' },
          { id: 'devops', name: 'DevOps', role: 'devops', skills: ['部署', '运维'], description: '运维和部署' },
        ],
        tasks: [
          { id: 'task-1', title: '需求分析', description: '分析项目需求', assignedAgentId: 'arch', priority: 'high' },
          { id: 'task-2', title: '架构设计', description: '设计系统架构', assignedAgentId: 'arch', priority: 'high' },
          { id: 'task-3', title: '前端开发', description: '开发前端界面', assignedAgentId: 'dev1', priority: 'medium' },
          { id: 'task-4', title: '后端开发', description: '开发后端接口', assignedAgentId: 'dev2', priority: 'medium' },
          { id: 'task-5', title: '集成测试', description: '进行集成测试', assignedAgentId: 'tester', priority: 'high' },
          { id: 'task-6', title: '部署上线', description: '部署到生产环境', assignedAgentId: 'devops', priority: 'medium' },
        ],
        dependencies: [
          { fromTaskId: 'task-1', toTaskId: 'task-2' },
          { fromTaskId: 'task-2', toTaskId: 'task-3' },
          { fromTaskId: 'task-2', toTaskId: 'task-4' },
          { fromTaskId: 'task-3', toTaskId: 'task-5' },
          { fromTaskId: 'task-4', toTaskId: 'task-5' },
          { fromTaskId: 'task-5', toTaskId: 'task-6' },
        ],
        teamConfig: {
          teams: [
            { id: 'dev-team', name: '开发团队', description: '项目开发团队', color: '#22c55e', quota: 20, agentIds: ['arch', 'dev1', 'dev2', 'tester', 'devops'] },
          ],
          roleGroups: [
            { id: 'architects', name: '架构组', role: 'architect', teamId: 'dev-team', agentIds: ['arch'], assignmentStrategy: 'fixed' },
            { id: 'frontend-devs', name: '前端开发组', role: 'developer', teamId: 'dev-team', agentIds: ['dev1'], assignmentStrategy: 'fixed' },
            { id: 'backend-devs', name: '后端开发组', role: 'developer', teamId: 'dev-team', agentIds: ['dev2'], assignmentStrategy: 'fixed' },
            { id: 'testers', name: '测试组', role: 'tester', teamId: 'dev-team', agentIds: ['tester'], assignmentStrategy: 'fixed' },
            { id: 'devops-team', name: '运维组', role: 'devops', teamId: 'dev-team', agentIds: ['devops'], assignmentStrategy: 'fixed' },
          ],
          assignmentRules: [
            { taskId: 'task-1', rule: 'role-match', targetRoleGroupId: 'architects', targetAgentId: 'arch' },
            { taskId: 'task-2', rule: 'role-match', targetRoleGroupId: 'architects', targetAgentId: 'arch' },
            { taskId: 'task-3', rule: 'role-match', targetRoleGroupId: 'frontend-devs', targetAgentId: 'dev1' },
            { taskId: 'task-4', rule: 'role-match', targetRoleGroupId: 'backend-devs', targetAgentId: 'dev2' },
            { taskId: 'task-5', rule: 'role-match', targetRoleGroupId: 'testers', targetAgentId: 'tester' },
            { taskId: 'task-6', rule: 'role-match', targetRoleGroupId: 'devops-team', targetAgentId: 'devops' },
          ],
        },
        createdAt: new Date(),
        lastUsed: null,
        usageCount: 0,
      },

      // 竞赛冲刺模板
      {
        id: 'sprint-template',
        name: '竞赛冲刺模板',
        description: '多Agent并行竞赛模式，适合快速任务完成',
        mode: 'contest',
        agents: [
          { id: 'agent1', name: '竞争者1', role: 'developer', skills: ['快速开发'], description: '竞赛参与者' },
          { id: 'agent2', name: '竞争者2', role: 'developer', skills: ['快速开发'], description: '竞赛参与者' },
          { id: 'agent3', name: '竞争者3', role: 'developer', skills: ['快速开发'], description: '竞赛参与者' },
          { id: 'judge', name: '裁判', role: 'tester', skills: ['评估', '评分'], description: '竞赛裁判' },
        ],
        tasks: [
          { id: 'task-1', title: '竞赛准备', description: '准备竞赛环境', assignedAgentId: 'judge', priority: 'high' },
          { id: 'task-2', title: '方案设计', description: '各自设计解决方案', assignedAgentId: 'agent1', priority: 'high' },
          { id: 'task-3', title: '方案实现', description: '实现解决方案', assignedAgentId: 'agent1', priority: 'high' },
          { id: 'task-4', title: '方案评估', description: '评估各方案质量', assignedAgentId: 'judge', priority: 'high' },
          { id: 'task-5', title: '冠军裁决', description: '确定最终冠军', assignedAgentId: 'judge', priority: 'high' },
        ],
        dependencies: [
          { fromTaskId: 'task-1', toTaskId: 'task-2' },
          { fromTaskId: 'task-2', toTaskId: 'task-3' },
          { fromTaskId: 'task-3', toTaskId: 'task-4' },
          { fromTaskId: 'task-4', toTaskId: 'task-5' },
        ],
        teamConfig: {
          teams: [
            { id: 'contestant-team-1', name: '参赛团队1', description: '第一支参赛团队', color: '#ef4444', quota: 5, agentIds: ['agent1'] },
            { id: 'contestant-team-2', name: '参赛团队2', description: '第二支参赛团队', color: '#3b82f6', quota: 5, agentIds: ['agent2'] },
            { id: 'contestant-team-3', name: '参赛团队3', description: '第三支参赛团队', color: '#22c55e', quota: 5, agentIds: ['agent3'] },
            { id: 'judge-team', name: '评审团队', description: '竞赛评审团队', color: '#f59e0b', quota: 5, agentIds: ['judge'] },
          ],
          roleGroups: [
            { id: 'contestant-1', name: '参赛者1', role: 'developer', teamId: 'contestant-team-1', agentIds: ['agent1'], assignmentStrategy: 'fixed' },
            { id: 'contestant-2', name: '参赛者2', role: 'developer', teamId: 'contestant-team-2', agentIds: ['agent2'], assignmentStrategy: 'fixed' },
            { id: 'contestant-3', name: '参赛者3', role: 'developer', teamId: 'contestant-team-3', agentIds: ['agent3'], assignmentStrategy: 'fixed' },
            { id: 'contest-judges', name: '评审组', role: 'tester', teamId: 'judge-team', agentIds: ['judge'], assignmentStrategy: 'fixed' },
          ],
          assignmentRules: [
            { taskId: 'task-1', rule: 'fixed', targetRoleGroupId: 'contest-judges', targetAgentId: 'judge' },
            { taskId: 'task-2', rule: 'broadcast', targetTeamId: 'contestant-team-1' },
            { taskId: 'task-3', rule: 'broadcast', targetTeamId: 'contestant-team-1' },
            { taskId: 'task-4', rule: 'fixed', targetRoleGroupId: 'contest-judges', targetAgentId: 'judge' },
            { taskId: 'task-5', rule: 'fixed', targetRoleGroupId: 'contest-judges', targetAgentId: 'judge' },
          ],
        },
        createdAt: new Date(),
        lastUsed: null,
        usageCount: 0,
      },

      // 脑暴模式模板
      {
        id: 'storm-template',
        name: '头脑风暴模板',
        description: '头脑风暴模式，适合创意发散和方案讨论',
        mode: 'storm',
        agents: [
          { id: 'moderator', name: '主持人', role: 'product', skills: ['引导', '总结'], description: '脑暴主持人' },
          { id: 'creative1', name: '创意1', role: 'analyst', skills: ['创意', '发散'], description: '创意贡献者' },
          { id: 'creative2', name: '创意2', role: 'analyst', skills: ['创意', '发散'], description: '创意贡献者' },
          { id: 'critic', name: '批评者', role: 'tester', skills: ['批判', '验证'], description: '方案验证者' },
        ],
        tasks: [
          { id: 'task-1', title: '问题定义', description: '明确要解决的问题', assignedAgentId: 'moderator', priority: 'high' },
          { id: 'task-2', title: '创意发散', description: '自由提出各种想法', assignedAgentId: 'creative1', priority: 'high' },
          { id: 'task-3', title: '方案整理', description: '整理和分类创意', assignedAgentId: 'moderator', priority: 'medium' },
          { id: 'task-4', title: '方案评估', description: '评估各方案可行性', assignedAgentId: 'critic', priority: 'high' },
          { id: 'task-5', title: '方案选择', description: '选择最佳方案', assignedAgentId: 'moderator', priority: 'high' },
        ],
        dependencies: [
          { fromTaskId: 'task-1', toTaskId: 'task-2' },
          { fromTaskId: 'task-2', toTaskId: 'task-3' },
          { fromTaskId: 'task-3', toTaskId: 'task-4' },
          { fromTaskId: 'task-4', toTaskId: 'task-5' },
        ],
        teamConfig: {
          teams: [
            { id: 'brainstorm-team', name: '脑暴团队', description: '创意脑暴团队', color: '#a855f7', quota: 15, agentIds: ['moderator', 'creative1', 'creative2', 'critic'] },
          ],
          roleGroups: [
            { id: 'moderators', name: '主持组', role: 'product', teamId: 'brainstorm-team', agentIds: ['moderator'], assignmentStrategy: 'fixed' },
            { id: 'creatives', name: '创意组', role: 'analyst', teamId: 'brainstorm-team', agentIds: ['creative1', 'creative2'], assignmentStrategy: 'broadcast' },
            { id: 'critics', name: '评审组', role: 'tester', teamId: 'brainstorm-team', agentIds: ['critic'], assignmentStrategy: 'fixed' },
          ],
          assignmentRules: [
            { taskId: 'task-1', rule: 'fixed', targetRoleGroupId: 'moderators', targetAgentId: 'moderator' },
            { taskId: 'task-2', rule: 'broadcast', targetRoleGroupId: 'creatives' },
            { taskId: 'task-3', rule: 'fixed', targetRoleGroupId: 'moderators', targetAgentId: 'moderator' },
            { taskId: 'task-4', rule: 'fixed', targetRoleGroupId: 'critics', targetAgentId: 'critic' },
            { taskId: 'task-5', rule: 'fixed', targetRoleGroupId: 'moderators', targetAgentId: 'moderator' },
          ],
        },
        createdAt: new Date(),
        lastUsed: null,
        usageCount: 0,
      },
    ];

    this.templates.set(defaultTemplates);
  }

  getTemplateById(id: string): OrchestrationTemplate | undefined {
    return this.templates().find(t => t.id === id);
  }

  getTemplatesByMode(mode: OrchestrationTemplate['mode']): OrchestrationTemplate[] {
    return this.templates().filter(t => t.mode === mode);
  }

  selectTemplate(template: OrchestrationTemplate): void {
    this.selectedTemplate.set(template);
    this.incrementUsage(template.id);
  }

  incrementUsage(templateId: string): void {
    this.templates.update(templates => 
      templates.map(t => 
        t.id === templateId 
          ? { ...t, usageCount: t.usageCount + 1, lastUsed: new Date() }
          : t
      )
    );
  }

  createCustomTemplate(template: Omit<OrchestrationTemplate, 'id' | 'createdAt' | 'lastUsed' | 'usageCount'>): OrchestrationTemplate {
    const newTemplate: OrchestrationTemplate = {
      ...template,
      id: `template-${Date.now()}`,
      createdAt: new Date(),
      lastUsed: null,
      usageCount: 0,
    };
    this.templates.update(templates => [...templates, newTemplate]);
    return newTemplate;
  }

  deleteTemplate(templateId: string): void {
    this.templates.update(templates => templates.filter(t => t.id !== templateId));
    if (this.selectedTemplate()?.id === templateId) {
      this.selectedTemplate.set(null);
    }
  }

  getMostUsedTemplates(limit: number = 5): OrchestrationTemplate[] {
    return [...this.templates()]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  getRecentlyUsedTemplates(limit: number = 5): OrchestrationTemplate[] {
    return [...this.templates()]
      .filter(t => t.lastUsed !== null)
      .sort((a, b) => (b.lastUsed?.getTime() || 0) - (a.lastUsed?.getTime() || 0))
      .slice(0, limit);
  }

  // 获取模板的团队配置
  getTeamConfigForTemplate(templateId: string): TeamConfig | null {
    const template = this.getTemplateById(templateId);
    return template?.teamConfig || null;
  }

  // 根据模式获取默认团队配置
  getDefaultTeamConfigForMode(mode: OrchestrationTemplate['mode']): TeamConfig | null {
    const templates = this.getTemplatesByMode(mode);
    if (templates.length > 0) {
      return templates[0].teamConfig;
    }
    return null;
  }

  // 获取任务分配规则
  getAssignmentRulesForTemplate(templateId: string): AssignmentRuleConfig[] {
    const template = this.getTemplateById(templateId);
    return template?.teamConfig?.assignmentRules || [];
  }

  // 获取角色组信息
  getRoleGroupsForTemplate(templateId: string): RoleGroupDefinition[] {
    const template = this.getTemplateById(templateId);
    return template?.teamConfig?.roleGroups || [];
  }

  // 获取团队列表
  getTeamsForTemplate(templateId: string): TeamDefinition[] {
    const template = this.getTemplateById(templateId);
    return template?.teamConfig?.teams || [];
  }
}
