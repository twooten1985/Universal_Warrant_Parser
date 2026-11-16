/**
 * Read large Google CSV, JSON, and mbox files one record at a time.
 * The whole file is not held as a single string.
 */

import fs from 'fs';
import readline from 'readline';
import type { ParseResult } from '../types';
import { buildAccountKey } from '../identity';
import { buildParseResult } from '../parserHelper';
import { accountFromGoogleFolder, extensionOfName, extractIps, googleFolderFromPath } from './googleFolders';
import { googleTime, isDelimitedPreamble, parseGoogleContent, type GoogleParseOutcome } from './googleParse';
import { decodeTextBuffer, detectTextEncoding } from './textDecode';

const BATCH = 1500;

function finish(fileName: string, relativePath: string, outcome: GoogleParseOutcome): ParseResult {
  const folder = googleFolderFromPath(`${relativePath}/${fileName}`);
  const acct = folder ? accountFromGoogleFolder(folder) : null;
  const events = outcome.events.map(evt => ({
    ...evt,
    targetAccount: evt.targetAccount || acct?.targetAccount,
    accountKey: evt.accountKey || acct?.accountKey || (acct ? buildAccountKey('google', acct.gaiaId, acct.username, acct.email) : undefined),
  }));
  const accountInfo = acct
    ? {
        userId: acct.gaiaId,
        username: acct.username,
        email: acct.email,
        displayName: acct.email || acct.username,
        provider: 'google' as const,
        accountKey: acct.accountKey,
      }
    : undefined;
  return buildParseResult('google', events, accountInfo);
}

function lineClock(line: string): string | undefined {
  const m = line.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}|\s+UTC|\s+GMT)?/i);
  if (!m) return undefined;
  const t = googleTime(m[0]);
  return t.untimed ? undefined : t.iso;
}

/** Public IPs on data lines that the column parser did not already emit. */
function sweepMissedIps(lines: string[], fileName: string, events: GoogleParseOutcome['events']): void {
  const have = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const ip = events[i].ipAddress;
    if (ip) have.add(ip);
  }
  const best = new Map<string, string | undefined>();
  for (let i = 0; i < lines.length; i++) {
    const ips = extractIps(lines[i]);
    if (!ips.length) continue;
    const time = lineClock(lines[i]);
    for (let n = 0; n < ips.length; n++) {
      const ip = ips[n];
      if (have.has(ip)) continue;
      const prev = best.get(ip);
      if (prev === undefined && !best.has(ip)) best.set(ip, time);
      else if (!prev && time) best.set(ip, time);
    }
  }
  let n = events.length;
  for (const [ip, time] of best) {
    const untimed = !time;
    events.push({
      id: `google-ip-sweep-${ip}-${n}-${fileName}`,
      timestamp: untimed ? 'Unknown' : time,
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
        untimed,
      },
    });
    n++;
  }
}

async function consumeDelimitedLines(lines: AsyncIterable<string>, fileName: string, relativePath: string): Promise<ParseResult | null> {
  let header = '';
  let batch: string[] = [];
  const sweptLines: string[] = [];
  const events: GoogleParseOutcome['events'] = [];
  let handled = false;
  const flush = () => {
    if (!header || batch.length === 0) return;
    const parsed = parseGoogleContent(fileName, [header, ...batch].join('\n'), relativePath);
    batch = [];
    if (!parsed.handled) return;
    handled = true;
    const offset = events.length;
    for (let i = 0; i < parsed.events.length; i++) events.push({ ...parsed.events[i], id: `${parsed.events[i].id}-s${offset + i}` });
  };
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (!header) {
      if (isDelimitedPreamble(line)) continue;
      header = line;
      continue;
    }
    batch.push(line);
    sweptLines.push(line);
    if (batch.length >= BATCH) flush();
  }
  flush();
  sweepMissedIps(sweptLines, fileName, events);
  if (!handled && events.length === 0) return null;
  return finish(fileName, relativePath, { handled: true, events });
}

async function streamDelimited(filePath: string, fileName: string, relativePath: string): Promise<ParseResult | null> {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  return consumeDelimitedLines(rl, fileName, relativePath);
}

