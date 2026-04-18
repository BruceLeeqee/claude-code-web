# Agent Battle Arena 5种模式实现指南

## 1. 模式概述

Agent Battle Arena 支持5种不同的协作模式，每种模式都有其独特的实现逻辑和视觉效果：

1. **对抗模式 (Battle)**：智能体之间相互竞争，通过辩论和对抗产生最佳解决方案
2. **协作模式 (Coop)**：智能体之间相互配合，共同完成复杂任务
3. **流水线模式 (Pipeline)**：智能体按顺序处理任务，形成工作流
4. **脑暴模式 (Storm)**：智能体集体 brainstorm，产生创意和想法
5. **竞赛模式 (Contest)**：智能体参与竞赛，争夺资源和奖励

## 2. 核心架构

### 2.1 模式切换机制

模式切换通过 Angular 信号（Signal）实现，使用 `currentMode` 信号来跟踪当前激活的模式：

```typescript
import { Injectable, signal } from '@angular/core';

type CollaborationMode = 'battle' | 'coop' | 'pipeline' | 'storm' | 'contest';

@Injectable({ providedIn: 'root' })
export class ModeService {
  private readonly currentMode = signal<CollaborationMode>('battle');

  getMode() {
    return this.currentMode();
  }

  setMode(mode: CollaborationMode) {
    this.currentMode.set(mode);
  }

  mode$ = this.currentMode.asObservable();
}
```

### 2.2 模式状态管理

每种模式都有其独特的状态管理逻辑：

```typescript
interface ModeState {
  battle: BattleModeState;
  coop: CoopModeState;
  pipeline: PipelineModeState;
  storm: StormModeState;
  contest: ContestModeState;
}

interface BattleModeState {
  teams: TeamState[];
  score: Record<string, number>;
  currentTurn: string;
  debateTopic: string;
}

interface CoopModeState {
  agents: AgentState[];
  sharedGoal: string;
  progress: number; // 0-100%
  contributions: Record<string, number>;
}

interface PipelineModeState {
  stages: PipelineStage[];
  currentStage: number;
  tasks: TaskState[];
}

interface StormModeState {
  topics: string[];
  ideas: IdeaState[];
  votingResults: Record<string, number>;
}

interface ContestModeState {
  challenges: ChallengeState[];
  leaderboard: LeaderboardEntry[];
  activeChallenge: string;
}
```

## 3. 对抗模式 (Battle) 实现

### 3.1 功能概述

对抗模式是一种智能体之间相互竞争的模式，通过辩论和对抗产生最佳解决方案。主要功能包括：
- 团队对战
- 实时分数统计
- 辩论回合制
- 论点碰撞特效
- 胜负判定

### 3.2 界面布局

```html
<div class="battle-mode">
  <!-- 顶部分数板 -->
  <div class="battle-scoreboard">
    <div class="team-score team-alpha">
      <span class="team-name">TEAM ALPHA</span>
      <span class="team-score-value">{{ battleState.score['alpha'] }}</span>
    </div>
    <div class="vs-mark">VS</div>
    <div class="team-score team-beta">
      <span class="team-name">TEAM BETA</span>
      <span class="team-score-value">{{ battleState.score['beta'] }}</span>
    </div>
  </div>

  <!-- 辩论舞台 -->
  <div class="battle-stage">
    <!-- 智能体角色 -->
    <div class="agent-characters">
      <div class="agent character-alpha" [class.active]="battleState.currentTurn === 'alpha'">
        <div class="agent-sprite"></div>
        <div class="agent-name">ARCHITECT</div>
      </div>
      <div class="agent character-beta" [class.active]="battleState.currentTurn === 'beta'">
        <div class="agent-sprite"></div>
        <div class="agent-name">ANALYST</div>
      </div>
    </div>

    <!-- 论点碰撞特效 -->
    <div class="argument-collision" *ngIf="showCollisionEffect">
      <div class="collision-animation"></div>
    </div>

    <!-- 辩论主题 -->
    <div class="debate-topic">
      <h3>辩论主题: {{ battleState.debateTopic }}</h3>
    </div>

    <!-- 论点展示 -->
    <div class="arguments">
      <div class="argument team-alpha">
        <h4>Alpha 团队论点:</h4>
        <p>{{ alphaArgument }}</p>
      </div>
      <div class="argument team-beta">
        <h4>Beta 团队论点:</h4>
        <p>{{ betaArgument }}</p>
      </div>
    </div>
  </div>

  <!-- 控制按钮 -->
  <div class="battle-controls">
    <button class="control-btn" (click)="nextTurn()">下一轮</button>
    <button class="control-btn" (click)="resetBattle()">重置辩论</button>
    <button class="control-btn" (click)="endBattle()">结束辩论</button>
  </div>
</div>
```

### 3.3 实现逻辑

```typescript
@Injectable({ providedIn: 'root' })
export class BattleModeService {
  private readonly battleState = signal<BattleModeState>({
    teams: [
      { id: 'alpha', name: 'TEAM ALPHA', agents: [] },
      { id: 'beta', name: 'TEAM BETA', agents: [] }
    ],
    score: { alpha: 0, beta: 0 },
    currentTurn: 'alpha',
    debateTopic: '人工智能是否会取代人类工作'
  });

  // 获取当前状态
  getBattleState() {
    return this.battleState();
  }

  // 初始化辩论
  initBattle(topic: string, alphaAgents: Agent[], betaAgents: Agent[]) {
    this.battleState.set({
      teams: [
        { id: 'alpha', name: 'TEAM ALPHA', agents: alphaAgents },
        { id: 'beta', name: 'TEAM BETA', agents: betaAgents }
      ],
      score: { alpha: 0, beta: 0 },
      currentTurn: 'alpha',
      debateTopic: topic
    });
  }

  // 下一轮
  nextTurn() {
    this.battleState.update(current => {
      const nextTurn = current.currentTurn === 'alpha' ? 'beta' : 'alpha';
      return {
        ...current,
        currentTurn: nextTurn
      };
    });
  }

  // 评估论点
  evaluateArgument(teamId: string, argument: string) {
    // 简单的评分逻辑，实际项目中可以使用更复杂的算法
    const score = Math.floor(Math.random() * 10) + 1;
    
    this.battleState.update(current => {
      const newScore = { ...current.score };
      newScore[teamId] += score;
      return {
        ...current,
        score: newScore
      };
    });

    return score;
  }

  // 结束辩论
  endBattle() {
    const state = this.battleState();
    const winner = state.score.alpha > state.score.beta ? 'alpha' : 'beta';
    
    // 触发胜利特效
    this.triggerVictoryEffect(winner);
    
    return winner;
  }

  // 触发胜利特效
  private triggerVictoryEffect(winner: string) {
    // 实现胜利特效逻辑
  }
}
```

