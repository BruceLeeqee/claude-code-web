# Agent Battle Arena 多智能体协作页实现计划

**文档版本**：1.0  
**项目名称**：Agent Battle Arena - 像素大战风格多智能体协作可视化系统  
**适用页面**：多智能体协作页 / 协作舞台 / 监控与控制中心  
**设计依据**：
- `Agent Battle Arena - 项目概述与视觉风格设计文档`
- `Agent Battle Arena - 布局与组件设计文档`
- `Agent Battle Arena - 动画与特效规范文档`
- `Agent Battle Arena - 交互设计文档`
- `Agent Battle Arena - 系统架构与监控设计文档`
- `Agent Battle Arena - 实现指南与里程碑文档`
- `Agent Battle Arena - 设计文档汇总`

---

## 1. 实现概述

本实现计划基于现有的设计文档和代码，详细说明如何构建 Agent Battle Arena 多智能体协作页。该页面将采用像素街机风格，将多智能体协作过程构建成一个实时战斗/协作舞台，让用户能够直观理解协作过程、实时观察 Agent 状态与关系、控制协作节奏、干预协作行为、回放历史过程、导出结果与战报、查看系统资源与运行状况。

## 2. 技术栈选择

### 2.1 前端框架
- **Angular**：项目已有基于 Angular 的实现基础，继续使用 Angular 16+ 版本
- **TypeScript**：提供类型安全和更好的开发体验

### 2.2 可视化库
- **PixiJS**：用于实现高性能的像素风格动画和特效
- **Vis.js**：用于实现协作关系网络图
- **ECharts**：用于实现数据流 Sankey 图和系统监控图表

### 2.3 状态管理
- **RxJS**：用于响应式状态管理和事件流处理
- **BehaviorSubject**：用于管理页面核心状态

### 2.4 样式
- **SCSS**：用于模块化样式管理
- **像素风格**：自定义像素风格组件和动画

## 3. 核心组件实现

### 3.1 AgentNode 组件

#### 3.1.1 组件结构
```typescript
// src/app/features/prototype/collaboration/components/agent-node.component.ts

import { Component, Input, Output, EventEmitter } from '@angular/core';
import type { WorkbenchTeammateVm } from '../../../../core/multi-agent/multi-agent.types';

@Component({
  selector: 'app-agent-node',
  templateUrl: './agent-node.component.html',
  styleUrls: ['./agent-node.component.scss']
})
export class AgentNodeComponent {
  @Input() agent: WorkbenchTeammateVm | null = null;
  @Input() isCurrentTurn = false;
  @Output() selected = new EventEmitter<string>();

  agentTypes = {
    RED_PACMAN: 'red',
    BLUE_INVADER: 'blue',
    GREEN_FROGGER: 'green',
    GOLD_DONKEYKONG: 'gold',
    PURPLE_TETRIS: 'purple',
    WHITE_GHOST: 'white'
  };

  statuses = {
    idle: 'idle',
    thinking: 'thinking',
    attacking: 'attacking',
    damaged: 'damaged',
    powered: 'powered',
    defeated: 'defeated'
  };

  getAgentTypeColor(type: string): string {
    return this.agentTypes[type as keyof typeof this.agentTypes] || 'gray';
  }

  onSelect(): void {
    if (this.agent) {
      this.selected.emit(this.agent.agentId);
    }
  }
}
```

#### 3.1.2 组件模板
```html
<!-- src/app/features/prototype/collaboration/components/agent-node.component.html -->

<div 
  class="agent-node"
  [class.current-turn]="isCurrentTurn"
  [class.selected]="isSelected"
  [class.idle]="agent?.status === 'idle'"
  [class.thinking]="agent?.status === 'thinking'"
  [class.attacking]="agent?.status === 'attacking'"
  [class.damaged]="agent?.status === 'damaged'"
  [class.powered]="agent?.status === 'powered'"
  [class.defeated]="agent?.status === 'defeated'"
  (click)="onSelect()"
>
  <div class="agent-avatar" [style.backgroundColor]="getAgentTypeColor(agent?.role || '')">
    <div class="agent-name">{{ agent?.name }}</div>
  </div>
  <div class="agent-stats">
    <div class="stat hp">HP: {{ agent?.hp || 100 }}</div>
    <div class="stat energy">Energy: {{ agent?.energy || 50 }}</div>
    <div class="stat score">Score: {{ agent?.score || 0 }}</div>
  </div>
  <div class="agent-status">{{ agent?.status }}</div>
</div>
```

