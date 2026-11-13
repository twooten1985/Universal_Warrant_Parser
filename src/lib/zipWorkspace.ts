/**
 * Stream a zip from disk one entry at a time (yauzl). The original zip is opened read-only.
 * Nested zips are expanded the same way a folder import expands them, so a direct zip load
 * and a pre-extracted folder load list the same files. Nothing is turned into one giant string.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const req = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/index.js');

export interface ZipWorkEntry {
  path: string;
  rel: string;
  name: string;
  size: number;
  head: string;
}

export interface ZipWorkResult {
  dir: string;
  entries: ZipWorkEntry[];
  failed: Array<{ rel: string; error: string }>;
  reused: boolean;
}

const NESTED_DEPTH = 64;
const MAX_ENTRIES = 20000;

const skip = (rel: string) => {
  const l = rel.toLowerCase();
  return l.includes('__macosx/') || l.endsWith('.ds_store') || l.endsWith('/');
};

function headHex(filePath: string): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const b = Buffer.alloc(32);
    const n = fs.readSync(fd, b, 0, 32, 0);
    return b.subarray(0, n).toString('hex');
  } finally {
    fs.closeSync(fd);
  }
}

export function workDirFor(cacheRoot: string, zipPath: string): string {
  const st = fs.statSync(zipPath);
  const key = crypto.createHash('sha1').update(`${path.resolve(zipPath)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20);
  return path.join(cacheRoot, 'zipwork', key);
}

function openZip(zipPath: string): Promise<any> {
  const yauzl = req('yauzl');
  const options = { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: false };
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, options, (err: Error | null, zip: any) => {
      if (!err && zip) return resolve(zip);
      yauzl.open(zipPath, { ...options, decodeStrings: false }, (err2: Error | null, zip2: any) => {
        if (err2 || !zip2) return reject(err2 || err);
        resolve(zip2);
      });
    });
  });
}

function entryName(entry: { fileName: string | Buffer }): string {
  const raw = Buffer.isBuffer(entry.fileName) ? entry.fileName.toString('utf8') : String(entry.fileName);
  return raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function streamEntry(zip: any, entry: any, target: string, want: number): Promise<void> {
  const part = target + '.uwrp-part';
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err: Error | null, rs: any) => {
      if (err) return reject(err);
      const ws = fs.createWriteStream(part);
      let n = 0;
      let bad = false;
      const fail = (e: unknown) => {
        if (bad) return;
        bad = true;
        try { rs.destroy(); } catch { /* already closed */ }
        try { ws.destroy(); } catch { /* already closed */ }
        try { fs.rmSync(part, { force: true }); } catch { /* gone */ }
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      rs.on('data', (d: Buffer) => { n += d.length; });
      rs.on('error', fail);
      ws.on('error', fail);
      ws.on('finish', () => {
        if (bad) return;
        if (Number.isFinite(want) && want >= 0 && n !== want) return fail(new Error(`size mismatch ${n} != ${want}`));
        try {
          fs.rmSync(target, { force: true });
          fs.renameSync(part, target);
          resolve();
        } catch (e) {
          fail(e);
        }
      });
      rs.pipe(ws);
    });
  });
}

function allocateTarget(root: string, rel: string, used: Set<string>): string | null {
  let target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  if (used.has(target.toLowerCase())) {
    const ext = path.extname(target);
    const stem = ext ? target.slice(0, target.length - ext.length) : target;
    let i = 2;
    while (used.has(`${stem} (${i})${ext}`.toLowerCase())) i++;
    target = `${stem} (${i})${ext}`;
  }
  used.add(target.toLowerCase());
  return target;
}

