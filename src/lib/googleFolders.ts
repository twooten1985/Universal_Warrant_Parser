/**
 * Google warrant folder names, No Data placeholders, and public-IP checks.
 * Folder names look like <email>.<GaiaID>.<Product>.<Category>_001
 * or the same with # separators, and may end in .Preserved.
 * The email contains dots, so the numeric id is the anchor.
 */

import { buildAccountKey } from '../identity';
import { NON_GAIA_PRODUCTS } from './googleCategories';

export interface GoogleFolderName {
  /** Raw folder segment. */
  folder: string;
  /** Text before the numeric id. An email when it contains @. */
  accountText: string;
  email?: string;
  /** Digits in the folder. GAIA id, except products in NON_GAIA_PRODUCTS. */
  numericId: string;
  gaiaId?: string;
  product: string;
  category: string;
  part: string;
  preserved: boolean;
  /** Product.Category */
  key: string;
}

export interface GoogleAccountIdentity {
  email?: string;
  username?: string;
  gaiaId?: string;
  /** Stable chip / target label shared by every category of this account. */
  targetAccount: string;
  accountKey: string;
}

const FOLDER_RE = /^(?<acct>.+?)[.#](?<id>\d{6,})[.#](?<product>[A-Za-z][A-Za-z0-9]*)\.(?<cat>.+?)_(?<part>\d{3})(?:\.Preserved)?$/;

export function parseGoogleFolderName(segment: string): GoogleFolderName | null {
  const name = String(segment || '').trim().replace(/\\/g, '/').split('/').pop() || '';
  if (!name) return null;
  const m = FOLDER_RE.exec(name);
  if (!m?.groups) return null;
  const accountText = m.groups.acct.trim();
  const numericId = m.groups.id;
  const product = m.groups.product;
  const email = accountText.includes('@') ? accountText : undefined;
  const gaiaId = NON_GAIA_PRODUCTS.has(product) ? undefined : numericId;
  return {
    folder: name,
    accountText,
    email,
    numericId,
    gaiaId,
    product,
    category: m.groups.cat,
    part: m.groups.part,
    preserved: /\.Preserved$/i.test(name),
    key: `${product}.${m.groups.cat}`,
  };
}

/** First path segment that is a Google category folder. */
export function googleFolderFromPath(relativePath: string | undefined | null): GoogleFolderName | null {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const hit = parseGoogleFolderName(parts[i]);
    if (hit) return hit;
  }
  return null;
}

export function accountFromGoogleFolder(folder: GoogleFolderName): GoogleAccountIdentity {
  const email = folder.email?.trim();
  const username = email && email.includes('@') ? email.split('@')[0] : (email || undefined);
  const gaiaId = folder.gaiaId;
  const targetAccount = username || email || gaiaId || folder.numericId;
  return {
    email,
    username,
    gaiaId,
    targetAccount,
    accountKey: buildAccountKey('google', gaiaId, username, email),
  };
}

const HEADER_LINE = /^(google(\s+account)?(\s+data)?|service|resource|originating identifier|resolved identifier|email address|account identifier|production|request id|legal process|generated|date produced|date range)\b/i;

/** True when the only non-header text is a "No Data" placeholder. */
export function isNoDataText(text: string | null | undefined): boolean {
  if (!text) return false;
  const stripped = String(text).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n');
  const lines = stripped.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const body = lines.filter(l => !HEADER_LINE.test(l) && !/^\[.*\]$/.test(l) && !/^[-–—_=*]{3,}$/.test(l));
  if (body.length === 0) return false;
  return body.every(l => /^no\s*data\b[.!]?$/i.test(l));
}

