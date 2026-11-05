/**
 * Discord session text, login history, and account merge.
 *
 * The repository has no redacted Discord session sample. This reader is
 * label-based and accepts several realistic shapes:
 * - a profile block (Username, User ID, Registration IP, Last Seen IP, …)
 * - a later IP log whose own header row is skipped, then every data row is kept
 * - pipe, colon, tab, or comma separators
 * - repeated "IP" + "Timestamp" pairs
 *
 * Discord login times are UTC. A value with no zone is read as UTC, not as
 * the examiner's local zone. "Not found" is kept as that text and is never
 * used as an account key or a shared identifier.
 *
 * A header IP that also appears in the history does not add a second row.
 * The same IP at a different timestamp stays as its own row.
 * A redacted sample of the production session file would confirm any columns
 * this label scan still skips.
 */

import type {
  AccountRecord,
  DiscordLoginActivity,
  DiscordUsernameChange,
  ForensicEvent,
} from '../types';
import { isNonIdentifier, isNotFoundLiteral } from '../identity/normalize';

export interface SessionHistoryRow {
  ip: string;
  timestampRaw: string;
}

export interface SessionExtract {
  username?: string;
  displayName?: string;
  userId?: string;
  email?: string;
  phone?: string;
  createdRaw?: string;
  registrationIp?: string;
  lastSeenIp?: string;
  lastSeenRaw?: string;
  /** Fields whose recorded value is the literal Not found (original spelling). */
  literals: Record<string, string>;
  history: SessionHistoryRow[];
}

export interface SubscriberAliasGroup {
  names: string[];
}

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const TIMESTAMP_RE = /\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s*(?:Z|UTC|GMT|[+-]\d{2}:?\d{2}))?/i;

const PROFILE_FIELDS: Array<{ field: keyof SessionExtract | 'lastSeenAt'; re: RegExp }> = [
  { field: 'registrationIp', re: /^(registration\s*ip|reg(?:istration)?\s*ip|signup\s*ip|ip\s*at\s*registration)$/i },
  { field: 'lastSeenIp', re: /^(last\s*seen\s*ip|last\s*ip|ip\s*last\s*seen|most\s*recent\s*ip|last\s*login\s*ip)$/i },
  { field: 'lastSeenAt', re: /^(last\s*seen|last\s*seen\s*at|last\s*online)$/i },
  { field: 'userId', re: /^(user\s*id|userid|uid|discord\s*id|account\s*id)$/i },
  { field: 'username', re: /^(username|user\s*name|handle)$/i },
  { field: 'displayName', re: /^(display\s*name|global\s*name|globalname)$/i },
  { field: 'email', re: /^(e-?mail|email\s*address)$/i },
  { field: 'phone', re: /^(phone|phone\s*number|mobile|telephone)$/i },
  { field: 'createdRaw', re: /^(created|created\s*at|creation\s*date|registration\s*date|account\s*created|registered|date\s*created)$/i },
];

export function isMappableIpAddress(value: string | null | undefined): boolean {
  if (!value || isNonIdentifier(value)) return false;
  const v = value.trim().toLowerCase();
  return v !== 'unknown' && v !== 'none' && v !== '-' && v !== '—' && v !== 'n/a';
}

