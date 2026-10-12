/**
 * Find every coordinate pair in JSON, CSV, and loose text.
 * Large files are read in chunks. The JSON walker keeps only the current
 * object path, sibling fields, and the hits themselves.
 */
import fs from 'fs';
import path from 'path';
import { validLatLng, type LocationRecord } from './locationRecord';

export interface TextHit {
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number | null;
  capturedAt: string | null;
  recordPath: string;
  coordSource: 'json' | 'csv' | 'text' | 'geojson';
}

export interface EventCoordSeed {
  sourceFile: string;
  lat: number;
  lng: number;
  capturedAt?: string | null;
}

const MAX_HITS = 100_000;
const MAX_DEPTH = 48;
const CHUNK = 256 * 1024;

const LAT_KEYS = new Set(['latitude', 'lat', 'gpslatitude']);
const LNG_KEYS = new Set(['longitude', 'lng', 'lon', 'long', 'gpslongitude']);
const LAT_E7 = new Set(['latitudee7']);
const LNG_E7 = new Set(['longitudee7']);
const ALT_KEYS = new Set(['altitude', 'alt', 'elevation', 'gpsaltitude']);
const ACC_KEYS = new Set(['accuracy', 'accuracymeters', 'horizontalaccuracy', 'accuracyradius']);
const TIME_KEYS = new Set(['timestamp', 'timestampms', 'time', 'datetime', 'datetimeoriginal', 'date', 'capturedat', 'creationtime', 'phototakentime']);

export function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface Frame {
  kind: 'object' | 'array';
  path: string;
  underCoordinates: boolean;
  isCoordinates: boolean;
  numbers: number[];
  onlyNumbers: boolean;
  nextIndex: number;
  pendingKey: string;
  lat?: number;
  lng?: number;
  latE7?: boolean;
  lngE7?: boolean;
  alt?: number;
  accuracy?: number;
  time?: string;
  pending: TextHit[];
}

export class JsonLocationScanner {
  hits: TextHit[] = [];
  private stack: Frame[] = [];
  private expect: 'value' | 'key' | 'colon' | 'comma' = 'value';
  private mode: 'none' | 'string' | 'number' | 'literal' = 'none';
  private buf = '';
  private escape = false;
  private stringIsKey = false;
  private skipDepth = 0;
  private done = false;