### 3.4 视觉效果

```css
/* 对抗模式样式 */
.battle-mode {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #1a1a2e;
  overflow: hidden;
}

.battle-scoreboard {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  background-color: #16213e;
  border-bottom: 2px solid #0f3460;
}

.team-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 40px;
}

.team-name {
  font-family: 'Press Start 2P', cursive;
  font-size: 16px;
  margin-bottom: 10px;
}

.team-alpha .team-name {
  color: #4ecdc4;
}

.team-beta .team-name {
  color: #ff6b6b;
}

.team-score-value {
  font-family: 'Press Start 2P', cursive;
  font-size: 24px;
  font-weight: bold;
}

.team-alpha .team-score-value {
  color: #4ecdc4;
}

.team-beta .team-score-value {
  color: #ff6b6b;
}

.vs-mark {
  font-family: 'Press Start 2P', cursive;
  font-size: 24px;
  color: #ffd93d;
  margin: 0 20px;
}

.battle-stage {
  position: relative;
  height: 600px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.agent-characters {
  display: flex;
  justify-content: space-around;
  width: 100%;
  margin-bottom: 40px;
}

.agent {
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: all 0.3s ease;
}

.agent.active {
  transform: scale(1.1);
  filter: brightness(1.3);
}

.agent-sprite {
  width: 100px;
  height: 100px;
  margin-bottom: 10px;
  animation: agent-idle 2s ease-in-out infinite;
}

.character-alpha .agent-sprite {
  background-color: #4ecdc4;
  border-radius: 50%;
}

.character-beta .agent-sprite {
  background-color: #ff6b6b;
  border-radius: 50%;
}

.agent-name {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
}

.argument-collision {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 200px;
  height: 200px;
  z-index: 10;
}

.collision-animation {
  width: 100%;
  height: 100%;
  background-color: #ffd93d;
  border-radius: 50%;
  animation: collision 1s ease-out forwards;
}

@keyframes collision {
  0% {
    transform: scale(0);
    opacity: 1;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}

@keyframes agent-idle {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.debate-topic {
  margin: 20px 0;
  text-align: center;
}

.debate-topic h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #ecf0f1;
  max-width: 600px;
}

.arguments {
  display: flex;
  justify-content: space-around;
  width: 100%;
  margin-top: 20px;
}

.argument {
  width: 45%;
  padding: 20px;
  border-radius: 8px;
  background-color: rgba(0, 0, 0, 0.5);
}

.argument h4 {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  margin-bottom: 10px;
}

.team-alpha .argument h4 {
  color: #4ecdc4;
}

.team-beta .argument h4 {
  color: #ff6b6b;
}

.argument p {
  font-family: 'VT323', monospace;
  font-size: 16px;
  color: #ecf0f1;
  line-height: 1.4;
}

.battle-controls {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.control-btn {
  margin: 0 10px;
  padding: 10px 20px;
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  background-color: #0f3460;
  color: #ecf0f1;
  border: 2px solid #4ecdc4;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.control-btn:hover {
  background-color: #4ecdc4;
  color: #1a1a2e;
}
```

## 4. 协作模式 (Coop) 实现

### 4.1 功能概述

协作模式是一种智能体之间相互配合，共同完成复杂任务的模式。主要功能包括：
- 共享目标设定
- 任务分配
- 进度跟踪
- 贡献度统计
- 团队协作可视化

### 4.2 界面布局

```html
<div class="coop-mode">
  <!-- 顶部共享目标 -->
  <div class="coop-header">
    <h2>共享目标: {{ coopState.sharedGoal }}</h2>
    <div class="progress-container">
      <div class="progress-bar" [style.width]="coopState.progress + '%'"></div>
      <span class="progress-text">{{ coopState.progress }}%</span>
    </div>
  </div>

  <!-- 智能体团队 -->
  <div class="coop-team">
    <div class="agent-card" *ngFor="let agent of coopState.agents">
      <div class="agent-avatar" [style.backgroundColor]="agent.color"></div>
      <div class="agent-info">
        <h3>{{ agent.name }}</h3>
        <p>{{ agent.role }}</p>
        <div class="contribution-bar">
          <div class="contribution-fill" [style.width]="(coopState.contributions[agent.id] || 0) + '%'"></div>
          <span class="contribution-text">{{ coopState.contributions[agent.id] || 0 }}%</span>
        </div>
      </div>
      <div class="agent-status" [class.active]="agent.status === 'running'">
        {{ agent.status.toUpperCase() }}
      </div>
    </div>
  </div>

  <!-- 任务板 -->
  <div class="coop-tasks">
    <h3>任务板</h3>
    <div class="task-list">
      <div class="task-item" *ngFor="let task of tasks">
        <div class="task-header">
          <h4>{{ task.title }}</h4>
          <span class="task-assignee">分配给: {{ task.assignee }}</span>
        </div>
        <div class="task-progress">
          <div class="task-progress-bar" [style.width]="task.progress + '%'"></div>
          <span class="task-progress-text">{{ task.progress }}%</span>
        </div>
        <div class="task-description">{{ task.description }}</div>
      </div>
    </div>
  </div>

  <!-- 协作网络图 -->
  <div class="coop-network">
    <h3>协作网络</h3>
    <div class="network-container" #networkContainer></div>
  </div>
</div>
```

### 4.3 实现逻辑

```typescript
@Injectable({ providedIn: 'root' })
export class CoopModeService {
  private readonly coopState = signal<CoopModeState>({
    agents: [],
    sharedGoal: '开发一个智能客服系统',
    progress: 0,
    contributions: {}
  });

  // 获取当前状态
  getCoopState() {
    return this.coopState();
  }

  // 初始化协作
  initCoop(goal: string, agents: Agent[]) {
    const contributions: Record<string, number> = {};
    agents.forEach(agent => {
      contributions[agent.id] = 0;
    });

    this.coopState.set({
      agents,
      sharedGoal: goal,
      progress: 0,
      contributions
    });
  }

  // 分配任务
  assignTask(task: Task, agentId: string) {
    // 实现任务分配逻辑
  }

  // 更新任务进度
  updateTaskProgress(taskId: string, progress: number) {
    // 实现任务进度更新逻辑
    
    // 更新整体进度
    this.updateOverallProgress();
  }

  // 更新智能体贡献度
  updateContribution(agentId: string, amount: number) {
    this.coopState.update(current => {
      const newContributions = { ...current.contributions };
      newContributions[agentId] = Math.min(100, (newContributions[agentId] || 0) + amount);
      return {
        ...current,
        contributions: newContributions
      };
    });
  }

  // 更新整体进度
  private updateOverallProgress() {
    // 实现整体进度计算逻辑
    this.coopState.update(current => {
      // 简单的进度计算，实际项目中可以使用更复杂的算法
      const totalContribution = Object.values(current.contributions).reduce((sum, value) => sum + value, 0);
      const avgContribution = totalContribution / Object.keys(current.contributions).length;
      return {
        ...current,
        progress: Math.min(100, Math.round(avgContribution))
      };
    });
  }

  // 完成目标
  completeGoal() {
    this.coopState.update(current => ({
      ...current,
      progress: 100
    }));

    // 触发完成特效
    this.triggerCompletionEffect();
  }

  // 触发完成特效
  private triggerCompletionEffect() {
    // 实现完成特效逻辑
  }
}
```

