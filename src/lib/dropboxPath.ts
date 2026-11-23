/**
 * Dropbox warrant layout. Folder names vary, so this matches patterns:
 * part-N archives, a numeric user-id folder, and Deleted Files / File Data containers.
 * Unknown folder names under those containers are kept.
 */

export type DropboxArea = 'deleted' | 'current' | 'metadata' | 'user' | 'other';
export type DropboxCategory = 'disabled-backup' | 'backup' | 'folder' | 'file-metadata' | 'user-metadata' | 'unknown';

export interface DropboxLocation {
  /** Zip or top folder this file came from, when the name matches a part. */
  part?: string;
  userId?: string;
  area: DropboxArea;
  category: DropboxCategory;
  categoryLabel: string;
  deleted: boolean;
  /** Path under the category folder, used only for an exact activity match. */
  relativeToCategory: string;
}

const PART_RE = /^(deleted-file-data|file-data)-part-\d+$/i;
const META_RE = /^file-metadata$/i;

/** user-metadata.pdf, User Metadata.pdf, user_metadata.pdf, and the same names with a part number. */
export function isDropboxUserReport(nameOrPath: string): boolean {
  const base = String(nameOrPath || '').replace(/\\/g, '/').split('/').pop() || '';
  const stem = base.replace(/\.[a-z0-9]{1,8}$/i, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^user metadata(?: part)?(?: \d+)?$/.test(stem);
}

export function dropboxFileTagKey(file: { name: string; relativePath?: string | null; returnId?: string | null }): string {
  const rel = String(file.relativePath || file.name || 'file').replace(/\\/g, '/');
  return `dropbox-file:${file.returnId || ''}:${rel}`;
}

export function dropboxCategoryLabel(category: DropboxCategory): string {
  switch (category) {
    case 'disabled-backup': return 'Disabled Backup';
    case 'backup': return 'Backup';
    case 'folder': return 'Folder';
    case 'file-metadata': return 'File metadata';
    case 'user-metadata': return 'User metadata';
    default: return 'Unknown folder';
  }
}

export function categoryFromActivityName(name: string): DropboxCategory {
  const n = name.toLowerCase();
  if (n.includes('disabled') && n.includes('backup')) return 'disabled-backup';
  if (n.includes('folder')) return 'folder';
  if (n.includes('backup')) return 'backup';
  return 'unknown';
}

function categoryFromFolder(name: string): DropboxCategory | null {
  const n = name.toLowerCase();
  if (!n) return null;
  if (n.includes('disabled') && n.includes('backup')) return 'disabled-backup';
  if (n.includes('backup')) return 'backup';
  if (n.includes('folder')) return 'folder';
  return null;
}

export function normalizeDropboxPath(value: string): string {
  let path = String(value || '').replace(/\\/g, '/').trim();
  path = path.replace(/\/{2,}/g, '/');
  if (path.startsWith('/')) path = path.slice(1);
  path = path.replace(/^root\//i, '');
  if (path.endsWith('/')) path = path.slice(0, -1);
  return path.toLowerCase();
}

export function classifyDropboxPath(relativePath: string | undefined | null): DropboxLocation {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  let part: string | undefined;
  let userId: string | undefined;
  let area: DropboxArea = 'other';
  let category: DropboxCategory = 'unknown';
  let categoryIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!part && (PART_RE.test(seg) || META_RE.test(seg) || isDropboxUserReport(seg))) {
      part = seg.replace(/\.[a-z0-9]+$/i, '');
    }
    if (!userId && /^\d{5,}$/.test(seg)) userId = seg;
    if (/^deleted files$/i.test(seg)) area = 'deleted';
    else if (/^file data$/i.test(seg)) area = 'current';
    else if (META_RE.test(seg)) area = 'metadata';
    else if (isDropboxUserReport(seg)) area = 'user';
    const cat = categoryFromFolder(seg);
    if (cat && categoryIndex < 0 && area !== 'metadata' && area !== 'user') {
      category = cat;
      categoryIndex = i;
    }
  }
  const leaf = parts[parts.length - 1] || '';
  if (area === 'metadata' || /file-activity\.csv$/i.test(leaf)) {
    if (parts.some(seg => META_RE.test(seg)) || area === 'metadata') {
      area = 'metadata';
      const fromName = categoryFromActivityName(leaf);
      category = fromName === 'unknown' ? 'file-metadata' : fromName;
    }
  }
  if (area === 'user' || isDropboxUserReport(leaf)) {
    area = 'user';
    category = 'user-metadata';
    if (!part) part = 'user-metadata';
  }
  if (area === 'other' && part && /^deleted-file-data/i.test(part)) area = 'deleted';
  if (area === 'other' && part && /^file-data/i.test(part)) area = 'current';
  const relativeToCategory = categoryIndex >= 0 ? parts.slice(categoryIndex + 1).join('/') : '';
  return {
    part,
    userId,
    area,
    category,
    categoryLabel: dropboxCategoryLabel(category),
    deleted: area === 'deleted',
    relativeToCategory,
  };
}

