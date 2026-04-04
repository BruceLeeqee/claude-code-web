/**
 * 浏览器内内存文件系统：路径 → 文本内容与更新时间，用于演示或编辑器沙箱。
 */
/** 虚拟文件条目 */
export interface MemFile {
  path: string;
  content: string;
  updatedAt: number;
}

/** 目录节点描述（与当前 Map 实现配合的辅助结构） */
export interface MemDirNode {
  path: string;
  files: MemFile[];
  dirs: string[];
}

/** 以 Map 存储的简易内存文件系统 */
export class MemoryFileSystem {
  private readonly files = new Map<string, MemFile>();

  /** 写入或覆盖文件 */
  write(path: string, content: string): void {
    this.files.set(path, {
      path,
      content,
      updatedAt: Date.now(),
    });
  }

  /** 读取内容，不存在返回 null */
  read(path: string): string | null {
    return this.files.get(path)?.content ?? null;
  }

  /** 删除路径 */
  remove(path: string): void {
    this.files.delete(path);
  }

  /** 按路径前缀筛选文件 */
  list(prefix = ''): MemFile[] {
    return [...this.files.values()].filter((f) => f.path.startsWith(prefix));
  }

  /** 返回全部文件副本 */
  snapshot(): MemFile[] {
    return [...this.files.values()];
  }
}
