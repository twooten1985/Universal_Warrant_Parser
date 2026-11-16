/**
 * Evidence-tag records shared by the main case database and the portable viewer.
 * The portable viewer saves a JSON file of this shape. Import merges it into a case.
 * Custom color tags (labels) and row metadata travel with the same record.
 */

import { normalizeTagDefs, type CustomTagDef } from './customTags';

export const EVIDENCE_TAG_EXPORT_KIND = 'uwrp-evidence-tags';
export const EVIDENCE_TAG_EXPORT_VERSION = 2;

export interface EvidenceTagMeta {
  source?: string;
  kind?: string;
  account?: string;
  path?: string;
  sha256?: string;
  timestamp?: string;
  description?: string;
  category?: string;
  backupId?: string;
  device?: string;
  domain?: string;
  relativePath?: string;
  fileID?: string;
}

export interface EvidenceTagRecord {
  tagged?: boolean;
  notes?: string;
  meta?: EvidenceTagMeta;
  /** Ids of case-wide custom tags applied to this item. */
  labels?: string[];
}

export interface EvidenceTagExport {
  kind: typeof EVIDENCE_TAG_EXPORT_KIND;
  version: number;
  caseId: string;
  exportedAt: string;
  evidence_tags: Record<string, EvidenceTagRecord & { tagged: boolean; notes: string }>;
  tag_definitions?: CustomTagDef[];
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

const META_KEYS = ['source', 'kind', 'account', 'path', 'sha256', 'timestamp', 'description', 'category', 'backupId', 'device', 'domain', 'relativePath', 'fileID'] as const;

export function readTagMeta(value: unknown): EvidenceTagMeta | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const out: EvidenceTagMeta = {};
  for (const key of META_KEYS) {
    const raw = row[key];
    if (typeof raw === 'string' && raw) out[key] = raw;
  }
  return Object.keys(out).length ? out : undefined;
}

export function readTagLabels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || labels.includes(id)) continue;
    labels.push(id);
    if (labels.length >= 24) break;
  }
  return labels.length ? labels : undefined;
}

function asTagMap(value: unknown): Record<string, EvidenceTagRecord> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, EvidenceTagRecord> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || key === 'kind' || key === 'version' || key === 'caseId' || key === 'exportedAt' || key === 'tag_definitions') continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const meta = readTagMeta(row.meta);
    const labels = readTagLabels(row.labels);
    if (typeof row.tagged !== 'boolean' && typeof row.notes !== 'string' && !meta && !labels) continue;
    const record: EvidenceTagRecord = {
      tagged: !!row.tagged,
      notes: typeof row.notes === 'string' ? row.notes : '',
    };
    if (meta) record.meta = meta;
    if (labels) record.labels = labels;
    out[key] = record;
    count++;
  }
  return count > 0 ? out : null;
}

export interface EvidenceTagBundle {
  caseId: string;
  evidenceTags: Record<string, EvidenceTagRecord>;
  tagDefinitions: CustomTagDef[];
}

/** Accept the portable export file, or a bare map of event id to tag. */
export function readEvidenceTagExport(value: unknown): EvidenceTagBundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const nested = obj.evidence_tags || obj.evidenceTags;
  const fromNested = asTagMap(nested);
  const tagDefinitions = normalizeTagDefs(obj.tag_definitions || obj.tagDefinitions);
  if (fromNested) {
    return {
      caseId: typeof obj.caseId === 'string' ? obj.caseId : '',
      evidenceTags: fromNested,
      tagDefinitions,
    };
  }
  const bare = asTagMap(obj);
  if (!bare && tagDefinitions.length === 0) return null;
  return { caseId: '', evidenceTags: bare || {}, tagDefinitions };
}

/**
 * Overlay imported tags onto the case. Keys in the file replace that key.
 * Tags already on the case that the file does not mention are left alone.
 */
export function mergeEvidenceTags(
  current: Record<string, EvidenceTagRecord>,
  incoming: Record<string, EvidenceTagRecord>
): Record<string, EvidenceTagRecord> {
  const next: Record<string, EvidenceTagRecord> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!value) continue;
    next[key] = {
      tagged: !!value.tagged,
      notes: value.notes || '',
      ...(value.meta ? { meta: value.meta } : {}),
      ...(value.labels?.length ? { labels: value.labels.slice() } : {}),
    };
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (!key || !value) continue;
    const prior = next[key];
    const notes = typeof value.notes === 'string' ? value.notes : (prior?.notes || '');
    const meta = value.meta ? { ...(prior?.meta || {}), ...value.meta } : prior?.meta;
    const labels = Array.isArray(value.labels) ? value.labels.slice() : prior?.labels;
    const record: EvidenceTagRecord = { tagged: !!value.tagged, notes };
    if (meta && Object.keys(meta).length) record.meta = meta;
    if (labels?.length) record.labels = labels;
    next[key] = record;
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
  tags: Record<string, EvidenceTagRecord>,
  tagDefinitions?: readonly CustomTagDef[]
): EvidenceTagExport {
  const evidence_tags: EvidenceTagExport['evidence_tags'] = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!value) continue;
    const record: EvidenceTagExport['evidence_tags'][string] = { tagged: !!value.tagged, notes: value.notes || '' };
    if (value.meta && Object.keys(value.meta).length) record.meta = value.meta;
    if (value.labels?.length) record.labels = value.labels.slice();
    evidence_tags[key] = record;
  }
  const defs = normalizeTagDefs(tagDefinitions || []);
  return {
    kind: EVIDENCE_TAG_EXPORT_KIND,
    version: EVIDENCE_TAG_EXPORT_VERSION,
    caseId,
    exportedAt: new Date().toISOString(),
    evidence_tags,
    ...(defs.length ? { tag_definitions: defs } : {}),
  };
}