  push(chunk: string): void {
    if (this.done) return;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.mode === 'string') {
        if (this.escape) {
          if (this.buf.length < 240) this.buf += c === 'n' ? '\n' : c === 't' ? '\t' : c;
          this.escape = false;
          continue;
        }
        if (c === '\\') { this.escape = true; continue; }
        if (c === '"') {
          this.mode = 'none';
          this.finishString();
          continue;
        }
        if (this.buf.length < 240) this.buf += c;
        continue;
      }
      if (this.mode === 'number') {
        if (c === '-' || c === '+' || c === '.' || c === 'e' || c === 'E' || (c >= '0' && c <= '9')) {
          this.buf += c;
          continue;
        }
        this.finishNumber();
      }
      if (this.mode === 'literal') {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
          this.buf += c;
          continue;
        }
        this.finishLiteral();
      }
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') continue;
      if (c === '"') {
        this.mode = 'string';
        this.buf = '';
        this.escape = false;
        this.stringIsKey = this.expect === 'key';
        continue;
      }
      if (c === '-' || (c >= '0' && c <= '9')) {
        this.mode = 'number';
        this.buf = c;
        continue;
      }
      if (c === 't' || c === 'f' || c === 'n') {
        this.mode = 'literal';
        this.buf = c;
        continue;
      }
      if (c === '{' || c === '[') this.open(c);
      else if (c === '}' || c === ']') this.close(c);
      else if (c === ':') this.expect = 'value';
      else if (c === ',') this.comma();
      if (this.hits.length >= MAX_HITS) {
        this.done = true;
        return;
      }
    }
  }

  finish(): void {
    if (this.mode === 'number') this.finishNumber();
    if (this.mode === 'literal') this.finishLiteral();
    while (this.stack.length) this.close(this.stack[this.stack.length - 1].kind === 'array' ? ']' : '}');
  }

  private open(ch: '{' | '['): void {
    if (this.skipDepth > 0) {
      this.skipDepth++;
      return;
    }
    if (this.stack.length >= MAX_DEPTH) {
      this.skipDepth = 1;
      return;
    }
    const parent = this.stack[this.stack.length - 1];
    let path = '$';
    let key = '';
    if (parent) {
      parent.onlyNumbers = false;
      if (parent.kind === 'object') {
        key = parent.pendingKey || '';
        path = `${parent.path}.${key}`;
      } else {
        path = `${parent.path}[${parent.nextIndex}]`;
        parent.nextIndex += 1;
      }
    }
    const keyNorm = normKey(key);
    const isCoordinates = ch === '[' && !!parent && parent.kind === 'object' && keyNorm === 'coordinates';
    const under = !!(parent && (parent.isCoordinates || parent.underCoordinates));
    this.stack.push({
      kind: ch === '[' ? 'array' : 'object',
      path: parent ? path : '$',
      underCoordinates: under || isCoordinates,
      isCoordinates,
      numbers: [],
      onlyNumbers: ch === '[',
      nextIndex: 0,
      pendingKey: '',
      pending: [],
    });
    this.expect = ch === '{' ? 'key' : 'value';
  }

  private close(ch: '}' | ']'): void {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      return;
    }
    const frame = this.stack.pop();
    if (!frame) return;
    if ((ch === ']' && frame.kind !== 'array') || (ch === '}' && frame.kind !== 'object')) return;
    const hits = frame.pending;
    if (frame.kind === 'object') {
      let lat = frame.lat;
      let lng = frame.lng;
      if (lat != null && frame.latE7) lat = lat / 1e7;
      if (lng != null && frame.lngE7) lng = lng / 1e7;
      if (lat != null && lng != null && validLatLng(lat, lng)) {
        hits.push({
          lat,
          lng,
          alt: saneAlt(frame.alt),
          accuracy: saneAcc(frame.accuracy),
          capturedAt: frame.time || null,
          recordPath: frame.path,
          coordSource: 'json',
        });
      }
    } else if (frame.onlyNumbers && frame.numbers.length >= 2 && frame.numbers.length <= 4 && (frame.isCoordinates || frame.underCoordinates)) {
      const lng = frame.numbers[0];
      const lat = frame.numbers[1];
      const alt = frame.numbers.length >= 3 ? frame.numbers[2] : null;
      if (validLatLng(lat, lng)) {
        hits.push({
          lat,
          lng,
          alt: saneAlt(alt ?? undefined),
          accuracy: null,
          capturedAt: null,
          recordPath: frame.path,
          coordSource: 'geojson',
        });
      }
    }
    const parent = this.stack[this.stack.length - 1];
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (!hit.capturedAt && frame.time) hit.capturedAt = frame.time;
      if (hit.accuracy == null && frame.accuracy != null) hit.accuracy = saneAcc(frame.accuracy);
    }
    if (!parent) {
      for (let i = 0; i < hits.length && this.hits.length < MAX_HITS; i++) this.hits.push(hits[i]);
    } else {
      if (!parent.time && frame.time) parent.time = frame.time;
      if (parent.accuracy == null && frame.accuracy != null) parent.accuracy = frame.accuracy;
      if (parent.alt == null && frame.alt != null && frame.kind === 'object' && parent.kind === 'object') parent.alt = frame.alt;
      for (let i = 0; i < hits.length && parent.pending.length < MAX_HITS; i++) parent.pending.push(hits[i]);
    }
    this.expect = 'comma';
  }

  private comma(): void {
    const parent = this.stack[this.stack.length - 1];
    this.expect = parent && parent.kind === 'array' ? 'value' : 'key';
  }

  private finishString(): void {
    const value = this.buf;
    this.buf = '';
    if (this.stringIsKey) {
      const parent = this.stack[this.stack.length - 1];
      if (parent && parent.kind === 'object') parent.pendingKey = value;
      this.expect = 'colon';
      return;
    }
    this.applyValue(value, true);
  }

  private finishNumber(): void {
    const raw = this.buf;
    this.buf = '';
    this.mode = 'none';
    const n = Number(raw);
    this.applyValue(Number.isFinite(n) ? n : raw, false);
  }

  private finishLiteral(): void {
    this.buf = '';
    this.mode = 'none';
    const parent = this.stack[this.stack.length - 1];
    if (parent && parent.kind === 'array') parent.onlyNumbers = false;
    this.expect = 'comma';
  }

  private applyValue(value: string | number, fromString: boolean): void {
    const parent = this.stack[this.stack.length - 1];
    if (!parent) {
      this.expect = 'comma';
      return;
    }
    if (parent.kind === 'array') {
      if (typeof value === 'number') parent.numbers.push(value);
      else parent.onlyNumbers = false;
      parent.nextIndex += 1;
      this.expect = 'comma';
      return;
    }
    const key = normKey(parent.pendingKey);
    if (typeof value === 'number') {
      if (LAT_E7.has(key) || key.endsWith('latitudee7')) { parent.lat = value; parent.latE7 = true; }
      else if (LNG_E7.has(key) || key.endsWith('longitudee7')) { parent.lng = value; parent.lngE7 = true; }
      else if (LAT_KEYS.has(key)) parent.lat = value;
      else if (LNG_KEYS.has(key)) parent.lng = value;
      else if (ALT_KEYS.has(key)) parent.alt = value;
      else if (ACC_KEYS.has(key)) parent.accuracy = value;
      else if (TIME_KEYS.has(key)) parent.time = parent.time || numberTime(value);
    } else if (fromString) {
      const n = Number(value);
      if (Number.isFinite(n) && (LAT_KEYS.has(key) || LNG_KEYS.has(key) || LAT_E7.has(key) || LNG_E7.has(key))) {
        this.applyValue(n, false);
        return;
      }
      if (TIME_KEYS.has(key)) parent.time = parent.time || normalizeTime(value);
      if (key === 'latlng' || key === 'latlon' || key === 'geopoint') {
        const pair = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
        if (pair) {
          const lat = Number(pair[1]);
          const lng = Number(pair[2]);
          if (validLatLng(lat, lng)) {
            parent.lat = lat;
            parent.lng = lng;
          }
        }
      }
    }
    this.expect = 'comma';
  }
}

