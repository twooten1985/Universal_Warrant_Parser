/**
 * Google category parsers. Events are ordinary ForensicEvents with
 * details.googleCategory and details.provider = 'google'.
 * A time is taken from the record. If the record has none, the event is untimed.
 */

import type { AccountRecord, ForensicEvent } from '../types';
import { describeCategory, lookupCategory } from './googleCategories';
import {
  accountFromGoogleFolder,
  e7Pair,
  extensionOfName,
  extractIps,
  googleFolderFromPath,
  isNoDataText,
  parseCoordString,
  type GoogleAccountIdentity,
  type GoogleFolderName,
} from './googleFolders';

export interface GoogleParseOutcome {
  handled: boolean;
  events: ForensicEvent[];
  accountInfo?: AccountRecord;
}

const TIME_HEADER = /(timestamp|date.?time|^time$|^date$|created|start time|end time|first activity|last activity|photo taken|time_usec)/i;
const IP_HEADER = /(ip address|^ip$|client ip|remote ip)/i;
const PROXIED_HEADER = /proxied/i;

export function googleTime(value: unknown): { iso: string; untimed: boolean } {
  if (value == null) return { iso: 'Unknown', untimed: true };
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (o.timestamp != null) return googleTime(o.timestamp);
    if (o.time != null) return googleTime(o.time);
    return { iso: 'Unknown', untimed: true };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return fromEpoch(value);
  }
  const s = String(value).trim();
  if (!s || /^unknown$|^n\/a$|^-$/i.test(s)) return { iso: 'Unknown', untimed: true };
  if (/^\d{10,16}$/.test(s)) return fromEpoch(Number(s));
  const d = new Date(s.replace(/\s+UTC$/i, 'Z').replace(/\s+GMT$/i, 'Z'));
  if (!Number.isNaN(d.getTime())) {
    const year = d.getUTCFullYear();
    if (year >= 1990 && year <= 2100) return { iso: d.toISOString(), untimed: false };
  }
  return { iso: 'Unknown', untimed: true };
}

function fromEpoch(n: number): { iso: string; untimed: boolean } {
  if (!Number.isFinite(n) || n <= 0) return { iso: 'Unknown', untimed: true };
  let ms = n;
  if (n < 1e11) ms = n * 1000;
  else if (n > 1e14) ms = Math.round(n / 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return { iso: 'Unknown', untimed: true };
  const year = d.getUTCFullYear();
  if (year < 1990 || year > 2100) return { iso: 'Unknown', untimed: true };
  return { iso: d.toISOString(), untimed: false };
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function detectDelim(line: string): string {
  const tab = (line.match(/\t/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  const semi = (line.match(/;/g) || []).length;
  if (tab > comma && tab >= semi) return '\t';
  if (semi > comma && semi > tab) return ';';
  return ',';
}

export function parseDelimitedLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
      continue;
    }
    if (c === '"') { q = true; continue; }
    if (c === delim) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

export interface DelimitedTable {
  delimiter: string;
  headers: string[];
  rows: Array<Record<string, string>>;
}

/** Null when the text is not a header row plus at least one record. */
export function parseDelimitedTable(text: string): DelimitedTable | null {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return null;
  const delimiter = detectDelim(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map(h => h.replace(/^\uFEFF/, '').trim());
  if (headers.length < 2) return null;
  if (headers.every(h => h.length > 80)) return null;
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseDelimitedLine(lines[i], delimiter);
    if (cells.every(c => !c)) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c] || `column_${c + 1}`] = cells[c] ?? '';
    }
    rows.push(row);
  }
  if (rows.length === 0) return null;
  return { delimiter, headers, rows };
}

export function forEachDelimitedRow(
  text: string,
  onHeader: (headers: string[], delimiter: string) => void,
  onRow: (row: Record<string, string>, index: number) => void,
): boolean {
  const lines = text.split(/\r?\n/);
  let headers: string[] | null = null;
  let delimiter = ',';
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!headers) {
      delimiter = detectDelim(line);
      headers = parseDelimitedLine(line, delimiter).map(h => h.replace(/^\uFEFF/, '').trim());
      if (headers.length < 2) return false;
      onHeader(headers, delimiter);
      continue;
    }
    const cells = parseDelimitedLine(line, delimiter);
    if (cells.every(c => !c)) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) row[headers[c] || `column_${c + 1}`] = cells[c] ?? '';
    onRow(row, index++);
  }
  return !!headers && index > 0;
}

function field(row: Record<string, string>, re: RegExp): string {
  for (const [k, v] of Object.entries(row)) {
    if (re.test(k) && String(v || '').trim()) return String(v).trim();
  }
  return '';
}

function rowTime(row: Record<string, string>): { iso: string; untimed: boolean } {
  const v = field(row, TIME_HEADER);
  return v ? googleTime(v) : { iso: 'Unknown', untimed: true };
}

function rowIp(row: Record<string, string>): { ip?: string; proxied?: string } {
  let ip = '';
  let proxied = '';
  for (const [k, v] of Object.entries(row)) {
    const val = String(v || '').trim();
    if (!val) continue;
    if (PROXIED_HEADER.test(k)) proxied = proxied || val;
    else if (IP_HEADER.test(k)) ip = ip || val;
  }
  return { ip: ip || undefined, proxied: proxied || undefined };
}

function base(
  fileName: string,
  folder: GoogleFolderName | null,
  acct: GoogleAccountIdentity | null,
  partial: Omit<ForensicEvent, 'sourceFile' | 'id'> & { id?: string },
  index: number,
): ForensicEvent {
  const def = folder ? describeCategory(folder.product, folder.category) : null;
  const untimed = partial.details?.untimed === true || partial.timestamp === 'Unknown';
  return {
    id: partial.id || `g-${def?.id || 'file'}-${index}-${fileName}`,
    timestamp: untimed ? 'Unknown' : partial.timestamp,
    category: partial.category,
    sender: partial.sender,
    recipient: partial.recipient,
    content: partial.content,
    ipAddress: partial.ipAddress,
    location: partial.location,
    sourceFile: fileName,
    targetAccount: partial.targetAccount || acct?.targetAccount,
    accountKey: partial.accountKey || acct?.accountKey,
    details: {
      provider: 'google',
      googleCategory: def?.id,
      googleProduct: folder?.product,
      ...(untimed ? { untimed: true } : {}),
      ...(partial.details || {}),
    },
  };
}

