/**
 * Discord channel names from a legal return.
 * messages/c<channel id>/channel.json may supply a name and type.
 * Chat rows live in messages.csv or messages.json.
 * A name is shown only when the return supplies one. The channel id is never turned into a name.
 */

import type { ForensicEvent } from '../types';

export interface DiscordChannelMeta {
  id: string;
  /** Name string from channel.json. Absent when the file did not supply one. */
  name?: string;
  /** Raw type value from channel.json. Not used as a display name. */
  type?: string;
  /** Normalized relative path of the channel.json that supplied this record. */
  sourcePath: string;
}

export function normalizeDiscordRelativePath(relativePath?: string | null): string {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * Channel id from a Discord return path. Same rule as the message parser:
 * a c<id> folder or a channel-<id> segment, and the id is at least 10 digits.
 */
export function discordChannelIdFromPath(relativePath?: string | null): string | null {
  if (!relativePath) return null;
  const norm = relativePath.replace(/\\/g, '/');
  return norm.match(/(?:^|\/)c(\d{10,})(?:\/|$)/i)?.[1]
    || norm.match(/channel[_-]?(\d{10,})/i)?.[1]
    || null;
}

export function isDiscordChannelFileName(fileName: string): boolean {
  const base = fileName.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
  return base === 'channel.json';
}

export function isDiscordUserRecord(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const row = data as Record<string, unknown>;
  return !!(
    row.username ||
    row.email ||
    row.phone ||
    row.global_name ||
    row.registration_ip ||
    row.created_at ||
    row.mfa_enabled != null ||
    row.discriminator != null
  );
}

function suppliedChannelName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/^#+/, '').trim();
  return trimmed || undefined;
}

/** Read channel.json. Returns null when the file has no channel id. */
export function discordChannelMetaFromValue(data: unknown, relativePath?: string): DiscordChannelMeta | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const jsonId = row.id == null ? '' : String(row.id).trim();
  const pathId = discordChannelIdFromPath(relativePath) || '';
  const id = jsonId || pathId;
  if (!id) return null;
  const name = suppliedChannelName(row.name);
  const type = row.type == null || String(row.type).trim() === '' ? undefined : String(row.type).trim();
  return {
    id,
    ...(name ? { name } : {}),
    ...(type ? { type } : {}),
    sourcePath: normalizeDiscordRelativePath(relativePath),
  };
}

export function discordMessageRecords(fileName: string, data: unknown): Record<string, unknown>[] | null {
  if (isDiscordChannelFileName(fileName)) return null;
  const base = fileName.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
  const asRecords = (value: unknown): Record<string, unknown>[] | null => {
    if (!Array.isArray(value)) return null;
    const rows: Record<string, unknown>[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      rows.push(item as Record<string, unknown>);
    }
    return rows;
  };
  let rows: Record<string, unknown>[] | null = null;
  if (Array.isArray(data)) rows = asRecords(data);
  else if (data && typeof data === 'object' && Array.isArray((data as { messages?: unknown }).messages)) {
    rows = asRecords((data as { messages: unknown }).messages);
  }
  if (!rows) return null;
  if (base === 'messages.json') return rows;
  if (rows.length === 0) return null;
  const messageLike = rows.every(row => {
    const keys = new Set(Object.keys(row).map(key => key.toLowerCase()));
    const userLike = keys.has('username') || keys.has('email') || keys.has('global_name');
    const body = keys.has('contents') || keys.has('content') || keys.has('timestamp');
    return body && !userLike;
  });
  return messageLike ? rows : null;
}

export function discordRecordField(row: Record<string, unknown>, ...keys: string[]): unknown {
  const lower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) lower.set(key.toLowerCase(), value);
  for (const key of keys) {
    const found = lower.get(key.toLowerCase());
    if (found !== undefined) return found;
  }
  return undefined;
}

export function discordMessageSender(authorUser: unknown, authorId: unknown): string {
  const user = typeof authorUser === 'string' ? authorUser.trim() : '';
  const id = authorId == null ? '' : String(authorId).trim();
  if (user && id) return `${user} (${id})`;
  if (user) return user;
  if (id) return id;
  return 'Unknown';
}

