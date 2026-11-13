/**
 * Apple iCloud return parsers (text only). Paths come from the Apple importer as
 * relativePath = "<account>/<TYPE>/<rest...>" so every record is tied to its account.
 * Media files never reach this module; they go to MediaVault with in-memory previews.
 */
import type { ForensicEvent, ParseResult } from '../types';

export const APPLE_PROVIDER_LABEL = 'Apple iCloud';

const empty = (): ParseResult['summaryStats'] => ({ totalEvents: 0, messagesCount: 0, connectionsCount: 0, filesCount: 0, callsCount: 0, uniqueIPs: [], dateRange: null });

const STEM_SEG = /^(\d+)-([A-Z][A-Z-]*?)-(\d+)(?:\.zip)?(?:\.extracted)?$/i;
export function appleContext(relativePath?: string): { account: string; type: string; identifier: string; folder: string } {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const folder = parts.length > 1 ? parts[parts.length - 2] : '';
  // Any depth: "<anything>/<acct>-<TYPE>-<id>/<acct>/<identifier>/..." (e.g. the plain Folder button)
  const si = parts.findIndex(p => STEM_SEG.test(p));
  if (si >= 0) {
    const m = parts[si].match(STEM_SEG)!;
    const ident = parts.slice(si + 1).find(p => /@|^Ph_/i.test(p)) || '';
    return { account: m[1], type: m[2].toUpperCase(), identifier: ident, folder };
  }
  const account = /^\d+$/.test(parts[0] || '') ? parts[0] : (parts[0] || 'unknown');
  const type = (parts[1] || '').toUpperCase();
  const ident = parts.find(p => /@|^Ph_/i.test(p)) || '';
  return { account, type, identifier: ident, folder };
}

export function appleAccountKey(account: string): string {
  return `${APPLE_PROVIDER_LABEL.toLowerCase()}::uid::${account}`;
}

// ---- small helpers ----
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}

const PACIFIC = 'America/Los_Angeles';
function tzOffsetMinutes(utcMs: number, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p: Record<string, string> = {};
    for (const x of dtf.formatToParts(new Date(utcMs))) p[x.type] = x.value;
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === '24' ? '0' : p.hour), +p.minute, +p.second);
    return (asUtc - utcMs) / 60000;
  } catch { return 0; }
}

/** Normalize Apple timestamps to ISO UTC. sheetTz is 'GMT' or 'PST/PDT' from the sheet preamble. */
export function appleTime(raw: string | undefined, sheetTz = 'GMT'): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'Unknown';
  if (/^\d{10}(\.\d+)?$/.test(s)) return new Date(parseFloat(s) * 1000).toISOString();
  if (/^\d{13}$/.test(s)) return new Date(+s).toISOString();
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Math.round((parseFloat(s) - 25569) * 86400000)).toISOString();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$|\b(UTC|GMT)\b/.test(s)) { const d = new Date(s.replace(/\bUTC\b/, 'Z')); if (!isNaN(+d)) return d.toISOString(); }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/) || null;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  let ms: number | null = null;
  if (m) ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  else if (us) { let h = +us[4]; if (us[7]) { if (/pm/i.test(us[7]) && h < 12) h += 12; if (/am/i.test(us[7]) && h === 12) h = 0; } ms = Date.UTC(+us[3], +us[1] - 1, +us[2], h, +us[5], +(us[6] || 0)); }
  else { const d = new Date(s); if (!isNaN(+d)) return d.toISOString(); return s; }
  if (/PST|PDT|pacific/i.test(sheetTz)) ms -= tzOffsetMinutes(ms, PACIFIC) * 60000;
  return new Date(ms).toISOString();
}

const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i;
function finish(events: ForensicEvent[], accountInfo?: ParseResult['accountInfo']): ParseResult {
  const ips = new Set<string>(); const ts: string[] = [];
  let m = 0, c = 0, f = 0, k = 0;
  for (const e of events) {
    if (e.ipAddress) ips.add(e.ipAddress);
    if (/^\d{4}-/.test(e.timestamp)) ts.push(e.timestamp);
    if (e.category === 'message') m++; else if (e.category === 'connection') c++; else if (e.category === 'file') f++; else if (e.category === 'call') k++;
  }
  ts.sort();
  return { provider: 'apple', events, accountInfo, summaryStats: { totalEvents: events.length, messagesCount: m, connectionsCount: c, filesCount: f, callsCount: k, uniqueIPs: [...ips], dateRange: ts.length ? { start: ts[0], end: ts[ts.length - 1] } : null } };
}

