/**
 * Dropbox file-activity CSV and user-metadata text.
 * Times stay in the UTC form Dropbox wrote. Nothing here invents a local clock.
 */
import type { AccountRecord, ForensicEvent } from '../types';
import { buildAccountKey } from '../identity';
import {
  categoryFromActivityName,
  dropboxCategoryLabel,
  isDropboxNoInformation,
  isDropboxUserReport,
  normalizeDropboxPath,
  type DropboxCategory,
} from './dropboxPath';

export const DROPBOX_NO_DATA = 'No data provided by Dropbox';

export interface DropboxActivityRow {
  time: string;
  actorUserId: string;
  action: string;
  sizeBytes: string;
  filePath: string;
  normalizedPath: string;
  category: DropboxCategory;
}

function noDataEvent(fileName: string, relativePath: string, label: string): ForensicEvent {
  return {
    id: `dropbox-nodata-${fileName}-${label}`,
    timestamp: 'Unknown',
    category: 'other',
    sender: 'Dropbox',
    content: DROPBOX_NO_DATA,
    sourceFile: fileName,
    details: {
      provider: 'dropbox',
      dropboxKind: 'no-data',
      dropboxNote: DROPBOX_NO_DATA,
      dropboxSection: label,
      relativePath,
      untimed: true,
    },
  };
}

export function parseDropboxActivityCsv(fileName: string, content: string, relativePath?: string): ForensicEvent[] {
  const rel = relativePath || fileName;
  const category = categoryFromActivityName(fileName);
  if (isDropboxNoInformation(content)) return [noDataEvent(fileName, rel, dropboxCategoryLabel(category))];
  const lines = String(content || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [noDataEvent(fileName, rel, dropboxCategoryLabel(category))];
  let start = 0;
  if (/time\/date/i.test(lines[0]) && /file path/i.test(lines[0])) start = 1;
  const events: ForensicEvent[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 5) continue;
    const time = cells[0].trim();
    const actor = cells[1].trim();
    const action = cells[2].trim();
    const size = cells[3].trim();
    const filePath = cells.slice(4).join(',').trim();
    if (!filePath || /^file path$/i.test(filePath)) continue;
    events.push({
      id: `dropbox-activity-${category}-${i}-${fileName}`,
      timestamp: time || 'Unknown',
      category: 'file',
      sender: actor || 'Dropbox',
      content: `${action || 'Activity'} ${filePath}`,
      sourceFile: fileName,
      details: {
        provider: 'dropbox',
        dropboxKind: 'file-activity',
        dropboxTime: time,
        dropboxAction: action,
        dropboxSize: size,
        dropboxFilePath: filePath,
        dropboxNormalizedPath: normalizeDropboxPath(filePath),
        dropboxCategory: category,
        dropboxCategoryLabel: dropboxCategoryLabel(category),
        relativePath: rel,
        untimed: !time,
      },
    });
  }
  if (!events.length) return [noDataEvent(fileName, rel, dropboxCategoryLabel(category))];
  return events;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const SECTION_NAMES = [
  'Basic Information',
  'Billing Activity',
  'Authentication Log',
  'Linked Computer Information',
  'Mobile Information',
];

function headingName(line: string): { name: string; rest: string } | null {
  const compact = line.replace(/\s+/g, ' ').trim();
  const lower = compact.toLowerCase();
  for (let i = 0; i < SECTION_NAMES.length; i++) {
    const name = SECTION_NAMES[i];
    const key = name.toLowerCase();
    if (lower === key) return { name, rest: '' };
    if (lower.startsWith(`${key} `) || lower.startsWith(`${key}:`)) {
      return { name, rest: compact.slice(name.length).replace(/^[:|\s]+/, '').trim() };
    }
  }
  return null;
}

function sectionLines(text: string): Map<string, string[]> {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const blocks = new Map<string, string[]>();
  let current = '';
  for (let i = 0; i < lines.length; i++) {
    const heading = headingName(lines[i]);
    if (heading) {
      current = heading.name;
      if (!blocks.has(current)) blocks.set(current, []);
      if (heading.rest) blocks.get(current)!.push(heading.rest);
      continue;
    }
    if (current) blocks.get(current)!.push(lines[i]);
  }
  return blocks;
}

function cellsOf(line: string): string[] {
  if (line.includes('|')) return line.split('|').map(cell => cell.trim()).filter(Boolean);
  return [line.trim()].filter(Boolean);
}

function labelKey(cell: string): string {
  const key = cell.replace(/:$/, '').trim().toLowerCase();
  if (key === 'user id') return 'User ID';
  if (key === 'full name') return 'Full Name';
  if (key === 'email' || key === 'email address') return 'Email Address';
  if (key === 'last ping' || key === 'last ping time/date' || key === 'last ping time') return 'Last Ping Time/Date';
  if (key === 'ip' || key === 'ip address') return 'IP Address';
  if (key === 'device model') return 'Device Model';
  if (key === 'device carrier' || key === 'carrier') return 'Device Carrier';
  if (key === 'computer name' || key === 'computer') return 'Computer Name';
  return '';
}

function readLabeled(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    const headers = cells.map(labelKey);
    if (cells.length > 1 && headers.some(Boolean) && !headers.every(Boolean)) {
      for (let c = 0; c < cells.length; c++) {
        if (!headers[c]) continue;
        const value = cells[c + 1];
        if (value && !labelKey(value)) out[headers[c]] = value;
      }
      continue;
    }
    if (cells.length > 1 && headers.every(Boolean)) {
      const values = cellsOf(lines[i + 1] || '');
      if (values.length && !values.every(value => labelKey(value))) {
        for (let c = 0; c < headers.length; c++) {
          if (headers[c] && values[c] && !labelKey(values[c])) out[headers[c]] = values[c];
        }
        i += 1;
        continue;
      }
    }
    const colon = lines[i].match(/^([^:]{2,40}):\s*(.+)$/);
    if (colon) {
      const key = labelKey(colon[1]);
      if (key) { out[key] = colon[2].trim(); continue; }
    }
    const key = cells.length === 1 ? labelKey(cells[0]) : '';
    const next = lines[i + 1] || '';
    if (key && next && !labelKey(next) && !headingName(next)) {
      out[key] = cellsOf(next)[0] || next;
      i += 1;
    }
  }
  return out;
}