### 4.4 视觉效果

```css
/* 协作模式样式 */
.coop-mode {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #1a1a2e;
  overflow: hidden;
}

.coop-header {
  padding: 20px;
  background-color: #16213e;
  border-bottom: 2px solid #0f3460;
  text-align: center;
}

.coop-header h2 {
  font-family: 'Press Start 2P', cursive;
  font-size: 16px;
  color: #4ecdc4;
  margin-bottom: 20px;
}

.progress-container {
  position: relative;
  width: 80%;
  height: 20px;
  background-color: #0f3460;
  border-radius: 10px;
  margin: 0 auto;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background-color: #4ecdc4;
  border-radius: 10px;
  transition: width 0.5s ease;
  animation: progress-pulse 2s ease-in-out infinite;
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
}

.coop-team {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  padding: 20px;
  gap: 20px;
}

.agent-card {
  width: 250px;
  padding: 20px;
  background-color: #16213e;
  border-radius: 8px;
  border: 2px solid #0f3460;
  transition: all 0.3s ease;
}

.agent-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 5px 15px rgba(78, 205, 196, 0.3);
}

.agent-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  margin-bottom: 15px;
}

.agent-info h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
  margin-bottom: 5px;
}

.agent-info p {
  font-family: 'VT323', monospace;
  font-size: 14px;
  color: #95a5a6;
  margin-bottom: 15px;
}

.contribution-bar {
  position: relative;
  width: 100%;
  height: 10px;
  background-color: #0f3460;
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 10px;
}

.contribution-fill {
  height: 100%;
  background-color: #4ecdc4;
  border-radius: 5px;
  transition: width 0.5s ease;
}

.contribution-text {
  position: absolute;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
  font-family: 'VT323', monospace;
  font-size: 12px;
  color: #ecf0f1;
}

.agent-status {
  font-family: 'Press Start 2P', cursive;
  font-size: 10px;
  color: #95a5a6;
  text-align: right;
}

.agent-status.active {
  color: #4ecdc4;
  animation: status-pulse 2s ease-in-out infinite;
}

.coop-tasks {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.coop-tasks h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.task-item {
  padding: 15px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  border-left: 4px solid #4ecdc4;
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.task-header h4 {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
}

.task-assignee {
  font-family: 'VT323', monospace;
  font-size: 12px;
  color: #95a5a6;
}

.task-progress {
  position: relative;
  width: 100%;
  height: 8px;
  background-color: #0f3460;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
}

.task-progress-bar {
  height: 100%;
  background-color: #4ecdc4;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.task-progress-text {
  position: absolute;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
  font-family: 'VT323', monospace;
  font-size: 10px;
  color: #ecf0f1;
}

.task-description {
  font-family: 'VT323', monospace;
  font-size: 14px;
  color: #ecf0f1;
  line-height: 1.4;
}

.coop-network {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.coop-network h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.network-container {
  width: 100%;
  height: 300px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
}

@keyframes progress-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

@keyframes status-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
```

## 5. 流水线模式 (Pipeline) 实现

### 5.1 功能概述

流水线模式是一种智能体按顺序处理任务，形成工作流的模式。主要功能包括：
- 多阶段工作流
- 任务传递
- 状态转换
- 进度跟踪
- 瓶颈识别

### 5.2 界面布局

```html
<div class="pipeline-mode">
  <!-- 顶部流水线状态 -->
  <div class="pipeline-header">
    <h2>流水线模式</h2>
    <div class="pipeline-stats">
      <div class="stat-item">
        <span class="stat-label">当前阶段:</span>
        <span class="stat-value">{{ pipelineState.stages[pipelineState.currentStage]?.name || '未开始' }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">完成度:</span>
        <span class="stat-value">{{ calculateCompletion() }}%</span>
      </div>
    </div>
  </div>

  <!-- 流水线 stages -->
  <div class="pipeline-stages">
    <div 
      class="pipeline-stage" 
      *ngFor="let stage of pipelineState.stages; let i = index"
      [class.active]="i === pipelineState.currentStage"
      [class.completed]="i < pipelineState.currentStage"
    >
      <div class="stage-number">{{ i + 1 }}</div>
      <div class="stage-info">
        <h3>{{ stage.name }}</h3>
        <p>{{ stage.description }}</p>
        <div class="stage-agent">
          <span class="agent-label">负责智能体:</span>
          <span class="agent-name">{{ stage.agentName }}</span>
        </div>
      </div>
      <div class="stage-status">
        <span [class.status-completed]="i < pipelineState.currentStage">
          {{ i < pipelineState.currentStage ? '完成' : i === pipelineState.currentStage ? '进行中' : '等待' }}
        </span>
      </div>
    </div>
  </div>

  <!-- 任务队列 -->
  <div class="pipeline-tasks">
    <h3>任务队列</h3>
    <div class="task-queue">
      <div 
        class="task-card" 
        *ngFor="let task of pipelineState.tasks"
        [class.active]="task.stageIndex === pipelineState.currentStage"
      >
        <div class="task-header">
          <h4>{{ task.title }}</h4>
          <span class="task-stage">阶段 {{ task.stageIndex + 1 }}</span>
        </div>
        <div class="task-description">{{ task.description }}</div>
        <div class="task-status">
          <span [class]="'status-' + task.status">{{ task.status }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- 控制按钮 -->
  <div class="pipeline-controls">
    <button class="control-btn" (click)="prevStage()" [disabled]="pipelineState.currentStage === 0">上一阶段</button>
    <button class="control-btn" (click)="nextStage()" [disabled]="pipelineState.currentStage >= pipelineState.stages.length - 1">下一阶段</button>
    <button class="control-btn" (click)="resetPipeline()">重置流水线</button>
  </div>
</div>
```

### 5.3 实现逻辑

