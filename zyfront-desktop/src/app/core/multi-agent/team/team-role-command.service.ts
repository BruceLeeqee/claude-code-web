import { Injectable, inject } from '@angular/core';
import type { RoleDefinition, CommandResult } from './team.types';
import { TEAM_FILE_PATHS, slugify } from './team.types';
import { RoleRegistryService } from './role-registry.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../zyfront-core.providers';
import { AppSettingsService } from '../../app-settings.service';

const ROLE_GENERATION_PROMPT = `你是一个智能体角色定义生成器。根据用户提供的角色名称和描述，生成一个详细的角色定义。

请以 JSON 格式输出，包含以下字段：
{
  "name": "角色名称（英文）",
  "description": "详细的角色描述，包含职责范围和专业能力",
  "prompt": "完整的系统提示词，指导该角色如何工作",
  "capabilities": ["能力标签1", "能力标签2"],
  "constraints": ["约束条件1", "约束条件2"],
  "tools": ["推荐的工具列表"],
  "disallowedTools": ["禁止使用的工具"],
  "model": "推荐的模型"
}

工具可选值：Read, Write, Edit, Grep, Glob, Bash, WebSearch, WebFetch
模型可选值：MiniMax-M2.7, deepseek-v4-pro, abab6.5s-chat, claude-3-5-sonnet-latest

要求：
1. description 要详细，包含该角色的专业领域、工作方式、产出标准
2. prompt 要完整，包含工作流程、质量标准、交付物要求、失败处理方式
3. capabilities 要根据描述推断专业能力标签
4. constraints 要根据角色特点设置合理约束
5. tools 要根据角色需要推荐合适的工具
6. 只输出 JSON，不要输出其他内容`;

