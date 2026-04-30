import { Injectable, inject, signal, computed } from '@angular/core';
import type { StructDefinition, StructFileStatus, TeamStageDefinition, TeamRunMode } from './team.types';
import { TEAM_FILE_PATHS, slugify } from './team.types';
import { RoleRegistryService } from './role-registry.service';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

@Injectable({ providedIn: 'root' })
export class StructRegistryService {
  private readonly persistence = inject(TeamFilePersistenceService);
  private readonly roleRegistry = inject(RoleRegistryService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly structs = signal<Map<string, StructDefinition>>(new Map());
  private readonly initialized = signal(false);

  readonly structList = computed(() => [...this.structs().values()]);
  readonly structCount = computed(() => this.structs().size);

  async ensureInitialized(): Promise<void> {
    if (this.initialized()) return;

    this.persistence.clearCache();
    const fileStructs = await this.persistence.scanStructs();
    const map = new Map<string, StructDefinition>();
    fileStructs.forEach(s => map.set(s.slug, s));
    this.structs.set(map);
    this.initialized.set(true);
  }

  private initializeDefaults(): void {
    const defaults: StructDefinition[] = [
      this.createDefaultStruct(
        'fullstack-dev-with-fix',
        'hybrid',
        '前后端并行开发 + 集成排障 + 回归验证的混合结构。',
        ['frontend-developer', 'backend-developer', 'qa-engineer'],
        [
          { name: 'parallel-development', mode: 'subagent', roles: ['frontend-developer', 'backend-developer'], parallel: true, maxRounds: 1 },
          { name: 'integration-verification', mode: 'agent-team', roles: ['frontend-developer', 'backend-developer', 'qa-engineer'], maxRounds: 3 },
          { name: 'regression', mode: 'subagent', roles: ['qa-engineer'], maxRounds: 1 },
        ],
      ),
      this.createDefaultStruct(
        'security-review',
        'agent-team',
        '安全审查流程：代码扫描 + 漏洞分析 + 修复验证。',
        ['security-reviewer', 'backend-developer', 'qa-engineer'],
        [
          { name: 'security-scan', mode: 'subagent', roles: ['security-reviewer'], maxRounds: 1 },
          { name: 'fix-and-verify', mode: 'agent-team', roles: ['security-reviewer', 'backend-developer'], maxRounds: 3 },
          { name: 'regression', mode: 'subagent', roles: ['qa-engineer'], maxRounds: 1 },
        ],
      ),
      this.createDefaultStruct(
        'pr-verification',
        'agent-team',
        'PR 评审流程：代码审查 + 测试验证 + 合并确认。',
        ['architect', 'qa-engineer'],
        [
          { name: 'code-review', mode: 'agent-team', roles: ['architect'], maxRounds: 2 },
          { name: 'test-verification', mode: 'subagent', roles: ['qa-engineer'], maxRounds: 1 },
        ],
      ),
    ];

    const map = new Map<string, StructDefinition>();
    defaults.forEach(s => {
      map.set(s.slug, s);
      this.persistence.writeStruct(s);
    });
    this.structs.set(map);
  }

  private createDefaultStruct(
    name: string,
    type: StructDefinition['type'],
    description: string,
    roles: string[],
    stages: TeamStageDefinition[],
  ): StructDefinition {
    const slug = slugify(name);
    const now = Date.now();
    return {
      name,
      slug,
      type,
      description,
      roles,
      stages,
      handoffRules: ['前一阶段完成后自动切换到下一阶段', '如遇阻塞，升级到协作模式'],
      communicationRules: ['subagent 阶段不共享上下文', 'agent-team 阶段共享任务列表和邮箱'],
      completionCriteria: ['所有阶段任务完成', '无阻塞项'],
      failurePolicy: '逐级升级，最终回退到协作排查',
      status: 'ready',
      filePath: `${TEAM_FILE_PATHS.structs}/${slug}.md`,
      createdAt: now,
      updatedAt: now,
    };
  }

  async register(struct: StructDefinition): Promise<void> {
    this.structs.update(map => {
      const newMap = new Map(map);
      newMap.set(struct.slug, struct);
      return newMap;
    });

    await this.persistence.writeStruct(struct);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_STRUCT_CREATED,
      sessionId: 'struct-registry',
      source: 'system',
      payload: { struct, filePath: struct.filePath },
    });
  }

  registerSync(struct: StructDefinition): void {
    this.structs.update(map => {
      const newMap = new Map(map);
      newMap.set(struct.slug, struct);
      return newMap;
    });

    this.persistence.writeStruct(struct);
  }

  async unregister(slug: string): Promise<boolean> {
    const existing = this.structs().get(slug);
    if (!existing) return false;

    this.structs.update(map => {
      const newMap = new Map(map);
      newMap.delete(slug);
      return newMap;
    });

    await this.persistence.deleteFile(existing.filePath);
    return true;
  }

  async update(slug: string, updates: Partial<StructDefinition>): Promise<StructDefinition | undefined> {
    const existing = this.structs().get(slug);
    if (!existing) return undefined;

    const updated: StructDefinition = {
      ...existing,
      ...updates,
      slug: existing.slug,
      updatedAt: Date.now(),
    };

    this.structs.update(map => {
      const newMap = new Map(map);
      newMap.set(slug, updated);
      return newMap;
    });

    await this.persistence.writeStruct(updated);
    return updated;
  }

  get(slug: string): StructDefinition | undefined {
    return this.structs().get(slug);
  }

  getByName(name: string): StructDefinition | undefined {
    const byName = this.structList().find(s => s.name === name);
    if (byName) return byName;

    const bySlug = this.structs().get(name);
    if (bySlug) return bySlug;

    const lowerName = name.toLowerCase();
    return this.structList().find(s =>
      s.name.toLowerCase() === lowerName ||
      s.slug.toLowerCase() === lowerName
    );
  }

  list(): StructDefinition[] {
    return this.structList();
  }

  listByType(type: StructDefinition['type']): StructDefinition[] {
    return this.structList().filter(s => s.type === type);
  }

  listByStatus(status: StructFileStatus): StructDefinition[] {
    return this.structList().filter(s => s.status === status);
  }

  exists(slug: string): boolean {
    return this.structs().has(slug);
  }

  existsByName(name: string): boolean {
    return this.structList().some(s => s.name === name);
  }

  validateRoles(roles: string[]): { valid: boolean; missing: string[]; registeredCount: number } {
    const registeredRoles = this.roleRegistry.roleList();
    const missing: string[] = [];

    for (const r of roles) {
      if (this.roleRegistry.existsBySlugOrName(r)) continue;

      const rLower = r.toLowerCase();
      const slugMatch = registeredRoles.some(role => role.slug.toLowerCase() === rLower);
      if (slugMatch) continue;

      const semanticMatch = registeredRoles.some(role => {
        const nameLower = role.name.toLowerCase();
        const descLower = (role.description ?? '').toLowerCase();
        const slugLower = role.slug.toLowerCase();
        return (
          nameLower.includes(rLower) ||
          rLower.includes(nameLower) ||
          descLower.includes(rLower) ||
          slugLower.includes(rLower) ||
          rLower.includes(slugLower) ||
          (role.capabilities ?? []).some(cap => cap.toLowerCase().includes(rLower) || rLower.includes(cap.toLowerCase()))
        );
      });

      if (!semanticMatch) {
        missing.push(r);
      }
    }

    return { valid: missing.length === 0, missing, registeredCount: registeredRoles.length };
  }

  generateTemplate(
    name: string,
    description: string,
    roles: string[],
    type: StructDefinition['type'] = 'hybrid',
  ): string {
    const stages = this.inferStages(description, roles, type);
    const struct: StructDefinition = {
      name,
      slug: slugify(name),
      type,
      description,
      roles,
      stages,
      handoffRules: ['前一阶段完成后自动切换到下一阶段', '如遇阻塞，升级到协作模式'],
      communicationRules: ['subagent 阶段不共享上下文', 'agent-team 阶段共享任务列表和邮箱'],
      completionCriteria: ['所有阶段任务完成', '无阻塞项'],
      failurePolicy: '逐级升级，最终回退到协作排查',
      status: 'draft',
      filePath: `${TEAM_FILE_PATHS.structs}/${slugify(name)}.md`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return this.persistence.structToMarkdown(struct);
  }

  generateStructFromDescription(
    name: string,
    description: string,
    roles: string[],
    type: StructDefinition['type'] = 'hybrid',
  ): StructDefinition {
    const slug = slugify(name);
    const now = Date.now();
    const stages = this.inferStages(description, roles, type);

    return {
      name,
      slug,
      type,
      description,
      roles,
      stages,
      handoffRules: ['前一阶段完成后自动切换到下一阶段', '如遇阻塞，升级到协作模式'],
      communicationRules: ['subagent 阶段不共享上下文', 'agent-team 阶段共享任务列表和邮箱'],
      completionCriteria: ['所有阶段任务完成', '无阻塞项'],
      failurePolicy: '逐级升级，最终回退到协作排查',
      status: 'draft',
      filePath: `${TEAM_FILE_PATHS.structs}/${slug}.md`,
      createdAt: now,
      updatedAt: now,
    };
  }

  validate(struct: Partial<StructDefinition>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!struct.name || struct.name.trim().length === 0) {
      errors.push('协作结构名称不能为空');
    }

    if (!struct.type) {
      errors.push('协作结构类型必须指定');
    }

    if (!struct.roles || struct.roles.length === 0) {
      errors.push('协作结构必须至少包含一个角色');
    }

    if (struct.stages && struct.stages.length === 0) {
      errors.push('协作结构必须至少包含一个阶段');
    }

    if (Array.isArray(struct.stages)) {
      struct.stages.forEach((stage, i) => {
        if (!stage.name) errors.push(`阶段 ${i + 1} 缺少名称`);
        if (!stage.mode) errors.push(`阶段 ${i + 1} 缺少模式`);
        if (!stage.roles || stage.roles.length === 0) errors.push(`阶段 ${i + 1} 缺少角色`);
      });
    }

    return { valid: errors.length === 0, errors };
  }

  async refreshFromFiles(): Promise<number> {
    this.persistence.clearCache();
    this.initialized.set(false);
    const fileStructs = await this.persistence.scanStructs();
    const map = new Map<string, StructDefinition>();
    fileStructs.forEach(s => map.set(s.slug, s));
    this.structs.set(map);
    this.initialized.set(true);
    return fileStructs.length;
  }

  private inferStages(description: string, roles: string[], type: StructDefinition['type']): TeamStageDefinition[] {
    if (type === 'subagent') {
      return [{
        name: 'isolated-execution',
        mode: 'subagent',
        roles,
        parallel: true,
        maxRounds: 1,
      }];
    }

    if (type === 'agent-team') {
      return [{
        name: 'collaborative-work',
        mode: 'agent-team',
        roles,
        maxRounds: 5,
      }];
    }

    const stages: TeamStageDefinition[] = [];

    stages.push({
      name: 'parallel-development',
      mode: 'subagent',
      roles,
      parallel: true,
      maxRounds: 1,
    });

    stages.push({
      name: 'integration-collaboration',
      mode: 'agent-team',
      roles,
      maxRounds: 3,
    });

    const hasQa = roles.some(r => /qa|test|验证/i.test(r));
    if (hasQa) {
      stages.push({
        name: 'regression-verification',
        mode: 'subagent',
        roles: roles.filter(r => /qa|test|验证/i.test(r)),
        maxRounds: 1,
      });
    }

    return stages;
  }
}
