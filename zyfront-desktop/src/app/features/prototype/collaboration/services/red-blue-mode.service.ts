import { Injectable, signal } from '@angular/core';

// 攻防阶段类型
export type RedBluePhase = 'preparation' | 'scanning' | 'exploitation' | 'defense' | 'reporting' | 'result';

// 攻击向量类型
export type AttackVector = 'sql_injection' | 'xss' | 'csrf' | 'buffer_overflow' | 'authentication_bypass';

// 风险等级
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// 攻击策略接口
export interface AttackStrategy {
  id: string;
  name: string;
  vector: AttackVector;
  description: string;
  severity: RiskLevel;
  successProbability: number;
}

// 防御方案接口
export interface DefenseStrategy {
  id: string;
  name: string;
  description: string;
  effectiveness: number;
  targets: AttackVector[];
}

// 漏洞记录接口
export interface VulnerabilityRecord {
  id: string;
  discoveredBy: string;
  fixedBy: string | null;
  attack: AttackStrategy;
  defense: DefenseStrategy | null;
  timestamp: Date;
  status: 'discovered' | 'fixed' | 'open';
  riskScore: number;
}

// 红蓝团队接口
export interface RedBlueTeam {
  id: string;
  name: string;
  role: 'red' | 'blue';
  agentIds: string[];
  score: number;
  strategies: (AttackStrategy | DefenseStrategy)[];
}

// 攻防状态接口
export interface RedBlueState {
  phase: RedBluePhase;
  currentRound: number;
  totalRounds: number;
  redTeam: RedBlueTeam;
  blueTeam: RedBlueTeam;
  vulnerabilities: VulnerabilityRecord[];
  riskHistory: { round: number; risk: number }[];
  isActive: boolean;
  startTime: Date | null;
  endTime: Date | null;
  result: { winner: 'red' | 'blue' | 'draw' | null; redScore: number; blueScore: number; report: string } | null;
}

@Injectable({ providedIn: 'root' })
export class RedBlueModeService {
  private _state = signal<RedBlueState>({
    phase: 'preparation',
    currentRound: 0,
    totalRounds: 10,
    redTeam: {
      id: 'red',
      name: '红队',
      role: 'red',
      agentIds: [],
      score: 0,
      strategies: []
    },
    blueTeam: {
      id: 'blue',
      name: '蓝队',
      role: 'blue',
      agentIds: [],
      score: 0,
      strategies: []
    },
    vulnerabilities: [],
    riskHistory: [],
    isActive: false,
    startTime: null,
    endTime: null,
    result: null
  });

  state = this._state.asReadonly();

  // 预设攻击策略
  private attackStrategies: AttackStrategy[] = [
    { id: 'att1', name: 'SQL注入攻击', vector: 'sql_injection', description: '通过表单注入SQL代码', severity: 'critical', successProbability: 0.7 },
    { id: 'att2', name: 'XSS跨站脚本', vector: 'xss', description: '注入恶意脚本到网页', severity: 'high', successProbability: 0.65 },
    { id: 'att3', name: 'CSRF攻击', vector: 'csrf', description: '伪造用户请求', severity: 'high', successProbability: 0.55 },
    { id: 'att4', name: '缓冲区溢出', vector: 'buffer_overflow', description: '利用缓冲区溢出漏洞', severity: 'critical', successProbability: 0.5 },
    { id: 'att5', name: '认证绕过', vector: 'authentication_bypass', description: '绕过身份验证机制', severity: 'high', successProbability: 0.6 }
  ];

  // 预设防御策略
  private defenseStrategies: DefenseStrategy[] = [
    { id: 'def1', name: '输入验证', description: '严格验证用户输入', effectiveness: 0.9, targets: ['sql_injection', 'xss'] },
    { id: 'def2', name: '内容安全策略', description: '启用CSP防止XSS', effectiveness: 0.85, targets: ['xss'] },
    { id: 'def3', name: 'CSRF令牌', description: '使用CSRF令牌保护', effectiveness: 0.9, targets: ['csrf'] },
    { id: 'def4', name: '内存安全', description: '防止缓冲区溢出', effectiveness: 0.8, targets: ['buffer_overflow'] },
    { id: 'def5', name: '多因素认证', description: '增强身份验证', effectiveness: 0.85, targets: ['authentication_bypass'] }
  ];

  // 初始化攻防
  initialize(redAgentIds: string[], blueAgentIds: string[]): void {
    this._state.update(state => ({
      ...state,
      phase: 'preparation',
      currentRound: 0,
      redTeam: {
        ...state.redTeam,
        agentIds: redAgentIds,
        score: 0,
        strategies: this.getRandomAttackStrategies(3)
      },
      blueTeam: {
        ...state.blueTeam,
        agentIds: blueAgentIds,
        score: 0,
        strategies: this.getRandomDefenseStrategies(3)
      },
      vulnerabilities: [],
      riskHistory: [],
      isActive: false,
      startTime: null,
      endTime: null,
      result: null
    }));
  }

  // 启动攻防
  start(): void {
    this._state.update(state => ({
      ...state,
      isActive: true,
      phase: 'scanning',
      currentRound: 1,
      startTime: new Date()
    }));
  }

