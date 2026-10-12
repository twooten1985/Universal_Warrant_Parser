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
  isMedia?: boolean;
  md5?: string | null;
  sha1?: string | null;
  sha256?: string | null;
  digestNote?: string | null;
  digestStatus?: 'computed' | 'missing' | null;
  mediaMissing?: boolean;
  sourcePath?: string | null;
  hasStoredBytes?: boolean;
}

export interface MediaDigestReport {
  mediaFiles: number;
  computed: number;
  missing: number;
  missingReasons: Array<{ name: string; reason: string }>;
  vicMatched: number;
  namedSetMatched: number;
  matchedBySet: Array<{ name: string; count: number }>;
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
  if (file.digestNote) return file.digestNote;
  if (file.mediaMissing && !file.sourcePath && !file.hasStoredBytes) return 'No file bytes are available to hash';
  if (!file.sourcePath && !file.hasStoredBytes) return 'No file bytes are available to hash';
  return 'Digests have not been computed from the file bytes yet';
}

export function mediaDigestReport(
  files: readonly DigestReportFile[],
  vicHashes?: ReadonlySet<string> | null,
  hashHits?: ReadonlyMap<string, HashHit[]> | null
): MediaDigestReport {
  let mediaFiles = 0;
  let computed = 0;
  let missing = 0;
  let vicMatched = 0;
  let namedSetMatched = 0;
  const missingReasons: MediaDigestReport['missingReasons'] = [];
  const bySet = new Map<string, number>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.isMedia) continue;
    mediaFiles += 1;
    const digests = fileDigestList(file);
    if (digests.length === 3) computed += 1;
    else {
      missing += 1;
      missingReasons.push({ name: file.name, reason: missingReason(file) });
    }
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

  const matchedBySet = [...bySet.entries()].map(([name, count]) => ({ name, count }));
  matchedBySet.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { mediaFiles, computed, missing, missingReasons, vicMatched, namedSetMatched, matchedBySet };
}
