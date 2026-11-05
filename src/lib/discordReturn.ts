/**
 * Discord-only identity, message, and attachment handling.
 * Other providers are never collapsed or relabeled here.
 * Remote CDN URLs are described, never fetched. Local previews are not written to disk.
 */

import type { AccountRecord, ForensicEvent, ParseResult, UploadedFile } from '../types';
import { mediaDisplaySrc } from './casePersistence';
import { classifyMediaName } from './mediaBrowser';
import { foldDiscordReportAccounts, mergeDiscordAccountRecords } from './discordSession';

export interface DiscordAttachmentRef {
  filename: string;
  url?: string;
  contentType?: string;
  size?: number;
}

export interface DiscordAttachmentView {
  key: string;
  kind: 'local-image' | 'local-video' | 'link-only' | 'missing' | 'unsupported';
  filename: string;
  path?: string;
  url?: string;
  contentType?: string;
  size?: number;
  hashes: { md5?: string; sha1?: string; sha256?: string };
  /** Browser URL for a file already in the return. Never a Discord CDN address. */
  localSrc: string | null;
  blurredByDefault: boolean;
  autoplay: false;
  fetchesRemote: false;
  linkOnly: boolean;
  parentMessageId: string;
  note: string;
}

function stringField(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function fileNameFromUrl(url: string): string {
  const path = url.split('?')[0].split('#')[0];
  const seg = path.split('/').filter(Boolean).pop() || 'attachment';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** Parse a Discord attachment cell: package "name (url)", a bare CDN URL, a filename, or a JSON list. */
export function parseDiscordAttachmentField(value: unknown): DiscordAttachmentRef[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    const out: DiscordAttachmentRef[] = [];
    for (const item of value) out.push(...parseDiscordAttachmentField(item));
    return dedupeAttachmentRefs(out);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const url = stringField(record.url) || stringField(record.proxy_url);
    const filename = stringField(record.filename) || stringField(record.fileName) || (url ? fileNameFromUrl(url) : '');
    if (!filename && !url) return [];
    const sizeRaw = record.size ?? record.fileSizeBytes ?? record.file_size;
    const size = typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) ? sizeRaw : undefined;
    const contentType = stringField(record.content_type) || stringField(record.contentType) || undefined;
    return [{ filename: filename || 'attachment', url: url || undefined, contentType, size }];
  }

  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return parseDiscordAttachmentField(JSON.parse(text));
    } catch {
      /* The cell is ordinary text that happens to start with a bracket. */
    }
  }

  const out: DiscordAttachmentRef[] = [];
  const seenUrls = new Set<string>();
  const paired = /([^()\r\n]+?)\s*\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = paired.exec(text))) {
    const filename = match[1].trim();
    const url = match[2].trim();
    if (!filename || /^https?:$/i.test(filename)) continue;
    out.push({ filename, url });
    seenUrls.add(url);
  }

  const urls = text.match(/https?:\/\/[^\s,)]+/g) || [];
  for (const url of urls) {
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    out.push({ filename: fileNameFromUrl(url), url });
  }

  const withoutUrls = text
    .replace(/[^()\r\n]+?\s*\(https?:\/\/[^)\s]+\)/g, ' ')
    .replace(/https?:\/\/[^\s,)]+/g, ' ');
  const tokens = withoutUrls
    .split(/[\r\n|;]+/)
    .flatMap(part => part.split(','))
    .map(part => part.trim())
    .filter(part => part && !/^https?:$/i.test(part));
  const knownNames = new Set(out.map(item => item.filename.toLowerCase()));
  for (const token of tokens) {
    if (knownNames.has(token.toLowerCase())) continue;
    out.push({ filename: token });
    knownNames.add(token.toLowerCase());
  }
  return dedupeAttachmentRefs(out);
}

function dedupeAttachmentRefs(refs: DiscordAttachmentRef[]): DiscordAttachmentRef[] {
  const out: DiscordAttachmentRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.filename.toLowerCase()}|${ref.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function isDiscordAccount(account: AccountRecord): boolean {
  const provider = (account.provider || '').replace(/\s+/g, '').toLowerCase();
  if (provider === 'discord') return true;
  return (account.accountKey || '').toLowerCase().startsWith('discord::');
}

function discordUserId(account: AccountRecord): string {
  if (account.userId == null) return '';
  return String(account.userId).trim();
}

function mergeAccountProvenance(kept: AccountRecord, extra: AccountRecord): AccountRecord {
  return mergeDiscordAccountRecords(kept, extra);
}

/** Collapse repeated Discord subscriber cards that share a user id. Kik and other providers stay as they are. */
export function dedupeDiscordAccounts(accounts: readonly AccountRecord[]): AccountRecord[] {
  const out: AccountRecord[] = [];
  const indexByUid = new Map<string, number>();
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const uid = isDiscordAccount(account) ? discordUserId(account) : '';
    if (!uid) {
      out.push(account);
      continue;
    }
    const prev = indexByUid.get(uid);
    if (prev == null) {
      indexByUid.set(uid, out.length);
      out.push(account);
      continue;
    }
    out[prev] = mergeAccountProvenance(out[prev], account);
  }
  return foldDiscordReportAccounts(out);
}

