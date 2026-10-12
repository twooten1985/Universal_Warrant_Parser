/**
 * Read GPS and capture metadata from images and videos without loading the
 * whole file. Image readers stop at the compressed image data. Video readers
 * walk box headers and only pull small metadata atoms (the moov tree), skipping
 * mdat payloads.
 */
import fs from 'fs';
import path from 'path';
import { validLatLng, type MediaLocation } from './locationRecord';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.dng']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.3gp', '.3gpp']);
const MAX_ATOM = 512 * 1024;
const MAX_XMP = 512 * 1024;
const MAX_SEGMENT = 8 * 1024 * 1024;

interface Reader {
  size: number;
  bytesRead: number;
  read(pos: number, len: number): Buffer;
}

function fileReader(fd: number, size: number): Reader {
  const reader: Reader = {
    size,
    bytesRead: 0,
    read(pos: number, len: number) {
      if (len <= 0 || pos >= size || pos < 0) return Buffer.alloc(0);
      const n = Math.min(len, size - pos, MAX_SEGMENT);
      const buf = Buffer.alloc(n);
      const got = fs.readSync(fd, buf, 0, n, pos);
      reader.bytesRead += got;
      return got === n ? buf : buf.subarray(0, got);
    },
  };
  return reader;
}

function bufferReader(buf: Buffer): Reader {
  return {
    size: buf.length,
    bytesRead: buf.length,
    read(pos: number, len: number) {
      if (pos < 0 || len <= 0 || pos >= buf.length) return Buffer.alloc(0);
      return buf.subarray(pos, Math.min(buf.length, pos + len));
    },
  };
}

function emptyLocation(bytesRead = 0): MediaLocation {
  return { lat: null, lng: null, alt: null, capturedAt: null, device: null, coordSource: null, bytesRead };
}

export function readMediaLocation(filePath: string): MediaLocation | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 16) return emptyLocation(0);
    const reader = fileReader(fd, size);
    const found = IMAGE_EXT.has(ext) ? readImage(reader, ext) : readVideo(reader);
    found.bytesRead = reader.bytesRead;
    return found;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function readImage(reader: Reader, ext: string): MediaLocation {
  if (ext === '.jpg' || ext === '.jpeg') return readJpeg(reader);
  if (ext === '.png') return readPng(reader);
  if (ext === '.webp') return readWebp(reader);
  if (ext === '.heic' || ext === '.heif') return readHeif(reader);
  return readTiffFile(reader);
}

interface PartialLoc {
  lat?: number | null;
  lng?: number | null;
  alt?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
}

function mergeLoc(base: PartialLoc, extra: PartialLoc, sourceIfCoords: string): PartialLoc {
  const out = { ...base };
  const extraHas = extra.lat != null && extra.lng != null && validLatLng(extra.lat, extra.lng);
  const baseHas = out.lat != null && out.lng != null && validLatLng(out.lat, out.lng);
  if (!baseHas && extraHas) {
    out.lat = extra.lat;
    out.lng = extra.lng;
    out.coordSource = sourceIfCoords;
  }
  if (out.alt == null && extra.alt != null && Number.isFinite(extra.alt)) out.alt = extra.alt;
  if (!out.capturedAt && extra.capturedAt) out.capturedAt = extra.capturedAt;
  if (!out.device && extra.device) out.device = extra.device;
  return out;
}

function finish(part: PartialLoc, bytesRead = 0): MediaLocation {
  const lat = part.lat ?? null;
  const lng = part.lng ?? null;
  const ok = lat != null && lng != null && validLatLng(lat, lng);
  return {
    lat: ok ? lat : null,
    lng: ok ? lng : null,
    alt: part.alt != null && Number.isFinite(part.alt) ? part.alt : null,
    capturedAt: part.capturedAt || null,
    device: part.device || null,
    coordSource: ok ? (part.coordSource || null) : null,
    bytesRead,
  };
}

