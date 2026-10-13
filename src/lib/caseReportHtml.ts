/**
 * One offline case report. Print/Save PDF and the evidence zip both call
 * buildCaseReportHtml so the document is the same shape.
 * Images are not loaded from a network. Blur is chosen at export time.
 */
import type { ForensicEvent } from '../types';
import { redactIp, redactPiiText } from './portableCaseGenerator';

export const CASE_REPORT_VERSION = '5.1.2';

export interface CaseReportAccount {
  username?: string;
  userId?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  createdDate?: string;
  registrationIp?: string;
  provider?: string;
  sourceFile?: string;
}

export interface CaseReportMedia {
  name: string;
  /** Relative link inside the zip, such as files/photo.png. */
  href: string;
  /** Thumbnail address. A data URL when the print copy embeds the image. */
  src: string;
  kind: 'image' | 'video';
  md5: string;
  sha256: string;
  matchLabel: string;
  size: number;
}

export interface CaseReportCard {
  id: string;
  tagged: boolean;
  timestamp: string;
  category: string;
  sender: string;
  recipient: string;
  content: string;
  ipAddress: string;
  location: string;
  sourceFile: string;
  notes: string;
  details: string;
  account: string;
  provider: string;
  conversation: string;
  media?: CaseReportMedia | null;
}

export interface CaseReportLocation {
  lat: number;
  lng: number;
  label: string;
  cardId: string;
  capturedAt: string;
  eventId?: string;
  tagKey?: string;
  tagged?: boolean;
}

export interface CaseReportEntity {
  value: string;
  type: string;
  providers: string[];
  detail: string;
}

export interface CaseReportSource {
  name: string;
  hash: string;
  messages: number;
  connections: number;
  files: number;
  calls: number;
  profiles: number;
  other: number;
}

export interface CaseReportInput {
  caseId: string;
  agency: string;
  itemNumber: string;
  examiner: string;
  subject: string;
  providerName: string;
  notes: string;
  logoDataUrl: string;
  generatedAtIso: string;
  appVersion: string;
  accounts: CaseReportAccount[];
  cards: CaseReportCard[];
  locations: CaseReportLocation[];
  entities: CaseReportEntity[];
  sources: CaseReportSource[];
  totals: {
    events: number;
    tagged: number;
    messages: number;
    connections: number;
    files: number;
    calls: number;
    profiles: number;
    other: number;
    media: number;
    locations: number;
  };
}

export interface CaseReportOptions {
  exhibitsOnly: boolean;
  blurImages: boolean;
  timeZone: string;
  redactIpAddresses: boolean;
  redactPii: boolean;
  includeAccount: boolean;
  includeMessages?: boolean;
  includeTimeline: boolean;
  includeMedia?: boolean;
  includeEntities: boolean;
  includeLocations: boolean;
  includeSources?: boolean;
  /** When false, the header omits case number, examiner, and subject. */
  includeCaseIdentifiers?: boolean;
}

function sectionOn(value: boolean | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value;
}

/** One color per evidence type. Donut, legend, section bars, and cards all use this list. */
export const EVIDENCE_TYPES: Array<{ id: string; label: string; href: string; color: string }> = [
  { id: 'account', label: 'Account info', href: '#sec-account', color: '#2f6fd8' },
  { id: 'message', label: 'Messages', href: '#sec-messages', color: '#1f8a4c' },
  { id: 'connection', label: 'Logins / IPs', href: '#type-connection', color: '#c0392b' },
  { id: 'media', label: 'Media', href: '#sec-media', color: '#8e44ad' },
  { id: 'location', label: 'Locations', href: '#sec-locations', color: '#d68910' },
  { id: 'call', label: 'Calls', href: '#type-call', color: '#d35400' },
  { id: 'file', label: 'Files', href: '#type-file', color: '#148f77' },
  { id: 'profile', label: 'Profiles', href: '#type-profile', color: '#1a5276' },
  { id: 'other', label: 'Other records', href: '#type-other', color: '#5b6472' },
  { id: 'entity', label: 'Entity overlaps', href: '#sec-entities', color: '#6c3483' },
  { id: 'source', label: 'Sources', href: '#sec-sources', color: '#34495e' },
];

const TYPE_BY_ID = new Map(EVIDENCE_TYPES.map(type => [type.id, type]));

function evidenceType(id: string) {
  return TYPE_BY_ID.get(id) || TYPE_BY_ID.get('other')!;
}

/** Captured time, then modified time, otherwise the word unknown. Never "now". */
export function mediaExhibitTimestamp(file: { capturedAt?: string | null; modifiedAt?: string | null }): string {
  const captured = (file.capturedAt || '').trim();
  if (captured && !Number.isNaN(Date.parse(captured))) return captured;
  const modified = (file.modifiedAt || '').trim();
  if (modified && !Number.isNaN(Date.parse(modified))) return modified;
  return 'unknown';
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slug(value: string): string {
  const out = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return out || 'item';
}

function colorFor(category: string): string {
  return evidenceType(category).color;
}

function labelFor(category: string): string {
  return evidenceType(category).label;
}

function safeLogo(url: string): string {
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url || '')) return url;
  return '';
}

function safeImageSrc(url: string): string {
  if (!url) return '';
  if (/^files\/[a-zA-Z0-9._~/%-]+$/.test(url)) return url;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
  if (/^data:video\/(mp4|webm|quicktime);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
  return '';
}

function zoneName(timeZone: string): string {
  const zone = timeZone || 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone === 'UTC' ? 'UTC' : zone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    const offset = parts.find(part => part.type === 'timeZoneName')?.value || zone;
    return zone === 'UTC' ? `UTC (${offset})` : `${zone} (${offset})`;
  } catch {
    return 'UTC (UTC+00:00)';
  }
}

function formatWhen(value: string, timeZone: string): string {
  if (!value || value === 'unknown') return 'unknown';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 'unknown';
  const zone = timeZone && timeZone !== 'UTC' ? timeZone : 'UTC';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).format(new Date(parsed));
  } catch {
    return 'unknown';
  }
}

function redactText(value: string, options: CaseReportOptions): string {
  let next = value || '';
  if (options.redactIpAddresses) {
    next = next.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, match => redactIp(match) || match);
  }
  if (options.redactPii) next = redactPiiText(next) || next;
  return next;
}

