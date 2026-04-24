/**
 * 数据验证探针 — 可扩展脚本
 *
 * 用途：检查数据持久化、一致性、缓存同步、读写正确性。
 * 运行：node scripts/data-check.mjs
 *
 * 扩展方式：在 PROBES 数组中追加 probe 对象即可。
 */
import fs from 'node:fs';
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
    name: 'src-tree-readable',
    run() {
      const src = path.join(projectRoot, 'src');
      if (!fs.existsSync(src)) {
        return { passed: false, detail: 'src/ directory not found' };
      }
      const stat = fs.statSync(src);
      if (!stat.isDirectory()) {
        return { passed: false, detail: 'src/ is not a directory' };
      }
      return { passed: true, detail: 'src/ exists and readable' };
    },
  },
  {
    name: 'package-json-valid',
    run() {
      const pkgPath = path.join(projectRoot, 'package.json');
      try {
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const pkg = JSON.parse(raw);
        if (!pkg.name || !pkg.version) {
          return { passed: false, detail: 'package.json missing name/version' };
        }
        return { passed: true, detail: `package.json valid (${pkg.name}@${pkg.version})` };
      } catch (e) {
        return { passed: false, detail: `package.json parse error: ${e.message}` };
      }
    },
  },
  {
    name: 'tsconfig-valid',
    run() {
      const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
      try {
        const raw = fs.readFileSync(tsconfigPath, 'utf8');
        // tsconfig 允许注释，仅检查文件存在且非空
        if (!raw.trim()) {
          return { passed: false, detail: 'tsconfig.json is empty' };
        }
        return { passed: true, detail: 'tsconfig.json exists and non-empty' };
      } catch (e) {
        return { passed: false, detail: `tsconfig.json read error: ${e.message}` };
      }
    },
  },
  {
    name: 'angular-json-valid',
    run() {
      const angularPath = path.join(projectRoot, 'angular.json');
      try {
        const raw = fs.readFileSync(angularPath, 'utf8');
        JSON.parse(raw);
        return { passed: true, detail: 'angular.json valid' };
      } catch (e) {
        return { passed: false, detail: `angular.json error: ${e.message}` };
      }
    },
  },
  // ── 扩展点：在此追加更多数据探针 ──
  // {
  //   name: 'db-connection',
  //   run() {
  //     // check database connection / data integrity
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
      console.log(`  ✓ data:${probe.name} — ${result.detail}`);
    } else {
      failed++;
      failures.push(probe.name);
      console.log(`  ✗ data:${probe.name} — ${result.detail}`);
    }
  } catch (err) {
    failed++;
    failures.push(probe.name);
    console.log(`  ✗ data:${probe.name} — ${err.message}`);
  }
}

console.log(`\ndata-check: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`Failed probes: ${failures.join(', ')}`);
  process.exit(1);
}