function joinWrappedIp(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length && /:/.test(line) && /[0-9a-f:]$/i.test(line) && /^[:0-9a-f.]+$/i.test(lines[i + 1].replace(/\s/g, ''))) {
      line += lines[i + 1].replace(/\s/g, '');
      i++;
    }
    out.push(line);
  }
  return out;
}

const TIME_RE = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\s+UTC)?/;

function ipFromLine(line: string): string {
  const v4 = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (v4 && v4[0].split('.').every(part => Number(part) <= 255)) return v4[0];
  const tokens = line.split(/[\s,]+/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^\d{2}:\d{2}:\d{2}$/.test(token)) continue;
    const colons = token.match(/:/g) || [];
    if (colons.length >= 2 && /^[0-9a-f:]+$/i.test(token)) return token;
  }
  return '';
}

function parseNotice(fileName: string, relativePath: string, reason: string, excerpt: string): ForensicEvent {
  return {
    id: `dropbox-pdf-notice-${fileName}`,
    timestamp: 'Unknown',
    category: 'other',
    sender: 'Dropbox',
    content: reason,
    sourceFile: fileName,
    details: {
      provider: 'dropbox',
      dropboxKind: 'parse-notice',
      dropboxNote: reason,
      dropboxExcerpt: excerpt.slice(0, 240),
      relativePath,
      untimed: true,
    },
  };
}

function isHeaderLine(line: string): boolean {
  const cells = cellsOf(line).map(cell => cell.replace(/:$/, '').trim().toLowerCase());
  if (!cells.length) return false;
  return cells.every(cell => /^(timestamp|ip address|ip|computer name|computer|last ping(?: time(?:\/date)?)?|device model|device carrier|carrier)$/.test(cell));
}

