import { Component, signal, computed, ElementRef, ViewChild, Input, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';

// 节点类型 - 移除agent类型，只保留任务和流程控制
export type NodeType = 'task' | 'start' | 'end' | 'decision' | 'merge' | 'loop';

// 分配规则类型
export type AssignmentRule = 'none' | 'fixed' | 'round-robin' | 'load-balance' | 'broadcast' | 'role-match';

// 连线类型
export type EdgeType = 'serial' | 'parallel' | 'conditional';

// 任务节点接口
export interface TaskNode {
  id: string;
  type: 'task';
  x: number;
  y: number;
  label: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  assignmentRule: AssignmentRule;
  assignedAgentId: string | null;
  assignedGroupId: string | null;
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];
  condition?: string; // 分支条件
  timeout?: number; // 超时时间（秒）
  retries?: number; // 重试次数
}

// 流程控制节点接口
export interface ControlNode {
  id: string;
  type: 'start' | 'end' | 'decision' | 'merge' | 'loop';
  x: number;
  y: number;
  label: string;
  condition?: string; // 用于条件分支
}

// 统一节点类型
export type CanvasNode = TaskNode | ControlNode;

// 连线接口
export interface CanvasEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  label?: string;
  condition?: string; // 条件分支的标注
}

// Agent分组接口
export interface AgentGroup {
  id: string;
  name: string;
  agents: string[]; // agent IDs
  color: string;
}

// Agent接口
export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  groupId: string;
  status: 'idle' | 'running' | 'busy';
  load: number; // 0-100
  currentTaskId: string | null;
}

// 画布状态
export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  zoom: number;
  pan: { x: number; y: number };
}

// 输入数据接口
export interface InputTask {
  id: string;
  title: string;
  description: string;
  assignedAgentId: string | null;
  status: string;
  priority: string;
  dependencies: string[];
}

export interface InputAgent {
  id: string;
  name: string;
  role: string;
  status: string;
}

