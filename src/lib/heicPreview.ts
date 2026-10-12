import { useEffect, useState } from 'react';

/**
 * Display-only HEIC/HEIF -> JPEG previews. The original file is never modified;
 * previews live only as in-memory blob URLs (never saved, exported, or hashed).
 * EXIF/GPS is read from the original elsewhere (mediaLocation.readHeif).
 */
const cache = new Map<string, Promise<string>>();

export function isHeicName(name?: string | null): boolean {
  return /\.(heic|heif)$/i.test(String(name || '').trim());
}

async function convert(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('read failed');
  const blob = await res.blob();
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 });
  const jpg = Array.isArray(out) ? out[0] : out;
  return URL.createObjectURL(jpg);
}

export function useHeicPreview(url: string | null | undefined, name: string | null | undefined) {
  const heic = isHeicName(name);
  const [state, setState] = useState<{ src: string | null; status: 'native' | 'converting' | 'converted' | 'failed' }>(
    { src: heic ? null : url || null, status: heic ? 'converting' : 'native' }
  );
  useEffect(() => {
    if (!heic || !url) { setState({ src: url || null, status: 'native' }); return; }
    let alive = true;
    setState({ src: null, status: 'converting' });
    let p = cache.get(url);
    if (!p) { p = convert(url); cache.set(url, p); p.catch(() => cache.delete(url)); }
    p.then(src => { if (alive) setState({ src, status: 'converted' }); })
     .catch(() => { if (alive) setState({ src: null, status: 'failed' }); });
    return () => { alive = false; };
  }, [url, heic]);
  return { ...state, isHeic: heic };
}
