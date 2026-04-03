import type { Skill, SkillInput, SkillOutput } from '../types/index.js';

export interface SkillExecutionResult {
  skillId: string;
  output: SkillOutput;
}

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  unregister(id: string): void {
    this.skills.delete(id);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

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

  async runById(id: string, input: SkillInput): Promise<SkillOutput | null> {
    const skill = this.skills.get(id);
    if (!skill) return null;
    return skill.run(input);
  }
}
