/**
 * Named hash lists (MD5, SHA-1, SHA-256). Project VIC stays on its own MD5 table.
 * Parsing is chunk-friendly so a large file is never held as one string.
 */

export type HashAlgo = 'md5' | 'sha1' | 'sha256';
export type HashCategory = 'csam' | 'notable' | 'ignorable' | 'custom';

export const HASH_CATEGORIES: Array<{ id: HashCategory; label: string }> = [
  { id: 'csam', label: 'Known CSAM' },
  { id: 'notable', label: 'Notable' },
  { id: 'ignorable', label: 'Ignorable' },
  { id: 'custom', label: 'Custom' },
];

export interface HashSetInfo {
  id: string;
  name: string;
  category: HashCategory;
  hashCount: number;
  createdAt: string;
}

export interface HashHit {
  setId: string;
  name: string;
  category: HashCategory;
}

export interface TabularPreview {
  delimiter: ',' | '\t';
  headers: string[];
  hashColumns: number[];
}

/** Longest token first, and the boundary applies to every length. A bare {32} match would slice SHA-1 into a fake MD5 and SHA-256 into two. */
const HASH_TOKEN = /(?<![a-fA-F0-9])([a-fA-F0-9]{64}|[a-fA-F0-9]{40}|[a-fA-F0-9]{32})(?![a-fA-F0-9])/g;

export const VIC_CHUNK_BYTES = 25 * 1024 * 1024;
/** Longer than a SHA-256 so a hash that starts just before the cut is complete in this read. */
export const VIC_CHUNK_OVERLAP = 100;
const HASH_MAX_CHARS = 64;

export function categoryLabel(category: string): string {
  return HASH_CATEGORIES.find(item => item.id === category)?.label || 'Custom';
}

export function isHashCategory(value: string): value is HashCategory {
  return HASH_CATEGORIES.some(item => item.id === value);
}

export function classifyHash(value: string): HashAlgo | null {
  const hex = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  if (hex.length === 32) return 'md5';
  if (hex.length === 40) return 'sha1';
  if (hex.length === 64) return 'sha256';
  return null;
}

export function normalizeHash(value: string): string | null {
  const algo = classifyHash(value);
  return algo ? value.trim().toLowerCase() : null;
}

/** Pull MD5, SHA-1, and SHA-256 values out of a text fragment. */
export function extractHashesFromText(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  HASH_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HASH_TOKEN.exec(text))) out.push(match[1].toLowerCase());
  return out;
}

export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function headerLooksLikeHash(header: string): boolean {
  const name = header.trim().toLowerCase().replace(/["']/g, '');
  if (!name) return false;
  return name === 'md5' || name === 'sha1' || name === 'sha-1' || name === 'sha256' || name === 'sha-256' || name === 'hash' || name.endsWith('md5') || name.endsWith('sha1') || name.endsWith('sha-1') || name.endsWith('sha256') || name.endsWith('sha-256');
}

/** First-chunk look at a CSV or NSRL-style text file. Null when the file is not a table. */
export function sniffTabular(sample: string): TabularPreview | null {
  const line = sample.split(/\r?\n/).find(row => row.trim().length > 0) || '';
  if (!line || line.trim().startsWith('{') || line.trim().startsWith('[')) return null;
  if (classifyHash(line.trim())) return null;
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  if (tabs === 0 && commas === 0) return null;
  const delimiter: ',' | '\t' = tabs > commas ? '\t' : ',';
  const headers = splitDelimitedLine(line, delimiter).map(cell => cell.trim());
  if (headers.length < 2) return null;
  const hashColumns: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (headerLooksLikeHash(headers[i])) hashColumns.push(i);
  }
  return { delimiter, headers, hashColumns };
}

export function hashesFromPlainChunk(text: string, carry: string): { hashes: string[]; carry: string } {
  const merged = carry + text;
  const tail = merged.match(/[0-9a-fA-F]{1,63}$/);
  let body = merged;
  let nextCarry = '';
  if (tail && tail.index != null && (tail.index === 0 || /[^0-9a-fA-F]/.test(merged.charAt(tail.index - 1)))) {
    nextCarry = tail[0];
    body = merged.slice(0, merged.length - nextCarry.length);
  }
  return { hashes: extractHashesFromText(body), carry: nextCarry };
}

export function hashesFromTabularChunk(
  text: string,
  delimiter: ',' | '\t',
  columns: number[],
  carry: string
): { hashes: string[]; carry: string } {
  const merged = carry + text;
  const endsWithBreak = /\r?\n$/.test(merged);
  const lines = merged.split(/\r?\n/);
  let nextCarry = '';
  if (!endsWithBreak) nextCarry = lines.pop() || '';
  else if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const hashes: string[] = [];
  const wanted = columns.length ? columns : [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitDelimitedLine(line, delimiter);
    for (let c = 0; c < wanted.length; c++) {
      const cell = cells[wanted[c]] || '';
      const found = extractHashesFromText(cell);
      for (let h = 0; h < found.length; h++) hashes.push(found[h]);
    }
  }
  return { hashes, carry: nextCarry };
}

function addNormalized(set: Set<string>, value: unknown) {
  if (typeof value !== 'string') return;
  const whole = normalizeHash(value);
  if (whole) {
    set.add(whole);
    return;
  }
  if (value.length > 4000) return;
  const found = extractHashesFromText(value);
  for (let i = 0; i < found.length; i++) set.add(found[i]);
}

function harvest(value: unknown, set: Set<string>, depth: number) {
  if (value == null || depth > 5) return;
  if (typeof value === 'string') {
    addNormalized(set, value);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) harvest(value[i], set, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>);
    for (let i = 0; i < entries.length; i++) harvest(entries[i], set, depth + 1);
  }
}