```typescript
@Injectable({ providedIn: 'root' })
export class PipelineModeService {
  private readonly pipelineState = signal<PipelineModeState>({
    stages: [],
    currentStage: 0,
    tasks: []
  });

  // 获取当前状态
  getPipelineState() {
    return this.pipelineState();
  }

  // 初始化流水线
  initPipeline(stages: PipelineStage[], tasks: TaskState[]) {
    this.pipelineState.set({
      stages,
      currentStage: 0,
      tasks
    });
  }

  // 上一阶段
  prevStage() {
    this.pipelineState.update(current => {
      if (current.currentStage > 0) {
        return {
          ...current,
          currentStage: current.currentStage - 1
        };
      }
      return current;
    });
  }

  // 下一阶段
  nextStage() {
    this.pipelineState.update(current => {
      if (current.currentStage < current.stages.length - 1) {
        // 标记当前阶段的任务为完成
        const updatedTasks = current.tasks.map(task => {
          if (task.stageIndex === current.currentStage) {
            return { ...task, status: 'completed' };
          }
          return task;
        });

        return {
          ...current,
          currentStage: current.currentStage + 1,
          tasks: updatedTasks
        };
      }
      return current;
    });
  }

  // 更新任务状态
  updateTaskStatus(taskId: string, status: TaskStatus) {
    this.pipelineState.update(current => {
      const updatedTasks = current.tasks.map(task => {
        if (task.id === taskId) {
          return { ...task, status };
        }
        return task;
      });
      return {
        ...current,
        tasks: updatedTasks
      };
    });
  }

  // 重置流水线
  resetPipeline() {
    this.pipelineState.update(current => {
      const resetTasks = current.tasks.map(task => ({
        ...task,
        status: 'unassigned'
      }));
      return {
        ...current,
        currentStage: 0,
        tasks: resetTasks
      };
    });
  }

  // 计算完成度
  calculateCompletion() {
    const state = this.pipelineState();
    const totalStages = state.stages.length;
    const completedStages = state.currentStage;
    return Math.round((completedStages / totalStages) * 100);
  }
}
```

### 5.4 视觉效果

```css
/* 流水线模式样式 */
.pipeline-mode {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #1a1a2e;
  overflow: hidden;
}

.pipeline-header {
  padding: 20px;
  background-color: #16213e;
  border-bottom: 2px solid #0f3460;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pipeline-header h2 {
  font-family: 'Press Start 2P', cursive;
  font-size: 16px;
  color: #4ecdc4;
}

.pipeline-stats {
  display: flex;
  gap: 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.stat-label {
  font-family: 'VT323', monospace;
  font-size: 12px;
  color: #95a5a6;
}

.stat-value {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
}

.pipeline-stages {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.pipeline-stage {
  display: flex;
  align-items: center;
  padding: 20px;
  background-color: #16213e;
  border-radius: 8px;
  border: 2px solid #0f3460;
  transition: all 0.3s ease;
  position: relative;
}

.pipeline-stage::before {
  content: '';
  position: absolute;
  left: 30px;
  top: 100%;
  width: 2px;
  height: 15px;
  background-color: #0f3460;
}

.pipeline-stage:last-child::before {
  display: none;
}

.pipeline-stage.active {
  border-color: #4ecdc4;
  background-color: rgba(78, 205, 196, 0.1);
}

.pipeline-stage.completed {
  border-color: #27ae60;
  background-color: rgba(39, 174, 96, 0.1);
}

.stage-number {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: #0f3460;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Press Start 2P', cursive;
  font-size: 16px;
  color: #ecf0f1;
  margin-right: 20px;
  z-index: 1;
}

.pipeline-stage.active .stage-number {
  background-color: #4ecdc4;
  color: #1a1a2e;
}

.pipeline-stage.completed .stage-number {
  background-color: #27ae60;
  color: #1a1a2e;
}

.stage-info {
  flex: 1;
}

.stage-info h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #ecf0f1;
  margin-bottom: 5px;
}

.stage-info p {
  font-family: 'VT323', monospace;
  font-size: 14px;
  color: #95a5a6;
  margin-bottom: 10px;
}

.stage-agent {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-label {
  font-family: 'VT323', monospace;
  font-size: 12px;
  color: #95a5a6;
}

.agent-name {
  font-family: 'Press Start 2P', cursive;
  font-size: 10px;
  color: #4ecdc4;
}

.stage-status {
  margin-left: 20px;
}

.stage-status span {
  font-family: 'Press Start 2P', cursive;
  font-size: 10px;
  color: #95a5a6;
}

.status-completed {
  color: #27ae60 !important;
}

.pipeline-stage.active .stage-status span {
  color: #4ecdc4;
  animation: status-pulse 2s ease-in-out infinite;
}

.pipeline-tasks {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.pipeline-tasks h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.task-queue {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-card {
  padding: 15px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  border-left: 4px solid #0f3460;
  transition: all 0.3s ease;
}

.task-card.active {
  border-left-color: #4ecdc4;
  background-color: rgba(78, 205, 196, 0.1);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.task-header h4 {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
}

.task-stage {
  font-family: 'VT323', monospace;
  font-size: 12px;
  color: #95a5a6;
}

.task-description {
  font-family: 'VT323', monospace;
  font-size: 14px;
  color: #ecf0f1;
  margin-bottom: 10px;
  line-height: 1.4;
}

.task-status {
  text-align: right;
}

.task-status span {
  font-family: 'Press Start 2P', cursive;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 12px;
}

.status-unassigned {
  color: #95a5a6;
  background-color: rgba(149, 165, 166, 0.2);
}

.status-assigned {
  color: #3498db;
  background-color: rgba(52, 152, 219, 0.2);
}

.status-running {
  color: #f39c12;
  background-color: rgba(243, 156, 18, 0.2);
  animation: status-pulse 2s ease-in-out infinite;
}

.status-completed {
  color: #27ae60;
  background-color: rgba(39, 174, 96, 0.2);
}

.status-failed {
  color: #e74c3c;
  background-color: rgba(231, 76, 60, 0.2);
}

.pipeline-controls {
  display: flex;
  justify-content: center;
  margin: 20px;
  gap: 15px;
}

.control-btn {
  padding: 10px 20px;
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  background-color: #0f3460;
  color: #ecf0f1;
  border: 2px solid #4ecdc4;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.control-btn:hover:not(:disabled) {
  background-color: #4ecdc4;
  color: #1a1a2e;
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes status-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
```

## 6. 脑暴模式 (Storm) 实现

### 6.1 功能概述

脑暴模式是一种智能体集体 brainstorm，产生创意和想法的模式。主要功能包括：
- 主题设定
- 想法生成
- 投票评分
- 想法分类
- 创意可视化

### 6.2 界面布局

