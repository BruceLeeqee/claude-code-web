export interface SchemaRegistryEntry {
  id: string;
  version: string;
  schema: unknown;
}

export class SchemaRegistry {
  private readonly entries = new Map<string, SchemaRegistryEntry>();

  register(entry: SchemaRegistryEntry): void {
    this.entries.set(`${entry.id}@${entry.version}`, entry);
  }

  get(id: string, version: string): SchemaRegistryEntry | null {
    return this.entries.get(`${id}@${version}`) ?? null;
  }
}
