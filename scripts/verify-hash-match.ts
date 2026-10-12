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
import { hashHitMap } from '../src/lib/hashSets';
import { hitsForHashes } from '../src/components/HashMatchBadges';
import { countMediaKinds, fileMatchesHashList } from '../src/lib/mediaBrowser';
import { matchedDigestFields, mediaDigestReport } from '../src/lib/hashMatchReport';
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

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('verify-hash-match: ok');