export function parseDropboxUserText(fileName: string, text: string, relativePath?: string): { events: ForensicEvent[]; account?: AccountRecord } {
  const rel = relativePath || fileName;
  const raw = String(text || '').replace(/\u0000/g, '').trim();
  const blocks = sectionLines(raw);
  const events: ForensicEvent[] = [];
  const basicLines = blocks.get('Basic Information') || [];
  const basic = readLabeled(basicLines);
  const reportId = raw.match(/report for user\s+(\d{5,})/i)?.[1] || basicLines.join(' ').match(/\b(\d{5,})\b/)?.[1] || '';
  const userId = basic['User ID'] || reportId;
  const fullName = basic['Full Name'] || '';
  const email = basic['Email Address'] || raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const other: Record<string, string> = {};
  if (fullName) other['Full Name'] = fullName;
  if (email) other['Email Address'] = email;

  const billingLines = blocks.get('Billing Activity') || [];
  const billingText = billingLines.join('\n').trim();
  if (!blocks.has('Billing Activity')) {
    /* section absent: a partial report still imports */
  } else if (!billingText || isDropboxNoInformation(billingText)) {
    events.push(noDataEvent(fileName, rel, 'Billing Activity'));
  } else {
    other['Billing Activity'] = billingText.replace(/\s+/g, ' ').slice(0, 2000);
    events.push({
      id: `dropbox-billing-${fileName}`,
      timestamp: 'Unknown',
      category: 'other',
      sender: 'Dropbox',
      content: other['Billing Activity'],
      sourceFile: fileName,
      details: { provider: 'dropbox', dropboxKind: 'billing', dropboxSection: 'Billing Activity', relativePath: rel, untimed: true },
    });
  }

  const authLines = blocks.get('Authentication Log') || [];
  const authText = authLines.join('\n').trim();
  if (!blocks.has('Authentication Log')) {
    /* absent */
  } else if (!authText || isDropboxNoInformation(authText)) {
    events.push(noDataEvent(fileName, rel, 'Authentication Log'));
  } else {
    const lines = joinWrappedIp(authLines);
    for (let i = 0; i < lines.length; i++) {
      if (isHeaderLine(lines[i]) || /^timestamp\b/i.test(lines[i])) continue;
      const time = lines[i].match(TIME_RE)?.[0] || '';
      let ip = ipFromLine(lines[i]);
      if (time && !ip && i + 1 < lines.length && !lines[i + 1].match(TIME_RE)) {
        const nextIp = ipFromLine(lines[i + 1]);
        if (nextIp) { ip = nextIp; i += 1; }
      }
      if (!time && !ip) continue;
      events.push({
        id: `dropbox-auth-${i}-${fileName}`,
        timestamp: time || 'Unknown',
        category: 'connection',
        sender: 'Dropbox',
        content: `Authentication ${ip || 'no IP'}`,
        ipAddress: ip || undefined,
        sourceFile: fileName,
        details: {
          provider: 'dropbox',
          dropboxKind: 'auth-log',
          dropboxSection: 'Authentication Log',
          dropboxTime: time,
          untimed: !time,
          relativePath: rel,
        },
      });
    }
  }

  const computerLines = blocks.get('Linked Computer Information') || [];
  const computerText = computerLines.join('\n').trim();
  const computers: string[] = [];
  if (!blocks.has('Linked Computer Information')) {
    /* absent */
  } else if (!computerText || isDropboxNoInformation(computerText)) {
    events.push(noDataEvent(fileName, rel, 'Linked Computer Information'));
  } else {
    for (let i = 0; i < computerLines.length; i++) {
      if (isHeaderLine(computerLines[i]) || isDropboxNoInformation(computerLines[i])) continue;
      let name = '';
      const colon = computerLines[i].match(/^computer(?: name)?\s*:\s*(.+)$/i);
      if (colon) name = colon[1].trim();
      else if (labelKey(computerLines[i]) === 'Computer Name' && computerLines[i + 1]) {
        name = computerLines[i + 1].trim();
        i += 1;
      } else if (!labelKey(computerLines[i])) name = computerLines[i];
      if (!name) continue;
      computers.push(name);
      events.push({
        id: `dropbox-computer-${i}-${fileName}`,
        timestamp: 'Unknown',
        category: 'profile',
        sender: 'Dropbox',
        content: name,
        sourceFile: fileName,
        details: {
          provider: 'dropbox',
          dropboxKind: 'computer',
          dropboxSection: 'Linked Computer Information',
          deviceModel: name,
          relativePath: rel,
          untimed: true,
        },
      });
    }
    if (computers.length) other['Linked computers'] = computers.join('; ').slice(0, 2000);
  }

  const mobileLines = blocks.get('Mobile Information') || [];
  const mobileText = mobileLines.join('\n').trim();
  if (!blocks.has('Mobile Information')) {
    /* absent */
  } else if (!mobileText || isDropboxNoInformation(mobileText)) {
    events.push(noDataEvent(fileName, rel, 'Mobile Information'));
  } else {
    const joined = joinWrappedIp(mobileLines);
    const devices: Array<{ ping: string; ip: string; model: string; carrier: string }> = [];
    const pushDevice = (row: { ping?: string; ip?: string; model?: string; carrier?: string }) => {
      const ping = row.ping || '';
      const ip = row.ip || '';
      const model = row.model || '';
      const carrier = row.carrier || '';
      if (!ping && !ip && !model && !carrier) return;
      devices.push({ ping, ip, model, carrier });
    };
    for (let i = 0; i < joined.length; i++) {
      if (isHeaderLine(joined[i])) {
        const headers = cellsOf(joined[i]).map(labelKey);
        const values = cellsOf(joined[i + 1] || '');
        if (headers.length > 1 && values.length && !values.every(value => labelKey(value))) {
          const row: { ping?: string; ip?: string; model?: string; carrier?: string } = {};
          for (let c = 0; c < headers.length; c++) {
            if (headers[c] === 'Last Ping Time/Date') row.ping = values[c] || '';
            if (headers[c] === 'IP Address') row.ip = values[c] || '';
            if (headers[c] === 'Device Model') row.model = values[c] || '';
            if (headers[c] === 'Device Carrier') row.carrier = values[c] || '';
          }
          pushDevice(row);
          i += 1;
        }
        continue;
      }
      const labeled = readLabeled(joined.slice(i));
      if (labeled['Last Ping Time/Date'] || labeled['IP Address'] || labeled['Device Model'] || labeled['Device Carrier']) {
        pushDevice({
          ping: labeled['Last Ping Time/Date'],
          ip: labeled['IP Address'] || ipFromLine(joined.slice(i).join(' ')),
          model: labeled['Device Model'],
          carrier: labeled['Device Carrier'],
        });
        break;
      }
    }
    devices.forEach((device, index) => {
      if (index === 0) {
        if (device.ping) other['Mobile last ping'] = device.ping;
        if (device.ip) other['Mobile IP'] = device.ip;
        if (device.model) other['Device model'] = device.model;
        if (device.carrier) other['Device carrier'] = device.carrier;
      }
      if (!device.ip && !device.model) return;
      events.push({
        id: `dropbox-mobile-${index}-${fileName}`,
        timestamp: device.ping || 'Unknown',
        category: 'connection',
        sender: 'Dropbox',
        content: `Mobile ${device.model || 'device'} ${device.ip}`.trim(),
        ipAddress: device.ip || undefined,
        sourceFile: fileName,
        details: {
          provider: 'dropbox',
          dropboxKind: 'mobile',
          dropboxSection: 'Mobile Information',
          dropboxTime: device.ping,
          deviceModel: device.model,
          deviceCarrier: device.carrier,
          untimed: !device.ping,
          relativePath: rel,
        },
      });
    });
  }

  const recognized = blocks.size > 0 || !!(userId || email || fullName);
  if (!recognized) {
    const reason = raw
      ? 'Text was read from this PDF, but it did not include Basic Information, an authentication log, or a Dropbox user id.'
      : 'No text could be read from this PDF. The words may be stored in a compressed stream, or the file may be a scan. The PDF is still in the return.';
    events.unshift(parseNotice(fileName, rel, reason, raw));
  }

  const account: AccountRecord | undefined = userId || email || fullName
    ? {
        userId: userId || undefined,
        username: fullName || userId || undefined,
        displayName: fullName || undefined,
        email: email || undefined,
        provider: 'dropbox',
        sourceFile: fileName,
        accountKey: buildAccountKey('dropbox', userId, fullName, email),
        otherDetails: other,
      }
    : undefined;
  return { events, account };
}

export function parseDropboxContent(fileName: string, content: string, relativePath?: string): { events: ForensicEvent[]; account?: AccountRecord } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    return { events: parseDropboxActivityCsv(fileName, content, relativePath) };
  }
  if (lower.endsWith('.pdf') || lower.endsWith('.txt') || isDropboxUserReport(fileName) || /report for user/i.test(content)) {
    return parseDropboxUserText(fileName, content, relativePath);
  }
  return { events: [] };
}
