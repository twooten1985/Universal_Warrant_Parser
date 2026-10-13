/**
 * Synthetic checks for the offline case report.
 * Run: npx tsx scripts/verify-case-report.ts
 */
import type { ForensicEvent } from '../src/types';
import {
  CASE_REPORT_VERSION,
  EVIDENCE_TYPES,
  assembleCaseReport,
  mediaExhibitTimestamp,
  standaloneReportPackage,
  type AssembleReportArgs,
} from '../src/lib/caseReportHtml';

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const PALETTE: Array<{ id: string; label: string; href: string; color: string }> = [
  { id: 'account', label: 'Account info', href: '#sec-account', color: '#2f6fd8' },
  { id: 'message', label: 'Messages', href: '#sec-messages', color: '#1f8a4c' },
  { id: 'connection', label: 'Logins / IPs', href: '#type-connection', color: '#c0392b' },
  { id: 'media', label: 'Media', href: '#sec-media', color: '#8e44ad' },
  { id: 'location', label: 'Locations', href: '#sec-locations', color: '#d68910' },
  { id: 'call', label: 'Calls', href: '#type-call', color: '#d35400' },
  { id: 'file', label: 'Files', href: '#type-file', color: '#148f77' },
  { id: 'profile', label: 'Profiles', href: '#type-profile', color: '#1a5276' },
  { id: 'other', label: 'Other records', href: '#type-other', color: '#5b6472' },
  { id: 'entity', label: 'Entity overlaps', href: '#sec-entities', color: '#6c3483' },
  { id: 'source', label: 'Sources', href: '#sec-sources', color: '#34495e' },
];

assert(CASE_REPORT_VERSION === '5.1.2', 'app version constant');
assert(EVIDENCE_TYPES.length === PALETTE.length, 'palette length');
for (const expected of PALETTE) {
  const actual = EVIDENCE_TYPES.find(type => type.id === expected.id);
  assert(actual?.label === expected.label && actual.href === expected.href && actual.color === expected.color, `palette ${expected.id}`);
}

assert(mediaExhibitTimestamp({}) === 'unknown', 'missing media time is unknown');
assert(mediaExhibitTimestamp({ capturedAt: 'not-a-date', modifiedAt: '' }) === 'unknown', 'unparseable media time is unknown');
assert(mediaExhibitTimestamp({ capturedAt: '2024-02-03T04:05:06.000Z' }) === '2024-02-03T04:05:06.000Z', 'captured time wins');
assert(mediaExhibitTimestamp({ capturedAt: '', modifiedAt: '2021-08-09T10:11:12.000Z' }) === '2021-08-09T10:11:12.000Z', 'modified time is the fallback');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MD5 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA256 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const EMPTY_SHA = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const SOURCE = 'C:\\Lab\\MACHINEPATHTOKEN\\messages.js';

function event(partial: Partial<ForensicEvent> & Pick<ForensicEvent, 'id' | 'category' | 'content'>): ForensicEvent {
  return {
    timestamp: '2026-06-15T14:30:22.000Z',
    sender: 'Alice',
    recipient: 'Bob',
    sourceFile: SOURCE,
    ...partial,
  };
}

const events: ForensicEvent[] = [
  event({
    id: 'msg-1',
    category: 'message',
    sender: 'Alice',
    recipient: 'Bob',
    content: 'ALPHA-MESSAGE suspect.user@example.com 5550192834',
    details: { resolvedMediaName: 'attach.png', sourcePath: 'C:\\Lab\\MACHINEPATHTOKEN\\hidden.txt', visible: 'VISIBLE-DETAIL' },
  }),
  event({
    id: 'msg-2',
    category: 'message',
    sender: 'Bob',
    recipient: 'Alice',
    content: 'UNTAGGED-BODY',
    timestamp: '2026-06-15T15:00:00.000Z',
  }),
  event({
    id: 'msg-3',
    category: 'message',
    sender: 'Alice',
    recipient: 'Carol',
    content: 'CAROL-MESSAGE',
  }),
  event({
    id: 'ip-1',
    category: 'connection',
    sender: 'Alice',
    recipient: '',
    content: 'LOGIN-RECORD',
    ipAddress: '8.8.4.4',
  }),
  event({
    id: 'file-1',
    category: 'file',
    sender: 'Alice',
    recipient: '',
    content: 'FILE-RECORD',
  }),
  event({
    id: 'profile-1',
    category: 'profile',
    sender: 'Alice',
    recipient: '',
    content: 'PROFILE-RECORD',
  }),
  event({
    id: 'other-1',
    category: 'other',
    sender: 'Alice',
    recipient: '',
    content: 'OTHER-RECORD </script><script>alert(1)</script>',
  }),
];