#### 3.1.3 组件样式
```scss
/* src/app/features/prototype/collaboration/components/agent-node.component.scss */

.agent-node {
  position: relative;
  width: 120px;
  height: 150px;
  border: 2px solid #333;
  border-radius: 8px;
  background-color: #1a1a1a;
  padding: 10px;
  margin: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);

  &:hover {
    transform: translateY(-5px);
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.7);
  }

  &.current-turn {
    border-color: #ffcc00;
    box-shadow: 0 0 20px rgba(255, 204, 0, 0.5);
  }

  &.selected {
    border-color: #00ccff;
    box-shadow: 0 0 20px rgba(0, 204, 255, 0.5);
  }

  .agent-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    margin: 0 auto 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    color: white;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
  }

  .agent-name {
    font-size: 12px;
    text-align: center;
  }

  .agent-stats {
    font-size: 10px;
    margin-bottom: 10px;

    .stat {
      margin-bottom: 2px;
    }
  }

  .agent-status {
    font-size: 10px;
    text-align: center;
    color: #ccc;
  }

  &.idle {
    border-color: #666;
  }

  &.thinking {
    border-color: #00ccff;
    animation: pulse 1s infinite;
  }

  &.attacking {
    border-color: #ff3300;
    animation: shake 0.5s infinite;
  }

  &.damaged {
    border-color: #ff6600;
    animation: flash 0.5s infinite;
  }

  &.powered {
    border-color: #9933ff;
    box-shadow: 0 0 20px rgba(153, 51, 255, 0.5);
  }

  &.defeated {
    border-color: #333;
    opacity: 0.5;
  }
}

@keyframes pulse {
  0% { box-shadow: 0 0 5px rgba(0, 204, 255, 0.5); }
  50% { box-shadow: 0 0 20px rgba(0, 204, 255, 0.8); }
  100% { box-shadow: 0 0 5px rgba(0, 204, 255, 0.5); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-2px); }
  75% { transform: translateX(2px); }
}

@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

### 3.2 BattleStage 组件

#### 3.2.1 组件结构
```typescript
// src/app/features/prototype/collaboration/components/battle-stage.component.ts

import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import * as PIXI from 'pixi.js';
import type { WorkbenchTeamVm, WorkbenchTeammateVm } from '../../../../core/multi-agent/multi-agent.types';

@Component({
  selector: 'app-battle-stage',
  templateUrl: './battle-stage.component.html',
  styleUrls: ['./battle-stage.component.scss']
})
export class BattleStageComponent implements OnInit, OnDestroy {
  @Input() team: WorkbenchTeamVm | null = null;
  @Input() currentMode: string = 'collaboration';
  @Input() currentTopic: string = '';
  @Input() currentRound: number = 1;

  private app: PIXI.Application | null = null;
  private stageElements: Map<string, PIXI.Sprite> = new Map();
  private animationFrameId: number | null = null;

  ngOnInit(): void {
    this.initPixi();
    this.startAnimation();
  }

  ngOnDestroy(): void {
    this.stopAnimation();
    this.destroyPixi();
  }

  private initPixi(): void {
    const container = document.getElementById('battle-stage-container');
    if (!container) return;

    this.app = new PIXI.Application({
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: 0x111111,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    });

    container.appendChild(this.app.view);
    this.createStageElements();
  }

