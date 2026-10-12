import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import {
  migrate,
  listCases,
  loadWorkspace,
  loadEvents,
  saveWorkspace,
  deleteWorkspace,
  getLastCaseId,
  rememberLastCase,
  registerMediaPaths,
  isAllowedMediaPath,
  appendEventRows,
  storeTextContent,
  readStoredTextPreview,
  readStoredMedia,
  cacheMediaFile,
  removeMediaCache,
  loadCaseLocations,
  countCaseLocations,
  copyCaseLocations,
  insertForensicHashes,
  listHashSets,
  createHashSet,
  addHashSetEntries,
  deleteHashSet,
  matchHashSets,
} from "./src/lib/caseDatabase";
import { readMediaLocation } from "./src/lib/mediaLocation";
import { rescanCaseLocations } from "./src/lib/scanCaseLocations";
import { parseFileAtPath, readTextPreview } from "./src/lib/parseSourceFile";
import { cancelPortableExport, getPortableExport, startPortableExport } from "./src/lib/streamPortableCase";
import type { ForensicEvent, ProviderType } from "./src/types";
import { extractFrames, newJob } from "./src/lib/ffmpegFrames";

function appendErrorLog(logPath: string, level: string, message: string, detail?: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${level} ${message}${detail ? `\n${detail}` : ""}\n`;
    fs.appendFileSync(logPath, line);
  } catch (err) {
    console.error("Failed to write error log:", err);
  }
}

function hashFileDigests(filePath: string): Promise<{ md5: string; sha1: string; sha256: string }> {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash("md5");
    const sha1 = crypto.createHash("sha1");
    const sha256 = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => {
      md5.update(chunk);
      sha1.update(chunk);
      sha256.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({
      md5: md5.digest("hex"),
      sha1: sha1.digest("hex"),
      sha256: sha256.digest("hex"),
    }));
  });
}

function resolveStaticDir(): string {
  const built = path.resolve(process.cwd(), "dist");
  try {
    if (typeof __dirname === "string" && __dirname && __dirname !== "." && fs.existsSync(path.join(__dirname, "index.html"))) {
      return __dirname;
    }
  } catch {
    /* ESM source has no __dirname */
  }
  if (fs.existsSync(path.join(built, "index.html"))) return built;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    if (fs.existsSync(path.join(here, "index.html"))) return here;
  } catch {
    /* CJS bundle leaves import.meta empty */
  }
  return built;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json({ limit: "64mb" }));
  app.use(express.urlencoded({ limit: "32mb", extended: true }));

  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "database.sqlite");
  const dataDir = path.dirname(dbPath);
  const logPath = path.join(dataDir, "uwrp-errors.log");
  const mediaCacheRoot = path.join(dataDir, "media-cache");
  fs.mkdirSync(dataDir, { recursive: true });

  console.log(`[Backend] Initializing SQLite database at: ${dbPath}`);
  const db = new Database(dbPath);
  migrate(db);

  app.get("/api/diagnostics", (_req, res) => {
    res.json({
      logPath,
      logFileName: "uwrp-errors.log",
      databasePath: dbPath,
      logFolder: dataDir,
    });
  });

  app.post("/api/client-log", (req, res) => {
    const message = String(req.body?.message || "Client error");
    const detail = String(req.body?.detail || "");
    const source = String(req.body?.source || "renderer");
    appendErrorLog(logPath, source.toUpperCase(), message, detail);
    res.json({ success: true, logPath });
  });

  app.get("/api/session/last-case", (_req, res) => {
    try {
      res.json({ id: getLastCaseId(db) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cases", (_req, res) => {
    try {
      res.json(listCases(db));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cases/:id/events", (req, res) => {
    try {
      const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
      const limit = Math.min(2000, Math.max(1, parseInt(String(req.query.limit || "1000"), 10) || 1000));
      const events = loadEvents(db, req.params.id, offset, limit);
      res.json({ offset, limit, events });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/cases/:id/events", (req, res) => {
    try {
      const events = Array.isArray(req.body?.events) ? (req.body.events as ForensicEvent[]) : [];
      const offset = Math.max(0, parseInt(String(req.body?.offset || "0"), 10) || 0);
      const reset = !!req.body?.reset;
      const tx = db.transaction(() => {
        if (reset) db.prepare(`DELETE FROM case_events WHERE case_id = ?`).run(req.params.id);
        appendEventRows(db, req.params.id, events, offset);
        const count = (db.prepare(`SELECT COUNT(*) AS n FROM case_events WHERE case_id = ?`).get(req.params.id) as { n: number }).n;
        db.prepare(
          `INSERT INTO case_parse (case_id, signature, provider, accounts_json, account_changes_json, summary_json, account_info_json, event_count, complete)
           VALUES (?, '', '', '[]', '[]', 'null', 'null', ?, ?)
           ON CONFLICT(case_id) DO UPDATE SET event_count = excluded.event_count, complete = excluded.complete`
        ).run(req.params.id, count, req.body?.complete === false ? 0 : 1);
      });
      tx();
      res.json({ success: true, stored: events.length });
    } catch (err: any) {
      appendErrorLog(logPath, "SERVER", "Failed to store events", err.stack || err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cases/:id", (req, res) => {
    try {
      const workspace = loadWorkspace(db, req.params.id);
      if (!workspace) return res.status(404).json({ error: "Case not found" });
      res.json(workspace);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/cases", (req, res) => {
    try {
      if (!req.body?.id) return res.status(400).json({ error: "Case id is required" });
      saveWorkspace(db, {
        id: req.body.id,
        case_id_code: req.body.case_id_code,
        investigator_name: req.body.investigator_name,
        suspect_name: req.body.suspect_name,
        active_provider: req.body.active_provider,
        signature: req.body.signature,
        locationRev: Number(req.body.locationRev || 0),
        files: req.body.files,
        events: Array.isArray(req.body.events) ? req.body.events : undefined,
        accounts: req.body.accounts,
        accountChanges: req.body.accountChanges,
        summaryStats: req.body.summaryStats,
        accountInfo: req.body.accountInfo,
        evidence_tags: req.body.evidence_tags,
        keepEvents: req.body.keepEvents === true || !Array.isArray(req.body.events),
      });
      res.json({ success: true, id: req.body.id });
    } catch (err: any) {
      appendErrorLog(logPath, "SERVER", "Failed to save case", err.stack || err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/cases/:id", (req, res) => {
    try {
      deleteWorkspace(db, req.params.id);
      removeMediaCache(mediaCacheRoot, req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/media/register", (req, res) => {
    try {
      const paths = Array.isArray(req.body?.paths) ? req.body.paths.map((p: unknown) => String(p)) : [];
      const count = registerMediaPaths(db, paths);
      res.json({ success: true, count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/parse/source", (req, res) => {
    try {
      const sourcePath = String(req.body?.sourcePath || "");
      const name = String(req.body?.name || path.basename(sourcePath));
      const provider = String(req.body?.provider || "discord") as ProviderType;
      const relativePath = req.body?.relativePath ? String(req.body.relativePath) : undefined;
      if (!sourcePath || !isAllowedMediaPath(db, sourcePath)) {
        return res.status(403).json({ error: "Path is not registered for this case" });
      }
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        return res.status(404).json({ error: "Source file is missing", missing: true });
      }
      const parsed = parseFileAtPath(provider, name, sourcePath, relativePath);
      res.json(parsed);
    } catch (err: any) {
      appendErrorLog(logPath, "PARSE", `Failed to parse ${req.body?.name || "file"}`, err.stack || err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/text-preview", (req, res) => {
    try {
      const sourcePath = String(req.query.path || "");
      if (!sourcePath || !isAllowedMediaPath(db, sourcePath)) {
        return res.status(403).json({ error: "Path is not registered" });
      }
      if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: "File missing", missing: true });
      const text = readTextPreview(sourcePath, 8000);
      res.json({ text, truncated: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cases/:id/file-text", (req, res) => {
    try {
      const rel = String(req.query.rel || "");
      const name = String(req.query.name || "");
      const preview = readStoredTextPreview(db, req.params.id, rel, name, 8000);
      if (preview == null) return res.status(404).json({ error: "No stored text for this file" });
      res.json({ text: preview, truncated: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/cases/:id/file-text",
    express.text({ limit: "256mb", type: "*/*" }),
    (req, res) => {
      try {
        const name = decodeURIComponent(String(req.header("x-filename") || "pasted.txt"));
        const relativePath = decodeURIComponent(String(req.header("x-relative-path") || name));
        const provider = req.header("x-provider") ? decodeURIComponent(String(req.header("x-provider"))) : null;
        const content = typeof req.body === "string" ? req.body : "";
        storeTextContent(db, req.params.id, relativePath, name, content, content.length, provider);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/cases/:id/cache-media",
    express.raw({ limit: "512mb", type: "*/*" }),
    (req, res) => {
      try {
        const name = decodeURIComponent(String(req.header("x-filename") || "media.bin"));
        const relativePath = decodeURIComponent(String(req.header("x-relative-path") || name));
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
        const sourcePath = cacheMediaFile(mediaCacheRoot, req.params.id, relativePath, bytes);
        registerMediaPaths(db, [sourcePath]);
        res.json({ success: true, sourcePath, size: bytes.length });
      } catch (err: any) {
        appendErrorLog(logPath, "SERVER", "Failed to cache media", err.stack || err.message);
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get("/api/local-media", (req, res) => {
    try {
      const filePath = String(req.query.path || "");
      if (!filePath || !isAllowedMediaPath(db, filePath)) {
        return res.status(404).json({ missing: true, error: "Media is not available" });
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return res.status(404).json({ missing: true, error: "Media file missing" });
      }
      res.setHeader("Cache-Control", "no-store");
      const resolved = path.resolve(filePath);
      const head = Buffer.alloc(80);
      const fd = fs.openSync(resolved, "r");
      let read = 0;
      try {
        read = fs.readSync(fd, head, 0, head.length, 0);
      } finally {
        fs.closeSync(fd);
      }
      const sniff = head.subarray(0, read).toString("utf8").trimStart().toLowerCase();
      if (sniff.startsWith("<svg") || sniff.startsWith("<?xml")) {
        res.setHeader("Content-Type", "image/svg+xml");
        res.send(fs.readFileSync(resolved));
        return;
      }
      res.sendFile(resolved);
    } catch (err: any) {
      res.status(404).json({ missing: true, error: err.message });
    }
  });

  app.get("/api/cases/:id/stored-media", (req, res) => {
    try {
      const rel = String(req.query.rel || "");
      const name = String(req.query.name || "");
      const stored = readStoredMedia(db, req.params.id, rel, name);
      if (!stored) return res.status(404).json({ missing: true });
      res.setHeader("Cache-Control", "no-store");
      const dataUrl = stored.match(/^data:([^;]+);base64,([\s\S]+)$/);
      if (dataUrl) {
        res.setHeader("Content-Type", dataUrl[1]);
        res.send(Buffer.from(dataUrl[2], "base64"));
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.send(Buffer.from(stored));
    } catch (err: any) {
      res.status(404).json({ missing: true, error: err.message });
    }
  });

  // ffmpeg fallback preview frames (memory only; JPEGs returned in JSON, nothing written to disk)
  app.get("/api/media/frames", async (req, res) => {
    const job = newJob();
    res.on("close", () => { if (!res.writableEnded) job.kill(); });
    try {
      const src = String(req.query.src || "");
      const count = Number(req.query.count || 10);
      const u = new URL(src, "http://local");
      let input: { path?: string; bytes?: Buffer } | null = null;
      if (u.pathname === "/api/local-media") {
        const filePath = String(u.searchParams.get("path") || "");
        if (filePath && isAllowedMediaPath(db, filePath) && fs.existsSync(filePath)) input = { path: path.resolve(filePath) };
      } else {
        const m = u.pathname.match(/^\/api\/cases\/([^/]+)\/stored-media$/);
        if (m) {
          const stored = readStoredMedia(db, decodeURIComponent(m[1]), String(u.searchParams.get("rel") || ""), String(u.searchParams.get("name") || ""));
          if (stored) {
            const d = stored.match(/^data:([^;]+);base64,([\s\S]+)$/);
            input = { bytes: d ? Buffer.from(d[2], "base64") : Buffer.from(stored) };
          }
        }
      }
      if (!input) return res.status(404).json({ error: "Media is not available" });
      const out = await extractFrames(job, input, count);
      res.setHeader("Cache-Control", "no-store");
      res.json({ duration: out.duration, frames: out.frames.map(f => f.toString("base64")) });
    } catch (err: any) {
      if (!res.headersSent && !job.killed) res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/media/inspect", async (req, res) => {
    try {
      const filePath = String(req.query.path || "");
      if (!filePath || !isAllowedMediaPath(db, filePath)) {
        return res.status(404).json({ missing: true });
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return res.status(404).json({ missing: true });
      }
      const stat = fs.statSync(filePath);
      const digests = stat.size <= 15 * 1024 * 1024 ? await hashFileDigests(filePath) : null;
      const found = readMediaLocation(filePath);
      const gps = found && found.lat != null && found.lng != null ? { lat: found.lat, lng: found.lng } : null;
      res.json({
        md5: digests?.md5 || null,
        sha1: digests?.sha1 || null,
        sha256: digests?.sha256 || null,
        gps,
        gpsAlt: found?.alt ?? null,
        capturedAt: found?.capturedAt ?? null,
        device: found?.device ?? null,
        coordSource: found?.coordSource ?? null,
        size: stat.size,
        missing: false,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export a case as a downloadable SQLite file.
  app.get("/api/cases/:id/export", async (req, res) => {
    let tempDbPath = "";
    try {
      const { id } = req.params;
      const mediaOption = (req.query.mediaOption as string) || "all";
      const caseMeta = db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as any;
      if (!caseMeta) return res.status(404).json({ error: "Case not found" });
      const files = db.prepare("SELECT * FROM case_files WHERE case_id = ?").all(id) as any[];
      const tags = db.prepare("SELECT * FROM evidence_tags WHERE case_id = ?").all(id) as any[];
      const events = db.prepare("SELECT * FROM case_events WHERE case_id = ? ORDER BY event_index").all(id) as any[];
      const parseRow = db.prepare("SELECT * FROM case_parse WHERE case_id = ?").get(id);

      const taggedEventIds = new Set(tags.filter((t) => t.tagged === 1).map((t) => t.event_id as string));
      const safeCaseCode = (caseMeta.case_id_code || id).replace(/[^a-zA-Z0-9-_]/g, "_");
      tempDbPath = path.join(os.tmpdir(), `case_${safeCaseCode}_${Date.now()}.sqlite`);
      const tempDb = new Database(tempDbPath);
      migrate(tempDb);
      saveWorkspace(tempDb, {
        id: caseMeta.id,
        case_id_code: caseMeta.case_id_code,
        investigator_name: caseMeta.investigator_name,
        suspect_name: caseMeta.suspect_name,
        active_provider: caseMeta.active_provider,
        signature: caseMeta.parse_signature || (parseRow as any)?.signature || "",
        files: files
          .filter((f) => {
            if (f.is_media !== 1) return true;
            if (mediaOption === "none") return false;
            if (mediaOption === "tagged") {
              const fileKey = f.relative_path || f.name;
              return taggedEventIds.has(fileKey) || taggedEventIds.has(f.name);
            }
            return true;
          })
          .map((f) => ({
            name: f.name,
            relativePath: f.relative_path,
            size: f.size,
            isMedia: f.is_media === 1,
            mediaType: f.media_type,
            provider: f.provider,
            sourcePath: f.source_path,
            content: f.is_media === 1 ? "" : f.content,
            md5: f.md5,
            isScreenshot: f.is_screenshot === 1,
            skinTonePercent: f.skin_tone_percent,
            gps: f.gps_lat != null && f.gps_lng != null ? { lat: f.gps_lat, lng: f.gps_lng } : null,
            gpsAlt: f.gps_alt ?? null,
            capturedAt: f.captured_at || null,
            device: f.device || null,
            coordSource: f.coord_source || null,
            forensicsProcessed: f.forensics_processed === 1,
          })),
        events: events.map((e) => JSON.parse(e.event_json)),
        accounts: parseRow ? JSON.parse((parseRow as any).accounts_json || "[]") : [],
        accountChanges: parseRow ? JSON.parse((parseRow as any).account_changes_json || "[]") : [],
        summaryStats: parseRow ? JSON.parse((parseRow as any).summary_json || "null") : null,
        accountInfo: parseRow ? JSON.parse((parseRow as any).account_info_json || "null") : null,
        evidence_tags: Object.fromEntries(tags.map((t) => [t.event_id, { tagged: t.tagged === 1, notes: t.notes || "" }])),
        locationRev: Number(caseMeta.location_rev || 0),
      });
      copyCaseLocations(db, tempDb, id);
      tempDb.close();

      const optionSuffix = mediaOption === "tagged" ? "_tagged-media" : mediaOption === "none" ? "_no-media" : "";
      res.download(tempDbPath, `${safeCaseCode}${optionSuffix}_forensics.sqlite`, () => {
        if (tempDbPath && fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      });
    } catch (err: any) {
      if (tempDbPath && fs.existsSync(tempDbPath)) {
        try { fs.unlinkSync(tempDbPath); } catch { /* ignore */ }
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/cases/import", express.raw({ limit: "2gb", type: "*/*" }), async (req, res) => {
    let tempImportPath = "";
    try {
      const buffer = req.body;
      if (!buffer || buffer.length === 0) return res.status(400).json({ error: "Empty database file received" });
      tempImportPath = path.join(os.tmpdir(), `import_${Date.now()}.sqlite`);
      fs.writeFileSync(tempImportPath, buffer);
      let importDb: Database.Database;
      try {
        importDb = new Database(tempImportPath, { readonly: true });
      } catch {
        if (fs.existsSync(tempImportPath)) fs.unlinkSync(tempImportPath);
        return res.status(400).json({ error: "Invalid SQLite database file" });
      }
      let importedIds: string[] = [];
      try {
        const cases = importDb.prepare(`SELECT * FROM cases`).all() as any[];
        importedIds = cases.map((c) => c.id);
        const merge = db.transaction(() => {
          for (const id of importedIds) {
            const loaded = loadWorkspace(importDb, id);
            if (!loaded) continue;
            const events = loadEvents(importDb, id, 0, 1_000_000);
            const fileRows = importDb.prepare(`SELECT * FROM case_files WHERE case_id = ?`).all(id) as any[];
            saveWorkspace(db, {
              id,
              case_id_code: loaded.case_id_code,
              investigator_name: loaded.investigator_name,
              suspect_name: loaded.suspect_name,
              active_provider: loaded.active_provider,
              signature: loaded.signature,
              accounts: loaded.accounts,
              accountChanges: loaded.accountChanges,
              summaryStats: loaded.summaryStats || undefined,
              accountInfo: loaded.accountInfo || undefined,
              evidence_tags: loaded.evidence_tags,
              events,
              files: fileRows.map((f) => ({
                name: f.name,
                relativePath: f.relative_path,
                size: f.size,
                isMedia: f.is_media === 1,
                mediaType: f.media_type,
                provider: f.provider,
                sourcePath: f.source_path,
                content: f.is_media === 1 ? "" : f.content,
                md5: f.md5,
                sha1: f.sha1,
                sha256: f.sha256,
                isScreenshot: f.is_screenshot === 1,
                skinTonePercent: f.skin_tone_percent,
                gps: f.gps_lat != null && f.gps_lng != null ? { lat: f.gps_lat, lng: f.gps_lng } : null,
                gpsAlt: f.gps_alt ?? null,
                capturedAt: f.captured_at || null,
                device: f.device || null,
                coordSource: f.coord_source || null,
                forensicsProcessed: f.forensics_processed === 1,
              })),
              locationRev: Number(loaded.location_rev || 0),
            });
            copyCaseLocations(importDb, db, id);
          }
        });
        merge();
      } catch (dbErr: any) {
        importDb.close();
        if (fs.existsSync(tempImportPath)) fs.unlinkSync(tempImportPath);
        return res.status(400).json({ error: dbErr.message || "Invalid SQLite database or schema mismatch" });
      }
      importDb.close();
      if (fs.existsSync(tempImportPath)) fs.unlinkSync(tempImportPath);
      res.json({ success: true, imported_ids: importedIds });
    } catch (err: any) {
      if (tempImportPath && fs.existsSync(tempImportPath)) {
        try { fs.unlinkSync(tempImportPath); } catch { /* ignore */ }
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/forensic-hashes", (_req, res) => {
    try {
      const rows = db.prepare("SELECT md5 FROM forensic_hashes").all() as Array<{ md5: string }>;
      res.json(rows.map((r) => r.md5));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/forensic-hashes", (req, res) => {
    try {
      const { hashes } = req.body;
      if (!Array.isArray(hashes)) return res.status(400).json({ error: "Invalid hashes array" });
      const saved = insertForensicHashes(db, hashes.map((item: unknown) => String(item)));
      res.json({ success: true, count: hashes.length, added: saved.added, alreadyPresent: saved.alreadyPresent });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cases/:id/locations", (req, res) => {
    try {
      const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
      const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit || "2000"), 10) || 2000));
      res.json({
        total: countCaseLocations(db, req.params.id),
        offset,
        locations: loadCaseLocations(db, req.params.id, offset, limit),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/cases/:id/rescan-locations", (req, res) => {
    try {
      const files = Array.isArray(req.body?.files) ? req.body.files : undefined;
      const seeds = Array.isArray(req.body?.seeds) ? req.body.seeds : undefined;
      const result = rescanCaseLocations(db, req.params.id, { files, seeds });
      res.json(result);
    } catch (err: any) {
      appendErrorLog(logPath, "SERVER", "Location rescan failed", err?.stack || err?.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/portable-case", (req, res) => {
    try {
      const destPath = String(req.body?.destPath || "");
      if (!destPath) return res.status(400).json({ error: "Choose where to save the portable case." });
      const id = startPortableExport({
        db,
        viewerDir: path.join(resolveStaticDir(), "portable"),
        logError: (message, detail) => appendErrorLog(logPath, "PORTABLE", message, detail),
        request: {
          caseDbId: String(req.body?.caseDbId || ""),
          destPath,
          caseId: String(req.body?.caseId || ""),
          investigatorName: String(req.body?.investigatorName || ""),
          suspectName: String(req.body?.suspectName || ""),
          provider: String(req.body?.provider || ""),
          providerName: String(req.body?.providerName || ""),
          briefingText: String(req.body?.briefingText || ""),
          includeMetadata: req.body?.includeMetadata !== false,
          includeBriefing: req.body?.includeBriefing !== false,
          includeEvidenceTags: req.body?.includeEvidenceTags !== false,
          onlyTaggedExhibits: !!req.body?.onlyTaggedExhibits,
          includeAccountInfo: req.body?.includeAccountInfo !== false,
          includeMessages: req.body?.includeMessages !== false,
          includeIpAudit: req.body?.includeIpAudit !== false,
          includeGeoMap: req.body?.includeGeoMap !== false,
          includeFiles: req.body?.includeFiles !== false,
          includeAccountChanges: req.body?.includeAccountChanges !== false,
          redactIpAddresses: !!req.body?.redactIpAddresses,
          redactPii: !!req.body?.redactPii,
          passcode: String(req.body?.passcode || ""),
          evidenceTags: req.body?.evidenceTags && typeof req.body.evidenceTags === "object" ? req.body.evidenceTags : undefined,
        },
      });
      res.json({ id });
    } catch (err: any) {
      appendErrorLog(logPath, "PORTABLE", err?.message || "Could not start portable export", err?.stack || "");
      res.status(500).json({ error: err?.message || "Could not start portable export" });
    }
  });

  app.get("/api/portable-case/:id", (req, res) => {
    const job = getPortableExport(String(req.params.id));
    if (!job) return res.status(404).json({ error: "That export is no longer running." });
    res.json(job);
  });

  app.post("/api/portable-case/:id/cancel", (req, res) => {
    cancelPortableExport(String(req.params.id));
    const job = getPortableExport(String(req.params.id));
    res.json(job || { cancelled: true });
  });

  app.get("/api/hash-sets", (_req, res) => {
    try {
      res.json(listHashSets(db));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hash-sets", (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      const category = String(req.body?.category || "custom");
      if (!name) return res.status(400).json({ error: "Name the hash set before importing." });
      if (!["csam", "notable", "ignorable", "custom"].includes(category)) {
        return res.status(400).json({ error: "Unknown hash set category." });
      }
      const id = createHashSet(db, name, category);
      res.json({ id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hash-sets/:id/hashes", (req, res) => {
    try {
      const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes : null;
      if (!hashes) return res.status(400).json({ error: "Invalid hashes array" });
      const added = addHashSetEntries(db, req.params.id, hashes.map((item: unknown) => String(item)));
      res.json({ success: true, added });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/hash-sets/:id", (req, res) => {
    try {
      deleteHashSet(db, req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hash-sets/match", (req, res) => {
    try {
      const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes : null;
      if (!hashes) return res.status(400).json({ error: "Invalid hashes array" });
      if (hashes.length > 20000) return res.status(400).json({ error: "Send at most 20000 hashes at a time." });
      res.json(matchHashSets(db, hashes.map((item: unknown) => String(item))));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/forensic-hashes", (_req, res) => {
    try {
      db.prepare("DELETE FROM forensic_hashes").run();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.get("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const templatePath = path.resolve(process.cwd(), "index.html");
        let template = fs.readFileSync(templatePath, "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    // The packaged server is CommonJS next to index.html, so __dirname is that folder.
    // `tsx server.ts` is ESM: __dirname is missing or ".", and import.meta.url is this file.
    const distPath = resolveStaticDir();
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-stack Forensic Server running on http://localhost:${PORT}`);
  });
}

startServer();
