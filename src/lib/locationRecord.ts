/** A point plotted on the locations map or stored in the case database. */

export type LocationKind = 'ip' | 'photo-exif' | 'video-metadata' | 'location-record' | 'sidecar';

export interface LocationRecord {
  kind: LocationKind;
  lat: number;
  lng: number;
  alt?: number | null;
  accuracy?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
  fileName: string;
  filePath?: string | null;
  recordPath?: string | null;
  mediaName?: string | null;
  eventId?: string | null;
}

export interface MediaLocation {
  lat: number | null;
  lng: number | null;
  alt: number | null;
  capturedAt: string | null;
  device: string | null;
  coordSource: string | null;
  bytesRead: number;
}

export function validLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < 5e-6 && Math.abs(lng) < 5e-6) return false;
  return true;
}

export function coordSourceLabel(source?: string | null): string {
  switch (source) {
    case 'exif': return 'EXIF GPS';
    case 'xmp': return 'XMP GPS';
    case 'quicktime-iso6709': return 'QuickTime ISO 6709';
    case 'quicktime-xyz': return 'QuickTime location';
    case 'android-xyz': return 'Android location';
    case '3gpp-loci': return '3GPP location';
    case 'json': return 'JSON record';
    case 'csv': return 'CSV column';
    case 'text': return 'Text record';
    case 'geojson': return 'GeoJSON';
    case 'event': return 'Parsed record';
    default: return source || 'Location';
  }
}

export function kindLabel(kind: LocationKind): string {
  switch (kind) {
    case 'ip': return 'IP address';
    case 'photo-exif': return 'Photo EXIF';
    case 'video-metadata': return 'Video metadata';
    case 'location-record': return 'Location record';
    case 'sidecar': return 'Sidecar JSON';
    default: return kind;
  }
}

export function osmLink(lat: number, lng: number): string {
  const la = lat.toFixed(6);
  const ln = lng.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=16/${la}/${ln}`;
}

export function mediaKindForSource(source: string | null | undefined, mediaType?: string | null): LocationKind {
  if (mediaType === 'video') return 'video-metadata';
  if (source && /quicktime|android|3gpp|loci|xyz/i.test(source)) return 'video-metadata';
  return 'photo-exif';
}