export function dropboxUserIdFromPaths(paths: readonly string[]): string {
  for (let i = 0; i < paths.length; i++) {
    const hit = classifyDropboxPath(paths[i]).userId;
    if (hit) return hit;
  }
  return '';
}

export interface DropboxSkip {
  relativePath: string;
  reason: string;
}

function isPartDirName(name: string): boolean {
  const stem = name.replace(/\.zip$/i, '');
  return PART_RE.test(stem) || META_RE.test(stem);
}

/**
 * A return folder may contain a zip and the folder extracted from it, plus files that are not part of the return.
 * Prefer the zip. Record the extracted copy as skipped. Leave unrelated files out.
 */
export function planDropboxImport(relativePaths: readonly string[]): { skip: Set<string>; notes: DropboxSkip[] } {
  const paths = relativePaths.map(item => String(item || '').replace(/\\/g, '/'));
  const zipStems = new Set<string>();
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (!/\.zip$/i.test(path)) continue;
    const base = path.split('/').pop() || '';
    if (!isPartDirName(base)) continue;
    zipStems.add(path.replace(/\.zip$/i, '').toLowerCase());
  }
  const skip = new Set<string>();
  const notes: DropboxSkip[] = [];
  const noted = new Set<string>();
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const lower = path.toLowerCase();
    if (/\.zip$/i.test(lower) && zipStems.has(lower.replace(/\.zip$/i, ''))) continue;
    for (const stem of zipStems) {
      if (!lower.startsWith(`${stem}/`)) continue;
      skip.add(path);
      if (!noted.has(stem)) {
        noted.add(stem);
        notes.push({
          relativePath: stem,
          reason: 'Extracted folder was skipped because the zip with the same name is the original evidence.',
        });
      }
      break;
    }
  }
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (skip.has(path)) continue;
    if (isKeptDropboxPath(path, zipStems)) continue;
    skip.add(path);
    notes.push({ relativePath: path, reason: 'Ignored. It is not part of the Dropbox return.' });
  }
  return { skip, notes };
}

function isKeptDropboxPath(path: string, zipStems: Set<string>): boolean {
  const lower = path.toLowerCase();
  const base = lower.split('/').pop() || '';
  if (/\.zip$/i.test(base) && isPartDirName(base)) return true;
  if (isDropboxUserReport(base)) return true;
  if (/file-activity\.csv$/i.test(base)) return true;
  const segs = lower.split('/');
  for (let i = 0; i < segs.length; i++) {
    if (!isPartDirName(segs[i])) continue;
    const stem = segs.slice(0, i + 1).join('/');
    if (zipStems.has(stem)) return false;
    return true;
  }
  return false;
}

export function isDropboxNoInformation(text: string | null | undefined): boolean {
  const body = String(text || '').replace(/\u0000/g, '').trim();
  if (!body) return false;
  return /^no information available\.?$/i.test(body);
}
