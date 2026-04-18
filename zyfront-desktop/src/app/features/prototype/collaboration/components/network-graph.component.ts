import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, ViewChild, ElementRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as vis from 'vis-network';
import { ModeManagerService } from '../services/mode-manager.service';

interface NetworkNode {
  id: string;
  label: string;
  group: string;
  shape: string;
  color: string;
  size: number;
}

interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  color: string;
  width: number;
  dashed: boolean;
}

@Component({
  selector: 'app-network-graph',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="network-graph-container">
      <div class="network-header">
        <span class="network-title">协作拓扑网络</span>
        <span class="network-subtitle">NETWORK TOPOLOGY</span>
      </div>
      <div #networkContainer class="network-content"></div>
      <div class="network-controls">
        <button class="control-btn" (click)="resetView()">重置视图</button>
        <button class="control-btn" (click)="togglePhysics()">
          {{ isPhysicsEnabled ? '禁用物理' : '启用物理' }}
        </button>
        <button class="control-btn" (click)="generateRandomGraph()">随机生成</button>
      </div>
    </div>
  `,
  styles: [
    `
      .network-graph-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #000000;
        border: 2px solid #333;
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.1);
      }
      
      .network-header {
        padding: 12px 16px;
        border-bottom: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
      }
      
      .network-title {
        font-family: 'Press Start 2P', cursive;
        color: #ff00ff;
        font-size: 12px;
        display: block;
        margin-bottom: 4px;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .network-subtitle {
        font-size: 8px;
        color: #888;
        letter-spacing: 2px;
      }
      
      .network-content {
        flex: 1;
        position: relative;
      }
      
      .network-controls {
        padding: 12px 16px;
        border-top: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
        display: flex;
        gap: 8px;
        justify-content: center;
      }
      
      .control-btn {
        padding: 8px 16px;
        border: 1px solid #333;
        background: rgba(255, 255, 255, 0.05);
        color: #ccc;
        font-family: 'VT323', monospace;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.3s;
      }
      
      .control-btn:hover {
        border-color: #ff00ff;
        box-shadow: 0 0 8px rgba(255, 0, 255, 0.4);
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NetworkGraphComponent implements OnInit, OnDestroy {
  @ViewChild('networkContainer') networkContainer!: ElementRef;
  @Input() nodes: NetworkNode[] = [];
  @Input() edges: NetworkEdge[] = [];
  
  private network!: vis.Network;
  private container!: HTMLElement;
  isPhysicsEnabled = true;

  constructor(private modeManager: ModeManagerService) {}

  ngOnInit() {
    this.container = this.networkContainer.nativeElement;
    this.initializeNetwork();
  }

  ngOnDestroy() {
    if (this.network) {
      this.network.destroy();
    }
  }

  private initializeNetwork() {
    // Default nodes and edges if none provided
    const defaultNodes = this.nodes.length > 0 ? this.nodes : this.getDefaultNodes();
    const defaultEdges = this.edges.length > 0 ? this.edges : this.getDefaultEdges();

    const data = {
      nodes: defaultNodes,
      edges: defaultEdges
    };

    const options: any = {
      nodes: {
        font: {
          color: '#ffffff',
          size: 12,
          face: 'VT323, monospace'
        },
        borderWidth: 2,
        shadow: {
          enabled: false // 禁用阴影以提高性能
        }
      },
      edges: {
        font: {
          color: '#cccccc',
          size: 10,
          face: 'VT323, monospace'
        },
        shadow: {
          enabled: false // 禁用阴影以提高性能
        }
      },
      physics: {
        enabled: this.isPhysicsEnabled,
        repulsion: {
          nodeDistance: 150
        },
        stabilization: {
          iterations: 50 // 减少迭代次数以提高性能
        }
      },
      interaction: {
        dragNodes: true,
        dragView: true,
        zoomView: true
      }
    };

    this.network = new vis.Network(this.container, data, options);
    this.setupEventListeners();
  }

  private getDefaultNodes(): NetworkNode[] {
    return [
      { id: 'agent-1', label: '架构师', group: 'alpha', shape: 'circle', color: '#ff4444', size: 20 },
      { id: 'agent-2', label: '分析师', group: 'alpha', shape: 'circle', color: '#4488ff', size: 20 },
      { id: 'agent-3', label: '开发者', group: 'alpha', shape: 'circle', color: '#44ff88', size: 20 },
      { id: 'agent-4', label: '测试员', group: 'beta', shape: 'circle', color: '#ffdd00', size: 20 },
      { id: 'agent-5', label: '运维', group: 'beta', shape: 'circle', color: '#888888', size: 20 },
      { id: 'agent-6', label: '产品', group: 'beta', shape: 'circle', color: '#ff66aa', size: 20 }
    ];
  }

  private getDefaultEdges(): NetworkEdge[] {
    return [
      { id: 'edge-1', from: 'agent-1', to: 'agent-2', label: '任务分解', color: '#ff4444', width: 2, dashed: false },
      { id: 'edge-2', from: 'agent-2', to: 'agent-3', label: '需求分析', color: '#4488ff', width: 2, dashed: false },
      { id: 'edge-3', from: 'agent-3', to: 'agent-4', label: '代码实现', color: '#44ff88', width: 2, dashed: false },
      { id: 'edge-4', from: 'agent-4', to: 'agent-5', label: '测试报告', color: '#ffdd00', width: 2, dashed: false },
      { id: 'edge-5', from: 'agent-5', to: 'agent-6', label: '部署反馈', color: '#888888', width: 2, dashed: false },
      { id: 'edge-6', from: 'agent-6', to: 'agent-1', label: '需求变更', color: '#ff66aa', width: 2, dashed: true }
    ];
  }

  private setupEventListeners() {
    this.network.on('click', (params) => {
      if (params.nodes.length > 0) {
        console.log('Node clicked:', params.nodes[0]);
      } else if (params.edges.length > 0) {
        console.log('Edge clicked:', params.edges[0]);
      }
    });

    this.network.on('doubleClick', (params) => {
      if (params.nodes.length > 0) {
        console.log('Node double clicked:', params.nodes[0]);
      }
    });
  }

  resetView() {
    this.network.fit();
  }

  togglePhysics() {
    this.isPhysicsEnabled = !this.isPhysicsEnabled;
    this.network.setOptions({
      physics: {
        enabled: this.isPhysicsEnabled
      }
    });
  }

  generateRandomGraph() {
    const nodes: any[] = [];
    const edges: any[] = [];
    const colors = ['#ff4444', '#4488ff', '#44ff88', '#ffdd00', '#888888', '#ff66aa'];
    
    // Generate 8-12 nodes
    const nodeCount = Math.floor(Math.random() * 5) + 8;
    for (let i = 1; i <= nodeCount; i++) {
      nodes.push({
        id: `node-${i}`,
        label: `Agent ${i}`,
        group: i % 2 === 0 ? 'alpha' : 'beta',
        shape: 'circle',
        color: colors[i % colors.length],
        size: Math.floor(Math.random() * 10) + 20
      });
    }
    
    // Generate random edges
    const edgeCount = Math.floor(Math.random() * nodeCount) + nodeCount;
    for (let i = 1; i <= edgeCount; i++) {
      const from = `node-${Math.floor(Math.random() * nodeCount) + 1}`;
      let to = `node-${Math.floor(Math.random() * nodeCount) + 1}`;
      while (to === from) {
        to = `node-${Math.floor(Math.random() * nodeCount) + 1}`;
      }
      
      edges.push({
        id: `edge-${i}`,
        from: from,
        to: to,
        label: `Edge ${i}`,
        color: colors[i % colors.length],
        width: Math.floor(Math.random() * 3) + 1,
        dashed: Math.random() > 0.7
      });
    }
    
    this.network.setData({ nodes, edges });
    this.network.fit();
  }
}