/** Package messages.csv has ID, Timestamp, Contents, Attachments and no channel_id column. */
export function isDiscordPackageMessageHeader(headers: string[]): boolean {
  const keys = new Set(
    headers.map(header => header.toLowerCase().trim().replace(/[\uFEFF\u0000-\u001F'"`_\-\s]/g, ''))
  );
  if (keys.has('channelid')) return false;
  const hasTime = keys.has('timestamp') || keys.has('time');
  const hasBody = keys.has('contents') || keys.has('content');
  const hasId = keys.has('id') || keys.has('messageid');
  return hasTime && hasBody && hasId;
}

function collapseChannelGroup(group: DiscordChannelMeta[]): DiscordChannelMeta | null {
  if (group.length === 0) return null;
  const ids = new Set(group.map(item => item.id));
  if (ids.size !== 1) {
    // Same path describing different ids. Do not attach either name.
    return null;
  }
  const names = new Set(group.map(item => item.name).filter((name): name is string => !!name));
  const types = new Set(group.map(item => item.type).filter((type): type is string => !!type));
  const name = names.size === 1 ? [...names][0] : undefined;
  const type = types.size === 1 ? [...types][0] : undefined;
  return {
    id: group[0].id,
    ...(name ? { name } : {}),
    ...(type ? { type } : {}),
    sourcePath: group[0].sourcePath,
  };
}

/**
 * One record per channel id.
 * Duplicate paths collapse first. Conflicting supplied names are dropped
 * so the UI does not pick a name the return did not agree on.
 */
export function indexDiscordChannels(metas: readonly DiscordChannelMeta[]): Map<string, DiscordChannelMeta> {
  const byPath = new Map<string, DiscordChannelMeta[]>();
  const unpathed: DiscordChannelMeta[] = [];
  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    if (!meta.id) continue;
    const pathKey = meta.sourcePath ? normalizeDiscordRelativePath(meta.sourcePath) : '';
    if (!pathKey) {
      unpathed.push(meta);
      continue;
    }
    const list = byPath.get(pathKey);
    if (list) list.push(meta);
    else byPath.set(pathKey, [meta]);
  }

  const collapsed: DiscordChannelMeta[] = [];
  for (const group of byPath.values()) {
    const one = collapseChannelGroup(group);
    if (one) collapsed.push(one);
  }
  for (const meta of unpathed) collapsed.push(meta);

  const byId = new Map<string, DiscordChannelMeta[]>();
  for (const meta of collapsed) {
    const list = byId.get(meta.id);
    if (list) list.push(meta);
    else byId.set(meta.id, [meta]);
  }

  const indexed = new Map<string, DiscordChannelMeta>();
  for (const [id, group] of byId) {
    const one = collapseChannelGroup(group);
    if (one) indexed.set(id, one);
  }
  return indexed;
}

/** Copy a supplied channel name onto Discord message rows. Leaves every other event alone. */
export function applyDiscordChannelNames(
  events: ForensicEvent[],
  metas: readonly DiscordChannelMeta[],
  onlyEventIds?: ReadonlySet<string>
): void {
  if (metas.length === 0) return;
  const indexed = indexDiscordChannels(metas);
  if (indexed.size === 0) return;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.category !== 'message') continue;
    if (onlyEventIds && !onlyEventIds.has(event.id)) continue;
    const channelId = String(event.details?.channelId || '').trim();
    if (!channelId) continue;
    const info = indexed.get(channelId);
    if (!info?.name) continue;
    events[i] = {
      ...event,
      details: {
        ...event.details,
        channelName: info.name,
        ...(info.type ? { channelType: info.type } : {}),
      },
    };
  }
}

/** Conversation label. A supplied name is shown beside the id. An id alone stays an id. */
export function discordChannelLabel(channelId: string, channelName?: string | null): string {
  const id = String(channelId || '').trim();
  const name = String(channelName || '').trim();
  if (name) return `#${name} — ${id}`;
  if (!id || id === 'general') return 'Discord Channel';
  return id;
}

export function discordThreadDisplayName(
  channelId: string,
  messages: Array<{ details?: { channelName?: unknown } | null }>
): { label: string; channelName?: string; channelId: string } {
  const names = new Set<string>();
  for (const message of messages) {
    const raw = message.details?.channelName;
    if (typeof raw === 'string' && raw.trim()) names.add(raw.trim());
  }
  const channelName = names.size === 1 ? [...names][0] : undefined;
  const id = String(channelId || '').trim();
  return {
    channelId: id,
    ...(channelName ? { channelName } : {}),
    label: discordChannelLabel(id, channelName),
  };
}

/**
 * Channel-id lookup for the Discord conversation list.
 * Message-text search is separate: a hit count above zero still drives global-search navigation.
 */
export function discordChannelLookup(channelId: string, channelName: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const id = channelId.trim().toLowerCase();
  if (id && id !== 'general') {
    if (id === q) return true;
    if (q.length >= 4 && id.includes(q)) return true;
  }
  const name = (channelName || '').trim().toLowerCase();
  if (!name) return false;
  if (name === q) return true;
  if (q.length >= 3 && name.includes(q)) return true;
  return false;
}

/** Keep the open transcript visible for an id/name lookup that matched no message text. */
export function discordLookupKeepsMessages(
  channelId: string,
  channelName: string | undefined,
  query: string,
  messageHitCount: number
): boolean {
  return messageHitCount === 0 && discordChannelLookup(channelId, channelName, query);
}