function readJpeg(reader: Reader): MediaLocation {
  const soi = reader.read(0, 2);
  if (soi.length < 2 || soi[0] !== 0xff || soi[1] !== 0xd8) return emptyLocation(reader.bytesRead);
  let pos = 2;
  let part: PartialLoc = {};
  let guard = 0;
  while (pos + 4 <= reader.size && guard++ < 5000) {
    const mark = reader.read(pos, 4);
    if (mark.length < 4 || mark[0] !== 0xff) break;
    let p = 1;
    while (p < mark.length && mark[p] === 0xff) p++;
    if (p >= mark.length) {
      pos += mark.length;
      continue;
    }
    const marker = mark[p];
    const headerAt = pos + p + 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos = headerAt;
      continue;
    }
    const lenBuf = reader.read(headerAt, 2);
    if (lenBuf.length < 2) break;
    const segLen = lenBuf.readUInt16BE(0);
    if (segLen < 2) break;
    const payloadLen = segLen - 2;
    const payloadAt = headerAt + 2;
    if (marker === 0xe1 && payloadLen > 0 && payloadLen <= MAX_SEGMENT) {
      const payload = reader.read(payloadAt, payloadLen);
      if (payload.length >= 6 && payload.toString('ascii', 0, 4) === 'Exif') {
        const tiff = payload.subarray(6);
        part = mergeLoc(part, parseTiff(bufferReader(tiff), 0, tiff.length), 'exif');
      } else {
        const xmp = xmpFromApp1(payload);
        if (xmp) part = mergeLoc(part, parseXmp(xmp), 'xmp');
      }
    }
    pos = payloadAt + payloadLen;
  }
  return finish(part, reader.bytesRead);
}

function xmpFromApp1(payload: Buffer): string | null {
  const sig = 'http://ns.adobe.com/xap/1.0/\0';
  const head = payload.toString('latin1', 0, Math.min(payload.length, 64));
  if (!head.startsWith(sig)) return null;
  return payload.subarray(sig.length).toString('utf8');
}

function readPng(reader: Reader): MediaLocation {
  const sig = reader.read(0, 8);
  if (sig.toString('hex') !== '89504e470d0a1a0a') return emptyLocation(reader.bytesRead);
  let pos = 8;
  let part: PartialLoc = {};
  let guard = 0;
  while (pos + 8 <= reader.size && guard++ < 10000) {
    const hdr = reader.read(pos, 8);
    if (hdr.length < 8) break;
    const len = hdr.readUInt32BE(0);
    const type = hdr.toString('ascii', 4, 8);
    if (len > reader.size || pos + 12 + len > reader.size + 12) break;
    if (type === 'IDAT' || type === 'IEND') break;
    if ((type === 'eXIf' || type === 'iTXt' || type === 'tEXt' || type === 'zTXt') && len > 0 && len <= MAX_XMP) {
      const data = reader.read(pos + 8, len);
      if (type === 'eXIf') {
        part = mergeLoc(part, parseTiff(bufferReader(data), 0, data.length), 'exif');
      } else {
        const text = data.toString('latin1');
        if (text.includes('xmp') || text.includes('GPS')) {
          const xmlAt = text.indexOf('<');
          if (xmlAt >= 0) part = mergeLoc(part, parseXmp(text.slice(xmlAt)), 'xmp');
        }
      }
    }
    pos += 12 + len;
  }
  return finish(part, reader.bytesRead);
}

function readWebp(reader: Reader): MediaLocation {
  const hdr = reader.read(0, 12);
  if (hdr.toString('ascii', 0, 4) !== 'RIFF' || hdr.toString('ascii', 8, 12) !== 'WEBP') return emptyLocation(reader.bytesRead);
  let pos = 12;
  let part: PartialLoc = {};
  let guard = 0;
  while (pos + 8 <= reader.size && guard++ < 10000) {
    const ch = reader.read(pos, 8);
    if (ch.length < 8) break;
    const fourcc = ch.toString('ascii', 0, 4);
    const size = ch.readUInt32LE(4);
    const padded = size + (size % 2);
    if (size > reader.size) break;
    if ((fourcc === 'EXIF' || fourcc === 'XMP ') && size > 0 && size <= MAX_XMP) {
      const data = reader.read(pos + 8, size);
      if (fourcc === 'EXIF') part = mergeLoc(part, parseTiff(bufferReader(data), 0, data.length), 'exif');
      else part = mergeLoc(part, parseXmp(data.toString('utf8')), 'xmp');
    }
    pos += 8 + padded;
  }
  return finish(part, reader.bytesRead);
}

function readTiffFile(reader: Reader): MediaLocation {
  return finish(parseTiff(reader, 0, reader.size), reader.bytesRead);
}

