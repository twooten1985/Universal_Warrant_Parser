import React, { useEffect, useRef, useState } from 'react';
import { Film, Play } from 'lucide-react';

/**
 * Griffeye-style hover scrub tile. Posters are grabbed in memory (offscreen video + canvas -> blob URL),
 * never written to disk, exported, or hashed. Originals are only read.
 */
type PosterInfo = { url: string | null; duration: number; failed: boolean };
const posterCache = new Map<string, Promise<PosterInfo>>();
const posterUrls = new Map<string, string>();
const MAX_POSTERS = 400;

function remember(src: string, url: string) {
  posterUrls.set(src, url);
  while (posterUrls.size > MAX_POSTERS) {
    const [oldSrc, oldUrl] = posterUrls.entries().next().value as [string, string];
    URL.revokeObjectURL(oldUrl);
    posterUrls.delete(oldSrc);
    posterCache.delete(oldSrc);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { posterUrls.forEach(u => URL.revokeObjectURL(u)); posterUrls.clear(); posterCache.clear(); });
}

// Limit concurrent poster grabs so a big page doesn't open dozens of decoders.
let running = 0;
const queue: Array<() => void> = [];
function slot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const go = () => { running++; fn().then(resolve, reject).finally(() => { running--; queue.shift()?.(); }); };
    if (running < 3) go(); else queue.push(go);
  });
}

function grabPoster(src: string): Promise<PosterInfo> {
  return slot(() => new Promise<PosterInfo>(resolve => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    let done = false;
    const finish = (info: PosterInfo) => {
      if (done) return; done = true; clearTimeout(timer);
      v.removeAttribute('src'); v.load();
      resolve(info);
    };
    const timer = setTimeout(() => finish({ url: null, duration: 0, failed: true }), 15000);
    v.onerror = () => finish({ url: null, duration: 0, failed: true });
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      if (!v.videoWidth) { finish({ url: null, duration: d, failed: true }); return; } // audio-only / undecodable video track
      v.currentTime = d > 0 ? Math.min(d * 0.1, Math.max(0, d - 0.05)) : 0;
    };
    v.onseeked = () => {
      try {
        const w = Math.min(480, v.videoWidth); const h = Math.round(v.videoHeight * (w / v.videoWidth));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(v, 0, 0, w, h);
        const d = Number.isFinite(v.duration) ? v.duration : 0;
        c.toBlob(b => {
          if (!b) { finish({ url: null, duration: d, failed: true }); return; }
          const url = URL.createObjectURL(b); remember(src, url);
          finish({ url, duration: d, failed: false });
        }, 'image/jpeg', 0.8);
      } catch { finish({ url: null, duration: 0, failed: true }); }
    };
    v.src = src;
  }));
}

function getPoster(src: string) {
  let p = posterCache.get(src);
  if (!p) { p = grabPoster(src); posterCache.set(src, p); }
  return p;
}

