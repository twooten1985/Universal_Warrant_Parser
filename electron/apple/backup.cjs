'use strict';
/**
 * iOS (iTunes/Finder-style) backup reader for the Apple backup viewer. Read-only.
 * - SQLite is first tried with a read-only `file:` URI plus immutable=1. The bundled better-sqlite3
 *   build does not accept URI filenames, so in practice each database is copied to a private temp
 *   working folder (SHA-256 of original and copy recorded in memory), opened there, and the folder is
 *   deleted on close. SQLite therefore never writes -wal/-shm/-journal files next to the evidence.
 * - Media bytes are only returned to the window in memory (base64). Nothing is written to disk.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const APPLE_EPOCH = 978307200; // 2001-01-01T00:00:00Z
function appleTime(v) {
  if (v == null || v === '' || Number(v) === 0) return '';
  let n = Number(v); if (!isFinite(n)) return '';
  if (Math.abs(n) > 1e14) n = n / 1e9;      // nanoseconds (iOS 11+ sms.db)
  else if (Math.abs(n) > 1e11) n = n / 1e3;  // milliseconds (rare)
  const d = new Date((n + APPLE_EPOCH) * 1000);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// ---------- plist (binary + XML) ----------
function parseBplist(buf) {
  if (buf.toString('ascii', 0, 6) !== 'bplist') throw new Error('not a binary plist');
  const t = buf.length - 32;
  const offSize = buf[t + 6], refSize = buf[t + 7];
  const num = Number(buf.readBigUInt64BE(t + 8)), top = Number(buf.readBigUInt64BE(t + 16)), offTab = Number(buf.readBigUInt64BE(t + 24));
  const readN = (p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[p + i]; return v; };
  const offs = new Array(num); for (let i = 0; i < num; i++) offs[i] = readN(offTab + i * offSize, offSize);
  let depth = 0;
  function len(p, low) {
    if (low !== 0xf) return [low, p + 1];
    const m = buf[p + 1] & 0xf, n = 1 << m; return [readN(p + 2, n), p + 2 + n];
  }
  function obj(i) {
    if (++depth > 512) throw new Error('plist too deep');
    try {
      const p = offs[i], b = buf[p], hi = b >> 4, low = b & 0xf;
      switch (hi) {
        case 0x0: return low === 8 ? false : low === 9 ? true : null;
        case 0x1: { const n = 1 << low; if (n === 8) return Number(buf.readBigInt64BE(p + 1)); if (n === 16) return Number(buf.readBigInt64BE(p + 9)); return readN(p + 1, n); }
        case 0x2: return low === 2 ? buf.readFloatBE(p + 1) : buf.readDoubleBE(p + 1);
        case 0x3: return new Date((buf.readDoubleBE(p + 1) + APPLE_EPOCH) * 1000);
        case 0x4: { const [n, s] = len(p, low); return buf.subarray(s, s + n); }
        case 0x5: { const [n, s] = len(p, low); return buf.toString('latin1', s, s + n); }
        case 0x6: { const [n, s] = len(p, low); const c = Buffer.from(buf.subarray(s, s + n * 2)); c.swap16(); return c.toString('utf16le'); }
        case 0x8: return { UID: readN(p + 1, low + 1) };
        case 0xa: { const [n, s] = len(p, low); const a = []; for (let k = 0; k < n; k++) a.push(obj(readN(s + k * refSize, refSize))); return a; }
        case 0xd: { const [n, s] = len(p, low); const o = {}; for (let k = 0; k < n; k++) o[String(obj(readN(s + k * refSize, refSize)))] = obj(readN(s + (n + k) * refSize, refSize)); return o; }
        default: return null;
      }
    } finally { depth--; }
  }
  return obj(top);
}
function readPlistBuffer(buf) {
  if (!buf || !buf.length) return null;
  if (buf.toString('ascii', 0, 6) === 'bplist') return parseBplist(buf);
  return require('plist').parse(buf.toString('utf8'));
}
function readPlist(file) { try { return readPlistBuffer(fs.readFileSync(file)); } catch { return null; } }
/** Minimal NSKeyedArchiver decode: returns the root object with UIDs resolved one level (enough for MBFile). */
function unarchive(o) {
  if (!o || !Array.isArray(o.$objects) || !o.$top) return o;
  const objs = o.$objects; const r = o.$top.root || Object.values(o.$top)[0];
  const deref = v => (v && typeof v === 'object' && 'UID' in v) ? objs[v.UID] : v;
  const root = deref(r); if (!root || typeof root !== 'object') return root;
  const out = {}; for (const [k, v] of Object.entries(root)) out[k] = deref(v);
  return out;
}

// ---------- typedstream (attributedBody) ----------
/** Pull the plain string out of an NSAttributedString typedstream blob (iOS 16+ often leaves message.text empty). */
function attributedBodyText(b) {
  if (!b || !b.length) return '';
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const i = buf.indexOf('NSString'); if (i < 0) return '';
  const j = buf.indexOf(Buffer.from([0x01, 0x2b]), i); if (j < 0) return '';
  let p = j + 2, n = buf[p];
  if (n === 0x81) { n = buf.readUInt16LE(p + 1); p += 3; } else if (n === 0x82) { n = buf.readUInt32LE(p + 1); p += 5; } else p += 1;
  return buf.toString('utf8', p, Math.min(buf.length, p + n));
}

