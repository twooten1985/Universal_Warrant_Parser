/**
 * Parse one warrant file from disk in the server process.
 * The renderer never has to hold the raw file text.
 * Original files are read only.
 */

import fs from 'fs';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import type { ParseResult, ProviderType } from '../types';
import { parseForensicFile } from '../parserHelper';
import { parseDiscordWorkbook } from './discordWorkbook';
import { parseGoogleFromDisk } from './googleStream';
import { decodeTextBuffer } from './textDecode';

let domReady = false;
function ensureServerDomParser(): void {
  if (domReady) return;
  domReady = true;
  const g = globalThis as unknown as { DOMParser?: unknown };
  if (typeof g.DOMParser === 'undefined') {
    g.DOMParser = XmlDOMParser;
  }
}

export async function parseFileAtPath(
  provider: ProviderType,
  name: string,
  sourcePath: string,
  relativePath?: string
): Promise<ParseResult> {
  ensureServerDomParser();
  if (provider === 'google') {
    const streamed = await parseGoogleFromDisk(name, sourcePath, relativePath);
    if (streamed) return streamed;
  }
  const bytes = fs.readFileSync(sourcePath);
  const lower = name.toLowerCase();
  const spreadsheet = lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.includes('message_transaction_records');
  if (spreadsheet && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return parseDiscordWorkbook(provider, name, new Uint8Array(bytes), relativePath);
  }
  const content = decodeTextBuffer(bytes);
  return parseForensicFile(provider, name, content, relativePath);
}

export function readTextPreview(sourcePath: string, maxChars = 8000): { text: string; truncated: boolean } {
  const fd = fs.openSync(sourcePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const cap = Math.min(Math.max(maxChars, 1), 2_000_000);
    const byteBudget = Math.min(stat.size, cap * 4 + 4);
    const buf = Buffer.alloc(byteBudget);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const decoded = decodeTextBuffer(buf.subarray(0, n));
    return { text: decoded.slice(0, cap), truncated: stat.size > n || decoded.length > cap };
  } finally {
    fs.closeSync(fd);
  }
}
