/**
 * Forensic analysis must finish even when a file throws or never resolves,
 * and a file larger than 15 MB still gets MD5, SHA-1, and SHA-256.
 * Run: npx tsx scripts/verify-media-analysis.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashFileStream } from '../src/lib/streamHash';
import { mediaNeedsAnalysis, runMediaAnalysis } from '../src/lib/mediaAnalysis';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-analysis-'));
const smallPath = path.join(dir, 'small.bin');
const largePath = path.join(dir, 'large.bin');
fs.writeFileSync(smallPath, Buffer.from('forensic-bytes'));
fs.writeFileSync(largePath, Buffer.alloc(15 * 1024 * 1024 + 64, 7));

const smallDigests = await hashFileStream(smallPath);
const largeDigests = await hashFileStream(largePath);
assert.equal(largeDigests.sha256.length, 64);
assert.equal(largeDigests.md5.length, 32);
assert.equal(largeDigests.sha1.length, 40);
assert.ok(fs.statSync(largePath).size > 15 * 1024 * 1024);

assert.equal(mediaNeedsAnalysis({ name: 'large.bin', isMedia: true, size: fs.statSync(largePath).size, sourcePath: largePath }), true);
assert.equal(mediaNeedsAnalysis({
  name: 'done.jpg',
  isMedia: true,
  sourcePath: smallPath,
  md5: smallDigests.md5,
  sha1: smallDigests.sha1,
  sha256: smallDigests.sha256,
  forensicsProcessed: true,
}), false);

const progress: Array<[number, number]> = [];
const started = Date.now();
const result = await runMediaAnalysis(
  [
    { name: 'small.bin', isMedia: true, mediaType: 'image', sourcePath: smallPath, size: fs.statSync(smallPath).size },
    { name: 'large.bin', isMedia: true, mediaType: 'video', sourcePath: largePath, size: fs.statSync(largePath).size },
    { name: 'throws.heic', isMedia: true, mediaType: 'image', sourcePath: smallPath },
    { name: 'nobody.png', isMedia: true, mediaType: 'image' },
  ],
  {
    hashTimeoutMs: 200,
    skinTimeoutMs: 50,
    locateTimeoutMs: 40,
    isScreenshot: (file) => file.name.includes('screen'),
    digest: async (file) => {
      if (file.name === 'throws.heic') throw new Error('HEIC decoder exploded');
      if (file.name === 'large.bin') return hashFileStream(largePath);
      if (file.name === 'small.bin') return hashFileStream(smallPath);
      return { missing: true };
    },
    locate: async (file) => {
      if (file.name === 'large.bin') return new Promise(() => {});
      return {};
    },
    skinTone: async (file) => {
      if (file.name === 'small.bin') return new Promise(() => {});
      return 0;
    },
    onFileDone: (done, total) => progress.push([done, total]),
  }
);

assert.ok(Date.now() - started < 5000, 'skin and metadata timeouts let the run finish');
assert.equal(result.outcomes.length, 4);
assert.deepEqual(progress, [[1, 4], [2, 4], [3, 4], [4, 4]]);
assert.equal(result.summary.analyzed, 2);
assert.equal(result.summary.failed, 1);
assert.equal(result.summary.skipped, 1);
assert.equal(result.summary.analyzed + result.summary.skipped + result.summary.failed, 4);

const small = result.outcomes.find(item => item.name === 'small.bin');
const large = result.outcomes.find(item => item.name === 'large.bin');
assert.equal(small?.status, 'analyzed');
assert.equal(small?.md5, smallDigests.md5);
assert.equal(small?.sha1, smallDigests.sha1);
assert.equal(small?.sha256, smallDigests.sha256);
assert.match(small?.reason || '', /Nudity check failed/);
assert.equal(large?.status, 'analyzed');
assert.equal(large?.sha256, largeDigests.sha256);
assert.equal(large?.digestStatus, 'computed');
assert.match(large?.reason || '', /Metadata read failed/);

const thrown = result.outcomes.find(item => item.name === 'throws.heic');
assert.equal(thrown?.status, 'failed');
assert.match(thrown?.reason || '', /HEIC decoder exploded/);
assert.equal(thrown?.digestStatus, 'missing');
assert.equal(mediaNeedsAnalysis({ name: 'throws.heic', isMedia: true, sourcePath: smallPath, digestStatus: 'missing' }), false);

const controller = new AbortController();
const hungPromise = runMediaAnalysis(
  [{ name: 'hangs.mp4', isMedia: true, mediaType: 'video', sourcePath: largePath }],
  {
    signal: controller.signal,
    digest: () => new Promise(() => {}),
    skinTone: async () => 0,
  }
);
setTimeout(() => controller.abort(), 40);
const hung = await hungPromise;
assert.equal(hung.outcomes.length, 0, 'cancelling a hash does not record a permanent miss');
assert.equal(mediaNeedsAnalysis({ name: 'hangs.mp4', isMedia: true, sourcePath: largePath }), true);

const skipped = result.outcomes.find(item => item.name === 'nobody.png');
assert.equal(skipped?.status, 'skipped');
assert.match(skipped?.reason || '', /No file bytes/);

fs.rmSync(dir, { recursive: true, force: true });
console.log('verify-media-analysis: ok');
