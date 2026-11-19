/**
 * Synthetic Google warrant return. No real names, emails, addresses, or case data.
 * Documentation ranges only (203.0.113.0/24, 198.51.100.0/24, 2001:db8::/32).
 *
 * Default size is a few dozen megabytes: thousands of category folders, nested zips,
 * ZIP64, a long path, UTF-16 HTML/CSV, duplicate names, and a file that is not a zip.
 * Pass gigabytes > 0 to also write a streamed binary of that many gibibytes.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

export interface SyntheticGoogleOptions {
  /** No Data category folders. Default 1200. */
  noDataFolders?: number;
  /** Extra gibibytes of binary inside the return. Default 0. */
  gigabytes?: number;
}

export interface SyntheticGooglePaths {
  folder: string;
  zipPath: string;
  /** Relative path of the UTF-16 access-log CSV. */
  activityRel: string;
  /** Relative path of the UTF-16 subscriber HTML. */
  htmlRel: string;
  /** Relative path of a file that is named .zip but is not a zip. */
  fakeZipRel: string;
  accountEmail: string;
  gaiaId: string;
}

const EMAIL = 'synthetic.user@example.test';
const GAIA = '100000001001';

function utf16(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

function folderName(product: string, category: string, part = '001'): string {
  return `${EMAIL}.${GAIA}.${product}.${category}_${part}`;
}

function writeFile(root: string, rel: string, data: Buffer | string): void {
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
}

function htmlDoc(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Subscriber</title></head><body>
<p>Google Account Data</p>
<p>Email: ${EMAIL}</p>
<p>GAIA ID: ${GAIA}</p>
<p>Sign-up IP: 203.0.113.77</p>
<p>Created: 2020-01-15T00:00:00Z</p>
</body></html>`;
}

function activityCsv(rows: number): string {
  const lines = ['Google Account Data', 'Service: Access Log Activity', 'Time (UTC),Source IP,Product'];
  for (let i = 0; i < rows; i++) {
    const ip = i === 0 ? '198.51.100.61' : `203.0.113.${(i % 200) + 1}`;
    lines.push(`2024-06-02T09:${String(i % 60).padStart(2, '0')}:00Z,${ip},Gmail`);
  }
  return lines.join('\n');
}

function zipTo(dest: string, files: Array<{ name: string; data: Buffer }>, zip64: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 1 }, forceZip64: zip64 });
    const fail = (err: Error) => reject(err);
    out.on('error', fail);
    archive.on('error', fail);
    out.on('close', () => resolve());
    archive.pipe(out);
    for (const file of files) archive.append(file.data, { name: file.name });
    void archive.finalize();
  });
}

async function zipFolder(dest: string, folder: string, extra: Array<{ name: string; data: Buffer }>): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 1 }, forceZip64: true });
    const fail = (err: Error) => reject(err);
    out.on('error', fail);
    archive.on('error', fail);
    out.on('close', () => resolve());
    archive.pipe(out);
    archive.directory(folder, false);
    for (const file of extra) archive.append(file.data, { name: file.name });
    void archive.finalize();
  });
}

export async function writeSyntheticGoogleReturn(root: string, options: SyntheticGoogleOptions = {}): Promise<SyntheticGooglePaths> {
  const noDataFolders = options.noDataFolders ?? 1200;
  const folder = path.join(root, 'SyntheticGoogleReturn');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });

  const sub = folderName('GoogleAccount', 'SubscriberInfo');
  const htmlRel = `${sub}/SubscriberInfo.html`;
  writeFile(folder, htmlRel, utf16(htmlDoc()));

  const act = folderName('AccessLogActivity', 'Activity');
  const activityRel = `${act}/Activity.csv`;
  writeFile(folder, activityRel, utf16(activityCsv(400)));

  const photos = folderName('GooglePhotos', 'PhotoResourceLegal');
  const innerCsv = `Time,Latitude,Longitude\n2024-06-01T12:00:00Z,37.0,-122.0\n`;
  const innerPath = path.join(root, 'inner-photos.zip');
  await zipTo(innerPath, [
    { name: 'takeout/photo-note.csv', data: Buffer.from(innerCsv) },
    { name: 'takeout/photo-1.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
  ], false);
  writeFile(folder, `${photos}/photos-export.zip`, fs.readFileSync(innerPath));

  const drive = folderName('Drive', 'FileContent');
  const fakeZipRel = `${drive}/notes.zip`;
  writeFile(folder, fakeZipRel, Buffer.from('this is not a zip archive\n'));
  writeFile(folder, `${drive}/readme.txt`, Buffer.from('synthetic drive note\n'));

  const longSeg = `synthetic-long-${'p'.repeat(180)}`;
  writeFile(folder, `${drive}/${longSeg}/deep-note.txt`, Buffer.from('long path file\n'));

  const padded = Buffer.alloc(12 * 1024 * 1024, 0x20);
  const head = utf16(`${htmlDoc()}\n`);
  head.copy(padded);
  writeFile(folder, `${folderName('MyActivity', 'MyActivity')}/MyActivity.html`, padded);

  const noData = utf16('Google Account Data\nService: Synthetic\nNo Data\n');
  for (let i = 0; i < noDataFolders; i++) {
    const name = folderName('SyntheticProduct', `Category${String(i).padStart(4, '0')}`, '001');
    writeFile(folder, `${name}/NoData.txt`, noData);
  }

  const gigs = Math.max(0, options.gigabytes || 0);
  if (gigs > 0) {
    const bin = path.join(folder, drive, 'streamed-binary.bin');
    const ws = fs.createWriteStream(bin);
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    const total = gigs * 1024;
    for (let i = 0; i < total; i++) {
      if (!ws.write(chunk)) await new Promise<void>(resolve => ws.once('drain', () => resolve()));
    }
    await new Promise<void>((resolve, reject) => {
      ws.on('error', reject);
      ws.end(() => resolve());
    });
  }

  const zipPath = path.join(root, 'SyntheticGoogleReturn.zip');
  const illegal = Buffer.from('Time (UTC),Source IP\n2024-06-03T00:00:00Z,203.0.113.44\n');
  await zipFolder(zipPath, folder, [
    { name: 'illegal/report:name*.csv', data: illegal },
    { name: 'dup/same.txt', data: Buffer.from('one\n') },
    { name: 'dup/same.txt', data: Buffer.from('two\n') },
    { name: '../slip.txt', data: Buffer.from('no\n') },
  ]);

  return { folder, zipPath, activityRel, htmlRel, fakeZipRel, accountEmail: EMAIL, gaiaId: GAIA };
}
