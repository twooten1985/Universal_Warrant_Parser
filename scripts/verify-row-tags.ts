/**
 * Tag persistence and Google row identity. Synthetic data only.
 * Run: npx tsx scripts/verify-row-tags.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { evidenceTagFromRow, loadWorkspace, migrate, saveWorkspace } from '../src/lib/caseDatabase';
import { googleJsonRowKey, googleRowKey } from '../src/lib/googleRowKey';
import { countTagUse, stripTagLabel } from '../src/lib/customTags';
import { mergeEvidenceTags, readEvidenceTagExport } from '../src/lib/evidenceTags';
import { exhibitEventsFromTags } from '../src/lib/exhibits';
import { assembleCaseReport, type AssembleReportArgs } from '../src/lib/caseReportHtml';
import type { ForensicEvent } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const same = googleRowKey('case-1', 'returns/Activity.csv', 2, ['2024-05-01T15:04:05Z', '203.0.113.10']);
const slash = googleRowKey('case-1', 'returns\\Activity.csv', 2, ['2024-05-01T15:04:05Z', '203.0.113.10']);
assert(same === slash, 'row key treats slashes the same');
assert(same.startsWith('google-row:case-1:returns/Activity.csv:2:'), 'row key keeps case, path, and index');
assert(same !== googleRowKey('case-1', 'returns/Activity.csv', 3, ['2024-05-01T15:04:05Z', '203.0.113.10']), 'a different row index is a different key');
assert(same !== googleRowKey('case-1', 'returns/Activity.csv', 2, ['2024-05-01T15:04:05Z', '203.0.113.11']), 'changed cells change the hash');
assert(same !== googleRowKey('case-2', 'returns/Activity.csv', 2, ['2024-05-01T15:04:05Z', '203.0.113.10']), 'a different case is a different key');
const again = googleRowKey('case-1', 'returns/Activity.csv', 2, ['2024-05-01T15:04:05Z', '203.0.113.10']);
assert(again === same, 'the same row hashes the same way on a later import');

const jsonA = googleJsonRowKey('case-1', 'notes.json', 0, { b: '2', a: '1' });
const jsonB = googleJsonRowKey('case-1', 'notes.json', 0, { a: '1', b: '2' });
assert(jsonA === jsonB, 'json row hash ignores key order');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-tags-'));
const dbPath = path.join(dir, 'case.sqlite');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE cases (
    id TEXT PRIMARY KEY,
    case_id_code TEXT,
    investigator_name TEXT,
    suspect_name TEXT,
    active_provider TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE evidence_tags (
    case_id TEXT,
    event_id TEXT,
    tagged INTEGER,
    notes TEXT,
    PRIMARY KEY (case_id, event_id)
  );
`);
db.prepare(`INSERT INTO cases (id, case_id_code, investigator_name, suspect_name, active_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'old-case', 'C-100', 'Examiner', 'Subject', 'google', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
);
db.prepare(`INSERT INTO evidence_tags (case_id, event_id, tagged, notes) VALUES (?, ?, ?, ?)`).run('old-case', 'evt-keep', 1, 'original note');
migrate(db);
const cols = db.prepare(`PRAGMA table_info(evidence_tags)`).all() as Array<{ name: string }>;
assert(cols.some(col => col.name === 'meta_json') && cols.some(col => col.name === 'labels_json'), 'migration adds tag columns');
const legacy = loadWorkspace(db, 'old-case');
assert(legacy?.evidence_tags['evt-keep']?.tagged === true, 'old tagged flag survives migration');
assert(legacy?.evidence_tags['evt-keep']?.notes === 'original note', 'old note survives migration');
assert(!legacy?.evidence_tags['evt-keep']?.labels, 'old rows have no invented labels');

const rowKey = googleRowKey('old-case', 'returns/Activity.csv', 0, ['hello', '203.0.113.10']);
saveWorkspace(db, {
  id: 'old-case',
  case_id_code: 'C-100',
  investigator_name: 'Examiner',
  suspect_name: 'Subject',
  active_provider: 'google',
  evidence_tags: {
    'evt-keep': { tagged: true, notes: 'original note' },
    [rowKey]: {
      tagged: true,
      notes: 'saw the login',
      labels: ['review'],
      meta: { source: 'Google', kind: 'google-row', category: 'Activity', path: 'returns/Activity.csv', description: 'hello' },
    },
    'media-file-photo.jpg': { tagged: true, notes: '', labels: ['review', 'weapon'] },
  },
  tag_definitions: [
    { id: 'review', name: 'Review', color: '#1d4ed8' },
    { id: 'weapon', name: 'Weapon', color: '#b91c1c' },
  ],
  keepEvents: true,
});
const saved = loadWorkspace(db, 'old-case');
assert(saved?.evidence_tags['evt-keep']?.notes === 'original note', 'saving new tags keeps the old one');
assert(saved?.evidence_tags[rowKey]?.meta?.category === 'Activity', 'row meta round-trips');
assert(saved?.evidence_tags[rowKey]?.meta?.path === 'returns/Activity.csv', 'row path round-trips');
assert(saved?.evidence_tags[rowKey]?.labels?.join(',') === 'review', 'row labels round-trip');
assert(saved?.tag_definitions.length === 2, 'tag definitions round-trip');
assert(saved?.tag_definitions.find(def => def.id === 'weapon')?.color === '#b91c1c', 'tag color round-trips');
assert(countTagUse(saved?.evidence_tags || {}, 'review') === 2, 'usage counts every item wearing the tag');
const stripped = stripTagLabel(saved?.evidence_tags || {}, 'weapon');
assert(!stripped['media-file-photo.jpg']?.labels?.includes('weapon'), 'deleting a tag removes it from items');
assert(stripped['media-file-photo.jpg']?.tagged === true, 'deleting a tag keeps the evidence flag');
assert(stripped['media-file-photo.jpg']?.labels?.includes('review'), 'deleting one tag leaves the others');

const raw = db.prepare(`SELECT * FROM evidence_tags WHERE event_id = ?`).get(rowKey) as Record<string, unknown>;
const fromRow = evidenceTagFromRow(raw);
assert(fromRow.notes === 'saw the login' && fromRow.meta?.kind === 'google-row', 'a raw sqlite row still reads');

const orphans = exhibitEventsFromTags(saved?.evidence_tags || {}, new Set(['evt-keep']));
const google = orphans.find(event => event.id === rowKey);
assert(google?.details?.googleCategoryLabel === 'Activity', 'a tagged generic row becomes an exhibit');
assert(google?.sourceFile === 'returns/Activity.csv', 'the exhibit keeps the source file');
assert(!orphans.some(event => event.id === 'media-file-photo.jpg'), 'media keys stay on the media path');

const merged = mergeEvidenceTags(
  { 'evt-keep': { tagged: true, notes: 'original note' } },
  { 'evt-new': { tagged: true, notes: 'added', labels: ['review'] } }
);
assert(merged['evt-keep']?.notes === 'original note' && merged['evt-new']?.labels?.[0] === 'review', 'merge keeps untouched tags and incoming labels');

const bundle = readEvidenceTagExport({
  kind: 'uwrp-evidence-tags',
  version: 2,
  caseId: 'C-100',
  evidence_tags: { 'evt-keep': { tagged: true, notes: 'original note', labels: ['review'], meta: { category: 'Activity', path: 'returns/Activity.csv' } } },
  tag_definitions: [{ id: 'review', name: 'Review', color: '#1d4ed8' }],
});
assert(bundle?.evidenceTags['evt-keep']?.meta?.path === 'returns/Activity.csv', 'tag export keeps row meta');
assert(bundle?.tagDefinitions[0]?.name === 'Review', 'tag export keeps definitions');

const event: ForensicEvent = {
  id: 'evt-keep',
  timestamp: '2024-05-01T15:04:05Z',
  category: 'connection',
  sender: 'synthetic.user@example.test',
  content: 'login',
  sourceFile: 'Activity.csv',
  details: { provider: 'google', googleCategory: 'AccessLogActivity.Activity', googleProduct: 'AccessLogActivity' },
};
const args: AssembleReportArgs = {
  caseId: 'C-100',
  agency: 'Test',
  itemNumber: '1',
  examiner: 'Examiner',
  subject: 'Subject',
  providerName: 'Google',
  notes: '',
  logoDataUrl: '',
  generatedAtIso: '2024-05-01T00:00:00.000Z',
  exhibitsOnly: true,
  blurImages: false,
  timeZone: 'UTC',
  redactIpAddresses: false,
  redactPii: false,
  includeAccount: false,
  includeTimeline: true,
  includeMedia: false,
  includeEntities: false,
  includeLocations: false,
  embedMedia: false,
  events: [event, google as ForensicEvent],
  files: [],
  tags: saved?.evidence_tags || {},
  tagDefinitions: saved?.tag_definitions || [],
  accounts: [],
  locations: [],
  entities: [],
};
const html = assembleCaseReport(args).html;
assert(html.includes('Review'), 'html report names the custom tag');
assert(html.includes('#1d4ed8'), 'html report includes the tag color');
assert(html.includes('class="chip"'), 'html report renders a tag chip');
assert(html.includes('Activity'), 'html report shows the google category');
assert(html.includes('returns/Activity.csv'), 'html report shows the source path for a generic row');

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('row tags ok');
