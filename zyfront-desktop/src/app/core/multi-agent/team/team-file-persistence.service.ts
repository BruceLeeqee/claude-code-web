import { Injectable, inject, signal, computed } from '@angular/core';
import { TEAM_FILE_PATHS } from './team.types';
import type { RoleDefinition, StructDefinition, TeamRuntimeState } from './team.types';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import { LocalBridgeService } from '../../local-bridge.service';

export interface FrontmatterData {
  [key: string]: unknown;
}

export interface ParsedFrontmatterFile {
  frontmatter: FrontmatterData;
  body: string;
  raw: string;
}

export interface FileWriteResult {
  path: string;
  success: boolean;
  error?: string;
}

export interface FileReadResult {
  path: string;
  content: string | null;
  exists: boolean;
  error?: string;
}

export interface DirectoryScanResult {
  path: string;
  files: string[];
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class TeamFilePersistenceService {
  private readonly eventBus = inject(MultiAgentEventBusService);
  private readonly bridge = inject(LocalBridgeService);

  private readonly fileCache = signal<Map<string, string>>(new Map());
  private readonly dirtyFiles = signal<Set<string>>(new Set());

  readonly cachedFiles = computed(() => this.fileCache().size);
  readonly hasDirtyFiles = computed(() => this.dirtyFiles().size > 0);

  parseFrontmatter(content: string): ParsedFrontmatterFile {
    const trimmed = content.trim();
    const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = trimmed.match(fmRegex);

    if (!match) {
      return { frontmatter: {}, body: trimmed, raw: content };
    }

    const frontmatterStr = match[1];
    const body = match[2] || '';
    const frontmatter: FrontmatterData = {};

    const lines = frontmatterStr.split(/\r?\n/);
    let i = 0;

    const parseValue = (val: string): unknown => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      if (/^-?\d+$/.test(val)) return parseInt(val, 10);
      if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
      if (val.startsWith('[') && val.endsWith(']')) {
        const inner = val.slice(1, -1).trim();
        if (inner === '') return [];
        try {
          return JSON.parse(val);
        } catch {
          return inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        }
      }
      return val.replace(/^['"]|['"]$/g, '');
    };

    const parseObjectArray = (startIndent: number): Record<string, unknown>[] => {
      const result: Record<string, unknown>[] = [];
      let currentObj: Record<string, unknown> | null = null;

      while (i < lines.length) {
        const line = lines[i];
        const lineIndent = line.search(/\S|$/);
        const trimmedLine = line.trim();

        if (lineIndent < startIndent || trimmedLine === '') {
          if (currentObj) {
            result.push(currentObj);
            currentObj = null;
          }
          if (trimmedLine === '' && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nextIndent = nextLine.search(/\S|$/);
            if (nextIndent < startIndent) break;
          }
          if (lineIndent < startIndent) break;
          i++;
          continue;
        }

        if (trimmedLine.startsWith('-') && (trimmedLine[1] === ' ' || trimmedLine[1] === '\t' || trimmedLine.length === 1)) {
          if (currentObj) {
            result.push(currentObj);
          }
          currentObj = {};
          const afterDash = trimmedLine.substring(1).trim();
          if (afterDash && afterDash.includes(':')) {
            const colonIdx = afterDash.indexOf(':');
            const k = afterDash.substring(0, colonIdx).trim();
            const v = afterDash.substring(colonIdx + 1).trim();
            if (v) {
              currentObj[k] = parseValue(v);
            }
          }
          i++;
          continue;
        }

        if (trimmedLine.includes(':') && currentObj !== null) {
          const colonIdx = trimmedLine.indexOf(':');
          const k = trimmedLine.substring(0, colonIdx).trim();
          const v = trimmedLine.substring(colonIdx + 1).trim();
          if (v) {
            currentObj[k] = parseValue(v);
          }
          i++;
          continue;
        }

        break;
      }

      if (currentObj) {
        result.push(currentObj);
      }

      return result;
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine === '' || !trimmedLine.includes(':')) {
        i++;
        continue;
      }

      const lineIndent = line.search(/\S|$/);
      const colonIdx = trimmedLine.indexOf(':');
      const key = trimmedLine.substring(0, colonIdx).trim();
      const value = trimmedLine.substring(colonIdx + 1).trim();

      if (value === '') {
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextIndent = nextLine.search(/\S|$/);
          const nextTrimmed = nextLine.trim();

          if (nextTrimmed.startsWith('-')) {
            const afterDash = nextTrimmed.length > 1 ? nextTrimmed.substring(1).trim() : '';
            const isObjectArrayStart = afterDash === '' || afterDash.includes(':');
            
            if (isObjectArrayStart) {
              if (afterDash === '' && i + 2 < lines.length) {
                const afterDashLine = lines[i + 2];
                const afterDashIndent = afterDashLine.search(/\S|$/);
                const afterDashTrimmed = afterDashLine.trim();
                if (afterDashIndent > nextIndent && afterDashTrimmed.includes(':')) {
                  i++;
                  frontmatter[key] = parseObjectArray(nextIndent);
                  continue;
                }
              } else if (afterDash.includes(':')) {
                i++;
                frontmatter[key] = parseObjectArray(nextIndent);
                continue;
              }
            }
            i++;
            const arr: string[] = [];
            while (i < lines.length) {
              const arrLine = lines[i].trim();
              if (arrLine.startsWith('- ')) {
                const itemAfterDash = arrLine.substring(2).trim();
                if (itemAfterDash.includes(':')) {
                  i--;
                  break;
                }
                arr.push(itemAfterDash);
                i++;
              } else if (arrLine === '-') {
                i++;
              } else if (arrLine === '') {
                i++;
              } else {
                break;
              }
            }
            if (arr.length > 0) {
              frontmatter[key] = arr;
            } else {
              i--;
            }
            continue;
          }

          if (nextTrimmed.includes(':') && !nextTrimmed.startsWith('-')) {
            i++;
            const nestedObj: FrontmatterData = {};
            while (i < lines.length) {
              const nestedLine = lines[i];
              const nestedIndent = nestedLine.search(/\S|$/);
              if (nestedIndent <= lineIndent) break;
              const nestedTrimmed = nestedLine.trim();
              if (nestedTrimmed === '' || !nestedTrimmed.includes(':')) {
                i++;
                continue;
              }
              const nColonIdx = nestedTrimmed.indexOf(':');
              const nk = nestedTrimmed.substring(0, nColonIdx).trim();
              const nv = nestedTrimmed.substring(nColonIdx + 1).trim();
              nestedObj[nk] = parseValue(nv);
              i++;
            }
            frontmatter[key] = nestedObj;
            continue;
          }
        }
        frontmatter[key] = [];
        i++;
        continue;
      }

      frontmatter[key] = parseValue(value);
      i++;
    }

    return { frontmatter, body, raw: content };
  }