function legacyOwned(fileName: string, folder: GoogleFolderName | null): boolean {
  const n = fileName.toLowerCase();
  if (folder?.key === 'GoogleAccount.SubscriberInfo') return true;
  if (folder?.key === 'Mail.Messages' && (n.endsWith('.mbox') || n.endsWith('.eml'))) return true;
  if (folder) return false;
  if (/(subscriber|account_info)/.test(n) && (n.endsWith('.json') || n.endsWith('.html') || n.endsWith('.htm'))) return true;
  if (n.endsWith('.mbox') || n.endsWith('.eml')) return true;
  if ((n.includes('email') || n.includes('gmail') || n.includes('mail')) && (n.endsWith('.json') || n.endsWith('.csv'))) return true;
  if ((n.includes('search') || n.includes('browser') || n.includes('history')) && (n.endsWith('.json') || n.endsWith('.csv')) && !n.includes('location')) return true;
  if (n.includes('devices') && n.endsWith('.json')) return true;
  if ((n.includes('bio') || n.includes('chat_user_info') || n.includes('user_info')) && n.endsWith('.json') && !n.includes('myactivity')) return true;
  if (n.includes('activity') && n.endsWith('.json') && !n.includes('myactivity')) return true;
  return false;
}

export function parseGoogleContent(fileName: string, content: string, relativePath?: string): GoogleParseOutcome {
  const rel = relativePath || fileName;
  const folder = googleFolderFromPath(`${rel}/${fileName}`);
  const acct = folder ? accountFromGoogleFolder(folder) : null;
  if (legacyOwned(fileName, folder) && !(folder?.key === 'Timeline.Records' || /records\.json$/i.test(fileName))) {
    return { handled: false, events: [] };
  }
  if (isNoDataText(content)) return { handled: true, events: [] };
  try {
    const events = eventsFor(fileName, content, rel, folder, acct);
    if (!events) return { handled: false, events: [] };
    return { handled: true, events };
  } catch (err) {
    console.error('Google category parse failed:', fileName, err);
    return { handled: false, events: [] };
  }
}

function eventsFor(
  fileName: string,
  content: string,
  relativePath: string,
  folder: GoogleFolderName | null,
  acct: GoogleAccountIdentity | null,
): ForensicEvent[] | null {
  const ext = extensionOfName(fileName);
  const key = folder?.key || '';
  const def = folder ? lookupCategory(folder.product, folder.category) : null;
  if (ext === 'mp3' || ext === 'amr' || ext === 'm4a' || ext === 'wav') {
    return audioList(fileName, content, folder, acct);
  }

  if (key === 'Timeline.EncryptedBackups' || /encrypted\s*backups/i.test(fileName)) {
    return [base(fileName, folder, acct, {
      timestamp: 'Unknown',
      category: 'other',
      sender: 'Google Timeline',
      content: 'Encrypted Location History backup. Google encrypts this file. It cannot be decrypted or displayed.',
      details: { untimed: true, encrypted: true, viewable: false, googleKind: 'encrypted-backup' },
    }, 0)];
  }
  if (key === 'DriveMobileBackups.Backup' || (def?.parser === 'list-only')) {
    return [base(fileName, folder, acct, {
      timestamp: 'Unknown',
      category: 'file',
      sender: 'Google Drive',
      content: `Backup file listed (${fileName}). Contents are not parsed. The file stays in the workspace so it can be hashed.`,
      details: { untimed: true, listOnly: true, viewable: false, googleKind: 'binary-backup' },
    }, 0)];
  }
  if (key === 'Timeline.Records' || /records\.json$/i.test(fileName) || /location[_\s-]*history/i.test(fileName)) {
    return timelinePoints(fileName, content, folder, acct, 'point');
  }
  if (key === 'Timeline.SemanticLocationHistory' || /semanticlocationhistory/i.test(fileName)) {
    return timelinePoints(fileName, content, folder, acct, 'semantic');
  }
  if (key === 'Timeline.Settings') return timelineSettings(fileName, content, folder, acct);
  if (key === 'Timeline.UserLocationProfile') return userPlaces(fileName, content, folder, acct);
  if (key === 'Timeline.TimelineEdits' || key === 'Timeline.Tombstones') return genericStructured(fileName, content, folder, acct);
  if (key === 'Maps.AliasedPlacesResource') return mapsPlaces(fileName, content, folder, acct);
  if (key === 'Saved.SavedCollections') return savedPlaces(fileName, content, folder, acct);
  if (key === 'GooglePhotos.PhotoResourceLegal' && ext === 'json') return photoSidecar(fileName, content, folder, acct);
  if (key === 'MyActivity.MyActivity' || /myactivity/i.test(fileName)) return myActivity(fileName, content, folder, acct);
  if (key === 'AccessLogActivity.Activity') return accessActivity(fileName, content, folder, acct);
  if (key === 'AccessLogActivity.Devices') return accessDevices(fileName, content, folder, acct);
  if (key === 'GoogleAccount.ChangeHistory') return changeHistory(fileName, content, folder, acct);
  if (folder?.product === 'GoogleAccountTargetAssociation') return linkedAccounts(fileName, content, folder, acct);
  if (key === 'AndroidDeviceConfigurationService.DeviceAndUserProfile' || /device-.*\.html?$/i.test(fileName)) {
    return androidProfile(fileName, content, folder, acct);
  }
  if (key === 'GoogleChat.Messages') return chatMessages(fileName, content, folder, acct);
  if (key === 'GoogleChat.GroupInfo') return chatGroup(fileName, content, folder, acct);
  if (key === 'GoogleChat.UserInfo' && folder) return chatUser(fileName, content, folder, acct);
  if (key === 'GoogleFiWireless.UserInfo') return fiUserInfo(fileName, content, folder, acct);
  if (key === 'GoogleFiWireless.Voicemails&Greetings') return audioList(fileName, content, folder, acct);
  if (key === 'Voice.Communications') return voiceHtml(fileName, content, folder, acct);
  if (key === 'Voice.ContactsMetadata' || key === 'Contacts.Contacts' || ext === 'vcf' || ext === 'vcard') {
    if (ext === 'vcf' || ext === 'vcard' || /begin:vcard/i.test(content)) return vcards(fileName, content, folder, acct);
  }
  if (ext === 'ics' || /begin:vcalendar/i.test(content)) return icsEvents(fileName, content, folder, acct);
  if (key === 'Mail.MessageInformation') return mailHeaders(fileName, content, folder, acct);
  if (key === 'GooglePay.ConsumerTransactions' || (folder?.product === 'GooglePay' && (ext === 'csv' || ext === 'tsv'))) {
    return payOrTable(fileName, content, folder, acct, key === 'GooglePay.ConsumerTransactions');
  }
  if (key === 'Voice.Billing' || key === 'Voice.SubscriberInformation' || key === 'GoogleFiWireless.Billing') {
    return labeledText(fileName, content, folder, acct);
  }
  if (folder && (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === 'json' || ext === 'html' || ext === 'htm')) {
    return genericStructured(fileName, content, folder, acct);
  }
  if (/records\.json$/i.test(fileName)) return timelinePoints(fileName, content, folder, acct, 'point');
  return null;
}

