/**
 * 技能注册表：在用户消息进入模型前运行所有已注册技能，合并 promptPatch 等输出。
 */
import type { Skill, SkillInput, SkillOutput } from '../types/index.js';

/** 单次技能执行结果 */
export interface SkillExecutionResult {
  skillId: string;
  output: SkillOutput;
}

/** 维护 id → Skill 映射 */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  /** 注册技能（同 id 覆盖） */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  /** 按 id 移除 */
  unregister(id: string): void {
    this.skills.delete(id);
  }

  /** 当前已注册技能列表 */
  list(): Skill[] {
    return [...this.skills.values()];
  }

  /** 顺序执行全部技能 */
  async runAll(input: SkillInput): Promise<SkillExecutionResult[]> {
    const outputs: SkillExecutionResult[] = [];
    for (const skill of this.skills.values()) {
      outputs.push({
        skillId: skill.id,
        output: await skill.run(input),
      });
    }
    return outputs;
  }

  /** 仅执行指定 id，不存在返回 null */
  async runById(id: string, input: SkillInput): Promise<SkillOutput | null> {
    const skill = this.skills.get(id);
    if (!skill) return null;
    return skill.run(input);
  }
}
