import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Loader2,
  MapPin,
  Play,
  Search,
  ShieldAlert,
  Tag,
  User,
} from 'lucide-react';
import type { AccountRecord, ForensicEvent, UploadedFile } from '../types';
import { accountFilterLabel } from '../identity/extractIdentifiers';
import {
  MEDIA_PAGE_SIZE_STORAGE_KEY,
  mediaDisplaySrc,
  normalizeMediaPageSize,
  paginateItems,
  readStoredMediaPageSize,
} from '../lib/casePersistence';
import { countMediaKinds, fileDigestList, fileHasLocation, filterMediaFiles, mediaTagKey, type MediaKind } from '../lib/mediaBrowser';
import { coordSourceLabel, osmLink } from '../lib/locationRecord';
import { MediaPager } from './MediaPager';
import { useHeicPreview } from '../lib/heicPreview';
import { useGallerySettings, type ThumbMode } from '../lib/gallerySettings';

function HeicAwareImage({ url, name, onFail }: { url: string; name: string; onFail: () => void }) {
  const heic = useHeicPreview(url, name);
  if (heic.isHeic && heic.status === 'converting') return <p className="text-xs text-slate-300 p-6">Converting HEIC preview…</p>;
  if (heic.isHeic && heic.status === 'failed') return <p className="text-xs text-amber-300 p-6">Could not convert this HEIC for preview. The original file is unchanged and still exports/hashes normally.</p>;
  return (
    <div className="flex flex-col items-center gap-1">
      <img key={heic.src || url} src={heic.src || url} alt={name} className="max-h-[60vh] max-w-full rounded-md shadow-lg object-contain" onError={onFail} />
      {heic.isHeic && <span className="text-[10px] font-bold text-amber-300">HEIC — converted JPEG preview (original unchanged)</span>}
    </div>
  );
}
import { MediaThumb } from './MediaThumb';
import { HashMatchBadges } from './HashMatchBadges';
import type { HashHit } from '../lib/hashSets';

export interface MediaVaultProps {
  files: UploadedFile[];
  evidenceTags: Record<string, { tagged?: boolean; notes?: string }>;
  events?: ForensicEvent[];
  accounts?: AccountRecord[] | null;
  accountFilter?: string;
  onAccountFilterChange?: (value: string) => void;
  /** Show the account dropdown in this grid. The main app already has one above the tabs. */
  showAccountFilter?: boolean;
  vicHashes?: ReadonlySet<string>;
  hashHits?: ReadonlyMap<string, HashHit[]> | null;
  caseId?: string;
  forensicProgress?: { current: number; total: number } | null;
  onToggleTag?: (tagKey: string) => void;
  onUpdateNotes?: (tagKey: string, notes: string) => void;
  onBulkTag?: (tagged: boolean) => void;
  emptyHint?: string;
  /** Open this media item's inspect view. `focusNonce` changes on each request. */
  focusName?: string | null;
  focusNonce?: number;
}