// ---- ffmpeg fallback (server/main process returns JPEGs; kept here as blob URLs in memory only) ----
type FrameSet = { urls: string[]; duration: number };
const frameSets = new Map<string, FrameSet>(); // LRU, ~50 videos
const MAX_FRAMESETS = 50;
function rememberFrames(src: string, fsx: FrameSet) {
  frameSets.delete(src); frameSets.set(src, fsx);
  while (frameSets.size > MAX_FRAMESETS) {
    const [k, v] = frameSets.entries().next().value as [string, FrameSet];
    v.urls.forEach(u => URL.revokeObjectURL(u)); frameSets.delete(k);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { frameSets.forEach(v => v.urls.forEach(u => URL.revokeObjectURL(u))); frameSets.clear(); });
}
function b64ToUrl(b64: string): string {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: 'image/jpeg' }));
}
async function fetchFrames(src: string, count: number, signal?: AbortSignal): Promise<FrameSet> {
  const res = await fetch(`/api/media/frames?count=${count}&src=${encodeURIComponent(src)}`, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error('frames failed');
  const j = await res.json() as { duration: number; frames: string[] };
  if (!j.frames?.length) throw new Error('no frames');
  return { duration: j.duration || 0, urls: j.frames.map(b64ToUrl) };
}
const ffPosterCache = new Map<string, Promise<PosterInfo>>();
function getFfPoster(src: string): Promise<PosterInfo> {
  let p = ffPosterCache.get(src);
  if (!p) {
    p = fetchFrames(src, 1).then(fsx => { remember(src + '#ff', fsx.urls[0]); return { url: fsx.urls[0], duration: fsx.duration, failed: false }; })
      .catch(() => ({ url: null, duration: 0, failed: true }));
    ffPosterCache.set(src, p);
  }
  return p;
}

// Only one live hover preview at a time.
let stopActive: (() => void) | null = null;

const fmt = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export function HoverVideoThumb({ src, name, filterClass = '', hoverEnabled = true }: { src: string; name: string; filterClass?: string; hoverEnabled?: boolean }) {
  const [poster, setPoster] = useState<PosterInfo | null>(null);
  const [active, setActive] = useState(false);
  const [pct, setPct] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playFailed, setPlayFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const seeking = useRef(false);
  const [ffMode, setFfMode] = useState(false);
  const [frames, setFrames] = useState<FrameSet | null>(null);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    setPoster(null); setPlayFailed(false); setFfMode(false); setFrames(frameSets.get(src) || null);
    getPoster(src).then(async p => {
      if (!alive) return;
      if (!p.failed) { setPoster(p); setDuration(p.duration); return; }
      // Native decode failed: try the ffmpeg fallback poster (~10%).
      const fp = await getFfPoster(src);
      if (!alive) return;
      if (!fp.failed) setFfMode(true);
      setPoster(fp); setDuration(fp.duration);
    });
    return () => { alive = false; };
  }, [src]);

  const unload = () => {
    abortRef.current?.abort(); abortRef.current = null; setLoadingFrames(false);
    const v = videoRef.current;
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    setActive(false); setPct(0);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); if (stopActive === unload) stopActive = null; }, []);

  const noPreview = poster?.failed || playFailed;

  const onEnter = () => {
    if (!hoverEnabled || noPreview) return;
    timerRef.current = window.setTimeout(() => {
      if (stopActive && stopActive !== unload) stopActive();
      stopActive = unload;
      setActive(true);
      if (ffMode) {
        const cached = frameSets.get(src);
        if (cached) { rememberFrames(src, cached); setFrames(cached); return; }
        const ac = new AbortController(); abortRef.current = ac; setLoadingFrames(true);
        fetchFrames(src, 10, ac.signal).then(fsx => { rememberFrames(src, fsx); setFrames(fsx); if (fsx.duration) setDuration(fsx.duration); })
          .catch(() => { /* aborted or failed: keep poster */ })
          .finally(() => { if (abortRef.current === ac) { abortRef.current = null; setLoadingFrames(false); } });
      }
    }, 200);
  };
  const onLeave = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (stopActive === unload) stopActive = null;
    unload();
  };
  const doSeek = (t: number) => {
    const v = videoRef.current; if (!v) return;
    if (seeking.current) { pendingSeek.current = t; return; }
    seeking.current = true; v.currentTime = t;
  };
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setPct(p);
    if (!ffMode && duration > 0) doSeek(p * duration);
  };

  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave} onMouseMove={onMove}
      className={`relative w-full h-full overflow-hidden bg-slate-900 select-none ${active ? 'cursor-ew-resize' : ''}`}>
      {poster?.url ? (
        <img src={poster.url} alt={name} draggable={false} className={`absolute inset-0 w-full h-full object-cover ${filterClass}`} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500">
          {poster ? <Film className="h-7 w-7" /> : <div className="h-5 w-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />}
        </div>
      )}
      {active && ffMode && frames && frames.urls.length > 0 && (
        <img src={frames.urls[Math.min(frames.urls.length - 1, Math.floor(pct * frames.urls.length))]} alt="" draggable={false} className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${filterClass}`} />
      )}
      {active && ffMode && loadingFrames && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-indigo-400/60 animate-pulse pointer-events-none" />
      )}
      {active && ffMode && (
        <div className="absolute top-1.5 right-1.5 bg-slate-950/80 px-1 py-0.5 rounded text-[8px] font-bold text-slate-300 pointer-events-none" title="Preview frames decoded by ffmpeg in memory; original unchanged">FFMPEG</div>
      )}
      {active && !ffMode && (
        <video ref={videoRef} src={src} muted playsInline preload="auto"
          onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) { setDuration(d); doSeek(pct * d); } }}
          onSeeked={() => { seeking.current = false; const n = pendingSeek.current; pendingSeek.current = null; if (n != null) doSeek(n); }}
          onError={() => { setPlayFailed(true); onLeave(); }}
          className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${filterClass}`} />
      )}
      {duration > 0 && (
        <div className="absolute bottom-1.5 right-1.5 bg-slate-950/80 px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-200 flex items-center gap-1 pointer-events-none">
          <Play className="h-2 w-2 fill-current" />{fmt(duration)}
        </div>
      )}
      {noPreview && (
        <div className="absolute top-1.5 left-1.5 bg-slate-950/85 px-1.5 py-0.5 rounded text-[9px] font-bold text-amber-300 pointer-events-none" title="This codec can't be decoded for preview (e.g. HEVC). Click to open; the original is unchanged.">No preview</div>
      )}
      {active && duration > 0 && (!ffMode || frames) && (
        <>
          <div className="absolute top-1.5 bg-indigo-600 text-white font-mono text-[9px] font-bold px-1.5 py-0.5 rounded -translate-x-1/2 pointer-events-none" style={{ left: `${Math.min(90, Math.max(10, pct * 100))}%` }}>
            {fmt(pct * duration)}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/50 pointer-events-none">
            <div className="h-full bg-indigo-500" style={{ width: `${pct * 100}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