function redactIpValue(value: string, options: CaseReportOptions): string {
  if (!value || !options.redactIpAddresses) return value || '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':')) return redactIp(value) || value;
  return redactText(value, options);
}

function applyCardRedaction(card: CaseReportCard, options: CaseReportOptions): CaseReportCard {
  return {
    ...card,
    sender: redactText(card.sender, options),
    recipient: redactText(card.recipient, options),
    content: redactText(card.content, options),
    notes: redactText(card.notes, options),
    location: redactText(card.location, options),
    ipAddress: redactIpValue(card.ipAddress, options),
    details: redactText(card.details, options),
    account: redactText(card.account, options),
  };
}

function donut(slices: Array<{ label: string; count: number; color: string; href: string }>, total: number): string {
  const radius = 15.91549430918954;
  let offset = 0;
  const rings = slices.filter(slice => slice.count > 0).map(slice => {
    const pct = total > 0 ? (slice.count / total) * 100 : 0;
    const dash = `${pct.toFixed(4)} ${(100 - pct).toFixed(4)}`;
    const circle = `<a href="${esc(slice.href)}"><circle class="ring" cx="21" cy="21" r="${radius}" fill="none" stroke="${slice.color}" stroke-width="8" stroke-dasharray="${dash}" stroke-dashoffset="-${offset.toFixed(4)}"><title>${esc(slice.label)}: ${slice.count}</title></circle></a>`;
    offset += pct;
    return circle;
  });
  return `<svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Evidence by type"><g transform="rotate(-90 21 21)"><circle cx="21" cy="21" r="${radius}" fill="none" stroke="var(--line)" stroke-width="8"></circle>${rings.join('')}</g><text x="21" y="19.5" text-anchor="middle" class="donut-n">${total}</text><text x="21" y="25.5" text-anchor="middle" class="donut-lbl">items</text></svg>`;
}

function summaryTable(counts: Record<string, number>, cards: CaseReportCard[], input: CaseReportInput, included: Set<string>): string {
  const types = EVIDENCE_TYPES.filter(type => included.has(type.id));
  const slices = types.map(type => ({ ...type, count: counts[type.id] || 0 })).filter(type => type.count > 0);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const byProvider = new Map<string, number>();
  for (const card of cards) {
    const provider = card.provider || input.providerName || 'Unknown provider';
    byProvider.set(provider, (byProvider.get(provider) || 0) + 1);
  }
  const rows: string[] = [];
  rows.push(`<tr class="first"><td class="lbl">Items in this summary</td><td class="n">${total}</td><td class="pct"></td></tr>`);
  rows.push(`<tr class="grp"><td colspan="3">By evidence type</td></tr>`);
  for (const type of types) {
    const count = counts[type.id] || 0;
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    rows.push(`<tr class="cat"><td class="lbl"><span class="sw" style="background:${type.color}"></span><a href="${type.href}">${esc(type.label)}</a></td><td class="n">${count}</td><td class="pct">${pct}%</td></tr>`);
  }
  rows.push(`<tr class="grp"><td colspan="3">By account / provider</td></tr>`);
  for (const [provider, count] of byProvider) {
    rows.push(`<tr class="cat"><td class="lbl"><span class="sw" style="background:${evidenceType('account').color}"></span><a href="#sec-account">${esc(provider)}</a></td><td class="n">${count}</td><td class="pct">${cards.length ? ((count / cards.length) * 100).toFixed(1) : '0.0'}%</td></tr>`);
  }
  if (included.has('source')) {
    rows.push(`<tr class="tot"><td class="lbl"><a href="#sec-sources">Tagged vs events in the case</a></td><td class="n">${input.totals.tagged} / ${input.totals.events}</td><td class="pct"></td></tr>`);
  }
  return `<div class="sumrow"><div class="chartcol">${donut(slices, total)}</div><div class="datacol"><table>${rows.join('')}</table></div></div>`;
}

function field(label: string, value: string, mono = false): string {
  if (!value) return '';
  return `<div class="f${mono ? ' mono' : ''}"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
}

function mediaBlock(media: CaseReportMedia | null | undefined): string {
  if (!media) return '';
  const src = safeImageSrc(media.src) || safeImageSrc(media.href);
  const href = safeImageSrc(media.href) || '#';
  const thumb = media.kind === 'image' && src
    ? `<a class="full" href="${esc(href)}" data-full="${esc(src)}"><img class="openable" src="${esc(src)}" alt="${esc(media.name)}" data-full="${esc(src)}" data-name="${esc(media.name)}"></a>`
    : `<a class="full" href="${esc(href)}"><span class="playicon" aria-hidden="true">&#9654;</span><span class="videoname">${esc(media.name)}</span></a>`;
  return `<div class="thumbwrap">${thumb}</div><div class="fields">${field('File', media.name, true)}${field('SHA-256', media.sha256 || 'not computed', true)}${field('MD5', media.md5 || 'not computed', true)}${media.matchLabel ? `<div class="match">${esc(media.matchLabel)}</div>` : ''}</div>`;
}

function cardHtml(card: CaseReportCard, exhibitNumber: number, timeZone: string, idSuffix = ''): string {
  const when = formatWhen(card.timestamp, timeZone);
  const who = card.recipient ? `${card.sender || 'Unknown'} → ${card.recipient}` : (card.sender || 'Unknown');
  const search = [card.sender, card.recipient, card.content, card.notes, card.sourceFile, card.ipAddress, card.media?.name, card.media?.md5, card.media?.sha256, card.category]
    .join(' ')
    .toLowerCase();
  const exhibitAttr = card.tagged && exhibitNumber > 0 ? String(exhibitNumber) : '1000000';
  const exhibitLabel = card.tagged && exhibitNumber > 0 ? `EXHIBIT-${exhibitNumber}` : '—';
  const notes = card.notes
    ? `<div class="notes"><div class="notes-title">Examiner notes</div>${esc(card.notes)}</div>`
    : '';
  const details = card.details
    ? `<details class="meta"><summary>Raw details</summary><pre>${esc(card.details)}</pre></details>`
    : `<details class="meta"><summary>Raw details</summary><p class="muted">No extra fields were stored for this record.</p></details>`;
  const typeId = idSuffix === '-media' ? 'media' : (card.category || 'other');
  return `<article class="card" id="${esc(card.id)}${esc(idSuffix)}" data-time="${esc(card.timestamp === 'unknown' ? '' : card.timestamp)}" data-exhibit="${exhibitAttr}" data-search="${esc(search)}"><div class="catbar" style="background:${colorFor(typeId)}">${esc(exhibitLabel)} · ${esc(labelFor(typeId))}</div><div class="cardbody"><div class="when">${esc(when)}</div><div class="who">${esc(who)}</div><div class="content">${esc(card.content || '')}</div>${field('IP', card.ipAddress, true)}${field('Location', card.location)}${field('Source file', card.sourceFile, true)}${notes}${mediaBlock(card.media)}${details}</div></article>`;
}

