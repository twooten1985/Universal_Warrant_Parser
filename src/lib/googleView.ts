/**
 * Counts, category file lists, HTML preview, and IP-map rows for a Google return.
 * These stay in one place so the dashboard, the category viewer, and the checks agree.
 */
import type { ForensicEvent, UploadedFile } from '../types';
import { isMappableIpAddress } from './discordSession';
import {
  extensionOfName,
  googleFolderFromPath,
  isGoogleImageExt,
  isNoDataText,
  isNonPublicIp,
} from './googleFolders';

const ARCHIVE_EXT = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz']);

const VIEW_RANK: Record<string, number> = {
  html: 0,
  htm: 1,
  csv: 2,
  tsv: 3,
  json: 4,
  xml: 5,
  txt: 6,
  vcf: 7,
  vcard: 7,
  ics: 8,
  eml: 9,
  mbox: 10,
  pdf: 11,
  mp3: 12,
  amr: 12,
  m4a: 12,
  wav: 12,
  jpg: 20,
  jpeg: 20,
  png: 20,
  gif: 20,
  webp: 20,
  heic: 20,
  heif: 20,
};

export interface GoogleDashboardCounts {
  photos: number;
  emails: number;
  ips: number;
  drive: number;
  messages: number;
  changes: number;
}

export interface IpMapRecord {
  ip: string;
  timestamp: string;
  untimed: boolean;
  /** Clock time, or the words "No timestamp" when the source row has none. */
  label: string;
  source: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Image file from the Google return. A wrong or missing provider tag still counts when the path is a Google Photos folder. */
export function isGooglePhotoFile(file: UploadedFile): boolean {
  const name = file.name || '';
  const rel = `${file.relativePath || ''}/${name}`.replace(/\\/g, '/');
  const ext = extensionOfName(name);
  if (ARCHIVE_EXT.has(ext)) return false;
  if (file.noDataPlaceholder) return false;
  const image = file.mediaType === 'image' || isGoogleImageExt(ext);
  if (!image || ext === 'json') return false;
  const folder = googleFolderFromPath(file.relativePath || name);
  if (folder?.product === 'GooglePhotos' || /googlephotos/i.test(rel)) return true;
  const provider = String(file.provider || '').toLowerCase();
  if (provider === 'google') return true;
  if (!provider && folder) return true;
  return false;
}

export function googleDashboardCounts(events: ForensicEvent[], files: UploadedFile[] = []): GoogleDashboardCounts {
  const emails = events.filter(e => e.category === 'message' && e.details?.isEmail).length;
  const messages = events.filter(e => (e.category === 'message' || e.category === 'call') && !e.details?.isEmail).length;
  const changes = events.filter(e => e.details?.googleCategory === 'GoogleAccount.ChangeHistory' || e.details?.googleKind === 'account-change').length;
  const drive = events.filter(e => e.details?.googleCategory === 'Drive.DriveFiles' || e.details?.googleCategory === 'DriveAssociatedTargets.SharedDrives').length;
  const ips = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const values = [e.ipAddress, e.details?.ipAddress, e.details?.proxiedIp, e.details?.extractedIP];
    for (let v = 0; v < values.length; v++) {
      const ip = String(values[v] || '').trim();
      if (ip && isMappableIpAddress(ip)) ips.add(ip);
    }
  }
  const seen = new Set<string>();
  let photos = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!isGooglePhotoFile(file)) continue;
    const key = `${file.relativePath || ''}::${file.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    photos++;
  }
  return { photos, emails, ips: ips.size, drive, messages, changes };
}

function isContainerFile(file: UploadedFile, folderName: string): boolean {
  const name = file.name || '';
  const rel = (file.relativePath || '').replace(/\\/g, '/');
  const ext = extensionOfName(name);
  if (ARCHIVE_EXT.has(ext)) return true;
  if (name.endsWith('/') || rel.endsWith('/')) return true;
  const base = rel.split('/').pop() || name;
  if (!ext && (base === folderName || name === folderName)) return true;
  return false;
}

function isPlaceholderFile(file: UploadedFile): boolean {
  if (file.noDataPlaceholder) return true;
  if (file.content && !file.content.startsWith('data:') && isNoDataText(file.content)) return true;
  return false;
}

function viewScore(file: UploadedFile): number {
  const ext = extensionOfName(file.name);
  let score = VIEW_RANK[ext] ?? 40;
  const n = file.name.toLowerCase();
  if (/subscriber|changehistory|myactivity|^activity|device/.test(n)) score -= 0.25;
  if (/nodata|no-data|placeholder/.test(n)) score += 30;
  return score;
}

/**
 * Files the category viewer can open.
 * Container archives and directory rows are left out.
 * No Data placeholders are left out unless they are the only thing in the folder.
 * The first item is the default: HTML before CSV before JSON before everything else.
 */
export function viewableCategoryFiles(files: UploadedFile[], folderName: string): UploadedFile[] {
  const owned = files.filter(f => {
    const rel = (f.relativePath || f.name || '').replace(/\\/g, '/');
    return rel === folderName || rel.includes(`${folderName}/`) || rel.includes(folderName);
  });
  const openable = owned.filter(f => !isContainerFile(f, folderName));
  const meaningful = openable.filter(f => !isPlaceholderFile(f));
  const list = meaningful.length > 0 ? meaningful : openable.filter(isPlaceholderFile);
  return [...list].sort((a, b) => viewScore(a) - viewScore(b) || a.name.localeCompare(b.name));
}

export function defaultViewableFile(files: UploadedFile[]): UploadedFile | null {
  return files[0] || null;
}

export function fileViewKey(file: UploadedFile): string {
  return file.relativePath || file.name;
}

/** Strip scripts and inline event handlers. The iframe is also sandboxed. */
export function prepareHtmlDocument(raw: string): { html: string; text: string; isHtml: boolean } {
  const stripped = String(raw || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*$/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
  const text = stripped
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const isHtml = /<\s*(!doctype|html|body|table|div|p|span|h[1-6]|ul|ol|tr|td|th|a)\b/i.test(stripped);
  const html = isHtml
    ? stripped
    : `<!DOCTYPE html><html><body><pre style="white-space:pre-wrap;font-family:ui-monospace,monospace">${escapeHtml(text || raw)}</pre></body></html>`;
  return { html, text: text || String(raw || ''), isHtml };
}

function timedLabel(timestamp: string | undefined, untimed: boolean): { timestamp: string; untimed: boolean; label: string } {
  if (untimed || !timestamp || timestamp === 'Unknown' || Number.isNaN(Date.parse(timestamp))) {
    return { timestamp: '', untimed: true, label: 'No timestamp' };
  }
  return { timestamp, untimed: false, label: timestamp };
}

/** One row per public IP. Private addresses stay off the map. IPv6 is kept. Untimed rows are labeled "No timestamp". */
export function ipMapRecords(events: ForensicEvent[]): IpMapRecord[] {
  const best = new Map<string, IpMapRecord>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const values = [e.ipAddress, e.details?.ipAddress, e.details?.proxiedIp, e.details?.extractedIP];
    const untimed = e.details?.untimed === true || !e.timestamp || e.timestamp === 'Unknown';
    for (let v = 0; v < values.length; v++) {
      const ip = String(values[v] || '').trim();
      if (!ip || !isMappableIpAddress(ip) || isNonPublicIp(ip)) continue;
      const next = timedLabel(untimed ? '' : e.timestamp, untimed);
      const prev = best.get(ip);
      if (!prev) {
        best.set(ip, { ip, timestamp: next.timestamp, untimed: next.untimed, label: next.label, source: e.sourceFile || '' });
      } else if (prev.untimed && !next.untimed) {
        best.set(ip, { ...prev, timestamp: next.timestamp, untimed: false, label: next.label, source: e.sourceFile || prev.source });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.ip.localeCompare(b.ip));
}
