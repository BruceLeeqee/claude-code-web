import { Injectable, inject, signal } from '@angular/core';
import type { StructDefinition, RoleDefinition, CommandResult, TeamStageDefinition } from './team.types';
import { TEAM_FILE_PATHS, slugify } from './team.types';
import { StructRegistryService } from './struct-registry.service';
import { RoleRegistryService } from './role-registry.service';
import { TeamFilePersistenceService } from './team-file-persistence.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import { CLAUDE_RUNTIME, type ClaudeCoreRuntime } from '../../zyfront-core.providers';
import { AppSettingsService } from '../../app-settings.service';

const ROLE_SEMANTIC_KEYWORDS: Record<string, string[]> = {
  'frontend': ['前端', 'frontend', 'ui', '界面', '组件', 'component', 'react', 'angular', 'vue', '页面', '交互'],
  'backend': ['后端', 'backend', 'api', '服务端', 'server', '接口', '数据库', 'database', 'service'],
  'qa': ['测试', 'qa', 'test', '验证', '质量', '回归', 'bug', '用例', 'quality'],
  'architect': ['架构', 'architect', '设计', '方案', '技术决策', '系统设计', '架构师'],
  'security': ['安全', 'security', '漏洞', '审计', '审查', 'security-reviewer'],
  'devops': ['运维', 'devops', '部署', 'deploy', 'ci', 'cd', '环境', 'infrastructure'],
  'pm': ['产品', 'pm', '需求', 'product', 'manager', '产品经理'],
  'designer': ['设计', 'designer', 'ui设计', 'ux', '交互设计', '视觉'],
};

const EXCLUDED_ROLE_PATTERNS: RegExp[] = [
  /^主智能体$/i,
  /^main.?agent$/i,
  /^用户$/i,
  /^user$/i,
  /^超体$/i,
  /^super.?agent$/i,
  /^lead.?agent$/i,
  /^coordinator$/i,
];

const STRUCT_GENERATION_PROMPT = `你是一个智能体协作结构生成器。根据用户提供的结构名称和描述，生成一个详细的协作结构定义。

注意：主智能体（超体智能体）是系统内置的，不需要作为角色出现在协作结构中。用户也不需要作为角色。

请以 JSON 格式输出，包含以下字段：
{
  "description": "详细的结构描述，包含适用场景和工作流程概述",
  "roles": ["角色slug1", "角色slug2"],
  "stages": [
    {
      "name": "阶段英文名称",
      "mode": "subagent 或 agent-team",
      "roles": ["参与该阶段的角色slug"],
      "parallel": true或false,
      "maxRounds": 数字,
      "trigger": "阶段触发条件",
      "output": "阶段产出物",
      "handoffCondition": "切换到下一阶段的条件",
      "failurePolicy": "retry 或 escalate 或 abort",
      "completionCondition": "阶段完成条件",
      "regressionTest": "回归验证方式"
    }
  ],
  "handoffRules": ["切换规则1", "切换规则2"],
  "communicationRules": ["通信规则1", "通信规则2"],
  "completionCriteria": ["完成标准1", "完成标准2"],
  "failurePolicy": "整体失败策略描述"
}

阶段模式说明：
- subagent：角色独立执行，不共享上下文，适合并行开发、独立验证
- agent-team：角色协作执行，共享任务列表和邮箱，适合集成排障、协作设计

要求：
1. stages 要根据描述推断出合理的阶段编排，包含触发条件、产出物、切换条件
2. 每个阶段的 roles 应该只包含该阶段实际参与的角色（不含主智能体和用户）
3. handoffRules 要描述阶段间切换的具体规则
4. communicationRules 要区分 subagent 和 agent-team 阶段的通信方式
5. completionCriteria 要具体可验证
6. 只输出 JSON，不要输出其他内容`;