  private createStageElements(): void {
    if (!this.app) return;

    // Create background
    const background = new PIXI.Graphics();
    background.beginFill(0x111111);
    background.drawRect(0, 0, this.app.screen.width, this.app.screen.height);
    background.endFill();
    this.app.stage.addChild(background);

    // Create stage border
    const border = new PIXI.Graphics();
    border.lineStyle(4, 0x333333);
    border.drawRect(0, 0, this.app.screen.width, this.app.screen.height);
    this.app.stage.addChild(border);

    // Create center arena
    const arena = new PIXI.Graphics();
    arena.lineStyle(2, 0x666666);
    arena.drawCircle(this.app.screen.width / 2, this.app.screen.height / 2, 150);
    this.app.stage.addChild(arena);
  }

  private startAnimation(): void {
    this.animate();
  }

  private animate(): void {
    if (!this.app) return;

    // Update animations
    this.updateAgentPositions();
    this.updateEffects();

    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  private updateAgentPositions(): void {
    if (!this.app || !this.team) return;

    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;
    const radius = 100;
    const agentCount = this.team.teammates.length;

    this.team.teammates.forEach((agent, index) => {
      const angle = (index / agentCount) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;

      let sprite = this.stageElements.get(agent.agentId);
      if (!sprite) {
        sprite = PIXI.Sprite.from(`assets/agents/${agent.role}.png`);
        sprite.anchor.set(0.5);
        sprite.scale.set(0.5);
        this.app?.stage.addChild(sprite);
        this.stageElements.set(agent.agentId, sprite);
      }

      // Smooth movement
      const targetX = x;
      const targetY = y;
      const currentX = sprite.x;
      const currentY = sprite.y;

      sprite.x += (targetX - currentX) * 0.1;
      sprite.y += (targetY - currentY) * 0.1;

      // Update sprite based on agent status
      this.updateAgentSprite(sprite, agent);
    });
  }

  private updateAgentSprite(sprite: PIXI.Sprite, agent: WorkbenchTeammateVm): void {
    switch (agent.status) {
      case 'thinking':
        sprite.alpha = 0.8;
        sprite.scale.set(0.5 + Math.sin(Date.now() * 0.005) * 0.1);
        break;
      case 'attacking':
        sprite.alpha = 1;
        sprite.scale.set(0.6);
        break;
      case 'damaged':
        sprite.alpha = 0.6;
        sprite.scale.set(0.4);
        break;
      case 'powered':
        sprite.alpha = 1;
        sprite.scale.set(0.6);
        // Add glow effect
        break;
      default:
        sprite.alpha = 1;
        sprite.scale.set(0.5);
    }
  }

  private updateEffects(): void {
    // Update particle effects, beams, etc.
  }

  private stopAnimation(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private destroyPixi(): void {
    this.app?.destroy();
    this.app = null;
    this.stageElements.clear();
  }
}
```

#### 3.2.2 组件模板
```html
<!-- src/app/features/prototype/collaboration/components/battle-stage.component.html -->

<div class="battle-stage">
  <div class="stage-header">
    <h2>Battle Stage</h2>
    <div class="stage-info">
      <span class="mode">{{ currentMode }}</span>
      <span class="round">Round {{ currentRound }}</span>
    </div>
  </div>
  <div id="battle-stage-container" class="stage-container"></div>
  <div class="stage-footer">
    <div class="topic">{{ currentTopic }}</div>
  </div>
</div>
```

#### 3.2.3 组件样式
```scss
/* src/app/features/prototype/collaboration/components/battle-stage.component.scss */

.battle-stage {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #0a0a0a;
  border: 2px solid #333;
  border-radius: 8px;
  overflow: hidden;

  .stage-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px;
    background-color: #1a1a1a;
    border-bottom: 2px solid #333;

    h2 {
      color: #ffcc00;
      font-size: 18px;
      margin: 0;
      text-shadow: 0 0 10px rgba(255, 204, 0, 0.5);
    }

    .stage-info {
      display: flex;
      gap: 10px;

      .mode, .round {
        color: #ccc;
        font-size: 12px;
        padding: 2px 8px;
        background-color: #2a2a2a;
        border-radius: 4px;
      }
    }
  }

  .stage-container {
    width: 100%;
    height: calc(100% - 80px);
    position: relative;
  }

  .stage-footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 10px;
    background-color: rgba(26, 26, 26, 0.8);
    border-top: 2px solid #333;

    .topic {
      color: #fff;
      font-size: 14px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
}
```

### 3.3 协作关系网络图组件

#### 3.3.1 组件结构
```typescript
// src/app/features/prototype/collaboration/components/network-graph.component.ts

import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import * as vis from 'vis-network';
import type { WorkbenchTeamVm } from '../../../../core/multi-agent/multi-agent.types';

@Component({
  selector: 'app-network-graph',
  templateUrl: './network-graph.component.html',
  styleUrls: ['./network-graph.component.scss']
})
export class NetworkGraphComponent implements OnInit, OnDestroy {
  @Input() team: WorkbenchTeamVm | null = null;

  private network: vis.Network | null = null;

  ngOnInit(): void {
    this.initNetwork();
  }

  ngOnDestroy(): void {
    this.network?.destroy();
  }

  private initNetwork(): void {
    const container = document.getElementById('network-graph-container');
    if (!container) return;

    const nodes = this.getNodes();
    const edges = this.getEdges();

    const data = {
      nodes: nodes,
      edges: edges
    };

    const options = {
      nodes: {
        shape: 'circle',
        size: 20,
        font: {
          size: 12,
          color: '#fff'
        },
        color: {
          background: '#3498db',
          border: '#2980b9',
          highlight: {
            background: '#2980b9',
            border: '#1f618d'
          }
        }
      },
      edges: {
        width: 2,
        color: {
          color: '#666',
          highlight: '#3498db'
        },
        arrows: {
          to: {
            enabled: true,
            scaleFactor: 0.5
          }
        }
      },
      interaction: {
        hover: true,
        zoomView: true,
        dragNodes: true,
        dragView: true
      },
      physics: {
        enabled: true,
        stabilization: {
          enabled: true,
          iterations: 100
        }
      }
    };

    this.network = new vis.Network(container, data, options);
  }

  private getNodes(): vis.DataSet {
    const nodes = new vis.DataSet();

    if (this.team) {
      this.team.teammates.forEach(agent => {
        nodes.add({
          id: agent.agentId,
          label: agent.name,
          color: {
            background: agent.role === 'leader' ? '#e74c3c' : '#3498db',
            border: agent.role === 'leader' ? '#c0392b' : '#2980b9'
          }
        });
      });
    }

    return nodes;
  }

  private getEdges(): vis.DataSet {
    const edges = new vis.DataSet();

    if (this.team) {
      const leader = this.team.teammates.find(agent => agent.role === 'leader');
      if (leader) {
        this.team.teammates.forEach(agent => {
          if (agent.role !== 'leader') {
            edges.add({
              from: leader.agentId,
              to: agent.agentId,
              label: 'collaborates'
            });
          }
        });
      }
    }

    return edges;
  }

  updateGraph(): void {
    if (this.network) {
      const nodes = this.getNodes();
      const edges = this.getEdges();
      this.network.setData({ nodes, edges });
    }
  }
}
```

#### 3.3.2 组件模板
```html
<!-- src/app/features/prototype/collaboration/components/network-graph.component.html -->

<div class="network-graph">
  <div class="graph-header">
    <h3>Collaboration Network</h3>
  </div>
  <div id="network-graph-container" class="graph-container"></div>
</div>
```

#### 3.3.3 组件样式
```scss
/* src/app/features/prototype/collaboration/components/network-graph.component.scss */

.network-graph {
  width: 100%;
  height: 100%;
  background-color: #1a1a1a;
  border: 2px solid #333;
  border-radius: 8px;
  overflow: hidden;

  .graph-header {
    padding: 10px;
    background-color: #2a2a2a;
    border-bottom: 2px solid #333;

    h3 {
      color: #3498db;
      font-size: 14px;
      margin: 0;
    }
  }

  .graph-container {
    width: 100%;
    height: calc(100% - 40px);
  }
}
```

### 3.4 控制面板组件

#### 3.4.1 组件结构
```typescript
// src/app/features/prototype/collaboration/components/control-panel.component.ts

import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-control-panel',
  templateUrl: './control-panel.component.html',
  styleUrls: ['./control-panel.component.scss']
})
export class ControlPanelComponent {
  @Output() play = new EventEmitter<void>();
  @Output() pause = new EventEmitter<void>();
  @Output() replay = new EventEmitter<void>();
  @Output() speedChange = new EventEmitter<number>();
  @Output() focusAgent = new EventEmitter<string>();
  @Output() exportData = new EventEmitter<void>();

