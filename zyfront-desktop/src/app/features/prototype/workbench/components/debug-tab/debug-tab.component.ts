import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import type { DebugRow, DebugSectionRows, DebugSectionText, DebugTabPayload, DebugTabViewModel } from '../../debug/debug-command.types';

export interface DebugCommandEntry {
  input: string;
  output: string;
  success: boolean;
  timestamp: number;
}

@Component({
  selector: 'app-debug-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule],
  templateUrl: './debug-tab.component.html',
  styleUrls: ['./debug-tab.component.scss'],
})
export class DebugTabComponent {
  @Input({ required: true }) payload!: DebugTabPayload;
  @Input() sessionId = '';
  @Output() refresh = new EventEmitter<void>();
  @Output() copy = new EventEmitter<void>();
  @Output() pinSession = new EventEmitter<string>();
  @Output() commandSubmit = new EventEmitter<string>();

  /** 命令输入缓冲 */
  commandInput = '';

  /** 命令历史（输入 + 输出） */
  commandHistory: DebugCommandEntry[] = [];

  copyText(): void {
    this.copy.emit();
  }

  pin(value: string): void {
    this.pinSession.emit(value);
  }

  get viewModel(): DebugTabViewModel {
    return this.payload.viewModel;
  }

  isRowsSection(section: DebugSectionRows | DebugSectionText): section is DebugSectionRows {
    return section.kind === 'rows';
  }

  isTextSection(section: DebugSectionRows | DebugSectionText): section is DebugSectionText {
    return section.kind === 'text';
  }

  isRowItem(item: DebugRow): item is DebugRow {
    return true;
  }

  /** 提交命令 */
  submitCommand(): void {
    const raw = this.commandInput.trim();
    if (!raw) return;

    // 只允许 /debug 开头的命令
    if (!raw.startsWith('/debug')) {
      this.commandHistory.push({
        input: raw,
        output: '仅支持 /debug 相关命令，例如: /debug prompt, /debug memory, /debug workbench',
        success: false,
        timestamp: Date.now(),
      });
      this.commandInput = '';
      return;
    }

    this.commandSubmit.emit(raw);
    this.commandInput = '';
  }

  /** 添加命令结果到历史 */
  addCommandResult(input: string, output: string, success: boolean): void {
    this.commandHistory.push({
      input,
      output,
      success,
      timestamp: Date.now(),
    });
  }

  /** 处理键盘事件 */
  onCommandKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submitCommand();
    }
  }
}
