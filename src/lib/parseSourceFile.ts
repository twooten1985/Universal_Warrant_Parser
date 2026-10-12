/**
 * Parse one warrant file from disk in the server process.
 * The renderer never has to hold the raw file text.
 * Original files are read only.
 */

import fs from 'fs';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import type { ParseResult, ProviderType } from '../types';
import { parseForensicFile } from '../parserHelper';

let domReady = false;
function ensureServerDomParser(): void {
  if (domReady) return;
  domReady = true;
  const g = globalThis as unknown as { DOMParser?: unknown };
  if (typeof g.DOMParser === 'undefined') {
    g.DOMParser = XmlDOMParser;
  }
}

export function parseFileAtPath(
  provider: ProviderType,
  name: string,
  sourcePath: string,
  relativePath?: string
): ParseResult {
  ensureServerDomParser();
  const content = fs.readFileSync(sourcePath, 'utf8');
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
