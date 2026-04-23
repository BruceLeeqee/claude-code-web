import { Injectable, inject } from '@angular/core';
import { AppSettingsService } from '../../../core/app-settings.service';
import { SkillIndexService, type SkillRecord } from '../../../core/skill-index.service';
import { PromptMemoryBuilderService } from '../../../core/memory/prompt-memory-builder.service';

export interface AssistantFlowRequest {
  sessionId: string;
  rawInput: string;
  runtimeSystemPrompt: string;
}

export interface AssistantSkillEnrichmentResult {
  effectiveUserInput: string;
  hitSkills: SkillRecord[];
  debugReason: string;
  diagnostics: string[];
}

export interface AssistantFlowStartResult {
  ok: boolean;
  reason?: 'empty' | 'no_api_key' | 'empty_skill_result';
  fullPrompt?: string;
  buildReport?: ReturnType<PromptMemoryBuilderService['getLastBuildReport']>;
  skillEnrichment?: AssistantSkillEnrichmentResult;
}

@Injectable({ providedIn: 'root' })
export class WorkbenchAssistantFlowService {
  private readonly appSettings = inject(AppSettingsService);
  private readonly skillIndex = inject(SkillIndexService);
  private readonly promptMemoryBuilder = inject(PromptMemoryBuilderService);

  async preparePrompt(
    sessionId: string,
    userInput: string,
    runtimeSystemPrompt: string,
  ): Promise<AssistantFlowStartResult> {
    const trimmed = userInput.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    if (!this.appSettings.value.apiKey?.trim()) return { ok: false, reason: 'no_api_key' };

    // 技能检测与记忆构建有依赖关系（effectiveUserInput → buildFullPromptForInput），
    // 但技能内容读取可延迟到命中后再做；先并行启动vault就绪
    const skillEnrichment = await this.enrichPromptWithInstalledSkill(trimmed);
    const fullPrompt = await this.promptMemoryBuilder.buildFullPromptForInput(
      sessionId,
      skillEnrichment.effectiveUserInput,
      runtimeSystemPrompt,
    );

    return {
      ok: true,
      fullPrompt,
      buildReport: this.promptMemoryBuilder.getLastBuildReport(sessionId),
      skillEnrichment,
    };
  }

