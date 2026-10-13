/**
 * SQLite persistence for parsed warrant returns.
 * Events and the media index are stored here so reopening a case does not
 * parse the original return again. Media file bytes are not copied in.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import type { ForensicEvent, ParseResult, ProviderType } from '../types';
import { normalizeHash } from './hashSets';

export type CaseDb = Database.Database;

export interface StoredFileInput {
  name: string;
  relativePath?: string;
  size?: number;
  isMedia?: boolean;
  mediaType?: string | null;
  provider?: string | null;
  sourcePath?: string | null;
  content?: string | null;
  md5?: string | null;
  sha1?: string | null;
  sha256?: string | null;
  isScreenshot?: boolean;
  skinTonePercent?: number | null;
  gps?: { lat: number; lng: number } | null;
  gpsAlt?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
  forensicsProcessed?: boolean;
  /** True only when md5, sha1, and sha256 were hashed from the original file bytes. */
  digestFromBytes?: boolean;
}

export interface StoredLocation {
  kind: string;
  lat: number;
  lng: number;
  alt?: number | null;
  accuracy?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
  fileName: string;
  filePath?: string | null;
  recordPath?: string | null;
  mediaName?: string | null;
  eventId?: string | null;
}

export interface SaveWorkspaceInput {
  id: string;
  case_id_code?: string;
  investigator_name?: string;
  suspect_name?: string;
  active_provider?: string;
  signature?: string;
  files?: StoredFileInput[];
  events?: ForensicEvent[];
  accounts?: ParseResult['accounts'];
  accountChanges?: ParseResult['accountChanges'];
  summaryStats?: ParseResult['summaryStats'];
  accountInfo?: ParseResult['accountInfo'];
  evidence_tags?: Record<string, { tagged?: boolean; notes?: string }>;
  /** When true, leave previously stored events in place (metadata-only update). */
  keepEvents?: boolean;
  /** Lower than the stored revision keeps location columns already written by a rescan. */
  locationRev?: number;
}

function addColumn(db: CaseDb, sql: string): void {
  try {
    db.exec(sql);
  } catch {
    /* column already exists */
  }
}