export function extensionOfName(name: string): string {
  const base = (name || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

const TEXT_EXT = new Set(['json', 'csv', 'tsv', 'txt', 'eml', 'mbox', 'html', 'htm', 'xml', 'pdf', 'vcf', 'ics', 'vcard']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'dng']);
const AUDIO_EXT = new Set(['mp3', 'amr', 'm4a', 'wav', 'ogg', 'aac', 'flac']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', '3gp', '3gpp', 'webm', 'avi']);

export function isGoogleTextExt(ext: string): boolean {
  return TEXT_EXT.has(ext);
}
export function isGoogleImageExt(ext: string): boolean {
  return IMAGE_EXT.has(ext);
}
export function isGoogleAudioExt(ext: string): boolean {
  return AUDIO_EXT.has(ext);
}
export function isGoogleVideoExt(ext: string): boolean {
  return VIDEO_EXT.has(ext);
}
export function isGoogleMediaExt(ext: string): boolean {
  return IMAGE_EXT.has(ext) || AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext);
}

export type FolderClass = 'data' | 'no-data' | 'encrypted' | 'media';

export interface InventoryFileInput {
  name: string;
  relativePath?: string;
  size?: number;
  text?: string | null;
  isMedia?: boolean;
}

export interface ClassifiedFolder {
  folder: GoogleFolderName;
  classification: FolderClass;
  files: InventoryFileInput[];
  placeholders: InventoryFileInput[];
}

/** 172.16.0.0/12 and the other non-public ranges, plus IPv6 loopback, link-local, and ULA. */
export function isNonPublicIp(ip: string): boolean {
  const v = String(ip || '').trim().toLowerCase();
  if (!v) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    const d = Number(m[4]);
    if ([a, b, c, d].some(n => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  if (!isIpv6(v)) return true;
  if (v === '::1' || v === '::') return true;
  const head = v.split(':')[0] || '';
  const first = parseInt(head || '0', 16);
  if (Number.isFinite(first)) {
    if (first >= 0xfe80 && first <= 0xfebf) return true;
    if (first >= 0xfc00 && first <= 0xfdff) return true;
  }
  if (v.startsWith('::ffff:')) {
    const mapped = v.slice('::ffff:'.length);
    if (/^\d+\./.test(mapped)) return isNonPublicIp(mapped);
  }
  return false;
}

export function isIpv6(value: string): boolean {
  const v = value.trim();
  if (!v.includes(':')) return false;
  if (v.length > 64) return false;
  if ((v.match(/::/g) || []).length > 1) return false;
  const zoneStripped = v.split('%')[0];
  const halves = zoneStripped.split('::');
  const check = (part: string, allowEmpty: boolean) => {
    if (!part) return allowEmpty;
    const bits = part.split(':');
    if (bits.some(b => b.length < 1 || b.length > 4 || !/^[0-9a-f]+$/i.test(b))) {
      const last = bits[bits.length - 1];
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(last)) {
        return bits.slice(0, -1).every(b => b.length >= 1 && b.length <= 4 && /^[0-9a-f]+$/i.test(b));
      }
      return false;
    }
    return true;
  };
  if (halves.length === 1) {
    const bits = halves[0].split(':');
    return bits.length === 8 && check(halves[0], false);
  }
  if (halves.length !== 2) return false;
  const left = halves[0] ? halves[0].split(':').length : 0;
  const right = halves[1] ? halves[1].split(':').length : 0;
  if (left + right > 7) return false;
  return check(halves[0], true) && check(halves[1], true);
}

const IPV4_RE = /(?:^|[^0-9.])((?:\d{1,3}\.){3}\d{1,3})(?![0-9.])/g;
const IPV6_RE = /(?:^|[^0-9a-fA-F:])((?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?:(?::[0-9a-fA-F]{1,4}){1,6})|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)|(?:[0-9a-fA-F]{1,4}:){1,4}:\d{1,3}(?:\.\d{1,3}){3})(?![0-9a-fA-F:])/g;

export function extractIps(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (ip: string) => {
    const v = ip.trim();
    if (!v || seen.has(v) || isNonPublicIp(v)) return;
    seen.add(v);
    found.push(v);
  };
  let m: RegExpExecArray | null;
  const v4 = new RegExp(IPV4_RE.source, 'g');
  while ((m = v4.exec(text))) push(m[1]);
  const v6 = new RegExp(IPV6_RE.source, 'g');
  while ((m = v6.exec(text))) {
    if (isIpv6(m[1])) push(m[1]);
  }
  return found;
}

const TIME_IN_LINE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{4}-\d{2}-\d{2})/;

/** A timestamp that is actually written on the same line, or null. Never invented. */
export function timeOnLine(line: string): string | null {
  const m = TIME_IN_LINE.exec(line);
  if (!m) return null;
  const d = new Date(m[1].includes('T') || m[1].includes(' ') ? m[1] : `${m[1]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return d.toISOString();
}

export function parseCoordString(value: string | null | undefined): { lat: number; lng: number } | null {
  if (!value) return null;
  const s = String(value).trim();
  const geo = /^geo:(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i.exec(s);
  if (geo) {
    const lat = Number(geo[1]);
    const lng = Number(geo[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7)) {
      return { lat, lng };
    }
    return null;
  }
  const deg = /(-?\d+(?:\.\d+)?)\s*°\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*°?/.exec(s);
  if (deg) {
    const lat = Number(deg[1]);
    const lng = Number(deg[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7)) {
      return { lat, lng };
    }
  }
  return null;
}

export function e7Pair(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const useE7 = Math.abs(la) > 180 || Math.abs(ln) > 180;
  const a = useE7 ? la / 1e7 : la;
  const b = useE7 ? ln / 1e7 : ln;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  if (Math.abs(a) < 1e-7 && Math.abs(b) < 1e-7) return null;
  return { lat: a, lng: b };
}
