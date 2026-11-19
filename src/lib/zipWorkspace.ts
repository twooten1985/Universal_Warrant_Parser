/**
 * Stream a zip from disk one entry at a time (yauzl). The original zip is opened read-only.
 * Nested zips are expanded the same way a folder import expands them, so a direct zip load
 * and a pre-extracted folder load list the same files. Nothing is turned into one giant string.
 *
 * A bad entry, a nested archive that is not a zip, a long path, or an illegal character
 * is recorded on `failed` and the rest of the return continues.
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

/** Release check marker. The Windows package must still contain this module. */
export const ZIP_WORKSPACE_ID = 'zipWorkspace';

const NESTED_DEPTH = 64;
const MAX_ENTRIES = 250000;
/** Stay under Windows MAX_PATH even when the cache directory is already long. */
const MAX_DISK_PATH = 240;

const skip = (rel: string) => {
  const l = rel.toLowerCase();
  return l.includes('__macosx/') || l.endsWith('.ds_store') || l.endsWith('/');
};

function headHex(filePath: string): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(32);
    const n = fs.readSync(fd, b, 0, 32, 0);
    return b.subarray(0, n).toString('hex');
  } catch {
    return '';
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function asError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Disk name. The original `rel` is kept for the examiner. */
export function diskRelative(rel: string): string {
  const parts = String(rel || '').replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part === '.' || part === '..') continue;
    let safe = part.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
    if (!safe || safe === '.' || safe === '..') safe = '_blank';
    const stem = safe.replace(/\.[^.]+$/, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) safe = `_${safe}`;
    if (Buffer.byteLength(safe) > 160) {
      const ext = path.posix.extname(safe).slice(0, 20);
      const hash = crypto.createHash('sha1').update(part).digest('hex').slice(0, 8);
      safe = `${safe.slice(0, 120)}_${hash}${ext}`;
    }
    out.push(safe);
  }
  let joined = out.join('/');
  if (!joined) joined = '_blank';
  if (joined.length > 180) {
    const hash = crypto.createHash('sha1').update(rel).digest('hex').slice(0, 20);
    const base = path.posix.basename(joined) || 'file';
    joined = path.posix.join('long', hash, base);
  }
  return joined;
}

function winPath(target: string): string {
  if (process.platform !== 'win32') return target;
  const full = path.resolve(target);
  if (full.startsWith('\\\\?\\')) return full;
  if (full.startsWith('\\\\')) return `\\\\?\\UNC\\${full.slice(2)}`;
  return `\\\\?\\${full}`;
}

