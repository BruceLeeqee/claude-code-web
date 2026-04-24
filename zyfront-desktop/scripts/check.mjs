/**
 * 综合验证探针 — 聚合 runner
 *
 * 用途：依次运行 api-check / data-check / ui-check，汇总结果。
 * 运行：node scripts/check.mjs
 *       npm run check
 *
 * 退出码：0 = 全部通过，1 = 有失败探针。
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const RUNNERS = [
  { name: 'api:check', script: 'scripts/api-check.mjs' },
  { name: 'data:check', script: 'scripts/data-check.mjs' },
  { name: 'ui:check', script: 'scripts/ui-check.mjs' },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const runner of RUNNERS) {
  const scriptPath = path.join(projectRoot, runner.script);
  console.log(`\n── ${runner.name} ──`);
  try {
    const output = execSync(`node "${scriptPath}"`, {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 300_000,
      encoding: 'utf8',
    });
    console.log(output);
    passed++;
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    console.log(out || e.message);
    failed++;
    failures.push(runner.name);
  }
}

console.log(`\n══ check (aggregate) ══`);
console.log(`  ${passed} suites passed, ${failed} suites failed`);

if (failed > 0) {
  console.error(`\nFailed suites: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('\nAll checks passed.');
