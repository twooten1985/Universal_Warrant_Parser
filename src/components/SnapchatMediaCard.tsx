/**
 * Snapchat media inside a message. Local bytes stay blurred until Reveal, Play, or Open.
 * A media ID with no file in the return is labeled and never fetched.
 * Reveal state lives in component memory and is not written anywhere.
 */

import React, { useRef, useState } from 'react';
import type { SnapchatMediaView } from '../lib/snapchatMedia';

function localOnly(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) return null;
  return url;
}

export function SnapchatMediaCard({ view }: { view: SnapchatMediaView }) {
  const [revealed, setRevealed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fullSize, setFullSize] = useState(false);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const src = localOnly(view.localSrc);
  const poster = localOnly(view.poster);
  const showMedia = !failed && !!src && (view.kind === 'local-image' || view.kind === 'local-video');
  const blurred = view.blurredByDefault && !revealed;

  return (
    <div
      className="mt-2 rounded-lg border border-slate-300/40 bg-black/10 p-2 text-left"
      data-attachment-kind={view.kind}
      data-snap-media-id={view.mediaId}
      data-fetches-remote="false"
    >
      {showMedia && view.kind === 'local-image' && (
        <div>
          <img
            src={src || undefined}
            alt={view.filename || view.mediaId}
            onError={() => setFailed(true)}
            className={`max-w-[280px] max-h-[180px] object-contain rounded ${blurred ? 'blur-md' : ''}`}
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {!revealed && (
              <button type="button" className="px-1.5 py-0.5 text-[10px] font-bold rounded border border-slate-300" onClick={() => setRevealed(true)}>
                Reveal
              </button>
            )}
            <button
              type="button"
              className="px-1.5 py-0.5 text-[10px] font-bold rounded border border-slate-300"
              onClick={() => {
                setRevealed(true);
                setFullSize(true);
              }}
            >
              Open full size
            </button>
          </div>
        </div>
      )}
      {showMedia && view.kind === 'local-video' && (
        <div>
          <video
            ref={videoRef}
            src={src || undefined}
            poster={poster || undefined}
            preload="metadata"
            playsInline
            autoPlay={false}
            controls={revealed}
            onError={() => setFailed(true)}
            className={`max-w-[280px] max-h-[180px] ${blurred ? 'blur-md' : ''}`}
          />
          <div className="mt-1 flex flex-wrap gap-1">
            <button
              type="button"
              className="px-1.5 py-0.5 text-[10px] font-bold rounded border border-slate-300"
              onClick={() => {
                setRevealed(true);
                setPlaying(true);
                const node = videoRef.current;
                if (node) void node.play();
              }}
            >
              Play
            </button>
            <button type="button" className="px-1.5 py-0.5 text-[10px] font-bold rounded border border-slate-300" onClick={() => setRevealed(true)}>
              Open
            </button>
          </div>
          {playing ? null : <div className="text-[9px] mt-1">Paused until Play. Video does not autoplay.</div>}
        </div>
      )}
      {fullSize && src && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-6" onClick={() => setFullSize(false)}>
          <img src={src} alt={view.filename || view.mediaId} className="max-w-full max-h-full object-contain" />
        </div>
      )}
      <div className="mt-1 space-y-0.5 text-[9px] font-mono text-slate-500 dark:text-slate-400 break-all">
        <div>Media ID: {view.mediaId}</div>
        {view.decodedId && <div>Decoded ID: {view.decodedId}</div>}
        {view.filename && <div>File: {view.filename}</div>}
        {view.path && view.path !== view.filename && <div>Path: {view.path}</div>}
        {view.hashes.md5 && <div>MD5: {view.hashes.md5}</div>}
        {view.hashes.sha1 && <div>SHA-1: {view.hashes.sha1}</div>}
        {view.hashes.sha256 && <div>SHA-256: {view.hashes.sha256}</div>}
        {view.note && <div className="font-sans font-semibold text-slate-600 dark:text-slate-300">{view.note}</div>}
        {view.kind === 'ambiguous' && (
          <div className="font-sans text-slate-500 dark:text-slate-400">More than one file matches this media ID. Nothing was attached.</div>
        )}
        {view.kind === 'missing' && (
          <div className="font-sans text-slate-500 dark:text-slate-400">Expired or unopened snaps are often left out of the return.</div>
        )}
        {failed && <div className="font-sans font-semibold">Preview could not be shown. The original file was not modified.</div>}
      </div>
    </div>
  );
}