function sniffEncoding(filePath: string): ReturnType<typeof detectTextEncoding> {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(512);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    return detectTextEncoding(head.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
}

/** Pull JSON array elements out of a file without keeping the file text. */
export async function forEachJsonElement(filePath: string, onElement: (value: unknown) => void): Promise<number> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let buf = '';
  let inString = false;
  let escape = false;
  let depth = 0;
  let arrayDepth = -1;
  let capture: string | null = null;
  let captureDepth = 0;
  let count = 0;
  let i = 0;
  const keyBuf: string[] = [];
  let seeingKey = false;
  const watched = /locations|timelineobjects|semanticsegments|rawsignals|activities|messages|features|frequentplaces|devicesettings|members|emails/i;

  const consume = (text: string) => {
    buf += text;
    while (i < buf.length) {
      const c = buf[i];
      if (capture !== null) capture += c;
      if (inString) {
        if (escape) { escape = false; i++; continue; }
        if (c === '\\') { escape = true; i++; continue; }
        if (c === '"') {
          inString = false;
          if (seeingKey) seeingKey = false;
        } else if (seeingKey && keyBuf.length < 80) keyBuf.push(c);
        i++;
        continue;
      }
      if (c === '"') {
        inString = true;
        escape = false;
        if (depth > 0 && capture === null) { seeingKey = true; keyBuf.length = 0; }
        i++;
        continue;
      }
      if (c === '{' || c === '[') {
        if (c === '[' && capture === null) {
          const key = keyBuf.join('');
          if (arrayDepth < 0 && (depth === 0 || watched.test(key))) arrayDepth = depth + 1;
        }
        depth++;
        if (capture === null && c === '{' && arrayDepth > 0 && depth === arrayDepth + 1) {
          capture = '{';
          captureDepth = depth;
        }
        i++;
        continue;
      }
      if (c === '}' || c === ']') {
        if (capture !== null && c === '}' && depth === captureDepth) {
          try { onElement(JSON.parse(capture)); count++; } catch { /* skip a broken element */ }
          capture = null;
        }
        depth--;
        if (arrayDepth > 0 && depth < arrayDepth) arrayDepth = -1;
        i++;
        continue;
      }
      i++;
    }
    if (i > 1_000_000) {
      const keep = capture ? capture.length + 100 : 200;
      const drop = buf.length - keep;
      if (drop > 0) {
        buf = buf.slice(drop);
        i -= drop;
      }
    }
  };

  for await (const chunk of stream) consume(String(chunk));
  return count;
}

async function streamJson(filePath: string, fileName: string, relativePath: string): Promise<ParseResult | null> {
  const events: GoogleParseOutcome['events'] = [];
  let handled = false;
  const count = await forEachJsonElement(filePath, (value) => {
    const parsed = parseGoogleContent(fileName, JSON.stringify(value), relativePath);
    if (!parsed.handled) return;
    handled = true;
    const offset = events.length;
    for (let i = 0; i < parsed.events.length; i++) events.push({ ...parsed.events[i], id: `${parsed.events[i].id}-s${offset + i}` });
  });
  if (!handled || count === 0) return null;
  return finish(fileName, relativePath, { handled: true, events });
}

