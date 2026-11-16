/**
 * Case-wide custom tags (a name and a color). Definitions live on the case.
 * Which items wear a tag is stored on the evidence-tag record for that item.
 */

export interface CustomTagDef {
  id: string;
  name: string;
  color: string;
}

export const TAG_COLOR_PALETTE = [
  '#b91c1c',
  '#c2410c',
  '#b45309',
  '#4d7c0f',
  '#047857',
  '#0e7490',
  '#1d4ed8',
  '#6d28d9',
  '#a21caf',
  '#be185d',
  '#44403c',
  '#0f766e',
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function normalizeTagColor(input: string, fallback = '#1d4ed8'): string {
  const raw = (input || '').trim();
  if (HEX.test(raw)) return raw.toLowerCase();
  return fallback;
}

/** Dark chips use white text. Light chips use ink so a yellow tag stays readable. */
export function chipTextColor(color: string): string {
  const hex = normalizeTagColor(color, '#334155');
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#1a1d24' : '#ffffff';
}

export function cleanTagName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function slugTagId(name: string, existing: Iterable<string>): string {
  const base = cleanTagName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'tag';
  const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const id = `${base}-${i}`;
    if (!used.has(id)) return id;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function countTagUse(tags: Record<string, { labels?: string[] } | undefined> | null | undefined, id: string): number {
  if (!tags || !id) return 0;
  let n = 0;
  for (const row of Object.values(tags)) {
    if (row?.labels?.includes(id)) n += 1;
  }
  return n;
}

export function stripTagLabel<T extends { labels?: string[] }>(tags: Record<string, T>, id: string): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, row] of Object.entries(tags)) {
    if (!row) continue;
    if (!row.labels?.includes(id)) {
      next[key] = row;
      continue;
    }
    next[key] = { ...row, labels: row.labels.filter(label => label !== id) };
  }
  return next;
}

export function toggleLabel<T extends { labels?: string[] }>(
  tags: Record<string, T>,
  keys: readonly string[],
  labelId: string,
  on: boolean
): Record<string, T> {
  if (!labelId) return tags;
  const next: Record<string, T> = { ...tags };
  for (const key of keys) {
    if (!key) continue;
    const cur = next[key];
    const labels = new Set(cur?.labels || []);
    if (on) labels.add(labelId);
    else labels.delete(labelId);
    const base = (cur || {}) as T;
    next[key] = { ...base, labels: [...labels] };
  }
  return next;
}

export function tagsForLabels(defs: readonly CustomTagDef[] | undefined, ids: readonly string[] | undefined): CustomTagDef[] {
  if (!defs?.length || !ids?.length) return [];
  const byId = new Map(defs.map(def => [def.id, def]));
  const out: CustomTagDef[] = [];
  for (const id of ids) {
    const def = byId.get(id);
    if (def && !out.some(item => item.id === def.id)) out.push(def);
  }
  return out;
}

export function mergeTagDefs(current: readonly CustomTagDef[], incoming: readonly CustomTagDef[]): CustomTagDef[] {
  const next = new Map<string, CustomTagDef>();
  for (const def of current) {
    if (def?.id && def.name) next.set(def.id, { id: def.id, name: cleanTagName(def.name), color: normalizeTagColor(def.color) });
  }
  for (const def of incoming) {
    const name = cleanTagName(def?.name || '');
    if (!def?.id || !name) continue;
    next.set(def.id, { id: def.id, name, color: normalizeTagColor(def.color) });
  }
  return [...next.values()];
}

export function normalizeTagDefs(value: unknown): CustomTagDef[] {
  if (!Array.isArray(value)) return [];
  const out: CustomTagDef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name = cleanTagName(typeof row.name === 'string' ? row.name : '');
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, color: normalizeTagColor(typeof row.color === 'string' ? row.color : '') });
  }
  return out;
}
