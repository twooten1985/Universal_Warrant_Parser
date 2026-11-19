/**
 * Decide whether a file is text we can parse or a binary attachment.
 * Magic bytes win over the extension: a PDF or zip renamed to .txt is still binary.
 * Binaries are kept as files. They are not decoded into a JavaScript string.
 */

const BINARY_EXT = new Set([
  'pdf', 'zip', '7z', 'rar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'dmg', 'exe', 'dll', 'bin',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'dng', 'ico',
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp', 'mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'amr',
  'doc', 'docx', 'ppt', 'pptx', 'xls', 'odt', 'ods', 'odp', 'sqlite', 'db',
]);

/** Spreadsheets the Discord parser still opens, and only when they are small. */
const SPREADSHEET_EXT = new Set(['xlsx', 'xlsm']);

export type DiskClass = 'text' | 'binary' | 'spreadsheet';

export function extensionOfFileName(name: string): string {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isZipMagic(head: Buffer): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
}

export function isPdfMagic(head: Buffer): boolean {
  return head.length >= 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
}

export function isGzipMagic(head: Buffer): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

export function isOleMagic(head: Buffer): boolean {
  return head.length >= 4 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
}

export function isImageOrMediaMagic(head: Buffer): boolean {
  if (head.length < 12) return false;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true;
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return true;
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return true;
  if (head.toString('ascii', 4, 8) === 'ftyp') return true;
  if (head.toString('ascii', 0, 4) === 'OggS') return true;
  if (head.toString('ascii', 0, 3) === 'ID3') return true;
  if (head.toString('ascii', 0, 4) === 'fLaC') return true;
  return false;
}

export function isSqliteMagic(head: Buffer): boolean {
  return head.length >= 15 && head.toString('ascii', 0, 15) === 'SQLite format 3';
}

/** Node's fs.readFileSync throws ERR_FS_FILE_TOO_LARGE at 2 GiB. Stay under that. */
export const FS_READ_LIMIT = 2 * 1024 * 1024 * 1024 - 1;

export function classifyByHead(name: string, head: Buffer, size: number): DiskClass {
  const ext = extensionOfFileName(name);
  if (size > FS_READ_LIMIT) return 'binary';
  if (isPdfMagic(head) || isGzipMagic(head) || isImageOrMediaMagic(head) || isSqliteMagic(head)) return 'binary';
  if (isOleMagic(head) && !SPREADSHEET_EXT.has(ext)) return 'binary';
  if (isZipMagic(head)) {
    if (SPREADSHEET_EXT.has(ext) && size <= 64 * 1024 * 1024) return 'spreadsheet';
    return 'binary';
  }
  if (ext === 'zip' || ext === 'pdf' || BINARY_EXT.has(ext)) return 'binary';
  if (SPREADSHEET_EXT.has(ext)) return size <= 64 * 1024 * 1024 ? 'spreadsheet' : 'binary';
  return 'text';
}
