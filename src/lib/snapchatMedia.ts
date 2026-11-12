/**
 * Snapchat message media.
 * A chat row already carries the raw media ID and, for b~ values, the decoded reference.
 * A file already in the return is shown only when exactly one name or path matches
 * either form. Remote Snapchat and CDN addresses are never requested.
 */

import type { ForensicEvent } from '../types';
import { mediaDisplaySrc } from './casePersistence';
import { classifyMediaName } from './mediaBrowser';
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
  kind: 'local-image' | 'local-video' | 'missing' | 'unsupported';
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

export type SnapchatMediaIndex = Map<string, SnapchatMediaFile[]>;

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

function addToken(into: Set<string>, value: string) {
  const token = value.trim().toLowerCase();
  if (token.length >= MIN_TOKEN) into.add(token);
}

function tokensFor(file: SnapchatMediaFile): string[] {
  const name = (file.name || '').replace(/\\/g, '/');
  const rel = (file.relativePath || name).replace(/\\/g, '/');
  const tokens = new Set<string>();
  addToken(tokens, stemOf(name));
  addToken(tokens, stemOf(rel));
  addToken(tokens, rel);
  for (const segment of rel.split('/')) {
    if (!segment || segment === '.' || segment === '..') continue;
    addToken(tokens, segment);
    addToken(tokens, stemOf(segment));
  }
  return [...tokens];
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
  const map: SnapchatMediaIndex = new Map();
  const seen = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!isSnapMediaCandidate(file)) continue;
    const id = pathIdentity(file) || `loose:${(file.name || '').toLowerCase()}#${i}`;
    for (const token of tokensFor(file)) {
      const mark = `${token}|${id}`;
      if (seen.has(mark)) continue;
      seen.add(mark);
      const list = map.get(token);
      if (list) list.push(file);
      else map.set(token, [file]);
    }
  }
  return map;
}

function hitsForKey(index: SnapchatMediaIndex, key: string): SnapchatMediaFile[] {
  const token = key.trim().toLowerCase();
  if (token.length < MIN_TOKEN) return [];
  return uniqueHits(index.get(token) || []);
}

function keysFrom(details: { mediaId?: unknown; mediaRef?: unknown } | undefined): { raw: string; decoded: string } {
  const raw = typeof details?.mediaId === 'string' ? details.mediaId.trim() : '';
  const stored = typeof details?.mediaRef === 'string' ? details.mediaRef.trim() : '';
  const decoded = stored || (raw ? decodeMediaId(raw) || '' : '');
  return { raw, decoded };
}

/**
 * Accept a file only when the raw media ID and the decoded b~ form together
 * point at exactly one name or path. Two files, or the two forms pointing at
 * different files, stay unresolved.
 */
export function resolveSnapchatCapturedMedia(
  files: readonly SnapchatMediaFile[],
  details: { mediaId?: unknown; mediaRef?: unknown } | undefined,
  index?: SnapchatMediaIndex
): SnapchatMediaFile | null {
  const idx = index || buildSnapchatMediaIndex(files);
  const { raw, decoded } = keysFrom(details);
  const rawHits = hitsForKey(idx, raw);
  const decodedKey = decoded.toLowerCase() === raw.toLowerCase() ? '' : decoded;
  const decodedHits = hitsForKey(idx, decodedKey);
  const union = uniqueHits([...rawHits, ...decodedHits]);
  if (union.length !== 1) return null;
  if (rawHits.length > 1 || decodedHits.length > 1) return null;
  if (rawHits.length === 1 && decodedHits.length === 1 && pathIdentity(rawHits[0]) !== pathIdentity(decodedHits[0])) {
    if (rawHits[0] !== decodedHits[0]) return null;
  }
  return union[0];
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
  const match = resolveSnapchatCapturedMedia(files, event.details, index);
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

/** HTML chat export fragment. Local bytes only. A missing file keeps the ID and the not-in-return label. */
export function snapchatMediaExportHtml(view: SnapchatMediaView): string {
  const id = escapeHtml(view.mediaId);
  const decoded = view.decodedId ? `<br/>Decoded ID: ${escapeHtml(view.decodedId)}` : '';
  if (view.kind === 'local-image' && view.localSrc && !isRemote(view.localSrc)) {
    return `<div data-attachment-kind="local-image">Media ID: ${id}${decoded}<br/><img class="media-preview" src="${escapeHtml(view.localSrc)}" alt=""/></div>`;
  }
  if (view.kind === 'local-video' && view.localSrc && !isRemote(view.localSrc)) {
    const poster = view.poster && !isRemote(view.poster) ? ` poster="${escapeHtml(view.poster)}"` : '';
    return `<div data-attachment-kind="local-video">Media ID: ${id}${decoded}<br/><video class="media-preview" src="${escapeHtml(view.localSrc)}"${poster} controls playsinline></video></div>`;
  }
  const note = escapeHtml(view.note || SNAPCHAT_MEDIA_MISSING);
  return `<div data-attachment-kind="${view.kind}">Media ID: ${id}${decoded}<br/>${note}</div>`;
}
