'use strict';
// uwrp-b11: iCloud snapshot helpers — keybag / FileInfoList detection, A_ id -> path mapping, plist summaries,
// LZFSE (in memory) and an "likely encrypted" classification. Read-only; nothing is written to disk; no values are logged.
const fs = require('fs'), path = require('path');
const lzfse = require('./lzfse.cjs');
function head(p, n) { try { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(n); const k = fs.readSync(fd, b, 0, n, 0); fs.closeSync(fd); return b.subarray(0, k); } catch { return Buffer.alloc(0); } }
function entropy(b) { if (!b.length) return 0; const c = new Uint32Array(256); for (const x of b) c[x]++; let e = 0; for (const n of c) if (n) { const q = n / b.length; e -= q * Math.log2(q); } return e; }
/** High-entropy content with no known header: what protected-class (per-file key) iCloud content looks like. */
function looksEncrypted(b) { return b.length >= 256 && entropy(b.subarray(0, 65536)) > 7.6; }
/** A_<4hex>_<UUID>_<base64 id, "/" written as "__">_<size>  ->  id variants used to match listings. */
function assetIds(name) {
  const m = /^[AN]_[0-9a-f]{4}_[0-9a-f-]{36}_(.+?)_(\d+)$/i.exec(name); if (!m) return [];
  const b64 = m[1].replace(/__/g, '/'); const out = new Set([b64, b64.replace(/=+$/, ''), m[1]]);
  try { const raw = Buffer.from(b64, 'base64'); if (raw.length >= 16) { out.add(raw.toString('hex')); out.add(raw.toString('base64url').replace(/=+$/, '')); } } catch {}
  return [...out].map(s => s.toLowerCase() === s ? s : s).filter(Boolean);
}
const idKey = s => String(s).trim();
// ---------- keybag ----------
const TAGS = new Set(['VERS', 'TYPE', 'UUID', 'HMCK', 'WRAP', 'SALT', 'ITER', 'DPWT', 'DPIC', 'DPSL', 'CLAS', 'WPKY', 'KTYP', 'PBKY', 'GRCE', 'TKMT', 'SART', 'UUID', 'DATA', 'SIGN', 'AUTH']);
function tlv(b) { const out = []; let p = 0; while (p + 8 <= b.length) { const t = b.toString('latin1', p, p + 4), n = b.readUInt32BE(p + 4); if (!/^[A-Z0-9]{4}$/.test(t) || p + 8 + n > b.length) return null; out.push([t, b.subarray(p + 8, p + 8 + n)]); p += 8 + n; } return p === b.length && out.length ? out : null; }
/** Structure of a keybag (no key material is returned). */
function parseKeybag(buf) {
  const cands = [['binary', buf]]; const txt = buf.toString('utf8').trim();
  if (/^[A-Za-z0-9+/=\s_-]+$/.test(txt)) { const t = txt.replace(/\s+/g, ''); if (/^[0-9a-f]+$/i.test(t) && t.length % 2 === 0) cands.push(['hex text', Buffer.from(t, 'hex')]); cands.push(['base64 text', Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64')]); }
  try { const j = JSON.parse(txt); const s = JSON.stringify(j); return { format: 'JSON text', parsed: true, fields: Object.keys(j || {}).length, note: 'JSON keybag listing' + (/WPKY|wrapped|classKey/i.test(s) ? ' with wrapped class keys' : '') }; } catch {}
  for (const [fmt, b] of cands) {
    let t = tlv(b); if (t && t.length === 1 && t[0][0] === 'DATA') { const inner = tlv(t[0][1]); if (inner) t = inner; }
    if (!t || !t.some(([k]) => TAGS.has(k))) continue;
    const get = k => { const x = t.find(e => e[0] === k); return x && x[1].length === 4 ? x[1].readUInt32BE(0) : null; };
    const classes = t.filter(e => e[0] === 'CLAS').map(e => e[1].length === 4 ? e[1].readUInt32BE(0) : null).filter(x => x != null);
    const TYPE = ['System', 'Backup', 'Escrow', 'OTA (iCloud)'];
    return { format: 'Apple keybag (TLV, ' + fmt + ')', parsed: true, version: get('VERS'), type: get('TYPE') != null ? (TYPE[get('TYPE')] || String(get('TYPE'))) : null, classes: [...new Set(classes)].sort((a, b) => a - b), wrappedKeys: t.filter(e => e[0] === 'WPKY').length, wrap: get('WRAP') };
  }
  return { format: 'unrecognised', parsed: false };
}
// ---------- FileInfoList (tolerant) ----------
const DOMAIN_RE = /\b((?:App|AppDomainGroup|AppDomainPlugin|SysContainer|SysSharedContainer)Domain-[^\s,;|\t"]+|[A-Z][A-Za-z]*Domain)\b/;
function parseFileInfoList(text) {
  const map = new Map(); let lines = 0, rows = 0;
  const add = (ids, domain, rel, extra) => { for (const id of ids) if (id && !map.has(idKey(id))) map.set(idKey(id), { domain: domain || '(listed)', relativePath: rel, ...extra }); };
  try { const j = JSON.parse(text); const walk = o => { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return; const r = recordOf(o); if (r) { rows++; add(r.ids, r.domain, r.rel, {}); } for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v); }; walk(j); return { format: 'JSON', lines: 0, rows, map }; } catch {}
  for (const line of text.split(/\r?\n/)) { lines++; if (!line.trim()) continue;
    const cells = line.split(/\t|\s*\|\s*|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
    let domain = '', rel = ''; const ids = [];
    for (const c of cells) { const d = DOMAIN_RE.exec(c); if (!domain && d && d[0].length === c.length) { domain = c; continue; }
      if (!domain && d && c.startsWith(d[0] + '/')) { domain = d[0]; rel = c.slice(d[0].length + 1); continue; }
      if (/^[0-9a-f]{40}$/i.test(c)) { ids.push(c.toLowerCase()); continue; }
      if (/^[A-Za-z0-9+/_-]{26,}={0,2}$/.test(c) && !c.includes('.')) { try { if (Buffer.from(c.replace(/__/g, '/'), 'base64').length >= 16) { ids.push(c.replace(/__/g, '/'), c.replace(/__/g, '/').replace(/=+$/, '')); try { ids.push(Buffer.from(c.replace(/__/g, '/'), 'base64').toString('hex')); } catch {} continue; } } catch {} }
      if (/^[AN]_[0-9a-f]{4}_/i.test(c)) { ids.push(...assetIds(c)); continue; }
      if (!rel && /[/\\]/.test(c) && !/^\d+$/.test(c)) rel = c.replace(/\\/g, '/'); }
    if (ids.length && (rel || domain)) { rows++; add(ids, domain, rel || '(unnamed)', {}); } }
  return { format: 'text listing', lines, rows, map };
}
function recordOf(o) { // a dict that looks like {fileID/id, domain, relativePath}
  const k = Object.keys(o); const pick = re => { const x = k.find(n => re.test(n)); return x ? o[x] : undefined; };
  const rel = pick(/^(relativePath|RelativePath|path|Path|relative_path|filePath)$/), domain = pick(/^(domain|Domain)$/), id = pick(/^(fileID|fileId|FileID|file_id|assetID|assetId|signature|Signature|id|ID)$/);
  if (typeof rel !== 'string' || id == null) return null;
  const ids = []; if (typeof id === 'string') { ids.push(id, id.replace(/=+$/, '')); if (/^[0-9a-f]{40}$/i.test(id)) ids.push(id.toLowerCase()); else try { const r = Buffer.from(id, 'base64'); if (r.length >= 16) ids.push(r.toString('hex')); } catch {} }
  else if (Buffer.isBuffer(id)) ids.push(id.toString('hex'), id.toString('base64'), id.toString('base64').replace(/=+$/, ''));
  return { ids, domain: typeof domain === 'string' ? domain : '', rel };
}
/** Find keybag / FileInfoList / manifest-like files near the snapshot parts (case-insensitive, any extension). */
function findProtectionFiles(snapDirs) {
  const roots = new Set(); for (const d of snapDirs) roots.add(path.dirname(path.dirname(path.dirname(d)))); // <Apple ID>\ (holds backup\D_\S_)
  const seen = new Set(), keybags = [], fileInfo = [], manifests = [];
  const walk = (d, depth) => { if (depth > 7 || seen.has(d)) return; seen.add(d); let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { const p = path.join(d, e.name); const lc = e.name.toLowerCase();
      if (e.isDirectory()) { if (!/^[AN]_/.test(e.name)) walk(p, depth + 1); continue; }
      if (!e.isFile() || /^[AN]_/.test(e.name)) continue;
      if (/^key_?bag/.test(lc)) keybags.push(p); else if (/^file_?info_?list/.test(lc)) fileInfo.push(p); else if (/^(manifest\.(plist|db|mbdb)|info\.plist|status\.plist)$/.test(lc)) manifests.push(p); } };
  for (const r of roots) walk(r, 0);
  return { keybags, fileInfo, manifests };
}
/** JSON text of a plist (binary or XML; NSKeyedArchiver is unarchived). Data blobs are summarised, not dumped. */
function plistText(buf, B) {
  let o = B.readPlistBuffer(buf); try { if (o && o.$archiver) o = B.unarchive(o) ?? o; } catch {}
  const seen = new WeakSet();
  const s = JSON.stringify(o, (k, v) => { if (v && v.type === 'Buffer' && Array.isArray(v.data)) return `<data ${v.data.length} bytes>`; if (v instanceof Uint8Array) return `<data ${v.length} bytes>`; if (typeof v === 'bigint') return String(v); if (v && typeof v === 'object') { if (seen.has(v)) return '<cycle>'; seen.add(v); } return v; }, 1);
  return s && s.length > 400000 ? s.slice(0, 400000) + '\n… (truncated)' : s;
}
module.exports = { lzfse, head, entropy, looksEncrypted, assetIds, parseKeybag, parseFileInfoList, recordOf, findProtectionFiles, plistText };