let seq = 0;
function ev(ctx: ReturnType<typeof appleContext>, file: string, e: Partial<ForensicEvent> & Pick<ForensicEvent, 'category' | 'content'>): ForensicEvent {
  return {
    id: `apple-${ctx.account}-${ctx.type}-${Date.now().toString(36)}-${(seq++).toString(36)}`,
    timestamp: 'Unknown', sender: APPLE_PROVIDER_LABEL, sourceFile: file,
    ...(/^\d+$/.test(ctx.account) ? { targetAccount: ctx.account, accountKey: appleAccountKey(ctx.account) } : {}),
    ...e,
    details: { appleType: ctx.type, appleAccount: ctx.account, ...(e.details || {}) },
  };
}

function baseAccount(ctx: ReturnType<typeof appleContext>): ParseResult['accountInfo'] {
  if (!/^\d+$/.test(ctx.account)) return undefined; // shared production workbook: no pseudo-account
  const isPhone = /^Ph_/i.test(ctx.identifier);
  return {
    userId: ctx.account,
    username: ctx.identifier ? ctx.identifier.replace(/^Ph_/i, '') : ctx.account,
    email: !isPhone && ctx.identifier.includes('@') ? ctx.identifier : undefined,
    phone: isPhone ? ctx.identifier.replace(/^Ph_/i, '') : undefined,
    provider: APPLE_PROVIDER_LABEL,
    accountKey: appleAccountKey(ctx.account),
    otherDetails: { 'Apple account number': ctx.account, ...(isPhone ? { 'Identifier type': 'Phone number (logs only)' } : {}) },
  };
}

// ---- tables (Apple CSVs and derived xlsx sheets) ----
interface Table { header: string[]; rows: string[][]; preamble: string[]; tz: string; sheet: string }
function readTable(text: string): Table {
  const lines = text.split(/\r?\n/);
  const pre: string[] = [];
  let i = 0;
  while (i < lines.length && lines[i].startsWith('# ')) { pre.push(lines[i].slice(2)); i++; }
  const rows = csvRows(lines.slice(i).join('\n'));
  const tzLine = pre.find(l => /^Timezone:/i.test(l)) || '';
  return { header: (rows[0] || []).map(h => h.trim()), rows: rows.slice(1), preamble: pre, tz: tzLine.replace(/^Timezone:\s*/i, '') || 'GMT', sheet: (pre.find(l => /^Sheet:/.test(l)) || '').replace(/^Sheet:\s*/, '') };
}
const find = (h: string[], re: RegExp) => h.findIndex(x => re.test(x));

function categoryFor(type: string, sheet: string): ForensicEvent['category'] {
  if (/FACETIME/.test(type)) return 'call';
  if (/LOG$|IDMS|SIGNON|IFORGOT/i.test(type + ' ' + sheet)) return 'connection';
  if (/MAIL/.test(type)) return 'message';
  if (/ICLOUDDRIVE|CLOUDPHOTO/.test(type)) return 'file';
  if (/ACCOUNT|SUBSCRIBER|GCRM|REGISTRATION/i.test(type + ' ' + sheet)) return 'profile';
  return 'other';
}