export function workDirFor(cacheRoot: string, zipPath: string): string {
  const st = fs.statSync(zipPath);
  const key = crypto.createHash('sha1').update(`${path.resolve(zipPath)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20);
  return path.join(cacheRoot, 'zipwork', key);
}

function openZip(zipPath: string): Promise<any> {
  const yauzl = req('yauzl');
  const options = {
    lazyEntries: true,
    autoClose: false,
    decodeStrings: true,
    strictFileNames: false,
    validateEntrySizes: false,
  };
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, options, (err: Error | null, zip: any) => {
      if (!err && zip) return resolve(zip);
      yauzl.open(zipPath, { ...options, decodeStrings: false }, (err2: Error | null, zip2: any) => {
        if (err2 || !zip2) return reject(err2 || err || new Error('Could not open zip'));
        resolve(zip2);
      });
    });
  });
}

function entryName(entry: { fileName: string | Buffer }): string {
  const raw = Buffer.isBuffer(entry.fileName) ? entry.fileName.toString('utf8') : String(entry.fileName || '');
  return raw.replace(/\0/g, '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function streamEntry(zip: any, entry: any, target: string, want: number): Promise<number> {
  const diskTarget = winPath(target);
  const part = `${diskTarget}.uwrp-part`;
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err: Error | null, rs: any) => {
      if (err || !rs) return reject(err || new Error('no stream'));
      let ws: fs.WriteStream;
      try {
        fs.mkdirSync(path.dirname(diskTarget), { recursive: true });
        ws = fs.createWriteStream(part);
      } catch (mkdirErr) {
        try { rs.destroy(); } catch { /* already closed */ }
        return reject(mkdirErr);
      }
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
        try {
          fs.rmSync(diskTarget, { force: true });
          fs.renameSync(part, diskTarget);
          resolve(n);
        } catch (e) {
          fail(e);
        }
      });
      rs.pipe(ws);
    });
  });
}

function allocateTarget(root: string, diskRel: string, used: Set<string>): string | null {
  const rootResolved = path.resolve(root);
  let rel = diskRel;
  if (rootResolved.length + 1 + rel.length > MAX_DISK_PATH) {
    const hash = crypto.createHash('sha1').update(diskRel).digest('hex').slice(0, 20);
    const base = path.posix.basename(diskRel) || 'file';
    rel = path.posix.join('long', hash, base);
  }
  let target = path.resolve(rootResolved, rel);
  if (!target.startsWith(rootResolved + path.sep) && target !== rootResolved) return null;
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
  expandNested: boolean,
  seenZips: Set<string>
): Promise<void> {
  if (depth > NESTED_DEPTH || entries.length >= MAX_ENTRIES) return;
  const seenKey = path.resolve(zipPath);
  if (seenZips.has(seenKey)) return;
  seenZips.add(seenKey);
  let zip: any;
  try {
    zip = await openZip(zipPath);
  } catch (err) {
    failed.push({ rel: prefix || path.basename(zipPath), error: asError(err) });
    return;
  }
  const nested: Array<{ zipPath: string; prefix: string }> = [];
  await new Promise<void>((resolve) => {
    let settled = false;
    let capped = false;
    const finishZip = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    zip.on('error', (err: Error) => {
      failed.push({ rel: prefix || path.basename(zipPath), error: asError(err) });
      finishZip();
    });
    zip.on('end', () => finishZip());
    zip.on('entry', (entry: any) => {
      const next = () => {
        if (capped || settled) return finishZip();
        try { zip.readEntry(); } catch (err) { failed.push({ rel: prefix || path.basename(zipPath), error: asError(err) }); finishZip(); }
      };
      try {
        const rel = `${prefix}${entryName(entry)}`;
        if (entries.length >= MAX_ENTRIES) {
          if (!capped) {
            capped = true;
            failed.push({ rel: rel || prefix || path.basename(zipPath), error: 'entry cap reached; remaining entries were not extracted' });
          }
          return finishZip();
        }
        if (skip(rel) || !rel || rel.includes('\0')) return next();
        const target = allocateTarget(root, diskRelative(rel), used);
        if (!target) {
          failed.push({ rel, error: 'unsafe path skipped' });
          return next();
        }
        const want = Number(entry.uncompressedSize);
        const finish = (written: number) => {
          try {
            const size = fs.statSync(winPath(target)).size;
            entries.push({
              path: target,
              rel,
              name: path.posix.basename(rel) || path.basename(target),
              size,
              head: headHex(winPath(target)),
            });
            if (Number.isFinite(want) && want > 0 && written !== want) {
              failed.push({ rel, error: `zip size ${want} did not match bytes written (${written}); kept the extracted file` });
            }
            if (expandNested && rel.toLowerCase().endsWith('.zip') && depth < NESTED_DEPTH && size > 0 && size < 8 * 1024 * 1024 * 1024) {
              nested.push({ zipPath: target, prefix: `${rel.replace(/\.zip$/i, '')}/` });
            }
          } catch (err) {
            failed.push({ rel, error: asError(err) });
          }
          next();
        };
        streamEntry(zip, entry, target, want).then(finish).catch((err) => {
          failed.push({ rel, error: asError(err) });
          next();
        });
      } catch (err) {
        failed.push({ rel: prefix || path.basename(zipPath), error: asError(err) });
        next();
      }
    });
    try { zip.readEntry(); } catch (err) {
      failed.push({ rel: prefix || path.basename(zipPath), error: asError(err) });
      finishZip();
    }
  });
  try { zip.close(); } catch { /* already closed */ }
  for (let i = 0; i < nested.length; i++) {
    const child = nested[i];
    try {
      await extractOne(child.zipPath, root, child.prefix, depth + 1, entries, failed, used, expandNested, seenZips);
    } catch (err) {
      failed.push({ rel: child.prefix, error: asError(err) });
    }
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
  return extractOne(zipPath, root, prefix, 0, entries, failed, new Set(), expandNested, new Set()).then(() => {
    const out: ZipWorkResult = { dir, entries, failed, reused: false };
    try { fs.writeFileSync(manifest, JSON.stringify({ ...out, entries, failed })); } catch { /* best effort */ }
    return out;
  });
}

/** Folder import: every file, plus the contents of any zip still sitting in the folder. */
export async function inventoryFolder(dir: string, cacheRoot: string, prefix = ''): Promise<ZipWorkEntry[]> {
  const listed = await inventoryFolderDetailed(dir, cacheRoot, prefix);
  return listed.entries;
}

export async function inventoryFolderDetailed(
  dir: string,
  cacheRoot: string,
  prefix = ''
): Promise<{ entries: ZipWorkEntry[]; failed: ZipWorkResult['failed'] }> {
  const out: ZipWorkEntry[] = [];
  const failed: ZipWorkResult['failed'] = [];
  const walk = (current: string, relBase: string) => {
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      failed.push({ rel: relBase || '.', error: asError(err) });
      return;
    }
    for (let i = 0; i < ents.length; i++) {
      const ent = ents[i];
      if (ent.name.endsWith('.uwrp-part') || ent.name === '_uwrp_zipwork.json') continue;
      const abs = path.join(current, ent.name);
      const rel = `${relBase}${ent.name}`;
      try {
        if (ent.isDirectory()) walk(abs, `${rel}/`);
        else if (ent.isFile()) {
          const lower = rel.toLowerCase();
          if (lower.includes('__macosx/') || lower.endsWith('.ds_store')) continue;
          const size = fs.statSync(abs).size;
          out.push({ path: abs, rel, name: ent.name, size, head: headHex(abs) });
        }
      } catch (err) {
        failed.push({ rel, error: asError(err) });
      }
    }
  };
  walk(dir, prefix);
  const seen = new Set(out.map(entry => `${entry.rel}|${entry.size}`));
  const zips = out.filter(entry => entry.name.toLowerCase().endsWith('.zip'));
  for (let i = 0; i < zips.length; i++) {
    const zip = zips[i];
    try {
      const nested = await extractZipToWorkspace(
        zip.path,
        path.join(cacheRoot, 'nested', crypto.createHash('sha1').update(zip.rel).digest('hex').slice(0, 12)),
        `${zip.rel.replace(/\.zip$/i, '')}/`
      );
      for (let n = 0; n < nested.failed.length; n++) failed.push(nested.failed[n]);
      for (let n = 0; n < nested.entries.length; n++) {
        const entry = nested.entries[n];
        const key = `${entry.rel}|${entry.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
      }
    } catch (err) {
      failed.push({ rel: zip.rel, error: asError(err) });
    }
  }
  return { entries: out, failed };
}
