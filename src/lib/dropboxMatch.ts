/**
 * Match a file-activity row to a stored file only when the path under the
 * category folder equals the CSV path, in the same category.
 * A shared file name is not a match. Unmatched rows and unmatched files both stay.
 */
import type { ForensicEvent, UploadedFile } from '../types';
import { classifyDropboxPath, normalizeDropboxPath, type DropboxCategory } from './dropboxPath';

export interface DropboxMatch {
  matched: Array<{ event: ForensicEvent; file: UploadedFile }>;
  activityWithoutFile: ForensicEvent[];
  filesWithoutActivity: UploadedFile[];
}

function activityCategory(event: ForensicEvent): DropboxCategory | '' {
  const value = event.details?.dropboxCategory;
  return typeof value === 'string' ? value as DropboxCategory : '';
}

function activityKey(event: ForensicEvent): string {
  const raw = event.details?.dropboxNormalizedPath || event.details?.dropboxFilePath || '';
  return normalizeDropboxPath(String(raw));
}

export function fileMatchKey(file: UploadedFile): { category: DropboxCategory; key: string } {
  const loc = classifyDropboxPath(file.relativePath || file.name);
  return { category: loc.category, key: normalizeDropboxPath(loc.relativeToCategory) };
}

export function matchDropboxActivity(files: readonly UploadedFile[], events: readonly ForensicEvent[]): DropboxMatch {
  const activity = events.filter(event => event.details?.dropboxKind === 'file-activity' && activityKey(event));
  const pool = files.filter(file => {
    const loc = classifyDropboxPath(file.relativePath || file.name);
    return loc.area === 'deleted' || loc.area === 'current';
  });
  const used = new Set<UploadedFile>();
  const matched: DropboxMatch['matched'] = [];
  const activityWithoutFile: ForensicEvent[] = [];
  for (let i = 0; i < activity.length; i++) {
    const event = activity[i];
    const key = activityKey(event);
    const category = activityCategory(event);
    const file = pool.find(item => {
      if (used.has(item)) return false;
      const got = fileMatchKey(item);
      return got.category === category && got.key === key && key.length > 0;
    });
    if (!file) activityWithoutFile.push(event);
    else {
      used.add(file);
      matched.push({ event, file });
    }
  }
  const filesWithoutActivity = pool.filter(file => !used.has(file) && fileMatchKey(file).key);
  return { matched, activityWithoutFile, filesWithoutActivity };
}
