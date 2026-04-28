import { Injectable, inject, signal, computed } from '@angular/core';
import type { RoleDefinition, RoleFileStatus } from './team.types';
import { TEAM_FILE_PATHS, slugify } from './team.types';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

@Injectable({ providedIn: 'root' })
export class RoleRegistryService {
  private readonly persistence = inject(TeamFilePersistenceService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly roles = signal<Map<string, RoleDefinition>>(new Map());
  private readonly initialized = signal(false);

  readonly roleList = computed(() => [...this.roles().values()]);
  readonly roleCount = computed(() => this.roles().size);

  async ensureInitialized(): Promise<void> {
    if (this.initialized()) return;

    this.persistence.clearCache();
    const fileRoles = await this.persistence.scanRoles();
    const map = new Map<string, RoleDefinition>();
    fileRoles.forEach(role => map.set(role.slug, role));
    this.roles.set(map);
    this.initialized.set(true);
  }

  private initializeDefaults(): void {
    const defaults: RoleDefinition[] = [
      this.createDefaultRole('frontend-developer', 'agent-team', '负责实现UI组件、界面交互和前端状态管理的专家。', 'MiniMax-M2.7'),
      this.createDefaultRole('backend-developer', 'agent-team', '负责后端服务、API实现和数据库交互的专家。', 'MiniMax-M2.7'),
      this.createDefaultRole('qa-engineer', 'subagent', '负责测试用例设计、质量验证和回归测试的专家。', 'abab6.5s-chat'),
      this.createDefaultRole('architect', 'agent-team', '负责系统架构设计、技术决策和任务协调的专家。', 'deepseek-v4-pro'),
      this.createDefaultRole('security-reviewer', 'subagent', '负责安全审查、漏洞检测和安全策略评估的专家。', 'MiniMax-M2.7'),
      this.createDefaultRole('devops', 'subagent', '负责部署配置、CI/CD和环境管理的专家。', 'abab6.5s-chat'),
    ];

    const map = new Map<string, RoleDefinition>();
    defaults.forEach(role => {
      map.set(role.slug, role);
      this.persistence.writeRole(role);
    });
    this.roles.set(map);
  }

  private createDefaultRole(
    name: string,
    type: RoleDefinition['type'],
    description: string,
    model: string,
  ): RoleDefinition {
    const now = Date.now();
    return {
      name,
      slug: slugify(name),
      type,
      description,
      model,
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      disallowedTools: [],
      permissionMode: 'acceptEdits',
      maxTurns: 40,
      prompt: description,
      capabilities: [],
      constraints: [],
      allowedPaths: [],
      allowedWritePaths: [],
      status: 'ready',
      filePath: `${TEAM_FILE_PATHS.roles}/${slugify(name)}.md`,
      createdAt: now,
      updatedAt: now,
    };
  }

  async register(role: RoleDefinition): Promise<void> {
    this.roles.update(map => {
      const newMap = new Map(map);
      newMap.set(role.slug, role);
      return newMap;
    });

    await this.persistence.writeRole(role);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_ROLE_CREATED,
      sessionId: 'role-registry',
      source: 'system',
      payload: { role, filePath: role.filePath },
    });
  }

  registerSync(role: RoleDefinition): void {
    this.roles.update(map => {
      const newMap = new Map(map);
      newMap.set(role.slug, role);
      return newMap;
    });

    this.persistence.writeRole(role);
  }

  async unregister(slug: string): Promise<boolean> {
    const existing = this.roles().get(slug);
    if (!existing) return false;

    this.roles.update(map => {
      const newMap = new Map(map);
      newMap.delete(slug);
      return newMap;
    });

    await this.persistence.deleteFile(existing.filePath);
    return true;
  }

  async deleteBySlug(slug: string): Promise<boolean> {
    return this.unregister(slug);
  }

  async update(slug: string, updates: Partial<RoleDefinition>): Promise<RoleDefinition | undefined> {
    const existing = this.roles().get(slug);
    if (!existing) return undefined;

    const updated: RoleDefinition = {
      ...existing,
      ...updates,
      slug: existing.slug,
      updatedAt: Date.now(),
    };

    this.roles.update(map => {
      const newMap = new Map(map);
      newMap.set(slug, updated);
      return newMap;
    });

    await this.persistence.writeRole(updated);
    return updated;
  }

  get(slug: string): RoleDefinition | undefined {
    return this.roles().get(slug);
  }

  getBySlug(slug: string): RoleDefinition | undefined {
    return this.roles().get(slug);
  }

  getByName(name: string): RoleDefinition | undefined {
    return this.roleList().find(r => r.name === name);
  }

  list(): RoleDefinition[] {
    return this.roleList();
  }

  listByType(type: RoleDefinition['type']): RoleDefinition[] {
    return this.roleList().filter(r => r.type === type);
  }

  listByStatus(status: RoleFileStatus): RoleDefinition[] {
    return this.roleList().filter(r => r.status === status);
  }

  exists(slug: string): boolean {
    return this.roles().has(slug);
  }

  existsByName(name: string): boolean {
    return this.roleList().some(r => r.name === name);
  }

  generateTemplate(name: string, description: string, type: RoleDefinition['type'] = 'agent-team', model: string = 'MiniMax-M2.7'): string {
    return this.persistence.roleToMarkdown({
      name,
      slug: slugify(name),
      type,
      description,
      model,
      tools: this.inferTools(description),
      disallowedTools: this.inferDisallowedTools(description),
      permissionMode: 'acceptEdits',
      maxTurns: 40,
      prompt: description,
      capabilities: this.inferCapabilities(description),
      constraints: [],
      allowedPaths: [],
      allowedWritePaths: [],
      status: 'draft',
      filePath: `${TEAM_FILE_PATHS.roles}/${slugify(name)}.md`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  generateRoleFromDescription(name: string, description: string, type: RoleDefinition['type'] = 'agent-team'): RoleDefinition {
    const slug = slugify(name);
    const now = Date.now();
    const model = this.inferModel(description);

    return {
      name,
      slug,
      type,
      description,
      model,
      tools: this.inferTools(description),
      disallowedTools: this.inferDisallowedTools(description),
      permissionMode: 'acceptEdits',
      maxTurns: 40,
      prompt: description,
      capabilities: this.inferCapabilities(description),
      constraints: [],
      allowedPaths: [],
      allowedWritePaths: [],
      status: 'draft',
      filePath: `${TEAM_FILE_PATHS.roles}/${slug}.md`,
      createdAt: now,
      updatedAt: now,
    };
  }

  validate(role: Partial<RoleDefinition>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!role.name || role.name.trim().length === 0) {
      errors.push('角色名称不能为空');
    }

    if (role.name && !/^[a-zA-Z0-9\u4e00-\u9fa5_-]+$/.test(role.name)) {
      errors.push('角色名称只能包含字母、数字、中文、下划线和连字符');
    }

    if (!role.type) {
      errors.push('角色类型必须指定为 subagent 或 agent-team');
    }

    if (role.maxTurns !== undefined && role.maxTurns < 1) {
      errors.push('maxTurns 必须大于 0');
    }

    return { valid: errors.length === 0, errors };
  }

  async refreshFromFiles(): Promise<number> {
    this.persistence.clearCache();
    this.initialized.set(false);
    const fileRoles = await this.persistence.scanRoles();
    const map = new Map<string, RoleDefinition>();
    fileRoles.forEach(role => map.set(role.slug, role));
    this.roles.set(map);
    this.initialized.set(true);
    return fileRoles.length;
  }

  private inferModel(description: string): string {
    if (/架构|设计|方案|architect|design/i.test(description)) return 'deepseek-v4-pro';
    if (/测试|验证|qa|test/i.test(description)) return 'abab6.5s-chat';
    if (/安全|审查|security|audit/i.test(description)) return 'MiniMax-M2.7';
    return 'MiniMax-M2.7';
  }

  private inferTools(description: string): string[] {
    const tools = ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'];
    if (/搜索|调研|search|research/i.test(description)) {
      tools.push('WebSearch', 'WebFetch');
    }
    return tools;
  }

  private inferDisallowedTools(description: string): string[] {
    const disallowed: string[] = [];
    if (/只读|审查|review|audit/i.test(description)) {
      disallowed.push('Write', 'Edit', 'Bash');
    }
    return disallowed;
  }

  private inferCapabilities(description: string): string[] {
    const caps: string[] = [];
    if (/前端|frontend|ui|react|angular|vue/i.test(description)) caps.push('frontend-dev');
    if (/后端|backend|api|server/i.test(description)) caps.push('backend-dev');
    if (/测试|test|qa/i.test(description)) caps.push('testing');
    if (/安全|security/i.test(description)) caps.push('security-review');
    if (/部署|deploy|devops|ci/i.test(description)) caps.push('devops');
    if (/架构|architect/i.test(description)) caps.push('architecture');
    return caps;
  }
}