```html
<div class="storm-mode">
  <!-- 顶部脑暴主题 -->
  <div class="storm-header">
    <h2>脑暴模式</h2>
    <div class="storm-topic">
      <h3>当前主题: {{ stormState.topics[0] || '未设定' }}</h3>
      <button class="topic-btn" (click)="changeTopic()">更换主题</button>
    </div>
  </div>

  <!-- 想法生成区域 -->
  <div class="storm-generation">
    <h3>想法生成</h3>
    <div class="idea-input">
      <textarea placeholder="输入你的想法..." [(ngModel)]="newIdea"></textarea>
      <button class="add-idea-btn" (click)="addIdea()">添加想法</button>
    </div>
  </div>

  <!-- 想法展示区域 -->
  <div class="storm-ideas">
    <h3>想法列表</h3>
    <div class="idea-grid">
      <div class="idea-card" *ngFor="let idea of stormState.ideas">
        <div class="idea-header">
          <h4>{{ idea.content }}</h4>
          <span class="idea-author">by {{ idea.author }}</span>
        </div>
        <div class="idea-votes">
          <button class="vote-btn" (click)="voteIdea(idea.id, 'up')">↑</button>
          <span class="vote-count">{{ stormState.votingResults[idea.id] || 0 }}</span>
          <button class="vote-btn" (click)="voteIdea(idea.id, 'down')">↓</button>
        </div>
        <div class="idea-tags">
          <span class="tag" *ngFor="let tag of idea.tags">{{ tag }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- 投票结果 -->
  <div class="storm-results">
    <h3>投票结果</h3>
    <div class="results-chart" #resultsChart></div>
  </div>

  <!-- 控制按钮 -->
  <div class="storm-controls">
    <button class="control-btn" (click)="startBrainstorm()">开始脑暴</button>
    <button class="control-btn" (click)="stopBrainstorm()">停止脑暴</button>
    <button class="control-btn" (click)="clearIdeas()">清除想法</button>
  </div>
</div>
```

### 6.3 实现逻辑

```typescript
@Injectable({ providedIn: 'root' })
export class StormModeService {
  private readonly stormState = signal<StormModeState>({
    topics: ['如何提高团队协作效率', '智能体如何更好地理解用户需求', '未来AI发展趋势'],
    ideas: [],
    votingResults: {}
  });

  // 获取当前状态
  getStormState() {
    return this.stormState();
  }

  // 开始脑暴
  startBrainstorm() {
    // 实现脑暴开始逻辑
  }

  // 停止脑暴
  stopBrainstorm() {
    // 实现脑暴停止逻辑
  }

  // 更换主题
  changeTopic() {
    this.stormState.update(current => {
      const currentIndex = current.topics.indexOf(current.topics[0]);
      const nextIndex = (currentIndex + 1) % current.topics.length;
      const newTopics = [current.topics[nextIndex], ...current.topics.filter((_, index) => index !== nextIndex)];
      return {
        ...current,
        topics: newTopics
      };
    });
  }

  // 添加想法
  addIdea(content: string, author: string) {
    const idea: IdeaState = {
      id: `idea-${Date.now()}`,
      content,
      author,
      tags: this.generateTags(content),
      timestamp: Date.now()
    };

    this.stormState.update(current => ({
      ...current,
      ideas: [idea, ...current.ideas]
    }));
  }

  // 投票想法
  voteIdea(ideaId: string, direction: 'up' | 'down') {
    this.stormState.update(current => {
      const newVotingResults = { ...current.votingResults };
      const currentVotes = newVotingResults[ideaId] || 0;
      newVotingResults[ideaId] = direction === 'up' ? currentVotes + 1 : currentVotes - 1;
      return {
        ...current,
        votingResults: newVotingResults
      };
    });
  }

  // 生成标签
  private generateTags(content: string): string[] {
    // 简单的标签生成逻辑，实际项目中可以使用更复杂的NLP算法
    const commonTags = ['创意', '技术', '用户体验', '效率', '创新', '协作'];
    return commonTags.slice(0, Math.floor(Math.random() * 3) + 1);
  }

  // 清除想法
  clearIdeas() {
    this.stormState.update(current => ({
      ...current,
      ideas: [],
      votingResults: {}
    }));
  }

  // 获取热门想法
  getTopIdeas(limit: number = 5) {
    const state = this.stormState();
    return [...state.ideas]
      .sort((a, b) => (state.votingResults[b.id] || 0) - (state.votingResults[a.id] || 0))
      .slice(0, limit);
  }
}
```

### 6.4 视觉效果

```css
/* 脑暴模式样式 */
.storm-mode {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #1a1a2e;
  overflow: hidden;
}

.storm-header {
  padding: 20px;
  background-color: #16213e;
  border-bottom: 2px solid #0f3460;
  text-align: center;
}

.storm-header h2 {
  font-family: 'Press Start 2P', cursive;
  font-size: 16px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.storm-topic {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
}

.storm-topic h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #ecf0f1;
}

.topic-btn {
  padding: 8px 16px;
  font-family: 'Press Start 2P', cursive;
  font-size: 10px;
  background-color: #0f3460;
  color: #ecf0f1;
  border: 2px solid #4ecdc4;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.topic-btn:hover {
  background-color: #4ecdc4;
  color: #1a1a2e;
}

.storm-generation {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.storm-generation h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.idea-input {
  display: flex;
  gap: 15px;
}

.idea-input textarea {
  flex: 1;
  padding: 15px;
  background-color: rgba(0, 0, 0, 0.5);
  border: 2px solid #0f3460;
  border-radius: 6px;
  color: #ecf0f1;
  font-family: 'VT323', monospace;
  font-size: 16px;
  resize: vertical;
  min-height: 100px;
}

.idea-input textarea::placeholder {
  color: #95a5a6;
}

.add-idea-btn {
  padding: 0 20px;
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  background-color: #0f3460;
  color: #ecf0f1;
  border: 2px solid #4ecdc4;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
  align-self: flex-end;
}

.add-idea-btn:hover {
  background-color: #4ecdc4;
  color: #1a1a2e;
}

.storm-ideas {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.storm-ideas h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.idea-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 15px;
}

.idea-card {
  padding: 15px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  border: 2px solid #0f3460;
  transition: all 0.3s ease;
}

.idea-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 5px 15px rgba(78, 205, 196, 0.3);
}

.idea-header {
  margin-bottom: 10px;
}

.idea-header h4 {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
  margin-bottom: 5px;
}

.idea-author {
  font-family: 'VT323', monospace;
  font-size: 12px;
  color: #95a5a6;
}

.idea-votes {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.vote-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background-color: #0f3460;
  color: #ecf0f1;
  border: 2px solid #4ecdc4;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
}

.vote-btn:hover {
  background-color: #4ecdc4;
  color: #1a1a2e;
}

.vote-count {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #ecf0f1;
  min-width: 30px;
  text-align: center;
}

.idea-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tag {
  padding: 2px 8px;
  background-color: rgba(78, 205, 196, 0.2);
  color: #4ecdc4;
  font-family: 'VT323', monospace;
  font-size: 10px;
  border-radius: 12px;
}

.storm-results {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.storm-results h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.results-chart {
  width: 100%;
  height: 300px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
}

.storm-controls {
  display: flex;
  justify-content: center;
  margin: 20px;
  gap: 15px;
}

.control-btn {
  padding: 10px 20px;
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  background-color: #0f3460;
  color: #ecf0f1;
  border: 2px solid #4ecdc4;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.control-btn:hover {
  background-color: #4ecdc4;
  color: #1a1a2e;
}
```