// ---------- read-only SQLite ----------
function sha256File(f) {
  const h = crypto.createHash('sha256'); const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(1 << 20);
  try { let n; while ((n = fs.readSync(fd, b, 0, b.length, null)) > 0) h.update(b.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function roUri(file) { return pathToFileURL(file).href + '?mode=ro&immutable=1'; }
function loadSqlite() { return require('better-sqlite3'); }
const custody = []; // in-memory notes about temp copies (no PII: hashes + generic labels)
function openReadOnly(file, Database = loadSqlite()) {
  try {
    const db = new Database(roUri(file), { readonly: true, fileMustExist: true });
    db.prepare('SELECT 1').get();
    return { db, close: () => db.close(), mode: 'uri-immutable' };
  } catch (e) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-bk-'));
    const copy = path.join(dir, 'working.sqlite');
    const before = sha256File(file);
    fs.copyFileSync(file, copy);
    const after = sha256File(copy);
    custody.push({ at: new Date().toISOString(), action: 'temp working copy', original_sha256: before, copy_sha256: after, match: before === after });
    // The copy lives in our own temp folder, so SQLite may create -wal/-shm there (never next to the evidence).
    let db; try { db = new Database(copy, { readonly: true, fileMustExist: true }); db.prepare('SELECT count(*) FROM sqlite_master').get(); }
    catch { try { db && db.close(); } catch {} db = new Database(copy, { fileMustExist: true }); db.pragma('query_only = ON'); }
    return { db, mode: 'temp-copy', close: () => { try { db.close(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
  }
}
const cols = (db, t) => { try { return new Set(db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map(r => r.name)); } catch { return new Set(); } };
const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(t);
const pick = (c, name, alt = 'NULL') => c.has(name) ? name : alt;

// ---------- backup ----------
const STEM_SEG = /^(\d+)-([A-Z][A-Z-]*?)-(\d+)(?:\.zip)?(?:\.extracted)?$/i;
function accountFromPath(p) { const seg = p.split(/[\\/]+/).find(s => STEM_SEG.test(s)); return seg ? seg.match(STEM_SEG)[1] : ''; }

// /*uwrp-b9*/ Apple's law-enforcement iCloud backup export ("snapshot asset" layout):
//   .../backup/D_<40-hex device id>/S_<snapshot UUID>/A_<4hex>_<UUID>_<file id>=_<size>   (file contents, no names)
//   .../backup/D_.../S_.../N_<UUID>_<file id>=_0                                         (0-byte placeholders)
// There is no Manifest.db / Manifest.plist / Info.plist. One snapshot is usually split over several BACKUP zips
// (each zip holds the same D_/S_ folders with a share of the files), so parts are grouped by device + snapshot.
// Files are identified by their content: SQLite databases by their tables, media and plists by magic bytes.
const SNAP_GROUPS = new Map(); // first dir -> all part dirs of one snapshot
const isSnapDir = d => /^S_[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(path.basename(d)) && /^D_[0-9a-f]{40}$/i.test(path.basename(path.dirname(d)));
/*uwrp-b11*/ const SI = require('./snapinfo.cjs');
function sniff(p) {
  let b = Buffer.alloc(0); try { const fd = fs.openSync(p, 'r'); b = Buffer.alloc(32); const n = fs.readSync(fd, b, 0, 32, 0); fs.closeSync(fd); b = b.subarray(0, n); } catch {}
  if (b.length === 32 && /^\s*</.test(b.toString('latin1'))) { try { const fd = fs.openSync(p, 'r'); const c = Buffer.alloc(256); const n = fs.readSync(fd, c, 0, 256, 0); fs.closeSync(fd); b = c.subarray(0, n); } catch {} }
  return sniffBuf(b);
}
function sniffBuf(b) {
  const s = b.toString('latin1'); const ft = b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' ? b.toString('latin1', 8, 12) : '';
  if (s.startsWith('SQLite format 3')) return { kind: 'database', ext: 'sqlite' };
  if (s.startsWith('bplist')) return { kind: 'plist', ext: 'plist' };
  if (s.startsWith('<?xml') || s.startsWith('<plist')) return { kind: /<plist|<!DOCTYPE plist/.test(s) ? 'plist' : 'xml', ext: /<plist|<!DOCTYPE plist/.test(s) ? 'plist' : 'xml' };
  if (/^\s*[\[{]/.test(s)) return { kind: 'json', ext: 'json' };
  if (b[0] === 0x89 && s.slice(1, 4) === 'PNG') return { kind: 'image', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', ext: 'jpg' };
  if (s.startsWith('GIF8')) return { kind: 'image', ext: 'gif' };
  if (ft) return /^(heic|heix|hevc|mif1|msf1)$/.test(ft) ? { kind: 'image', ext: 'heic' } : ft === 'qt  ' ? { kind: 'video', ext: 'mov' } : /^(M4A |M4B )$/.test(ft) ? { kind: 'audio', ext: 'm4a' } : { kind: 'video', ext: 'mp4' };
  if (s.startsWith('PK\x03\x04')) return { kind: 'archive', ext: 'zip' };
  if (s.startsWith('%PDF')) return { kind: 'document', ext: 'pdf' };
  if (/^bvx[21n-]/.test(s)) return { kind: 'compressed (LZFSE)', ext: 'lzfse' };
  if (s.startsWith('AA01')) return { kind: 'archive (Apple Archive)', ext: 'aar' };
  if (s.startsWith('UnityFS')) return { kind: 'app data (Unity)', ext: 'unity3d' };
  if (b.length === 0) return { kind: 'empty', ext: 'bin' };
  return { kind: 'other', ext: 'bin' };
}
// Which iOS database is this? (by its tables) -> the domain/path the parsers below look for.
const DB_SIGNATURES = [
  [t => t.has('message') && t.has('handle') && t.has('chat'), 'HomeDomain', 'Library/SMS/sms.db', 'Messages (sms.db)'],
  [t => t.has('abperson') && t.has('abmultivalue'), 'HomeDomain', 'Library/AddressBook/AddressBook.sqlitedb', 'Contacts (AddressBook)'],
  [t => t.has('zcallrecord'), 'HomeDomain', 'Library/CallHistoryDB/CallHistory.storedata', 'Call history'],
  [t => t.has('zasset') && (t.has('zadditionalassetattributes') || t.has('zgenericalbum')), 'CameraRollDomain', 'Media/PhotoData/Photos.sqlite', 'Photos library (Photos.sqlite)'],
  [t => t.has('ziccloudsyncingobject'), 'AppDomainGroup-group.com.apple.notes', 'NoteStore.sqlite', 'Notes (NoteStore)'],
  [t => t.has('znote') && t.has('znotebody'), 'HomeDomain', 'Library/Notes/notes.sqlite', 'Notes (legacy)'],
  [t => t.has('history_visits') && t.has('history_items'), 'AppDomain-com.apple.mobilesafari', 'Library/Safari/History.db', 'Safari history'],
  [t => t.has('calendaritem'), 'HomeDomain', 'Library/Calendar/Calendar.sqlitedb', 'Calendar'],
];
function findSnapshotGroups(root) {
  const byKey = new Map();
  const walk = (d, depth) => { if (depth > 14) return; let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory()) { const p = path.join(d, e.name); if (isSnapDir(p)) { const k = (path.basename(d) + '/' + e.name).toLowerCase(); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); } else walk(p, depth + 1); } };
  walk(root, 0);
  const out = [];
  for (const dirs of byKey.values()) { dirs.sort(); SNAP_GROUPS.set(dirs[0], dirs); out.push({ dir: dirs[0], parts: dirs }); }
  return out;
}

class IosBackup {
  constructor(dir, opts = {}) {
    this.dir = dir; this.Database = opts.Database || null; this.opened = new Map();
    this.id = path.basename(dir); this.account = opts.account || accountFromPath(dir);
    this.manifest = readPlist(path.join(dir, 'Manifest.plist')) || {};
    this.infoPl = readPlist(path.join(dir, 'Info.plist')) || {};
    this.status = readPlist(path.join(dir, 'Status.plist')) || {};
    this.encrypted = this.manifest.IsEncrypted === true;
    this.hasManifestDb = fs.existsSync(path.join(dir, 'Manifest.db'));
    this.hasMbdb = fs.existsSync(path.join(dir, 'Manifest.mbdb'));
    // No Manifest.db: treat the folder as loose files and recognise databases by name anywhere below it.
    this.loose = !this.hasManifestDb && !this.encrypted;
    if (this.loose && !Object.keys(this.infoPl).length) { // loose layouts: use the shallowest Info.plist / Status.plist below the folder
      const q = [[dir, 0]]; while (q.length) { const [d, depth] = q.shift(); let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        const has = n => ents.find(e => e.isFile() && e.name.toLowerCase() === n);
        if (has('info.plist')) { this.infoPl = readPlist(path.join(d, has('info.plist').name)) || {}; if (has('status.plist')) this.status = readPlist(path.join(d, has('status.plist').name)) || {}; break; }
        if (depth < 4) for (const e of ents) if (e.isDirectory()) q.push([path.join(d, e.name), depth + 1]); }
    }
    this.format = this.hasManifestDb ? 'iTunes/Finder backup (Manifest.db + hashed files)' : this.encrypted ? 'Encrypted iTunes/Finder backup'
      : this.hasMbdb ? 'Legacy backup (Manifest.mbdb, iOS 9 and older) — shown as loose files' : 'Loose files (databases recognised by file name)';
    this._files = null;
    const g = SNAP_GROUPS.get(dir) || (isSnapDir(dir) ? (findSnapshotGroups(path.dirname(path.dirname(path.dirname(dir)))).find(x => x.parts.includes(dir)) || { parts: [dir] }).parts : null);
    if (g) {
      this.snapshot = true; this.snapDirs = g; this.loose = true; this.encrypted = false;
      this.id = path.basename(dir).slice(0, 14); this.device_ = path.basename(path.dirname(dir)).slice(2, 10);
      this.format = `iCloud backup snapshot (Apple's asset layout: D_<device>/S_<snapshot>/A_ files, no Manifest.db) in ${g.length} part${g.length === 1 ? '' : 's'}`;
      if (!opts.account) this.account = accountFromPath(dir);
    }
  }
  open(file) {
    if (this.opened.has(file)) return this.opened.get(file).db;
    let h; if (SI.lzfse.isLzfse(SI.head(file, 4))) { const D = this.Database || loadSqlite(); const db = new D(SI.lzfse.decompress(fs.readFileSync(file)), { readonly: true }); h = { db, close: () => db.close(), mode: 'lzfse-memory' }; } // LZFSE-compressed SQLite: decompressed and opened in memory only
    else h = openReadOnly(file, this.Database || loadSqlite()); this.opened.set(file, h); return h.db;
  }
  close() { for (const h of this.opened.values()) h.close(); this.opened.clear(); }
  physical(fileID) {
    if (this.snapshot) { this.files(); return (this._paths && this._paths.get(fileID)) || ''; }
    if (this.loose) { const p = path.join(this.dir, ...String(fileID).split('/')); return p.startsWith(this.dir) && fs.existsSync(p) ? p : ''; }
    const a = path.join(this.dir, fileID.slice(0, 2), fileID), b = path.join(this.dir, fileID);
    return fs.existsSync(a) ? a : fs.existsSync(b) ? b : '';
  }
  files() {
    if (this._files) return this._files;
    if (this.snapshot) {
      const out = []; this._paths = new Map(); this.placeholders = 0; this.kinds = {}; const taken = new Map();
      const pf = SI.findProtectionFiles(this.snapDirs); const map = new Map(); const pr = this._prot = { lzfseOk: 0, lzfseBad: 0, lzfseBig: 0, encrypted: 0, plistOk: 0, plistBad: 0, recs: 0, mapped: 0, keybag: null, fileInfo: null, files: { keybag: pf.keybags.map(x => path.basename(x)), fileInfo: pf.fileInfo.map(x => path.basename(x)), manifests: pf.manifests.map(x => path.basename(x)) } };
      for (const kb of pf.keybags.slice(0, 4)) { try { const st = fs.statSync(kb); if (st.size < 8 * 1048576) { const r = SI.parseKeybag(fs.readFileSync(kb)); if (!pr.keybag || r.parsed) pr.keybag = r; } } catch {} }
      for (const fi of pf.fileInfo) { try { if (fs.statSync(fi).size > 512 * 1048576) continue; const r = SI.parseFileInfoList(fs.readFileSync(fi, 'utf8')); pr.fileInfo = { format: r.format, lines: (pr.fileInfo ? pr.fileInfo.lines : 0) + r.lines, rows: (pr.fileInfo ? pr.fileInfo.rows : 0) + r.rows }; for (const [k, v] of r.map) if (!map.has(k)) map.set(k, v); } catch {} }
      this._recs = o => { const walk = (x, d) => { if (d > 12 || !x || typeof x !== 'object' || Buffer.isBuffer(x)) return; if (Array.isArray(x)) { for (const y of x) walk(y, d + 1); return; } const r = SI.recordOf(x); if (r) { pr.recs++; for (const id of r.ids) if (!map.has(id)) map.set(id, { domain: r.domain || '(listed)', relativePath: r.rel }); } for (const v of Object.values(x)) walk(v, d + 1); }; try { walk(o, 0); } catch {} };
      for (const d of this.snapDirs) { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch {}
        for (const e of ents) { if (!e.isFile()) continue; const p = path.join(d, e.name);
          if (/^N_/.test(e.name)) { this.placeholders++; continue; }
          if (this._paths.has(e.name)) continue; // same asset present in two parts: keep the first copy
          let st; try { st = fs.statSync(p); } catch { continue; }
          let k = sniff(p); const pr = this._prot; let note = '';
          if (k.kind === 'compressed (LZFSE)') { if (st.size <= 16 * 1048576) { try { const inner = sniffBuf(SI.lzfse.decompress(fs.readFileSync(p)).subarray(0, 256)); pr.lzfseOk++; k = { kind: 'lzfse ' + inner.kind, ext: inner.ext }; note = 'LZFSE-compressed ' + inner.kind; } catch { pr.lzfseBad++; } } else pr.lzfseBig++; }
          else if (k.kind === 'other' && SI.looksEncrypted(SI.head(p, 65536))) { k = { kind: 'encrypted', ext: 'bin' }; pr.encrypted++; note = 'Likely encrypted (Data Protection class key needed)'; }
          else if (k.kind === 'plist' && st.size <= 4 * 1048576) { try { const o = readPlistBuffer(fs.readFileSync(p)); pr.plistOk++; this._recs(o); } catch { pr.plistBad++; } }
          let domain = '(snapshot)', rel = `${k.kind.split(' ').slice(0, k.kind.startsWith('lzfse') ? 2 : 1).join('-')}/${e.name}.${k.ext}`, label = '';
          if (k.kind === 'database' || k.kind === 'lzfse database') { try { const t = new Set(this.open(p).prepare("SELECT lower(name) AS n FROM sqlite_master WHERE type='table'").all().map(r => r.n));
              const sig = DB_SIGNATURES.find(s => s[0](t)); if (sig) { const key = sig[1] + '\u0000' + sig[2]; const prev = taken.get(key);
                if (!prev || prev.size < st.size) { if (prev) { prev.domain = '(snapshot)'; prev.relativePath = `database/${prev.fileID}.sqlite`; } domain = sig[1]; rel = sig[2]; label = sig[3]; } } } catch {} }
          const f = { fileID: e.name, domain, relativePath: rel, flags: 1, isDir: false, size: st.size, mtime: st.mtime.toISOString(), kind: k.kind, label, note };
          if (label) taken.set(domain + '\u0000' + rel, f);
          this._paths.set(e.name, p); this.kinds[k.kind] = (this.kinds[k.kind] || 0) + 1; out.push(f); } }
      if (map.size) for (const f of out) { const hit = SI.assetIds(f.fileID).map(i => map.get(i)).find(Boolean); if (hit && hit.relativePath) { pr.mapped++; if (!f.label) { f.domain = hit.domain; f.relativePath = hit.relativePath; } f.originalPath = hit.domain + '/' + hit.relativePath; } }
      this._files = out; this.byPath = new Map(out.map(f => [f.domain + '\u0000' + f.relativePath, f])); return out;
    }
    if (this.loose) {
      const out = []; const walk = (d, rel, depth) => { if (depth > 40 || out.length > 500000) return; let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) { const r = rel ? rel + '/' + e.name : e.name; const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p, r, depth + 1);
          else if (e.isFile()) { let st; try { st = fs.statSync(p); } catch { continue; } const seg = r.split('/'); const dom = /Domain(-|$)/.test(seg[0]) && seg.length > 1 ? seg[0] : '(folder)';
            out.push({ fileID: r, domain: dom, relativePath: dom === '(folder)' ? r : seg.slice(1).join('/'), flags: 1, isDir: false, size: st.size, mtime: st.mtime.toISOString() }); } } };
      walk(this.dir, '', 0);
      this._files = out; this.byPath = new Map(out.map(f => [f.domain + '\u0000' + f.relativePath, f])); return out;
    }
    if (this.encrypted || !this.hasManifestDb) return (this._files = []);
    let rows = [];
    try { rows = this.open(path.join(this.dir, 'Manifest.db')).prepare('SELECT fileID, domain, relativePath, flags, file FROM Files').all(); } catch { rows = []; }
    this._files = rows.map(r => {
      let size = null, mtime = '';
      try { const f = unarchive(readPlistBuffer(r.file)); if (f) { size = f.Size ?? null; mtime = f.LastModified ? new Date(Number(f.LastModified) * 1000).toISOString() : ''; } } catch {}
      return { fileID: r.fileID, domain: r.domain, relativePath: r.relativePath || '', flags: r.flags, isDir: r.flags === 2, size, mtime };
    });
    this.byPath = new Map(this._files.map(f => [f.domain + '\u0000' + f.relativePath, f]));
    return this._files;
  }
  find(domain, rel) {
    this.files(); const hit = (this.byPath && this.byPath.get(domain + '\u0000' + rel)) || null;
    if (hit || !this.loose || !rel) return hit;
    const lc = rel.toLowerCase(), base = lc.split('/').pop();
    return this._files.find(f => f.fileID.toLowerCase().endsWith('/' + lc) || f.fileID.toLowerCase() === lc)
      || (() => { const same = this._files.filter(f => f.fileID.toLowerCase().split('/').pop() === base); return KNOWN_DB.has(base) ? same[0] : same.length === 1 ? same[0] : null; })() || null;
  }
  findLike(domainRe, rel) { const f = this.files().find(x => domainRe.test(x.domain) && x.relativePath === rel); return f || (this.loose ? this.find('', rel) : null); }
  dbFor(domain, rel) {
    const f = typeof domain === 'string' ? this.find(domain, rel) : this.findLike(domain, rel);
    if (!f) return null; const p = this.physical(f.fileID); if (!p) return null;
    try { return { db: this.open(p), file: f, phys: p }; } catch { return null; }
  }
  meta(file, extra = {}) {
    return { source: 'Backup', account: this.account, backupId: this.id, device: this.deviceName(), domain: file ? file.domain : '', relativePath: file ? file.relativePath : '', fileID: file ? file.fileID : '', path: file ? this.physical(file.fileID) : this.dir, ...extra };
  }
  deviceName() { return this.infoPl['Device Name'] || (this.manifest.Lockdown && this.manifest.Lockdown.DeviceName) || (this.snapshot ? `iCloud device ${this.device_}…` : 'iOS device'); }
  snapshotSummary() { if (!this.snapshot) return null; const f = this.files(); return { format: this.format, parts: this.snapDirs.length, files: f.length, placeholders: this.placeholders, bytes: f.reduce((n, x) => n + (x.size || 0), 0), kinds: this.kinds, recognised: f.filter(x => x.label).map(x => x.label), protection: this.protection() }; }
  protection() { if (!this.snapshot) return null; this.files(); const p = this._prot; const kb = p.files.keybag.length, fi = p.files.fileInfo.length;
    const readable = []; if (p.plistOk) readable.push(`${p.plistOk} plists (binary/XML, parsed)`); if (p.lzfseOk) readable.push(`${p.lzfseOk} LZFSE files (decompressed in memory)`);
    const k = this.kinds || {}; for (const n of ['database', 'image', 'video', 'audio', 'json', 'document', 'archive']) if (k[n]) readable.push(`${k[n]} ${n}`);
    const why = []; if (p.encrypted) why.push(`${p.encrypted} files have no recognisable header and near-random content: they are almost certainly protected-class files encrypted with per-file keys wrapped by the iCloud Backup keybag's class keys.`);
    if (p.encrypted && !kb) why.push('keyBag.txt was not found in the parts present. Apple puts it in only one BACKUP part, so decrypt and extract every part.');
    if (p.encrypted && kb) why.push('keyBag.txt is present, but unwrapping its class keys and decrypting per-file keys uses an undocumented Apple scheme that this app does not implement. Use a tool that supports Apple warrant returns (Magnet AXIOM, Cellebrite Physical Analyzer, Elcomsoft Phone Breaker) for those files. Advanced Data Protection accounts cannot be decrypted at all.');
    if (!fi) why.push('FileInfoList.txt (Apple\'s file listing that maps A_ files to their original domain/path) was not found, so original paths are only rebuilt where a plist inside the backup records them; other files are named by their content type.');
    if (p.lzfseBad) why.push(`${p.lzfseBad} LZFSE files could not be decompressed (truncated or damaged).`);
    return { keybagFound: kb > 0, keybag: p.keybag, keybagFiles: p.files.keybag, fileInfoListFound: fi > 0, fileInfoList: p.fileInfo, manifestFiles: p.files.manifests, likelyEncrypted: p.encrypted, lzfseDecoded: p.lzfseOk, lzfseFailed: p.lzfseBad, lzfseTooLarge: p.lzfseBig, plistsParsed: p.plistOk, plistsFailed: p.plistBad, pathRecords: p.recs, pathsRebuilt: p.mapped, readable, notReadable: why }; }

  // ----- sections -----
  device() {
    const L = this.manifest.Lockdown || {}, I = this.infoPl;
    const v = (...xs) => xs.find(x => x != null && x !== '') ?? '';
    const date = d => d instanceof Date ? d.toISOString() : (d || '');
    return {
      backupId: this.id, account: this.account, encrypted: this.encrypted, manifestDb: this.hasManifestDb, format: this.format,
      deviceName: v(I['Device Name'], L.DeviceName), productType: v(I['Product Type'], L.ProductType), productName: v(I['Product Name']),
      iosVersion: v(I['Product Version'], L.ProductVersion), build: v(I['Build Version'], L.BuildVersion),
      serial: v(I['Serial Number'], L.SerialNumber), imei: v(I.IMEI, I.IMEI2), phone: v(I['Phone Number']), udid: v(I['Unique Identifier'], L.UniqueDeviceID, I['Target Identifier']),
      iccid: v(I.ICCID), meid: v(I.MEID), lastBackup: date(v(I['Last Backup Date'], this.manifest.Date, this.status.Date)),
      itunesVersion: v(I['iTunes Version']), backupState: v(this.status.BackupState), snapshotState: v(this.status.SnapshotState), isFullBackup: this.status.IsFullBackup,
      wasPasscodeSet: this.manifest.WasPasscodeSet, fileCount: this.files().length,
    };
  }
  apps() {
    const m = new Map();
    for (const [id, a] of Object.entries(this.manifest.Applications || {})) m.set(id, { bundleId: id, version: a && (a.CFBundleVersion || ''), path: a && (a.Path || '') });
    for (const id of this.infoPl['Installed Applications'] || []) if (!m.has(id)) m.set(id, { bundleId: id, version: '', path: '' });
    return [...m.values()].sort((a, b) => a.bundleId.localeCompare(b.bundleId)).map(a => ({ ...a, key: `backup:${this.id}:app:${a.bundleId}`, meta: this.meta(null, { kind: 'app', path: path.join(this.dir, 'Manifest.plist'), timestamp: this.device().lastBackup, description: `Installed app ${a.bundleId}${a.version ? ' ' + a.version : ''}` }) }));
  }
  messages() {
    const h = this.dbFor('HomeDomain', 'Library/SMS/sms.db'); if (!h) return { found: false, chats: [], messages: [] };
    const { db, file } = h; const mc = cols(db, 'message'), cc = cols(db, 'chat');
    const rows = db.prepare(`SELECT m.ROWID id, m.guid guid, m.text text, ${mc.has('attributedBody') ? 'm.attributedBody' : 'NULL'} ab, m.date date, m.is_from_me fromMe, ${mc.has('service') ? 'm.service' : 'NULL'} service,
      ${mc.has('cache_has_attachments') ? 'm.cache_has_attachments' : '0'} hasAtt, h.id handle, c.ROWID chatId, c.chat_identifier chatIdent, ${cc.has('display_name') ? 'c.display_name' : 'NULL'} chatName
      FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id LEFT JOIN chat_message_join j ON j.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = j.chat_id ORDER BY m.date`).all();
    const atts = new Map();
    if (hasTable(db, 'attachment') && hasTable(db, 'message_attachment_join')) {
      for (const a of db.prepare('SELECT j.message_id mid, a.ROWID id, a.filename filename, a.mime_type mime, a.transfer_name name, a.total_bytes bytes FROM message_attachment_join j JOIN attachment a ON a.ROWID = j.attachment_id').all()) {
        const rel = String(a.filename || '').replace(/^~\//, '').replace(/^\/var\/mobile\//, '').replace(/^\/private\/var\/mobile\//, '');
        const f = this.find('MediaDomain', rel);
        const list = atts.get(a.mid) || []; atts.set(a.mid, list);
        list.push({ id: a.id, name: a.name || path.basename(rel), mime: a.mime || '', bytes: a.bytes, fileID: f ? f.fileID : '', relativePath: rel, available: !!(f && this.physical(f.fileID)),
          key: `backup:${this.id}:att:${a.id}`, meta: this.meta(f || null, { kind: 'attachment', domain: 'MediaDomain', relativePath: rel, fileID: f ? f.fileID : '', path: f ? this.physical(f.fileID) : '', description: `Message attachment ${a.name || path.basename(rel)}` }) });
      }
    }
    const chats = new Map();
    const messages = rows.map(r => {
      const text = r.text || attributedBodyText(r.ab) || '';
      const ts = appleTime(r.date); const chatKey = String(r.chatId ?? 'nochat:' + (r.handle || ''));
      const c = chats.get(chatKey) || { id: chatKey, identifier: r.chatIdent || r.handle || '', name: r.chatName || '', count: 0, last: '' }; chats.set(chatKey, c); c.count++; c.last = ts || c.last;
      const a = atts.get(r.id) || [];
      return { id: r.id, chat: chatKey, timestamp: ts, fromMe: r.fromMe === 1, handle: r.handle || '', service: r.service || '', text, textSource: r.text ? 'text' : (text ? 'attributedBody' : ''), attachments: a,
        key: `backup:${this.id}:msg:${r.guid || r.id}`,
        meta: this.meta(file, { kind: 'message', timestamp: ts, description: `${r.fromMe === 1 ? 'Sent to' : 'Received from'} ${r.handle || r.chatIdent || 'unknown'}: ${text.slice(0, 120)}${a.length ? ` [${a.length} attachment(s)]` : ''}` }) };
    });
    return { found: true, chats: [...chats.values()].sort((x, y) => y.last.localeCompare(x.last)), messages };
  }
  calls() {
    const h = this.dbFor('HomeDomain', 'Library/CallHistoryDB/CallHistory.storedata'); if (!h) return { found: false, rows: [] };
    const { db, file } = h; if (!hasTable(db, 'ZCALLRECORD')) return { found: true, rows: [] };
    const c = cols(db, 'ZCALLRECORD');
    const rows = db.prepare(`SELECT Z_PK id, ${pick(c, 'ZADDRESS')} address, ZDATE date, ${pick(c, 'ZDURATION', '0')} duration, ${pick(c, 'ZORIGINATED', '0')} originated, ${pick(c, 'ZANSWERED', '0')} answered, ${pick(c, 'ZCALLTYPE')} callType, ${pick(c, 'ZSERVICE_PROVIDER')} provider, ${pick(c, 'ZNAME')} name FROM ZCALLRECORD ORDER BY ZDATE`).all();
    const TYPE = { 1: 'Phone', 8: 'FaceTime video', 16: 'FaceTime audio' };
    return { found: true, rows: rows.map(r => { const ts = appleTime(r.date); const address = r.address == null ? '' : Buffer.isBuffer(r.address) ? r.address.toString('utf8') : String(r.address);
      const dir = r.originated ? 'Outgoing' : (r.answered ? 'Incoming' : 'Missed');
      return { id: r.id, timestamp: ts, address, name: r.name || '', duration: Math.round(Number(r.duration) || 0), direction: dir, type: TYPE[r.callType] || String(r.provider || r.callType || ''),
        key: `backup:${this.id}:call:${r.id}`, meta: this.meta(file, { kind: 'call', timestamp: ts, description: `${dir} ${TYPE[r.callType] || 'call'} ${address} (${Math.round(Number(r.duration) || 0)} s)` }) }; }) };
  }
  contacts() {
    const h = this.dbFor('HomeDomain', 'Library/AddressBook/AddressBook.sqlitedb'); if (!h) return { found: false, rows: [] };
    const { db, file } = h; const c = cols(db, 'ABPerson');
    const people = db.prepare(`SELECT ROWID id, ${pick(c, 'First')} first, ${pick(c, 'Last')} last, ${pick(c, 'Organization')} org, ${pick(c, 'CreationDate')} created, ${pick(c, 'ModificationDate')} modified FROM ABPerson`).all();
    const mv = hasTable(db, 'ABMultiValue') ? db.prepare('SELECT record_id rid, property prop, value FROM ABMultiValue').all() : [];
    return { found: true, rows: people.map(p => { const vals = mv.filter(m => m.rid === p.id); const name = [p.first, p.last].filter(Boolean).join(' ') || p.org || '(no name)';
      const phones = vals.filter(m => m.prop === 3).map(m => String(m.value)), emails = vals.filter(m => m.prop === 4).map(m => String(m.value));
      return { id: p.id, name, org: p.org || '', phones, emails, created: appleTime(p.created), modified: appleTime(p.modified),
        key: `backup:${this.id}:contact:${p.id}`, meta: this.meta(file, { kind: 'contact', timestamp: appleTime(p.modified || p.created), description: `Contact ${name}${phones.length ? ' · ' + phones.join(', ') : ''}${emails.length ? ' · ' + emails.join(', ') : ''}` }) }; }) };
  }
  photos() {
    const out = []; const seen = new Set();
    const h = this.dbFor('CameraRollDomain', 'Media/PhotoData/Photos.sqlite');
    if (h) {
      const t = hasTable(h.db, 'ZASSET') ? 'ZASSET' : hasTable(h.db, 'ZGENERICASSET') ? 'ZGENERICASSET' : '';
      if (t) { const c = cols(h.db, t);
        for (const r of h.db.prepare(`SELECT Z_PK id, ZDIRECTORY dir, ZFILENAME name, ${pick(c, 'ZDATECREATED')} created, ${pick(c, 'ZMODIFICATIONDATE')} modified, ${pick(c, 'ZLATITUDE')} lat, ${pick(c, 'ZLONGITUDE')} lng, ${pick(c, 'ZKIND')} kind, ${pick(c, 'ZWIDTH')} w, ${pick(c, 'ZHEIGHT')} h, ${pick(c, 'ZUNIFORMTYPEIDENTIFIER')} uti FROM ${t}`).all()) {
          const rel = `Media/${r.dir}/${r.name}`; const f = this.find('CameraRollDomain', rel); seen.add(rel);
          const gps = (r.lat != null && r.lng != null && !(r.lat === -180 && r.lng === -180) && !(r.lat === 0 && r.lng === 0)) ? { lat: r.lat, lng: r.lng } : null;
          out.push({ name: r.name, relativePath: rel, fileID: f ? f.fileID : '', available: !!(f && this.physical(f.fileID)), created: appleTime(r.created), modified: appleTime(r.modified), gps, kind: r.kind === 1 ? 'video' : 'image', width: r.w, height: r.h, uti: r.uti || '', size: f ? f.size : null });
        } }
    }
    for (const f of this.files()) if (f.domain === 'CameraRollDomain' && /^Media\/DCIM\/.+\.(jpe?g|png|heic|heif|gif|mov|mp4)$/i.test(f.relativePath) && !seen.has(f.relativePath))
      out.push({ name: path.basename(f.relativePath), relativePath: f.relativePath, fileID: f.fileID, available: !!this.physical(f.fileID), created: f.mtime, modified: f.mtime, gps: null, kind: /\.(mov|mp4)$/i.test(f.relativePath) ? 'video' : 'image', size: f.size });
    if (this.snapshot) for (const f of this.files()) if (f.domain === '(snapshot)' && (f.kind === 'image' || f.kind === 'video'))
      out.push({ name: f.fileID.slice(0, 40) + '….' + f.relativePath.split('.').pop(), relativePath: f.relativePath, fileID: f.fileID, available: true, created: '', modified: f.mtime, gps: null, kind: f.kind, size: f.size });
    return { found: !!h || out.length > 0, rows: out.map(p => ({ ...p, key: `backup:${this.id}:photo:${p.fileID || p.relativePath}`,
      meta: this.meta(p.fileID ? this.find('CameraRollDomain', p.relativePath) : null, { kind: 'photo', domain: 'CameraRollDomain', relativePath: p.relativePath, timestamp: p.created, description: `Photo ${p.name}${p.gps ? ` (GPS ${p.gps.lat.toFixed(5)}, ${p.gps.lng.toFixed(5)})` : ''}` }) })) };
  }
  notes() {
    const rows = [];
    const h = this.dbFor(/^AppDomainGroup-group\.com\.apple\.notes$/, 'NoteStore.sqlite');
    if (h && hasTable(h.db, 'ZICCLOUDSYNCINGOBJECT')) {
      const c = cols(h.db, 'ZICCLOUDSYNCINGOBJECT');
      const cd = ['ZCREATIONDATE3', 'ZCREATIONDATE1', 'ZCREATIONDATE'].find(x => c.has(x)) || 'NULL', md = ['ZMODIFICATIONDATE1', 'ZMODIFICATIONDATE'].find(x => c.has(x)) || 'NULL';
      const folders = c.has('ZTITLE2') ? new Map(h.db.prepare('SELECT Z_PK id, ZTITLE2 t FROM ZICCLOUDSYNCINGOBJECT WHERE ZTITLE2 IS NOT NULL').all().map(r => [r.id, r.t])) : new Map();
      for (const r of h.db.prepare(`SELECT Z_PK id, ZTITLE1 title, ${pick(c, 'ZSNIPPET')} snippet, ${cd} created, ${md} modified, ${pick(c, 'ZFOLDER')} folder FROM ZICCLOUDSYNCINGOBJECT WHERE ZTITLE1 IS NOT NULL`).all())
        rows.push({ id: r.id, title: r.title, snippet: r.snippet || '', created: appleTime(r.created), modified: appleTime(r.modified), folder: folders.get(r.folder) || '', file: h.file });
    }
    const l = this.dbFor('HomeDomain', 'Library/Notes/notes.sqlite');
    if (l && hasTable(l.db, 'ZNOTE')) for (const r of l.db.prepare('SELECT Z_PK id, ZTITLE title, ZSUMMARY snippet, ZCREATIONDATE created, ZMODIFICATIONDATE modified FROM ZNOTE').all())
      rows.push({ id: 'legacy-' + r.id, title: r.title || '', snippet: r.snippet || '', created: appleTime(r.created), modified: appleTime(r.modified), folder: '', file: l.file });
    return { found: !!(h || l), rows: rows.map(({ file, ...r }) => ({ ...r, key: `backup:${this.id}:note:${r.id}`, meta: this.meta(file, { kind: 'note', timestamp: r.modified || r.created, description: `Note "${r.title}": ${r.snippet.slice(0, 120)}` }) })) };
  }
  safari() {
    const h = this.dbFor('AppDomain-com.apple.mobilesafari', 'Library/Safari/History.db'); if (!h) return { found: false, rows: [] };
    const { db, file } = h; if (!hasTable(db, 'history_visits')) return { found: true, rows: [] };
    return { found: true, rows: db.prepare('SELECT v.id id, v.visit_time t, v.title title, i.url url, i.visit_count count FROM history_visits v JOIN history_items i ON i.id = v.history_item ORDER BY v.visit_time').all()
      .map(r => ({ id: r.id, timestamp: appleTime(r.t), title: r.title || '', url: r.url || '', visitCount: r.count, key: `backup:${this.id}:safari:${r.id}`, meta: this.meta(file, { kind: 'safari', timestamp: appleTime(r.t), description: `Visited ${r.url}${r.title ? ' — ' + r.title : ''}` }) })) };
  }
  calendar() {
    const h = this.dbFor('HomeDomain', 'Library/Calendar/Calendar.sqlitedb'); if (!h) return { found: false, rows: [] };
    const { db, file } = h; if (!hasTable(db, 'CalendarItem')) return { found: true, rows: [] };
    const c = cols(db, 'CalendarItem'); const cals = hasTable(db, 'Calendar') ? new Map(db.prepare('SELECT ROWID id, title FROM Calendar').all().map(r => [r.id, r.title])) : new Map();
    const locs = hasTable(db, 'Location') ? new Map(db.prepare('SELECT ROWID id, title FROM Location').all().map(r => [r.id, r.title])) : new Map();
    return { found: true, rows: db.prepare(`SELECT ROWID id, summary, start_date s, end_date e, ${pick(c, 'calendar_id')} cal, ${pick(c, 'location_id')} loc, ${pick(c, 'description')} descr FROM CalendarItem ORDER BY start_date`).all()
      .map(r => ({ id: r.id, title: r.summary || '', start: appleTime(r.s), end: appleTime(r.e), calendar: cals.get(r.cal) || '', location: locs.get(r.loc) || '', notes: r.descr || '',
        key: `backup:${this.id}:cal:${r.id}`, meta: this.meta(file, { kind: 'calendar', timestamp: appleTime(r.s), description: `Calendar event "${r.summary || ''}"${locs.get(r.loc) ? ' at ' + locs.get(r.loc) : ''}` }) })) };
  }
  fileList({ domain, q, limit = 5000 } = {}) {
    const all = this.files();
    if (!domain) { const m = new Map(); for (const f of all) m.set(f.domain, (m.get(f.domain) || 0) + 1); return { domains: [...m.entries()].map(([d, n]) => ({ domain: d, count: n })).sort((a, b) => a.domain.localeCompare(b.domain)) }; }
    const rows = all.filter(f => f.domain === domain && (!q || f.relativePath.toLowerCase().includes(String(q).toLowerCase()))).slice(0, limit);
    return { domain, total: all.filter(f => f.domain === domain).length, rows: rows.map(f => ({ ...f, available: !f.isDir && !!this.physical(f.fileID), key: `backup:${this.id}:file:${f.fileID}`, meta: this.meta(f, { kind: 'file', timestamp: f.mtime, description: `Backup file ${f.domain}/${f.relativePath}` }) })) };
  }
  counts() {
    if (this.encrypted) return {};
    const safe = fn => { try { return fn(); } catch { return null; } };
    const m = safe(() => this.messages()); return {
      messages: m ? m.messages.length : 0, attachments: m ? m.messages.reduce((n, x) => n + x.attachments.length, 0) : 0,
      calls: (safe(() => this.calls().rows) || []).length, contacts: (safe(() => this.contacts().rows) || []).length, photos: (safe(() => this.photos().rows) || []).length,
      notes: (safe(() => this.notes().rows) || []).length, safari: (safe(() => this.safari().rows) || []).length, calendar: (safe(() => this.calendar().rows) || []).length,
      apps: this.apps().length, files: this.files().length,
    };
  }
  /** Messages + calls as timeline events for the main window (source label "iOS backup"). */
  timelineEvents() {
    if (this.encrypted) return [];
    const label = `iOS backup ${this.deviceName()} (${this.id.slice(0, 8)}…)`; const ev = [];
    try { for (const m of this.messages().messages) ev.push({ id: m.key, timestamp: m.timestamp || 'Unknown', category: 'message', sender: m.fromMe ? 'Device owner' : (m.handle || 'unknown'), recipient: m.fromMe ? (m.handle || '') : 'Device owner',
      content: m.text || (m.attachments.length ? `[${m.attachments.length} attachment(s)]` : ''), sourceFile: `${label} · HomeDomain/Library/SMS/sms.db`, accountKey: this.account ? `apple icloud::uid::${this.account}` : undefined, targetAccount: this.account || undefined,
      details: { source: 'iOS backup', backupId: this.id, appleAccount: this.account, kind: 'backup-message', service: m.service, chat: m.chat, exhibitMeta: m.meta } }); } catch {}
    try { for (const c of this.calls().rows) ev.push({ id: c.key, timestamp: c.timestamp || 'Unknown', category: 'call', sender: c.direction === 'Outgoing' ? 'Device owner' : c.address, recipient: c.direction === 'Outgoing' ? c.address : 'Device owner',
      content: `${c.direction} ${c.type || 'call'} · ${c.duration} s`, sourceFile: `${label} · HomeDomain/Library/CallHistoryDB/CallHistory.storedata`, accountKey: this.account ? `apple icloud::uid::${this.account}` : undefined, targetAccount: this.account || undefined,
      details: { source: 'iOS backup', backupId: this.id, appleAccount: this.account, kind: 'backup-call', exhibitMeta: c.meta } }); } catch {}
    return ev;
  }
  /** In-memory preview bytes for one backup file (never written to disk). */
  preview(fileID, max = 64 * 1024 * 1024) {
    const f = this.files().find(x => x.fileID === fileID); const p = f && this.physical(fileID); if (!p) return null;
    const st = fs.statSync(p); if (st.size > max) return { tooLarge: true, size: st.size };
    let b = fs.readFileSync(p); const ext = path.extname(f.relativePath).toLowerCase();
    if (SI.lzfse.isLzfse(b)) { try { b = SI.lzfse.decompress(b, max); } catch { return { error: 'LZFSE data could not be decompressed' }; } }
    if (/^(bplist|<\?xml|<plist)/.test(b.toString('latin1', 0, 8)) && b.length <= 16 * 1048576) { try { return { mime: 'application/json', text: SI.plistText(b, module.exports), size: b.length }; } catch { return { error: 'plist could not be parsed' }; } }
    if (f.kind === 'encrypted') return { error: 'Encrypted (protected class) — needs the keybag class keys' };
    const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif', '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.webp': 'image/webp' };
    return { mime: MIME[ext] || 'application/octet-stream', b64: b.toString('base64'), size: b.length };
  }
}

const KNOWN_DB = new Set(['sms.db', 'addressbook.sqlitedb', 'callhistory.storedata', 'photos.sqlite', 'notestore.sqlite', 'history.db', 'calendar.sqlitedb', 'notes.sqlite']);

/** Find backup folders below root (folders that hold Manifest.db / Manifest.plist / Info.plist). */
function findBackupDirs(root) {
  const out = new Set(); if (!root) return [];
  try { const r = fs.statSync(root).isFile() ? path.dirname(root) : root; const snaps = findSnapshotGroups(r); if (snaps.length) { const hits = snaps.map(s => s.dir); const rest = findBackupDirsClassic(r).filter(d => !snaps.some(s => s.parts.some(p => p.startsWith(d) || d.startsWith(p)))); return [...hits, ...rest]; } } catch {}
  return findBackupDirsClassic(root);
}
function findBackupDirsClassic(root) {
  const out = new Set(); if (!root) return [];
  const walk = (d, depth) => { if (depth > 12) return; let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (ents.some(e => e.isFile() && /^(Manifest\.db|Manifest\.plist)$/i.test(e.name))) { out.add(d); return; }
    for (const e of ents) if (e.isDirectory()) walk(path.join(d, e.name), depth + 1); };
  try { if (fs.statSync(root).isFile()) root = path.dirname(root); } catch { return []; }
  walk(root, 0);
  if (!out.size) { // unknown layout: any recognised database below root -> one loose backup rooted at root
    let found = false; const scan = (d, depth) => { if (found || depth > 30) return; let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) { if (found) return; if (e.isFile() && (KNOWN_DB.has(e.name.toLowerCase()) || /^(Info\.plist|Status\.plist|Manifest\.mbdb)$/i.test(e.name))) found = true; else if (e.isDirectory()) scan(path.join(d, e.name), depth + 1); } };
    scan(root, 0); if (found) out.add(root);
  }
  return [...out];
}

// ---------- backups still inside a .zip ----------
/** "X:\\…\\name.zip\\inner\\path" (Explorer/Magnet show zips as folders) -> { zip, inner } or null. */
function splitZipPath(p) {
  const parts = String(p || '').split(/[\\/]+/);
  for (let i = 1; i <= parts.length; i++) {
    const cand = parts.slice(0, i).join(path.sep); if (!/\.zip$/i.test(cand)) continue;
    try { if (fs.statSync(cand.length === 2 && cand.endsWith(':') ? cand + path.sep : cand).isFile()) return { zip: cand, inner: parts.slice(i).filter(Boolean).join('/') }; } catch {}
  }
  return null;
}
function zipEntries(zipPath) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, z) => {
    if (err) return reject(err); const out = [];
    z.on('entry', e => { out.push({ name: e.fileName.replace(/\\/g, '/'), size: e.uncompressedSize, crc32: e.crc32, dir: /\/$/.test(e.fileName) }); z.readEntry(); });
    z.on('end', () => resolve(out)); z.on('error', reject); z.readEntry();
  }));
}
const norm = s => s.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
/** Describe what a zip holds (entries list only; nothing extracted). */
async function inspectZip(zipPath, inner = '') {
  const pre = norm(inner).toLowerCase(); const all = await zipEntries(zipPath);
  const ents = all.filter(e => !e.dir && (!pre || norm(e.name).toLowerCase().startsWith(pre + '/') || norm(e.name).toLowerCase() === pre));
  const ext = {}; for (const e of ents) { const x = (path.extname(e.name) || '(none)').toLowerCase(); ext[x] = (ext[x] || 0) + 1; }
  const base = e => e.name.split('/').pop().toLowerCase();
  const summaryOnly = ents.length > 0 && ents.every(e => /^(summary|downloadsummary|metadata)\.txt$/.test(base(e)));
  return { zip: zipPath, inner: norm(inner), entries: ents.length, totalBytes: ents.reduce((n, e) => n + e.size, 0), ext,
    hasManifestDb: ents.some(e => base(e) === 'manifest.db'), hasManifestPlist: ents.some(e => base(e) === 'manifest.plist'),
    knownDbs: [...new Set(ents.map(base).filter(b => KNOWN_DB.has(b)))], summaryOnly, empty: ents.length === 0 };
}
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crcUpdate(c, b) { if (require('zlib').crc32) return require('zlib').crc32(b, c); c = ~c; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; }
/**
 * Extract the part of a zip under `inner` into destDir (a working folder; the zip is only read).
 * Every file is CRC-checked against the zip and SHA-256 hashed; the zip's own SHA-256 is taken before and after.
 */
async function extractZipBackup(zipPath, inner, destDir, onStatus) {
  const yauzl = require('yauzl'); const pre = norm(inner || ''); const preLc = pre.toLowerCase();
  const zipShaBefore = sha256File(zipPath); fs.mkdirSync(destDir, { recursive: true });
  const rootAbs = path.resolve(destDir); const files = []; let n = 0;
  await new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, z) => {
    if (err) return reject(err);
    z.on('entry', e => {
      const name = norm(e.fileName.replace(/\\/g, '/'));
      if (/\/$/.test(e.fileName) || (preLc && !name.toLowerCase().startsWith(preLc + '/'))) return z.readEntry();
      const rel = preLc ? name.slice(pre.length + 1) : name; const out = path.resolve(rootAbs, ...rel.split('/').filter(s => s && s !== '.' && s !== '..'));
      if (!out.startsWith(rootAbs + path.sep)) return z.readEntry(); // zip-slip guard
      fs.mkdirSync(path.dirname(out), { recursive: true });
      z.openReadStream(e, (er, rs) => { if (er) return reject(er);
        const h = crypto.createHash('sha256'); let crc = 0; const ws = fs.createWriteStream(out, { flags: 'wx' });
        rs.on('data', b => { h.update(b); crc = crcUpdate(crc, b); }); rs.pipe(ws);
        ws.on('finish', () => { files.push({ path: rel, bytes: e.uncompressedSize, sha256: h.digest('hex'), crcOk: (crc >>> 0) === (e.crc32 >>> 0) }); if (++n % 200 === 0 && onStatus) onStatus(`Extracted ${n} files…`); z.readEntry(); });
        ws.on('error', reject); rs.on('error', reject); });
    });
    z.on('end', resolve); z.on('error', reject); z.readEntry();
  }));
  const zipShaAfter = sha256File(zipPath);
  const manifest = { zip: path.basename(zipPath), inner: pre, zipSha256Before: zipShaBefore, zipSha256After: zipShaAfter, zipUnchanged: zipShaBefore === zipShaAfter, files: files.length, allCrcOk: files.every(f => f.crcOk), extractedAt: new Date().toISOString(), entries: files };
  fs.writeFileSync(path.join(destDir, '_uwrp_extract_manifest.json'), JSON.stringify(manifest, null, 1));
  return { destDir, ...manifest, entries: undefined };
}

module.exports = { findSnapshotGroups, sniff, IosBackup, findBackupDirs, splitZipPath, zipEntries, inspectZip, extractZipBackup, KNOWN_DB, openReadOnly, appleTime, parseBplist, readPlistBuffer, readPlist, unarchive, attributedBodyText, sha256File, roUri, custody, accountFromPath };
