/**
 * Stream a portable case ZIP to disk. Media is copied one file at a time.
 * Case records are written as small script chunks the viewer loads with script tags
 * (file:// cannot fetch a sibling JSON file). Nothing is built as one giant string.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Archiver } from 'archiver';
import type { CaseDb } from './caseDatabase';
import type { AccountRecord, ForensicEvent, ProviderType } from '../types';
import { portableMediaFileName, redactIp, redactPiiText } from './portableCaseGenerator';

const CHUNK_CHARS = 512 * 1024;

export interface PortableExportRequest {
  caseDbId: string;
  destPath: string;
  caseId: string;
  investigatorName: string;
  suspectName: string;
  provider: string;
  providerName: string;
  briefingText?: string;
  includeMetadata: boolean;
  includeBriefing: boolean;
  includeEvidenceTags: boolean;
  onlyTaggedExhibits: boolean;
  includeAccountInfo: boolean;
  includeMessages: boolean;
  includeIpAudit: boolean;
  includeGeoMap: boolean;
  includeFiles: boolean;
  includeAccountChanges: boolean;
  redactIpAddresses: boolean;
  redactPii: boolean;
  passcode: string;
  /** Latest tags from the open workspace. Small. Events and media bytes stay in the database and on disk. */
  evidenceTags?: Record<string, { tagged?: boolean; notes?: string }>;
}

export interface PortableJobView {
  id: string;
  phase: string;
  filesDone: number;
  filesTotal: number;
  currentFile: string;
  done: boolean;
  cancelled: boolean;
  error: string;
  destPath: string;
}

interface Job extends PortableJobView {
  abort: AbortController;
}

const jobs = new Map<string, Job>();

function loadArchiver(): (format: string, options?: { store?: boolean; zlib?: { level: number } }) => Archiver {
  let from = process.cwd() + '/package.json';
  try {
    if (typeof __filename === 'string' && __filename) from = __filename;
  } catch {
    /* ESM */
  }
  if (!from.endsWith('.cjs') && !from.endsWith('.js') && !from.endsWith('.mjs') && !from.endsWith('.ts')) {
    try {
      from = fileURLToPath(import.meta.url);
    } catch {
      /* bundled CJS leaves import.meta empty */
    }
  }
  return createRequire(from)('archiver');
}

class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
}

export function getPortableExport(id: string): PortableJobView | null {
  const job = jobs.get(id);
  if (!job) return null;
  return {
    id: job.id,
    phase: job.phase,
    filesDone: job.filesDone,
    filesTotal: job.filesTotal,
    currentFile: job.currentFile,
    done: job.done,
    cancelled: job.cancelled,
    error: job.error,
    destPath: job.destPath,
  };
}

export function cancelPortableExport(id: string): void {
  const job = jobs.get(id);
  if (!job || job.done) return;
  job.cancelled = true;
  job.phase = 'Cancelling';
  job.abort.abort();
}

export function startPortableExport(args: {
  db: CaseDb;
  request: PortableExportRequest;
  viewerDir: string;
  logError: (message: string, detail?: string) => void;
}): string {
  const id = crypto.randomBytes(8).toString('hex');
  const destPath = path.resolve(args.request.destPath);
  const job: Job = {
    id,
    phase: 'Preparing',
    filesDone: 0,
    filesTotal: 0,
    currentFile: '',
    done: false,
    cancelled: false,
    error: '',
    destPath,
    abort: new AbortController(),
  };
  jobs.set(id, job);
  void runExport(job, args).catch(() => {
    /* runExport records the error */
  });
  return id;
}

function throwIfCancelled(job: Job) {
  if (job.cancelled || job.abort.signal.aborted) throw new ExportCancelled();
}

function jsPayload(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function waitEntry(archive: Archiver): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEntry = () => {
      cleanup();
      resolve();
    };
    const onErr = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      archive.removeListener('entry', onEntry);
      archive.removeListener('error', onErr);
    };
    archive.once('entry', onEntry);
    archive.once('error', onErr);
  });
}