function timelinePoints(
  fileName: string,
  content: string,
  folder: GoogleFolderName | null,
  acct: GoogleAccountIdentity | null,
  mode: 'point' | 'semantic',
): ForensicEvent[] {
  let data: unknown;
  try { data = JSON.parse(content); } catch { return []; }
  const hits: Array<{ lat: number; lng: number; time?: string; accuracy?: number; label?: string; kind: string; deviceTag?: string; source?: string }> = [];
  walkLocation(data, hits, { kind: mode === 'semantic' ? 'visit' : 'point' });
  return hits.map((h, idx) => {
    const t = googleTime(h.time);
    return base(fileName, folder, acct, {
      id: `google-loc-${idx}-${fileName}`,
      timestamp: t.iso,
      category: 'connection',
      sender: h.kind === 'trip' ? 'Google Timeline trip' : h.kind === 'visit' ? 'Google Timeline visit' : 'Google Location Services',
      content: `${h.kind === 'trip' ? 'Trip' : h.kind === 'visit' ? 'Visit' : 'Latitude'}: ${h.lat}, Longitude: ${h.lng}${h.accuracy != null ? `, Accuracy: ${h.accuracy}` : ''}${h.label ? ` (${h.label})` : ''}`,
      location: h.label,
      details: {
        untimed: t.untimed,
        lat: h.lat,
        lng: h.lng,
        latitude: h.lat,
        longitude: h.lng,
        accuracy: h.accuracy,
        label: h.label,
        googleKind: h.kind,
        deviceTag: h.deviceTag,
        source: h.source,
      },
    }, idx);
  });
}

function walkLocation(
  node: unknown,
  hits: Array<{ lat: number; lng: number; time?: string; accuracy?: number; label?: string; kind: string; deviceTag?: string; source?: string }>,
  ctx: { kind: string; time?: string; deviceTag?: string; source?: string },
): void {
  if (node == null) return;
  if (typeof node === 'string') {
    const c = parseCoordString(node);
    if (c) hits.push({ ...c, time: ctx.time, kind: ctx.kind, deviceTag: ctx.deviceTag, source: ctx.source });
    return;
  }
  if (Array.isArray(node)) {
    const geo = geoJsonPair(node);
    if (geo && ctx.kind === 'geojson') {
      hits.push({ ...geo, time: ctx.time, kind: 'place', deviceTag: ctx.deviceTag, source: ctx.source });
      return;
    }
    for (let i = 0; i < node.length; i++) walkLocation(node[i], hits, ctx);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  const time = firstTime(o) || ctx.time;
  const deviceTag = str(o.deviceTag) || ctx.deviceTag;
  const source = str(o.source) || ctx.source;
  const label = str(o.label) || str(o.name) || str(o.placeId);
  const next = { ...ctx, time, deviceTag, source };
  const pair = objectCoord(o);
  const ownKind = kindFromKeys(o) || ctx.kind;
  if (pair) {
    const acc = num(o.accuracy) ?? num(o.accuracyMeters) ?? num(o.accuracy_meters);
    hits.push({ ...pair, time, accuracy: acc ?? undefined, label: label || undefined, kind: ownKind, deviceTag, source });
  }
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    const nk = k.toLowerCase();
    let childKind = next.kind;
    if (nk === 'placevisit' || nk === 'visit') childKind = 'visit';
    else if (nk === 'activitysegment' || nk === 'activity' || nk === 'timelinepath') childKind = 'trip';
    else if (nk === 'coordinates' || nk === 'geometry') childKind = 'geojson';
    else if (nk === 'locations' || nk === 'rawsignals' || nk === 'position') childKind = 'point';
    if (typeof v === 'string') {
      if (!pair) walkLocation(v, hits, { ...next, kind: childKind });
      continue;
    }
    if (typeof v === 'object') walkLocation(v, hits, { ...next, kind: childKind });
  }
}

function kindFromKeys(o: Record<string, unknown>): string | null {
  if (o.placeVisit || o.visit) return 'visit';
  if (o.activitySegment || o.activity || o.timelinePath) return 'trip';
  return null;
}

function objectCoord(o: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = o.latitudeE7 ?? o.latitude ?? o.lat;
  const lng = o.longitudeE7 ?? o.longitude ?? o.lng ?? o.lon;
  if (lat != null && lng != null) {
    const pair = e7Pair(lat, lng);
    if (pair) return pair;
  }
  const geo = o.geoData ?? o.geo;
  if (geo && typeof geo === 'object') {
    const g = geo as Record<string, unknown>;
    const p = e7Pair(g.latitude ?? g.lat, g.longitude ?? g.lng ?? g.lon);
    if (p) return p;
  }
  for (const key of ['latLng', 'latlng', 'point', 'placeLocation', 'position']) {
    if (typeof o[key] === 'string') {
      const p = parseCoordString(String(o[key]));
      if (p) return p;
    }
  }
  return null;
}

