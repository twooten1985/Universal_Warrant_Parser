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

function sectionBlocks(text: string): Map<string, string> {
  const names = [
    'Basic Information',
    'Billing Activity',
    'Authentication Log',
    'Linked Computer Information',
    'Mobile Information',
  ];
  const marks: Array<{ name: string; at: number }> = [];
  for (let i = 0; i < names.length; i++) {
    const at = text.search(new RegExp(names[i].replace(/ /g, '\\s+'), 'i'));
    if (at >= 0) marks.push({ name: names[i], at });
  }
  marks.sort((a, b) => a.at - b.at);
  const blocks = new Map<string, string>();
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].at + marks[i].name.length;
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    blocks.set(marks[i].name, text.slice(start, end).trim());
  }
  return blocks;
}

function field(block: string, label: string): string {
  const match = block.match(new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^\\n]+)`, 'i'));
  return match ? match[1].trim() : '';
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

export function parseDropboxUserText(fileName: string, text: string, relativePath?: string): { events: ForensicEvent[]; account?: AccountRecord } {
  const rel = relativePath || fileName;
  const raw = String(text || '').replace(/\u0000/g, '');
  const reportId = raw.match(/report for user\s+(\d{5,})/i)?.[1] || '';
  const blocks = sectionBlocks(raw);
  const events: ForensicEvent[] = [];
  const basic = blocks.get('Basic Information') || '';
  const userId = field(basic, 'User ID') || reportId;
  const fullName = field(basic, 'Full Name');
  const email = field(basic, 'Email Address');
  const other: Record<string, string> = {};
  if (fullName) other['Full Name'] = fullName;
  if (email) other['Email Address'] = email;

  const billing = blocks.get('Billing Activity') || '';
  if (!billing || isDropboxNoInformation(billing)) {
    events.push(noDataEvent(fileName, rel, 'Billing Activity'));
  } else {
    other['Billing Activity'] = billing.replace(/\s+/g, ' ').slice(0, 2000);
  }

  const auth = blocks.get('Authentication Log') || '';
  if (!auth || isDropboxNoInformation(auth)) {
    events.push(noDataEvent(fileName, rel, 'Authentication Log'));
  } else {
    const lines = joinWrappedIp(auth.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    for (let i = 0; i < lines.length; i++) {
      const time = lines[i].match(TIME_RE)?.[0] || '';
      let ip = ipFromLine(lines[i]);
      if (time && !ip && i + 1 < lines.length) ip = ipFromLine(lines[i + 1]);
      if (!time && !ip) continue;
      if (/^timestamp/i.test(lines[i])) continue;
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
          dropboxTime: time,
          untimed: !time,
          relativePath: rel,
        },
      });
    }
  }

  const computers = blocks.get('Linked Computer Information') || '';
  if (!computers || isDropboxNoInformation(computers)) {
    events.push(noDataEvent(fileName, rel, 'Linked Computer Information'));
  } else {
    other['Linked computers'] = computers.replace(/\s+/g, ' ').slice(0, 2000);
  }

  const mobile = blocks.get('Mobile Information') || '';
  if (!mobile || isDropboxNoInformation(mobile)) {
    events.push(noDataEvent(fileName, rel, 'Mobile Information'));
  } else {
    const joined = joinWrappedIp(mobile.split(/\r?\n/).map(line => line.trim()).filter(Boolean)).join('\n');
    const ping = field(joined, 'Last Ping Time/Date') || joined.match(TIME_RE)?.[0] || '';
    const ip = field(joined, 'IP Address') || ipFromLine(joined);
    const model = field(joined, 'Device Model');
    const carrier = field(joined, 'Device Carrier');
    if (ping) other['Mobile last ping'] = ping;
    if (ip) other['Mobile IP'] = ip;
    if (model) other['Device model'] = model;
    if (carrier) other['Device carrier'] = carrier;
    if (ip) {
      events.push({
        id: `dropbox-mobile-${fileName}`,
        timestamp: ping || 'Unknown',
        category: 'connection',
        sender: 'Dropbox',
        content: `Mobile ${model || 'device'} ${ip}`,
        ipAddress: ip,
        sourceFile: fileName,
        details: {
          provider: 'dropbox',
          dropboxKind: 'mobile',
          dropboxTime: ping,
          deviceModel: model,
          deviceCarrier: carrier,
          untimed: !ping,
          relativePath: rel,
        },
      });
    }
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
  if (lower.endsWith('.pdf') || lower.endsWith('.txt') || /user-metadata/i.test(fileName) || /report for user/i.test(content)) {
    return parseDropboxUserText(fileName, content, relativePath);
  }
  return { events: [] };
}