async function addBuffer(archive: Archiver, job: Job, name: string, body: string | Buffer) {
  throwIfCancelled(job);
  const pending = waitEntry(archive);
  archive.append(body, { name });
  await pending;
}

async function addFile(archive: Archiver, job: Job, diskPath: string, name: string) {
  throwIfCancelled(job);
  const pending = waitEntry(archive);
  archive.file(diskPath, { name });
  await pending;
}

function keepEvent(evt: ForensicEvent, req: PortableExportRequest, tags: Record<string, { tagged?: boolean }>): boolean {
  if (evt.category === 'message' && !req.includeMessages) return false;
  if (evt.category === 'connection' && !req.includeIpAudit && !req.includeGeoMap) return false;
  if (evt.category === 'file' && !req.includeFiles) return false;
  if (req.onlyTaggedExhibits && !tags[evt.id]?.tagged) return false;
  return true;
}

function redactEvent(evt: ForensicEvent, req: PortableExportRequest): ForensicEvent {
  if (!req.redactIpAddresses && !req.redactPii) return evt;
  let content = evt.content;
  let ipAddress = evt.ipAddress;
  let sender = evt.sender;
  let recipient = evt.recipient;
  if (req.redactIpAddresses) {
    if (ipAddress) ipAddress = redactIp(ipAddress);
    if (content) {
      content = content.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, (match) => redactIp(match) || match);
    }
  }
  if (req.redactPii) {
    content = redactPiiText(content) || content;
    sender = redactPiiText(sender) || sender;
    recipient = redactPiiText(recipient) || recipient;
  }
  return { ...evt, content, ipAddress, sender, recipient };
}

interface MediaRow {
  name: string;
  relative_path: string;
  size: number;
  media_type: string | null;
  source_path: string | null;
  md5: string | null;
  is_screenshot: number | null;
  skin_tone_percent: number | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_alt: number | null;
  captured_at: string | null;
  device: string | null;
  coord_source: string | null;
}

function loadTags(db: CaseDb, caseId: string, override?: PortableExportRequest['evidenceTags']) {
  const tags: Record<string, { tagged: boolean; notes: string }> = {};
  const rows = db.prepare(`SELECT event_id, tagged, notes FROM evidence_tags WHERE case_id = ?`).all(caseId) as Array<{
    event_id: string;
    tagged: number;
    notes: string | null;
  }>;
  for (let i = 0; i < rows.length; i++) {
    tags[rows[i].event_id] = { tagged: rows[i].tagged === 1, notes: rows[i].notes || '' };
  }
  if (override) {
    for (const [key, value] of Object.entries(override)) {
      if (!value) continue;
      tags[key] = { tagged: !!value.tagged, notes: value.notes || tags[key]?.notes || '' };
    }
  }
  return tags;
}

function taggedMediaNames(db: CaseDb, caseId: string, tags: Record<string, { tagged?: boolean }>, job: Job): Set<string> {
  const names = new Set<string>();
  const stmt = db.prepare(`SELECT event_json FROM case_events WHERE case_id = ? ORDER BY event_index`);
  for (const row of stmt.iterate(caseId) as Iterable<{ event_json: string }>) {
    throwIfCancelled(job);
    let evt: ForensicEvent;
    try {
      evt = JSON.parse(row.event_json) as ForensicEvent;
    } catch {
      continue;
    }
    if (!tags[evt.id]?.tagged) continue;
    const name = evt.details?.resolvedMediaName;
    if (typeof name === 'string' && name) names.add(name);
  }
  return names;
}

function mediaIsTagged(name: string, tags: Record<string, { tagged?: boolean }>, taggedNames: Set<string>): boolean {
  if (tags[`media-file-${name}`]?.tagged) return true;
  return taggedNames.has(name);
}

function deletePartial(destPath: string) {
  try {
    fs.rmSync(destPath, { force: true });
  } catch {
    /* already gone */
  }
}

