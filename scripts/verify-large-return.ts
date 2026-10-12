/**
 * Checks paging, saved-case restore, and that a large media set does not
 * keep file bytes in the records the renderer would hold.
 *
 * Run: npx tsx scripts/verify-large-return.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import {
  addToSet,
  appendEvents,
  fileParseSignature,
  paginateItems,
  retainedContentBytes,
  shouldRestoreSavedParse,
  stripRetainedBytes,
  bytesFromDataUrl,
} from '../src/lib/casePersistence';
import {
  appendEventRows,
  cacheMediaFile,
  getLastCaseId,
  isAllowedMediaPath,
  loadEvents,
  loadWorkspace,
  migrate,
  registerMediaPaths,
  saveWorkspace,
} from '../src/lib/caseDatabase';
import type { ForensicEvent } from '../src/types';

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

function event(i: number): ForensicEvent {
  return {
    id: `evt-${i}`,
    timestamp: '2024-01-01T00:00:00.000Z',
    category: 'message',
    sender: 'a',
    content: `message ${i}`,
    sourceFile: 'messages.csv',
  };
}

function checkPaging(): void {
  const items = new Array(2000);
  for (let i = 0; i < items.length; i++) items[i] = { name: `m-${i}.jpg` };
  const page = paginateItems(items, 3, 50);
  assert(page.total === 2000, 'filtered total');
  assert(page.pageCount === 40, 'page count');
  assert(page.page === 3, 'current page');
  assert(page.items.length === 50, 'only one page of items');
  assert(page.items[0].name === 'm-100.jpg', 'page starts at the right item');
  assert(page.start === 100 && page.end === 150, 'range');
  const last = paginateItems(items, 999, 500);
  assert(last.page === 4 && last.items.length === 500, 'page is clamped');
  const empty = paginateItems([], 2, 25);
  assert(empty.page === 1 && empty.items.length === 0 && empty.total === 0, 'empty set');
  console.log('paging: 2000 items, page size 50, page 3 renders 50 items');
}

function checkMemory(): { diskBytes: number; retained: number; eventCount: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-mem-'));
  const big = path.join(dir, 'return-media.bin');
  const diskBytes = 8 * 1024 * 1024;
  fs.writeFileSync(big, Buffer.alloc(diskBytes, 7));

  const files: Array<{ name: string; content: string; size: number; isMedia: boolean; sourcePath: string }> = [];
  for (let i = 0; i < 5000; i++) {
    files.push({
      name: `clip-${i}.mp4`,
      content: '',
      size: diskBytes,
      isMedia: true,
      sourcePath: big,
    });
  }
  const retained = retainedContentBytes(files);
  assert(retained === 0, `renderer content bytes should be 0, was ${retained}`);
  assert(fs.statSync(big).size === diskBytes, 'synthetic media stays on disk');

  const fat = { name: 'blob.jpg', content: 'data:image/jpeg;base64,' + 'A'.repeat(2_000_000), isMedia: true };
  assert(retainedContentBytes([fat]) > 2_000_000, 'base64 would be retained if stored on the file');
  assert(retainedContentBytes([stripRetainedBytes(fat)]) === 0, 'strip drops retained bytes');

  const chunks: ForensicEvent[][] = [];
  const chunkCount = 80;
  const chunkSize = 1000;
  for (let c = 0; c < chunkCount; c++) {
    const chunk = new Array<ForensicEvent>(chunkSize);
    for (let j = 0; j < chunkSize; j++) chunk[j] = event(c * chunkSize + j);
    chunks.push(chunk);
  }
  const before = process.memoryUsage().heapUsed;
  const combined: ForensicEvent[] = [];
  for (let i = 0; i < chunks.length; i++) appendEvents(combined, chunks[i]);
  const after = process.memoryUsage().heapUsed;
  assert(combined.length === chunkCount * chunkSize, 'events appended once');
  assert(combined[0] === chunks[0][0], 'append keeps the same event objects');
  const growthMb = (after - before) / (1024 * 1024);
  console.log(`memory: retained content ${retained} bytes, disk file ${diskBytes} bytes, append heap growth ${growthMb.toFixed(1)} MB for ${combined.length} events`);

  const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const decoded = bytesFromDataUrl(svg);
  assert(decoded && decoded.length > 10, 'small inline image decodes for the app cache');
  const huge = 'data:text/plain;base64,' + 'A'.repeat(3_000_000);
  assert(bytesFromDataUrl(huge) === null, 'large data URLs are not copied back into memory');

  const hashes = addToSet(new Set(['a']), ['b', 'c']);
  assert(hashes.size === 3, 'hash set grows without a spread');
  return { diskBytes, retained, eventCount: combined.length };
}

function checkRestore(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-case-'));
  const dbPath = path.join(dir, 'database.sqlite');
  const present = path.join(dir, 'photo.jpg');
  const missing = path.join(dir, 'gone.jpg');
  fs.writeFileSync(present, Buffer.from('jpeg-bytes'));

  const db = new Database(dbPath);
  migrate(db);
  const caseId = 'case-restore-1';
  const events = [event(1), event(2), event(3)];
  const files = [
    {
      name: 'messages.csv',
      relativePath: 'messages.csv',
      size: 42,
      isMedia: false,
      provider: 'discord',
      sourcePath: path.join(dir, 'messages.csv'),
      content: 'should-not-matter',
    },
    {
      name: 'photo.jpg',
      relativePath: 'media/photo.jpg',
      size: 10,
      isMedia: true,
      mediaType: 'image',
      provider: 'discord',
      sourcePath: present,
      content: 'data:image/jpeg;base64,' + 'B'.repeat(5000),
    },
    {
      name: 'gone.jpg',
      relativePath: 'media/gone.jpg',
      size: 10,
      isMedia: true,
      mediaType: 'image',
      provider: 'discord',
      sourcePath: missing,
      content: 'data:image/jpeg;base64,' + 'C'.repeat(5000),
    },
  ];
  const signature = fileParseSignature(files, 'discord');
  saveWorkspace(db, {
    id: caseId,
    case_id_code: 'CASE-1',
    investigator_name: 'Examiner',
    suspect_name: 'Subject',
    active_provider: 'discord',
    signature,
    files,
    accounts: [],
    evidence_tags: { 'evt-1': { tagged: true, notes: 'keep' } },
    keepEvents: true,
  });
  appendEventRows(db, caseId, events, 0);

  const loaded = loadWorkspace(db, caseId);
  assert(loaded, 'case loads');
  assert(loaded!.fromSavedParse === true, 'saved events mark the case as already parsed');
  assert(loaded!.event_count === 3, 'event count');
  const restored = loadEvents(db, caseId, 0, 1000);
  assert(restored.length === 3 && restored[2].id === 'evt-3', 'events round-trip');
  assert(shouldRestoreSavedParse(loaded!.signature, loaded!.files as Array<{ name: string; size: number; relativePath?: string; provider?: string }>, 'discord', restored.length), 'reopen uses the saved parse');
  assert(!shouldRestoreSavedParse('different', loaded!.files as Array<{ name: string; size: number }>, 'discord', restored.length), 'a different file set does not pretend to match');

  const byName = new Map(loaded!.files.map(f => [String(f.name), f]));
  const photo = byName.get('photo.jpg') as { content?: string; mediaMissing?: boolean; sourcePath?: string };
  const gone = byName.get('gone.jpg') as { content?: string; mediaMissing?: boolean };
  assert(photo.content === '', 'present media is not returned as base64');
  assert(photo.mediaMissing === false, 'file on disk is not missing');
  assert(gone.mediaMissing === true, 'missing source is flagged');
  assert(gone.content === '' || gone.content == null, 'missing media is not a data URL');

  const stored = db.prepare(`SELECT content FROM case_files WHERE case_id = ? AND name = ?`).get(caseId, 'photo.jpg') as { content: string };
  assert(!stored.content || stored.content.length === 0, 'database does not keep media bytes');

  assert(getLastCaseId(db) === caseId, 'last case id is remembered');
  assert(isAllowedMediaPath(db, present), 'saved source path is allowed');
  assert(!isAllowedMediaPath(db, path.join(dir, 'secret.jpg')), 'unregistered path is not allowed');
  registerMediaPaths(db, [path.join(dir, 'secret.jpg')]);
  assert(isAllowedMediaPath(db, path.join(dir, 'secret.jpg')), 'registered path is allowed');

  const cacheRoot = path.join(dir, 'media-cache');
  const cached = cacheMediaFile(cacheRoot, caseId, 'nested/clip.mp4', Buffer.from('mp4'));
  assert(cached.startsWith(path.resolve(cacheRoot)), 'cache stays inside the app media folder');
  assert(fs.existsSync(cached), 'cached bytes exist');
  const stayed = cacheMediaFile(cacheRoot, caseId, '../../etc/passwd', Buffer.from('no'));
  assert(stayed.startsWith(path.resolve(cacheRoot) + path.sep), 'dot-dot segments cannot leave the media cache');
  assert(!stayed.split(path.sep).includes('..'), 'traversal segments are removed');
  db.close();
  console.log('restore: save/load returned 3 events without calling the parser; missing media flagged; media bytes not stored');
}

function waitForServer(port: number): Promise<void> {
  const deadline = Date.now() + 20000;
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(`http://127.0.0.1:${port}/api/diagnostics`).then(res => {
        if (res.ok) resolve();
        else if (Date.now() > deadline) reject(new Error('diagnostics not ready'));
        else setTimeout(tick, 200);
      }).catch(() => {
        if (Date.now() > deadline) reject(new Error('server did not start'));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

async function checkHttp(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-http-'));
  const dbPath = path.join(dir, 'database.sqlite');
  const media = path.join(dir, 'served.jpg');
  fs.writeFileSync(media, Buffer.from('hello-media'));
  const port = 43187;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (buf) => { stderr += String(buf); });
  try {
    await waitForServer(port);
    const svgPath = path.join(dir, 'tile.jpg');
    fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    const db = new Database(dbPath);
    registerMediaPaths(db, [media, svgPath]);
    db.close();

    const ok = await fetch(`http://127.0.0.1:${port}/api/local-media?path=${encodeURIComponent(media)}`);
    assert(ok.status === 200, `present file should be served, got ${ok.status}`);
    const body = Buffer.from(await ok.arrayBuffer());
    assert(body.toString() === 'hello-media', 'served bytes match the file on disk');

    const svg = await fetch(`http://127.0.0.1:${port}/api/local-media?path=${encodeURIComponent(svgPath)}`);
    assert(svg.status === 200, 'svg bytes are served');
    assert(String(svg.headers.get('content-type') || '').includes('image/svg+xml'), 'svg is not labeled as a jpeg');

    const missing = await fetch(`http://127.0.0.1:${port}/api/local-media?path=${encodeURIComponent(path.join(dir, 'nope.jpg'))}`);
    assert(missing.status === 404, `unregistered path should 404, got ${missing.status}`);

    const diag = await fetch(`http://127.0.0.1:${port}/api/diagnostics`);
    const info = await diag.json() as { logPath?: string; logFileName?: string };
    assert(info.logFileName === 'uwrp-errors.log', 'diagnostics names the log file');
    assert(typeof info.logPath === 'string' && info.logPath.endsWith('uwrp-errors.log'), 'log path is next to the database');

    const logged = await fetch(`http://127.0.0.1:${port}/api/client-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'synthetic renderer error', detail: 'stack', source: 'test' }),
    });
    assert(logged.ok, 'client log accepted');
    const logText = fs.readFileSync(info.logPath!, 'utf8');
    assert(logText.includes('synthetic renderer error'), 'error was written to uwrp-errors.log');
    console.log(`http: local media served, unregistered path 404, log at ${info.logPath}`);
  } catch (err) {
    console.error(stderr);
    throw err;
  } finally {
    child.kill('SIGTERM');
  }
}

async function main(): Promise<void> {
  checkPaging();
  checkMemory();
  checkRestore();
  await checkHttp();
  console.log('all large-return checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
