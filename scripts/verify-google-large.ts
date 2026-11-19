/**
 * Large synthetic Google return, plus the crash shapes from beta.21:
 * a PDF bigger than the JS string limit, a zip bigger than 2 GiB, and
 * entry names Windows cannot store (colon, reserved, long).
 * Files over the string limit are sparse. Nothing here is a real return.
 * Run: npx tsx scripts/verify-google-large.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import Database from 'better-sqlite3';
import { parseFileAtPath } from '../src/lib/parseSourceFile';
import { diskRelative, extractZipToWorkspace, inventoryFolderDetailed } from '../src/lib/zipWorkspace';
import { migrate } from '../src/lib/caseDatabase';
import { appendReturnError } from '../src/lib/returnLog';
import { detectReturnProvider } from '../src/lib/detectReturn';
import { writeSyntheticGoogleReturn } from './syntheticGoogleReturn';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function sparse(file: string, size: number, head: Buffer): void {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, head, 0, head.length, 0);
    fs.ftruncateSync(fd, size);
  } finally {
    fs.closeSync(fd);
  }
  const st = fs.statSync(file);
  assert(st.size === size, `${path.basename(file)} size is ${st.size}, expected ${size}`);
}

function zipTo(dest: string, files: Array<{ name: string; data: Buffer }>): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 1 }, forceZip64: true });
    out.on('error', reject);
    archive.on('error', reject);
    out.on('close', () => resolve());
    archive.pipe(out);
    for (const file of files) archive.append(file.data, { name: file.name });
    void archive.finalize();
  });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-google-large-'));
const made = await writeSyntheticGoogleReturn(root, { noDataFolders: 1200 });

const names = fs.readdirSync(made.folder);
assert(names.length >= 1200, `expected thousands of category folders, saw ${names.length}`);

const folderListed = await inventoryFolderDetailed(made.folder, path.join(root, 'folder-cache'));
assert(folderListed.entries.some(entry => entry.rel.replace(/\\/g, '/').endsWith('SubscriberInfo.html')), 'unzipped folder lists the subscriber HTML');
assert(folderListed.entries.some(entry => entry.name === 'Activity.csv'), 'unzipped folder lists the access log');
assert(folderListed.failed.some(item => /not a zip|end of central|invalid/i.test(item.error) || item.rel.toLowerCase().includes('.zip')), 'a file named .zip that is not a zip is recorded, not fatal');

const zipped = await extractZipToWorkspace(made.zipPath, path.join(root, 'zip-cache'));
assert(zipped.entries.some(entry => entry.rel.endsWith('SubscriberInfo.html')), 'zipped return lists the subscriber HTML');
assert(zipped.entries.some(entry => entry.rel.includes('report:name') || entry.rel.includes('illegal/')), 'the illegal archive name is kept in metadata');
const illegalOnDisk = zipped.entries.find(entry => entry.rel.includes('report:name') || entry.rel.includes('illegal/'));
if (illegalOnDisk) {
  assert(!path.basename(illegalOnDisk.path).includes(':'), 'the file written to disk has no colon');
  assert(fs.existsSync(illegalOnDisk.path), 'the sanitized file was written');
}
const slip = zipped.entries.find(entry => entry.rel.includes('slip.txt'));
if (slip) assert(path.resolve(slip.path).startsWith(path.resolve(zipped.dir)), 'a ../ entry stays inside the workspace');

const activity = folderListed.entries.find(entry => entry.name === 'Activity.csv');
assert(activity, 'activity csv is on disk');
const parsed = await parseFileAtPath('google', 'Activity.csv', activity!.path, activity!.rel);
assert(parsed.events.some(event => event.ipAddress === '198.51.100.61'), 'UTF-16 access log streams to the source IP');

const html = folderListed.entries.find(entry => entry.name === 'SubscriberInfo.html');
assert(html, 'subscriber html is on disk');
const htmlParsed = await parseFileAtPath('google', 'SubscriberInfo.html', html!.path, html!.rel);
assert(htmlParsed.events.some(event => event.ipAddress === '203.0.113.77') || (htmlParsed.warnings || []).length >= 0, 'subscriber HTML parses or is bounded');
assert(htmlParsed.events.some(event => event.ipAddress === '203.0.113.77'), 'UTF-16 subscriber HTML yields the sign-up IP');

const hugePdf = path.join(root, 'Drive-export.pdf');
const hugeZip = path.join(root, 'Production-synthetic.zip');
const PDF_SIZE = 700 * 1024 * 1024;
const ZIP_SIZE = 3598924653;
sparse(hugePdf, PDF_SIZE, Buffer.from('%PDF-1.4\n% synthetic\n'));
sparse(hugeZip, ZIP_SIZE, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
const started = Date.now();
const pdfParsed = await parseFileAtPath('google', 'Drive-export.pdf', hugePdf, 'Drive/Drive-export.pdf');
const zipParsed = await parseFileAtPath('google', 'Production-synthetic.zip', hugeZip, 'Production-synthetic.zip');
assert(Date.now() - started < 15000, 'huge PDF and zip were not read into one string');
assert((pdfParsed.warnings || []).some(item => item.relativePath === 'Drive/Drive-export.pdf'), 'PDF skip uses the path relative to the return');
assert((zipParsed.warnings || []).length > 0, 'the multi-gigabyte zip is skipped instead of readFileSync');
assert(!JSON.stringify(pdfParsed).includes('Cannot create a string'), 'PDF parse did not hit the string limit');

assert(!diskRelative('INBOX/2025-12-23T15:47:10-13.eml').includes(':'), 'colon timestamps are sanitized');
assert(/_CON/i.test(diskRelative('Mail/CON.eml')), 'reserved Windows names are prefixed');
const colonZip = path.join(root, 'colon.zip');
await zipTo(colonZip, [
  { name: 'INBOX/2025-12-23T15:47:10-13.eml', data: Buffer.from('From: synthetic@example.test\nSubject: hello\n\nbody\n') },
  { name: 'Mail/CON.eml', data: Buffer.from('reserved\n') },
  { name: `deep/${'n'.repeat(180)}/note.txt`, data: Buffer.from('long\n') },
]);
const colon = await extractZipToWorkspace(colonZip, path.join(root, 'colon-cache'));
const eml = colon.entries.find(entry => entry.rel.includes('15:47:10'));
assert(eml, 'the colon-named mail is listed under its original name');
assert(fs.existsSync(eml!.path), 'the sanitized mail exists on disk');
assert(!eml!.path.includes('15:47:10'), 'the disk path does not keep the colon time');
assert(colon.entries.some(entry => /CON/i.test(entry.rel)), 'the reserved name is kept in metadata');

const detected = detectReturnProvider(folderListed.entries.slice(0, 40).map(entry => entry.rel));
assert(detected.provider === 'google' && detected.confidence !== 'low', `detection was ${detected.provider} ${detected.confidence}`);

const logPath = path.join(root, 'uwrp-errors.log');
appendReturnError(logPath, 'Drive/Drive-export.pdf', 'Skipped text parse');
const log = fs.readFileSync(logPath, 'utf8');
assert(log.includes('Drive/Drive-export.pdf'), 'the error log uses the relative path');
assert(!log.includes(hugePdf), 'the error log does not contain the absolute evidence path');

const db = new Database(path.join(root, 'case.db'));
db.exec(`CREATE TABLE cases (id TEXT PRIMARY KEY, case_id_code TEXT, investigator_name TEXT, suspect_name TEXT, active_provider TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE case_files (
    case_id TEXT, name TEXT, content TEXT, size INTEGER, is_media INTEGER, media_type TEXT,
    relative_path TEXT, provider TEXT, PRIMARY KEY (case_id, name)
  );
  INSERT INTO cases VALUES ('c1', 'CASE', 'Examiner', 'Synthetic', 'google', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
  INSERT INTO case_files VALUES ('c1', 'a.csv', '', 10, 0, NULL, 'a.csv', 'google');`);
migrate(db);
const role = db.prepare(`SELECT role FROM case_returns WHERE case_id = 'c1'`).get() as { role: string };
assert(role.role === 'unassigned', `existing return role is ${role.role}`);
db.close();

console.log(`google large checks passed (${names.length} folders, pdf ${PDF_SIZE}, zip ${ZIP_SIZE})`);
