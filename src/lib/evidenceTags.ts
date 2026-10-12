/**
 * Evidence-tag records shared by the main case database and the portable viewer.
 * The portable viewer saves a JSON file of this shape. Import merges it into a case.
 */

export const EVIDENCE_TAG_EXPORT_KIND = 'uwrp-evidence-tags';
export const EVIDENCE_TAG_EXPORT_VERSION = 1;

export interface EvidenceTagRecord {
  tagged?: boolean;
  notes?: string;
}

export interface EvidenceTagExport {
  kind: typeof EVIDENCE_TAG_EXPORT_KIND;
  version: number;
  caseId: string;
  exportedAt: string;
  evidence_tags: Record<string, { tagged: boolean; notes: string }>;
}

export interface PortableTagIdentity {
  caseId?: string;
  generatedAt?: string;
  providerName?: string;
  suspectName?: string;
  stats?: { totalEvents?: number; mediaCount?: number };
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** localStorage key for tags edited in a portable case on this computer. */
export function portableTagStorageKey(meta: PortableTagIdentity): string {
  const caseId = (meta.caseId || '').trim();
  if (caseId) return `uwrp-portable-tags:v1:case:${caseId}`;
  const fingerprint = [
    meta.generatedAt || '',
    meta.providerName || '',
    meta.suspectName || '',
    String(meta.stats?.totalEvents || 0),
    String(meta.stats?.mediaCount || 0),
  ].join('|');
  return `uwrp-portable-tags:v1:export:${fnv1a(fingerprint)}`;
}

function asTagMap(value: unknown): Record<string, EvidenceTagRecord> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, EvidenceTagRecord> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || key === 'kind' || key === 'version' || key === 'caseId' || key === 'exportedAt') continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.tagged !== 'boolean' && typeof row.notes !== 'string') continue;
    out[key] = {
      tagged: !!row.tagged,
      notes: typeof row.notes === 'string' ? row.notes : '',
    };
    count++;
  }
  return count > 0 ? out : null;
}

/** Accept the portable export file, or a bare map of event id to tag. */
export function readEvidenceTagExport(value: unknown): { caseId: string; evidenceTags: Record<string, EvidenceTagRecord> } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const nested = obj.evidence_tags || obj.evidenceTags;
  const fromNested = asTagMap(nested);
  if (fromNested) {
    return {
      caseId: typeof obj.caseId === 'string' ? obj.caseId : '',
      evidenceTags: fromNested,
    };
  }
  const bare = asTagMap(obj);
  if (!bare) return null;
  return { caseId: '', evidenceTags: bare };
}

/**
 * Overlay imported tags onto the case. Keys in the file replace that key.
 * Tags already on the case that the file does not mention are left alone.
 */
export function mergeEvidenceTags(
  current: Record<string, EvidenceTagRecord>,
  incoming: Record<string, EvidenceTagRecord>
): Record<string, { tagged: boolean; notes: string }> {
  const next: Record<string, { tagged: boolean; notes: string }> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!value) continue;
    next[key] = { tagged: !!value.tagged, notes: value.notes || '' };
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (!key || !value) continue;
    const notes = typeof value.notes === 'string' ? value.notes : (next[key]?.notes || '');
    next[key] = { tagged: !!value.tagged, notes };
  }
  return next;
}

export function readStoredPortableTags(
  storage: { getItem(key: string): string | null } | null | undefined,
  key: string
): Record<string, EvidenceTagRecord> | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return readEvidenceTagExport(JSON.parse(raw))?.evidenceTags ?? null;
  } catch {
    return null;
  }
}

export function evidenceTagExportDocument(
  caseId: string,
  tags: Record<string, EvidenceTagRecord>
): EvidenceTagExport {
  const evidence_tags: EvidenceTagExport['evidence_tags'] = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!value) continue;
    evidence_tags[key] = { tagged: !!value.tagged, notes: value.notes || '' };
  }
  return {
    kind: EVIDENCE_TAG_EXPORT_KIND,
    version: EVIDENCE_TAG_EXPORT_VERSION,
    caseId,
    exportedAt: new Date().toISOString(),
    evidence_tags,
  };
}
