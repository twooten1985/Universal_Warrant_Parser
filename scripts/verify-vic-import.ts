/**
 * VIC import tokenizer.
 * A 32-character slice of a SHA-1 or SHA-256 must not become an MD5,
 * a hash split across a 25 MB-style chunk boundary is counted once,
 * and media matching uses MD5, SHA-1, and SHA-256.
 */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { fileMatchesHashList } from '../src/lib/mediaBrowser';
import { insertForensicHashes, migrate } from '../src/lib/caseDatabase';
import { formatHashImportSummary, scanHashFile } from '../src/lib/hashSets';

function hexOf(n: number, length: number): string {
  let out = '';
  let value = n;
  while (out.length < length) {
    out += value.toString(16).padStart(8, '0');
    value += 1;
  }
  return out.slice(0, length);
}

function legacyMd5Slices(text: string): string[] {
  return text.match(/[a-fA-F0-9]{32}/g) || [];
}

const md5 = hexOf(1, 32);
const sha1 = hexOf(2, 40).toUpperCase();
const sha256 = hexOf(3, 64);
const lines = [
  md5,
  sha1,
  sha256,
  md5,
  'not-a-hash',
  '',
  `file,${sha256},notes`,
  'zzzz',
];
const corpus = lines.join('\n') + '\n';
const whole = scanHashFile(corpus, 1024 * 1024, 100);
assert.equal(whole.linesRead, lines.length);
assert.equal(whole.md5, 1);
assert.equal(whole.sha1, 1);
assert.equal(whole.sha256, 1);
assert.equal(whole.duplicates, 2);
assert.equal(whole.skippedLines, 3);
assert.deepEqual(whole.unique.sort(), [md5, sha1.toLowerCase(), sha256].sort());
assert.ok(!whole.unique.some(hash => hash.length === 32 && hash !== md5));

const chopped = legacyMd5Slices(corpus);
assert.ok(chopped.length > whole.md5 + whole.sha1 + whole.sha256, 'the old 32-character regex still over-counts this fixture');
assert.equal(legacyMd5Slices(sha256).length, 2);
assert.equal(legacyMd5Slices(sha1).length, 1);

const onlyLong = `${sha1}\n${sha256}\n`;
const longScan = scanHashFile(onlyLong, 1024, 100);
assert.equal(longScan.md5, 0);
assert.equal(longScan.sha1, 1);
assert.equal(longScan.sha256, 1);
assert.equal(longScan.duplicates, 0);
assert.equal(longScan.skippedLines, 0);

// SHA-256 begins 8 bytes before a 40-byte cut, so the next window starts on a 32-hex tail.
const splitSha = hexOf(9, 64);
const prefix = 'zzzzzzzz';
const after = `\n${md5}\nnot a hash\n${md5}\n${'pad line\n'.repeat(30)}`;
const splitText = prefix + splitSha + after;
assert.ok(splitText.length > 40 + 70);
const splitAt = 40;
assert.equal(/[a-fA-F0-9]/.test(splitText.charAt(splitAt - 1)), true);
assert.equal(splitText.slice(splitAt, splitAt + 32), splitSha.slice(splitAt - prefix.length, splitAt - prefix.length + 32));
const chunked = scanHashFile(splitText, 40, 70);
const oneRead = scanHashFile(splitText, splitText.length + 10, 70);
assert.equal(chunked.md5, 1);
assert.equal(chunked.sha1, 0);
assert.equal(chunked.sha256, 1);
assert.equal(chunked.duplicates, 1);
assert.equal(chunked.linesRead, oneRead.linesRead);
assert.equal(chunked.skippedLines, oneRead.skippedLines);
assert.deepEqual(chunked.unique.sort(), oneRead.unique.sort());
assert.ok(chunked.unique.includes(splitSha));
assert.ok(!chunked.unique.includes(splitSha.slice(0, 32)));
assert.ok(!chunked.unique.includes(splitSha.slice(32)));

// A hash that sits entirely in the overlap is kept once.
const overlapSha = hexOf(80, 64);
const overlapText = `${'a'.repeat(32)}\n${' '.repeat(20)}${overlapSha}\n${'tail\n'.repeat(40)}`;
const overlapScan = scanHashFile(overlapText, 40, 80);
const overlapOnce = scanHashFile(overlapText, overlapText.length + 5, 80);
assert.equal(overlapScan.sha256, 1);
assert.equal(overlapScan.duplicates, 0);
assert.deepEqual(overlapScan.unique.sort(), overlapOnce.unique.sort());
assert.equal(overlapScan.linesRead, overlapOnce.linesRead);

const nineHundred: string[] = [];
for (let i = 0; i < 300; i++) nineHundred.push(hexOf(1000 + i, 32));
for (let i = 0; i < 300; i++) nineHundred.push(hexOf(2000 + i, 40));
for (let i = 0; i < 300; i++) nineHundred.push(hexOf(3000 + i, 64));
const nineText = nineHundred.join('\n') + '\n';
const nine = scanHashFile(nineText, 64, 70);
assert.equal(nine.linesRead, 900);
assert.equal(nine.md5, 300);
assert.equal(nine.sha1, 300);
assert.equal(nine.sha256, 300);
assert.equal(nine.duplicates, 0);
assert.equal(nine.skippedLines, 0);
assert.equal(nine.unique.length, 900);
assert.ok(legacyMd5Slices(nineText).length > 900);

const summary = formatHashImportSummary(nine, 395, 505);
assert.match(summary, /Lines read: 900/);
assert.match(summary, /MD5: 300/);
assert.match(summary, /SHA-1: 300/);
assert.match(summary, /SHA-256: 300/);
assert.match(summary, /Newly added: 395/);
assert.match(summary, /Already in the database: 505/);

const fileSha1 = hexOf(50, 40);
const fileSha256 = hexOf(51, 64);
assert.equal(fileMatchesHashList({ sha1: fileSha1 }, new Set([fileSha1])), true);
assert.equal(fileMatchesHashList({ sha256: fileSha256 }, new Set([fileSha256])), true);
assert.equal(fileMatchesHashList({ md5: md5 }, new Set([fileSha1, fileSha256])), false);
assert.equal(fileMatchesHashList({ sha1: fileSha1 }, new Set([fileSha1.slice(0, 32)])), false);
assert.equal(fileMatchesHashList({ sha256: fileSha256 }, new Set([fileSha256.slice(0, 32), fileSha256.slice(32)])), false);
assert.equal(fileMatchesHashList({ md5, sha1: fileSha1, sha256: fileSha256 }, new Set([fileSha256])), true);

const db = new Database(':memory:');
migrate(db);
const firstSave = insertForensicHashes(db, [md5, sha1, sha256, md5, 'not-a-hash', 'abc']);
assert.equal(firstSave.added, 3);
assert.equal(firstSave.alreadyPresent, 1);
const secondSave = insertForensicHashes(db, [md5, fileSha1, fileSha256]);
assert.equal(secondSave.added, 2);
assert.equal(secondSave.alreadyPresent, 1);
const stored = db.prepare('SELECT md5 FROM forensic_hashes ORDER BY md5').all() as Array<{ md5: string }>;
assert.equal(stored.length, 5);
assert.ok(stored.some(row => row.md5 === sha256));
assert.ok(!stored.some(row => row.md5 === sha256.slice(0, 32)));
db.close();

console.log('VIC import tokenizer checks passed');
