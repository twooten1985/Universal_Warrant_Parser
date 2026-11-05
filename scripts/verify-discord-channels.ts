/**
 * Discord channel names come only from synthetic channel.json metadata.
 * Run: npx tsx scripts/verify-discord-channels.ts
 *
 * No real Discord return, account, channel id, or message text is used.
 */
import assert from 'node:assert/strict';
import { parseForensicFile } from '../src/parserHelper';
import { assembleWorkspaceParse } from '../src/lib/consolidateParse';
import {
  discordChannelIdFromPath,
  discordChannelLookup,
  discordLookupKeepsMessages,
  discordThreadDisplayName,
  indexDiscordChannels,
  type DiscordChannelMeta,
} from '../src/lib/discordChannels';
import type { ForensicEvent, ParseResult } from '../src/types';

const LABEL = '#synth-room \u2014 9000000001001';

function channelJson(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ id, type: 0, ...extra });
}

function columnCsv(channelId: string, body: string): string {
  return [
    'channel_id,message_id,timestamp,author_id,author_username,content,attachments',
    `${channelId},m-${channelId},2024-01-02T03:04:05.000Z,501,synth_user,"${body}",`,
  ].join('\n');
}

function packageCsv(body: string): string {
  return [
    'ID,Timestamp,Contents,Attachments',
    `pkg-m1,2024-03-03T00:00:00.000Z,"${body}",`,
  ].join('\n');
}

function messagesJson(body: string): string {
  return JSON.stringify([
    {
      ID: 'json-m1',
      Timestamp: '2024-02-02T00:00:00.000Z',
      Contents: body,
      Attachments: '',
    },
  ]);
}

function parsedFile(name: string, relativePath: string, content: string) {
  return {
    name,
    relativePath,
    size: content.length,
    provider: 'discord' as const,
    parse: parseForensicFile('discord', name, content, relativePath),
  };
}

function assemble(files: ReturnType<typeof parsedFile>[]): ParseResult {
  const result = assembleWorkspaceParse(files, 'discord', provider => provider);
  assert.ok(result, 'workspace parse');
  return result;
}

function messages(result: ParseResult): ForensicEvent[] {
  return result.events.filter(event => event.category === 'message');
}

function labelFor(events: ForensicEvent[], channelId: string): string {
  const rows = events.filter(event => event.details?.channelId === channelId);
  const shown = discordThreadDisplayName(channelId, rows);
  assert.equal(shown.channelId, channelId, 'conversation lookup key stays the channel id');
  return shown.label;
}

// Path layout: messages/c<id>/ holds the channel id. A non-channel folder does not.
assert.equal(discordChannelIdFromPath('messages/c9000000001001/channel.json'), '9000000001001');
assert.equal(discordChannelIdFromPath('Messages\\C9000000001001\\messages.csv'), '9000000001001');
assert.equal(discordChannelIdFromPath('messages/csv/messages.csv'), null);
assert.equal(discordChannelIdFromPath('messages/c/channel.json'), null);
assert.equal(discordChannelIdFromPath('messages/c1001/channel.json'), null);

const userJson = JSON.stringify({
  id: '501',
  username: 'synth_user',
  global_name: 'Synth User',
  email: 'synth.user@example.test',
  created_at: '2024-01-01T00:00:00.000Z',
});

const named = channelJson('9000000001001', { name: 'synth-room' });
const namedPath = 'messages/c9000000001001/channel.json';
const columnPath = 'messages/c9000000001001/messages.csv';
const columnBody = columnCsv('9000000001001', 'synthetic column note');

const withName = assemble([
  parsedFile('user.json', 'user.json', userJson),
  parsedFile('channel.json', namedPath, named),
  parsedFile('channel.json', namedPath, named),
  parsedFile('messages.csv', columnPath, columnBody),
]);

assert.equal(withName.accounts?.length, 1, 'channel.json is not an account');
assert.equal(withName.accounts?.[0]?.username, 'synth_user');
const namedMessages = messages(withName);
assert.equal(namedMessages.length, 1, 'duplicate channel.json paths do not duplicate chat rows');
assert.equal(namedMessages[0].details?.channelId, '9000000001001');
assert.equal(namedMessages[0].details?.channelName, 'synth-room');
assert.equal(namedMessages[0].details?.channelType, '0');
assert.equal(labelFor(namedMessages, '9000000001001'), LABEL);
assert.equal(namedMessages[0].sender.includes('synth-room'), false);

// The same folder with Windows separators is the same path.
const winDup = assemble([
  parsedFile('channel.json', 'messages\\c9000000001001\\channel.json', named),
  parsedFile('channel.json', 'messages/c9000000001001/channel.json', named),
  parsedFile('messages.csv', columnPath, columnBody),
]);
assert.equal(messages(winDup)[0].details?.channelName, 'synth-room');
assert.equal(labelFor(messages(winDup), '9000000001001'), LABEL);

