import type { Plugin, PluginContext, StorageAdapter } from '../types/index.js';
import { InMemoryEventBus } from '../utils/index.js';

export class PluginManager {
  private readonly plugins = new Map<string, Plugin>();
  private readonly events = new InMemoryEventBus();

  constructor(private readonly storage: StorageAdapter) {}

  async register(plugin: Plugin): Promise<void> {
    await plugin.setup({ events: this.events, storage: this.storage } satisfies PluginContext);
    this.plugins.set(plugin.id, plugin);
  }

  async unregister(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    await plugin.teardown?.();
    this.plugins.delete(id);
  }

  list(): Plugin[] {
    return [...this.plugins.values()];
  }
}