const tags = {
  'msg-1': { tagged: true, notes: 'Examiner saw the map' },
  'msg-3': { tagged: true, notes: '' },
  'ip-1': { tagged: true, notes: '' },
  'file-1': { tagged: true, notes: '' },
  'profile-1': { tagged: true, notes: '' },
  'media-file-known.jpg': { tagged: true, notes: 'Hash hit' },
};

function args(overrides: Partial<AssembleReportArgs> = {}): AssembleReportArgs {
  return {
    caseId: 'CASE-77',
    agency: 'LBI',
    itemNumber: 'Item-4',
    examiner: 'ExaminerUnique',
    subject: 'SubjectUnique',
    providerName: 'Twitter',
    notes: 'Header note about the return',
    logoDataUrl: PNG,
    generatedAtIso: '2020-01-01T00:00:00.000Z',
    appVersion: '5.0.0',
    exhibitsOnly: false,
    blurImages: true,
    timeZone: 'UTC',
    redactIpAddresses: false,
    redactPii: false,
    includeAccount: true,
    includeTimeline: true,
    includeEntities: true,
    includeLocations: true,
    includeCaseIdentifiers: true,
    embedMedia: false,
    events,
    files: [
      { name: 'attach.png', isMedia: true, mediaType: 'image', content: PNG, relativePath: 'shots/attach.png' },
      {
        name: 'known.jpg',
        isMedia: true,
        mediaType: 'image',
        content: PNG,
        relativePath: 'C:\\Secret\\known.jpg',
        md5: MD5,
        sha256: SHA256,
        capturedAt: '2024-02-03T04:05:06.000Z',
      },
      { name: 'mystery-shot.png', isMedia: true, mediaType: 'image', content: PNG },
      { name: 'empty-return.js', isMedia: false, sha256: EMPTY_SHA, content: 'window.empty = []' },
    ],
    tags,
    accounts: [{
      provider: 'Twitter',
      username: 'suspect_jack',
      email: 'suspect.user@example.com',
      phone: '5550192834',
      registrationIp: '9.9.9.9',
      createdDate: '2018-04-12T10:15:30.000Z',
      sourceFile: 'account.js',
    }],
    locations: [{ lat: 25.7617, lng: -80.1918, label: 'Miami', cardId: '', capturedAt: '2026-06-15T14:30:22.000Z', eventId: 'msg-1' }],
    entities: [{ value: '1.2.3.4', type: 'ip', providers: ['Twitter', 'Google'], detail: 'shared address' }],
    vicHashes: [MD5],
    hashLabels: { [SHA256]: ['Known set (contraband)'] },
    ...overrides,
  };
}

const full = assembleCaseReport(args());
const html = full.html;

