import { useEffect, useState } from 'react';

/** Gallery display settings only (no media data) persisted in localStorage. */
export type ThumbMode = 'normal' | 'blur' | 'grayscale';
export interface GallerySettings { hoverPreviews: boolean; thumbMode: ThumbMode; revealOnHover: boolean; }
const KEY = 'uwrp.gallerySettings.v1';
const DEFAULTS: GallerySettings = { hoverPreviews: true, thumbMode: 'normal', revealOnHover: false };

function load(): GallerySettings {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch { return DEFAULTS; }
}

export function useGallerySettings(): [GallerySettings, (patch: Partial<GallerySettings>) => void] {
  const [s, setS] = useState<GallerySettings>(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* settings only */ } }, [s]);
  return [s, (patch) => setS(prev => ({ ...prev, ...patch }))];
}

export function thumbFilterClass(mode: ThumbMode, revealOnHover: boolean): string {
  if (mode === 'blur') return revealOnHover ? 'blur-xl group-hover:blur-none' : 'blur-xl';
  if (mode === 'grayscale') return revealOnHover ? 'grayscale group-hover:grayscale-0' : 'grayscale';
  return '';
}