function parseTiff(reader: Reader, base: number, length: number): PartialLoc {
  const head = reader.read(base, 8);
  if (head.length < 8) return {};
  const order = head.toString('ascii', 0, 2);
  if (order !== 'II' && order !== 'MM') return {};
  const le = order === 'II';
  const magic = le ? head.readUInt16LE(2) : head.readUInt16BE(2);
  if (magic !== 42) return {};
  const ifd0 = le ? head.readUInt32LE(4) : head.readUInt32BE(4);
  const part: PartialLoc = {};
  const visit = (offset: number, depth: number) => {
    if (depth > 4 || offset <= 0 || offset + 2 > length) return;
    const countBuf = reader.read(base + offset, 2);
    if (countBuf.length < 2) return;
    const count = Math.min(le ? countBuf.readUInt16LE(0) : countBuf.readUInt16BE(0), 256);
    const entries = reader.read(base + offset + 2, count * 12);
    let gpsPtr = 0;
    let exifPtr = 0;
    for (let i = 0; i < count; i++) {
      const e = entries.subarray(i * 12, i * 12 + 12);
      if (e.length < 12) break;
      const tag = u16(e, 0, le);
      const type = u16(e, 2, le);
      const n = u32(e, 4, le);
      const value = readTag(reader, base, length, e, type, n, le);
      if (tag === 0x010f && value.text) part.device = joinDevice(value.text, part.device, true);
      if (tag === 0x0110 && value.text) part.device = joinDevice(part.device, value.text, false);
      if (tag === 0x0132 && value.text && !part.capturedAt) part.capturedAt = exifDate(value.text);
      if (tag === 0x8769) exifPtr = value.long || 0;
      if (tag === 0x8825) gpsPtr = value.long || 0;
      if (tag === 0x02bc && value.bytes) {
        const xml = value.bytes.toString('utf8');
        const xmp = parseXmp(xml);
        if (xmp.lat != null && part.lat == null) {
          part.lat = xmp.lat;
          part.lng = xmp.lng;
          part.coordSource = 'xmp';
        }
        if (part.alt == null && xmp.alt != null) part.alt = xmp.alt;
        if (!part.capturedAt && xmp.capturedAt) part.capturedAt = xmp.capturedAt;
        if (!part.device && xmp.device) part.device = xmp.device;
      }
      if (tag === 0x0001 && value.text) part.device = part.device;
      applyGpsTag(part, tag, value);
    }
    if (exifPtr) readExifIfd(reader, base, length, exifPtr, le, part);
    if (gpsPtr) readGpsIfd(reader, base, length, gpsPtr, le, part);
  };
  visit(ifd0, 0);
  if (part.lat != null && part.lng != null && validLatLng(part.lat, part.lng) && !part.coordSource) part.coordSource = 'exif';
  return part;
}

function joinDevice(make: string | null | undefined, model: string | null | undefined, makeFirst: boolean): string {
  const a = (make || '').replace(/\0/g, '').trim();
  const b = (model || '').replace(/\0/g, '').trim();
  if (makeFirst) {
    if (a && b && !b.toLowerCase().startsWith(a.toLowerCase())) return `${a} ${b}`.trim();
    return (b || a).trim();
  }
  if (a && b && !a.toLowerCase().includes(b.toLowerCase())) return `${a} ${b}`.trim();
  return (a || b).trim();
}

interface TagValue {
  text?: string;
  long?: number;
  rationals?: number[];
  bytes?: Buffer;
}

function u16(buf: Buffer, off: number, le: boolean): number {
  return le ? buf.readUInt16LE(off) : buf.readUInt16BE(off);
}
function u32(buf: Buffer, off: number, le: boolean): number {
  return le ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
}
function i32(buf: Buffer, off: number, le: boolean): number {
  return le ? buf.readInt32LE(off) : buf.readInt32BE(off);
}

function typeSize(type: number): number {
  switch (type) {
    case 1: return 1;
    case 2: return 1;
    case 3: return 2;
    case 4: return 4;
    case 5: return 8;
    case 9: return 4;
    case 10: return 8;
    default: return 0;
  }
}