// Package messages.csv and messages.json take the channel id from the folder.
const packageBody = packageCsv('synthetic package note');
const jsonBody = messagesJson('synthetic json note');
const packageResult = assemble([
  parsedFile('channel.json', 'messages/c9000000001003/channel.json', channelJson('9000000001003', { name: 'synth-pack' })),
  parsedFile('messages.csv', 'messages/c9000000001003/messages.csv', packageBody),
  parsedFile('channel.json', 'messages/c9000000001002/channel.json', channelJson('9000000001002', { name: 'synth-json' })),
  parsedFile('messages.json', 'messages/c9000000001002/messages.json', jsonBody),
]);
const packageRows = messages(packageResult);
const pack = packageRows.find(event => event.details?.channelId === '9000000001003');
const jsonRow = packageRows.find(event => event.details?.channelId === '9000000001002');
assert.ok(pack && jsonRow, 'package csv and messages.json both produce chat rows');
assert.equal(pack.details?.messageId, 'pkg-m1');
assert.notEqual(pack.details?.channelId, 'pkg-m1');
assert.equal(pack.details?.channelName, 'synth-pack');
assert.equal(pack.sender, 'User (System)');
assert.equal(labelFor(packageRows, '9000000001003'), '#synth-pack \u2014 9000000001003');
assert.equal(jsonRow.details?.channelName, 'synth-json');
assert.equal(jsonRow.sender, 'User (System)');
assert.equal(labelFor(packageRows, '9000000001002'), '#synth-json \u2014 9000000001002');

// No channel.json: the id is the label. Do not prefix a hash or invent a title.
const absent = assemble([
  parsedFile('messages.csv', 'messages/c9000000001004/messages.csv', columnCsv('9000000001004', 'synthetic orphan note')),
  parsedFile('messages.json', 'messages/c9000000001007/messages.json', messagesJson('synthetic json orphan')),
]);
const orphanCsv = messages(absent).find(event => event.details?.channelId === '9000000001004');
const orphanJson = messages(absent).find(event => event.details?.channelId === '9000000001007');
assert.ok(orphanCsv && orphanJson);
assert.equal(orphanCsv.details?.channelName, undefined);
assert.equal(orphanJson.details?.channelName, undefined);
for (const id of ['9000000001004', '9000000001007']) {
  const label = labelFor(messages(absent), id);
  assert.equal(label, id);
  assert.equal(label.startsWith('#'), false);
  assert.equal(label.includes('Discord Channel: #'), false);
}

// Same path, two supplied names: keep the id and drop both names.
const conflicted = assemble([
  parsedFile('channel.json', 'messages/c9000000001005/channel.json', channelJson('9000000001005', { name: 'synth-room' })),
  parsedFile('channel.json', 'messages/c9000000001005/channel.json', channelJson('9000000001005', { name: 'other-room' })),
  parsedFile('messages.csv', 'messages/c9000000001005/messages.csv', columnCsv('9000000001005', 'synthetic conflict note')),
]);
const conflictRow = messages(conflicted)[0];
assert.equal(conflictRow.details?.channelId, '9000000001005');
assert.equal(conflictRow.details?.channelName, undefined);
const conflictLabel = labelFor(messages(conflicted), '9000000001005');
assert.equal(conflictLabel, '9000000001005');
assert.equal(conflictLabel.includes('synth-room'), false);
assert.equal(conflictLabel.includes('other-room'), false);

// Different paths, same id, different names: do not choose one.
const split = assemble([
  parsedFile('channel.json', 'a/messages/c9000000001006/channel.json', channelJson('9000000001006', { name: 'alpha-room' })),
  parsedFile('channel.json', 'b/messages/c9000000001006/channel.json', channelJson('9000000001006', { name: 'beta-room' })),
  parsedFile('messages.csv', 'a/messages/c9000000001006/messages.csv', columnCsv('9000000001006', 'synthetic split note')),
]);
assert.equal(messages(split)[0].details?.channelName, undefined);
assert.equal(labelFor(messages(split), '9000000001006'), '9000000001006');

