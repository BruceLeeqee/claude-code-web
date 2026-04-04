/**
 * 插件管理器：为每个插件注入事件总线、存储与服务注册表，并负责 setup/teardown。
 * 让插件开发者关注“进入时做什么”和“退出时做什么”，而宿主程序负责管理整个生命周期
 */
import type { Plugin, PluginContext, StorageAdapter } from '../types/index.js';
import { InMemoryEventBus } from '../utils/index.js';

export class PluginManager {
  private readonly plugins = new Map<string, Plugin>();
  private readonly events = new InMemoryEventBus();
  private readonly serviceContainer = new Map<string, unknown>();

  constructor(private readonly storage: StorageAdapter) {}

  /** 首次注册时调用 setup；重复 id 忽略 */
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

  /** 调用 teardown 后移除 */
  async unregister(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    await plugin.teardown?.();
    this.plugins.delete(id);
  }

  /** 已加载插件列表 */
  list(): Plugin[] {
    return [...this.plugins.values()];
  }

  /** 获取插件通过 exposeService 注册的实例 */
  getService<T>(name: string): T | null {
    return (this.serviceContainer.get(name) as T | undefined) ?? null;
  }
}