function readTag(reader: Reader, base: number, length: number, entry: Buffer, type: number, count: number, le: boolean): TagValue {
  const size = typeSize(type) * count;
  if (size <= 0 || size > MAX_XMP || count > 5_000_000) return {};
  let raw: Buffer;
  if (size <= 4) raw = entry.subarray(8, 8 + size);
  else {
    const off = u32(entry, 8, le);
    if (off <= 0 || off >= length) return {};
    raw = reader.read(base + off, size);
  }
  if (raw.length < Math.min(size, 1)) return {};
  if (type === 2) return { text: raw.toString('utf8').replace(/\0/g, '').trim(), bytes: type === 2 ? undefined : raw };
  if (type === 1 && count === 1) return { long: raw[0] };
  if (type === 3 && count === 1 && raw.length >= 2) return { long: u16(raw, 0, le) };
  if ((type === 4 || type === 9) && count === 1 && raw.length >= 4) return { long: type === 9 ? i32(raw, 0, le) : u32(raw, 0, le) };
  if (type === 5 || type === 10) {
    const rationals: number[] = [];
    for (let i = 0; i + 8 <= raw.length; i += 8) {
      const num = type === 10 ? i32(raw, i, le) : u32(raw, i, le);
      const den = type === 10 ? i32(raw, i + 4, le) : u32(raw, i + 4, le);
      rationals.push(den ? num / den : 0);
    }
    return { rationals };
  }
  if (type === 1 || type === 7) return { bytes: raw };
  return { bytes: raw };
}

function applyGpsTag(part: PartialLoc, tag: number, value: TagValue): void {
  if (tag === 0x0002 && value.rationals && value.rationals.length >= 3) {
    part.lat = dms(value.rationals[0], value.rationals[1], value.rationals[2]);
  }
  if (tag === 0x0004 && value.rationals && value.rationals.length >= 3) {
    part.lng = dms(value.rationals[0], value.rationals[1], value.rationals[2]);
  }
  if (tag === 0x0006 && value.rationals && value.rationals.length >= 1) part.alt = value.rationals[0];
}

function readGpsIfd(reader: Reader, base: number, length: number, offset: number, le: boolean, part: PartialLoc): void {
  if (offset <= 0 || offset + 2 > length) return;
  const countBuf = reader.read(base + offset, 2);
  if (countBuf.length < 2) return;
  const count = Math.min(u16(countBuf, 0, le), 64);
  const entries = reader.read(base + offset + 2, count * 12);
  let latRef = 'N';
  let lngRef = 'E';
  let altRef = 0;
  let lat: number | null = null;
  let lng: number | null = null;
  let alt: number | null = null;
  let hours: number[] | null = null;
  let date = '';
  for (let i = 0; i < count; i++) {
    const e = entries.subarray(i * 12, i * 12 + 12);
    if (e.length < 12) break;
    const tag = u16(e, 0, le);
    const type = u16(e, 2, le);
    const n = u32(e, 4, le);
    const value = readTag(reader, base, length, e, type, n, le);
    if (tag === 1 && value.text) latRef = value.text;
    if (tag === 2 && value.rationals && value.rationals.length >= 3) lat = dms(value.rationals[0], value.rationals[1], value.rationals[2]);
    if (tag === 3 && value.text) lngRef = value.text;
    if (tag === 4 && value.rationals && value.rationals.length >= 3) lng = dms(value.rationals[0], value.rationals[1], value.rationals[2]);
    if (tag === 5 && value.long != null) altRef = value.long;
    if (tag === 6 && value.rationals && value.rationals.length >= 1) alt = value.rationals[0];
    if (tag === 7 && value.rationals && value.rationals.length >= 3) hours = value.rationals;
    if (tag === 0x1d && value.text) date = value.text;
  }
  if (lat != null && /s/i.test(latRef)) lat = -Math.abs(lat);
  if (lng != null && /w/i.test(lngRef)) lng = -Math.abs(lng);
  if (lat != null && lng != null && validLatLng(lat, lng)) {
    part.lat = lat;
    part.lng = lng;
    part.coordSource = part.coordSource || 'exif';
  }
  if (alt != null && Number.isFinite(alt)) part.alt = altRef === 1 ? -Math.abs(alt) : alt;
  const when = gpsWhen(date, hours);
  if (when) part.capturedAt = when;
}

function readExifIfd(reader: Reader, base: number, length: number, offset: number, le: boolean, part: PartialLoc): void {
  if (offset <= 0 || offset + 2 > length) return;
  const countBuf = reader.read(base + offset, 2);
  if (countBuf.length < 2) return;
  const count = Math.min(u16(countBuf, 0, le), 128);
  const entries = reader.read(base + offset + 2, count * 12);
  for (let i = 0; i < count; i++) {
    const e = entries.subarray(i * 12, i * 12 + 12);
    if (e.length < 12) break;
    const tag = u16(e, 0, le);
    const type = u16(e, 2, le);
    const n = u32(e, 4, le);
    if (tag !== 0x9003 && tag !== 0x9004 && tag !== 0x0132) continue;
    const value = readTag(reader, base, length, e, type, n, le);
    if (value.text && !part.capturedAt) part.capturedAt = exifDate(value.text);
    if (tag === 0x9003 && value.text) part.capturedAt = exifDate(value.text);
  }
}