function section(id: string, title: string, count: number, body: string, typeId: string): string {
  const color = typeId === 'timeline' ? 'var(--ink)' : colorFor(typeId);
  return `<h2 class="catsec" id="${id}" style="border-left:6px solid ${color}">${esc(title)} <span class="n">(${count})</span><a class="toplink" href="#top">&#8593; top</a></h2>${body}`;
}

function locationPlot(points: CaseReportLocation[]): string {
  if (points.length === 0) return '<p class="muted">No coordinates were included.</p>';
  let minLat = Math.min(...points.map(point => point.lat));
  let maxLat = Math.max(...points.map(point => point.lat));
  let minLng = Math.min(...points.map(point => point.lng));
  let maxLng = Math.max(...points.map(point => point.lng));
  if (minLat === maxLat) {
    minLat -= 0.02;
    maxLat += 0.02;
  }
  if (minLng === maxLng) {
    minLng -= 0.02;
    maxLng += 0.02;
  }
  const width = 800;
  const height = 420;
  const pad = 28;
  const xOf = (lng: number) => pad + ((lng - minLng) / (maxLng - minLng)) * (width - pad * 2);
  const yOf = (lat: number) => pad + ((maxLat - lat) / (maxLat - minLat)) * (height - pad * 2);
  const dots = points.map(point => {
    const href = point.cardId ? `#${point.cardId}` : '#sec-locations';
    return `<a href="${esc(href)}"><circle class="plot" cx="${xOf(point.lng).toFixed(1)}" cy="${yOf(point.lat).toFixed(1)}" r="6"><title>${esc(point.label)}</title></circle></a>`;
  }).join('');
  const list = points.map(point => {
    const osm = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(point.lat))}&mlon=${encodeURIComponent(String(point.lng))}#map=14/${point.lat}/${point.lng}`;
    const jump = point.cardId ? `<a href="#${esc(point.cardId)}">${esc(point.label)}</a>` : esc(point.label);
    return `<li>${jump} <a href="${esc(osm)}">${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}</a></li>`;
  }).join('');
  return `<svg class="plotmap" viewBox="0 0 ${width} ${height}" role="img" aria-label="Location plot without map tiles"><rect width="${width}" height="${height}" class="plotbg"></rect>${dots}</svg><ul class="loclist">${list}</ul><p class="muted">This plot is drawn from the coordinates alone. It does not download map tiles.</p>`;
}

