import { Injectable, signal } from '@angular/core';

// 目标类型
export type GoalType = 'collaboration' | 'competition' | 'review' | 'security';

// 复杂度
export type Complexity = 'simple' | 'medium' | 'complex';

// 目标解析结果
export interface GoalAnalysis {
  type: GoalType;
  complexity: Complexity;
  suggestedMode: string;
  requiredRoles: string[];
  riskLevel: 'low' | 'medium' | 'high';
  estimatedTime: number;
}

// 自动团队配置
export interface AutoTeam {
  id: string;
  name: string;
  role: string;
  skills: string[];
  strategy: string;
}

// 自动任务
export interface AutoTask {
  id: string;
  title: string;
  description: string;
  priority: number;
  assigneeId: string | null;
  dependsOn: string[];
  estimatedDuration: number;
}

// 调度策略
export type SchedulingStrategy = 'sequential' | 'parallel' | 'competitive';

// 收敛策略
export type ConvergenceStrategy = 'score_threshold' | 'time_limit' | 'consensus';

// 自动编排结果
export interface AutoOrchestrationResult {
  analysis: GoalAnalysis;
  team: AutoTeam[];
  tasks: AutoTask[];
  schedulingStrategy: SchedulingStrategy;
  convergenceStrategy: ConvergenceStrategy;
}

@Injectable({ providedIn: 'root' })
export class AutoOrchestrationService {
  // 关键词到目标类型的映射
  private goalKeywords = {
    collaboration: ['协作', '合作', '一起', '团队', '共同'],
    competition: ['竞赛', '比赛', '对抗', '竞争', '优化'],
    review: ['评审', '评估', '选择', '方案', '投票'],
    security: ['安全', '漏洞', '防护', '攻防', '测试']
  };

  // 角色技能配置
  private roleSkills = {
    architect: ['架构设计', '系统分析', '技术选型'],
    developer: ['编码', '问题解决', '快速迭代'],
    tester: ['缺陷发现', '质量保证', '用户体验'],
    analyst: ['数据处理', '可视化', '报告生成'],
    product: ['用户体验', '市场分析', '产品规划']
  };

  // 复杂度评估
  analyzeGoal(description: string): GoalAnalysis {
    const words = description.split(/[，。\s]+/);

    let type: GoalType = 'collaboration';
    let maxScore = 0;

    // 确定目标类型
    for (const [t, keywords] of Object.entries(this.goalKeywords)) {
      const score = keywords.filter(k => words.includes(k)).length;
      if (score > maxScore) {
        maxScore = score;
        type = t as GoalType;
      }
    }

    // 评估复杂度
    const lengthScore = Math.min(3, words.length / 10);
    const hasTechnical = /[架构|系统|设计|实现|优化|复杂]/.test(description) ? 1 : 0;
    const complexity = lengthScore + hasTechnical <= 1 ? 'simple' :
                      lengthScore + hasTechnical <= 2 ? 'medium' : 'complex';

    // 推荐模式
    const modeMap: { [key in GoalType]: string } = {
      collaboration: 'coop',
      competition: 'contest',
      review: 'review',
      security: 'redblue'
    };

    // 风险评估
    const hasRiskWords = /[风险|问题|困难|挑战|复杂]/.test(description);
    const riskLevel = hasRiskWords && complexity === 'complex' ? 'high' :
                     hasRiskWords ? 'medium' : 'low';

    return {
      type,
      complexity,
      suggestedMode: modeMap[type],
      requiredRoles: this.getRequiredRoles(type, complexity),
      riskLevel,
      estimatedTime: this.estimateTime(complexity)
    };
  }

  // 获取需要的角色
  private getRequiredRoles(type: GoalType, complexity: Complexity): string[] {
    const baseRoles: string[] = [];

    switch (type) {
      case 'collaboration':
        baseRoles.push('architect', 'developer');
        break;
      case 'competition':
        baseRoles.push('developer', 'tester', 'analyst');
        break;
      case 'review':
        baseRoles.push('analyst', 'product', 'architect');
        break;
      case 'security':
        baseRoles.push('developer', 'tester');
        break;
    }

    if (complexity === 'complex') {
      baseRoles.push('analyst');
    }
    if (complexity === 'simple') {
      baseRoles.push('product');
    }

    return [...new Set(baseRoles)];
  }

