/**
 * PDF report link annotations and embedded JPEG thumbnails.
 * Synthetic files only.
 * Run: npx tsx scripts/verify-pdf-report.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { writePdfReport } from '../src/lib/pdfReport';
import type { ForensicEvent, UploadedFile } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-pdf-report-'));
const photo = path.join(root, 'photo.jpg');
const made = spawnSync(ffmpegPath || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x24', '-frames:v', '1', photo], { stdio: 'ignore' });
assert(made.status === 0 && fs.existsSync(photo), 'synthetic JPEG could not be created');
const dest = path.join(root, 'report.pdf');
const file: UploadedFile = {
  name: 'photo.jpg',
  relativePath: 'dropbox/Camera/photo.jpg',
  content: '',
  size: fs.statSync(photo).size,
  isMedia: true,
  mediaType: 'image',
  provider: 'dropbox',
  sourcePath: photo,
  sha256: 'synthetic-sha',
};
const events: ForensicEvent[] = [
  {
    id: 'msg-1',
    timestamp: '2026-09-05 17:32:02 UTC',
    category: 'message',
    sender: 'Synthetic Dropbox',
    content: 'See https://example.test/synthetic and the photo.',
    sourceFile: 'photo.jpg',
    details: { resolvedMediaName: 'photo.jpg' },
  },
  {
    id: 'file-1',
    timestamp: '2026-09-05 17:40:00 UTC',
    category: 'file',
    sender: 'Synthetic Google',
    content: 'A Google file record.',
    sourceFile: 'notes.txt',
  },
];

const written = await writePdfReport({
  destPath: dest,
  report: {
    caseId: 'SYNTH-PDF',
    agency: 'Example Agency',
    itemNumber: '1',
    examiner: 'Examiner',
    subject: 'Synthetic Subject',
    providerName: 'Mixed',
    notes: '',
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
    includeLocations: true,
    embedMedia: false,
    events,
    files: [file],
    tags: { 'msg-1': { tagged: true, labels: ['tag-review'] } },
    tagDefinitions: [{ id: 'tag-review', name: 'Review', color: '#b45309' }],
    accounts: [{ provider: 'dropbox', userId: '100000222333', displayName: 'Synthetic User' }],
    locations: [{ lat: 37.0, lng: -122.0, label: 'Synthetic point', cardId: '', capturedAt: '', tagged: true }],
    entities: [],
  },
});

const pdf = fs.readFileSync(written.pdfPath);
const latin = pdf.toString('latin1');
assert(pdf.subarray(0, 5).toString() === '%PDF-', 'output is a PDF');
assert(/\/Subtype\s*\/Link/.test(latin), 'the PDF contains link annotations');
assert(/\/URI/.test(latin) && latin.includes('example.test'), 'an external URL is a URI link');
assert(/\/Dest/.test(latin) || /\/GoTo/.test(latin) || /\/A\s*<</.test(latin), 'internal links use PDF destinations');
assert(latin.includes('DCTDecode') || pdf.includes(Buffer.from([0xff, 0xd8])), 'a JPEG thumbnail is embedded');
assert(written.images >= 1, `expected an embedded image, images=${written.images} placeholders=${written.placeholders}`);
console.log('pdf report checks passed');
