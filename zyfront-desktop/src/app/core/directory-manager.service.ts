import { Injectable } from '@angular/core';

export interface DirectoryConfig {
  version: number;
  keys: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class DirectoryManagerService {
  private cache: DirectoryConfig | null = null;

  async ensureVaultReady(): Promise<void> {
    const boot = await window.zytrader.vault.bootstrap();
    if (!boot.ok) {
      throw new Error(boot.error ?? 'vault bootstrap failed');
    }
  }

  async readDirectoryConfig(force = false): Promise<DirectoryConfig> {
    if (this.cache && !force) return this.cache;

    const read = await window.zytrader.fs.read('05-SYSTEM/directory.config.json', { scope: 'vault' });
    if (!read.ok) {
      throw new Error('failed to read directory.config.json');
    }

    const parsed = JSON.parse(read.content) as Partial<DirectoryConfig>;
    const normalized: DirectoryConfig = {
      version: Number(parsed.version ?? 1),
      keys: { ...(parsed.keys ?? {}) },
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