assert(html.startsWith('<!doctype html>'), 'standalone document');
assert(!/https?:\/\/(cdn|unpkg|fonts\.google|ajax\.googleapis)/i.test(html), 'no CDN');
assert((html.match(/<script/g) || []).length === 1, 'one script element');
assert((html.match(/<\/script>/g) || []).length === 1, 'script payload cannot close the script');
assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'event text is escaped');
assert(!html.includes('MACHINEPATHTOKEN'), 'machine paths are stripped');
assert(!/C:\\/.test(html) && !html.includes('C:/'), 'drive-letter paths are not published');
assert(html.includes('VISIBLE-DETAIL'), 'non-path details remain');
assert(html.includes('The original evidence was not modified by this report.'), 'evidence unchanged statement');
assert(html.includes('Generated by Universal Warrant Return Parser 5.0.0'), 'version');
assert(html.includes('Machine paths are not published in this report.'), 'path statement');
assert(html.includes('Record counts for the whole case, including zeros:'), 'zero counts intro');
assert(html.includes('calls 0'), 'zero call count is stated');
assert(html.includes('<td class="mono">empty-return.js</td><td class="mono">' + EMPTY_SHA + '</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td>'), 'source with zero events');
assert(html.includes('LBI') && html.includes('Item-4') && html.includes('ExaminerUnique') && html.includes('SubjectUnique'), 'header fields');
assert(html.includes('Header note about the return'), 'notes');
assert(html.includes('Times shown in') && html.includes('UTC'), 'time zone is stated');
assert(html.includes('01 Jan 2020'), 'generated time uses the chosen zone');
assert(html.includes('15 Jun 2026') && html.includes('14:30:22'), 'exhibit time uses the chosen zone');
assert(!html.includes('12 Oct 2026'), 'unknown media time is not replaced with today');
assert(html.includes(`<img class="logo" src="${PNG}"`), 'logo is inline');
assert(html.startsWith('<!doctype html><html class="blur">'), 'blur is baked on');
assert(html.includes("wire('btnBlur', 'blur', 'blur', root.classList.contains('blur'), false)"), 'blur is not remembered');
assert(html.includes("wire('btnDark', 'dark', 'dark', false, true)"), 'dark mode is remembered');
assert(html.includes('uwrp.report.'), 'dark mode storage key');
assert(html.includes('html.dark{--line:#333a46;--ink:#e6e8ec;--mut:#8b93a3}'), 'dark mode variables');
assert(html.includes('html.dark{--line:#d5d9e0;--ink:#1a1d24;--mut:#5b6472}'), 'print resets dark mode');
assert(html.includes('fill:var(--ink)'), 'donut center follows the theme');
assert(html.includes('print-color-adjust:exact'), 'print keeps colors');
assert(html.includes('-webkit-print-color-adjust:exact'), 'webkit print colors');
assert(/\.donut \.ring\{[^}]*print-color-adjust:exact/.test(html), 'donut slices print in color');
assert(/\.summary \.sw/.test(html) && html.includes('h2.catsec,h3.typesec'), 'legend and section bars print in color');
assert(html.includes('page-break-before:always') && html.includes('break-before:page'), 'page breaks between sections');
assert(html.includes('beforeprint') && html.includes('afterprint'), 'print opens collapsed sections');
assert(html.includes('grid-template-columns:repeat(auto-fill,minmax(230px,1fr))'), 'valid grid property');
assert(!html.includes('grid-template-cols'), 'no invalid grid property');
assert(!/(^|[;{])\s*tracking\s*:/.test(html), 'no invalid tracking property');
assert(html.includes('letter-spacing'), 'spacing uses a real CSS property');
assert(html.includes('var STEP = 250'), 'cards are paged 250 at a time');
assert(html.includes('id="showMore"'), 'show more control');
assert(html.includes('id="reportSearch"') && html.includes('id="reportSort"'), 'search and sort');
assert(html.includes('<option value="time">') && html.includes('<option value="exhibit">'), 'sort choices');
assert(html.includes('id="btnExpand"') && html.includes('id="btnCollapse"'), 'expand and collapse');
assert(html.includes("event.key === 'Escape'"), 'viewer closes on escape');
assert(html.includes('id="lb"') || html.includes("lb.id = 'lb'"), 'in-page viewer');

assert(html.includes('<svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Evidence by type">'), 'inline donut');
assert(html.includes('By evidence type'), 'type legend');

const nonzero = new Set(['account', 'message', 'connection', 'media', 'location', 'file', 'profile', 'other', 'entity', 'source']);
for (const type of PALETTE) {
  const legend = `<span class="sw" style="background:${type.color}"></span><a href="${type.href}">${type.label}</a>`;
  assert(html.includes(legend), `legend row ${type.label}`);
  if (nonzero.has(type.id)) {
    assert(new RegExp(`<a href="${type.href}"><circle class="ring"[^>]*stroke="${type.color}"`).test(html), `slice ${type.label}`);
  } else {
    assert(!html.includes(`stroke="${type.color}"`), `zero slice omitted ${type.label}`);
    assert(html.includes(`<a href="${type.href}">${type.label}</a></td><td class="n">0</td>`), `zero legend count ${type.label}`);
  }
}

assert(html.includes('id="sec-account" style="border-left:6px solid #2f6fd8"'), 'account section bar');
assert(html.includes('id="sec-messages" style="border-left:6px solid #1f8a4c"'), 'message section bar');
assert(html.includes('id="sec-timeline" style="border-left:6px solid var(--ink)"'), 'timeline parent bar');
assert(html.includes('id="sec-media" style="border-left:6px solid #8e44ad"'), 'media section bar');
assert(html.includes('id="sec-locations" style="border-left:6px solid #d68910"'), 'location section bar');
assert(html.includes('id="sec-entities" style="border-left:6px solid #6c3483"'), 'entity section bar');
assert(html.includes('id="sec-sources" style="border-left:6px solid #34495e"'), 'source section bar');
assert(html.includes('id="type-connection" style="border-left:6px solid #c0392b"'), 'login section bar');
assert(html.includes('id="type-call" style="border-left:6px solid #d35400"'), 'empty call section still linked');
assert(html.includes('id="type-file" style="border-left:6px solid #148f77"'), 'file section bar');
assert(html.includes('id="type-profile" style="border-left:6px solid #1a5276"'), 'profile section bar');
assert(html.includes('id="type-other" style="border-left:6px solid #5b6472"'), 'other section bar');
assert(html.includes('href="#top"'), 'back to top');
assert(html.includes('>Jump to section:</span>'), 'jump chips');

function articles(document: string): Array<{ id: string; html: string }> {
  return [...document.matchAll(/<article class="card" id="([^"]+)"[\s\S]*?<\/article>/g)].map(match => ({
    id: match[1],
    html: match[0],
  }));
}