@Component({
  selector: 'app-orchestration-canvas',
  standalone: true,
  template: `
    <div class="orchestration-canvas-container">
      <!-- 主画布区域 -->
      <div class="canvas-main-area">
        <!-- 工具栏 -->
        <div class="canvas-toolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn" (click)="addTaskNode()">+ 任务</button>
            <button class="toolbar-btn" (click)="addDecisionNode()">◇ 分支</button>
            <button class="toolbar-btn" (click)="addMergeNode()">⊕ 合并</button>
          </div>
          <div class="toolbar-group">
            <button class="toolbar-btn btn-start" (click)="startExecution()">▶ 开始执行</button>
            <button class="toolbar-btn" (click)="resetCanvas()">↻ 重置</button>
          </div>
          <div class="toolbar-group">
            <button class="toolbar-btn" (click)="zoomIn()">+ 放大</button>
            <button class="toolbar-btn" (click)="zoomOut()">- 缩小</button>
            <button class="toolbar-btn" (click)="fitView()">⊞ 适应</button>
          </div>
          <div class="toolbar-group">
            <button class="toolbar-btn" (click)="alignHorizontal()" title="水平对齐">⇔ 水平</button>
            <button class="toolbar-btn" (click)="alignVertical()" title="垂直对齐">⇕ 垂直</button>
            <button class="toolbar-btn" (click)="distributeEvenly()" title="均匀分布">☷ 分布</button>
            <button class="toolbar-btn" (click)="alignBranchNodes()" title="对齐分支">◇ 分支</button>
          </div>
          <div class="toolbar-group">
            <button class="toolbar-btn" (click)="togglePreviewMode()">
              {{ showPreview() ? '隐藏分配预览' : '显示分配预览' }}
            </button>
            <button class="toolbar-btn" (click)="exportCanvas()">⬇ 导出</button>
          </div>
        </div>

        <!-- 画布 -->
        <div class="canvas-wrapper" #canvasWrapper>
          <div
            #canvas
            class="canvas"
            (mousedown)="onMouseDown($event)"
            (mousemove)="onMouseMove($event)"
            (mouseup)="onMouseUp($event)"
            (mouseleave)="onMouseUp($event)"
            (click)="onCanvasClick($event)"
            [style.transform]="canvasTransform()"
          >
            <!-- 网格背景 -->
            <svg class="grid" width="5000" height="5000">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a2a1a" stroke-width="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)"/>
            </svg>

            <!-- 连线层 -->
            <svg class="edges-layer" width="5000" height="5000">
              @for (edge of edges(); track edge.id) {
                <g class="edge-group">
                  <!-- 连线 -->
                  <path
                    [attr.d]="getEdgePath(edge)"
                    [class.edge-serial]="edge.type === 'serial'"
                    [class.edge-parallel]="edge.type === 'parallel'"
                    [class.edge-conditional]="edge.type === 'conditional'"
                    [class.edge-selected]="selectedNodeId() === edge.sourceId || selectedNodeId() === edge.targetId"
                  />
                  <!-- 连线标签 -->
                  @if (edge.label || edge.condition) {
                    <text
                      [attr.x]="getEdgeCenterX(edge)"
                      [attr.y]="getEdgeCenterY(edge) - 5"
                      font-size="10"
                      fill="#00ff41"
                      text-anchor="middle"
                      class="edge-label"
                    >{{ edge.condition || edge.label }}</text>
                  }
                </g>
              }

              <!-- 分配预览连线（淡色虚线指向Agent分组） -->
              @if (showPreview()) {
                @for (previewEdge of previewEdges(); track previewEdge.id) {
                  <line
                    [attr.x1]="previewEdge.x1"
                    [attr.y1]="previewEdge.y1"
                    [attr.x2]="previewEdge.x2"
                    [attr.y2]="previewEdge.y2"
                    stroke="#8b5cf6"
                    stroke-width="1"
                    stroke-dasharray="4,4"
                    opacity="0.4"
                  />
                }
              }
            </svg>

            <!-- 节点层 -->
            @for (node of nodes(); track node.id) {
              <div
                class="canvas-node"
                [class.node-task]="node.type === 'task'"
                [class.node-start]="node.type === 'start'"
                [class.node-end]="node.type === 'end'"
                [class.node-decision]="node.type === 'decision'"
                [class.node-merge]="node.type === 'merge'"
                [class.node-loop]="node.type === 'loop'"
                [class.selected]="selectedNodeId() === node.id"
                [class.status-pending]="node.type === 'task' && node.status === 'pending'"
                [class.status-running]="node.type === 'task' && node.status === 'running'"
                [class.status-completed]="node.type === 'task' && node.status === 'completed'"
                [class.status-failed]="node.type === 'task' && node.status === 'failed'"
                [class.drop-target]="isDragOver() === node.id"
                [style.left.px]="node.x"
                [style.top.px]="node.y"
                [style.width.px]="getNodeWidth(node)"
                [style.height.px]="getNodeHeight(node)"
                (mousedown)="onNodeMouseDown($event, node)"
                (dblclick)="onNodeDoubleClick($event, node)"
                (contextmenu)="onNodeRightClick($event, node)"
                (dragover)="onNodeDragOver($event, node)"
                (dragleave)="onNodeDragLeave($event)"
                (drop)="onNodeDrop($event, node)"
              >
                <!-- 任务节点内容 -->
                @if (node.type === 'task') {
                  <div class="node-header">
                    <span class="node-icon">📋</span>
                    <span class="node-title">{{ node.label }}</span>
                  </div>
                  
                  @if (node.description) {
                    <div class="node-description">{{ node.description }}</div>
                  }
                  
                  <!-- 分配规则标签 -->
                  <div class="assignment-tag" [class]="getAssignmentTagClass(node)">
                    {{ getAssignmentTagText(node) }}
                  </div>

                  <!-- 状态和进度 -->
                  <div class="node-body">
                    <div class="status-bar">
                      <span class="status-text">{{ getStatusText(node.status) }}</span>
                      @if (node.status === 'running') {
                        <div class="progress-bar">
                          <div class="progress-fill" [style.width.%]="node.progress"></div>
                        </div>
                      }
                    </div>
                  </div>

                  <!-- 连接点 -->
                  <div class="node-handle handle-top" (mousedown)="startConnection($event, node.id)"></div>
                  <div class="node-handle handle-bottom" (mousedown)="startConnection($event, node.id)"></div>
                }

                <!-- 流程控制节点内容 -->
                @if (node.type === 'start' || node.type === 'end') {
                  <div class="control-node-content">
                    <span class="node-icon">{{ node.type === 'start' ? '▶' : '⬛' }}</span>
                    <span class="node-label">{{ node.label }}</span>
                  </div>
                  <div class="node-handle handle-bottom" (mousedown)="startConnection($event, node.id)"></div>
                }

                @if (node.type === 'decision' || node.type === 'merge') {
                  <div class="diamond-shape">
                    <span class="diamond-icon">{{ node.type === 'decision' ? '◇' : '⊕' }}</span>
                  </div>
                  <span class="node-label diamond-label">{{ node.label }}</span>
                  @if (node.type === 'decision' && node.condition) {
                    <span class="condition-text">{{ node.condition }}</span>
                  }
                  <div class="node-handle handle-top" (mousedown)="startConnection($event, node.id)"></div>
                  <div class="node-handle handle-bottom" (mousedown)="startConnection($event, node.id)"></div>
                  <div class="node-handle handle-left" (mousedown)="startConnection($event, node.id)"></div>
                  <div class="node-handle handle-right" (mousedown)="startConnection($event, node.id)"></div>
                }
              </div>
            }

            <!-- 临时连线 -->
            @if (isConnecting() && connectingFrom()) {
              <svg class="temp-edge" width="5000" height="5000">
                <line
                  [attr.x1]="getNodeCenterX(connectingFrom()!)"
                  [attr.y1]="getNodeCenterY(connectingFrom()!)"
                  [attr.x2]="mousePos().x"
                  [attr.y2]="mousePos().y"
                  stroke="#fbbf24"
                  stroke-width="2"
                  stroke-dasharray="5,5"
                />
              </svg>
            }
          </div>
        </div>
      </div>

      <!-- 右侧资源调度面板 -->
      <div class="resource-panel">
        <div class="panel-header">
          <span class="panel-title">资源调度</span>
          <span class="panel-subtitle">Agent管理</span>
        </div>

        <!-- Agent分组列表 -->
        <div class="panel-section">
          <h3 class="section-title">Agent分组</h3>
          @for (group of agentGroups(); track group.id) {
            <div class="group-item" [class.group-expanded]="expandedGroups().includes(group.id)">
              <div class="group-header" (click)="toggleGroup(group.id)">
                <span class="group-toggle">{{ expandedGroups().includes(group.id) ? '▼' : '▶' }}</span>
                <span class="group-color" [style.background]="group.color"></span>
                <span class="group-name">{{ group.name }}</span>
                <span class="group-count">{{ group.agents.length }}</span>
              </div>
              @if (expandedGroups().includes(group.id)) {
                <div class="group-agents">
                  @for (agentId of group.agents; track agentId) {
                    @let agent = getAgentById(agentId);
                    @if (agent) {
                      <div class="agent-card" [class.agent-running]="agent.status === 'running'"
                           draggable="true"
                           (dragstart)="onAgentDragStart($event, agent.id)"
                           (dragend)="onAgentDragEnd($event)">
                        <div class="agent-info">
                          <span class="agent-name">{{ agent.name }}</span>
                          <span class="agent-role">{{ agent.role }}</span>
                        </div>
                        <div class="agent-status-bar">
                          <span class="agent-status" [class]="agent.status">{{ getAgentStatusText(agent.status) }}</span>
                          @if (agent.status === 'running') {
                            <div class="agent-load-bar">
                              <div class="agent-load-fill" [style.width.%]="agent.load"></div>
                            </div>
                            <span class="agent-load-text">{{ agent.load }}%</span>
                          }
                        </div>
                      </div>
                    }
                  }
                </div>
              }
            </div>
          }
        </div>

        <!-- 任务分配配置区 -->
        <div class="panel-section">
          <h3 class="section-title">任务分配配置</h3>
          @if (selectedTaskNode()) {
            <div class="assignment-config">
              <div class="config-item">
                <label>当前任务</label>
                <span class="config-value">{{ selectedTaskNode()!.label }}</span>
              </div>
              
              <div class="config-item">
                <label>分配规则</label>
                <select class="config-select" [value]="selectedTaskNode()!.assignmentRule" (change)="updateAssignmentRule(selectedTaskNode()!.id, $event)">
                  <option value="none">无分配</option>
                  <option value="fixed">固定分配</option>
                  <option value="round-robin">轮询分配</option>
                  <option value="load-balance">负载均衡</option>
                  <option value="broadcast">广播分配</option>
                  <option value="role-match">按角色匹配</option>
                </select>
              </div>

              @if (selectedTaskNode()!.assignmentRule !== 'none' && selectedTaskNode()!.assignmentRule !== 'broadcast') {
                <div class="config-item">
                  <label>分配目标</label>
                  <select class="config-select" [value]="selectedTaskNode()!.assignedGroupId || selectedTaskNode()!.assignedAgentId" (change)="updateAssignmentTarget(selectedTaskNode()!.id, $event)">
                    <option value="">请选择...</option>
                    <optgroup label="Agent分组">
                      @for (group of agentGroups(); track group.id) {
                        <option [value]="'group:' + group.id">{{ group.name }}</option>
                      }
                    </optgroup>
                    <optgroup label="Agent">
                      @for (agent of agentInfoList(); track agent.id) {
                        <option [value]="'agent:' + agent.id">{{ agent.name }}</option>
                      }
                    </optgroup>
                  </select>
                </div>
              }

              <div class="config-actions">
                <button class="btn-apply" (click)="applyAssignment(selectedTaskNode()!.id)">应用配置</button>
              </div>
            </div>
          } @else {
            <p class="no-selection">选择任务节点查看分配配置</p>
          }
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    @if (contextMenu()) {
      <div class="context-menu" [style.left.px]="contextMenu()!.x" [style.top.px]="contextMenu()!.y">
        <div class="menu-item" (click)="openTaskConfigDialogForNode(contextMenu()!.nodeId)">⚙ 编辑任务配置</div>
        <div class="menu-item" (click)="editPrompt()">✏ 编辑提示词</div>
        <div class="menu-divider"></div>
        <div class="menu-item" (click)="setAssignmentRule('fixed')">固定分配</div>
        <div class="menu-item" (click)="setAssignmentRule('round-robin')">轮询分配</div>
        <div class="menu-item" (click)="setAssignmentRule('load-balance')">负载均衡</div>
        <div class="menu-item" (click)="setAssignmentRule('broadcast')">广播分配</div>
        <div class="menu-divider"></div>
        <div class="menu-item" (click)="duplicateNode()">📋 复制节点</div>
        <div class="menu-item" (click)="renameNode()">✎ 重命名</div>
        <div class="menu-item" (click)="setBranchRule()">◇ 设置分支规则</div>
        <div class="menu-divider"></div>
        <div class="menu-item" (click)="jumpToResourcePanel()">跳转到资源面板</div>
        <div class="menu-item menu-delete" (click)="deleteSelectedNode()">✕ 删除节点</div>
      </div>
    }

    <!-- 任务配置弹窗 -->
    @if (showTaskConfigDialog()) {
      <div class="modal-overlay" (click)="closeTaskConfigDialog()">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <span class="modal-title">⚙ 任务配置</span>
            <button class="modal-close" (click)="closeTaskConfigDialog()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>任务名称</label>
              <input class="form-input" [value]="editingTask()?.label || ''" (input)="updateEditingTask('label', $event)" placeholder="输入任务名称" />
            </div>
            <div class="form-group">
              <label>任务提示词（支持模板变量 $&#123;variable&#125;）</label>
              <textarea class="form-textarea" [value]="editingTask()?.description || ''" (input)="updateEditingTask('description', $event)" rows="4" placeholder="输入任务提示词..."></textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>超时时间（秒）</label>
                <input class="form-input" type="number" [value]="editingTaskTimeout()" (input)="updateEditingTaskTimeout($event)" placeholder="300" />
              </div>
              <div class="form-group">
                <label>重试次数</label>
                <input class="form-input" type="number" [value]="editingTaskRetries()" (input)="updateEditingTaskRetries($event)" placeholder="3" />
              </div>
            </div>
            <div class="form-group">
              <label>优先级</label>
              <select class="form-select" [value]="editingTask()?.priority || 'medium'" (change)="updateEditingTaskPriority($event)">
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="closeTaskConfigDialog()">取消</button>
            <button class="btn btn-primary" (click)="saveTaskConfig()">保存</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .orchestration-canvas-container {
      display: flex;
      flex-direction: row;
      height: 100%;
      min-height: 500px;
      background: #0a0a0a;
      border: 1px solid #00ff41;
      border-radius: 4px;
      overflow: hidden;
      font-family: 'Courier New', monospace;
    }

    .canvas-main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    .canvas-toolbar {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      background: linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%);
      border-bottom: 1px solid #00ff41;
      z-index: 100;
      flex-wrap: wrap;
      align-items: center;
    }

    .toolbar-group {
      display: flex;
      gap: 4px;
      padding-right: 8px;
      border-right: 1px solid #333;
    }

    .toolbar-group:last-child {
      border-right: none;
    }

    .toolbar-btn {
      padding: 4px 10px;
      border: 1px solid #00ff41;
      border-radius: 2px;
      background: #0a0a0a;
      color: #00ff41;
      cursor: pointer;
      font-size: 11px;
      font-family: 'Courier New', monospace;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .toolbar-btn:hover {
      background: #00ff41;
      color: #0a0a0a;
    }

    .toolbar-btn.btn-start {
      background: #00ff41;
      color: #0a0a0a;
      font-weight: bold;
    }

    .toolbar-btn.btn-start:hover {
      background: #00cc33;
    }

    .canvas-wrapper {
      flex: 1;
      overflow: auto;
      position: relative;
    }

    .canvas {
      position: relative;
      min-width: 5000px;
      min-height: 5000px;
      transform-origin: 0 0;
    }

    .grid, .edges-layer, .temp-edge {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }

    .edge-group {
      pointer-events: auto;
    }

    .edge-serial {
      stroke: #00ff41;
      stroke-width: 2;
      fill: none;
    }

    .edge-parallel {
      stroke: #00ff41;
      stroke-width: 2;
      stroke-dasharray: 6,4;
      fill: none;
    }

    .edge-conditional {
      stroke: #fbbf24;
      stroke-width: 2;
      fill: none;
    }

    .edge-selected {
      stroke-width: 3;
      filter: drop-shadow(0 0 4px rgba(0, 255, 65, 0.6));
    }

    .edge-label {
      pointer-events: none;
    }

    .canvas-node {
      position: absolute;
      cursor: move;
      user-select: none;
      z-index: 10;
      transition: box-shadow 0.2s, border-color 0.2s;
    }

    .canvas-node:hover {
      box-shadow: 0 0 15px rgba(0, 255, 65, 0.3);
    }

    .canvas-node.selected {
      box-shadow: 0 0 0 2px rgba(0, 255, 65, 0.4), 0 0 20px rgba(0, 255, 65, 0.2);
    }

    .canvas-node.drop-target {
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.6), 0 0 30px rgba(139, 92, 246, 0.4);
      border-color: #8b5cf6 !important;
    }

    /* 任务节点样式 */
    .node-task {
      background: linear-gradient(135deg, #0a1a0a 0%, #0a0a0a 100%);
      border: 2px solid #00ff41;
      border-radius: 4px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .node-task.status-running {
      animation: pulse-running 1.5s infinite;
    }

    .node-task.status-completed {
      border-color: #22c55e;
      opacity: 0.8;
    }

    .node-task.status-failed {
      border-color: #ef4444;
      opacity: 0.7;
    }

    @keyframes pulse-running {
      0%, 100% { box-shadow: 0 0 5px rgba(0, 255, 65, 0.3); }
      50% { box-shadow: 0 0 20px rgba(0, 255, 65, 0.6); }
    }

    .node-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .node-icon {
      font-size: 14px;
    }

    .node-title {
      font-size: 11px;
      color: #00ff41;
      font-weight: bold;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-description {
      font-size: 9px;
      color: #666;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-left: 20px;
    }

    .assignment-tag {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 10px;
      background: #333;
      color: #888;
      text-align: center;
      white-space: nowrap;
    }

    .assignment-tag.fixed {
      background: rgba(139, 92, 246, 0.2);
      color: #8b5cf6;
      border: 1px solid #8b5cf6;
    }

    .assignment-tag.round-robin {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
      border: 1px solid #3b82f6;
    }

    .assignment-tag.load-balance {
      background: rgba(236, 72, 153, 0.2);
      color: #ec4899;
      border: 1px solid #ec4899;
    }

    .assignment-tag.broadcast {
      background: rgba(251, 191, 36, 0.2);
      color: #fbbf24;
      border: 1px solid #fbbf24;
    }

    .assignment-tag.role-match {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
      border: 1px solid #22c55e;
    }

    .node-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .status-bar {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-text {
      font-size: 9px;
      color: #888;
    }

    .progress-bar {
      flex: 1;
      height: 4px;
      background: #1a1a1a;
      border-radius: 2px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00ff41, #22c55e);
      transition: width 0.3s;
    }

    /* 流程控制节点样式 */
    .node-start, .node-end {
      background: linear-gradient(135deg, #0a1a0a 0%, #0a0a0a 100%);
      border: 2px solid #22c55e;
      border-radius: 20px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .node-end {
      border-color: #ef4444;
    }

    .control-node-content {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .node-label {
      font-size: 10px;
      color: #00ff41;
      text-align: center;
    }

    .node-decision, .node-merge, .node-loop {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .diamond-shape {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #1a1a0a 0%, #0a0a0a 100%);
      border: 2px solid #f59e0b;
      transform: rotate(45deg);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 10px 0;
    }

    .diamond-icon {
      transform: rotate(-45deg);
      font-size: 16px;
      color: #f59e0b;
    }

    .diamond-label {
      margin-top: 4px;
    }

    .condition-text {
      font-size: 9px;
      color: #fbbf24;
      margin-top: 2px;
    }

    /* 连接点 */
    .node-handle {
      position: absolute;
      width: 8px;
      height: 8px;
      background: #00ff41;
      border-radius: 50%;
      cursor: crosshair;
      z-index: 20;
      transition: transform 0.2s;
    }

    .node-handle:hover {
      transform: scale(1.3);
    }

    .handle-top { top: -4px; left: 50%; transform: translateX(-50%); }
    .handle-bottom { bottom: -4px; left: 50%; transform: translateX(-50%); }
    .handle-left { left: -4px; top: 50%; transform: translateY(-50%); }
    .handle-right { right: -4px; top: 50%; transform: translateY(-50%); }

    /* 资源调度面板 */
    .resource-panel {
      width: 280px;
      background: #0a0a0a;
      border-left: 1px solid #00ff41;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .panel-header {
      padding: 12px;
      background: linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%);
      border-bottom: 1px solid #00ff41;
    }

    .panel-title {
      font-size: 13px;
      color: #00ff41;
      font-weight: bold;
      display: block;
    }

    .panel-subtitle {
      font-size: 10px;
      color: #666;
      display: block;
      margin-top: 2px;
    }

    .panel-section {
      padding: 12px;
      border-bottom: 1px solid #333;
    }

    .section-title {
      font-size: 11px;
      color: #00ff41;
      margin: 0 0 10px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid #333;
    }

    .group-item {
      margin-bottom: 8px;
    }

    .group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: #111;
      border: 1px solid #333;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .group-header:hover {
      background: #1a1a1a;
      border-color: #00ff41;
    }

    .group-toggle {
      font-size: 10px;
      color: #666;
    }

    .group-color {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .group-name {
      flex: 1;
      font-size: 11px;
      color: #ccc;
    }

    .group-count {
      font-size: 10px;
      color: #666;
      background: #222;
      padding: 1px 6px;
      border-radius: 10px;
    }

    .group-agents {
      margin-top: 6px;
      padding-left: 12px;
    }

    .agent-card {
      padding: 8px;
      margin-bottom: 6px;
      background: #0a0a0a;
      border: 1px solid #333;
      border-radius: 4px;
      transition: all 0.2s;
      cursor: grab;
    }

    .agent-card:hover {
      border-color: #8b5cf6;
      box-shadow: 0 0 10px rgba(139, 92, 246, 0.3);
    }

    .agent-card:active {
      cursor: grabbing;
    }

    .agent-card.agent-running {
      border-color: #00ff41;
    }

    .agent-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .agent-name {
      font-size: 11px;
      color: #00ff41;
      font-weight: bold;
    }

    .agent-role {
      font-size: 9px;
      color: #8b5cf6;
      background: rgba(139, 92, 246, 0.2);
      padding: 1px 6px;
      border-radius: 10px;
    }

    .agent-status-bar {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .agent-status {
      font-size: 9px;
      padding: 1px 6px;
      border-radius: 10px;
    }

    .agent-status.idle {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .agent-status.running {
      background: rgba(0, 255, 65, 0.2);
      color: #00ff41;
    }

    .agent-status.busy {
      background: rgba(251, 191, 36, 0.2);
      color: #fbbf24;
    }

    .agent-load-bar {
      flex: 1;
      height: 4px;
      background: #1a1a1a;
      border-radius: 2px;
      overflow: hidden;
    }

    .agent-load-fill {
      height: 100%;
      background: linear-gradient(90deg, #00ff41, #fbbf24);
      transition: width 0.3s;
    }

    .agent-load-text {
      font-size: 9px;
      color: #666;
    }

    /* 任务分配配置 */
    .assignment-config {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .config-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .config-item label {
      font-size: 10px;
      color: #666;
    }

    .config-value {
      font-size: 11px;
      color: #00ff41;
      padding: 6px 8px;
      background: #111;
      border: 1px solid #333;
      border-radius: 4px;
    }

    .config-select {
      padding: 6px 8px;
      background: #111;
      border: 1px solid #333;
      border-radius: 4px;
      color: #00ff41;
      font-size: 11px;
      font-family: 'Courier New', monospace;
    }

    .config-select:focus {
      border-color: #00ff41;
      outline: none;
    }

    .config-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }

    .btn-apply {
      flex: 1;
      padding: 6px 12px;
      background: #00ff41;
      color: #0a0a0a;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-weight: bold;
      font-family: 'Courier New', monospace;
      transition: all 0.2s;
    }

    .btn-apply:hover {
      background: #00cc33;
    }

    .no-selection {
      font-size: 11px;
      color: #666;
      font-style: italic;
    }

    /* 右键菜单 */
    .context-menu {
      position: fixed;
      background: #1a1a1a;
      border: 1px solid #00ff41;
      border-radius: 4px;
      padding: 6px 0;
      z-index: 1000;
      min-width: 150px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }

    .menu-item {
      padding: 8px 16px;
      font-size: 11px;
      color: #00ff41;
      cursor: pointer;
      transition: all 0.2s;
    }

    .menu-item:hover {
      background: #00ff41;
      color: #0a0a0a;
    }

    .menu-divider {
      height: 1px;
      background: #333;
      margin: 4px 0;
    }

    .menu-delete {
      color: #ef4444;
    }

    .menu-delete:hover {
      background: #ef4444;
      color: #0a0a0a;
    }

    /* 任务配置弹窗 */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }

    .modal-content {
      background: #0a0a0a;
      border: 2px solid #00ff41;
      border-radius: 8px;
      padding: 20px;
      min-width: 500px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 0 30px rgba(0, 255, 65, 0.3);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid #333;
    }

    .modal-title {
      font-size: 16px;
      color: #00ff41;
      font-weight: bold;
    }

    .modal-close {
      background: none;
      border: none;
      color: #00ff41;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-close:hover {
      background: #00ff41;
      color: #0a0a0a;
      border-radius: 4px;
    }

    .modal-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-group label {
      font-size: 12px;
      color: #00ff41;
      font-weight: bold;
    }

    .form-input, .form-textarea, .form-select {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 8px 12px;
      color: #00ff41;
      font-family: 'Courier New', monospace;
      font-size: 12px;
    }

    .form-input:focus, .form-textarea:focus, .form-select:focus {
      outline: none;
      border-color: #00ff41;
      box-shadow: 0 0 5px rgba(0, 255, 65, 0.5);
    }

    .form-textarea {
      resize: vertical;
      min-height: 80px;
    }

    .form-row {
      display: flex;
      gap: 16px;
    }

    .form-row .form-group {
      flex: 1;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid #333;
    }

    .btn {
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: 'Courier New', monospace;
      transition: all 0.2s;
    }

    .btn-secondary {
      background: #333;
      border: 1px solid #555;
      color: #ccc;
    }

    .btn-secondary:hover {
      background: #444;
    }

    .btn-primary {
      background: #00ff41;
      border: 1px solid #00ff41;
      color: #0a0a0a;
      font-weight: bold;
    }

    .btn-primary:hover {
      background: #00cc33;
    }
  `]
})
export class OrchestrationCanvasComponent implements OnChanges {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasWrapper') canvasWrapperRef!: ElementRef<HTMLDivElement>;