function saneAlt(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < -500 || value > 100000) return null;
  return value;
}

function saneAcc(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1e7) return null;
  return value;
}

function numberTime(n: number): string | null {
  if (!Number.isFinite(n) || n < 1_000_000_000) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100) return null;
  return d.toISOString();
}

function normalizeTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{10,13}$/.test(trimmed)) return numberTime(Number(trimmed));
  const ms = Date.parse(trimmed);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  return trimmed;
}

export function scanJsonText(text: string): TextHit[] {
  const scanner = new JsonLocationScanner();
  scanner.push(text);
  scanner.finish();
  return scanner.hits;
}

export function scanJsonFile(filePath: string): TextHit[] {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const scanner = new JsonLocationScanner();
    const dec = new TextDecoder('utf-8');
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    while (pos < size && scanner.hits.length < MAX_HITS) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      scanner.push(dec.decode(buf.subarray(0, n), { stream: true }));
      pos += n;
    }
    scanner.push(dec.decode());
    scanner.finish();
    return scanner.hits;
  } finally {
    fs.closeSync(fd);
  }
}

function parseCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function detectDelim(header: string): string {
  const comma = (header.match(/,/g) || []).length;
  const semi = (header.match(/;/g) || []).length;
  const tab = (header.match(/\t/g) || []).length;
  if (tab >= comma && tab >= semi && tab > 0) return '\t';
  if (semi > comma) return ';';
  return ',';
}

export function scanDelimitedText(text: string, delimHint?: string): TextHit[] {
  const hits: TextHit[] = [];
  const lines = text.split(/\r?\n/);
  let header: string[] | null = null;
  let delim = delimHint || ',';
  let latI = -1;
  let lngI = -1;
  let altI = -1;
  let accI = -1;
  let timeI = -1;
  let latE7 = false;
  let lngE7 = false;
  let row = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!header) {
      delim = delimHint || detectDelim(line);
      header = parseCsvLine(line, delim).map(c => normKey(c));
      latI = header.findIndex(h => LAT_KEYS.has(h) || LAT_E7.has(h));
      lngI = header.findIndex(h => LNG_KEYS.has(h) || LNG_E7.has(h));
      latE7 = latI >= 0 && (LAT_E7.has(header[latI]) || header[latI].endsWith('latitudee7'));
      lngE7 = lngI >= 0 && (LNG_E7.has(header[lngI]) || header[lngI].endsWith('longitudee7'));
      altI = header.findIndex(h => ALT_KEYS.has(h));
      accI = header.findIndex(h => ACC_KEYS.has(h));
      timeI = header.findIndex(h => TIME_KEYS.has(h));
      if (latI < 0 || lngI < 0) return [];
      continue;
    }
    row++;
    const cells = parseCsvLine(line, delim);
    let lat = Number(cells[latI]);
    let lng = Number(cells[lngI]);
    if (latE7) lat /= 1e7;
    if (lngE7) lng /= 1e7;
    if (!validLatLng(lat, lng)) continue;
    const alt = altI >= 0 ? saneAlt(Number(cells[altI])) : null;
    const accuracy = accI >= 0 ? saneAcc(Number(cells[accI])) : null;
    const capturedAt = timeI >= 0 ? normalizeTime(cells[timeI] || '') : null;
    hits.push({ lat, lng, alt, accuracy, capturedAt, recordPath: `row:${row + 1}`, coordSource: 'csv' });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}

