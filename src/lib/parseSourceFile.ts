/**
 * Parse one warrant file from disk in the server process.
 * The renderer never has to hold the raw file text.
 * Original files are read only.
 */

import fs from 'fs';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import type { ParseResult, ProviderType } from '../types';
import { extractTextFromPdfContent, parseForensicFile } from '../parserHelper';
import { isDropboxUserReport } from './dropboxPath';
import { extractPositionedPdfText } from './pdfText';
import zlib from 'zlib';
import { parseDiscordWorkbook } from './discordWorkbook';
import { parseGoogleFromDisk } from './googleStream';
import { decodeTextBuffer, detectTextEncoding } from './textDecode';
import type { SkippedItem } from './returnLog';
import { classifyByHead, FS_READ_LIMIT, isPdfMagic } from './binaryKind';

/** Never decode a whole multi-gigabyte production into one JavaScript string. */
const MAX_WHOLE_FILE = 8 * 1024 * 1024;

export interface ParsedSource extends ParseResult {
  warnings?: SkippedItem[];
}

let domReady = false;
function ensureServerDomParser(): void {
  if (domReady) return;
  domReady = true;
  const g = globalThis as unknown as { DOMParser?: unknown };
  if (typeof g.DOMParser === 'undefined') {
    g.DOMParser = XmlDOMParser;
  }
}

function readHead(sourcePath: string, size: number): Buffer {
  const fd = fs.openSync(sourcePath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(64, size));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function emptyParse(provider: ProviderType, warnings: SkippedItem[]): ParsedSource {
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
      dateRange: null,
    },
    warnings,
  };
}

function readEncodedPrefix(sourcePath: string, maxChars: number): string {
  const fd = fs.openSync(sourcePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const sniffLen = Math.min(512, stat.size);
    const sniff = Buffer.alloc(sniffLen);
    const sniffed = fs.readSync(fd, sniff, 0, sniff.length, 0);
    const sample = sniff.subarray(0, sniffed);
    if (classifyByHead('file.txt', sample, stat.size) === 'binary') return '';
    const encoding = detectTextEncoding(sample);
    const byteBudget = Math.min(stat.size, encoding === 'utf8' ? maxChars : Math.min(stat.size, maxChars * 2 + 4));
    const buf = Buffer.alloc(byteBudget);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return decodeTextBuffer(buf.subarray(0, n)).slice(0, maxChars);
  } finally {
    fs.closeSync(fd);
  }
}

export async function parseFileAtPath(
  provider: ProviderType,
  name: string,
  sourcePath: string,
  relativePath?: string
): Promise<ParsedSource> {
  ensureServerDomParser();
  const rel = relativePath || name;
  const warnings: SkippedItem[] = [];
  try {
    const stat = fs.statSync(sourcePath);
    const head = readHead(sourcePath, stat.size);
    const dropboxUserPdf = provider === 'dropbox'
      && stat.size > 0
      && stat.size <= 32 * 1024 * 1024
      && (isPdfMagic(head) || name.toLowerCase().endsWith('.pdf'))
      && (isDropboxUserReport(name) || isDropboxUserReport(relativePath || ''));
    if (dropboxUserPdf) {
      const bytes = Buffer.alloc(stat.size);
      const fd = fs.openSync(sourcePath, 'r');
      try { fs.readSync(fd, bytes, 0, bytes.length, 0); } finally { fs.closeSync(fd); }
      let text = '';
      try {
        const positioned = extractPositionedPdfText(new Uint8Array(bytes), data => zlib.inflateSync(Buffer.from(data)));
        const legacy = extractTextFromPdfContent(bytes.toString('latin1'));
        text = positioned.text.length >= legacy.length ? positioned.text : legacy;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push({ relativePath: rel, error: `Could not read Dropbox user report text: ${message}` });
      }
      const parsed = parseForensicFile(provider, name, text, relativePath);
      return { ...parsed, warnings };
    }
    const kind = classifyByHead(name, head, stat.size);
    if (kind === 'binary' || stat.size > FS_READ_LIMIT) {
      warnings.push({
        relativePath: rel,
        error: `Skipped text parse of ${name} (${stat.size} bytes). It is a binary attachment or larger than what can be loaded as one string. The file stays in the return with its name and size.`,
      });
      return emptyParse(provider, warnings);
    }
    if (kind === 'spreadsheet') {
      const bytes = Buffer.alloc(stat.size);
      const fd = fs.openSync(sourcePath, 'r');
      try { fs.readSync(fd, bytes, 0, bytes.length, 0); } finally { fs.closeSync(fd); }
      return parseDiscordWorkbook(provider, name, new Uint8Array(bytes), relativePath);
    }
    if (provider === 'google') {
      const streamed = await parseGoogleFromDisk(name, sourcePath, relativePath);
      if (streamed) return streamed;
    }
    if (stat.size > MAX_WHOLE_FILE) {
      const content = readEncodedPrefix(sourcePath, 1_000_000);
      const parsed = parseForensicFile(provider, name, content, relativePath);
      warnings.push({
        relativePath: rel,
        error: `File is ${stat.size} bytes. Parsed a bounded prefix instead of loading the whole file into one string.`,
      });
      return { ...parsed, warnings };
    }
    const bytes = Buffer.alloc(stat.size);
    const fd = fs.openSync(sourcePath, 'r');
    try { fs.readSync(fd, bytes, 0, bytes.length, 0); } finally { fs.closeSync(fd); }
    const content = decodeTextBuffer(bytes);
    return parseForensicFile(provider, name, content, relativePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push({ relativePath: rel, error: message });
    return emptyParse(provider, warnings);
  }
}

export function readTextPreview(sourcePath: string, maxChars = 8000): { text: string; truncated: boolean } {
  const fd = fs.openSync(sourcePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const cap = Math.min(Math.max(maxChars, 1), 2_000_000);
    const head = Buffer.alloc(Math.min(64, stat.size));
    const headN = fs.readSync(fd, head, 0, head.length, 0);
    if (classifyByHead(sourcePath, head.subarray(0, headN), stat.size) !== 'text') {
      return { text: '', truncated: true };
    }
    const byteBudget = Math.min(stat.size, cap * 4 + 4, FS_READ_LIMIT);
    const buf = Buffer.alloc(byteBudget);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const decoded = decodeTextBuffer(buf.subarray(0, n));
    return { text: decoded.slice(0, cap), truncated: stat.size > n || decoded.length > cap };
  } finally {
    fs.closeSync(fd);
  }
}
