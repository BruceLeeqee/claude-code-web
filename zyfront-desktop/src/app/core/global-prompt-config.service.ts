import { Inject, Injectable } from '@angular/core';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './zyfront-core.providers';

@Injectable({ providedIn: 'root' })
export class GlobalPromptConfigService {
  private readonly key = 'zyfront.globalConfig.zyfront.md';

  constructor(@Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime) {}

  async bootstrap(): Promise<void> {
    const content = await this.resolveGlobalConfigContent();
    if (!content) return;
    // zyfront-core 在请求时会通过 `loadPromptGlobalConfig(localStorage)` 读取该配置；
    // 本服务只需确保 localStorage 中的约定 key 已存在即可。
  }

  private async resolveGlobalConfigContent(): Promise<string | null> {
    const fromStorage = this.readFromLocalStorage();
    if (fromStorage) return fromStorage;

    const fromWorkspace = await this.readFromWorkspaceFile();
    if (fromWorkspace) {
      this.writeToLocalStorage(fromWorkspace);
      return fromWorkspace;
    }

    return null;
  }

  private readFromLocalStorage(): string | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { content?: string };
      const content = String(parsed.content ?? '').trim();
      return content || null;
    } catch {
      return null;
    }
  }

  private writeToLocalStorage(content: string): void {
    localStorage.setItem(
      this.key,
      JSON.stringify({
        fileName: 'zyfront.md',
        content,
        updatedAt: Date.now(),
      }),
    );
  }

  private async readFromWorkspaceFile(): Promise<string | null> {
    const read = await window.zytrader.fs.read('zyfront.md', { scope: 'workspace' });
    if (!read.ok) return null;
    const content = String(read.content ?? '').trim();
    return content || null;
  }
}