function bar(articleHtml: string): string {
  const match = /class="catbar" style="background:(#[0-9a-f]{6})"/.exec(articleHtml);
  assert(match, 'card color bar');
  return match[1];
}

const cards = articles(html);
const alpha = cards.filter(card => card.html.includes('ALPHA-MESSAGE'));
assert(alpha.length === 2, 'message with media is listed twice');
const messageCopy = alpha.find(card => !card.id.endsWith('-media'));
const mediaCopy = alpha.find(card => card.id.endsWith('-media'));
assert(messageCopy && bar(messageCopy.html) === '#1f8a4c', 'message card uses the message color');
assert(mediaCopy && bar(mediaCopy.html) === '#8e44ad', 'media copy uses the media color');
assert(bar(cards.find(card => card.html.includes('LOGIN-RECORD'))!.html) === '#c0392b', 'login card color');
assert(bar(cards.find(card => card.html.includes('FILE-RECORD'))!.html) === '#148f77', 'file card color');
assert(bar(cards.find(card => card.html.includes('PROFILE-RECORD'))!.html) === '#1a5276', 'profile card color');
assert(bar(cards.find(card => card.html.includes('OTHER-RECORD'))!.html) === '#5b6472', 'other card color');
const known = cards.find(card => card.html.includes('known.jpg') && card.id.startsWith('media-'));
assert(known && bar(known.html) === '#8e44ad', 'standalone media card color');
assert(known!.html.includes('SHA-256') && known!.html.includes(SHA256), 'sha-256');
assert(known!.html.includes('MD5') && known!.html.includes(MD5), 'md5');
assert(known!.html.includes('Project VIC') && known!.html.includes('Known set (contraband)'), 'hash labels');
assert(known!.html.includes('href="files/Secret/known.jpg"'), 'zip-relative media link');
assert(known!.html.includes('src="files/Secret/known.jpg"'), 'thumbnail uses the zip path when not embedded');
assert(known!.html.includes('03 Feb 2024'), 'captured time on media');
const mystery = cards.find(card => card.html.includes('mystery-shot.png'));
assert(mystery && mystery.html.includes('>unknown<') && mystery.html.includes('data-time=""'), 'unknown media timestamp');
assert(html.includes('not computed'), 'missing hashes say not computed');
assert(html.includes('alice → bob') && html.includes('alice → carol'), 'conversations are grouped');
assert((html.match(/<details class="convo"/g) || []).length === 2, 'two conversations');
assert(/alice → bob <span class="n">\(2\)<\/span>/.test(html), 'same pair shares a conversation');
assert(html.includes('Examiner notes') && html.includes('Examiner saw the map'), 'examiner notes');
assert(html.includes('8.8.4.4') && html.includes('9.9.9.9') && html.includes('suspect.user@example.com'), 'unredacted values');
assert(html.includes('href="https://www.openstreetmap.org/?mlat=25.7617&amp;mlon=-80.1918'), 'coordinates link out');
assert(!/tile\.openstreetmap|mapbox|leaflet/i.test(html), 'no map tiles');
assert(html.includes('class="plotmap"'), 'static location plot');
assert(html.includes('It does not download map tiles.'), 'plot explanation');
assert(html.includes('<span class="sw" style="background:#2f6fd8"></span><a href="#sec-account">Twitter</a>'), 'provider row uses the account color');
assert(html.includes('<a href="#sec-sources">Tagged vs events in the case</a>'), 'tagged total links to sources');
assert(html.includes('class="donut-n">15</text>'), 'donut total is the sum of nonzero types');

