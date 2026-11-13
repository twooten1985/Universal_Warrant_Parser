'use strict';
/** Apple iCloud import wizard: IPC + window wiring (main process). */
const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('./core.cjs');

function registerAppleImporter({ app, ipcMain, BrowserWindow, dialog, shell, getMainWindow, iconPath }) {
  let win = null;
  let backupWin = null;
  const S = { scan: null, pass: null, gpg: null, tmp: null, prod: null, items: [], outDir: null, dl: null, log: null, outerSha: null, outerName: null, examiner: '' };

  const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources');
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

  function wipePass() { if (S.pass) { S.pass.fill(0); S.pass = null; } }
  function cleanupTmp() { if (S.tmp) { try { fs.rmSync(S.tmp, { recursive: true, force: true }); } catch {} S.tmp = null; } }
  function reset() { wipePass(); cleanupTmp(); if (S.dl) S.dl.pause(); Object.assign(S, { scan: null, prod: null, items: [], outDir: null, dl: null, log: null, outerSha: null, outerName: null }); }

  // /*uwrp-b9*/ single-flight parse: a second start (auto-start + button, or a re-click) joins the running one,
  // and the running parse works on its own copies of the working folder / custody log / passcode, so nothing
  // another step does to the shared state (reset, folder scan) can pull them out from under it.
  let running = null;
  const single = fn => { if (running) return running; running = (async () => { try { return await fn(); } finally { running = null; } })(); return running; };
  const notWhileRunning = () => { if (running) throw new Error('Parsing is still running in this window. Wait for it to finish.'); };
  const handoff = (outDir, roots, coverage, backups) => { const mw = getMainWindow(); if (mw && !mw.isDestroyed()) { mw.webContents.send('apple-import-complete', { outDir, roots, accounts: coverage, backups }); if (mw.isMinimized()) mw.restore(); mw.show(); mw.focus(); } if (win && !win.isDestroyed()) { win.show(); win.moveTop(); } };
  let openMode = '';
  // /*uwrp-b6*/ payload = { file } (a .zip.gpg chosen anywhere in the main app) or { folder } (a folder that contains one).
  function open(mode, payload) {
    openMode = mode || '';
    const send = () => {
      if (!win || win.isDestroyed()) return;
      if (payload && payload.file) win.webContents.send('apple:gpg-file', payload.file);
      else if (payload && payload.folder) win.webContents.send('apple:folder-path', payload.folder);
      else if (openMode) win.webContents.send('apple:mode', openMode);
    };
    if (win && !win.isDestroyed()) { win.show(); win.focus(); send(); return; }
    win = new BrowserWindow({
      width: 1180, height: 820, title: 'Apple iCloud Import', icon: iconPath, parent: getMainWindow() || undefined,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'wizard-preload.cjs') },
    });
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, 'wizard.html'), { query: { mode: payload ? '' : openMode } });
    if (payload) win.webContents.once('did-finish-load', send);
    win.on('closed', () => { win = null; reset(); });
  }
  const isGpgName = p => /\.(gpg|pgp|asc)$/i.test(String(p || ''));
  const E2E = process.env.UWRP_APPLE_TEST === '1';

  function summary(prod) {
    const csvText = prod.linksCsv[0] ? fs.readFileSync(prod.linksCsv[0], 'utf8') : '';
    const items = csvText ? core.parseLinksCsv(csvText) : [];
    const accounts = {};
    for (const it of items) { const a = accounts[it.account || '?'] || (accounts[it.account || '?'] = { account: it.account || '?', files: 0, approxBytes: 0, types: new Set() }); a.files++; a.approxBytes += it.approxBytes || 0; a.types.add(it.typeCode || it.dataType); }
    const soon = items.filter(i => i.expiresAt && i.expiresAt - Date.now() < 7 * 86400000).length;
    return {
      items, view: {
        files: { linksCsv: prod.linksCsv.map(p => path.basename(p)), html: prod.html.length, bash: prod.bash.map(p => path.basename(p)), pdf: prod.pdf.map(p => path.basename(p)), dataGuide: prod.dataGuide && path.basename(prod.dataGuide), accountWorkbook: prod.accountWorkbook && path.basename(prod.accountWorkbook) },
        items: items.map(core.linkSafe),
        accounts: Object.values(accounts).map(a => ({ ...a, types: [...a.types] })),
        expiringSoon: soon, expired: items.filter(i => i.expiresAt && i.expiresAt < Date.now()).length,
        totalApproxBytes: items.reduce((s, i) => s + (i.approxBytes || 0), 0),
      },
    };
  }

  const GPG_FILTERS = [{ name: 'Apple encrypted return (*.zip.gpg)', extensions: ['gpg', 'pgp', 'asc'] }, { name: 'Decrypted Apple production (*.zip)', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }];
  ipcMain.handle('apple:env', () => {
    S.gpg = core.findGpg(resourcesDir);
    return { gpgFound: !!S.gpg, gpgBundled: !!(S.gpg && S.gpg.startsWith(resourcesDir)), platform: process.platform, version: app.getVersion() };
  });
  ipcMain.handle('apple:pick-gpg', async () => {
    if (E2E && process.env.UWRP_E2E_PICK_GPG) return process.env.UWRP_E2E_PICK_GPG; // test hook (UWRP_APPLE_TEST only)
    const r = await dialog.showOpenDialog((win && !win.isDestroyed() ? win : BrowserWindow.getFocusedWindow()) || undefined, { title: 'Select Apple production (.zip.gpg)', properties: ['openFile'], filters: GPG_FILTERS });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('apple:pick-folder', async (_e, title) => {
    if (E2E && process.env.UWRP_E2E_PICK_FOLDER) return process.env.UWRP_E2E_PICK_FOLDER; // test hook (UWRP_APPLE_TEST only)
    const r = await dialog.showOpenDialog((win && !win.isDestroyed() ? win : BrowserWindow.getFocusedWindow()) || undefined, { title: title || 'Select folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  /** Step 2–4: passcode (stdin to gpg) -> decrypt outer -> hash -> extract (temp) -> preview links. */
  ipcMain.handle('apple:decrypt-outer', async (_e, { gpgFile, passcode }) => {
    notWhileRunning();
    reset();
    if (!S.gpg) S.gpg = core.findGpg(resourcesDir);
    if (!S.gpg) throw new Error('GnuPG was not found. The bundled copy is missing; reinstall the app or install Gpg4win.');
    const already = /\.zip$/i.test(gpgFile); // already-decrypted production .zip: no passcode needed
    S.pass = Buffer.from(String(passcode || ''), 'utf8');
    passcode = null;
    if (!already && !S.pass.length) throw new Error('Enter the Apple passcode (from Apple\'s email).');
    S.outerName = path.basename(gpgFile);
    send('apple:status', 'Hashing the original file...');
    S.outerSha = await core.sha256File(gpgFile);
    S.tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'uwrp-apple-'));
    const zipOut = path.join(S.tmp, S.outerName.replace(/\.(gpg|pgp)$/i, '') || 'production.zip');
    if (already) fs.copyFileSync(gpgFile, zipOut); // working copy; original untouched
    else { send('apple:status', 'Decrypting with GnuPG...');
      try { await core.gpgDecrypt(S.gpg, gpgFile, zipOut, S.pass); } catch (e) { wipePass(); cleanupTmp(); throw e; } }
    send('apple:status', 'Extracting...');
    const exDir = path.join(S.tmp, 'production');
    await core.extractZip(zipOut, exDir);
    S.prod = core.inspectProduction(exDir);
    if (!S.prod.linksCsv.length) throw new Error('Decrypted, but no Account_Data_Links CSV was found in this production.');
    const s = summary(S.prod);
    S.items = s.items;
    return { outerName: S.outerName, outerSha256: S.outerSha, ...s.view };
  });

  ipcMain.handle('apple:check-output', async (_e, dir) => {
    const free = await core.freeSpaceBytes(dir);
    const needed = S.items.reduce((s, i) => s + (i.approxBytes || 0), 0) * 3; // .gpg + decrypted zip + extracted
    let empty = true; try { empty = fs.readdirSync(dir).length === 0; } catch {}
    return { dir, free, needed, ok: free == null || free > needed, empty };
  });

  /** Step 5: commit output folder; production package copied in; custody log opened. */
  ipcMain.handle('apple:set-output', async (_e, { dir, examiner }) => {
    S.outDir = dir; S.examiner = String(examiner || '').slice(0, 120);
    S.log = new core.CustodyLog(path.join(dir, 'logs'), { examiner: S.examiner, appVersion: app.getVersion() });
    S.log.write('import-start', { file: S.outerName, sha256: S.outerSha, result: 'original production hashed (not modified)' });
    S.log.write('outer-decrypt', { file: S.outerName, result: 'ok (gpg ' + path.basename(S.gpg) + ', passcode via stdin, not stored)' });
    const dest = path.join(dir, 'production');
    fs.cpSync(S.prod.root, dest, { recursive: true, errorOnExist: false });
    for (const f of core.walk(dest)) S.log.write('production-file', { file: path.relative(dest, f), bytes: fs.statSync(f).size, sha256: await core.sha256File(f) });
    S.prod = core.inspectProduction(dest);
    cleanupTmp();
    return { productionDir: dest, log: S.log.jsonl };
  });

  ipcMain.handle('apple:start-download', (_e, { selected }) => {
    const pick = new Set(selected || S.items.map(i => i.idx));
    const items = S.items.filter(i => pick.has(i.idx));
    for (const i of S.items) if (!pick.has(i.idx)) S.log.write('download-deselected', { account: i.account, type: i.typeCode, file: i.name });
    S.dl = new core.Downloader(items, path.join(S.outDir, 'gpg'), { log: S.log, concurrency: 3, allowInsecureLocal: process.env.UWRP_APPLE_TEST === '1' });
    S.dl.on('item', it => send('apple:item', it));
    S.dl.on('done', list => send('apple:dl-done', list));
    S.dl.start();
    return S.dl.publicItems();
  });
  ipcMain.handle('apple:pause', () => { S.dl && S.dl.pause(); return true; });
  ipcMain.handle('apple:resume', () => { S.dl && S.dl.start(); return true; });
  ipcMain.handle('apple:retry', (_e, idx) => { S.dl && S.dl.retry(idx); return true; });

  /** Step 7: decrypt + extract each verified file, derive xlsx tables, detect backups, hand to the main window. */
  // passcode re-entered in the wizard when it is no longer in memory (memory only, never logged)
  const takePass = arg => { if (!S.pass && arg && arg.passcode) { S.pass = Buffer.from(String(arg.passcode), 'utf8'); arg.passcode = null; } };
  const needPass = () => { const e = new Error('NEED_PASSCODE: Enter the Apple passcode again to decrypt the downloaded files. Nothing is downloaded again.'); e.code = 'NEED_PASSCODE'; return e; };
  ipcMain.handle('apple:process', (_e, arg) => { takePass(arg); return single(async () => {
    if (S.scan && !S.pass && (S.scan.gpgs.length || (S.dl && S.dl.publicItems().some(i => i.status === 'verified')))) throw needPass();
    if (S.scan) return finishFolderNow(S.dl ? S.dl.publicItems().filter(i => i.status === 'verified') : []); // downloads started from a folder scan
    if (!S.outDir) throw new Error('No working folder is set for this import. Use "Open extracted Apple return folder" and pick the download folder to resume.');
    if (!S.pass) throw needPass();
    const outDir = S.outDir, prod = S.prod, gpg = S.gpg, pass = Buffer.from(S.pass);
    const log = S.log || (S.log = new core.CustodyLog(path.join(outDir, 'logs'), { examiner: S.examiner, appVersion: app.getVersion() }));
    const ok = (S.dl ? S.dl.publicItems() : []).filter(i => i.status === 'verified');
    let res;
    try { res = await processVerified({ items: ok, outDir, gpg, pass, log, prod, onStatus: m => send('apple:status', m) }); }
    finally { pass.fill(0); }
    if (!res.failed.length || res.failed.some(f => /Wrong passcode/i.test(f.error))) wipePass(); // a wrong passcode is asked for again; otherwise kept (memory only) only so "Retry parsing" can run after a failure; wiped on close
    log.write('import-complete', { result: `${ok.length} downloaded / ${res.decrypted} decrypted / ${res.failed.length} failed` });
    log.exportCsv();
    handoff(outDir, res.roots, res.coverage, res.backups.length);
    return res;
  }); });

  // ---- already-downloaded / extracted folder ----
  ipcMain.handle('apple:scan-folder', (_e, dir) => {
    notWhileRunning();
    reset();
    S.scan = core.scanAppleFolder(dir);
    const sc = S.scan;
    if (sc.production) { S.prod = sc.production; S.items = sc.missing; }
    return { dir: sc.dir, layouts: sc.layouts, accounts: sc.accounts, extracted: sc.extractedDirs.length + (sc.bashDirs || []).length, bashTypes: sc.bashTypes || [], zips: sc.zips.length, gpgs: sc.gpgs.length,
      duplicates: sc.skippedDuplicates, linkItems: sc.linkItems.length, missing: sc.missing.map(core.linkSafe), hasWorkbook: !!sc.workbook,
      expired: sc.missing.filter(i => i.expiresAt && i.expiresAt < Date.now()).length };
  });
  /** Import what is on disk; optionally download the missing linked files first (handled by the normal download flow). */
  ipcMain.handle('apple:folder-import', async (_e, { outDir, examiner, passcode, downloadMissing }) => {
    notWhileRunning();
    if (!outDir) throw new Error('Choose a working folder first.');
    if (!S.scan) throw new Error('Scan a folder first.');
    if (!S.gpg) S.gpg = core.findGpg(resourcesDir);
    if (passcode) { wipePass(); S.pass = Buffer.from(String(passcode), 'utf8'); passcode = null; }
    S.outDir = outDir; S.examiner = String(examiner || '').slice(0, 120);
    S.log = new core.CustodyLog(path.join(outDir, 'logs'), { examiner: S.examiner, appVersion: app.getVersion() });
    S.log.write('folder-import-start', { path: S.scan.dir, result: JSON.stringify(S.scan.layouts) });
    if ((S.scan.gpgs.length || (downloadMissing && S.items.length)) && !S.pass) throw new Error('Enter the passcode from Apple\'s email to decrypt the .gpg files.');
    if (S.scan.gpgs.length && !S.gpg) throw new Error('GnuPG was not found.');
    if (downloadMissing && S.items.length) {
      for (const f of core.walk(S.scan.production.root).filter(f => !/\.zip(\.gpg)?$/i.test(f) && !/(^|[\\/])\d+-[A-Z-]+-\d+([\\/]|$)/i.test(path.relative(S.scan.production.root, f)))) S.log.write('production-file', { file: path.relative(S.scan.production.root, f), bytes: fs.statSync(f).size, sha256: await core.sha256File(f) });
      return { download: true, items: S.items.map(core.linkSafe) };
    }
    return await single(() => finishFolderNow([]));
  });
  async function finishFolderNow(downloaded) {
    const scan = S.scan, outDir = S.outDir, gpg = S.gpg, pass = S.pass ? Buffer.from(S.pass) : null;
    if (!scan || !outDir) throw new Error('Choose the folder and a working folder first.');
    const log = S.log || (S.log = new core.CustodyLog(path.join(outDir, 'logs'), { examiner: S.examiner, appVersion: app.getVersion() }));
    try { return await finishFolderWith({ scan, outDir, gpg, pass, log, downloaded }); } finally { if (pass) pass.fill(0); }
  }
  async function finishFolderWith({ scan, outDir, gpg, pass, log, downloaded }) {
    const r1 = await core.importScannedFolder({ scan, outDir, gpg, pass, log, onStatus: m => send('apple:status', m) });
    const r2 = downloaded.length ? await processVerified({ items: downloaded, outDir, gpg, pass, log, prod: null, onStatus: m => send('apple:status', m) }) : null;
    // derived tables for every xlsx in all roots + the production workbook
    const derived = path.join(outDir, 'derived_tables');
    const jobs = [];
    if (scan.workbook) jobs.push({ src: scan.workbook, rel: '_production' });
    for (const root of r1.roots) for (const f of core.walk(root)) if (/\.xlsx$/i.test(f) && /^\d+(-[A-Z-]+-\d+)?$/i.test(path.relative(root, f).split(path.sep)[0])) jobs.push({ src: f, rel: path.dirname(path.relative(root, f)) });
    for (const j of jobs) {
      const target = path.join(derived, j.rel);
      if (fs.existsSync(target) && fs.readdirSync(target).some(n => n.startsWith(path.basename(j.src, '.xlsx') + '__'))) continue;
      try { await core.xlsxToCsvFiles(j.src, target, path.basename(j.src, '.xlsx')); log.write('derived-table', { file: path.basename(j.src) }); } catch (e) { log.write('derived-table-failed', { file: path.basename(j.src), error: e.message }); }
    }
    const roots = [...new Set([...r1.roots, ...(r2 ? [r2.roots.extracted] : [])])];
    const coverageMap = {};
    for (const root of roots) for (const a of core.summarizeExtracted(root)) {
      const c = coverageMap[a.account] || (coverageMap[a.account] = { ...a, types: {} });
      c.identifiers = [...new Set([...(c.identifiers || []), ...a.identifiers])]; c.phoneOnly = c.identifiers.length > 0 && c.identifiers.every(i => /^Ph_/i.test(i));
      for (const [t, v] of Object.entries(a.types)) c.types[t] = c.types[t] && c.types[t].status === 'data' ? c.types[t] : v;
    }
    const backups = roots.flatMap(r => core.detectBackups(r));
    const failed = [...r1.failed, ...(r2 ? r2.failed : [])];
    log.write('import-complete', { result: `${r1.extracted + (r2 ? r2.decrypted : 0)} extracted / ${failed.length} failed` });
    log.exportCsv();
    const out = { decrypted: r1.decrypted + (r2 ? r2.decrypted : 0), extracted: r1.extracted, failed, roots: { extracted: roots, derived }, backups, coverage: Object.values(coverageMap) };
    if (!failed.length) wipePass();
    handoff(outDir, out.roots, out.coverage, backups.length);
    return out;
  }
  ipcMain.handle('apple:folder-finish', (_e, arg) => { takePass(arg); if (!S.pass && S.dl && S.dl.publicItems().some(i => i.status === 'verified')) throw needPass(); return single(() => finishFolderNow(S.dl ? S.dl.publicItems().filter(i => i.status === 'verified') : [])); });

  ipcMain.handle('apple:open-folder', (_e, p) => shell.openPath(p || S.outDir || ''));
  ipcMain.handle('apple:cancel', () => { notWhileRunning(); reset(); return true; });

  ipcMain.on('uwrp-open-apple-import', (_e, mode) => open(mode));
  ipcMain.on('uwrp-open-apple-file', (_e, p) => {
    try { p = path.resolve(String(p || '')); if (!isGpgName(p) || !fs.statSync(p).isFile()) return; } catch { return; }
    open('', { file: p });
  });
  ipcMain.on('uwrp-open-apple-folder', (_e, d) => {
    try { d = path.resolve(String(d || '')); if (!fs.statSync(d).isDirectory()) return; } catch { return; }
    open('folder', { folder: d });
  });
  ipcMain.on('uwrp-open-apple-backups', (_e, root) => openBackups(root));
  ipcMain.handle('apple:backups', (_e, root) => core.detectBackups(root));

  // ---------- phase 2: iOS backup viewer (read-only) ----------
  const BK = require('./backup.cjs');
  const crypto = require('crypto');
  const open$ = new Map();            // dir -> IosBackup (only dirs found by apple:backup-list)
  const hashCache = new Map();        // physical path -> sha256
  let tagState = [];                  // tagged keys pushed by the main window
  const getBk = dir => { if (!open$.has(dir)) throw new Error('Unknown backup folder.'); let b = open$.get(dir); if (!b) { b = new BK.IosBackup(dir); open$.set(dir, b); } return b; };
  const hashOf = p => { if (!p) return ''; if (!hashCache.has(p)) { try { if (fs.statSync(p).isFile()) hashCache.set(p, BK.sha256File(p)); } catch { return ''; } } return hashCache.get(p) || ''; };
  function listBackups(roots) {
    const dirs = [...new Set([].concat(roots || []).filter(Boolean).flatMap(r => BK.findBackupDirs(r)))];
    return dirs.map(dir => { if (!open$.has(dir)) open$.set(dir, null); const b = getBk(dir); let counts = {}; try { counts = b.counts(); } catch {} return { dir, id: b.id, account: b.account, encrypted: b.encrypted, device: b.device(), counts, format: b.format, snapshot: b.snapshotSummary ? b.snapshotSummary() : null }; });
  }
  const zipInfo = new Map(); const tempDirs = [];
  const zipOf = r => typeof r !== 'string' || !r ? null : (/\.zip$/i.test(r) && fs.existsSync(r) && fs.statSync(r).isFile() ? { zip: r, inner: '' } : BK.splitZipPath(r));
  ipcMain.handle('apple:backup-list', async (_e, root) => {
    const z = !Array.isArray(root) && !(typeof root === 'string' && fs.existsSync(root) && fs.statSync(root).isDirectory()) ? zipOf(root) : null;
    if (z) { // Backup still inside a .zip (Explorer / Magnet show zips as folders). List entries only.
      let info = await BK.inspectZip(z.zip, z.inner); if (info.empty && z.inner) info = { ...(await BK.inspectZip(z.zip, '')), innerNotFound: z.inner };
      zipInfo.set(z.zip, info); return { zip: info, backups: [], root };
    }
    const list = listBackups(root); const det = [].concat(root || []).filter(Boolean).flatMap(r => { try { return core.detectBackups(r); } catch { return []; } }); return { backups: list, detected: det.length, root }; });
  ipcMain.handle('apple:backup-section', (_e, { dir, section, opts }) => {
    const b = getBk(dir);
    if (b.encrypted && section !== 'device' && section !== 'apps') return { encrypted: true };
    const fn = { device: () => b.device(), apps: () => b.apps(), messages: () => b.messages(), calls: () => b.calls(), contacts: () => b.contacts(), photos: () => b.photos(), notes: () => b.notes(), safari: () => b.safari(), calendar: () => b.calendar(), files: () => b.fileList(opts || {}) }[section];
    if (!fn) throw new Error('Unknown section'); return fn();
  });
  ipcMain.handle('apple:pick-backup-zip', async () => {
    const r = await dialog.showOpenDialog(backupWin || undefined, { title: 'Open a backup .zip', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  /** Extract a zip-contained backup to a working folder (user-chosen or temp). The zip is only read; CRC + SHA-256 checked. */
  ipcMain.handle('apple:backup-extract', async (_e, { zip, dest }) => {
    const info = zipInfo.get(zip); if (!info) throw new Error('Open the zip in the viewer first.');
    let d;
    if (dest) { d = path.join(dest, path.basename(zip).replace(/\.zip$/i, '') + '.extracted'); if (fs.existsSync(d)) d += '-' + Date.now(); }
    else { d = fs.mkdtempSync(path.join(app.getPath('temp'), 'uwrp-bkzip-')); tempDirs.push(d); }
    const r = await BK.extractZipBackup(zip, info.inner, d, m => backupWin && !backupWin.isDestroyed() && backupWin.webContents.send('apple:status', m));
    return { ...r, temp: !dest };
  });
  ipcMain.handle('apple:backup-preview', (_e, { dir, fileID }) => getBk(dir).preview(String(fileID)));
  ipcMain.handle('apple:backup-hash', (_e, { dir, fileID }) => { const b = getBk(dir); return hashOf(b.physical(String(fileID))); });
  /** Tags from the backup window: add SHA-256 of the original file, then hand to the main window (it saves them in the case DB). */
  ipcMain.handle('apple:backup-tag', (_e, { items, tagged }) => {
    const out = (items || []).slice(0, 20000).map(it => ({ key: String(it.key), meta: { ...(it.meta || {}), sha256: (it.meta && it.meta.sha256) || hashOf(it.meta && it.meta.path) } }));
    const mw = getMainWindow();
    if (!mw || mw.isDestroyed()) return { ok: false, error: 'Main window is not open.' };
    mw.webContents.send('uwrp-backup-tags', { items: out, tagged: !!tagged });
    const set = new Set(tagState); for (const it of out) tagged ? set.add(it.key) : set.delete(it.key); tagState = [...set];
    if (backupWin && !backupWin.isDestroyed()) backupWin.webContents.send('apple:tag-state', tagState);
    return { ok: true, count: out.length };
  });
  ipcMain.handle('apple:get-tag-state', () => tagState);
  ipcMain.on('uwrp-tag-state', (_e, keys) => { tagState = Array.isArray(keys) ? keys.filter(k => typeof k === 'string' && k.startsWith('backup:')) : []; if (backupWin && !backupWin.isDestroyed()) backupWin.webContents.send('apple:tag-state', tagState); });
  /** Main window: parsed backups per account + messages/calls for the timeline. */
  ipcMain.handle('apple:backup-summary', (_e, roots) => { const list = listBackups(roots); const events = list.flatMap(x => { try { return getBk(x.dir).timelineEvents(); } catch { return []; } }); return { backups: list, events }; });
  /** SHA-256 of an original file (read-only) for exhibit records. */
  ipcMain.handle('uwrp-hash-file', (_e, p) => typeof p === 'string' ? hashOf(p) : '');

  function openBackups(root) {
    if (backupWin && !backupWin.isDestroyed()) { backupWin.focus(); backupWin.webContents.send('apple:backup-root', root); return; }
    backupWin = new BrowserWindow({ width: 1280, height: 860, title: 'iOS / iCloud Backup Viewer', icon: iconPath,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'wizard-preload.cjs') } });
    backupWin.setMenuBarVisibility(false);
    backupWin.loadFile(path.join(__dirname, 'backups.html'), { query: { root: root || '' } });
    backupWin.on('closed', () => { backupWin = null; for (const b of open$.values()) if (b) b.close(); open$.clear(); zipInfo.clear();
      for (const d of tempDirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } }); // temp extracts only
  }

  return { open, openBackups };
}

async function processVerified({ items, outDir, gpg, pass, log, prod, onStatus }) {
  const decDir = path.join(outDir, 'decrypted');
  const exRoot = path.join(outDir, 'extracted');
  const derived = path.join(outDir, 'derived_tables');
  fs.mkdirSync(decDir, { recursive: true }); fs.mkdirSync(exRoot, { recursive: true });
  const failed = []; let decrypted = 0;
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    onStatus && onStatus(`Decrypting ${n + 1} of ${items.length}: ${it.name}`);
    const zip = path.join(decDir, it.name.replace(/\.gpg$/i, ''));
    try {
      if (!fs.existsSync(zip)) await core.gpgDecrypt(gpg, it.path, zip, pass);
      decrypted++;
      const zsha = await core.sha256File(zip);
      log && log.write('file-decrypt', { account: it.account, type: it.typeCode, file: path.basename(zip), sha256: zsha, result: 'ok' });
      const dest = path.join(exRoot, path.basename(zip).replace(/\.zip$/i, ''));
      const files = await core.extractZip(zip, dest);
      log && log.write('file-extract', { account: it.account, type: it.typeCode, file: path.basename(zip), result: `${files.length} files${files.repaired ? `, ${files.repaired.length} incomplete copies re-extracted` : ''}${files.failed ? `, ${files.failed.length} entries FAILED` : ''}`, path: dest });
      if (files.failed) failed.push(...files.failed.map(f => ({ name: it.name + ' › ' + f.name, error: f.error })));
    } catch (e) {
      failed.push({ name: it.name, error: e.message });
      log && log.write('file-decrypt-failed', { account: it.account, type: it.typeCode, file: it.name, error: e.message });
    }
  }
  // Derived CSV tables from spreadsheets (account workbook + per-type xlsx). Text only; originals untouched.
  onStatus && onStatus('Reading spreadsheets...');
  const xlsxJobs = [];
  if (prod && prod.accountWorkbook) xlsxJobs.push({ src: prod.accountWorkbook, rel: '_production' });
  for (const f of core.walk(exRoot)) if (/\.xlsx$/i.test(f)) xlsxJobs.push({ src: f, rel: path.dirname(path.relative(exRoot, f)) });
  for (const j of xlsxJobs) {
    try {
      const w = await core.xlsxToCsvFiles(j.src, path.join(derived, j.rel), path.basename(j.src, '.xlsx'));
      log && log.write('derived-table', { file: path.basename(j.src), result: `${w.length} sheet(s) -> csv` });
    } catch (e) { log && log.write('derived-table-failed', { file: path.basename(j.src), error: e.message }); }
  }
  const backups = core.detectBackups(exRoot);
  const coverage = core.summarizeExtracted(exRoot);
  return { decrypted, failed, roots: { extracted: exRoot, derived }, backups, coverage };
}

module.exports = { registerAppleImporter, processVerified };
