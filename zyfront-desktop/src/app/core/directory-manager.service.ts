import { Injectable } from '@angular/core';

export interface DirectoryConfig {
  version: number;
  keys: Record<string, string>;
}

/** 与 Electron main `DEFAULT_DIRECTORY_CONFIG.keys` 对齐，用于合并缺省项 */
const DEFAULT_DIRECTORY_KEYS: Record<string, string> = {
  inbox: '00-HUMAN-TEMP',
  'inbox-human': '00-HUMAN-TEMP/human',
  'inbox-agent': '00-HUMAN-TEMP/agent',
  'human-notes': '01-HUMAN-NOTES',
  'agent-memory': '02-AGENT-MEMORY',
  'agent-short-term': '02-AGENT-MEMORY/01-Short-Term',
  'agent-long-term': '02-AGENT-MEMORY/02-Long-User',
  'agent-long-user': '02-AGENT-MEMORY/02-Long-User',
  'agent-long-feedback': '02-AGENT-MEMORY/03-Long-Feedback',
  'agent-long-project': '02-AGENT-MEMORY/04-Long-Projects',
  'agent-long-reference': '02-AGENT-MEMORY/05-Long-Reference',
  'agent-context': '02-AGENT-MEMORY/06-Context',
  'agent-meta': '02-AGENT-MEMORY/07-Meta',
  'agent-memory-index': '02-AGENT-MEMORY/07-Meta',
  'agent-skills': '03-AGENT-TOOLS/01-Skills',
  'agent-plugins': '03-AGENT-TOOLS/02-Plugins',
  'agent-docs': '03-AGENT-TOOLS/08-Docs',
  projects: '04-PROJECTS',
  resources: '05-RESOURCES',
  system: '06-SYSTEM',
};

@Injectable({ providedIn: 'root' })
export class DirectoryManagerService {
  private cache: DirectoryConfig | null = null;

  async ensureVaultReady(): Promise<void> {
    const boot = await window.zytrader.vault.bootstrap();
    if (!boot.ok) {
      throw new Error(boot.error ?? 'vault bootstrap failed');
    }
  }

  invalidateCache(): void {
    this.cache = null;
  }

  async readDirectoryConfig(force = false): Promise<DirectoryConfig> {
    if (this.cache && !force) return this.cache;

    const candidates = ['06-SYSTEM/directory.config.json', '05-SYSTEM/directory.config.json'];
    let raw: string | undefined;
    for (const p of candidates) {
      const read = await window.zytrader.fs.read(p, { scope: 'vault' });
      if (read.ok && typeof read.content === 'string') {
        raw = read.content;
        break;
      }
    }
    if (raw === undefined) {
      throw new Error('failed to read directory.config.json');
    }

    const parsed = JSON.parse(raw) as Partial<DirectoryConfig>;
    const normalized: DirectoryConfig = {
      version: Number(parsed.version ?? 1),
      keys: { ...DEFAULT_DIRECTORY_KEYS, ...(parsed.keys ?? {}) },
    };
    this.cache = normalized;
    return normalized;
  }

  async getFullPath(key: string): Promise<string> {
    const resolved = await window.zytrader.vault.resolve(key);
    if (!resolved.ok || !resolved.absolute) {
      throw new Error(resolved.error ?? `unknown key: ${key}`);
    }
    return resolved.absolute;
  }

  async getRelativePathByKey(key: string): Promise<string> {
    const cfg = await this.readDirectoryConfig();
    const rel = cfg.keys[key];
    if (!rel) throw new Error(`unknown key: ${key}`);
    return rel;
  }
}