async function runExport(
  job: Job,
  args: { db: CaseDb; request: PortableExportRequest; viewerDir: string; logError: (message: string, detail?: string) => void }
) {
  const { db, request, viewerDir, logError } = args;
  const req = { ...request, destPath: job.destPath };
  let archive: Archiver | null = null;
  let output: fs.WriteStream | null = null;
  try {
    if (!path.isAbsolute(req.destPath)) throw new Error('Choose a full path for the portable case.');
    if (!req.destPath.toLowerCase().endsWith('.zip')) throw new Error('The portable case file must end in .zip.');
    const viewerJs = path.join(viewerDir, 'viewer.js');
    const viewerCss = path.join(viewerDir, 'viewer.css');
    if (!fs.existsSync(viewerJs) || !fs.existsSync(viewerCss)) {
      throw new Error('The portable viewer is not built. Run npm run build, then create the package again.');
    }
    const caseRow = db.prepare(`SELECT id FROM cases WHERE id = ?`).get(req.caseDbId) as { id: string } | undefined;
    if (!caseRow) throw new Error('Save the case before building a portable package. This case is not in the local database.');
    const previousCache = Number(db.pragma('cache_size', { simple: true })) || -2000;
    db.pragma('cache_size = -4000');

    fs.mkdirSync(path.dirname(req.destPath), { recursive: true });
    deletePartial(req.destPath);

    const folder = `Case_${(req.caseId || 'Returns').replace(/[^\w.-]+/g, '_')}_Portable_Viewer`;
    const tags = req.includeEvidenceTags ? loadTags(db, req.caseDbId, req.evidenceTags) : {};
    const taggedNames = req.onlyTaggedExhibits && req.includeFiles
      ? taggedMediaNames(db, req.caseDbId, tags, job)
      : new Set<string>();

    const mediaRows = req.includeFiles
      ? (db.prepare(
          `SELECT name, relative_path, size, media_type, source_path, md5, is_screenshot, skin_tone_percent,
                  gps_lat, gps_lng, gps_alt, captured_at, device, coord_source
           FROM case_files WHERE case_id = ? AND is_media = 1 ORDER BY relative_path, name`
        ).all(req.caseDbId) as MediaRow[])
      : [];
    const selectedMedia = req.onlyTaggedExhibits
      ? mediaRows.filter(row => mediaIsTagged(row.name, tags, taggedNames))
      : mediaRows;
    job.filesTotal = selectedMedia.length;
    job.phase = 'Copying media';

    output = fs.createWriteStream(req.destPath);
    archive = loadArchiver()('zip', { store: true, zlib: { level: 0 } });
    const archiveRef = archive;
    const outputRef = output;
    let settled = false;
    const failed = new Promise<never>((_resolve, reject) => {
      const fail = (err: Error) => {
        if (!settled) reject(err);
      };
      outputRef.on('error', fail);
      archiveRef.on('error', fail);
      archiveRef.on('warning', (err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') fail(err);
      });
    });
    failed.catch(() => {
      /* The export await races this promise. A late rejection must not surface as unhandled. */
    });
    archive.pipe(output);

    const contentStmt = db.prepare(
      `SELECT content FROM case_files WHERE case_id = ? AND relative_path = ? AND name = ? AND is_media = 1`
    );

    const chunkNames: string[] = [];
    let chunkIndex = 0;
    const writeChunk = async (part: Record<string, unknown>) => {
      const name = `chunk-${String(chunkIndex).padStart(4, '0')}.js`;
      chunkIndex += 1;
      chunkNames.push(name);
      const body = `window.__UWRP_PARTS = window.__UWRP_PARTS || [];window.__UWRP_PARTS.push(${jsPayload(part)});\n`;
      await addBuffer(archiveRef, job, `${folder}/data/${name}`, body);
    };

    const mediaPart: Array<Record<string, unknown>> = [];
    let mediaChars = 0;
    const flushMedia = async () => {
      if (!mediaPart.length) return;
      const copy = mediaPart.splice(0, mediaPart.length);
      mediaChars = 0;
      await writeChunk({ media: copy });
    };

    for (let i = 0; i < selectedMedia.length; i++) {
      throwIfCancelled(job);
      const row = selectedMedia[i];
      job.currentFile = row.name;
      const relative = `media/${portableMediaFileName(i, row.name)}`;
      const zipName = `${folder}/${relative}`;
      let copied = false;
      const source = row.source_path || '';
      if (source && source !== req.destPath && fs.existsSync(source) && fs.statSync(source).isFile()) {
        await addFile(archiveRef, job, source, zipName);
        copied = true;
      } else {
        const stored = contentStmt.get(req.caseDbId, row.relative_path || '', row.name) as { content?: string } | undefined;
        const content = stored?.content || '';
        if (content.startsWith('data:')) {
          const comma = content.indexOf(',');
          const b64 = comma >= 0 ? content.slice(comma + 1) : '';
          const buf = Buffer.from(b64, 'base64');
          if (buf.length) {
            await addBuffer(archiveRef, job, zipName, buf);
            copied = true;
          }
        }
      }
      const descriptor = {
        name: row.name,
        mediaType: row.media_type === 'video' ? 'video' : 'image',
        size: row.size || 0,
        src: copied ? relative : '',
        missing: !copied,
        relativePath: row.relative_path || '',
        md5: row.md5 || null,
        isScreenshot: row.is_screenshot === 1,
        skinTonePercent: row.skin_tone_percent ?? null,
        gps: row.gps_lat != null && row.gps_lng != null ? { lat: row.gps_lat, lng: row.gps_lng } : null,
        gpsAlt: row.gps_alt ?? null,
        capturedAt: row.captured_at || null,
        device: row.device || null,
        coordSource: row.coord_source || null,
      };
      const encoded = jsPayload(descriptor);
      if (mediaChars + encoded.length > CHUNK_CHARS && mediaPart.length) await flushMedia();
      mediaPart.push(descriptor);
      mediaChars += encoded.length;
      job.filesDone = i + 1;
    }
    await flushMedia();
    if (!req.includeFiles) await writeChunk({ media: [] });

    const locationRows = db.prepare(
      `SELECT kind, lat, lng, alt, accuracy, captured_at, device, coord_source, file_name, file_path, record_path, media_name, event_id
       FROM case_locations WHERE case_id = ? ORDER BY loc_index`
    ).all(req.caseDbId) as Array<Record<string, unknown>>;
    let locationBatch: Array<Record<string, unknown>> = [];
    let locationChars = 0;
    for (let i = 0; i < locationRows.length && i < 100000; i++) {
      const row = locationRows[i];
      const item = {
        kind: row.kind,
        lat: row.lat,
        lng: row.lng,
        alt: row.alt ?? null,
        accuracy: row.accuracy ?? null,
        capturedAt: row.captured_at || null,
        device: row.device || null,
        coordSource: row.coord_source || null,
        fileName: row.file_name || '',
        filePath: row.file_path || null,
        recordPath: row.record_path || null,
        mediaName: row.media_name || null,
        eventId: row.event_id || null,
      };
      const encoded = jsPayload(item);
      if (locationChars + encoded.length > CHUNK_CHARS && locationBatch.length) {
        await writeChunk({ locations: locationBatch });
        locationBatch = [];
        locationChars = 0;
      }
      locationBatch.push(item);
      locationChars += encoded.length;
    }
    if (locationBatch.length) await writeChunk({ locations: locationBatch });

    job.phase = 'Writing case records';
    job.currentFile = 'Case records';
    const fileRows = db.prepare(
      `SELECT name, size, is_media, media_type FROM case_files WHERE case_id = ? ORDER BY relative_path, name`
    ).all(req.caseDbId) as Array<{ name: string; size: number; is_media: number; media_type: string | null }>;
    let fileBatch: Array<Record<string, unknown>> = [];
    let fileChars = 0;
    for (let i = 0; i < fileRows.length; i++) {
      throwIfCancelled(job);
      const item = {
        name: fileRows[i].name,
        size: fileRows[i].size || 0,
        isMedia: fileRows[i].is_media === 1,
        mediaType: fileRows[i].media_type,
      };
      const encoded = jsPayload(item);
      if (fileChars + encoded.length > CHUNK_CHARS && fileBatch.length) {
        await writeChunk({ files: fileBatch });
        fileBatch = [];
        fileChars = 0;
      }
      fileBatch.push(item);
      fileChars += encoded.length;
    }
    if (fileBatch.length) await writeChunk({ files: fileBatch });

    const eventStmt = db.prepare(`SELECT event_json FROM case_events WHERE case_id = ? ORDER BY event_index`);
    let eventBatch: ForensicEvent[] = [];
    let eventChars = 0;
    let totalEvents = 0;
    let messagesCount = 0;
    let connectionsCount = 0;
    let filesCount = 0;
    let taggedCount = 0;
    const flushEvents = async () => {
      if (!eventBatch.length) return;
      const copy = eventBatch;
      eventBatch = [];
      eventChars = 0;
      await writeChunk({ events: copy });
    };
    for (const row of eventStmt.iterate(req.caseDbId) as Iterable<{ event_json: string }>) {
      throwIfCancelled(job);
      let evt: ForensicEvent;
      try {
        evt = JSON.parse(row.event_json) as ForensicEvent;
      } catch {
        continue;
      }
      if (!keepEvent(evt, req, tags)) continue;
      const next = redactEvent(evt, req);
      const encoded = jsPayload(next);
      if (eventChars + encoded.length > CHUNK_CHARS && eventBatch.length) await flushEvents();
      eventBatch.push(next);
      eventChars += encoded.length;
      totalEvents++;
      if (next.category === 'message') messagesCount++;
      if (next.category === 'connection') connectionsCount++;
      if (next.category === 'file') filesCount++;
      if (tags[next.id]?.tagged) taggedCount++;
    }
    await flushEvents();

    const parseRow = db.prepare(`SELECT accounts_json, account_changes_json, account_info_json FROM case_parse WHERE case_id = ?`).get(req.caseDbId) as
      | { accounts_json?: string; account_changes_json?: string; account_info_json?: string }
      | undefined;
    const parseJson = <T,>(value: string | undefined, fallback: T): T => {
      if (!value) return fallback;
      try { return JSON.parse(value) as T; } catch { return fallback; }
    };
    let accounts = req.includeAccountInfo ? parseJson<AccountRecord[]>(parseRow?.accounts_json, []) : [];
    let accountInfo = req.includeAccountInfo ? parseJson<AccountRecord | null>(parseRow?.account_info_json, null) : null;
    if (req.redactIpAddresses || req.redactPii) {
      accounts = accounts.map(acc => ({
        ...acc,
        registrationIp: req.redactIpAddresses ? redactIp(acc.registrationIp) : acc.registrationIp,
        email: req.redactPii ? redactPiiText(acc.email) : acc.email,
        phone: req.redactPii ? redactPiiText(acc.phone) : acc.phone,
      }));
      if (accountInfo) {
        accountInfo = {
          ...accountInfo,
          registrationIp: req.redactIpAddresses ? redactIp(accountInfo.registrationIp) : accountInfo.registrationIp,
          email: req.redactPii ? redactPiiText(accountInfo.email) : accountInfo.email,
          phone: req.redactPii ? redactPiiText(accountInfo.phone) : accountInfo.phone,
        };
      }
    }

    job.phase = 'Finishing';
    job.currentFile = 'Viewer';
    const meta = {
      caseId: req.includeMetadata ? req.caseId : '',
      investigatorName: req.includeMetadata ? req.investigatorName : '',
      suspectName: req.includeMetadata ? req.suspectName : '',
      provider: req.provider as ProviderType,
      providerName: req.providerName,
      generatedAt: new Date().toISOString(),
      briefingText: req.includeBriefing ? req.briefingText || '' : '',
      passcode: req.passcode || '',
      includeFiles: req.includeFiles,
      accounts,
      accountInfo,
      accountChanges: req.includeAccountChanges ? parseJson(parseRow?.account_changes_json, []) : [],
      evidenceTags: req.includeEvidenceTags ? tags : {},
      stats: {
        totalEvents,
        messagesCount,
        connectionsCount,
        filesCount,
        taggedCount,
        mediaCount: selectedMedia.length,
      },
    };
    const manifest = `window.__UWRP_PARTS = window.__UWRP_PARTS || [];window.__UWRP_META = ${jsPayload(meta)};window.__UWRP_MANIFEST = ${jsPayload({ chunks: chunkNames })};\n`;
    await addBuffer(archiveRef, job, `${folder}/data/manifest.js`, manifest);
    await addBuffer(archiveRef, job, `${folder}/Portable_Case_Viewer.html`, htmlShell(meta.caseId || 'Evidence'));
    await addBuffer(archiveRef, job, `${folder}/README_OFFICER_INSTRUCTIONS.txt`, readmeText(req));
    await addFile(archiveRef, job, viewerJs, `${folder}/viewer/viewer.js`);
    await addFile(archiveRef, job, viewerCss, `${folder}/viewer/viewer.css`);

    throwIfCancelled(job);
    const closed = new Promise<void>((resolve, reject) => {
      outputRef.on('close', () => resolve());
      outputRef.on('error', reject);
    });
    await Promise.race([archiveRef.finalize(), failed]);
    await Promise.race([closed, failed]);
    settled = true;
    job.phase = 'Done';
    job.currentFile = '';
    job.done = true;
    db.pragma(`cache_size = ${previousCache}`);
  } catch (err) {
    try { db.pragma('cache_size = -20000'); } catch { /* connection may be closing */ }
    try { archive?.abort(); } catch { /* already closed */ }
    try { output?.destroy(); } catch { /* already closed */ }
    deletePartial(job.destPath);
    if (err instanceof ExportCancelled || job.cancelled) {
      job.cancelled = true;
      job.phase = 'Cancelled';
      job.error = '';
      job.done = true;
      return;
    }
    const error = err instanceof Error ? err : new Error(String(err));
    job.error = error.message || 'The portable case could not be saved.';
    job.phase = 'Failed';
    job.done = true;
    logError(job.error, error.stack || String(err));
  }
}

