/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Play, Film } from 'lucide-react';

interface VideoScrubberProps {
  src: string;
  className?: string;
}

export function VideoScrubber({ src, className = "w-full h-full" }: VideoScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [duration, setDuration] = useState(0);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(!src);

  // Seek to 0.1s on load to capture a thumbnail frame instead of black
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0.1;
    }
    setIsLoaded(false);
    setHasError(!src);
  }, [src]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
      setIsLoaded(true);
    }
  };

  const handleLoadedData = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setHasError(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || duration <= 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    
    setHoverPercent(pct);
    
    // Seek to the exact frame relative to mouse position
    videoRef.current.currentTime = pct * duration;
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setHoverPercent(0);
    // Reset back to static starting frame
    if (videoRef.current) {
      videoRef.current.currentTime = 0.1;
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      className={`relative overflow-hidden cursor-ew-resize bg-slate-900 select-none flex items-center justify-center ${className}`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onLoadedData={handleLoadedData}
        onError={handleError}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded && !hasError ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Loading or Unsupported Codec Fallback State */}
      {(!isLoaded || hasError) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-400 p-4 text-center">
          {hasError ? (
            <>
              <Film className="h-7 w-7 text-slate-600 mb-1" />
              <span className="text-[10px] font-semibold text-slate-500">Media file missing</span>
              <span className="text-[9px] text-slate-650 mt-0.5">The original file could not be opened</span>
            </>
          ) : (
            <div className="flex flex-col items-center space-y-1">
              <div className="h-5 w-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-[9px] text-slate-500">Rendering Video...</span>
            </div>
          )}
        </div>
      )}

      {/* Grid overlay lines (Griffeye-style subtle overlay) */}
      <div className="absolute inset-0 pointer-events-none border border-white/5 bg-gradient-to-b from-black/10 via-transparent to-black/25" />

      {/* UI Overlays */}
      {isLoaded && !hasError && (
        <>
          {/* Static length badge at the bottom-left */}
          <div className="absolute bottom-2 left-2 bg-slate-950/80 px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-350 flex items-center space-x-1 border border-white/10 shadow-sm pointer-events-none">
            <Play className="h-2 w-2 fill-current text-indigo-400" />
            <span>
              {duration > 0
                ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`
                : '0:00'}
            </span>
          </div>

          {/* Interactive Scrub Lines, Timestamps, and Progress Bar */}
          {isHovered && duration > 0 && (
            <>
              {/* Scrub vertical guide line */}
              <div
                className="absolute top-0 bottom-0 w-px bg-indigo-500/70 pointer-events-none"
                style={{ left: `${hoverPercent * 100}%` }}
              />

              {/* Float-above mouse timestamp preview */}
              <div
                className="absolute top-2 bg-indigo-600 text-white font-mono text-[9px] font-bold px-1.5 py-0.5 rounded shadow-lg border border-indigo-400/30 transition-all pointer-events-none -translate-x-1/2"
                style={{
                  left: `${hoverPercent * 100}%`,
                }}
              >
                {(() => {
                  const currentSec = hoverPercent * duration;
                  const mins = Math.floor(currentSec / 60);
                  const secs = Math.floor(currentSec % 60);
                  const ms = Math.floor((currentSec % 1) * 100);
                  return `${mins}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
                })()}
              </div>

              {/* Progress track overlay */}
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-950/50 pointer-events-none">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-75"
                  style={{ width: `${hoverPercent * 100}%` }}
                />
              </div>
            </>
          )}

          {/* Interactive cue text */}
          {!isHovered && (
            <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-slate-950/75 text-[8px] font-black uppercase tracking-wider text-slate-300 px-1.5 py-0.5 rounded border border-white/5 pointer-events-none">
              ↔ Drag to Seek
            </div>
          )}
        </>
      )}
    </div>
  );
}