function dms(d: number, m: number, s: number): number {
  return d + m / 60 + s / 3600;
}

function exifDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

function gpsWhen(date: string, hours: number[] | null): string | null {
  const d = date.trim().match(/^(\d{4}):(\d{2}):(\d{2})/);
  if (!d && !hours) return null;
  const hh = hours ? clampTime(hours[0]) : '00';
  const mm = hours ? clampTime(hours[1]) : '00';
  const ss = hours ? clampTime(hours[2]) : '00';
  if (!d) return null;
  return `${d[1]}-${d[2]}-${d[3]}T${hh}:${mm}:${ss}Z`;
}

function clampTime(n: number): string {
  const v = Math.max(0, Math.min(59, Math.floor(Number.isFinite(n) ? n : 0)));
  return String(v).padStart(2, '0');
}

function parseXmp(xml: string): PartialLoc {
  const latRaw = xmpValue(xml, 'GPSLatitude');
  const lngRaw = xmpValue(xml, 'GPSLongitude');
  const part: PartialLoc = {};
  if (latRaw && lngRaw) {
    const lat = xmpCoord(latRaw);
    const lng = xmpCoord(lngRaw);
    if (lat != null && lng != null && validLatLng(lat, lng)) {
      part.lat = lat;
      part.lng = lng;
      part.coordSource = 'xmp';
    }
  }
  const altRaw = xmpValue(xml, 'GPSAltitude');
  if (altRaw) {
    const alt = xmpAlt(altRaw);
    if (alt != null) part.alt = alt;
  }
  const when = xmpValue(xml, 'DateTimeOriginal') || xmpValue(xml, 'CreateDate') || xmpValue(xml, 'DateCreated');
  if (when) part.capturedAt = normalizeWhen(when);
  const make = xmpValue(xml, 'Make');
  const model = xmpValue(xml, 'Model');
  if (make || model) part.device = joinDevice(make, model, true);
  return part;
}

function xmpValue(xml: string, local: string): string | null {
  const attr = new RegExp(`(?:^|[\\s])(?:[\\w-]+:)?${local}\\s*=\\s*"([^"]+)"`, 'i').exec(xml);
  if (attr) return decodeXml(attr[1]);
  const el = new RegExp(`<(?:[\\w-]+:)?${local}\\b[^>]*>([^<]+)</(?:[\\w-]+:)?${local}>`, 'i').exec(xml);
  if (el) return decodeXml(el[1]);
  return null;
}

function decodeXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

function xmpCoord(raw: string): number | null {
  const ref = raw.match(/[NSEW]\s*$/i);
  const body = raw.replace(/[NSEW]\s*$/i, '').trim();
  const parts = body.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n));
  if (!parts.length) return null;
  let v = parts[0];
  if (parts.length === 2) v = parts[0] + parts[1] / 60;
  else if (parts.length >= 3) v = parts[0] + parts[1] / 60 + parts[2] / 3600;
  if (ref && /[SW]/i.test(ref[0])) v = -Math.abs(v);
  return v;
}

