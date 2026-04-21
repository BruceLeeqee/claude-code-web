import { Component, Input, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, NgClass } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { OutputItem } from '../../types/workbench.types';

@Component({
  selector: 'app-terminal-main',
  standalone: true,
  imports: [NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, NgClass, NzIconModule, NzButtonModule],
  template: `
    <div class="terminal-main" #scrollContainer>
      <div class="output-list">
        <div 
          *ngFor="let item of outputItems"
          class="output-item"
          [ngClass]="item.type"
        >
          <div class="output-timestamp">
            {{ formatTime(item.timestamp) }}
          </div>
          
          <ng-container [ngSwitch]="item.type">
            <div *ngSwitchCase="'terminal'" class="terminal-output">
              <pre>{{ item.content }}</pre>
            </div>
            
            <div *ngSwitchCase="'card'" class="card-output">
              <div class="card-content" [innerHTML]="sanitizeHtml(item.content)"></div>
            </div>
            
            <div *ngSwitchCase="'diff'" class="diff-output">
              <div class="diff-header">{{ item.content?.title || 'Diff' }}</div>
              <pre class="diff-content">{{ item.content?.diff }}</pre>
            </div>
            
            <div *ngSwitchCase="'image'" class="image-output">
              <img [src]="item.content?.url" [alt]="item.content?.name" />
            </div>
            
            <div *ngSwitchCase="'file'" class="file-output">
              <div class="file-card">
                <span nz-icon nzType="file" class="file-icon"></span>
                <span class="file-name">{{ item.content?.name }}</span>
                <button nz-button nzSize="small">打开</button>
              </div>
            </div>
            
            <div *ngSwitchCase="'error'" class="error-output">
              <span nz-icon nzType="warning" nzTheme="twotone" nzTwotoneColor="#ff4d4f" class="error-icon"></span>
              <span class="error-message">{{ item.content?.message || item.content }}</span>
            </div>
            
            <div *ngSwitchDefault class="default-output">
              {{ item.content }}
            </div>
          </ng-container>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .terminal-main {
      height: 100%;
      overflow-y: auto;
      background: #0a0a0a;
      padding: 16px;
    }
    
    .output-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    .output-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .output-timestamp {
      font-size: 11px;
      color: #595959;
    }
    
    .terminal-output pre {
      margin: 0;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
      color: #d9d9d9;
      white-space: pre-wrap;
      word-break: break-word;
    }
    
    .card-output {
      background: #141414;
      border-radius: 8px;
      padding: 16px;
      border: 1px solid #2a2a2a;
    }
    
    .diff-output {
      background: #141414;
      border-radius: 8px;
      padding: 12px;
      border: 1px solid #2a2a2a;
    }
    
    .diff-header {
      font-size: 13px;
      font-weight: 500;
      color: #fff;
      margin-bottom: 8px;
    }
    
    .diff-content {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      color: #d9d9d9;
      margin: 0;
      white-space: pre-wrap;
    }
    
    .image-output img {
      max-width: 100%;
      border-radius: 8px;
    }
    
    .file-output .file-card {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #141414;
      border-radius: 8px;
      padding: 12px 16px;
      border: 1px solid #2a2a2a;
    }
    
    .file-icon {
      font-size: 24px;
      color: #1890ff;
    }
    
    .file-name {
      flex: 1;
      color: #d9d9d9;
      font-size: 14px;
    }
    
    .error-output {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: #ff4d4f10;
      border-radius: 8px;
      padding: 12px 16px;
      border: 1px solid #ff4d4f30;
    }
    
    .error-icon {
      font-size: 20px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    
    .error-message {
      color: #ff4d4f;
      font-size: 14px;
    }
    
    .default-output {
      color: #d9d9d9;
      font-size: 14px;
    }
  `]
})
export class TerminalMainComponent implements AfterViewChecked {
  @Input() outputItems: OutputItem[] = [];
  @Input() scrollToBottom: boolean = true;

  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLDivElement>;

  constructor(private sanitizer: DomSanitizer) {}

  ngAfterViewChecked() {
    if (this.scrollToBottom && this.scrollContainer) {
      this.scrollContainer.nativeElement.scrollTop = 
        this.scrollContainer.nativeElement.scrollHeight;
    }
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
  }

  sanitizeHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}