## 7. 竞赛模式 (Contest) 实现

### 7.1 功能概述

竞赛模式是一种智能体参与竞赛，争夺资源和奖励的模式。主要功能包括：
- 挑战任务
- 资源争夺
- 排行榜
- 奖励系统
- 竞赛进度

### 7.2 界面布局

```html
<div class="contest-mode">
  <!-- 顶部竞赛信息 -->
  <div class="contest-header">
    <h2>竞赛模式</h2>
    <div class="contest-stats">
      <div class="stat-item">
        <span class="stat-label">当前挑战:</span>
        <span class="stat-value">{{ contestState.activeChallenge || '未开始' }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">剩余时间:</span>
        <span class="stat-value">{{ timeRemaining }}</span>
      </div>
    </div>
  </div>

  <!-- 排行榜 -->
  <div class="contest-leaderboard">
    <h3>排行榜</h3>
    <div class="leaderboard-table">
      <div class="leaderboard-header">
        <div class="rank-column">排名</div>
        <div class="agent-column">智能体</div>
        <div class="score-column">分数</div>
        <div class="reward-column">奖励</div>
      </div>
      <div 
        class="leaderboard-row" 
        *ngFor="let entry of contestState.leaderboard; let i = index"
        [class.first]="i === 0"
        [class.second]="i === 1"
        [class.third]="i === 2"
      >
        <div class="rank-column">{{ i + 1 }}</div>
        <div class="agent-column">
          <div class="agent-avatar" [style.backgroundColor]="entry.agentColor"></div>
          <span>{{ entry.agentName }}</span>
        </div>
        <div class="score-column">{{ entry.score }}</div>
        <div class="reward-column">{{ entry.reward }}</div>
      </div>
    </div>
  </div>

  <!-- 挑战任务 -->
  <div class="contest-challenges">
    <h3>挑战任务</h3>
    <div class="challenge-list">
      <div 
        class="challenge-card" 
        *ngFor="let challenge of contestState.challenges"
        [class.active]="challenge.id === contestState.activeChallenge"
      >
        <div class="challenge-header">
          <h4>{{ challenge.title }}</h4>
          <span class="challenge-reward">奖励: {{ challenge.reward }}</span>
        </div>
        <div class="challenge-description">{{ challenge.description }}</div>
        <div class="challenge-difficulty">
          <span class="difficulty-label">难度:</span>
          <div class="difficulty-bar">
            <div 
              class="difficulty-fill" 
              [style.width]="challenge.difficulty * 20 + '%'"
              [class.difficulty-easy]="challenge.difficulty <= 2"
              [class.difficulty-medium]="challenge.difficulty > 2 && challenge.difficulty <= 3"
              [class.difficulty-hard]="challenge.difficulty > 3"
            ></div>
          </div>
        </div>
        <button 
          class="start-challenge-btn" 
          (click)="startChallenge(challenge.id)"
          [disabled]="challenge.id === contestState.activeChallenge"
        >
          {{ challenge.id === contestState.activeChallenge ? '进行中' : '开始挑战' }}
        </button>
      </div>
    </div>
  </div>

  <!-- 资源状态 -->
  <div class="contest-resources">
    <h3>资源状态</h3>
    <div class="resource-grid">
      <div class="resource-item">
        <span class="resource-label">CPU</span>
        <span class="resource-value">{{ resources.cpu }}%</span>
      </div>
      <div class="resource-item">
        <span class="resource-label">内存</span>
        <span class="resource-value">{{ resources.memory }}%</span>
      </div>
      <div class="resource-item">
        <span class="resource-label">网络</span>
        <span class="resource-value">{{ resources.network }}%</span>
      </div>
      <div class="resource-item">
        <span class="resource-label">GPU</span>
        <span class="resource-value">{{ resources.gpu }}%</span>
      </div>
    </div>
  </div>

  <!-- 控制按钮 -->
  <div class="contest-controls">
    <button class="control-btn" (click)="startContest()">开始竞赛</button>
    <button class="control-btn" (click)="stopContest()">停止竞赛</button>
    <button class="control-btn" (click)="resetContest()">重置竞赛</button>
  </div>
</div>
```

### 7.3 实现逻辑

```typescript
@Injectable({ providedIn: 'root' })
export class ContestModeService {
  private readonly contestState = signal<ContestModeState>({
    challenges: [],
    leaderboard: [],
    activeChallenge: ''
  });

  private timer: number | null = null;
  private timeLeft = 3600; // 1小时

  // 获取当前状态
  getContestState() {
    return this.contestState();
  }

  // 获取剩余时间
  getTimeRemaining() {
    const minutes = Math.floor(this.timeLeft / 60);
    const seconds = this.timeLeft % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  // 初始化竞赛
  initContest(challenges: ChallengeState[], agents: Agent[]) {
    const leaderboard: LeaderboardEntry[] = agents.map(agent => ({
      agentId: agent.id,
      agentName: agent.name,
      agentColor: agent.color,
      score: 0,
      reward: '无'
    }));

    this.contestState.set({
      challenges,
      leaderboard,
      activeChallenge: ''
    });

    this.timeLeft = 3600;
  }

  // 开始竞赛
  startContest() {
    this.timer = window.setInterval(() => {
      if (this.timeLeft > 0) {
        this.timeLeft--;
      } else {
        this.stopContest();
      }
    }, 1000);
  }

  // 停止竞赛
  stopContest() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // 计算最终排名和奖励
    this.calculateFinalRankings();
  }

  // 重置竞赛
  resetContest() {
    this.stopContest();
    this.timeLeft = 3600;

    this.contestState.update(current => ({
      ...current,
      leaderboard: current.leaderboard.map(entry => ({
        ...entry,
        score: 0,
        reward: '无'
      })),
      activeChallenge: ''
    }));
  }

  // 开始挑战
  startChallenge(challengeId: string) {
    this.contestState.update(current => ({
      ...current,
      activeChallenge: challengeId
    }));
  }

  // 完成挑战
  completeChallenge(challengeId: string, agentId: string) {
    const challenge = this.contestState().challenges.find(c => c.id === challengeId);
    if (!challenge) return;

    this.contestState.update(current => {
      const updatedLeaderboard = current.leaderboard.map(entry => {
        if (entry.agentId === agentId) {
          return {
            ...entry,
            score: entry.score + challenge.points,
            reward: challenge.reward
          };
        }
        return entry;
      }).sort((a, b) => b.score - a.score);

      return {
        ...current,
        leaderboard: updatedLeaderboard,
        activeChallenge: ''
      };
    });
  }

  // 计算最终排名
  private calculateFinalRankings() {
    this.contestState.update(current => {
      const sortedLeaderboard = [...current.leaderboard].sort((a, b) => b.score - a.score);
      
      // 分配奖励
      const updatedLeaderboard = sortedLeaderboard.map((entry, index) => {
        let reward = '无';
        switch (index) {
          case 0:
            reward = '🏆 冠军';
            break;
          case 1:
            reward = '🥈 亚军';
            break;
          case 2:
            reward = '🥉 季军';
            break;
        }
        return {
          ...entry,
          reward
        };
      });
      
      return {
        ...current,
        leaderboard: updatedLeaderboard
      };
    });
  }
}
```

