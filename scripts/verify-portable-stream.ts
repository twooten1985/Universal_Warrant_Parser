/**
 * Streams a portable case with thousands of media files and opens the viewer from file://.
 * Usage: npx tsx scripts/verify-portable-stream.ts
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/caseDatabase';
import { cancelPortableExport, getPortableExport, startPortableExport, type PortableExportRequest } from '../src/lib/streamPortableCase';

const COUNT = 5000;
const FILE_BYTES = 60 * 1024;
const EVENT_COUNT = 80;
const EVENT_CHARS = 500_000;

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function baseRequest(caseDbId: string, destPath: string, extra: Partial<PortableExportRequest> = {}): PortableExportRequest {
  return {
    caseDbId,
    destPath,
    caseId: 'SYN-LARGE',
    investigatorName: 'Examiner',
    suspectName: 'Subject',
    provider: 'discord',
    providerName: 'Discord',
    includeMetadata: true,
    includeBriefing: false,
    includeEvidenceTags: true,
    onlyTaggedExhibits: false,
    includeAccountInfo: true,
    includeMessages: true,
    includeIpAudit: true,
    includeGeoMap: false,
    includeFiles: true,
    includeAccountChanges: false,
    redactIpAddresses: false,
    redactPii: false,
    passcode: '',
    ...extra,
  };
}

function seedCase(db: Database.Database, id: string, mediaDir: string, count: number, fileBytes: number) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const buf = Buffer.alloc(fileBytes, 0);
  png.copy(buf);
  db.prepare(`INSERT INTO cases (id, case_id_code, investigator_name, suspect_name, active_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, 'SYN-LARGE', 'Examiner', 'Subject', 'discord', new Date().toISOString(), new Date().toISOString()
  );
  const insertFile = db.prepare(
    `INSERT INTO case_files (case_id, name, content, size, is_media, media_type, relative_path, provider, source_path, md5, is_screenshot, skin_tone_percent)
     VALUES (?, ?, '', ?, 1, 'image', ?, 'discord', ?, ?, 0, 0)`
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const name = `grid-${String(i + 1).padStart(4, '0')}.png`;
      const disk = path.join(mediaDir, name);
      if (!fs.existsSync(disk)) fs.writeFileSync(disk, buf);
      insertFile.run(id, name, fileBytes, name, disk, i === 0 ? 'abc' : null);
    }
  });
  tx();
  const payload = 'N'.repeat(EVENT_CHARS);
  const insertEvent = db.prepare(`INSERT INTO case_events (case_id, event_index, event_json) VALUES (?, ?, ?)`);
  const eventTx = db.transaction(() => {
    for (let i = 0; i < EVENT_COUNT; i++) {
      const evt = {
        id: `evt-${i}`,
        timestamp: '2026-01-01T00:00:00Z',
        category: i % 2 === 0 ? 'message' : 'connection',
        sender: 'subject',
        content: payload,
        sourceFile: 'return.json',
      };
      insertEvent.run(id, i, JSON.stringify(evt));
    }
  });
  eventTx();
  db.prepare(`INSERT INTO evidence_tags (case_id, event_id, tagged, notes) VALUES (?, ?, 1, ?)`).run(id, 'media-file-grid-0001.png', 'first exhibit');
  db.prepare(`INSERT INTO case_parse (case_id, provider, accounts_json, account_changes_json, summary_json, account_info_json, event_count, complete) VALUES (?, 'discord', '[]', '[]', '{}', '{}', ?, 1)`).run(id, EVENT_COUNT);
}

function waitJob(id: string, onTick?: (job: NonNullable<ReturnType<typeof getPortableExport>>) => void) {
  return new Promise<NonNullable<ReturnType<typeof getPortableExport>>>((resolve, reject) => {
    const timer = setInterval(() => {
      const job = getPortableExport(id);
      if (!job) {
        clearInterval(timer);
        reject(new Error('job missing'));
        return;
      }
      onTick?.(job);
      if (job.done) {
        clearInterval(timer);
        resolve(job);
      }
    }, 200);
  });
}

async function openFile(pageUrl: string) {
  const port = 9349;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-file-chrome-'));
  const chromeBin = fs.existsSync('/usr/local/bin/google-chrome') ? '/usr/local/bin/google-chrome' : 'google-chrome';
  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1200,640',
    pageUrl,
  ], { stdio: 'ignore' });
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let version: { webSocketDebuggerUrl: string } | null = null;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        version = await res.json() as { webSocketDebuggerUrl: string };
        break;
      }
    } catch { /* booting */ }
    await sleep(150);
  }
  assert(version, 'chrome did not start');
  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await listRes.json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = list.find(item => item.type === 'page' && item.url.startsWith('file:')) || list.find(item => item.type === 'page');
  assert(page, 'no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('websocket failed')));
  });
  let seq = 0;
  const pending = new Map<number, (msg: { result?: { result?: { value?: unknown } }; error?: { message: string } }) => void>();
  ws.addEventListener('message', event => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  });
  const evaluate = (expression: string) => new Promise<unknown>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, msg => {
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result?.result?.value);
    });
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
  try {
    const opened = await evaluate(`
      (async () => {
        let imgs = [];
        for (let i = 0; i < 30; i++) {
          imgs = [...document.querySelectorAll('#tabview-media-vault img')];
          if (imgs.length) break;
          await new Promise(r => setTimeout(r, 200));
        }
        const text = document.body.innerText || '';
        const pagers = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Next').length;
        return { text: text.slice(0, 700), imgs: imgs.length, pagers, href: location.href };
      })()
    `) as { text: string; imgs: number; pagers: number; href: string };
    assert(opened.imgs === 50, `expected 50 images on page 1, got ${opened.imgs}. ${opened.text}`);
    assert(opened.pagers >= 2, 'expected top and bottom pagers');
    assert(opened.text.includes('Page 1 of'), opened.text);
    assert(!opened.text.includes('http://') || opened.href.startsWith('file:'), opened.href);

    const after = await evaluate(`
      (async () => {
        const root = document.getElementById('tabview-media-vault');
        const buttons = [...root.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Next');
        const bottom = buttons[buttons.length - 1];
        bottom.scrollIntoView({ block: 'end' });
        await new Promise(r => setTimeout(r, 250));
        const before = window.scrollY;
        bottom.click();
        await new Promise(r => setTimeout(r, 900));
        const imgs = [...root.querySelectorAll('img')].map(img => img.getAttribute('src'));
        return {
          before,
          top: document.getElementById('media-browser-top').getBoundingClientRect().top,
          count: imgs.length,
          first: imgs[0] || '',
          text: [...root.querySelectorAll('p')].map(p => p.innerText).filter(t => t.includes('Page')).join(' | '),
          remote: performance.getEntriesByType('resource').map(e => e.name).filter(name => name.startsWith('http')),
        };
      })()
    `) as { before: number; top: number; count: number; first: string; text: string; remote: string[] };
    assert(after.before > 100, `page did not scroll (${after.before})`);
    assert(after.count === 50, `page 2 count ${after.count}`);
    assert(after.first.includes('media/'), after.first);
    assert(after.text.includes('Page 2 of'), after.text);
    assert(after.top < 80 && after.top > -30, `bottom Next did not return to the grid (${after.top})`);
    assert(after.remote.length === 0, `network calls from file viewer: ${after.remote.join(', ')}`);

    const searched = await evaluate(`
      (async () => {
        const input = document.getElementById('media-search');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'grid-0001.png');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));
        const root = document.getElementById('tabview-media-vault');
        return { imgs: root.querySelectorAll('img').length, text: root.innerText.includes('EXHIBIT'), name: root.innerText.includes('grid-0001.png') };
      })()
    `) as { imgs: number; text: boolean; name: boolean };
    assert(searched.imgs === 1, `search rendered ${searched.imgs}`);
    assert(searched.name && searched.text, 'tagged file should show its exhibit mark');
  } finally {
    ws.close();
    chrome.kill();
  }
}