async function extractOne(
  zipPath: string,
  root: string,
  prefix: string,
  depth: number,
  entries: ZipWorkEntry[],
  failed: ZipWorkResult['failed'],
  used: Set<string>,
  expandNested: boolean
): Promise<void> {
  if (depth > NESTED_DEPTH || entries.length >= MAX_ENTRIES) return;
  const zip = await openZip(zipPath);
  const nested: Array<{ zipPath: string; prefix: string }> = [];
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: any) => {
      const rel = `${prefix}${entryName(entry)}`;
      const next = () => zip.readEntry();
      if (skip(rel) || entries.length >= MAX_ENTRIES) return next();
      const target = allocateTarget(root, rel, used);
      if (!target) {
        failed.push({ rel, error: 'unsafe path skipped' });
        return next();
      }
      const want = Number(entry.uncompressedSize);
      const finish = () => {
        try {
          const size = fs.statSync(target).size;
          entries.push({ path: target, rel, name: path.posix.basename(rel), size, head: headHex(target) });
          if (expandNested && rel.toLowerCase().endsWith('.zip') && depth < NESTED_DEPTH) {
            nested.push({ zipPath: target, prefix: `${rel.replace(/\.zip$/i, '')}/` });
          }
        } catch (err) {
          failed.push({ rel, error: err instanceof Error ? err.message : String(err) });
        }
        next();
      };
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target) && fs.statSync(target).size === want) return finish();
      } catch { /* write it */ }
      streamEntry(zip, entry, target, want).then(finish).catch((err) => {
        failed.push({ rel, error: err instanceof Error ? err.message : String(err) });
        next();
      });
    });
    zip.readEntry();
  });
  try { zip.close(); } catch { /* already closed */ }
  for (const child of nested) {
    await extractOne(child.zipPath, root, child.prefix, depth + 1, entries, failed, used, expandNested);
  }
}

export function extractZipToWorkspace(zipPath: string, cacheRoot: string, prefix = '', expandNested = true): Promise<ZipWorkResult> {
  const dir = workDirFor(cacheRoot, zipPath);
  const manifest = path.join(dir, '_uwrp_zipwork.json');
  if (fs.existsSync(manifest)) {
    try {
      const saved = JSON.parse(fs.readFileSync(manifest, 'utf8')) as ZipWorkResult;
      if (saved.entries.every(entry => fs.existsSync(entry.path) && fs.statSync(entry.path).size === entry.size)) {
        return Promise.resolve({ ...saved, reused: true });
      }
    } catch {
      /* extract again */
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const root = path.resolve(dir, 'x');
  fs.mkdirSync(root, { recursive: true });
  const entries: ZipWorkEntry[] = [];
  const failed: ZipWorkResult['failed'] = [];
  return extractOne(zipPath, root, prefix, 0, entries, failed, new Set(), expandNested).then(() => {
    const out: ZipWorkResult = { dir, entries, failed, reused: false };
    try { fs.writeFileSync(manifest, JSON.stringify(out)); } catch { /* best effort */ }
    return out;
  });
}

/** Folder import: every file, plus the contents of any zip still sitting in the folder. */
export async function inventoryFolder(dir: string, cacheRoot: string, prefix = ''): Promise<ZipWorkEntry[]> {
  const out: ZipWorkEntry[] = [];
  const walk = (current: string, relBase: string) => {
    const ents = fs.readdirSync(current, { withFileTypes: true });
    for (const ent of ents) {
      if (ent.name.endsWith('.uwrp-part') || ent.name === '_uwrp_zipwork.json') continue;
      const abs = path.join(current, ent.name);
      const rel = `${relBase}${ent.name}`;
      if (ent.isDirectory()) walk(abs, `${rel}/`);
      else if (ent.isFile()) {
        const lower = rel.toLowerCase();
        if (lower.includes('__macosx/') || lower.endsWith('.ds_store')) continue;
        const size = fs.statSync(abs).size;
        out.push({ path: abs, rel, name: ent.name, size, head: headHex(abs) });
      }
    }
  };
  walk(dir, prefix);
  const zips = out.filter(entry => entry.name.toLowerCase().endsWith('.zip'));
  for (const zip of zips) {
    const nested = await extractZipToWorkspace(zip.path, path.join(cacheRoot, 'nested', crypto.createHash('sha1').update(zip.rel).digest('hex').slice(0, 12)), `${zip.rel.replace(/\.zip$/i, '')}/`);
    for (const entry of nested.entries) {
      if (!out.some(have => have.rel === entry.rel && have.size === entry.size)) out.push(entry);
    }
  }
  return out;
}
