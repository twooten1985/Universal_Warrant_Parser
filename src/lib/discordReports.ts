/**
 * Discord report files that sit beside the session file.
 *
 * reports/username_change.csv is tab-separated with these headers:
 * user_account_updated_timestamp, old_full_username, old_discriminator,
 * new_full_username, new_discriminator, old_display_name, new_display_name.
 * The timestamp is kept as recorded, including its UTC offset.
 *
 * reports/message_transaction_records is an Excel workbook. The device/client
 * column is chosen by header name first (device, client, platform, user_agent,
 * and the other names in DEVICE_HEADERS). Column 3 (1-based) is used only when
 * the file name is message_transaction_records, no device header exists, and
 * column 3's header is not a known non-device field such as message_id or
 * user_id. A shifted sheet that names the device column is never read from
 * column 3. There is no redacted header row in the repo; an unrecognized
 * header that is not in that denylist is treated as Tim's column 3 for this
 * known report only.
 *
 * Empty device cells do not become rows. Values are Discord-recorded
 * client/device info, not verified hardware.
 */

import type { AccountRecord, DiscordDeviceRecord, DiscordUsernameChange, ForensicEvent } from '../types';
import { isNonIdentifier } from '../identity/normalize';
import { formatDiscordUtc, parseDiscordUtcTimestamp, usernameHistoryNewestFirst } from './discordSession';

function splitDelimited(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const headerLine = cleaned.split(/\r?\n/).find(line => line.trim()) || '';
  const delimiter = headerLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const next = cleaned[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  if (current || row.length) {
    row.push(current.trim());
    if (row.some(cell => cell !== '')) rows.push(row);
  }
  return rows;
}

const USERNAME_HEADERS = [
  'user_account_updated_timestamp',
  'old_full_username',
  'old_discriminator',
  'new_full_username',
  'new_discriminator',
  'old_display_name',
  'new_display_name',
] as const;

const DEVICE_HEADERS = new Set([
  'device', 'devices', 'client', 'clients', 'client_type', 'device_type', 'platform',
  'user_agent', 'browser_user_agent', 'os', 'device_model', 'client_info', 'client_name',
  'phone_type', 'device_name', 'app_client', 'discord_client',
]);

const NON_DEVICE_HEADERS = new Set([
  'id', 'event_id', 'record_id', 'transaction_id', 'message_id', 'user_id', 'userid', 'uid',
  'username', 'user', 'email', 'ip', 'ip_address', 'timestamp', 'time', 'date', 'datetime',
  'created_at', 'occurred_at', 'event_time', 'event_timestamp', 'content', 'message',
  'channel', 'channel_id', 'guild', 'guild_id', 'event_type',
]);

const DATE_HEADERS = new Set([
  'timestamp', 'time', 'date', 'datetime', 'created_at', 'occurred_at', 'event_time',
  'event_timestamp', 'recorded_at', 'seen_at', 'date_time', 'user_account_updated_timestamp',
]);

const USER_ID_HEADERS = new Set(['user_id', 'userid', 'uid', 'discord_id']);

export function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\uFEFF]/g, '').replace(/[\s-]+/g, '_');
}

export function isKnownDeviceReport(name: string, relativePath?: string): boolean {
  const hay = `${name || ''} ${relativePath || ''}`.toLowerCase();
  return hay.includes('message_transaction_records');
}

export function isDeviceHeader(value: string): boolean {
  return DEVICE_HEADERS.has(normalizeHeader(value));
}

export function isNonDeviceHeader(value: string): boolean {
  return NON_DEVICE_HEADERS.has(normalizeHeader(value));
}

/**
 * Header name wins. Column 3 is only the known message_transaction_records
 * layout, and only when that column is not already a recognized non-device field.
 */
export function resolveDeviceColumn(headers: string[] | null, width: number, knownReport: boolean): number | null {
  if (headers) {
    for (let i = 0; i < headers.length; i++) {
      if (isDeviceHeader(headers[i] || '')) return i;
    }
  }
  if (!knownReport || width < 3) return null;
  if (headers && headers.length >= 3 && isNonDeviceHeader(headers[2] || '')) return null;
  return 2;
}

function headerIndex(headers: string[], names: Set<string>): number {
  for (let i = 0; i < headers.length; i++) {
    if (names.has(normalizeHeader(headers[i] || ''))) return i;
  }
  return -1;
}

function looksLikeHeader(row: string[]): boolean {
  return row.some(cell => {
    const name = normalizeHeader(cell);
    return DEVICE_HEADERS.has(name) || NON_DEVICE_HEADERS.has(name) || DATE_HEADERS.has(name) || USER_ID_HEADERS.has(name);
  });
}

export function parseUsernameChangeTable(content: string, fileName: string): DiscordUsernameChange[] | null {
  const rows = splitDelimited(content);
  if (rows.length < 2) return null;
  const headers = rows[0].map(normalizeHeader);
  for (let i = 0; i < USERNAME_HEADERS.length; i++) {
    if (!headers.includes(USERNAME_HEADERS[i])) return null;
  }
  const idx = (name: typeof USERNAME_HEADERS[number]) => headers.indexOf(name);
  const out: DiscordUsernameChange[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const change: DiscordUsernameChange = {
      timestampRaw: (row[idx('user_account_updated_timestamp')] || '').trim(),
      oldUsername: (row[idx('old_full_username')] || '').trim(),
      oldDiscriminator: (row[idx('old_discriminator')] || '').trim(),
      newUsername: (row[idx('new_full_username')] || '').trim(),
      newDiscriminator: (row[idx('new_discriminator')] || '').trim(),
      oldDisplayName: (row[idx('old_display_name')] || '').trim(),
      newDisplayName: (row[idx('new_display_name')] || '').trim(),
      sourceFile: fileName,
    };
    const hasName = change.oldUsername || change.newUsername || change.oldDisplayName || change.newDisplayName;
    if (!hasName) continue;
    change.timestampUtc = parseDiscordUtcTimestamp(change.timestampRaw) || undefined;
    out.push(change);
  }
  return out;
}