export function migrate(db: CaseDb): void {
  db.pragma('journal_mode = WAL');

  // Older builds keyed case_files by (case_id, name) and collapsed duplicates.
  try {
    const tableSqlObj = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'case_files'`).get() as { sql?: string } | undefined;
    const tableSql = tableSqlObj?.sql || '';
    if (tableSql && !tableSql.toLowerCase().includes('primary key (case_id, relative_path, name)')) {
      db.transaction(() => {
        db.exec(`ALTER TABLE case_files RENAME TO case_files_old;`);
        db.exec(`
          CREATE TABLE case_files (
            case_id TEXT,
            name TEXT,
            content TEXT,
            size INTEGER,
            is_media INTEGER,
            media_type TEXT,
            relative_path TEXT NOT NULL DEFAULT '',
            provider TEXT,
            PRIMARY KEY (case_id, relative_path, name),
            FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
          );
        `);
        db.exec(`
          INSERT INTO case_files (case_id, name, content, size, is_media, media_type, relative_path, provider)
          SELECT case_id, name, content, size, is_media, media_type, COALESCE(relative_path, ''), provider
          FROM case_files_old;
        `);
        db.exec(`DROP TABLE case_files_old;`);
      })();
    }
  } catch (err) {
    console.error('[Migration] case_files primary key migration skipped:', err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      case_id_code TEXT,
      investigator_name TEXT,
      suspect_name TEXT,
      active_provider TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS case_files (
      case_id TEXT,
      name TEXT,
      content TEXT,
      size INTEGER,
      is_media INTEGER,
      media_type TEXT,
      relative_path TEXT NOT NULL DEFAULT '',
      provider TEXT,
      PRIMARY KEY (case_id, relative_path, name),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evidence_tags (
      case_id TEXT,
      event_id TEXT,
      tagged INTEGER,
      notes TEXT,
      PRIMARY KEY (case_id, event_id),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS forensic_hashes (
      md5 TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS case_events (
      case_id TEXT NOT NULL,
      event_index INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY (case_id, event_index)
    );

    CREATE TABLE IF NOT EXISTS case_parse (
      case_id TEXT PRIMARY KEY,
      signature TEXT,
      provider TEXT,
      accounts_json TEXT,
      account_changes_json TEXT,
      summary_json TEXT,
      account_info_json TEXT,
      event_count INTEGER DEFAULT 0,
      complete INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS media_allow (
      path TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  addColumn(db, 'ALTER TABLE case_files ADD COLUMN provider TEXT');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN md5 TEXT');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN is_screenshot INTEGER');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN skin_tone_percent REAL');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN gps_lat REAL');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN gps_lng REAL');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN gps_alt REAL');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN captured_at TEXT');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN device TEXT');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN coord_source TEXT');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN forensics_processed INTEGER');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN source_path TEXT');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN sha1 TEXT');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN sha256 TEXT');
  addColumn(db, 'ALTER TABLE case_files ADD COLUMN digest_from_bytes INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS hash_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      hash_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS hash_set_entries (
      set_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (set_id, hash)
    );
    CREATE INDEX IF NOT EXISTS idx_hash_set_entries_hash ON hash_set_entries(hash);
  `);
  addColumn(db, 'ALTER TABLE cases ADD COLUMN parse_signature TEXT');
  addColumn(db, 'ALTER TABLE cases ADD COLUMN location_rev INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS case_locations (
      case_id TEXT NOT NULL,
      loc_index INTEGER NOT NULL,
      kind TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      alt REAL,
      accuracy REAL,
      captured_at TEXT,
      device TEXT,
      coord_source TEXT,
      file_name TEXT,
      file_path TEXT,
      record_path TEXT,
      media_name TEXT,
      event_id TEXT,
      PRIMARY KEY (case_id, loc_index)
    );
  `);
}

export function rememberLastCase(db: CaseDb, id: string | null): void {
  db.prepare(
    `INSERT INTO app_state (key, value) VALUES ('last_case_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(id || '');
}

export function getLastCaseId(db: CaseDb): string | null {
  const row = db.prepare(`SELECT value FROM app_state WHERE key = 'last_case_id'`).get() as { value?: string } | undefined;
  const id = row?.value?.trim();
  return id ? id : null;
}

export function registerMediaPaths(db: CaseDb, paths: string[]): number {
  const insert = db.prepare(`INSERT OR IGNORE INTO media_allow (path) VALUES (?)`);
  const tx = db.transaction((list: string[]) => {
    let n = 0;
    for (const p of list) {
      if (!p) continue;
      insert.run(p);
      n++;
    }
    return n;
  });
  return tx(paths);
}

export function isAllowedMediaPath(db: CaseDb, filePath: string): boolean {
  if (!filePath) return false;
  const allowed = db.prepare(`SELECT 1 AS ok FROM media_allow WHERE path = ?`).get(filePath) as { ok?: number } | undefined;
  if (allowed) return true;
  const stored = db.prepare(`SELECT 1 AS ok FROM case_files WHERE source_path = ? LIMIT 1`).get(filePath) as { ok?: number } | undefined;
  return !!stored;
}

export function listCases(db: CaseDb): unknown[] {
  return db.prepare(`SELECT * FROM cases ORDER BY updated_at DESC`).all();
}

function fileMissing(sourcePath: string | null | undefined, hasContent: boolean, isMedia: boolean): boolean {
  if (!isMedia) return false;
  if (sourcePath) {
    try {
      return !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile();
    } catch {
      return true;
    }
  }
  return !hasContent;
}

export interface LoadedWorkspace {
  id: string;
  case_id_code: string;
  investigator_name: string;
  suspect_name: string;
  active_provider: string;
  created_at: string;
  updated_at: string;
  signature: string;
  fromSavedParse: boolean;
  event_count: number;
  files: Array<Record<string, unknown>>;
  evidence_tags: Record<string, { tagged: boolean; notes: string }>;
  accounts: ParseResult['accounts'];
  accountChanges: ParseResult['accountChanges'];
  summaryStats: ParseResult['summaryStats'] | null;
  accountInfo: ParseResult['accountInfo'] | null;
  location_rev: number;
  location_count: number;
}

export function loadWorkspace(db: CaseDb, id: string): LoadedWorkspace | null {
  const caseMeta = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!caseMeta) return null;
  const files = db.prepare(
    `SELECT name, relative_path, size, is_media, media_type, provider, md5, sha1, sha256, is_screenshot,
            skin_tone_percent, gps_lat, gps_lng, gps_alt, captured_at, device, coord_source,
            forensics_processed, source_path, digest_from_bytes,
            CASE WHEN content IS NOT NULL AND length(content) > 0 THEN 1 ELSE 0 END AS has_content
     FROM case_files WHERE case_id = ? ORDER BY relative_path, name`
  ).all(id) as Array<Record<string, unknown>>;

  const tags = db.prepare(`SELECT * FROM evidence_tags WHERE case_id = ?`).all(id) as Array<Record<string, unknown>>;
  const parseRow = db.prepare(`SELECT * FROM case_parse WHERE case_id = ?`).get(id) as Record<string, unknown> | undefined;
  const eventCountRow = db.prepare(`SELECT COUNT(*) AS n FROM case_events WHERE case_id = ?`).get(id) as { n: number };

    const formattedFiles = files.map(f => {
    const isMedia = f.is_media === 1;
    const sourcePath = (f.source_path as string) || '';
    const hasContent = f.has_content === 1;
    const gpsLat = f.gps_lat as number | null;
    const gpsLng = f.gps_lng as number | null;
    const digestFromBytes = f.digest_from_bytes === 1;
    let mediaMissing = false;
    let hasStoredBytes = false;
    if (isMedia) {
      const onDisk = sourcePath ? !fileMissing(sourcePath, true, true) : false;
      if (onDisk) {
        mediaMissing = false;
      } else if (hasContent) {
        mediaMissing = false;
        hasStoredBytes = true;
      } else {
        mediaMissing = true;
      }
    }
    return {
      name: f.name,
      relativePath: f.relative_path || '',
      size: f.size || 0,
      isMedia,
      mediaType: f.media_type || null,
      provider: f.provider || null,
      sourcePath: sourcePath || null,
      md5: digestFromBytes ? (f.md5 || null) : null,
      sha1: digestFromBytes ? (f.sha1 ?? null) : null,
      sha256: digestFromBytes ? (f.sha256 ?? null) : null,
      isScreenshot: f.is_screenshot === 1,
      skinTonePercent: f.skin_tone_percent ?? null,
      gps: gpsLat != null && gpsLng != null ? { lat: gpsLat, lng: gpsLng } : null,
      gpsAlt: f.gps_alt ?? null,
      capturedAt: (f.captured_at as string) || null,
      device: (f.device as string) || null,
      coordSource: (f.coord_source as string) || null,
      forensicsProcessed: digestFromBytes && f.forensics_processed === 1,
      digestFromBytes,
      mediaMissing,
      hasStoredBytes,
      content: '',
    };
  });

  const evidenceTags: Record<string, { tagged: boolean; notes: string }> = {};
  for (const t of tags) {
    evidenceTags[String(t.event_id)] = {
      tagged: t.tagged === 1,
      notes: (t.notes as string) || '',
    };
  }

  const parseJson = <T,>(value: unknown, fallback: T): T => {
    if (typeof value !== 'string' || !value) return fallback;
    try { return JSON.parse(value) as T; } catch { return fallback; }
  };

  const eventCount = eventCountRow?.n || 0;
  const locationCountRow = db.prepare(`SELECT COUNT(*) AS n FROM case_locations WHERE case_id = ?`).get(id) as { n: number } | undefined;
  return {
    id: String(caseMeta.id),
    case_id_code: String(caseMeta.case_id_code || ''),
    investigator_name: String(caseMeta.investigator_name || ''),
    suspect_name: String(caseMeta.suspect_name || ''),
    active_provider: String(caseMeta.active_provider || 'discord'),
    created_at: String(caseMeta.created_at || ''),
    updated_at: String(caseMeta.updated_at || ''),
    signature: String(parseRow?.signature || caseMeta.parse_signature || ''),
    fromSavedParse: eventCount > 0,
    event_count: eventCount,
    files: formattedFiles,
    evidence_tags: evidenceTags,
    accounts: parseJson(parseRow?.accounts_json, [] as ParseResult['accounts']),
    accountChanges: parseJson(parseRow?.account_changes_json, [] as ParseResult['accountChanges']),
    summaryStats: parseJson(parseRow?.summary_json, null),
    accountInfo: parseJson(parseRow?.account_info_json, null),
    location_rev: Number(caseMeta.location_rev || 0),
    location_count: locationCountRow?.n || 0,
  };
}