async function main() {
  const viewerDir = path.resolve('dist/portable');
  assert(fs.existsSync(path.join(viewerDir, 'viewer.js')), 'build the portable viewer first');
  assert(fs.existsSync(path.join(viewerDir, 'viewer.css')), 'viewer.css missing');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-stream-'));
  const mediaDir = path.join(root, 'evidence');
  fs.mkdirSync(mediaDir);
  const db = new Database(path.join(root, 'case.sqlite'));
  migrate(db);
  console.log(`Writing ${COUNT} media files...`);
  seedCase(db, 'case-large', mediaDir, COUNT, FILE_BYTES);
  const sample = path.join(mediaDir, 'grid-0001.png');
  const beforeStat = fs.statSync(sample);

  const logs: string[] = [];
  const logError = (message: string, detail?: string) => {
    logs.push(`${message}\n${detail || ''}`);
  };

  const noMediaDir = path.join(root, 'nomedia.sqlite');
  const db2 = new Database(noMediaDir);
  migrate(db2);
  db2.prepare(`INSERT INTO cases (id, case_id_code, active_provider, created_at, updated_at) VALUES ('case-none', 'NONE', 'discord', '', '')`).run();
  db2.prepare(`INSERT INTO case_parse (case_id, provider, accounts_json, account_changes_json, summary_json, account_info_json, event_count, complete) VALUES ('case-none', 'discord', '[]', '[]', '{}', '{}', 0, 1)`).run();
  const noneZip = path.join(root, 'none.zip');
  const noneId = startPortableExport({
    db: db2,
    viewerDir,
    logError,
    request: baseRequest('case-none', noneZip, { includeFiles: false, caseId: 'NONE' }),
  });
  const noneJob = await waitJob(noneId);
  assert(!noneJob.error, noneJob.error);
  assert(fs.existsSync(noneZip), 'no-media zip missing');

  const taggedZip = path.join(root, 'tagged.zip');
  const taggedId = startPortableExport({
    db,
    viewerDir,
    logError,
    request: baseRequest('case-large', taggedZip, { onlyTaggedExhibits: true, caseId: 'TAGGED' }),
  });
  const taggedJob = await waitJob(taggedId);
  assert(!taggedJob.error, taggedJob.error);
  assert(taggedJob.filesTotal === 1, `tagged export copied ${taggedJob.filesTotal}`);

  const badZip = path.join(root, 'not-a-directory', 'case.zip');
  fs.writeFileSync(path.join(root, 'not-a-directory'), 'file');
  const badId = startPortableExport({
    db,
    viewerDir,
    logError,
    request: baseRequest('case-large', badZip),
  });
  const badJob = await waitJob(badId);
  assert(badJob.error, 'expected a failure');
  assert(!fs.existsSync(badZip), 'partial zip should be removed');
  assert(logs.some(line => line.includes(badJob.error)), 'failure was not logged with the message');

  const cancelZip = path.join(root, 'cancel.zip');
  const cancelId = startPortableExport({
    db,
    viewerDir,
    logError,
    request: baseRequest('case-large', cancelZip, { caseId: 'CANCEL' }),
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      const job = getPortableExport(cancelId);
      if (!job) {
        clearInterval(timer);
        reject(new Error('cancel job missing'));
        return;
      }
      if (job.filesDone > 0 || job.done) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
  cancelPortableExport(cancelId);
  const cancelJob = await waitJob(cancelId);
  assert(cancelJob.cancelled, 'cancel did not finish as cancelled');
  assert(!fs.existsSync(cancelZip), 'cancelled zip was left on disk');

  const zipPath = path.join(root, 'large.zip');
  let maxHeap = 0;
  const heapTimer = setInterval(() => {
    const heap = process.memoryUsage().heapUsed;
    if (heap > maxHeap) maxHeap = heap;
  }, 200);
  const started = Date.now();
  const id = startPortableExport({
    db,
    viewerDir,
    logError,
    request: baseRequest('case-large', zipPath),
  });
  const job = await waitJob(id, current => {
    if (current.filesDone > 0 && current.filesDone % 1000 === 0) {
      console.log(`${current.filesDone}/${current.filesTotal} ${current.currentFile} heap ${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`);
    }
  });
  clearInterval(heapTimer);
  assert(!job.error, job.error);
  assert(job.filesDone === COUNT, `copied ${job.filesDone}`);
  const zipStat = fs.statSync(zipPath);
  const afterStat = fs.statSync(sample);
  assert(beforeStat.mtimeMs === afterStat.mtimeMs && beforeStat.size === afterStat.size, 'original evidence changed');
  assert(zipStat.size > 200 * 1024 * 1024, `zip is only ${zipStat.size} bytes`);
  assert(maxHeap < 220 * 1024 * 1024, `heap grew to ${Math.round(maxHeap / 1048576)}MB`);
  console.log(`Export ${Math.round(zipStat.size / 1048576)}MB in ${((Date.now() - started) / 1000).toFixed(1)}s, peak heap ${Math.round(maxHeap / 1048576)}MB`);

  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert(!listing.includes('evidence_data.json'), 'case data was written twice');
  const mediaLines = listing.split('\n').filter(line => line.includes('/media/'));
  assert(mediaLines.length === COUNT, `zip lists ${mediaLines.length} media files`);
  assert(listing.includes('chunk-'), 'missing data chunks');
  assert(listing.includes('viewer.js'), 'missing viewer');

  const outDir = path.join(root, 'unpacked');
  fs.mkdirSync(outDir);
  execFileSync('unzip', ['-q', zipPath, '-d', outDir]);
  const viewer = path.join(outDir, 'Case_SYN-LARGE_Portable_Viewer', 'Portable_Case_Viewer.html');
  assert(fs.existsSync(viewer), 'viewer html missing');
  const dataDir = path.join(path.dirname(viewer), 'data');
  const chunks = fs.readdirSync(dataDir).filter(name => name.startsWith('chunk-'));
  for (const name of chunks) {
    const size = fs.statSync(path.join(dataDir, name)).size;
    assert(size < 2 * 1024 * 1024, `${name} is ${size} bytes`);
  }
  const html = fs.readFileSync(viewer, 'utf8');
  assert(html.includes('manifest.js') && html.includes('viewer.js'), 'html shell is wrong');
  assert(!html.includes('evidence_data'), 'html still embeds a second copy');

  const pageUrl = `file://${viewer}`;
  console.log(`Opening ${pageUrl}`);
  await openFile(pageUrl);
  console.log('Portable stream export verified.');
  db.close();
  db2.close();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