const embedded = assembleCaseReport(args({ embedMedia: true })).html;
assert(embedded.includes(`src="${PNG}"`), 'print copy embeds the image');
assert(embedded.includes('href="files/Secret/known.jpg"'), 'embedded copy still links at the zip path');

const exhibits = assembleCaseReport(args({
  exhibitsOnly: true,
  locations: [
    { lat: 25.7617, lng: -80.1918, label: 'Miami', cardId: '', capturedAt: '2026-06-15T14:30:22.000Z', eventId: 'msg-1' },
    { lat: 28.5383, lng: -81.3792, label: 'Orlando', cardId: '', capturedAt: '', eventId: '', tagKey: 'location-point-orlando' },
  ],
})).html;
assert(!exhibits.includes('UNTAGGED-BODY'), 'exhibits only drops untagged events');
assert(!exhibits.includes('mystery-shot.png'), 'exhibits only drops untagged media');
assert(exhibits.includes('ALPHA-MESSAGE') && exhibits.includes('LOGIN-RECORD') && exhibits.includes('known.jpg'), 'exhibits only keeps tagged records');
assert(exhibits.includes('25.7617') && exhibits.includes('Miami'), 'exhibits only keeps a tagged location');
assert(!exhibits.includes('28.5383') && !exhibits.includes('Orlando'), 'exhibits only drops an untagged location');

const noMessages = assembleCaseReport(args({ includeMessages: false })).html;
assert(!noMessages.includes('id="sec-messages"'), 'messages section is omitted');
assert(!noMessages.includes('href="#sec-messages"'), 'messages jump chip and donut link are omitted');
assert(!noMessages.includes('stroke="#1f8a4c"'), 'messages slice is omitted');
assert(noMessages.includes('class="donut-n">12</text>'), 'donut total drops the message count');
assert(!noMessages.includes('left out'), 'omitted messages are not given a placeholder');