function parseTable(ctx: ReturnType<typeof appleContext>, file: string, text: string): ParseResult {
  const t = readTable(text);
  const h = t.header.map(x => x.toLowerCase());
  const events: ForensicEvent[] = [];
  if (!h.length) {
    return finish([ev(ctx, file, { category: 'other', content: `No data produced: ${t.sheet || file}`, details: { noData: true, preamble: t.preamble.join(' | ') } })], baseAccount(ctx));
  }
  const iTs = find(h, /(^|_)(ts|timestamp|date|time)$|signon_ts|activity_ts|create_ts|date|time/);
  const iIp = find(h, /ip/);
  const iFrom = find(h, /^(from|sender|caller|initiator)/);
  const iTo = find(h, /^(to|recipient|callee|target|receiver)/);
  const iSubj = find(h, /subject|content_name|app_name|title|summary|url|ac_name|event/);
  const cat = categoryFor(ctx.type, t.sheet);
  const accountInfo = baseAccount(ctx);
  const isAcctSheet = /ACCOUNT/.test(ctx.type) || /account|subscriber/i.test(t.sheet);
  for (const r of t.rows) {
    const rec: Record<string, string> = {};
    t.header.forEach((k, idx) => { if (k && r[idx]) rec[k] = r[idx]; });
    if (!Object.keys(rec).length) continue;
    const ip = iIp >= 0 ? (r[iIp] || '').trim() : '';
    const summaryBits = [iSubj >= 0 ? r[iSubj] : '', iFrom >= 0 ? 'from ' + r[iFrom] : '', iTo >= 0 ? 'to ' + r[iTo] : ''].filter(x => x && !/^(from|to) $/.test(x));
    events.push(ev(ctx, file, {
      category: cat,
      timestamp: iTs >= 0 ? appleTime(r[iTs], t.tz) : 'Unknown',
      sender: iFrom >= 0 && r[iFrom] ? r[iFrom] : `${APPLE_PROVIDER_LABEL} ${t.sheet || ctx.type}`,
      recipient: iTo >= 0 ? r[iTo] || undefined : undefined,
      ipAddress: ip && IP_RE.test(ip) ? ip : undefined,
      content: `${t.sheet || ctx.type}: ${summaryBits.join(' · ') || Object.values(rec).slice(0, 4).join(' · ')}`.slice(0, 600),
      details: { ...rec, sheet: t.sheet, sheetTimezone: t.tz },
    }));
  }
  if (isAcctSheet && t.rows[0] && accountInfo) {
    const rec: Record<string, string> = {};
    t.header.forEach((k, idx) => { if (k && t.rows[0][idx]) rec[k] = t.rows[0][idx]; });
    const pick = (re: RegExp) => { const k = Object.keys(rec).find(x => re.test(x.toLowerCase())); return k ? rec[k] : undefined; };
    accountInfo.email = accountInfo.email || pick(/email|apple ?id|logon/);
    accountInfo.displayName = [pick(/^first.?name/), pick(/^last.?name/)].filter(Boolean).join(' ') || accountInfo.displayName;
    accountInfo.phone = accountInfo.phone || pick(/phone/);
    accountInfo.createdDate = pick(/signup|creat|registered/) ? appleTime(pick(/signup|creat|registered/), t.tz) : undefined;
    accountInfo.otherDetails = { ...(accountInfo.otherDetails || {}), ...Object.fromEntries(Object.entries(rec).slice(0, 40)) };
  }
  return finish(events, accountInfo);
}

// ---- Messages in iCloud ----
function parseMessages(ctx: ReturnType<typeof appleContext>, file: string, text: string): ParseResult {
  const t = readTable(text);
  const h = t.header.map(x => x.toLowerCase());
  const iTs = find(h, /date|time|timestamp/);
  const iFrom = find(h, /^(from|sender|handle|author)/);
  const iTo = find(h, /^(to|recipient|participants?|recipients)/);
  const iBody = find(h, /^(text|body|message|content)/);
  const iChat = find(h, /chat|conversation|thread|group|guid/);
  const iMine = find(h, /is.?from.?me|from.?me|direction|outgoing/);
  const iSvc = find(h, /service/);
  const iAtt = find(h, /attach/);
  const events: ForensicEvent[] = [];
  for (const r of t.rows) {
    const rec: Record<string, string> = {};
    t.header.forEach((k, idx) => { if (k && r[idx]) rec[k] = r[idx]; });
    if (!Object.keys(rec).length) continue;
    const mineRaw = iMine >= 0 ? String(r[iMine] || '').toLowerCase() : '';
    const mine = mineRaw ? /^(1|true|yes|out|outgoing|sent)/.test(mineRaw) : undefined;
    const from = iFrom >= 0 ? r[iFrom] : '';
    const to = iTo >= 0 ? r[iTo] : '';
    const convo = (iChat >= 0 && r[iChat]) || [from, to].filter(Boolean).sort().join(' ↔ ') || 'Unknown chat';
    events.push(ev(ctx, file, {
      category: 'message',
      timestamp: iTs >= 0 ? appleTime(r[iTs], t.tz) : 'Unknown',
      sender: from || (mine ? ctx.identifier || ctx.account : 'Unknown'),
      recipient: to || undefined,
      content: iBody >= 0 ? r[iBody] || '' : Object.values(rec).join(' · '),
      details: { ...rec, conversationId: convo, threadName: convo, ...(mine !== undefined ? { isFromSuspect: mine } : {}), ...(iSvc >= 0 ? { service: r[iSvc] } : {}), ...(iAtt >= 0 && r[iAtt] ? { attachments: r[iAtt] } : {}) },
    }));
  }
  return finish(events, baseAccount(ctx));
}

