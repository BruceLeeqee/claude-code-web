export interface MemFile {
  path: string;
  content: string;
  updatedAt: number;
}

export interface MemDirNode {
  path: string;
  files: MemFile[];
  dirs: string[];
}

/**
 * Browser-side in-memory filesystem simulation.
 */
export class MemoryFileSystem {
  private readonly files = new Map<string, MemFile>();

  write(path: string, content: string): void {
    this.files.set(path, {
      path,
      content,
      updatedAt: Date.now(),
    });
  }

  read(path: string): string | null {
    return this.files.get(path)?.content ?? null;
  }

  remove(path: string): void {
    this.files.delete(path);
  }

  list(prefix = ''): MemFile[] {
    return [...this.files.values()].filter((f) => f.path.startsWith(prefix));
  }

  snapshot(): MemFile[] {
    return [...this.files.values()];
  }
}
