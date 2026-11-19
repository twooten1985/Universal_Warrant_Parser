/**
 * Per-file errors for a warrant return.
 * The log line uses the path relative to the return, never an absolute evidence path.
 */
import fs from 'fs';
import path from 'path';

export interface SkippedItem {
  relativePath: string;
  error: string;
}

export function returnRelative(root: string | undefined, filePath: string): string {
  const raw = String(filePath || '').replace(/\\/g, '/');
  const base = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (base && raw.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return raw.slice(base.length + 1);
  }
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    return raw.split('/').filter(Boolean).pop() || 'file';
  }
  return raw.replace(/^\/+/, '');
}

export function appendReturnError(logPath: string, relativePath: string, error: string, context = 'SKIP'): void {
  try {
    const rel = returnRelative(undefined, relativePath) || '(unknown)';
    const detail = String(error || 'unknown error').replace(/\0/g, '').slice(0, 4000);
    const line = `[${new Date().toISOString()}] ${context} ${rel}\n${detail}\n`;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line);
  } catch {
    /* logging must not throw */
  }
}