  currentSpeed = 1;
  speedOptions = [
    { value: 1, label: '1x' },
    { value: 2, label: '2x' },
    { value: 4, label: '4x' },
    { value: 8, label: '8x' }
  ];

  onSpeedChange(speed: number): void {
    this.currentSpeed = speed;
    this.speedChange.emit(speed);
  }

  onFocusAgent(agentId: string): void {
    this.focusAgent.emit(agentId);
  }
}
```

#### 3.4.2 组件模板
```html
<!-- src/app/features/prototype/collaboration/components/control-panel.component.html -->

<div class="control-panel">
  <div class="control-group">
    <button class="control-button play" (click)="play.emit()">
      <span class="icon">▶</span>
      Play
    </button>
    <button class="control-button pause" (click)="pause.emit()">
      <span class="icon">⏸</span>
      Pause
    </button>
    <button class="control-button replay" (click)="replay.emit()">
      <span class="icon">⏹</span>
      Replay
    </button>
  </div>
  
  <div class="control-group">
    <label for="speed">Speed:</label>
    <select id="speed" [(ngModel)]="currentSpeed" (change)="onSpeedChange(currentSpeed)">
      <option *ngFor="let option of speedOptions" [value]="option.value">
        {{ option.label }}
      </option>
    </select>
  </div>
  
  <div class="control-group">
    <button class="control-button export" (click)="exportData.emit()">
      <span class="icon">📤</span>
      Export
    </button>
  </div>
