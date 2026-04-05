/**
 * 构建前校验：源码必须为合法 UTF-8（fatal），并拒绝「???」占位（易在界面上显示为乱码）。
 * 运行：node scripts/verify-source-utf8.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, '../src');

const TEXT_EXT = new Set(['.ts', '.html', '.scss', '.css', '.json', '.md']);

function walk(dir, out = []) {
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
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

function assertValidUtf8(buf, filePath) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    throw new Error(`${filePath}: 不是合法 UTF-8 文件（请用 UTF-8 保存，勿用 GBK）`);
  }
  if (text.includes('\uFFFD')) {
    throw new Error(`${filePath}: 含 Unicode 替换字符 U+FFFD，多为错误解码后保存导致`);
  }
}

function assertNoTripleQuestionPlaceholder(text, filePath) {
  // 排除 URL / 路径里的偶然三连
  if (!text.includes('???')) return;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('???')) continue;
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;
    if (line.includes('http') && line.includes('???')) continue;
    throw new Error(
      `${filePath}:${i + 1}: 含「???」占位，请改为明确中文或英文文案（曾导致界面乱码/问号）`,
    );
  }
}

const files = walk(srcRoot).filter((p) => TEXT_EXT.has(path.extname(p).toLowerCase()));

let ok = 0;
for (const filePath of files) {
  const buf = fs.readFileSync(filePath);
  assertValidUtf8(buf, path.relative(srcRoot, filePath));
  const text = buf.toString('utf8');
  assertNoTripleQuestionPlaceholder(text, path.relative(srcRoot, filePath));
  ok++;
}

console.log(`verify-source-utf8: OK (${ok} files under src/)`);