/** Hashes attached to a media file or an event. Large message bodies are not scanned. */
export function recordHashes(record: {
  content?: string;
  details?: unknown;
  md5?: string | null;
  sha1?: string | null;
  sha256?: string | null;
}): string[] {
  const set = new Set<string>();
  addNormalized(set, record.md5);
  addNormalized(set, record.sha1);
  addNormalized(set, record.sha256);
  if (record.details) harvest(record.details, set, 0);
  if (record.content && record.content.length <= 4000) addNormalized(set, record.content);
  return Array.from(set);
}

export interface HashImportSummary {
  linesRead: number;
  md5: number;
  sha1: number;
  sha256: number;
  duplicates: number;
  skippedLines: number;
  unique: string[];
}

export interface HashWindowCarry {
  /** The byte before this window is a hex digit, so the window starts inside a token. */
  leftBlocked: boolean;
  /** A line began in an earlier window and has not reached its newline. */
  openLine: boolean;
  /** That open line already contained a hash this import accepted. */
  openHasHash: boolean;
}

export function emptyHashImportSummary(): HashImportSummary {
  return { linesRead: 0, md5: 0, sha1: 0, sha256: 0, duplicates: 0, skippedLines: 0, unique: [] };
}

export function emptyHashWindowCarry(): HashWindowCarry {
  return { leftBlocked: false, openLine: false, openHasHash: false };
}

export function hashWindowBounds(
  offset: number,
  fileSize: number,
  chunkSize = VIC_CHUNK_BYTES,
  overlap = VIC_CHUNK_OVERLAP
): { start: number; end: number; isLast: boolean; acceptUntil: number; nextOffset: number } {
  const start = Math.max(0, offset);
  const end = Math.min(fileSize, start + chunkSize + overlap);
  const isLast = end >= fileSize;
  const bytesInWindow = Math.max(0, end - start);
  const acceptUntil = isLast ? bytesInWindow : Math.min(chunkSize, bytesInWindow);
  return { start, end, isLast, acceptUntil, nextOffset: start + chunkSize };
}

function absorbHashSummary(total: HashImportSummary, part: HashImportSummary) {
  total.linesRead += part.linesRead;
  total.md5 += part.md5;
  total.sha1 += part.sha1;
  total.sha256 += part.sha256;
  total.duplicates += part.duplicates;
  total.skippedLines += part.skippedLines;
  for (let i = 0; i < part.unique.length; i++) total.unique.push(part.unique[i]);
}

function rememberHash(summary: HashImportSummary, seen: Set<string>, hex: string) {
  if (seen.has(hex)) {
    summary.duplicates++;
    return;
  }
  seen.add(hex);
  summary.unique.push(hex);
  if (hex.length === 64) summary.sha256++;
  else if (hex.length === 40) summary.sha1++;
  else summary.md5++;
}

/**
 * Scan one read of a streamed hash file.
 * `acceptUntil` is the cut in characters (equal to bytes for an ASCII hash list).
 * Text past that cut is overlap: it completes a token that started before the cut,
 * and tokens that start in the overlap are left for the next window.
 */
