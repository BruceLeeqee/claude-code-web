import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';

interface ToolItem {
  id: string;
  name: string;
  desc: string;
  selected: boolean;
}

@Component({
  selector: 'app-skill-create-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule],
  templateUrl: './skill-create-wizard.component.html',
  styleUrl: './skill-create-wizard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillCreateWizardComponent {
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly complete = new EventEmitter<{ name: string; desc: string }>();

  protected readonly step = signal(1);
  protected readonly maxStep = 5;

  protected readonly skillName = signal('');
  protected readonly skillDesc = signal('');
  protected readonly skillType = signal<'code' | 'test' | 'api' | 'security' | 'data'>('code');

  protected readonly tools = signal<ToolItem[]>([
    { id: 'code-search', name: 'Code Search API', desc: '在本地代码库中进行语义检索及变量追踪', selected: true },
    { id: 'file-writer', name: 'File Writer', desc: '执行受控文件读写操作', selected: false },
    { id: 'shell-executor', name: 'Shell Executor', desc: '在沙箱终端下运行构建命令', selected: false },
  ]);

  protected readonly depth = signal<'Light' | 'Deep (Comprehensive)'>('Deep (Comprehensive)');
  protected readonly maxRetries = signal(10);

  protected readonly testLogs = signal<string[]>([
    '[08:45:01] Loading Code Search API...',
    '[08:45:02] Running dry-run with test parameters...',
    '[08:45:03] Scanning src/components/sidebar.tsx...',
    '[08:45:05] Found 14 matches. Logic validated.',
  ]);

  protected readonly reviewAfterPublish = signal(false);
  protected readonly enableVersionControl = signal(true);

  protected readonly steps = [
    { id: 1, title: '基本信息' },
    { id: 2, title: '工具选择' },
    { id: 3, title: '参数配置' },
    { id: 4, title: '测试验证' },
    { id: 5, title: '保存草稿' },
  ] as const;

  protected readonly canNext = computed(() => {
    const s = this.step();
    if (s === 1) return this.skillName().trim().length > 1 && this.skillDesc().trim().length > 2;
    if (s === 2) return this.tools().some((t) => t.selected);
    return true;
  });

  protected stepClass(id: number): 'pending' | 'active' | 'done' {
    const cur = this.step();
    if (id < cur) return 'done';
    if (id === cur) return 'active';
    return 'pending';
  }

  protected toggleTool(id: string): void {
    this.tools.update((arr) => arr.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t)));
  }

  protected prev(): void {
    const cur = this.step();
    if (cur <= 1) return;
    this.step.set(cur - 1);
  }

  protected next(): void {
    if (!this.canNext()) return;
    const cur = this.step();
    if (cur >= this.maxStep) return;
    this.step.set(cur + 1);
  }

  protected runTest(): void {
    this.testLogs.update((logs) => [...logs, `[${new Date().toLocaleTimeString()}] Re-run passed.`]);
  }

  protected close(): void {
    this.cancel.emit();
  }

  protected saveAndCreate(): void {
    this.complete.emit({
      name: this.skillName().trim() || '新技能',
      desc: this.skillDesc().trim() || '由向导创建',
    });
  }
}

