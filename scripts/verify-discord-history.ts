/**
 * Synthetic Discord login history, username history, and device workbook checks.
 * No case data. IP addresses are TEST-NET only.
 * Run: npx tsx scripts/verify-discord-history.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JSZip from 'jszip';
import { parseForensicFile } from '../src/parserHelper';
import { assembleWorkspaceParse } from '../src/lib/consolidateParse';
import { combineWorkspaceResults } from '../src/lib/discordReturn';
import { parseDiscordWorkbook } from '../src/lib/discordWorkbook';
import { resolveDeviceColumn } from '../src/lib/discordReports';
import {
  discordAliasGroups,
  isMappableIpAddress,
  parseDiscordUtcTimestamp,
  profileSearchUsernames,
} from '../src/lib/discordSession';
import { messageMatchesQuery } from '../src/lib/conversationJump';
import { extractIdentifiers, suggestLinks } from '../src/identity';
import { AccountInfoCard } from '../src/components/AccountInfoCard';
import type { AccountRecord, ForensicEvent, ParseResult } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const providerLabel = (provider: string) => (provider === 'discord' ? 'Discord' : provider);
const SUBJECT_ID = '111000000000000001';
const OTHER_ID = '111000000000000009';

function sessionText(): string {
  return [
    'Username: synthetic_subject',
    'User ID: 111000000000000001',
    'Email: synthetic.subject@example.com',
    'Phone: +15555550123',
    'Created: 2020-04-01 12:00:00 UTC',
    'Registration IP: 192.0.2.10',
    'Last Seen IP: 198.51.100.20',
    '',
    'IP Address Log',
    'Timestamp, IP Address',
    '2020-04-01 12:00:00, 192.0.2.10',
    '2024-06-01 09:00:00 UTC, 198.51.100.20',
    '2024-11-02 01:02:03, 203.0.113.40',
    '2024-12-12 12:12:12 UTC, 192.0.2.10',
  ].join('\n');
}

function notFoundSession(): string {
  return [
    'Username: Not found',
    'User ID: Not found',
    'Email: Not found',
    'Registration IP: Not found',
    'Last Seen IP: 198.51.100.44',
    'IP History',
    'IP Address | Timestamp (UTC)',
    'Not found | 2024-01-01 00:00:00 UTC',
    '198.51.100.44 | 2024-02-02 02:02:02 UTC',
  ].join('\n');
}

function distinctHeaderSession(): string {
  return [
    'Username: synthetic_subject',
    'User ID: 111000000000000001',
    'Created: 2020-04-01 08:00:00 UTC',
    'Registration IP: 192.0.2.15',
    'Last Seen: 2024-08-08 08:08:08 UTC',
    'Last Seen IP: 203.0.113.70',
    'Login History',
    'IP Address | Timestamp (UTC)',
    '192.0.2.16 | 2024-01-02 03:04:05',
    '203.0.113.70 | 2024-08-08 08:08:08',
  ].join('\n');
}

function usernameTsv(): string {
  return [
    'user_account_updated_timestamp\told_full_username\told_discriminator\tnew_full_username\tnew_discriminator\told_display_name\tnew_display_name',
    '2024-01-01 00:00:00+00:00\tsynthetic_old\t1001\tsynthetic_mid\t1001\tOld Label\tOld Label',
    '2024-06-01 12:30:00-04:00\tsynthetic_mid\t1001\tsynthetic_subject\t0\tOld Label\tCurrent Label',
  ].join('\n');
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function workbook(rows: string[][], numeric?: { ref: string; value: string; style: string }): Promise<Uint8Array> {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const idOf = (value: string) => {
    if (!index.has(value)) {
      index.set(value, strings.length);
      strings.push(value);
    }
    return index.get(value)!;
  };
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const col = String.fromCharCode(65 + c);
      const ref = `${col}${r + 1}`;
      if (numeric && numeric.ref === ref) {
        return `<c r="${ref}" s="${numeric.style}"><v>${xml(numeric.value)}</v></c>`;
      }
      return `<c r="${ref}" t="s"><v>${idOf(value)}</v></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(item => `<si><t>${xml(item)}</t></si>`).join('')}</sst>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const book = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Records" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;
  const zip = new JSZip();
  zip.file('xl/workbook.xml', book);
  zip.file('xl/_rels/workbook.xml.rels', rels);
  zip.file('xl/sharedStrings.xml', sst);
  zip.file('xl/worksheets/sheet1.xml', sheet);
  zip.file('xl/styles.xml', styles);
  return zip.generateAsync({ type: 'uint8array' });
}

function workspace(files: Array<{ name: string; relativePath: string; content?: string; bytes?: Uint8Array; parse: ParseResult }>): ParseResult {
  const result = assembleWorkspaceParse(files.map(file => ({
    name: file.name,
    relativePath: file.relativePath,
    size: file.content?.length || file.bytes?.byteLength || 1,
    provider: 'discord' as const,
    parse: file.parse,
  })), 'discord', providerLabel);
  if (!result) throw new Error('expected a workspace parse');
  return result;
}

function loginsOf(account: { loginActivity?: Array<{ ip: string; timestampUtc?: string; timestampLabel: string }> } | undefined) {
  return account?.loginActivity || [];
}

function checkUtcAndSession(): void {
  const plain = parseDiscordUtcTimestamp('2024-11-02 01:02:03');
  assert(plain === '2024-11-02T01:02:03.000Z', 'a Discord time with no zone stays on that UTC clock');
  const offset = parseDiscordUtcTimestamp('2024-06-01 12:30:00-04:00');
  assert(offset === '2024-06-01T16:30:00.000Z', 'an explicit offset converts to UTC without dropping the calculation');

  const parsed = parseForensicFile('discord', 'synthetic-session.txt', sessionText(), 'reports/synthetic-session.txt');
  const account = parsed.accountInfo;
  assert(account?.userId === SUBJECT_ID, 'session file keeps the subscriber id');
  assert(account?.registrationIp === '192.0.2.10', 'registration IP still comes from the header');
  assert(account?.lastSeenIp === '198.51.100.20', 'last seen IP still comes from the header');
  const logins = loginsOf(account);
  assert(logins.length === 4, 'header IPs that already have the same history timestamp are not extra rows');
  assert(logins.filter(row => row.ip === '192.0.2.10').length === 2, 'the same IP at two times stays two rows');
  const third = logins.find(row => row.ip === '203.0.113.40');
  assert(third?.timestampUtc === '2024-11-02T01:02:03.000Z', 'history time without a zone is stored as UTC');
  assert(third?.timestampLabel === '2024-11-02 01:02:03 UTC', 'the card label says UTC');
  const ips = parsed.summaryStats.uniqueIPs;
  assert(ips.includes('203.0.113.40') && ips.includes('192.0.2.10') && ips.includes('198.51.100.20'), 'history IPs are mapped on events');
  assert(!ips.some(ip => ip.toLowerCase() === 'not found'), 'Not found is not a unique IP');

  const distinct = parseForensicFile('discord', 'synthetic-session.txt', distinctHeaderSession(), 'reports/synthetic-session.txt');
  const distinctLogins = loginsOf(distinct.accountInfo);
  assert(distinctLogins.some(row => row.ip === '192.0.2.15' && row.timestampUtc === '2020-04-01T08:00:00.000Z'), 'a header IP with its own timestamp is kept when the history does not already have that instant');
  assert(distinctLogins.filter(row => row.ip === '203.0.113.70').length === 1, 'last seen IP is not duplicated when that instant is already in the history');
  assert(distinctLogins.some(row => row.ip === '192.0.2.16'), 'rows after the history header are read');
}

function checkNotFound(): void {
  const parsed = parseForensicFile('discord', 'synthetic-session.txt', notFoundSession(), 'reports/synthetic-session.txt');
  const account = parsed.accountInfo;
  assert(account?.registrationIp === 'Not found', 'Not found stays the literal registration value');
  assert(!account?.userId, 'Not found is not a user id');
  assert(!account?.username, 'Not found is not a username');
  assert(!account?.email, 'Not found is not an email');
  assert(account?.lastSeenIp === '198.51.100.44', 'a real last seen IP is kept beside Not found');
  const logins = loginsOf(account);
  assert(logins.some(row => row.ip === 'Not found'), 'a history cell of Not found is kept on the card');
  assert(!parsed.events.some(event => event.ipAddress === 'Not found'), 'Not found is not an event IP identifier');
  assert(!parsed.summaryStats.uniqueIPs.includes('Not found'), 'Not found is excluded from the IP list');
  assert(isMappableIpAddress('Not found') === false, 'Not found is not a shared connection value');
  assert(isMappableIpAddress('198.51.100.44') === true, 'a TEST-NET address can be a shared connection');

  const occurrences = extractIdentifiers([{
    provider: 'Discord',
    userId: 'Not found',
    username: 'Not found',
    email: 'Not found',
    phone: 'Not found',
    registrationIp: 'Not found',
    accountKey: 'discord::anon',
  }]);
  assert(occurrences.length === 0, 'Not found does not become an Exact identifier');
  const edges = suggestLinks(extractIdentifiers([
    { provider: 'Discord', userId: SUBJECT_ID, username: 'synthetic_subject', registrationIp: '192.0.2.10', accountKey: 'discord::uid::' + SUBJECT_ID },
    { provider: 'Discord', userId: OTHER_ID, username: 'synthetic_partner', registrationIp: '192.0.2.10', accountKey: 'discord::uid::' + OTHER_ID },
  ]));
  assert(edges.length === 0, 'a shared IP is not an Exact identity link');
}

function checkPathsAndDedupe(): void {
  const session = () => parseForensicFile('discord', 'synthetic-session.txt', sessionText(), 'reports/synthetic-session.txt');
  const thin = parseForensicFile('discord', 'user.json', JSON.stringify({
    id: SUBJECT_ID,
    username: 'synthetic_subject',
    email: 'synthetic.subject@example.com',
  }), 'account/user.json');
  const richFirst = workspace([
    { name: 'synthetic-session.txt', relativePath: 'a/synthetic-session.txt', parse: session() },
    { name: 'user.json', relativePath: 'account/user.json', parse: thin },
  ]);
  assert((richFirst.accounts || []).filter(account => account.userId === SUBJECT_ID).length === 1, 'session and user json with the same id are one subscriber');
  assert(loginsOf(richFirst.accounts?.find(account => account.userId === SUBJECT_ID)).length === 4, 'a later user.json does not drop login history');

  const thinFirst = workspace([
    { name: 'user.json', relativePath: 'account/user.json', parse: thin },
    { name: 'synthetic-session.txt', relativePath: 'b/synthetic-session.txt', parse: session() },
    { name: 'synthetic-session.txt', relativePath: 'c/nested/synthetic-session.txt', parse: session() },
    { name: 'synthetic-session.txt', relativePath: 'd/copy/synthetic-session.txt', parse: session() },
  ]);
  const subject = thinFirst.accounts?.find(account => account.userId === SUBJECT_ID);
  assert(loginsOf(subject).length === 4, 'repeated source paths do not multiply or discard login rows');
  const paths = subject?.otherDetails?.['Source paths'] || '';
  assert(paths.includes('b/synthetic-session.txt') && paths.includes('c/nested/synthetic-session.txt') && paths.includes('d/copy/synthetic-session.txt'), 'each source path is retained');
  const loginEvents = (thinFirst.events || []).filter(event => event.details?.loginActivity === true);
  assert(loginEvents.length === 4, 'login events collapse across paths');
  const again = combineWorkspaceResults(thinFirst, thinFirst);
  const againSubject = again?.accounts?.find(account => account.userId === SUBJECT_ID);
  assert(loginsOf(againSubject).length === 4, 're-import does not duplicate login history');
}

function checkUsernames(): void {
  const parsed = parseForensicFile('discord', 'username_change.csv', usernameTsv(), 'reports/username_change.csv');
  const history = parsed.accountInfo?.usernameHistory || [];
  assert(history.length === 2, 'both username rows are kept');
  assert(history[1].timestampRaw === '2024-06-01 12:30:00-04:00', 'the UTC offset is preserved on the row');
  assert(history[0].oldUsername === 'synthetic_old' && history[1].newUsername === 'synthetic_subject', 'old and new usernames are preserved');
  const names = profileSearchUsernames(parsed.accountInfo || {});
  assert(names.includes('synthetic_old') && names.includes('synthetic_mid') && names.includes('synthetic_subject'), 'old and new usernames are available to shared-name search');
  const edges = suggestLinks(extractIdentifiers([
    { provider: 'Discord', userId: SUBJECT_ID, username: 'synthetic_subject', usernameHistory: history, accountKey: 'discord::uid::' + SUBJECT_ID },
    { provider: 'Snapchat', userId: 'snap-1', username: 'synthetic_old', accountKey: 'snapchat::uid::snap-1' },
  ]));
  assert(edges.length === 0, 'a historical username is not an Exact identity link');

  const session = parseForensicFile('discord', 'synthetic-session.txt', sessionText(), 'reports/synthetic-session.txt');
  const partner = parseForensicFile('discord', 'partner.txt', [
    'Username: synthetic_partner',
    'User ID: 111000000000000009',
    'Registration IP: 203.0.113.8',
    'Last Seen IP: 203.0.113.9',
    'IP Address Log',
    'Timestamp, IP Address',
    '2024-03-03 03:03:03 UTC, 203.0.113.8',
  ].join('\n'), 'reports/partner.txt');
  const joined = workspace([
    { name: 'synthetic-session.txt', relativePath: 'reports/synthetic-session.txt', parse: session },
    { name: 'partner.txt', relativePath: 'reports/partner.txt', parse: partner },
    { name: 'username_change.csv', relativePath: 'reports/username_change.csv', parse: parsed },
    { name: 'username_change.csv', relativePath: 'copy/reports/username_change.csv', parse: parsed },
  ]);
  const subject = joined.accounts?.find(account => account.userId === SUBJECT_ID);
  const other = joined.accounts?.find(account => account.userId === OTHER_ID);
  assert((subject?.usernameHistory || []).length === 2, 'username history attaches to the matching subscriber once');
  assert(!(other?.usernameHistory || []).length, 'username history is not copied onto the other subscriber');
  assert(!joined.accounts?.some(account => !account.userId && account.usernameHistory?.length), 'the report row is not left as a second card');

  const message: ForensicEvent = {
    id: 'disc-msg-1',
    timestamp: '2024-07-04T15:30:00.000Z',
    category: 'message',
    sender: 'synthetic_subject (111000000000000001)',
    content: 'synthetic hello',
    sourceFile: 'messages.csv',
    details: { discord: true },
  };
  const groups = discordAliasGroups(joined.accounts);
  assert(messageMatchesQuery(message, 'synthetic_old', groups), 'an old username finds that subscriber in chat');
  assert(messageMatchesQuery(message, 'current label', groups), 'a historical display name finds that subscriber in chat');
  assert(!messageMatchesQuery({ ...message, sender: 'synthetic_partner (111000000000000009)' }, 'synthetic_old', groups), 'another sender is not matched by this subscriber old name');
  assert(messageMatchesQuery(message, 'synthetic hello', groups), 'message text search still works');

  const card = renderToStaticMarkup(React.createElement(AccountInfoCard, {
    account: subject,
    accounts: subject ? [subject] : [],
    provider: 'Discord',
    selectedAccountFilter: 'synthetic_subject',
    onAccountFilterChange: () => undefined,
    onOpenConnection: () => undefined,
    sharedConnectionIps: ['192.0.2.10'],
  }));
  const articles = card.split('<article').slice(1);
  assert(articles.length === 2, 'each username change is a row');
  assert(articles[0].includes('2024-06-01 12:30:00-04:00'), 'newest username change is first and keeps the offset');
  assert(articles[0].includes('data-change="username display"') || articles[0].includes('data-change="username display name"'), 'username and display name both changed on the newest row');
  assert(articles[1].includes('2024-01-01 00:00:00+00:00'), 'older row keeps its +00:00 offset');
  assert(articles[1].includes('data-change="username"'), 'an unchanged display name is not shown as a change');
  assert(card.includes('reports/username_change.csv'), 'username history cites its report');
  assert(card.includes('192.0.2.10') && card.includes('Shared connection point'), 'a shared IP can be opened as a connection point');
  assert(card.includes('2024-11-02 01:02:03 UTC'), 'login rows show UTC');
}

function renderAccount(account: AccountRecord): string {
  return renderToStaticMarkup(React.createElement(AccountInfoCard, {
    account,
    accounts: [account],
    provider: 'Discord',
    selectedAccountFilter: account.username || account.userId || 'subscriber',
    onAccountFilterChange: () => undefined,
  }));
}

async function checkDevices(): Promise<void> {
  assert(resolveDeviceColumn(['id', 'timestamp', 'message_id', 'device'], 4, true) === 3, 'a named device column wins over column 3');
  assert(resolveDeviceColumn(['id', 'timestamp', 'message_id'], 3, true) === null, 'column 3 is not used when it is a message id');
  assert(resolveDeviceColumn(['a', 'b', 'c'], 3, false) === null, 'column 3 is not used for an unrelated workbook');
  assert(resolveDeviceColumn(['transaction_id', 'event_time', 'client_label'], 3, true) === 2, 'the known report falls back to column 3 when no device header exists');

  const serial = String(Math.round((Date.UTC(2024, 2, 3) - Date.UTC(1899, 11, 30)) / 86400000));
  const known = await workbook([
    ['transaction_id', 'event_time', 'client_label'],
    ['t-1', '', 'Discord Android'],
    ['t-2', '2024-04-04 04:04:04 UTC', ''],
    ['t-3', '2024-05-05 05:05:05 UTC', 'Discord Android'],
    ['t-4', '2024-06-06 06:06:06 UTC', 'Windows Desktop'],
  ], { ref: 'B2', value: serial, style: '1' });
  const parsed = await parseDiscordWorkbook('discord', 'message_transaction_records.xlsx', known, 'reports/message_transaction_records.xlsx');
  const devices = parsed.accountInfo?.deviceRecords || [];
  assert(devices.length === 3, 'an empty device cell does not create a row');
  assert(devices.filter(row => row.device === 'Discord Android').length === 2, 'repeated devices stay separate rows');
  assert(devices.some(row => row.device === 'Discord Android' && row.timestampUtc?.startsWith('2024-03-03')), 'an Excel date serial in a date column is read');
  assert(devices.every(row => row.source === 'reports/message_transaction_records'), 'rows cite the message transaction report');
  const card = renderAccount({ ...parsed.accountInfo, userId: SUBJECT_ID, username: 'synthetic_subject' });
  assert(card.includes('Discord-recorded client/device info'), 'devices are labeled as Discord-recorded client info');
  assert(card.includes('Not verified hardware'), 'devices are not described as verified hardware');
  assert(card.includes('reports/message_transaction_records'), 'the device section cites the report path');
  assert(card.includes('Discord Android') && card.includes('×2'), 'the summary counts repeated clients');
  assert((card.match(/data-device-row=/g) || []).length === 3, 'the detail list has one row per recorded value');

  const shifted = await workbook([
    ['id', 'timestamp', 'message_id', 'device'],
    ['row-1', '2024-07-07 07:07:07 UTC', 'not-a-device', 'iPhone 15'],
  ]);
  const shiftedParse = await parseDiscordWorkbook('discord', 'message_transaction_records.xlsx', shifted, 'reports/message_transaction_records.xlsx');
  assert(shiftedParse.accountInfo?.deviceRecords?.[0]?.device === 'iPhone 15', 'a shifted device header is read by name');
  assert(!shiftedParse.accountInfo?.deviceRecords?.some(row => row.device === 'not-a-device'), 'column 3 is not read when the device header moved');

  const unrelated = await workbook([
    ['a', 'b', 'c'],
    ['1', '2', 'Discord iOS'],
  ]);
  const unrelatedParse = await parseDiscordWorkbook('discord', 'notes.xlsx', unrelated, 'notes/notes.xlsx');
  assert(!(unrelatedParse.accountInfo?.deviceRecords || []).length, 'an unrelated sheet does not use column 3');

  const renamed = new TextEncoder().encode('a,b,device\n1,2,Discord iOS\n');
  const renamedParse = await parseDiscordWorkbook('discord', 'message_transaction_records.xlsx', renamed, 'reports/message_transaction_records.xlsx');
  assert(!(renamedParse.accountInfo?.deviceRecords || []).length, 'CSV bytes with an xlsx name are not treated as a workbook');

  const tagged = await workbook([
    ['user_id', 'event_time', 'device'],
    [SUBJECT_ID, '2024-08-08 08:08:08 UTC', 'Discord Android'],
    [OTHER_ID, '2024-08-09 09:09:09 UTC', 'Desktop Client'],
  ]);
  const taggedParse = await parseDiscordWorkbook('discord', 'message_transaction_records.xlsx', tagged, 'reports/message_transaction_records.xlsx');
  const subject = parseForensicFile('discord', 'synthetic-session.txt', sessionText(), 'reports/synthetic-session.txt');
  const partner = parseForensicFile('discord', 'partner.txt', [
    'Username: synthetic_partner',
    'User ID: 111000000000000009',
    'Registration IP: 203.0.113.8',
    'Last Seen IP: 203.0.113.9',
    'IP History',
    'Timestamp, IP Address',
    '2024-03-03 03:03:03 UTC, 203.0.113.8',
  ].join('\n'), 'reports/partner.txt');
  const combined = workspace([
    { name: 'synthetic-session.txt', relativePath: 'reports/synthetic-session.txt', parse: subject },
    { name: 'partner.txt', relativePath: 'reports/partner.txt', parse: partner },
    { name: 'message_transaction_records.xlsx', relativePath: 'reports/message_transaction_records.xlsx', parse: taggedParse },
    { name: 'message_transaction_records.xlsx', relativePath: 'copy/reports/message_transaction_records.xlsx', parse: taggedParse },
  ]);
  const subjectDevices = combined.accounts?.find(account => account.userId === SUBJECT_ID)?.deviceRecords || [];
  const partnerDevices = combined.accounts?.find(account => account.userId === OTHER_ID)?.deviceRecords || [];
  assert(subjectDevices.length === 1 && subjectDevices[0].device === 'Discord Android', 'device rows follow the user id column');
  assert(partnerDevices.length === 1 && partnerDevices[0].device === 'Desktop Client', 'the other subscriber keeps only their device row');
  const again = combineWorkspaceResults(combined, combined);
  assert((again?.accounts?.find(account => account.userId === SUBJECT_ID)?.deviceRecords || []).length === 1, 're-import does not duplicate device rows');
}

checkUtcAndSession();
checkNotFound();
checkPathsAndDedupe();
checkUsernames();
checkDevices().then(() => {
  console.log('discord history checks passed');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
