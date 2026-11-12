/**
 * Conversation search navigation.
 * The channel is chosen first. Scrolling is allowed only after that channel's
 * virtual page actually contains the target message.
 */

import type { ForensicEvent } from '../types';
import { formatDiscordUtc, type SubscriberAliasGroup } from './discordSession';
import { paginateItems } from './casePersistence';

export interface ThreadFeedFilters {
  startDate: string;
  endDate: string;
  senderFilter: string;
  searchTerm: string;
  showHollowInFeed: boolean;
  filterToKeywordHits: boolean;
  keywords: string[];
  /** Discord subscriber names, including historical usernames, grouped per account. */
  subscriberAliases?: readonly SubscriberAliasGroup[];
}

export interface ConversationJumpPlan {
  threadId: string;
  messageId: string;
  page: number;
}

export function isHollowChatMessage(message: ForensicEvent): boolean {
  // A Discord package row is a real message. Empty Contents is attachment-only or blank text, not a stub.
  if (message.details?.discord === true) return false;
  if (message.category === 'message' && message.details?.channelId != null && message.details?.messageId != null) return false;
  if (message.details?.isHollowMessage === true) return true;
  const content = (message.content || '').trim();
  if (!content || content === '[Empty Message]') return true;
  if (/^\[Network:/i.test(content)) return true;
  if (/^\[Abuse report/i.test(content)) return true;
  return false;
}

export function markupSearchHit(text: string, query: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const q = query.trim();
  if (!q) return escaped;
  const esc = q.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return escaped.replace(new RegExp('(' + esc + ')', 'gi'), (match) => {
    return '<mark style="background-color:#a5f3fc;color:#0e7490;padding:1px 4px;border-radius:3px;font-weight:800;border:1px solid #67e8f9">' + match + '</mark>';
  });
}

function messageSortMs(message: ForensicEvent): number {
  const parsed = Date.parse(message.timestamp);
  return isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function queryHitsAlias(query: string, token: string): boolean {
  if (token === query) return true;
  if (/^\d{6,}$/.test(token)) return false;
  return query.length >= 3 && token.includes(query);
}

function messageSearchText(message: ForensicEvent, bareId: boolean): string {
  const parts = [
    message.content || '',
    message.sender || '',
    message.recipient || '',
    message.ipAddress || '',
    message.sourceFile || '',
    String(message.details?.messageId || ''),
  ];
  if (bareId) return parts.join(' ');
  parts.push(message.timestamp || '');
  const rawStamp = message.details?.timestampRaw;
  if (typeof rawStamp === 'string') parts.push(rawStamp);
  if (message.timestamp) parts.push(formatDiscordUtc(message.timestamp));
  const attached = message.details?.attachments;
  if (typeof attached === 'string') parts.push(attached);
  if (message.details?.mediaId) parts.push(String(message.details.mediaId));
  if (message.details?.mediaRef) parts.push(String(message.details.mediaRef));
  if (message.details?.resolvedMediaName) parts.push(String(message.details.resolvedMediaName));
  const refs = message.details?.discordAttachments;
  if (Array.isArray(refs)) {
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      if (!ref || typeof ref !== 'object') continue;
      if (ref.filename) parts.push(String(ref.filename));
      if (ref.url) parts.push(String(ref.url));
    }
  }
  return parts.join(' ');
}

export function messageMatchesQuery(
  message: ForensicEvent,
  query: string,
  aliases?: readonly SubscriberAliasGroup[]
): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  const bareId = /^\d{10,}$/.test(q);
  const messageId = String(message.details?.messageId || '').toLowerCase();
  if (bareId && messageId && messageId.includes(q)) return true;
  const hay = messageSearchText(message, bareId).toLowerCase();
  if (hay.includes(q)) return true;
  if (!aliases || aliases.length === 0) return false;
  const sender = (message.sender || '').toLowerCase();
  const recipient = (message.recipient || '').toLowerCase();
  for (let i = 0; i < aliases.length; i++) {
    const tokens = aliases[i].names.map(name => name.trim().toLowerCase()).filter(name => name.length >= 2);
    const named = tokens.some(token => queryHitsAlias(q, token));
    const party = tokens.some(token => sender.includes(token) || recipient.includes(token));
    if (named && party) return true;
  }
  return false;
}

function keywordPattern(keywords: string[]): RegExp | null {
  const cleaned = keywords.map(keyword => keyword.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  const escaped = cleaned.map(keyword => keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  return new RegExp('(' + escaped.join('|') + ')', 'i');
}

export function messageHasKeyword(message: ForensicEvent, keywords: string[]): boolean {
  const pattern = keywordPattern(keywords);
  if (!pattern) return false;
  const hay = `${message.content || ''} ${message.sender || ''} ${message.recipient || ''}`;
  return pattern.test(hay);
}

export function filterThreadMessages(messages: readonly ForensicEvent[], filters: Pick<ThreadFeedFilters, 'startDate' | 'endDate' | 'senderFilter' | 'searchTerm' | 'subscriberAliases'>): ForensicEvent[] {
  let list = messages.slice();
  if (filters.startDate) {
    const startMs = new Date(filters.startDate + 'T00:00:00').getTime();
    list = list.filter(message => {
      const parsed = Date.parse(message.timestamp);
      return isNaN(parsed) || parsed >= startMs;
    });
  }
  if (filters.endDate) {
    const endMs = new Date(filters.endDate + 'T23:59:59').getTime();
    list = list.filter(message => {
      const parsed = Date.parse(message.timestamp);
      return isNaN(parsed) || parsed <= endMs;
    });
  }
  if (filters.senderFilter && filters.senderFilter !== 'All Senders') {
    list = list.filter(message => message.sender === filters.senderFilter);
  }
  const query = filters.searchTerm.trim().toLowerCase();
  if (query) list = list.filter(message => messageMatchesQuery(message, query, filters.subscriberAliases));
  list.sort((a, b) => {
    const hollowDelta = Number(isHollowChatMessage(a)) - Number(isHollowChatMessage(b));
    if (hollowDelta !== 0) return hollowDelta;
    return messageSortMs(a) - messageSortMs(b);
  });
  return list;
}

export function feedMessagesForThread(messages: readonly ForensicEvent[], filters: ThreadFeedFilters): ForensicEvent[] {
  const filtered = filterThreadMessages(messages, filters);
  const base = filters.showHollowInFeed ? filtered : filtered.filter(message => !isHollowChatMessage(message));
  if (filters.filterToKeywordHits && keywordPattern(filters.keywords)) {
    return base.filter(message => messageHasKeyword(message, filters.keywords));
  }
  return base;
}

export function renderedMessageIds(messages: readonly ForensicEvent[], page: number, pageSize: number): string[] {
  return paginateItems(messages, page, pageSize).items.map(message => message.id);
}

/**
 * Scroll only after the destination channel is open and the virtual page
 * that contains the message is the page on screen.
 */
export function jumpScrollAllowed(
  state: { threadId: string; page: number; renderedIds: readonly string[] },
  plan: ConversationJumpPlan
): boolean {
  return state.threadId === plan.threadId
    && state.page === plan.page
    && state.renderedIds.includes(plan.messageId);
}

export function planConversationJump(args: {
  threads: readonly { id: string; messages: readonly ForensicEvent[] }[];
  threadId: string;
  mode: 'search' | 'keyword';
  filters: ThreadFeedFilters;
  pageSize: number;
  messageId?: string;
}): ConversationJumpPlan | null {
  const thread = args.threads.find(item => item.id === args.threadId);
  if (!thread) return null;
  const feed = feedMessagesForThread(thread.messages, args.filters);
  const query = args.filters.searchTerm.trim().toLowerCase();
  const matches = (message: ForensicEvent) => {
    if (isHollowChatMessage(message)) return false;
    if (args.mode === 'search') return query !== '' && messageMatchesQuery(message, query, args.filters.subscriberAliases);
    return messageHasKeyword(message, args.filters.keywords);
  };
  const match = args.messageId
    ? thread.messages.find(message => message.id === args.messageId)
    : thread.messages.find(matches);
  if (!match) return null;
  let list: readonly ForensicEvent[] = feed;
  let index = feed.findIndex(message => message.id === match.id);
  if (index < 0) {
    list = thread.messages;
    index = thread.messages.findIndex(message => message.id === match.id);
  }
  if (index < 0) return null;
  const pageSize = args.pageSize > 0 ? args.pageSize : 40;
  return {
    threadId: thread.id,
    messageId: match.id,
    page: Math.floor(index / pageSize) + 1,
  };
}