  private normalizeForSkillHit(v: string): string {
    return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private expandSkillMatchInput(v: string): string {
    return v.replace(/[“”"'`]/g, '');
  }

  private extractSkillTokens(skill: SkillRecord): string[] {
    const source = `${skill.id} ${skill.name} ${skill.desc ?? ''} ${skill.contentPath ?? ''}`;
    const norm = this.normalizeForSkillHit(source);
    const parts = norm.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((p) => p.length >= 2);
    const out = new Set(parts);
    return [...out];
  }

  private scoreSkillHit(userInput: string, skill: SkillRecord): number {
    if (skill.status !== 'ok') return 0;
    const inputNorm = this.expandSkillMatchInput(this.normalizeForSkillHit(userInput));
    if (!inputNorm) return 0;

    const idNorm = this.normalizeForSkillHit(skill.id);
    const nameNorm = this.normalizeForSkillHit(skill.name);
    const descNorm = this.normalizeForSkillHit(skill.desc ?? '');
    const pathNorm = this.normalizeForSkillHit(skill.contentPath ?? '');

    let score = 0;
    if (idNorm && inputNorm.includes(idNorm)) score += 6;
    if (nameNorm && inputNorm.includes(nameNorm)) score += 8;
    if (descNorm && inputNorm.includes(descNorm.slice(0, Math.min(24, descNorm.length)))) score += 2;
    if (pathNorm) {
      const tail = pathNorm.slice(-Math.min(24, pathNorm.length));
      if (tail.length >= 4 && inputNorm.includes(tail)) score += 1;
    }

    const tokens = this.extractSkillTokens(skill);
    for (const t of tokens) {
      if (inputNorm.includes(t)) {
        score += t.length >= 4 ? 3 : 1;
      }
    }

    return score;
  }

  private buildSkillPromptPatch(records: SkillRecord[], markdowns: Map<string, string>): string {
    const lines: string[] = [
      '【技能强制命中】',
      `本轮命中技能数量：${records.length}`,
      '你必须优先遵循命中技能中的步骤执行（而不是泛化回复）。',
      '若技能与当前工具能力存在冲突，先说明冲突点，再给可执行替代方案。',
      '',
    ];

    records.forEach((record, idx) => {
      const md = markdowns.get(record.id) ?? '';
      const normalized = md.replace(/\r/g, '').trim();
      const compact = normalized.length > 1600 ? `${normalized.slice(0, 1600)}\n...` : normalized;
      lines.push(`[命中技能 #${idx + 1}] ${record.name}（id=${record.id}）`);
      lines.push(`技能文件：${record.contentPath}`);
      lines.push('[SKILL.md 摘要开始]');
      lines.push(compact || '（技能内容为空）');
      lines.push('[SKILL.md 摘要结束]');
      lines.push('');
    });

    return lines.join('\n');
  }

  private async reloadInstalledSkills(): Promise<SkillRecord[]> {
    const all = await this.skillIndex.listInstalledSkills();
    return all.filter((s) => s.status === 'ok');
  }

  private async enrichPromptWithInstalledSkill(userInput: string): Promise<AssistantSkillEnrichmentResult> {
    const all = await this.reloadInstalledSkills();
    if (all.length === 0) {
      return {
        effectiveUserInput: userInput,
        hitSkills: [],
        debugReason: '未发现可用技能',
        diagnostics: ['(无已安装技能)'],
      };
    }

    try {
      const scoredAll = all
        .map((s) => ({ s, score: this.scoreSkillHit(userInput, s) }))
        .sort((a, b) => b.score - a.score || (b.s.updatedAt ?? 0) - (a.s.updatedAt ?? 0));
      const diagnostics = scoredAll.map(({ s, score }) => {
        if (score > 0) return `✅ ${s.name} (${s.id})：命中，score=${score}`;
        return `❌ ${s.name} (${s.id})：未命中（基础评分=0，需内容兜底）`;
      });

      let ranked = scoredAll.filter((x) => x.score > 0).slice(0, 3).map((x) => x.s);

      if (ranked.length === 0) {
        // 兜底：并行批量读取技能内容做内容匹配（限制并发数避免 I/O 压力）
        const inputNorm = this.expandSkillMatchInput(this.normalizeForSkillHit(userInput));
        const batchSize = 5;
        for (let i = 0; i < all.length && ranked.length === 0; i += batchSize) {
          const batch = all.slice(i, i + batchSize);
          const mdResults = await Promise.all(batch.map((s) => this.skillIndex.readSkillMd(s)));
          for (let j = 0; j < mdResults.length && ranked.length === 0; j++) {
            const md = mdResults[j]!;
            if (!md.ok || !md.content.trim()) continue;
            const s = batch[j]!;
            const contentNorm = this.normalizeForSkillHit(md.content);
            const metaTokens = this.extractSkillTokens(s);
            const mdTokens = contentNorm.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((p) => p.length >= 2).slice(0, 800);
            const tokenSet = [...new Set([...metaTokens, ...mdTokens])];

            let hits = 0;
            for (const token of tokenSet) {
              if (token.length < 2) continue;
              if (inputNorm.includes(token)) {
                hits += token.length >= 4 ? 2 : 1;
                if (hits >= 3) {
                  ranked = [s];
                  break;
                }
              }
            }
          }
        }
      }

      if (ranked.length === 0) {
        const debug = all.slice(0, 8).map((s) => `${s.name}(${s.id}):${this.scoreSkillHit(userInput, s)}`).join(' | ');
        return {
          effectiveUserInput: userInput,
          hitSkills: [],
          debugReason: `未命中；候选得分：${debug || 'none'}`,
          diagnostics,
        };
      }

      const markdowns = new Map<string, string>();
      const okSkills: SkillRecord[] = [];
      const mdResults = await Promise.all(ranked.map((skill) => this.skillIndex.readSkillMd(skill)));
      for (let i = 0; i < mdResults.length; i++) {
        const md = mdResults[i]!;
        const skill = ranked[i]!;
        if (!md.ok || !md.content.trim()) continue;
        markdowns.set(skill.id, md.content);
        okSkills.push(skill);
      }

      if (okSkills.length === 0) {
        return {
          effectiveUserInput: userInput,
          hitSkills: [],
          debugReason: '候选技能读取失败或内容为空',
          diagnostics,
        };
      }

      const tail = `【已命中技能：${okSkills.map((s) => `${s.name}（${s.id}）`).join('，')}】`;
      const scoreDebug = okSkills.map((s) => `${s.name}(${s.id}):${this.scoreSkillHit(userInput, s)}`).join(' | ');
      const patch = this.buildSkillPromptPatch(okSkills, markdowns);
      return {
        effectiveUserInput: `${userInput}\n${tail}\n\n${patch}`,
        hitSkills: okSkills,
        debugReason: `命中；得分：${scoreDebug}`,
        diagnostics,
      };
    } catch {
      return {
        effectiveUserInput: userInput,
        hitSkills: [],
        debugReason: '检测异常（已回退为不注入技能）',
        diagnostics: all.map((s) => `⚠️ ${s.name} (${s.id})：检测异常`),
      };
    }
  }
}