export function parseDiscordUtcTimestamp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const found = raw.trim().match(TIMESTAMP_RE);
  const text = (found ? found[0] : raw).trim();
  if (!text) return null;
  if (/^\d{13}$/.test(text)) {
    const d = new Date(Number(text));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/^\d{10}$/.test(text)) {
    const d = new Date(Number(text) * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  let s = text.replace(/\s*UTC$/i, 'Z').replace(/\s*GMT$/i, 'Z').replace(/\s+/g, ' ');
  const m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/i);
  if (!m) {
    if (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
      const d = new Date(s.replace(' ', 'T'));
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  }
  const sec = m[6] || '00';
  const frac = m[7] ? `.${m[7].slice(0, 3).padEnd(3, '0')}` : '';
  let zone = m[8] || 'Z';
  if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${sec}${frac}${zone}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatDiscordUtc(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

/**
 * Wall time in a named zone. The offset comes from that zone's rules, including
 * daylight-saving changes. It is not a fixed number of hours.
 * The returned `utc` value is the same instant that was passed in.
 */
export function formatInstantInZone(iso: string, timeZone: string): { utc: string; zone: string; offsetMinutes: number; label: string } | null {
  const d = new Date(iso);
  if (isNaN(d.getTime()) || !timeZone) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
  } catch {
    return null;
  }
  const pick = (type: string) => parts.find(part => part.type === type)?.value || '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const hour = pick('hour');
  const minute = pick('minute');
  const second = pick('second');
  if (!year || !month || !day) return null;
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const offsetMinutes = Math.round((asUtc - d.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return {
    utc: d.toISOString(),
    zone: timeZone,
    offsetMinutes,
    label: `${year}-${month}-${day} ${hour}:${minute}:${second} UTC${sign}${hh}:${mm}`,
  };
}

function extractIpv4(line: string): string[] {
  const out: string[] = [];
  const re = new RegExp(IPV4.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) out.push(match[0]);
  return out;
}

function notFoundToken(line: string): string | null {
  const match = line.match(/\bnot found\b/i);
  return match ? match[0] : null;
}

function splitLabel(line: string): { label: string; value: string } | null {
  const match = line.match(/^([^:=\t|]{1,80}?)\s*[:=\t|]\s*(.*)$/);
  if (!match) return null;
  const label = match[1].trim();
  if (!label || /^\d/.test(label)) return null;
  return { label, value: match[2].trim() };
}

function profileField(label: string): (typeof PROFILE_FIELDS)[number]['field'] | null {
  const compact = label.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < PROFILE_FIELDS.length; i++) {
    if (PROFILE_FIELDS[i].re.test(compact)) return PROFILE_FIELDS[i].field;
  }
  return null;
}

function isHistoryHeading(line: string): boolean {
  const s = line.trim().toLowerCase().replace(/[:=\-|]+/g, ' ').replace(/\s+/g, ' ');
  return /^(ip address log|ip history|login history|login ip history|ip addresses|connection history|session history|recent ip addresses|ip log)$/.test(s);
}

function isColumnHeader(line: string): boolean {
  if (extractIpv4(line).length || notFoundToken(line)) return false;
  const l = line.toLowerCase();
  return /\bip\b|ip address/.test(l) && /time|date|timestamp/.test(l);
}

function isGenericIpLabel(label: string): boolean {
  return /^(ip|ip address|login ip|client ip|source ip)$/i.test(label.trim());
}

function isTimestampLabel(label: string): boolean {
  return /^(time|timestamp|date|datetime|seen at|logged at)$/i.test(label.trim());
}

function assignLiteral(extract: SessionExtract, label: string, value: string): void {
  extract.literals[label] = value.trim();
}

export function looksLikeDiscordSessionText(content: string): boolean {
  const lower = content.toLowerCase();
  if (lower.includes('user_account_updated_timestamp')) return false;
  const hasIdentity = /user\s*id|username|e-?mail|discord/.test(lower);
  const hasNetwork = /registration\s*ip|last\s*seen\s*ip|last\s*ip|ip address log|login history|ip history/.test(lower);
  return hasIdentity && hasNetwork;
}

export function parseDiscordSessionText(content: string): SessionExtract | null {
  if (!looksLikeDiscordSessionText(content)) return null;
  const extract: SessionExtract = { literals: {}, history: [] };
  const lines = content.split(/\r?\n/);
  let pending: { ip: string } | null = null;
  let genericIpCount = 0;

  const pushHistory = (ip: string, timestampRaw: string) => {
    const cleanIp = ip.trim();
    const cleanTs = timestampRaw.trim();
    if (!cleanIp || !cleanTs) return;
    extract.history.push({ ip: cleanIp, timestampRaw: cleanTs });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^[=\-_*#]{3,}$/.test(line)) continue;
    if (isHistoryHeading(line) || isColumnHeader(line)) {
      pending = null;
      continue;
    }

    const labeled = splitLabel(line);
    const timestamp = (line.match(TIMESTAMP_RE) || [])[0] || '';
    const ips = extractIpv4(line);
    const missing = notFoundToken(line);
    const field = labeled ? profileField(labeled.label) : null;

    if (labeled && field) {
      const value = labeled.value.trim();
      if (field === 'registrationIp' || field === 'lastSeenIp') {
        const ip = ips[0] || (isNotFoundLiteral(value) ? value : '');
        if (ip) extract[field] = ip;
        else if (value) assignLiteral(extract, field === 'registrationIp' ? 'Registration IP' : 'Last Seen IP', value);
        if (ip && timestamp) pushHistory(ip, timestamp);
      } else if (field === 'lastSeenAt') {
        extract.lastSeenRaw = timestamp || value;
      } else if (isNotFoundLiteral(value) || isNonIdentifier(value)) {
        const label = field === 'userId' ? 'User ID'
          : field === 'username' ? 'Username'
            : field === 'displayName' ? 'Display Name'
              : field === 'email' ? 'Email'
                : field === 'phone' ? 'Phone'
                  : 'Created';
        assignLiteral(extract, label, value);
      } else if (field === 'createdRaw') {
        extract.createdRaw = timestamp || value;
      } else if (field !== 'literals' && field !== 'history') {
        (extract as unknown as Record<string, string>)[field] = value;
      }
      pending = null;
      continue;
    }

    if (labeled && isGenericIpLabel(labeled.label) && (ips[0] || isNotFoundLiteral(labeled.value)) && !timestamp) {
      genericIpCount += 1;
      pending = { ip: ips[0] || labeled.value.trim() };
      continue;
    }

    if (pending && timestamp && (!labeled || isTimestampLabel(labeled.label))) {
      pushHistory(pending.ip, timestamp);
      pending = null;
      continue;
    }

    if ((ips[0] || missing) && timestamp) {
      pushHistory(ips[0] || missing || '', timestamp);
      pending = null;
    }
  }

  if (pending && genericIpCount === 1 && !extract.registrationIp) {
    extract.registrationIp = pending.ip;
  }
  return extract;
}

function ipKey(ip: string): string {
  return ip.trim().toLowerCase();
}

export function composeLoginActivity(input: {
  history: SessionHistoryRow[];
  registrationIp?: string;
  lastSeenIp?: string;
  createdRaw?: string;
  lastSeenRaw?: string;
}): DiscordLoginActivity[] {
  const rows: DiscordLoginActivity[] = [];
  const seen = new Set<string>();
  const push = (ip: string, timestampRaw: string | undefined, source: DiscordLoginActivity['source']) => {
    const clean = ip.trim();
    if (!clean) return;
    const parsed = timestampRaw ? parseDiscordUtcTimestamp(timestampRaw) : null;
    const label = parsed ? formatDiscordUtc(parsed) : (timestampRaw ? `${timestampRaw.trim()} (as recorded)` : '');
    const key = `${ipKey(clean)}|${parsed || label}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      ip: clean,
      timestampUtc: parsed || undefined,
      timestampLabel: label || 'Time not recorded',
      source,
    });
  };

  for (let i = 0; i < input.history.length; i++) {
    push(input.history[i].ip, input.history[i].timestampRaw, 'history');
  }

  const considerHeader = (ip: string | undefined, timestampRaw: string | undefined, source: DiscordLoginActivity['source']) => {
    if (!ip || !ip.trim() || isNotFoundLiteral(ip)) return;
    const parsed = timestampRaw ? parseDiscordUtcTimestamp(timestampRaw) : null;
    if (!parsed) return;
    const sameInstant = rows.some(row => ipKey(row.ip) === ipKey(ip) && row.timestampUtc === parsed);
    if (sameInstant) return;
    push(ip, timestampRaw, source);
  };

  considerHeader(input.registrationIp, input.createdRaw, 'registration');
  considerHeader(input.lastSeenIp, input.lastSeenRaw, 'last-seen');
  return rows;
}

function loginEventId(userId: string, row: DiscordLoginActivity, index: number): string {
  const ip = isNotFoundLiteral(row.ip) ? 'not-found' : row.ip;
  return `disc-login-${userId || 'acct'}-${row.timestampUtc || row.timestampLabel}-${ip}-${index}`;
}

export function loginEventsFor(account: AccountRecord, fileName: string): ForensicEvent[] {
  const rows = account.loginActivity || [];
  const events: ForensicEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mappable = isMappableIpAddress(row.ip);
    events.push({
      id: loginEventId(account.userId || account.username || '', row, i),
      timestamp: row.timestampUtc || row.timestampLabel,
      category: 'connection',
      sender: 'Discord Session',
      content: 'Discord session connection recorded',
      ipAddress: mappable ? row.ip : undefined,
      sourceFile: fileName,
      targetAccount: account.username || account.userId,
      details: {
        discord: true,
        loginActivity: true,
        ipLiteral: row.ip,
        timestampUtc: row.timestampUtc || '',
        timezone: 'UTC',
      },
    });
  }
  return events;
}

export function accountFromSession(extract: SessionExtract, fileName: string): { account: AccountRecord; events: ForensicEvent[] } {
  const loginActivity = composeLoginActivity(extract);
  const account: AccountRecord = {
    userId: extract.userId,
    username: extract.username,
    displayName: extract.displayName,
    email: extract.email,
    phone: extract.phone,
    createdDate: extract.createdRaw ? (parseDiscordUtcTimestamp(extract.createdRaw) || extract.createdRaw) : undefined,
    registrationIp: extract.registrationIp,
    lastSeenIp: extract.lastSeenIp,
    loginActivity: loginActivity.length ? loginActivity : undefined,
    sourceFile: fileName,
    provider: 'discord',
    otherDetails: {
      Source: 'Discord session file',
      'Source File': fileName,
      ...extract.literals,
    },
  };
  const events: ForensicEvent[] = [];
  if (extract.username || extract.userId || extract.email) {
    events.push({
      id: `disc-reg-${extract.userId || extract.username || fileName}`,
      timestamp: account.createdDate || 'Unknown',
      category: 'profile',
      sender: 'Discord System',
      content: `Account created for username: ${extract.username || 'N/A'} (ID: ${extract.userId || 'N/A'})`,
      ipAddress: isMappableIpAddress(extract.registrationIp) ? extract.registrationIp : undefined,
      sourceFile: fileName,
      details: { discord: true },
    });
  }
  const logins = loginEventsFor(account, fileName);
  for (let i = 0; i < logins.length; i++) events.push(logins[i]);
  return { account, events };
}

export function loginRowsFromJson(value: unknown): SessionHistoryRow[] {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const lists = [
    root.ip_history, root.login_history, root.loginHistory, root.IPHistory, root['Login History'], root['IP History'],
  ];
  const rows: SessionHistoryRow[] = [];
  for (let n = 0; n < lists.length; n++) {
    const list = lists[n];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const ip = String(rec.ip || rec.ip_address || rec.ipAddress || rec['IP Address'] || rec['IP'] || '').trim();
      const timestampRaw = String(rec.timestamp || rec.time || rec.Timestamp || rec.date || rec['Timestamp'] || '').trim();
      if (ip && timestampRaw) rows.push({ ip, timestampRaw });
    }
  }
  return rows;
}

function listField(other: Record<string, string>, key: string, value: string | undefined): void {
  if (!value) return;
  const parts = (other[key] || '').split('; ').filter(Boolean);
  if (!parts.includes(value)) parts.push(value);
  other[key] = parts.join('; ');
}

function preferField(current: string | undefined, incoming: string | undefined): string | undefined {
  const next = incoming?.trim();
  if (isNotFoundLiteral(current) && next && !isNonIdentifier(next)) return incoming;
  if ((current == null || current.trim() === '') && next) return incoming;
  return current;
}

function unionBy<T>(left: T[] | undefined, right: T[] | undefined, keyOf: (item: T) => string): T[] | undefined {
  const out: T[] = [];
  const seen = new Set<string>();
  const add = (item: T) => {
    const key = keyOf(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  (left || []).forEach(add);
  (right || []).forEach(add);
  return out.length ? out : undefined;
}

/** Merge two Discord reads of the same subscriber. Later data fills gaps and unions history. */
export function mergeDiscordAccountRecords(kept: AccountRecord, extra: AccountRecord): AccountRecord {
  const other: Record<string, string> = { ...(kept.otherDetails || {}) };
  const extraOther = extra.otherDetails || {};
  for (const [key, value] of Object.entries(extraOther)) {
    if (key === 'Source paths' || key === 'Additional source files') continue;
    const next = String(value ?? '').trim();
    const cur = other[key];
    if ((cur == null || cur.trim() === '') && next) other[key] = next;
  }
  listField(other, 'Additional source files', extra.sourceFile && extra.sourceFile !== kept.sourceFile ? extra.sourceFile : undefined);
  const keptPaths = (kept.otherDetails?.['Source paths'] || '').split('; ').filter(Boolean);
  const extraPaths = (extra.otherDetails?.['Source paths'] || '').split('; ').filter(Boolean);
  for (let i = 0; i < keptPaths.length; i++) listField(other, 'Source paths', keptPaths[i]);
  for (let i = 0; i < extraPaths.length; i++) listField(other, 'Source paths', extraPaths[i]);

  return {
    ...kept,
    userId: preferField(kept.userId, extra.userId),
    username: preferField(kept.username, extra.username),
    displayName: preferField(kept.displayName, extra.displayName),
    email: preferField(kept.email, extra.email),
    phone: preferField(kept.phone, extra.phone),
    createdDate: preferField(kept.createdDate, extra.createdDate),
    registrationIp: preferField(kept.registrationIp, extra.registrationIp),
    lastSeenIp: preferField(kept.lastSeenIp, extra.lastSeenIp),
    loginActivity: unionBy(kept.loginActivity, extra.loginActivity, row => `${ipKey(row.ip)}|${row.timestampUtc || row.timestampLabel}`),
    usernameHistory: unionBy(
      kept.usernameHistory,
      extra.usernameHistory,
      row => [row.timestampRaw, row.oldUsername, row.oldDiscriminator, row.newUsername, row.newDiscriminator, row.oldDisplayName, row.newDisplayName].join('|')
    ),
    deviceRecords: unionBy(
      kept.deviceRecords,
      extra.deviceRecords,
      row => [row.device, row.timestampUtc || '', row.timestampRaw || '', row.userId || ''].join('|')
    ),
    otherDetails: other,
    sourceFile: kept.sourceFile || extra.sourceFile,
  };
}

function isDiscord(account: AccountRecord): boolean {
  const provider = (account.provider || '').replace(/\s+/g, '').toLowerCase();
  if (provider === 'discord') return true;
  return (account.accountKey || '').toLowerCase().startsWith('discord::');
}

function subscriberId(account: AccountRecord): string {
  return account.userId == null ? '' : String(account.userId).trim();
}

function isReportOnly(account: AccountRecord): boolean {
  if (!isDiscord(account) || subscriberId(account)) return false;
  if (account.email && !isNonIdentifier(account.email)) return false;
  if (account.loginActivity && account.loginActivity.length) return false;
  if (account.registrationIp && !isNonIdentifier(account.registrationIp)) return false;
  return !!((account.usernameHistory && account.usernameHistory.length) || (account.deviceRecords && account.deviceRecords.length));
}

function nameSet(account: AccountRecord): Set<string> {
  const out = new Set<string>();
  const add = (value?: string) => {
    const v = (value || '').trim().toLowerCase();
    if (v && !isNonIdentifier(v)) out.add(v);
  };
  add(account.username);
  add(account.displayName);
  for (const row of account.usernameHistory || []) {
    add(row.oldUsername);
    add(row.newUsername);
    add(row.oldDisplayName);
    add(row.newDisplayName);
  }
  return out;
}

function namesOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const name of a) if (b.has(name)) return true;
  return false;
}

/**
 * Attach username-change and device reports onto the Discord subscriber.
 * A report with no user id is not a second person. It is copied onto a
 * matching subscriber, or onto the only subscriber in the return.
 * Device rows are not copied onto a second subscriber unless a user id
 * column names that subscriber.
 */
export function foldDiscordReportAccounts(accounts: readonly AccountRecord[]): AccountRecord[] {
  const subscribers = accounts.filter(account => isDiscord(account) && !!subscriberId(account));
  const next = accounts.map(account => ({ ...account }));
  const drop = new Set<number>();

  for (let i = 0; i < next.length; i++) {
    const report = next[i];
    if (!isReportOnly(report)) continue;
    const reportNames = nameSet(report);
    let historyTargets = subscribers.filter(account => namesOverlap(reportNames, nameSet(account)));
    if (!historyTargets.length && subscribers.length === 1 && report.usernameHistory?.length) {
      historyTargets = [subscribers[0]];
    }

    if (report.usernameHistory?.length && historyTargets.length) {
      for (let t = 0; t < historyTargets.length; t++) {
        const at = next.findIndex(account => subscriberId(account) !== '' && subscriberId(account) === subscriberId(historyTargets[t]));
        if (at < 0) continue;
        next[at] = mergeDiscordAccountRecords(next[at], {
          ...report,
          userId: next[at].userId,
          username: next[at].username || report.username,
          deviceRecords: undefined,
        });
        historyTargets[t] = next[at];
      }
    }

    const leftoverDevices: NonNullable<AccountRecord['deviceRecords']> = [];
    for (const row of report.deviceRecords || []) {
      const uid = (row.userId || '').trim();
      let target: AccountRecord | undefined;
      if (uid && !isNonIdentifier(uid)) {
        target = next.find(account => subscriberId(account) === uid);
      } else if (subscribers.length === 1) {
        target = next.find(account => subscriberId(account) === subscriberId(subscribers[0]));
      }
      if (!target) {
        leftoverDevices.push(row);
        continue;
      }
      const at = next.indexOf(target);
      if (at < 0) {
        leftoverDevices.push(row);
        continue;
      }
      next[at] = mergeDiscordAccountRecords(next[at], { deviceRecords: [row] });
    }

    const historyLeft = !(report.usernameHistory?.length) || historyTargets.length === 0;
    if (!leftoverDevices.length && !historyLeft) {
      drop.add(i);
      continue;
    }
    if (!leftoverDevices.length && report.usernameHistory?.length && historyTargets.length) {
      drop.add(i);
      continue;
    }
    next[i] = {
      ...report,
      usernameHistory: historyTargets.length ? undefined : report.usernameHistory,
      deviceRecords: leftoverDevices.length ? leftoverDevices : undefined,
    };
    if (!next[i].usernameHistory?.length && !next[i].deviceRecords?.length) drop.add(i);
  }

  return next.filter((_, idx) => !drop.has(idx));
}

/** Old and new Discord usernames for the existing shared-name search. Not an Exact identity link. */
export function profileSearchUsernames(account: AccountRecord): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value?: string) => {
    const v = (value || '').trim();
    if (!v || isNonIdentifier(v)) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  for (const row of account.usernameHistory || []) {
    add(row.oldUsername);
    add(row.newUsername);
  }
  return out;
}

export function discordAliasGroups(accounts: readonly AccountRecord[] | undefined, filter?: string): SubscriberAliasGroup[] {
  const groups: SubscriberAliasGroup[] = [];
  for (let i = 0; i < (accounts || []).length; i++) {
    const account = accounts![i];
    if (!isDiscord(account)) continue;
    if (filter && filter !== 'all') {
      const label = account.username || account.userId || account.displayName || account.accountKey || '';
      const matches = filter === label || filter === account.username || filter === account.userId || filter === account.accountKey || filter === account.displayName;
      if (!matches) continue;
    }
    const names: string[] = [];
    const seen = new Set<string>();
    const add = (value?: string) => {
      const v = (value || '').trim();
      if (!v || isNonIdentifier(v)) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      names.push(v);
    };
    add(account.username);
    add(account.displayName);
    add(account.userId);
    for (const row of account.usernameHistory || []) {
      add(row.oldUsername);
      add(row.newUsername);
      add(row.oldDisplayName);
      add(row.newDisplayName);
    }
    if (names.length) groups.push({ names });
  }
  return groups;
}

/**
 * Newest first. Equal timestamps keep the later source row first.
 * This is a presentation order for the subscriber card. The recorded
 * timestamps, including their UTC offsets, are not rewritten.
 */
export function usernameHistoryNewestFirst(rows: readonly DiscordUsernameChange[]): DiscordUsernameChange[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const ta = a.row.timestampUtc ? Date.parse(a.row.timestampUtc) : NaN;
    const tb = b.row.timestampUtc ? Date.parse(b.row.timestampUtc) : NaN;
    const aOk = !isNaN(ta);
    const bOk = !isNaN(tb);
    if (aOk && bOk && ta !== tb) return tb - ta;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return b.index - a.index;
  }).map(item => item.row);
}

export function formatDiscordHandle(username: string, discriminator: string): string {
  const user = username.trim();
  const disc = discriminator.trim();
  if (user && disc) return `${user}#${disc}`;
  return user || disc;
}
