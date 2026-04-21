import { Component, Input, Output, EventEmitter } from '@angular/core';
import { NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { Attachment, InputSubmittedPayload } from '../../types/workbench.types';
import { v4 as uuidv4 } from 'uuid';

@Component({
  selector: 'app-input-bar',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule, NzInputModule, NzButtonModule, NzIconModule, NzTooltipModule],
  template: `
    <div class="input-bar">
      <div class="attachments-preview" *ngIf="attachments.length > 0">
        <div 
          *ngFor="let attachment of attachments"
          class="attachment-chip"
        >
          <span nz-icon [nzType]="getAttachmentIcon(attachment.type)" class="attachment-icon"></span>
          <span class="attachment-name">{{ attachment.name }}</span>
          <button 
            nz-button 
            nzType="text" 
            nzSize="small" 
            class="remove-btn"
            (click)="removeAttachment(attachment.id)"
            nz-tooltip
            nzTooltipTitle="移除"
          >
            <span nz-icon nzType="close"></span>
          </button>
        </div>
      </div>
      
      <div class="input-row">
        <div class="input-toolbar">
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            (click)="triggerFilePicker()"
            nz-tooltip
            nzTooltipTitle="添加文件"
          >
            <span nz-icon nzType="file"></span>
          </button>
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            (click)="triggerImagePicker()"
            nz-tooltip
            nzTooltipTitle="添加图片"
          >
            <span nz-icon nzType="image"></span>
          </button>
        </div>
        
        <textarea 
          class="main-input"
          [(ngModel)]="draftText"
          placeholder="输入你的指令... (Shift+Enter 换行，Enter 发送)"
          (keydown)="handleKeydown($event)"
          (focus)="onFocus()"
          (blur)="onBlur()"
          [rows]="isExpanded ? 5 : 1"
          (ngModelChange)="onDraftChange($event)"
        ></textarea>
        
        <button 
          class="send-button"
          nz-button
          nzType="primary"
          [disabled]="!canSend"
          (click)="send()"
        >
          <span nz-icon nzType="send"></span>
        </button>
      </div>
      
      <input 
        type="file" 
        #fileInput 
        class="hidden-input"
        (change)="onFileSelected($event)"
        multiple
      >
      
      <input 
        type="file" 
        #imageInput 
        class="hidden-input"
        (change)="onImageSelected($event)"
        accept="image/*"
        multiple
      >
    </div>
  `,
  styles: [`
    .input-bar {
      background: #141414;
      border-top: 1px solid #2a2a2a;
      padding: 12px;
    }
    
    .attachments-preview {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: #1e1e1e;
      border-radius: 4px;
      font-size: 12px;
      color: #d9d9d9;
    }
    
    .attachment-icon {
      color: #1890ff;
    }
    
    .remove-btn {
      padding: 0;
      height: auto;
      margin-left: 2px;
    }
    
    .input-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    
    .input-toolbar {
      display: flex;
      gap: 4px;
      padding: 4px 0;
    }
    
    .main-input {
      flex: 1;
      background: #1e1e1e;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      padding: 10px 12px;
      color: #d9d9d9;
      font-size: 14px;
      resize: none;
      outline: none;
      transition: border-color 0.2s;
    }
    
    .main-input:focus {
      border-color: #1890ff;
    }
    
    .send-button {
      min-width: 44px;
      height: 44px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .hidden-input {
      display: none;
    }
  `]
})
export class InputBarComponent {
  @Input() draftText: string = '';
  @Input() attachments: Attachment[] = [];
  @Output() submitted = new EventEmitter<InputSubmittedPayload>();
  @Output() draftChanged = new EventEmitter<string>();
  @Output() attachmentsChanged = new EventEmitter<Attachment[]>();

  isExpanded: boolean = false;
  isFocused: boolean = false;

  get canSend(): boolean {
    return this.draftText.trim().length > 0 || this.attachments.length > 0;
  }

  onDraftChange(text: string) {
    this.draftChanged.emit(text);
  }

  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  send() {
    if (!this.canSend) return;

    this.submitted.emit({
      sessionId: '',
      text: this.draftText,
      attachments: this.attachments,
      timestamp: Date.now(),
      source: 'user'
    });
  }

  onFocus() {
    this.isFocused = true;
  }

  onBlur() {
    this.isFocused = false;
  }

  triggerFilePicker() {
    const input = document.querySelector('input[type="file"]:not([accept])') as HTMLInputElement;
    input?.click();
  }

  triggerImagePicker() {
    const input = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    input?.click();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const attachment: Attachment = {
          id: uuidv4(),
          type: 'file',
          name: file.name,
          size: file.size,
          mimeType: file.type
        };
        this.addAttachment(attachment);
      }
    }
    input.value = '';
  }

  onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const attachment: Attachment = {
          id: uuidv4(),
          type: 'image',
          name: file.name,
          size: file.size,
          mimeType: file.type
        };
        this.addAttachment(attachment);
      }
    }
    input.value = '';
  }

  addAttachment(attachment: Attachment) {
    this.attachmentsChanged.emit([...this.attachments, attachment]);
  }

  removeAttachment(attachmentId: string) {
    this.attachmentsChanged.emit(this.attachments.filter(a => a.id !== attachmentId));
  }

  getAttachmentIcon(type: string): string {
    const iconMap: Record<string, string> = {
      file: 'file',
      image: 'image',
      code: 'code',
      link: 'link'
    };
    return iconMap[type] || 'file';
  }
}

