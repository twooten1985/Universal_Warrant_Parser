/**
 * Classify each Google category folder.
 * Placeholders are recorded on an audit list. Nothing here deletes or hides a file.
 * Hashing is not touched.
 */

import { describeCategory, type GoogleCategoryMode } from './googleCategories';
import {
  extensionOfName,
  googleFolderFromPath,
  isGoogleMediaExt,
  isGoogleTextExt,
  isNoDataText,
  type GoogleFolderName,
  type InventoryFileInput,
} from './googleFolders';

export type GoogleFolderStatus = 'data' | 'no-data' | 'encrypted' | 'media';

export interface GoogleAuditItem {
  folder: string;
  relativePath: string;
  name: string;
  reason: 'no-data-placeholder';
}

export interface GoogleFolderInventory {
  folder: GoogleFolderName;
  status: GoogleFolderStatus;
  /** Badge shown in the tree. "Not parsed" means the generic viewer, not a missing file. */
  badge: 'Data' | 'No Data' | 'Encrypted' | 'Not parsed';
  mode: GoogleCategoryMode;
  fileCount: number;
  files: InventoryFileInput[];
  placeholders: InventoryFileInput[];
}

export interface GoogleReturnInventory {
  folders: GoogleFolderInventory[];
  /** No Data placeholders. Kept for the examiner. Never a delete list. */
  audit: GoogleAuditItem[];
  unscoped: InventoryFileInput[];
}

function folderStatus(folder: GoogleFolderName, files: InventoryFileInput[]): { status: GoogleFolderStatus; placeholders: InventoryFileInput[] } {
  const placeholders: InventoryFileInput[] = [];
  let textData = 0;
  let media = 0;
  let binary = 0;
  let encryptedName = folder.key === 'Timeline.EncryptedBackups';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = extensionOfName(f.name);
    const text = f.text;
    if (text != null && isGoogleTextExt(ext) && isNoDataText(text)) {
      placeholders.push(f);
      continue;
    }
    if (/encrypted\s*backups?/i.test(f.name) || /encrypted\s*backups?/i.test(text || '')) {
      encryptedName = true;
    }
    if (f.isMedia || isGoogleMediaExt(ext)) {
      media++;
      continue;
    }
    if (isGoogleTextExt(ext) || (!ext && text)) {
      if (text != null && text.trim()) textData++;
      else if (text == null) textData++;
      continue;
    }
    binary++;
  }
  if (encryptedName && textData === 0 && media === 0) {
    return { status: 'encrypted', placeholders };
  }
  if (placeholders.length > 0 && textData === 0 && media === 0 && binary === 0) {
    return { status: 'no-data', placeholders };
  }
  if (media > 0 && textData === 0 && binary === 0) {
    return { status: 'media', placeholders };
  }
  if (textData === 0 && media === 0 && binary > 0 && placeholders.length === 0) {
    return { status: 'encrypted', placeholders };
  }
  return { status: 'data', placeholders };
}

function badgeFor(status: GoogleFolderStatus, mode: GoogleCategoryMode): GoogleFolderInventory['badge'] {
  if (status === 'no-data') return 'No Data';
  if (status === 'encrypted') return 'Encrypted';
  if (mode === 'flagged') return 'Encrypted';
  if (mode === 'generic') return 'Not parsed';
  if (status === 'media' && mode !== 'parsed') return 'Not parsed';
  return 'Data';
}

export function inventoryGoogleReturn(files: readonly InventoryFileInput[]): GoogleReturnInventory {
  const groups = new Map<string, { folder: GoogleFolderName; files: InventoryFileInput[] }>();
  const unscoped: InventoryFileInput[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const folder = googleFolderFromPath(f.relativePath || f.name);
    if (!folder) {
      unscoped.push(f);
      continue;
    }
    const g = groups.get(folder.folder) || { folder, files: [] };
    g.files.push(f);
    groups.set(folder.folder, g);
  }
  const folders: GoogleFolderInventory[] = [];
  const audit: GoogleAuditItem[] = [];
  for (const g of groups.values()) {
    const { status, placeholders } = folderStatus(g.folder, g.files);
    const def = describeCategory(g.folder.product, g.folder.category);
    const mode: GoogleCategoryMode = status === 'encrypted' || def.mode === 'flagged' ? 'flagged' : def.mode;
    for (let i = 0; i < placeholders.length; i++) {
      const p = placeholders[i];
      audit.push({
        folder: g.folder.folder,
        relativePath: p.relativePath || p.name,
        name: p.name,
        reason: 'no-data-placeholder',
      });
    }
    folders.push({
      folder: g.folder,
      status: mode === 'flagged' && status !== 'no-data' ? 'encrypted' : status,
      badge: badgeFor(status, mode),
      mode,
      fileCount: g.files.length,
      files: g.files,
      placeholders,
    });
  }
  folders.sort((a, b) => a.folder.key.localeCompare(b.folder.key) || a.folder.folder.localeCompare(b.folder.folder));
  return { folders, audit, unscoped };
}
