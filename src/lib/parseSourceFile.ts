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
  const bytes = new Uint8Array(fs.readFileSync(sourcePath));
  const lower = name.toLowerCase();
  const spreadsheet = lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.includes('message_transaction_records');
  if (spreadsheet && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return parseDiscordWorkbook(provider, name, bytes, relativePath);
  }
  const content = Buffer.from(bytes).toString('utf8');
  return parseForensicFile(provider, name, content, relativePath);
}

export function readTextPreview(sourcePath: string, maxChars = 8000): string {
  const fd = fs.openSync(sourcePath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(maxChars * 4, 256 * 1024));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8').slice(0, maxChars);
  } finally {
    fs.closeSync(fd);
  }
}
