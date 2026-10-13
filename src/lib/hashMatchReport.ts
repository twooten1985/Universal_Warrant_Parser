/**
 * What the Settings "Hash match report" shows, and which digest on a file hit.
 */
import type { HashHit } from './hashSets';
import { normalizeHash } from './hashSets';
import { fileDigestList } from './mediaBrowser';

export interface HashCountBreakdown {
  total: number;
  md5: number;
  sha1: number;
  sha256: number;
}

export interface HashSetInventoryRow extends HashCountBreakdown {
  id: string;
  name: string;
  category: string;
}

export interface HashInventory {
  vic: HashCountBreakdown;
  sets: HashSetInventoryRow[];
}

export interface DigestReportFile {
  name: string;
  relativePath?: string | null;
  isMedia?: boolean;
  md5?: string | null;
  sha1?: string | null;
  sha256?: string | null;
  digestNote?: string | null;
  digestStatus?: 'computed' | 'missing' | null;
  digestFromBytes?: boolean;
  mediaMissing?: boolean;
  sourcePath?: string | null;
  hasStoredBytes?: boolean;
}

export interface HashAudit {
  uniqueLoaded: number;
  uniqueMatched: number;
  notFound: string[];
}

export interface ComputedFileHash {
  name: string;
  path: string;
  md5: string;
  sha1: string;
  sha256: string;
}

export interface MediaDigestReport {
  mediaFiles: number;
  computed: number;
  missing: number;
  missingReasons: Array<{ name: string; reason: string }>;
  vicMatched: number;
  namedSetMatched: number;
  matchedBySet: Array<{ name: string; count: number }>;
  totalFiles: number;
  hashedFiles: number;
  notHashed: number;
  uniqueLoaded: number;
  uniqueMatched: number;
  notFound: string[];
  computedHashes: ComputedFileHash[];
}

export function emptyHashCounts(): HashCountBreakdown {
  return { total: 0, md5: 0, sha1: 0, sha256: 0 };
}

export function countHashesByLength(hashes: Iterable<string>): HashCountBreakdown {
  const out = emptyHashCounts();
  for (const raw of hashes) {
    const hex = normalizeHash(String(raw || ''));
    if (!hex) continue;
    out.total += 1;
    if (hex.length === 32) out.md5 += 1;
    else if (hex.length === 40) out.sha1 += 1;
    else if (hex.length === 64) out.sha256 += 1;
  }
  return out;
}

export function matchedDigestFields(
  file: { md5?: string | null; sha1?: string | null; sha256?: string | null },
  vicHashes?: ReadonlySet<string> | null,
  hashHits?: ReadonlyMap<string, HashHit[]> | null
): { md5: boolean; sha1: boolean; sha256: boolean } {
  const hit = (value?: string | null) => {
    const key = normalizeHash(value || '');
    if (!key) return false;
    if (vicHashes?.has(key)) return true;
    return !!hashHits?.get(key)?.length;
  };
  return { md5: hit(file.md5), sha1: hit(file.sha1), sha256: hit(file.sha256) };
}

function missingReason(file: DigestReportFile): string {
  if (file.digestFromBytes === false) return 'Stored hash came from return metadata, not the original file bytes';
  if (file.digestNote) return file.digestNote;
  if (file.mediaMissing && !file.sourcePath && !file.hasStoredBytes) return 'No file bytes are available to hash';
  if (!file.sourcePath && !file.hasStoredBytes && !(file as { content?: string }).content) return 'No file bytes are available to hash';
  if (!file.sourcePath && !file.hasStoredBytes) return 'No file bytes are available to hash';
  return 'Digests have not been computed from the file bytes yet';
}

function trustedDigests(file: DigestReportFile): string[] {
  if (file.digestFromBytes === false) return [];
  return fileDigestList(file);
}

export function computedHashCsv(rows: readonly ComputedFileHash[]): string {
  const lines = ['path,name,md5,sha1,sha256'];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines.push([row.path, row.name, row.md5, row.sha1, row.sha256].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

export function missingHashCsv(hashes: readonly string[]): string {
  const lines = ['hash'];
  for (let i = 0; i < hashes.length; i++) lines.push(csvCell(hashes[i]));
  return lines.join('\r\n');
}

function csvCell(value: string): string {
  const text = String(value || '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function mediaDigestReport(
  files: readonly DigestReportFile[],
  vicHashes?: ReadonlySet<string> | null,
  hashHits?: ReadonlyMap<string, HashHit[]> | null,
  loadedHashes?: Iterable<string> | null
): MediaDigestReport {
  let mediaFiles = 0;
  let computed = 0;
  let missing = 0;
  let vicMatched = 0;
  let namedSetMatched = 0;
  let hashedFiles = 0;
  const missingReasons: MediaDigestReport['missingReasons'] = [];
  const bySet = new Map<string, number>();
  const computedHashes: ComputedFileHash[] = [];
  const present = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const digests = trustedDigests(file);
    const byteHashed = digests.length === 3;
    if (byteHashed) {
      hashedFiles += 1;
      const path = file.relativePath || file.name;
      computedHashes.push({
        name: file.name,
        path,
        md5: digests[0],
        sha1: digests[1],
        sha256: digests[2],
      });
      for (let d = 0; d < digests.length; d++) present.add(digests[d]);
    } else {
      missingReasons.push({ name: file.relativePath || file.name, reason: missingReason(file) });
    }
    if (!file.isMedia) continue;
    mediaFiles += 1;
    if (byteHashed) computed += 1;
    else missing += 1;
    let vic = false;
    let named = false;
    const seenSets = new Set<string>();
    for (let d = 0; d < digests.length; d++) {
      const key = digests[d];
      if (vicHashes?.has(key)) vic = true;
      const hits = hashHits?.get(key) || [];
      for (let h = 0; h < hits.length; h++) {
        named = true;
        if (seenSets.has(hits[h].setId)) continue;
        seenSets.add(hits[h].setId);
        bySet.set(hits[h].name, (bySet.get(hits[h].name) || 0) + 1);
      }
    }
    if (vic) vicMatched += 1;
    if (named) namedSetMatched += 1;
  }

  const loaded = new Set<string>();
  if (loadedHashes) {
    for (const raw of loadedHashes) {
      const hex = normalizeHash(String(raw || ''));
      if (hex) loaded.add(hex);
    }
  }
  const notFound: string[] = [];
  let uniqueMatched = 0;
  loaded.forEach(hash => {
    if (present.has(hash)) uniqueMatched += 1;
    else notFound.push(hash);
  });
  notFound.sort();

  const matchedBySet = [...bySet.entries()].map(([name, count]) => ({ name, count }));
  matchedBySet.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    mediaFiles,
    computed,
    missing,
    missingReasons,
    vicMatched,
    namedSetMatched,
    matchedBySet,
    totalFiles: files.length,
    hashedFiles,
    notHashed: files.length - hashedFiles,
    uniqueLoaded: loaded.size,
    uniqueMatched,
    notFound,
    computedHashes,
  };
}
