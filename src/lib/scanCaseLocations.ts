/**
 * Read media headers and text files for one saved case. One file is open at a time.
 */
import fs from 'fs';
import type { CaseDb } from './caseDatabase';
import { countCaseLocations, replaceCaseLocations, setLocationRev, type StoredLocation } from './caseDatabase';
import { readMediaLocation } from './mediaLocation';
import {
  dedupeTextHits,
  eventSeedsFromEvents,
  hitsToRecords,
  isSidecarForMedia,
  scanDelimitedText,
  scanJsonText,
  scanLooseText,
  scanTextFile,
  type EventCoordSeed,
} from './textLocations';

export interface ScanFileRef {
  name: string;
  relativePath?: string | null;
  sourcePath?: string | null;
  isMedia?: boolean;
  mediaType?: string | null;
}

export interface MediaLocationPatch {
  name: string;
  relativePath: string;
  gps: { lat: number; lng: number } | null;
  gpsAlt: number | null;
  capturedAt: string | null;
  device: string | null;
  coordSource: string | null;
}

const TEXT_EXT = new Set(['.json', '.geojson', '.csv', '.tsv', '.txt']);

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function rescanCaseLocations(
  db: CaseDb,
  caseId: string,
  opts?: { files?: ScanFileRef[]; seeds?: EventCoordSeed[] }
): { locationRev: number; locationCount: number; media: MediaLocationPatch[] } {
  const files = opts?.files && opts.files.length
    ? opts.files
    : (db.prepare(
      `SELECT name, relative_path AS relativePath, source_path AS sourcePath, is_media AS isMedia, media_type AS mediaType
       FROM case_files WHERE case_id = ?`
    ).all(caseId) as Array<Record<string, unknown>>).map(row => ({
      name: String(row.name),
      relativePath: (row.relativePath as string) || '',
      sourcePath: (row.sourcePath as string) || null,
      isMedia: row.isMedia === 1,
      mediaType: (row.mediaType as string) || null,
    }));

  const mediaFiles = files.filter(f => f.isMedia);
  const patches: MediaLocationPatch[] = [];
  const update = db.prepare(
    `UPDATE case_files
     SET gps_lat = ?, gps_lng = ?, gps_alt = ?, captured_at = ?, device = ?, coord_source = ?
     WHERE case_id = ? AND relative_path = ? AND name = ?`
  );

  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    const source = file.sourcePath || '';
    if (!source || !fs.existsSync(source)) continue;
    const found = readMediaLocation(source);
    const lat = found?.lat ?? null;
    const lng = found?.lng ?? null;
    const patch: MediaLocationPatch = {
      name: file.name,
      relativePath: file.relativePath || '',
      gps: lat != null && lng != null ? { lat, lng } : null,
      gpsAlt: found?.alt ?? null,
      capturedAt: found?.capturedAt ?? null,
      device: found?.device ?? null,
      coordSource: found?.coordSource ?? null,
    };
    patches.push(patch);
    update.run(
      patch.gps?.lat ?? null,
      patch.gps?.lng ?? null,
      patch.gpsAlt,
      patch.capturedAt,
      patch.device,
      patch.coordSource,
      caseId,
      patch.relativePath,
      patch.name
    );
  }

  const seeds: EventCoordSeed[] = [...(opts?.seeds || [])];
  const eventStmt = db.prepare(`SELECT event_json FROM case_events WHERE case_id = ?`);
  for (const row of eventStmt.iterate(caseId) as Iterable<{ event_json: string }>) {
    try {
      const evt = JSON.parse(row.event_json) as { sourceFile?: string; timestamp?: string; details?: Record<string, unknown> };
      const found = eventSeedsFromEvents([evt]);
      if (found.length) seeds.push(found[0]);
    } catch {
      /* skip a bad row */
    }
  }

  const locations: StoredLocation[] = [];
  const textFiles = files.filter(f => !f.isMedia && TEXT_EXT.has(extOf(f.name)));
  for (let i = 0; i < textFiles.length; i++) {
    const file = textFiles[i];
    const source = file.sourcePath || '';
    let hits = source && fs.existsSync(source) ? scanTextFile(source) : [];
    if (!hits.length && !source) {
      const stored = db.prepare(
        `SELECT content FROM case_files WHERE case_id = ? AND relative_path = ? AND name = ?`
      ).get(caseId, file.relativePath || '', file.name) as { content?: string } | undefined;
      const content = stored?.content || '';
      if (content) {
        const ext = extOf(file.name);
        if (ext === '.json' || ext === '.geojson') hits = scanJsonText(content);
        else if (ext === '.csv' || ext === '.tsv') hits = scanDelimitedText(content, ext === '.tsv' ? '\t' : undefined);
        else hits = scanLooseText(content);
      }
    }
    hits = dedupeTextHits(hits, seeds, file.name, file.relativePath || file.name);
    let kind: 'sidecar' | 'location-record' = 'location-record';
    let mediaName: string | null = null;
    for (let m = 0; m < mediaFiles.length; m++) {
      const media = mediaFiles[m];
      if (isSidecarForMedia(file.name, file.relativePath || '', media.name, media.relativePath || '')) {
        kind = 'sidecar';
        mediaName = media.name;
        break;
      }
    }
    const records = hitsToRecords(hits, file.name, file.relativePath || null, kind, mediaName);
    for (let h = 0; h < records.length && locations.length < 100_000; h++) locations.push(records[h]);
  }

  replaceCaseLocations(db, caseId, locations);
  const revRow = db.prepare(`SELECT location_rev FROM cases WHERE id = ?`).get(caseId) as { location_rev?: number } | undefined;
  const locationRev = Number(revRow?.location_rev || 0) + 1;
  setLocationRev(db, caseId, locationRev);
  return { locationRev, locationCount: countCaseLocations(db, caseId), media: patches };
}