  // 输入数据
  @Input() agents: InputAgent[] = [];
  @Input() tasks: InputTask[] = [];
  @Input() mode: string = 'battle';

  // 输出事件
  @Output() taskStarted = new EventEmitter<string>();
  @Output() taskCompleted = new EventEmitter<string>();
  @Output() nodeSelected = new EventEmitter<string>();

  // Agent分组数据
  private agentGroupsData = signal<AgentGroup[]>([
    { id: 'red-team', name: '红队', agents: [], color: '#ef4444' },
    { id: 'blue-team', name: '蓝队', agents: [], color: '#3b82f6' },
    { id: 'developers', name: '开发者组', agents: [], color: '#22c55e' },
    { id: 'reviewers', name: '评审组', agents: [], color: '#f59e0b' },
  ]);

  // Agent详细信息
  private agentsData = signal<AgentInfo[]>([]);

  agentGroups = computed(() => this.agentGroupsData());
  agentInfoList = computed(() => this.agentsData());

  // 画布状态
  private state = signal<CanvasState>({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    zoom: 1,
    pan: { x: 0, y: 0 }
  });

  nodes = computed(() => this.state().nodes);
  edges = computed(() => this.state().edges);
  selectedNodeId = computed(() => this.state().selectedNodeId);
  
  selectedTaskNode = computed(() => {
    const id = this.selectedNodeId();
    if (!id) return null;
    const node = this.nodes().find(n => n.id === id);
    return node && node.type === 'task' ? node : null;
  });

