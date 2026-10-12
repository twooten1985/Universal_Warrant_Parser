import type { LocationRecord } from './locationRecord';
import { kindLabel } from './locationRecord';

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function locationsToCsv(rows: LocationRecord[]): string {
  const header = ['kind', 'latitude', 'longitude', 'altitude', 'accuracy', 'captured_at', 'device', 'coord_source', 'file_name', 'file_path', 'record_path', 'media_name', 'event_id'];
  const lines = [header.join(',')];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines.push([
      row.kind,
      row.lat,
      row.lng,
      row.alt ?? '',
      row.accuracy ?? '',
      row.capturedAt ?? '',
      row.device ?? '',
      row.coordSource ?? '',
      row.fileName,
      row.filePath ?? '',
      row.recordPath ?? '',
      row.mediaName ?? '',
      row.eventId ?? '',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function locationsToKml(rows: LocationRecord[]): string {
  const marks: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const alt = row.alt != null && Number.isFinite(row.alt) ? row.alt : 0;
    const name = `${kindLabel(row.kind)}: ${row.fileName}`;
    const desc = [
      row.filePath ? `Path: ${row.filePath}` : '',
      row.recordPath ? `Record: ${row.recordPath}` : '',
      row.capturedAt ? `Time: ${row.capturedAt}` : '',
      row.accuracy != null ? `Accuracy: ${row.accuracy}` : '',
      row.device ? `Device: ${row.device}` : '',
      row.coordSource ? `Source: ${row.coordSource}` : '',
      `${row.lat}, ${row.lng}`,
    ].filter(Boolean).join('\n');
    const when = row.capturedAt ? `<TimeStamp><when>${xml(row.capturedAt)}</when></TimeStamp>` : '';
    marks.push(
      `<Placemark><name>${xml(name)}</name><description>${xml(desc)}</description>${when}<Point><coordinates>${row.lng},${row.lat},${alt}</coordinates></Point></Placemark>`
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Locations</name>${marks.join('')}</Document></kml>\n`;
}