function geoJsonPair(arr: unknown[]): { lat: number; lng: number } | null {
  if (arr.length < 2 || typeof arr[0] === 'object' || typeof arr[1] === 'object') return null;
  const lng = Number(arr[0]);
  const lat = Number(arr[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7) return null;
  return { lat, lng };
}

function firstTime(o: Record<string, unknown>): string | undefined {
  for (const k of ['timestamp', 'timestampMs', 'startTimestamp', 'startTime', 'time', 'photoTakenTime', 'creationTime', 'created_date', 'endTime']) {
    if (o[k] == null) continue;
    const t = googleTime(o[k]);
    if (!t.untimed) return t.iso;
  }
  const dur = o.duration;
  if (dur && typeof dur === 'object') {
    const d = dur as Record<string, unknown>;
    const t = googleTime(d.startTimestamp || d.start || d.startTime);
    if (!t.untimed) return t.iso;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function timelineSettings(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  let data: any;
  try { data = JSON.parse(content); } catch { return genericStructured(fileName, content, folder, acct); }
  const list = Array.isArray(data?.deviceSettings) ? data.deviceSettings : Array.isArray(data) ? data : [];
  if (list.length === 0) return genericStructured(fileName, content, folder, acct);
  return list.map((dev: any, idx: number) => {
    const t = googleTime(dev.deviceCreationTime || dev.creationTime);
    const name = str(dev.devicePrettyName) || str(dev.platformType) || 'Device';
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: 'other',
      sender: 'Google Timeline',
      content: `Device ${str(dev.deviceTag) || idx}: ${name}${dev.platformType ? ` (${dev.platformType})` : ''}`,
      details: {
        untimed: t.untimed,
        googleKind: 'device-setting',
        deviceTag: str(dev.deviceTag),
        deviceName: str(dev.devicePrettyName),
        platformType: str(dev.platformType),
        reportingEnabled: dev.reportingEnabled,
      },
    }, idx);
  });
}

function userPlaces(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  let data: any;
  try { data = JSON.parse(content); } catch { return []; }
  const list = Array.isArray(data?.frequentPlaces) ? data.frequentPlaces : Array.isArray(data) ? data : [data];
  const events: ForensicEvent[] = [];
  list.forEach((place: any, idx: number) => {
    if (!place || typeof place !== 'object') return;
    const hits: Array<{ lat: number; lng: number; time?: string; kind: string; label?: string }> = [];
    walkLocation(place, hits, { kind: 'place' });
    const label = str(place.label) || str(place.placeId) || 'Place';
    if (hits.length === 0) {
      events.push(base(fileName, folder, acct, {
        timestamp: 'Unknown',
        category: 'other',
        sender: 'Google Timeline',
        content: `Labeled place: ${label}`,
        details: { untimed: true, googleKind: 'labeled-place', label, placeId: str(place.placeId) },
      }, idx));
      return;
    }
    hits.forEach((h, j) => {
      events.push(base(fileName, folder, acct, {
        timestamp: 'Unknown',
        category: 'connection',
        sender: 'Google Timeline',
        content: `${label}: ${h.lat}, ${h.lng}`,
        location: label,
        details: { untimed: true, lat: h.lat, lng: h.lng, latitude: h.lat, longitude: h.lng, label, googleKind: 'labeled-place', placeId: str(place.placeId) },
      }, idx * 10 + j));
    });
  });
  return events;
}

function mapsPlaces(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  let data: any;
  try { data = JSON.parse(content); } catch { return genericStructured(fileName, content, folder, acct); }
  const features = Array.isArray(data?.features) ? data.features : Array.isArray(data) ? data : [];
  if (features.length === 0) return genericStructured(fileName, content, folder, acct);
  const events: ForensicEvent[] = [];
  features.forEach((f: any, idx: number) => {
    const props = f?.properties || f || {};
    const name = str(props.name) || str(props.title) || 'Place';
    const address = str(props.address) || str(props.formatted_address);
    const coords = f?.geometry?.coordinates;
    const pair = Array.isArray(coords) ? geoJsonPair(coords) : null;
    events.push(base(fileName, folder, acct, {
      timestamp: 'Unknown',
      category: 'connection',
      sender: 'Google Maps',
      content: address ? `${name} — ${address}` : name,
      location: address || name,
      details: {
        untimed: true,
        googleKind: 'aliased-place',
        name,
        address,
        ...(pair ? { lat: pair.lat, lng: pair.lng, latitude: pair.lat, longitude: pair.lng } : {}),
      },
    }, idx));
  });
  return events;
}

function savedPlaces(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const table = parseDelimitedTable(content);
  if (!table) return genericStructured(fileName, content, folder, acct);
  return table.rows.map((row, idx) => {
    const title = field(row, /title|name/i) || 'Saved item';
    const note = field(row, /note|description/i);
    const url = field(row, /url/i);
    const tags = field(row, /tag/i);
    const coord = parseCoordString(note) || parseCoordString(url) || parseCoordString(Object.values(row).join(' '));
    const t = rowTime(row);
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: coord ? 'connection' : 'other',
      sender: 'Google Maps',
      content: [title, note, url].filter(Boolean).join(' — '),
      details: {
        untimed: t.untimed,
        googleKind: 'saved-place',
        title,
        note,
        url,
        tags,
        fields: row,
        ...(coord ? { lat: coord.lat, lng: coord.lng, latitude: coord.lat, longitude: coord.lng } : {}),
      },
    }, idx);
  });
}