  // 执行红队攻击
  redTeamAttack(): void {
    if (!this.canRedAttack()) return;

    const attack = this.getRandomAttack();
    const success = Math.random() < attack.successProbability;

    if (success) {
      const vulnerability: VulnerabilityRecord = {
        id: `vuln-${Date.now()}`,
        discoveredBy: this._state().redTeam.agentIds[0],
        fixedBy: null,
        attack,
        defense: null,
        timestamp: new Date(),
        status: 'open',
        riskScore: this.calculateRiskScore(attack)
      };

      this._state.update(state => ({
        ...state,
        redTeam: {
          ...state.redTeam,
          score: state.redTeam.score + 10
        },
        vulnerabilities: [...state.vulnerabilities, vulnerability]
      }));
    }
  }

  // 执行蓝队防御
  blueTeamDefense(): void {
    if (!this.canBlueDefend()) return;

    const openVulns = this._state().vulnerabilities.filter(v => v.status === 'open');
    if (openVulns.length === 0) return;

    const vuln = openVulns[0];
    const defense = this.getMatchingDefense(vuln.attack.vector);

    if (defense) {
      const success = Math.random() < defense.effectiveness;

      if (success) {
        this._state.update(state => ({
          ...state,
          blueTeam: {
            ...state.blueTeam,
            score: state.blueTeam.score + 15
          },
          vulnerabilities: state.vulnerabilities.map(v =>
            v.id === vuln.id ? { ...v, status: 'fixed', fixedBy: state.blueTeam.agentIds[0], defense } : v
          )
        }));
      }
    }
  }

  // 进入下一阶段
  nextPhase(): void {
    const phases: RedBluePhase[] = ['preparation', 'scanning', 'exploitation', 'defense', 'reporting', 'result'];
    const currentIndex = phases.indexOf(this._state().phase);

    if (currentIndex < phases.length - 1) {
      const nextPhase = phases[currentIndex + 1];

      if (nextPhase === 'result') {
        this.determineWinner();
      }

      this._state.update(state => ({
        ...state,
        phase: nextPhase,
        currentRound: nextPhase === 'reporting' ? state.totalRounds : state.currentRound + (nextPhase === 'scanning' || nextPhase === 'exploitation' ? 1 : 0)
      }));
    }
  }

  // 确定胜负
  private determineWinner(): void {
    const redScore = this._state().redTeam.score;
    const blueScore = this._state().blueTeam.score;
    let winner: 'red' | 'blue' | 'draw';

    if (redScore > blueScore) {
      winner = 'red';
    } else if (blueScore > redScore) {
      winner = 'blue';
    } else {
      winner = 'draw';
    }

    const report = this.generateReport(winner, redScore, blueScore);

    this._state.update(state => ({
      ...state,
      isActive: false,
      endTime: new Date(),
      result: {
        winner,
        redScore,
        blueScore,
        report
      }
    }));
  }

  // 生成攻防报告
  private generateReport(winner: 'red' | 'blue' | 'draw', redScore: number, blueScore: number): string {
    const vulns = this._state().vulnerabilities;
    const openVulns = vulns.filter(v => v.status === 'open');
    const fixedVulns = vulns.filter(v => v.status === 'fixed');

    return `
攻防演习报告

时间: ${new Date().toLocaleString()}
结果: ${winner === 'red' ? '红队获胜' : winner === 'blue' ? '蓝队获胜' : '平局'}

红队得分: ${redScore}
蓝队得分: ${blueScore}

发现漏洞: ${vulns.length}个
已修复漏洞: ${fixedVulns.length}个
未修复漏洞: ${openVulns.length}个

建议: ${openVulns.length > 0 ? '需要加强安全措施' : '安全状况良好'}
    `.trim();
  }

  // 获取随机攻击策略
  private getRandomAttackStrategies(count: number): AttackStrategy[] {
    const shuffled = [...this.attackStrategies].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  // 获取随机防御策略
  private getRandomDefenseStrategies(count: number): DefenseStrategy[] {
    const shuffled = [...this.defenseStrategies].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  // 获取随机攻击
  private getRandomAttack(): AttackStrategy {
    return this._state().redTeam.strategies[
      Math.floor(Math.random() * this._state().redTeam.strategies.length)
    ] as AttackStrategy;
  }

  // 获取匹配的防御策略
  private getMatchingDefense(attackVector: AttackVector): DefenseStrategy | null {
    const defenses = this._state().blueTeam.strategies as DefenseStrategy[];
    return defenses.find(d => d.targets.includes(attackVector)) || null;
  }

  // 计算风险评分
  private calculateRiskScore(attack: AttackStrategy): number {
    const weights: Record<RiskLevel, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };
    return weights[attack.severity] * 10;
  }

  // 检查红队是否可以攻击
  canRedAttack(): boolean {
    const phase = this._state().phase;
    return this._state().isActive && (phase === 'scanning' || phase === 'exploitation');
  }

  // 检查蓝队是否可以防御
  canBlueDefend(): boolean {
    const phase = this._state().phase;
    return this._state().isActive && phase === 'defense';
  }

  // 获取当前风险
  getCurrentRisk(): number {
    const openVulns = this._state().vulnerabilities.filter(v => v.status === 'open');
    return openVulns.reduce((sum, v) => sum + v.riskScore, 0);
  }

  // 重置攻防
  reset(): void {
    this._state.update(state => ({
      ...state,
      phase: 'preparation',
      currentRound: 0,
      redTeam: { ...state.redTeam, score: 0, strategies: [] },
      blueTeam: { ...state.blueTeam, score: 0, strategies: [] },
      vulnerabilities: [],
      riskHistory: [],
      isActive: false,
      startTime: null,
      endTime: null,
      result: null
    }));
  }
}
