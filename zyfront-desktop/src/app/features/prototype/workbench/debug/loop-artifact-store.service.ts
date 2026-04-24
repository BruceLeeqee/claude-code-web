import { Injectable } from '@angular/core';
import type { LoopArtifact, LoopState, LoopStepDoc } from './loop-command.types';

declare const window: Window & typeof globalThis;

/**
 * Loop 工件存储与文档索引
 *
 * 职责（对应文档 P2）：
 * - 任务级文档索引
 * - 工件归档（document / screenshot / log / patch / report）
 * - 产出物持久化
 */

export interface ArtifactIndex {
  loopId: string;
  taskId: string;
  documents: ArtifactEntry[];
  screenshots: ArtifactEntry[];
  logs: ArtifactEntry[];
  patches: ArtifactEntry[];
  reports: ArtifactEntry[];
  totalSize: number;
  indexedAt: string;
}

export interface ArtifactEntry {
  id: string;
  kind: LoopArtifact['kind'];
  label: string;
  path: string;
  stepId: string;
  size: number;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class LoopArtifactStoreService {

  /**
   * 为 loop 状态构建完整的工件索引
   */
  buildIndex(state: LoopState): ArtifactIndex {
    const now = new Date().toISOString();
    const entries = state.artifacts.map((a) => this.toEntry(a, state));
    const stepDocEntries = state.stepDocs.map((d) => this.stepDocToEntry(d));

    const allEntries = [...entries, ...stepDocEntries];

    return {
      loopId: state.loopId,
      taskId: state.taskId,
      documents: allEntries.filter((e) => e.kind === 'document'),
      screenshots: allEntries.filter((e) => e.kind === 'screenshot'),
      logs: allEntries.filter((e) => e.kind === 'log'),
      patches: allEntries.filter((e) => e.kind === 'patch'),
      reports: allEntries.filter((e) => e.kind === 'report'),
      totalSize: allEntries.reduce((sum, e) => sum + e.size, 0),
      indexedAt: now,
    };
  }

  /**
   * 注册新工件到 loop 状态
   */
  registerArtifact(
    state: LoopState,
    kind: LoopArtifact['kind'],
    label: string,
    path: string,
  ): LoopArtifact[] {
    const now = new Date().toISOString();
    const artifact: LoopArtifact = { kind, label, path, createdAt: now };
    return [...state.artifacts, artifact];
  }

  /**
   * 将索引写入磁盘
   */
  async writeIndexToDisk(index: ArtifactIndex): Promise<boolean> {
    if (typeof window === 'undefined' || !window.zytrader?.fs?.write) return false;

    const content = this.renderIndex(index);
    const indexPath = `02-AGENT-MEMORY/01-Short-Term/loop/${index.loopId}-artifact-index.md`;
    const result = await window.zytrader.fs.write(indexPath, content, { scope: 'vault' });
    return result.ok;
  }

  /**
   * 渲染索引为可读 markdown
   */
  renderIndex(index: ArtifactIndex): string {
    const lines: string[] = [
      `# 工件索引：${index.loopId}`,
      '',
      `> 任务 ID: ${index.taskId}`,
      `> 索引时间: ${index.indexedAt}`,
      `> 总大小: ${index.totalSize} bytes`,
      '',
    ];

    const sections: Array<{ title: string; entries: ArtifactEntry[] }> = [
      { title: '文档', entries: index.documents },
      { title: '截图', entries: index.screenshots },
      { title: '日志', entries: index.logs },
      { title: '补丁', entries: index.patches },
      { title: '报告', entries: index.reports },
    ];

    for (const section of sections) {
      if (section.entries.length === 0) continue;
      lines.push(`## ${section.title}`, '');
      lines.push('| ID | 标签 | 路径 | 步骤 | 大小 | 创建时间 |');
      lines.push('|---|---|---|---|---|---|');
      for (const e of section.entries) {
        lines.push(`| ${e.id} | ${e.label} | ${e.path} | ${e.stepId} | ${e.size} | ${e.createdAt} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /* ── 内部方法 ────────────────────────────────────────── */

  private toEntry(artifact: LoopArtifact, state: LoopState): ArtifactEntry {
    const relatedDoc = state.stepDocs.find((d) => d.path === artifact.path);
    return {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: artifact.kind,
      label: artifact.label,
      path: artifact.path,
      stepId: relatedDoc?.stepId ?? 'unknown',
      size: 0,
      createdAt: artifact.createdAt,
    };
  }

  private stepDocToEntry(doc: LoopStepDoc): ArtifactEntry {
    return {
      id: doc.id,
      kind: 'document',
      label: doc.title,
      path: doc.path,
      stepId: doc.stepId,
      size: doc.content?.length ?? 0,
      createdAt: doc.createdAt,
    };
  }
}
