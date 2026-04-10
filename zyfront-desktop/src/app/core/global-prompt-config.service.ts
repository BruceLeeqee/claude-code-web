import { Inject, Injectable } from '@angular/core';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from './zyfront-core.providers';

@Injectable({ providedIn: 'root' })
export class GlobalPromptConfigService {
  private readonly key = 'zyfront.globalConfig.zyfront.md';

  constructor(@Inject(CLAUDE_RUNTIME) private readonly runtime: ClaudeCoreRuntime) {}

  async bootstrap(): Promise<void> {
    const content = await this.resolveGlobalConfigContent();
    if (!content) return;

    await this.runtime.context.set('prompt.globalConfig', {
      content,
      loadedAt: Date.now(),
      source: 'zyfront.md',
    });
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
