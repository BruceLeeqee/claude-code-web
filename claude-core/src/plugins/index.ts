import type { Plugin, PluginContext, StorageAdapter } from '../types/index.js';
import { InMemoryEventBus } from '../utils/index.js';

export class PluginManager {
  private readonly plugins = new Map<string, Plugin>();
  private readonly events = new InMemoryEventBus();
  private readonly serviceContainer = new Map<string, unknown>();

  constructor(private readonly storage: StorageAdapter) {}

  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.id)) return;

    const ctx: PluginContext = {
      events: this.events,
      storage: this.storage,
      exposeService: (name, service) => {
        this.serviceContainer.set(name, service);
      },
      getService: <T>(name: string): T | null => {
        return (this.serviceContainer.get(name) as T | undefined) ?? null;
      },
    };

    await plugin.setup(ctx);
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

  getService<T>(name: string): T | null {
    return (this.serviceContainer.get(name) as T | undefined) ?? null;
  }
}