function photoSidecar(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  let data: any;
  try { data = JSON.parse(content); } catch { return []; }
  const title = str(data.title) || fileName;
  const taken = googleTime(data.photoTakenTime || data.creationTime || data.timestamp);
  const geo = data.geoData || data.geoDataExif || {};
  const pair = e7Pair(geo.latitude, geo.longitude);
  return [base(fileName, folder, acct, {
    timestamp: taken.iso,
    category: 'file',
    sender: 'Google Photos',
    content: pair ? `${title} at ${pair.lat}, ${pair.lng}` : title,
    details: {
      untimed: taken.untimed,
      googleKind: 'photo',
      title,
      ...(pair ? { lat: pair.lat, lng: pair.lng, latitude: pair.lat, longitude: pair.lng } : {}),
    },
  }, 0)];
}

function myActivity(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: any;
    try { data = JSON.parse(trimmed); } catch { return []; }
    const items = Array.isArray(data) ? data : (data.activities || data.events || []);
    if (!Array.isArray(items)) return [];
    return items.map((item: any, idx: number) => {
      const t = googleTime(item.time || item.timestamp || item.time_usec);
      const title = str(item.title) || str(item.header) || 'Activity';
      const url = str(item.titleUrl) || str(item.url);
      const products = Array.isArray(item.products) ? item.products.join(', ') : str(item.header);
      let ip: string | undefined;
      if (Array.isArray(item.details)) {
        const hit = item.details.find((d: any) => /ip/i.test(String(d?.name || '')) || extractIps(String(d?.value || '')).length);
        if (hit) ip = extractIps(String(hit.value || ''))[0] || str(hit.value);
      }
      const loc = Array.isArray(item.locationInfos) ? item.locationInfos[0] : null;
      const pair = loc ? e7Pair(loc.latitude ?? loc.lat, loc.longitude ?? loc.lng) : null;
      return base(fileName, folder, acct, {
        id: `google-act-${idx}-${fileName}`,
        timestamp: t.iso,
        category: 'other',
        sender: products || 'Google Activity',
        content: url ? `${title} (${url})` : title,
        ipAddress: ip,
        details: { untimed: t.untimed, title, url, products, ipAddress: ip, googleKind: 'my-activity', ...(pair ? { lat: pair.lat, lng: pair.lng } : {}) },
      }, idx);
    });
  }
  return myActivityHtml(fileName, content, folder, acct);
}

function myActivityHtml(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const chunks = content.split(/class="[^"]*outer-cell[^"]*"/i).slice(1);
  const blocks = chunks.length ? chunks : content.split(/<div[^>]+content-cell/i).slice(1);
  const source = blocks.length ? blocks : [content];
  const events: ForensicEvent[] = [];
  source.forEach((block, idx) => {
    const text = stripTags(block).split('\n').map(l => l.trim()).filter(Boolean);
    const href = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const title = href ? stripTags(href[2]).trim() : (text[0] || '');
    if (!title || /^no\s*data$/i.test(title)) return;
    let time = { iso: 'Unknown', untimed: true };
    for (const line of text) {
      const t = googleTime(line);
      if (!t.untimed) { time = t; break; }
    }
    events.push(base(fileName, folder, acct, {
      timestamp: time.iso,
      category: 'other',
      sender: 'Google My Activity',
      content: href ? `${title} (${href[1]})` : title,
      details: { untimed: time.untimed, title, url: href?.[1], googleKind: 'my-activity' },
    }, idx));
  });
  return events;
}

function accessActivity(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const table = parseDelimitedTable(content);
  if (!table) return [];
  return table.rows.map((row, idx) => {
    const t = rowTime(row);
    const ips = rowIp(row);
    const product = field(row, /product/i);
    const activity = field(row, /activity type|activity/i);
    const ua = field(row, /user agent/i);
    const where = [field(row, /country/i), field(row, /region/i), field(row, /city/i)].filter(Boolean).join(', ');
    const bits = [activity || product || 'Activity', where, ua].filter(Boolean);
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: 'connection',
      sender: product || 'Google Access Log',
      content: bits.join(' — '),
      ipAddress: ips.ip,
      location: where || undefined,
      details: {
        untimed: t.untimed,
        googleKind: 'access-log',
        ipAddress: ips.ip,
        proxiedIp: ips.proxied,
        userAgent: ua || undefined,
        product: product || undefined,
        subProduct: field(row, /sub-?product/i) || undefined,
        activityType: activity || undefined,
        gmailChannel: field(row, /gmail access channel|channel/i) || undefined,
        gaiaId: field(row, /gaia/i) || undefined,
        fields: row,
      },
    }, idx);
  });
}

function accessDevices(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const table = parseDelimitedTable(content);
  if (!table) return genericStructured(fileName, content, folder, acct);
  return table.rows.map((row, idx) => {
    const last = field(row, /last activity|last seen|last/i);
    const first = field(row, /first activity|first seen|first/i);
    const t = googleTime(last || first);
    const model = [field(row, /brand/i), field(row, /model/i), field(row, /device type|type/i)].filter(Boolean).join(' ');
    const os = [field(row, /^os$|operating/i), field(row, /os version|version/i)].filter(Boolean).join(' ');
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: 'connection',
      sender: 'Google Access Log',
      content: `Device: ${model || 'Unknown device'}${os ? ` — ${os}` : ''}`,
      location: field(row, /country/i) || undefined,
      details: { untimed: t.untimed, googleKind: 'device', fields: row, device: model || undefined },
    }, idx);
  });
}

function changeHistory(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const table = htmlRows(content);
  const events: ForensicEvent[] = [];
  const body = table.length ? table : stripTags(content).split('\n').map(l => [l.trim()]).filter(r => r[0]);
  body.forEach((cells, idx) => {
    const joined = cells.join(' | ');
    if (!joined || isNoDataText(joined) || HEADER_LINE_SKIP(joined)) return;
    let time = { iso: 'Unknown', untimed: true };
    for (const c of cells) {
      const t = googleTime(c);
      if (!t.untimed) { time = t; break; }
    }
    const ip = extractIps(joined)[0];
    if (time.untimed && !ip && cells.length < 2 && joined.length < 12) return;
    events.push(base(fileName, folder, acct, {
      timestamp: time.iso,
      category: 'other',
      sender: 'Google Account',
      content: `Account change: ${joined.slice(0, 500)}`,
      ipAddress: ip,
      details: { untimed: time.untimed, googleKind: 'account-change', cells, ipAddress: ip },
    }, idx));
  });
  return events;
}

