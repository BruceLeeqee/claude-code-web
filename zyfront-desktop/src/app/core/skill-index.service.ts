import { Injectable } from '@angular/core';

/**
 * 技能来自 Vault `agent-skills` 目录（默认 `03-AGENT-TOOLS/01-Skills/<id>/`）。
 * 入口文件（自动生成须遵守，否则可能检测不到）：依次尝试 `SKILL.md` → `Skill.md` → `skill.md`。
 * 约定说明见本包 `docs/agent-skills-vault-convention.md`。
 */
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

  /**
   * 统一路径格式（Windows/WSL2 兼容）：
   * - 去掉首尾空白
   * - 统一为 / 分隔，避免 `a\\b\\SKILL.md` 在 preload 中解析失败
   * - 去掉重复斜杠（保留协议头，如 https://）
   */
  private normalizeSkillPath(path: string): string {
    const trimmed = String(path ?? '').trim();
    if (!trimmed) return '';
    const slash = trimmed.replace(/\\/g, '/');
    return slash.replace(/(^|[^:])\/\/+?/g, '$1/');
  }

  /** 针对 Windows/WSL2 的兜底读取：先标准路径，再尝试反斜杠路径 */
  private async readSkillFileCompat(path: string, scope: 'vault'): Promise<{ ok: boolean; content: string }> {
    const normalized = this.normalizeSkillPath(path);
    const first = await window.zytrader.fs.read(normalized, { scope });
    if (first.ok) return { ok: true, content: first.content };

    const backslash = normalized.replace(/\//g, '\\');
    if (backslash !== normalized) {
      const second = await window.zytrader.fs.read(backslash, { scope });
      if (second.ok) return { ok: true, content: second.content };
    }

    return { ok: false, content: '' };
  }

  /** 在模型页等处修改 directory.config 后调用，使下次扫描重新解析路径 */
  invalidateSkillRoot(): void {
    this.skillRootRel = null;
  }

  private async resolveVaultSkillDir(): Promise<string> {
    if (this.skillRootRel) return this.skillRootRel;
    const r = await window.zytrader.vault.resolve('agent-skills');
    if (r.ok && r.relative) {
      this.skillRootRel = this.normalizeSkillPath(r.relative);
      return this.skillRootRel;
    }
    this.skillRootRel = this.normalizeSkillPath('03-AGENT-TOOLS/01-Skills');
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
    // 原则：路径读取要跨 Windows/WSL2 稳定，不能因分隔符差异导致偶发读不到 SKILL.md
    return this.readSkillFileCompat(record.contentPath, record.scope);
  }

  private async scanVaultSkillDir(): Promise<SkillScanEntry[]> {
    const dir = await this.resolveVaultSkillDir();
    return this.scanDir(this.normalizeSkillPath(dir), 'vault', 'vault');
  }

  private async scanDir(dir: string, scope: 'vault', source: SkillSource): Promise<SkillScanEntry[]> {
    const out: SkillScanEntry[] = [];

    const walk = async (currentDir: string, depth: number): Promise<void> => {
      // 支持 agent 自动生成的多级技能目录（如 01-Skills/douyin/text-to-ppt/SKILL.md）
      // 兼容较深的 agent 生成目录（如多级子技能）
      if (depth > 10) return;
      const listed = await window.zytrader.fs.list(currentDir, { scope });
      if (!listed.ok) return;

      for (const e of listed.entries) {
        if (e.type !== 'dir') continue;
        const fullDir = this.normalizeSkillPath(`${currentDir}/${e.name}`);
        /** 与本包 docs/agent-skills-vault-convention.md 一致；自动生成请使用其中任一名 */
        const skillNameCandidates = ['SKILL.md', 'Skill.md', 'skill.md'];
        let read: { ok: boolean; content: string } = { ok: false, content: '' };
        let contentPath = '';
        for (const fname of skillNameCandidates) {
          const p = this.normalizeSkillPath(`${fullDir}/${fname}`);
          read = await this.readSkillFileCompat(p, scope);
          if (read.ok) {
            contentPath = p;
            break;
          }
        }
        // 仅有 *.md 而无 SKILL.md 的目录（如只放了 douyin-search.md）仍视为一个技能
        if (!read.ok) {
          const inner = await window.zytrader.fs.list(fullDir, { scope });
          if (inner.ok) {
            const mdFiles = inner.entries.filter((x) => x.type === 'file' && /\.md$/i.test(x.name));
            const preferred = mdFiles.find((x) => /^skill\.md$/i.test(x.name));
            const single = mdFiles.length === 1 ? mdFiles[0] : undefined;
            const pick = preferred ?? single;
            if (pick) {
              contentPath = this.normalizeSkillPath(`${fullDir}/${pick.name}`);
              read = await this.readSkillFileCompat(contentPath, scope);
            }
          }
        }

        if (read.ok && contentPath) {
          const id = this.normalizeSkillPath(fullDir.replace(`${dir}/`, ''));
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
          // 命中技能目录后继续向下扫描，兼容“技能组/子技能”混合结构
        }

        await walk(fullDir, depth + 1);
      }
    };

    await walk(dir, 0);
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