export function loadEvents(db: CaseDb, id: string, offset: number, limit: number): ForensicEvent[] {
  const rows = db.prepare(
    `SELECT event_json FROM case_events WHERE case_id = ? ORDER BY event_index LIMIT ? OFFSET ?`
  ).all(id, limit, offset) as Array<{ event_json: string }>;
  const events: ForensicEvent[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    events[i] = JSON.parse(rows[i].event_json) as ForensicEvent;
  }
  return events;
}

export function saveWorkspace(db: CaseDb, input: SaveWorkspaceInput): void {
  const now = new Date().toISOString();
  const id = input.id;
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO cases (id, case_id_code, investigator_name, suspect_name, active_provider, created_at, updated_at, parse_signature)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM cases WHERE id = ?), ?), ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         case_id_code = excluded.case_id_code,
         investigator_name = excluded.investigator_name,
         suspect_name = excluded.suspect_name,
         active_provider = excluded.active_provider,
         updated_at = excluded.updated_at,
         parse_signature = excluded.parse_signature`
    ).run(
      id,
      input.case_id_code || '',
      input.investigator_name || '',
      input.suspect_name || '',
      input.active_provider || 'discord',
      id,
      now,
      now,
      input.signature || ''
    );

    if (Array.isArray(input.files)) {
      const priorRows = db.prepare(
        `SELECT relative_path, name, gps_lat, gps_lng, gps_alt, captured_at, device, coord_source
         FROM case_files WHERE case_id = ?`
      ).all(id) as Array<Record<string, unknown>>;
      const priorLoc = new Map<string, Record<string, unknown>>();
      for (const row of priorRows) priorLoc.set(`${row.relative_path || ''}::${row.name}`, row);
      const revRow = db.prepare(`SELECT location_rev FROM cases WHERE id = ?`).get(id) as { location_rev?: number } | undefined;
      const keepLocations = (input.locationRev ?? 0) < Number(revRow?.location_rev || 0);

      db.prepare(`DELETE FROM case_files WHERE case_id = ?`).run(id);
      const insertFile = db.prepare(
        `INSERT OR REPLACE INTO case_files (
           case_id, name, content, size, is_media, media_type, relative_path, provider,
           md5, is_screenshot, skin_tone_percent, gps_lat, gps_lng, gps_alt, captured_at, device, coord_source,
           forensics_processed, source_path, sha1, sha256, digest_from_bytes
         ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const file of input.files) {
        const isMedia = !!file.isMedia;
        // Never persist media bytes. Text content is stored only when there is
        // no on-disk source to re-read (pasted text). It is not returned in bulk.
        const fromBytes = !!file.digestFromBytes;
        const content = isMedia ? '' : (file.sourcePath ? '' : (file.content || ''));
        const prior = priorLoc.get(`${file.relativePath || ''}::${file.name}`);
        const gpsLat = keepLocations && prior ? prior.gps_lat : (file.gps?.lat ?? null);
        const gpsLng = keepLocations && prior ? prior.gps_lng : (file.gps?.lng ?? null);
        const gpsAlt = keepLocations && prior ? prior.gps_alt : (file.gpsAlt ?? null);
        const capturedAt = keepLocations && prior ? prior.captured_at : (file.capturedAt ?? null);
        const device = keepLocations && prior ? prior.device : (file.device ?? null);
        const coordSource = keepLocations && prior ? prior.coord_source : (file.coordSource ?? null);
        insertFile.run(
          id,
          file.name,
          content,
          file.size || 0,
          isMedia ? 1 : 0,
          file.mediaType || null,
          file.relativePath || '',
          file.provider || null,
          fromBytes ? (file.md5 || null) : null,
          file.isScreenshot ? 1 : 0,
          file.skinTonePercent ?? null,
          gpsLat ?? null,
          gpsLng ?? null,
          gpsAlt ?? null,
          capturedAt ?? null,
          device ?? null,
          coordSource ?? null,
          fromBytes && file.forensicsProcessed ? 1 : 0,
          file.sourcePath || null,
          fromBytes ? (file.sha1 ?? null) : null,
          fromBytes ? (file.sha256 ?? null) : null,
          fromBytes ? 1 : 0
        );
        if (file.sourcePath) {
          db.prepare(`INSERT OR IGNORE INTO media_allow (path) VALUES (?)`).run(file.sourcePath);
        }
      }
    }

    db.prepare(`DELETE FROM evidence_tags WHERE case_id = ?`).run(id);
    if (input.evidence_tags && typeof input.evidence_tags === 'object') {
      const insertTag = db.prepare(
        `INSERT INTO evidence_tags (case_id, event_id, tagged, notes) VALUES (?, ?, ?, ?)`
      );
      for (const [eventId, tagInfo] of Object.entries(input.evidence_tags)) {
        if (!tagInfo) continue;
        const notes = tagInfo.notes || '';
        if (tagInfo.tagged || notes.trim()) {
          insertTag.run(id, eventId, tagInfo.tagged ? 1 : 0, notes);
        }
      }
    }

    if (!input.keepEvents && Array.isArray(input.events)) {
      replaceEvents(db, id, input.events);
    }

    db.prepare(
      `INSERT INTO case_parse (
         case_id, signature, provider, accounts_json, account_changes_json, summary_json, account_info_json, event_count, complete
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(case_id) DO UPDATE SET
         signature = excluded.signature,
         provider = excluded.provider,
         accounts_json = excluded.accounts_json,
         account_changes_json = excluded.account_changes_json,
         summary_json = excluded.summary_json,
         account_info_json = excluded.account_info_json,
         event_count = excluded.event_count,
         complete = 1`
    ).run(
      id,
      input.signature || '',
      input.active_provider || '',
      JSON.stringify(input.accounts || []),
      JSON.stringify(input.accountChanges || []),
      JSON.stringify(input.summaryStats || null),
      JSON.stringify(input.accountInfo || null),
      Array.isArray(input.events) ? input.events.length : (db.prepare(`SELECT COUNT(*) AS n FROM case_events WHERE case_id = ?`).get(id) as { n: number }).n
    );

    rememberLastCase(db, id);
  });
  tx();
}