  // 估算时间
  private estimateTime(complexity: Complexity): number {
    const times = { simple: 5, medium: 15, complex: 30 };
    return times[complexity];
  }

  // 自动生成团队
  generateTeam(analysis: GoalAnalysis): AutoTeam[] {
    const teams: AutoTeam[] = [];
    let idCounter = 0;

    analysis.requiredRoles.forEach(role => {
      teams.push({
        id: `auto-agent-${++idCounter}`,
        name: `${role.charAt(0).toUpperCase() + role.slice(1)} Agent`,
        role,
        skills: this.roleSkills[role as keyof typeof this.roleSkills],
        strategy: 'balanced'
      });
    });

    return teams;
  }

  // 自动拆分任务
  splitTasks(description: string, team: AutoTeam[], complexity: Complexity): AutoTask[] {
    const tasks: AutoTask[] = [];

    // 基础任务
    const baseTasks = [
      { title: '需求分析', role: 'analyst', priority: 1 },
      { title: '方案设计', role: 'architect', priority: 2 },
      { title: '任务实施', role: 'developer', priority: 3 },
      { title: '测试验证', role: 'tester', priority: 4 },
      { title: '总结报告', role: 'product', priority: 5 }
    ];

    // 根据复杂度决定任务数量
    const numTasks = complexity === 'simple' ? 3 :
                    complexity === 'medium' ? 4 : 5;

    baseTasks.slice(0, numTasks).forEach((task, index) => {
      const assignee = team.find(t => t.role === task.role) || team[0];
      tasks.push({
        id: `auto-task-${index + 1}`,
        title: task.title,
        description: `执行${task.title}工作: ${description.substring(0, 50)}...`,
        priority: task.priority,
        assigneeId: assignee.id,
        dependsOn: index > 0 ? [`auto-task-${index}`] : [],
        estimatedDuration: 5 + Math.random() * 10
      });
    });

    return tasks;
  }

  // 选择调度策略
  selectSchedulingStrategy(analysis: GoalAnalysis): SchedulingStrategy {
    switch (analysis.type) {
      case 'competition':
        return 'competitive';
      case 'security':
        return 'parallel';
      default:
        return analysis.complexity === 'simple' ? 'sequential' : 'parallel';
    }
  }

  // 选择收敛策略
  selectConvergenceStrategy(analysis: GoalAnalysis): ConvergenceStrategy {
    switch (analysis.riskLevel) {
      case 'high':
        return 'consensus';
      case 'medium':
        return 'score_threshold';
      default:
        return 'time_limit';
    }
  }

  // 完整的自动编排
  autoOrchestrate(goalDescription: string): AutoOrchestrationResult {
    const analysis = this.analyzeGoal(goalDescription);
    const team = this.generateTeam(analysis);
    const tasks = this.splitTasks(goalDescription, team, analysis.complexity);
    const schedulingStrategy = this.selectSchedulingStrategy(analysis);
    const convergenceStrategy = this.selectConvergenceStrategy(analysis);

    return {
      analysis,
      team,
      tasks,
      schedulingStrategy,
      convergenceStrategy
    };
  }

  // 获取编排建议
  getSuggestions(analysis: GoalAnalysis): string[] {
    const suggestions: string[] = [];

    suggestions.push(`建议使用模式: ${analysis.suggestedMode}`);
    suggestions.push(`预计耗时: ${analysis.estimatedTime}分钟`);

    if (analysis.complexity === 'complex') {
      suggestions.push('此任务较复杂，建议增加更多参与者');
    }

    if (analysis.riskLevel === 'high') {
      suggestions.push('风险较高，建议增加评审环节');
    }

    return suggestions;
  }
}