function formatDateTime(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

@Injectable({ providedIn: 'root' })
export class TeamRoleCommandService {
  private readonly registry = inject(RoleRegistryService);
  private readonly eventBus = inject(MultiAgentEventBusService);
  private readonly files = inject(TeamFilePersistenceService);
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly appSettings = inject(AppSettingsService);

  async executeNew(name: string, prompt: string, type: RoleDefinition['type'] = 'agent-team'): Promise<CommandResult<RoleDefinition>> {
    const roleName = name.trim();
    const rolePrompt = prompt.trim();
    if (!roleName || !rolePrompt) {
      return {
        ok: false,
        command: '/team-role new',
        message: '缺少角色英文名称或提示词',
        errors: ['用法：/team-role new <role-name> <role-prompt>'],
      };
    }

    const slug = slugify(roleName);
    const filePath = `${TEAM_FILE_PATHS.roles}/${slug}.md`;
    
    this.files.clearCache();
    await this.registry.refreshFromFiles();
    
    const existing = await this.files.readFile(filePath);
    if (existing.exists) {
      return {
        ok: false,
        command: '/team-role new',
        message: `角色文件 "${filePath}" 已存在`,
        errors: [`角色文件已存在，请先删除该文件：/team-role delete ${roleName}`],
      };
    }

    const currentRoles = this.registry.list();
    const duplicate = currentRoles.find((role) => role.slug === slug || role.name === roleName);
    if (duplicate) {
      return {
        ok: false,
        command: '/team-role new',
        message: `角色 "${roleName}" 已存在`,
        errors: [`角色已存在，请先删除：/team-role delete ${roleName}`],
      };
    }

    let role: RoleDefinition;
    const apiKey = this.appSettings.value?.apiKey;
    
    if (apiKey?.trim()) {
      try {
        role = await this.generateRoleWithLLM(roleName, rolePrompt, type, slug, filePath);
      } catch (error) {
        role = this.createBasicRole(roleName, rolePrompt, type, slug, filePath);
      }
    } else {
      role = this.createBasicRole(roleName, rolePrompt, type, slug, filePath);
    }

    const validation = this.registry.validate(role);
    if (!validation.valid) {
      return {
        ok: false,
        command: '/team-role new',
        message: `角色创建失败：${validation.errors.join('; ')}`,
        errors: validation.errors,
      };
    }

    const writeResult = await this.files.writeRole(role);
    if (!writeResult.success) {
      return {
        ok: false,
        command: '/team-role new',
        message: writeResult.error || '角色文件写入失败',
        errors: [writeResult.error || '角色文件写入失败'],
      };
    }

    await this.registry.refreshFromFiles();

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_ROLE_CREATED,
      sessionId: 'team-role-command',
      source: 'user',
      payload: { role, filePath: role.filePath },
    });

    return {
      ok: true,
      command: '/team-role new',
      message: `角色 "${roleName}" 创建成功`,
      data: role,
      createdFiles: [role.filePath],
      openedFiles: [role.filePath],
      metadata: {
        filePath: role.filePath,
        roleName: role.name,
        roleSlug: role.slug,
        openInEditor: true,
        openScope: 'vault',
      },
    };
  }

  private createBasicRole(
    name: string,
    description: string,
    type: RoleDefinition['type'],
    slug: string,
    filePath: string
  ): RoleDefinition {
    const now = formatDateTime();
    return {
      name,
      slug,
      type,
      description,
      model: 'MiniMax-M2.7',
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      disallowedTools: [],
      permissionMode: 'acceptEdits',
      maxTurns: 40,
      prompt: description,
      capabilities: [],
      constraints: [],
      allowedPaths: [],
      allowedWritePaths: [],
      status: 'draft',
      filePath,
      createdAt: now as unknown as number,
      updatedAt: now as unknown as number,
    };
  }

  private async generateRoleWithLLM(
    name: string,
    userPrompt: string,
    type: RoleDefinition['type'],
    slug: string,
    filePath: string
  ): Promise<RoleDefinition> {
    const fullPrompt = `${ROLE_GENERATION_PROMPT}\n\n角色名称：${name}\n角色描述：${userPrompt}\n角色类型：${type}`;

    const raw = await this.callLLM(fullPrompt);
    const parsed = this.parseRoleJSON(raw);
    const now = formatDateTime();

    return {
      name,
      slug,
      type,
      description: parsed.description || userPrompt,
      model: parsed.model || 'MiniMax-M2.7',
      tools: parsed.tools || ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      disallowedTools: parsed.disallowedTools || [],
      permissionMode: 'acceptEdits',
      maxTurns: 40,
      prompt: parsed.prompt || userPrompt,
      capabilities: parsed.capabilities || [],
      constraints: parsed.constraints || [],
      allowedPaths: [],
      allowedWritePaths: [],
      status: 'draft',
      filePath,
      createdAt: now as unknown as number,
      updatedAt: now as unknown as number,
    };
  }

  private async callLLM(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const { stream, cancel } = this.runtime.assistant.stream('role-generation', {
          userInput: prompt,
          config: this.runtime.client.getModel(),
        });

        const reader = stream.getReader();
        let accumulated = '';
        const timeout = setTimeout(() => {
          cancel();
          reject(new Error('Role generation timeout'));
        }, 30000);

        const readChunk = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                clearTimeout(timeout);
                resolve(accumulated);
                return;
              }
              if (value.type === 'error') {
                clearTimeout(timeout);
                reject(new Error(value.error || 'LLM stream error'));
                return;
              }
              if (value.type === 'delta' && value.textDelta) {
                accumulated += value.textDelta;
              }
            }
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        };

        readChunk();
      } catch (error) {
        reject(error);
      }
    });
  }

  private parseRoleJSON(raw: string): Partial<RoleDefinition> {
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
      }
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);
      return {
        name: parsed.name,
        description: parsed.description,
        prompt: parsed.prompt,
        capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [],
        constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
        tools: Array.isArray(parsed.tools) ? parsed.tools : undefined,
        disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
        model: parsed.model,
      };
    } catch {
      return {};
    }
  }

  async executeList(): Promise<CommandResult<RoleDefinition[]>> {
    const roles = await this.registry.refreshFromFiles().then(() => this.registry.list());
    const renderedList = roles.length > 0
      ? roles.map((role, index) => `${index + 1}. ${this.getDisplayRoleName(role)} (${role.slug})`).join('\n')
      : '（暂无角色）';

    return {
      ok: true,
      command: '/team-role list',
      message: roles.length > 0 ? `共 ${roles.length} 个角色` : '暂无角色',
      data: roles,
      metadata: { renderedList },
    };
  }

  async executeInfo(name: string): Promise<CommandResult<RoleDefinition>> {
    await this.registry.refreshFromFiles();
    const role = this.registry.getByName(name) ?? this.registry.getBySlug(slugify(name));
    if (!role) {
      return {
        ok: false,
        command: '/team-role info',
        message: `未找到角色：${name}`,
        errors: [`未找到角色：${name}`],
      };
    }

    return {
      ok: true,
      command: '/team-role info',
      message: `角色 "${this.getDisplayRoleName(role)}" 信息如下`,
      data: role,
      metadata: { renderedInfo: this.files.roleToMarkdown(role), filePath: role.filePath },
    };
  }

  async executeDelete(name: string): Promise<CommandResult<void>> {
    const roleName = name.trim();
    if (!roleName) {
      return {
        ok: false,
        command: '/team-role delete',
        message: '缺少角色英文名称',
        errors: ['用法：/team-role delete <role-name>'],
      };
    }

    await this.registry.refreshFromFiles();
    const slug = slugify(roleName);
    const role = this.registry.getBySlug(slug) ?? this.registry.getByName(roleName);
    if (!role) {
      return {
        ok: false,
        command: '/team-role delete',
        message: `未找到角色：${roleName}`,
        errors: [`未找到角色：${roleName}`],
      };
    }

    const deleted = await this.files.deleteFile(role.filePath);
    if (!deleted.success) {
      return {
        ok: false,
        command: '/team-role delete',
        message: deleted.error || '角色删除失败',
        errors: [deleted.error || '角色删除失败'],
      };
    }

    await this.registry.refreshFromFiles();
    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_ROLE_CREATED,
      sessionId: 'team-role-command',
      source: 'user',
      payload: { role, filePath: role.filePath },
    });

    return {
      ok: true,
      command: '/team-role delete',
      message: `角色 "${role.name}" 已删除`,
      openedFiles: [],
      createdFiles: [],
    };
  }

  private getDisplayRoleName(role: RoleDefinition): string {
    return role.name;
  }
}