export function replaceEvents(db: CaseDb, caseId: string, events: ForensicEvent[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM case_events WHERE case_id = ?`).run(caseId);
    appendEventRows(db, caseId, events, 0);
  });
  tx();
}

export function appendEventRows(db: CaseDb, caseId: string, events: ForensicEvent[], offset: number): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO case_events (case_id, event_index, event_json) VALUES (?, ?, ?)`
  );
  for (let i = 0; i < events.length; i++) {
    insert.run(caseId, offset + i, JSON.stringify(events[i]));
  }
}

export function storeTextContent(db: CaseDb, caseId: string, relativePath: string, name: string, content: string, size: number, provider: string | null): void {
  db.prepare(
    `INSERT INTO case_files (case_id, name, content, size, is_media, media_type, relative_path, provider)
     VALUES (?, ?, ?, ?, 0, NULL, COALESCE(?, ''), ?)
     ON CONFLICT(case_id, relative_path, name) DO UPDATE SET content = excluded.content, size = excluded.size`
  ).run(caseId, name, content, size, relativePath || '', provider);
}

export function readStoredTextPreview(db: CaseDb, caseId: string, relativePath: string, name: string, maxChars: number): string | null {
  const row = db.prepare(
    `SELECT substr(content, 1, ?) AS preview FROM case_files
     WHERE case_id = ? AND relative_path = ? AND name = ?`
  ).get(maxChars, caseId, relativePath || '', name) as { preview?: string } | undefined;
  return row?.preview ?? null;
}