function xmpAlt(raw: string): number | null {
  const frac = raw.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = Number(frac[2]);
    return den ? Number(frac[1]) / den : null;
  }
  const n = Number(raw.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeWhen(raw: string): string | null {
  const exif = exifDate(raw);
  if (exif) return exif;
  const ms = Date.parse(raw);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  return raw.trim() || null;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts', 'moof', 'traf', 'gmhd', 'clip']);

function readVideo(reader: Reader): MediaLocation {
  const part: PartialLoc = {};
  let keys: string[] = [];
  const consider = (type: string, payload: number, boxEnd: number) => {
    const len = boxEnd - payload;
    if (type === 'mvhd' && len >= 20 && len < 256) {
      const when = mvhdTime(reader.read(payload, Math.min(len, 32)));
      if (when && !part.capturedAt) part.capturedAt = when;
    }
    if (type === 'keys' && len > 8 && len <= MAX_ATOM) keys = parseKeys(reader.read(payload, len));
    if (type === 'ilst' && len > 8 && len <= MAX_ATOM) {
      const fields = parseIlst(reader.read(payload, len), keys);
      applyQuickTimeFields(part, fields);
    }
    if (isLocationAtom(type) && len > 0 && len <= 4096) {
      const buf = reader.read(payload, len);
      const iso = findIso6709(buf.toString('latin1'));
      if (iso && (part.lat == null || part.lng == null)) {
        part.lat = iso.lat;
        part.lng = iso.lng;
        if (iso.alt != null) part.alt = iso.alt;
        part.coordSource = type === 'loci' ? '3gpp-loci' : type.includes('xyz') || type === 'xyz ' ? (type.charCodeAt(0) === 0xa9 ? 'quicktime-xyz' : 'android-xyz') : 'quicktime-xyz';
      } else if (type === 'loci') {
        const fixed = parseLoci(buf);
        if (fixed && part.lat == null) {
          part.lat = fixed.lat;
          part.lng = fixed.lng;
          part.alt = fixed.alt;
          part.coordSource = '3gpp-loci';
        }
      }
      if (type.charCodeAt(0) === 0xa9) {
        const text = buf.toString('utf8').replace(/\0/g, '').trim();
        if (type === '\u00a9mak' || type === '©mak') part.device = joinDevice(text, part.device, true);
        if (type === '©mod') part.device = joinDevice(part.device, text, false);
      }
    }
  };

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 14) return;
    let pos = start;
    let guard = 0;
    while (pos + 8 <= end && guard++ < 200000) {
      const hdr = reader.read(pos, 16);
      if (hdr.length < 8) break;
      let size = hdr.readUInt32BE(0);
      const type = hdr.toString('latin1', 4, 8);
      let headerLen = 8;
      if (size === 1) {
        if (hdr.length < 16) break;
        const big = hdr.readBigUInt64BE(8);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
        size = Number(big);
        headerLen = 16;
      } else if (size === 0) size = end - pos;
      if (!Number.isFinite(size) || size < headerLen) break;
      const boxEnd = pos + size;
      if (boxEnd <= pos || boxEnd > end) break;
      const payload = pos + headerLen;
      if (type === 'mdat' || type === 'free' || type === 'skip' || type === 'wide' || type === 'mdat') {
        pos = boxEnd;
        continue;
      }
      consider(type, type === 'meta' ? payload + 4 : payload, boxEnd);
      if (CONTAINERS.has(type) || type === 'meta') {
        const child = type === 'meta' ? payload + 4 : payload;
        if (child < boxEnd) walk(child, boxEnd, depth + 1);
      }
      pos = boxEnd;
    }
  };
  walk(0, reader.size, 0);
  if (part.lat != null && part.lng != null && !validLatLng(part.lat, part.lng)) {
    part.lat = null;
    part.lng = null;
    part.coordSource = null;
  }
  return finish(part, reader.bytesRead);
}

function isLocationAtom(type: string): boolean {
  if (!type || type.length !== 4) return false;
  if (type.charCodeAt(0) === 0xa9) return true;
  const lower = type.toLowerCase();
  return lower === 'xyz ' || lower === 'loci' || lower.includes('xyz') || lower === 'loc ';
}

function parseKeys(buf: Buffer): string[] {
  if (buf.length < 8) return [];
  const count = Math.min(buf.readUInt32BE(4), 64);
  const keys: string[] = [];
  let p = 8;
  for (let i = 0; i < count && p + 8 <= buf.length; i++) {
    const sz = buf.readUInt32BE(p);
    if (sz < 8 || p + sz > buf.length) break;
    keys.push(buf.toString('utf8', p + 8, p + sz).replace(/\0/g, ''));
    p += sz;
  }
  return keys;
}

function parseIlst(buf: Buffer, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let p = 0;
  while (p + 8 <= buf.length) {
    const sz = buf.readUInt32BE(p);
    if (sz < 8 || p + sz > buf.length) break;
    const idx = buf.readUInt32BE(p + 4);
    const four = buf.toString('latin1', p + 4, p + 8);
    const name = idx > 0 && idx <= keys.length && idx < 100000 ? keys[idx - 1] : four;
    const text = dataAtomText(buf.subarray(p + 8, p + sz));
    if (name && text) out[name] = text;
    p += sz;
  }
  return out;
}

function dataAtomText(body: Buffer): string {
  if (body.length >= 16 && body.toString('latin1', 4, 8) === 'data') {
    const size = body.readUInt32BE(0);
    const end = Math.min(body.length, size);
    return body.subarray(16, end).toString('utf8').replace(/\0/g, '').trim();
  }
  return body.toString('utf8').replace(/\0/g, '').trim();
}