function discordEventKey(event: ForensicEvent): string | null {
  const flagged = event.details?.discord === true;
  if (event.category === 'message') {
    const messageId = event.details?.messageId;
    // channelId is written only by the Discord parser, including returns parsed before the discord flag existed.
    const fromDiscord = flagged || event.details?.channelId != null;
    if (!fromDiscord || messageId == null || String(messageId).trim() === '') return null;
    return `msg:${String(messageId).trim()}`;
  }
  if (flagged && event.id && event.id.startsWith('disc-')) return `id:${event.id}`;
  return null;
}

function mergeEventProvenance(kept: ForensicEvent, extra: ForensicEvent): ForensicEvent {
  if (!extra.sourceFile || extra.sourceFile === kept.sourceFile) return kept;
  const prior = Array.isArray(kept.details?.alsoSeenIn) ? kept.details.alsoSeenIn.map(String) : [];
  if (prior.includes(extra.sourceFile)) return kept;
  return {
    ...kept,
    details: { ...kept.details, alsoSeenIn: [...prior, extra.sourceFile] },
  };
}

/**
 * One stored Discord message per message id.
 * Messages with no id, and every non-Discord event, are left untouched
 * so identical text in two real messages is preserved.
 */
export function dedupeDiscordEvents(events: readonly ForensicEvent[]): ForensicEvent[] {
  const out: ForensicEvent[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const key = discordEventKey(event);
    if (!key) {
      out.push(event);
      continue;
    }
    const prev = seen.get(key);
    if (prev == null) {
      seen.set(key, out.length);
      out.push(event);
      continue;
    }
    out[prev] = mergeEventProvenance(out[prev], event);
  }
  return out;
}

/** Re-import appends the new parse, then folds Discord duplicates only. */
export function combineWorkspaceResults(previous: ParseResult | null, incoming: ParseResult | null): ParseResult | null {
  if (!incoming) return previous;
  if (!previous) return incoming;
  const events: ForensicEvent[] = [];
  const previousEvents = previous.events || [];
  const incomingEvents = incoming.events || [];
  for (let i = 0; i < previousEvents.length; i++) events.push(previousEvents[i]);
  for (let i = 0; i < incomingEvents.length; i++) events.push(incomingEvents[i]);
  const accounts = [...(previous.accounts || []), ...(incoming.accounts || [])];
  return {
    ...incoming,
    events: dedupeDiscordEvents(events),
    accounts: dedupeDiscordAccounts(accounts),
  };
}

function matchLocalFile(filename: string, files: readonly UploadedFile[]): UploadedFile | undefined {
  const want = filename.trim().toLowerCase();
  if (!want) return undefined;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = (file.name || '').toLowerCase();
    const relative = (file.relativePath || '').replace(/\\/g, '/').toLowerCase();
    const base = relative.split('/').pop() || '';
    if (name === want || base === want) return file;
  }
  return undefined;
}

function contentTypeFor(filename: string, declared?: string): string | undefined {
  if (declared) return declared;
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'm4v') return 'video/x-m4v';
  return undefined;
}

/**
 * Inline preview only when a supported file is already in the return.
 * A Discord CDN URL never becomes an image or video source.
 */
export function discordAttachmentViews(event: ForensicEvent, files: readonly UploadedFile[]): DiscordAttachmentView[] {
  const refs = event.details?.discordAttachments;
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const views: DiscordAttachmentView[] = [];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i] as DiscordAttachmentRef;
    if (!ref || typeof ref !== 'object') continue;
    const filename = stringField(ref.filename) || (ref.url ? fileNameFromUrl(ref.url) : 'attachment');
    const local = matchLocalFile(filename, files);
    const hashes = {
      md5: local?.md5 || undefined,
      sha1: local?.sha1 || undefined,
      sha256: local?.sha256 || undefined,
    };
    const path = local?.relativePath || undefined;
    const size = typeof ref.size === 'number' ? ref.size : local?.size;
    const contentType = contentTypeFor(filename, ref.contentType);
    const base = {
      key: `${event.id}:${i}:${filename}`,
      filename,
      path,
      url: ref.url || undefined,
      contentType,
      size,
      hashes,
      autoplay: false as const,
      fetchesRemote: false as const,
      parentMessageId: event.id,
    };

    if (!local) {
      if (ref.url) {
        views.push({
          ...base,
          kind: 'link-only',
          localSrc: null,
          blurredByDefault: false,
          linkOnly: true,
          note: 'Link only. This media was not captured or downloaded.',
        });
      } else {
        views.push({
          ...base,
          kind: 'missing',
          localSrc: null,
          blurredByDefault: false,
          linkOnly: false,
          note: 'No file with this filename is in the return.',
        });
      }
      continue;
    }

    const display = mediaDisplaySrc(local);
    const mediaKind = local.mediaType || classifyMediaName(local.name || filename);
    if (!display.url || display.missing || (mediaKind !== 'image' && mediaKind !== 'video')) {
      views.push({
        ...base,
        kind: 'unsupported',
        localSrc: null,
        blurredByDefault: false,
        linkOnly: false,
        note: display.missing
          ? 'The local file is missing. Nothing was downloaded to replace it.'
          : 'This file type cannot be played inline. The original file was not modified.',
      });
      continue;
    }

    views.push({
      ...base,
      kind: mediaKind === 'video' ? 'local-video' : 'local-image',
      localSrc: display.url,
      blurredByDefault: true,
      linkOnly: false,
      note: '',
    });
  }
  return views;
}
