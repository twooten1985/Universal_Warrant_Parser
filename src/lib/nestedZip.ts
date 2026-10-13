/**
 * Walk a zip, including zip files stored inside it, and return the members.
 * Media buried in a nested archive is otherwise never hashed or matched.
 */
import JSZip from 'jszip';

/** Deep enough that a warrant return's nested archives are fully opened. */
export const NESTED_ZIP_DEPTH = 64;
export const NESTED_ZIP_MAX_ENTRIES = 20000;

export interface FlatZipEntry {
  path: string;
  bytes: Uint8Array;
}

export async function flattenZip(
  data: ArrayBuffer | Uint8Array,
  prefix = '',
  depth = 0
): Promise<FlatZipEntry[]> {
  if (depth > NESTED_ZIP_DEPTH) return [];
  const zip = await JSZip.loadAsync(data);
  const out: FlatZipEntry[] = [];
  const names = Object.keys(zip.files);
  for (let i = 0; i < names.length; i++) {
    if (out.length >= NESTED_ZIP_MAX_ENTRIES) break;
    const entry = zip.files[names[i]];
    if (!entry || entry.dir) continue;
    const path = `${prefix}${entry.name}`.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    const lower = path.toLowerCase();
    if (lower.includes('__macosx') || lower.endsWith('/.ds_store') || lower.endsWith('.ds_store')) continue;
    const bytes = await entry.async('uint8array');
    if (lower.endsWith('.zip') && depth < NESTED_ZIP_DEPTH) {
      if (out.length < NESTED_ZIP_MAX_ENTRIES) out.push({ path, bytes });
      const nestedPrefix = `${path.replace(/\.zip$/i, '')}/`;
      try {
        const nested = await flattenZip(bytes, nestedPrefix, depth + 1);
        for (let n = 0; n < nested.length && out.length < NESTED_ZIP_MAX_ENTRIES; n++) out.push(nested[n]);
      } catch {
        /* The archive bytes above are still hashed when the nested zip cannot be opened. */
      }
      continue;
    }
    out.push({ path, bytes });
  }
  return out;
}