### 7.4 视觉效果

```css
/* 竞赛模式样式 */
.contest-mode {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #1a1a2e;
  overflow: hidden;
}

.contest-header {
  padding: 20px;
  background-color: #16213e;
  border-bottom: 2px solid #0f3460;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.contest-header h2 {
  font-family: 'Press Start 2P', cursive;
  font-size: 16px;
  color: #4ecdc4;
}

.contest-stats {
  display: flex;
  gap: 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.stat-label {
  font-family: 'VT323', monospace;
  font-size: 12px;
  color: #95a5a6;
}

.stat-value {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
}

.contest-leaderboard {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.contest-leaderboard h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.leaderboard-table {
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  overflow: hidden;
}

.leaderboard-header {
  display: grid;
  grid-template-columns: 80px 1fr 100px 100px;
  padding: 15px;
  background-color: #0f3460;
  font-family: 'Press Start 2P', cursive;
  font-size: 10px;
  color: #ecf0f1;
  font-weight: bold;
}

.leaderboard-row {
  display: grid;
  grid-template-columns: 80px 1fr 100px 100px;
  padding: 15px;
  border-bottom: 1px solid #0f3460;
  transition: all 0.3s ease;
}

.leaderboard-row:hover {
  background-color: rgba(78, 205, 196, 0.1);
}

.leaderboard-row.first {
  background-color: rgba(255, 217, 61, 0.2);
}

.leaderboard-row.second {
  background-color: rgba(192, 192, 192, 0.2);
}

.leaderboard-row.third {
  background-color: rgba(205, 127, 50, 0.2);
}

.rank-column {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #ecf0f1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-column {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
}

.agent-column span {
  font-family: 'VT323', monospace;
  font-size: 14px;
  color: #ecf0f1;
}

.score-column {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #4ecdc4;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reward-column {
  font-family: 'Press Start 2P', cursive;
  font-size: 10px;
  color: #ecf0f1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.contest-challenges {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.contest-challenges h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.challenge-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.challenge-card {
  padding: 20px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  border: 2px solid #0f3460;
  transition: all 0.3s ease;
}

.challenge-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 5px 15px rgba(78, 205, 196, 0.3);
}

.challenge-card.active {
  border-color: #4ecdc4;
  background-color: rgba(78, 205, 196, 0.1);
}

.challenge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.challenge-header h4 {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #ecf0f1;
}

.challenge-reward {
  font-family: 'VT323', monospace;
  font-size: 14px;
  color: #ffd93d;
}

.challenge-description {
  font-family: 'VT323', monospace;
  font-size: 14px;
  color: #ecf0f1;
  margin-bottom: 15px;
  line-height: 1.4;
}

.challenge-difficulty {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}

.difficulty-label {
  font-family: 'VT323', monospace;
  font-size: 12px;
  color: #95a5a6;
}

.difficulty-bar {
  flex: 1;
  height: 8px;
  background-color: #0f3460;
  border-radius: 4px;
  overflow: hidden;
}

.difficulty-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.difficulty-easy {
  background-color: #27ae60;
}

.difficulty-medium {
  background-color: #f39c12;
}

.difficulty-hard {
  background-color: #e74c3c;
}

.start-challenge-btn {
  width: 100%;
  padding: 10px;
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  background-color: #0f3460;
  color: #ecf0f1;
  border: 2px solid #4ecdc4;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.start-challenge-btn:hover:not(:disabled) {
  background-color: #4ecdc4;
  color: #1a1a2e;
}

.start-challenge-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.contest-resources {
  padding: 20px;
  background-color: #16213e;
  margin: 20px;
  border-radius: 8px;
  border: 2px solid #0f3460;
}

.contest-resources h3 {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
  margin-bottom: 15px;
}

.resource-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 15px;
}

.resource-item {
  padding: 15px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  text-align: center;
}

.resource-label {
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  color: #95a5a6;
  display: block;
  margin-bottom: 5px;
}

.resource-value {
  font-family: 'Press Start 2P', cursive;
  font-size: 14px;
  color: #4ecdc4;
}

.contest-controls {
  display: flex;
  justify-content: center;
  margin: 20px;
  gap: 15px;
}

.control-btn {
  padding: 10px 20px;
  font-family: 'Press Start 2P', cursive;
  font-size: 12px;
  background-color: #0f3460;
  color: #ecf0f1;
  border: 2px solid #4ecdc4;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.control-btn:hover {
  background-color: #4ecdc4;
  color: #1a1a2e;
}
```

## 8. 模式切换与状态管理

### 8.1 模式切换服务

模式切换通过 `ModeService` 实现，该服务管理当前激活的模式：

```typescript
@Injectable({ providedIn: 'root' })
export class ModeService {
  private readonly currentMode = signal<CollaborationMode>('battle');

  getMode() {
    return this.currentMode();
  }

  setMode(mode: CollaborationMode) {
    this.currentMode.set(mode);
  }

  mode$ = this.currentMode.asObservable();
}
```

### 8.2 状态管理服务

使用 Angular 信号（Signal）和服务来管理每个模式的状态：