export function scanHashWindow(
  text: string,
  acceptUntil: number,
  seen: Set<string>,
  carry: HashWindowCarry
): { summary: HashImportSummary; carry: HashWindowCarry } {
  const summary = emptyHashImportSummary();
  const limit = Math.max(0, Math.min(acceptUntil, text.length));
  const finalWindow = acceptUntil >= text.length;
  let indexShift = 0;
  let body = text;
  if (carry.leftBlocked) {
    const lead = /^[a-fA-F0-9]+/.exec(text);
    if (lead) {
      indexShift = lead[0].length;
      body = text.slice(indexShift);
    }
  }

  const hashStarts: number[] = [];
  HASH_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HASH_TOKEN.exec(body))) {
    const start = match.index + indexShift;
    if (start >= limit) continue;
    rememberHash(summary, seen, match[1].toLowerCase());
    hashStarts.push(start);
  }

  let hashCursor = 0;
  const lineHasHash = (from: number, to: number) => {
    while (hashCursor < hashStarts.length && hashStarts[hashCursor] < from) hashCursor++;
    return hashCursor < hashStarts.length && hashStarts[hashCursor] < to;
  };

  const closeLine = (from: number, to: number, inherited: boolean) => {
    summary.linesRead++;
    if (!inherited && !lineHasHash(from, to)) summary.skippedLines++;
  };

  const blockedCarry = (): HashWindowCarry => ({
    leftBlocked: limit > 0 && /[a-fA-F0-9]/.test(text.charAt(limit - 1)),
    openLine: true,
    openHasHash: false,
  });

  let lineStart = 0;
  if (carry.openLine) {
    const nl = text.indexOf('\n');
    if (nl === -1 || nl >= limit) {
      const next = blockedCarry();
      next.openHasHash = carry.openHasHash || lineHasHash(0, limit);
      if (finalWindow && text.length > 0) {
        closeLine(0, text.length, carry.openHasHash);
        return { summary, carry: emptyHashWindowCarry() };
      }
      if (finalWindow && text.length === 0 && carry.openLine) {
        closeLine(0, 0, carry.openHasHash);
        return { summary, carry: emptyHashWindowCarry() };
      }
      return { summary, carry: next };
    }
    closeLine(0, nl, carry.openHasHash);
    lineStart = nl + 1;
  }

  while (lineStart < text.length && lineStart < limit) {
    const nl = text.indexOf('\n', lineStart);
    if (nl === -1 || nl >= limit) {
      if (finalWindow && lineStart < text.length) {
        closeLine(lineStart, text.length, false);
        break;
      }
      const next = blockedCarry();
      next.openHasHash = lineHasHash(lineStart, limit);
      return { summary, carry: next };
    }
    closeLine(lineStart, nl, false);
    lineStart = nl + 1;
  }

  if (lineStart >= limit && !finalWindow) {
    return {
      summary,
      carry: {
        leftBlocked: limit > 0 && /[a-fA-F0-9]/.test(text.charAt(limit - 1)),
        openLine: false,
        openHasHash: false,
      },
    };
  }

  return { summary, carry: emptyHashWindowCarry() };
}

/** Same windowing the VIC importer uses: 25 MB reads with overlap, advancing by the chunk size. */
export function scanHashFile(
  text: string,
  chunkSize = VIC_CHUNK_BYTES,
  overlap = VIC_CHUNK_OVERLAP
): HashImportSummary {
  if (chunkSize < 1) throw new Error('Chunk size must be at least 1');
  if (overlap < HASH_MAX_CHARS - 1) throw new Error('Chunk overlap must cover a SHA-256 split on the boundary');
  const total = emptyHashImportSummary();
  if (!text) return total;
  const seen = new Set<string>();
  let offset = 0;
  let carry = emptyHashWindowCarry();
  while (offset < text.length) {
    const bounds = hashWindowBounds(offset, text.length, chunkSize, overlap);
    const part = scanHashWindow(text.slice(bounds.start, bounds.end), bounds.acceptUntil, seen, carry);
    absorbHashSummary(total, part.summary);
    carry = part.carry;
    if (bounds.isLast) break;
    offset = bounds.nextOffset;
  }
  return total;
}

export function formatHashImportSummary(summary: HashImportSummary, added: number, alreadyPresent: number): string {
  return [
    `Lines read: ${summary.linesRead.toLocaleString()}`,
    `MD5: ${summary.md5.toLocaleString()}`,
    `SHA-1: ${summary.sha1.toLocaleString()}`,
    `SHA-256: ${summary.sha256.toLocaleString()}`,
    `Duplicates: ${summary.duplicates.toLocaleString()}`,
    `Invalid or skipped lines: ${summary.skippedLines.toLocaleString()}`,
    `Newly added: ${added.toLocaleString()}`,
    `Already in the database: ${alreadyPresent.toLocaleString()}`,
  ].join('. ') + '.';
}

export function hashHitMap(
  rows: ReadonlyArray<{ hash: string; setId: string; name: string; category: string }>
): Map<string, HashHit[]> {
  const map = new Map<string, HashHit[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = normalizeHash(row.hash);
    if (!key || !isHashCategory(row.category)) continue;
    const hit: HashHit = { setId: row.setId, name: row.name, category: row.category };
    const list = map.get(key);
    if (list) list.push(hit);
    else map.set(key, [hit]);
  }
  return map;
}

export function collectCaseHashes(
  files: ReadonlyArray<{ md5?: string | null; sha1?: string | null; sha256?: string | null }>,
  events: ReadonlyArray<{ content?: string; details?: unknown }>
): string[] {
  const set = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const found = recordHashes(files[i]);
    for (let h = 0; h < found.length; h++) set.add(found[h]);
  }
  for (let i = 0; i < events.length; i++) {
    const found = recordHashes(events[i]);
    for (let h = 0; h < found.length; h++) set.add(found[h]);
  }
  return Array.from(set);
}
