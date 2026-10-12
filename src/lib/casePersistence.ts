/**
 * Pure helpers for media paging and saved-case restore.
 * Kept free of React so large-return behavior can be tested in Node.
 */

import type { ParseResult, ProviderType, UploadedFile } from '../types';

export const MEDIA_PAGE_SIZES = [25, 50, 100, 250, 500] as const;
export const MEDIA_PAGE_SIZE_STORAGE_KEY = 'forensic_media_page_size_v1';

export interface PageSlice<T> {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** Inclusive start index in the filtered list (0 when empty). */
  start: number;
  /** Exclusive end index. */
  end: number;
  items: T[];
}

export function paginateItems<T>(items: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const size = pageSize > 0 ? Math.floor(pageSize) : 25;
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size) || 1);
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = total === 0 ? 0 : (current - 1) * size;
  const end = Math.min(start + size, total);
  return {
    page: current,
    pageCount,
    pageSize: size,
    total,
    start,
    end,
    items: items.slice(start, end),
  };
}

export function normalizeMediaPageSize(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return (MEDIA_PAGE_SIZES as readonly number[]).includes(n) ? n : 50;
}

export function readStoredMediaPageSize(storage?: { getItem(key: string): string | null } | null): number {
  try {
    return normalizeMediaPageSize(storage?.getItem(MEDIA_PAGE_SIZE_STORAGE_KEY));
  } catch {
    return 50;
  }
}

/** Identity of the files a saved parse belongs to. Does not include file bytes. */
export function fileParseSignature(
  files: ReadonlyArray<{ provider?: string; relativePath?: string; name: string; size: number }>,
  activeProvider: string
): string {
  const parts = new Array<string>(files.length);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    parts[i] = `${f.provider || activeProvider}::${f.relativePath || ''}::${f.name}::${f.size}`;
  }
  parts.sort();
  return `${activeProvider}\n${parts.join('\n')}`;
}

export function shouldRestoreSavedParse(
  savedSignature: string | null | undefined,
  files: ReadonlyArray<{ provider?: string; relativePath?: string; name: string; size: number }>,
  activeProvider: string,
  savedEventCount: number
): boolean {
  if (!savedSignature || savedEventCount < 0) return false;
  if (!files.length) return false;
  return savedSignature === fileParseSignature(files, activeProvider);
}

/**
 * Append without spreading. Spreading inside a loop (`arr = [...arr, ...next]`)
 * allocates a new copy of every record on every file and, on a large return,
 * throws RangeError or exhausts renderer memory before the page can paint.
 */
/** Copy a set and add items without spreading a huge array into a call. */
export function addToSet(prev: ReadonlySet<string>, items: readonly string[]): Set<string> {
  const next = new Set(prev);
  for (let i = 0; i < items.length; i++) next.add(items[i]);
  return next;
}

export function appendEvents<T>(target: T[], incoming: readonly T[] | null | undefined): void {
  if (!incoming || incoming.length === 0) return;
  for (let i = 0; i < incoming.length; i++) target.push(incoming[i]);
}

const INLINE_MEDIA_BYTE_CAP = 2 * 1024 * 1024;

/**
 * Decode a small data URL into bytes so it can be written to the app media cache.
 * Returns null when the URL is not a data URL or is large enough that copying it
 * would put the file back into memory.
 */