export function scanDelimitedFile(filePath: string): TextHit[] {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const dec = new TextDecoder('utf-8');
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    let carry = '';
    const hits: TextHit[] = [];
    let header: string[] | null = null;
    let delim = ',';
    let latI = -1;
    let lngI = -1;
    let altI = -1;
    let accI = -1;
    let timeI = -1;
    let latE7 = false;
    let lngE7 = false;
    let dataRow = 0;
    const takeLine = (line: string) => {
      if (!line.trim()) return;
      if (!header) {
        delim = detectDelim(line);
        header = parseCsvLine(line, delim).map(c => normKey(c));
        latI = header.findIndex(h => LAT_KEYS.has(h) || LAT_E7.has(h));
        lngI = header.findIndex(h => LNG_KEYS.has(h) || LNG_E7.has(h));
        latE7 = latI >= 0 && LAT_E7.has(header[latI]);
        lngE7 = lngI >= 0 && LNG_E7.has(header[lngI]);
        altI = header.findIndex(h => ALT_KEYS.has(h));
        accI = header.findIndex(h => ACC_KEYS.has(h));
        timeI = header.findIndex(h => TIME_KEYS.has(h));
        return;
      }
      if (latI < 0 || lngI < 0) return;
      dataRow++;
      const cells = parseCsvLine(line, delim);
      let lat = Number(cells[latI]);
      let lng = Number(cells[lngI]);
      if (latE7) lat /= 1e7;
      if (lngE7) lng /= 1e7;
      if (!validLatLng(lat, lng)) return;
      hits.push({
        lat,
        lng,
        alt: altI >= 0 ? saneAlt(Number(cells[altI])) : null,
        accuracy: accI >= 0 ? saneAcc(Number(cells[accI])) : null,
        capturedAt: timeI >= 0 ? normalizeTime(cells[timeI] || '') : null,
        recordPath: `row:${dataRow + 1}`,
        coordSource: 'csv',
      });
    };
    while (pos < size && hits.length < MAX_HITS) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      carry += dec.decode(buf.subarray(0, n), { stream: true });
      let nl = carry.indexOf('\n');
      while (nl >= 0) {
        const line = carry.slice(0, nl).replace(/\r$/, '');
        carry = carry.slice(nl + 1);
        takeLine(line);
        nl = carry.indexOf('\n');
      }
      if (carry.length > 1_000_000) {
        takeLine(carry);
        carry = '';
      }
      pos += n;
    }
    carry += dec.decode();
    if (carry.trim()) takeLine(carry.replace(/\r$/, ''));
    if (latI < 0 || lngI < 0) return [];
    return hits;
  } finally {
    fs.closeSync(fd);
  }
}

export function scanLooseText(text: string): TextHit[] {
  const hits: TextHit[] = [];
  const latRe = /(?:gps[\s_]*)?lat(?:itude)?(?:e7)?\s*[:=]\s*"?(-?\d+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = latRe.exec(text)) && hits.length < MAX_HITS) {
    const window = text.slice(match.index, Math.min(text.length, match.index + 220));
    const lng = /(?:gps[\s_]*)?(?:lng|lon|long|longitude)(?:e7)?\s*[:=]\s*"?(-?\d+(?:\.\d+)?)/i.exec(window);
    if (!lng) continue;
    let la = Number(match[1]);
    let ln = Number(lng[1]);
    if (/e7/i.test(match[0])) la /= 1e7;
    if (/e7/i.test(lng[0])) ln /= 1e7;
    if (!validLatLng(la, ln)) continue;
    const line = text.slice(0, match.index).split(/\n/).length;
    hits.push({ lat: la, lng: ln, alt: null, accuracy: null, capturedAt: null, recordPath: `line:${line}`, coordSource: 'text' });
  }
  return hits;
}

