/**
 * UI 验证探针 — 可扩展脚本
 *
 * 用途：检查页面构建产物、组件完整性、样式文件、HTML 合规性。
 * 运行：node scripts/ui-check.mjs
 *
 * 扩展方式：在 PROBES 数组中追加 probe 对象即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

/* ── 工具函数 ────────────────────────────────────────────── */

function walkSync(dir, out = []) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of names) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.angular') continue;
      walkSync(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

/* ── 探针定义 ────────────────────────────────────────────── */

/**
 * @typedef {{ name: string; run: () => { passed: boolean; detail: string } }} Probe
 */
const PROBES = [
  {
    name: 'html-templates-exist',
    run() {
      const src = path.join(projectRoot, 'src');
      const htmlFiles = walkSync(src).filter((f) => f.endsWith('.html'));
      if (htmlFiles.length === 0) {
        return { passed: false, detail: 'no HTML templates found in src/' };
      }
      return { passed: true, detail: `${htmlFiles.length} HTML templates found` };
    },
  },
  {
    name: 'scss-styles-exist',
    run() {
      const src = path.join(projectRoot, 'src');
      const scssFiles = walkSync(src).filter((f) => f.endsWith('.scss') || f.endsWith('.css'));
      if (scssFiles.length === 0) {
        return { passed: false, detail: 'no style files found in src/' };
      }
      return { passed: true, detail: `${scssFiles.length} style files found` };
    },
  },
  {
    name: 'no-empty-templates',
    run() {
      const src = path.join(projectRoot, 'src');
      const htmlFiles = walkSync(src).filter((f) => f.endsWith('.html'));
      const empty = [];
      for (const f of htmlFiles) {
        const content = fs.readFileSync(f, 'utf8').trim();
        if (!content || content.length < 10) {
          empty.push(path.relative(projectRoot, f));
        }
      }
      if (empty.length > 0) {
        return { passed: false, detail: `empty templates: ${empty.join(', ')}` };
      }
      return { passed: true, detail: 'all templates non-empty' };
    },
  },
  {
    name: 'component-ts-pairs',
    run() {
      const src = path.join(projectRoot, 'src');
      const tsFiles = walkSync(src).filter(
        (f) => f.endsWith('.component.ts') || f.endsWith('.page.ts'),
      );
      let missing = 0;
      for (const ts of tsFiles) {
        const base = ts.replace(/\.ts$/, '');
        const html = `${base}.html`;
        if (!fs.existsSync(html)) {
          missing++;
        }
      }
      if (missing > 0) {
        return {
          passed: false,
          detail: `${missing} component TS files missing .html templates`,
        };
      }
      return { passed: true, detail: `${tsFiles.length} component TS files all have HTML pairs` };
    },
  },
  // ── 扩展点：在此追加更多 UI 探针 ──
  // {
  //   name: 'screenshot-regression',
  //   run() {
  //     // screenshot diff / visual regression check
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
      console.log(`  ✓ ui:${probe.name} — ${result.detail}`);
    } else {
      failed++;
      failures.push(probe.name);
      console.log(`  ✗ ui:${probe.name} — ${result.detail}`);
    }
  } catch (err) {
    failed++;
    failures.push(probe.name);
    console.log(`  ✗ ui:${probe.name} — ${err.message}`);
  }
}

console.log(`\nui-check: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`Failed probes: ${failures.join(', ')}`);
  process.exit(1);
}