export function bytesFromDataUrl(dataUrl: string, cap = INLINE_MEDIA_BYTE_CAP): Uint8Array | null {
  if (!dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const meta = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  try {
    if (meta.includes(';base64')) {
      const binary = atob(payload);
      if (binary.length > cap) return null;
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    const text = decodeURIComponent(payload);
    if (text.length > cap) return null;
    return new TextEncoder().encode(text);
  } catch {
    return null;
  }
}

export function localMediaUrl(sourcePath: string): string {
  return `/api/local-media?path=${encodeURIComponent(sourcePath)}`;
}

export function storedMediaUrl(caseId: string, relativePath: string, name: string): string {
  const q = new URLSearchParams({ rel: relativePath || '', name });
  return `/api/cases/${encodeURIComponent(caseId)}/stored-media?${q.toString()}`;
}

export function mediaDisplaySrc(file: {
  isMedia?: boolean;
  content?: string;
  sourcePath?: string;
  mediaMissing?: boolean;
  hasStoredBytes?: boolean;
  caseId?: string;
  relativePath?: string;
  name?: string;
}): { url: string; missing: boolean } {
  if (!file.isMedia) return { url: file.content || '', missing: false };
  if (file.mediaMissing) return { url: '', missing: true };
  if (file.sourcePath) return { url: localMediaUrl(file.sourcePath), missing: false };
  if (file.hasStoredBytes && file.caseId && file.name) {
    return { url: storedMediaUrl(file.caseId, file.relativePath || '', file.name), missing: false };
  }
  const content = file.content || '';
  if (!content || content.startsWith('blob:')) return { url: '', missing: true };
  return { url: content, missing: false };
}

/** Bytes of file text/base64 the renderer is actually retaining. */
export function retainedContentBytes(files: ReadonlyArray<{ content?: string }>): number {
  let n = 0;
  for (let i = 0; i < files.length; i++) {
    const c = files[i].content;
    if (c) n += c.length;
  }
  return n;
}

export function stripRetainedBytes<T extends { content?: string; isMedia?: boolean }>(file: T): T {
  if (!file.content) return file;
  if (file.isMedia || file.content.length > 0) {
    return { ...file, content: '' };
  }
  return file;
}

export interface SavedWorkspaceFile {
  name: string;
  relativePath: string;
  size: number;
  isMedia: boolean;
  mediaType?: 'image' | 'video' | null;
  provider?: string | null;
  sourcePath?: string | null;
  md5?: string | null;
  sha1?: string | null;
  sha256?: string | null;
  isScreenshot?: boolean;
  skinTonePercent?: number | null;
  gps?: { lat: number; lng: number } | null;
  gpsAlt?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
  forensicsProcessed?: boolean;
  mediaMissing?: boolean;
  hasStoredBytes?: boolean;
  content?: string;
}

export function toUploadedFile(raw: SavedWorkspaceFile, caseId?: string): UploadedFile {
  const file: UploadedFile = {
    name: raw.name,
    relativePath: raw.relativePath || '',
    size: raw.size || 0,
    isMedia: !!raw.isMedia,
    mediaType: raw.mediaType || undefined,
    provider: (raw.provider || undefined) as ProviderType | undefined,
    content: raw.isMedia ? '' : (raw.content || ''),
    sourcePath: raw.sourcePath || undefined,
    md5: raw.md5 || undefined,
    sha1: raw.sha1 ?? undefined,
    sha256: raw.sha256 ?? undefined,
    isScreenshot: !!raw.isScreenshot,
    skinTonePercent: raw.skinTonePercent ?? undefined,
    gps: raw.gps || undefined,
    gpsAlt: raw.gpsAlt ?? null,
    capturedAt: raw.capturedAt || null,
    device: raw.device || null,
    coordSource: raw.coordSource || null,
    forensicsProcessed: raw.isMedia ? true : !!raw.forensicsProcessed,
    mediaMissing: !!raw.mediaMissing,
    hasStoredBytes: !!raw.hasStoredBytes,
  };
  if (file.isMedia) {
    const display = mediaDisplaySrc({ ...file, caseId });
    file.content = display.url;
    file.mediaMissing = display.missing;
    file.forensicsProcessed = raw.forensicsProcessed !== false;
  }
  return file;
}

export function workspaceResultFromSaved(saved: {
  provider: ProviderType;
  events: ParseResult['events'];
  accounts?: ParseResult['accounts'];
  accountChanges?: ParseResult['accountChanges'];
  summaryStats?: ParseResult['summaryStats'];
  accountInfo?: ParseResult['accountInfo'];
}): ParseResult {
  const events = saved.events || [];
  const summary = saved.summaryStats || {
    totalEvents: events.length,
    messagesCount: events.filter(e => e.category === 'message').length,
    connectionsCount: events.filter(e => e.category === 'connection').length,
    filesCount: events.filter(e => e.category === 'file').length,
    callsCount: events.filter(e => e.category === 'call').length,
    uniqueIPs: Array.from(new Set(events.map(e => e.ipAddress).filter(Boolean) as string[])),
    dateRange: null,
  };
  return {
    provider: saved.provider,
    events,
    accounts: saved.accounts || [],
    accountChanges: saved.accountChanges || [],
    accountInfo: saved.accountInfo,
    summaryStats: summary,
  };
}