const noLocations = assembleCaseReport(args({ includeLocations: false })).html;
assert(!noLocations.includes('id="sec-locations"'), 'locations section is omitted');
assert(!noLocations.includes('href="#sec-locations"'), 'locations jump chip is omitted');
assert(!noLocations.includes('class="plotmap"'), 'location plot is omitted');
assert(!noLocations.includes('25.7617'), 'location coordinates are omitted');
assert(!noLocations.includes('stroke="#d68910"'), 'locations slice is omitted');
assert(noLocations.includes('class="donut-n">14</text>'), 'donut total drops the location count');

const noSources = assembleCaseReport(args({ includeSources: false })).html;
assert(!noSources.includes('id="sec-sources"'), 'sources section is omitted');
assert(!noSources.includes('href="#sec-sources"'), 'sources jump chip is omitted');
assert(!noSources.includes('Record counts for the whole case'), 'source summary counts are omitted');
assert(!noSources.includes('stroke="#34495e"'), 'sources slice is omitted');

const zipPack = standaloneReportPackage({
  includeMedia: true,
  embedMedia: false,
  html: '<!doctype html><title>report</title>',
  files: [{ path: 'files/a.jpg', bytes: Uint8Array.from([1, 2, 3]) }],
});
assert(zipPack.kind === 'zip' && zipPack.files.length === 1 && zipPack.files[0].path === 'files/a.jpg', 'media export is a zip of report files');
const htmlPack = standaloneReportPackage({
  includeMedia: false,
  embedMedia: false,
  html: '<!doctype html>',
  files: [{ path: 'files/a.jpg', bytes: Uint8Array.from([1]) }],
});
assert(htmlPack.kind === 'html', 'a report without media is one html file');
const embedPack = standaloneReportPackage({
  includeMedia: true,
  embedMedia: true,
  html: '<!doctype html>',
  files: [{ path: 'files/a.jpg', bytes: Uint8Array.from([1]) }],
});
assert(embedPack.kind === 'html', 'embedded media stays in one html file');

const redacted = assembleCaseReport(args({ redactIpAddresses: true, redactPii: true })).html;
assert(!redacted.includes('8.8.4.4') && redacted.includes('8.8.XXX.XXX'), 'ipv4 redaction');
assert(!redacted.includes('9.9.9.9') && redacted.includes('9.9.XXX.XXX'), 'registration ip redaction');
assert(!redacted.includes('1.2.3.4') && redacted.includes('1.2.XXX.XXX'), 'entity ip redaction');
assert(!redacted.includes('suspect.user@example.com') && redacted.includes('s***r@example.com'), 'email redaction');
assert(!redacted.includes('5550192834') && redacted.includes('******2834'), 'phone redaction');

const zoned = assembleCaseReport(args({ timeZone: 'America/New_York' })).html;
assert(zoned.includes('America/New_York'), 'named zone is stated');
assert(zoned.includes('10:30:22'), 'named zone shifts the clock');

const plain = assembleCaseReport(args({
  blurImages: false,
  includeCaseIdentifiers: false,
  logoDataUrl: 'javascript:alert(1)',
})).html;
assert(plain.startsWith('<!doctype html><html><head>'), 'blur off leaves the root unmarked');
assert(!plain.includes('ExaminerUnique') && !plain.includes('SubjectUnique'), 'case identifiers can be omitted');
assert(plain.includes('LBI') && plain.includes('Item-4'), 'agency and item stay');
assert(!plain.includes('javascript:alert'), 'logo must be an image data url');

const attachmentPaths = full.attachments.map(item => item.path);
assert(attachmentPaths.includes('files/Secret/known.jpg'), 'known media attachment path');
assert(attachmentPaths.includes('files/shots/attach.png'), 'attachment path');
assert(attachmentPaths.includes('files/mystery-shot.png'), 'mystery attachment path');
assert(attachmentPaths.every(item => item.startsWith('files/') && !item.includes('..')), 'attachment paths stay inside files/');
assert(full.attachments.some(item => item.path === 'files/Secret/known.jpg' && !!item.base64), 'image bytes are stored for the zip');

if (process.env.WRITE_REPORT) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.WRITE_REPORT, html);
}

console.log('verify-case-report: ok');