function HEADER_LINE_SKIP(line: string): boolean {
  return /^(google|service|resource|originating identifier|resolved identifier)\b/i.test(line.trim());
}

function htmlRows(html: string): string[][] {
  const rows: string[][] = [];
  const parts = html.split(/<tr\b/i).slice(1);
  for (let i = 0; i < parts.length; i++) {
    const cells = [...parts[i].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => stripTags(m[1]).replace(/\s+/g, ' ').trim());
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

function linkedAccounts(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const table = parseDelimitedTable(content);
  if (!table) return labeledText(fileName, content, folder, acct);
  return table.rows.map((row, idx) => {
    const t = rowTime(row);
    const summary = Object.entries(row).filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k}: ${v}`).join('; ');
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: 'other',
      sender: 'Google Account',
      content: `Linked account (${folder?.category || 'link'}): ${summary.slice(0, 500)}`,
      details: { untimed: t.untimed, googleKind: 'linked-account', linkType: folder?.category, fields: row },
    }, idx);
  });
}

function androidProfile(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const rows = htmlRows(content);
  const fields: Record<string, string> = {};
  if (rows.length) {
    for (const r of rows) {
      if (r.length >= 2) fields[r[0]] = r.slice(1).join(' ');
    }
  }
  const lines = stripTags(content).split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = /^([^:]{2,60}):\s*(.+)$/.exec(line);
    if (m && !fields[m[1]]) fields[m[1].trim()] = m[2].trim();
  }
  const preview = Object.entries(fields).slice(0, 12).map(([k, v]) => `${k}: ${v}`).join('; ') || lines.slice(0, 8).join(' | ');
  if (!preview || isNoDataText(preview)) return [];
  return [base(fileName, folder, acct, {
    timestamp: 'Unknown',
    category: 'profile',
    sender: 'Android device',
    content: preview.slice(0, 800),
    details: { untimed: true, googleKind: 'android-device', fields, deviceNumericId: folder?.numericId },
  }, 0)];
}

function chatMessages(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  let data: any;
  try { data = JSON.parse(content); } catch { return genericStructured(fileName, content, folder, acct); }
  const list = Array.isArray(data) ? data : (data.messages || []);
  if (!Array.isArray(list) || list.length === 0) return genericStructured(fileName, content, folder, acct);
  const room = str(data.group_id) || str(data.conversation_id) || folder?.folder || 'Google Chat';
  return list.map((msg: any, idx: number) => {
    const t = googleTime(msg.created_date || msg.createdDate || msg.timestamp);
    const creator = msg.creator || {};
    const sender = str(creator.name) || str(creator.email) || 'Chat user';
    const text = str(msg.text) || str(msg.message) || '';
    const files = Array.isArray(msg.attached_files) ? msg.attached_files.map((f: any) => str(f.export_name) || str(f.name)).filter(Boolean) : [];
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: 'message',
      sender,
      content: text || (files.length ? `Attachment: ${files.join(', ')}` : '(no text)'),
      details: {
        untimed: t.untimed,
        googleKind: 'chat-message',
        conversationId: `Google Chat: ${room}`,
        conversationName: `Google Chat ${room}`,
        creatorEmail: str(creator.email),
        attached: files.join('; '),
        deleted: str(msg.deleted_date || msg.deletedDate),
      },
    }, idx);
  });
}

function chatGroup(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  let data: any;
  try { data = JSON.parse(content); } catch { return []; }
  const members = Array.isArray(data?.members) ? data.members : Array.isArray(data) ? data : [];
  return members.map((m: any, idx: number) => base(fileName, folder, acct, {
    timestamp: 'Unknown',
    category: 'profile',
    sender: str(m.name) || str(m.email) || 'Member',
    content: `Chat member: ${[str(m.name), str(m.email), str(m.user_type)].filter(Boolean).join(' · ') || 'member'}`,
    details: { untimed: true, googleKind: 'chat-member', email: str(m.email), name: str(m.name), userType: str(m.user_type || m.userType) },
  }, idx));
}

function chatUser(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  let data: any;
  try { data = JSON.parse(content); } catch { return []; }
  const user = data.user || data;
  const email = str(user.email);
  const t = googleTime(data.created_date || data.createdDate);
  return [base(fileName, folder, acct, {
    timestamp: t.iso,
    category: 'profile',
    sender: 'Google Chat',
    content: `Chat profile ${email || ''} state ${str(data.user_state || data.userState) || 'unknown'}`.trim(),
    details: { untimed: t.untimed, googleKind: 'chat-profile', email, userType: str(user.user_type || user.userType) },
  }, 0)];
}

function fiUserInfo(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const table = parseDelimitedTable(content);
  if (!table) return genericStructured(fileName, content, folder, acct);
  return table.rows.map((row, idx) => {
    const t = googleTime(field(row, /start/i) || field(row, TIME_HEADER));
    const usage = field(row, /usage type|type/i);
    const direction = field(row, /direction/i);
    const remote = field(row, /remote|other number|destination/i);
    const dur = field(row, /duration/i);
    const isCall = /call|voice/i.test(usage);
    const isText = /sms|mms|message|text/i.test(usage);
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: isCall ? 'call' : isText ? 'message' : 'other',
      sender: field(row, /user number|subscriber/i) || 'Google Fi',
      recipient: remote || undefined,
      content: [usage || 'Fi record', direction, remote, dur ? `${dur}` : ''].filter(Boolean).join(' · '),
      details: {
        untimed: t.untimed,
        googleKind: 'fi-usage',
        conversationId: remote ? `Fi: ${remote}` : 'Google Fi',
        usageType: usage || undefined,
        direction: direction || undefined,
        duration: dur || undefined,
        equipmentId: field(row, /equipment/i) || undefined,
        carrier: field(row, /carrier/i) || undefined,
        fields: row,
      },
    }, idx);
  });
}

function audioList(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const ext = extensionOfName(fileName);
  if (ext === 'mp3' || ext === 'amr' || ext === 'm4a' || ext === 'wav') {
    return [base(fileName, folder, acct, {
      timestamp: 'Unknown',
      category: 'call',
      sender: 'Google Fi',
      content: `Voicemail audio: ${fileName}`,
      details: { untimed: true, googleKind: 'voicemail', mediaName: fileName, conversationId: 'Fi voicemail' },
    }, 0)];
  }
  return genericStructured(fileName, content, folder, acct);
}

function voiceHtml(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const pieces = content.split(/<abbr\b/i).slice(1);
  const blocks = pieces.length ? pieces.map(p => `<abbr ${p}`) : [content];
  const events: ForensicEvent[] = [];
  blocks.forEach((block, idx) => {
    const timeAttr = /<abbr\b[^>]*\btitle="([^"]+)"/i.exec(block);
    const t = googleTime(timeAttr?.[1]);
    const sender = stripTags((/<cite\b[\s\S]*?<span[^>]*class="[^"]*\bfn\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1]) || (/<cite\b[^>]*>([\s\S]*?)<\/cite>/i.exec(block)?.[1]) || '').trim();
    const tel = /<a\b[^>]*class="[^"]*\btel\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const phone = tel ? stripTags(tel[1]).trim() : '';
    const quote = /<q\b[^>]*>([\s\S]*?)<\/q>/i.exec(block);
    const text = quote ? stripTags(quote[1]).trim() : '';
    const audio = /href="([^"]+\.(?:mp3|amr|m4a))"/i.exec(block);
    const callish = /class="[^"]*(call|voicemail)[^"]*"/i.test(block) || !!audio;
    if (!text && !phone && !audio && !timeAttr) return;
    const thread = phone || sender || 'Google Voice';
    events.push(base(fileName, folder, acct, {
      timestamp: t.iso,
      category: callish && !text ? 'call' : 'message',
      sender: sender || phone || 'Google Voice',
      recipient: phone || undefined,
      content: text || (audio ? `Voicemail ${audio[1]}` : 'Voice call'),
      details: {
        untimed: t.untimed,
        googleKind: audio ? 'voicemail' : callish ? 'voice-call' : 'voice-text',
        conversationId: `Voice: ${thread}`,
        conversationName: `Google Voice ${thread}`,
        phone: phone || undefined,
        mediaName: audio?.[1],
      },
    }, idx));
  });
  return events.length ? events : labeledText(fileName, content, folder, acct);
}

function vcards(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const cards = content.split(/BEGIN:VCARD/i).slice(1);
  return cards.map((card, idx) => {
    const unfolded = card.replace(/\r?\n[ \t]/g, '');
    const get = (key: string) => {
      const re = new RegExp(`^${key}[^:]*:(.*)$`, 'im');
      return (re.exec(unfolded)?.[1] || '').trim();
    };
    const tels = [...unfolded.matchAll(/^TEL[^:]*:(.*)$/gim)].map(m => m[1].trim()).filter(Boolean);
    const emails = [...unfolded.matchAll(/^EMAIL[^:]*:(.*)$/gim)].map(m => m[1].trim()).filter(Boolean);
    const fn = get('FN') || get('N');
    return base(fileName, folder, acct, {
      timestamp: 'Unknown',
      category: 'other',
      sender: fn || 'Contact',
      content: [fn, tels.join(', '), emails.join(', '), get('ORG')].filter(Boolean).join(' · ') || 'Empty vCard',
      details: { untimed: true, googleKind: 'contact', kind: 'contact', fn, tel: tels.join('; '), email: emails.join('; '), org: get('ORG') || undefined },
    }, idx);
  });
}

function icsEvents(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const events = content.split(/BEGIN:VEVENT/i).slice(1);
  return events.map((ev, idx) => {
    const unfolded = ev.replace(/\r?\n[ \t]/g, '');
    const get = (key: string) => (new RegExp(`^${key}[^:]*:(.*)$`, 'im').exec(unfolded)?.[1] || '').trim();
    const t = googleTime(get('DTSTART').replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/, '$1-$2-$3T$4:$5:$6Z'));
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: 'other',
      sender: get('ORGANIZER') || 'Calendar',
      content: get('SUMMARY') || 'Calendar event',
      location: get('LOCATION') || undefined,
      details: { untimed: t.untimed, googleKind: 'calendar', summary: get('SUMMARY'), location: get('LOCATION') || undefined },
    }, idx);
  });
}

function mailHeaders(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const table = parseDelimitedTable(content);
  if (table && table.headers.some(h => /subject|from|to/i.test(h))) {
    return table.rows.map((row, idx) => {
      const t = rowTime(row);
      const subject = field(row, /subject/i) || '(No Subject)';
      const from = field(row, /^from$|sender/i) || 'Unknown Sender';
      const to = field(row, /^to$|recipient/i) || '';
      const body = field(row, /body|snippet|content/i);
      return base(fileName, folder, acct, {
        timestamp: t.iso,
        category: 'message',
        sender: from,
        recipient: to || undefined,
        content: `[Email Subject: ${subject}] ${body}`.trim(),
        ipAddress: rowIp(row).ip,
        details: {
          untimed: t.untimed,
          isEmail: true,
          googleKind: 'mail-header',
          subject,
          from,
          to,
          body,
          headersOnly: !body,
        },
      }, idx);
    });
  }
  return labeledText(fileName, content, folder, acct);
}

function payOrTable(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null, pay: boolean): ForensicEvent[] {
  const table = parseDelimitedTable(content);
  if (!table) return genericStructured(fileName, content, folder, acct);
  return table.rows.map((row, idx) => {
    const t = rowTime(row);
    const amount = field(row, /amount|value/i);
    const desc = field(row, /description|memo|title|name/i) || field(row, /product/i) || 'Transaction';
    const status = field(row, /status/i);
    return base(fileName, folder, acct, {
      timestamp: t.iso,
      category: 'other',
      sender: 'Google Pay',
      content: [desc, amount, status].filter(Boolean).join(' · '),
      details: {
        untimed: t.untimed,
        googleKind: pay ? 'pay-transaction' : 'table-row',
        amount: amount || undefined,
        status: status || undefined,
        transactionId: field(row, /transaction/i) || undefined,
        paymentMethod: field(row, /payment method|method/i) || undefined,
        fields: row,
      },
    }, idx);
  });
}

function labeledText(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const text = /<html|<table|<div/i.test(content) ? stripTags(content) : content;
  const fields: Record<string, string> = {};
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).filter(l => !HEADER_LINE_SKIP(l));
  if (lines.every(l => /^no\s*data[.!]?$/i.test(l))) return [];
  for (const line of lines) {
    const m = /^([^:]{2,80}):\s*(.+)$/.exec(line);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  const preview = Object.keys(fields).length
    ? Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')
    : lines.join('\n');
  if (!preview.trim()) return [];
  const t = googleTime(fields['Date'] || fields['Created'] || lines.find(l => !googleTime(l).untimed) || '');
  return [base(fileName, folder, acct, {
    timestamp: t.iso,
    category: 'other',
    sender: folder?.product || 'Google',
    content: preview.slice(0, 2000),
    details: { untimed: t.untimed, googleKind: 'labeled-text', fields },
  }, 0)];
}

function audioOrSkip(fileName: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const ext = extensionOfName(fileName);
  if (ext === 'mp3' || ext === 'amr' || ext === 'm4a') return audioList(fileName, '', folder, acct);
  return [];
}

/** Header-driven table, or one JSON object per array element. No assumed columns. */
function genericStructured(fileName: string, content: string, folder: GoogleFolderName | null, acct: GoogleAccountIdentity | null): ForensicEvent[] {
  const ext = extensionOfName(fileName);
  if (ext === 'mp3' || ext === 'amr' || ext === 'm4a') return audioOrSkip(fileName, folder, acct);
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (isNoDataText(trimmed)) return [];
  if (ext === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      const rows = jsonRecords(data);
      if (rows.length) {
        return rows.map((row, idx) => {
          const t = rowTime(flatten(row));
          return base(fileName, folder, acct, {
            timestamp: t.iso,
            category: 'other',
            sender: folder?.product || 'Google',
            content: summarize(row),
            details: { untimed: t.untimed, googleKind: 'json-record', fields: flatten(row) },
          }, idx);
        });
      }
    } catch { /* fall through */ }
  }
  const table = parseDelimitedTable(content);
  if (table) {
    return table.rows.map((row, idx) => {
      const t = rowTime(row);
      const ips = rowIp(row);
      return base(fileName, folder, acct, {
        timestamp: t.iso,
        category: ips.ip ? 'connection' : 'other',
        sender: folder?.product || 'Google',
        content: Object.entries(row).filter(([, v]) => v).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(' · '),
        ipAddress: ips.ip,
        details: { untimed: t.untimed, googleKind: 'table-row', fields: row },
      }, idx);
    });
  }
  if (ext === 'html' || ext === 'htm' || /<html|<table|<div/i.test(content)) {
    const rows = htmlRows(content);
    if (rows.length > 1) {
      const headers = rows[0];
      return rows.slice(1).map((cells, idx) => {
        const fields: Record<string, string> = {};
        headers.forEach((h, i) => { fields[h || `column_${i + 1}`] = cells[i] || ''; });
        const t = rowTime(fields);
        return base(fileName, folder, acct, {
          timestamp: t.iso,
          category: 'other',
          sender: folder?.product || 'Google',
          content: cells.filter(Boolean).join(' · ').slice(0, 500),
          details: { untimed: t.untimed, googleKind: 'table-row', fields },
        }, idx);
      });
    }
    return labeledText(fileName, content, folder, acct);
  }
  return labeledText(fileName, content, folder, acct);
}

function jsonRecords(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter(x => x && typeof x === 'object') as Array<Record<string, unknown>>;
  }
  if (!data || typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;
  for (const v of Object.values(o)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v as Array<Record<string, unknown>>;
  }
  return [o];
}

function flatten(row: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) continue;
    if (typeof v === 'object') {
      const nested = flatten(v as Record<string, unknown>, key);
      if (Object.keys(nested).length < 12) Object.assign(out, nested);
      else out[key] = JSON.stringify(v).slice(0, 300);
    } else out[key] = String(v);
  }
  return out;
}

function summarize(row: Record<string, unknown>): string {
  const flat = flatten(row);
  return Object.entries(flat).filter(([, v]) => v).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(' · ').slice(0, 500) || 'Record';
}

/** One sweep hit per public IP. Time comes from the same line, or the event is untimed. */
export function sweepPublicIps(content: string, fileName: string, skip: boolean): ForensicEvent[] {
  if (skip || !content) return [];
  const best = new Map<string, { time?: string }>();
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ips = extractIps(line);
    if (!ips.length) continue;
    const time = lineTime(line);
    for (const ip of ips) {
      const prev = best.get(ip);
      if (!prev) best.set(ip, { time: time || undefined });
      else if (!prev.time && time) prev.time = time;
    }
  }
  const events: ForensicEvent[] = [];
  let n = 0;
  for (const [ip, info] of best) {
    const t = info.time ? googleTime(info.time) : { iso: 'Unknown', untimed: true };
    events.push({
      id: `google-ip-sweep-${ip}-${n}-${fileName}`,
      timestamp: t.untimed ? 'Unknown' : t.iso,
      category: 'connection',
      sender: 'Google IP Sweeper',
      content: `IP Address [${ip}] extracted from return file "${fileName}"`,
      ipAddress: ip,
      sourceFile: fileName,
      details: {
        provider: 'google',
        extractedIP: ip,
        extractionMethod: 'Regex Sweep',
        sourceFile: fileName,
        untimed: t.untimed,
      },
    });
    n++;
  }
  return events;
}

function lineTime(line: string): string | null {
  const m = line.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (!m) return null;
  const t = googleTime(m[0]);
  return t.untimed ? null : t.iso;
}

export function skipIpSweep(fileName: string, relativePath?: string): boolean {
  const hay = `${relativePath || ''} ${fileName}`.toLowerCase();
  return /location history|location_history|records\.json|semanticlocationhistory|timeline\.records/.test(hay);
}