export function readStoredMedia(db: CaseDb, caseId: string, relativePath: string, name: string): string | null {
  const row = db.prepare(
    `SELECT content FROM case_files WHERE case_id = ? AND relative_path = ? AND name = ? AND is_media = 1`
  ).get(caseId, relativePath || '', name) as { content?: string } | undefined;
  return row?.content || null;
}

export function replaceCaseLocations(db: CaseDb, caseId: string, rows: StoredLocation[]): number {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM case_locations WHERE case_id = ?`).run(caseId);
    const insert = db.prepare(
      `INSERT INTO case_locations (
         case_id, loc_index, kind, lat, lng, alt, accuracy, captured_at, device, coord_source,
         file_name, file_path, record_path, media_name, event_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      insert.run(
        caseId,
        i,
        row.kind,
        row.lat,
        row.lng,
        row.alt ?? null,
        row.accuracy ?? null,
        row.capturedAt ?? null,
        row.device ?? null,
        row.coordSource ?? null,
        row.fileName || '',
        row.filePath ?? null,
        row.recordPath ?? null,
        row.mediaName ?? null,
        row.eventId ?? null
      );
    }
  });
  tx();
  return rows.length;
}

export function loadCaseLocations(db: CaseDb, caseId: string, offset: number, limit: number): StoredLocation[] {
  const rows = db.prepare(
    `SELECT kind, lat, lng, alt, accuracy, captured_at, device, coord_source, file_name, file_path, record_path, media_name, event_id
     FROM case_locations WHERE case_id = ? ORDER BY loc_index LIMIT ? OFFSET ?`
  ).all(caseId, limit, offset) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    kind: String(row.kind),
    lat: Number(row.lat),
    lng: Number(row.lng),
    alt: row.alt == null ? null : Number(row.alt),
    accuracy: row.accuracy == null ? null : Number(row.accuracy),
    capturedAt: (row.captured_at as string) || null,
    device: (row.device as string) || null,
    coordSource: (row.coord_source as string) || null,
    fileName: String(row.file_name || ''),
    filePath: (row.file_path as string) || null,
    recordPath: (row.record_path as string) || null,
    mediaName: (row.media_name as string) || null,
    eventId: (row.event_id as string) || null,
  }));
}

