import { Injectable, signal } from '@angular/core';

// 快照接口
export interface Snapshot {
  id: string;
  name: string;
  createdAt: Date;
  description: string;
  state: any;
  size: number;
  mode: string;
}

// 快照元数据
export interface SnapshotMetadata {
  id: string;
  name: string;
  createdAt: Date;
  mode: string;
  size: number;
}

@Injectable({ providedIn: 'root' })
export class SnapshotService {
  readonly snapshots = signal<Snapshot[]>([]);
  private maxSnapshots = 20;
  private autoSaveInterval: any = null;

  // 获取所有快照元数据
  getAllMetadata(): SnapshotMetadata[] {
    return this.snapshots().map(s => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      mode: s.mode,
      size: s.size
    }));
  }

  // 创建快照
  createSnapshot(name: string, state: any, mode: string, description?: string): Snapshot {
    const snapshot: Snapshot = {
      id: this.generateId(),
      name,
      createdAt: new Date(),
      description: description || '',
      state: this.deepClone(state),
      size: this.calculateSize(state),
      mode
    };

    this.snapshots.update(prev => {
      const updated = [...prev, snapshot];
      if (updated.length > this.maxSnapshots) {
        return updated.slice(-this.maxSnapshots);
      }
      return updated;
    });

    return snapshot;
  }

  // 恢复快照
  restoreSnapshot(id: string): any {
    const snapshot = this.snapshots().find(s => s.id === id);
    if (!snapshot) {
      throw new Error(`Snapshot ${id} not found`);
    }
    return this.deepClone(snapshot.state);
  }

  // 删除快照
  deleteSnapshot(id: string): boolean {
    const initialLength = this.snapshots().length;
    this.snapshots.update(prev => prev.filter(s => s.id !== id));
    return this.snapshots().length < initialLength;
  }

  // 获取最新快照
  getLatestSnapshot(): Snapshot | null {
    const sorted = [...this.snapshots()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return sorted[0] || null;
  }

  // 根据ID获取快照
  getSnapshotById(id: string): Snapshot | null {
    return this.snapshots().find(s => s.id === id) || null;
  }

  // 清空所有快照
  clearSnapshots(): void {
    this.snapshots.set([]);
  }

  // 开始自动保存
  startAutoSave(stateFn: () => any, mode: string, intervalMs: number = 30000): void {
    this.stopAutoSave();
    this.autoSaveInterval = setInterval(() => {
      const state = stateFn();
      const now = new Date();
      this.createSnapshot(
        `自动保存 ${now.toLocaleTimeString()}`,
        state,
        mode,
        `自动生成的快照`
      );
    }, intervalMs);
  }

  // 停止自动保存
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  // 深拷贝
  private deepClone<T>(obj: T): T {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      console.warn('Deep clone failed, returning original', e);
      return obj;
    }
  }

  // 计算对象大小
  private calculateSize(obj: any): number {
    try {
      return new Blob([JSON.stringify(obj)]).size;
    } catch (e) {
      return 0;
    }
  }

  // 生成ID
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
