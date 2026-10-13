/**
 * Stable evidence-tag key for one plotted location.
 * A point that came from a parsed event uses that event id.
 * Every other point uses location-<source>-<id>.
 */

export interface LocationTagInput {
  id?: string | null;
  eventId?: string | null;
  kind?: string | null;
  coordSource?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  recordPath?: string | null;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function locationTagKey(point: LocationTagInput): string {
  const eventId = (point.eventId || '').trim();
  if (eventId) return eventId;
  const source = slug(point.coordSource || point.kind || 'point') || 'point';
  const id = (point.id || [point.filePath || '', point.recordPath || '', point.fileName || ''].filter(Boolean).join('--') || 'unknown')
    .replace(/[^a-zA-Z0-9._:-]+/g, '-');
  return `location-${source}-${id}`;
}

export function locationIsTagged(
  point: LocationTagInput,
  tags: Record<string, { tagged?: boolean; notes?: string } | undefined> | null | undefined
): boolean {
  if (!tags) return false;
  return !!tags[locationTagKey(point)]?.tagged;
}