</div>
```

#### 3.4.3 组件样式
```scss
/* src/app/features/prototype/collaboration/components/control-panel.component.scss */

.control-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background-color: #1a1a1a;
  border: 2px solid #333;
  border-radius: 8px;

  .control-group {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .control-button {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 12px;
    background-color: #2a2a2a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.3s ease;

    &:hover {
      background-color: #3498db;
      border-color: #2980b9;
    }

    &.play:hover {
      background-color: #27ae60;
      border-color: #229954;
    }

    &.pause:hover {
      background-color: #f39c12;
      border-color: #e67e22;
    }

    &.replay:hover {
      background-color: #e74c3c;
      border-color: #c0392b;
    }

    &.export:hover {
      background-color: #9b59b6;
      border-color: #8e44ad;
    }

    .icon {
      font-size: 14px;
    }
  }

  label {
    color: #ccc;
    font-size: 12px;
  }

  select {
    padding: 6px 10px;
    background-color: #2a2a2a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;

    &:focus {
      outline: none;
      border-color: #3498db;
    }
  }
}
```

## 4. 页面集成

### 4.1 协作页主组件

#### 4.1.1 组件结构
```typescript
// src/app/features/prototype/collaboration/collaboration.page.ts

import { Component, OnInit, OnDestroy } from '@angular/core';
import { MultiAgentOrchestratorService } from '../../../core/multi-agent/multi-agent.orchestrator.service';
import { MultiAgentEventBusService } from '../../../core/multi-agent/multi-agent.event-bus.service';
import type { WorkbenchTeamVm } from '../../../core/multi-agent/multi-agent.types';

