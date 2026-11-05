/**
 * Discord-only identity, message, and attachment handling.
 * Other providers are never collapsed or relabeled here.
 * Remote CDN URLs are described, never fetched. Local previews are not written to disk.
 */

import type { AccountRecord, ForensicEvent, ParseResult, UploadedFile } from '../types';
import { mediaDisplaySrc } from './casePersistence';
import { classifyMediaName, mediaExplorerFiles } from './mediaBrowser';
import { foldDiscordReportAccounts, mergeDiscordAccountRecords } from './discordSession';

export interface DiscordAttachmentRef {
  filename: string;
  url?: string;
  /** Snowflake id when the return supplied one. A small index such as 0 is not an id. */
  id?: string;
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
    const idRaw = stringField(record.id) || stringField(record.attachment_id);
    const id = /^\d{10,}$/.test(idRaw) ? idRaw : undefined;
    return [{ filename: filename || 'attachment', url: url || undefined, ...(id ? { id } : {}), contentType, size }];
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

/** Keep 16-digit-or-longer id values as strings so JSON.parse does not round them. */
export function preserveDiscordSnowflakeText(text: string): string {
  return text.replace(
    /("(?:id|message_id|messageid|channel_id|channelid|author_id|authorid|user_id|userid|guild_id|guildid|attachment_id|attachmentid)"\s*:\s*)(\d{16,})(?=\s*[,}\]])/gi,
    '$1"$2"'
  );
}

function decodeHtmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function hrefsIn(html: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = (match[1] || match[2] || '').replace(/&amp;/gi, '&').trim();
    if (href && !href.startsWith('#')) out.push(href);
  }
  return out;
}

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[\uFEFF\u0000-\u001F'"`_\-\s]/g, '');
}

function isScientific(text: string): boolean {
  return /^[-+]?\d+(\.\d+)?e[+-]?\d+$/i.test(text.replace(/\s+/g, ''));
}

const HTML_ID_KEYS = new Set(['id', 'messageid', 'authorid', 'channelid', 'userid']);

function cellStored(html: string, key: string): string {
  const text = decodeHtmlText(html);
  const digitsMatch = html.match(/\b(?:sdval|x:num|data-value)\s*=\s*["'](\d{16,})["']/i);
  const digits = digitsMatch ? digitsMatch[1] : '';
  if (HTML_ID_KEYS.has(key)) {
    const textDigits = /^\d{10,}$/.test(text) ? text : '';
    if (digits && textDigits) return digits.length >= textDigits.length ? digits : textDigits;
    if (digits && (isScientific(text) || !text)) return digits;
    return text;
  }
  if (key.includes('attach')) {
    const hrefs = hrefsIn(html);
    if (hrefs.length) {
      return hrefs.map(href => {
        if (/^https?:/i.test(href)) {
          const name = text && !/^https?:/i.test(text) ? text : '';
          return name ? `${name} (${href})` : href;
        }
        const name = href.split('?')[0].split('/').filter(Boolean).pop() || href;
        return name;
      }).join('\n');
    }
  }
  return text;
}

function htmlTableMessageRows(content: string): Record<string, unknown>[] | null {
  if (!/<table\b/i.test(content)) return null;
  const rows: string[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(content))) {
    const cells: string[] = [];
    const cellRe = /<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) cells.push(cellMatch[0]);
    if (cells.length) rows.push(cells);
  }
  if (rows.length < 2) return null;
  let header: string[] | null = null;
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const keys = rows[i].map(cell => headerKey(decodeHtmlText(cell)));
    const hasTime = keys.some(key => key === 'timestamp' || key === 'time');
    const hasId = keys.some(key => key === 'id' || key === 'messageid');
    const hasBody = keys.some(key => key === 'content' || key === 'contents' || key === 'body' || key === 'message' || key === 'attachments' || key === 'attachment');
    if (hasTime && hasId && hasBody) {
      header = keys;
      start = i + 1;
      break;
    }
  }
  if (!header) return null;
  const out: Record<string, unknown>[] = [];
  for (let r = start; r < rows.length; r++) {
    const record: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      record[key] = cellStored(rows[r][c] || '', key);
    }
    const stamp = record.timestamp || record.time || '';
    if (!stamp) continue;
    out.push({
      id: record.id || record.messageid || '',
      timestamp: stamp,
      content: record.contents || record.content || record.body || record.message || '',
      attachments: record.attachments || record.attachment || '',
      channel_id: record.channelid || '',
      author_id: record.authorid || record.userid || '',
      author_username: record.authorusername || record.username || record.author || '',
    });
  }
  return out.length ? out : null;
}

