/**
 * Synthetic Snapchat message media: unique raw/decoded ID match, local preview, no remote fetch.
 * No case data. Run: npx tsx scripts/verify-snapchat-media.ts
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseForensicFile, resolveMediaFile } from '../src/parserHelper';
import { assembleWorkspaceParse } from '../src/lib/consolidateParse';
import { assembleCaseReport, standaloneReportPackage } from '../src/lib/caseReportHtml';
import { mediaExplorerFiles } from '../src/lib/mediaBrowser';
import {
  SNAPCHAT_MEDIA_MISSING,
  isSnapchatMediaPlaceholder,
  resolveSnapchatCapturedMedia,
  snapchatMediaExportHtml,
  snapchatMediaViews,
} from '../src/lib/snapchatMedia';
import { isHollowChatMessage, messageMatchesQuery, planConversationJump } from '../src/lib/conversationJump';
import { SnapchatMediaCard } from '../src/components/SnapchatMediaCard';
import { ConversationViewer } from '../src/components/ConversationViewer';
import { EventTimeline } from '../src/components/EventTimeline';
import { MediaVault } from '../src/components/MediaVault';
import type { ForensicEvent, UploadedFile } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function snapId(decoded: string): string {
  return `b~${b64url(decoded)}`;
}

const DECODED_IMAGE = 'synthdecodedmedia01';
const PATH_VIDEO = 'synthpathvideo0003';
const RAW_PLAIN = 'synthrawmediaid0004';
const RAW_ONLY = 'synthrawfilename05';
const MISSING = 'synthmissingmedia06';
const JSON_IMAGE = 'synthjsonmedia0007';
const JSON_MISSING = 'synthjsonmissing08';
const AMBIGUOUS = 'synthambiguousmedia9';
const CONFLICT = 'synthconflictmedia02';
const AGREE = 'synthagreeonefile10';
const CDN = 'https://cf-st.sc-cdn.net/synthetic/not-a-real-object';
const APP_URL = 'https://app.snapchat.com/synthetic/not-real';
const IMAGE = 'data:image/svg+xml;base64,U05BUF9JTUFHRQ';
const VIDEO = 'data:video/mp4;base64,U05BUF9WSURFTw';
const SHA1 = '0123456789abcdef0123456789abcdef01234567';
const THREAD = 'synthetic-snap-thread';
const FAKE_SHA = '1af53ee39049753c';

const imageRaw = snapId(DECODED_IMAGE);
const rawOnlyId = snapId(RAW_ONLY);
const missingRaw = snapId(MISSING);
const jsonRaw = snapId(JSON_IMAGE);
const jsonMissingRaw = snapId(JSON_MISSING);
const ambiguousRaw = snapId(AMBIGUOUS);
const conflictRaw = snapId(CONFLICT);
const agreeRaw = snapId(AGREE);
const pathRaw = snapId(PATH_VIDEO);

function row(text: string, mediaId: string, stamp: string): string {
  return `${THREAD},synthetic_snap_user,synthetic_partner,,Synthetic thread,${text},${mediaId},${stamp}`;
}

const csv = [
  'conversation_id,sender_username,recipient_username,group_member_usernames,conversation_title,text,media_id,timestamp',
  row('synthetic before text', '', '2026-06-15 18:00:00 UTC'),
  row('', imageRaw, '2026-06-15 18:01:00 UTC'),
  row('', pathRaw, '2026-06-15 18:02:00 UTC'),
  row('', RAW_PLAIN, '2026-06-15 18:03:00 UTC'),
  row('', rawOnlyId, '2026-06-15 18:04:00 UTC'),
  row('', missingRaw, '2026-06-15 18:05:00 UTC'),
  row('synthetic after text', '', '2026-06-15 18:06:00 UTC'),
  row('', ambiguousRaw, '2026-06-15 18:07:00 UTC'),
  row('', conflictRaw, '2026-06-15 18:08:00 UTC'),
  row('synthetic caption beside media', agreeRaw, '2026-06-15 18:09:00 UTC'),
  row('', snapId('synthsubstringtrap11'), '2026-06-15 18:10:00 UTC'),
].join('\n');

const json = JSON.stringify({
  'Received Chat History': [
    {
      Created: '2026-06-15 19:00:00 UTC',
      Sender: 'synthetic_partner',
      Recipient: 'synthetic_snap_user',
      'Conversation ID': 'synthetic-json-thread',
      Text: 'synthetic json caption',
      'Media ID': jsonRaw,
      'Media URL': CDN,
    },
  ],
  'Sent Chat History': [
    {
      Created: '2026-06-15 19:05:00 UTC',
      Sender: 'synthetic_snap_user',
      Recipient: 'synthetic_partner',
      'Conversation ID': 'synthetic-json-thread',
      'Media ID': jsonMissingRaw,
      'Media Type': 'IMAGE',
      'Media URL': APP_URL,
    },
  ],
});

function media(name: string, relativePath: string, content: string, mediaType: 'image' | 'video', sha1?: string): UploadedFile {
  return {
    name,
    relativePath,
    content,
    size: content.length,
    isMedia: true,
    mediaType,
    ...(sha1 ? { sha1 } : {}),
  };
}

const imageFile = media(`${DECODED_IMAGE}.jpg`, `media/${DECODED_IMAGE}.jpg`, IMAGE, 'image', SHA1);
const pathVideo = media('snap.mp4', `library/${PATH_VIDEO}/snap.mp4`, VIDEO, 'video');
const plainVideo = media(`${RAW_PLAIN}.mp4`, `snaps/${RAW_PLAIN}.mp4`, VIDEO, 'video');
const rawNameFile = media(`${rawOnlyId}.jpg`, `original/${rawOnlyId}.jpg`, IMAGE, 'image');
const ambiguousA = media(`${AMBIGUOUS}.jpg`, `folder-a/${AMBIGUOUS}.jpg`, IMAGE, 'image');
const ambiguousB = media(`${AMBIGUOUS}.jpg`, `folder-b/${AMBIGUOUS}.jpg`, IMAGE, 'image');
const conflictRawFile = media(`${conflictRaw}.jpg`, `original/${conflictRaw}.jpg`, IMAGE, 'image');
const conflictDecodedFile = media(`${CONFLICT}.png`, `decoded/${CONFLICT}.png`, IMAGE, 'image');
const trapFile = media(`xx${DECODED_IMAGE}yy.jpg`, `trap/xx${DECODED_IMAGE}yy.jpg`, IMAGE, 'image');
const agreeFile = media(`${AGREE}.jpg`, `agree/${agreeRaw}/${AGREE}.jpg`, IMAGE, 'image');
const jsonFile = media(`${JSON_IMAGE}.jpg`, `json-media/${JSON_IMAGE}.jpg`, IMAGE, 'image');
const files = [imageFile, pathVideo, plainVideo, rawNameFile, ambiguousA, ambiguousB, conflictRawFile, conflictDecodedFile, trapFile, agreeFile, jsonFile];

const parsed = parseForensicFile('snapchat', 'chat_history.csv', csv, 'chats/chat_history.csv');
const jsonParsed = parseForensicFile('snapchat', 'chat_history.json', json, 'chats/chat_history.json');
const assembled = assembleWorkspaceParse(
  [
    { name: 'chat_history.csv', relativePath: 'chats/chat_history.csv', size: csv.length, provider: 'snapchat', parse: parsed },
    { name: 'chat_history.json', relativePath: 'chats/chat_history.json', size: json.length, provider: 'snapchat', parse: jsonParsed },
    ...files.map(file => ({
      name: file.name,
      relativePath: file.relativePath,
      size: file.size,
      provider: 'snapchat' as const,
      isMedia: true,
      parse: null,
    })),
  ],
  'snapchat',
  (provider) => provider
);

assert(assembled, 'workspace parse returns a result');
const events = assembled!.events.filter(event => event.category === 'message');

function byMedia(id: string): ForensicEvent {
  const found = events.find(event => event.details?.mediaId === id);
  if (!found) throw new Error(`missing message for ${id}`);
  return found;
}

const before = events.find(event => event.content === 'synthetic before text');
const after = events.find(event => event.content === 'synthetic after text');
const imageEvent = byMedia(imageRaw);
const pathEvent = byMedia(pathRaw);
const plainEvent = byMedia(RAW_PLAIN);
const rawOnlyEvent = byMedia(rawOnlyId);
const missingEvent = byMedia(missingRaw);
const ambiguousEvent = byMedia(ambiguousRaw);
const conflictEvent = byMedia(conflictRaw);
const agreeEvent = byMedia(agreeRaw);
const trapEvent = events.find(event => String(event.details?.mediaRef || '') === 'synthsubstringtrap11');
const jsonCaption = events.find(event => event.content === 'synthetic json caption');
const jsonMissingEvent = byMedia(jsonMissingRaw);

assert(before && after && trapEvent && jsonCaption && jsonMissingEvent, 'text, trap, and json rows parsed');
assert(imageEvent.details?.mediaRef === DECODED_IMAGE, 'b~ media id is decoded onto the row');
assert(imageEvent.content === `[Sent Media Snap ID: ${imageRaw}]`, 'media-only row keeps the raw id in the stored text');
assert(before!.content === 'synthetic before text', 'text-only row is unchanged');
assert(isSnapchatMediaPlaceholder(imageEvent.content), 'media-only placeholder is recognized');
assert(isSnapchatMediaPlaceholder(before!.content) === false, 'ordinary text is not a media placeholder');
assert(isHollowChatMessage(imageEvent) === false, 'a media row stays in the conversation time slot');
assert(Date.parse(before!.timestamp) < Date.parse(imageEvent.timestamp) && Date.parse(imageEvent.timestamp) < Date.parse(after!.timestamp), 'the media row stays between the neighboring text');

assert(imageEvent.details?.resolvedMediaName === imageFile.name, 'decoded id matches the file stem');
assert(imageEvent.details?.resolvedMediaPath === imageFile.relativePath, 'the match keeps the relative path');
assert(pathEvent.details?.resolvedMediaPath === pathVideo.relativePath, 'a unique path segment matches when the basename does not');
assert(resolveMediaFile(PATH_VIDEO, ['snap.mp4']) === null, 'basename-only search misses a file that is filed under the media id');
assert(plainEvent.details?.resolvedMediaName === plainVideo.name, 'a raw id with no b~ prefix matches that filename');
assert(rawOnlyEvent.details?.resolvedMediaName === rawNameFile.name, 'a file named with the original b~ id matches');
assert(resolveMediaFile(RAW_ONLY, [rawNameFile.name]) === null, 'decoded-only search misses a file named with the raw id');
assert(!ambiguousEvent.details?.resolvedMediaName, 'two files with the same stem are not guessed');
assert(!conflictEvent.details?.resolvedMediaName, 'raw and decoded forms pointing at different files are not guessed');
assert(!missingEvent.details?.resolvedMediaName, 'a missing file is not given a name');
assert(!trapEvent!.details?.resolvedMediaName, 'a longer filename that merely contains the id is not a match');
assert(agreeEvent.details?.resolvedMediaPath === agreeFile.relativePath, 'one file that satisfies both the raw id and the decoded id is kept');
assert(jsonCaption!.details?.mediaId === jsonRaw, 'json chat keeps the media id');
assert(jsonCaption!.details?.mediaUrl === CDN, 'json keeps a snapchat url as text only');
assert(jsonCaption!.content === 'synthetic json caption', 'json caption text is unchanged');
const legacyJson = parseForensicFile('snapchat', 'chat_history.json', JSON.stringify({
  'Received Chat History': [{ Created: '2026-06-15 12:00:00 UTC', Sender: 'synthetic_partner', Recipient: 'synthetic_snap_user', Text: '', 'Media Type': 'IMAGE' }],
}), 'legacy.json');
const legacyMsg = legacyJson.events.find(event => event.category === 'message');
assert(legacyMsg?.content === '[Sent Media Snap: IMAGE]', 'json without a media id keeps the media-type placeholder');
assert(!legacyMsg?.details?.mediaId, 'json without a media id does not invent one');
assert(legacyMsg && snapchatMediaViews(legacyMsg, []).length === 0, 'a type-only snap has no media card');
assert(jsonMissingEvent.content.includes(jsonMissingRaw), 'json media-only row keeps the id');
assert(!jsonMissingEvent.content.includes('snapchat.com'), 'the snapchat url is not copied into the message text');
assert(messageMatchesQuery(jsonCaption!, JSON_IMAGE), 'a captioned message is searchable by its decoded media id');
assert(!messageMatchesQuery(before!, JSON_IMAGE), 'the media id search does not hit a text-only neighbor');

const imageViews = snapchatMediaViews(imageEvent, files);
assert(imageViews.length === 1 && imageViews[0].kind === 'local-image', 'the image is shown in the message');
assert(imageViews[0].localSrc === IMAGE, 'the preview uses bytes already in the return');
assert(imageViews[0].blurredByDefault === true && imageViews[0].autoplay === false && imageViews[0].fetchesRemote === false, 'the image starts blurred and is not fetched');
assert(imageViews[0].hashes.sha1 === SHA1, 'a real file hash can be shown');
assert(!String(imageViews[0].localSrc).includes('sc-cdn.net'), 'the preview source is not a snapchat host');

const videoViews = snapchatMediaViews(pathEvent, files);
assert(videoViews[0].kind === 'local-video' && videoViews[0].localSrc === VIDEO, 'the video in the id folder is local');
assert(videoViews[0].poster && videoViews[0].poster.startsWith('data:image/png'), 'video uses a local poster');
assert(!/^https?:/i.test(videoViews[0].poster || ''), 'the poster is not a remote url');
assert(videoViews[0].blurredByDefault === true && videoViews[0].autoplay === false, 'video stays blurred and does not autoplay');

const missingViews = snapchatMediaViews(missingEvent, files);
assert(missingViews[0].kind === 'missing' && missingViews[0].localSrc === null, 'a missing file has no preview');
assert(missingViews[0].note === SNAPCHAT_MEDIA_MISSING && missingViews[0].mediaId === missingRaw, 'the missing card keeps the id and the not-in-return label');
assert(missingViews[0].fetchesRemote === false, 'a missing snap is not downloaded');
assert(snapchatMediaViews(ambiguousEvent, files)[0].kind === 'missing', 'an ambiguous pair is labeled missing');
assert(snapchatMediaViews(conflictEvent, files)[0].kind === 'missing', 'a raw/decoded disagreement is labeled missing');
assert(snapchatMediaViews(trapEvent!, files)[0].kind === 'missing', 'a substring name is labeled missing');
assert(snapchatMediaViews(before!, files).length === 0, 'a text-only message has no media card');

const stripped = snapchatMediaViews(imageEvent, [{
  ...imageFile,
  content: '',
  sourcePath: '/tmp/synthetic/synthdecodedmedia01.jpg',
}]);
assert(stripped[0].kind === 'local-image' && stripped[0].localSrc?.startsWith('/api/local-media?path='), 'stripped bytes still preview from the local file');
assert(!String(stripped[0].localSrc).includes('sc-cdn.net'), 'the local media route is not a snapchat url');
assert(mediaExplorerFiles(files).some(file => file.relativePath === imageFile.relativePath), 'the matched image is in the media explorer index');

const beforeContent = imageFile.content;
const beforeHash = imageFile.sha1;
resolveSnapchatCapturedMedia(files, imageEvent.details);
snapchatMediaViews(imageEvent, files);
assert(imageFile.content === beforeContent && imageFile.sha1 === beforeHash, 'matching does not rewrite file bytes or hashes');

let fetches = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetches += 1;
  throw new Error('snapchat media must not fetch');
}) as typeof fetch;
try {
  const remoteViews = snapchatMediaViews(jsonCaption!, files);
  assert(remoteViews[0].kind === 'local-image' && remoteViews[0].localSrc === IMAGE, 'json media uses the local file');
  assert(!String(remoteViews[0].localSrc).includes('sc-cdn.net'), 'a stored snapchat url is not the image source');
  const absent = snapchatMediaViews(jsonMissingEvent, files);
  assert(absent[0].note === SNAPCHAT_MEDIA_MISSING && absent[0].localSrc === null, 'json without a file keeps the id and does not fetch the url');
  const exported = snapchatMediaExportHtml(absent[0]) + snapchatMediaExportHtml(remoteViews[0]) + snapchatMediaExportHtml(videoViews[0]);
  assert(exported.includes(SNAPCHAT_MEDIA_MISSING) && exported.includes(jsonMissingRaw), 'html export keeps the id and the missing label');
  assert(exported.includes(IMAGE) && exported.includes('poster='), 'html export includes the local image and a video poster');
  assert(!exported.includes('sc-cdn.net') && !exported.includes('snapchat.com'), 'html export does not embed a snapchat url');
  assert(!/<img[^>]*src="https?:/i.test(exported) && !/<video[^>]*src="https?:/i.test(exported), 'export media sources are not remote');
  assert(fetches === 0, 'building the cards does not call fetch');
} finally {
  globalThis.fetch = previousFetch;
}

const imageCard = renderToStaticMarkup(React.createElement(SnapchatMediaCard, { view: imageViews[0] }));
assert(imageCard.includes('blur-md') && imageCard.includes('Reveal'), 'the image preview starts blurred until Reveal');
assert(imageCard.includes(DECODED_IMAGE) && imageCard.includes(`src="${IMAGE}"`), 'the blurred image is the local file');
assert(imageCard.includes('data-fetches-remote="false"'), 'the card records that it does not fetch');

const videoCard = renderToStaticMarkup(React.createElement(SnapchatMediaCard, { view: videoViews[0] }));
const videoTag = videoCard.match(/<video[^>]*>/)?.[0] || '';
assert(videoTag.includes('poster=') && videoTag.includes('blur-md') && !/autoplay/i.test(videoTag), 'video has a poster, starts blurred, and does not autoplay');
assert(videoCard.includes('Play') && videoCard.includes('Open'), 'Play and Open are explicit');
assert(!videoTag.includes('http'), 'the video source is not a remote url');

const missingCard = renderToStaticMarkup(React.createElement(SnapchatMediaCard, { view: missingViews[0] }));
assert(missingCard.includes(SNAPCHAT_MEDIA_MISSING) && missingCard.includes(missingRaw), 'the missing card shows the id and the label');
assert(!missingCard.includes('<img') && !missingCard.includes('<video'), 'a missing card does not invent a preview');

const csvEvents = events.filter(event => event.details?.conversationId === THREAD);
const chatHtml = renderToStaticMarkup(React.createElement(ConversationViewer, {
  events: csvEvents,
  loadedFiles: files,
  activeProvider: 'snapchat',
  evidenceTags: {},
  onToggleTag: () => {},
  onUpdateNotes: () => {},
}));
const beforeAt = chatHtml.indexOf('synthetic before text');
const imageAt = chatHtml.indexOf(`data-snap-media-id="${imageRaw}"`);
const afterAt = chatHtml.indexOf('synthetic after text');
assert(beforeAt > -1 && imageAt > beforeAt && afterAt > imageAt, 'the image stays between the neighboring text messages');
assert(chatHtml.includes('data-attachment-kind="local-image"') && chatHtml.includes('data-attachment-kind="local-video"'), 'images and videos render in the bubbles');
assert(chatHtml.includes('blur-md') && chatHtml.includes('Reveal') && chatHtml.includes('Play'), 'bubble previews start blurred with Reveal and Play');
assert(chatHtml.includes(SNAPCHAT_MEDIA_MISSING), 'a missing file is labeled in the bubble');
assert(!chatHtml.includes('[Sent Media Snap ID:'), 'the bubble does not leave only the bare id placeholder');
assert(!chatHtml.includes('sc-cdn.net') && !chatHtml.includes('snapchat.com'), 'the conversation does not render a snapchat url');
const jsonHtml = renderToStaticMarkup(React.createElement(ConversationViewer, {
  events: events.filter(event => event.details?.conversationId === 'synthetic-json-thread'),
  loadedFiles: files,
  activeProvider: 'snapchat',
  evidenceTags: {},
  onToggleTag: () => {},
  onUpdateNotes: () => {},
}));
assert(jsonHtml.includes('synthetic json caption'), 'caption text is still shown with its media');
assert(jsonHtml.includes('data-attachment-kind="local-image"') && jsonHtml.includes(SNAPCHAT_MEDIA_MISSING), 'json shows the local file and labels the missing snap');
assert(!jsonHtml.includes('sc-cdn.net') && !jsonHtml.includes('snapchat.com'), 'json bubbles do not render a snapchat url');

const timelineHtml = renderToStaticMarkup(React.createElement(EventTimeline, {
  events: [before!, imageEvent, pathEvent, missingEvent, after!],
  loadedFiles: files,
  onExportFilteredCSV: () => {},
  focusEventId: missingEvent.id,
  focusNonce: 1,
}));
assert(timelineHtml.includes('data-attachment-kind="local-image"') && timelineHtml.includes('blur-md'), 'the timeline shows the local image blurred');
assert(timelineHtml.includes('poster=') && timelineHtml.includes('Play'), 'the timeline video has a poster and play control');
assert(timelineHtml.includes(SNAPCHAT_MEDIA_MISSING) && timelineHtml.includes(missingRaw), 'the timeline keeps the missing id and the label');
assert(!timelineHtml.includes(FAKE_SHA), 'the timeline does not invent a SHA-1');
assert(timelineHtml.includes(SHA1), 'a hash taken from the file can still be shown');
assert(!timelineHtml.includes('sc-cdn.net'), 'the timeline does not point at a snapchat host');

const vaultHtml = renderToStaticMarkup(React.createElement(MediaVault, {
  files,
  evidenceTags: {},
  events,
  onOpenMessage: () => {},
}));
assert(vaultHtml.includes(`data-open-message="${imageEvent.id}"`), 'a media explorer click target is the message that sent the file');
assert(vaultHtml.includes('Show in chat'), 'the explorer action is labeled');
assert(!vaultHtml.includes(`data-open-message="${ambiguousEvent.id}"`), 'an unresolved file does not jump to a guessed message');
assert(!vaultHtml.includes(`data-open-message="${missingEvent.id}"`), 'a missing file has nothing to open');

const jump = planConversationJump({
  threads: [{ id: THREAD, messages: events.filter(event => event.details?.conversationId === THREAD) }],
  threadId: THREAD,
  mode: 'search',
  filters: {
    startDate: '',
    endDate: '',
    senderFilter: 'All Senders',
    searchTerm: '',
    showHollowInFeed: false,
    filterToKeywordHits: false,
    keywords: [],
  },
  pageSize: 40,
  messageId: imageEvent.id,
});
assert(jump?.threadId === THREAD && jump.messageId === imageEvent.id && jump.page === 1, 'the explorer jump opens the message in its own time slot');

const report = assembleCaseReport({
  caseId: 'SYNTH-SNAP',
  agency: 'Synthetic',
  itemNumber: 'S-1',
  examiner: 'Synthetic examiner',
  subject: 'synthetic_snap_user',
  providerName: 'Snapchat',
  notes: '',
  logoDataUrl: '',
  generatedAtIso: '2026-06-15T00:00:00.000Z',
  exhibitsOnly: true,
  blurImages: true,
  timeZone: 'UTC',
  redactIpAddresses: false,
  redactPii: false,
  includeAccount: false,
  includeMessages: true,
  includeTimeline: false,
  includeMedia: true,
  includeEntities: false,
  includeLocations: false,
  includeSources: false,
  embedMedia: true,
  events: [{
    ...agreeEvent,
    details: { ...agreeEvent.details, resolvedMediaName: agreeFile.name, resolvedMediaPath: agreeFile.relativePath },
  }],
  files: [
    { name: agreeFile.name, relativePath: 'other/decoy.jpg', isMedia: true, mediaType: 'image', content: 'data:image/png;base64,DECOYSNAP', size: 8 },
    { name: agreeFile.name, relativePath: agreeFile.relativePath, isMedia: true, mediaType: 'image', content: 'data:image/png;base64,REALSNAP', size: 8 },
  ],
  tags: { [agreeEvent.id]: { tagged: true, notes: '' } },
  accounts: [],
  locations: [],
  entities: [],
});
assert(report.html.startsWith('<!doctype html><html class="blur">'), 'the case report still blurs images by default');
assert(report.html.includes('REALSNAP') && !report.html.includes('DECOYSNAP'), 'the report follows the matched path instead of a same-named decoy');
assert(!report.html.includes(FAKE_SHA) && !report.html.includes('sc-cdn.net'), 'the report does not add a made-up hash or a snapchat url');

const REPORT_IMAGE = 'data:image/png;base64,REPORTIMAGE';
const REPORT_VIDEO = 'data:video/mp4;base64,REPORTVIDEO';
const folderReport = assembleCaseReport({
  caseId: 'SYNTH-REPORT',
  agency: 'Synthetic',
  itemNumber: 'S-2',
  examiner: 'Synthetic examiner',
  subject: 'synthetic_snap_user',
  providerName: 'Snapchat',
  notes: '',
  logoDataUrl: '',
  generatedAtIso: '2026-06-15T00:00:00.000Z',
  exhibitsOnly: false,
  blurImages: false,
  timeZone: 'UTC',
  redactIpAddresses: false,
  redactPii: false,
  includeAccount: false,
  includeMessages: true,
  includeTimeline: false,
  includeMedia: true,
  includeEntities: false,
  includeLocations: false,
  includeSources: false,
  embedMedia: false,
  events: [
    {
      id: 'report-image',
      timestamp: '2026-06-15T18:01:00.000Z',
      category: 'message',
      sender: 'synthetic_snap_user',
      content: 'synthetic image row',
      sourceFile: 'chat_history.csv',
      details: { resolvedMediaName: 'report-still.png', resolvedMediaPath: 'media/report-still.png' },
    },
    {
      id: 'report-video',
      timestamp: '2026-06-15T18:02:00.000Z',
      category: 'message',
      sender: 'synthetic_snap_user',
      content: 'synthetic video row',
      sourceFile: 'chat_history.csv',
      details: { resolvedMediaName: 'report-clip.mp4', resolvedMediaPath: 'media/report-clip.mp4', mediaId: 'synthetic-video-id', sourcePath: 'C:\\Evidence\\original-report-clip.mp4' },
    },
    {
      id: 'report-untyped-video',
      timestamp: '2026-06-15T18:03:00.000Z',
      category: 'message',
      sender: 'synthetic_snap_user',
      content: 'synthetic untyped video row',
      sourceFile: 'chat_history.csv',
      details: { resolvedMediaName: 'report-plain.mp4' },
    },
    {
      id: 'report-missing',
      timestamp: '2026-06-15T18:04:00.000Z',
      category: 'message',
      sender: 'synthetic_snap_user',
      content: 'synthetic missing row',
      sourceFile: 'chat_history.csv',
      details: { mediaId: 'synthetic-missing-id', mediaUrl: CDN },
    },
  ],
  files: [
    { name: 'report-still.png', relativePath: 'media/report-still.png', isMedia: true, mediaType: 'image', content: REPORT_IMAGE, size: 12 },
    { name: 'report-clip.mp4', relativePath: 'media/report-clip.mp4', isMedia: true, mediaType: 'video', content: REPORT_VIDEO, size: 12 },
    { name: 'report-plain.mp4', isMedia: true, content: REPORT_VIDEO, size: 12 },
  ],
  tags: {},
  accounts: [],
  locations: [],
  entities: [],
});
const imageHref = folderReport.attachments.find(item => item.name === 'report-still.png')?.path || '';
const videoHref = folderReport.attachments.find(item => item.name === 'report-clip.mp4')?.path || '';
const plainHref = folderReport.attachments.find(item => item.name === 'report-plain.mp4')?.path || '';
assert(imageHref.startsWith('files/') && videoHref.startsWith('files/') && plainHref.startsWith('files/'), 'saved media uses a files folder path');
assert(folderReport.html.includes(`<img class="openable" src="${imageHref}"`), 'a saved image still displays from the folder');
const reportVideos = folderReport.html.match(/<video[^>]*src="files\/[^"]+\.mp4"[^>]*>/g) || [];
assert(reportVideos.length >= 2, 'each saved video has a video element');
assert(reportVideos.every(tag => tag.includes('controls') && !/autoplay/i.test(tag)), 'saved videos have controls and do not autoplay');
assert(folderReport.html.includes(`src="${videoHref}"`) && folderReport.html.includes(`src="${plainHref}"`), 'video elements use the copied relative paths');
assert(!folderReport.html.includes(`<img class="openable" src="${videoHref}"`), 'a video file is not shown with an image tag');
assert(!folderReport.html.includes('original-report-clip.mp4'), 'the report does not point at the original evidence path');
assert(!/<(?:img|video|source)\b[^>]*(?:src|href)="https?:/i.test(folderReport.html), 'report media is not loaded from a remote url');
assert(!/<(?:img|video|source)\b[^>]*src="(?:\/|[A-Za-z]:)/.test(folderReport.html), 'report media src stays a relative files path');
assert(folderReport.html.includes('media not in return') && folderReport.html.includes('synthetic-missing-id'), 'missing media stays labeled');
assert(!folderReport.attachments.some(item => item.path.includes('synthetic-missing-id')), 'a missing snap does not invent a file');
const packed = standaloneReportPackage({
  includeMedia: true,
  embedMedia: false,
  html: folderReport.html,
  files: folderReport.attachments.filter(item => item.base64).map(item => ({ path: item.path, base64: item.base64 })),
});
assert(packed.kind === 'zip', 'the existing folder export still packs a zip');
if (packed.kind === 'zip') {
  const packedPaths = packed.files.map(item => item.path);
  assert(packedPaths.includes(imageHref) && packedPaths.includes(videoHref) && packedPaths.includes(plainHref), 'the image and the videos are copied beside the HTML');
  assert(packed.files.every(item => item.bytes.byteLength > 0), 'copied media has bytes');
}
const mediaOff = assembleCaseReport({
  caseId: 'SYNTH-REPORT',
  agency: 'Synthetic',
  itemNumber: 'S-2',
  examiner: 'Synthetic examiner',
  subject: 'synthetic_snap_user',
  providerName: 'Snapchat',
  notes: '',
  logoDataUrl: '',
  generatedAtIso: '2026-06-15T00:00:00.000Z',
  exhibitsOnly: false,
  blurImages: false,
  timeZone: 'UTC',
  redactIpAddresses: false,
  redactPii: false,
  includeAccount: false,
  includeMessages: true,
  includeTimeline: false,
  includeMedia: false,
  includeEntities: false,
  includeLocations: false,
  includeSources: false,
  embedMedia: false,
  events: [{
    id: 'report-image',
    timestamp: '2026-06-15T18:01:00.000Z',
    category: 'message',
    sender: 'synthetic_snap_user',
    content: 'synthetic image row',
    sourceFile: 'chat_history.csv',
    details: { resolvedMediaName: 'report-still.png' },
  }],
  files: [{ name: 'report-still.png', isMedia: true, mediaType: 'image', content: REPORT_IMAGE, size: 12 }],
  tags: {},
  accounts: [],
  locations: [],
  entities: [],
});
assert(!mediaOff.html.includes('<img') && !mediaOff.html.includes('<video') && mediaOff.attachments.length === 0, 'leaving media out of the report does not write a files folder');

console.log('snapchat message media checks passed');
