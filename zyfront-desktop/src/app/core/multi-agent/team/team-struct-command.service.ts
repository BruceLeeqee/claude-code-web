import { Injectable, inject } from '@angular/core';
import type { StructDefinition, CommandResult } from './team.types';
import { TEAM_FILE_PATHS, slugify } from './team.types';
import { StructRegistryService } from './struct-registry.service';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

@Injectable({ providedIn: 'root' })
export class TeamStructCommandService {
  private readonly registry = inject(StructRegistryService);
  private readonly files = inject(TeamFilePersistenceService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  async executeNew(name: string, prompt: string, type: StructDefinition['type'] = 'hybrid'): Promise<CommandResult<StructDefinition>> {
    const structName = name.trim();
    const structPrompt = prompt.trim();
    if (!structName || !structPrompt) {
      return {
        ok: false,
        command: '/team-struct new',
        message: '缺少结构英文名称或提示词',
        errors: ['用法：/team-struct new <struct-name> <struct-prompt>'],
      };
    }

    await this.registry.refreshFromFiles();
    const slug = slugify(structName);
    if (this.registry.exists(slug) || this.registry.existsByName(structName)) {
      return {
        ok: false,
        command: '/team-struct new',
        message: `协作结构 "${structName}" 已存在`,
        errors: [`协作结构 "${structName}" 已存在`],
      };
    }

    const roles = this.inferRolesFromDescription(structPrompt);
    const stages = this.buildStages(structPrompt, roles, type);
    const struct: StructDefinition = {
      name: structName,
      slug,
      type,
      description: structPrompt,
      roles,
      stages,
      handoffRules: ['前一阶段完成后自动切换到下一阶段', '如遇阻塞，升级到协作模式'],
      communicationRules: ['subagent 阶段不共享上下文', 'agent-team 阶段共享任务列表和邮箱'],
      completionCriteria: ['所有阶段任务完成', '无阻塞项'],
      failurePolicy: '逐级升级，最终回退到协作排查',
      status: 'draft',
      filePath: `${TEAM_FILE_PATHS.structs}/${slug}.md`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const validation = this.registry.validate(struct);
    if (!validation.valid) {
      return {
        ok: false,
        command: '/team-struct new',
        message: `协作结构创建失败：${validation.errors.join('; ')}`,
        errors: validation.errors,
      };
    }

    const roleValidation = this.registry.validateRoles(struct.roles);
    if (!roleValidation.valid) {
      return {
        ok: false,
        command: '/team-struct new',
        message: `以下角色未定义：${roleValidation.missing.join(', ')}，请先使用 /team-role new 创建`,
        errors: [`未定义角色：${roleValidation.missing.join(', ')}`],
        warnings: [`提示：可使用 /team-role new "${roleValidation.missing[0]}" 创建缺失角色`],
      };
    }

    const markdown = this.files.structToMarkdown(struct);
    const writeResult = await this.files.writeFile(struct.filePath, markdown);
    if (!writeResult.success) {
      return {
        ok: false,
        command: '/team-struct new',
        message: writeResult.error || '协作结构文件写入失败',
        errors: [writeResult.error || '协作结构文件写入失败'],
      };
    }

    await this.registry.refreshFromFiles();

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_STRUCT_CREATED,
      sessionId: 'team-struct-command',
      source: 'user',
      payload: { struct, filePath: struct.filePath },
    });

    return {
      ok: true,
      command: '/team-struct new',
      message: `协作结构 "${structName}" 创建成功`,
      data: struct,
      createdFiles: [struct.filePath],
      openedFiles: [struct.filePath],
      metadata: {
        markdown,
        filePath: struct.filePath,
        openInEditor: true,
        openScope: 'vault',
        tabKey: `team-struct:${struct.slug}`,
        tabTitle: `Team Struct · ${struct.name}`,
      },
    };
  }

