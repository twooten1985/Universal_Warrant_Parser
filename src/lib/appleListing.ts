/**
 * Server-side listing of an imported Apple return. Read-only: walks the folders and
 * builds "<account>/<TYPE>/<rest>" relative paths so parsers and the account switcher
 * see one account per Apple account number (1..N, discovered from folder names).
 */
import fs from 'fs';
import path from 'path';

const MEDIA_IMG = new Set(['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'tif', 'tiff', 'bmp']);
const MEDIA_VID = new Set(['mp4', 'mov', 'm4v', '3gp', 'avi']);
const TEXT = new Set(['csv', 'txt', 'vcf', 'ics', 'eml', 'json']);
const TEXT_MAX = 300 * 1024 * 1024;

export interface AppleEntry { path: string; name: string; size: number; relativePath: string; kind: 'text' | 'media' | 'binary'; mediaType?: 'image' | 'video'; noData?: boolean }

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 24) return out;
  let ents: fs.Dirent[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1); else if (e.isFile() && !e.name.endsWith('.uwrp-part')) out.push(p); // /*uwrp-b7*/ skip unfinished extractions
  }
  return out;
}

const STEM = /^(\d+)-([A-Z][A-Z-]*?)-(\d+)$/i;

// uwrp-b7: Apple bash-download layout "<acct>/<appleId>/<Category>/..." -> same "<acct>/<TYPE>/<appleId>/<Category>/..." as zipped returns
const FOLDER_TYPE: Record<string, string> = { account: 'ACCOUNT', bookmarks: 'BOOKMARKS', icloudbookmarks: 'BOOKMARKS', contacts: 'CONTACTS', log: 'LOG', logs: 'LOG',
  mail: 'MAIL', mailheader: 'MAILHEADER', notes: 'NOTES', signinwithapple: 'SIGNINWITHAPPLE', cloudphotolibrary: 'CLOUDPHOTOLIBRARY', icloudphotos: 'CLOUDPHOTOLIBRARY',
  icloudcalendarsandreminders: 'CALENDARS', calendars: 'CALENDARS', icloudbackup: 'BACKUP', backup: 'BACKUP', iclouddrive: 'ICLOUDDRIVE',
  icloudreminders: 'ICLOUDREMINDERS', reminders: 'ICLOUDREMINDERS', maps: 'MAPS', messagesinicloud: 'MESSAGESINICLOUD', safaribrowsinghistory: 'SAFARIBROWSINGHISTORY',
  facetimelog: 'FACETIME-LOG', imessagelog: 'IMESSAGE-LOG', icloudlog: 'ICLOUD-LOG', maillog: 'MAIL-LOG' };
export const typeFromFolder = (n: string) => FOLDER_TYPE[String(n || '').toLowerCase().replace(/[^a-z]/g, '')] || null;

export function relFor(root: string, file: string): string | null {
  const parts = path.relative(root, file).split(path.sep);
  if (/^\d+$/.test(parts[0] || '') && parts.length >= 4) { const t = typeFromFolder(parts[2]); if (t) return [parts[0], t, ...parts.slice(1)].join('/'); }
  const m = parts[0] && parts[0].match(STEM);
  if (!m) return null;
  const rest = parts.slice(1);
  if (rest[0] === m[1]) rest.shift();
  return [m[1], m[2].toUpperCase(), ...rest].join('/');
}

/** extracted may be one root or several (mixed layouts: in-place extracted folders + working copies). */
export function listAppleReturn(extractedRoots: string | string[], derived: string): AppleEntry[] {
  const out: AppleEntry[] = [];
  const roots = (Array.isArray(extractedRoots) ? extractedRoots : [extractedRoots]).map(String).filter(Boolean);
  const seen = new Set<string>();
  for (const extracted of roots) {
  if (!fs.existsSync(extracted)) continue;
  {
    const stems = fs.readdirSync(extracted, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const st of stems) {
      const files = walk(path.join(extracted, st.name));
      // "only Summary.txt" = Apple produced no data for that type; judged per type folder (bash layout holds many types per account)
      const unitOf = (f: string) => { const p = path.relative(path.join(extracted, st.name), f).split(path.sep); return /^\d+$/.test(st.name) && p.length >= 3 ? p.slice(0, 2).join('/') : ''; };
      const byUnit = new Map<string, string[]>(); for (const f of files) { const k = unitOf(f); byUnit.set(k, [...(byUnit.get(k) || []), f]); }
      const summaryOnly = new Set([...byUnit].filter(([, fs2]) => fs2.length > 0 && fs2.every(f => /^summary\.txt$/i.test(path.basename(f)))).map(([k]) => k));
      for (const f of files) {
        const onlySummary = summaryOnly.has(unitOf(f));
        const rel = relFor(extracted, f);
        if (!rel || seen.has(f)) continue;
        seen.add(f);
        const name = path.basename(f);
        const ext = (name.includes('.') ? name.split('.').pop() || '' : '').toLowerCase();
        if (ext === 'xlsx' || ext === 'zip') continue; // xlsx read via derived tables; nested zips were extracted
        const size = fs.statSync(f).size;
        const kind: AppleEntry['kind'] = MEDIA_IMG.has(ext) || MEDIA_VID.has(ext) ? 'media' : TEXT.has(ext) && size <= TEXT_MAX ? 'text' : 'binary';
        out.push({ path: f, name, size, relativePath: rel, kind, mediaType: MEDIA_IMG.has(ext) ? 'image' : MEDIA_VID.has(ext) ? 'video' : undefined, ...(onlySummary ? { noData: true } : {}) });
      }
    }
  }
  }
  if (derived && fs.existsSync(derived)) {
    for (const f of walk(derived)) {
      if (!/\.csv$/i.test(f)) continue;
      const relRaw = path.relative(derived, f).split(path.sep);
      let rel: string;
      if (relRaw[0] === '_production') rel = ['production', 'ACCOUNTWORKBOOK', ...relRaw.slice(1)].join('/');
      else rel = relFor(derived, f) || relRaw.join('/');
      out.push({ path: f, name: path.basename(f), size: fs.statSync(f).size, relativePath: rel, kind: 'text' });
    }
  }
  return out;
}