const ROLE_GENERATION_PROMPT_FOR_STRUCT = `你是一个智能体角色定义生成器。根据用户提供的角色名称和协作上下文，生成一个详细的角色定义。

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

export interface RoleMapping {
  originalSlug: string;
  mappedSlug: string;
  mappedName: string;
  mappedFilePath: string;
}

export interface PendingStructPlan {
  struct: StructDefinition;
  existingRoles: Array<{ slug: string; name: string; filePath: string }>;
  rolesToCreate: string[];
  rolesReused: string[];
  excludedRoles: string[];
  roleMappings: RoleMapping[];
}

@Injectable({ providedIn: 'root' })
export class TeamStructCommandService {
  private readonly registry = inject(StructRegistryService);
  private readonly roleRegistry = inject(RoleRegistryService);
  private readonly files = inject(TeamFilePersistenceService);
  private readonly eventBus = inject(MultiAgentEventBusService);
  private readonly runtime = inject<ClaudeCoreRuntime>(CLAUDE_RUNTIME);
  private readonly appSettings = inject(AppSettingsService);

  private readonly pendingPlan = signal<PendingStructPlan | null>(null);
  readonly currentPendingPlan = this.pendingPlan.asReadonly();

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

    this.files.clearCache();
    await this.registry.refreshFromFiles();
    await this.roleRegistry.refreshFromFiles();
    const slug = slugify(structName);
    if (this.registry.exists(slug) || this.registry.existsByName(structName)) {
      return {
        ok: false,
        command: '/team-struct new',
        message: `协作结构 "${structName}" 已存在`,
        errors: [`协作结构 "${structName}" 已存在`],
      };
    }

    const apiKey = this.appSettings.value?.apiKey;
    let struct: StructDefinition;

    if (apiKey?.trim()) {
      try {
        struct = await this.generateStructWithLLM(structName, structPrompt, type, slug);
      } catch {
        const roles = this.inferRolesFromDescription(structPrompt);
        const stages = this.buildStages(structPrompt, roles, type);
        struct = this.createBasicStruct(structName, structPrompt, type, slug, roles, stages);
      }
    } else {
      const roles = this.inferRolesFromDescription(structPrompt);
      const stages = this.buildStages(structPrompt, roles, type);
      struct = this.createBasicStruct(structName, structPrompt, type, slug, roles, stages);
    }

    struct.roles = this.filterExcludedRoles(struct.roles);

    struct.stages = struct.stages.map(stage => ({
      ...stage,
      roles: stage.roles && stage.roles.length > 0 ? stage.roles : [...struct.roles],
    }));

    const { existingRoles, rolesToCreate, rolesReused, excludedRoles } = this.classifyRoles(struct.roles);

    const plan: PendingStructPlan = {
      struct,
      existingRoles,
      rolesToCreate,
      rolesReused,
      excludedRoles,
      roleMappings: [],
    };
    this.pendingPlan.set(plan);

    const planLines = this.renderPlan(plan);

    return {
      ok: true,
      command: '/team-struct new',
      message: `协作结构方案已生成，请确认后正式创建`,
      data: struct,
      metadata: {
        confirmationRequired: true,
        structName: struct.name,
        structSlug: struct.slug,
        planText: planLines,
        existingRoles: existingRoles.map(r => r.slug),
        rolesToCreate,
        rolesReused,
        excludedRoles,
      },
    };
  }

  async executeConfirm(nameOrSlug: string): Promise<CommandResult<StructDefinition>> {
    const plan = this.pendingPlan();
    if (!plan) {
      return {
        ok: false,
        command: '/team-struct confirm',
        message: '没有待确认的协作结构方案',
        errors: ['请先使用 /team-struct new 创建方案'],
      };
    }

    const slug = slugify(nameOrSlug);
    if (slug !== plan.struct.slug && nameOrSlug !== plan.struct.name) {
      return {
        ok: false,
        command: '/team-struct confirm',
        message: `待确认的方案是 "${plan.struct.name}"，不是 "${nameOrSlug}"`,
        errors: [`请确认正确的方案：/team-struct confirm ${plan.struct.name}`],
      };
    }

    const struct = plan.struct;
    let generatedRoleFiles: string[] = [];

    await this.roleRegistry.refreshFromFiles();

    if (plan.rolesToCreate.length > 0) {
      const apiKey = this.appSettings.value?.apiKey;
      if (apiKey?.trim()) {
        generatedRoleFiles = await this.generateMissingRoles(
          plan.rolesToCreate,
          struct.description,
        );
        await this.roleRegistry.refreshFromFiles();
      } else {
        for (const roleSlug of plan.rolesToCreate) {
          const fallbackRole = this.createFallbackRole(roleSlug, struct.description);
          const writeResult = await this.files.writeRole(fallbackRole);
          if (writeResult.success) {
            generatedRoleFiles.push(fallbackRole.filePath);
          }
        }
        await this.roleRegistry.refreshFromFiles();
      }
    }

    const reValidation = this.registry.validateRoles(struct.roles);
    if (!reValidation.valid) {
      return {
        ok: false,
        command: '/team-struct confirm',
        message: `角色验证仍失败：${reValidation.missing.join(', ')}`,
        errors: [`未定义角色：${reValidation.missing.join(', ')}`],
      };
    }

    const markdown = this.files.structToMarkdown(struct);
    const writeResult = await this.files.writeFile(struct.filePath, markdown);
    if (!writeResult.success) {
      this.pendingPlan.set(null);
      return {
        ok: false,
        command: '/team-struct confirm',
        message: writeResult.error || '协作结构文件写入失败',
        errors: [writeResult.error || '协作结构文件写入失败'],
      };
    }

    await this.registry.refreshFromFiles();
    this.pendingPlan.set(null);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_STRUCT_CREATED,
      sessionId: 'team-struct-command',
      source: 'user',
      payload: { struct, filePath: struct.filePath },
    });

    const allCreatedFiles = [struct.filePath, ...generatedRoleFiles];

    return {
      ok: true,
      command: '/team-struct confirm',
      message: generatedRoleFiles.length > 0
        ? `协作结构 "${struct.name}" 创建成功，已自动生成 ${generatedRoleFiles.length} 个角色定义文件`
        : `协作结构 "${struct.name}" 创建成功`,
      data: struct,
      createdFiles: allCreatedFiles,
      openedFiles: [struct.filePath],
      metadata: {
        markdown,
        filePath: struct.filePath,
        openInEditor: true,
        openScope: 'vault',
        generatedRoleFiles,
      },
    };
  }

  async executeReject(nameOrSlug: string): Promise<CommandResult<void>> {
    const plan = this.pendingPlan();
    if (!plan) {
      return {
        ok: false,
        command: '/team-struct reject',
        message: '没有待确认的协作结构方案',
        errors: ['无需取消'],
      };
    }

    const structName = plan.struct.name;
    this.pendingPlan.set(null);

    return {
      ok: true,
      command: '/team-struct reject',
      message: `协作结构 "${structName}" 方案已取消`,
    };
  }

  async updatePlanWithUserInput(userInput: string): Promise<CommandResult<StructDefinition>> {
    const plan = this.pendingPlan();
    if (!plan) {
      return {
        ok: false,
        command: '/team-struct update',
        message: '没有待确认的协作结构方案',
        errors: ['请先使用 /team-struct new 创建方案'],
      };
    }

    const apiKey = this.appSettings.value?.apiKey;
    let updatedStruct: StructDefinition;

    if (apiKey?.trim()) {
      try {
        updatedStruct = await this.updateStructWithLLM(plan.struct, userInput);
      } catch {
        updatedStruct = this.applyUserModificationsLocally(plan.struct, userInput);
      }
    } else {
      updatedStruct = this.applyUserModificationsLocally(plan.struct, userInput);
    }

    updatedStruct.roles = this.filterExcludedRoles(updatedStruct.roles);
    updatedStruct.stages = updatedStruct.stages.map(stage => ({
      ...stage,
      roles: stage.roles && stage.roles.length > 0 ? stage.roles : [...updatedStruct.roles],
    }));

    const { existingRoles, rolesToCreate, rolesReused, excludedRoles } = this.classifyRoles(updatedStruct.roles);

    const updatedPlan: PendingStructPlan = {
      struct: updatedStruct,
      existingRoles,
      rolesToCreate,
      rolesReused,
      excludedRoles,
      roleMappings: [],
    };

    this.pendingPlan.set(updatedPlan);
    const planLines = this.renderPlan(updatedPlan);

    return {
      ok: true,
      command: '/team-struct update',
      message: `方案已更新，请确认后正式创建`,
      data: updatedStruct,
      metadata: {
        confirmationRequired: true,
        structName: updatedStruct.name,
        structSlug: updatedStruct.slug,
        planText: planLines,
        existingRoles: existingRoles.map(r => r.slug),
        rolesToCreate,
        rolesReused,
        excludedRoles,
      },
    };
  }

  private async updateStructWithLLM(
    currentStruct: StructDefinition,
    userFeedback: string,
  ): Promise<StructDefinition> {
    const currentStructJSON = JSON.stringify(currentStruct, null, 2);
    const updatePrompt = `你是一个协作结构设计专家。用户有一个协作结构方案，现在用户提出了修改意见。

