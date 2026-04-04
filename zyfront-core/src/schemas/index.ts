/**
 * 模式注册表：按 id@version 存 JSON Schema 等定义。
 */
/** 一条注册的模式条目 */
export interface SchemaRegistryEntry {
  id: string;
  version: string;
  schema: unknown;
}

/** id@version 为键的模式仓库 */
export class SchemaRegistry {
  private readonly entries = new Map<string, SchemaRegistryEntry>();

  /** 注册条目，键为 `${id}@${version}` */
  register(entry: SchemaRegistryEntry): void {
    this.entries.set(`${entry.id}@${entry.version}`, entry);
  }

  /** 按 id 与 version 查找 */
  get(id: string, version: string): SchemaRegistryEntry | null {
    return this.entries.get(`${id}@${version}`) ?? null;
  }
}
