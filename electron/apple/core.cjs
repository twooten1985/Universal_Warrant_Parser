'use strict';
/**
 * Apple iCloud return importer: main-process core.
 * Rules: passcodes are Buffers in memory only and go to gpg via stdin (never argv, logs or settings).
 * Signed links are secrets: only the host is ever logged. Originals (.gpg) are never modified.
 * Nothing here creates previews or thumbnails.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

// ---------- gpg ----------
function findGpg(resourcesDir) {
  const cands = [];
  if (resourcesDir) cands.push(path.join(resourcesDir, 'gpg', process.platform === 'win32' ? 'gpg.exe' : 'gpg'));
  cands.push(path.join(__dirname, '..', '..', 'resources', 'gpg', process.platform === 'win32' ? 'gpg.exe' : 'gpg'));
  if (process.platform === 'win32') {
    cands.push('C:\\Program Files (x86)\\GnuPG\\bin\\gpg.exe', 'C:\\Program Files\\GnuPG\\bin\\gpg.exe',
      'C:\\Program Files (x86)\\Gpg4win\\bin\\gpg.exe');
  } else {
    cands.push('/usr/bin/gpg', '/usr/local/bin/gpg', '/opt/homebrew/bin/gpg');
  }
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
  return null;
}

/** Remove anything that could echo secrets from gpg stderr before showing/logging it. */
function sanitizeGpgMessage(s) {
  return String(s || '').split(/\r?\n/).filter(l => /gpg:/.test(l))
    .map(l => l.replace(/https?:\/\/\S+/g, '<link>')).join('\n').slice(0, 2000);
}

/** Symmetric decrypt. pass is a Buffer; written to stdin only. Throws {code:'BAD_PASS'} on wrong passcode. */
function gpgDecrypt(gpgPath, inFile, outFile, pass) {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-gpg-'));
    const args = ['--homedir', home, '--batch', '--yes', '--no-tty', '--pinentry-mode', 'loopback',
      '--passphrase-fd', '0', '--no-symkey-cache', '--output', outFile + '.uwrp-part', '--decrypt', inFile]; // /*uwrp-b7*/ renamed only on success
    const child = spawn(gpgPath, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => { cleanup(); reject(e); });
    child.on('close', code => {
      cleanup();
      if (code === 0) { try { fs.renameSync(outFile + '.uwrp-part', outFile); } catch (e) { return reject(e); } return resolve({ ok: true }); }
      try { fs.rmSync(outFile + '.uwrp-part', { force: true }); } catch {}
      const msg = sanitizeGpgMessage(err);
      const e = new Error(/bad (session key|passphrase)|decryption failed/i.test(msg) ? 'Wrong passcode (gpg could not decrypt).' : 'gpg failed: ' + msg);
      e.code = /bad (session key|passphrase)/i.test(msg) ? 'BAD_PASS' : 'GPG_FAIL';
      reject(e);
    });
    child.stdin.on('error', () => {});
    child.stdin.write(pass);
    child.stdin.end('\n');
    function cleanup() {
      // stop the per-run gpg-agent so no process keeps the temp home (or cached keys) alive
      try { const gc = path.join(path.dirname(gpgPath), process.platform === 'win32' ? 'gpgconf.exe' : 'gpgconf'); if (fs.existsSync(gc)) require('child_process').spawnSync(gc, ['--homedir', home, '--kill', 'gpg-agent'], { windowsHide: true, timeout: 5000 }); } catch {}
      try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    }
  });
}

