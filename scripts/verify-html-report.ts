/**
 * HTML report is written to a folder. Media stays in files/ and is not inlined.
 * Synthetic files only.
 * Run: npx tsx scripts/verify-html-report.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeHtmlReportFolder } from '../src/lib/htmlReportDisk';
import type { ForensicEvent, UploadedFile } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07,
  0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f,
  0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c,
  0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d,
  0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xd9,
]);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-html-report-'));
const evidence = path.join(root, 'evidence');
const dest = path.join(root, 'CASE_synthetic_report');
fs.mkdirSync(evidence, { recursive: true });

const providers = ['dropbox', 'google', 'snapchat', 'apple'] as const;
const files: UploadedFile[] = [];
const events: ForensicEvent[] = [];
for (let i = 0; i < 40; i++) {
  const provider = providers[i % providers.length];
  const name = `photo-${provider}-${i}.jpg`;
  const relativePath = `${provider}/Camera/photo-${i}.jpg`;
  const sourcePath = path.join(evidence, name);
  fs.writeFileSync(sourcePath, jpeg);
  files.push({
    name,
    relativePath,
    content: '',
    size: jpeg.length,
    isMedia: true,
    mediaType: 'image',
    provider,
    sourcePath,
    sha256: 'abc123synthetic',
  });
  events.push({
    id: `evt-${provider}-${i}`,
    timestamp: '2026-09-05 17:32:02 UTC',
    category: i % 5 === 0 ? 'message' : 'file',
    sender: `Synthetic ${provider}`,
    content: `Record ${i} for ${provider}. See https://example.test/synthetic`,
    sourceFile: name,
    details: { provider, resolvedMediaName: name },
  });
}

const result = await writeHtmlReportFolder({
  destDir: dest,
  report: {
    caseId: 'SYNTH-HTML',
    agency: 'Example Agency',
    itemNumber: '1',
    examiner: 'Examiner',
    subject: 'Synthetic Subject',
    providerName: 'Mixed',
    notes: 'Synthetic report. Not case data.',
    logoDataUrl: '',
    generatedAtIso: '2026-09-05T17:32:02.000Z',
    exhibitsOnly: false,
    blurImages: false,
    timeZone: 'UTC',
    redactIpAddresses: false,
    redactPii: false,
    includeAccount: true,
    includeMessages: true,
    includeTimeline: true,
    includeMedia: true,
    includeEntities: false,
    includeLocations: false,
    includeSources: true,
    embedMedia: false,
    events,
    files,
    tags: {},
    accounts: [],
    locations: [],
    entities: [],
  },
});

const html = fs.readFileSync(result.htmlPath, 'utf8');
assert(fs.existsSync(result.htmlPath), 'report.html was written');
assert(!html.includes('data:image'), 'media bytes are not inlined as data URLs');
assert(html.includes('files/'), 'the HTML points at the media folder');
assert(html.includes('https://example.test/synthetic'), 'an external URL is in the report');
assert(!/<html class="blur"/.test(html) && !/<html class="blur"/.test(html), 'blur is off');
assert(!html.startsWith('<html class="blur"') && !html.includes('<html class="blur"'), 'blur class is not the default');
const copied = fs.readdirSync(result.mediaDir, { recursive: true }).map(String);
const jpegCopy = copied.find(name => name.endsWith('.jpg'));
assert(jpegCopy, 'a media file was copied into the files folder');
const sample = fs.readFileSync(path.join(result.mediaDir, jpegCopy!));
assert(sample[0] === 0xff && sample[1] === 0xd8, 'the copied media is the original JPEG');
assert(result.copied === 40, `copied ${result.copied} files, expected 40`);
assert(html.includes(jpegCopy!.replace(/\\/g, '/').split('/').pop() || 'photo'), 'the HTML names a copied picture');
console.log('html report checks passed');
