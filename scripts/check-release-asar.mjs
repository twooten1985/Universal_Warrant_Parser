/**
 * Fail the Windows build if the packaged app is missing a feature marker
 * or if app code contains a real evidence path.
 * Usage: node scripts/check-release-asar.mjs dist-electron
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.argv[2] || 'dist-electron';
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const asar = walk(root).find(file => file.endsWith(`${path.sep}app.asar`) || file.endsWith('/app.asar'));
if (!asar) {
  console.error(`No app.asar under ${root}`);
  process.exit(1);
}
const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-asar-'));
const extract = spawnSync('npx', ['--yes', '@electron/asar', 'extract', asar, extracted], { stdio: 'inherit', shell: process.platform === 'win32' });
if (extract.status !== 0) {
  console.error('Could not extract app.asar');
  process.exit(extract.status || 1);
}

const needles = [
  'icloud',
  'wizard.html',
  '/api/apple/list',
  'zipWorkspace',
  '/api/zip/workspace',
  'GOOGLE_CATEGORIES',
  'googleCategories',
  'case_tag_defs',
  'google-row:',
  'Tagged only',
];
const forbidden = [/C:\\Users\\/i, /C:\/Users\//i, /C:\\UWRP-work/i, /C:\/UWRP-work/i];
const allowDirs = new Set(['dist', 'electron']);
const allowFiles = new Set(['electron-main.cjs', 'electron-preload.cjs', 'package.json']);

let blob = '';
function addPath(rel) {
  blob += `\n${rel}`;
}
function consider(abs, rel) {
  const top = rel.split(/[\\/]/)[0];
  if (!allowDirs.has(top) && !allowFiles.has(rel)) return;
  if (abs.endsWith('.png') || abs.endsWith('.ico') || abs.endsWith('.map')) return;
  const st = fs.statSync(abs);
  if (st.size > 20 * 1024 * 1024) return;
  blob += `\n${fs.readFileSync(abs)}`;
}
function walkText(dir, relBase = '') {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) {
      if (name === 'node_modules') continue;
      addPath(rel);
      walkText(abs, rel);
    } else {
      addPath(rel);
      consider(abs, rel);
    }
  }
}
walkText(extracted);

const missing = needles.filter(needle => !blob.includes(needle));
const hits = [];
for (const pattern of forbidden) {
  const found = blob.match(pattern);
  if (found) hits.push(found[0]);
}
if (missing.length || hits.length) {
  console.error('Release check failed.');
  if (missing.length) console.error('Missing markers:\n' + missing.map(item => `  ${item}`).join('\n'));
  if (hits.length) console.error('Real paths:\n' + hits.map(item => `  ${item}`).join('\n'));
  process.exit(1);
}
console.log(`app.asar markers present (${needles.length}), no real evidence paths`);
