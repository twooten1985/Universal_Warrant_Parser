/**
 * Synthetic Google category return. No real names, emails, or paths.
 * Run: npx tsx scripts/verify-google-categories.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseForensicFile } from '../src/parserHelper';
import { parseFileAtPath } from '../src/lib/parseSourceFile';
import { googleCategorySample } from '../src/lib/googleFixture';
import { inventoryGoogleReturn } from '../src/lib/googleInventory';
import { isNoDataText, parseGoogleFolderName } from '../src/lib/googleFolders';
import { sweepPublicIps as sweepEvents } from '../src/lib/googleParse';
import { GOOGLE_CATEGORIES } from '../src/lib/googleCategories';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const dotted = parseGoogleFolderName('synthetic.user@example.test.100000001001.AccessLogActivity.Activity_001');
assert(dotted?.email === 'synthetic.user@example.test', 'email keeps its dots');
assert(dotted?.gaiaId === '100000001001', 'GAIA is the numeric id');
assert(dotted?.product === 'AccessLogActivity' && dotted.category === 'Activity', 'product and category');

const hashed = parseGoogleFolderName('synthetic.user@example.test#100000001001#GoogleAccount.SubscriberInfo_002');
assert(hashed?.gaiaId === '100000001001' && hashed.category === 'SubscriberInfo' && hashed.part === '002', 'hash separators');

const preserved = parseGoogleFolderName('synthetic.user@example.test.100000001001.Mail.MessageInformation_001.Preserved');
assert(preserved?.preserved === true && preserved.category === 'MessageInformation', 'preserved suffix');

const special = parseGoogleFolderName('synthetic.user@example.test.100000001001.GoogleFiWireless.Voicemails&Greetings_003');
assert(special?.category === 'Voicemails&Greetings', 'ampersand in the category');
const aka = parseGoogleFolderName('synthetic.user@example.test.100000001001.DriveAssociatedTargets.SharedDrives(a.k.a.TeamDrives)_001');
assert(aka?.category === 'SharedDrives(a.k.a.TeamDrives)', 'category may contain dots');

const device = parseGoogleFolderName('synthetic.user@example.test.900000111222.AndroidDeviceConfigurationService.DeviceAndUserProfile_001');
assert(device?.gaiaId === undefined && device?.numericId === '900000111222', 'android folder number is not a GAIA id');

assert(isNoDataText('Google Account Data\nService: Timeline\nOriginating Identifier: synthetic.user@example.test\nNo Data\n'), 'headers do not hide a No Data placeholder');
assert(!isNoDataText('Service: Timeline\nTimestamp,IP\n2024-01-01T00:00:00Z,203.0.113.10\n'), 'real rows are not No Data');
assert(!isNoDataText('Service: Timeline\n'), 'headers alone are not a No Data placeholder');

const swept = sweepEvents('note 172.16.5.5 and 203.0.113.10 and 2001:db8::10\n10.1.1.1\n', 'notes.txt', false);
assert(swept.every(e => e.timestamp !== '2026-07-02T04:59:59.000Z'), 'sweep does not invent a timestamp');
assert(swept.every(e => e.details?.untimed === true), 'sweep with no time is untimed');
assert(swept.some(e => e.ipAddress === '203.0.113.10'), 'public IPv4 is kept');
assert(swept.some(e => e.ipAddress === '2001:db8::10'), 'public IPv6 is kept');
assert(!swept.some(e => e.ipAddress === '172.16.5.5'), '172.16.0.0/12 is not a public address');
assert(!swept.some(e => e.ipAddress === '10.1.1.1'), '10/8 stays private');
const timed = sweepEvents('203.0.113.20 at 2024-05-01T15:04:05Z\n', 'notes.txt', false);
assert(timed[0]?.timestamp.startsWith('2024-05-01T15:04:05'), 'sweep uses a time written on the same line');
assert(timed[0]?.details?.untimed !== true, 'a real sweep time is not untimed');

const files = googleCategorySample();
const parsed = files.map(f => ({
  f,
  result: parseForensicFile('google', f.name, f.content, f.relativePath),
}));

function byName(name: string) {
  return parsed.find(p => p.f.name === name && (p.f.relativePath || '').includes(name)) || parsed.find(p => p.f.name === name);
}

const activity = parsed.find(p => (p.f.relativePath || '').includes('AccessLogActivity.Activity_001/Activity.csv'));
assert(activity, 'activity file parsed');
assert(activity!.result.events.filter(e => e.details?.googleKind === 'access-log').length === 3, 'three activity rows');
assert(activity!.result.events.some(e => e.ipAddress === '203.0.113.10' && e.timestamp.startsWith('2024-05-01T15:04:05')), 'activity keeps the real time and IP');
assert(activity!.result.events.some(e => e.ipAddress === '2001:db8::10'), 'activity keeps IPv6');
assert(!activity!.result.events.some(e => e.timestamp === '2026-07-02T04:59:59.000Z'), 'no fabricated activity time');
assert(activity!.result.events.every(e => e.details?.provider === 'google' && e.details?.googleCategory === 'AccessLogActivity.Activity'), 'activity is tagged');
assert(activity!.result.accountInfo?.userId === '100000001001', 'GAIA comes from the dotted folder');
assert(activity!.result.accountInfo?.email === 'synthetic.user@example.test', 'account email comes from the folder');

const keys = new Set(parsed.filter(p => (p.f.relativePath || '').includes('100000001001') && !p.f.relativePath!.includes('AndroidDevice')).flatMap(p => p.result.events.map(e => e.accountKey).filter(Boolean)));
assert(keys.size === 1 && [...keys][0]?.includes('100000001001'), 'categories of one GAIA share an account key');

const android = parsed.find(p => (p.f.relativePath || '').includes('AndroidDeviceConfigurationService'));
assert(android && android.result.accountInfo?.userId !== '900000111222', 'device id is not stored as the GAIA id');
assert(android!.result.events[0]?.content.includes('Synthetic Handset'), 'android HTML profile is read');

const changes = parsed.find(p => p.f.name === 'ChangeHistory.html')!;
assert(changes.result.events.some(e => e.details?.googleKind === 'account-change' && e.ipAddress === '203.0.113.44' && e.timestamp.startsWith('2024-04-01')), 'change history row');
assert(changes.result.events.some(e => e.details?.untimed === true && e.ipAddress === '198.51.100.8'), 'a change with no time stays untimed');

const my = parsed.find(p => p.f.name === 'MyActivity.html')!;
assert(my.result.events.some(e => e.content.includes('synthetic query') && e.timestamp.startsWith('2024-05-03')), 'My Activity HTML');

const vcf = parsed.find(p => p.f.name === 'contacts.vcf')!;
assert(vcf.result.events.some(e => e.details?.googleKind === 'contact' && String(e.details?.tel).includes('15555550100')), 'vCard contact');

const voice = parsed.find(p => p.f.name === 'calls.html')!;
assert(voice.result.events.some(e => e.category === 'message' && e.content.includes('synthetic voice text') && e.details?.mediaName === 'voicemail.mp3'), 'voice text links the mp3');
assert(String(voice.result.events[0]?.details?.conversationId || '').startsWith('Voice:'), 'voice opens as a conversation');

const mp3 = parsed.find(p => p.f.name === 'voicemail.mp3')!;
assert(mp3.result.events.some(e => e.details?.googleKind === 'voicemail'), 'voicemail audio is listed');

const oldLoc = parsed.find(p => p.f.name === 'Records.json')!;
assert(oldLoc.result.events.some(e => Math.abs(Number(e.details?.lat) - 37.7749) < 0.001 && e.timestamp.startsWith('2024-05-01T15:00:00')), 'old Records.json E7 point');

const raw = parsed.find(p => p.f.name === 'RawSignals.json')!;
assert(raw.result.events.some(e => Math.abs(Number(e.details?.lat) - 37.78) < 0.001), 'rawSignals degree string');

const sem = parsed.find(p => p.f.name === 'Semantic.json')!;
assert(sem.result.events.some(e => e.details?.googleKind === 'visit'), 'semantic visit');
assert(sem.result.events.some(e => e.details?.googleKind === 'trip'), 'semantic trip');

const settings = parsed.find(p => p.f.name === 'Settings.json')!;
assert(settings.result.events.some(e => e.details?.deviceTag === '1' && e.details?.deviceName === 'Synthetic Handset'), 'settings map device tag to a name');

const home = parsed.find(p => p.f.name === 'UserLocationProfile.json')!;
assert(home.result.events.some(e => e.details?.label === 'HOME' && e.details?.lat), 'home label is plotted');

const enc = parsed.find(p => (p.f.relativePath || '').includes('EncryptedBackups'))!;
assert(enc.result.events.some(e => e.details?.encrypted === true && e.details?.viewable === false), 'encrypted backup is flagged');

const chat = parsed.find(p => p.f.name === 'messages.json')!;
assert(chat.result.events.some(e => e.category === 'message' && e.content === 'synthetic chat line' && String(e.details?.conversationId).includes('Google Chat')), 'chat message');

const fi = parsed.find(p => p.f.name.includes('UserInfo'))!;
assert(fi.result.events.some(e => e.category === 'call' && e.recipient === '+15555550999'), 'Fi usage row');

const pay = parsed.find(p => p.f.name === 'transactions.csv')!;
assert(pay.result.events.some(e => e.details?.amount === '12.00' && e.timestamp.startsWith('2024-05-07')), 'Pay transaction');

const unknown = parsed.find(p => (p.f.relativePath || '').includes('UnmappedExport'))!;
assert(unknown.result.events.some(e => e.details?.googleKind === 'table-row' && e.details?.fields?.Alpha === 'one'), 'unknown category uses the header');
assert(unknown.result.events[0]?.details?.googleCategory === 'FutureProduct.UnmappedExport', 'unknown category stays visible');

const mail = parsed.find(p => p.f.name === 'MessageInformation.csv')!;
assert(mail.result.events.some(e => e.details?.isEmail === true && e.details?.subject === 'synthetic subject'), 'message headers reach the Gmail browser');
assert((mail.f.relativePath || '').includes('.Preserved'), 'preserved folder was the source');

const photo = parsed.find(p => p.f.name === 'photo.jpg.json')!;
assert(photo.result.events.some(e => e.details?.googleKind === 'photo' && Math.abs(Number(e.details?.lat) - 37.75) < 0.001), 'photo sidecar coordinates');

const linked = parsed.find(p => p.f.name === 'LinkedByAndroidProfile.csv')!;
assert(linked.result.events.some(e => e.details?.googleKind === 'linked-account' && e.content.includes('linked.peer@example.test')), 'linked account');

const inventory = inventoryGoogleReturn(files.map(f => ({
  name: f.name,
  relativePath: f.relativePath,
  size: f.size,
  text: f.content.startsWith('data:') ? null : f.content,
  isMedia: f.isMedia,
})));
assert(inventory.audit.some(a => a.name === 'NoData.txt'), 'No Data placeholder is on the audit list');
assert(inventory.folders.some(f => f.badge === 'No Data'), 'No Data badge');
assert(inventory.folders.some(f => f.badge === 'Encrypted' && f.folder.key === 'Timeline.EncryptedBackups'), 'encrypted badge');
assert(inventory.folders.some(f => f.badge === 'Not parsed' && f.folder.category === 'UnmappedExport'), 'unknown category is not parsed, not hidden');
assert(inventory.folders.some(f => f.badge === 'Data' && f.folder.key === 'AccessLogActivity.Activity'), 'activity is data');
assert(inventory.audit.length === inventory.folders.filter(f => f.placeholders.length).reduce((n, f) => n + f.placeholders.length, 0), 'audit count matches placeholders');

const descriptions = Object.values(GOOGLE_CATEGORIES);
assert(descriptions.every(d => d.description.length > 40 && d.parser && d.label), 'every mapped category has a description');
assert(descriptions.some(d => d.id === 'AccessLogActivity.Activity' && /IP/i.test(d.description) && /worth opening/i.test(d.description)), 'activity description says what an examiner gets');

const mboxParts: string[] = [];
for (let i = 0; i < 2100; i++) {
  mboxParts.push(`From \nFrom: synthetic.user@example.test\nTo: peer@example.test\nSubject: synthetic ${i}\nDate: Tue, 15 Jun 2024 12:00:00 +0000\n\nbody ${i}\n`);
}
const mbox = parseForensicFile('google', 'mail.mbox', mboxParts.join('\n'), `${'synthetic.user@example.test'}.${'100000001001'}.Mail.Messages_001/mail.mbox`);
assert(mbox.events.filter(e => e.details?.isEmail).length === 2100, 'mbox is not capped at 2000');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-google-'));
const csvPath = path.join(dir, 'wide.csv');
const header = 'Timestamp,IP Address,Activity Type\n';
let body = header;
for (let i = 0; i < 8000; i++) body += `2024-05-01T15:04:${String(i % 60).padStart(2, '0')}Z,203.0.113.10,Login\n`;
assert(body.length > 256 * 1024, 'stream fixture is large enough to take the disk path');
fs.writeFileSync(csvPath, body);
const wideRel = 'synthetic.user@example.test.100000001001.AccessLogActivity.Activity_001/wide.csv';
const streamed = await parseFileAtPath('google', 'wide.csv', csvPath, wideRel);
assert(streamed.events.filter(e => e.details?.googleKind === 'access-log').length === 8000, 'large CSV is streamed row by row');
assert(streamed.events.every(e => e.timestamp !== '2026-07-02T04:59:59.000Z'), 'streamed rows keep real times');
fs.rmSync(dir, { recursive: true, force: true });

console.log('google category checks passed');