  async executeList(): Promise<CommandResult<StructDefinition[]>> {
    await this.registry.refreshFromFiles();
    const structs = this.registry.list();

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_STRUCT_LISTED,
      sessionId: 'team-struct-command',
      source: 'user',
      payload: {
        structs: structs.map(s => ({
          name: s.name,
          slug: s.slug,
          type: s.type,
          description: s.description,
          roles: s.roles,
          status: s.status,
          updatedAt: s.updatedAt,
        })),
      },
    });

    return {
      ok: true,
      command: '/team-struct list',
      message: `共 ${structs.length} 个协作结构`,
      data: structs,
    };
  }

  async executeInfo(nameOrSlug: string): Promise<CommandResult<StructDefinition>> {
    await this.registry.refreshFromFiles();
    let struct = this.registry.get(slugify(nameOrSlug));
    if (!struct) {
      struct = this.registry.getByName(nameOrSlug);
    }

    if (!struct) {
      return {
        ok: false,
        command: '/team-struct info',
        message: `协作结构 "${nameOrSlug}" 不存在`,
        errors: [`协作结构 "${nameOrSlug}" 不存在`],
      };
    }

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_STRUCT_OPENED,
      sessionId: 'team-struct-command',
      source: 'user',
      payload: { struct, filePath: struct.filePath },
    });

    return {
      ok: true,
      command: '/team-struct info',
      message: `协作结构 "${struct.name}" 详情`,
      data: struct,
      openedFiles: [struct.filePath],
    };
  }

  async executeDelete(name: string): Promise<CommandResult<void>> {
    const structName = name.trim();
    if (!structName) {
      return {
        ok: false,
        command: '/team-struct delete',
        message: '缺少结构英文名称',
        errors: ['用法：/team-struct delete <struct-name>'],
      };
    }

    await this.registry.refreshFromFiles();
    const slug = slugify(structName);
    const struct = this.registry.get(slug) ?? this.registry.getByName(structName);
    if (!struct) {
      return {
        ok: false,
        command: '/team-struct delete',
        message: `未找到协作结构：${structName}`,
        errors: [`未找到协作结构：${structName}`],
      };
    }

    const deleted = await this.files.deleteFile(struct.filePath);
    if (!deleted.success) {
      return {
        ok: false,
        command: '/team-struct delete',
        message: deleted.error || '协作结构删除失败',
        errors: [deleted.error || '协作结构删除失败'],
      };
    }

    await this.registry.refreshFromFiles();
    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_STRUCT_CREATED,
      sessionId: 'team-struct-command',
      source: 'user',
      payload: { struct, filePath: struct.filePath },
    });

    return {
      ok: true,
      command: '/team-struct delete',
      message: `协作结构 "${struct.name}" 已删除`,
    };
  }

  private buildStages(description: string, roles: string[], type: StructDefinition['type']): StructDefinition['stages'] {
    if (type === 'subagent') {
      return [{ name: 'isolated-execution', mode: 'subagent', roles, parallel: true, maxRounds: 1 }];
    }
    if (type === 'agent-team') {
      return [{ name: 'collaborative-work', mode: 'agent-team', roles, maxRounds: 5 }];
    }
    return [
      { name: 'parallel-development', mode: 'subagent', roles, parallel: true, maxRounds: 1 },
      { name: 'integration-collaboration', mode: 'agent-team', roles, maxRounds: 3 },
    ];
  }

  private inferRolesFromDescription(description: string): string[] {
    const roles: string[] = [];

    if (/前端|frontend|ui/i.test(description)) roles.push('frontend-developer');
    if (/后端|backend|api/i.test(description)) roles.push('backend-developer');
    if (/测试|qa|test|验证/i.test(description)) roles.push('qa-engineer');
    if (/架构|architect/i.test(description)) roles.push('architect');
    if (/安全|security/i.test(description)) roles.push('security-reviewer');
    if (/运维|devops/i.test(description)) roles.push('devops');

    if (roles.length === 0) {
      roles.push('frontend-developer', 'backend-developer', 'qa-engineer');
    }

    return roles;
  }
}