export function countCaseLocations(db: CaseDb, caseId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM case_locations WHERE case_id = ?`).get(caseId) as { n: number } | undefined;
  return row?.n || 0;
}

export function setLocationRev(db: CaseDb, caseId: string, rev: number): void {
  db.prepare(`UPDATE cases SET location_rev = ? WHERE id = ?`).run(rev, caseId);
}

export function copyCaseLocations(from: CaseDb, to: CaseDb, caseId: string): void {
  let rows: StoredLocation[] = [];
  try {
    rows = loadCaseLocations(from, caseId, 0, 200_000);
  } catch {
    return;
  }
  replaceCaseLocations(to, caseId, rows);
  try {
    const rev = from.prepare(`SELECT location_rev FROM cases WHERE id = ?`).get(caseId) as { location_rev?: number } | undefined;
    setLocationRev(to, caseId, Number(rev?.location_rev || 0));
  } catch {
    /* older export */
  }
}

export function deleteWorkspace(db: CaseDb, id: string): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM case_events WHERE case_id = ?`).run(id);
    db.prepare(`DELETE FROM case_parse WHERE case_id = ?`).run(id);
    db.prepare(`DELETE FROM evidence_tags WHERE case_id = ?`).run(id);
    db.prepare(`DELETE FROM case_locations WHERE case_id = ?`).run(id);
    db.prepare(`DELETE FROM case_files WHERE case_id = ?`).run(id);
    db.prepare(`DELETE FROM cases WHERE id = ?`).run(id);
    const last = getLastCaseId(db);
    if (last === id) rememberLastCase(db, null);
  });
  tx();
}

