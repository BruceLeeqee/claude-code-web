import type { PromptSection } from './types.js';

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface PromptHashes {
  staticHash: string;
  dynamicHash: string;
  fullHash: string;
}

export function computePromptHashes(sections: PromptSection[], finalPrompt: string): PromptHashes {
  const staticContent = sections
    .filter((s) => s.kind === 'static')
    .map((s) => `[${s.id}]\n${s.content}`)
    .join('\n\n');

  const dynamicContent = sections
    .filter((s) => s.kind !== 'static')
    .map((s) => `[${s.id}]\n${s.content}`)
    .join('\n\n');

  return {
    staticHash: djb2(staticContent),
    dynamicHash: djb2(dynamicContent),
    fullHash: djb2(finalPrompt),
  };
}
