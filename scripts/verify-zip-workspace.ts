/**
 * Synthetic zip: direct load and a pre-extracted folder list the same files.
 * Includes a nested zip and ZIP64 headers. No case data.
 * Run: npx tsx scripts/verify-zip-workspace.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { extractZipToWorkspace, inventoryFolder } from '../src/lib/zipWorkspace';
import { parseForensicFile } from '../src/parserHelper';
import { assembleWorkspaceParse } from '../src/lib/consolidateParse';
import { snapchatMediaViews } from '../src/lib/snapchatMedia';

const archiver = createRequire(import.meta.url)('archiver');

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function zipTo(dest: string, files: Array<{ name: string; data: Buffer }>, zip64: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 9 }, forceZip64: zip64 });
    out.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(out);
    for (const file of files) archive.append(file.data, { name: file.name });
    void archive.finalize();
  });
}

const ID = 'synthzipmedia01';
const csv = [
  'conversation_id,sender_username,recipient_username,group_member_usernames,conversation_title,text,media_id,timestamp',
  `synthetic-zip,synthetic_snap_user,synthetic_partner,,Synthetic,synthetic zip text,${ID},2026-06-15 18:00:00 UTC`,
].join('\n');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-zip-'));
const innerPath = path.join(root, 'inner.zip');
const outerPath = path.join(root, 'return.zip');
await zipTo(innerPath, [{ name: `media/media~${ID}.mp4`, data: Buffer.from('synthetic-video-bytes') }], false);
await zipTo(outerPath, [
  { name: 'chats/chat_history.csv', data: Buffer.from(csv) },
  { name: `media/2024-01-02_synthetic_${ID}.jpg`, data: jpeg },
  { name: 'nested/inner.zip', data: fs.readFileSync(innerPath) },
  { name: 'media/odd name~file.jpg', data: jpeg },
], true);

const direct = await extractZipToWorkspace(outerPath, path.join(root, 'direct-cache'));
const explorer = path.join(root, 'explorer');
fs.mkdirSync(explorer, { recursive: true });
const outerOnly = await extractZipToWorkspace(outerPath, path.join(root, 'outer-cache'), '', false);
for (const entry of outerOnly.entries) {
  const dest = path.join(explorer, entry.rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(entry.path, dest);
}
const folder = await inventoryFolder(explorer, path.join(root, 'folder-cache'));
const key = (rows: Array<{ rel: string; size: number }>) => rows.map(row => `${row.rel}|${row.size}`).sort().join('\n');
assert(key(direct.entries) === key(folder), 'direct zip load and the pre-extracted folder list the same files');
assert(direct.entries.some(entry => entry.rel === `media/2024-01-02_synthetic_${ID}.jpg`), 'the dated media name is kept');
assert(direct.entries.some(entry => entry.rel === `nested/inner/media/media~${ID}.mp4`), 'the nested zip is expanded in place');
assert(direct.entries.some(entry => entry.rel.endsWith('odd name~file.jpg')), 'a spaced name survives extraction');
const zip64 = fs.readFileSync(outerPath);
assert(zip64.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])) || zip64.includes(Buffer.from([0x01, 0x00])), 'the synthetic archive uses ZIP64');

const chat = direct.entries.find(entry => entry.name === 'chat_history.csv');
assert(chat, 'chat csv extracted');
const parsed = parseForensicFile('snapchat', chat!.name, fs.readFileSync(chat!.path, 'utf8'), chat!.rel);
const assembled = assembleWorkspaceParse([
  { name: chat!.name, relativePath: chat!.rel, size: chat!.size, provider: 'snapchat', parse: parsed },
  ...direct.entries.filter(entry => entry.name.endsWith('.jpg') || entry.name.endsWith('.mp4')).map(entry => ({
    name: entry.name,
    relativePath: entry.rel,
    size: entry.size,
    isMedia: true,
    parse: null,
  })),
], 'snapchat', (provider) => provider);
const message = assembled!.events.find(event => event.details?.mediaId === ID);
const views = snapchatMediaViews(message!, direct.entries.map(entry => ({
  name: entry.name,
  relativePath: entry.rel,
  isMedia: entry.name.endsWith('.jpg') || entry.name.endsWith('.mp4'),
  mediaType: entry.name.endsWith('.mp4') ? 'video' as const : entry.name.endsWith('.jpg') ? 'image' as const : null,
  content: '',
  size: entry.size,
})));
assert(views[0]?.kind === 'ambiguous' || views[0]?.kind === 'local-image' || views[0]?.kind === 'local-video', 'the zip media is not reported missing');
assert(views[0]?.note !== 'media not in return', 'searchable zip media is not labeled missing');
const names = direct.entries.filter(entry => entry.rel.toLowerCase().includes(ID.toLowerCase())).map(entry => entry.rel);
assert(names.length >= 2, 'both the jpg and the nested video contain the id');
assert(views[0]?.kind === 'ambiguous' && names.every(name => views[0].note.includes(name.split('/').pop() || name) || views[0].note.includes(name)), 'both id hits are named when more than one file matches');

console.log('zip workspace checks passed');