  serializeFrontmatter(frontmatter: FrontmatterData, body: string = ''): string {
    const lines: string[] = ['---'];

    const serializeScalar = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean' || typeof v === 'number') return String(v);
      if (typeof v === 'string') {
        if (v.includes(':') || v.includes('#') || v.includes('\n') || v.includes('"') || v.includes("'")) {
          return `"${v.replace(/"/g, '\\"')}"`;
        }
        return v;
      }
      return JSON.stringify(v);
    };

    const serializeArrayItem = (item: unknown, baseIndent: number): string[] => {
      const result: string[] = [];
      const indent = '  '.repeat(baseIndent);

      if (item === null || item === undefined) {
        result.push(`${indent}- null`);
      } else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        result.push(`${indent}- ${serializeScalar(item)}`);
      } else if (Array.isArray(item)) {
        if (item.length === 0) {
          result.push(`${indent}- []`);
        } else if (item.every(x => typeof x === 'string' && !x.includes(':'))) {
          result.push(`${indent}- [${(item as string[]).join(', ')}]`);
        } else {
          result.push(`${indent}-`);
          item.forEach(subItem => {
            result.push(...serializeArrayItem(subItem, baseIndent + 1));
          });
        }
      } else if (typeof item === 'object') {
        const entries = Object.entries(item as Record<string, unknown>).filter(([_, v]) => v !== undefined);
        if (entries.length === 0) {
          result.push(`${indent}- {}`);
        } else {
          result.push(`${indent}-`);
          entries.forEach(([k, v]) => {
            const keyIndent = '  '.repeat(baseIndent + 1);
            if (v === null || v === undefined) {
              // skip
            } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              result.push(`${keyIndent}${k}: ${serializeScalar(v)}`);
            } else if (Array.isArray(v)) {
              if (v.length === 0) {
                result.push(`${keyIndent}${k}: []`);
              } else if (v.every(x => typeof x === 'string' && !x.includes(':'))) {
                result.push(`${keyIndent}${k}: [${(v as string[]).join(', ')}]`);
              } else {
                result.push(`${keyIndent}${k}:`);
                v.forEach(subItem => {
                  result.push(...serializeArrayItem(subItem, baseIndent + 2));
                });
              }
            } else if (typeof v === 'object') {
              result.push(`${keyIndent}${k}:`);
              const subEntries = Object.entries(v as Record<string, unknown>).filter(([_, sv]) => sv !== undefined);
              subEntries.forEach(([sk, sv]) => {
                const subIndent = '  '.repeat(baseIndent + 2);
                result.push(`${subIndent}${sk}: ${serializeScalar(sv)}`);
              });
            }
          });
        }
      }
      return result;
    };

    for (const [key, value] of Object.entries(frontmatter)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${key}: []`);
        } else if (value.every(v => typeof v === 'string' && v.length < 30 && !v.includes(':'))) {
          lines.push(`${key}: [${(value as string[]).join(', ')}]`);
        } else {
          lines.push(`${key}:`);
          value.forEach(item => {
            lines.push(...serializeArrayItem(item, 1));
          });
        }
        continue;
      }

      if (typeof value === 'object' && !Array.isArray(value)) {
        lines.push(`${key}:`);
        for (const [sk, sv] of Object.entries(value as FrontmatterData)) {
          if (sv !== undefined && sv !== null) {
            lines.push(`  ${sk}: ${serializeScalar(sv)}`);
          }
        }
        continue;
      }

      if (typeof value === 'string') {
        lines.push(`${key}: ${serializeScalar(value)}`);
        continue;
      }

      lines.push(`${key}: ${serializeScalar(value)}`);
    }

    lines.push('---');
    if (body) {
      lines.push('');
      lines.push(body);
    }

    return lines.join('\n');
  }

  roleToMarkdown(role: RoleDefinition): string {
    const fm: FrontmatterData = {
      name: role.name,
      slug: role.slug,
      type: role.type,
      description: role.description,
      model: role.model || 'default',
      tools: role.tools,
      disallowedTools: role.disallowedTools || [],
      permissionMode: role.permissionMode || 'acceptEdits',
      maxTurns: role.maxTurns || 40,
      status: role.status,
      capabilities: role.capabilities || [],
      constraints: role.constraints || [],
      allowedPaths: role.allowedPaths || [],
      allowedWritePaths: role.allowedWritePaths || [],
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };

    const body = [
      `# ${role.name}`,
      '',
      '## 角色定义',
      role.description,
      '',
      '## 职责范围',
      ...(role.capabilities || []).map(c => `- ${c}`),
      '',
      '## 工具权限',
      `- 可用工具：${role.tools.join(', ')}`,
      role.disallowedTools && role.disallowedTools.length > 0
        ? `- 禁用工具：${role.disallowedTools.join(', ')}`
        : '- 禁用工具：（无）',
      '',
      '## 工作流',
      '1. 接收任务并确认理解',
      '2. 分析需求，制定实施计划',
      '3. 按计划执行实现，逐步推进',
      '4. 自我验证结果，确保质量',
      '5. 回传摘要，包括变更文件列表和关键决策',
      '',
      '## 质量标准',
      '- 代码符合项目规范和风格指南',
      '- 关键逻辑有测试覆盖',
      '- 变更文件列表清晰完整',
      '- 无未处理的 lint 错误',
      '- 遵循最小变更原则',
      '',
      '## 交付物',
      '- 实现代码（含必要注释）',
      '- 测试用例（如适用）',
      '- 变更摘要（含文件列表和关键决策说明）',
      '',
      '## 失败处理',
      '- 遇到阻塞时：回传阻塞原因、已尝试方案和建议下一步',
      '- 超过 maxTurns 时：输出当前进度、未完成项和继续建议',
      '- 依赖缺失时：明确说明缺失依赖和获取方式',
      '',
      '## 约束',
      ...(role.constraints || []).map(c => `- ${c}`),
      '- 不得修改超出 allowedWritePaths 范围的文件',
      '- 不得使用 disallowedTools 中列出的工具',
      '- 每次变更后必须验证结果',
    ].join('\n');

    return this.serializeFrontmatter(fm, body);
  }

  markdownToRole(content: string, filePath: string): RoleDefinition | null {
    const parsed = this.parseFrontmatter(content);
    const fm = parsed.frontmatter;
    
    console.log('[TeamFilePersistence] markdownToRole:', { 
      filePath, 
      hasName: !!fm['name'], 
      frontmatterKeys: Object.keys(fm),
      bodyLength: parsed.body.length 
    });

    if (!fm['name']) {
      console.warn('[TeamFilePersistence] markdownToRole: missing name in frontmatter:', filePath);
      return null;
    }

    const slugFromPath = filePath.split('/').pop()?.replace(/\.md$/i, '') || '';

    const ensureArray = <T>(value: unknown): T[] => {
      if (Array.isArray(value)) return value as T[];
      return [];
    };

    return {
      name: fm['name'] as string,
      slug: (fm['slug'] as string) || slugFromPath,
      type: (fm['type'] as RoleDefinition['type']) || 'agent-team',
      description: (fm['description'] as string) || '',
      model: fm['model'] as string | undefined,
      tools: ensureArray<string>(fm['tools']),
      disallowedTools: ensureArray<string>(fm['disallowedTools']),
      permissionMode: fm['permissionMode'] as string | undefined,
      maxTurns: fm['maxTurns'] as number | undefined,
      prompt: (fm['description'] as string) || '',
      capabilities: ensureArray<string>(fm['capabilities']),
      constraints: ensureArray<string>(fm['constraints']),
      allowedPaths: ensureArray<string>(fm['allowedPaths']),
      allowedWritePaths: ensureArray<string>(fm['allowedWritePaths']),
      status: (fm['status'] as RoleDefinition['status']) || 'draft',
      filePath,
      createdAt: (fm['createdAt'] as number) || Date.now(),
      updatedAt: (fm['updatedAt'] as number) || Date.now(),
    };
  }

  structToMarkdown(struct: StructDefinition): string {
    const fm: FrontmatterData = {
      name: struct.name,
      slug: struct.slug,
      type: struct.type,
      description: struct.description,
      roles: struct.roles,
      stages: struct.stages,
      handoffRules: struct.handoffRules || [],
      communicationRules: struct.communicationRules || [],
      completionCriteria: struct.completionCriteria || [],
      failurePolicy: struct.failurePolicy || '',
      artifactAggregationStrategy: struct.artifactAggregationStrategy || '',
      status: struct.status,
      createdAt: struct.createdAt,
      updatedAt: struct.updatedAt,
    };

    const body = [
      `# ${struct.name}`,
      '',
      '## 适用场景',
      struct.description,
      '',
      '## 参与角色',
      ...struct.roles.map(r => `- ${r}`),
      '',
      '## 阶段编排',
      ...struct.stages.map(s => {
        const failurePolicy = s.failurePolicy || 'retry';
        const handoff = s.handoffCondition || '前一阶段所有任务完成';
        return [
          `### ${s.name}`,
          `- 模式：${s.mode}`,
          `- 角色：${s.roles.join(', ')}`,
          `- 并行：${s.parallel ? '是' : '否'}`,
          `- 最大轮次：${s.maxRounds ?? '无限制'}`,
          `- 切换条件：${handoff}`,
          `- 失败策略：${failurePolicy}`,
          s.output ? `- 产出：${s.output}` : '',
        ].filter(Boolean).join('\n');
      }),
      '',
      '## 切换条件',
      '- subagent 阶段：所有角色完成任务或超时',
      '- agent-team 阶段：检测到集成问题或阻塞',
      '- 回归阶段：协作修复完成，需要独立验证',
      '',
      '## 失败处理与回退策略',
      struct.failurePolicy || '逐级升级，最终回退到协作排查',
      '',
      '### 失败策略说明',
      '- retry：自动重试最多3次',
      '- escalate：升级到协作模式（subagent → agent-team）',
      '- abort：中止整个流程',
      '',
      '## 产物汇总策略',
      '- 每个阶段输出摘要与文件变更列表',
      '- 最终汇总所有阶段的产出',
      '- 产物通过 artifacts 数组在阶段间传递',
    ].join('\n');

    return this.serializeFrontmatter(fm, body);
  }

  markdownToStruct(content: string, filePath: string): StructDefinition | null {
    const parsed = this.parseFrontmatter(content);
    const fm = parsed.frontmatter;

    console.log('[TeamFilePersistence] markdownToStruct:', { 
      filePath, 
      hasName: !!fm['name'], 
      frontmatterKeys: Object.keys(fm),
      hasStages: Array.isArray(fm['stages']),
      stagesCount: Array.isArray(fm['stages']) ? (fm['stages'] as unknown[]).length : 0
    });

    if (!fm['name']) {
      console.warn('[TeamFilePersistence] markdownToStruct: missing name in frontmatter:', filePath);
      return null;
    }

    const slugFromPath = filePath.split('/').pop()?.replace(/\.md$/i, '') || '';

    const ensureArray = <T>(value: unknown): T[] => {
      if (Array.isArray(value)) return value as T[];
      return [];
    };

    const ensureStages = (value: unknown): StructDefinition['stages'] => {
      if (Array.isArray(value)) return value as StructDefinition['stages'];
      return [];
    };

    const parsedStages = ensureStages(fm['stages']);

    return {
      name: fm['name'] as string,
      slug: (fm['slug'] as string) || slugFromPath,
      type: (fm['type'] as StructDefinition['type']) || 'hybrid',
      description: (fm['description'] as string) || '',
      roles: ensureArray<string>(fm['roles']),
      stages: parsedStages,
      handoffRules: ensureArray<string>(fm['handoffRules']),
      communicationRules: ensureArray<string>(fm['communicationRules']),
      completionCriteria: ensureArray<string>(fm['completionCriteria']),
      failurePolicy: (fm['failurePolicy'] as string) || '',
      artifactAggregationStrategy: (fm['artifactAggregationStrategy'] as string) || '',
      status: (fm['status'] as StructDefinition['status']) || 'draft',
      filePath,
      createdAt: (fm['createdAt'] as number) || Date.now(),
      updatedAt: (fm['updatedAt'] as number) || Date.now(),
    };
  }

  runtimeToJson(runtime: TeamRuntimeState): string {
    return JSON.stringify(runtime, null, 2);
  }

  jsonToRuntime(content: string, filePath: string): TeamRuntimeState | null {
    try {
      const data = JSON.parse(content);
      return { ...data, filePath };
    } catch {
      return null;
    }
  }

  async writeFile(relativePath: string, content: string): Promise<FileWriteResult> {
    try {
      this.fileCache.update(cache => {
        const newCache = new Map(cache);
        newCache.set(relativePath, content);
        return newCache;
      });

      const diskResult = await this.bridge.write(relativePath, content, 'vault');
      if (!diskResult.ok) {
        this.dirtyFiles.update(dirty => new Set(dirty).add(relativePath));
        return { path: relativePath, success: false, error: `磁盘写入失败: ${relativePath}` };
      }

      this.dirtyFiles.update(dirty => {
        const newDirty = new Set(dirty);
        newDirty.delete(relativePath);
        return newDirty;
      });

      this.eventBus.emit({
        type: EVENT_TYPES.MEMORY_SYNCED,
        sessionId: relativePath.split('/')[1] || 'file-persistence',
        source: 'system',
        payload: {
          sessionId: relativePath.split('/')[1] || 'file-persistence',
          pipeline: 'team' as const,
          filesTouched: [relativePath],
        },
      });

      return { path: relativePath, success: true };
    } catch (e: any) {
      this.dirtyFiles.update(dirty => new Set(dirty).add(relativePath));
      return { path: relativePath, success: false, error: e?.message ?? String(e) };
    }
  }

  async readFile(relativePath: string): Promise<FileReadResult> {
    console.log('[TeamFilePersistence] readFile called:', relativePath);
    try {
      const diskResult = await this.bridge.read(relativePath, 'vault');
      console.log('[TeamFilePersistence] bridge.read result:', { 
        path: relativePath, 
        ok: diskResult.ok, 
        contentLength: typeof diskResult.content === 'string' ? diskResult.content.length : 0 
      });
      if (diskResult.ok && typeof diskResult.content === 'string') {
        this.fileCache.update(cache => {
          const newCache = new Map(cache);
          newCache.set(relativePath, diskResult.content);
          return newCache;
        });
        return { path: relativePath, content: diskResult.content, exists: true };
      }
      this.fileCache.update(cache => {
        const newCache = new Map(cache);
        newCache.delete(relativePath);
        return newCache;
      });
      return { path: relativePath, content: null, exists: false };
    } catch (e: any) {
      console.error('[TeamFilePersistence] readFile error:', { path: relativePath, error: e?.message ?? String(e) });
      this.fileCache.update(cache => {
        const newCache = new Map(cache);
        newCache.delete(relativePath);
        return newCache;
      });
      return { path: relativePath, content: null, exists: false };
    }
  }

  async deleteFile(relativePath: string): Promise<FileWriteResult> {
    try {
      this.fileCache.update(cache => {
        const newCache = new Map(cache);
        newCache.delete(relativePath);
        return newCache;
      });

      this.dirtyFiles.update(dirty => {
        const newDirty = new Set(dirty);
        newDirty.delete(relativePath);
        return newDirty;
      });

      await this.bridge.remove(relativePath, 'vault');

      return { path: relativePath, success: true };
    } catch (e: any) {
      return { path: relativePath, success: false, error: e?.message ?? String(e) };
    }
  }

  async scanDirectory(relativePath: string): Promise<DirectoryScanResult> {
    console.log('[TeamFilePersistence] scanDirectory called:', relativePath);
    try {
      const diskResult = await this.bridge.list(relativePath, 'vault');
      console.log('[TeamFilePersistence] bridge.list result:', { 
        path: relativePath, 
        ok: diskResult.ok, 
        entriesCount: diskResult.entries?.length 
      });
      if (diskResult.ok && diskResult.entries) {
        const files: string[] = [];
        for (const entry of diskResult.entries) {
          const fullPath = relativePath === '.' || relativePath === ''
            ? entry.name
            : `${relativePath}/${entry.name}`;
          if (entry.type === 'file') {
            files.push(fullPath);
          } else if (entry.type === 'dir') {
            const subResult = await this.scanDirectory(fullPath);
            if (!subResult.error) {
              files.push(...subResult.files);
            }
          }
        }
        console.log('[TeamFilePersistence] scanDirectory result:', { path: relativePath, fileCount: files.length, files: files.slice(0, 10) });
        return { path: relativePath, files };
      }
      console.log('[TeamFilePersistence] scanDirectory failed or empty:', { path: relativePath, ok: diskResult.ok });
      return { path: relativePath, files: [] };
    } catch (e: any) {
      console.error('[TeamFilePersistence] scanDirectory error:', { path: relativePath, error: e?.message ?? String(e) });
      return { path: relativePath, files: [], error: e?.message ?? String(e) };
    }
  }

  async writeRole(role: RoleDefinition): Promise<FileWriteResult> {
    const content = this.roleToMarkdown(role);
    return this.writeFile(role.filePath, content);
  }

  async writeStruct(struct: StructDefinition): Promise<FileWriteResult> {
    const content = this.structToMarkdown(struct);
    return this.writeFile(struct.filePath, content);
  }

  async writeRuntime(runtime: TeamRuntimeState): Promise<FileWriteResult> {
    const path = `${TEAM_FILE_PATHS.teams}/${runtime.id}/runtime.json`;
    const content = this.runtimeToJson(runtime);
    return this.writeFile(path, content);
  }

  async readRole(filePath: string): Promise<RoleDefinition | null> {
    const result = await this.readFile(filePath);
    if (!result.content) return null;
    return this.markdownToRole(result.content, filePath);
  }

  async readStruct(filePath: string): Promise<StructDefinition | null> {
    const result = await this.readFile(filePath);
    if (!result.content) return null;
    return this.markdownToStruct(result.content, filePath);
  }

  async readRuntime(teamId: string): Promise<TeamRuntimeState | null> {
    const path = `${TEAM_FILE_PATHS.teams}/${teamId}/runtime.json`;
    const result = await this.readFile(path);
    if (!result.content) return null;
    return this.jsonToRuntime(result.content, path);
  }

  async scanRoles(): Promise<RoleDefinition[]> {
    const result = await this.scanDirectory(TEAM_FILE_PATHS.roles);
    const roles: RoleDefinition[] = [];

    for (const file of result.files) {
      if (!file.endsWith('.md')) continue;
      const role = await this.readRole(file);
      if (role) roles.push(role);
    }

    return roles;
  }

  async scanStructs(): Promise<StructDefinition[]> {
    const result = await this.scanDirectory(TEAM_FILE_PATHS.structs);
    const structs: StructDefinition[] = [];

    for (const file of result.files) {
      if (!file.endsWith('.md')) continue;
      const struct = await this.readStruct(file);
      if (struct) structs.push(struct);
    }

    return structs;
  }

  async scanRuntimes(): Promise<TeamRuntimeState[]> {
    const result = await this.scanDirectory(TEAM_FILE_PATHS.teams);
    const runtimes: TeamRuntimeState[] = [];

    for (const file of result.files) {
      if (!file.endsWith('/runtime.json')) continue;
      const teamId = file.split('/').slice(-2, -1)[0];
      if (teamId) {
        const runtime = await this.readRuntime(teamId);
        if (runtime) runtimes.push(runtime);
      }
    }

    return runtimes;
  }

  async deleteRuntime(teamId: string): Promise<FileWriteResult> {
    const path = `${TEAM_FILE_PATHS.teams}/${teamId}/runtime.json`;
    return this.deleteFile(path);
  }

  clearCache(): void {
    this.fileCache.set(new Map());
    this.dirtyFiles.set(new Set());
  }

  getDirtyFiles(): string[] {
    return [...this.dirtyFiles()];
  }

  async flushDirtyFiles(): Promise<FileWriteResult[]> {
    const results: FileWriteResult[] = [];
    const dirty = this.dirtyFiles();

    for (const path of dirty) {
      const content = this.fileCache().get(path);
      if (content !== undefined) {
        const writeResult = await this.writeFile(path, content);
        results.push(writeResult);
      }
    }

    return results;
  }

  async syncAll(): Promise<{
    roles: { added: string[]; updated: string[]; removed: string[] };
    structs: { added: string[]; updated: string[]; removed: string[] };
    runtimes: { added: string[]; updated: string[]; removed: string[] };
  }> {
    const roles = await this.syncType('roles', TEAM_FILE_PATHS.roles);
    const structs = await this.syncType('structs', TEAM_FILE_PATHS.structs);
    const runtimes = await this.syncType('runtimes', TEAM_FILE_PATHS.teams);

    return { roles, structs, runtimes };
  }

  private async syncType(
    typeName: string,
    directory: string,
  ): Promise<{ added: string[]; updated: string[]; removed: string[] }> {
    const scanResult = await this.scanDirectory(directory);
    const currentFiles = new Set(scanResult.files);

    const cachedFiles = new Set<string>();
    this.fileCache().forEach((_, key) => {
      if (key.startsWith(directory)) {
        cachedFiles.add(key);
      }
    });

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];

    currentFiles.forEach(file => {
      if (!cachedFiles.has(file)) {
        added.push(file);
      }
    });

    cachedFiles.forEach(file => {
      if (!currentFiles.has(file)) {
        removed.push(file);
      }
    });

    for (const file of added) {
      const readResult = await this.readFile(file);
      if (readResult.content !== null) {
        this.fileCache.update(cache => {
          const newCache = new Map(cache);
          newCache.set(file, readResult.content!);
          return newCache;
        });
      }
    }

    for (const file of removed) {
      this.fileCache.update(cache => {
        const newCache = new Map(cache);
        newCache.delete(file);
        return newCache;
      });
    }

    return { added, updated, removed };
  }

  private watchIntervalId: ReturnType<typeof setInterval> | null = null;
  private fsWatchId: string | null = null;

  async watchForChanges(intervalMs: number = 5000): Promise<void> {
    this.stopWatching();

    try {
      if (window.zytrader?.fs?.watchDir) {
        const result = await window.zytrader.fs.watchDir('03-AGENT-TOOLS', { scope: 'vault' });
        if (result.ok && result.watchId) {
          this.fsWatchId = result.watchId;
          if (window.zytrader?.fs?.onDirectoryChange) {
            window.zytrader.fs.onDirectoryChange(async () => {
              await this.syncAll();
            });
          }
        }
        return;
      }
    } catch {
      // fallback to polling
    }

    this.watchIntervalId = setInterval(async () => {
      const syncResult = await this.syncAll();

      const hasChanges =
        syncResult.roles.added.length > 0 || syncResult.roles.removed.length > 0 ||
        syncResult.structs.added.length > 0 || syncResult.structs.removed.length > 0 ||
        syncResult.runtimes.added.length > 0 || syncResult.runtimes.removed.length > 0;

      if (hasChanges) {
        this.eventBus.emit({
          type: EVENT_TYPES.MEMORY_SYNCED,
          sessionId: 'file-persistence',
          source: 'system',
          payload: {
            sessionId: 'file-persistence',
            pipeline: 'team' as const,
            filesTouched: [
              ...syncResult.roles.added,
              ...syncResult.structs.added,
              ...syncResult.runtimes.added,
            ],
          },
        });
      }
    }, intervalMs);
  }

  stopWatching(): void {
    if (this.watchIntervalId !== null) {
      clearInterval(this.watchIntervalId);
      this.watchIntervalId = null;
    }

    if (this.fsWatchId && window.zytrader?.fs?.unwatchDir) {
      window.zytrader.fs.unwatchDir(this.fsWatchId);
      this.fsWatchId = null;
    }
  }
}