export function cacheMediaFile(root: string, caseId: string, relativePath: string, bytes: Buffer): string {
  const safeRel = (relativePath || 'media.bin').replace(/\\/g, '/').split('/').filter(seg => seg && seg !== '.' && seg !== '..').join('/');
  const dest = path.resolve(root, caseId, safeRel);
  const rootResolved = path.resolve(root);
  if (!dest.startsWith(rootResolved + path.sep) && dest !== rootResolved) {
    throw new Error('Refusing to write outside the media cache');
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  return dest;
}

export function removeMediaCache(root: string, caseId: string): void {
  const dest = path.resolve(root, caseId);
  const rootResolved = path.resolve(root);
  if (!dest.startsWith(rootResolved + path.sep)) return;
  fs.rmSync(dest, { recursive: true, force: true });
}

export interface StoredHashSet {
  id: string;
  name: string;
  category: string;
  hashCount: number;
  createdAt: string;
}

export function listHashSets(db: CaseDb): StoredHashSet[] {
  const rows = db.prepare(
    `SELECT id, name, category, hash_count, created_at FROM hash_sets ORDER BY created_at, name`
  ).all() as Array<{ id: string; name: string; category: string; hash_count: number; created_at: string }>;
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    category: row.category,
    hashCount: row.hash_count || 0,
    createdAt: row.created_at || '',
  }));
}

export function insertForensicHashes(
  db: CaseDb,
  hashes: readonly string[]
): { added: number; alreadyPresent: number } {
  let added = 0;
  let accepted = 0;
  const tx = db.transaction((rows: readonly string[]) => {
    const stmt = db.prepare('INSERT OR IGNORE INTO forensic_hashes (md5) VALUES (?)');
    for (let i = 0; i < rows.length; i++) {
      const hex = normalizeHash(String(rows[i] || ''));
      if (!hex) continue;
      accepted++;
      const info = stmt.run(hex);
      added += Number(info.changes) || 0;
    }
  });
  tx(hashes);
  return { added, alreadyPresent: accepted - added };
}