```typescript
@Injectable({ providedIn: 'root' })
export class ArenaStateService {
  private readonly arenaState = signal<{
    currentMode: CollaborationMode;
    battle: BattleModeState;
    coop: CoopModeState;
    pipeline: PipelineModeState;
    storm: StormModeState;
    contest: ContestModeState;
  }>({
    currentMode: 'battle',
    battle: {/* 初始状态 */},
    coop: {/* 初始状态 */},
    pipeline: {/* 初始状态 */},
    storm: {/* 初始状态 */},
    contest: {/* 初始状态 */}
  });

  // 获取当前模式的状态
  getCurrentModeState() {
    const state = this.arenaState();
    return state[state.currentMode];
  }

  // 切换模式
  switchMode(mode: CollaborationMode) {
    this.arenaState.update(current => ({
      ...current,
      currentMode: mode
    }));
  }

  // 更新模式状态
  updateModeState<T extends CollaborationMode>(mode: T, state: Partial<ModeState[T]>) {
    this.arenaState.update(current => ({
      ...current,
      [mode]: {
        ...current[mode],
        ...state
      }
    }));
  }
}
```

## 9. 前端集成

### 9.1 组件结构

使用 Angular 组件结构来实现模式切换和内容展示：

```typescript
@Component({
  selector: 'app-arena-mode',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './arena-mode.component.html',
  styleUrls: ['./arena-mode.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArenaModeComponent {
  private readonly modeService = inject(ModeService);
  private readonly arenaStateService = inject(ArenaStateService);

  protected readonly activeMode = this.modeService.mode$;
  protected readonly battleState = this.arenaStateService.battleState$;
  protected readonly coopState = this.arenaStateService.coopState$;
  protected readonly pipelineState = this.arenaStateService.pipelineState$;
  protected readonly stormState = this.arenaStateService.stormState$;
  protected readonly contestState = this.arenaStateService.contestState$;

  protected switchMode(mode: CollaborationMode) {
    this.modeService.setMode(mode);
  }

  protected get isBattleMode() {
    return this.modeService.getMode() === 'battle';
  }

  protected get isCoopMode() {
    return this.modeService.getMode() === 'coop';
  }

  protected get isPipelineMode() {
    return this.modeService.getMode() === 'pipeline';
  }

  protected get isStormMode() {
    return this.modeService.getMode() === 'storm';
  }

  protected get isContestMode() {
    return this.modeService.getMode() === 'contest';
  }
}
```

### 9.2 模板实现

```html
<div class="arena-mode-container">
  <!-- 模式切换按钮 -->
  <div class="mode-switcher">
    <button 
      class="mode-btn" 
      [class.active]="isBattleMode"
      (click)="switchMode('battle')"
    >
      对抗模式
    </button>
    <button 
      class="mode-btn" 
      [class.active]="isCoopMode"
      (click)="switchMode('coop')"
    >
      协作模式
    </button>
    <button 
      class="mode-btn" 
      [class.active]="isPipelineMode"
      (click)="switchMode('pipeline')"
    >
      流水线模式
    </button>
    <button 
      class="mode-btn" 
      [class.active]="isStormMode"
      (click)="switchMode('storm')"
    >
      脑暴模式
    </button>
    <button 
      class="mode-btn" 
      [class.active]="isContestMode"
      (click)="switchMode('contest')"
    >
      竞赛模式
    </button>
  </div>

  <!-- 模式内容 -->
  <div class="mode-content">
    <!-- 对抗模式 -->
    @if (isBattleMode) {
      <app-battle-mode></app-battle-mode>
    }

    <!-- 协作模式 -->
    @if (isCoopMode) {
      <app-coop-mode></app-coop-mode>
    }

    <!-- 流水线模式 -->
    @if (isPipelineMode) {
      <app-pipeline-mode></app-pipeline-mode>
    }

    <!-- 脑暴模式 -->
    @if (isStormMode) {
      <app-storm-mode></app-storm-mode>
    }

    <!-- 竞赛模式 -->
    @if (isContestMode) {
      <app-contest-mode></app-contest-mode>
    }
  </div>
</div>
```

## 10. 后端集成

### 10.1 智能体编排服务

使用 `MultiAgentOrchestratorService` 与后端智能体服务交互：

```typescript
@Injectable({ providedIn: 'root' })
export class AgentService {
  constructor(private orchestrator: MultiAgentOrchestratorService) {}

  // 创建智能体团队
  async createTeam(config: TeammateSpawnConfig, size: number) {
    return this.orchestrator.createTeam(config, size);
  }

  // 发送消息给智能体
  async sendMessage(agentId: string, message: string) {
    return this.orchestrator.sendMessage(agentId, message);
  }

  // 停止智能体
  async stopAgent(agentId: string) {
    return this.orchestrator.stopTeammate(agentId);
  }

  // 获取团队状态
  getTeamState() {
    return this.orchestrator.getCurrentVm();
  }
}
```

### 10.2 WebSocket 通信

使用 WebSocket 与后端保持实时通信：

```typescript
@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private socket: WebSocket | null = null;
  private readonly messageSubject = new Subject<any>();
  
  messages$ = this.messageSubject.asObservable();

  connect(url: string) {
    this.socket = new WebSocket(url);
    
    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.messageSubject.next(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.socket.onclose = () => {
      console.log('WebSocket closed');
      // 尝试重连
      setTimeout(() => this.connect(url), 5000);
    };
  }

  send(message: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
```

## 11. 性能优化

### 11.1 前端优化

1. **变更检测策略**：使用 `ChangeDetectionStrategy.OnPush` 减少不必要的变更检测
2. **虚拟滚动**：对长列表使用虚拟滚动
3. **图像优化**：使用精灵图和适当大小的图像
4. **动画优化**：使用 CSS 硬件加速和 `will-change` 属性
5. **内存管理**：及时清理不再使用的资源和事件监听器

### 11.2 后端优化

1. **WebSocket 优化**：使用压缩和批量消息减少网络传输
2. **缓存策略**：缓存频繁访问的数据
3. **负载均衡**：使用负载均衡器分发请求
4. **异步处理**：使用异步处理提高并发能力
5. **资源限制**：设置合理的资源限制避免系统过载

## 12. 响应式设计

### 12.1 布局适配

- **桌面端**：完整显示所有内容
- **平板端**：调整布局，确保内容可读性
- **移动端**：简化布局，优先显示核心功能

### 12.2 触控适配

- **触摸手势**：支持滑动切换模式
- **触控目标**：确保按钮和交互元素足够大
- **反馈机制**：提供视觉和触觉反馈

## 13. 总结

Agent Battle Arena 的5种模式实现了不同的智能体协作场景，从对抗到协作，从流水线到脑暴，从竞赛到资源争夺，为用户提供了丰富的智能体交互体验。

每种模式都有其独特的实现逻辑和视觉效果，通过 Angular 信号（Signal）和服务来管理状态，使用 WebSocket 与后端保持实时通信，实现了高性能、响应式的用户界面。

通过模块化的设计和扩展性考虑，系统可以轻松添加新的模式和功能，为未来的发展奠定了基础。