function accountTable(accounts: CaseReportAccount[], options: CaseReportOptions, timeZone: string): string {
  if (accounts.length === 0) return '<p class="muted">No account records were parsed.</p>';
  const rows = accounts.map(account => {
    const email = options.redactPii ? (redactPiiText(account.email) || '') : (account.email || '');
    const phone = options.redactPii ? (redactPiiText(account.phone) || '') : (account.phone || '');
    const ip = redactIpValue(account.registrationIp || '', options);
    return `<tr><td>${esc(account.provider || '')}</td><td>${esc(account.username || account.userId || account.displayName || '')}</td><td>${esc(email)}</td><td>${esc(phone)}</td><td>${esc(formatWhen(account.createdDate || '', timeZone))}</td><td class="mono">${esc(ip)}</td><td class="mono">${esc(account.sourceFile || '')}</td></tr>`;
  }).join('');
  return `<table class="gridtable"><thead><tr><th>Provider</th><th>Account</th><th>Email</th><th>Phone</th><th>Created</th><th>Registration IP</th><th>Source file</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sourceTable(sources: CaseReportSource[], totals: CaseReportInput['totals'], version: string): string {
  const rows = sources.map(source => `<tr><td class="mono">${esc(source.name)}</td><td class="mono">${esc(source.hash || 'not computed')}</td><td>${source.messages}</td><td>${source.connections}</td><td>${source.files}</td><td>${source.calls}</td><td>${source.profiles}</td><td>${source.other}</td></tr>`).join('');
  return `<table class="gridtable"><thead><tr><th>Source file</th><th>Hash</th><th>Messages</th><th>Connections</th><th>Files</th><th>Calls</th><th>Profiles</th><th>Other</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No source files were recorded.</td></tr>'}</tbody></table>
<p>Record counts for the whole case, including zeros: messages ${totals.messages}, connections ${totals.connections}, files ${totals.files}, calls ${totals.calls}, profiles ${totals.profiles}, other ${totals.other}, media ${totals.media}, locations ${totals.locations}.</p>
<p>The original evidence was not modified by this report.</p>
<p>Generated by Universal Warrant Return Parser ${esc(version || CASE_REPORT_VERSION)}.</p>
<p>Machine paths are not published in this report.</p>`;
}

const REPORT_CSS = `
:root{--line:#d5d9e0;--ink:#1a1d24;--mut:#5b6472}
*{box-sizing:border-box}
body{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;color:var(--ink);background:#fff}
.wrap{max-width:1200px;margin:0 auto;padding:24px}
.muted{color:var(--mut)}
header.rpt{display:flex;gap:20px;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:16px}
header.rpt img.logo{max-height:110px;max-width:320px;object-fit:contain}
header.rpt h1{margin:0 0 6px;font-size:20px}
header.rpt table{border-collapse:collapse}
header.rpt td{padding:2px 14px 2px 0;vertical-align:top}
header.rpt td:first-child{color:var(--mut);white-space:nowrap}
header.rpt .hnotes{margin-top:8px;white-space:pre-wrap;max-width:70ch}
details.summary,details.overview{margin:18px 0;border:1px solid var(--line);border-left:4px solid #2f6fd8;border-radius:0 8px 8px 0;overflow:hidden}
details.summary > summary,details.overview > summary{cursor:pointer;list-style:none;font-weight:700;padding:11px 14px;background:#fafbfd}
details.summary > summary::-webkit-details-marker,details.overview > summary::-webkit-details-marker,details.meta > summary::-webkit-details-marker,details.convo > summary::-webkit-details-marker{display:none}
.summary .sumrow{display:flex;gap:32px;align-items:center;flex-wrap:wrap;padding:14px}
.donut{width:148px;height:148px;display:block}
.donut .donut-n{font-size:7.5px;font-weight:700;fill:var(--ink)}
.donut .donut-lbl{font-size:3.4px;fill:var(--mut)}
.donut a{cursor:pointer}
.donut .ring{-webkit-print-color-adjust:exact;print-color-adjust:exact}
h3.typesec{font-size:14px;margin:16px 0 8px;padding:4px 0 4px 10px;display:flex;gap:8px;align-items:baseline}
h3.typesec .n{color:var(--mut);font-weight:400;font-size:12px}
.summary table{border-collapse:collapse;font-size:12.5px}
.summary td{padding:3px 0}
.summary td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;padding-right:22px}
.summary td.pct{text-align:right;color:var(--mut)}
.summary tr.grp td{border-top:1px solid var(--line);padding-top:8px;color:var(--mut);font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700}
.summary tr.tot td{border-top:2px solid var(--ink);font-weight:700}
.summary .sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:8px}
.summary a{color:inherit}
nav.toc{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0;align-items:center}
nav.toc a{border:1px solid #2f6fd8;border-radius:6px;padding:3px 12px;text-decoration:none;color:#2f6fd8;font-size:12px;font-weight:600;background:#f0f5ff}
nav.toc a .n{font-weight:400}
.rptbar{margin:12px 0;font-size:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rptbar button,.rptbar select,.rptbar input{border:1px solid var(--line);background:#f7f8fa;border-radius:6px;padding:3px 10px;font:inherit;color:var(--ink)}
.rptbar .tgl{display:inline-flex;align-items:center;gap:8px;font-weight:600}
.rptbar .sw{width:32px;height:17px;border-radius:9px;background:#c3c8d0;position:relative;display:inline-block}
.rptbar .tgl.on{border-color:#2f6fd8;color:#2f6fd8}
.rptbar .tgl.on .sw{background:#2f6fd8}
h2.catsec{font-size:16px;margin:28px 0 10px;padding:5px 0 5px 12px;display:flex;align-items:baseline;gap:8px;break-before:page;page-break-before:always}
h2.catsec .n{color:var(--mut);font-weight:400;font-size:13px}
h2.catsec .toplink{margin-left:auto;font-size:11px;font-weight:600;text-decoration:none;color:#2f6fd8}
.card{border:1px solid var(--line);border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid;margin:0 0 12px;background:#fff}
.card .catbar{padding:3px 9px;color:#fff;font-weight:600;font-size:11px}
.card .cardbody{padding:10px}
.card .when{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--mut)}
.card .who{font-weight:700;margin:2px 0 6px}
.card .content{white-space:pre-wrap;word-break:break-word}
.card .f{display:flex;gap:6px;padding:1px 0}
.card .f .k{color:var(--mut);flex:0 0 92px}
.card .f .v{flex:1;word-break:break-word}
.card .mono .v,.mono{font-family:ui-monospace,Consolas,monospace;font-size:11px}
.notes{background:#fffbeb;border:1px solid #fde68a;color:#78350f;padding:8px;border-radius:6px;margin-top:8px;white-space:pre-wrap}
.notes-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.match{display:inline-block;margin-top:6px;padding:2px 8px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700}
.thumbwrap img{width:100%;max-height:180px;object-fit:contain;background:#0c0d10;display:block}
.playicon{display:inline-block;width:36px;height:36px;border-radius:50%;background:#111;color:#fff;text-align:center;line-height:36px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.gridtable{border-collapse:collapse;width:100%;font-size:12px}
.gridtable th,.gridtable td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
.plotmap{width:100%;max-width:900px;height:auto;border:1px solid var(--line);border-radius:8px;background:#f4f1ea}
.plotbg{fill:#f4f1ea}
.plot{fill:#2f6fd8;stroke:#fff;stroke-width:1.5}
.loclist{font-size:12px}
.hide{display:none !important}
#showMore{margin:16px 0;border:1px solid #2f6fd8;background:#f0f5ff;color:#2f6fd8;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer}
#lb{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;padding:16px}
#lb.on{display:flex}
#lb img{max-width:100%;max-height:100%;object-fit:contain}
html.blur .thumbwrap img{filter:blur(22px)}
html.blur .thumbwrap img:hover,html.blur .thumbwrap img.revealed{filter:none}
html.dark{--line:#333a46;--ink:#e6e8ec;--mut:#8b93a3}
html.dark body{background:#14161a}
html.dark .card,html.dark header.rpt,html.dark .gridtable{color:var(--ink)}
html.dark .card{background:#1c1f26}
html.dark details.summary > summary,html.dark details.overview > summary,html.dark .rptbar button,html.dark .rptbar select,html.dark .rptbar input{background:#1c1f26;color:var(--ink)}
footer.gen{margin-top:28px;padding-top:10px;border-top:1px solid var(--line);color:var(--mut);font-size:12px}
@media print{
  .rptbar,#showMore,#lb{display:none !important}
  .card.hide,details.hide{display:block !important}
  html.blur .thumbwrap img{filter:none !important}
  .card,.catbar,.notes,.match,.donut .ring,.summary .sw,h2.catsec,h3.typesec{ -webkit-print-color-adjust:exact; print-color-adjust:exact }
  html.dark{--line:#d5d9e0;--ink:#1a1d24;--mut:#5b6472}
  html.dark body,html.dark .card{background:#fff;color:#1a1d24}
}
`;

const REPORT_JS = `
(function(){
  var root = document.documentElement;
  var STEP = 250;
  var limit = STEP;
  function get(key){ try { return localStorage.getItem('uwrp.report.' + key); } catch (e) { return null; } }
  function set(key, value){ try { localStorage.setItem('uwrp.report.' + key, value); } catch (e) {} }
  function wire(id, cls, key, def, persist){
    var btn = document.getElementById(id);
    if (!btn) return;
    var stored = persist ? get(key) : null;
    var on = stored === null ? def : stored === '1';
    root.classList.toggle(cls, on);
    btn.classList.toggle('on', on);
    btn.addEventListener('click', function(){
      var value = root.classList.toggle(cls);
      btn.classList.toggle('on', value);
      if (persist) set(key, value ? '1' : '0');
    });
  }
  wire('btnBlur', 'blur', 'blur', root.classList.contains('blur'), false);
  wire('btnDark', 'dark', 'dark', false, true);
  function timeValue(card){
    var raw = card.getAttribute('data-time') || '';
    var parsed = Date.parse(raw);
    return raw && !isNaN(parsed) ? parsed : Infinity;
  }
  function apply(){
    var query = ((document.getElementById('reportSearch') || {}).value || '').trim().toLowerCase();
    var mode = ((document.getElementById('reportSort') || {}).value || 'time');
    document.querySelectorAll('.card-list').forEach(function(list){
      var cards = Array.prototype.filter.call(list.children, function(el){ return el.classList && el.classList.contains('card'); });
      cards.sort(function(a, b){
        if (mode === 'exhibit') return Number(a.getAttribute('data-exhibit')) - Number(b.getAttribute('data-exhibit'));
        return timeValue(a) - timeValue(b);
      });
      cards.forEach(function(card){ list.appendChild(card); });
    });
    var matches = [];
    document.querySelectorAll('.card').forEach(function(card){
      var text = card.getAttribute('data-search') || '';
      if (!query || text.indexOf(query) !== -1) matches.push(card);
      else card.classList.add('hide');
    });
    matches.forEach(function(card, index){ card.classList.toggle('hide', index >= limit); });
    document.querySelectorAll('details.convo').forEach(function(group){
      group.classList.toggle('hide', !group.querySelector('.card:not(.hide)'));
    });
    var more = document.getElementById('showMore');
    if (more) {
      var hidden = matches.length - Math.min(limit, matches.length);
      more.hidden = hidden <= 0;
      more.textContent = hidden > 0 ? 'Show more (' + hidden + ' remaining)' : 'Show more';
    }
  }
  var search = document.getElementById('reportSearch');
  var sort = document.getElementById('reportSort');
  if (search) search.addEventListener('input', function(){ limit = STEP; apply(); });
  if (sort) sort.addEventListener('change', apply);
  var moreBtn = document.getElementById('showMore');
  if (moreBtn) moreBtn.addEventListener('click', function(){ limit += STEP; apply(); });
  document.getElementById('btnExpand').addEventListener('click', function(){
    document.querySelectorAll('details').forEach(function(item){ item.open = true; });
  });
  document.getElementById('btnCollapse').addEventListener('click', function(){
    document.querySelectorAll('details').forEach(function(item){ item.open = false; });
  });
  var lb = document.createElement('div');
  lb.id = 'lb';
  document.body.appendChild(lb);
  function closeViewer(){ lb.classList.remove('on'); lb.innerHTML = ''; }
  function openViewer(src, name){
    closeViewer();
    var img = document.createElement('img');
    img.alt = name || '';
    img.src = src;
    lb.appendChild(img);
    lb.classList.add('on');
  }
  document.querySelectorAll('a.full').forEach(function(link){
    link.addEventListener('click', function(event){
      var img = link.querySelector('img.openable');
      if (!img) return;
      event.preventDefault();
      openViewer(img.getAttribute('data-full') || img.src, img.getAttribute('data-name') || '');
    });
  });
  lb.addEventListener('click', closeViewer);
  document.addEventListener('keydown', function(event){
    if (event.key === 'Escape') closeViewer();
  });
  var snap = [];
  window.addEventListener('beforeprint', function(){
    snap = [];
    document.querySelectorAll('details').forEach(function(item){ snap.push(item.open); item.open = true; });
  });
  window.addEventListener('afterprint', function(){
    document.querySelectorAll('details').forEach(function(item, index){ item.open = snap[index]; });
  });
  apply();
})();
`;

export function buildCaseReportHtml(input: CaseReportInput, options: CaseReportOptions): string {
  const zone = options.timeZone || 'UTC';
  const cards = (options.exhibitsOnly ? input.cards.filter(card => card.tagged) : input.cards)
    .map(card => applyCardRedaction(card, options));
  let exhibit = 0;
  const numbered = cards.map(card => {
    if (card.tagged) exhibit += 1;
    return { card, exhibit: card.tagged ? exhibit : 0 };
  });
  const messages = numbered.filter(item => item.card.category === 'message');
  const timeline = numbered.filter(item => item.card.category !== 'message' && item.card.category !== 'media');
  const media = numbered.filter(item => item.card.media || item.card.category === 'media');
  const groups = new Map<string, typeof messages>();
  for (const item of messages) {
    const key = item.card.conversation || 'Conversation';
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  const messageHtml = messages.length === 0
    ? '<p class="muted">No messages in this report.</p>'
    : [...groups.entries()].map(([name, items]) => {
      const body = `<div class="card-list">${items.map(item => cardHtml(item.card, item.exhibit, zone)).join('')}</div>`;
      return `<details class="convo" open><summary>${esc(name)} <span class="n">(${items.length})</span></summary>${body}</details>`;
    }).join('');
  const timelineTypes = ['connection', 'call', 'file', 'profile', 'other'];
  const timelineHtml = timelineTypes.map(typeId => {
    const items = timeline.filter(item => evidenceType(item.card.category || 'other').id === typeId);
    const type = evidenceType(typeId);
    const body = items.length === 0
      ? '<p class="muted">None in this report.</p>'
      : `<div class="card-list">${items.map(item => cardHtml(item.card, item.exhibit, zone)).join('')}</div>`;
    return `<h3 class="typesec" id="type-${typeId}" style="border-left:6px solid ${type.color}">${esc(type.label)} <span class="n">(${items.length})</span></h3>${body}`;
  }).join('');
  const mediaHtml = media.length === 0
    ? '<p class="muted">No media in this report.</p>'
    : `<div class="grid card-list">${media.map(item => cardHtml(item.card, item.exhibit, zone, item.card.category === 'media' ? '' : '-media')).join('')}</div>`;
  const logo = safeLogo(input.logoDataUrl);
  const showCase = options.includeCaseIdentifiers !== false;
  const headerRows = [
    ['Agency', input.agency || '—'],
    ...(showCase ? [['Case number', input.caseId || '—']] : []),
    ['Item number', input.itemNumber || '—'],
    ...(showCase ? [['Examiner', input.examiner || '—'], ['Subject', input.subject || '—']] : []),
    ['Provider', input.providerName || '—'],
    ['Generated', formatWhen(input.generatedAtIso, zone)],
    ['Times shown in', zoneName(zone)],
  ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');
  const showAccount = options.includeAccount;
  const showMessages = sectionOn(options.includeMessages, options.includeTimeline);
  const showTimeline = options.includeTimeline;
  const showMedia = sectionOn(options.includeMedia, options.includeTimeline);
  const showLocations = options.includeLocations;
  const showEntities = options.includeEntities;
  const showSources = sectionOn(options.includeSources, true);
  const entities = showEntities ? input.entities : [];
  const entityHtml = entities.length === 0
    ? '<p class="muted">No shared identifiers were included.</p>'
    : `<table class="gridtable"><thead><tr><th>Value</th><th>Type</th><th>Providers</th><th>Where it appeared</th></tr></thead><tbody>${entities.map(entity => {
      const value = entity.type === 'ip' ? redactIpValue(entity.value, options) : redactText(entity.value, options);
      return `<tr><td class="mono">${esc(value)}</td><td>${esc(entity.type)}</td><td>${esc(entity.providers.join(', '))}</td><td>${esc(redactText(entity.detail, options))}</td></tr>`;
    }).join('')}</tbody></table>`;
  const locations = (showLocations ? input.locations : []).filter(point => !options.exhibitsOnly || !!point.tagged);
  const chipRows: Array<[string, string, number]> = [];
  if (showAccount) chipRows.push(['sec-account', 'Account info', input.accounts.length]);
  if (showMessages) chipRows.push(['sec-messages', 'Messages', messages.length]);
  if (showTimeline) chipRows.push(['sec-timeline', 'Timeline', timeline.length]);
  if (showMedia) chipRows.push(['sec-media', 'Media', media.length]);
  if (showLocations) chipRows.push(['sec-locations', 'Locations', locations.length]);
  if (showEntities) chipRows.push(['sec-entities', 'Entity overlaps', entities.length]);
  if (showSources) chipRows.push(['sec-sources', 'Sources', input.sources.length]);
  const chips = chipRows.map(([id, label, count]) => `<a href="#${id}">${esc(label)} <span class="n">${count}</span></a>`).join('');
  const blurClass = options.blurImages ? ' class="blur"' : '';
  const included = new Set<string>();
  if (showAccount) included.add('account');
  if (showMessages) included.add('message');
  if (showTimeline) {
    included.add('connection');
    included.add('call');
    included.add('file');
    included.add('profile');
    included.add('other');
  }
  if (showMedia) included.add('media');
  if (showLocations) included.add('location');
  if (showEntities) included.add('entity');
  if (showSources) included.add('source');
  const typeCounts: Record<string, number> = {
    account: showAccount ? input.accounts.length : 0,
    message: showMessages ? messages.length : 0,
    connection: showTimeline ? timeline.filter(item => evidenceType(item.card.category).id === 'connection').length : 0,
    media: showMedia ? media.length : 0,
    location: showLocations ? locations.length : 0,
    call: showTimeline ? timeline.filter(item => evidenceType(item.card.category).id === 'call').length : 0,
    file: showTimeline ? timeline.filter(item => evidenceType(item.card.category).id === 'file').length : 0,
    profile: showTimeline ? timeline.filter(item => evidenceType(item.card.category).id === 'profile').length : 0,
    other: showTimeline ? timeline.filter(item => evidenceType(item.card.category).id === 'other').length : 0,
    entity: showEntities ? entities.length : 0,
    source: showSources ? input.sources.length : 0,
  };
  const summaryCards = numbered
    .map(item => item.card)
    .filter(card => {
      if (card.category === 'message') return showMessages;
      if (card.category === 'media' || card.media) return showMedia;
      return showTimeline;
    });
  return `<!doctype html><html${blurClass}><head><meta charset="utf-8"><title>${esc(input.caseId || 'Case')} report</title><style>${REPORT_CSS}</style></head><body><a id="top"></a><div class="wrap">
<header class="rpt">${logo ? `<img class="logo" src="${logo}" alt="">` : ''}<div><h1>${esc(input.caseId || 'Case report')}</h1><table>${headerRows}</table>${input.notes ? `<div class="hnotes">${esc(input.notes)}</div>` : ''}</div></header>
<details class="summary" open><summary>Report summary</summary>${summaryTable(typeCounts, summaryCards, input, included)}</details>
<nav class="toc"><span class="lbl">Jump to section:</span>${chips}</nav>
<div class="rptbar"><button type="button" id="btnExpand">Expand all</button><button type="button" id="btnCollapse">Collapse all</button><button type="button" id="btnBlur" class="tgl"><span class="sw"></span>Blur images</button><button type="button" id="btnDark" class="tgl"><span class="sw"></span>Dark mode</button><label>Search <input id="reportSearch" type="search"></label><label>Sort <select id="reportSort"><option value="time">Time</option><option value="exhibit">Exhibit number</option></select></label></div>
${showAccount ? section('sec-account', 'Account info', typeCounts.account, accountTable(input.accounts, options, zone), 'account') : ''}
${showMessages ? section('sec-messages', 'Messages', typeCounts.message, messageHtml, 'message') : ''}
${showTimeline ? section('sec-timeline', 'Timeline', timeline.length, timelineHtml, 'timeline') : ''}
${showMedia ? section('sec-media', 'Media', typeCounts.media, mediaHtml, 'media') : ''}
${showLocations ? section('sec-locations', 'Locations', typeCounts.location, locationPlot(locations), 'location') : ''}
${showEntities ? section('sec-entities', 'Entity overlaps', typeCounts.entity, entityHtml, 'entity') : ''}
${showSources ? section('sec-sources', 'Sources', typeCounts.source, sourceTable(input.sources, input.totals, input.appVersion), 'source') : ''}
<button type="button" id="showMore">Show more</button>
<footer class="gen">Generated by Universal Warrant Return Parser ${esc(input.appVersion || CASE_REPORT_VERSION)}</footer>
</div><script>${REPORT_JS}</script></body></html>`;
}

export interface ReportWorkspaceFile {
  name: string;
  relativePath?: string;
  isMedia?: boolean;
  mediaType?: string | null;
  size?: number;
  content?: string;
  md5?: string | null;
  sha1?: string | null;
  sha256?: string | null;
  capturedAt?: string | null;
  modifiedAt?: string | null;
  gps?: { lat: number; lng: number } | null;
  provider?: string | null;
}

export interface ReportAttachment {
  path: string;
  base64?: string;
  text?: string;
  name?: string;
  relativePath?: string;
}

export interface AssembleReportArgs {
  caseId: string;
  agency: string;
  itemNumber: string;
  examiner: string;
  subject: string;
  providerName: string;
  notes: string;
  logoDataUrl: string;
  generatedAtIso: string;
  appVersion?: string;
  exhibitsOnly: boolean;
  blurImages: boolean;
  timeZone: string;
  redactIpAddresses: boolean;
  redactPii: boolean;
  includeAccount: boolean;
  includeMessages?: boolean;
  includeTimeline: boolean;
  includeMedia?: boolean;
  includeEntities: boolean;
  includeLocations: boolean;
  includeSources?: boolean;
  includeCaseIdentifiers?: boolean;
  embedMedia: boolean;
  events: ForensicEvent[];
  files: ReportWorkspaceFile[];
  tags: Record<string, { tagged?: boolean; notes?: string }>;
  accounts: CaseReportAccount[];
  locations: CaseReportLocation[];
  entities: CaseReportEntity[];
  vicHashes?: Iterable<string>;
  hashLabels?: Record<string, string[]>;
}

function zipMediaPath(file: ReportWorkspaceFile, used: Set<string>): string {
  const raw = (file.relativePath || file.name || 'media').replace(/\\/g, '/');
  const parts = raw.split('/').filter(part => part && part !== '.' && part !== '..' && !/^[a-zA-Z]:$/.test(part));
  const safe = parts.map(part => part.replace(/[^a-zA-Z0-9._-]+/g, '_')).join('/') || 'media';
  let path = `files/${safe}`;
  let n = 2;
  while (used.has(path)) {
    path = `files/${safe}-${n}`;
    n += 1;
  }
  used.add(path);
  return path;
}

function splitContent(content: string | undefined): { dataUrl: string; base64: string; text: string } {
  const value = content || '';
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(value);
  if (match) return { dataUrl: value, base64: match[2], text: '' };
  return { dataUrl: '', base64: '', text: value };
}

function publicDetails(details: unknown): string {
  if (!details || typeof details !== 'object') return '';
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (/path|dir|folder|sourcePath/i.test(key)) continue;
    copy[key] = value;
  }
  const text = JSON.stringify(copy, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
}

function matchLabel(file: ReportWorkspaceFile, vic: Set<string>, labels: Record<string, string[]>): string {
  const out: string[] = [];
  for (const raw of [file.md5, file.sha1, file.sha256]) {
    const hash = (raw || '').trim().toLowerCase();
    if (!hash) continue;
    if (vic.has(hash) && !out.includes('Project VIC')) out.push('Project VIC');
    for (const label of labels[hash] || []) {
      if (!out.includes(label)) out.push(label);
    }
  }
  return out.join(', ');
}

function mediaOf(file: ReportWorkspaceFile, href: string, embed: boolean): CaseReportMedia {
  const packed = splitContent(file.content);
  const kind = file.mediaType === 'video' ? 'video' : 'image';
  const embedded = embed && packed.dataUrl ? packed.dataUrl : '';
  const src = embedded && kind === 'image' ? embedded : href;
  const link = embedded && kind === 'video' ? embedded : href;
  return {
    name: file.name,
    href: link,
    src,
    kind,
    md5: file.md5 || 'not computed',
    sha256: file.sha256 || 'not computed',
    matchLabel: '',
    size: file.size || 0,
  };
}

export function assembleCaseReport(args: AssembleReportArgs): { html: string; attachments: ReportAttachment[] } {
  const tags = args.tags || {};
  const vic = new Set([...(args.vicHashes || [])].map(hash => hash.toLowerCase()));
  const labels = args.hashLabels || {};
  const used = new Set<string>();
  const attachments: ReportAttachment[] = [];
  const pathFor = new Map<string, string>();
  const remember = (file: ReportWorkspaceFile) => {
    const key = `${file.relativePath || ''}::${file.name}`;
    const existing = pathFor.get(key);
    if (existing) return existing;
    const path = zipMediaPath(file, used);
    pathFor.set(key, path);
    const packed = splitContent(file.content);
    attachments.push({
      path,
      base64: packed.base64 || undefined,
      text: !packed.base64 && packed.text && file.isMedia ? packed.text : undefined,
      name: file.name,
      relativePath: file.relativePath,
    });
    return path;
  };
  const fileByName = new Map<string, ReportWorkspaceFile>();
  for (const file of args.files) {
    if (file.name && !fileByName.has(file.name)) fileByName.set(file.name, file);
  }
  const included = args.exhibitsOnly ? args.events.filter(event => tags[event.id]?.tagged) : args.events;
  const cards: CaseReportCard[] = [];
  const linkedNames = new Set<string>();
  const idByEvent = new Map<string, string>();
  included.forEach((event, index) => {
    const mediaName = typeof event.details?.resolvedMediaName === 'string' ? event.details.resolvedMediaName : '';
    const file = mediaName ? fileByName.get(mediaName) : undefined;
    let media: CaseReportMedia | null = null;
    if (file?.isMedia) {
      linkedNames.add(file.name);
      const href = remember(file);
      media = mediaOf(file, href, args.embedMedia);
      media.matchLabel = matchLabel(file, vic, labels);
    }
    const pair = [event.sender || '', event.recipient || ''].map(part => part.toLowerCase()).sort().join(' → ') || 'Conversation';
    const cardId = `evt-${slug(event.id)}-${index + 1}`;
    idByEvent.set(event.id, cardId);
    cards.push({
      id: cardId,
      tagged: !!tags[event.id]?.tagged,
      timestamp: event.timestamp || 'unknown',
      category: event.category || 'other',
      sender: event.sender || '',
      recipient: event.recipient || '',
      content: event.content || '',
      ipAddress: event.ipAddress || '',
      location: event.location || '',
      sourceFile: (event.sourceFile || '').replace(/\\/g, '/').split('/').pop() || '',
      notes: tags[event.id]?.notes || '',
      details: publicDetails(event.details),
      account: event.targetAccount || '',
      provider: args.providerName,
      conversation: pair,
      media,
    });
  });
  const mediaFiles = args.files.filter(file => file.isMedia);
  mediaFiles.forEach((file, index) => {
    const key = `media-file-${file.name}`;
    const tagged = !!tags[key]?.tagged;
    const referenced = linkedNames.has(file.name);
    if (args.exhibitsOnly && !tagged) return;
    if (referenced && !tagged) return;
    const href = remember(file);
    const media = mediaOf(file, href, args.embedMedia);
    media.matchLabel = matchLabel(file, vic, labels);
    cards.push({
      id: `media-${index + 1}`,
      tagged,
      timestamp: mediaExhibitTimestamp(file),
      category: 'media',
      sender: 'Extracted media',
      recipient: '',
      content: file.name,
      ipAddress: '',
      location: file.gps ? `${file.gps.lat}, ${file.gps.lng}` : '',
      sourceFile: (file.name || '').replace(/\\/g, '/').split('/').pop() || '',
      notes: tags[key]?.notes || '',
      details: '',
      account: '',
      provider: file.provider || args.providerName,
      conversation: '',
      media,
    });
  });
  const count = (category: string) => args.events.filter(event => event.category === category).length;
  const sources = new Map<string, CaseReportSource>();
  const bump = (name: string, category: string) => {
    const leaf = (name || 'unknown').replace(/\\/g, '/').split('/').pop() || 'unknown';
    const row = sources.get(leaf) || { name: leaf, hash: 'not computed', messages: 0, connections: 0, files: 0, calls: 0, profiles: 0, other: 0 };
    if (category === 'message') row.messages += 1;
    else if (category === 'connection') row.connections += 1;
    else if (category === 'file') row.files += 1;
    else if (category === 'call') row.calls += 1;
    else if (category === 'profile') row.profiles += 1;
    else row.other += 1;
    sources.set(leaf, row);
  };
  for (const event of args.events) bump(event.sourceFile, event.category);
  for (const file of args.files) {
    if (file.isMedia) continue;
    const leaf = file.name.replace(/\\/g, '/').split('/').pop() || file.name;
    const row = sources.get(leaf) || { name: leaf, hash: 'not computed', messages: 0, connections: 0, files: 0, calls: 0, profiles: 0, other: 0 };
    row.hash = file.sha256 || file.md5 || row.hash;
    sources.set(leaf, row);
  }
  const input: CaseReportInput = {
    caseId: args.caseId,
    agency: args.agency,
    itemNumber: args.itemNumber,
    examiner: args.examiner,
    subject: args.subject,
    providerName: args.providerName,
    notes: args.notes,
    logoDataUrl: args.logoDataUrl,
    generatedAtIso: args.generatedAtIso,
    appVersion: args.appVersion || CASE_REPORT_VERSION,
    accounts: args.accounts,
    cards,
    locations: args.locations.map(point => {
      const tagged = !!(point.tagged || (point.eventId && tags[point.eventId]?.tagged) || (point.tagKey && tags[point.tagKey]?.tagged));
      return {
        ...point,
        label: (point.label || 'Location').replace(/\\/g, '/').split('/').pop() || 'Location',
        cardId: point.cardId || (point.eventId ? idByEvent.get(point.eventId) || '' : ''),
        tagged,
      };
    }).filter(point => !args.exhibitsOnly || point.tagged),
    entities: args.entities,
    sources: [...sources.values()],
    totals: {
      events: args.events.length,
      tagged: args.events.filter(event => tags[event.id]?.tagged).length + mediaFiles.filter(file => tags[`media-file-${file.name}`]?.tagged).length,
      messages: count('message'),
      connections: count('connection'),
      files: count('file'),
      calls: count('call'),
      profiles: count('profile'),
      other: count('other'),
      media: mediaFiles.length,
      locations: args.locations.length,
    },
  };
  return {
    html: buildCaseReportHtml(input, {
      exhibitsOnly: args.exhibitsOnly,
      blurImages: args.blurImages,
      timeZone: args.timeZone,
      redactIpAddresses: args.redactIpAddresses,
      redactPii: args.redactPii,
      includeAccount: args.includeAccount,
      includeMessages: args.includeMessages,
      includeTimeline: args.includeTimeline,
      includeMedia: args.includeMedia,
      includeEntities: args.includeEntities,
      includeLocations: args.includeLocations,
      includeSources: args.includeSources,
      includeCaseIdentifiers: args.includeCaseIdentifiers,
    }),
    attachments,
  };
}

export interface StandaloneMediaFile {
  path: string;
  bytes?: Uint8Array;
  base64?: string;
}

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/\s/g, '');
  if (!clean) return new Uint8Array();
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Media included and not embedded: a zip with report.html and files/.
 * Otherwise one HTML file. Embedding keeps the bytes inside that HTML file.
 */
export function standaloneReportPackage(input: {
  includeMedia: boolean;
  embedMedia: boolean;
  html: string;
  files: StandaloneMediaFile[];
}): { kind: 'html'; html: string } | { kind: 'zip'; html: string; files: Array<{ path: string; bytes: Uint8Array }> } {
  if (!input.includeMedia || input.embedMedia) return { kind: 'html', html: input.html };
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i];
    if (!file.path.startsWith('files/') || file.path.includes('..')) continue;
    const bytes = file.bytes && file.bytes.byteLength ? file.bytes : decodeBase64(file.base64 || '');
    if (!bytes.byteLength) continue;
    files.push({ path: file.path, bytes });
  }
  return { kind: 'zip', html: input.html, files };
}
