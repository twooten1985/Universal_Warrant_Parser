/**
 * Synthetic Discord attachment-only rows, local media association, and timeline focus.
 * No case data. Run: npx tsx scripts/verify-discord-attachment-link.ts
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseForensicFile } from '../src/parserHelper';
import { dedupeDiscordEvents, discordAttachmentViews } from '../src/lib/discordReturn';
import { mediaExplorerFiles } from '../src/lib/mediaBrowser';
import { formatDiscordUtc, formatInstantInZone, parseDiscordUtcTimestamp } from '../src/lib/discordSession';
import {
  feedMessagesForThread,
  isHollowChatMessage,
  messageMatchesQuery,
  planConversationJump,
  type ThreadFeedFilters,
} from '../src/lib/conversationJump';
import { DiscordAttachmentCard } from '../src/components/DiscordAttachmentCard';
import { EventTimeline, planTimelineSelection } from '../src/components/EventTimeline';
import { ConversationViewer } from '../src/components/ConversationViewer';
import type { ForensicEvent, UploadedFile } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const CHANNEL = '444000000000000001';
const OTHER_CHANNEL = '444000000000000002';
const BEFORE_ID = '555000000000000001';
const MEDIA_ID = '555000000000000002';
const AFTER_ID = '555000000000000003';
const AUTHOR = '666000000000000001';
const ATTACH = '777000000000000001';
const FILE = 'synthetic-clip.mov';
const ISO = '2026-05-22T17:03:00.000Z';
const URL = `https://discord.storage.googleapis.com/media/${CHANNEL}/${ATTACH}/${FILE}`;
const VIDEO = 'data:video/mp4;base64,AAAA';

function filters(searchTerm: string): ThreadFeedFilters {
  return {
    startDate: '',
    endDate: '',
    senderFilter: 'All Senders',
    searchTerm,
    showHollowInFeed: false,
    filterToKeywordHits: false,
    keywords: [],
  };
}

function csvReturn(): string {
  return [
    'channel_id,message_id,timestamp,author_id,author_username,content,attachments',
    `${CHANNEL},${BEFORE_ID},2026-05-22 15:35:00+00:00,${AUTHOR},synthetic_before,synthetic before text,`,
    `${CHANNEL},${MEDIA_ID},2026-05-22 17:03:00+00:00,${AUTHOR},synthetic_media,,${URL}`,
    `${CHANNEL},${AFTER_ID},2026-05-22 17:10:00+00:00,${AUTHOR},synthetic_after,synthetic after text,`,
  ].join('\n');
}

function messagesOf(events: ForensicEvent[]): ForensicEvent[] {
  return events.filter(event => event.category === 'message');
}

function mediaFile(name: string, relativePath: string): UploadedFile {
  return {
    name,
    relativePath,
    content: VIDEO,
    size: 4,
    isMedia: true,
    mediaType: 'video',
  };
}

const parsed = parseForensicFile('discord', 'messages.csv', csvReturn(), `messages/c${CHANNEL}/messages.csv`);
const rows = messagesOf(parsed.events);
assert(rows.length === 3, 'text, attachment-only, and following text stay three rows');
const ordered = rows.slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
assert(ordered[0].details?.messageId === BEFORE_ID, 'earlier text row stays before the media row');
assert(ordered[1].details?.messageId === MEDIA_ID, 'attachment-only row stays between its neighbors');
assert(ordered[2].details?.messageId === AFTER_ID, 'later text row stays after the media row');
assert((ordered[1].content || '') === '', 'attachment-only row keeps empty text');
assert(isHollowChatMessage(ordered[1]) === false, 'attachment-only Discord row is not dropped as an empty stub');
assert(ordered[1].timestamp === ISO, 'UTC offset on the CSV is preserved as a UTC instant');
assert(ordered[1].details?.timestampRaw === '2026-05-22 17:03:00+00:00', 'raw timestamp text is kept');
assert(formatDiscordUtc(ordered[1].timestamp) === '2026-05-22 17:03:00 UTC', 'chat clock is labeled UTC, not a local offset');
assert(ordered[1].details?.discordAttachments?.[0]?.filename === FILE, 'filename comes from the attachment URL');
assert(ordered[1].details?.discordAttachments?.[0]?.url === URL, 'full attachment URL is kept');

const feed = feedMessagesForThread(ordered, filters(''));
assert(feed.map(event => event.details?.messageId).join(',') === [BEFORE_ID, MEDIA_ID, AFTER_ID].join(','), 'the media row stays in the conversation between the text rows');

assert(messageMatchesQuery(ordered[1], FILE), 'filename search hits the media row');
assert(!messageMatchesQuery(ordered[0], FILE), 'filename search does not hit the earlier text row');
assert(messageMatchesQuery(ordered[1], URL), 'full attachment URL search hits the media row');
assert(messageMatchesQuery(ordered[1], MEDIA_ID), 'message id search hits the media row');
assert(!messageMatchesQuery(ordered[0], MEDIA_ID), 'message id search does not hit a neighbor');
assert(messageMatchesQuery(ordered[1], ISO), 'exact ISO timestamp search hits the media row');
assert(messageMatchesQuery(ordered[1], '2026-05-22 17:03:00 UTC'), 'labeled UTC timestamp search hits the media row');
assert(!messageMatchesQuery(ordered[1], '5.5500000000000002e+17'), 'spreadsheet scientific notation is not treated as the message id');

const plan = planConversationJump({
  threads: [{ id: CHANNEL, messages: ordered }],
  threadId: CHANNEL,
  mode: 'search',
  filters: filters(FILE),
  pageSize: 40,
});
assert(plan?.threadId === CHANNEL && plan.messageId === ordered[1].id, 'filename search navigates to the attachment-only message');

const captured = mediaFile(`${ATTACH}.mov`, `attachments/${CHANNEL}/${ATTACH}.mov`);
const decoy = mediaFile(FILE, `loose/${FILE}`);
const listed = mediaExplorerFiles([decoy, captured]);
assert(listed.some(file => file.relativePath === captured.relativePath), 'Media Explorer lists the captured video');
assert(listed.some(file => file.relativePath === decoy.relativePath), 'Media Explorer also lists the unrelated same-name file');
const views = discordAttachmentViews(ordered[1], [decoy, captured]);
assert(views.length === 1, 'one attachment card');
assert(views[0].kind === 'local-video', 'captured video is shown as local video');
assert(views[0].path === captured.relativePath, 'the attachments-folder id path wins over a loose basename');
assert(views[0].localSrc === VIDEO, 'preview uses bytes already in the return');
assert(!String(views[0].localSrc).includes('discord.storage.googleapis.com'), 'storage host is not used as the media source');
assert(views[0].fetchesRemote === false && views[0].autoplay === false, 'the card does not fetch or autoplay');
assert(views[0].blurredByDefault === true, 'local video starts blurred');
assert(views[0].parentMessageId === ordered[1].id, 'exhibit target stays the parent message');
assert(views[0].url === URL, 'original URL stays on the card for provenance');

const card = renderToStaticMarkup(React.createElement(DiscordAttachmentCard, { view: views[0], query: FILE }));
const videoTag = card.match(/<video[^>]*>/)?.[0] || '';
assert(videoTag.length > 0 && !/autoplay/i.test(videoTag), 'video element does not autoplay');
assert(card.includes('blur-md') && card.includes('Play') && card.includes('Open'), 'Play and Open are explicit and the frame starts blurred');
assert(card.includes('<mark'), 'filename search is highlighted on the card');
assert(!card.includes('discord.storage.googleapis.com"') || card.includes('URL:'), 'the URL is labeled and is not the video source');
assert(!videoTag.includes('http'), 'video source is not a remote URL');

const plain = mediaFile(FILE, `attachments/${FILE}`);
const plainViews = discordAttachmentViews(ordered[1], [plain]);
assert(plainViews[0].kind === 'local-video' && plainViews[0].path === `attachments/${FILE}`, 'a unique file in the attachments folder links by filename plus that folder');

const prefixed = mediaFile(`0_${FILE}`, `attachments/${MEDIA_ID}/0_${FILE}`);
const prefixedViews = discordAttachmentViews(ordered[1], [prefixed, decoy]);
assert(prefixedViews[0].path === prefixed.relativePath, 'an indexed name under the message id folder links to that message');

const collisionA = mediaFile(FILE, `attachments/${CHANNEL}/${FILE}`);
const collisionB = mediaFile(FILE, `attachments/${OTHER_CHANNEL}/${FILE}`);
const collision = discordAttachmentViews({
  ...ordered[1],
  details: {
    ...ordered[1].details,
    channelId: 'general',
    discordAttachments: [{ filename: FILE, url: 'https://cdn.example.test/files/synthetic-clip.mov' }],
  },
}, [collisionA, collisionB]);
assert(collision[0].kind === 'link-only' && collision[0].fetchesRemote === false, 'two unexplained copies stay a link');
assert(collision[0].localSrc == null, 'a collision does not preview either file');

const winter = formatInstantInZone('2026-01-15T15:00:00.000Z', 'America/New_York');
const summer = formatInstantInZone('2026-07-04T15:00:00.000Z', 'America/New_York');
const beforeSpring = formatInstantInZone('2026-03-08T06:30:00.000Z', 'America/New_York');
const afterSpring = formatInstantInZone('2026-03-08T07:30:00.000Z', 'America/New_York');
assert(winter && summer && beforeSpring && afterSpring, 'named-zone conversion returns a label');
assert(winter.utc === '2026-01-15T15:00:00.000Z', 'zone conversion does not rewrite the UTC instant');
assert(winter.offsetMinutes === -300, 'January in New York is UTC-05');
assert(summer.offsetMinutes === -240, 'July in New York is UTC-04');
assert(beforeSpring.offsetMinutes === -300 && afterSpring.offsetMinutes === -240, 'the same March date changes offset when daylight saving starts');
assert(winter.offsetMinutes !== 360 && summer.offsetMinutes !== 360, 'conversion does not assume a fixed six-hour offset');
assert(parseDiscordUtcTimestamp('2026-05-22 17:03:00+00:00') === ISO, 'an explicit +00:00 timestamp stays that UTC instant');
assert(parseDiscordUtcTimestamp('2026-05-22 17:03:00') === ISO, 'a Discord timestamp with no zone is read as UTC');

const unquoted = `[{"ID": ${MEDIA_ID}, "Timestamp": "2026-05-22 17:03:00+00:00", "Contents": "", "Attachments": "${URL}"},{"ID": ${AFTER_ID}, "Timestamp": "2026-05-22 17:10:00+00:00", "Contents": "synthetic neighbor", "Attachments": ""}]`;
const jsonRows = messagesOf(parseForensicFile('discord', 'messages.json', unquoted, `messages/c${CHANNEL}/messages.json`).events);
assert(jsonRows.map(event => event.details?.messageId).sort().join(',') === [MEDIA_ID, AFTER_ID].sort().join(','), 'unquoted snowflakes stay distinct digit strings');
const folded = dedupeDiscordEvents(jsonRows.concat(jsonRows.map(event => ({ ...event, sourceFile: 'copy.json' }))));
assert(folded.length === 2, 're-import still collapses by the exact message id');

const html = `<table><tr><th>message_id</th><th>timestamp</th><th>content</th><th>attachments</th></tr><tr><td x:num="${MEDIA_ID}">5.5500000000000002E+17</td><td>2026-05-22 17:03:00+00:00</td><td></td><td><a href="${URL}">${FILE}</a></td></tr></table>`;
const htmlRow = messagesOf(parseForensicFile('discord', 'messages.html', html, `messages/c${CHANNEL}/messages.html`).events)[0];
assert(htmlRow && htmlRow.details?.messageId === MEDIA_ID, 'HTML keeps the full id when the cell displays scientific notation');
assert(htmlRow.details?.channelId === CHANNEL, 'HTML in a channel folder keeps that channel id');
assert(isHollowChatMessage(htmlRow) === false, 'an HTML attachment-only row stays in the conversation');
const literalSci = parseForensicFile('discord', 'messages.html', `<table><tr><th>message_id</th><th>timestamp</th><th>content</th><th>attachments</th></tr><tr><td>5.5500000000000002E+17</td><td>2026-05-22 17:03:00+00:00</td><td></td><td>${URL}</td></tr></table>`, 'messages.html');
const sciId = messagesOf(literalSci.events)[0]?.details?.messageId;
assert(sciId === '5.5500000000000002E+17', 'scientific notation with no full digit string is kept as written');
assert(messageMatchesQuery(messagesOf(literalSci.events)[0], '5.5500000000000002E+17'), 'the literal scientific-notation id is searchable');

const kikEmpty: ForensicEvent = {
  id: 'kik-empty',
  timestamp: '2026-05-22T17:03:00.000Z',
  category: 'message',
  sender: 'synthetic_kik',
  content: '',
  sourceFile: 'kik.csv',
};
assert(isHollowChatMessage(kikEmpty) === true, 'an empty non-Discord row is still a stub');
const kikFeed = feedMessagesForThread([kikEmpty, { ...kikEmpty, id: 'kik-text', content: 'synthetic kik text' }], filters(''));
assert(kikFeed.length === 1 && kikFeed[0].id === 'kik-text', 'non-Discord empty rows stay out of the chat feed');

const timelineEvents: ForensicEvent[] = [];
for (let i = 0; i < 20; i++) {
  timelineEvents.push({
    id: `other-${i}`,
    timestamp: new Date(Date.UTC(2026, 4, 22, 12, i)).toISOString(),
    category: 'message',
    sender: 'synthetic_other',
    content: `synthetic note ${i}`,
    sourceFile: 'notes.csv',
  });
}
timelineEvents.push(ordered[1]);
const focus = planTimelineSelection(timelineEvents, ordered[1].id, 15);
assert(focus?.page === 2 && focus.eventId === ordered[1].id, 'the media message is on timeline page 2');
const timelineHtml = renderToStaticMarkup(React.createElement(EventTimeline, {
  events: [ordered[0], ordered[1], ordered[2]],
  onExportFilteredCSV: () => {},
  focusEventId: ordered[1].id,
  focusNonce: 1,
}));
assert(timelineHtml.includes('data-timeline-selected="true"'), 'timeline marks the focused event');
assert(timelineHtml.includes(`id="row-${ordered[1].id}"`), 'timeline renders the focused event row');
const selectedChunk = timelineHtml.split('data-timeline-selected="true"')[0];
assert(selectedChunk.includes(`id="row-${ordered[1].id}"`) || timelineHtml.indexOf(`id="row-${ordered[1].id}"`) < timelineHtml.indexOf('data-timeline-selected="true"') + 80, 'the selected marker belongs to the media message');

const chatHtml = renderToStaticMarkup(React.createElement(ConversationViewer, {
  events: ordered,
  loadedFiles: [captured],
  activeProvider: 'discord',
  evidenceTags: {},
  onToggleTag: () => {},
  onUpdateNotes: () => {},
  onShowOnTimeline: () => {},
}));
assert(chatHtml.includes('synthetic before text') && chatHtml.includes('synthetic after text'), 'neighboring text remains visible');
assert(chatHtml.includes(`data-show-on-timeline="${ordered[1].id}"`), 'the attachment-only message has Show on timeline');
assert(chatHtml.includes('Show on timeline'), 'the timeline action is labeled');
assert(chatHtml.includes('2026-05-22 17:03:00 UTC'), 'the conversation shows the UTC evidence time');
assert(chatHtml.includes('data-attachment-kind="local-video"'), 'the captured video is rendered under the message');
const beforeAt = chatHtml.indexOf('synthetic before text');
const afterAt = chatHtml.indexOf('synthetic after text');
const mediaAt = chatHtml.indexOf('data-attachment-kind="local-video"');
assert(beforeAt > -1 && mediaAt > beforeAt && afterAt > mediaAt, 'the video sits between the neighboring text messages');

console.log('discord attachment link checks passed');