function decodePart(body: string, encoding: string): string {
  const enc = encoding.toLowerCase();
  if (enc.includes('base64')) {
    try {
      return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
    } catch { return body; }
  }
  if (enc.includes('quoted-printable')) {
    return body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body;
}

export function eventFromMboxMessage(raw: string, index: number, fileName: string): GoogleParseOutcome['events'][number] | null {
  const text = raw.replace(/^From .*\r?\n/, '');
  const splitAt = text.search(/\r?\n\r?\n/);
  const headerText = splitAt >= 0 ? text.slice(0, splitAt) : text;
  const body = splitAt >= 0 ? text.slice(splitAt).replace(/^\r?\n\r?\n/, '') : '';
  if (/^(service|originating identifier)\s*:/i.test(headerText) && !/^from:/im.test(headerText)) return null;
  const headers: Record<string, string> = {};
  let name = '';
  for (const line of headerText.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && name) { headers[name] += ` ${line.trim()}`; continue; }
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    name = line.slice(0, colon).trim().toLowerCase();
    headers[name] = line.slice(colon + 1).trim();
  }
  if (!headers.from && !headers.subject && !headers.date && !headers.to) return null;
  const encoding = headers['content-transfer-encoding'] || '';
  const type = headers['content-type'] || '';
  let plain = '';
  let html = '';
  if (/multipart/i.test(type)) {
    const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
    if (boundary) {
      const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      for (const part of parts) {
        const cut = part.search(/\r?\n\r?\n/);
        if (cut < 0) continue;
        const ph = part.slice(0, cut);
        const pb = part.slice(cut).replace(/^\r?\n\r?\n/, '');
        const cte = /content-transfer-encoding:\s*(.+)/i.exec(ph)?.[1] || '';
        const ct = /content-type:\s*([^;\r\n]+)/i.exec(ph)?.[1] || '';
        const decoded = decodePart(pb, cte);
        if (/text\/html/i.test(ct)) html = html || decoded;
        else if (/text\/plain/i.test(ct)) plain = plain || decoded;
      }
    }
  } else {
    const decoded = decodePart(body, encoding);
    if (/text\/html/i.test(type)) html = decoded;
    else plain = decoded;
  }
  const from = headers.from || 'Unknown Sender';
  const to = headers.to || '';
  const subject = headers.subject || '(No Subject)';
  const when = googleTime(headers.date);
  const ip = headers['x-originating-ip']?.replace(/[<>\[\]]/g, '') || (headers.received || '').match(/\[([0-9a-fA-F.:]+)\]/)?.[1];
  const cleaned = (plain || html.replace(/<[^>]+>/g, ' ')).replace(/\s+\n/g, '\n').trim();
  return {
    id: headers['message-id'] || `mbox-email-${fileName}-${index}`,
    timestamp: when.iso,
    category: 'message',
    sender: from,
    recipient: to || undefined,
    content: cleaned.slice(0, 100000),
    ipAddress: ip || undefined,
    sourceFile: fileName,
    details: {
      provider: 'google',
      isEmail: true,
      googleKind: 'mail',
      subject,
      body: cleaned.slice(0, 100000),
      htmlBody: html ? html.slice(0, 200000) : undefined,
      from,
      to,
      cc: headers.cc || '',
      labels: headers['x-gmail-labels']?.split(',').map(s => s.trim()) || [],
      untimed: when.untimed,
    },
  };
}

async function streamMbox(filePath: string, fileName: string, relativePath: string): Promise<ParseResult> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let carry = '';
  const events: GoogleParseOutcome['events'] = [];
  let index = 0;
  const emit = (block: string) => {
    const evt = eventFromMboxMessage(block, index, fileName);
    index++;
    if (evt) events.push(evt);
  };
  for await (const chunk of stream) {
    carry += chunk;
    let nl = carry.indexOf('\nFrom ');
    while (nl >= 0) {
      emit(carry.slice(0, nl));
      carry = carry.slice(nl + 1);
      nl = carry.indexOf('\nFrom ');
    }
    if (carry.length > 2_000_000 && !carry.includes('\nFrom ')) {
      emit(carry);
      carry = '';
    }
  }
  if (carry.trim()) emit(carry);
  const folder = googleFolderFromPath(`${relativePath}/${fileName}`);
  if (folder) {
    for (let i = 0; i < events.length; i++) {
      events[i] = { ...events[i], details: { ...events[i].details, googleCategory: folder.key, googleProduct: folder.product } };
    }
  }
  return finish(fileName, relativePath, { handled: true, events });
}

/**
 * Stream a Google CSV, JSON, or mbox from disk.
 * Returns null when the file is one the existing in-memory parser still owns.
 */
export async function parseGoogleFromDisk(fileName: string, sourcePath: string, relativePath?: string): Promise<ParseResult | null> {
  const ext = extensionOfName(fileName);
  const rel = relativePath || fileName;
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    if (sniffEncoding(sourcePath) !== 'utf8') {
      const text = decodeTextBuffer(fs.readFileSync(sourcePath));
      return consumeDelimitedLines((async function* () { for (const line of text.split(/\r?\n/)) yield line; })(), fileName, rel);
    }
    const stat = fs.statSync(sourcePath);
    if (stat.size < 256 * 1024) return null;
    return streamDelimited(sourcePath, fileName, rel);
  }
  if (ext === 'json') {
    if (sniffEncoding(sourcePath) !== 'utf8') {
      const text = decodeTextBuffer(fs.readFileSync(sourcePath));
      const parsed = parseGoogleContent(fileName, text, rel);
      if (!parsed.handled) return null;
      return finish(fileName, rel, parsed);
    }
    const stat = fs.statSync(sourcePath);
    if (stat.size < 256 * 1024) return null;
    return streamJson(sourcePath, fileName, rel);
  }
  if (ext === 'mbox') return streamMbox(sourcePath, fileName, rel);
  return null;
}
