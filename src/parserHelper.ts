/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderType, ForensicEvent, ParseResult } from './types';
import { buildAccountKey } from './identity';

// Helper to parse standard CSV formatted string safely, honoring quotes and escaping
export function parseCSV(text: string, customDelimiter?: string): string[][] {
  // Detect delimiter if not explicitly provided (e.g. Tab-separated Kik warrant returns vs Comma-separated Snapchat returns)
  let delimiter = customDelimiter;
  if (!delimiter) {
    const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0) || '';
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;

    if (tabCount > commaCount && tabCount >= semicolonCount) {
      delimiter = '\t';
    } else if (semicolonCount > commaCount && semicolonCount > tabCount) {
      delimiter = ';';
    } else {
      delimiter = ',';
    }
  }

  const result: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let currentValue = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentValue += '"';
        i++; // skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(currentValue.trim());
      currentValue = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip \n
      }
      row.push(currentValue.trim());
      result.push(row);
      row = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  // Push final pieces if anything remains
  if (currentValue || row.length > 0) {
    row.push(currentValue.trim());
    result.push(row);
  }

  // Filter out any completely empty rows
  return result.filter(r => r.length > 0 && r.some(val => val !== ''));
}

// Convert CSV headers to indices mapping
function getHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, idx) => {
    // Strip BOM (\uFEFF), control chars, quotes, spaces, underscores, hyphens
    const cleanKey = h.toLowerCase().trim().replace(/[\uFEFF\u0000-\u001F'"`_\-\s]/g, '');
    if (cleanKey) {
      map[cleanKey] = idx;
    }
  });
  return map;
}

function findCol(hMap: Record<string, number>, ...aliases: string[]): number | undefined {
  for (const a of aliases) {
    const key = a.toLowerCase().replace(/[\uFEFF\u0000-\u001F'"`_\-\s]/g, '');
    if (hMap[key] !== undefined) return hMap[key];
  }
  return undefined;
}


/** Parse MEGA LE epoch (seconds or ms). Returns null if not a real timestamp — never invent. */
function parseMegaEpoch(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  let n: number;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    n = val;
  } else {
    const s = String(val).trim();
    if (!s || /^unknown$/i.test(s)) return null;
    // Already human UTC from a prior pass — not an epoch
    if (/^\d{4}-\d{2}-\d{2}/.test(s) && /UTC|Z|[+-]\d{2}/i.test(s)) return null;
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s);
    if (!Number.isFinite(n)) return null;
  }
  // Heuristic: ms vs seconds (same as standalone MEGA Parser)
  if (n >= 1e12) return Math.floor(n / 1000);
  if (n >= 1e9) return Math.floor(n);
  if (n >= 0 && n < 1e9) return Math.floor(n); // early epochs still valid
  return null;
}

/** Format MEGA time as YYYY-MM-DD HH:MM:SS UTC; null if no real epoch (do not invent). */
function formatMegaUtc(val: unknown): string | null {
  const epoch = parseMegaEpoch(val);
  if (epoch === null) return null;
  const d = new Date(epoch * 1000);
  if (isNaN(d.getTime())) return null;
  const pad = (x: number) => String(x).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

function humanizeMegaBytes(val: unknown): string {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n) || n < 0) return String(val ?? '');
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Sort key for events — prefers details.sortEpoch, then MEGA UTC string, then Date parse. */
function eventSortMs(evt: ForensicEvent): number {
  const raw = evt.details?.sortEpoch ?? evt.details?.epoch;
  if (raw !== undefined && raw !== null && raw !== '') {
    const e = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(e)) return e >= 1e12 ? e : e * 1000;
  }
  const t = evt.timestamp;
  if (!t || t === 'Unknown') return Number.POSITIVE_INFINITY;
  const m = String(t).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) {
    const ms = Date.parse(`${m[1]}T${m[2]}Z`);
    if (!isNaN(ms)) return ms;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
}

// Parse timestamp string into ISO or clean formatted date
export function cleanTimestamp(ts: string | number | undefined | null): string {
  if (ts === undefined || ts === null || ts === '') return 'Unknown';
  // Numbers (epoch ms) — only if caller passed a real timestamp, never Date.now() invent
  if (typeof ts === 'number') {
    if (!Number.isFinite(ts)) return 'Unknown';
    const dNum = new Date(ts);
    return !isNaN(dNum.getTime()) ? dNum.toISOString() : 'Unknown';
  }
  const trimmed = String(ts).trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return 'Unknown';
  // Try normal parsing — include common US zone abbreviations seen in Kik returns
  const cleanTs = trimmed
    .replace(/\bUTC\b/gi, 'Z')
    .replace(/\bEST\b/g, '-05:00')
    .replace(/\bEDT\b/g, '-04:00')
    .replace(/\bPST\b/g, '-08:00')
    .replace(/\bPDT\b/g, '-07:00')
    .replace(/\bCST\b/g, '-06:00')
    .replace(/\bCDT\b/g, '-05:00')
    .replace(/\bMST\b/g, '-07:00')
    .replace(/\bMDT\b/g, '-06:00');
  const d = new Date(cleanTs);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  return trimmed; // Fallback: keep original text rather than inventing a date
}

// Decodes b~ base64 encoded Snapchat media ID inside CSV returns
export function decodeMediaId(rawMediaId: string | undefined): string | null {
  if (!rawMediaId) return null;
  const s = rawMediaId.trim();
  if (!s) return null;

  if (s.startsWith('b~')) {
    let b64Part = s.substring(2);
    // Padding
    const padNeeded = (4 - (b64Part.length % 4)) % 4;
    if (padNeeded > 0 && padNeeded < 4) {
      b64Part += '='.repeat(padNeeded);
    }
    try {
      // Decode base64 URL safe style
      const base64Str = b64Part.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(base64Str);
      const safeChars = /[a-zA-Z0-9_\-\+\/]/;
      let best = '';
      let current = '';
      for (let i = 0; i < decoded.length; i++) {
        const c = decoded[i];
        if (safeChars.test(c)) {
          current += c;
        } else {
          if (current.length > best.length) {
            best = current;
          }
          current = '';
        }
      }
      if (current.length > best.length) {
        best = current;
      }
      return best.length >= 8 ? best : null;
    } catch (e) {
      return null;
    }
  } else {
    return s.length >= 4 ? s : null;
  }
}

export function cleanTwitterJson(text: string): string {
  const trimmed = text.trim();
  // Match things like `window.YTD.direct_message.part0 = ` or `window.YTD.tweet.part0 =` or any JS assignment
  const assignmentMatch = trimmed.match(/^window\.YTD\.[a-zA-Z0-9_.]+\s*=\s*/);
  if (assignmentMatch) {
    return trimmed.substring(assignmentMatch[0].length);
  }
  return trimmed;
}


/** Kik LE returns often ship subscriber-data-<username>.pdf in the root folder. */
export function kikUsernameFromSubscriberPdfName(fileName: string): string | undefined {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  const m = base.match(/^subscriber-data-(.+)\.pdf$/i);
  if (!m) return undefined;
  const raw = m[1].trim();
  if (!raw || /^username$/i.test(raw)) return undefined;
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/**
 * Lightweight PDF string harvest for LE subscriber PDFs (no pdf.js dependency).
 * Pulls printable strings from literal (...) and hex <...> PDF objects.
 */
export function extractTextFromPdfContent(content: string): string {
  if (!content) return '';
  try {
    // Already-extracted / plain text path
    if (!content.startsWith('%PDF') && content.toLowerCase().includes('username')) {
      return content.length > 200000 ? content.slice(0, 200000) : content;
    }
    // Cap scan window so large LE PDFs cannot freeze the UI thread
    const scan = content.length > 2000000 ? content.slice(0, 2000000) : content;
    const chunks: string[] = [];
    // Avoid catastrophic backtracking: limit body length inside (...) 
    const litRe = /\((?:\\.|[^\\\n)]{0,500})\)/g;
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = litRe.exec(scan)) !== null) {
      if (++guard > 20000) break;
      let s = match[0].slice(1, -1);
      s = s
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (/[\x20-\x7E]{3,}/.test(s)) chunks.push(s);
      if (chunks.join('\n').length > 200000) break;
    }
    const hexRe = /<([0-9A-Fa-f\s]{6,512})>/g;
    guard = 0;
    while ((match = hexRe.exec(scan)) !== null) {
      if (++guard > 5000) break;
      const hex = match[1].replace(/\s+/g, '');
      if (hex.length < 6 || hex.length % 2 !== 0) continue;
      let out = '';
      for (let i = 0; i < hex.length; i += 2) {
        const code = parseInt(hex.slice(i, i + 2), 16);
        if (code >= 32 && code <= 126) out += String.fromCharCode(code);
        else if (code === 10 || code === 13) out += '\n';
      }
      if (out.trim().length >= 3) chunks.push(out);
    }
    const joined = chunks.join('\n');
    return joined.length > 200000 ? joined.slice(0, 200000) : joined;
  } catch {
    return '';
  }
}