function htmlShell(title: string): string {
  const safeTitle = title.replace(/[<>&]/g, '');
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portable Case Viewer - ${safeTitle}</title>
  <link rel="stylesheet" href="viewer/viewer.css">
</head>
<body>
  <div id="root"></div>
  <script src="data/manifest.js"></script>
  <script>
    (function () {
      var list = (window.__UWRP_MANIFEST && window.__UWRP_MANIFEST.chunks) || [];
      for (var i = 0; i < list.length; i++) {
        document.write('<script src="data/' + list[i] + '"><\\/script>');
      }
    })();
  </script>
  <script src="viewer/viewer.js"></script>
</body>
</html>
`;
}

function readmeText(req: PortableExportRequest): string {
  return `LAW ENFORCEMENT PORTABLE CASE PACKAGE
=====================================
Case Identifier: ${req.caseId || 'N/A'}
Investigator: ${req.investigatorName || 'N/A'}
Suspect/Subject: ${req.suspectName || 'N/A'}
Warrant Return Provider: ${req.providerName}
Generated On: ${new Date().toLocaleString()}

INSTRUCTIONS FOR REVIEWING OFFICERS:
------------------------------------
1. Unzip this folder. Open Portable_Case_Viewer.html by double-clicking it.
2. Internet connection is not required. The page does not call the network to show media.
3. If a PIN was set, enter the PIN from the investigating agency.
4. Open Media Vault to page through images and videos. Per page, First, Prev, Next, and Last sit above and below the grid. Only the current page is shown.
5. Media files are in the media folder beside the viewer. The original evidence files were not modified.
`;
}