export function createHashSet(db: CaseDb, name: string, category: string): string {
  const id = `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `INSERT INTO hash_sets (id, name, category, created_at, hash_count) VALUES (?, ?, ?, ?, 0)`
  ).run(id, name.trim() || 'Hash set', category || 'custom', new Date().toISOString());
  return id;
}

export function addHashSetEntries(db: CaseDb, setId: string, hashes: readonly string[]): number {
  const exists = db.prepare(`SELECT id FROM hash_sets WHERE id = ?`).get(setId);
  if (!exists) return 0;
  const insert = db.prepare(`INSERT OR IGNORE INTO hash_set_entries (set_id, hash) VALUES (?, ?)`);
  let added = 0;
  const tx = db.transaction((rows: readonly string[]) => {
    for (let i = 0; i < rows.length; i++) {
      const hash = normalizeHash(String(rows[i] || ''));
      if (!hash) continue;
      const info = insert.run(setId, hash);
      added += info.changes;
    }
  });
  tx(hashes);
  db.prepare(
    `UPDATE hash_sets SET hash_count = (SELECT COUNT(*) FROM hash_set_entries WHERE set_id = ?) WHERE id = ?`
  ).run(setId, setId);
  return added;
}

export function deleteHashSet(db: CaseDb, setId: string): void {
  db.prepare(`DELETE FROM hash_set_entries WHERE set_id = ?`).run(setId);
  db.prepare(`DELETE FROM hash_sets WHERE id = ?`).run(setId);
}

export interface HashInventoryRow {
  id: string;
  name: string;
  category: string;
  total: number;
  md5: number;
  sha1: number;
  sha256: number;
}

function countRow(row: { total?: number | null; md5?: number | null; sha1?: number | null; sha256?: number | null }) {
  return {
    total: Number(row?.total) || 0,
    md5: Number(row?.md5) || 0,
    sha1: Number(row?.sha1) || 0,
    sha256: Number(row?.sha256) || 0,
  };
}

/** How many MD5, SHA-1, and SHA-256 values are loaded for Project VIC and each named set. */
export function hashInventory(db: CaseDb): { vic: { total: number; md5: number; sha1: number; sha256: number }; sets: HashInventoryRow[] } {
  const vic = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN length(md5) = 32 THEN 1 ELSE 0 END) AS md5,
            SUM(CASE WHEN length(md5) = 40 THEN 1 ELSE 0 END) AS sha1,
            SUM(CASE WHEN length(md5) = 64 THEN 1 ELSE 0 END) AS sha256
     FROM forensic_hashes`
  ).get() as { total?: number | null; md5?: number | null; sha1?: number | null; sha256?: number | null };
  const sets = db.prepare(
    `SELECT s.id AS id, s.name AS name, s.category AS category,
            COUNT(e.hash) AS total,
            SUM(CASE WHEN length(e.hash) = 32 THEN 1 ELSE 0 END) AS md5,
            SUM(CASE WHEN length(e.hash) = 40 THEN 1 ELSE 0 END) AS sha1,
            SUM(CASE WHEN length(e.hash) = 64 THEN 1 ELSE 0 END) AS sha256
     FROM hash_sets s
     LEFT JOIN hash_set_entries e ON e.set_id = s.id
     GROUP BY s.id
     ORDER BY s.created_at, s.name`
  ).all() as Array<{ id: string; name: string; category: string; total?: number | null; md5?: number | null; sha1?: number | null; sha256?: number | null }>;
  return {
    vic: countRow(vic || {}),
    sets: sets.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category,
      ...countRow(row),
    })),
  };
}

export function matchHashSets(db: CaseDb, hashes: readonly string[]): Array<{ hash: string; setId: string; name: string; category: string }> {
  const clean: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < hashes.length; i++) {
    const hash = normalizeHash(String(hashes[i] || ''));
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    clean.push(hash);
  }
  const out: Array<{ hash: string; setId: string; name: string; category: string }> = [];
  const batch = 400;
  for (let i = 0; i < clean.length; i += batch) {
    const slice = clean.slice(i, i + batch);
    const marks = slice.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT e.hash AS hash, s.id AS setId, s.name AS name, s.category AS category
       FROM hash_set_entries e
       JOIN hash_sets s ON s.id = e.set_id
       WHERE e.hash IN (${marks})`
    ).all(...slice) as Array<{ hash: string; setId: string; name: string; category: string }>;
    for (let r = 0; r < rows.length; r++) out.push(rows[r]);
  }
  return out;
}

export interface HashAudit {
  uniqueLoaded: number;
  uniqueMatched: number;
  notFound: string[];
}

/** Loaded VIC and named-set hashes compared with digests computed from file bytes. */
export function hashAudit(db: CaseDb, computed: readonly string[]): HashAudit {
  const rows = db.prepare(
    `SELECT hash FROM (
       SELECT md5 AS hash FROM forensic_hashes
       UNION
       SELECT hash AS hash FROM hash_set_entries
     )`
  ).all() as Array<{ hash: string }>;
  const have = new Set<string>();
  for (let i = 0; i < computed.length; i++) {
    const hex = normalizeHash(String(computed[i] || ''));
    if (hex) have.add(hex);
  }
  const seen = new Set<string>();
  const notFound: string[] = [];
  let uniqueMatched = 0;
  for (let i = 0; i < rows.length; i++) {
    const hex = normalizeHash(String(rows[i]?.hash || ''));
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    if (have.has(hex)) uniqueMatched += 1;
    else notFound.push(hex);
  }
  notFound.sort();
  return { uniqueLoaded: seen.size, uniqueMatched, notFound };
}