  // 展开的分组
  private expandedGroupsList = signal<string[]>(['red-team', 'blue-team']);
  expandedGroups = computed(() => this.expandedGroupsList());

  // 显示分配预览
  private showPreviewMode = signal(false);
  showPreview = computed(() => this.showPreviewMode());

  // 右键菜单
  private contextMenuData = signal<{ x: number; y: number; nodeId: string } | null>(null);
  contextMenu = computed(() => this.contextMenuData());

  // 任务配置弹窗状态
  private showTaskConfigDialogState = signal(false);
  showTaskConfigDialog = computed(() => this.showTaskConfigDialogState());
  private editingTaskData = signal<TaskNode | null>(null);
  editingTask = computed(() => this.editingTaskData());
  private editingTaskTimeoutValue = signal(300);
  editingTaskTimeout = computed(() => this.editingTaskTimeoutValue());
  private editingTaskRetriesValue = signal(3);
  editingTaskRetries = computed(() => this.editingTaskRetriesValue());

  // 拖拽和连线状态
  private dragStartPos = { x: 0, y: 0 };
  private dragNodeStartPos = { x: 0, y: 0 };
  private isDraggingNode = signal(false);
  readonly isConnecting = signal(false);
  readonly connectingFrom = signal<string | null>(null);
  readonly mousePos = signal({ x: 0, y: 0 });

  // Agent拖拽分配状态
  private draggingAgentId = signal<string | null>(null);
  private isDragOverNode = signal<string | null>(null);
  isDragOver = computed(() => this.isDragOverNode());

  canvasTransform = computed(() => {
    const s = this.state().zoom;
    const pan = this.state().pan;
    return `translate(${pan.x}px, ${pan.y}px) scale(${s})`;
  });

