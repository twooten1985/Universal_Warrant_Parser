/**
 * Snapchat message media.
 * A chat row already carries the raw media ID and, for b~ values, the decoded reference.
 * A file already in the return is shown only when exactly one name or path matches
 * either form. Remote Snapchat and CDN addresses are never requested.
 */

import type { ForensicEvent } from '../types';
import { mediaDisplaySrc } from './casePersistence';
import { classifyMediaName, mediaNamePathHay } from './mediaBrowser';
import { decodeMediaId } from '../parserHelper';

export const SNAPCHAT_MEDIA_MISSING = 'media not in return';

/** Neutral local poster. A data URL, not a Snapchat or CDN address. */
export const SNAPCHAT_VIDEO_POSTER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const MIN_TOKEN = 8;

export interface SnapchatMediaFile {
  name: string;
  relativePath?: string;
  content?: string;
  isMedia?: boolean;
  mediaType?: 'image' | 'video' | null;
  sourcePath?: string;
  mediaMissing?: boolean;
  hasStoredBytes?: boolean;
  caseId?: string;
  size?: number;
  md5?: string | null;
  sha1?: string | null;
  sha256?: string | null;
}

export interface SnapchatMediaView {
  key: string;
  kind: 'local-image' | 'local-video' | 'missing' | 'ambiguous' | 'unsupported';
  mediaId: string;
  decodedId?: string;
  filename?: string;
  path?: string;
  localSrc: string | null;
  poster: string | null;
  blurredByDefault: boolean;
  autoplay: false;
  fetchesRemote: false;
  parentMessageId: string;
  note: string;
  hashes: { md5?: string; sha1?: string; sha256?: string };
}

export interface SnapchatIndexedFile {
  file: SnapchatMediaFile;
  hay: string;
  stem: string;
}

export type SnapchatMediaIndex = SnapchatIndexedFile[];

export interface SnapchatMediaResolution {
  file: SnapchatMediaFile | null;
  candidates: SnapchatMediaFile[];
}

export function isSnapchatMediaPlaceholder(content: string): boolean {
  return /^\[Sent Media Snap(?: ID)?: .+\]$/.test((content || '').trim());
}

/** Hide the bare ID line once the card is showing that same ID. Evidence text on the event stays as parsed. */
export function snapchatBubbleText(content: string, hasMediaCard: boolean): string {
  if (hasMediaCard && isSnapchatMediaPlaceholder(content)) return '';
  return content || '';
}

function normPath(value: string): string {
  return value.replace(/\\/g, '/').trim().toLowerCase();
}

function stemOf(value: string): string {
  const base = value.split('/').pop() || value;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base;
  return base.slice(0, dot);
}

function idVariants(id: string): string[] {
  const out = new Set<string>();
  const add = (value: string) => {
    const text = value.trim().toLowerCase();
    if (text.length >= MIN_TOKEN) out.add(text);
    const bare = text.replace(/=+$/g, '');
    if (bare.length >= MIN_TOKEN) out.add(bare);
  };
  const forms = [id];
  try { forms.push(decodeURIComponent(id)); } catch { /* keep the original */ }
  for (const form of forms) {
    add(form);
    add(form.replace(/\+/g, '-').replace(/\//g, '_'));
    add(form.replace(/-/g, '+').replace(/_/g, '/'));
    try { add(encodeURIComponent(form)); } catch { /* keep the plain form */ }
    const stripped = form.replace(/^(?:b~|media~)/i, '');
    if (stripped !== form) add(stripped);
  }
  return [...out];
}

function isSnapMediaCandidate(file: SnapchatMediaFile): boolean {
  if (file.mediaType === 'image' || file.mediaType === 'video') return true;
  if (classifyMediaName(file.name || '')) return true;
  const base = (file.relativePath || '').replace(/\\/g, '/').split('/').pop() || '';
  return !!classifyMediaName(base);
}

function pathIdentity(file: SnapchatMediaFile): string {
  const path = normPath(file.relativePath || '');
  const name = (file.name || '').toLowerCase();
  return path ? `path:${path}|${name}` : '';
}

function uniqueHits(list: readonly SnapchatMediaFile[]): SnapchatMediaFile[] {
  const out: SnapchatMediaFile[] = [];
  const paths = new Set<string>();
  const refs = new Set<SnapchatMediaFile>();
  for (const file of list) {
    const pathId = pathIdentity(file);
    if (pathId) {
      if (paths.has(pathId)) continue;
      paths.add(pathId);
      out.push(file);
      continue;
    }
    if (refs.has(file)) continue;
    refs.add(file);
    out.push(file);
  }
  return out;
}

export function buildSnapchatMediaIndex(files: readonly SnapchatMediaFile[]): SnapchatMediaIndex {
  const out: SnapchatMediaIndex = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!isSnapMediaCandidate(file)) continue;
    const name = (file.name || '').replace(/\\/g, '/');
    out.push({
      file,
      hay: mediaNamePathHay(file),
      stem: stemOf(name).toLowerCase(),
    });
  }
  return out;
}

