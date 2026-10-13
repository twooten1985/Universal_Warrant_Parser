/**
 * Named hash sets must match MD5, SHA-1, and SHA-256 computed from file bytes,
 * including a file over 15 MB and a file that only lived inside a nested zip.
 * Run: npx tsx scripts/verify-hash-match.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { addHashSetEntries, createHashSet, hashInventory, insertForensicHashes, matchHashSets, migrate } from '../src/lib/caseDatabase';
import { hashHitMap, hashesFromPlainChunk, hashesFromTabularChunk, normalizeHash, sniffTabular } from '../src/lib/hashSets';
import { hitsForHashes } from '../src/components/HashMatchBadges';
import { countMediaKinds, fileMatchesHashList } from '../src/lib/mediaBrowser';
import { computedHashCsv, matchedDigestFields, mediaDigestReport, missingHashCsv } from '../src/lib/hashMatchReport';
import { inventoryBytes, listReturnFiles } from '../src/lib/ingestReturn';
import { flattenZip } from '../src/lib/nestedZip';
import { hashBuffer, hashFileStream } from '../src/lib/streamHash';
import type { UploadedFile } from '../src/types';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-hash-match-'));
const photo = Buffer.from('nested-photo-bytes');
const inner = new JSZip();
inner.file('photo.jpg', photo);
const innerBytes = await inner.generateAsync({ type: 'uint8array' });
const outer = new JSZip();
outer.file('returns/inner.zip', innerBytes);
outer.file('note.txt', 'not media');
const flat = await flattenZip(await outer.generateAsync({ type: 'uint8array' }));
const nested = flat.find(item => item.path.endsWith('photo.jpg'));
assert.ok(nested, 'media inside a nested zip is extracted');
const nestedDigests = hashBuffer(nested.bytes);
assert.deepEqual(nestedDigests, hashBuffer(photo));

const largePath = path.join(dir, 'clip.mp4');
fs.writeFileSync(largePath, Buffer.alloc(15 * 1024 * 1024 + 128, 9));
const largeDigests = await hashFileStream(largePath);
const metadataMd5 = 'ab'.repeat(16);
assert.notEqual(metadataMd5, largeDigests.md5);

const dbPath = path.join(dir, 'hashes.sqlite');
const db = new Database(dbPath);
migrate(db);
const setId = createHashSet(db, 'Agency notable', 'notable');
const stored = addHashSetEntries(db, setId, [
  largeDigests.md5.toUpperCase(),
  `  ${largeDigests.sha1}  `,
  largeDigests.sha256,
  nestedDigests.md5,
  nestedDigests.sha1,
  nestedDigests.sha256,
]);
assert.equal(stored, 6);

const inventory = hashInventory(db);
assert.equal(inventory.sets.length, 1);
assert.equal(inventory.sets[0].name, 'Agency notable');
assert.equal(inventory.sets[0].md5, 2);
assert.equal(inventory.sets[0].sha1, 2);
assert.equal(inventory.sets[0].sha256, 2);
assert.equal(inventory.sets[0].total, 6);

const matched = matchHashSets(db, [
  largeDigests.md5,
  largeDigests.sha1,
  largeDigests.sha256,
  nestedDigests.sha256,
  metadataMd5,
]);
assert.equal(matched.length, 4);
assert.ok(matched.every(row => row.name === 'Agency notable'));
assert.ok(!matched.some(row => row.hash === metadataMd5));

const hits = hashHitMap(matched.map(row => ({ ...row, hash: ` ${row.hash.toUpperCase()} ` })));
const largeFile: UploadedFile = {
  name: 'clip.mp4',
  content: '',
  size: fs.statSync(largePath).size,
  isMedia: true,
  mediaType: 'video',
  md5: largeDigests.md5,
  sha1: largeDigests.sha1,
  sha256: largeDigests.sha256,
};
const beforeBytes: UploadedFile = { ...largeFile, md5: metadataMd5, sha1: undefined, sha256: undefined };
assert.equal(fileMatchesHashList(beforeBytes, new Set(), new Set([largeDigests.sha256])), false);
assert.equal(fileMatchesHashList(largeFile, new Set(), new Set([largeDigests.sha256])), true);

const badge = hitsForHashes([largeDigests.sha256], new Set(), hits);
assert.equal(badge.vic, false);
assert.equal(badge.hits.length, 1);
assert.equal(badge.hits[0].name, 'Agency notable');

const flags = matchedDigestFields(largeFile, new Set(), hits);
assert.deepEqual(flags, { md5: true, sha1: true, sha256: true });
const metadataFlags = matchedDigestFields(beforeBytes, new Set(), hits);
assert.deepEqual(metadataFlags, { md5: false, sha1: false, sha256: false });

insertForensicHashes(db, [nestedDigests.md5]);
const vic = new Set([nestedDigests.md5]);
const nestedFile: UploadedFile = {
  name: 'photo.jpg',
  content: '',
  size: photo.length,
  isMedia: true,
  mediaType: 'image',
  relativePath: nested.path,
  md5: nestedDigests.md5,
  sha1: nestedDigests.sha1,
  sha256: nestedDigests.sha256,
};
const known = new Set<string>();
hits.forEach((_list, hash) => known.add(hash));
known.add(nestedDigests.sha256);
const counts = countMediaKinds([largeFile, nestedFile, beforeBytes], vic, 30, known);
assert.equal(counts.all, 3);
assert.equal(counts.vic, 2);

const report = mediaDigestReport(
  [
    largeFile,
    nestedFile,
    { ...beforeBytes, digestNote: 'Hashing clip-meta.mp4 timed out after 120000 ms' },
  ],
  vic,
  hits
);
assert.equal(report.mediaFiles, 3);
assert.equal(report.computed, 2);
assert.equal(report.missing, 1);
assert.match(report.missingReasons[0].reason, /timed out/);
assert.equal(report.namedSetMatched, 2);
assert.equal(report.vicMatched, 1);
assert.ok(report.matchedBySet.some(row => row.name === 'Agency notable' && row.count === 2));

const loaded = hashInventory(db);
assert.equal(loaded.vic.total, 1);
assert.equal(loaded.vic.md5, 1);

const stale = { ...largeFile, md5: metadataMd5, sha1: largeDigests.sha1, sha256: largeDigests.sha256, digestFromBytes: false as const };
assert.equal(fileMatchesHashList(stale, new Set([metadataMd5]), new Set([largeDigests.sha256])), false);
const staleReport = mediaDigestReport([stale]);
assert.equal(staleReport.hashedFiles, 0);
assert.match(staleReport.missingReasons[0].reason, /metadata/);

const hugePath = path.join(dir, 'over-100mb.mp4');
fs.writeFileSync(hugePath, Buffer.alloc(100 * 1024 * 1024 + 64, 4));
assert.ok(fs.statSync(hugePath).size > 100 * 1024 * 1024);
const hugeDigests = await hashFileStream(hugePath);
assert.equal(hugeDigests.md5.length, 32);
assert.equal(hugeDigests.sha1.length, 40);
assert.equal(hugeDigests.sha256.length, 64);

const extensionless = inventoryBytes('noext', 'folder/noext', Buffer.from('extensionless-binary\0hidden'));
assert.equal(extensionless.size, Buffer.from('extensionless-binary\0hidden').length);
assert.equal(extensionless.text, null);
const extensionlessDigests = hashBuffer(extensionless.bytes);

const notes = inventoryBytes('notes.dat', 'notes.dat', Buffer.from('case notes that are not media'));
assert.equal(notes.isMedia, false);
assert.equal(notes.size, Buffer.from('case notes that are not media').length);
const notesDigests = hashBuffer(notes.bytes);

const heic = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypheic'),
  Buffer.from('original-heic-bytes-not-a-jpeg-preview'),
]);
const preview = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const heicFile = inventoryBytes('photo.heic', 'album/photo.heic', heic);
assert.equal(heicFile.isMedia, true);
assert.equal(heicFile.mediaType, 'image');
assert.equal(heicFile.size, heic.length);
assert.equal(Buffer.compare(Buffer.from(heicFile.bytes), heic), 0);
const heicDigests = hashBuffer(heicFile.bytes);
const previewDigests = hashBuffer(preview);
assert.notEqual(heicDigests.md5, previewDigests.md5);
const sniffed = inventoryBytes('bare', 'bare', heic);
assert.equal(sniffed.mediaType, 'image');
assert.equal(hashBuffer(sniffed.bytes).md5, heicDigests.md5);

const deepPhoto = Buffer.from('three-level-photo-bytes');
const level3 = new JSZip();
level3.file('deep.jpg', deepPhoto);
level3.file('readme.dat', Buffer.from('nested non-media'));
const level2 = new JSZip();
level2.file('mid/inner.zip', await level3.generateAsync({ type: 'uint8array' }));
const level1 = new JSZip();
level1.file('outer/level2.zip', await level2.generateAsync({ type: 'uint8array' }));
const deepFlat = await listReturnFiles(await level1.generateAsync({ type: 'uint8array' }));
const deep = deepFlat.find(item => item.relativePath.endsWith('deep.jpg'));
const deepNotes = deepFlat.find(item => item.relativePath.endsWith('readme.dat'));
assert.ok(deep, 'a photo three zips down is kept');
assert.ok(deepNotes && !deepNotes.isMedia, 'a non-media file inside the nested zip is kept');
assert.ok(deepFlat.some(item => item.relativePath.endsWith('level2.zip')), 'the nested zip itself is kept');
assert.ok(deepFlat.some(item => item.relativePath.endsWith('inner.zip')), 'the innermost zip itself is kept');
assert.equal(Buffer.compare(Buffer.from(deep.bytes), deepPhoto), 0);
const deepDigests = hashBuffer(deep.bytes);
assert.deepEqual(deepDigests, hashBuffer(deepPhoto));

const quotedMd5 = 'ab'.repeat(16);
const quotedSha1 = 'cd'.repeat(20);
const quotedSha256 = 'ef'.repeat(32);
assert.equal(normalizeHash(`\uFEFF"${quotedMd5.toUpperCase()}"\r`), quotedMd5);
assert.equal(normalizeHash(`'${quotedSha1}'\r\n`), quotedSha1);
const plain = hashesFromPlainChunk(`\uFEFF"${quotedMd5.toUpperCase()}"\r\n'${quotedSha1}'\r\n${quotedSha256}\r\n`, '');
assert.deepEqual(plain.hashes, [quotedMd5, quotedSha1, quotedSha256]);
const tableHead = sniffTabular(`\uFEFFmd5,sha1\r\n${quotedMd5},${quotedSha1}\r\n`);
assert.ok(tableHead);
assert.deepEqual(tableHead.hashColumns, [0, 1]);
const table = hashesFromTabularChunk(`\uFEFF"${quotedMd5.toUpperCase()}",${quotedSha1}\r\n`, ',', tableHead.hashColumns, '');
assert.deepEqual(table.hashes, [quotedMd5, quotedSha1]);

const covered = mediaDigestReport(
  [
    { name: 'over-100mb.mp4', isMedia: true, relativePath: 'over-100mb.mp4', ...hugeDigests, digestFromBytes: true },
    { name: 'noext', isMedia: false, relativePath: extensionless.relativePath, ...extensionlessDigests, digestFromBytes: true },
    { name: 'notes.dat', isMedia: false, relativePath: notes.relativePath, ...notesDigests, digestFromBytes: true },
    { name: 'photo.heic', isMedia: true, relativePath: heicFile.relativePath, ...heicDigests, digestFromBytes: true },
    { name: 'deep.jpg', isMedia: true, relativePath: deep.relativePath, ...deepDigests, digestFromBytes: true },
  ],
  null,
  null,
  [heicDigests.md5, hugeDigests.sha256, extensionlessDigests.md5, notesDigests.sha1, deepDigests.sha256, previewDigests.md5]
);
assert.equal(covered.totalFiles, 5);
assert.equal(covered.hashedFiles, 5);
assert.equal(covered.notHashed, 0);
assert.equal(covered.uniqueLoaded, 6);
assert.equal(covered.uniqueMatched, 5);
assert.deepEqual(covered.notFound, [previewDigests.md5]);
assert.equal(fileMatchesHashList(
  { md5: previewDigests.md5, digestFromBytes: false },
  new Set([previewDigests.md5])
), false);
assert.match(computedHashCsv(covered.computedHashes), /over-100mb\.mp4/);
assert.match(missingHashCsv(covered.notFound), new RegExp(previewDigests.md5));

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('verify-hash-match: ok');
