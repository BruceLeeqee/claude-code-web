import { Injectable } from '@angular/core';

/** 技能来自 Vault `agent-skills` 目录（默认 `03-AGENT-TOOLS/01-Skills/<id>/SKILL.md`） */
export type SkillSource = 'vault';
export type SkillStatus = 'ok' | 'invalid';

export interface SkillRecord {
  id: string;
  name: string;
  desc: string;
  source: SkillSource;
  status: SkillStatus;
  updatedAt?: number;
  installedAt?: number;
  contentPath: string;
  scope: 'vault';
}

interface SkillScanEntry {
  id: string;
  source: SkillSource;
  scope: 'vault';
  contentPath: string;
  updatedAt?: number;
  name: string;
  desc: string;
  status: SkillStatus;
}

type FsWithWatch = typeof window.zytrader.fs & {
  watchDir?: (dir?: string, opts?: { scope?: 'vault' | 'workspace' }) => Promise<{
    ok: boolean;
    watchId?: string;
    error?: string;
  }>;
  unwatchDir?: (watchId: string) => Promise<{ ok: boolean }>;
  onDirectoryChange?: (
    cb: (payload: { watchId: string; scope?: string; dir?: string; ts?: number }) => void,
  ) => () => void;
};

@Injectable({ providedIn: 'root' })
export class SkillIndexService {
  private skillRootRel: string | null = null;

  /** 在模型页等处修改 directory.config 后调用，使下次扫描重新解析路径 */
  invalidateSkillRoot(): void {
    this.skillRootRel = null;
  }

  private async resolveVaultSkillDir(): Promise<string> {
    if (this.skillRootRel) return this.skillRootRel;
    const r = await window.zytrader.vault.resolve('agent-skills');
    if (r.ok && r.relative) {
      this.skillRootRel = r.relative;
      return r.relative;
    }
    this.skillRootRel = '03-AGENT-TOOLS/01-Skills';
    return this.skillRootRel;
  }

  async listInstalledSkills(): Promise<SkillRecord[]> {
    const entries = await this.scanVaultSkillDir();
    return entries
      .map((it) => ({
        id: it.id,
        name: it.name,
        desc: it.desc,
        source: it.source,
        status: it.status,
        updatedAt: it.updatedAt,
        installedAt: it.updatedAt,
        contentPath: it.contentPath,
        scope: it.scope,
      }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id));
  }

  /**
   * 监听 Vault 下技能根目录变更（新建子目录、修改 SKILL.md 等），用于自动刷新索引。
   * 非 Electron 或旧 preload 无 watch API 时返回空清理函数。
   */
  watchVaultSkillRoot(onChange: () => void): () => void {
    const fsApi = window.zytrader?.fs as FsWithWatch | undefined;
    if (
      !fsApi ||
      typeof fsApi.watchDir !== 'function' ||
      typeof fsApi.unwatchDir !== 'function' ||
      typeof fsApi.onDirectoryChange !== 'function'
    ) {
      return () => {};
    }

    let disposed = false;
    let watchId: string | undefined;
    let offListener: (() => void) | undefined;

    void this.resolveVaultSkillDir().then((dir) => {
      void fsApi.watchDir!(dir, { scope: 'vault' }).then((res) => {
        if (disposed) {
          if (res.ok && res.watchId) void fsApi.unwatchDir!(res.watchId);
          return;
        }
        if (!res.ok || !res.watchId) return;
        watchId = res.watchId;
        offListener = fsApi.onDirectoryChange!((payload) => {
          if (payload.watchId === watchId) onChange();
        });
      });
    });

    return () => {
      disposed = true;
      offListener?.();
      offListener = undefined;
      const id = watchId;
      watchId = undefined;
      if (id) void fsApi.unwatchDir!(id);
    };
  }

  async readSkillMd(record: Pick<SkillRecord, 'contentPath' | 'scope'>): Promise<{ ok: boolean; content: string }> {
    const read = await window.zytrader.fs.read(record.contentPath, { scope: record.scope });
    if (!read.ok) return { ok: false, content: '' };
    return { ok: true, content: read.content };
  }

  private async scanVaultSkillDir(): Promise<SkillScanEntry[]> {
    const dir = await this.resolveVaultSkillDir();
    return this.scanDir(dir, 'vault', 'vault');
  }

  private async scanDir(dir: string, scope: 'vault', source: SkillSource): Promise<SkillScanEntry[]> {
    const listed = await window.zytrader.fs.list(dir, { scope });
    if (!listed.ok) return [];

    const out: SkillScanEntry[] = [];
    for (const e of listed.entries) {
      if (e.type !== 'dir') continue;
      const id = e.name;
      const contentPath = `${dir}/${id}/SKILL.md`;
      const read = await window.zytrader.fs.read(contentPath, { scope });
      if (!read.ok) {
        out.push({
          id,
          source,
          scope,
          contentPath,
          name: this.prettyNameFromId(id),
          desc: 'SKILL.md 不存在或不可读。',
          status: 'invalid',
        });
        continue;
      }

      const parsed = this.parseSkillMarkdown(read.content, id);
      out.push({
        id,
        source,
        scope,
        contentPath,
        updatedAt: Date.now(),
        name: parsed.name,
        desc: parsed.desc,
        status: 'ok',
      });
    }

    return out;
  }

  private parseSkillMarkdown(content: string, fallbackId: string): { name: string; desc: string } {
    const lines = content
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);

    const titleLine = lines.find((x) => x.startsWith('#'));
    const firstPlain = lines.find((x) => !x.startsWith('#') && !x.startsWith('---'));

    const name = titleLine?.replace(/^#+\s*/, '').trim() || this.prettyNameFromId(fallbackId);
    const desc = (firstPlain || '本地技能').slice(0, 200);
    return { name, desc };
  }

  private prettyNameFromId(id: string): string {
    const last = id.split('/').pop() ?? id;
    return last
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }
}