function htmlAttributeMessageRows(content: string): Record<string, unknown>[] | null {
  if (!/data-message-id\s*=/i.test(content)) return null;
  const re = /<([a-z0-9]+)\b([^>]*\sdata-message-id\s*=\s*["'][^"']+["'][^>]*)>([\s\S]*?)<\/\1>/gi;
  const out: Record<string, unknown>[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const attrs = match[2];
    const body = match[3];
    const id = (attrs.match(/data-message-id\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    const stamp = (attrs.match(/data-timestamp\s*=\s*["']([^"']+)["']/i) || [])[1]
      || (body.match(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/i) || [])[1]
      || '';
    if (!id || !stamp) continue;
    const hrefs = hrefsIn(body);
    const text = decodeHtmlText(body.replace(/<a\b[\s\S]*?<\/a>/gi, ' '));
    out.push({
      id,
      timestamp: stamp,
      content: text,
      attachments: hrefs.map(href => (/^https?:/i.test(href) ? href : (href.split('?')[0].split('/').filter(Boolean).pop() || href))).join('\n'),
      channel_id: (attrs.match(/data-channel-id\s*=\s*["']([^"']+)["']/i) || [])[1] || '',
      author_id: (attrs.match(/data-user-id\s*=\s*["']([^"']+)["']/i) || [])[1] || '',
    });
  }
  return out.length ? out : null;
}

/** Discord message rows from an HTML table or a data-message-id transcript. Null when the file is not that shape. */
export function discordMessageRowsFromHtml(content: string): Record<string, unknown>[] | null {
  if (!content) return null;
  const table = htmlTableMessageRows(content);
  if (table && table.length) return table;
  const blocks = htmlAttributeMessageRows(content);
  if (blocks && blocks.length) return blocks;
  return null;
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

function filePath(file: UploadedFile): string {
  return (file.relativePath || file.name || '').replace(/\\/g, '/').toLowerCase();
}

function fileSegments(file: UploadedFile): string[] {
  return filePath(file).split('/').filter(Boolean);
}

function fileBase(file: UploadedFile): string {
  const segs = fileSegments(file);
  return segs[segs.length - 1] || (file.name || '').toLowerCase();
}

export function discordUrlEvidence(url: string): { filename: string; channelId?: string; attachmentId?: string } {
  const filename = fileNameFromUrl(url);
  let pathname = url.split('?')[0].split('#')[0];
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* Keep the raw path when the string is not an absolute URL. */
  }
  const segs = pathname.split('/').filter(Boolean).map(seg => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  });
  if (segs.length && segs[segs.length - 1].toLowerCase() === filename.toLowerCase()) segs.pop();
  const numeric = segs.filter(seg => /^\d{10,}$/.test(seg));
  if (numeric.length >= 2) {
    return { filename, channelId: numeric[numeric.length - 2], attachmentId: numeric[numeric.length - 1] };
  }
  if (numeric.length === 1) return { filename, attachmentId: numeric[0] };
  return { filename };
}

function pathHasId(file: UploadedFile, id: string | undefined): boolean {
  if (!id || id.length < 8) return false;
  const want = id.toLowerCase();
  return fileSegments(file).some(seg => seg === want || seg.startsWith(`${want}.`) || seg.startsWith(`${want}_`) || seg.startsWith(`${want}-`));
}

function inAttachmentsFolder(file: UploadedFile): boolean {
  return fileSegments(file).includes('attachments');
}

export interface DiscordCaptureEvidence {
  filename: string;
  attachmentId?: string;
  channelId?: string;
  messageId?: string;
}

function filenameHits(file: UploadedFile, evidence: DiscordCaptureEvidence): boolean {
  const want = evidence.filename.trim().toLowerCase();
  if (!want) return false;
  const base = fileBase(file);
  const name = (file.name || '').toLowerCase();
  if (name === want || base === want) return true;
  const prefixed = base.match(/^\d+_(.+)$/);
  if (!prefixed || prefixed[1] !== want) return false;
  return pathHasId(file, evidence.attachmentId) || pathHasId(file, evidence.messageId) || pathHasId(file, evidence.channelId);
}

function idNamedFile(file: UploadedFile, evidence: DiscordCaptureEvidence): boolean {
  const id = (evidence.attachmentId || '').toLowerCase();
  if (!/^\d{10,}$/.test(id)) return false;
  const base = fileBase(file);
  if (base === id) return true;
  const dot = evidence.filename.lastIndexOf('.');
  const ext = dot > 0 ? evidence.filename.slice(dot).toLowerCase() : '';
  return !!ext && base === `${id}${ext}`;
}

function captureScore(file: UploadedFile, evidence: DiscordCaptureEvidence): number {
  const nameHit = filenameHits(file, evidence);
  const idFile = idNamedFile(file, evidence);
  if (!nameHit && !idFile) return -1;
  if ((nameHit || idFile) && pathHasId(file, evidence.attachmentId)) return 4;
  if (nameHit && pathHasId(file, evidence.messageId)) return 3;
  if (nameHit && pathHasId(file, evidence.channelId)) return 2;
  if (idFile && inAttachmentsFolder(file)) return 4;
  if (nameHit && inAttachmentsFolder(file)) return 1;
  if (nameHit) return 0;
  return -1;
}

/**
 * Link a message attachment to a file already in the return.
 * The candidate list is the Media Explorer index, plus image/video files
 * sitting in an attachments folder. A shared basename is not enough when
 * more than one file has it. Remote URLs are never fetched.
 */
export function resolveDiscordCapturedMedia(
  files: readonly UploadedFile[],
  evidence: DiscordCaptureEvidence
): UploadedFile | undefined {
  const indexed = new Set(mediaExplorerFiles(files));
  const pool: UploadedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (indexed.has(file) || (inAttachmentsFolder(file) && classifyMediaName(file.name || fileBase(file)))) {
      pool.push(file);
    }
  }
  let best = -1;
  const chosen: UploadedFile[] = [];
  for (let i = 0; i < pool.length; i++) {
    const score = captureScore(pool[i], evidence);
    if (score < 0) continue;
    if (score > best) {
      best = score;
      chosen.length = 0;
      chosen.push(pool[i]);
    } else if (score === best) {
      chosen.push(pool[i]);
    }
  }
  if (chosen.length === 1) return chosen[0];
  if (chosen.length > 1) return undefined;
  const want = evidence.filename.trim().toLowerCase();
  if (!want) return undefined;
  const exact = files.filter(file => (file.name || '').toLowerCase() === want || fileBase(file) === want);
  return exact.length === 1 ? exact[0] : undefined;
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
    const fromUrl = ref.url ? discordUrlEvidence(ref.url) : { filename: '' };
    const channelRaw = String(event.details?.channelId || '');
    const messageRaw = String(event.details?.messageId || '');
    const local = resolveDiscordCapturedMedia(files, {
      filename,
      attachmentId: stringField(ref.id) || fromUrl.attachmentId,
      channelId: fromUrl.channelId || (/^\d{10,}$/.test(channelRaw) ? channelRaw : undefined),
      messageId: messageRaw || undefined,
    });
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