// ---------- hashing ----------
function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// ---------- zip extraction (streaming, zip-slip safe, nested zips) ----------
function extractZip(zipPath, destDir, opts = {}) {
  const yauzl = require('yauzl');
  const depth = opts.depth || 0;
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      const out = [];
      const nested = [];
      const root = path.resolve(destDir);
      zip.on('error', reject);
      zip.on('end', async () => {
        try {
          for (const n of nested) {
            if (depth >= 3) break;
            const sub = n + '.extracted';
            const more = await extractZip(n, sub, { depth: depth + 1 });
            out.push(...more); if (more.failed) (out.failed || (out.failed = [])).push(...more.failed); if (more.repaired) (out.repaired || (out.repaired = [])).push(...more.repaired);
          }
          resolve(out);
        } catch (e) { reject(e); }
      });
      zip.on('entry', entry => {
        const name = entry.fileName.replace(/\\/g, '/');
        if (name.includes('__MACOSX/') || /\.DS_Store$/.test(name)) return zip.readEntry();
        let target = path.resolve(root, name);
        if (target !== root && !target.startsWith(root + path.sep)) return zip.readEntry(); // zip-slip
        if (/\/$/.test(name)) { fs.mkdirSync(target, { recursive: true }); return zip.readEntry(); }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // /*uwrp-b7*/ Write to a .uwrp-part file and rename only when the byte count matches the zip entry.
        // beta.6 wrote straight to the target with flag 'wx' and skipped any existing file, so a run that was
        // interrupted (or an entry that failed mid-stream) left a 0-byte / truncated working copy that every
        // later import kept forever ("0 KB, won't display").
        if (out.includes(target)) { const ext = path.extname(target); const stem = ext ? target.slice(0, -ext.length) : target; let i = 2; while (out.includes(`${stem} (${i})${ext}`)) i++; target = `${stem} (${i})${ext}`; } // duplicate entry name in one zip
        const want = entry.uncompressedSize;
        let have = -1; try { have = fs.statSync(target).size; } catch {}
        if (have === want) { out.push(target); if (/\.zip$/i.test(name)) nested.push(target); return zip.readEntry(); }
        const part = target + '.uwrp-part';
        const fail = (why) => { try { fs.rmSync(part, { force: true }); } catch {} (out.failed || (out.failed = [])).push({ name, error: String(why && why.message || why) }); zip.readEntry(); };
        zip.openReadStream(entry, (e2, rs) => {
          if (e2) return fail(e2);
          const ws = fs.createWriteStream(part, { flags: 'w' });
          let n = 0, bad = null;
          rs.on('data', d => { n += d.length; });
          rs.on('error', e => { bad = e; ws.destroy(); fail(e); });
          ws.on('error', e => { if (!bad) { bad = e; rs.destroy(); fail(e); } });
          ws.on('finish', () => {
            if (bad) return;
            if (n !== want) return fail(new Error(`size mismatch ${n} != ${want}`));
            try { if (have >= 0) fs.rmSync(target, { force: true }); fs.renameSync(part, target); } catch (e) { return fail(e); }
            if (have >= 0) (out.repaired || (out.repaired = [])).push({ name, was: have, now: n });
            out.push(target);
            if (/\.zip$/i.test(name)) nested.push(target);
            zip.readEntry();
          });
          rs.pipe(ws);
        });
      });
      zip.readEntry();
    });
  });
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  text = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}
function csvCell(v) { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function parseSize(s) {
  const m = String(s || '').trim().match(/^([\d.,]+)\s*(bytes?|b|kb|mb|gb|tb)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const u = (m[2] || 'b').toLowerCase();
  const mul = u.startsWith('k') ? 1024 : u.startsWith('m') ? 1024 ** 2 : u.startsWith('g') ? 1024 ** 3 : u.startsWith('t') ? 1024 ** 4 : 1;
  return Math.round(n * mul);
}

function parseExpiryDate(s) {
  const m = String(s || '').match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], 23, 59, 59);
}

/** Parse Apple's links CSV into manifest items. Accounts are discovered from the File_Name prefix. */
function parseLinksCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const hdr = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => hdr.findIndex(h => names.includes(h));
  const iType = col('data_type'), iName = col('file_name'), iLink = col('file_link'), iFT = col('file_type'),
    iSize = col('gpg_size'), iSha = col('gpg_sha256'), iExp = col('link expiry date', 'link_expiry_date');
  if (iName < 0 || iLink < 0) throw new Error('This CSV does not have File_Name and File_Link columns.');
  return rows.slice(1).map((r, idx) => {
    const name = path.basename((r[iName] || '').trim());
    const url = (r[iLink] || '').trim();
    let host = '', expiresAt = null;
    try { const u = new URL(url); host = u.host; const e = u.searchParams.get('Expires'); if (e && /^\d+$/.test(e)) expiresAt = +e * 1000; } catch {}
    const m = name.match(/^(\d+)-([A-Z][A-Z-]*?)-(\d+)\.zip\.gpg$/i);
    const listExp = iExp >= 0 ? parseExpiryDate(r[iExp]) : null;
    return {
      idx, name, url, host,
      dataType: iType >= 0 ? (r[iType] || '').trim() : '',
      fileType: iFT >= 0 ? (r[iFT] || '').trim() : '',
      sizeText: iSize >= 0 ? (r[iSize] || '').trim() : '',
      approxBytes: iSize >= 0 ? parseSize(r[iSize]) : null,
      expectedSha256: iSha >= 0 ? (r[iSha] || '').trim().toLowerCase() : '',
      expiryText: iExp >= 0 ? (r[iExp] || '').trim() : '',
      expiresAt: expiresAt || listExp,
      account: m ? m[1] : '',
      typeCode: m ? m[2].toUpperCase() : '',
      fileId: m ? m[3] : '',
    };
  }).filter(x => x.name && x.url);
}

function linkSafe(item) { return { ...item, url: undefined }; }

// ---------- production folder discovery ----------
function walk(dir, out = [], depth = 0) {
  if (depth > 20) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1); else if (e.isFile()) out.push(p);
  }
  return out;
}

function inspectProduction(root) {
  const files = walk(root);
  const linksCsv = files.filter(f => /account_data_links/i.test(f) && /\.csv$/i.test(f));
  const html = files.filter(f => /account_data_links/i.test(f) && /\.html?$/i.test(f));
  const xlsx = files.filter(f => /\.xlsx$/i.test(f));
  const pdf = files.filter(f => /\.pdf$/i.test(f));
  const bash = files.filter(f => /\.(bash|sh)$/i.test(f));
  return {
    root, linksCsv, html, bash, pdf,
    dataGuide: xlsx.find(f => /data_guide/i.test(path.basename(f))) || null,
    accountWorkbook: xlsx.find(f => /apple.?confidential/i.test(path.basename(f))) || null,
    xlsx,
  };
}