// ---- vCard ----
function unfold(t: string) { return t.replace(/\r?\n[ \t]/g, ''); }
function parseVcf(ctx: ReturnType<typeof appleContext>, file: string, text: string): ParseResult {
  const events: ForensicEvent[] = [];
  for (const card of unfold(text).split(/BEGIN:VCARD/i).slice(1)) {
    const get = (k: string) => (card.match(new RegExp('^' + k + '(?:;[^:\\r\\n]*)?:(.*)$', 'gim')) || []).map(l => l.replace(/^[^:]*:/, '').trim());
    const fn = get('FN')[0] || get('N')[0]?.split(';').filter(Boolean).reverse().join(' ') || '(no name)';
    const tels = get('TEL'), emails = get('EMAIL'), org = get('ORG')[0], note = get('NOTE')[0];
    const adrs = get('ADR').map(a => a.split(';').map(x => x.trim()).filter(Boolean).join(', ')).filter(Boolean);
    events.push(ev(ctx, file, {
      category: 'profile', timestamp: get('REV')[0] ? appleTime(get('REV')[0]) : 'Unknown', sender: 'iCloud Contacts',
      content: `Contact: ${fn}${tels.length ? ' · ' + tels.join(', ') : ''}${emails.length ? ' · ' + emails.join(', ') : ''}`,
      details: { kind: 'contact', name: fn, phones: tels.join('; '), emails: emails.join('; '), org: (org || '').replace(/;+$/, '').replace(/;/g, ', '), addresses: adrs.join('; '), note: note || '', hasPhoto: /^PHOTO/im.test(card) },
    }));
  }
  return finish(events, baseAccount(ctx));
}

// ---- iCalendar ----
function icsTime(v?: string): string {
  if (!v) return 'Unknown';
  const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return v;
  return m[4] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString() : `${m[1]}-${m[2]}-${m[3]}`;
}
function parseIcs(ctx: ReturnType<typeof appleContext>, file: string, text: string, relativePath: string): ParseResult {
  const events: ForensicEvent[] = [];
  const calendar = relativePath.replace(/\\/g, '/').split('/').slice(-2, -1)[0] || '';
  for (const blk of unfold(text).split(/BEGIN:(?=VEVENT|VTODO)/i).slice(1)) {
    const kind = /^VTODO/i.test(blk) ? 'reminder' : 'calendar-event';
    const get = (k: string) => { const m = blk.match(new RegExp('^' + k + '(?:;[^:\\r\\n]*)?:(.*)$', 'im')); return m ? m[1].trim().replace(/\\n/g, '\n').replace(/\\,/g, ',') : ''; };
    events.push(ev(ctx, file, {
      category: 'other', timestamp: icsTime(get('DTSTART') || get('DUE') || get('CREATED')), sender: kind === 'reminder' ? 'iCloud Reminders' : 'iCloud Calendar',
      content: `${kind === 'reminder' ? 'Reminder' : 'Calendar'}: ${get('SUMMARY') || '(no title)'}${get('LOCATION') ? ' @ ' + get('LOCATION') : ''}`,
      location: get('LOCATION') || undefined,
      details: { kind, calendar, summary: get('SUMMARY'), start: icsTime(get('DTSTART')), end: icsTime(get('DTEND')), location: get('LOCATION'), description: get('DESCRIPTION').slice(0, 2000), organizer: get('ORGANIZER'), attendees: (blk.match(/^ATTENDEE[^:]*:(.*)$/gim) || []).map(a => a.replace(/^[^:]*:/, '')).join('; '), geo: get('GEO') },
    }));
  }
  return finish(events, baseAccount(ctx));
}

// ---- email (.eml) — headers + text/plain only; attachments are listed, not written ----
function decodeWords(s: string) {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_m, _cs, enc, data) => {
    try {
      if (enc.toLowerCase() === 'b') return new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
      return data.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_x: string, hx: string) => String.fromCharCode(parseInt(hx, 16)));
    } catch { return data; }
  });
}

