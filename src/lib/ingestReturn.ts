/**
 * Every file in a warrant return, including non-media, extensionless files,
 * and files buried in nested zips. The bytes here are the original file bytes.
 * Text shown to the parser is a separate decode and is never hashed.
 */
import { classifyMediaName } from './mediaBrowser';
import { flattenZip } from './nestedZip';

const TEXT_EXT = new Set(['json', 'csv', 'tsv', 'txt', 'eml', 'mbox', 'html', 'htm', 'xml', 'pdf']);

export interface InventoriedFile {
  name: string;
  relativePath: string;
  bytes: Uint8Array;
  size: number;
  isMedia: boolean;
  mediaType: 'image' | 'video' | null;
  /** Parser text. Null for binary. Do not hash this string. */
  text: string | null;
}

export function extensionOf(name: string): string {
  const base = (name || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = base.slice(dot + 1).toLowerCase();
  if (!ext || ext.length > 8) return '';
  return ext;
}

function sniffMedia(bytes: Uint8Array): 'image' | 'video' | null {
  if (bytes.length < 12) return null;
  const head = bytes.subarray(0, 16);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image';
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image';
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return 'image';
  let box = '';
  for (let i = 4; i < 12 && i < bytes.length; i++) box += String.fromCharCode(bytes[i]);
  if (box.startsWith('ftyp')) {
    const brand = String.fromCharCode(bytes[8] || 0, bytes[9] || 0, bytes[10] || 0, bytes[11] || 0).toLowerCase();
    if (brand === 'heic' || brand === 'heif' || brand === 'mif1') return 'image';
    return 'video';
  }
  return null;
}

function textFromBytes(bytes: Uint8Array): string | null {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0) return null;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function isTextReturnName(name: string): boolean {
  return TEXT_EXT.has(extensionOf(name));
}

/** Media kind from the name, then from the original header. The header is not a preview. */
export function classifyReturnName(name: string, head?: Uint8Array): { isMedia: boolean; mediaType: 'image' | 'video' | null } {
  const base = (name || '').replace(/\\/g, '/').split('/').pop() || name || 'file';
  const ext = extensionOf(base);
  let mediaType = classifyMediaName(base);
  if (!mediaType && head && head.byteLength && !ext) mediaType = sniffMedia(head);
  if (!mediaType && (ext === 'heic' || ext === 'heif')) mediaType = 'image';
  return { isMedia: mediaType !== null, mediaType };
}

/** One file, original bytes intact. Extensionless media is still the original buffer. */
export function inventoryBytes(name: string, relativePath: string, bytes: Uint8Array): InventoriedFile {
  const base = (relativePath || name).replace(/\\/g, '/').split('/').pop() || name || 'file';
  const ext = extensionOf(base);
  const classified = classifyReturnName(base, bytes);
  const wantText = !classified.isMedia && (TEXT_EXT.has(ext) || !ext);
  return {
    name: base,
    relativePath: relativePath || base,
    bytes,
    size: bytes.byteLength,
    isMedia: classified.isMedia,
    mediaType: classified.mediaType,
    text: wantText ? textFromBytes(bytes) : null,
  };
}

/** Expand a zip, including nested zips, and keep every member's original bytes. */
export async function listReturnFiles(data: ArrayBuffer | Uint8Array, prefix = ''): Promise<InventoriedFile[]> {
  const flat = await flattenZip(data, prefix);
  const out: InventoriedFile[] = [];
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i];
    const name = item.path.split('/').pop() || item.path;
    out.push(inventoryBytes(name, item.path, item.bytes));
  }
  return out;
}
