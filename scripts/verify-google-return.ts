/**
 * Synthetic Google return loaded as a zip (with a nested zip) and as a folder.
 * No real names, emails, or addresses. Documentation ranges only.
 * Run: npx tsx scripts/verify-google-return.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { parseForensicFile } from '../src/parserHelper';
import { parseFileAtPath, readTextPreview } from '../src/lib/parseSourceFile';
import { googleCategorySample } from '../src/lib/googleFixture';
import { migrate, readStoredTextPreview, storeTextContent } from '../src/lib/caseDatabase';
import { listReturnFiles } from '../src/lib/ingestReturn';
import {
  defaultViewableFile,
  googleDashboardCounts,
  ipMapRecords,
  prepareHtmlDocument,
  viewableCategoryFiles,
} from '../src/lib/googleView';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const A = 'synthetic.user@example.test.100000001001';
const subscriber = `${A}.GoogleAccount.SubscriberInfo_001`;
const android = 'synthetic.user@example.test.900000111222.AndroidDeviceConfigurationService.DeviceAndUserProfile_001';
const photos = `${A}.GooglePhotos.PhotoResourceLegal_001`;

const files = googleCategorySample();
const events = files.flatMap(file => parseForensicFile('google', file.name, file.content, file.relativePath).events);
const counts = googleDashboardCounts(events, files);

assert(counts.photos >= 82, `photos counted ${counts.photos}, expected at least 82`);
assert(files.filter(file => file.relativePath?.includes('GooglePhotos') && file.name.endsWith('.jpg')).length >= 82, 'fixture has 82 photo files');
assert(files.some(file => file.name.startsWith('photo-') && !file.provider), 'one photo has no provider tag');
assert(files.some(file => file.provider === 'snapchat' && (file.relativePath || '').includes('GooglePhotos')), 'one photo is tagged as another provider');
assert(counts.changes >= 3, `account changes counted ${counts.changes}`);
assert(counts.ips >= 8, `ip tile counted ${counts.ips}`);

const subView = viewableCategoryFiles(files, subscriber);
assert(subView.length === 1 && subView[0].name === 'SubscriberInfo.html', 'subscriber dropdown is only the HTML file');
assert(defaultViewableFile(subView)?.name === 'SubscriberInfo.html', 'subscriber default is the HTML file');
assert(!subView.some(file => file.name.endsWith('.zip')), 'subscriber zip is not viewable');

const forced = [
  { name: `${subscriber}.zip`, relativePath: `${subscriber}.zip`, content: '', size: 10, isMedia: false, provider: 'google' as const },
  { name: 'notes.txt', relativePath: `${subscriber}/notes.txt`, content: 'plain note', size: 10, isMedia: false, provider: 'google' as const },
  { name: 'SubscriberInfo.html', relativePath: `${subscriber}/SubscriberInfo.html`, content: '<html><body><p>Subscriber page</p></body></html>', size: 40, isMedia: false, provider: 'google' as const },
  { name: 'NoData.txt', relativePath: `${subscriber}/NoData.txt`, content: 'Google Account Data\nService: Google Account\nNo Data\n', size: 20, isMedia: false, provider: 'google' as const },
];
const forcedView = viewableCategoryFiles(forced, subscriber);
assert(forcedView.map(file => file.name).join(',') === 'SubscriberInfo.html,notes.txt', `dropdown is ${forcedView.map(file => file.name).join(',')}`);
assert(defaultViewableFile(forcedView)?.name === 'SubscriberInfo.html', 'default stays the HTML file when a zip is listed first');
const onlyPlaceholder = viewableCategoryFiles(forced.filter(file => file.name === 'NoData.txt' || file.name.endsWith('.zip')), subscriber);
assert(onlyPlaceholder.length === 1 && onlyPlaceholder[0].name === 'NoData.txt', 'a No Data file is listed when it is the only viewable file');

const deviceView = viewableCategoryFiles(files, android);
assert(!deviceView.some(file => file.name.endsWith('.zip')), 'device zip is not in the dropdown');
assert(deviceView.some(file => file.name === 'Device-1.html') && deviceView.some(file => file.name === 'Network.html'), 'both device HTML files are listed');
assert(defaultViewableFile(deviceView)?.name === 'Device-1.html', 'device default is the HTML profile');

const map = ipMapRecords(events);
const byIp = new Map(map.map(row => [row.ip, row]));
for (const ip of ['203.0.113.10', '203.0.113.60', '198.51.100.60', '203.0.113.50', '203.0.113.77', '203.0.113.44', '2001:db8::10', '2001:db8::44', '203.0.113.90']) {
  assert(byIp.has(ip), `map is missing ${ip}`);
}
assert(byIp.get('203.0.113.61')?.label === 'No timestamp', 'untimed access-log IP is labeled No timestamp');
assert(byIp.get('198.51.100.8')?.label === 'No timestamp', 'untimed change-history IP is labeled No timestamp');
assert(byIp.get('203.0.113.90')?.label === 'No timestamp', 'sweep IP with no time is labeled No timestamp');
assert(byIp.get('203.0.113.60')?.untimed === false, 'Activity IP Address column kept its time');
assert(byIp.get('198.51.100.60')?.untimed === false, 'Source IP column kept its time');
assert(byIp.get('203.0.113.77')?.untimed === false, 'sign-up IP kept the created date');
assert(!byIp.has('172.16.5.5'), 'private 172.16 address stays off the map');
assert(events.some(event => event.details?.googleKind === 'subscriber-ip' && event.category === 'connection' && event.ipAddress === '203.0.113.77'), 'sign-up IP is a connection event');
assert(events.some(event => event.details?.googleKind === 'account-change' && event.category === 'connection' && event.ipAddress === '203.0.113.44'), 'change history IP is a connection event');
assert(events.some(event => event.details?.googleKind === 'device' && event.ipAddress === '203.0.113.50'), 'device IP is kept');
assert(events.some(event => event.details?.googleKind === 'access-log' && event.ipAddress === '203.0.113.60'), 'preamble and Activity IP Address header are read');
assert(events.some(event => event.details?.googleKind === 'access-log' && event.ipAddress === '198.51.100.60'), 'Source IP header is read');

const html = String(files.find(file => file.name === 'SubscriberInfo.html')?.content || '');
const prepared = prepareHtmlDocument(html);
assert(prepared.isHtml, 'subscriber file is HTML');
assert(!/script/i.test(prepared.html), 'script is removed before the iframe');
assert(prepared.html.includes('Sign-up IP'), 'iframe document keeps the page text');
assert(prepared.text.includes('synthetic.user@example.test'), 'text fallback keeps the account email');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-google-return-'));
const utf16Path = path.join(dir, 'SubscriberInfo.html');
fs.writeFileSync(utf16Path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, 'utf16le')]));
const diskPreview = readTextPreview(utf16Path, 200000);
assert(diskPreview.text.includes('Sign-up IP: 203.0.113.77'), 'disk preview decodes UTF-16 HTML');
assert(!diskPreview.text.includes('\u0000'), 'UTF-16 preview has no NULs');
const fromDisk = await parseFileAtPath('google', 'SubscriberInfo.html', utf16Path, `${subscriber}/SubscriberInfo.html`);
assert(fromDisk.events.some(event => event.ipAddress === '203.0.113.77' && event.category === 'connection'), 'UTF-16 HTML on disk yields the sign-up IP');

const csv = [
  'Google Account Data',
  'Service: Access Log Activity',
  'Time (UTC),Source IP,Product',
  '2024-06-02T09:00:00Z,198.51.100.61,Gmail',
].join('\n');
const csvPath = path.join(dir, 'source-ip.csv');
fs.writeFileSync(csvPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')]));
const csvParsed = await parseFileAtPath('google', 'source-ip.csv', csvPath, `${A}.AccessLogActivity.Activity_001/source-ip.csv`);
assert(csvParsed.events.some(event => event.ipAddress === '198.51.100.61'), 'UTF-16 CSV with a Source IP header is read from disk');

const db = new Database(path.join(dir, 'case.db'));
migrate(db);
db.prepare(`INSERT INTO cases (id, case_id_code, investigator_name, suspect_name, active_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('case-html', 'CASE', 'Examiner', 'Synthetic', 'google', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
storeTextContent(db, 'case-html', `${subscriber}/SubscriberInfo.html`, 'SubscriberInfo.html', html, html.length, 'google');
const stored = readStoredTextPreview(db, 'case-html', `${subscriber}\\SubscriberInfo.html`, 'SubscriberInfo.html', 200000);
assert(stored && stored.includes('Sign-up IP'), 'stored HTML is returned when the path uses backslashes');
const byName = readStoredTextPreview(db, 'case-html', 'missing/path.html', 'SubscriberInfo.html', 200000);
assert(byName && byName.includes('synthetic.user@example.test'), 'stored HTML is found by file name when the relative path differs');
const storedDoc = prepareHtmlDocument(stored || '');
assert(!/script/i.test(storedDoc.html) && storedDoc.text.includes('Sign-up IP'), 'stored HTML renders with scripts removed');
db.close();

const inner = new JSZip();
inner.file(`${subscriber}/SubscriberInfo.html`, html);
const innerBytes = await inner.generateAsync({ type: 'nodebuffer' });
const outer = new JSZip();
outer.file(`${subscriber}.zip`, innerBytes);
outer.file(`${photos}/photo-from-zip.jpg`, Buffer.from('not-a-real-jpeg'));
const alt = String(files.find(file => file.name === 'Activity-alt.csv')?.content || '');
outer.file(`${A}.AccessLogActivity.Activity_001/Activity-alt.csv`, alt);
const zipBytes = await outer.generateAsync({ type: 'nodebuffer' });
const listed = await listReturnFiles(zipBytes, 'Return/');
assert(listed.some(item => item.name === 'SubscriberInfo.html'), 'nested zip yields the HTML file');
assert(listed.some(item => item.name.endsWith('.zip')), 'the nested zip container is still listed');
const htmlItem = listed.find(item => item.name === 'SubscriberInfo.html');
assert(htmlItem?.text && htmlItem.text.includes('203.0.113.77'), 'zip HTML text is available without a sourcePath');
const zipEvents = parseForensicFile('google', htmlItem!.name, htmlItem!.text || '', htmlItem!.relativePath).events;
assert(zipEvents.some(event => event.ipAddress === '203.0.113.77'), 'HTML from the nested zip parses to the sign-up IP');
const folderRoot = path.join(dir, 'extracted');
for (const item of listed) {
  if (item.name.endsWith('.zip')) continue;
  const dest = path.join(folderRoot, item.relativePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, item.bytes);
}
const extractedHtml = listed.find(item => item.name === 'SubscriberInfo.html')!;
const extractedParsed = await parseFileAtPath('google', extractedHtml.name, path.join(folderRoot, extractedHtml.relativePath), extractedHtml.relativePath);
assert(extractedParsed.events.some(event => event.ipAddress === '203.0.113.77'), 'the same HTML parsed from an extracted folder');
const extractedCsv = listed.find(item => item.name === 'Activity-alt.csv')!;
const extractedCsvParsed = await parseFileAtPath('google', extractedCsv.name, path.join(folderRoot, extractedCsv.relativePath), extractedCsv.relativePath);
assert(extractedCsvParsed.events.some(event => event.ipAddress === '203.0.113.60'), 'extracted Activity CSV keeps the activity IP');
assert(extractedCsvParsed.events.some(event => event.ipAddress === '203.0.113.61' && event.details?.untimed === true), 'extracted untimed activity row stays untimed');

fs.rmSync(dir, { recursive: true, force: true });
console.log('google return checks passed');
