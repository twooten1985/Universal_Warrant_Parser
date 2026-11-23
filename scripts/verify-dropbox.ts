/**
 * Synthetic Dropbox return. No real names, emails, IDs, or paths.
 * Covers part zips, an extracted copy of the same parts, a GUID folder under file-metadata,
 * user-metadata.pdf, an unrelated file, an active account without Disabled folders,
 * and a CSV whose only text is "No information available."
 * Run: npx tsx scripts/verify-dropbox.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { extractTextFromPdfContent, parseForensicFile } from '../src/parserHelper';
import { parseFileAtPath } from '../src/lib/parseSourceFile';
import { classifyDropboxPath, isDropboxUserReport, planDropboxImport } from '../src/lib/dropboxPath';
import { filterMediaFiles } from '../src/lib/mediaBrowser';
import { applyTagItems, exhibitEventsFromTags } from '../src/lib/exhibits';
import PDFDocument from 'pdfkit';
import { DROPBOX_NO_DATA } from '../src/lib/dropboxParse';
import { matchDropboxActivity } from '../src/lib/dropboxMatch';
import { detectReturnProvider } from '../src/lib/detectReturn';
import { accountIdFromPaths } from '../src/lib/caseReturns';
import { ipMapRecords } from '../src/lib/googleView';
import { extractZipToWorkspace } from '../src/lib/zipWorkspace';
import type { UploadedFile } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const USER = '100000222333';
const GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const WHEN = '2026-09-05 17:32:02 UTC';
const EMAIL = 'synthetic.dropbox@example.test';

function activityCsv(rows: string[]): string {
  return ['Time/Date,Actor User ID,Action,Size (Bytes),File Path', ...rows].join('\n');
}

function pdfWithLines(lines: string[]): Buffer {
  const body = lines.map(line => `(${line.replace(/[()\\]/g, '')}) Tj\n0 -14 Td`).join('\n');
  const stream = `BT /F1 11 Tf 72 740 Td\n${body}\nET`;
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n',
    '2 0 obj<< /Type /Pages /Count 1 /Kids [3 0 R] >>endobj\n',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

const folderCsv = activityCsv([
  `${WHEN},${USER},Add,1200,/Root/Camera Uploads/photo.jpg`,
  `2026-09-06 08:00:00 UTC,${USER},Delete,10,/Root/Camera Uploads/missing.jpg`,
]);
const backupCsv = activityCsv([
  `${WHEN},${USER},Add,400,/Root/clip.mp4`,
]);
const disabledCsv = 'No information available.';
const userText = [
  `Report for User ${USER}`,
  'Basic Information',
  `User ID: ${USER}`,
  'Full Name: Synthetic Dropbox User',
  `Email Address: ${EMAIL}`,
  'Billing Activity',
  'No information available.',
  'Authentication Log',
  'Timestamp, IP Address',
  `${WHEN}, 203.0.113.10`,
  '2026-09-06 08:00:00 UTC, 2001:db8:0:0:',
  ':10',
  'Linked Computer Information',
  'Computer Name: SYNTH-PC',
  'Mobile Information',
  'Last Ping Time/Date: 2026-09-07 12:00:00 UTC',
  'IP Address: 198.51.100.20',
  'Device Model: Synthetic Phone',
  'Device Carrier: Example Wireless',
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-dropbox-'));
const ret = path.join(root, 'DropboxReturn');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function writeRel(rel: string, data: Buffer | string): void {
  const dest = path.join(ret, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
}

const deletedPhoto = `${USER}/Deleted Files/Deleted Dropbox Folder/Camera Uploads/old.jpg`;
const currentPhoto = `${USER}/File Data/Dropbox Folder/Camera Uploads/photo.jpg`;
const sameNameOtherFolder = `${USER}/File Data/Dropbox Folder/Other/photo.jpg`;
const backupClip = `${USER}/File Data/Dropbox Backup/clip.mp4`;
const orphanNote = `${USER}/File Data/Dropbox Folder/readme.txt`;

writeRel(`deleted-file-data-part-1/${deletedPhoto}`, jpeg);
writeRel(`file-data-part-1/${currentPhoto}`, jpeg);
writeRel(`file-data-part-1/${sameNameOtherFolder}`, jpeg);
writeRel(`file-data-part-1/${backupClip}`, Buffer.from('synthetic-video'));
writeRel(`file-data-part-1/${orphanNote}`, 'synthetic note');
writeRel(`file-metadata/${GUID}/disabled-dropbox-backup-file-activity.csv`, disabledCsv);
writeRel(`file-metadata/${GUID}/dropbox-backup-file-activity.csv`, backupCsv);
writeRel(`file-metadata/${GUID}/dropbox-folder-file-activity.csv`, folderCsv);
writeRel('user-metadata.pdf', pdfWithLines(userText));
writeRel('listing.txt', 'directory listing that is not part of the return');

async function zipOf(dir: string, dest: string): Promise<void> {
  const zip = new JSZip();
  const walk = (current: string, prefix: string) => {
    for (const name of fs.readdirSync(current)) {
      const abs = path.join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) walk(abs, rel);
      else zip.file(rel, fs.readFileSync(abs));
    }
  };
  walk(dir, '');
  fs.writeFileSync(dest, await zip.generateAsync({ type: 'nodebuffer' }));
}

await zipOf(path.join(ret, 'deleted-file-data-part-1'), path.join(ret, 'deleted-file-data-part-1.zip'));
await zipOf(path.join(ret, 'file-data-part-1'), path.join(ret, 'file-data-part-1.zip'));
await zipOf(path.join(ret, 'file-metadata'), path.join(ret, 'file-metadata.zip'));

const listing: string[] = [];
const walkList = (dir: string, prefix: string) => {
  for (const name of fs.readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = path.join(dir, name);
    listing.push(rel);
    if (fs.statSync(abs).isDirectory()) walkList(abs, rel);
  }
};
walkList(ret, '');
const plan = planDropboxImport(listing);
assert(plan.skip.has('listing.txt'), 'unrelated listing.txt is not imported');
assert(plan.notes.some(note => note.relativePath === 'listing.txt'), 'unrelated file is recorded as ignored');
assert(plan.skip.has(`file-data-part-1/${currentPhoto}`), 'extracted file-data copy is skipped');
assert(plan.skip.has(`file-metadata/${GUID}/dropbox-folder-file-activity.csv`), 'extracted metadata copy is skipped');
assert(!plan.skip.has('file-data-part-1.zip'), 'the zip is kept');
assert(!plan.skip.has('file-metadata.zip'), 'file-metadata.zip is kept');
assert(!plan.skip.has('user-metadata.pdf'), 'user-metadata.pdf is kept');
assert(plan.notes.some(note => /extracted folder was skipped/i.test(note.reason) && note.relativePath === 'file-data-part-1'), 'the skipped extract is recorded against the part');

const guidCsv = classifyDropboxPath(`file-metadata/${GUID}/dropbox-folder-file-activity.csv`);
assert(guidCsv.area === 'metadata' && guidCsv.category === 'folder', `GUID csv classified as ${guidCsv.area}/${guidCsv.category}`);
assert(classifyDropboxPath('user-metadata.pdf').area === 'user', 'user-metadata.pdf is the user report');
const detected = detectReturnProvider(listing);
assert(detected.provider === 'dropbox' && detected.confidence !== 'low', `detection ${detected.provider} ${detected.confidence}`);
assert(accountIdFromPaths('dropbox', listing) === USER, 'account id is the numeric Dropbox user id');

const metaZip = await extractZipToWorkspace(path.join(ret, 'file-metadata.zip'), path.join(root, 'meta-cache'));
const folderEntry = metaZip.entries.find(entry => entry.name === 'dropbox-folder-file-activity.csv');
assert(folderEntry && folderEntry.rel.includes(GUID), 'zip extraction keeps the GUID folder');
const folderParsed = await parseFileAtPath('dropbox', folderEntry!.name, folderEntry!.path, `file-metadata/${folderEntry!.rel}`);
const keptTime = folderParsed.events.find(event => event.details?.dropboxFilePath === '/Root/Camera Uploads/photo.jpg');
assert(keptTime?.timestamp === WHEN, `timestamp was rewritten to ${keptTime?.timestamp}`);
const disabledEntry = metaZip.entries.find(entry => entry.name.startsWith('disabled-'));
assert(disabledEntry, 'disabled activity csv is inside the metadata zip');
const disabledParsed = await parseFileAtPath('dropbox', disabledEntry!.name, disabledEntry!.path, `file-metadata/${disabledEntry!.rel}`);
assert(disabledParsed.events.some(event => event.details?.dropboxKind === 'no-data' && event.content === DROPBOX_NO_DATA), 'empty category is a note, not zero rows');

const pdfText = extractTextFromPdfContent(fs.readFileSync(path.join(ret, 'user-metadata.pdf'), 'latin1'));
const pdfParsed = parseForensicFile('dropbox', 'user-metadata.pdf', pdfText, 'user-metadata.pdf');
assert(pdfParsed.accountInfo?.userId === USER, 'pdf user id');
assert(pdfParsed.accountInfo?.displayName === 'Synthetic Dropbox User', 'pdf name');
assert(pdfParsed.accountInfo?.email === EMAIL, 'pdf email');
assert(pdfParsed.events.some(event => event.ipAddress === '203.0.113.10' && event.details?.dropboxTime === WHEN), 'auth log keeps the UTC timestamp and IPv4');
assert(pdfParsed.events.some(event => event.ipAddress === '2001:db8:0:0::10'), `wrapped IPv6 was ${pdfParsed.events.map(event => event.ipAddress).join(',')}`);
assert(pdfParsed.events.some(event => event.details?.dropboxSection === 'Billing Activity' && event.content === DROPBOX_NO_DATA), 'billing note is visible');
assert(pdfParsed.accountInfo?.otherDetails?.['Linked computers']?.includes('SYNTH-PC'), 'linked computer kept');
assert(pdfParsed.accountInfo?.otherDetails?.['Device model'] === 'Synthetic Phone', 'mobile model kept');
const map = ipMapRecords(pdfParsed.events);
assert(map.some(row => row.ip === '203.0.113.10'), 'auth IP feeds the map');
assert(map.some(row => row.ip === '198.51.100.20'), 'mobile IP feeds the map');

const files: UploadedFile[] = [
  { name: 'photo.jpg', relativePath: `file-data-part-1/${currentPhoto}`, content: '', size: 4, isMedia: true, mediaType: 'image', provider: 'dropbox' },
  { name: 'photo.jpg', relativePath: `file-data-part-1/${sameNameOtherFolder}`, content: '', size: 4, isMedia: true, mediaType: 'image', provider: 'dropbox' },
  { name: 'clip.mp4', relativePath: `file-data-part-1/${backupClip}`, content: '', size: 8, isMedia: true, mediaType: 'video', provider: 'dropbox' },
  { name: 'readme.txt', relativePath: `file-data-part-1/${orphanNote}`, content: '', size: 8, isMedia: false, provider: 'dropbox' },
  { name: 'old.jpg', relativePath: `deleted-file-data-part-1/${deletedPhoto}`, content: '', size: 4, isMedia: true, mediaType: 'image', provider: 'dropbox' },
];
const matched = matchDropboxActivity(files, folderParsed.events.concat(parseForensicFile('dropbox', 'dropbox-backup-file-activity.csv', backupCsv).events));
assert(matched.matched.length === 2, `expected photo and clip matches, got ${matched.matched.length}`);
assert(matched.matched.some(item => item.file.relativePath?.includes('Camera Uploads/photo.jpg')), 'folder csv matches the camera path');
assert(!matched.matched.some(item => item.file.relativePath?.includes('/Other/')), 'same file name in another folder is not a match');
assert(matched.activityWithoutFile.some(event => event.details?.dropboxFilePath === '/Root/Camera Uploads/missing.jpg'), 'csv row with no file stays visible');
assert(matched.filesWithoutActivity.some(file => file.name === 'readme.txt'), 'file with no csv row stays visible');
assert(matched.filesWithoutActivity.some(file => file.relativePath?.includes('Deleted Files')), 'deleted file with no row stays visible');

const active = classifyDropboxPath(`file-data-part-1/${currentPhoto}`);
assert(active.deleted === false && active.categoryLabel === 'Folder', 'active account folder is current File Data');
assert(!listing.some(item => item.includes('Disabled Dropbox')), 'this synthetic active account has no Disabled folders');

const onlyCsv = parseForensicFile('dropbox', 'dropbox-folder-file-activity.csv', folderCsv, `file-metadata/${GUID}/dropbox-folder-file-activity.csv`);
assert(onlyCsv.events.length === 2, 'a return that is only a metadata csv still parses');
const lone = planDropboxImport(['dropbox-folder-file-activity.csv', 'notes.txt']);
assert(!lone.skip.has('dropbox-folder-file-activity.csv'), 'a lone activity csv still imports when file-metadata is absent');
assert(lone.skip.has('notes.txt'), 'a lone unrelated file is still ignored');

assert(isDropboxUserReport('User Metadata.pdf'), 'spaced user report name');
assert(isDropboxUserReport('nested/User-Metadata-part-2.pdf'), 'part suffix at any depth');
const named = planDropboxImport(['Reports/User Metadata.pdf', 'listing.txt']);
assert(!named.skip.has('Reports/User Metadata.pdf'), 'User Metadata.pdf is kept');
assert(named.skip.has('listing.txt'), 'unrelated file beside the renamed report is ignored');

const laidOut = await laidOutUserPdf();
const laidPath = path.join(ret, 'User Metadata.pdf');
fs.writeFileSync(laidPath, laidOut);
const laidParsed = await parseFileAtPath('dropbox', 'User Metadata.pdf', laidPath, 'Reports/User Metadata.pdf');
assert(laidParsed.accountInfo?.userId === USER, `laid-out pdf user id was ${laidParsed.accountInfo?.userId}`);
assert(laidParsed.accountInfo?.displayName === 'Synthetic Dropbox User', 'laid-out pdf name');
assert(laidParsed.accountInfo?.email === EMAIL, 'laid-out pdf email');
assert(laidParsed.events.some(event => event.ipAddress === '203.0.113.10'), 'laid-out auth IPv4');
assert(laidParsed.events.some(event => event.ipAddress === '2001:db8:0:0::10'), `laid-out wrapped IPv6 was ${laidParsed.events.map(event => event.ipAddress).join(',')}`);
assert(laidParsed.events.some(event => event.details?.dropboxKind === 'computer' && event.content.includes('SYNTH-PC')), 'laid-out computer is its own row');
assert(laidParsed.events.some(event => event.details?.deviceModel === 'Synthetic Phone' && event.ipAddress === '198.51.100.20'), 'laid-out mobile row');
assert(laidParsed.events.some(event => event.details?.dropboxSection === 'Billing Activity' && event.content === DROPBOX_NO_DATA), 'laid-out empty billing stays visible');
assert(!laidParsed.events.some(event => event.details?.dropboxKind === 'parse-notice'), 'a readable report does not show a failure notice');

const blank = parseForensicFile('dropbox', 'user-metadata.pdf', '', 'user-metadata.pdf');
assert(blank.events.some(event => event.details?.dropboxKind === 'parse-notice' && /no text could be read/i.test(String(event.details?.dropboxNote || ''))), 'an unreadable PDF explains why the account panel is empty');

const mediaFiltered = filterMediaFiles({
  files,
  kind: 'all',
  query: '',
  accountFilter: 'all',
  providerFilter: 'dropbox',
  returnFilter: 'ret-dropbox',
  vicHashes: new Set<string>(),
  skinToneThreshold: 101,
  tagKeyForFile: () => '',
});
const withReturn = files.map(file => ({ ...file, returnId: 'ret-dropbox' }));
const other: UploadedFile = { name: 'snap.jpg', relativePath: 'memories/snap.jpg', content: '', size: 4, isMedia: true, mediaType: 'image', provider: 'snapchat', returnId: 'ret-snap' };
const scoped = filterMediaFiles({
  files: [...withReturn, other],
  kind: 'image',
  query: '',
  accountFilter: 'all',
  providerFilter: 'dropbox',
  returnFilter: 'ret-dropbox',
  vicHashes: new Set<string>(),
  skinToneThreshold: 101,
  tagKeyForFile: () => '',
});
assert(scoped.length === 3 && scoped.every(file => file.provider === 'dropbox' && file.returnId === 'ret-dropbox'), `provider and return filters kept ${scoped.map(file => file.relativePath).join(', ')}`);
assert(mediaFiltered.length === 0, 'a return id that is not on the file is not a match');

const activity = folderParsed.events.find(event => event.details?.dropboxFilePath === '/Root/Camera Uploads/photo.jpg');
assert(activity, 'activity row exists to tag');
const tags = applyTagItems({}, [{
  key: activity!.id,
  meta: { source: 'Dropbox', kind: 'file-activity', category: 'Folder', description: activity!.content, path: activity!.sourceFile },
}], true);
assert(tags[activity!.id]?.tagged, 'an activity row takes a case tag');
const fileKey = `dropbox-file:ret-dropbox:${files[3].relativePath}`;
const fileTags = applyTagItems(tags, [{
  key: fileKey,
  meta: { source: 'Dropbox', kind: 'dropbox-file', description: files[3].relativePath || files[3].name, path: files[3].relativePath },
}], true);
const exhibits = exhibitEventsFromTags(fileTags, new Set([activity!.id]));
assert(exhibits.some(event => event.id === fileKey && event.content.includes('readme.txt')), 'a tagged Dropbox file is included in exhibit export');

console.log('dropbox return checks passed');

function laidOutUserPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 72 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica');
    let y = 72;
    const line = (text: string, x: number, size = 10) => {
      doc.fontSize(size).text(text, x, y, { lineBreak: false });
    };
    line(`Report for User ${USER}`, 72, 14);
    y = 100;
    line('Basic Information', 72, 13);
    y = 122;
    line('User ID', 72);
    line(USER, 230);
    y = 140;
    line('Full Name', 72);
    line('Synthetic Dropbox User', 230);
    y = 158;
    line('Email Address', 72);
    line(EMAIL, 230);
    y = 190;
    line('Billing Activity', 72, 13);
    y = 210;
    line('No information available.', 72);
    y = 240;
    line('Authentication Log', 72, 13);
    y = 262;
    line('Timestamp', 72);
    line('IP Address', 300);
    y = 280;
    line(WHEN, 72);
    line('203.0.113.10', 300);
    y = 298;
    line('2026-09-06 08:00:00 UTC', 72);
    line('2001:db8:0:0:', 300);
    y = 312;
    line(':10', 300);
    doc.addPage();
    y = 72;
    line('Linked Computer Information', 72, 13);
    y = 96;
    line('Computer Name', 72);
    y = 114;
    line('SYNTH-PC', 72);
    y = 150;
    line('Mobile Information', 72, 13);
    y = 174;
    line('Last Ping Time/Date', 72);
    line('IP Address', 230);
    line('Device Model', 340);
    line('Device Carrier', 450);
    y = 192;
    line('2026-09-07 12:00:00 UTC', 72);
    line('198.51.100.20', 230);
    line('Synthetic Phone', 340);
    line('Example Wireless', 450);
    doc.end();
  });
}
