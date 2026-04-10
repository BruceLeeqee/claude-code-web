import type { PromptBuildContext, PromptSection } from '../types.js';

export function buildEnvironmentSection(ctx: PromptBuildContext): PromptSection {
  const cwd = ctx.env?.cwd ?? 'unknown';
  const shell = ctx.env?.shell ?? 'unknown';
  const os = ctx.env?.os ?? 'unknown';
  const model = ctx.env?.model ?? 'unknown';
  const isGitRepo = ctx.env?.isGitRepo;
  const language = ctx.language ?? 'en';

  const lines =
    language === 'zh'
      ? [
          '# 环境信息',
          `- 工作目录: ${cwd}`,
          `- Shell: ${shell}`,
          `- 平台: ${os}`,
          `- 模型: ${model}`,
          typeof isGitRepo === 'boolean' ? `- 是否 Git 仓库: ${isGitRepo}` : null,
        ]
      : [
          '# Environment',
          `- Working directory: ${cwd}`,
          `- Shell: ${shell}`,
          `- Platform: ${os}`,
          `- Model: ${model}`,
          typeof isGitRepo === 'boolean' ? `- Is git repo: ${isGitRepo}` : null,
        ];

  return {
    id: 'environment',
    kind: 'dynamic',
    content: lines.filter((v): v is string => v !== null).join('\n'),
  };
}