function keysFrom(details: { mediaId?: unknown; mediaRef?: unknown } | undefined): string[] {
  const raw = typeof details?.mediaId === 'string' ? details.mediaId.trim() : '';
  const stored = typeof details?.mediaRef === 'string' ? details.mediaRef.trim() : '';
  const decoded = stored || (raw ? decodeMediaId(raw) || '' : '');
  return [...new Set([...idVariants(raw), ...idVariants(decoded)])];
}

function hitKind(row: SnapchatIndexedFile, ids: readonly string[]): 'stem' | 'token' | null {
  let token = false;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (row.stem === id || stemOf(row.file.relativePath || row.file.name || '').toLowerCase() === id) return 'stem';
    if (row.hay.includes(id)) token = true;
  }
  return token ? 'token' : null;
}

/**
 * Look up a Snapchat media ID the same way media search does: the full ID, including
 * base64 and URL-encoding variants, anywhere in the normalized file name or path.
 * An exact stem wins when several names contain the ID. More than one remaining
 * candidate is ambiguous and is not attached.
 */
export function resolveSnapchatMedia(
  files: readonly SnapchatMediaFile[],
  details: { mediaId?: unknown; mediaRef?: unknown } | undefined,
  index?: SnapchatMediaIndex
): SnapchatMediaResolution {
  const rows = index || buildSnapchatMediaIndex(files);
  const ids = keysFrom(details);
  const hits: Array<{ file: SnapchatMediaFile; kind: 'stem' | 'token' }> = [];
  for (let i = 0; i < rows.length; i++) {
    const kind = hitKind(rows[i], ids);
    if (kind) hits.push({ file: rows[i].file, kind });
  }
  const unique = uniqueHits(hits.map(hit => hit.file));
  const stems = uniqueHits(hits.filter(hit => hit.kind === 'stem').map(hit => hit.file));
  const chosen = stems.length > 0 ? stems : unique;
  if (chosen.length === 1) return { file: chosen[0], candidates: chosen };
  return { file: null, candidates: chosen };
}

export function resolveSnapchatCapturedMedia(
  files: readonly SnapchatMediaFile[],
  details: { mediaId?: unknown; mediaRef?: unknown } | undefined,
  index?: SnapchatMediaIndex
): SnapchatMediaFile | null {
  return resolveSnapchatMedia(files, details, index).file;
}

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('//');
}

function localPreviewSrc(file: SnapchatMediaFile): string | null {
  const display = mediaDisplaySrc(file);
  if (!display.url || display.missing) return null;
  if (isRemote(display.url)) return null;
  return display.url;
}

function hashesOf(file: SnapchatMediaFile): SnapchatMediaView['hashes'] {
  return {
    md5: file.md5 || undefined,
    sha1: file.sha1 || undefined,
    sha256: file.sha256 || undefined,
  };
}