function applyQuickTimeFields(part: PartialLoc, fields: Record<string, string>): void {
  const iso = fields['com.apple.quicktime.location.ISO6709'] || fields['location.ISO6709'] || '';
  if (iso) {
    const parsed = findIso6709(iso);
    if (parsed) {
      part.lat = parsed.lat;
      part.lng = parsed.lng;
      if (parsed.alt != null) part.alt = parsed.alt;
      part.coordSource = 'quicktime-iso6709';
    }
  }
  const make = fields['com.apple.quicktime.make'] || fields['©mak'] || '';
  const model = fields['com.apple.quicktime.model'] || fields['©mod'] || '';
  if (make || model) part.device = joinDevice(make || part.device, model, true);
  const created = fields['com.apple.quicktime.creationdate'] || fields['©day'] || '';
  if (created) {
    const when = normalizeWhen(created);
    if (when) part.capturedAt = when;
  }
}

function findIso6709(raw: string): { lat: number; lng: number; alt: number | null } | null {
  const m = raw.match(/([+-]\d{2,6}(?:\.\d+)?)([+-]\d{2,7}(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/);
  if (!m) return null;
  let lat = expandIso(Number(m[1]), 90);
  let lng = expandIso(Number(m[2]), 180);
  const alt = m[3] != null ? Number(m[3]) : null;
  if (!validLatLng(lat, lng)) return null;
  return { lat, lng, alt: alt != null && Number.isFinite(alt) ? alt : null };
}

function expandIso(value: number, limit: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) <= limit) return value;
  const sign = value < 0 ? -1 : 1;
  const a = Math.abs(value);
  const deg = Math.floor(a / 100);
  const min = a - deg * 100;
  if (deg <= limit && min < 60) return sign * (deg + min / 60);
  return value;
}

function parseLoci(buf: Buffer): { lat: number; lng: number; alt: number | null } | null {
  if (buf.length < 18) return null;
  let p = 4;
  p += 2;
  while (p < buf.length && buf[p] !== 0) p++;
  p += 1;
  if (p >= buf.length) return null;
  p += 1;
  if (p + 12 > buf.length) return null;
  const lng = buf.readInt32BE(p) / 65536;
  const lat = buf.readInt32BE(p + 4) / 65536;
  const alt = buf.readInt32BE(p + 8) / 65536;
  if (!validLatLng(lat, lng)) return null;
  return { lat, lng, alt };
}

function mvhdTime(buf: Buffer): string | null {
  if (buf.length < 20) return null;
  const version = buf[0];
  let secs = 0;
  if (version === 1) {
    if (buf.length < 16) return null;
    secs = Number(buf.readBigUInt64BE(4));
  } else secs = buf.readUInt32BE(4);
  if (!Number.isFinite(secs) || secs < 60) return null;
  const ms = Date.UTC(1904, 0, 1) + secs * 1000;
  if (ms < Date.UTC(1990, 0, 1) || ms > Date.UTC(2100, 0, 1)) return null;
  return new Date(ms).toISOString();
}

function readHeif(reader: Reader): MediaLocation {
  let exifBuf: Buffer | null = null;
  const items = new Map<number, { type: string }>();
  const locations = new Map<number, { offset: number; length: number }>();

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 8) return;
    let pos = start;
    let guard = 0;
    while (pos + 8 <= end && guard++ < 100000) {
      const hdr = reader.read(pos, 16);
      if (hdr.length < 8) break;
      let size = hdr.readUInt32BE(0);
      const type = hdr.toString('latin1', 4, 8);
      let headerLen = 8;
      if (size === 1 && hdr.length >= 16) {
        size = Number(hdr.readBigUInt64BE(8));
        headerLen = 16;
      } else if (size === 0) size = end - pos;
      if (!Number.isFinite(size) || size < headerLen) break;
      const boxEnd = pos + size;
      if (boxEnd <= pos || boxEnd > end) break;
      const payload = pos + headerLen;
      if (type === 'iinf' || type === 'iloc' || type === 'infe') {
        const body = reader.read(payload, Math.min(boxEnd - payload, MAX_ATOM));
        if (type === 'infe') parseInfe(body, items);
        if (type === 'iinf') parseIinf(body, items);
        if (type === 'iloc') parseIloc(body, locations);
      }
      if (type === 'meta' || type === 'iprp' || type === 'iinf') {
        const child = type === 'meta' || type === 'iinf' ? payload + 4 : payload;
        if (type === 'iinf') {
          /* children already inside the body we parsed */
        } else if (child < boxEnd) walk(child, boxEnd, depth + 1);
      } else if (CONTAINERS.has(type)) {
        walk(payload, boxEnd, depth + 1);
      }
      pos = boxEnd;
    }
  };
  walk(0, reader.size, 0);

  for (const [id, info] of items) {
    if (info.type !== 'Exif') continue;
    const loc = locations.get(id);
    if (!loc || loc.length <= 0 || loc.length > MAX_XMP) continue;
    exifBuf = reader.read(loc.offset, loc.length);
    break;
  }
  if (!exifBuf) return emptyLocation(reader.bytesRead);
  const tiff = exifItemToTiff(exifBuf);
  if (!tiff) return emptyLocation(reader.bytesRead);
  return finish(mergeLoc({}, parseTiff(bufferReader(tiff), 0, tiff.length), 'exif'), reader.bytesRead);
}

