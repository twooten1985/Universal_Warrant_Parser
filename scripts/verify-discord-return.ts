/**
 * Synthetic Discord regression checks. No case data.
 * Run: npx tsx scripts/verify-discord-return.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseForensicFile } from '../src/parserHelper';
import { assembleWorkspaceParse } from '../src/lib/consolidateParse';
import {
  combineWorkspaceResults,
  dedupeDiscordEvents,
  discordAttachmentViews,
  parseDiscordAttachmentField,
} from '../src/lib/discordReturn';
import { DiscordAttachmentCard } from '../src/components/DiscordAttachmentCard';
import {
  feedMessagesForThread,
  jumpScrollAllowed,
  planConversationJump,
  renderedMessageIds,
  type ThreadFeedFilters,
} from '../src/lib/conversationJump';
import type { ForensicEvent, ParseResult, UploadedFile } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const providerLabel = (provider: string) => {
  if (provider === 'discord') return 'Discord';
  if (provider === 'kik') return 'Kik Messenger';
  return provider;
};

const SUBJECT_ID = '111000000000000001';
const OTHER_ID = '111000000000000009';
const CHANNEL_ID = '333000000000000001';
const OTHER_CHANNEL = '333000000000000002';
const PHOTO = 'synthetic-share.png';
const CLIP = 'synthetic-clip.mp4';
const NOTES = 'synthetic-notes.zip';
const CDN = `https://cdn.discordapp.com/attachments/100/200/${PHOTO}`;
const PHOTO_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function sessionJson(): string {
  return JSON.stringify({
    id: SUBJECT_ID,
    username: 'synthetic_subject',
    global_name: 'Synthetic Subject',
    email: 'synthetic.subject@example.com',
    phone: '+15555550123',
    created_at: '2020-04-01T12:00:00.000Z',
    registration_ip: '203.0.113.50',
    messages: [
      {
        id: '222000000000000001',
        channel_id: CHANNEL_ID,
        timestamp: '2024-07-04T15:30:00.000Z',
        author: { id: SUBJECT_ID, username: 'synthetic_subject' },
        content: 'synthetic hello alpha',
        attachments: [{ filename: PHOTO, url: CDN, content_type: 'image/png', size: 68 }],
      },
      {
        id: '222000000000000002',
        channel_id: CHANNEL_ID,
        timestamp: '2024-07-04T15:31:00.000Z',
        author: { id: OTHER_ID, username: 'synthetic_partner' },
        content: 'synthetic hello alpha',
        attachments: `clip-only.webm (https://cdn.discordapp.com/attachments/100/201/clip-only.webm)`,
      },
      {
        id: '222000000000000003',
        channel_id: OTHER_CHANNEL,
        timestamp: '2024-07-04T16:00:00.000Z',
        author: { id: SUBJECT_ID, username: 'synthetic_subject' },
        content: 'different channel note',
        attachments: `${NOTES}, ${PHOTO}`,
      },
    ],
  });
}

function otherSession(): string {
  return JSON.stringify({
    id: OTHER_ID,
    username: 'synthetic_partner',
    email: 'synthetic.partner@example.com',
    phone: '+15555550124',
    created_at: '2021-01-01T00:00:00.000Z',
  });
}

function kikProfile(): string {
  return [
    'Username: synthetic_kik_alpha',
    'Email: synthetic.kik.alpha@example.com',
    'Phone: +15555550999',
  ].join('\n');
}

function kikMessages(): string {
  return [
    'timestamp,sender,message',
    '2024-07-04 15:00:00 UTC,synthetic_kik_alpha,synthetic kik hello',
    '2024-07-04 15:06:00 UTC,synthetic_kik_beta,synthetic kik hello',
  ].join('\n');
}

function messagesOf(result: ParseResult | null, providerPrefix: string): ForensicEvent[] {
  return (result?.events || []).filter(event => event.category === 'message' && event.id.startsWith(providerPrefix));
}

function discordAccounts(result: ParseResult | null) {
  return (result?.accounts || []).filter(account => (account.provider || '').toLowerCase() === 'discord');
}

function parseSession(relativePath: string) {
  return parseForensicFile('discord', 'synthetic-session.json', sessionJson(), relativePath);
}

function assembled(): ParseResult {
  const kikMsg = parseForensicFile('kik', 'kik_messages.csv', kikMessages(), 'kik/kik_messages.csv');
  const kikAcc = parseForensicFile('kik', 'kik_profile.txt', kikProfile(), 'kik/kik_profile.txt');
  const result = assembleWorkspaceParse([
    { name: 'synthetic-session.json', relativePath: 'inbox/synthetic-session.json', size: 10, provider: 'discord', parse: parseSession('inbox/synthetic-session.json') },
    { name: 'synthetic-session.json', relativePath: 'copy/synthetic-session.json', size: 10, provider: 'discord', parse: parseSession('copy/synthetic-session.json') },
    { name: 'synthetic-session.json', relativePath: 'nested/synthetic-session.json', size: 10, provider: 'discord', parse: parseSession('nested/synthetic-session.json') },
    { name: 'synthetic-partner.json', relativePath: 'other/synthetic-partner.json', size: 4, provider: 'discord', parse: parseForensicFile('discord', 'synthetic-partner.json', otherSession(), 'other/synthetic-partner.json') },
    { name: 'kik_profile.txt', relativePath: 'kik/kik_profile.txt', size: 3, provider: 'kik', parse: kikAcc },
    { name: 'kik_messages.csv', relativePath: 'kik/kik_messages.csv', size: 5, provider: 'kik', parse: kikMsg },
    { name: 'kik_messages.csv', relativePath: 'kik-copy/kik_messages.csv', size: 5, provider: 'kik', parse: parseForensicFile('kik', 'kik_messages.csv', kikMessages(), 'kik-copy/kik_messages.csv') },
  ], 'discord', providerLabel);
  if (!result) throw new Error('expected a workspace parse');
  return result;
}

function checkParseShape(): void {
  const once = parseSession('inbox/synthetic-session.json');
  const messages = once.events.filter(event => event.category === 'message');
  assert(messages.length === 3, 'one session file emits one event per message id');
  assert(once.accountInfo?.userId === SUBJECT_ID, 'session file keeps the subscriber id');
  assert(once.accountInfo?.username === 'synthetic_subject', 'session username');
  const photo = messages.find(event => event.details?.messageId === '222000000000000001');
  assert(photo?.details?.discordAttachments?.[0]?.filename === PHOTO, 'photo filename preserved');
  assert(photo?.details?.discordAttachments?.[0]?.url === CDN, 'original CDN URL preserved');
  assert(photo?.details?.discordAttachments?.[0]?.size === 68, 'declared size preserved');
  assert(photo?.sourceFile === 'synthetic-session.json', 'message keeps its source file');
  const sameText = messages.filter(event => event.content === 'synthetic hello alpha');
  assert(sameText.length === 2, 'identical text with different ids both stay');
  assert(new Set(sameText.map(event => event.details?.messageId)).size === 2, 'those ids stay distinct');

  const packageRows = parseForensicFile('discord', 'messages.json', JSON.stringify([
    {
      ID: '222000000000000010',
      Timestamp: '2024-08-01 12:00:00',
      Contents: 'package wording',
      Attachments: `${PHOTO} (${CDN})`,
    },
  ]), 'messages/c333000000000000001/messages.json');
  const packaged = packageRows.events.filter(event => event.category === 'message');
  assert(packaged.length === 1, 'package messages.json is one message');
  assert(packaged[0].details?.channelId === CHANNEL_ID, 'channel id comes from the package path');
  assert(packaged[0].details?.discordAttachments?.[0]?.filename === PHOTO, 'package attachment filename');
  assert(packaged[0].details?.discordAttachments?.[0]?.url === CDN, 'package attachment URL');
  assert(!packageRows.accountInfo, 'a messages file is not a second subscriber');

  const csv = parseForensicFile('discord', 'messages.csv', [
    'channel_id,message_id,timestamp,author_id,author_username,content,attachments',
    `${OTHER_CHANNEL},222000000000000011,2024-08-02 12:00:00 UTC,${SUBJECT_ID},synthetic_subject,csv wording,${PHOTO} (${CDN})`,
  ].join('\n'), 'messages.csv');
  const csvMessages = csv.events.filter(event => event.category === 'message');
  assert(csvMessages.length === 1, 'csv attachment stays on its message');
  assert(csvMessages[0].details?.discordAttachments?.[0]?.url === CDN, 'csv keeps the CDN URL');

  const refs = parseDiscordAttachmentField(`${NOTES}, ${PHOTO}`);
  assert(refs.length === 2, 'two filenames stay two attachments');
}

function checkMergeAndReimport(): void {
  const first = assembled();
  const discordMessages = messagesOf(first, 'disc-');
  const ids = discordMessages.map(event => String(event.details?.messageId));
  assert(discordAccounts(first).length === 2, 'subject and partner stay separate accounts');
  assert(discordAccounts(first).filter(account => account.userId === SUBJECT_ID).length === 1, 'one card for the session subscriber');
  assert(new Set(ids).size === ids.length, 'one stored message per Discord message id');
  assert(discordMessages.length === 3, 'three paths do not triple messages');
  const kikMessages = messagesOf(first, 'kik-');
  assert(kikMessages.length === 4, 'kik rows are not collapsed by the discord dedupe');
  assert(kikMessages.filter(event => event.content === 'synthetic kik hello').length === 4, 'repeated kik text stays repeated');
  const kikAccounts = (first.accounts || []).filter(account => (account.provider || '').toLowerCase().includes('kik'));
  assert(kikAccounts.length === 1, 'the single kik profile is unchanged');

  const again = combineWorkspaceResults(first, assembled());
  const againMessages = messagesOf(again, 'disc-');
  assert(againMessages.length === discordMessages.length, 're-import adds no discord messages');
  assert(discordAccounts(again).length === 2, 're-import adds no discord accounts');
  assert(messagesOf(again, 'kik-').length === 8, 'kik messages still append on re-import');
  const kept = againMessages.find(event => event.details?.messageId === '222000000000000001');
  assert(kept?.sourceFile === 'synthetic-session.json', 'kept message keeps its source file');

  const legacy: ForensicEvent = {
    id: 'disc-msg-legacy-1',
    timestamp: '2024-01-01T00:00:00.000Z',
    category: 'message',
    sender: 'synthetic_subject (111)',
    content: 'legacy copy',
    sourceFile: 'old.csv',
    details: { channelId: '333', messageId: 'legacy-1' },
  };
  const folded = dedupeDiscordEvents([legacy, { ...legacy, id: 'disc-msg-legacy-1b', sourceFile: 'old-copy.csv' }]);
  assert(folded.length === 1, 'older discord rows that already have a message id collapse');
  assert(folded[0].sourceFile === 'old.csv', 'the first source file stays on the message');
  assert(Array.isArray(folded[0].details?.alsoSeenIn) && folded[0].details?.alsoSeenIn.includes('old-copy.csv'), 'another path is kept as provenance');
}

function checkAttachments(): void {
  const event = parseSession('inbox/synthetic-session.json').events.find(item => item.details?.messageId === '222000000000000001');
  if (!event) throw new Error('missing photo message');
  const local: UploadedFile = {
    name: PHOTO,
    relativePath: `attachments/${PHOTO}`,
    content: PHOTO_DATA,
    size: 68,
    isMedia: true,
    mediaType: 'image',
    md5: 'abc123',
    sha256: 'def456',
  };
  const before = JSON.stringify(local);
  const views = discordAttachmentViews(event, [local]);
  assert(JSON.stringify(local) === before, 'hash metadata does not rewrite the file');
  assert(views.length === 1, 'one attachment view');
  assert(views[0].kind === 'local-image', 'local png is an inline image');
  assert(views[0].localSrc === PHOTO_DATA, 'preview uses the local bytes already in memory');
  assert(!String(views[0].localSrc).includes('cdn.discordapp.com'), 'CDN URL is not the image source');
  assert(views[0].url === CDN, 'CDN URL remains on the card');
  assert(views[0].path === `attachments/${PHOTO}`, 'original relative path is kept');
  assert(views[0].hashes.sha256 === 'def456', 'existing hash is shown');
  assert(views[0].blurredByDefault === true, 'local image starts blurred');
  assert(views[0].autoplay === false, 'images do not autoplay');
  assert(views[0].fetchesRemote === false, 'local card does not fetch');
  assert(views[0].parentMessageId === event.id, 'exhibit target is the parent message id');

  const linkEvent = parseSession('inbox/synthetic-session.json').events.find(item => item.details?.messageId === '222000000000000002');
  if (!linkEvent) throw new Error('missing link message');
  const linkViews = discordAttachmentViews(linkEvent, []);
  assert(linkViews[0].kind === 'link-only', 'CDN without a local file is link-only');
  assert(linkViews[0].localSrc === null, 'link-only has no media source');
  assert(linkViews[0].fetchesRemote === false, 'link-only does not fetch');
  assert(linkViews[0].linkOnly === true, 'card is marked link-only');
  assert(linkViews[0].parentMessageId === linkEvent.id, 'link card still belongs to its message');

  const video: UploadedFile = {
    name: CLIP,
    relativePath: CLIP,
    content: 'data:video/mp4;base64,AAAA',
    size: 4,
    isMedia: true,
    mediaType: 'video',
  };
  const videoEvent: ForensicEvent = {
    ...event,
    id: 'disc-msg-video',
    details: { discord: true, messageId: 'video-1', discordAttachments: [{ filename: CLIP }] },
  };
  const videoView = discordAttachmentViews(videoEvent, [video])[0];
  assert(videoView.kind === 'local-video', 'local mp4 is video');
  assert(videoView.blurredByDefault === true && videoView.autoplay === false, 'video waits for an explicit play');

  const zipEvent: ForensicEvent = {
    ...event,
    details: { discord: true, messageId: 'zip-1', discordAttachments: [{ filename: NOTES }] },
  };
  const zipView = discordAttachmentViews(zipEvent, [{
    name: NOTES,
    content: 'not-a-real-archive',
    size: 12,
    isMedia: false,
  }])[0];
  assert(zipView.kind === 'unsupported', 'unsupported files are not forced into a player');
  assert(zipView.localSrc === null, 'unsupported files are not given a media URL');

  const imageHtml = renderToStaticMarkup(React.createElement(DiscordAttachmentCard, { view: views[0] }));
  const imageTag = imageHtml.match(/<img[^>]*>/)?.[0] || '';
  assert(imageTag.includes('blur-md'), 'thumbnail markup is blurred');
  assert(imageTag.includes(PHOTO_DATA), 'thumbnail uses the local source');
  assert(!imageTag.includes('cdn.discordapp.com'), 'image tag does not use the CDN');
  assert(imageHtml.includes('Reveal') && imageHtml.includes('Open full size'), 'reveal and full-size controls are present');
  assert(imageHtml.includes('def456'), 'hash is visible in the card');

  const linkHtml = renderToStaticMarkup(React.createElement(DiscordAttachmentCard, { view: linkViews[0] }));
  assert(!linkHtml.includes('<img') && !linkHtml.includes('<video'), 'link-only card has no media element');
  assert(linkHtml.includes('not captured or downloaded'), 'link-only card says the file was not captured');
  assert(linkHtml.includes(linkViews[0].url || ''), 'original URL is labeled on the card');

  const videoHtml = renderToStaticMarkup(React.createElement(DiscordAttachmentCard, { view: videoView }));
  const videoTag = videoHtml.match(/<video[^>]*>/)?.[0] || '';
  assert(videoTag.length > 0 && !/autoplay/i.test(videoTag), 'video element does not autoplay');
  assert(videoHtml.includes('Play') && videoHtml.includes('Open'), 'video has explicit play and open actions');
  assert(videoHtml.includes('blur-md'), 'video frame starts blurred');
}

function checkSearchJump(): void {
  const pageSize = 40;
  const channelA: ForensicEvent[] = [{
    id: 'a-0',
    timestamp: '2024-01-01T00:00:00.000Z',
    category: 'message',
    sender: 'synthetic_subject (111)',
    content: 'lantern alpha',
    sourceFile: 'channel-a.txt',
    details: { discord: true, channelId: 'channel-a', messageId: 'a-0' },
  }];
  const channelB: ForensicEvent[] = [];
  for (let i = 0; i < 100; i++) {
    channelB.push({
      id: `b-${i}`,
      timestamp: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
      category: 'message',
      sender: 'synthetic_subject (111)',
      content: `lantern note ${i}`,
      sourceFile: 'channel-b.txt',
      details: { discord: true, channelId: 'channel-b', messageId: `b-${i}` },
    });
  }
  const filters: ThreadFeedFilters = {
    startDate: '',
    endDate: '',
    senderFilter: 'All Senders',
    searchTerm: 'lantern',
    showHollowInFeed: false,
    filterToKeywordHits: false,
    keywords: [],
  };
  const threads = [
    { id: 'channel-a', messages: channelA },
    { id: 'channel-b', messages: channelB },
  ];
  const target = channelB[85];
  const plan = planConversationJump({
    threads,
    threadId: 'channel-b',
    mode: 'search',
    filters,
    pageSize,
    messageId: target.id,
  });
  if (!plan) throw new Error('expected a jump plan');
  assert(plan.threadId === 'channel-b', 'jump opens the channel that owns the match');
  assert(plan.messageId === target.id, 'jump targets that message id');
  assert(plan.page === 3, 'message 85 is on page 3 of a 40-message page');
  const feed = feedMessagesForThread(channelB, filters);
  const firstPage = renderedMessageIds(feed, 1, pageSize);
  assert(!firstPage.includes(target.id), 'the target is not rendered on the first page');
  assert(!jumpScrollAllowed({ threadId: 'channel-a', page: 1, renderedIds: ['a-0'] }, plan), 'scroll waits until the correct channel is open');
  assert(!jumpScrollAllowed({ threadId: 'channel-b', page: 1, renderedIds: firstPage }, plan), 'scroll waits until the virtual page is mounted');
  const thirdPage = renderedMessageIds(feed, plan.page, pageSize);
  assert(thirdPage.includes(target.id), 'the planned page contains the message');
  assert(jumpScrollAllowed({ threadId: plan.threadId, page: plan.page, renderedIds: thirdPage }, plan), 'scroll is allowed only after the channel and page are ready');
  const sameText = channelA[0];
  assert(sameText.content.startsWith('lantern') && plan.messageId !== sameText.id, 'a different channel with the same word is not the target');
}

checkParseShape();
checkMergeAndReimport();
checkAttachments();
checkSearchJump();
console.log('discord return checks passed');