export function MediaVault({
  files,
  evidenceTags,
  events,
  accounts,
  accountFilter = 'all',
  onAccountFilterChange,
  showAccountFilter = false,
  vicHashes,
  hashHits,
  caseId = '',
  forensicProgress,
  onToggleTag,
  onUpdateNotes,
  onBulkTag,
  emptyHint,
  focusName,
  focusNonce = 0,
}: MediaVaultProps) {
  const hashes = vicHashes || emptySet;
  const [kind, setKind] = useState<MediaKind>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readStoredMediaPageSize(typeof window !== 'undefined' ? window.localStorage : null));
  const [skinToneThreshold, setSkinToneThreshold] = useState(30);
  const [groupTagging, setGroupTagging] = useState(false);
  const [gallery, setGallery] = useGallerySettings();
  const [zoom, setZoom] = useState<UploadedFile | null>(null);
  const [zoomFailed, setZoomFailed] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const skipPageReset = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(MEDIA_PAGE_SIZE_STORAGE_KEY, String(normalizeMediaPageSize(pageSize)));
    } catch {
      /* private browsing */
    }
  }, [pageSize]);

  useEffect(() => {
    if (skipPageReset.current) {
      skipPageReset.current = false;
      return;
    }
    setPage(1);
  }, [kind, query, accountFilter, pageSize, caseId, skinToneThreshold]);

  useEffect(() => {
    if (!focusNonce || !focusName) return;
    const file = files.find(item => item.isMedia && (item.name === focusName || item.relativePath === focusName));
    if (!file) return;
    const index = files.filter(item => item.isMedia).findIndex(item => item === file);
    skipPageReset.current = true;
    setKind('all');
    setQuery('');
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
    setZoom(file);
  }, [focusNonce, focusName, files, pageSize]);

  useEffect(() => {
    setZoomFailed(false);
  }, [zoom]);

  const eventByName = useMemo(() => {
    const map = new Map<string, ForensicEvent>();
    const list = events || [];
    for (let i = 0; i < list.length; i++) {
      const name = list[i].details?.resolvedMediaName;
      if (typeof name === 'string' && name && !map.has(name)) map.set(name, list[i]);
    }
    return map;
  }, [events]);

  const tagKeyFor = (file: UploadedFile) => mediaTagKey(file.name, eventByName);

  const counts = useMemo(
    () => countMediaKinds(files, hashes, skinToneThreshold),
    [files, hashes, skinToneThreshold]
  );

  const filtered = useMemo(
    () =>
      filterMediaFiles({
        files,
        kind,
        query,
        accountFilter,
        accounts,
        events,
        evidenceTags,
        vicHashes: hashes,
        skinToneThreshold,
        tagKeyForFile: tagKeyFor,
      }),
    [files, kind, query, accountFilter, accounts, events, evidenceTags, hashes, skinToneThreshold, eventByName]
  );

  const slice = useMemo(() => paginateItems(filtered, page, pageSize), [filtered, page, pageSize]);

  const scrollTop = () => {
    window.requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const canTag = !!onToggleTag;

  return (
    <div id="tabview-media-vault" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-left space-y-6">
      <div>
        <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm uppercase tracking-wider flex flex-wrap items-center gap-2">
          <ImageIcon className="h-4.5 w-4.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
          <span>Extracted Media Attachment Vault</span>
          {forensicProgress && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-650 dark:text-indigo-405 border border-indigo-100 dark:border-indigo-900/60 animate-pulse ml-2 normal-case">
              <Loader2 className="h-3 w-3 text-indigo-500 animate-spin" />
              <span>Forensic Analysis: {forensicProgress.current}/{forensicProgress.total} ({Math.round((forensicProgress.current / Math.max(1, forensicProgress.total)) * 100)}%)</span>
            </span>
          )}
        </h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
          Preview images and playback video elements associated with chat logs or secure link uploads.
        </p>
      </div>

      {counts.all === 0 ? (
        <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <ImageIcon className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-400 dark:text-slate-650">No media attachments detected in the current workspace.</p>
          <p className="text-xs text-slate-300 dark:text-slate-750 mt-1 max-w-sm mx-auto">
            {emptyHint || 'Click "Load Sample Dataset" above to test mock evidence images and stream base64 video instances.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
            <div className="flex flex-wrap items-center gap-1.5">
              <KindButton active={kind === 'all'} onClick={() => setKind('all')} className={kind === 'all' ? 'bg-slate-850 text-white dark:bg-slate-800' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-105 dark:hover:bg-slate-900'}>
                <span>All Media</span>
                <span className="text-[10px] font-mono font-bold opacity-60">({counts.all})</span>
              </KindButton>
              <KindButton active={kind === 'image'} onClick={() => setKind('image')} className={kind === 'image' ? 'bg-teal-650 text-white shadow-sm' : 'text-teal-605 dark:text-teal-450 hover:bg-teal-50 dark:hover:bg-teal-955/20'}>
                <ImageIcon className="h-3.5 w-3.5" />
                <span>Images Only</span>
                <span className="text-[10px] font-mono font-bold opacity-80">({counts.image})</span>
              </KindButton>
              <KindButton active={kind === 'video'} onClick={() => setKind('video')} className={kind === 'video' ? 'bg-sky-655 text-white shadow-sm' : 'text-sky-605 dark:text-sky-455 hover:bg-sky-50 dark:hover:bg-sky-955/20'}>
                <Play className="h-3.5 w-3.5" />
                <span>Videos Only</span>
                <span className="text-[10px] font-mono font-bold opacity-80">({counts.video})</span>
              </KindButton>
              <KindButton active={kind === 'vic'} onClick={() => setKind('vic')} className={kind === 'vic' ? 'bg-rose-650 text-white shadow-sm' : 'text-rose-605 dark:text-rose-455 hover:bg-rose-50 dark:hover:bg-rose-955/20'}>
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>VIC / CAID Match</span>
                <span className="text-[10px] font-mono font-bold opacity-80">({counts.vic})</span>
              </KindButton>
              <KindButton active={kind === 'nudity'} onClick={() => setKind('nudity')} className={kind === 'nudity' ? 'bg-amber-650 text-white shadow-sm' : 'text-amber-605 dark:text-amber-500 hover:bg-amber-55/20 dark:hover:bg-amber-955/20'}>
                <User className="h-3.5 w-3.5" />
                <span>Potential Nudity</span>
                <span className="text-[10px] font-mono font-bold opacity-85">({counts.nudity})</span>
              </KindButton>
              <KindButton active={kind === 'screenshot'} onClick={() => setKind('screenshot')} className={kind === 'screenshot' ? 'bg-indigo-650 text-white shadow-sm' : 'text-indigo-650 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-955/20'}>
                <Layers className="h-3.5 w-3.5" />
                <span>Screenshots</span>
                <span className="text-[10px] font-mono font-bold opacity-80">({counts.screenshot})</span>
              </KindButton>
              <KindButton active={kind === 'location'} onClick={() => setKind('location')} className={kind === 'location' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30'}>
                <MapPin className="h-3.5 w-3.5" />
                <span>Has location</span>
                <span className="text-[10px] font-mono font-bold opacity-80">({counts.location})</span>
              </KindButton>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 min-w-[180px] flex-1">
                <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <input
                  id="media-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, path, or notes"
                  className="w-full text-xs font-medium px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                />
              </label>
              <div className="flex items-center gap-1.5 pl-2 border-l border-slate-205 dark:border-slate-805">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">Triage:</span>
                <input
                  type="range"
                  min="10"
                  max="80"
                  step="5"
                  value={skinToneThreshold}
                  onChange={(e) => setSkinToneThreshold(Number(e.target.value))}
                  className="w-16 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  title={`Flag image if skin pixels > ${skinToneThreshold}%`}
                />
                <span className="text-[10px] font-mono font-bold text-slate-550">{skinToneThreshold}%</span>
              </div>
            </div>
          </div>

          {showAccountFilter && accounts && accounts.length > 0 && onAccountFilterChange && (
            <label className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Account
              <select
                aria-label="Account filter"
                value={accountFilter}
                onChange={(e) => onAccountFilterChange(e.target.value)}
                className="text-xs font-bold p-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
              >
                <option value="all">All accounts</option>
                {accounts.map((account, idx) => {
                  const label = accountFilterLabel(account, idx);
                  return <option key={label} value={label}>{label}</option>;
                })}
              </select>
            </label>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-955 border border-slate-200 dark:border-slate-800 rounded-xl">
            <div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-350 uppercase tracking-wider block">Bulk Media Actions</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 block font-medium">Tag/untag all media, or enable interactive Group Tagging mode.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onBulkTag && (
                <>
                  <button type="button" onClick={() => onBulkTag(true)} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-sm">
                    <Tag className="h-3.5 w-3.5" />
                    <span>Tag All Media ({counts.all})</span>
                  </button>
                  <button type="button" onClick={() => onBulkTag(false)} className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-955 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs">
                    <Tag className="h-3.5 w-3.5 opacity-40" />
                    <span>Untag All Media</span>
                  </button>
                </>
              )}
              {canTag && (
                <button
                  type="button"
                  onClick={() => setGroupTagging(v => !v)}
                  className={`px-3 py-1.5 border font-bold text-xs rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-xs ${
                    groupTagging
                      ? 'bg-indigo-600 border-indigo-700 text-white hover:bg-indigo-700 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-955'
                  }`}
                >
                  <CheckCircle className={`h-3.5 w-3.5 ${groupTagging ? 'text-emerald-450' : 'text-slate-405'}`} />
                  <span>Group Tagging: {groupTagging ? 'Enabled' : 'Disabled'}</span>
                </button>
              )}
              <label className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={gallery.hoverPreviews} onChange={e => setGallery({ hoverPreviews: e.target.checked })} />
                Hover previews
              </label>
              <label className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 flex items-center gap-1.5">
                <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                Thumbnails:
                <select value={gallery.thumbMode} onChange={e => setGallery({ thumbMode: e.target.value as ThumbMode })} className="bg-transparent font-bold">
                  <option value="normal">Normal</option>
                  <option value="blur">Blur</option>
                  <option value="grayscale">Grayscale</option>
                </select>
              </label>
              {gallery.thumbMode !== 'normal' && (
                <label className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={gallery.revealOnHover} onChange={e => setGallery({ revealOnHover: e.target.checked })} />
                  Reveal on hover
                </label>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-955/10">
              <ImageIcon className="h-10 w-10 text-slate-305 dark:text-slate-750 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-400 dark:text-slate-650">No media attachments matched the active classification filter.</p>
              <p className="text-xs text-slate-350 dark:text-slate-750 mt-1">Try switching back to "All Media" or import custom return assets.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div ref={topRef} id="media-browser-top">
                <MediaPager
                  page={slice.page}
                  pageCount={slice.pageCount}
                  pageSize={slice.pageSize}
                  total={slice.total}
                  start={slice.start}
                  end={slice.end}
                  onPage={(next) => setPage(next)}
                  onPageSize={(size) => setPageSize(normalizeMediaPageSize(size))}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {slice.items.map((file, i) => {
                  const tagKey = tagKeyFor(file);
                  const isTagged = !!evidenceTags[tagKey]?.tagged;
                  const notesVal = evidenceTags[tagKey]?.notes;
                  const isSkinNudity = (file.skinTonePercent || 0) >= skinToneThreshold;
                  return (
                    <div
                      key={`file-${file.name}-${i}`}
                      onClick={() => {
                        if (groupTagging && onToggleTag) onToggleTag(tagKey);
                      }}
                      className={`group relative border rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-950 shadow-xs hover:shadow-md hover:border-indigo-500/50 transition-all flex flex-col justify-between ${
                        groupTagging ? 'cursor-pointer hover:ring-2 hover:ring-indigo-500/40 select-none' : ''
                      } ${isTagged ? 'border-amber-400 dark:border-amber-600/70 ring-1 ring-amber-400/35 bg-amber-500/5' : 'border-slate-200 dark:border-slate-800'}`}
                    >
                      {canTag && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleTag?.(tagKey);
                          }}
                          className={`absolute top-2 right-2 z-10 p-1.5 rounded-md shadow-sm border transition-all cursor-pointer ${
                            isTagged
                              ? 'bg-amber-500 border-amber-600 text-white hover:bg-amber-650'
                              : 'bg-white dark:bg-slate-905 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 opacity-0 group-hover:opacity-100'
                          }`}
                          title={isTagged ? 'Marked as Case Evidence' : 'Flag as Case Evidence'}
                        >
                          <Tag className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <div className="relative aspect-video w-full bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-center overflow-hidden">
                        <MediaThumb file={file} caseId={caseId} mode={gallery.thumbMode} revealOnHover={gallery.revealOnHover} hoverPreviews={gallery.hoverPreviews} />
                        <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setZoom(file);
                            }}
                            className="p-1.5 bg-white text-slate-900 hover:bg-slate-100 rounded-md font-bold text-xs shadow-md flex items-center space-x-1 cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Inspect</span>
                          </button>
                        </div>
                      </div>
                      <div className="p-2.5 text-left bg-white dark:bg-slate-900/95 flex flex-col gap-1">
                        <strong className="block text-[11px] font-mono text-slate-705 dark:text-slate-300 truncate" title={file.name}>
                          {file.name}
                        </strong>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                            {(file.size / 1024).toFixed(1)} KB • {file.mediaType?.toUpperCase()}
                          </span>
                          {isTagged ? (
                            <span className="text-[9px] bg-amber-50 dark:bg-amber-950/40 text-amber-750 dark:text-amber-450 font-extrabold px-1.5 py-0.5 rounded border border-amber-200/50 dark:border-amber-900/30 flex items-center gap-0.5">
                              <Tag className="h-2.5 w-2.5" />
                              <span>EXHIBIT</span>
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <HashMatchBadges hashes={fileDigestList(file)} vicHashes={hashes} hashHits={hashHits} />
                          {file.isScreenshot && (
                            <span className="text-[8px] bg-indigo-50 dark:bg-indigo-955/45 text-indigo-750 dark:text-indigo-405 font-extrabold px-1.5 py-0.5 rounded border border-indigo-200/30 dark:border-indigo-900/30 flex items-center gap-0.5">
                              <Layers className="h-2.5 w-2.5" />
                              <span>SCREENSHOT</span>
                            </span>
                          )}
                          {isSkinNudity && (
                            <span className="text-[8px] bg-amber-50 dark:bg-amber-955/45 text-amber-705 dark:text-amber-455 font-extrabold px-1.5 py-0.5 rounded border border-amber-200/30 dark:border-amber-900/30 flex items-center gap-0.5" title={`Skin density: ${file.skinTonePercent?.toFixed(1)}%`}>
                              <User className="h-2.5 w-2.5" />
                              <span>SKIN ({file.skinTonePercent?.toFixed(0)}%)</span>
                            </span>
                          )}
                        </div>
                        {notesVal ? (
                          <p className="text-[10px] italic text-slate-500 truncate border-t border-slate-100 dark:border-slate-800/60 pt-1 mt-1 font-sans">
                            "{notesVal}"
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <MediaPager
                page={slice.page}
                pageCount={slice.pageCount}
                pageSize={slice.pageSize}
                total={slice.total}
                start={slice.start}
                end={slice.end}
                onPage={(next) => {
                  setPage(next);
                  scrollTop();
                }}
                onPageSize={(size) => {
                  setPageSize(normalizeMediaPageSize(size));
                  scrollTop();
                }}
              />
            </div>
          )}
        </div>
      )}

      {zoom && (
        <MediaLightbox
          file={zoom}
          caseId={caseId}
          tagKey={tagKeyFor(zoom)}
          tagged={!!evidenceTags[tagKeyFor(zoom)]?.tagged}
          notes={evidenceTags[tagKeyFor(zoom)]?.notes || ''}
          failed={zoomFailed}
          onFail={() => setZoomFailed(true)}
          onClose={() => setZoom(null)}
          onToggleTag={onToggleTag}
          onUpdateNotes={onUpdateNotes}
          vicHashes={hashes}
          hashHits={hashHits}
        />
      )}
    </div>
  );
}

function LocationFacts({ file }: { file: UploadedFile }) {
  const located = fileHasLocation(file);
  return (
    <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Location and capture</p>
      {located && file.gps ? (
        <>
          <p className="font-mono text-xs text-amber-200">{file.gps.lat.toFixed(6)}, {file.gps.lng.toFixed(6)}</p>
          <p className="text-[11px] text-slate-300">Source: {coordSourceLabel(file.coordSource)}</p>
          {file.gpsAlt != null && <p className="text-[11px] text-slate-300">Altitude: {file.gpsAlt} m</p>}
          {file.capturedAt && <p className="text-[11px] text-slate-300">Captured: {file.capturedAt}</p>}
          {file.device && <p className="text-[11px] text-slate-300">Device: {file.device}</p>}
          <a
            href={osmLink(file.gps.lat, file.gps.lng)}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[11px] font-bold text-sky-300 underline"
          >
            Open in maps
          </a>
        </>
      ) : (
        <p className="text-[11px] text-slate-500">No location was stored for this file.</p>
      )}
    </div>
  );
}

const emptySet: ReadonlySet<string> = new Set();

function KindButton({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 font-bold text-xs rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${className}`}
    >
      {children}
    </button>
  );
}

function MediaLightbox({
  file,
  caseId,
  tagKey,
  tagged,
  notes,
  failed,
  onFail,
  onClose,
  onToggleTag,
  onUpdateNotes,
  vicHashes,
  hashHits,
}: {
  file: UploadedFile;
  caseId: string;
  tagKey: string;
  tagged: boolean;
  notes: string;
  failed: boolean;
  onFail: () => void;
  onClose: () => void;
  onToggleTag?: (tagKey: string) => void;
  onUpdateNotes?: (tagKey: string, notes: string) => void;
  vicHashes?: ReadonlySet<string> | null;
  hashHits?: ReadonlyMap<string, HashHit[]> | null;
}) {
  const zoomDisplay = mediaDisplaySrc({ ...file, caseId });
  const missing = failed || zoomDisplay.missing || !zoomDisplay.url;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl relative flex flex-col md:flex-row">
        <div className="flex-1 bg-black flex flex-col justify-between p-4 min-h-[300px] md:min-h-[500px]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono pb-2 border-b border-white/10">
            <span>SYSTEM EXTRACT FILE</span>
            <span>{(file.size / 1024).toFixed(1)} KB</span>
          </div>
          <div className="flex-1 flex items-center justify-center py-6 select-none">
            {missing ? (
              <div className="flex flex-col items-center justify-center gap-2 text-slate-400 text-xs font-mono text-center px-6">
                <ImageIcon className="h-10 w-10 text-slate-500" />
                <span>Media file missing</span>
                <span className="text-[10px] text-slate-500">The original file could not be opened. Records from the saved case are still available.</span>
              </div>
            ) : file.mediaType === 'video' ? (
              <video
                key={zoomDisplay.url}
                src={zoomDisplay.url}
                controls
                preload="metadata"
                className="max-h-[60vh] max-w-full rounded-md shadow-lg"
                onError={onFail}
              />
            ) : (
              <HeicAwareImage url={zoomDisplay.url} name={file.name} onFail={onFail} />
            )}
          </div>
          <div className="text-slate-500 text-[10px] font-mono text-center">Source Name: {file.name}</div>
        </div>
        <div className="w-full md:w-[350px] bg-slate-900 border-t md:border-t-0 md:border-l border-slate-850 p-6 flex flex-col justify-between text-left">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-extrabold text-sm text-slate-100 font-sans tracking-wide">LE EVIDENCE TAGGING</h4>
                <p className="text-[11px] text-slate-400">Mark assets as case exhibits & add notes</p>
              </div>
              <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg text-lg bg-slate-800 hover:bg-slate-750 transition-colors cursor-pointer">
                ✕
              </button>
            </div>
            <div className={`p-4 rounded-xl border transition-all ${tagged ? 'bg-amber-500/10 border-amber-500/50 ring-1 ring-amber-500/20' : 'bg-slate-950/40 border-slate-800'}`}>
              <div className="flex items-start justify-between">
                <div className="space-y-1 pr-2">
                  <span className="font-bold text-xs text-slate-200 block">Flag as Official Exhibit</span>
                  <p className="text-[10px] text-slate-400 leading-snug">Include this image/video file in the final PDF Report and CSV logs index.</p>
                </div>
                {onToggleTag && (
                  <button
                    type="button"
                    onClick={() => onToggleTag(tagKey)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold font-sans transition-all cursor-pointer ${
                      tagged ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/25' : 'bg-slate-800 hover:bg-slate-705 text-slate-300 border border-slate-700'
                    }`}
                  >
                    {tagged ? 'Tagged' : 'Tag Exhibit'}
                  </button>
                )}
              </div>
              {tagged && (
                <div className="mt-3 bg-amber-500/5 border border-amber-500/25 rounded-md p-2 flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="font-mono text-[9px] font-bold text-amber-500 uppercase tracking-wider">EXHIBIT ACTIVE</span>
                </div>
              )}
            </div>
            <HashMatchBadges hashes={fileDigestList(file)} vicHashes={vicHashes} hashHits={hashHits} />
            <LocationFacts file={file} />
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">Examiner Notes</label>
              <textarea
                placeholder="Write descriptive findings, participant ties, or evidentiary purpose here..."
                value={notes}
                readOnly={!onUpdateNotes}
                onChange={(e) => onUpdateNotes?.(tagKey, e.target.value)}
                className="w-full h-36 p-3 rounded-lg border border-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-950 text-slate-200 text-xs leading-relaxed font-sans resize-none"
              />
            </div>
          </div>
          <div className="pt-6 border-t border-slate-800 mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!tagged && onToggleTag) onToggleTag(tagKey);
                onClose();
              }}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-all shadow-md cursor-pointer text-center"
            >
              Save & Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