export function snapchatMediaViews(
  event: ForensicEvent,
  files: readonly SnapchatMediaFile[],
  index?: SnapchatMediaIndex
): SnapchatMediaView[] {
  const raw = typeof event.details?.mediaId === 'string' ? event.details.mediaId.trim() : '';
  if (!raw) return [];
  const decoded = typeof event.details?.mediaRef === 'string' ? event.details.mediaRef.trim() : '';
  const resolution = resolveSnapchatMedia(files, event.details, index);
  const match = resolution.file;
  const base = {
    key: `${event.id}:snap`,
    mediaId: raw,
    decodedId: decoded && decoded.toLowerCase() !== raw.toLowerCase() ? decoded : undefined,
    autoplay: false as const,
    fetchesRemote: false as const,
    parentMessageId: event.id,
    poster: null as string | null,
    hashes: {} as SnapchatMediaView['hashes'],
  };

  if (!match) {
    if (resolution.candidates.length > 1) {
      const names = resolution.candidates.map(file => file.relativePath || file.name).join(', ');
      return [{
        ...base,
        kind: 'ambiguous',
        localSrc: null,
        blurredByDefault: false,
        note: `Ambiguous media match: ${names}`,
      }];
    }
    return [{
      ...base,
      kind: 'missing',
      localSrc: null,
      blurredByDefault: false,
      note: SNAPCHAT_MEDIA_MISSING,
    }];
  }

  const mediaKind = match.mediaType || classifyMediaName(match.name || '') || classifyMediaName((match.relativePath || '').split(/[/\\]/).pop() || '');
  const src = localPreviewSrc(match);
  const located = {
    filename: match.name,
    path: match.relativePath,
    hashes: hashesOf(match),
  };
  if (!src || (mediaKind !== 'image' && mediaKind !== 'video')) {
    return [{
      ...base,
      ...located,
      kind: 'unsupported',
      localSrc: null,
      blurredByDefault: false,
      note: 'The local file could not be shown. Nothing was downloaded.',
    }];
  }

  const video = mediaKind === 'video';
  return [{
    ...base,
    ...located,
    kind: video ? 'local-video' : 'local-image',
    localSrc: src,
    poster: video ? SNAPCHAT_VIDEO_POSTER : null,
    blurredByDefault: true,
    note: '',
  }];
}

export function snapchatMessagesByFile(
  events: readonly ForensicEvent[],
  files: readonly SnapchatMediaFile[]
): Map<string, ForensicEvent[]> {
  const index = buildSnapchatMediaIndex(files);
  const map = new Map<string, ForensicEvent[]>();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const raw = typeof event.details?.mediaId === 'string' ? event.details.mediaId.trim() : '';
    if (!raw) continue;
    const match = resolveSnapchatCapturedMedia(files, event.details, index);
    if (!match) continue;
    const key = pathIdentity(match) || `loose:${(match.name || '').toLowerCase()}`;
    const list = map.get(key);
    if (list) list.push(event);
    else map.set(key, [event]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const delta = (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0);
      if (delta !== 0) return delta;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  return map;
}

export function snapchatFileKey(file: SnapchatMediaFile): string {
  return pathIdentity(file) || `loose:${(file.name || '').toLowerCase()}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A saved HTML file may use a data URL or a files/ path copied beside it. App and evidence paths are not export sources. */
function exportableSrc(url: string | null): string | null {
  if (!url || isRemote(url) || url.includes('..')) return null;
  if (url.startsWith('data:')) return url;
  if (url.startsWith('files/')) return url;
  return null;
}

/** HTML chat export fragment. Local bytes only. A missing file keeps the ID and the not-in-return label. */
export function snapchatMediaExportHtml(view: SnapchatMediaView): string {
  const id = escapeHtml(view.mediaId);
  const decoded = view.decodedId ? `<br/>Decoded ID: ${escapeHtml(view.decodedId)}` : '';
  const src = exportableSrc(view.localSrc);
  if (view.kind === 'local-image' && src) {
    return `<div data-attachment-kind="local-image">Media ID: ${id}${decoded}<br/><img class="media-preview" src="${escapeHtml(src)}" alt=""/></div>`;
  }
  if (view.kind === 'local-video' && src) {
    const poster = exportableSrc(view.poster);
    const posterAttr = poster ? ` poster="${escapeHtml(poster)}"` : '';
    return `<div data-attachment-kind="local-video">Media ID: ${id}${decoded}<br/><video class="media-preview" src="${escapeHtml(src)}"${posterAttr} controls playsinline></video></div>`;
  }
  const note = escapeHtml(view.note || SNAPCHAT_MEDIA_MISSING);
  return `<div data-attachment-kind="${view.kind === 'local-image' || view.kind === 'local-video' ? 'missing' : view.kind}">Media ID: ${id}${decoded}<br/>${note || escapeHtml(SNAPCHAT_MEDIA_MISSING)}</div>`;
}