function parseIinf(body: Buffer, items: Map<number, { type: string }>): void {
  if (body.length < 6) return;
  const version = body[0];
  let p = 4;
  const count = version >= 0 ? body.readUInt16BE(p) : 0;
  p += 2;
  for (let i = 0; i < count && p + 8 <= body.length; i++) {
    const sz = body.readUInt32BE(p);
    if (sz < 8 || p + sz > body.length) break;
    const child = body.subarray(p, p + sz);
    if (child.toString('latin1', 4, 8) === 'infe') parseInfe(child.subarray(8), items);
    p += sz;
  }
}

function parseInfe(payload: Buffer, items: Map<number, { type: string }>): void {
  if (payload.length < 8) return;
  const version = payload[0];
  if (version >= 2) {
    const itemId = payload.readUInt16BE(4);
    const itemType = payload.toString('latin1', 8, 12);
    items.set(itemId, { type: itemType });
  }
}

function parseIloc(payload: Buffer, locations: Map<number, { offset: number; length: number }>): void {
  if (payload.length < 8) return;
  const version = payload[0];
  const offsetSize = (payload[4] >> 4) & 0xf;
  const lengthSize = payload[4] & 0xf;
  const baseSize = (payload[5] >> 4) & 0xf;
  const indexSize = version >= 1 ? payload[5] & 0xf : 0;
  let p = 6;
  if (p + 2 > payload.length) return;
  const count = version < 2 ? payload.readUInt16BE(p) : payload.readUInt32BE(p);
  p += version < 2 ? 2 : 4;
  const n = Math.min(count, 64);
  for (let i = 0; i < n && p + 2 <= payload.length; i++) {
    const itemId = version < 2 ? payload.readUInt16BE(p) : payload.readUInt32BE(p);
    p += version < 2 ? 2 : 4;
    if (version === 1 || version === 2) p += 2;
    p += 2;
    if (p + baseSize > payload.length) break;
    let base = 0;
    if (baseSize === 4) base = payload.readUInt32BE(p);
    else if (baseSize === 8) base = Number(payload.readBigUInt64BE(p));
    p += baseSize;
    if (p + 2 > payload.length) break;
    const extents = payload.readUInt16BE(p);
    p += 2;
    let offset = base;
    let length = 0;
    for (let e = 0; e < extents && e < 4; e++) {
      if (indexSize) p += indexSize;
      const extOff = readDyn(payload, p, offsetSize);
      p += offsetSize;
      const extLen = readDyn(payload, p, lengthSize);
      p += lengthSize;
      if (e === 0) {
        offset = base + extOff;
        length = extLen;
      }
    }
    if (length > 0) locations.set(itemId, { offset, length });
  }
}

function readDyn(buf: Buffer, pos: number, size: number): number {
  if (size === 0 || pos + size > buf.length) return 0;
  if (size === 2) return buf.readUInt16BE(pos);
  if (size === 4) return buf.readUInt32BE(pos);
  if (size === 8) return Number(buf.readBigUInt64BE(pos));
  return 0;
}

function exifItemToTiff(buf: Buffer): Buffer | null {
  if (buf.length < 8) return null;
  const declared = buf.readUInt32BE(0);
  const candidates = [declared, 4 + declared, 0, 4, 6, 10];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c >= 0 && c + 4 <= buf.length) {
      const sig = buf.toString('ascii', c, c + 2);
      if ((sig === 'II' || sig === 'MM') && (buf[c + 2] === 42 || buf[c + 3] === 42)) return buf.subarray(c);
    }
  }
  return null;
}