  // 预览连线（任务节点到Agent分组的淡色虚线）
  previewEdges = computed(() => {
    const previews: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> = [];
    const taskNodes = this.nodes().filter(n => n.type === 'task') as TaskNode[];
    
    taskNodes.forEach(task => {
      if (task.assignedGroupId) {
        const groupIndex = this.agentGroups().findIndex(g => g.id === task.assignedGroupId);
        if (groupIndex >= 0) {
          previews.push({
            id: `preview-${task.id}`,
            x1: task.x + 60,
            y1: task.y + 30,
            x2: 5000,
            y2: 100 + groupIndex * 120,
          });
        }
      }
    });

    return previews;
  });

  constructor() {
    this.syncAgentsData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['agents']) {
      this.syncAgentsData();
    }
    if (changes['tasks'] || changes['mode']) {
      this.syncFromData();
    }
  }

  // 同步Agent数据
  private syncAgentsData(): void {
    const groups = this.agentGroupsData();
    const agentsList: AgentInfo[] = this.agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      groupId: this.findAgentGroupId(agent.id),
      status: agent.status === 'running' ? 'running' : 'idle',
      load: agent.status === 'running' ? 75 : 0,
      currentTaskId: null,
    }));

    this.agentsData.set(agentsList);

    // 更新分组成员
    const updatedGroups = groups.map(group => ({
      ...group,
      agents: agentsList.filter(a => a.groupId === group.id).map(a => a.id),
    }));
    this.agentGroupsData.set(updatedGroups);
  }

  private findAgentGroupId(agentId: string): string {
    const agent = this.agents.find(a => a.id === agentId);
    if (!agent) return 'developers';
    
    const role = agent.role.toLowerCase();
    const name = agent.name.toLowerCase();
    
    if (role.includes('red') || name.includes('红') || name.includes('red')) return 'red-team';
    if (role.includes('blue') || name.includes('蓝') || name.includes('blue')) return 'blue-team';
    if (role.includes('architect') || name.includes('架构')) return 'developers';
    if (role.includes('analyst') || name.includes('分析') || name.includes('辩')) return 'reviewers';
    if (role.includes('developer') || name.includes('开发') || name.includes('竞争')) return 'developers';
    if (role.includes('tester') || name.includes('测试') || name.includes('裁判') || name.includes('评委')) return 'reviewers';
    if (role.includes('devops') || name.includes('运维')) return 'developers';
    if (role.includes('product') || name.includes('产品') || name.includes('主持')) return 'developers';
    
    return 'developers';
  }

  getAgentById(agentId: string): AgentInfo | undefined {
    return this.agentInfoList().find(a => a.id === agentId);
  }

  getAgentStatusText(status: string): string {
    const map: Record<string, string> = {
      'idle': '空闲',
      'running': '运行中',
      'busy': '繁忙',
    };
    return map[status] || status;
  }

  // 从输入数据同步画布
  private syncFromData(): void {
    const newNodes: CanvasNode[] = [];
    const newEdges: CanvasEdge[] = [];

    // 添加开始节点
    newNodes.push({
      id: 'start',
      type: 'start',
      x: 100,
      y: 250,
      label: '开始',
    });

    // 根据模式生成任务流结构
    const taskFlow = this.generateTaskFlowForMode(this.mode, this.tasks);
    
    taskFlow.nodes.forEach(node => {
      newNodes.push(node);
    });

    taskFlow.edges.forEach(edge => {
      newEdges.push(edge);
    });

    // 添加结束节点
    if (newNodes.length > 1) {
      const lastY = newNodes[newNodes.length - 1].y;
      newNodes.push({
        id: 'end',
        type: 'end',
        x: 100,
        y: lastY + 150,
        label: '结束',
      });

      // 连接最后一个节点到结束
      const lastTaskNode = newNodes.filter(n => n.type === 'task').pop();
      if (lastTaskNode) {
        newEdges.push({
          id: `edge-${lastTaskNode.id}-end`,
          sourceId: lastTaskNode.id,
          targetId: 'end',
          type: 'serial',
        });
      }
    }

    // 连接开始到第一个任务
    const firstTask = newNodes.find(n => n.type === 'task');
    if (firstTask) {
      newEdges.push({
        id: 'edge-start-first',
        sourceId: 'start',
        targetId: firstTask.id,
        type: 'serial',
      });
    }

    this.state.update(prev => ({
      ...prev,
      nodes: newNodes,
      edges: newEdges,
    }));
  }

  // 根据模式生成任务流
  private generateTaskFlowForMode(mode: string, tasks: InputTask[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];

    const startX = 150;
    const startY = 100;
    const gapY = 120;

    switch (mode) {
      case 'battle': // 对抗模式 - 双分支并行
        nodes.push(
          { id: 'decision-1', type: 'decision', x: startX, y: startY, label: '分支', condition: '红队/蓝队' },
          { id: 'task-red-1', type: 'task', x: startX - 120, y: startY + gapY, label: tasks[0]?.title || '红队任务', description: tasks[0]?.description || '', status: tasks[0]?.status as any || 'pending', progress: 0, assignmentRule: tasks[0]?.assignedAgentId ? 'fixed' : 'fixed', assignedAgentId: tasks[0]?.assignedAgentId || null, assignedGroupId: 'red-team', priority: tasks[0]?.priority as any || 'high', dependencies: ['decision-1'] },
          { id: 'task-blue-1', type: 'task', x: startX + 120, y: startY + gapY, label: tasks[1]?.title || '蓝队任务', description: tasks[1]?.description || '', status: tasks[1]?.status as any || 'pending', progress: 0, assignmentRule: tasks[1]?.assignedAgentId ? 'fixed' : 'fixed', assignedAgentId: tasks[1]?.assignedAgentId || null, assignedGroupId: 'blue-team', priority: tasks[1]?.priority as any || 'high', dependencies: ['decision-1'] },
          { id: 'merge-1', type: 'merge', x: startX, y: startY + gapY * 2, label: '合并' },
          { id: 'task-review', type: 'task', x: startX, y: startY + gapY * 3, label: tasks[2]?.title || '评审对比', description: tasks[2]?.description || '', status: tasks[2]?.status as any || 'pending', progress: 0, assignmentRule: 'role-match', assignedAgentId: null, assignedGroupId: 'reviewers', priority: 'high', dependencies: ['merge-1'] }
        );
        edges.push(
          { id: 'e1', sourceId: 'decision-1', targetId: 'task-red-1', type: 'conditional', label: '红队' },
          { id: 'e2', sourceId: 'decision-1', targetId: 'task-blue-1', type: 'conditional', label: '蓝队' },
          { id: 'e3', sourceId: 'task-red-1', targetId: 'merge-1', type: 'serial' },
          { id: 'e4', sourceId: 'task-blue-1', targetId: 'merge-1', type: 'serial' },
          { id: 'e5', sourceId: 'merge-1', targetId: 'task-review', type: 'serial' }
        );
        break;

      case 'coop': // 协作模式 - 线性依赖
        tasks.forEach((task, index) => {
          const hasAgent = task.assignedAgentId && task.assignedAgentId !== 'unassigned';
          nodes.push({
            id: task.id,
            type: 'task',
            x: startX,
            y: startY + index * gapY,
            label: task.title,
            description: task.description,
            status: task.status as any,
            progress: 0,
            assignmentRule: hasAgent ? 'fixed' : 'role-match',
            assignedAgentId: hasAgent ? task.assignedAgentId : null,
            assignedGroupId: null,
            priority: task.priority as any,
            dependencies: task.dependencies,
          });
          if (index > 0) {
            edges.push({
              id: `edge-${tasks[index - 1].id}-${task.id}`,
              sourceId: tasks[index - 1].id,
              targetId: task.id,
              type: 'serial',
            });
          }
        });
        break;

      case 'pipeline': // 流水线模式 - 纯串行
        tasks.forEach((task, index) => {
          const hasAgent = task.assignedAgentId && task.assignedAgentId !== 'unassigned';
          nodes.push({
            id: task.id,
            type: 'task',
            x: startX,
            y: startY + index * gapY,
            label: task.title,
            description: task.description,
            status: task.status as any,
            progress: 0,
            assignmentRule: hasAgent ? 'fixed' : 'fixed',
            assignedAgentId: hasAgent ? task.assignedAgentId : null,
            assignedGroupId: null,
            priority: task.priority as any,
            dependencies: task.dependencies,
          });
          if (index > 0) {
            edges.push({
              id: `edge-${tasks[index - 1].id}-${task.id}`,
              sourceId: tasks[index - 1].id,
              targetId: task.id,
              type: 'serial',
            });
          }
        });
        break;

      case 'storm': // 脑暴模式 - 单主任务+并行分支
        if (tasks.length > 0) {
          const mainTask = tasks[0];
          const hasMainAgent = mainTask.assignedAgentId && mainTask.assignedAgentId !== 'unassigned';
          nodes.push({
            id: mainTask.id,
            type: 'task',
            x: startX,
            y: startY,
            label: mainTask.title,
            description: mainTask.description,
            status: mainTask.status as any,
            progress: 0,
            assignmentRule: 'broadcast',
            assignedAgentId: hasMainAgent ? mainTask.assignedAgentId : null,
            assignedGroupId: null,
            priority: mainTask.priority as any,
            dependencies: [],
          });
          for (let i = 1; i < tasks.length; i++) {
            const subTask = tasks[i];
            nodes.push({
              id: subTask.id,
              type: 'task',
              x: startX + (i % 2 === 0 ? -120 : 120),
              y: startY + Math.ceil(i / 2) * gapY,
              label: subTask.title,
              description: subTask.description,
              status: subTask.status as any,
              progress: 0,
              assignmentRule: 'broadcast',
              assignedAgentId: null,
              assignedGroupId: null,
              priority: subTask.priority as any,
              dependencies: [mainTask.id],
            });
            edges.push({
              id: `edge-${mainTask.id}-${subTask.id}`,
              sourceId: mainTask.id,
              targetId: subTask.id,
              type: 'parallel',
            });
          }
        }
        break;

      case 'contest': // 竞赛模式 - 多组并行任务链
        const groupCount = Math.ceil(tasks.length / 3);
        for (let g = 0; g < groupCount; g++) {
          const groupTasks = tasks.slice(g * 3, (g + 1) * 3);
          groupTasks.forEach((task, index) => {
            const hasAgent = task.assignedAgentId && task.assignedAgentId !== 'unassigned';
            nodes.push({
              id: task.id,
              type: 'task',
              x: startX + g * 200 - 100,
              y: startY + index * gapY,
              label: task.title,
              description: task.description,
              status: task.status as any,
              progress: 0,
              assignmentRule: hasAgent ? 'fixed' : 'fixed',
              assignedAgentId: hasAgent ? task.assignedAgentId : null,
              assignedGroupId: null,
              priority: task.priority as any,
              dependencies: task.dependencies,
            });
            if (index > 0) {
              edges.push({
                id: `edge-${groupTasks[index - 1].id}-${task.id}`,
                sourceId: groupTasks[index - 1].id,
                targetId: task.id,
                type: 'serial',
              });
            }
          });
        }
        break;

      default: // 默认使用任务列表
        tasks.forEach((task, index) => {
          const hasAgent = task.assignedAgentId && task.assignedAgentId !== 'unassigned';
          nodes.push({
            id: task.id,
            type: 'task',
            x: startX,
            y: startY + index * gapY,
            label: task.title,
            description: task.description,
            status: task.status as any,
            progress: 0,
            assignmentRule: hasAgent ? 'fixed' : 'none',
            assignedAgentId: hasAgent ? task.assignedAgentId : null,
            assignedGroupId: null,
            priority: task.priority as any,
            dependencies: task.dependencies,
          });
        });
        break;
    }

    return { nodes, edges };
  }

  // 获取节点尺寸
  getNodeWidth(node: CanvasNode): number {
    return node.type === 'task' ? 140 : node.type === 'decision' || node.type === 'merge' ? 80 : 80;
  }

  getNodeHeight(node: CanvasNode): number {
    return node.type === 'task' ? 90 : node.type === 'decision' || node.type === 'merge' ? 80 : 40;
  }

  // 获取节点中心坐标
  getNodeCenterX(nodeId: string): number {
    const node = this.nodes().find(n => n.id === nodeId);
    if (!node) return 0;
    return node.x + this.getNodeWidth(node) / 2;
  }

  getNodeCenterY(nodeId: string): number {
    const node = this.nodes().find(n => n.id === nodeId);
    if (!node) return 0;
    return node.y + this.getNodeHeight(node) / 2;
  }

  // 获取连线路径
  getEdgePath(edge: CanvasEdge): string {
    const sourceX = this.getNodeCenterX(edge.sourceId);
    const sourceY = this.getNodeCenterY(edge.sourceId);
    const targetX = this.getNodeCenterX(edge.targetId);
    const targetY = this.getNodeCenterY(edge.targetId);

    // 使用贝塞尔曲线
    const midY = (sourceY + targetY) / 2;
    return `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
  }

  getEdgeCenterX(edge: CanvasEdge): number {
    return (this.getNodeCenterX(edge.sourceId) + this.getNodeCenterX(edge.targetId)) / 2;
  }

  getEdgeCenterY(edge: CanvasEdge): number {
    return (this.getNodeCenterY(edge.sourceId) + this.getNodeCenterY(edge.targetId)) / 2;
  }

  // 获取分配标签样式
  getAssignmentTagClass(node: TaskNode): string {
    return node.assignmentRule;
  }

  getAssignmentTagText(node: TaskNode): string {
    switch (node.assignmentRule) {
      case 'fixed':
        if (node.assignedAgentId) {
          const agent = this.getAgentById(node.assignedAgentId);
          return `固定: ${agent?.name || node.assignedAgentId}`;
        }
        if (node.assignedGroupId) {
          const group = this.agentGroups().find(g => g.id === node.assignedGroupId);
          return `固定: ${group?.name || node.assignedGroupId}`;
        }
        return '固定: 未配置';
      case 'round-robin':
        if (node.assignedGroupId) {
          const group = this.agentGroups().find(g => g.id === node.assignedGroupId);
          return `轮询: ${group?.name || node.assignedGroupId}`;
        }
        return '轮询: 未配置';
      case 'load-balance':
        if (node.assignedGroupId) {
          const group = this.agentGroups().find(g => g.id === node.assignedGroupId);
          return `均衡: ${group?.name || node.assignedGroupId}`;
        }
        return '均衡: 未配置';
      case 'broadcast':
        return '广播: 所有Agent';
      case 'role-match':
        if (node.assignedGroupId) {
          const group = this.agentGroups().find(g => g.id === node.assignedGroupId);
          return `角色: ${group?.name || node.assignedGroupId}`;
        }
        return '角色: 自动匹配';
      default:
        return '未分配';
    }
  }

  getStatusText(status: string): string {
    const map: Record<string, string> = {
      'pending': '待执行',
      'running': '执行中',
      'completed': '已完成',
      'failed': '失败',
    };
    return map[status] || status;
  }

  // 添加节点
  addTaskNode(): void {
    const id = `task-${Date.now()}`;
    const nodes = this.state().nodes;
    const lastTask = nodes.filter(n => n.type === 'task').pop();
    const newY = lastTask ? lastTask.y + 120 : 100;

    const newNode: TaskNode = {
      id,
      type: 'task',
      x: 150,
      y: newY,
      label: `新任务 ${nodes.filter(n => n.type === 'task').length + 1}`,
      description: '',
      status: 'pending',
      progress: 0,
      assignmentRule: 'none',
      assignedAgentId: null,
      assignedGroupId: null,
      priority: 'medium',
      dependencies: [],
    };

    this.state.update(prev => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));
  }

  addDecisionNode(): void {
    const id = `decision-${Date.now()}`;
    const nodes = this.state().nodes;
    const lastNode = nodes[nodes.length - 1];
    const newY = lastNode ? lastNode.y + 120 : 100;

    this.state.update(prev => ({
      ...prev,
      nodes: [...prev.nodes, {
        id,
        type: 'decision',
        x: 150,
        y: newY,
        label: '条件分支',
        condition: '',
      }],
    }));
  }

  addMergeNode(): void {
    const id = `merge-${Date.now()}`;
    const nodes = this.state().nodes;
    const lastNode = nodes[nodes.length - 1];
    const newY = lastNode ? lastNode.y + 120 : 100;

    this.state.update(prev => ({
      ...prev,
      nodes: [...prev.nodes, {
        id,
        type: 'merge',
        x: 150,
        y: newY,
        label: '合并',
      }],
    }));
  }

  // 选择节点
  selectNode(nodeId: string): void {
    this.state.update(prev => ({ ...prev, selectedNodeId: nodeId }));
  }

  // 删除选中节点
  deleteSelectedNode(): void {
    const id = this.selectedNodeId();
    if (!id) return;

    this.state.update(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== id),
      edges: prev.edges.filter(e => e.sourceId !== id && e.targetId !== id),
      selectedNodeId: null,
    }));

    this.contextMenuData.set(null);
  }

  // 更新分配规则
  updateAssignmentRule(taskId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as AssignmentRule;
    this.state.update(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => 
        n.id === taskId && n.type === 'task' ? { ...n, assignmentRule: value } : n
      ),
    }));
  }

  updateAssignmentTarget(taskId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value.startsWith('group:')) {
      this.state.update(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => 
          n.id === taskId && n.type === 'task' ? { ...n, assignedGroupId: value.replace('group:', ''), assignedAgentId: null } : n
        ),
      }));
    } else if (value.startsWith('agent:')) {
      this.state.update(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => 
          n.id === taskId && n.type === 'task' ? { ...n, assignedAgentId: value.replace('agent:', ''), assignedGroupId: null } : n
        ),
      }));
    }
  }

  applyAssignment(taskId: string): void {
    console.log('Applied assignment for task:', taskId);
    this.contextMenuData.set(null);
  }

  setAssignmentRule(rule: AssignmentRule): void {
    const id = this.contextMenuData()?.nodeId;
    if (!id) return;

    this.state.update(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => 
        n.id === id && n.type === 'task' ? { ...n, assignmentRule: rule } : n
      ),
    }));

    this.contextMenuData.set(null);
  }

  jumpToResourcePanel(): void {
    this.contextMenuData.set(null);
    // 可以添加滚动到资源面板的逻辑
  }

  // 鼠标事件

  onNodeMouseDown(event: MouseEvent, node: CanvasNode): void {
    event.stopPropagation();
    this.dragStartPos = { x: event.clientX, y: event.clientY };
    this.dragNodeStartPos = { x: node.x, y: node.y };
    this.isDraggingNode.set(true);
    this.selectNode(node.id);
  }

  startConnection(event: MouseEvent, nodeId: string): void {
    event.stopPropagation();
    event.preventDefault();
    this.isConnecting.set(true);
    this.connectingFrom.set(nodeId);
  }

  onMouseDown(event: MouseEvent): void {
    if (!this.isConnecting()) {
      this.state.update(prev => ({ ...prev, isDragging: true }));
    }
    this.updateMousePos(event);
  }

  onMouseMove(event: MouseEvent): void {
    this.updateMousePos(event);

    if (this.isDraggingNode() && this.selectedNodeId()) {
      const dx = event.clientX - this.dragStartPos.x;
      const dy = event.clientY - this.dragStartPos.y;
      const zoom = this.state().zoom;

      this.state.update(prev => ({
        ...prev,
        nodes: prev.nodes.map(n =>
          n.id === prev.selectedNodeId
            ? {
                ...n,
                x: this.dragNodeStartPos.x + dx / zoom,
                y: this.dragNodeStartPos.y + dy / zoom,
              }
            : n
        ),
      }));
    }
  }

  onMouseUp(event: MouseEvent): void {
    if (this.isConnecting() && this.connectingFrom()) {
      const targetNode = this.findNodeAt(event.clientX, event.clientY);
      if (targetNode && targetNode.id !== this.connectingFrom()) {
        this.addEdge(this.connectingFrom()!, targetNode.id);
      }
    }

    this.isDraggingNode.set(false);
    this.isConnecting.set(false);
    this.connectingFrom.set(null);
    this.state.update(prev => ({ ...prev, isDragging: false }));
  }

  private updateMousePos(event: MouseEvent): void {
    if (this.canvasRef) {
      const rect = this.canvasRef.nativeElement.getBoundingClientRect();
      const zoom = this.state().zoom;
      const pan = this.state().pan;
      this.mousePos.set({
        x: (event.clientX - rect.left - pan.x) / zoom,
        y: (event.clientY - rect.top - pan.y) / zoom,
      });
    }
  }

  private findNodeAt(clientX: number, clientY: number): CanvasNode | null {
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!rect) return null;

    const zoom = this.state().zoom;
    const pan = this.state().pan;
    const x = (clientX - rect.left - pan.x) / zoom;
    const y = (clientY - rect.top - pan.y) / zoom;

    return this.nodes().find(node => {
      const w = this.getNodeWidth(node);
      const h = this.getNodeHeight(node);
      return x >= node.x && x <= node.x + w && y >= node.y && y <= node.y + h;
    }) || null;
  }

  // 添加连线
  addEdge(sourceId: string, targetId: string): void {
    const existing = this.edges().find(e =>
      (e.sourceId === sourceId && e.targetId === targetId) ||
      (e.sourceId === targetId && e.targetId === sourceId)
    );

    if (!existing) {
      this.state.update(prev => ({
        ...prev,
        edges: [...prev.edges, {
          id: `edge-${Date.now()}`,
          sourceId,
          targetId,
          type: 'serial' as EdgeType,
        }],
      }));
    }
  }

  // 缩放
  zoomIn(): void {
    this.state.update(prev => ({
      ...prev,
      zoom: Math.min(prev.zoom * 1.2, 3),
    }));
  }

  zoomOut(): void {
    this.state.update(prev => ({
      ...prev,
      zoom: Math.max(prev.zoom / 1.2, 0.3),
    }));
  }

  // 适应视图 - 改进版：自动居中工作流
  fitView(): void {
    const nodes = this.nodes();
    if (nodes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + this.getNodeWidth(node));
      maxY = Math.max(maxY, node.y + this.getNodeHeight(node));
    });

    const wrapper = this.canvasWrapperRef?.nativeElement;
    if (!wrapper) return;

    const wrapperWidth = wrapper.clientWidth;
    const wrapperHeight = wrapper.clientHeight;
    const contentWidth = maxX - minX + 100;
    const contentHeight = maxY - minY + 100;

    const scaleX = wrapperWidth / contentWidth;
    const scaleY = wrapperHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1);

    // 计算居中偏移
    const panX = (wrapperWidth - contentWidth * scale) / 2 - minX * scale;
    const panY = (wrapperHeight - contentHeight * scale) / 2 - minY * scale;

    this.state.update(prev => ({
      ...prev,
      zoom: scale,
      pan: { x: panX, y: panY },
    }));
  }

  // 一键对齐 - 水平对齐
  alignHorizontal(): void {
    const selectedId = this.selectedNodeId();
    if (!selectedId) return;

    const selectedNode = this.nodes().find(n => n.id === selectedId);
    if (!selectedNode) return;

    this.state.update(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id === selectedId) return n;
        // 找到与选中节点有连线的节点
        const isConnected = prev.edges.some(e => 
          (e.sourceId === selectedId && e.targetId === n.id) ||
          (e.targetId === selectedId && e.sourceId === n.id)
        );
        if (isConnected) {
          return { ...n, y: selectedNode.y };
        }
        return n;
      }),
    }));
  }

  // 一键对齐 - 垂直对齐
  alignVertical(): void {
    const selectedId = this.selectedNodeId();
    if (!selectedId) return;

    const selectedNode = this.nodes().find(n => n.id === selectedId);
    if (!selectedNode) return;

    this.state.update(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id === selectedId) return n;
        const isConnected = prev.edges.some(e => 
          (e.sourceId === selectedId && e.targetId === n.id) ||
          (e.targetId === selectedId && e.sourceId === n.id)
        );
        if (isConnected) {
          return { ...n, x: selectedNode.x };
        }
        return n;
      }),
    }));
  }

  // 一键对齐 - 均匀分布
  distributeEvenly(): void {
    const taskNodes = this.nodes().filter(n => n.type === 'task') as TaskNode[];
    if (taskNodes.length < 3) return;

    // 按Y坐标排序
    const sorted = [...taskNodes].sort((a, b) => a.y - b.y);
    const minY = sorted[0].y;
    const maxY = sorted[sorted.length - 1].y;
    const gap = (maxY - minY) / (sorted.length - 1);

    this.state.update(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        const idx = sorted.findIndex(s => s.id === n.id);
        if (idx >= 0) {
          return { ...n, y: minY + idx * gap };
        }
        return n;
      }),
    }));
  }

  // 自动对齐分支/合并节点到中轴线
  alignBranchNodes(): void {
    const decisionNodes = this.nodes().filter(n => n.type === 'decision');
    const mergeNodes = this.nodes().filter(n => n.type === 'merge');

    this.state.update(prev => {
      let newNodes = [...prev.nodes];

      // 对齐分支节点
      decisionNodes.forEach(decision => {
        const centerX = decision.x;
        newNodes = newNodes.map(n => {
          if (prev.edges.some(e => e.sourceId === decision.id && e.targetId === n.id)) {
            // 分支任务节点，保持X偏移但Y对齐
            return n;
          }
          return n;
        });
      });

      // 对齐合并节点到中轴
      mergeNodes.forEach(merge => {
        const incomingEdges = prev.edges.filter(e => e.targetId === merge.id);
        if (incomingEdges.length >= 2) {
          const sourceNodes = incomingEdges.map(e => prev.nodes.find(n => n.id === e.sourceId)).filter(Boolean);
          if (sourceNodes.length >= 2) {
            const avgX = sourceNodes.reduce((sum, n) => sum + n!.x, 0) / sourceNodes.length;
            newNodes = newNodes.map(n => n.id === merge.id ? { ...n, x: avgX } : n);
          }
        }
      });

      return { ...prev, nodes: newNodes };
    });
  }

  // 切换预览模式
  togglePreviewMode(): void {
    this.showPreviewMode.update(v => !v);
  }

  // 节点双击 - 打开任务配置弹窗
  onNodeDoubleClick(event: MouseEvent, node: CanvasNode): void {
    event.preventDefault();
    event.stopPropagation();
    if (node.type === 'task') {
      this.openTaskConfigDialogForNode(node.id);
    }
  }

  // 节点右键 - 打开上下文菜单
  onNodeRightClick(event: MouseEvent, node: CanvasNode): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectNode(node.id);
    this.contextMenuData.set({
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id,
    });
  }

  // 点击画布空白处关闭右键菜单并取消节点选中
  onCanvasClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('canvas')) {
      this.state.update(prev => ({ ...prev, selectedNodeId: null }));
    }
    this.contextMenuData.set(null);
  }

  // 打开任务配置弹窗
  openTaskConfigDialogForNode(nodeId: string): void {
    const taskNode = this.nodes().find(n => n.id === nodeId) as TaskNode | undefined;
    if (taskNode) {
      this.editingTaskData.set(taskNode);
      this.editingTaskTimeoutValue.set(300);
      this.editingTaskRetriesValue.set(3);
      this.showTaskConfigDialogState.set(true);
    }
  }

  // 关闭任务配置弹窗
  closeTaskConfigDialog(): void {
    this.showTaskConfigDialogState.set(false);
    this.editingTaskData.set(null);
  }

  // 更新编辑中的任务字段
  updateEditingTask(field: 'label' | 'description', event: Event): void {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    const current = this.editingTaskData();
    if (current) {
      this.editingTaskData.set({ ...current, [field]: input.value });
    }
  }

  // 更新超时时间
  updateEditingTaskTimeout(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editingTaskTimeoutValue.set(parseInt(input.value) || 300);
  }

  // 更新重试次数
  updateEditingTaskRetries(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editingTaskRetriesValue.set(parseInt(input.value) || 3);
  }

  // 更新优先级
  updateEditingTaskPriority(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const current = this.editingTaskData();
    if (current) {
      this.editingTaskData.set({ ...current, priority: select.value as any });
    }
  }

  // 保存任务配置
  saveTaskConfig(): void {
    const editingTask = this.editingTaskData();
    if (!editingTask) return;

    this.state.update(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => 
        n.id === editingTask.id 
          ? { 
              ...n, 
              label: editingTask.label, 
              description: editingTask.description,
              priority: editingTask.priority,
            } 
          : n
      ),
    }));

    this.closeTaskConfigDialog();
  }

  // 右键菜单操作 - 编辑提示词
  editPrompt(): void {
    const selectedId = this.selectedNodeId();
    if (selectedId) {
      this.openTaskConfigDialogForNode(selectedId);
    }
    this.contextMenuData.set(null);
  }

  // 右键菜单操作 - 复制节点
  duplicateNode(): void {
    const selectedId = this.selectedNodeId();
    if (!selectedId) return;

    const selectedNode = this.nodes().find(n => n.id === selectedId);
    if (!selectedNode) return;

    const newNodeId = `${selectedNode.id}-copy-${Date.now()}`;
    const newNode = {
      ...selectedNode,
      id: newNodeId,
      x: selectedNode.x + 50,
      y: selectedNode.y + 50,
      label: `${selectedNode.label} (副本)`,
    };

    this.state.update(prev => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));

    this.contextMenuData.set(null);
  }

  // 右键菜单操作 - 重命名节点
  renameNode(): void {
    const selectedId = this.selectedNodeId();
    if (selectedId) {
      this.openTaskConfigDialogForNode(selectedId);
    }
    this.contextMenuData.set(null);
  }

  // 右键菜单操作 - 设置分支规则
  setBranchRule(): void {
    const selectedId = this.selectedNodeId();
    if (!selectedId) return;

    const selectedNode = this.nodes().find(n => n.id === selectedId);
    if (!selectedNode) return;

    const newCondition = prompt('输入分支条件（例如：条件A/条件B）:', selectedNode.condition || '');
    if (newCondition !== null) {
      this.state.update(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => 
          n.id === selectedId ? { ...n, condition: newCondition } : n
        ),
      }));
    }

    this.contextMenuData.set(null);
  }

  // 分组展开/折叠
  toggleGroup(groupId: string): void {
    this.expandedGroupsList.update(groups => {
      if (groups.includes(groupId)) {
        return groups.filter(g => g !== groupId);
      }
      return [...groups, groupId];
    });
  }

  // 导出
  exportCanvas(): void {
    const data = this.state();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orchestration.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // 重置
  resetCanvas(): void {
    this.state.update(prev => ({
      ...prev,
      selectedNodeId: null,
      zoom: 1,
      pan: { x: 0, y: 0 },
    }));
    this.syncFromData();
  }

  // 开始执行
  startExecution(): void {
    const taskNodes = this.nodes().filter(n => n.type === 'task') as TaskNode[];
    taskNodes.forEach(task => {
      if (task.status === 'pending') {
        this.taskStarted.emit(task.id);
      }
    });
  }

  // Agent拖拽相关方法
  onAgentDragStart(event: DragEvent, agentId: string): void {
    this.draggingAgentId.set(agentId);
    event.dataTransfer!.effectAllowed = 'copy';
    event.dataTransfer!.setData('text/plain', agentId);
  }

  onAgentDragEnd(event: DragEvent): void {
    this.draggingAgentId.set(null);
    this.isDragOverNode.set(null);
  }

  onNodeDragOver(event: DragEvent, node: CanvasNode): void {
    event.preventDefault();
    event.stopPropagation();
    if (node.type === 'task') {
      this.isDragOverNode.set(node.id);
    }
  }

  onNodeDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOverNode.set(null);
  }

  onNodeDrop(event: DragEvent, node: CanvasNode): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOverNode.set(null);

    if (node.type !== 'task') return;

    const agentId = event.dataTransfer!.getData('text/plain');
    if (!agentId) return;

    const agent = this.getAgentById(agentId);
    if (!agent) return;

    const taskNode = node as TaskNode;
    this.state.update(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id === node.id && n.type === 'task') {
          return {
            ...n,
            assignmentRule: 'fixed' as AssignmentRule,
            assignedAgentId: agentId,
            assignedGroupId: null,
          };
        }
        return n;
      }),
    }));

    console.log(`Agent "${agent.name}" 已分配到任务 "${taskNode.label}"`);
  }
}