/**
 * Stable identity for a Google category row that is not already a ForensicEvent.
 * case id + source relative path + row index + a hash of the row.
 * The same file, same row, same cells keep the same key across reloads and re-imports.
 */

export function rowContentHash(cells: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < cells.length; i++) {
    const text = i === 0 ? String(cells[i] ?? '') : `\u001f${String(cells[i] ?? '')}`;
    for (let c = 0; c < text.length; c++) {
      hash ^= text.charCodeAt(c);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function googleRowKey(caseId: string, relativePath: string, rowIndex: number, cells: readonly string[]): string {
  const id = (caseId || '').trim() || 'case';
  const path = (relativePath || '').replace(/\\/g, '/');
  const index = Number.isFinite(rowIndex) && rowIndex >= 0 ? Math.floor(rowIndex) : 0;
  return `google-row:${id}:${path}:${index}:${rowContentHash(cells)}`;
}

/** JSON objects hash by sorted keys so column display order does not change the key. */
export function googleJsonRowKey(caseId: string, relativePath: string, rowIndex: number, record: Record<string, string>): string {
  const keys = Object.keys(record).sort();
  const cells: string[] = [];
  for (const key of keys) cells.push(key, record[key] || '');
  return googleRowKey(caseId, relativePath, rowIndex, cells);
}