当前方案（JSON格式）：
\`\`\`json
${currentStructJSON}
\`\`\`

用户的修改意见：
${userFeedback}

请根据用户的修改意见，更新协作结构方案。返回完整的更新后的JSON格式的协作结构定义。

要求：
1. 保持原有的结构名称和slug不变
2. 根据用户的意见调整角色、阶段、切换规则等
3. 如果用户指定了特定的角色文件（如dev-leader.md），请将对应的角色slug更新为指定的文件名（去掉.md后缀）
4. 确保所有阶段都有roles字段
5. 返回完整的JSON，不要省略任何字段

返回格式示例：
{
  "name": "结构名称",
  "slug": "结构slug",
  "type": "hybrid",
  "description": "结构描述",
  "roles": ["role1", "role2"],
  "stages": [
    {
      "name": "阶段名称",
      "mode": "subagent",
      "roles": ["role1"],
      "trigger": "触发条件",
      "output": "产出物",
      "handoffCondition": "切换条件",
      "completionCondition": "完成条件"
    }
  ],
  "handoffRules": ["切换规则1", "切换规则2"],
  "communicationRules": ["通信规则1"],
  "completionCriteria": ["完成标准1"],
  "failurePolicy": "失败策略"
}

只返回JSON，不要有其他文字。`;

    const raw = await this.callLLM(updatePrompt);
    const parsed = this.parseStructJSON(raw);

    return {
      ...currentStruct,
      description: parsed.description || currentStruct.description,
      roles: parsed.roles || currentStruct.roles,
      stages: parsed.stages && parsed.stages.length > 0 ? parsed.stages : currentStruct.stages,
      handoffRules: parsed.handoffRules || currentStruct.handoffRules,
      communicationRules: parsed.communicationRules || currentStruct.communicationRules,
      completionCriteria: parsed.completionCriteria || currentStruct.completionCriteria,
      failurePolicy: parsed.failurePolicy || currentStruct.failurePolicy,
      updatedAt: Date.now(),
    };
  }

  private applyUserModificationsLocally(
    currentStruct: StructDefinition,
    userFeedback: string,
  ): StructDefinition {
    const roleMappingPatterns = [
      /(\S+)\s*使用\s*(\S+\.md)/g,
      /(\S+)\s*用\s*(\S+\.md)/g,
      /(\S+)\s*->\s*(\S+\.md)/g,
      /(\S+)\s*=\s*(\S+\.md)/g,
    ];

    const slugMap = new Map<string, string>();
    const allRoles = currentStruct.roles;

    for (const pattern of roleMappingPatterns) {
      let match;
      while ((match = pattern.exec(userFeedback)) !== null) {
        const roleKeyword = match[1].trim();
        const targetFile = match[2].trim();
        const targetSlug = targetFile.replace(/\.md$/i, '').toLowerCase();

        const originalSlug = this.findRoleSlugByKeyword(roleKeyword, allRoles);
        if (originalSlug) {
          slugMap.set(originalSlug, targetSlug);
        }
      }
    }

    if (slugMap.size === 0) {
      return { ...currentStruct, updatedAt: Date.now() };
    }

    return {
      ...currentStruct,
      roles: currentStruct.roles.map(r => slugMap.get(r) || r),
      stages: currentStruct.stages.map(stage => ({
        ...stage,
        roles: stage.roles.map(r => slugMap.get(r) || r),
      })),
      updatedAt: Date.now(),
    };
  }

  private parseRoleMappings(input: string, plan: PendingStructPlan): RoleMapping[] {
    const mappings: RoleMapping[] = [];
    const allRoles = plan.struct.roles;

    const patterns = [
      /(\S+)\s*使用\s*(\S+\.md)/g,
      /(\S+)\s*用\s*(\S+\.md)/g,
      /(\S+)\s*->\s*(\S+\.md)/g,
      /(\S+)\s*=\s*(\S+\.md)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const roleKeyword = match[1].trim();
        const targetFile = match[2].trim();

        const originalSlug = this.findRoleSlugByKeyword(roleKeyword, allRoles);
        if (!originalSlug) continue;

        const targetSlug = targetFile.replace(/\.md$/i, '').toLowerCase();
        const existingRole = this.roleRegistry.getBySlug(targetSlug) || this.roleRegistry.getByName(targetSlug);

        if (existingRole) {
          mappings.push({
            originalSlug,
            mappedSlug: existingRole.slug,
            mappedName: existingRole.name,
            mappedFilePath: existingRole.filePath,
          });
        } else {
          mappings.push({
            originalSlug,
            mappedSlug: targetSlug,
            mappedName: targetSlug,
            mappedFilePath: `03-AGENT-TOOLS/03-Roles/${targetFile}`,
          });
        }
      }
    }

    return mappings;
  }

  private findRoleSlugByKeyword(keyword: string, allRoles: string[]): string | null {
    const keywordLower = keyword.toLowerCase();

    const exactMatch = allRoles.find(r => r.toLowerCase() === keywordLower);
    if (exactMatch) return exactMatch;

    const partialMatch = allRoles.find(r =>
      r.toLowerCase().includes(keywordLower) ||
      keywordLower.includes(r.toLowerCase())
    );
    if (partialMatch) return partialMatch;

    const semanticMap: Record<string, string[]> = {
      'architect': ['架构师', '架构', 'architect'],
      'frontend': ['前端', 'frontend', 'fe'],
      'backend': ['后端', 'backend', 'be'],
      'qa': ['测试', 'qa', 'test', 'tester'],
      'dev': ['开发', 'dev', 'developer'],
      'leader': ['领导', 'leader', 'lead'],
    };

    for (const [slug, keywords] of Object.entries(semanticMap)) {
      if (keywords.some(k => keywordLower.includes(k) || k.includes(keywordLower))) {
        if (allRoles.includes(slug)) return slug;
      }
    }

    return null;
  }

  private applyRoleMappings(plan: PendingStructPlan): void {
    const { struct, roleMappings } = plan;
    if (roleMappings.length === 0) return;

    const slugMap = new Map<string, string>();
    for (const mapping of roleMappings) {
      slugMap.set(mapping.originalSlug, mapping.mappedSlug);
    }

    struct.roles = struct.roles.map(r => slugMap.get(r) || r);

    struct.stages = struct.stages.map(stage => ({
      ...stage,
      roles: stage.roles.map(r => slugMap.get(r) || r),
    }));
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

  private filterExcludedRoles(roles: string[]): string[] {
    return roles.filter(role => {
      const slugLower = role.toLowerCase();
      return !EXCLUDED_ROLE_PATTERNS.some(pattern => pattern.test(slugLower));
    });
  }

  private classifyRoles(structRoles: string[]): {
    existingRoles: Array<{ slug: string; name: string; filePath: string }>;
    rolesToCreate: string[];
    rolesReused: string[];
    excludedRoles: string[];
  } {
    const registeredRoles = this.roleRegistry.roleList();
    const existingRoles: Array<{ slug: string; name: string; filePath: string }> = [];
    const rolesToCreate: string[] = [];
    const rolesReused: string[] = [];

    for (const roleSlug of structRoles) {
      const exactMatch = registeredRoles.find(r => r.slug === roleSlug);
      if (exactMatch) {
        existingRoles.push({ slug: exactMatch.slug, name: exactMatch.name, filePath: exactMatch.filePath });
        rolesReused.push(roleSlug);
        continue;
      }

      const nameMatch = registeredRoles.find(r => r.name.toLowerCase() === roleSlug.toLowerCase());
      if (nameMatch) {
        existingRoles.push({ slug: nameMatch.slug, name: nameMatch.name, filePath: nameMatch.filePath });
        rolesReused.push(roleSlug);
        continue;
      }

      const semanticMatch = registeredRoles.find(r => {
        const rLower = r.slug.toLowerCase();
        const nameLower = r.name.toLowerCase();
        const descLower = (r.description ?? '').toLowerCase();
        const keywordSets = Object.values(ROLE_SEMANTIC_KEYWORDS);
        const roleKeywords = keywordSets.find(keywords =>
          keywords.some(kw => kw.toLowerCase() === roleSlug.toLowerCase() || roleSlug.toLowerCase().includes(kw.toLowerCase()))
        );
        if (!roleKeywords) return false;
        return roleKeywords.some(kw =>
          rLower.includes(kw.toLowerCase()) ||
          nameLower.includes(kw.toLowerCase()) ||
          descLower.includes(kw.toLowerCase())
        );
      });

      if (semanticMatch) {
        existingRoles.push({ slug: semanticMatch.slug, name: semanticMatch.name, filePath: semanticMatch.filePath });
        rolesReused.push(roleSlug);
      } else {
        rolesToCreate.push(roleSlug);
      }
    }

    return { existingRoles, rolesToCreate, rolesReused, excludedRoles: [] };
  }

  private renderPlan(plan: PendingStructPlan): string {
    const lines: string[] = [];
    const s = plan.struct;

    lines.push(`**协作结构方案：${s.name}**`);
    lines.push('');
    lines.push(`📋 **描述**：${s.description}`);
    lines.push(`📌 **类型**：${s.type}`);
    lines.push('');

    lines.push('👥 **角色分配**：');
    if (plan.roleMappings && plan.roleMappings.length > 0) {
      lines.push('  🔄 **角色映射**：');
      plan.roleMappings.forEach(m => {
        lines.push(`     ${m.originalSlug} → ${m.mappedName} (${m.mappedSlug})`);
      });
      lines.push('');
    }
    if (plan.rolesReused.length > 0) {
      const reusedNames = plan.existingRoles
        .filter(r => plan.rolesReused.includes(r.slug))
        .map(r => `${r.name} (${r.slug})`)
        .join('、');
      lines.push(`  ✅ 复用已有角色：${reusedNames}`);
    }
    if (plan.rolesToCreate.length > 0) {
      lines.push(`  🆕 需新建角色：${plan.rolesToCreate.join('、')}`);
      lines.push('');
      lines.push('  **缺失角色确认**：');
      plan.rolesToCreate.forEach((roleSlug, i) => {
        const semanticInfo = this.findSemanticInfo(roleSlug);
        const displayName = semanticInfo?.displayName || roleSlug;
        const description = semanticInfo?.description || '将根据协作上下文自动生成';
        lines.push(`  ${i + 1}. **${roleSlug}** (${displayName})`);
        lines.push(`     ${description}`);
      });
      lines.push('');
      lines.push('  💡 可直接输入角色映射指令，如："架构师使用dev-leader.md"');
    }
    lines.push('');

    lines.push('🔄 **阶段编排**：');
    s.stages.forEach((stage, i) => {
      const modeLabel = stage.mode === 'subagent' ? '独立执行' : '协作执行';
      const parallelLabel = stage.parallel ? '（并行）' : '';
      lines.push(`  ${i + 1}. **${stage.name}** [${modeLabel}${parallelLabel}]`);
      lines.push(`     角色：${stage.roles.join(', ')}`);
      if (stage.trigger) lines.push(`     触发：${stage.trigger}`);
      if (stage.output) lines.push(`     产出：${stage.output}`);
      if (stage.handoffCondition) lines.push(`     切换条件：${stage.handoffCondition}`);
      if (stage.completionCondition) lines.push(`     完成条件：${stage.completionCondition}`);
    });

    if (s.handoffRules && s.handoffRules.length > 0) {
      lines.push('');
      lines.push('🔀 **切换规则**：');
      s.handoffRules.forEach(r => lines.push(`  - ${r}`));
    }

    if (s.completionCriteria && s.completionCriteria.length > 0) {
      lines.push('');
      lines.push('✅ **完成标准**：');
      s.completionCriteria.forEach(c => lines.push(`  - ${c}`));
    }

    lines.push('');
    lines.push('---');
    if (plan.rolesToCreate.length > 0) {
      lines.push(`将自动创建 ${plan.rolesToCreate.length} 个缺失角色。`);
    }
    lines.push('输入 **"确认"** 正式创建，输入 **"取消"** 放弃方案。');
    lines.push('也可输入补充指令优化方案，如："架构师使用dev-leader.md" 或 "测试员使用dev-test.md"');

    return lines.join('\n');
  }

  private createBasicStruct(
    name: string,
    description: string,
    type: StructDefinition['type'],
    slug: string,
    roles: string[],
    stages: TeamStageDefinition[],
  ): StructDefinition {
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private async generateStructWithLLM(
    name: string,
    userPrompt: string,
    type: StructDefinition['type'],
    slug: string,
  ): Promise<StructDefinition> {
    const roles = this.inferRolesFromDescription(userPrompt);
    const fullPrompt = `${STRUCT_GENERATION_PROMPT}\n\n结构名称：${name}\n结构描述：${userPrompt}\n结构类型：${type}\n推断角色：${roles.join(', ')}`;

    const raw = await this.callLLM(fullPrompt);
    const parsed = this.parseStructJSON(raw);

    const stages: TeamStageDefinition[] = (parsed.stages && parsed.stages.length > 0)
      ? parsed.stages
      : this.buildStages(userPrompt, roles, type);

    return {
      name,
      slug,
      type,
      description: parsed.description || userPrompt,
      roles: parsed.roles || roles,
      stages,
      handoffRules: parsed.handoffRules || ['前一阶段完成后自动切换到下一阶段', '如遇阻塞，升级到协作模式'],
      communicationRules: parsed.communicationRules || ['subagent 阶段不共享上下文', 'agent-team 阶段共享任务列表和邮箱'],
      completionCriteria: parsed.completionCriteria || ['所有阶段任务完成', '无阻塞项'],
      failurePolicy: parsed.failurePolicy || '逐级升级，最终回退到协作排查',
      status: 'draft',
      filePath: `${TEAM_FILE_PATHS.structs}/${slug}.md`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private async generateMissingRoles(
    missingRoles: string[],
    structPrompt: string,
  ): Promise<string[]> {
    const generatedFiles: string[] = [];

    for (const roleSlug of missingRoles) {
      try {
        const semanticInfo = this.findSemanticInfo(roleSlug);
        const roleName = semanticInfo?.displayName || roleSlug;
        const roleContext = `该角色将参与协作结构，结构描述：${structPrompt}`;

        const role = await this.generateRoleWithLLM(roleName, roleSlug, roleContext);
        const validation = this.roleRegistry.validate(role);
        if (!validation.valid) continue;

        const writeResult = await this.files.writeRole(role);
        if (writeResult.success) {
          generatedFiles.push(role.filePath);
          this.eventBus.emit({
            type: EVENT_TYPES.TEAM_ROLE_CREATED,
            sessionId: 'team-struct-command',
            source: 'system',
            payload: { role, filePath: role.filePath, autoGenerated: true },
          });
        }
      } catch {
        const fallbackRole = this.createFallbackRole(roleSlug, structPrompt);
        const writeResult = await this.files.writeRole(fallbackRole);
        if (writeResult.success) {
          generatedFiles.push(fallbackRole.filePath);
        }
      }
    }

    return generatedFiles;
  }

  private async generateRoleWithLLM(
    name: string,
    roleSlug: string,
    context: string,
  ): Promise<RoleDefinition> {
    const fullPrompt = `${ROLE_GENERATION_PROMPT_FOR_STRUCT}\n\n角色名称：${name}\n角色上下文：${context}`;

    const raw = await this.callLLM(fullPrompt);
    const parsed = this.parseRoleJSON(raw);
    const now = formatDateTime();
    const filePath = `${TEAM_FILE_PATHS.roles}/${roleSlug}.md`;

    return {
      name,
      slug: roleSlug,
      type: 'agent-team',
      description: parsed.description || context,
      model: parsed.model || 'MiniMax-M2.7',
      tools: parsed.tools || ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      disallowedTools: parsed.disallowedTools || [],
      permissionMode: 'acceptEdits',
      maxTurns: 40,
      prompt: parsed.prompt || context,
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

  private createFallbackRole(roleSlug: string, structPrompt: string): RoleDefinition {
    const semanticInfo = this.findSemanticInfo(roleSlug);
    const name = semanticInfo?.displayName || roleSlug;
    const description = semanticInfo?.description || `参与协作结构的${name}角色`;
    const now = formatDateTime();
    const filePath = `${TEAM_FILE_PATHS.roles}/${roleSlug}.md`;

    return {
      name,
      slug: roleSlug,
      type: 'agent-team',
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

  private findSemanticInfo(roleSlug: string): { displayName: string; description: string } | null {
    for (const [semanticKey, keywords] of Object.entries(ROLE_SEMANTIC_KEYWORDS)) {
      if (semanticKey === roleSlug || keywords.some(kw => roleSlug.includes(kw.toLowerCase()))) {
        const displayNames: Record<string, string> = {
          'frontend': 'Frontend Developer',
          'backend': 'Backend Developer',
          'qa': 'QA Engineer',
          'architect': 'Architect',
          'security': 'Security Reviewer',
          'devops': 'DevOps Engineer',
          'pm': 'Product Manager',
          'designer': 'Designer',
        };
        const descriptions: Record<string, string> = {
          'frontend': '负责实现UI组件、界面交互和前端状态管理的专家',
          'backend': '负责后端服务、API实现和数据库交互的专家',
          'qa': '负责测试用例设计、质量验证和回归测试的专家',
          'architect': '负责系统架构设计、技术决策和任务协调的专家',
          'security': '负责安全审查、漏洞检测和安全策略评估的专家',
          'devops': '负责部署配置、CI/CD和环境管理的专家',
          'pm': '负责需求分析、产品规划和优先级排序的专家',
          'designer': '负责UI/UX设计、交互设计和视觉规范的专家',
        };
        return {
          displayName: displayNames[semanticKey] || semanticKey,
          description: descriptions[semanticKey] || '',
        };
      }
    }
    return null;
  }

  private async callLLM(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const { stream, cancel } = this.runtime.assistant.stream('struct-generation', {
          userInput: prompt,
          config: this.runtime.client.getModel(),
        });

        const reader = stream.getReader();
        let accumulated = '';
        const timeout = setTimeout(() => {
          cancel();
          reject(new Error('Struct generation timeout'));
        }, 60000);

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

  private parseStructJSON(raw: string): Partial<StructDefinition> {
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
        description: parsed.description,
        roles: Array.isArray(parsed.roles) ? parsed.roles : undefined,
        stages: Array.isArray(parsed.stages) ? parsed.stages.map((s: any) => ({
          name: s.name || 'unnamed-stage',
          mode: s.mode === 'subagent' ? 'subagent' : 'agent-team',
          roles: Array.isArray(s.roles) ? s.roles : [],
          parallel: s.parallel ?? false,
          trigger: s.trigger,
          maxRounds: s.maxRounds,
          output: s.output,
          handoffCondition: s.handoffCondition,
          failurePolicy: s.failurePolicy || 'retry',
          completionCondition: s.completionCondition,
          regressionTest: s.regressionTest,
        })) : undefined,
        handoffRules: Array.isArray(parsed.handoffRules) ? parsed.handoffRules : undefined,
        communicationRules: Array.isArray(parsed.communicationRules) ? parsed.communicationRules : undefined,
        completionCriteria: Array.isArray(parsed.completionCriteria) ? parsed.completionCriteria : undefined,
        failurePolicy: parsed.failurePolicy,
      };
    } catch {
      return {};
    }
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
    const matchedRoles: string[] = [];
    const registeredRoles = this.roleRegistry.roleList();

    for (const [semanticKey, keywords] of Object.entries(ROLE_SEMANTIC_KEYWORDS)) {
      const keywordHit = keywords.some(kw => description.toLowerCase().includes(kw.toLowerCase()));
      if (!keywordHit) continue;

      if (EXCLUDED_ROLE_PATTERNS.some(pattern => pattern.test(semanticKey))) continue;

      const matched = registeredRoles.find(role => {
        const nameLower = role.name.toLowerCase();
        const descLower = (role.description ?? '').toLowerCase();
        const slugLower = role.slug.toLowerCase();
        const semanticKeywords = ROLE_SEMANTIC_KEYWORDS[semanticKey] ?? [];
        return semanticKeywords.some(kw =>
          nameLower.includes(kw.toLowerCase()) ||
          descLower.includes(kw.toLowerCase()) ||
          slugLower.includes(kw.toLowerCase()) ||
          slugLower.includes(semanticKey.toLowerCase())
        );
      });

      if (matched) {
        if (!matchedRoles.includes(matched.slug)) {
          matchedRoles.push(matched.slug);
        }
      } else {
        if (!matchedRoles.includes(semanticKey)) {
          matchedRoles.push(semanticKey);
        }
      }
    }

    if (matchedRoles.length === 0) {
      for (const role of registeredRoles.slice(0, 3)) {
        if (!matchedRoles.includes(role.slug)) {
          matchedRoles.push(role.slug);
        }
      }
      if (matchedRoles.length === 0) {
        matchedRoles.push('frontend-developer', 'backend-developer', 'qa-engineer');
      }
    }

    return matchedRoles;
  }
}
