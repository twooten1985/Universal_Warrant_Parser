import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { HoverVideoThumb } from './HoverVideoThumb';
import { thumbFilterClass, type ThumbMode } from '../lib/gallerySettings';
import { mediaDisplaySrc } from '../lib/casePersistence';
import type { UploadedFile } from '../types';
import { useHeicPreview } from '../lib/heicPreview';

/** One media tile. The grid mounts this only for the current page. */
export function MediaThumb({ file, caseId, blur, mode, revealOnHover = false, hoverPreviews = true }: { file: UploadedFile; caseId: string; blur?: boolean; mode?: ThumbMode; revealOnHover?: boolean; hoverPreviews?: boolean }) {
  const display = mediaDisplaySrc({ ...file, caseId });
  const [failed, setFailed] = useState(false);
  const missing = display.missing || failed || !display.url;
  const blurClass = mode ? thumbFilterClass(mode, revealOnHover) : (blur ? 'blur-xl group-hover:blur-none' : '');
  const heic = useHeicPreview(display.url, file.name);

  if (missing) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-slate-400 text-[10px] font-mono w-full h-full px-2 text-center">
        <ImageIcon className="h-6 w-6 text-slate-500" />
        <span>Media file missing</span>
      </div>
    );
  }

  if (file.mediaType === 'video') {
    return (
      <div className="w-full h-full">
        <HoverVideoThumb src={display.url} name={file.name} filterClass={blurClass} hoverEnabled={hoverPreviews} />
      </div>
    );
  }

  if (heic.isHeic && heic.status !== 'converted') {
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-slate-400 text-[10px] font-mono w-full h-full px-2 text-center">
        <ImageIcon className="h-6 w-6 text-slate-500" />
        <span>{heic.status === 'failed' ? 'HEIC preview failed — original kept' : 'Converting HEIC…'}</span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <img
        src={heic.src || display.url}
        alt={file.name}
        className={`w-full h-full object-cover transition-all duration-300 ${blurClass}`}
        onError={() => setFailed(true)}
      />
      {heic.isHeic && (
        <span title="JPEG preview converted from HEIC. The original file is unchanged." className="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/70 text-white text-[8px] font-bold tracking-wide">HEIC</span>
      )}
    </div>
  );
}