function parseKikSubscriberFields(text: string, fileName: string): NonNullable<ParseResult['accountInfo']> | undefined {
  const fromName = kikUsernameFromSubscriberPdfName(fileName);
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const info: Record<string, string> = {};

  const labelAliases: Array<[string, RegExp]> = [
    ['Username', /^(username|kik\s*username|user\s*name|account\s*name)\s*[:#-]/i],
    ['Display Name', /^(display\s*name|first\s*name|full\s*name|name)\s*[:#-]/i],
    ['Email', /^(e-?mail|email\s*address)\s*[:#-]/i],
    ['Phone', /^(phone|phone\s*number|mobile|associated\s*phone)\s*[:#-]/i],
    ['Created Date', /^(created|created\s*date|registration\s*date|date\s*created|account\s*created)\s*[:#-]/i],
    ['Registration IP', /^(registration\s*ip|reg\s*ip|signup\s*ip|ip\s*address)\s*[:#-]/i],
    ['User ID', /^(user\s*id|userid|uid|account\s*id|kik\s*id)\s*[:#-]/i],
  ];

  for (const line of lines) {
    for (const [key, re] of labelAliases) {
      if (info[key]) continue;
      const lm = line.match(re);
      if (lm) {
        const val = line.slice(lm[0].length).trim().replace(/^[:\-#\s]+/, '');
        if (val) info[key] = val;
      }
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9 /_]{1,40})\s*[:=#]\s*(.+)$/);
    if (kv) {
      const k = kv[1].trim().toLowerCase();
      const v = kv[2].trim();
      if (!v) continue;
      if (!info['Username'] && /user\s*name|username/.test(k)) info['Username'] = v;
      if (!info['Email'] && /e-?mail/.test(k)) info['Email'] = v;
      if (!info['Phone'] && /phone|mobile/.test(k)) info['Phone'] = v;
      if (!info['Display Name'] && /(display|full name|^name$)/.test(k)) info['Display Name'] = v;
      if (!info['Created Date'] && /created|registration date/.test(k)) info['Created Date'] = v;
      if (!info['Registration IP'] && /(registration ip|^ip$|ip address)/.test(k)) info['Registration IP'] = v;
      if (!info['User ID'] && /(user id|userid|uid|account id)/.test(k)) info['User ID'] = v;
    }
  }

  if (!info['Email']) {
    const em = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (em) info['Email'] = em[0];
  }
  if (!info['Phone']) {
    const ph = text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/);
    if (ph) info['Phone'] = ph[0];
  }

  const username = info['Username'] || fromName;
  if (!username && !info['Email'] && !info['User ID']) return undefined;

  // Prefer PDF-body Username over filename when both exist (username already prefers info['Username'])
  return {
    userId: info['User ID'] || username,
    username: username,
    displayName: info['Display Name'],
    email: info['Email'],
    phone: info['Phone'],
    createdDate: info['Created Date'] ? cleanTimestamp(info['Created Date']) : undefined,
    registrationIp: info['Registration IP'],
    sourceFile: fileName,
    provider: 'kik',
    otherDetails: {
      ...info,
      'Source': 'Kik subscriber-data PDF',
      'Source File': fileName,
      ...(fromName && !info['Username'] ? { 'Username (from filename)': fromName } : {}),
      ...(info['Username'] && fromName && info['Username'] !== fromName
        ? { 'Filename username': fromName }
        : {}),
    },
  };
}

export function parseForensicFile(
  provider: ProviderType,
  fileName: string,
  content: string,
  relativePath?: string
): ParseResult {
  const lowercaseName = fileName.toLowerCase();
  
  // Guard: return empty result if the file is a media asset or non-data file
  // Exception: Kik subscriber-data-<username>.pdf is account identity, not media.
  const isKikSubscriberPdf =
    provider === 'kik' &&
    ((lowercaseName.startsWith('subscriber-data-') && lowercaseName.endsWith('.pdf')) ||
      !!kikUsernameFromSubscriberPdfName(fileName));

  const isMediaFile = lowercaseName.endsWith('.jpg') || 
                      lowercaseName.endsWith('.jpeg') || 
                      lowercaseName.endsWith('.png') || 
                      lowercaseName.endsWith('.gif') || 
                      lowercaseName.endsWith('.mp4') || 
                      lowercaseName.endsWith('.mov') ||
                      (lowercaseName.endsWith('.pdf') && !isKikSubscriberPdf) ||
                      content.trim().startsWith('[Simulated') ||
                      content.trim().startsWith('data:image/');

  if (isMediaFile) {
    return {
      provider,
      events: [],
      summaryStats: {
        totalEvents: 0,
        messagesCount: 0,
        connectionsCount: 0,
        filesCount: 0,
        callsCount: 0,
        uniqueIPs: [],
        dateRange: null
      }
    };
  }

  const events: ForensicEvent[] = [];
  let accountInfo: ParseResult['accountInfo'] = undefined;

  // Determine target account username from relative path if available
  let fileTargetAccount = 'Unknown';
  if (relativePath) {
    const parts = relativePath.split('/');
    if (parts.length > 1) {
      const possibleUser = parts[0].trim();
      const ignoredFolders = ['json', 'html', 'csv', 'documents', 'files', 'media', 'uploads', 'warrant_return', 'chat', 'chats', 'messages'];
      if (possibleUser && !ignoredFolders.includes(possibleUser.toLowerCase())) {
        fileTargetAccount = possibleUser;
      }
    }
  }

  // Let's implement individual parsers for each combination
  if (provider === 'discord') {
    if (lowercaseName.endsWith('.json') || content.trim().startsWith('{')) {
      try {
        const data = JSON.parse(content);
        if (data.username || data.id || data.email) {
          accountInfo = {
            userId: data.id,
            username: data.username,
            displayName: data.global_name || data.username,
            email: data.email,
            phone: data.phone,
            createdDate: cleanTimestamp(data.created_at),
            registrationIp: data.registration_ip,
            otherDetails: {
              'MFA Enabled': data.mfa_enabled ? 'Yes' : 'No',
              'Verified': data.verified ? 'Yes' : 'No',
              'Flags': String(data.flags || '')
            }
          };
          // Insert a registration event
          events.push({
            id: `disc-reg-${Date.now()}`,
            timestamp: cleanTimestamp(data.created_at),
            category: 'profile',
            sender: 'Discord System',
            content: `Account created for username: ${data.username} (ID: ${data.id})`,
            ipAddress: data.registration_ip,
            sourceFile: fileName
          });
        }
      } catch (e) {
        console.error("Failed to parse Discord JSON:", e);
      }
    } else {
      // It's CSV or TXT
      const rows = parseCSV(content);
      if (rows.length > 1) {
        const headers = rows[0];
        const hMap = getHeaderMap(headers);

        // Check file type based on headers
        const isIpHistory = headers.some(h => h.toLowerCase().includes('ip_address') || h.toLowerCase().includes('ipaddress'));
        const isMessages = headers.some(h => h.toLowerCase().includes('channel_id') || h.toLowerCase().includes('content'));

        if (isIpHistory) {
          // IP history format: timestamp, ip_address, event
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const tsVal = row[hMap['timestamp'] || hMap['time'] || 0];
            const ipVal = row[hMap['ipaddress'] || hMap['ip_address'] || hMap['ip'] || 1];
            const eventVal = row[hMap['event'] || hMap['action'] || 2] || 'Connection login';

            if (tsVal && ipVal) {
              events.push({
                id: `disc-ip-${i}-${Date.now()}`,
                timestamp: cleanTimestamp(tsVal),
                category: 'connection',
                sender: 'User Session',
                content: `IP Connection registered: ${eventVal}`,
                ipAddress: ipVal,
                sourceFile: fileName
              });
            }
          }
        } else if (isMessages) {
          // Messages CSV format: channel_id, message_id, timestamp, author_id, author_username, content, attachments
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const chanId = row[hMap['channelid'] || 0] || 'Unknown Channel';
            const msgId = row[hMap['messageid'] || 1] || `${i}`;
            const tsVal = row[hMap['timestamp'] || hMap['time'] || 2];
            const authorId = row[hMap['authorid'] || 3] || 'System';
            const authorUser = row[hMap['authorusername'] || hMap['username'] || hMap['author'] || 4] || 'User';
            const textVal = row[hMap['content'] || hMap['body'] || hMap['message'] || 5] || '';
            const attachVal = row[hMap['attachments'] || hMap['attachment'] || 6] || '';

            if (tsVal) {
              events.push({
                id: `disc-msg-${msgId}-${i}`,
                timestamp: cleanTimestamp(tsVal),
                category: 'message',
                sender: `${authorUser} (${authorId})`,
                content: textVal,
                details: {
                  channelId: chanId,
                  messageId: msgId,
                  attachments: attachVal || undefined
                },
                sourceFile: fileName
              });
            }
          }
        } else {
          // Catch-all generic CSV parser
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const tsVal = row[0];
            const desc = row.slice(1).join(' | ');
            if (tsVal) {
              events.push({
                id: `disc-gen-${i}`,
                timestamp: cleanTimestamp(tsVal),
                category: 'other',
                sender: 'Discord Return',
                content: desc,
                sourceFile: fileName
              });
            }
          }
        }
      }
    }
  }

  else if (provider === 'snapchat') {
    // Skip simulated media files, binaries and non-data assets
    const isMedia = lowercaseName.endsWith('.jpg') || 
                    lowercaseName.endsWith('.jpeg') || 
                    lowercaseName.endsWith('.png') || 
                    lowercaseName.endsWith('.gif') || 
                    lowercaseName.endsWith('.mp4') || 
                    lowercaseName.endsWith('.mov') ||
                    lowercaseName.endsWith('.pdf') ||
                    content.trim().startsWith('[Simulated');

    if (isMedia) {
      return {
        provider,
        events: [],
        summaryStats: {
          totalEvents: 0,
          messagesCount: 0,
          connectionsCount: 0,
          filesCount: 0,
          callsCount: 0,
          uniqueIPs: [],
          dateRange: null
        }
      };
    }

    const isCSV = lowercaseName.endsWith('.csv') || (!content.trim().startsWith('{') && !content.trim().startsWith('['));
    if (isCSV) {
      if (lowercaseName.includes('geolocation')) {
        try {
          const lines = content.split(/\r?\n/);
          let headerLineIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            const lowerLine = lines[i].toLowerCase();
            if ((lowerLine.includes('lat') || lowerLine.includes('latitude')) && 
                (lowerLine.includes('lon') || lowerLine.includes('lng') || lowerLine.includes('longitude'))) {
              headerLineIdx = i;
              break;
            }
          }

          if (headerLineIdx !== -1) {
            const dataBody = lines.slice(headerLineIdx).join('\n');
            const rows = parseCSV(dataBody);
            if (rows.length > 1) {
              const headers = rows[0].map(h => h.toLowerCase().trim());
              
              const tsIdx = headers.findIndex(h => h.includes('time') || h.includes('date') || h.includes('stamp'));
              const latIdx = headers.findIndex(h => h === 'lat' || h.includes('latitude'));
              const lonIdx = headers.findIndex(h => h === 'lon' || h === 'lng' || h.includes('longitude'));
              const accIdx = headers.findIndex(h => h.includes('accuracy') || h.includes('radius'));
              const srcIdx = headers.findIndex(h => h.includes('source') || h.includes('event') || h.includes('type'));

              for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0 || row.join('').trim() === '') continue;

                const timestamp = tsIdx !== -1 ? row[tsIdx] : '';
                const lat = latIdx !== -1 ? row[latIdx] : '';
                const lon = lonIdx !== -1 ? row[lonIdx] : '';
                const accuracy = accIdx !== -1 ? row[accIdx] : '';
                const source = srcIdx !== -1 ? row[srcIdx] : 'System Log';

                if (!timestamp || !lat || !lon) continue;

                const cleanTs = cleanTimestamp(timestamp);
                const locationStr = `${lat.trim()}, ${lon.trim()}${accuracy ? ` (Acc: ${accuracy.trim()}m)` : ''}`;

                events.push({
                  id: `snap-geo-${i}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                  timestamp: cleanTs,
                  category: 'connection',
                  sender: 'Snapchat Geolocation',
                  content: `Location recorded via: ${source.trim()}`,
                  location: locationStr,
                  details: {
                    latitude: lat.trim(),
                    longitude: lon.trim(),
                    accuracy: accuracy ? accuracy.trim() : undefined,
                    source: source.trim()
                  },
                  sourceFile: fileName,
                  targetAccount: fileTargetAccount
                });
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse Snapchat Geolocation CSV:", e);
        }
      } else {
        try {
          const lines = content.split(/\r?\n/);
          let target_username = "Unknown";
          // Attempt to extract Target username from banner line 0
          const firstLine = lines[0] || '';
          const bannerMatch = firstLine.match(/Target username\s*["'\s]*([A-Za-z0-9_\.\-]+)/i);
          if (bannerMatch) {
            target_username = bannerMatch[1];
          }

          // Find header row index
          let headerLineIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('conversation_id') && lines[i].includes('sender_username')) {
              headerLineIdx = i;
              break;
            }
          }

          if (headerLineIdx !== -1) {
            const dataBody = lines.slice(headerLineIdx).join('\n');
            const rows = parseCSV(dataBody);
            if (rows.length > 1) {
              const headers = rows[0];
              const hMap = getHeaderMap(headers);

              const currentTarget = target_username !== "Unknown" ? target_username : fileTargetAccount;

              // Populate account info based on target_username if we can
              if (currentTarget && !accountInfo) {
                accountInfo = {
                  userId: currentTarget,
                  username: currentTarget,
                  displayName: currentTarget,
                  otherDetails: {
                    'Registry Source': `Banner extract inside ${fileName}`
                  }
                };
              }

              for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const convId = (row[hMap['conversationid']] || '').trim();
                
                if (!convId || convId.startsWith('===') || convId.startsWith('---') || convId.toLowerCase() === 'conversation_id') {
                  continue;
                }

                const sender = (row[hMap['senderusername']] || '').trim();
                const recipient = (row[hMap['recipientusername']] || '').trim();
                const groupMembers = (row[hMap['groupmemberusernames']] || '').trim();
                const title = (row[hMap['conversationtitle']] || '').trim();
                const text = (row[hMap['text']] || '').trim();
                const mediaId = (row[hMap['mediaid']] || '').trim();
                const timestamp = (row[hMap['timestamp']] || '').trim();

                const direction = (sender && sender === currentTarget) ? 'out' : 'in';

                let threadName = '';
                if (title) {
                  threadName = title;
                } else if (groupMembers) {
                  const members = groupMembers.split(';').map(m => m.trim()).filter(m => m && m !== currentTarget);
                  threadName = members.length > 0 ? members.join('; ') : groupMembers;
                } else if (recipient && recipient !== currentTarget) {
                  threadName = recipient;
                } else if (sender && sender !== currentTarget) {
                  threadName = sender;
                } else {
                  threadName = `[conv:${convId.substring(0, 16)}]`;
                }

                const cleanTs = cleanTimestamp(timestamp);
                // Decoded media ID
                const mediaRef = decodeMediaId(mediaId);

                events.push({
                  id: `snap-csv-${convId}-${i}-${Date.now()}`,
                  timestamp: cleanTs,
                  category: 'message',
                  sender: sender || 'Unknown',
                  recipient: recipient || undefined,
                  content: text || (mediaId ? `[Sent Media Snap ID: ${mediaId}]` : ''),
                  details: {
                    conversationId: convId,
                    mediaId: mediaId || undefined,
                    mediaRef: mediaRef || undefined,
                    threadName: threadName,
                    direction: direction
                  },
                  sourceFile: fileName,
                  targetAccount: currentTarget
                });
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse Snapchat CSV:", e);
        }
      }
    } else {
      try {
        const data = JSON.parse(content);
        let profileUser = fileTargetAccount;
        
        // user_profile.json
        if (data.Profile || data["Profile"]) {
          const prof = data.Profile || data["Profile"];
          profileUser = prof["Username"] || fileTargetAccount;
          
          accountInfo = {
            userId: prof["Username"],
            username: prof["Username"],
            displayName: prof["Display Name"],
            email: prof["Email"],
            phone: prof["Mobile Number"] || prof["Phone"],
            createdDate: cleanTimestamp(prof["Created Timestamp"] || prof["Created Time"]),
            registrationIp: prof["Registration IP"],
            otherDetails: prof
          };
          events.push({
            id: `snap-reg-${Date.now()}`,
            timestamp: cleanTimestamp(prof["Created Timestamp"]),
            category: 'profile',
            sender: 'Snapchat Account',
            content: `Account registered: ${prof["Username"]} (Display Name: ${prof["Display Name"]})`,
            ipAddress: prof["Registration IP"],
            sourceFile: fileName,
            targetAccount: profileUser
          });
        }

        const currentTarget = profileUser || fileTargetAccount;

        // chat_history.json
        const receivedChats = data["Received Chat History"] || data["received_chats"] || [];
        const sentChats = data["Sent Chat History"] || data["sent_chats"] || [];

        receivedChats.forEach((item: any, idx: number) => {
          events.push({
            id: `snap-chat-rx-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(item["Created"] || item["timestamp"]),
            category: 'message',
            sender: item["Sender"] || 'External User',
            recipient: item["Recipient"] || 'Subject',
            content: item["Text"] || `[Sent Media Snap: ${item["Media Type"]}]`,
            details: { mediaType: item["Media Type"] },
            sourceFile: fileName,
            targetAccount: currentTarget
          });
        });

        sentChats.forEach((item: any, idx: number) => {
          events.push({
            id: `snap-chat-tx-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(item["Created"] || item["timestamp"]),
            category: 'message',
            sender: item["Sender"] || 'Subject',
            recipient: item["Recipient"] || 'Recipient User',
            content: item["Text"] || `[Sent Media Snap: ${item["Media Type"]}]`,
            details: { mediaType: item["Media Type"] },
            sourceFile: fileName,
            targetAccount: currentTarget
          });
        });

        // ip_history.json
        const loginHistory = data["Login History"] || data["IP History"] || data["login_history"] || [];
        loginHistory.forEach((item: any, idx: number) => {
          events.push({
            id: `snap-ip-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(item["Timestamp"] || item["time"]),
            category: 'connection',
            sender: item["Device UI"] || item["device"] || 'Mobile App',
            content: `Login / Connection active (Carrier: ${item["Carrier"] || 'Unknown'})`,
            ipAddress: item["IP Address"] || item["ip"],
            sourceFile: fileName,
            targetAccount: currentTarget
          });
        });
      } catch (e) {
        console.error("Failed to parse Snapchat JSON:", e);
      }
    }
  }

  else if (provider === 'kik') {
    // subscriber-data-<username>.pdf in the return root → main-page account card
    if (
      isKikSubscriberPdf ||
      (lowercaseName.includes('subscriber-data') && (lowercaseName.endsWith('.pdf') || lowercaseName.endsWith('.txt')))
    ) {
      const pdfText = lowercaseName.endsWith('.pdf')
        ? extractTextFromPdfContent(content)
        : content;
      const combined = pdfText || content;
      const parsed = parseKikSubscriberFields(combined, fileName);
      if (parsed) {
        accountInfo = parsed;
        events.push({
          id: `kik-subpdf-${Date.now()}`,
          timestamp: parsed.createdDate || new Date().toISOString(),
          category: 'profile',
          sender: 'Kik Registry',
          content: `Kik subscriber identity from ${fileName}: ${parsed.username || parsed.email || parsed.userId}`,
          ipAddress: parsed.registrationIp,
          sourceFile: fileName,
          targetAccount: parsed.username || parsed.userId
        });
      } else {
        const uname = kikUsernameFromSubscriberPdfName(fileName);
        if (uname) {
          accountInfo = {
            userId: uname,
            username: uname,
            sourceFile: fileName,
            provider: 'kik',
            otherDetails: {
              'Source': 'Kik subscriber-data PDF filename',
              'Source File': fileName,
              'Username (from filename)': uname
            }
          };
          events.push({
            id: `kik-subpdf-name-${Date.now()}`,
            timestamp: new Date().toISOString(),
            category: 'profile',
            sender: 'Kik Registry',
            content: `Kik username from subscriber PDF filename: ${uname}`,
            sourceFile: fileName,
            targetAccount: uname
          });
        }
      }
    } else if (lowercaseName.includes('profile') || content.includes('=== REGISTRATION RECORD ===')) {
      // Parse Kik profile txt
      const lines = content.split('\n');
      const info: Record<string, string> = {};
      lines.forEach(line => {
        const idx = line.indexOf(':');
        if (idx !== -1) {
          const key = line.substring(0, idx).trim();
          const val = line.substring(idx + 1).trim();
          if (key && val) {
            info[key] = val;
          }
        }
      });

      if (info['Username'] || info['Email']) {
        accountInfo = {
          userId: info['Username'],
          username: info['Username'],
          displayName: info['Display Name'],
          email: info['Email'],
          phone: info['Associated Phone'] || info['Phone'],
          createdDate: cleanTimestamp(info['Created Date']),
          registrationIp: info['Registration IP'],
          otherDetails: info
        };

        events.push({
          id: `kik-prof-${Date.now()}`,
          timestamp: cleanTimestamp(info['Created Date']),
          category: 'profile',
          sender: 'Kik Registry',
          content: `Account details parsed for user: ${info['Username']}`,
          ipAddress: info['Registration IP'],
          sourceFile: fileName
        });
      }
    } else {
      // Parse CSV / TSV — supports all Kik return schemas (chat_platform_sent.csv, messages.csv, etc.)
      const rows = parseCSV(content);
      if (rows.length > 1) {
        const headers = rows[0];
        const hMap = getHeaderMap(headers);

        // Identify column indices by alias
        const idCol = findCol(hMap, 'id', 'messageid', 'msgid', 'eventid', 'uid');
        const convoCol = findCol(hMap, 'parentid', 'conversationid', 'convoid', 'chatid', 'threadid', 'channelid', 'groupid');
        const tsCol = findCol(hMap, 'sentat', 'senttime', 'timestamp', 'timestampest', 'timestamputc', 'time', 'date', 'datetime', 'createdat', 'sentatts', 'sent');
        const senderCol = findCol(hMap, 'senderid', 'senderusername', 'sender', 'from', 'author', 'authorid', 'authorusername', 'userid', 'username', 'sourceuser', 'sendername');
        const recipientCol = findCol(hMap, 'receiverid', 'recipientid', 'recipientusername', 'recipient', 'receiver', 'to', 'dest', 'destination', 'target', 'targetuser', 'receivername');
        const msgCol = findCol(hMap, 'message', 'messagebody', 'body', 'text', 'content', 'msg', 'chatmessage', 'payload', 'messagetext', 'data');
        const filenameCol = findCol(hMap, 'filename', 'file', 'contentid', 'mediaid', 'mediaurl', 'attachment', 'attachments', 'assetid');
        const contentIdCol = findCol(hMap, 'contentid', 'mediaid');
        const ipCol = findCol(hMap, 'ip', 'ipaddress', 'sourceip', 'clientip');
        const portCol = findCol(hMap, 'port', 'sourceport', 'clientport');
        const appNameCol = findCol(hMap, 'appname', 'type', 'messagetype', 'mediatype', 'service');

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0 || row.join('').trim() === '') continue;

          // Raw extracted values
          let rawId = idCol !== undefined ? (row[idCol] || '').trim() : '';
          let convoId = convoCol !== undefined ? (row[convoCol] || '').trim() : '';
          let tsVal = tsCol !== undefined ? (row[tsCol] || '').trim() : '';
          let senderVal = senderCol !== undefined ? (row[senderCol] || '').trim() : '';
          let recipientVal = recipientCol !== undefined ? (row[recipientCol] || '').trim() : '';
          let bodyVal = msgCol !== undefined ? (row[msgCol] || '').trim() : '';
          let filenameVal = filenameCol !== undefined ? (row[filenameCol] || '').trim() : '';
          let contentIdVal = contentIdCol !== undefined ? (row[contentIdCol] || '').trim() : '';
          let ipVal = ipCol !== undefined ? (row[ipCol] || '').trim() : '';
          let portVal = portCol !== undefined ? (row[portCol] || '').trim() : '';
          let appNameVal = appNameCol !== undefined ? (row[appNameCol] || '').trim() : '';

          // Heuristic Sanity Checks:
          // 1. If timestamp column was missing or empty, find any column matching ISO/Date format
          if (!tsVal || !/\d{4}[-/]\d{2}[-/]\d{2}/.test(tsVal)) {
            const dateMatch = row.find(val => /^\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}/.test(val.trim()));
            if (dateMatch) {
              tsVal = dateMatch.trim();
            }
          }

          // 2. If bodyVal matches the timestamp or date format, it was misassigned
          if (bodyVal && /^\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}/.test(bodyVal)) {
            if (!tsVal || tsVal === bodyVal) {
              tsVal = bodyVal;
            }
            bodyVal = ''; // Clear misassigned timestamp from message text
          }

          // 3. If senderVal is "Gallery", "Video", "Camera", "Image", "Picture" -> that is the app_name/media_type, not a username
          if (senderVal && /^(gallery|video|camera|image|picture|text|audio|sticker)$/i.test(senderVal)) {
            if (!appNameVal) appNameVal = senderVal;
            senderVal = '';
          }

          // 4. If sender is empty, infer from filename or conversation direction
          if (!senderVal) {
            if (lowercaseName.includes('_sent') || lowercaseName.includes('sent.csv')) {
              senderVal = fileTargetAccount !== 'Unknown' ? fileTargetAccount : 'Account Owner';
            } else {
              senderVal = 'Unknown';
            }
          }

          // 5. If conversation ID is missing, fall back to clean placeholder
          if (!convoId) {
            convoId = recipientVal && recipientVal !== 'Unknown' ? `chat-${recipientVal}` : 'Direct Convo';
          }

          // 6. Format display content nicely for attachments and media.
          // Hollow rows (no chat body) stay in the dataset for provenance but are
          // flagged so Conversation View can surface real dialogue first.
          let displayContent = bodyVal;
          let isHollowMessage = false;
          if (!displayContent) {
            if (filenameVal) {
              displayContent = `[Media Attachment: ${filenameVal}]`;
            } else if (appNameVal && appNameVal.toLowerCase() !== 'text') {
              displayContent = `[Sent ${appNameVal} Media]`;
            } else if (ipVal) {
              displayContent = `[Network: ${ipVal}${portVal ? ':' + portVal : ''}]`;
              isHollowMessage = true;
            } else if (lowercaseName.includes('abuse_report') || lowercaseName.includes('abuse-report')) {
              displayContent = '[Abuse report / return metadata - no chat body]';
              isHollowMessage = true;
            } else {
              displayContent = '[Empty Message]';
              isHollowMessage = true;
            }
          }

          const msgId = rawId || `kik-${i}`;
          const cleanTs = cleanTimestamp(tsVal);

          const detailsObj: Record<string, any> = {
            convoId,
            isHollowMessage,
            ...(filenameVal ? { mediaRef: filenameVal, filename: filenameVal } : {}),
            ...(contentIdVal ? { contentId: contentIdVal } : {}),
            ...(portVal ? { port: portVal } : {}),
            ...(appNameVal ? { appName: appNameVal } : {})
          };

          events.push({
            id: `kik-msg-${msgId}-${i}`,
            timestamp: cleanTs,
            category: 'message',
            sender: senderVal,
            recipient: recipientVal || undefined,
            content: displayContent,
            ipAddress: ipVal || undefined,
            details: detailsObj,
            sourceFile: fileName,
            targetAccount: fileTargetAccount !== 'Unknown' ? fileTargetAccount : undefined
          });
        }
      }
    }
  }

  else if (provider === 'synchronos') {
    if (lowercaseName.includes('subscriber') || content.includes('SYNCHRONOS CLOUD')) {
      const lines = content.split('\n');
      const info: Record<string, string> = {};
      lines.forEach(line => {
        const idx = line.indexOf(':');
        if (idx !== -1) {
          const key = line.substring(0, idx).trim();
          const val = line.substring(idx + 1).trim();
          if (key && val) {
            info[key] = val;
          }
        }
      });
      accountInfo = {
        userId: info['Subscriber ID'],
        username: info['Registered Owner'],
        displayName: info['Registered Owner'],
        email: info['Email'],
        phone: info['Primary Phone'] || undefined,
        createdDate: cleanTimestamp(info['Sync Account Created']),
        otherDetails: info
      };
      events.push({
        id: `sync-sub-${Date.now()}`,
        timestamp: cleanTimestamp(info['Sync Account Created']),
        category: 'profile',
        sender: 'Synchronos Admin',
        content: `Subscriber profile registered for: ${info['Registered Owner']}`,
        sourceFile: fileName
      });
    } else {
      // Check if it's a folder-based Synchronoss file (ends with .txt) or uses a date-based folder path
      const rows = parseCSV(content);
      const isCsvLike = rows.length > 1 && rows[0].length > 1;

      if (!isCsvLike || lowercaseName.endsWith('.txt')) {
        // Synchronous Folder Layout (.txt files grouped by date)
        const pathParts = (relativePath || fileName || '').split('/');
        const isSmsPath = pathParts.some(p => p.toLowerCase() === 'sms');
        const isMmsPath = pathParts.some(p => p.toLowerCase() === 'mms');
        const isCallPath = pathParts.some(p => p.toLowerCase() === 'call');
        const isVzMobilePath = pathParts.some(p => p.toLowerCase() === 'vzmobile');

        const fileIdx = pathParts.length - 1;
        const dateFolder = fileIdx >= 1 ? pathParts[fileIdx - 1] : '';
        const categoryName = isCallPath ? 'call' : isVzMobilePath ? 'file' : 'message';

        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const metadata: Record<string, string> = {};
        let isStructured = false;
        let bodyStartIndex = -1;

        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          const match = line.match(/^([A-Za-z0-9_\-\s\(]+):\s*(.*)$/);
          if (match) {
            const key = match[1].trim().toLowerCase().replace(/[\(\)]/g, '');
            const val = match[2].trim();
            metadata[key] = val;
            isStructured = true;
          } else {
            if (isStructured && bodyStartIndex === -1) {
              bodyStartIndex = idx;
            }
          }
        }

        if (isStructured || dateFolder || lowercaseName.endsWith('.txt')) {
          let addressVal = metadata['address'] || metadata['number'] || metadata['phone'] || metadata['contact'] || '';
          let typeVal = metadata['type'] || metadata['direction'] || metadata['folder'] || 'Received';
          
          let bodyVal = metadata['body'] || metadata['content'] || metadata['message'] || metadata['text'] || '';
          if (!bodyVal && isStructured && bodyStartIndex !== -1) {
            bodyVal = lines.slice(bodyStartIndex).join('\n');
          }
          if (!isStructured && !bodyVal) {
            bodyVal = content.trim();
          }

          let timeVal = metadata['message time utc'] || metadata['message time'] || metadata['date'] || metadata['time'] || metadata['timestamp'] || metadata['date/time'] || metadata['datetime'] || '';
          if (!timeVal && dateFolder && /^\d{4}-\d{2}-\d{2}$/.test(dateFolder)) {
            const timeMatch = fileName.match(/(\d{6})/);
            if (timeMatch) {
              const t = timeMatch[1];
              timeVal = `${dateFolder}T${t.substring(0, 2)}:${t.substring(2, 4)}:${t.substring(4, 6)}Z`;
            } else {
              timeVal = `${dateFolder}T12:00:00Z`;
            }
          }
          if (!timeVal) {
            timeVal = 'Unknown';
          }

          const isSent = typeVal.toLowerCase().includes('sent') || typeVal.toLowerCase().includes('outgoing') || typeVal.toLowerCase().includes('tx');
          
          let senderName = isSent ? 'Subject (Backup)' : (addressVal || 'Synchronos Contact');
          let recipientName = isSent ? (addressVal || 'Synchronos Contact') : 'Subject (Backup)';

          if (categoryName === 'call' || (isStructured && metadata['duration'])) {
            const duration = metadata['duration'] || metadata['duration seconds'] || '';
            const durationStr = duration ? `, Duration: ${duration}s` : '';
            const callStatus = metadata['status'] || metadata['call status'] || 'Completed';
            bodyVal = `Voice Call Record: ${typeVal} with ${addressVal || 'Unknown'}${durationStr} (Status: ${callStatus})`;
          }

          events.push({
            id: `sync-folder-${fileName}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            timestamp: cleanTimestamp(timeVal),
            category: (categoryName === 'call' || metadata['duration']) ? 'call' : 'message',
            sender: senderName,
            recipient: recipientName,
            content: bodyVal || `[Metadata file: ${fileName}]`,
            details: {
              ...metadata,
              relativePath,
              dateFolder
            },
            sourceFile: relativePath || fileName
          });
        }
      } else {
        const headers = rows[0];
        const hMap = getHeaderMap(headers);

        const isFiles = headers.some(h => h.toLowerCase().includes('hash') || h.toLowerCase().includes('file_name'));
        const isSms = headers.some(h => h.toLowerCase().includes('sms') || h.toLowerCase().includes('body') || h.toLowerCase().includes('mms'));

        if (isFiles) {
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const fileId = row[hMap['fileid'] || 0];
            const storagePath = row[hMap['storagepath'] || 1] || '';
            const fileNameVal = row[hMap['filename'] || 2] || 'Unnamed File';
            const sizeVal = row[hMap['sizebytes'] || 3] || '0';
            const tsVal = row[hMap['uploadtimestamp'] || hMap['time'] || 4];
            const md5Val = row[hMap['filehashmd5'] || hMap['hash'] || 5] || '';
            const mimeVal = row[hMap['mimetype'] || 6] || '';

            if (tsVal) {
              events.push({
                id: `sync-file-${fileId}-${i}`,
                timestamp: cleanTimestamp(tsVal),
                category: 'file',
                sender: 'Device Backup Engine',
                content: `Backed up file: ${fileNameVal} (${(Number(sizeVal) / (1024 * 1024)).toFixed(2)} MB)`,
                details: {
                  storagePath,
                  sizeBytes: Number(sizeVal),
                  hashMD5: md5Val,
                  mimeType: mimeVal
                },
                sourceFile: fileName
              });
            }
          }
        } else if (hMap['direction'] !== undefined && hMap['sender'] !== undefined && hMap['recipients'] !== undefined) {
          // Synchronoss messages export: Date,Type,Direction,Attachments,Body,Sender,Recipients,Message ID
          // Direction 'out' = account owner (suspect); 'in' = other party (Sender).
          const col = (row: string[], k: string) => { const ix = hMap[k]; return ix === undefined ? '' : (row[ix] || '').trim(); };
          const splitNums = (v: string) => v.split(/[;,|]/).map(x => x.trim()).filter(Boolean);
          // Owner number = most common Sender on outbound rows (MMS out carries it)
          const ownerCounts = new Map<string, number>();
          for (let i = 1; i < rows.length; i++) {
            if (col(rows[i], 'direction').toLowerCase() === 'out') {
              const snd = col(rows[i], 'sender');
              if (snd) ownerCounts.set(snd, (ownerCounts.get(snd) || 0) + 1);
            }
          }
          let owner = '';
          let ownerN = 0;
          ownerCounts.forEach((n, k) => { if (n > ownerN) { owner = k; ownerN = n; } });
          const ownerLabel = owner ? `${owner} (Subject)` : 'Subject (Backup)';
          const relDir = (relativePath || fileName || '').replace(/\\/g, '/');
          const baseDir = relDir.includes('/') ? relDir.substring(0, relDir.lastIndexOf('/')) : '';
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const timeVal = col(row, 'date');
            if (!timeVal) continue;
            const dir = col(row, 'direction').toLowerCase() === 'out' ? 'out' : 'in';
            const isOut = dir === 'out';
            const senderNum = col(row, 'sender');
            const recips = splitNums(col(row, 'recipients'));
            const others = Array.from(new Set([...(isOut ? [] : [senderNum]), ...recips].filter(n => n && n !== owner)));
            const counterpart = others.length > 0 ? others.slice().sort().join(', ') : (senderNum || 'Unknown');
            const msgId = col(row, 'messageid') || `${i}`;
            const attRaw = splitNums(col(row, 'attachments'));
            const realAtts = attRaw.filter(x => x.toLowerCase() !== 'null.txt');
            const placeholderOnly = attRaw.length > 0 && realAtts.length === 0;
            const dayUtc = /^\d{4}-\d{2}-\d{2}/.test(timeVal) ? timeVal.substring(0, 10) : '';
            let dayLocal = '';
            const dt = new Date(timeVal);
            if (!isNaN(dt.getTime())) {
              dayLocal = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            }
            const days = Array.from(new Set([dayUtc, dayLocal].filter(Boolean)));
            const expectedPaths = realAtts.flatMap(fn => days.map(d => `attachments/mms/${dir}/${d}/${fn}`));
            const body = col(row, 'body');
            events.push({
              id: `sync-msg-${msgId}-${i}`,
              timestamp: cleanTimestamp(timeVal),
              category: 'message',
              sender: isOut ? ownerLabel : (senderNum || 'Unknown'),
              recipient: isOut ? counterpart : ownerLabel,
              content: body || (realAtts.length > 0 ? '[MMS attachment]' : placeholderOnly ? '[MMS — no attachment content in return]' : ''),
              details: {
                syncId: msgId,
                syncType: col(row, 'type').toUpperCase() || 'SMS',
                direction: dir,
                isFromSuspect: isOut,
                conversationId: counterpart,
                syncThreadName: counterpart,
                senderNumber: isOut ? owner : senderNum,
                syncAttachments: realAtts,
                syncAttachmentPaths: expectedPaths,
                syncAttachmentBaseDir: baseDir,
                placeholderAttachment: placeholderOnly
              },
              sourceFile: fileName
            });
          }
        } else if (isSms) {
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const syncId = row[0] || `${i}`;
            const timeVal = row[hMap['messagetimeutc'] || hMap['timestamp'] || hMap['time'] || 1];
            const addressVal = row[hMap['address'] || hMap['number'] || 2] || 'Unknown';
            const typeVal = row[hMap['type'] || hMap['direction'] || 3] || 'Received';
            const bodyVal = row[hMap['body'] || hMap['message'] || 4] || '';

            if (timeVal) {
              const isSent = typeVal.toLowerCase().includes('sent') || typeVal.toLowerCase().includes('tx');
              events.push({
                id: `sync-sms-${syncId}-${i}`,
                timestamp: cleanTimestamp(timeVal),
                category: 'message',
                sender: isSent ? 'Subject (Backup)' : addressVal,
                recipient: isSent ? addressVal : 'Subject (Backup)',
                content: bodyVal,
                details: { syncId, syncType: 'SMS Sync' },
                sourceFile: fileName
              });
            }
          }
        }
      }
    }
  }

  else if (provider === 'mega') {
    // Real MEGA LE / BSI JSON schema (same fields as standalone MEGA Parser).
    // Prefer session_details / top-level userhandle|email|creation_timestamp.
    // Never invent timestamps — skip events with no parseable epoch.
    const isJson =
      lowercaseName.endsWith('.json') ||
      content.trim().startsWith('{') ||
      content.trim().startsWith('[');

    if (isJson) {
      try {
        const rawData = JSON.parse(content);
        const data = rawData && typeof rawData === 'object' ? rawData : {};

        const isRealMegaSchema =
          data.session_details != null ||
          data.userhandle != null ||
          (data.creation_timestamp != null && (data.email != null || data.msisdn != null)) ||
          (typeof data.storage === 'object' && data.storage !== null);

        // ---- Real LE schema path ----
        if (isRealMegaSchema || !data.Account_Info && !data.account_info) {
          const createdUtc = formatMegaUtc(data.creation_timestamp);
          const lastActiveUtc = formatMegaUtc(data.lastactive_timestamp);
          const bsiUtc = formatMegaUtc(data.bsi_timestamp);

          const otherDetails: Record<string, string> = {};
          const putDetail = (label: string, val: unknown) => {
            if (val === undefined || val === null || val === '') return;
            otherDetails[label] = String(val);
          };
          putDetail('User handle', data.userhandle);
          putDetail('First name', data.firstname);
          putDetail('Last name', data.lastname);
          putDetail('Status', data.status);
          putDetail('Signup country', data.signup_country);
          putDetail('Language', data.language);
          putDetail('Pro level', data.pro_level);
          putDetail('MFA enabled', data.mfa_enabled === 1 || data.mfa_enabled === true ? 'Yes' : data.mfa_enabled === 0 || data.mfa_enabled === false ? 'No' : data.mfa_enabled);
          putDetail('Purge protected', data.purge_protected === 1 || data.purge_protected === true ? 'Yes' : data.purge_protected === 0 || data.purge_protected === false ? 'No' : data.purge_protected);
          putDetail('BSI version', data.bsi_version);
          if (createdUtc) putDetail('Account created', createdUtc);
          if (data.creation_timestamp != null) putDetail('Account created (epoch)', data.creation_timestamp);
          if (lastActiveUtc) putDetail('Last active', lastActiveUtc);
          if (data.lastactive_timestamp != null) putDetail('Last active (epoch)', data.lastactive_timestamp);
          if (bsiUtc) putDetail('BSI timestamp', bsiUtc);
          putDetail('Active public links', data.active_public_links);
          putDetail('Copyright takedowns', data.copyright_takedowns);
          putDetail('Num chats', data.num_chats);

          const storage = data.storage;
          if (storage && typeof storage === 'object') {
            for (const [k, v] of Object.entries(storage as Record<string, unknown>)) {
              const keyL = String(k).toLowerCase();
              if (keyL.includes('byte') || keyL === 'storage' || keyL === 'used' || keyL === 'total' || keyL === 'free') {
                putDetail(`Storage / ${k}`, humanizeMegaBytes(v));
              } else {
                putDetail(`Storage / ${k}`, v);
              }
            }
          } else if (storage != null) {
            putDetail('Storage', humanizeMegaBytes(storage));
          }

          for (const [key, label] of [
            ['public_upload_pages', 'Public upload pages'],
            ['inshares', 'Inshares (count)'],
            ['outshares', 'Outshares (count)'],
            ['links', 'Links (count)'],
            ['counternoticed_links', 'Counternoticed links (count)'],
            ['recoverable_delete_nodes', 'Recoverable delete nodes'],
          ] as const) {
            if (!(key in data)) continue;
            const val = data[key];
            if (Array.isArray(val)) putDetail(label, val.length);
            else if (val && typeof val === 'object') putDetail(label, JSON.stringify(val).slice(0, 200));
            else putDetail(label, val);
          }

          const displayName = [data.firstname, data.lastname].filter(Boolean).join(' ').trim()
            || (data.userhandle ? `MEGA ${data.userhandle}` : undefined)
            || (data.email ? String(data.email) : undefined);

          // First session creation IP as registration-ish provenance when present
          const sessionsArr: any[] = Array.isArray(data.session_details) ? data.session_details : [];
          const firstSessionIp =
            sessionsArr.find((s) => s && typeof s === 'object' && s.creation_ip)?.creation_ip;

          accountInfo = {
            userId: data.userhandle != null ? String(data.userhandle) : undefined,
            username: data.email != null ? String(data.email) : (data.userhandle != null ? String(data.userhandle) : undefined),
            displayName,
            email: data.email != null ? String(data.email) : undefined,
            phone: data.msisdn != null && String(data.msisdn).trim() !== '' ? String(data.msisdn) : undefined,
            createdDate: createdUtc || undefined,
            registrationIp: firstSessionIp ? String(firstSessionIp) : undefined,
            otherDetails,
          };

          const pushMegaEvent = (
            label: string,
            tsRaw: unknown,
            opts: {
              category?: ForensicEvent['category'];
              sender?: string;
              content?: string;
              ipAddress?: string;
              location?: string;
              details?: Record<string, unknown>;
            } = {}
          ) => {
            const epoch = parseMegaEpoch(tsRaw);
            const utc = formatMegaUtc(tsRaw);
            if (epoch === null || !utc) return; // no invented dates
            events.push({
              id: `mega-${label.replace(/\s+/g, '-').toLowerCase()}-${epoch}-${events.length}`,
              timestamp: utc,
              category: opts.category || 'other',
              sender: opts.sender || 'MEGA',
              content: opts.content || label,
              ipAddress: opts.ipAddress,
              location: opts.location,
              details: {
                ...(opts.details || {}),
                label,
                epoch,
                sortEpoch: epoch,
                epochProvenance: `Raw epoch from source: ${tsRaw}`,
              },
              sourceFile: fileName,
            });
          };

          pushMegaEvent('Account Created', data.creation_timestamp, {
            category: 'profile',
            sender: 'MEGA Registrar',
            content: `MEGA account created${data.email ? ` (${data.email})` : ''}${data.userhandle ? ` handle=${data.userhandle}` : ''}`,
          });
          pushMegaEvent('BSI Timestamp', data.bsi_timestamp, {
            category: 'profile',
            content: 'BSI record timestamp',
          });
          pushMegaEvent('Last Active', data.lastactive_timestamp, {
            category: 'connection',
            content: 'Account last active',
          });

          sessionsArr.forEach((session: any, idx: number) => {
            if (!session || typeof session !== 'object') return;
            const creationIp = session.creation_ip ? String(session.creation_ip) : undefined;
            const ua = session.user_agent ? String(session.user_agent) : '';
            const viable =
              session.viable === 1 || session.viable === true
                ? 'Yes'
                : session.viable === 0 || session.viable === false
                  ? 'No'
                  : session.viable != null
                    ? String(session.viable)
                    : '';
            const sessDetails = `IP ${creationIp || 'n/a'}${ua ? ` | ${ua}` : ''}${viable ? ` | viable=${viable}` : ''}`;

            pushMegaEvent('Session Created', session.creation_timestamp, {
              category: 'connection',
              sender: ua || 'MEGA Session',
              content: `Session ${idx + 1} created — ${sessDetails}`,
              ipAddress: creationIp,
              details: { ...session, sessionIndex: idx + 1 },
            });
            pushMegaEvent('Session Last Active', session.lastactive_timestamp, {
              category: 'connection',
              sender: ua || 'MEGA Session',
              content: `Session ${idx + 1} last active — ${sessDetails}`,
              ipAddress: creationIp,
              details: { ...session, sessionIndex: idx + 1 },
            });

            const addIps = Array.isArray(session.additional_ips) ? session.additional_ips : [];
            addIps.forEach((ipObj: any) => {
              if (!ipObj || typeof ipObj !== 'object') return;
              const ipStr = ipObj.ip ? String(ipObj.ip) : undefined;
              pushMegaEvent('IP First Seen', ipObj.firstseen_timestamp, {
                category: 'connection',
                sender: 'MEGA Session IP',
                content: `IP first seen: ${ipStr || 'unknown'}`,
                ipAddress: ipStr,
                details: { ...ipObj, sessionIndex: idx + 1 },
              });
              pushMegaEvent('IP Last Seen', ipObj.lastseen_timestamp, {
                category: 'connection',
                sender: 'MEGA Session IP',
                content: `IP last seen: ${ipStr || 'unknown'}`,
                ipAddress: ipStr,
                details: { ...ipObj, sessionIndex: idx + 1 },
              });
            });
          });

          const contacts = Array.isArray(data.contacts) ? data.contacts : [];
          contacts.forEach((contact: any, idx: number) => {
            if (!contact || typeof contact !== 'object') return;
            const who = contact.email || contact.cuserid || 'contact';
            pushMegaEvent('Contact', contact.ts ?? contact.timestamp ?? contact.creation_timestamp, {
              category: 'other',
              sender: String(who),
              content: `Contact: ${who}${contact.status ? ` (${contact.status})` : ''}`,
              details: { ...contact, contactIndex: idx },
            });
          });

          const pwChanges = Array.isArray(data.password_changes) ? data.password_changes : [];
          pwChanges.forEach((pc: any, idx: number) => {
            if (pc && typeof pc === 'object') {
              pushMegaEvent('Password Change', pc.timestamp ?? pc.ts, {
                category: 'profile',
                sender: 'MEGA Security',
                content: `Password change${pc.ip ? ` from ${pc.ip}` : ''}`,
                ipAddress: pc.ip ? String(pc.ip) : undefined,
                details: { ...pc, changeIndex: idx },
              });
            } else {
              pushMegaEvent('Password Change', pc, {
                category: 'profile',
                sender: 'MEGA Security',
                content: 'Password change',
              });
            }
          });

          // Public links / outshares with real timestamps only
          const linkLists: Array<{ key: string; label: string }> = [
            { key: 'links', label: 'Public Link' },
            { key: 'Active_Public_Links', label: 'Public Link' },
            { key: 'outshares', label: 'Outshare' },
            { key: 'Outshares', label: 'Outshare' },
          ];
          for (const { key, label } of linkLists) {
            const list = data[key];
            if (!Array.isArray(list)) continue;
            list.forEach((item: any, idx: number) => {
              if (!item || typeof item !== 'object') return;
              pushMegaEvent(label, item.creation_timestamp ?? item.ts ?? item.timestamp, {
                category: 'file',
                sender: 'Subject Account',
                content: `${label}: ${item.handle || item.target || 'n/a'}`,
                details: { ...item, listKey: key, index: idx },
              });
            });
          }

          const deleted =
            data.recoverable_delete_nodes_list ||
            data.Nodes_Recoverable ||
            data.recoverable_deleted_nodes;
          if (Array.isArray(deleted)) {
            deleted.forEach((node: any, idx: number) => {
              if (!node || typeof node !== 'object') return;
              pushMegaEvent('Recoverable Delete', node.deletion_timestamp ?? node.uts ?? node.ts, {
                category: 'file',
                sender: 'MEGA Nodes',
                content: `Recoverable delete: ${node.name || 'Unnamed'}${node.size_bytes != null ? ` (${humanizeMegaBytes(node.size_bytes)})` : ''}`,
                details: { ...node, index: idx },
              });
            });
          }
        } else {
          // ---- Legacy / demo Account_Info shape (best-effort, still no invented dates) ----
          const amVal = data.Account_Info || data.account_info;
          if (amVal) {
            const created =
              formatMegaUtc(amVal.Signed_Up_UTC) ||
              (typeof amVal.Signed_Up_UTC === 'string' && /\d{4}-\d{2}-\d{2}/.test(amVal.Signed_Up_UTC)
                ? String(amVal.Signed_Up_UTC)
                : undefined);
            accountInfo = {
              userId: amVal.User_ID || amVal.userId || amVal.userhandle,
              username: amVal.Email || amVal.email,
              displayName: `MEGA User : ${amVal.User_ID || amVal.userhandle || 'Unknown'}`,
              email: amVal.Email || amVal.email,
              phone: amVal.msisdn || amVal.MSISDN,
              createdDate: created,
              otherDetails: {
                Status: String(amVal.Status || amVal.status || 'Active'),
                'Country Code': String(amVal.Country_Code || amVal.signup_country || 'N/A'),
              },
            };
          }

          const sessionsList = data.Sessions || data.sessions || [];
          sessionsList.forEach((sess: any, idx: number) => {
            const ts = sess.action_time_utc || sess.timestamp || sess.ts || sess.creation_timestamp;
            const utc = formatMegaUtc(ts);
            const epoch = parseMegaEpoch(ts);
            // Allow already-human UTC strings from legacy samples only if they look like dates
            let timestamp = utc;
            let sortEpoch = epoch;
            if (!timestamp && typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts)) {
              timestamp = ts.includes('UTC') ? ts : `${ts} UTC`;
              const m = timestamp.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
              if (m) sortEpoch = Math.floor(Date.parse(`${m[1]}T${m[2]}Z`) / 1000);
            }
            if (!timestamp) return;
            events.push({
              id: `mega-sess-legacy-${idx}-${sortEpoch ?? idx}`,
              timestamp,
              category: 'connection',
              sender: sess.device || sess.useragent || 'MEGA Session',
              content: `Session: ${sess.action_type || 'LOGIN'}`,
              ipAddress: sess.ip_address || sess.ip || sess.creation_ip,
              location: sess.country_code,
              details: { ...sess, epoch: sortEpoch, sortEpoch, epochProvenance: `Source: ${ts}` },
              sourceFile: fileName,
            });
          });
        }
      } catch (e) {
        console.error('Failed to parse MEGA JSON:', e);
      }
    } else {
      // CSV fallback (nodes / sessions) — only emit rows with real timestamps
      const rows = parseCSV(content);
      if (rows.length > 1) {
        const headers = rows[0];
        const hMap = getHeaderMap(headers);
        const isNodes = headers.some(h => h.toLowerCase().includes('node_id') || h.toLowerCase().includes('parent_id') || h.toLowerCase().includes('name'));
        const isSessions = headers.some(h => h.toLowerCase().includes('session_id') || h.toLowerCase().includes('action_type') || h.toLowerCase().includes('ip_address') || h.toLowerCase().includes('creation_ip'));

        if (isNodes) {
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const nodeId = row[hMap['nodeid'] || 0];
            const type = row[hMap['type'] || 1] || 'file';
            const nameVal = row[hMap['name'] || 2] || 'Unnamed Node';
            const parentId = row[hMap['parentid'] || 3] || '';
            const sizeVal = row[hMap['sizebytes'] || 4] || '0';
            const timeVal = row[hMap['uploadedtimeutc'] || hMap['timestamp'] || hMap['creationtimestamp'] || 5];
            const utc = formatMegaUtc(timeVal);
            let timestamp = utc;
            let sortEpoch = parseMegaEpoch(timeVal);
            if (!timestamp && typeof timeVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(timeVal)) {
              timestamp = timeVal.includes('UTC') ? timeVal : `${timeVal} UTC`;
            }
            if (!timestamp) continue;
            events.push({
              id: `mega-node-${nodeId || i}-${i}`,
              timestamp,
              category: 'file',
              sender: 'Cloud Upload Manager',
              content: `Folder/File: ${nameVal} (${String(type).toUpperCase()}) - ${sizeVal} Bytes`,
              details: { nodeId, nodeType: type, sizeBytes: Number(sizeVal), parentId, epoch: sortEpoch, sortEpoch },
              sourceFile: fileName,
            });
          }
        } else if (isSessions) {
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const ssId = row[0] || `${i}`;
            const timeVal = row[hMap['actiontimeutc'] || hMap['timestamp'] || hMap['creationtimestamp'] || 1];
            const ipVal = row[hMap['ipaddress'] || hMap['creationip'] || 2];
            const countryVal = row[hMap['countrycode'] || 3] || undefined;
            const agentVal = row[hMap['clientver'] || hMap['clientversion'] || hMap['useragent'] || 4] || '';
            const devVal = row[hMap['device'] || 5] || 'PC';
            const actionVal = row[hMap['actiontype'] || 6] || 'Activity';
            const utc = formatMegaUtc(timeVal);
            let timestamp = utc;
            let sortEpoch = parseMegaEpoch(timeVal);
            if (!timestamp && typeof timeVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(timeVal)) {
              timestamp = timeVal.includes('UTC') ? timeVal : `${timeVal} UTC`;
            }
            if (!timestamp) continue;
            events.push({
              id: `mega-sess-${ssId}-${i}`,
              timestamp,
              category: 'connection',
              sender: `${devVal}${agentVal ? ` (${agentVal})` : ''}`,
              content: `MEGA session: ${actionVal}`,
              ipAddress: ipVal,
              location: countryVal,
              details: { ssId, epoch: sortEpoch, sortEpoch },
              sourceFile: fileName,
            });
          }
        }
      }
    }
  }

  else if (provider === 'cybertip') {
    // ESP-reported suspect only: reportedPersons / ReportedPerson map to NCMEC
    // personOrUserReported ("displayed as the suspect"). Do NOT promote reporter,
    // victim, intended-recipient, or other tip emails into accountInfo.email.
    const cybertipSuspectRoleRe = /suspect|reported\s*person|personoruserreported|esp\s*suspect|offender|uploader|reported\s*user/i;
    const cybertipNonSuspectRoleRe = /victim|child\s*victim|reporter|reporting\s*person|intended\s*recipient|recipient|witness|contact\s*person|parent|guardian|law\s*enforcement|additional\s*contact/i;

    const cybertipPersonRole = (person: any): string =>
      String(
        person?.role ||
        person?.personRole ||
        person?.type ||
        person?.personType ||
        person?.reportedPersonType ||
        person?.reportedPersonRole ||
        ''
      ).trim();

    const cybertipIsExplicitNonSuspect = (person: any): boolean =>
      cybertipNonSuspectRoleRe.test(cybertipPersonRole(person));

    const cybertipIsEspSuspectRole = (person: any): boolean => {
      const role = cybertipPersonRole(person);
      if (!role) return false;
      if (cybertipNonSuspectRoleRe.test(role)) return false;
      return cybertipSuspectRoleRe.test(role);
    };

    const cybertipHasEspAccountMarkers = (person: any): boolean => {
      if (person?.espIdentifier || person?.espId || person?.EspIdentifier) return true;
      if (typeof person?.screenName === 'string' && person.screenName.trim()) return true;
      const sns = person?.screenNames?.screenNames || person?.screenNames;
      return Array.isArray(sns) && sns.length > 0;
    };

    const cybertipPickSuspectPerson = <T,>(persons: T[]): T | undefined => {
      if (!persons.length) return undefined;
      const byRole = persons.find(p => cybertipIsEspSuspectRole(p));
      if (byRole) return byRole;
      const withEsp = persons.find(p => !cybertipIsExplicitNonSuspect(p) && cybertipHasEspAccountMarkers(p));
      if (withEsp) return withEsp;
      const nonVictim = persons.find(p => !cybertipIsExplicitNonSuspect(p));
      if (nonVictim) return nonVictim;
      return persons[0];
    };

    const cybertipPickSuspectEmail = (person: any): string | undefined => {
      if (!person) return undefined;
      if (typeof person.email === 'string' && person.email.trim()) return person.email.trim();
      const list: any[] = Array.isArray(person.emails?.emails)
        ? person.emails.emails
        : (Array.isArray(person.emails) ? person.emails : []);
      if (!list.length) return undefined;
      const usable = list.find((e: any) => {
        const t = String(e?.type || e?.emailType || e?.label || e?.role || '').toLowerCase();
        return !/recovery|secondary|alternate|backup|reporter|contact/.test(t);
      }) || list[0];
      if (typeof usable === 'string') return usable.trim() || undefined;
      const v = usable?.value || usable?.email || usable?.Email;
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };

    const cybertipPickSuspectPhone = (person: any): string | undefined => {
      if (!person) return undefined;
      if (typeof person.phone === 'string' && person.phone.trim()) return person.phone.trim();
      const list: any[] = Array.isArray(person.phones?.phones)
        ? person.phones.phones
        : (Array.isArray(person.phones) ? person.phones : []);
      if (!list.length) return undefined;
      const first = list[0];
      if (typeof first === 'string') return first.trim() || undefined;
      const v = first?.value || first?.phone || first?.PhoneNumber;
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };

    if (lowercaseName.endsWith('.json')) {
      try {
        const jsonData = JSON.parse(content);
        const reportedPersons: any[] =
          jsonData.reportedInformation?.reportedPeople?.reportedPersons || [];
        const suspectPerson = cybertipPickSuspectPerson(reportedPersons) || {};
        const subjectName = [suspectPerson.firstName, suspectPerson.lastName].filter(Boolean).join(' ') || 'Unknown Subject';
        const suspectEmail = cybertipPickSuspectEmail(suspectPerson);
        const suspectPhone = cybertipPickSuspectPhone(suspectPerson);

        const allPersonNames = reportedPersons.map((p: any, i: number) => {
          const n = [p.firstName, p.lastName].filter(Boolean).join(' ');
          const role = cybertipPersonRole(p);
          const label = n || `Reported Person ${i + 1}`;
          return role ? `${label} [${role}]` : label;
        });

        accountInfo = {
          userId: jsonData.reportId ? String(jsonData.reportId) : undefined,
          username: subjectName,
          displayName: subjectName,
          email: suspectEmail,
          phone: suspectPhone,
          createdDate: cleanTimestamp(jsonData.dateReceived),
          otherDetails: {
            'Incident Type': jsonData.reportedInformation?.incidentSummary?.incidentType || 'Unknown',
            'Reporting ESP': jsonData.reportedInformation?.reportingEsp?.espName || 'Unknown',
            'ESP Suspect Email': suspectEmail || undefined,
            'Reported Persons': allPersonNames.join('; ') || undefined,
            'Reported Person Count': String(reportedPersons.length || 0)
          }
        };

        // Primary ESP suspect profile only (not every tip email / person)
        events.push({
          id: `ct-suspect-${Date.now()}`,
          timestamp: cleanTimestamp(jsonData.dateReceived),
          category: 'profile',
          sender: subjectName,
          content: `CyberTip ESP-reported suspect: ${subjectName}${suspectEmail ? ` (email: ${suspectEmail})` : ''}${suspectPhone ? ` (phone: ${suspectPhone})` : ''}`,
          sourceFile: fileName,
          details: {
            espSuspect: true,
            emails: suspectEmail ? [suspectEmail] : [],
            phones: suspectPhone ? [suspectPhone] : []
          }
        });

        // Non-primary persons: forensic notes only — never accountInfo / identifier email
        reportedPersons.forEach((person: any, pIdx: number) => {
          if (person === suspectPerson) return;
          const pName = [person.firstName, person.lastName].filter(Boolean).join(' ') || `Reported Person ${pIdx + 1}`;
          const pRole = cybertipPersonRole(person) || 'additional contact';
          const pEmail = cybertipPickSuspectEmail(person);
          const pPhone = cybertipPickSuspectPhone(person);
          events.push({
            id: `ct-other-person-${pIdx}-${Date.now()}`,
            timestamp: cleanTimestamp(jsonData.dateReceived),
            category: 'other',
            sender: pName,
            content: `CyberTip additional person (not ESP primary suspect) [${pRole}]: ${pName}${pEmail ? ` (email noted: ${pEmail})` : ''}${pPhone ? ` (phone: ${pPhone})` : ''}`,
            sourceFile: fileName,
            details: {
              espSuspect: false,
              reportedPersonIndex: pIdx,
              role: pRole,
              emailNote: pEmail || undefined,
              phoneNote: pPhone || undefined
            }
          });
        });

        // Extract IPs from all reported persons (IP evidence is still forensically useful)
        const ips = new Set<string>();
        reportedPersons.forEach((person: any) => {
          person.sourceInformation?.sourceCaptures?.forEach((capture: any) => {
            if (capture.captureType === 'IP Address') ips.add(capture.value);
          });
        });

        const files = jsonData.reportedInformation?.uploadedFiles?.uploadedFiles || [];
        files.forEach((f: any, idx: number) => {
          f.sourceInformation?.sourceCaptures?.forEach((capture: any) => {
            if (capture.captureType === 'IP Address') ips.add(capture.value);
          });

          events.push({
            id: `ct-file-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(f.originalPost?.dateTime || f.dateTime || jsonData.dateReceived),
            category: 'file',
            sender: subjectName,
            content: `Uploaded File: ${f.fileName || 'Unknown'} (Hash: ${f.hash?.md5 || f.hash?.sha1 || 'N/A'})`,
            details: { viewedByEsp: f.viewedByEsp },
            sourceFile: fileName
          });
        });

        Array.from(ips).forEach((ip, idx) => {
          events.push({
            id: `ct-ip-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(jsonData.dateReceived),
            category: 'connection',
            sender: subjectName,
            content: `IP Address logged in CyberTip report`,
            ipAddress: ip,
            sourceFile: fileName
          });
        });

        const notes = jsonData.additionalNcmecInformation?.notes?.notes || [];
        notes.forEach((n: any, idx: number) => {
          events.push({
            id: `ct-note-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(n.dateTime),
            category: 'other',
            sender: 'NCMEC Note',
            content: n.value,
            sourceFile: fileName
          });
        });

      } catch (e) {
        console.error("Failed to parse CyberTip JSON:", e);
      }
    } else if (lowercaseName.endsWith('.xml')) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");

        const localNameOf = (el: Element) => (el.localName || el.tagName || '').replace(/^.*:/, '');
        const elementsByNames = (parent: Element | Document, names: string[]): Element[] => {
          const want = new Set(names.map(n => n.toLowerCase()));
          return Array.from(parent.getElementsByTagName('*')).filter(el => {
            const ln = localNameOf(el).toLowerCase();
            const tn = (el.tagName || '').toLowerCase();
            return want.has(ln) || want.has(tn);
          });
        };
        const textByNames = (parent: Element | Document, names: string[]): string => {
          const el = elementsByNames(parent, names)[0];
          if (!el) return '';
          const valueChild = elementsByNames(el, ['Value', 'value'])[0];
          if (valueChild) {
            const v = (valueChild.textContent || '').trim();
            if (v) return v;
          }
          return (el.textContent || '').trim();
        };
        const textsByNames = (parent: Element | Document, names: string[]): string[] => {
          const out: string[] = [];
          elementsByNames(parent, names).forEach(el => {
            const valueChild = elementsByNames(el, ['Value', 'value'])[0];
            const v = ((valueChild?.textContent || el.textContent) || '').trim();
            if (v) out.push(v);
          });
          return out;
        };
        const uniq = (arr: string[]) => Array.from(new Set(arr.map(s => s.trim()).filter(Boolean)));
        const ancestorIsNonSuspectSection = (el: Element): boolean => {
          let cur: Element | null = el.parentElement;
          while (cur) {
            const ln = localNameOf(cur).toLowerCase();
            // Exclude reporter / victim / intended-recipient sections.
            // Do NOT treat ReportingInformation / ReportedPeople as non-suspect parents.
            if (
              ln === 'reporter' ||
              ln === 'reportingperson' ||
              ln === 'contactperson' ||
              ln === 'victim' ||
              ln === 'childvictim' ||
              ln === 'victims' ||
              ln === 'intendedrecipient' ||
              ln === 'intendedrecipients' ||
              ln === 'intendedrecipientperson'
            ) {
              return true;
            }
            cur = cur.parentElement;
          }
          return false;
        };

        const reportId = textByNames(xmlDoc, ['ReportId', 'reportId']);
        const dateReceived = textByNames(xmlDoc, ['DateReceived', 'dateReceived']);
        const espName = textByNames(xmlDoc, ['ESPName', 'espName', 'EspName']) || 'Unknown';
        const incidentType = textByNames(xmlDoc, ['IncidentType', 'incidentType']) || undefined;

        // Prefer ReportedPerson under ReportedPeople; skip reporter/victim/recipient sections
        const personNodes = elementsByNames(xmlDoc, ['ReportedPerson', 'reportedPerson', 'PersonOrUserReported', 'personOrUserReported'])
          .filter(node => !ancestorIsNonSuspectSection(node));

        const persons = personNodes.map((node, pIdx) => {
          const firstName = textByNames(node, ['FirstName', 'firstName']);
          const lastName = textByNames(node, ['LastName', 'lastName']);
          const pName = [firstName, lastName].filter(Boolean).join(' ') || `Reported Person ${pIdx + 1}`;
          const role =
            textByNames(node, ['Role', 'role', 'PersonRole', 'personRole', 'PersonType', 'personType', 'ReportedPersonRole', 'reportedPersonRole']) ||
            node.getAttribute('role') ||
            node.getAttribute('type') ||
            '';
          const espIdentifier = textByNames(node, ['EspIdentifier', 'espIdentifier', 'ESPIdentifier', 'EspId', 'espId']);
          const screenName = textByNames(node, ['ScreenName', 'screenName']);
          // Emails scoped to this ReportedPerson only (not reporter/victim elsewhere in tip)
          const emailList = uniq([
            ...textsByNames(node, ['Email', 'email', 'EmailAddress', 'emailAddress']),
          ]).filter(e => /@/.test(e));
          const phoneList = uniq([
            ...textsByNames(node, ['Phone', 'phone', 'PhoneNumber', 'phoneNumber', 'Mobile', 'mobile', 'MobileNumber', 'mobileNumber']),
          ]);

          const personIps: string[] = [];
          elementsByNames(node, ['SourceCapture', 'sourceCapture', 'IPAddress', 'ipAddress', 'IpAddress']).forEach(cap => {
            const captureType = textByNames(cap, ['CaptureType', 'captureType']);
            const ln = localNameOf(cap).toLowerCase();
            const ipVal =
              textByNames(cap, ['IPAddress', 'ipAddress', 'IpAddress', 'Value', 'value']) ||
              (ln === 'ipaddress' ? (cap.textContent || '').trim() : '');
            if (ipVal && (!captureType || /ip/i.test(captureType) || ln === 'ipaddress')) {
              personIps.push(ipVal);
            }
          });

          return {
            pName,
            firstName,
            lastName,
            role,
            espIdentifier,
            screenName,
            emailList,
            phoneList,
            personIps,
            // shape compatible with JSON suspect pickers
            emails: { emails: emailList.map(value => ({ value })) },
            phones: { phones: phoneList.map(value => ({ value })) },
            espId: espIdentifier || undefined,
            screenNames: screenName ? { screenNames: [{ value: screenName }] } : undefined
          };
        });

        const primary = cybertipPickSuspectPerson(persons);
        const subjectName = primary?.pName || 'Unknown Subject';
        const suspectEmail = primary?.emailList[0] || undefined;
        const suspectPhone = primary?.phoneList[0] || undefined;
        const allPersonNames = persons.map(p => (p.role ? `${p.pName} [${p.role}]` : p.pName));

        accountInfo = {
          userId: reportId || undefined,
          username: subjectName,
          displayName: subjectName,
          email: suspectEmail,
          phone: suspectPhone,
          createdDate: cleanTimestamp(dateReceived),
          otherDetails: {
            'Format': 'XML CyberTip',
            'Reporting ESP': espName,
            'ESP Suspect Email': suspectEmail || undefined,
            ...(incidentType ? { 'Incident Type': incidentType } : {}),
            'Reported Persons': allPersonNames.join('; ') || undefined,
            'Reported Person Count': String(persons.length || 0)
          }
        };

        events.push({
          id: `ct-xml-suspect-${Date.now()}`,
          timestamp: cleanTimestamp(dateReceived),
          category: 'profile',
          sender: subjectName,
          content: `CyberTip ESP-reported suspect: ${subjectName}${suspectEmail ? ` (email: ${suspectEmail})` : ''}${suspectPhone ? ` (phone: ${suspectPhone})` : ''}`,
          sourceFile: fileName,
          details: {
            espSuspect: true,
            emails: suspectEmail ? [suspectEmail] : [],
            phones: suspectPhone ? [suspectPhone] : [],
            role: primary?.role || undefined,
            espIdentifier: primary?.espIdentifier || undefined
          }
        });

        persons.forEach((person, pIdx) => {
          if (person === primary) return;
          const pEmail = person.emailList[0];
          const pPhone = person.phoneList[0];
          const pRole = person.role || 'additional contact';
          events.push({
            id: `ct-xml-other-person-${pIdx}-${Date.now()}`,
            timestamp: cleanTimestamp(dateReceived),
            category: 'other',
            sender: person.pName,
            content: `CyberTip additional person (not ESP primary suspect) [${pRole}]: ${person.pName}${pEmail ? ` (email noted: ${pEmail})` : ''}${pPhone ? ` (phone: ${pPhone})` : ''}`,
            sourceFile: fileName,
            details: {
              espSuspect: false,
              reportedPersonIndex: pIdx,
              role: pRole,
              emailNote: pEmail || undefined,
              phoneNote: pPhone || undefined,
              firstName: person.firstName || undefined,
              lastName: person.lastName || undefined
            }
          });
        });

        const ips = new Set<string>();
        persons.forEach(p => p.personIps.forEach(ip => ips.add(ip)));
        elementsByNames(xmlDoc, ['IPAddress', 'ipAddress', 'IpAddress']).forEach(node => {
          const val = (node.textContent || '').trim();
          if (val) ips.add(val);
        });
        elementsByNames(xmlDoc, ['SourceCapture', 'sourceCapture']).forEach(cap => {
          const captureType = textByNames(cap, ['CaptureType', 'captureType']);
          const val = textByNames(cap, ['Value', 'value', 'IPAddress', 'ipAddress']);
          if (val && (!captureType || /ip/i.test(captureType))) ips.add(val);
        });

        Array.from(ips).forEach((ip, idx) => {
          events.push({
            id: `ct-xml-ip-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(dateReceived),
            category: 'connection',
            sender: subjectName,
            content: `IP Address logged in CyberTip report`,
            ipAddress: ip,
            sourceFile: fileName
          });
        });

        const fileNodes = elementsByNames(xmlDoc, ['UploadedFile', 'uploadedFile']);
        fileNodes.forEach((node, idx) => {
          const fName = textByNames(node, ['FileName', 'fileName', 'Filename', 'filename']) || 'Unknown File';
          const fTime = textByNames(node, ['DateTime', 'dateTime', 'OriginalDateTime', 'originalDateTime']) || dateReceived;
          const hashMd5 = textByNames(node, ['MD5', 'md5', 'Md5']) || 'N/A';

          events.push({
            id: `ct-xml-file-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(fTime),
            category: 'file',
            sender: subjectName,
            content: `Uploaded File: ${fName} (Hash: ${hashMd5})`,
            sourceFile: fileName,
            details: { fileName: fName, md5: hashMd5 !== 'N/A' ? hashMd5 : undefined }
          });
        });
      } catch (e) {
        console.error("Failed to parse CyberTip XML:", e);
      }
    }
  }

  else if (provider === 'google') {
    // 1. IP sweep across ALL Google files (JSON, CSV, HTML)
    const ipRegex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
    const ipMatches = content.match(ipRegex) || [];
    const uniqueIPsInFile = Array.from(new Set(ipMatches)).filter(ip => {
      if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip.startsWith('192.168.') || ip.startsWith('10.')) return false;
      const parts = ip.split('.').map(Number);
      if (parts.some(p => p > 255)) return false;
      return true;
    });

    // Create connection events for swept IPs (excluding locations records to avoid duplicates)
    if (!lowercaseName.includes('location history') && !lowercaseName.includes('location_history') && !lowercaseName.includes('records.json')) {
      uniqueIPsInFile.forEach((ip, idx) => {
        events.push({
          id: `google-ip-sweep-${ip}-${idx}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          timestamp: "2026-07-02T04:59:59.000Z", // Timestamp inside the date range of case
          category: 'connection',
          sender: 'Google IP Sweeper',
          content: `IP Address [${ip}] extracted from return file "${fileName}"`,
          ipAddress: ip,
          sourceFile: fileName,
          details: {
            extractedIP: ip,
            extractionMethod: 'Regex Sweep',
            sourceFile: fileName
          }
        });
      });
    }

    // 2. Structured parsing — subscriber_info / account_info / profile JSON
    // Independent files: GAIA (userId) + primary email drive identity; App.tsx must not
    // collapse distinct Google accounts on display-name alone.
    if ((lowercaseName.includes('subscriber') || lowercaseName.includes('account_info') || lowercaseName.includes('profile')) && lowercaseName.endsWith('.json')) {
      try {
        const jsonData = JSON.parse(content);
        const profile = jsonData.profile || jsonData.account || jsonData.subscriber || jsonData;

        // Primary forensic ID: prefer explicit GAIA keys over generic profile.id
        const gaiaIdRaw =
          profile.gaia_id ||
          profile.google_account_id ||
          profile.gaiaId ||
          profile.googleAccountId ||
          profile.id;
        const gaiaId = gaiaIdRaw !== undefined && gaiaIdRaw !== null && String(gaiaIdRaw).trim() !== ''
          ? String(gaiaIdRaw).trim()
          : undefined;

        // Primary email (never recovery/secondary as primary)
        const pickEmail = (v: unknown): string | undefined => {
          if (typeof v === 'string' && v.trim()) return v.trim();
          if (v && typeof v === 'object' && typeof (v as any).value === 'string' && (v as any).value.trim()) {
            return String((v as any).value).trim();
          }
          if (v && typeof v === 'object' && typeof (v as any).email === 'string' && (v as any).email.trim()) {
            return String((v as any).email).trim();
          }
          return undefined;
        };
        let primaryEmail =
          pickEmail(profile.primary_email) ||
          pickEmail(profile.primaryEmail) ||
          pickEmail(profile.email) ||
          pickEmail(profile.email_address) ||
          pickEmail(profile.emailAddress);
        if (!primaryEmail) {
          const emailList = profile.emails || profile.email_addresses || profile.emailAddresses;
          if (Array.isArray(emailList) && emailList.length > 0) {
            const primaryEntry = emailList.find((e: any) =>
              e && (e.primary === true || e.type === 'primary' || e.label === 'primary' || e.role === 'primary')
            );
            primaryEmail = pickEmail(primaryEntry) || pickEmail(emailList[0]);
          }
        }
        if (!primaryEmail) {
          primaryEmail = pickEmail(profile.contact_email) || pickEmail(profile.contactEmail);
        }
        // Explicitly do not fall back to recovery_email / secondary_email for AccountInfo.email

        const registrationIp =
          profile.terms_of_service_ip ||
          profile.tos_ip ||
          profile.tos_acceptance_ip ||
          profile.registration_ip ||
          profile.registrationIp ||
          profile.ip_at_registration ||
          undefined;

        const displayName = profile.name || profile.displayName || profile.display_name || undefined;
        const emailLocal = primaryEmail && primaryEmail.includes('@') ? primaryEmail.split('@')[0] : undefined;

        accountInfo = {
          userId: gaiaId,
          // Prefer email local-part as username for stable identity; keep human name on displayName
          username: emailLocal || displayName || profile.given_name || profile.givenName || undefined,
          displayName: displayName || ([profile.given_name || profile.givenName, profile.family_name || profile.familyName].filter(Boolean).join(' ') || undefined),
          email: primaryEmail,
          phone: profile.phone || profile.recovery_phone || profile.recovery_sms || undefined,
          createdDate: profile.creation_time || profile.created || profile.created_date || profile.createdDate || undefined,
          registrationIp: registrationIp ? String(registrationIp).trim() : undefined,
          otherDetails: {
            'Google Account ID': gaiaId,
            'GAIA ID': gaiaId,
            'Given Name': profile.given_name || profile.givenName || undefined,
            'Family Name': profile.family_name || profile.familyName || undefined,
            'Birthday': profile.birthday || undefined,
            'Recovery Email': profile.recovery_email || profile.recoveryEmail || undefined,
            'Secondary Email': profile.secondary_email || profile.secondaryEmail || undefined,
            'Recovery SMS': profile.recovery_sms || profile.recoverySms || undefined,
            'Registration / TOS IP': registrationIp ? String(registrationIp).trim() : undefined,
            'Services': Array.isArray(profile.services) ? profile.services.join(', ') : (profile.services || undefined),
            'Unregistered Services': Array.isArray(profile.unregistered_services) ? profile.unregistered_services.join(', ') : (profile.unregistered_services || undefined),
            'Status': profile.status || undefined,
            'Last Updated': profile.last_updated || profile.lastUpdated || undefined,
            'Last Logins': Array.isArray(profile.last_logins) ? profile.last_logins.join(', ') : (profile.last_logins || undefined),
            'TOS Language': profile.tos_language || profile.tosLanguage || undefined
          }
        };

        events.push({
          id: `google-acct-reg-${Date.now()}`,
          timestamp: cleanTimestamp(accountInfo.createdDate),
          category: 'profile',
          sender: 'Google Registry',
          content: `Account Profile Registered: ${accountInfo.displayName || accountInfo.username} (${accountInfo.email}) GAIA=${accountInfo.userId || 'N/A'} from IP ${accountInfo.registrationIp || 'N/A'}. Status: ${accountInfo.otherDetails?.['Status'] || 'Active'}.`,
          sourceFile: fileName,
          ipAddress: accountInfo.registrationIp,
          targetAccount: accountInfo.userId || accountInfo.email || accountInfo.username
        });
      } catch (e) {
        console.error("Failed to parse Google subscriber JSON:", e);
      }
    } else if ((() => {
      const pathLower = ((relativePath || '') + '/' + fileName).toLowerCase().replace(/\\/g, '/');
      const nameLower = lowercaseName;
      const hay = pathLower + ' ' + nameLower;
      return (
        hay.includes('subscriberinfo') ||
        hay.includes('subscriber_info') ||
        hay.includes('googleaccount.subscriberinfo') ||
        ((hay.includes('subscriber')) && (nameLower.endsWith('.html') || nameLower.endsWith('.htm') || pathLower.includes('.html') || pathLower.includes('.htm')))
      );
    })()) {
      // HTML SubscriberInfo returns (e.g. username.GAIA#GoogleAccount.SubscriberInfo_001/*.html)
      try {
        const cleanText = content.replace(/<[^>]*>/g, ' ');
        const pathForGaia = ((relativePath || '') + '/' + fileName).replace(/\\/g, '/');

        const originatingIdMatch = cleanText.match(/Originating Identifier:\s*([^\s\[]+)/i);
        const resolvedIdMatch = cleanText.match(/Resolved Identifier:\s*([^\s\[]+)/i);
        const emailMatch = cleanText.match(/Email Address Associated with Google Account ID:\s*([^\s\[]+)/i);
        const serviceMatch = cleanText.match(/Service:\s*([^\r\n]+)/i);
        const dateMatch = cleanText.match(/(?:Created|Date|Registered):\s*([^\r\n]+)/i);

        // Registration / TOS IP from HTML text when present
        const tosIpMatch =
          cleanText.match(/Terms of Service\s*IP[:\s]+([0-9a-fA-F.:]+)/i) ||
          cleanText.match(/TOS\s*IP[:\s]+([0-9a-fA-F.:]+)/i) ||
          cleanText.match(/Registration\s*IP[:\s]+([0-9a-fA-F.:]+)/i) ||
          cleanText.match(/IP\s*(?:at\s*)?Registration[:\s]+([0-9a-fA-F.:]+)/i);

        const email = emailMatch?.[1]?.trim() || originatingIdMatch?.[1]?.trim() || undefined;
        let userId = resolvedIdMatch?.[1]?.trim() || undefined;

        // Fallback: extract GAIA from folder pattern like something.1234567890#GoogleAccount.SubscriberInfo
        if (!userId) {
          const folderGaia =
            pathForGaia.match(/\.(\d{5,})#GoogleAccount\.SubscriberInfo/i) ||
            pathForGaia.match(/(\d{5,})#GoogleAccount\.SubscriberInfo/i);
          if (folderGaia?.[1]) userId = folderGaia[1];
        }

        const username = email && email.includes('@')
          ? email.split('@')[0]
          : (fileName.replace(/\.SubscriberInfo\.html$/i, '').replace(/\.html$/i, '').replace(/\.htm$/i, '') || 'Google User');
        const registrationIp = tosIpMatch?.[1]?.trim() || undefined;

        if (userId || email) {
          accountInfo = {
            userId: userId,
            username: username,
            displayName: username,
            email: email,
            createdDate: dateMatch?.[1]?.trim() || undefined,
            registrationIp: registrationIp,
            otherDetails: {
              'Google Account ID': userId,
              'GAIA ID': userId,
              'Service': serviceMatch?.[1]?.trim() || 'Google Account',
              'Scope': 'Google Returns',
              'Registration / TOS IP': registrationIp,
              'Source': 'SubscriberInfo HTML'
            }
          };

          events.push({
            id: `google-html-subscriber-${Date.now()}`,
            timestamp: cleanTimestamp(accountInfo.createdDate),
            category: 'profile',
            sender: 'Google Registry',
            content: `Account Subscriber Info HTML Parsed: User ${username} (${email || 'No email'}), GAIA=${userId || 'N/A'}${registrationIp ? ` from IP ${registrationIp}` : ''}.`,
            sourceFile: fileName,
            ipAddress: registrationIp,
            targetAccount: accountInfo.userId || accountInfo.email || accountInfo.username
          });
        }
      } catch (e) {
        console.error("Failed to parse Google Subscriber Info HTML:", e);
      }
    } else if ((lowercaseName.includes('bio') || lowercaseName.includes('google_chat_user_info') || lowercaseName.includes('chat_user_info')) && lowercaseName.endsWith('.json')) {
      try {
        const jsonData = JSON.parse(content);
        const bio = jsonData;
        
        accountInfo = {
          userId: bio.user?.email || undefined,
          username: bio.user?.email ? bio.user.email.split('@')[0] : undefined,
          email: bio.user?.email || undefined,
          otherDetails: {
            'Chat User Created Date': bio.created_date || bio.createdDate || undefined,
            'User State': bio.user_state || bio.userState || undefined,
            'DND Settings': typeof bio.dnd_settings === 'object' ? JSON.stringify(bio.dnd_settings) : (bio.dnd_settings || undefined),
            'DND Settings Update Date': bio.dnd_settings_update_date || bio.dndSettingsUpdateDate || undefined,
            'User Settings': typeof bio.user_settings === 'object' ? JSON.stringify(bio.user_settings) : (bio.user_settings || undefined),
            'Custom Status': typeof bio.custom_status === 'object' ? JSON.stringify(bio.custom_status) : (bio.custom_status || undefined),
            'Blocked Rooms': Array.isArray(bio.blocked_rooms) ? bio.blocked_rooms.join(', ') : (bio.blocked_rooms || undefined),
            'Presence Shared': bio.presence_shared !== undefined ? String(bio.presence_shared) : undefined,
            'Revision Date': bio.revision_date || bio.revisionDate || undefined,
            'Status Calculated Date': bio.status_calculated_date || bio.statusCalculatedDate || undefined
          }
        };

        events.push({
          id: `google-chat-bio-${Date.now()}`,
          timestamp: cleanTimestamp(bio.created_date || bio.createdDate),
          category: 'profile',
          sender: 'Google Chat System',
          content: `Google Chat Profile Activated. User Type: ${bio.user?.user_type || 'Human'}, State: ${bio.user_state || 'JOINED'}.`,
          sourceFile: fileName
        });
      } catch (e) {
        console.error("Failed to parse Google Chat Bio JSON:", e);
      }
    } else if (lowercaseName.includes('location history') || lowercaseName.includes('location_history') || lowercaseName.includes('records.json')) {
      try {
        const jsonData = JSON.parse(content);
        const locations = jsonData.locations || [];
        locations.forEach((loc: any, idx: number) => {
          events.push({
            id: `google-loc-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(loc.timestamp || loc.timestampMs),
            category: 'connection',
            sender: 'Google Location Services',
            content: `Latitude: ${loc.latitudeE7 / 1e7}, Longitude: ${loc.longitudeE7 / 1e7}${loc.accuracy ? `, Accuracy: ${loc.accuracy}` : ''}`,
            sourceFile: fileName,
            details: { lat: loc.latitudeE7 / 1e7, lng: loc.longitudeE7 / 1e7, accuracy: loc.accuracy }
          });
        });
      } catch (e) {
        console.error("Failed to parse Google Location JSON:", e);
      }
    } else if ((lowercaseName.includes('search') || lowercaseName.includes('browser') || lowercaseName.includes('browsing') || lowercaseName.includes('chrome') || (lowercaseName.includes('history') && !lowercaseName.includes('location'))) && lowercaseName.endsWith('.json')) {
      try {
        const jsonData = JSON.parse(content);
        let historyItems: any[] = [];
        if (Array.isArray(jsonData)) {
          historyItems = jsonData;
        } else {
          const possibleKeys = ['browser history', 'browserhistory', 'history', 'search', 'searches', 'browser_history', 'chrome_history'];
          const foundKey = Object.keys(jsonData).find(k => possibleKeys.includes(k.toLowerCase()));
          if (foundKey && Array.isArray(jsonData[foundKey])) {
            historyItems = jsonData[foundKey];
          } else {
            const arrayKey = Object.keys(jsonData).find(k => Array.isArray(jsonData[k]));
            if (arrayKey) {
              historyItems = jsonData[arrayKey];
            } else {
              historyItems = [jsonData];
            }
          }
        }

        historyItems.forEach((item: any, idx: number) => {
          const timestamp = item.time || item.timestamp || item.date || item.time_usec || item.timestamp_usec || Date.now();
          let cleanTime = '';
          if (typeof timestamp === 'number' && String(timestamp).length > 13) {
            cleanTime = new Date(timestamp / 1000).toISOString();
          } else {
            cleanTime = cleanTimestamp(timestamp);
          }

          const title = item.title || item.query || item.search_query || item.url || 'Unknown Browsing Item';
          const url = item.titleUrl || item.url || item.uri || '';
          
          let ip: string | undefined = undefined;
          if (Array.isArray(item.details)) {
            const ipDetail = item.details.find((d: any) => d?.name?.toLowerCase().includes('ip') || d?.value?.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/));
            if (ipDetail) {
              ip = ipDetail.value;
            }
          }
          if (!ip && item.ipAddress) ip = item.ipAddress;
          if (!ip && item.ip_address) ip = item.ip_address;

          const products = item.products ? item.products.join(', ') : (lowercaseName.includes('search') ? 'Search' : 'Chrome');

          events.push({
            id: `google-hist-${idx}-${Date.now()}`,
            timestamp: cleanTime,
            category: 'other',
            sender: products || 'Google Browser History',
            content: url ? `Visited: "${title}" (URL: ${url})` : `Activity: "${title}"`,
            ipAddress: ip,
            sourceFile: fileName,
            details: {
              title,
              url,
              products,
              ipAddress: ip
            }
          });
        });
      } catch (e) {
        console.error("Failed to parse Google Search/Browsing history JSON:", e);
      }
    } else if ((lowercaseName.includes('search') || lowercaseName.includes('browser') || lowercaseName.includes('browsing') || lowercaseName.includes('chrome') || (lowercaseName.includes('history') && !lowercaseName.includes('location'))) && lowercaseName.endsWith('.csv')) {
      try {
        const rows = parseCSV(content);
        if (rows.length > 1) {
          const headers = rows[0].map(h => h.trim().toLowerCase());
          const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('query') || h.includes('search') || h.includes('name'));
          const urlIdx = headers.findIndex(h => h.includes('url') || h.includes('link') || h.includes('uri') || h.includes('address'));
          const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('time') || h.includes('timestamp'));
          const ipIdx = headers.findIndex(h => h.includes('ip') || h.includes('ipaddress') || h.includes('ip_address'));

          if (titleIdx !== -1 || urlIdx !== -1 || dateIdx !== -1) {
            for (let i = 1; i < rows.length; i++) {
              const cols = rows[i];
              if (!cols || cols.every(c => !String(c || '').trim())) continue;
              const title = cols[titleIdx] || cols[urlIdx] || 'Search/Browsing Entry';
              const url = cols[urlIdx] || '';
              const date = cols[dateIdx];
              const ip = cols[ipIdx] || undefined;

              events.push({
                id: `google-hist-csv-${i}-${Date.now()}`,
                timestamp: cleanTimestamp(date),
                category: 'other',
                sender: lowercaseName.includes('search') ? 'Google Search' : 'Google Browser History',
                content: url ? `Visited: "${title}" (URL: ${url})` : `Activity: "${title}"`,
                ipAddress: ip,
                sourceFile: fileName,
                details: {
                  title,
                  url,
                  ipAddress: ip
                }
              });
            }
          }
        }
      } catch (e) {
        console.error("Failed to parse Google Search/Browsing history CSV:", e);
      }
    } else if (lowercaseName.includes('activity') && lowercaseName.endsWith('.json')) {
       try {
        const jsonData = JSON.parse(content);
        const activities = Array.isArray(jsonData) ? jsonData : (jsonData.activities || []);
        activities.forEach((act: any, idx: number) => {
          events.push({
            id: `google-act-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(act.time || act.timestamp),
            category: 'other',
            sender: act.header || 'Google Activity',
            content: act.title || 'Unknown Activity',
            sourceFile: fileName,
            details: { products: act.products?.join(', ') }
          });
        });
      } catch (e) {
        console.error("Failed to parse Google Activity JSON:", e);
      }
    } else if (lowercaseName.includes('devices') && lowercaseName.endsWith('.json')) {
       try {
        const jsonData = JSON.parse(content);
        const devices = Array.isArray(jsonData) ? jsonData : (jsonData.devices || []);
        devices.forEach((dev: any, idx: number) => {
          const deviceName = dev.deviceModel || dev.brand || dev.os || 'Unknown Device';
          events.push({
            id: `google-dev-${idx}-${Date.now()}`,
            timestamp: cleanTimestamp(dev.lastLoginTime || dev.lastSyncTime),
            category: 'connection',
            sender: 'Device Login',
            content: `Device Sync/Login: ${deviceName}`,
            ipAddress: dev.lastLoginIp || undefined,
            sourceFile: fileName,
            details: dev
          });
        });
      } catch (e) {
        console.error("Failed to parse Google Devices JSON:", e);
      }
    } else if (
      lowercaseName.endsWith('.mbox') ||
      lowercaseName.endsWith('.eml') ||
      (
        (lowercaseName.includes('mail') || lowercaseName.includes('messages') || lowercaseName.includes('mbox')) &&
        (content.includes('From ') || content.includes('Service: Mail') || content.includes('Resource: Messages')) &&
        !lowercaseName.endsWith('.json') &&
        !lowercaseName.endsWith('.csv')
      )
    ) {
      // Full mbox / eml MIME parsing (restored from V3)
      try {
        const isEml = lowercaseName.endsWith('.eml');
        const rawParts = (isEml && !content.includes('From ')) ? [content] : content.split(/^From /m);
        const parts = rawParts.slice(0, 2000);

        // Parse Google Forensic metadata sheets if prepended
        if (parts[0] && (parts[0].includes('Service: Mail') || parts[0].includes('Originating Identifier:'))) {
          try {
            const cleanText = parts[0].replace(/<[^>]*>/g, ' ');
            const originatingIdMatch = cleanText.match(/Originating Identifier:\s*([^\s\[\n\r]+)/i);
            const resolvedIdMatch = cleanText.match(/Resolved Identifier:\s*([^\s\[\n\r]+)/i);
            const emailMatch = cleanText.match(/Email Address Associated with Google Account ID:\s*([^\s\[\n\r]+)/i);

            const email = emailMatch?.[1] || originatingIdMatch?.[1] || undefined;
            const userId = resolvedIdMatch?.[1] || undefined;
            const username = email && email.includes('@') ? email.split('@')[0] : 'Google User';

            if (userId || email) {
              accountInfo = {
                userId: userId,
                username: username,
                displayName: username,
                email: email,
                createdDate: undefined,
                otherDetails: {
                  'Google Account ID': userId,
                  'GAIA ID': userId,
                  'Service': 'Mail Messages',
                  'Scope': 'Google Mail Returns'
                }
              };
            }
          } catch (e) {
            console.error("Failed to parse MBOX forensic header sheet:", e);
          }
        }

        const mailTarget = accountInfo?.userId || accountInfo?.email || accountInfo?.username;

        parts.forEach((part, idx) => {
          if (!part.trim()) return;

          // Skip the forensic header sheet so it doesn't render as a blank email
          if (idx === 0 && (part.includes('Service: Mail') || part.includes('Originating Identifier:'))) {
            return;
          }

          try {
            const doubleNewlineMatch = part.match(/\r?\n\r?\n/);
            let headerBodySplit = -1;
            let splitLength = 2;

            if (doubleNewlineMatch && doubleNewlineMatch.index !== undefined) {
              headerBodySplit = doubleNewlineMatch.index;
              splitLength = doubleNewlineMatch[0].length;
            }

            let headersStr = '';
            let bodyStr = '';

            if (headerBodySplit !== -1) {
              headersStr = part.slice(0, headerBodySplit);
              bodyStr = part.slice(headerBodySplit + splitLength);
            } else {
              headersStr = part;
            }

            const headerLines = headersStr.split(/\r?\n/);
            const headers: Record<string, string> = {};
            let currentHeaderName = '';
            for (const line of headerLines) {
              if (line.startsWith(' ') || line.startsWith('\t')) {
                if (currentHeaderName) {
                  headers[currentHeaderName] += ' ' + line.trim();
                }
              } else {
                const colonIdx = line.indexOf(':');
                if (colonIdx !== -1) {
                  const name = line.slice(0, colonIdx).trim().toLowerCase();
                  const value = line.slice(colonIdx + 1).trim();
                  currentHeaderName = name;
                  headers[name] = value;
                }
              }
            }

            const from = headers['from'] || 'Unknown Sender';
            const to = headers['to'] || 'Unknown Recipient';
            const subject = headers['subject'] || '(No Subject)';
            const dateStr = headers['date'] || new Date().toISOString();
            const ipAddress = headers['x-originating-ip'] || headers['received']?.match(/\[([0-9a-fA-F.:]+)\]/)?.[1] || undefined;

            const mimeBodies = extractMimeBodies(bodyStr, headers);
            const cleanedBody = cleanMimeBody(bodyStr, headers);
            const htmlBody = mimeBodies.html || '';

            events.push({
              id: headers['message-id'] || `mbox-email-${fileName}-${idx}`,
              timestamp: cleanTimestamp(dateStr),
              category: 'message',
              sender: from,
              recipient: to,
              content: cleanedBody,
              ipAddress: ipAddress,
              sourceFile: fileName,
              targetAccount: mailTarget,
              details: {
                isEmail: true,
                subject: subject,
                body: cleanedBody,
                htmlBody: htmlBody || undefined,
                from: from,
                to: to,
                cc: headers['cc'] || '',
                bcc: headers['bcc'] || '',
                labels: headers['x-gmail-labels']?.split(',').map(l => l.trim()) || [],
                ipAddress: ipAddress
              }
            });
          } catch (itemErr) {
            console.warn(`Failed parsing email part ${idx} in file ${fileName}:`, itemErr);
          }
        });
      } catch (err) {
        console.error("Failed parsing mbox or eml:", err);
      }
    } else if (
      lowercaseName.includes('email') ||
      lowercaseName.includes('gmail') ||
      (lowercaseName.includes('mail') && (lowercaseName.endsWith('.json') || lowercaseName.endsWith('.csv')))
    ) {
      if (lowercaseName.endsWith('.json')) {
        try {
          let parsedData: any;
          try {
            parsedData = JSON.parse(content);
          } catch (firstErr) {
            const cleanedContent = content.replace(/\\'/g, "'");
            parsedData = JSON.parse(cleanedContent);
          }
          const jsonData = parsedData;
          const emailsList = Array.isArray(jsonData) ? jsonData : (jsonData.emails || jsonData.messages || []);
          emailsList.forEach((em: any, idx: number) => {
            const htmlBody = em.htmlBody || em.html || em.bodyHtml || '';
            const plainBody = em.body || em.content || (htmlBody ? String(htmlBody).replace(/<[^>]*>/g, ' ') : '') || em.snippet || '';
            events.push({
              id: em.id || `google-email-${idx}-${Date.now()}`,
              timestamp: cleanTimestamp(em.date || em.timestamp || em.createdAt),
              category: 'message',
              sender: em.from || em.sender || 'Unknown Sender',
              recipient: em.to || em.recipient || 'Unknown Recipient',
              content: `[Email Subject: ${em.subject || 'No Subject'}] ${plainBody}`,
              ipAddress: em.ipAddress || em.ip_address || undefined,
              sourceFile: fileName,
              details: {
                isEmail: true,
                subject: em.subject || '(No Subject)',
                body: plainBody,
                htmlBody: htmlBody || undefined,
                from: em.from || em.sender || '',
                to: em.to || em.recipient || '',
                cc: em.cc || '',
                bcc: em.bcc || '',
                labels: em.labels || [],
                attachment: em.attachment || em.attachments || undefined,
                ipAddress: em.ipAddress || em.ip_address || undefined
              }
            });
          });
        } catch (e) {
          // JSON parsing failure
        }
      } else if (lowercaseName.endsWith('.csv')) {
        try {
          const rows = parseCSV(content);
          if (rows.length > 1) {
            const headers = rows[0].map(h => h.trim().toLowerCase());
            const subjectIdx = headers.findIndex(h => h.includes('subject'));
            const fromIdx = headers.findIndex(h => h.includes('from') || h.includes('sender'));
            const toIdx = headers.findIndex(h => h.includes('to') || h.includes('recipient'));
            const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('timestamp'));
            const bodyIdx = headers.findIndex(h => h.includes('body') || h.includes('content') || h.includes('snippet'));
            const ipIdx = headers.findIndex(h => h.includes('ip') || h.includes('ipaddress') || h.includes('ip_address'));

            if (subjectIdx !== -1 || fromIdx !== -1 || toIdx !== -1) {
              for (let i = 1; i < rows.length; i++) {
                const cols = rows[i];
                if (!cols || cols.every(c => !String(c || '').trim())) continue;
                const subject = cols[subjectIdx] || 'No Subject';
                const from = cols[fromIdx] || 'Unknown Sender';
                const to = cols[toIdx] || 'Unknown Recipient';
                const date = cols[dateIdx];
                const body = cols[bodyIdx] || '';
                const ip = cols[ipIdx] || undefined;

                events.push({
                  id: `google-email-csv-${i}-${Date.now()}`,
                  timestamp: cleanTimestamp(date),
                  category: 'message',
                  sender: from,
                  recipient: to,
                  content: `[Email Subject: ${subject}] ${body}`,
                  ipAddress: ip,
                  sourceFile: fileName,
                  details: {
                    isEmail: true,
                    subject,
                    body,
                    from,
                    to,
                    ipAddress: ip
                  }
                });
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse Google email CSV:", e);
        }
      }
    }
  } else if (provider === 'twitter') {
    const cleaned = cleanTwitterJson(content);
    const isJsonLike = cleaned.startsWith('[') || cleaned.startsWith('{');

    if (!isJsonLike) {
      console.warn(`Twitter/X Corp file "${fileName}" does not contain JSON/JS formatted data; skipping JSON parsing.`);
    } else {
      if (lowercaseName.includes('account') || lowercaseName.includes('account-limited')) {
        try {
          const data = JSON.parse(cleaned);
          const accountObj = Array.isArray(data) ? (data[0]?.account || data[0]) : (data.account || data);
          if (accountObj) {
            accountInfo = {
              userId: accountObj.accountId || accountObj.userId,
              username: accountObj.username,
              displayName: accountObj.accountDisplayName || accountObj.username,
              email: accountObj.email,
              phone: accountObj.phone,
              createdDate: cleanTimestamp(accountObj.createdAt),
              registrationIp: accountObj.createdVia,
              otherDetails: {
                'Created Via': accountObj.createdVia || 'Unknown'
              }
            };

            events.push({
              id: `tw-acct-${Date.now()}`,
              timestamp: cleanTimestamp(accountObj.createdAt),
              category: 'profile',
              sender: 'X/Twitter System',
              content: `Account Profile Registered: @${accountObj.username} (ID: ${accountObj.accountId || 'N/A'}, Email: ${accountObj.email || 'N/A'})`,
              sourceFile: fileName
            });
          }
        } catch (e) {
          console.warn("Failed to parse Twitter account details JSON:", e);
        }
      } else if (lowercaseName.includes('profile')) {
        try {
          const data = JSON.parse(cleaned);
          const profileObj = Array.isArray(data) ? (data[0]?.profile || data[0]) : (data.profile || data);
          if (profileObj) {
            const bio = profileObj.description?.bio || '';
            const location = profileObj.description?.location || '';
            const website = profileObj.description?.website || '';
            accountInfo = {
              userId: '',
              username: '',
              displayName: '',
              otherDetails: {
                'Biography': bio,
                'Location': location,
                'Website': website
              }
            };
            
            events.push({
              id: `tw-prof-${Date.now()}`,
              timestamp: 'Unknown',
              category: 'profile',
              sender: 'X/Twitter System',
              content: `Profile Info parsed. Bio: "${bio}" | Location: "${location}"`,
              sourceFile: fileName
            });
          }
        } catch (e) {
          console.warn("Failed to parse Twitter profile JSON:", e);
        }
      } else if (lowercaseName.includes('direct-message') || lowercaseName.includes('direct-messages')) {
        try {
          const data = JSON.parse(cleaned);
          const conversations = Array.isArray(data) ? data : [data];
          
          conversations.forEach((convWrapper: any, convIdx: number) => {
            const conv = convWrapper.dmConversation || convWrapper;
            if (!conv) return;

            const convId = conv.conversationId || `conv-${convIdx}`;
            const messages = conv.messages || [];

            messages.forEach((msgWrapper: any, msgIdx: number) => {
              const msg = msgWrapper.messageCreate || msgWrapper;
              if (!msg) return;

              const text = msg.text || '';
              const senderId = msg.senderId || 'unknown';
              const recipientId = msg.recipientId || 'unknown';
              const timestamp = cleanTimestamp(msg.createdAt);
              const msgId = msg.id || `tw-msg-${convId}-${msgIdx}-${Date.now()}`;

              // Check for media attachment
              let mediaName: string | undefined = undefined;
              if (msg.mediaUrls && msg.mediaUrls.length > 0) {
                const url = msg.mediaUrls[0];
                const parts = url.split('/');
                mediaName = parts[parts.length - 1]?.split('?')[0];
              }

              // Reaction tracking
              let reactionText = '';
              if (msg.reactions && msg.reactions.length > 0) {
                const rDetails = msg.reactions.map((r: any) => {
                  return `${r.senderId} reacted with ${r.reactionKey}`;
                }).join(', ');
                reactionText = ` [Reactions: ${rDetails}]`;
              }

              events.push({
                id: msgId,
                timestamp,
                category: 'message',
                sender: senderId,
                recipient: recipientId,
                content: text + reactionText,
                sourceFile: fileName,
                details: {
                  conversationId: convId,
                  resolvedMediaName: mediaName,
                  attachmentUrl: msg.mediaUrls?.[0],
                  reactions: msg.reactions
                }
              });
            });
          });
        } catch (e) {
          console.warn("Failed to parse Twitter DMs JSON:", e);
        }
      } else if (lowercaseName.includes('tweet') || lowercaseName.includes('tweets')) {
        try {
          const data = JSON.parse(cleaned);
          const tweetsList = Array.isArray(data) ? data : [data];

          tweetsList.forEach((tweetWrapper: any, idx: number) => {
            const t = tweetWrapper.tweet || tweetWrapper;
            if (!t) return;

            const text = t.full_text || t.text || '';
            const tweetId = t.id_str || t.id || `tweet-${idx}`;
            const timestamp = cleanTimestamp(t.created_at);
            const isDeleted = lowercaseName.includes('deleted');

            let mediaName: string | undefined = undefined;
            const mediaArray = t.entities?.media || [];
            if (mediaArray.length > 0) {
              const url = mediaArray[0].media_url_https || mediaArray[0].media_url || '';
              const parts = url.split('/');
              mediaName = parts[parts.length - 1]?.split('?')[0];
            }

            events.push({
              id: `tw-tweet-${tweetId}`,
              timestamp,
              category: 'message',
              sender: '@Me (My Tweets)',
              content: text,
              sourceFile: fileName,
              details: {
                conversationId: isDeleted ? 'deleted-tweets' : 'tweets',
                conversationName: isDeleted ? 'My Deleted Tweets & Posts' : 'My Tweets & Posts',
                resolvedMediaName: mediaName,
                favoriteCount: t.favorite_count,
                retweetCount: t.retweet_count,
                source: t.source
              }
            });
          });
        } catch (e) {
          console.warn("Failed to parse Twitter tweets JSON:", e);
        }
      } else if (lowercaseName.includes('like') || lowercaseName.includes('likes')) {
        try {
          const data = JSON.parse(cleaned);
          const likesList = Array.isArray(data) ? data : [data];

          likesList.forEach((likeWrapper: any, idx: number) => {
            const l = likeWrapper.like || likeWrapper;
            if (!l) return;

            events.push({
              id: `tw-like-${l.tweetId || idx}`,
              timestamp: 'Unknown',
              category: 'message',
              sender: '@LikedTweetOwner',
              content: l.fullText || `Liked Tweet (ID: ${l.tweetId})`,
              sourceFile: fileName,
              details: {
                conversationId: 'likes',
                conversationName: 'My Liked Tweets',
                expandedUrl: l.expandedUrl,
                tweetId: l.tweetId
              }
            });
          });
        } catch (e) {
          console.warn("Failed to parse Twitter Likes JSON:", e);
        }
      } else if (lowercaseName.includes('ip-audit') || lowercaseName.includes('ip_audit') || lowercaseName.includes('ipaudit')) {
        try {
          const data = JSON.parse(cleaned);
          const audits = Array.isArray(data) ? data : [data];

          audits.forEach((audWrapper: any, idx: number) => {
            const aud = audWrapper.ipAudit || audWrapper;
            if (!aud) return;

            events.push({
              id: `tw-ip-${idx}-${Date.now()}`,
              timestamp: cleanTimestamp(aud.createdAt),
              category: 'connection',
              sender: 'X/Twitter Security Audit',
              content: `Security Login Session. Account ID: ${aud.accountId || 'Me'}`,
              ipAddress: aud.loginIp,
              sourceFile: fileName,
              details: aud
            });
          });
        } catch (e) {
          console.warn("Failed to parse Twitter IP audits JSON:", e);
        }
      } else if (lowercaseName.includes('block') || lowercaseName.includes('mute')) {
        try {
          const data = JSON.parse(cleaned);
          const blocks = Array.isArray(data) ? data : [data];

          blocks.forEach((blWrapper: any, idx: number) => {
            const b = blWrapper.block || blWrapper.mute || blWrapper;
            if (!b) return;

            events.push({
              id: `tw-block-${idx}-${Date.now()}`,
              timestamp: 'Unknown',
              category: 'other',
              sender: lowercaseName.includes('block') ? 'X/Twitter Blocklist' : 'X/Twitter Mutelist',
              content: `${lowercaseName.includes('block') ? 'Blocked' : 'Muted'} Account ID: ${b.accountId || 'N/A'} (Link: ${b.userLink || 'N/A'})`,
              sourceFile: fileName,
              details: b
            });
          });
        } catch (e) {
          console.warn("Failed to parse Twitter blocks/mutes JSON:", e);
        }
      }
    }
  }

  // Stamp account identity on ALL events (every provider), not only Snapchat path-derived ones
  const resolvedTarget =
    accountInfo?.username?.trim() ||
    accountInfo?.userId?.trim() ||
    (fileTargetAccount && fileTargetAccount !== 'Unknown' ? fileTargetAccount : undefined);

  const resolvedAccountKey = buildAccountKey(
    provider,
    accountInfo?.userId,
    accountInfo?.username || resolvedTarget
  );

  if (accountInfo && !accountInfo.provider) {
    accountInfo = { ...accountInfo, provider, accountKey: resolvedAccountKey };
  } else if (accountInfo && !accountInfo.accountKey) {
    accountInfo = { ...accountInfo, accountKey: resolvedAccountKey };
  }

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const target = evt.targetAccount || resolvedTarget;
    const key = evt.accountKey || (target
      ? buildAccountKey(provider, accountInfo?.userId, accountInfo?.username || target)
      : resolvedAccountKey);
    if (target || key) {
      events[i] = {
        ...evt,
        targetAccount: target || evt.targetAccount,
        accountKey: key || evt.accountKey,
      };
    }
  }

  // Ensure and compute standard result output
  return buildParseResult(provider, events, accountInfo);
}

// Consolidate files parsed into a single consistent result
export function buildParseResult(
  provider: ProviderType,
  events: ForensicEvent[],
  accountInfo?: ParseResult['accountInfo']
): ParseResult {
  let messagesCount = 0;
  let connectionsCount = 0;
  let filesCount = 0;
  let callsCount = 0;
  const uniqueIPsSet = new Set<string>();

  let earliest: Date | null = null;
  let latest: Date | null = null;

  events.forEach(evt => {
    if (evt.category === 'message') messagesCount++;
    else if (evt.category === 'connection') connectionsCount++;
    else if (evt.category === 'file') filesCount++;
    else if (evt.category === 'call') callsCount++;

    if (evt.ipAddress && evt.ipAddress.trim() !== '') {
      uniqueIPsSet.add(evt.ipAddress.trim());
    }

    const ms = eventSortMs(evt);
    if (Number.isFinite(ms) && ms !== Number.POSITIVE_INFINITY) {
      const d = new Date(ms);
      if (!earliest || d < earliest) earliest = d;
      if (!latest || d > latest) latest = d;
    }
  });

  return {
    provider,
    events: events.sort((a, b) => eventSortMs(a) - eventSortMs(b)),
    accountInfo,
    summaryStats: {
      totalEvents: events.length,
      messagesCount,
      connectionsCount,
      filesCount,
      callsCount,
      uniqueIPs: Array.from(uniqueIPsSet),
      dateRange: earliest && latest ? { start: earliest.toISOString(), end: latest.toISOString() } : null
    }
  };
}

// Dynamically resolves a media reference against a list of file names uploadable in the workspace
export function resolveMediaFile(mediaRef: string, allFileNames: string[]): string | null {
  if (!mediaRef) return null;
  const refLower = mediaRef.toLowerCase();

  // Pass 1: exact stem match
  for (const name of allFileNames) {
    const lastDotIdx = name.lastIndexOf('.');
    const stem = lastDotIdx !== -1 ? name.substring(0, lastDotIdx) : name;
    if (stem === mediaRef) return name;
  }
  for (const name of allFileNames) {
    const lastDotIdx = name.lastIndexOf('.');
    const stem = lastDotIdx !== -1 ? name.substring(0, lastDotIdx) : name;
    if (stem.toLowerCase() === refLower) return name;
  }

  // Pass 2: filename starts with ref
  for (const name of allFileNames) {
    if (name.startsWith(mediaRef)) return name;
  }
  for (const name of allFileNames) {
    if (name.toLowerCase().startsWith(refLower)) return name;
  }

  // Pass 3: filename contains ref anywhere
  for (const name of allFileNames) {
    if (name.includes(mediaRef)) return name;
  }
  for (const name of allFileNames) {
    if (name.toLowerCase().includes(refLower)) return name;
  }

  // Pass 4: try alphanumeric block of ref >= 10 characters, sorted longest first
  const blocks10 = (mediaRef.match(/[a-zA-Z0-9]{10,}/g) || []).sort((a, b) => b.length - a.length);
  for (const block of blocks10) {
    const blockLower = block.toLowerCase();
    for (const name of allFileNames) {
      if (name.includes(block) || name.toLowerCase().includes(blockLower)) return name;
    }
  }

  // Pass 5: try alphanumeric block of ref >= 8 characters, sorted longest first
  const blocks8 = (mediaRef.match(/[a-zA-Z0-9]{8,}/g) || []).sort((a, b) => b.length - a.length);
  for (const block of blocks8) {
    const blockLower = block.toLowerCase();
    for (const name of allFileNames) {
      if (name.includes(block) || name.toLowerCase().includes(blockLower)) return name;
    }
  }

  return null;
}

function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBase64(str: string): string {
  try {
    const binary = atob(str.replace(/\s/g, ''));
    try { return decodeURIComponent(escape(binary)); }
    catch { return binary; }
  } catch (e) { return str; }
}

function parseHeaderBlock(str: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let currentHeaderName = '';
  for (const line of str.split(/\r?\n/)) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (currentHeaderName) headers[currentHeaderName] += ' ' + line.trim();
    } else {
      const colon = line.indexOf(':');
      if (colon !== -1) {
        const name = line.slice(0, colon).trim().toLowerCase();
        currentHeaderName = name;
        headers[name] = line.slice(colon + 1).trim();
      }
    }
  }
  return headers;
}

function extractMimePart(rawPart: string): { headers: Record<string, string>; body: string } | null {
  const trimmedPart = rawPart.trim();
  if (!trimmedPart || trimmedPart === '--') return null;
  const hb = trimmedPart.match(/\r?\n\r?\n/);
  let partHeadersStr = '', partBodyStr = '';
  if (hb && hb.index !== undefined) {
    partHeadersStr = trimmedPart.slice(0, hb.index);
    partBodyStr = trimmedPart.slice(hb.index + hb[0].length);
  } else {
    partBodyStr = trimmedPart;
  }
  return { headers: parseHeaderBlock(partHeadersStr), body: partBodyStr };
}

function extractTextFromMime(body: string, headers: Record<string, string>, depth: number = 0): { text: string; html: string } {
  if (depth > 6) return { text: '', html: '' };
  const contentType = (headers['content-type'] || '').toLowerCase();
  const encoding = (headers['content-transfer-encoding'] || '').toLowerCase();

  if (contentType.includes('multipart')) {
    const boundaryMatch = (headers['content-type'] || '').match(/boundary="?([^";\s]+)"?/i);
    if (!boundaryMatch || !boundaryMatch[1]) return { text: body, html: '' };
    const boundary = boundaryMatch[1];
    const rawParts = body.split('--' + boundary);
    let text = '', html = '', fallback = '';

    for (const rawPart of rawParts) {
      const parsed = extractMimePart(rawPart);
      if (!parsed) continue;
      const childCT = (parsed.headers['content-type'] || '').toLowerCase();
      const childEncoding = (parsed.headers['content-transfer-encoding'] || '').toLowerCase();
      const disposition = (parsed.headers['content-disposition'] || '').toLowerCase();

      if (childCT.includes('multipart')) {
        const nested = extractTextFromMime(parsed.body, parsed.headers, depth + 1);
        if (nested.text && !text) text = nested.text;
        if (nested.html && !html) html = nested.html;
        continue;
      }

      if (disposition.includes('attachment')) continue;

      let decoded = parsed.body;
      if (childEncoding.includes('quoted-printable')) decoded = decodeQuotedPrintable(decoded);
      else if (childEncoding.includes('base64')) decoded = decodeBase64(decoded);

      if (childCT.includes('text/plain') && !text) text = decoded;
      else if (childCT.includes('text/html') && !html) html = decoded;
      else if (!fallback && decoded.trim() && !childCT.includes('application/')) fallback = decoded;
    }
    return { text: text || fallback, html };
  }

  let decoded = body;
  if (encoding.includes('quoted-printable')) decoded = decodeQuotedPrintable(decoded);
  else if (encoding.includes('base64')) decoded = decodeBase64(decoded);
  if (contentType.includes('text/html')) return { text: '', html: decoded };
  return { text: decoded, html: '' };
}

/** Extract both plain-text and HTML MIME bodies (scripts never execute here). */
function extractMimeBodies(body: string, headers: Record<string, string>): { text: string; html: string } {
  return extractTextFromMime(body, headers);
}

function cleanMimeBody(body: string, headers: Record<string, string>): string {
  const { text, html } = extractMimeBodies(body, headers);
  let cleaned = text || (html ? html.replace(/<[^>]*>/g, ' ') : body);
  return cleaned
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}
