/**
 * Exhibit records shared by the Evidence/Exhibit page, CSV/ZIP exports and the case report.
 * A tag can carry `meta` (source, account, original path, SHA-256, timestamp, description and, for
 * iOS backups, domain/relativePath/fileID). Tags whose key is not a parsed event (backup items,
 * iCloud Drive files, …) become synthetic "exhibit" events so every existing exhibit path sees them.
 */
import type { ForensicEvent, UploadedFile } from '../types';
import { appleContext } from './appleParsers';

export interface ExhibitMeta {
  source?: string; kind?: string; account?: string; path?: string; sha256?: string; timestamp?: string; description?: string;
  backupId?: string; device?: string; domain?: string; relativePath?: string; fileID?: string;
}
export interface TagEntry { tagged: boolean; notes?: string; meta?: ExhibitMeta }
export type TagMap = Record<string, TagEntry>;
export interface TagItem { key: string; meta?: ExhibitMeta }

const CAT: Record<string, ForensicEvent['category']> = { message: 'message', attachment: 'file', call: 'call', photo: 'file', file: 'file', 'icloud-file': 'file', contact: 'profile', device: 'profile', app: 'other' };

export function exhibitEventsFromTags(tags: TagMap, existingIds: Set<string>): ForensicEvent[] {
  const out: ForensicEvent[] = [];
  for (const [key, t] of Object.entries(tags || {})) {
    if (!t?.tagged || !t.meta || existingIds.has(key) || key.startsWith('media-file-')) continue;
    const m = t.meta;
    out.push({
      id: key, timestamp: m.timestamp || 'Unknown', category: CAT[m.kind || ''] || 'other',
      sender: m.source === 'Backup' ? `iOS backup${m.device ? ' ' + m.device : ''}` : (m.source || 'Exhibit'), recipient: '',
      content: m.description || key, sourceFile: originalLabel(m),
      accountKey: m.account ? `apple icloud::uid::${m.account}` : undefined, targetAccount: m.account || undefined,
      details: { kind: 'exhibit-' + (m.kind || 'item'), exhibitMeta: m, appleAccount: m.account },
    });
  }
  return out;
}

export function originalLabel(m: ExhibitMeta): string {
  if (m.domain || m.fileID) return `${m.domain || ''}/${m.relativePath || ''}${m.fileID ? ` (fileID ${m.fileID})` : ''}`;
  return m.path || m.relativePath || '';
}

export function findFileForEvent(e: ForensicEvent, files: UploadedFile[]): UploadedFile | undefined {
  const s = String(e.sourceFile || '').replace(/\\/g, '/'); if (!s) return undefined;
  return files.find(f => f.name === s || (f.relativePath || '').replace(/\\/g, '/') === s)
    || files.find(f => (f.relativePath || '').replace(/\\/g, '/').endsWith('/' + s));
}

/** Derive exhibit metadata for a parsed event (iCloud or any provider). Stored tag meta wins. */
export function metaForEvent(e: ForensicEvent, files: UploadedFile[], stored?: ExhibitMeta): ExhibitMeta {
  const em = (e.details?.exhibitMeta || {}) as ExhibitMeta;
  const f = findFileForEvent(e, files);
  const ctx = f ? appleContext(f.relativePath || f.name) : null;
  const appleType = String(e.details?.appleType || ctx?.type || '');
  const base: ExhibitMeta = {
    source: em.source || (appleType ? `iCloud ${appleType}` : (f?.provider ? String(f.provider) : 'Return')),
    kind: em.kind || String(e.details?.kind || e.category || ''),
    account: em.account || String(e.details?.appleAccount || ctx?.account || e.targetAccount || ''),
    path: em.path || f?.sourcePath || f?.relativePath || e.sourceFile || '',
    sha256: em.sha256 || f?.sha256 || '',
    timestamp: em.timestamp || e.timestamp,
    description: em.description || String(e.content || '').slice(0, 240),
    backupId: em.backupId, device: em.device, domain: em.domain, relativePath: em.relativePath, fileID: em.fileID,
  };
  const s = stored || {};
  return { ...base, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v != null && v !== '')) };
}

export function metaForFile(f: UploadedFile, timestamp?: string): ExhibitMeta {
  const ctx = appleContext(f.relativePath || f.name);
  return { source: ctx.type ? `iCloud ${ctx.type}` : (f.provider ? String(f.provider) : 'Return'), kind: f.isMedia ? 'media' : 'icloud-file', account: /^\d+$/.test(ctx.account || '') ? ctx.account : '',
    path: f.sourcePath || f.relativePath || f.name, sha256: f.sha256 || '', timestamp: timestamp || (f as any).capturedAt || '', description: `${f.isMedia ? 'Media' : 'File'} ${f.relativePath || f.name}` };
}

export interface UnifiedExhibit {
  id: string; timestamp: string; sender: string; recipient?: string; content: string; ipAddress?: string; sourceFile: string; notes: string;
  mediaFile?: UploadedFile; isDiscreteMedia?: boolean; category: string;
  source: string; account: string; originalPath: string; sha256: string; description: string; domain?: string; relativePath?: string; fileID?: string; backupId?: string;
}

/** Same rules as before (tagged events + tagged media not already covered), now with exhibit metadata. */
export function buildUnifiedExhibits(events: ForensicEvent[], files: UploadedFile[], tags: TagMap, mediaTimestamp: (f: UploadedFile) => string): UnifiedExhibit[] {
  const tagged = events.filter(e => tags[e.id]?.tagged);
  const list: UnifiedExhibit[] = [];
  for (const evt of tagged) {
    const m = metaForEvent(evt, files, tags[evt.id]?.meta);
    const assoc = files.find(f => f.name === evt.details?.resolvedMediaName);
    list.push({ id: evt.id, timestamp: evt.timestamp, sender: evt.sender, recipient: evt.recipient || '', content: evt.content, ipAddress: evt.ipAddress || '', sourceFile: evt.sourceFile,
      notes: tags[evt.id]?.notes || '', mediaFile: assoc, category: evt.category || 'chat',
      source: m.source || '', account: m.account || '', originalPath: m.path || '', sha256: m.sha256 || '', description: m.description || '', domain: m.domain, relativePath: m.relativePath, fileID: m.fileID, backupId: m.backupId });
  }
  for (const file of files) {
    if (!file.isMedia) continue;
    const key = `media-file-${file.name}`;
    if (!tags[key]?.tagged || tagged.some(e => e.details?.resolvedMediaName === file.name)) continue;
    const ts = mediaTimestamp(file); const m = { ...metaForFile(file, ts), ...(tags[key]?.meta || {}) };
    list.push({ id: key, timestamp: ts, sender: 'Extracted Media Asset', recipient: 'Forensic Vault', content: `Independent File Extraction: ${file.name}`, ipAddress: 'N/A', sourceFile: 'Warrant Folder Attachment',
      notes: tags[key]?.notes || '', mediaFile: file, isDiscreteMedia: true, category: 'media',
      source: m.source || '', account: m.account || '', originalPath: m.path || '', sha256: m.sha256 || '', description: m.description || '' });
  }
  return list;
}

/** Merge tag items (from the iCloud views or the backup window) into the tag map. */
export function applyTagItems(prev: TagMap, items: TagItem[], tagged: boolean): TagMap {
  const next = { ...prev };
  for (const it of items) {
    const cur = next[it.key];
    next[it.key] = { tagged, notes: cur?.notes || '', meta: { ...(cur?.meta || {}), ...(it.meta || {}) } };
  }
  return next;
}