@Component({
  selector: 'app-collaboration',
  templateUrl: './collaboration.page.html',
  styleUrls: ['./collaboration.page.scss']
})
export class CollaborationPage implements OnInit, OnDestroy {
  team: WorkbenchTeamVm | null = null;
  selectedAgentId: string | null = null;
  currentMode: string = 'collaboration';
  currentTopic: string = 'Default Topic';
  currentRound: number = 1;
  isPaused: boolean = false;
  speedMultiplier: number = 1;

  private subscriptions: any[] = [];

  constructor(
    private orchestrator: MultiAgentOrchestratorService,
    private eventBus: MultiAgentEventBusService
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.orchestrator.workbenchTeamVm$.subscribe(team => {
        this.team = team;
      }),
      this.eventBus.events$.subscribe(event => {
        this.handleEvent(event);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  handleEvent(event: any): void {
    switch (event.type) {
      case 'multiagent.teammate.spawned':
        // Handle agent spawned event
        break;
      case 'multiagent.teammate.message':
        // Handle message event
        break;
      case 'multiagent.team.updated':
        // Handle team updated event
        break;
      // Handle other events
    }
  }

  onAgentSelect(agentId: string): void {
    this.selectedAgentId = agentId;
  }

  onPlay(): void {
    this.isPaused = false;
    // Start collaboration
  }

  onPause(): void {
    this.isPaused = true;
    // Pause collaboration
  }

  onReplay(): void {
    // Replay collaboration
  }

  onSpeedChange(speed: number): void {
    this.speedMultiplier = speed;
    // Update speed
  }

  onFocusAgent(agentId: string): void {
    this.selectedAgentId = agentId;
    // Focus on agent
  }

  onExportData(): void {
    // Export data
  }

  getSelectedAgent() {
    if (!this.team || !this.selectedAgentId) return null;
    return this.team.teammates.find(agent => agent.agentId === this.selectedAgentId);
  }
}
```

#### 4.1.2 组件模板
```html
<!-- src/app/features/prototype/collaboration/collaboration.page.html -->

<div class="collaboration-page">
  <!-- Top Header -->
  <div class="header">
    <div class="header-left">
      <h1>AGENT BATTLE ARENA</h1>
    </div>
    <div class="header-center">
      <div class="mode">{{ currentMode }}</div>
      <div class="topic">{{ currentTopic }}</div>
    </div>
    <div class="header-right">
      <div class="round">Round {{ currentRound }}</div>
      <div class="status" [class.paused]="isPaused">
        {{ isPaused ? 'Paused' : 'Running' }}
      </div>
    </div>
  </div>

  <!-- Main Content -->
  <div class="main-content">
    <!-- Left Sidebar: Agents & Network -->
    <div class="left-sidebar">
      <div class="agents-section">
        <h2>Agents</h2>
        <div class="agents-container">
          <app-agent-node
            *ngFor="let agent of team?.teammates"
            [agent]="agent"
            [isCurrentTurn]="false"
            (selected)="onAgentSelect($event)"
          ></app-agent-node>
        </div>
      </div>
      <div class="network-section">
        <app-network-graph [team]="team"></app-network-graph>
      </div>
    </div>

    <!-- Center Stage -->
    <div class="center-stage">
      <app-battle-stage
        [team]="team"
        [currentMode]="currentMode"
        [currentTopic]="currentTopic"
        [currentRound]="currentRound"
      ></app-battle-stage>
    </div>

    <!-- Right Sidebar: Task & Detail -->
    <div class="right-sidebar">
      <div class="detail-section">
        <h2>Details</h2>
        <div *ngIf="getSelectedAgent() as agent" class="agent-detail">
          <h3>{{ agent.name }}</h3>
          <div class="detail-item">
            <span class="label">Status:</span>
            <span class="value">{{ agent.status }}</span>
          </div>
          <div class="detail-item">
            <span class="label">Role:</span>
            <span class="value">{{ agent.role }}</span>
          </div>
          <div class="detail-item">
            <span class="label">Backend:</span>
            <span class="value">{{ agent.backend }}</span>
          </div>
          <div class="detail-item">
            <span class="label">Model:</span>
            <span class="value">{{ agent.model }}</span>
          </div>
        </div>
        <div *ngIf="!getSelectedAgent()" class="no-selection">
          Select an agent to view details
        </div>
      </div>
    </div>
  </div>

  <!-- Bottom Control & Monitor -->
  <div class="bottom-section">
    <app-control-panel
      (play)="onPlay()"
      (pause)="onPause()"
      (replay)="onReplay()"
      (speedChange)="onSpeedChange($event)"
      (focusAgent)="onFocusAgent($event)"
      (exportData)="onExportData()"
    ></app-control-panel>
  </div>
</div>
```

#### 4.1.3 组件样式
```scss
/* src/app/features/prototype/collaboration/collaboration.page.scss */

.collaboration-page {
  width: 100vw;
  height: 100vh;
  background-color: #0a0a0a;
  color: #fff;
  font-family: 'Press Start 2P', cursive;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    background-color: #1a1a1a;
    border-bottom: 2px solid #333;
    height: 80px;

    .header-left {
      h1 {
        color: #ffcc00;
        font-size: 24px;
        margin: 0;
        text-shadow: 0 0 10px rgba(255, 204, 0, 0.5);
      }
    }

    .header-center {
      .mode {
        color: #3498db;
        font-size: 14px;
        margin-bottom: 5px;
      }
      .topic {
        color: #fff;
        font-size: 12px;
        max-width: 400px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }

    .header-right {
      display: flex;
      gap: 20px;

      .round, .status {
        color: #ccc;
        font-size: 14px;
        padding: 5px 10px;
        background-color: #2a2a2a;
        border-radius: 4px;
      }

      .status.paused {
        color: #f39c12;
      }
    }
  }

  .main-content {
    flex: 1;
    display: flex;
    overflow: hidden;

    .left-sidebar {
      width: 300px;
      background-color: #1a1a1a;
      border-right: 2px solid #333;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      .agents-section {
        padding: 20px;
        border-bottom: 2px solid #333;

        h2 {
          color: #3498db;
          font-size: 16px;
          margin-bottom: 20px;
        }

        .agents-container {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
          max-height: 300px;
          overflow-y: auto;
        }
      }

      .network-section {
        flex: 1;
        padding: 20px;
        overflow: hidden;
      }
    }

    .center-stage {
      flex: 1;
      padding: 20px;
      overflow: hidden;
    }

    .right-sidebar {
      width: 300px;
      background-color: #1a1a1a;
      border-left: 2px solid #333;
      padding: 20px;
      overflow-y: auto;

      .detail-section {
        h2 {
          color: #3498db;
          font-size: 16px;
          margin-bottom: 20px;
        }

        .agent-detail {
          background-color: #2a2a2a;
          border: 2px solid #333;
          border-radius: 8px;
          padding: 15px;

          h3 {
            color: #ffcc00;
            font-size: 14px;
            margin-bottom: 15px;
          }

          .detail-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;

            .label {
              color: #ccc;
              font-size: 12px;
            }

            .value {
              color: #fff;
              font-size: 12px;
            }
          }
        }

        .no-selection {
          color: #666;
          font-size: 12px;
          text-align: center;
          padding: 20px;
          background-color: #2a2a2a;
          border: 2px solid #333;
          border-radius: 8px;
        }
      }
    }
  }

  .bottom-section {
    height: 80px;
    background-color: #1a1a1a;
    border-top: 2px solid #333;
    padding: 15px 20px;
  }
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: #1a1a1a;
}

::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #444;
}
```

## 5. 数据流与状态管理

### 5.1 核心状态

| 状态 | 类型 | 描述 |
|------|------|------|
| sessionId | string | 会话ID |
| mode | string | 协作模式 |
| currentTopic | string | 当前议题 |
| currentRound | number | 当前回合 |
| currentPhase | string | 当前阶段 |
| activeAgentIds | string[] | 活跃Agent ID列表 |
| selectedAgentId | string | 选中的Agent ID |
| selectedTaskId | string | 选中的任务ID |
| speedMulti