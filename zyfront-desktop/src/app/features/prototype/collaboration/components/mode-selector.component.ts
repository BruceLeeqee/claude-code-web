import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModeManagerService, CollaborationMode } from '../services/mode-manager.service';

@Component({
  selector: 'app-mode-selector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mode-selector">
      <div class="mode-selector-header">
        <span class="mode-selector-title">协作模式</span>
        <span class="mode-selector-subtitle">COLLABORATION MODES</span>
      </div>
      <div class="mode-list">
        <button 
          *ngFor="let mode of modes"
          type="button" 
          class="mode-item" 
          [class.mode-active]="currentMode === mode.id"
          [style.border-color]="mode.color"
          [style.box-shadow]="currentMode === mode.id ? '0 0 12px ' + mode.color : 'none'"
          (click)="switchMode(mode.id)"
        >
          <span class="mode-icon">{{ mode.icon }}</span>
          <span class="mode-text">{{ mode.name }}</span>
        </button>
      </div>
      <div class="mode-description">
        <div class="description-title">{{ currentModeConfig.name }}</div>
        <div class="description-text">{{ currentModeConfig.description }}</div>
      </div>
      <div class="mode-controls">
        <button 
          class="control-btn start-btn"
          [class.btn-active]="isActive"
          (click)="toggleMode()"
        >
          {{ isActive ? '停止' : '开始' }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .mode-selector {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
        background: #000000;
        border: 2px solid #333;
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.1);
      }
      
      .mode-selector-header {
        text-align: center;
      }
      
      .mode-selector-title {
        font-family: 'Press Start 2P', cursive;
        color: #ff00ff;
        font-size: 12px;
        display: block;
        margin-bottom: 4px;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .mode-selector-subtitle {
        font-size: 8px;
        color: #888;
        letter-spacing: 2px;
      }
      
      .mode-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .mode-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border: 2px solid #333;
        background: rgba(255, 255, 255, 0.05);
        color: #ccc;
        font-family: 'VT323', monospace;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.3s;
        text-align: left;
      }
      
      .mode-item:hover {
        border-color: #ff00ff;
        box-shadow: 0 0 12px rgba(255, 0, 255, 0.4);
      }
      
      .mode-active {
        background: rgba(255, 0, 255, 0.1);
        color: #ff00ff;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .mode-icon {
        font-size: 16px;
        min-width: 20px;
      }
      
      .mode-text {
        flex: 1;
      }
      
      .mode-description {
        padding: 12px;
        border: 1px solid #333;
        background: rgba(255, 255, 255, 0.03);
      }
      
      .description-title {
        font-family: 'VT323', monospace;
        color: #ff00ff;
        font-size: 14px;
        margin-bottom: 4px;
        text-shadow: 0 0 4px rgba(255, 0, 255, 0.6);
      }
      
      .description-text {
        color: #aaa;
        font-size: 12px;
        line-height: 1.4;
      }
      
      .mode-controls {
        display: flex;
        justify-content: center;
      }
      
      .control-btn {
        padding: 12px 24px;
        border: 2px solid #ff00ff;
        background: rgba(255, 0, 255, 0.2);
        color: #ff00ff;
        font-family: 'VT323', monospace;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.3s;
        text-shadow: 0 0 8px rgba(255, 0, 255, 0.8);
      }
      
      .control-btn:hover {
        background: rgba(255, 0, 255, 0.3);
        box-shadow: 0 0 16px rgba(255, 0, 255, 0.6);
      }
      
      .btn-active {
        border-color: #00ff00;
        background: rgba(0, 255, 0, 0.2);
        color: #00ff00;
        text-shadow: 0 0 8px rgba(0, 255, 0, 0.8);
      }
      
      .btn-active:hover {
        box-shadow: 0 0 16px rgba(0, 255, 0, 0.6);
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ModeSelectorComponent implements OnInit {
  modes: any[] = [];
  currentMode: CollaborationMode = 'battle';
  currentModeConfig = {
    id: 'battle' as CollaborationMode,
    name: '对抗模式',
    description: '智能体之间的辩论和竞争',
    icon: '▣',
    color: '#ff4444'
  };
  isActive = false;

  constructor(private modeManager: ModeManagerService) {}

  ngOnInit() {
    this.modes = this.modeManager.getAllModes();
    this.updateCurrentMode();
  }

  switchMode(mode: CollaborationMode) {
    this.modeManager.switchMode(mode);
    this.updateCurrentMode();
  }

  toggleMode() {
    if (this.isActive) {
      this.modeManager.stopMode();
    } else {
      this.modeManager.startMode();
    }
    this.updateCurrentMode();
  }

  private updateCurrentMode() {
    const state = this.modeManager.currentMode();
    this.currentMode = state.currentMode;
    this.currentModeConfig = this.modeManager.getCurrentModeConfig();
    this.isActive = state.isActive;
  }
}
