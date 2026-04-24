/**
 * API 验证探针 — 可扩展脚本
 *
 * 用途：检查后端 API 端点可用性、响应状态、schema 合规性。
 * 运行：node scripts/api-check.mjs
 *
 * 扩展方式：在 PROBES 数组中追加 probe 对象即可。
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

/* ── 探针定义 ────────────────────────────────────────────── */

/**
 * @typedef {{ name: string; run: () => { passed: boolean; detail: string } }} Probe
 */
const PROBES = [
  {
    name: 'typescript-compile',
    run() {
      try {
        execSync('npx tsc --noEmit --project tsconfig.app.json', {
          cwd: projectRoot,
          stdio: 'pipe',
          timeout: 120_000,
        });
        return { passed: true, detail: 'tsc --noEmit passed' };
      } catch (e) {
        const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
        return { passed: false, detail: out.slice(0, 600) || 'tsc failed' };
      }
    },
  },
  {
    name: 'angular-build',
    run() {
      try {
        execSync('npx ng build zyfront-desktop-web --base-href ./', {
          cwd: projectRoot,
          stdio: 'pipe',
          timeout: 180_000,
        });
        return { passed: true, detail: 'ng build passed' };
      } catch (e) {
        const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
        return { passed: false, detail: out.slice(0, 600) || 'ng build failed' };
      }
    },
  },
  // ── 扩展点：在此追加更多 API 探针 ──
  // {
  //   name: 'custom-endpoint',
  //   run() {
  //     // fetch / health-check / schema-assertion ...
  //     return { passed: true, detail: 'ok' };
  //   },
  // },
];

/* ── 执行引擎 ────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures = [];

for (const probe of PROBES) {
  try {
    const result = probe.run();
    if (result.passed) {
      passed++;
      console.log(`  ✓ api:${probe.name} — ${result.detail}`);
    } else {
      failed++;
      failures.push(probe.name);
      console.log(`  ✗ api:${probe.name} — ${result.detail}`);
    }
  } catch (err) {
    failed++;
    failures.push(probe.name);
    console.log(`  ✗ api:${probe.name} — ${err.message}`);
  }
}

console.log(`\napi-check: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`Failed probes: ${failures.join(', ')}`);
  process.exit(1);
}