export function usernameEventsFor(rows: readonly DiscordUsernameChange[], fileName: string): ForensicEvent[] {
  const ordered = usernameHistoryNewestFirst(rows).slice().reverse();
  const events: ForensicEvent[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    events.push({
      id: `disc-name-${row.timestampRaw}-${row.oldUsername}-${row.newUsername}-${row.oldDisplayName}-${row.newDisplayName}`,
      timestamp: row.timestampUtc || row.timestampRaw || 'Unknown',
      category: 'profile',
      sender: 'Discord Account',
      content: `Discord subscriber name history: ${row.oldUsername || '—'} -> ${row.newUsername || '—'}`,
      sourceFile: fileName,
      details: {
        discord: true,
        usernameChange: true,
        timestampRaw: row.timestampRaw,
        oldUsername: row.oldUsername,
        newUsername: row.newUsername,
        oldDisplayName: row.oldDisplayName,
        newDisplayName: row.newDisplayName,
      },
    });
  }
  return events;
}

export function accountFromUsernameChanges(rows: DiscordUsernameChange[], fileName: string, relativePath?: string): AccountRecord {
  const newest = usernameHistoryNewestFirst(rows)[0];
  const source = relativePath || fileName;
  return {
    username: newest && !isNonIdentifier(newest.newUsername) ? newest.newUsername : undefined,
    displayName: newest && !isNonIdentifier(newest.newDisplayName) ? newest.newDisplayName : undefined,
    usernameHistory: rows.slice(),
    sourceFile: fileName,
    provider: 'discord',
    otherDetails: {
      Source: 'Discord username history',
      'Username history source': source,
      'Source File': fileName,
    },
  };
}

export function devicesFromGrid(rows: string[][], fileName: string, relativePath?: string): DiscordDeviceRecord[] {
  const knownReport = isKnownDeviceReport(fileName, relativePath);
  if (!rows.length) return [];
  let header: string[] | null = null;
  let start = 0;
  const scan = Math.min(rows.length, 6);
  for (let i = 0; i < scan; i++) {
    if (looksLikeHeader(rows[i] || [])) {
      header = rows[i];
      start = i + 1;
      break;
    }
  }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const deviceCol = resolveDeviceColumn(header, width, knownReport);
  if (deviceCol == null) return [];
  const dateCol = header ? headerIndex(header, DATE_HEADERS) : -1;
  const userCol = header ? headerIndex(header, USER_ID_HEADERS) : -1;
  const out: DiscordDeviceRecord[] = [];
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] || [];
    const device = (row[deviceCol] || '').trim();
    if (!device) continue;
    let timestampRaw = '';
    if (dateCol >= 0) timestampRaw = (row[dateCol] || '').trim();
    if (!timestampRaw) {
      for (let c = 0; c < row.length; c++) {
        if (c === deviceCol) continue;
        if (parseDiscordUtcTimestamp(row[c] || '')) {
          timestampRaw = (row[c] || '').trim();
          break;
        }
      }
    }
    const parsed = timestampRaw ? parseDiscordUtcTimestamp(timestampRaw) : null;
    const userId = userCol >= 0 ? (row[userCol] || '').trim() : '';
    out.push({
      device,
      timestampRaw: timestampRaw || undefined,
      timestampUtc: parsed || undefined,
      userId: userId && !isNonIdentifier(userId) ? userId : undefined,
      source: 'reports/message_transaction_records',
      sourceFile: fileName,
    });
  }
  return out;
}

export function deviceEventsFor(rows: readonly DiscordDeviceRecord[], fileName: string): ForensicEvent[] {
  const events: ForensicEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    events.push({
      id: `disc-device-${i}-${row.timestampUtc || row.timestampRaw || 'notime'}-${row.device}`,
      timestamp: row.timestampUtc || row.timestampRaw || 'Unknown',
      category: 'connection',
      sender: 'Discord Client',
      content: `Discord-recorded client/device: ${row.device}`,
      sourceFile: fileName,
      details: {
        discord: true,
        deviceRecord: true,
        device: row.device,
        recordedSource: row.source,
        timestampUtc: row.timestampUtc || '',
      },
    });
  }
  return events;
}

export function accountFromDevices(rows: DiscordDeviceRecord[], fileName: string): AccountRecord {
  return {
    deviceRecords: rows.slice(),
    sourceFile: fileName,
    provider: 'discord',
    otherDetails: {
      Source: 'Discord-recorded client/device info',
      'Device source': 'reports/message_transaction_records',
      'Source File': fileName,
    },
  };
}

export function formatDeviceWhen(row: DiscordDeviceRecord): string {
  if (row.timestampUtc) return formatDiscordUtc(row.timestampUtc);
  return row.timestampRaw || 'Time not recorded';
}