// ---------- xlsx -> csv (derived text tables, never media) ----------
async function readXlsx(p) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(await fsp.readFile(p));
  const txt = async n => (zip.file(n) ? zip.file(n).async('string') : '');
  const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
  const ss = [];
  const sst = await txt('xl/sharedStrings.xml');
  for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) || []) {
    ss.push(dec((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
  }
  // date styles
  const styles = await txt('xl/styles.xml');
  const customDate = new Set();
  for (const m of styles.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) if (/[dmyhs]/i.test(m[2].replace(/"[^"]*"|\[[^\]]*\]/g, ''))) customDate.add(+m[1]);
  const xfs = ((styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0].match(/<xf [^>]*>/g) || []).map(x => +((x.match(/numFmtId="(\d+)"/) || [0, 0])[1]));
  const isDateFmt = id => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate.has(id);
  const wb = await txt('xl/workbook.xml');
  const rels = await txt('xl/_rels/workbook.xml.rels');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
  for (const m of rels.matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) relMap[m[2]] = m[1];
  const sheets = [];
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    let target = relMap[m[2]] || ''; target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const xml = await txt('xl/' + target);
    const rows = [];
    for (const r of xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) || []) {
      const cells = [];
      for (const c of r.match(/<c [^>]*?(\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = (c.match(/r="([A-Z]+)\d+"/) || [])[1];
        const t = (c.match(/ t="(\w+)"/) || [])[1];
        const s = +((c.match(/ s="(\d+)"/) || [0, 0])[1]);
        let v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (t === 's') v = ss[+v];
        else if (t === 'inlineStr') v = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        else if (v != null && t !== 'str' && t !== 'b' && t !== 'e' && isDateFmt(xfs[s] || 0)) {
          const n = parseFloat(v); if (isFinite(n)) v = new Date(Math.round((n - 25569) * 86400000)).toISOString().replace('.000Z', '').replace('T', ' ');
        }
        if (v != null && t !== 's') v = dec(String(v));
        let col = 0; if (ref) for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64); col = col ? col - 1 : cells.length;
        cells[col] = v == null ? '' : String(v);
      }
      rows.push(Array.from(cells, x => x || ''));
    }
    sheets.push({ name: dec(m[1]), rows });
  }
  return sheets;
}

/** Split Apple's sheet preamble ("Apple Confidential", DSID:, Period:, Timezone:) from the table. */
function splitPreamble(rows) {
  let hdr = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const filled = rows[i].filter(x => String(x).trim() !== '').length;
    if (filled >= 2 && rows[i].every(x => String(x).length < 80)) { hdr = i; break; }
  }
  const pre = (hdr < 0 ? rows : rows.slice(0, hdr)).map(r => r.filter(Boolean).join(' ').trim()).filter(Boolean);
  return { preamble: pre, header: hdr < 0 ? [] : rows[hdr], data: hdr < 0 ? [] : rows.slice(hdr + 1) };
}

async function xlsxToCsvFiles(xlsxPath, outDir, baseName) {
  const sheets = await readXlsx(xlsxPath);
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const s of sheets) {
    const { preamble, header, data } = splitPreamble(s.rows);
    const safe = (baseName + '__' + s.name).replace(/[^\w.\- ]+/g, '_');
    const p = path.join(outDir, safe + '.csv');
    const lines = [...preamble.map(l => '# ' + l.replace(/[\r\n]+/g, ' ')), '# Sheet: ' + s.name, '# Source: ' + path.basename(xlsxPath)];
    if (header.length) lines.push(header.map(csvCell).join(','));
    for (const r of data) lines.push(r.map(csvCell).join(','));
    await fsp.writeFile(p, lines.join('\r\n'), { flag: 'w' });
    written.push({ path: p, sheet: s.name, rows: data.length, preamble });
  }
  return written;
}

// ---------- backups (phase 2 detection only) ----------
function detectBackups(root) {
  const files = walk(root);
  const manifests = files.filter(f => /^Manifest\.db$/i.test(path.basename(f)));
  const out = [];
  const dirs = new Set(manifests.map(path.dirname));
  for (const f of files.filter(f => /^(Manifest\.plist|Info\.plist|Status\.plist)$/i.test(path.basename(f)))) dirs.add(path.dirname(f));
  for (const d of dirs) {
    const has = n => fs.existsSync(path.join(d, n));
    let encrypted = 'unknown';
    try {
      const b = fs.readFileSync(path.join(d, 'Manifest.plist'));
      const s = b.toString('latin1');
      if (s.startsWith('<?xml') || s.includes('<plist')) encrypted = /<key>IsEncrypted<\/key>\s*<true\s*\/>/.test(s) ? 'yes' : (/<key>IsEncrypted<\/key>/.test(s) ? 'no' : 'unknown');
      else if (s.startsWith('bplist')) encrypted = s.includes('IsEncrypted') ? 'unknown (binary plist)' : 'no';
    } catch {}
    out.push({ dir: d, manifestDb: has('Manifest.db'), manifestPlist: has('Manifest.plist'), infoPlist: has('Info.plist'), statusPlist: has('Status.plist'), encrypted });
  }
  // /*uwrp-b9*/ iCloud "snapshot asset" layout (D_<device>/S_<snapshot>/A_… files, no Manifest.db), possibly split over several BACKUP zips
  const snaps = new Map();
  for (const f of files) { const s = path.dirname(f), dd = path.dirname(s);
    if (!/^S_[0-9A-F-]{36}$/i.test(path.basename(s)) || !/^D_[0-9a-f]{40}$/i.test(path.basename(dd))) continue;
    const k = (path.basename(dd) + '/' + path.basename(s)).toLowerCase(); if (!snaps.has(k)) snaps.set(k, { parts: new Set(), files: 0, placeholders: 0 });
    const g = snaps.get(k); g.parts.add(s); /^N_/.test(path.basename(f)) ? g.placeholders++ : g.files++; }
  for (const g of snaps.values()) { const parts = [...g.parts].sort();
    out.push({ dir: parts[0], layout: 'icloud-snapshot', parts: parts.length, files: g.files, placeholders: g.placeholders, manifestDb: false, manifestPlist: false, infoPlist: false, statusPlist: false, encrypted: 'no' }); }
  return out;
}

// ---------- coverage / accounts ----------
function summarizeExtracted(extractedRoot) {
  const accounts = {};
  let tops = [];
  try { tops = fs.readdirSync(extractedRoot, { withFileTypes: true }).filter(e => e.isDirectory()); } catch {}
  for (const t of tops) {
    if (/^\d+$/.test(t.name)) { // uwrp-b7 bash layout
      for (const u of bashUnits(path.join(extractedRoot, t.name))) {
        const files = walk(u.path); const real = files.filter(f => !/^(Summary\.txt|DownloadSummary\.txt|Metadata\.txt)$/i.test(path.basename(f)));
        const a = accounts[u.account] || (accounts[u.account] = { account: u.account, identifiers: new Set(), types: {} });
        a.identifiers.add(u.identity);
        const prev = a.types[u.type];
        a.types[u.type] = { status: (prev && prev.status === 'data') || real.length ? 'data' : 'empty', files: (prev ? prev.files : 0) + files.length };
      }
      continue;
    }
    const m = t.name.match(/^(\d+)-([A-Z][A-Z-]*?)-(\d+)$/i);
    if (!m) continue;
    const acct = m[1], type = m[2].toUpperCase();
    const files = walk(path.join(extractedRoot, t.name));
    const real = files.filter(f => !/^(Summary\.txt|DownloadSummary\.txt|Metadata\.txt)$/i.test(path.basename(f)));
    const a = accounts[acct] || (accounts[acct] = { account: acct, identifiers: new Set(), types: {} });
    for (const f of files) {
      const rel = path.relative(path.join(extractedRoot, t.name), f).split(path.sep);
      if (rel.length >= 3 && rel[0] === acct) a.identifiers.add(rel[1]);
    }
    const prev = a.types[type];
    const status = real.length ? 'data' : 'empty';
    a.types[type] = { status: prev && prev.status === 'data' ? 'data' : status, files: (prev ? prev.files : 0) + files.length };
  }
  return Object.values(accounts).map(a => ({ ...a, identifiers: [...a.identifiers], phoneOnly: [...a.identifiers].length > 0 && [...a.identifiers].every(i => /^Ph_/i.test(i)) }));
}

// ---------- custody log ----------
class CustodyLog {
  constructor(dir, meta) {
    this.dir = dir; this.jsonl = path.join(dir, 'custody_log.jsonl'); this.csv = path.join(dir, 'custody_log.csv'); this.meta = meta || {};
    fs.mkdirSync(dir, { recursive: true });
  }
  write(event, fields = {}) {
    const rec = { ts: new Date().toISOString(), event, examiner: this.meta.examiner || '', machine: os.hostname(), app: this.meta.appVersion || '', ...fields };
    for (const k of Object.keys(rec)) {
      if (/pass|secret|token|signature/i.test(k)) delete rec[k];
      if (typeof rec[k] === 'string') rec[k] = rec[k].replace(/https?:\/\/[^\s"]+/g, m => { try { return new URL(m).host; } catch { return '<link>'; } });
    }
    fs.appendFileSync(this.jsonl, JSON.stringify(rec) + '\n');
    return rec;
  }
  exportCsv() {
    const lines = fs.existsSync(this.jsonl) ? fs.readFileSync(this.jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    const cols = ['ts', 'event', 'examiner', 'machine', 'app', 'account', 'type', 'file', 'host', 'bytes', 'expectedSha256', 'sha256', 'match', 'result', 'path', 'error'];
    const out = [cols.join(',')].concat(lines.map(r => cols.map(c => csvCell(r[c])).join(',')));
    fs.writeFileSync(this.csv, out.join('\r\n'));
    return this.csv;
  }
}

// ---------- downloader ----------
class Downloader extends EventEmitter {
  constructor(items, outDir, opts = {}) {
    super();
    this.outDir = outDir; this.concurrency = opts.concurrency || 3; this.maxRetries = opts.maxRetries ?? 5;
    this.log = opts.log; this.paused = false; this.active = new Map();
    this.allowInsecureLocal = !!opts.allowInsecureLocal; // tests only: http://127.0.0.1
    this.items = items.map(it => ({ ...it, status: 'queued', bytes: 0, total: it.approxBytes || 0, attempts: 0, speed: 0, sha256: '', match: null, error: '' }));
    fs.mkdirSync(outDir, { recursive: true });
  }
  publicItems() { return this.items.map(i => ({ idx: i.idx, name: i.name, account: i.account, typeCode: i.typeCode, dataType: i.dataType, status: i.status, bytes: i.bytes, total: i.total, attempts: i.attempts, speed: i.speed, sha256: i.sha256, expectedSha256: i.expectedSha256, match: i.match, error: i.error, expiresAt: i.expiresAt, host: i.host, path: i.path })); }
  emitUpdate(it) { this.emit('item', this.publicItems().find(x => x.idx === it.idx)); }
  start() { this.paused = false; this.pump(); }
  pause() { this.paused = true; for (const [idx, req] of this.active) { const it = this.items.find(i => i.idx === idx); it.status = 'paused'; it._paused = true; req.destroy(); this.emitUpdate(it); } }
  retry(idx) { const it = this.items.find(i => i.idx === idx); if (it && /failed|mismatch|paused|expired/.test(it.status)) { it.status = 'queued'; it.attempts = 0; it.error = ''; this.emitUpdate(it); this.pump(); } }
  skip(idx) { const it = this.items.find(i => i.idx === idx); if (it && it.status === 'queued') { it.status = 'skipped'; this.emitUpdate(it); this.pump(); } }
  pump() {
    if (this.paused) return;
    for (const it of this.items) { if (it.status === 'paused') it.status = 'queued'; }
    while (this.active.size < this.concurrency) {
      const next = this.items.find(i => i.status === 'queued');
      if (!next) break;
      this.run(next);
    }
    if (this.active.size === 0 && !this.items.some(i => i.status === 'queued' || i.status === 'downloading')) {
      this.emit('done', this.publicItems());
    }
  }
  async run(it) {
    it.status = 'downloading'; it.attempts++; it._paused = false; it.error = '';
    if (it.expiresAt && Date.now() > it.expiresAt) { it.status = 'expired'; it.error = 'Link expired. Request new links from Apple.'; this.log && this.log.write('download-expired', { account: it.account, type: it.typeCode, file: it.name, host: it.host }); this.emitUpdate(it); return this.pump(); }
    const final = path.join(this.outDir, it.name);
    const part = final + '.part';
    it.path = final;
    if (fs.existsSync(final) && it.expectedSha256) {
      const h = await sha256File(final);
      if (h === it.expectedSha256) { it.sha256 = h; it.match = true; it.status = 'verified'; it.bytes = it.total = fs.statSync(final).size; this.log && this.log.write('download-already-present', { account: it.account, type: it.typeCode, file: it.name, host: it.host, bytes: it.bytes, expectedSha256: it.expectedSha256, sha256: h, match: true, result: 'ok' }); this.emitUpdate(it); return this.pump(); }
    }
    const hash = crypto.createHash('sha256');
    let start = 0;
    if (fs.existsSync(part)) {
      start = fs.statSync(part).size;
      await new Promise((res, rej) => fs.createReadStream(part).on('data', d => hash.update(d)).on('end', res).on('error', rej));
    }
    this.log && this.log.write('download-start', { account: it.account, type: it.typeCode, file: it.name, host: it.host, bytes: start, result: start ? 'resume' : 'new' });
    this.emitUpdate(it);
    const finish = (ok, err) => {
      this.active.delete(it.idx);
      if (it._paused) { this.log && this.log.write('download-paused', { file: it.name, bytes: it.bytes }); this.emitUpdate(it); return; }
      if (!ok) {
        if (it.attempts < this.maxRetries && !/expired|403|404|410/.test(String(err))) {
          it.status = 'queued'; it.error = String(err).slice(0, 200);
          this.emitUpdate(it);
          setTimeout(() => this.pump(), Math.min(30000, 1000 * 2 ** it.attempts));
          return;
        }
        it.status = /403/.test(String(err)) ? 'expired' : 'failed'; it.error = String(err).slice(0, 300);
        this.log && this.log.write('download-failed', { account: it.account, type: it.typeCode, file: it.name, host: it.host, bytes: it.bytes, error: it.error, result: it.status });
      }
      this.emitUpdate(it); this.pump();
    };
    const get = (urlStr, redirects) => {
      let u; try { u = new URL(urlStr); } catch { return finish(false, 'bad link'); }
      const isLocal = u.protocol === 'http:' && this.allowInsecureLocal && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
      if (u.protocol !== 'https:' && !isLocal) return finish(false, 'refusing non-https link');
      const mod = u.protocol === 'https:' ? https : http;
      const headers = { 'User-Agent': 'UWRP-AppleImporter' };
      if (start > 0) headers.Range = `bytes=${start}-`;
      const req = mod.get(u, { headers, timeout: 60000 }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) { res.resume(); this.active.delete(it.idx); return get(new URL(res.headers.location, u).toString(), redirects + 1); }
        if (start > 0 && res.statusCode === 200) { start = 0; return restart(res); }
        if (res.statusCode === 416 && start > 0) { res.resume(); return complete(); }
        if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return finish(false, 'HTTP ' + res.statusCode + (res.statusCode === 403 ? ' (link expired or not authorized)' : '')); }
        pipeBody(res, hash, start);
      });
      this.active.set(it.idx, req);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', e => { if (!it._paused) finish(false, e.message); else finish(false, 'paused'); });
    };
    const restart = res => { // server ignored Range: start over
      const h2 = crypto.createHash('sha256');
      try { fs.rmSync(part, { force: true }); } catch {}
      pipeBody(res, h2, 0);
    };
    const pipeBody = (res, h, offset) => {
      const len = +res.headers['content-length'] || 0;
      if (len) it.total = offset + len;
      it.bytes = offset;
      const ws = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' });
      let last = Date.now(), lastBytes = it.bytes;
      res.on('data', d => {
        h.update(d); it.bytes += d.length;
        const now = Date.now();
        if (now - last > 400) { it.speed = Math.round((it.bytes - lastBytes) / ((now - last) / 1000)); last = now; lastBytes = it.bytes; this.emitUpdate(it); }
      });
      res.on('error', () => {});
      res.on('close', () => { if (!res.complete) ws.end(); });
      res.pipe(ws);
      ws.on('finish', () => {
        if (it._paused) return finish(false, 'paused');
        if (len && it.bytes < offset + len) return finish(false, 'connection dropped');
        complete(h);
      });
      ws.on('error', e => finish(false, e.message));
    };
    const complete = async h => {
      this.active.delete(it.idx);
      const digest = h ? h.digest('hex') : await sha256File(part);
      it.sha256 = digest;
      it.match = it.expectedSha256 ? digest === it.expectedSha256 : null;
      if (it.match === false) {
        this.log && this.log.write('download-hash-mismatch', { account: it.account, type: it.typeCode, file: it.name, host: it.host, bytes: it.bytes, expectedSha256: it.expectedSha256, sha256: digest, match: false, result: 'mismatch' });
        try { fs.renameSync(part, final + '.mismatch-' + Date.now()); } catch {}
        if (!it._mismatchRetried) { it._mismatchRetried = true; it.status = 'queued'; this.emitUpdate(it); return this.pump(); }
        it.status = 'mismatch'; it.error = 'SHA-256 does not match Apple\'s value.';
        this.emitUpdate(it); return this.pump();
      }
      fs.renameSync(part, final);
      try { fs.chmodSync(final, 0o444); } catch {}
      it.bytes = it.total = fs.statSync(final).size;
      it.status = 'verified';
      this.log && this.log.write('download-verified', { account: it.account, type: it.typeCode, file: it.name, host: it.host, bytes: it.bytes, expectedSha256: it.expectedSha256, sha256: digest, match: it.match, result: it.match ? 'ok' : 'no apple hash', path: final });
      this.emitUpdate(it); this.pump();
    };
    get(it.url, 0);
  }
}

async function freeSpaceBytes(dir) {
  try { const s = await fsp.statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

// ---------- already-downloaded / already-extracted returns ----------
const STEM_RE = /^(\d+)-([A-Z][A-Z-]*?)-(\d+)$/i;
// uwrp-b7: Apple's bash download script unzips into <prodId>/<acct>/<appleId>/<Category>/... (no "<acct>-<TYPE>-<id>"
// folders, category names in mixed case). Map those folder names to the same type codes the zipped flow uses.
const FOLDER_TYPE = { account: 'ACCOUNT', bookmarks: 'BOOKMARKS', icloudbookmarks: 'BOOKMARKS', contacts: 'CONTACTS', log: 'LOG', logs: 'LOG',
  mail: 'MAIL', mailheader: 'MAILHEADER', notes: 'NOTES', signinwithapple: 'SIGNINWITHAPPLE', cloudphotolibrary: 'CLOUDPHOTOLIBRARY', icloudphotos: 'CLOUDPHOTOLIBRARY',
  icloudcalendarsandreminders: 'CALENDARS', calendars: 'CALENDARS', icloudbackup: 'BACKUP', backup: 'BACKUP', iclouddrive: 'ICLOUDDRIVE',
  icloudreminders: 'ICLOUDREMINDERS', reminders: 'ICLOUDREMINDERS', maps: 'MAPS', messagesinicloud: 'MESSAGESINICLOUD', safaribrowsinghistory: 'SAFARIBROWSINGHISTORY',
  facetimelog: 'FACETIME-LOG', imessagelog: 'IMESSAGE-LOG', icloudlog: 'ICLOUD-LOG', maillog: 'MAIL-LOG' };
function typeFromFolder(name) { return FOLDER_TYPE[String(name || '').toLowerCase().replace(/[^a-z]/g, '')] || null; }
/** Bash-layout units under an account folder: [{ path, account, identity, category, type }]. */
function bashUnits(acctDir) {
  const account = path.basename(acctDir); if (!/^\d+$/.test(account)) return [];
  const out = [];
  let ids = []; try { ids = fs.readdirSync(acctDir, { withFileTypes: true }).filter(e => e.isDirectory()); } catch { return out; }
  for (const id of ids) {
    let cats = []; try { cats = fs.readdirSync(path.join(acctDir, id.name), { withFileTypes: true }).filter(e => e.isDirectory()); } catch { continue; }
    for (const c of cats) { const type = typeFromFolder(c.name); if (type) out.push({ path: path.join(acctDir, id.name, c.name), account, identity: id.name, category: c.name, type }); }
  }
  return out;
}

/**
 * Detect every Apple layout under a folder (mixed is fine):
 * (a) extracted <acct>-<TYPE>-<id>/ folders, (b) <acct>-<TYPE>-<id>.zip, (c) <acct>-<TYPE>-<id>.zip.gpg,
 * (d) an outer production (Account_Data_Links CSV + xlsx + PDF). Read-only.
 */
function scanAppleFolder(dir) {
  const extractedDirs = [], zips = [], gpgs = [], outer = [], productionGpgs = [], productionZips = [], bashDirs = [], units = [];
  const visit = (d, depth) => {
    if (depth > 6) return;
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (STEM_RE.test(e.name)) { extractedDirs.push(p); continue; }
        if (/^\d+$/.test(e.name)) { const u = bashUnits(p); if (u.length) { bashDirs.push(p); units.push(...u); continue; } }
        if (/^account_data_links$/i.test(e.name)) { outer.push(d); }
        visit(p, depth + 1);
      } else if (e.isFile()) {
        const m = e.name.match(/^(\d+)-([A-Z][A-Z-]*?)-(\d+)\.zip(\.gpg)?$/i);
        if (m) (m[4] ? gpgs : zips).push({ path: p, name: e.name, account: m[1], typeCode: m[2].toUpperCase(), fileId: m[3], size: fs.statSync(p).size });
        else if (/\.(gpg|pgp)$/i.test(e.name)) productionGpgs.push({ path: p, name: e.name, size: fs.statSync(p).size }); // Apple's original production (needs the passcode)
        else if (/_production_.*\.zip$/i.test(e.name)) productionZips.push({ path: p, name: e.name, size: fs.statSync(p).size }); // already-decrypted production
      }
    }
  };
  visit(dir, 0);
  const stemOf = n => n.replace(/\.zip(\.gpg)?$/i, '');
  const haveStem = new Set(extractedDirs.map(p => path.basename(p).toLowerCase()));
  // prefer the most-processed copy: extracted > zip > gpg
  const zipsTodo = zips.filter(z => !haveStem.has(stemOf(z.name).toLowerCase()));
  const zipStems = new Set(zips.map(z => stemOf(z.name).toLowerCase()));
  const gpgsTodo = gpgs.filter(g => !haveStem.has(stemOf(g.name).toLowerCase()) && !zipStems.has(stemOf(g.name).toLowerCase()));
  const prod = outer.length ? inspectProduction(outer[0]) : null;
  let workbook = prod && prod.accountWorkbook;
  if (!workbook) { try { const w = fs.readdirSync(dir).find(n => /apple.?confidential.*\.xlsx$/i.test(n)); if (w) workbook = path.join(dir, w); } catch {} }
  let items = [];
  if (prod && prod.linksCsv.length) { try { items = parseLinksCsv(fs.readFileSync(prod.linksCsv[0], 'utf8')); } catch {} }
  const have = new Set([...extractedDirs.map(p => path.basename(p)), ...zips.map(z => stemOf(z.name)), ...gpgs.map(g => stemOf(g.name))].map(x => x.toLowerCase()));
  const missing = items.filter(i => !have.has(stemOf(i.name).toLowerCase()));
  const accounts = new Set([...extractedDirs.map(p => path.basename(p).match(STEM_RE)[1]), ...bashDirs.map(p => path.basename(p)), ...zips.map(z => z.account), ...gpgs.map(g => g.account), ...items.map(i => i.account)].filter(Boolean));
  return {
    dir, extractedDirs, bashDirs, bashTypes: [...new Set(units.map(u => u.type))].sort(), extractedRoots: [...new Set([...extractedDirs, ...bashDirs].map(p => path.dirname(p)))],
    zips: zipsTodo, gpgs: gpgsTodo, skippedDuplicates: zips.length - zipsTodo.length + gpgs.length - gpgsTodo.length,
    production: prod, workbook, productionGpgs, productionZips, linkItems: items, missing, accounts: [...accounts].sort(),
    layouts: { a: extractedDirs.length + bashDirs.length > 0, b: zipsTodo.length > 0, c: gpgsTodo.length > 0, d: !!(prod && prod.linksCsv.length) },
  };
}

/** Import a scanned folder. Originals are only read; zips/gpgs are expanded into <outDir>. */
async function importScannedFolder({ scan, outDir, gpg, pass, log, onStatus }) {
  const exRoot = path.join(outDir, 'extracted');
  const decDir = path.join(outDir, 'decrypted');
  fs.mkdirSync(exRoot, { recursive: true });
  const failed = []; let decrypted = 0, extracted = 0;
  // hash every original we touch (read-only) into the custody log
  const originals = [...scan.extractedDirs.flatMap(d => walk(d)), ...(scan.bashDirs || []).flatMap(d => walk(d)), ...scan.zips.map(z => z.path), ...scan.gpgs.map(g => g.path)];
  for (let i = 0; i < originals.length; i++) {
    if (i % 50 === 0) onStatus && onStatus(`Hashing originals ${i + 1} of ${originals.length}...`);
    const f = originals[i];
    log && log.write('original-hashed', { file: path.relative(scan.dir, f), bytes: fs.statSync(f).size, sha256: await sha256File(f), result: 'read-only' });
  }
  // uwrp-b7: zips sitting inside in-place extracted folders (e.g. iCloud Drive / Messages zips in a bash-download tree)
  // are expanded into the working folder, mirroring the zipped flow's "<zip>.extracted" folders.
  for (const d of [...scan.extractedDirs, ...(scan.bashDirs || [])]) {
    const isBash = !STEM_RE.test(path.basename(d));
    for (const f of walk(d)) {
      if (!/\.zip$/i.test(f)) continue;
      const rel = path.relative(d, f);
      if (!fs.statSync(f).size) { log && log.write('nested-zip-empty', { file: path.basename(f), result: '0-byte zip in the return (nothing to extract)' }); continue; }
      let dest;
      if (isBash) { const [ident, cat] = rel.split(path.sep); const type = typeFromFolder(cat) || 'OTHER'; dest = path.join(exRoot, `${path.basename(d)}-${type}-0`, path.basename(d), rel + '.extracted'); void ident; }
      else dest = path.join(exRoot, path.basename(d), rel + '.extracted');
      try { const files = await extractZip(f, dest); log && log.write('file-extract', { file: path.basename(f), result: files.length + ' files (nested zip, working copy)' }); if (files.failed) failed.push(...files.failed.map(x => ({ name: path.basename(f) + ' › ' + x.name, error: x.error }))); }
      catch (e) { failed.push({ name: path.basename(f), error: e.message }); log && log.write('file-extract-failed', { file: path.basename(f), error: e.message }); }
    }
  }
  for (const z of scan.zips) {
    onStatus && onStatus('Extracting ' + z.name);
    try { const files = await extractZip(z.path, path.join(exRoot, z.name.replace(/\.zip$/i, ''))); extracted++; log && log.write('file-extract', { account: z.account, type: z.typeCode, file: z.name, result: files.length + ' files (working copy)' }); }
    catch (e) { failed.push({ name: z.name, error: e.message }); log && log.write('file-extract-failed', { file: z.name, error: e.message }); }
  }
  if (scan.gpgs.length) {
    if (!pass || !pass.length) throw new Error('Passcode needed to decrypt the .zip.gpg files.');
    fs.mkdirSync(decDir, { recursive: true });
    for (const g of scan.gpgs) {
      onStatus && onStatus('Decrypting ' + g.name);
      const zip = path.join(decDir, g.name.replace(/\.gpg$/i, ''));
      try {
        if (!fs.existsSync(zip)) await gpgDecrypt(gpg, g.path, zip, pass);
        decrypted++;
        log && log.write('file-decrypt', { account: g.account, type: g.typeCode, file: path.basename(zip), sha256: await sha256File(zip), result: 'ok' });
        await extractZip(zip, path.join(exRoot, path.basename(zip).replace(/\.zip$/i, '')));
        extracted++;
      } catch (e) {
        failed.push({ name: g.name, error: e.message });
        log && log.write('file-decrypt-failed', { file: g.name, error: e.message });
        if (e.code === 'BAD_PASS') throw e;
      }
    }
  }
  return { exRoot, roots: [...scan.extractedRoots, exRoot], decrypted, extracted, failed };
}

module.exports = { typeFromFolder, bashUnits, scanAppleFolder, importScannedFolder, findGpg, gpgDecrypt, sanitizeGpgMessage, sha256File, extractZip, parseCsv, parseLinksCsv, linkSafe, inspectProduction, readXlsx, splitPreamble, xlsxToCsvFiles, detectBackups, summarizeExtracted, CustodyLog, Downloader, freeSpaceBytes, walk, parseSize };