// ---- MIME (uwrp-b7) ----
function headerVal(head: string, k: string) { const m = head.match(new RegExp('^' + k + ':\\s*(.*)$', 'im')); return m ? m[1].trim() : ''; }
function decodeTransfer(raw: string, enc: string, charset: string): string {
  let bytes: Uint8Array;
  if (/base64/i.test(enc)) { try { const bin = atob(raw.replace(/[^A-Za-z0-9+/=]/g, '')); bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); } catch { return raw; } }
  else if (/quoted-printable/i.test(enc)) {
    const t = raw.replace(/=\r?\n/g, ''); const out: number[] = [];
    for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else { const cc = t.charCodeAt(i); if (cc < 128) out.push(cc); else { const enc = new TextEncoder().encode(c); for (let k = 0; k < enc.length; k++) out.push(enc[k]); } } }
    bytes = Uint8Array.from(out);
  } else return raw; // 7bit/8bit: the file text was already decoded when it was read
  try { return new TextDecoder((charset || 'utf-8').toLowerCase().replace(/^(us-)?ascii$/, 'utf-8'), { fatal: false }).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}
export function mimeBodies(head: string, body: string, depth = 0): { plain: string; html: string } {
  const ct = headerVal(head, 'Content-Type') || 'text/plain';
  const enc = headerVal(head, 'Content-Transfer-Encoding');
  const charset = (ct.match(/charset="?([^";\s]+)"?/i) || [])[1] || 'utf-8';
  const disp = headerVal(head, 'Content-Disposition');
  if (/^multipart\//i.test(ct) && depth < 8) {
    const boundary = (ct.match(/boundary="?([^";]+)"?/i) || [])[1];
    if (!boundary) return { plain: body, html: '' };
    const parts = body.split(new RegExp('\\r?\\n?--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*(?:\\r?\\n|$)')).slice(1);
    let plain = '', html = '';
    for (const p of parts) {
      const sp = p.search(/\r?\n\r?\n/); if (sp < 0) continue;
      const ph = unfold(p.slice(0, sp)); const pb = p.slice(sp).replace(/^\r?\n\r?\n/, '');
      const r = mimeBodies(ph, pb, depth + 1);
      if (!plain && r.plain) plain = r.plain; if (!html && r.html) html = r.html;
    }
    return { plain, html };
  }
  if (/attachment/i.test(disp)) return { plain: '', html: '' };
  if (/^text\/html/i.test(ct)) return { plain: '', html: decodeTransfer(body, enc, charset) };
  if (/^text\/(plain|enriched)?/i.test(ct) || !ct) return { plain: decodeTransfer(body, enc, charset), html: '' };
  return { plain: '', html: '' };
}
export function htmlToText(html: string): string {
  return html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function parseEml(ctx: ReturnType<typeof appleContext>, file: string, text: string): ParseResult {
  const split = text.search(/\r?\n\r?\n/);
  const head = unfold(split >= 0 ? text.slice(0, split) : text);
  const body = split >= 0 ? text.slice(split).trim() : '';
  const hv = (k: string) => { const m = head.match(new RegExp('^' + k + ':\\s*(.*)$', 'im')); return m ? decodeWords(m[1].trim()) : ''; };
  const received = (head.match(/^Received:.*$/gim) || []);
  const ip = (received.map(r => (r.match(/\[(\d{1,3}(?:\.\d{1,3}){3})\]/) || [])[1]).find(Boolean)) || hv('X-Originating-IP').replace(/[[\]]/g, '') || undefined;
  // uwrp-b7: real MIME walk (nested multipart, base64 / quoted-printable, charsets) so HTML mail keeps its HTML.
  const mime = mimeBodies(head, body);
  let plain = mime.plain;
  const html = mime.html;
  if (!plain && html) plain = htmlToText(html);
  const atts = [...text.matchAll(/filename\*?="?([^"\r\n;]+)"?/gi)].map(m => m[1]);
  const headersOnly = ctx.type === 'MAILHEADER' || !body;
  return finish([ev(ctx, file, {
    category: 'message', timestamp: hv('Date') ? appleTime(hv('Date')) : 'Unknown',
    sender: hv('From') || 'Unknown', recipient: hv('To') || undefined, ipAddress: ip && IP_RE.test(ip) ? ip : undefined,
    content: `${hv('Subject') || '(no subject)'}${plain ? '\n' + plain.slice(0, 3000) : ''}`,
    details: { kind: 'email', channel: 'email', isEmail: true, body: plain.slice(0, 20000), ...(html ? { htmlBody: html.slice(0, 1_500_000) } : {}), subject: hv('Subject'), from: hv('From'), to: hv('To'), cc: hv('Cc'), messageId: hv('Message-ID'), headersOnly, attachmentNames: atts.join('; '), conversationId: 'Email: ' + (hv('Subject').replace(/^(re|fwd?|fw):\s*/gi, '') || '(no subject)') },
  })], baseAccount(ctx));
}

// ---- free text (Notes, Reminder.txt, Metadata/Summary) ----
function parseText(ctx: ReturnType<typeof appleContext>, file: string, text: string, noData: boolean): ParseResult {
  const lower = file.toLowerCase();
  const kind = noData ? 'no-data' : /^(summary|downloadsummary|metadata)\.txt$/.test(lower) ? 'production-note' : ctx.type === 'NOTES' ? 'note' : ctx.type === 'ICLOUDREMINDERS' ? 'reminder' : 'text';
  const kv: Record<string, string> = {};
  for (const l of text.split(/\r?\n/).slice(0, 80)) { const m = l.match(/^\s*([A-Za-z][\w .\/-]{1,40}):\s*(.+)$/); if (m) kv[m[1].trim()] = m[2].trim(); }
  const tsKey = Object.keys(kv).find(k => /date|created|modified|due/i.test(k));
  const title = kv['Title'] || kv['Name'] || text.split(/\r?\n/).find(l => l.trim())?.slice(0, 120) || file;
  const content = kind === 'no-data' ? `No data produced — ${ctx.type}: ${text.trim().slice(0, 300)}`
    : kind === 'production-note' ? `Apple production note (${ctx.type}, ${file}): ${text.trim().slice(0, 400)}`
    : `${kind === 'note' ? 'Note' : kind === 'reminder' ? 'Reminder' : 'Text'}: ${title}\n${text.slice(0, 4000)}`;
  const body = kind === 'note' || kind === 'reminder' || kind === 'text' ? text.slice(0, 200000) : undefined;
  return finish([ev(ctx, file, { category: 'other', timestamp: tsKey ? appleTime(kv[tsKey]) : 'Unknown', sender: `iCloud ${ctx.type || 'file'}`, content, details: { kind, ...(noData ? { noData: true } : {}), ...kv, title, folder: ctx.folder, ...(body !== undefined ? { body } : {}) } })], baseAccount(ctx));
}

/** Account record for files the parser does not read (media, backups, binaries) so 1..N accounts all appear. */
export function appleStubParse(relativePath?: string): ParseResult {
  return { provider: 'apple', events: [], accountInfo: baseAccount(appleContext(relativePath)), summaryStats: empty() };
}

/** Entry point used by parseForensicFile when provider === 'apple'. */
export function parseAppleFile(fileName: string, content: string, relativePath?: string, opts: { noData?: boolean } = {}): ParseResult {
  const ctx = appleContext(relativePath);
  const lower = fileName.toLowerCase();
  try {
    if (opts.noData) return parseText(ctx, fileName, content, true);
    if (/messagesinicloud.*\.csv$/.test(lower) || (ctx.type === 'MESSAGESINICLOUD' && lower.endsWith('.csv'))) return parseMessages(ctx, fileName, content);
    if (lower.endsWith('.vcf')) return parseVcf(ctx, fileName, content);
    if (lower.endsWith('.ics')) return parseIcs(ctx, fileName, content, relativePath || '');
    if (lower.endsWith('.eml')) return parseEml(ctx, fileName, content);
    if (lower.endsWith('.csv')) return parseTable(ctx, fileName, content);
    if (lower.endsWith('.txt') || lower.endsWith('.json') || lower === '') return parseText(ctx, fileName, content, false);
  } catch (err) {
    console.error('Apple parser failed for', fileName, err);
  }
  return { provider: 'apple', events: [], accountInfo: baseAccount(ctx), summaryStats: empty() };
}