// Direct messages and guild objects often have no channel name. Do not borrow recipients or the server name.
const unnamedMeta = assemble([
  parsedFile('channel.json', 'messages/c9000000001008/channel.json', JSON.stringify({
    id: '9000000001008',
    type: 1,
    recipients: ['4242'],
  })),
  parsedFile('messages.json', 'messages/c9000000001008/messages.json', messagesJson('synthetic dm note')),
  parsedFile('channel.json', 'messages/c9000000001009/channel.json', JSON.stringify({
    id: '9000000001009',
    type: 0,
    guild: { id: '77', name: 'Synth Server' },
  })),
  parsedFile('messages.csv', 'messages/c9000000001009/messages.csv', columnCsv('9000000001009', 'synthetic guild note')),
  parsedFile('channel.json', 'messages/c9000000001011/channel.json', JSON.stringify({ id: '9000000001011', type: 0, name: '   ' })),
  parsedFile('messages.csv', 'messages/c9000000001011/messages.csv', columnCsv('9000000001011', 'synthetic blank name')),
]);
for (const id of ['9000000001008', '9000000001009', '9000000001011']) {
  const row = messages(unnamedMeta).find(event => event.details?.channelId === id);
  assert.ok(row, id);
  assert.equal(row.details?.channelName, undefined);
  const label = labelFor(messages(unnamedMeta), id);
  assert.equal(label, id);
  assert.equal(label.includes('4242'), false);
  assert.equal(label.includes('Synth Server'), false);
}

// A leading hash in the supplied name is the same channel name, shown once.
const hashed = assemble([
  parsedFile('channel.json', 'messages/c9000000001012/channel.json', channelJson('9000000001012', { name: '#synth-hash' })),
  parsedFile('messages.csv', 'messages/c9000000001012/messages.csv', columnCsv('9000000001012', 'synthetic hash name')),
]);
assert.equal(messages(hashed)[0].details?.channelName, 'synth-hash');
assert.equal(labelFor(messages(hashed), '9000000001012'), '#synth-hash \u2014 9000000001012');

// Supplied nested author is kept. A missing author stays Unknown.
const authored = parseForensicFile('discord', 'messages.json', JSON.stringify([
  {
    ID: 'json-m2',
    Timestamp: '2024-04-04T00:00:00.000Z',
    Contents: 'synthetic authored note',
    author: { id: '501', username: 'synth_user' },
  },
]), 'messages/c9000000001013/messages.json');
assert.equal(authored.events[0].sender, 'synth_user (501)');
assert.equal(authored.events[0].details?.channelId, '9000000001013');
assert.equal(authored.discordChannels, undefined);

// channel.json does not become the account file. A non-Discord provider ignores it.
const channelOnly = parseForensicFile('discord', 'channel.json', named, namedPath);
assert.equal(channelOnly.accountInfo, undefined);
assert.equal(channelOnly.events.length, 0);
assert.equal(channelOnly.discordChannels?.[0]?.name, 'synth-room');
const userOnly = parseForensicFile('discord', 'user.json', userJson, 'user.json');
assert.equal(userOnly.accountInfo?.username, 'synth_user');
assert.equal(userOnly.discordChannels, undefined);
const kik = parseForensicFile('kik', 'channel.json', named, namedPath);
assert.equal(kik.discordChannels, undefined);
assert.equal(kik.events.some(event => event.details?.channelName), false);

// Column channel id still wins over a different folder, and a name joins only that id.
const crossed = assemble([
  parsedFile('channel.json', 'messages/c9000000001001/channel.json', named),
  parsedFile('messages.csv', 'flat/messages.csv', columnCsv('channel-999', 'synthetic flat note')),
]);
const flat = messages(crossed).find(event => event.details?.channelId === 'channel-999');
assert.ok(flat);
assert.equal(flat.details?.channelName, undefined);
assert.equal(messages(crossed).some(event => event.details?.channelId === '9000000001001'), false);
assert.equal(labelFor(messages(crossed), 'channel-999'), 'channel-999');

// Index helper: conflicting names on one path, and a type, never become a display name.
const indexed = indexDiscordChannels([
  { id: '9000000001005', name: 'synth-room', type: '0', sourcePath: 'messages/c9000000001005/channel.json' },
  { id: '9000000001005', name: 'other-room', type: '3', sourcePath: 'messages/c9000000001005/channel.json' },
] satisfies DiscordChannelMeta[]);
assert.equal(indexed.get('9000000001005')?.name, undefined);
assert.equal(indexed.get('9000000001005')?.type, undefined);

// Channel-id lookup still finds the conversation. Message hits keep global-search filtering.
assert.equal(discordChannelLookup('9000000001001', 'synth-room', '9000000001001'), true);
assert.equal(discordChannelLookup('9000000001001', 'synth-room', 'synth-room'), true);
assert.equal(discordChannelLookup('9000000001001', undefined, '9000000001001'), true);
assert.equal(discordChannelLookup('9000000001002', undefined, '9000000001001'), false);
assert.equal(discordChannelLookup('9000000001001', 'synth-room', 'synthetic'), false);
assert.equal(discordLookupKeepsMessages('9000000001001', 'synth-room', '9000000001001', 0), true);
assert.equal(discordLookupKeepsMessages('9000000001001', 'synth-room', '9000000001001', 2), false);
assert.equal(discordLookupKeepsMessages('9000000001001', 'synth-room', 'nope', 0), false);

console.log('verify-discord-channels: ok');