export function scanLooseFile(filePath: string): TextHit[] {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const dec = new TextDecoder('utf-8');
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    let carry = '';
    const hits: TextHit[] = [];
    let lineNo = 1;
    while (pos < size && hits.length < MAX_HITS) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      carry += dec.decode(buf.subarray(0, n), { stream: true });
      if (carry.length > CHUNK * 2) {
        const chunkHits = scanLooseText(carry);
        for (let i = 0; i < chunkHits.length && hits.length < MAX_HITS; i++) {
          hits.push({ ...chunkHits[i], recordPath: `line:${lineNo}` });
        }
        lineNo += carry.split('\n').length;
        carry = carry.slice(-300);
      }
      pos += n;
    }
    carry += dec.decode();
    const rest = scanLooseText(carry);
    for (let i = 0; i < rest.length && hits.length < MAX_HITS; i++) hits.push(rest[i]);
    return hits;
  } finally {
    fs.closeSync(fd);
  }
}

export function scanTextFile(filePath: string): TextHit[] {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.json' || ext === '.geojson') return scanJsonFile(filePath);
    if (ext === '.csv' || ext === '.tsv') return scanDelimitedFile(filePath);
    if (ext === '.txt') return scanLooseFile(filePath);
  } catch {
    return [];
  }
  return [];
}

export function isSidecarForMedia(jsonName: string, jsonRel: string, mediaName: string, mediaRel: string): boolean {
  const jn = jsonName.toLowerCase();
  const mn = mediaName.toLowerCase();
  if (jn === `${mn}.json`) return true;
  const dot = mn.lastIndexOf('.');
  if (dot > 0 && jn === `${mn.slice(0, dot)}.json`) return true;
  if (jsonRel && mediaRel) {
    const jr = jsonRel.toLowerCase();
    const mr = mediaRel.toLowerCase();
    if (jr === `${mr}.json`) return true;
    const rd = mr.lastIndexOf('.');
    if (rd > 0 && jr === `${mr.slice(0, rd)}.json`) return true;
  }
  return false;
}

function looseTime(value?: string | null): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value.trim();
  return String(Math.floor(ms / 1000));
}

function sameFile(hitName: string, hitPath: string | null | undefined, source: string): boolean {
  const src = source.replace(/\\/g, '/').toLowerCase();
  const base = src.split('/').pop() || src;
  const name = hitName.toLowerCase();
  const rel = (hitPath || '').replace(/\\/g, '/').toLowerCase();
  return src === name || src === rel || base === name || base === rel.split('/').pop();
}

/** Drop text hits that repeat a coordinate an existing parser event already recorded. */
export function dedupeTextHits(hits: TextHit[], seeds: EventCoordSeed[], fileName: string, filePath?: string | null): TextHit[] {
  const used = new Set<number>();
  const kept: TextHit[] = [];
  for (let h = 0; h < hits.length; h++) {
    const hit = hits[h];
    let drop = false;
    for (let s = 0; s < seeds.length; s++) {
      if (used.has(s)) continue;
      const seed = seeds[s];
      if (!sameFile(fileName, filePath, seed.sourceFile)) continue;
      if (hit.lat.toFixed(5) !== seed.lat.toFixed(5) || hit.lng.toFixed(5) !== seed.lng.toFixed(5)) continue;
      if (seed.capturedAt && hit.capturedAt && looseTime(seed.capturedAt) !== looseTime(hit.capturedAt)) continue;
      used.add(s);
      drop = true;
      break;
    }
    if (!drop) kept.push(hit);
  }
  return kept;
}

export function eventSeedsFromEvents(events: Array<{ sourceFile?: string; timestamp?: string; details?: Record<string, unknown> }>): EventCoordSeed[] {
  const seeds: EventCoordSeed[] = [];
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const details = evt.details || {};
    let lat: number | null = null;
    let lng: number | null = null;
    if (details.latitude != null && details.longitude != null) {
      lat = Number(details.latitude);
      lng = Number(details.longitude);
    } else if (details.lat != null && (details.lng != null || details.lon != null)) {
      lat = Number(details.lat);
      lng = Number(details.lng ?? details.lon);
    }
    if (lat == null || lng == null || !validLatLng(lat, lng)) continue;
    seeds.push({ sourceFile: evt.sourceFile || '', lat, lng, capturedAt: evt.timestamp || null });
  }
  return seeds;
}

export function hitsToRecords(
  hits: TextHit[],
  fileName: string,
  filePath: string | null,
  kind: 'location-record' | 'sidecar',
  mediaName?: string | null
): LocationRecord[] {
  return hits.map(hit => ({
    kind,
    lat: hit.lat,
    lng: hit.lng,
    alt: hit.alt,
    accuracy: hit.accuracy,
    capturedAt: hit.capturedAt,
    device: null,
    coordSource: hit.coordSource,
    fileName,
    filePath,
    recordPath: hit.recordPath,
    mediaName: mediaName || null,
    eventId: null,
  }));
}
