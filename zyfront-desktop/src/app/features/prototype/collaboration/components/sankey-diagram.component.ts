import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, ViewChild, ElementRef, Input, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { ModeManagerService } from '../services/mode-manager.service';

interface SankeyNode {
  id: string;
  name: string;
  group: number;
  color: string;
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
  color: string;
}

@Component({
  selector: 'app-sankey-diagram',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sankey-container">
      <div class="sankey-header">
        <span class="sankey-title">实时数据流</span>
        <span class="sankey-subtitle">DATA FLOW (SANKEY)</span>
        <span class="sankey-badge">{{ status }}</span>
      </div>
      <div #sankeySvg class="sankey-content"></div>
      <div class="sankey-controls">
        <button class="control-btn" (click)="updateData()">更新数据</button>
        <button class="control-btn" (click)="resetView()">重置视图</button>
      </div>
    </div>
  `,
  styles: [
    `
      .sankey-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #000000;
        border: 2px solid #333;
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.1);
      }
      
      .sankey-header {
        padding: 12px 16px;
        border-bottom: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .sankey-title {
        font-family: 'Press Start 2P', cursive;
        color: #ff00ff;
        font-size: 12px;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .sankey-subtitle {
        font-size: 8px;
        color: #888;
        letter-spacing: 2px;
      }
      
      .sankey-badge {
        font-size: 10px;
        color: #ff00ff;
        background: rgba(255, 0, 255, 0.1);
        padding: 2px 8px;
        border: 1px solid #ff00ff;
        border-radius: 4px;
      }
      
      .sankey-content {
        flex: 1;
        position: relative;
      }
      
      .sankey-content svg {
        width: 100%;
        height: 100%;
      }
      
      .sankey-controls {
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
      
      /* Sankey link hover effect */
      .link:hover {
        opacity: 0.8 !important;
      }
      
      /* Node hover effect */
      .node rect:hover {
        stroke: #ff00ff !important;
        stroke-width: 2px !important;
      }
      
      /* Node text */
      .node text {
        font-family: 'VT323', monospace !important;
        font-size: 12px !important;
        fill: #ffffff !important;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SankeyDiagramComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('sankeySvg') sankeySvg!: ElementRef;
  @Input() nodes: SankeyNode[] = [];
  @Input() links: SankeyLink[] = [];
  
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private sankey!: any;
  private simulation!: any;
  status = '运行中';
  private width = 0;
  private height = 0;

  constructor(private modeManager: ModeManagerService) {}

  ngOnInit() {}

  ngAfterViewInit() {
    this.initializeSankey();
  }

  ngOnDestroy() {
    // Clean up any resources
  }

  private initializeSankey() {
    const container = this.sankeySvg.nativeElement;
    this.width = container.clientWidth;
    this.height = container.clientHeight;

    // Create SVG
    this.svg = d3.select(container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height);

    // Create Sankey generator
    this.sankey = sankey()
      .nodeWidth(20)
      .nodePadding(10)
      .extent([[1, 1], [this.width - 1, this.height - 6]]);

    // Default data if none provided
    const defaultNodes = this.nodes.length > 0 ? this.nodes : this.getDefaultNodes();
    const defaultLinks = this.links.length > 0 ? this.links : this.getDefaultLinks();

    this.updateSankey(defaultNodes, defaultLinks);
  }

  private getDefaultNodes(): SankeyNode[] {
    return [
      { id: 'input', name: '输入', group: 0, color: '#ff4444' },
      { id: 'agent-1', name: '架构师', group: 1, color: '#ff4444' },
      { id: 'agent-3', name: '开发者', group: 2, color: '#44ff88' },
      { id: 'agent-5', name: '运维', group: 3, color: '#888888' },
      { id: 'output', name: '输出', group: 4, color: '#ff00ff' }
    ];
  }

  private getDefaultLinks(): SankeyLink[] {
    return [
      { source: 'input', target: 'agent-1', value: 10, color: '#ff4444' },
      { source: 'agent-1', target: 'agent-3', value: 8, color: '#ff4444' },
      { source: 'agent-3', target: 'agent-5', value: 6, color: '#44ff88' },
      { source: 'agent-5', target: 'output', value: 6, color: '#888888' }
    ];
  }

  private updateSankey(nodes: SankeyNode[], links: SankeyLink[]) {
    // Clear previous content
    this.svg.selectAll('*').remove();

    // Prepare data
    const graph = {
      nodes: nodes.map(d => Object.assign({}, d)),
      links: links.map(d => Object.assign({}, d))
    };

    // Apply Sankey layout
    const { nodes: layoutNodes, links: layoutLinks } = this.sankey({ nodes: graph.nodes, links: graph.links });

    // Create links
    const link = this.svg.append('g')
      .selectAll('path')
      .data(layoutLinks)
      .join('path')
      .attr('class', 'link')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', d => d.color || '#ff00ff')
      .attr('stroke-width', d => Math.max(1, d.width))
      .attr('fill', 'none')
      .attr('stroke-opacity', 0.6)
      .on('mouseover', (event, d: any) => {
        d3.select(event.currentTarget)
          .attr('stroke-opacity', 0.8)
          .attr('stroke-width', (d: any) => Math.max(2, d.width));
      })
      .on('mouseout', (event, d: any) => {
        d3.select(event.currentTarget)
          .attr('stroke-opacity', 0.6)
          .attr('stroke-width', (d: any) => Math.max(1, d.width));
      });

    // Create nodes
    const node = this.svg.append('g')
      .selectAll('g')
      .data(layoutNodes)
      .join('g')
      .attr('class', 'node');

    node.append('rect')
      .attr('x', d => d.x0)
      .attr('y', d => d.y0)
      .attr('height', d => d.y1 - d.y0)
      .attr('width', d => d.x1 - d.x0)
      .attr('fill', d => d.color || '#ff00ff')
      .attr('stroke', '#333')
      .attr('stroke-width', 1);

    node.append('text')
      .attr('x', d => d.x0 < this.width / 2 ? d.x1 + 6 : d.x0 - 6)
      .attr('y', d => (d.y1 + d.y0) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', d => d.x0 < this.width / 2 ? 'start' : 'end')
      .text(d => d.name)
      .attr('font-size', '12px')
      .attr('fill', '#ffffff');

    // Add tooltip
    link.append('title')
      .text(d => `${d.source.name} → ${d.target.name}\n${d.value} 单位`);

    node.append('title')
      .text(d => `${d.name}\n${d.value} 单位`);
  }

  updateData() {
    // Generate random data
    const nodes = this.getDefaultNodes();
    const links = this.getDefaultLinks().map(link => ({
      ...link,
      value: Math.floor(Math.random() * 10) + 1
    }));

    this.updateSankey(nodes, links);
  }

  resetView() {
    // Reinitialize with default data
    const nodes = this.getDefaultNodes();
    const links = this.getDefaultLinks();
    this.updateSankey(nodes, links);
  }
}
