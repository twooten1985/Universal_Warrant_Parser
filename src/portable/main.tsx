import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationViewer } from '../components/ConversationViewer';
import { ConversationErrorBoundary } from '../components/ConversationErrorBoundary';
import { EventTimeline } from '../components/EventTimeline';
import { MediaVault } from '../components/MediaVault';
import type { AccountRecord, ForensicEvent, UploadedFile } from '../types';
import { kindLabel, osmLink, type LocationKind, type LocationRecord } from '../lib/locationRecord';
import { locationTagKey } from '../lib/locationTag';
import { mediaTagKey } from '../lib/mediaBrowser';
import {
  evidenceTagExportDocument,
  mergeEvidenceTags,
  portableTagStorageKey,
  readStoredPortableTags,
} from '../lib/evidenceTags';

interface PortableMediaRow {
  name: string;
  mediaType?: 'image' | 'video' | null;
  size: number;
  src: string;
  missing?: boolean;
  relativePath?: string;
  md5?: string | null;
  isScreenshot?: boolean;
  skinTonePercent?: number | null;
  gps?: { lat: number; lng: number } | null;
  gpsAlt?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
}

interface PortableFileRow {
  name: string;
  size: number;
  isMedia?: boolean;
  mediaType?: string | null;
}

interface PortableMeta {
  caseId: string;
  investigatorName: string;
  suspectName: string;
  providerName: string;
  generatedAt: string;
  briefingText?: string;
  passcode?: string;
  includeFiles: boolean;
  provider?: string;
  accounts?: AccountRecord[];
  accountInfo?: AccountRecord | null;
  evidenceTags: Record<string, { tagged?: boolean; notes?: string }>;
  stats?: {
    totalEvents: number;
    messagesCount: number;
    connectionsCount: number;
    filesCount: number;
    taggedCount: number;
    mediaCount: number;
  };
}

interface PortablePart {
  events?: ForensicEvent[];
  media?: PortableMediaRow[];
  files?: PortableFileRow[];
  locations?: LocationRecord[];
}

declare global {
  interface Window {
    __UWRP_META?: PortableMeta;
    __UWRP_PARTS?: PortablePart[];
  }
}

function assemble() {
  const meta = window.__UWRP_META;
  const parts = window.__UWRP_PARTS || [];
  const events: ForensicEvent[] = [];
  const media: PortableMediaRow[] = [];
  const files: PortableFileRow[] = [];
  const locations: LocationRecord[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.events) {
      for (let j = 0; j < part.events.length; j++) events.push(part.events[j]);
    }
    if (part.media) {
      for (let j = 0; j < part.media.length; j++) media.push(part.media[j]);
    }
    if (part.files) {
      for (let j = 0; j < part.files.length; j++) files.push(part.files[j]);
    }
    if (part.locations) {
      for (let j = 0; j < part.locations.length; j++) locations.push(part.locations[j]);
    }
  }
  return { meta, events, media, files, locations };
}

function toUploaded(row: PortableMediaRow): UploadedFile {
  return {
    name: row.name,
    content: row.missing ? '' : row.src,
    size: row.size || 0,
    isMedia: true,
    mediaType: row.mediaType === 'video' ? 'video' : 'image',
    relativePath: row.relativePath || row.name,
    md5: row.md5 || undefined,
    isScreenshot: !!row.isScreenshot,
    skinTonePercent: row.skinTonePercent ?? undefined,
    gps: row.gps || null,
    gpsAlt: row.gpsAlt ?? null,
    capturedAt: row.capturedAt || null,
    device: row.device || null,
    coordSource: row.coordSource || null,
    mediaMissing: !!row.missing || !row.src,
  };
}

function downloadTextFile(filename: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportTimelineCsv(providerName: string, filteredEvents: ForensicEvent[]) {
  if (!filteredEvents.length) return;
  const cell = (value: string) => `"${(value || '').replace(/"/g, '""')}"`;
  const headers = ['Record ID', 'Timestamp', 'Category', 'Identity Sender', 'Identity Recipient', 'Action Payload', 'IP Address', 'Geo Location', 'Source File'];
  const csvRows = [headers.join(',')];
  for (let i = 0; i < filteredEvents.length; i++) {
    const evt = filteredEvents[i];
    csvRows.push([
      cell(evt.id),
      cell(evt.timestamp),
      cell(evt.category),
      cell(evt.sender || ''),
      cell(evt.recipient || ''),
      cell(evt.content || ''),
      cell(evt.ipAddress || ''),
      cell(evt.location || ''),
      cell(evt.sourceFile || ''),
    ].join(','));
  }
  const safe = (providerName || 'case').replace(/[^a-zA-Z0-9-_]+/g, '_') || 'case';
  downloadTextFile(`${safe}_forensic_timeline_export.csv`, 'text/csv;charset=utf-8', csvRows.join('\n'));
}

function PortableApp() {
  const initial = useMemo(() => assemble(), []);
  const meta = initial.meta;
  const storageKey = useMemo(() => (meta ? portableTagStorageKey(meta) : ''), [meta]);
  const [unlocked, setUnlocked] = useState(!meta?.passcode);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [tab, setTab] = useState<'overview' | 'messages' | 'timeline' | 'media' | 'locations' | 'exhibits'>('media');
  const [mediaFocus, setMediaFocus] = useState<{ name: string; nonce: number } | null>(null);
  const [tags, setTags] = useState<Record<string, { tagged?: boolean; notes?: string }>>(() => {
    const packaged = initial.meta?.evidenceTags || {};
    if (!initial.meta) return packaged;
    const stored = readStoredPortableTags(
      typeof localStorage === 'undefined' ? null : localStorage,
      portableTagStorageKey(initial.meta)
    );
    return stored ? mergeEvidenceTags(packaged, stored) : packaged;
  });
  const [accountFilter, setAccountFilter] = useState('all');
  const mediaFiles = useMemo(() => initial.media.map(toUploaded), [initial.media]);
  const eventByName = useMemo(() => {
    const map = new Map<string, ForensicEvent>();
    for (let i = 0; i < initial.events.length; i++) {
      const name = initial.events[i].details?.resolvedMediaName;
      if (typeof name === 'string' && name && !map.has(name)) map.set(name, initial.events[i]);
    }
    return map;
  }, [initial.events]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(evidenceTagExportDocument(meta?.caseId || '', tags)));
    } catch {
      /* This browser blocked storage. Export tags still downloads a file. */
    }
  }, [storageKey, tags, meta?.caseId]);

  if (!meta) {
    return <p className="p-8 text-slate-200">This portable case did not include its data files. Unzip the whole folder and open Portable_Case_Viewer.html.</p>;
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <form
          className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-full max-w-sm text-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin === meta.passcode) setUnlocked(true);
            else setPinError(true);
          }}
        >
          <h1 className="text-lg font-extrabold text-white">Portable case locked</h1>
          <p className="text-xs text-slate-400 mt-2 mb-4">Enter the PIN from the investigating agency.</p>
          <input
            type="password"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinError(false); }}
            className="w-full p-3 rounded-lg bg-slate-950 border border-slate-700 text-center tracking-widest text-white"
          />
          {pinError && <p className="text-rose-400 text-xs mt-2 font-semibold">That PIN does not match.</p>}
          <button type="submit" className="mt-4 w-full py-2 rounded-lg bg-indigo-600 text-white font-bold text-sm">Unlock</button>
        </form>
      </div>
    );
  }

  const toggleTag = (key: string) => {
    setTags(prev => ({
      ...prev,
      [key]: { tagged: !prev[key]?.tagged, notes: prev[key]?.notes || '' },
    }));
  };
  const updateNotes = (key: string, notes: string) => {
    setTags(prev => ({
      ...prev,
      [key]: { tagged: !!prev[key]?.tagged, notes },
    }));
  };
  const bulk = (tagged: boolean) => {
    setTags(prev => {
      const next = { ...prev };
      for (let i = 0; i < mediaFiles.length; i++) {
        const file = mediaFiles[i];
        const key = mediaTagKey(file.name, eventByName);
        next[key] = { tagged, notes: prev[key]?.notes || '' };
      }
      return next;
    });
  };

  const exhibitRows: Array<{ id: string; timestamp: string; category: string; content: string; notes: string }> = [];
  const seenExhibits = new Set<string>();
  for (let i = 0; i < initial.events.length; i++) {
    const event = initial.events[i];
    if (!tags[event.id]?.tagged) continue;
    seenExhibits.add(event.id);
    exhibitRows.push({
      id: event.id,
      timestamp: event.timestamp,
      category: event.category,
      content: event.content,
      notes: tags[event.id]?.notes || '',
    });
  }
  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    const key = mediaTagKey(file.name, eventByName);
    if (!tags[key]?.tagged || seenExhibits.has(key)) continue;
    seenExhibits.add(key);
    exhibitRows.push({
      id: key,
      timestamp: file.capturedAt || '',
      category: 'file',
      content: file.name,
      notes: tags[key]?.notes || '',
    });
  }
  const taggedCount = exhibitRows.length;

  const exportTags = () => {
    const safe = (meta.caseId || 'case').replace(/[^a-zA-Z0-9-_]+/g, '_') || 'case';
    downloadTextFile(
      `evidence-tags-${safe}.json`,
      'application/json;charset=utf-8',
      JSON.stringify(evidenceTagExportDocument(meta.caseId || '', tags), null, 2)
    );
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950 px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-indigo-300">PORTABLE CASE VIEWER</p>
            <h1 className="text-lg font-extrabold text-white">{meta.caseId || 'Evidence return'}</h1>
            <p className="text-xs text-slate-400 mt-1">
              {meta.providerName} · {meta.suspectName || 'Subject'} · {meta.investigatorName || 'Examiner'}
            </p>
          </div>
          <button
            id="portable-export-tags"
            type="button"
            onClick={exportTags}
            className="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-extrabold shrink-0"
          >
            Export tags
          </button>
        </div>
        <p id="portable-tag-note" className="text-xs text-amber-200/90 mt-3 max-w-3xl">
          Tags and notes you add here are saved on this computer. They are not written back into the case file. Use Export tags, then Import tags in the main program, to bring them back into the case.
        </p>
      </header>
      <nav className="flex gap-2 px-6 py-3 border-b border-slate-800 overflow-x-auto">
        <TabButton id="overview" tab={tab} setTab={setTab}>Overview</TabButton>
        <TabButton id="messages" tab={tab} setTab={setTab}>Messages</TabButton>
        <TabButton id="timeline" tab={tab} setTab={setTab}>Timeline</TabButton>
        <TabButton id="media" tab={tab} setTab={setTab}>Media Vault ({meta.stats?.mediaCount ?? mediaFiles.length})</TabButton>
        <TabButton id="locations" tab={tab} setTab={setTab}>Locations ({initial.locations.length + mediaFiles.filter(file => file.gps).length})</TabButton>
        <TabButton id="exhibits" tab={tab} setTab={setTab}>Exhibits ({taggedCount})</TabButton>
      </nav>
      <main className="max-w-[1600px] mx-auto p-4 md:p-6">
        {tab === 'overview' && (
          <section className="space-y-4 text-sm text-slate-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Events" value={meta.stats?.totalEvents ?? initial.events.length} />
              <Stat label="Messages" value={meta.stats?.messagesCount ?? initial.events.filter(event => event.category === 'message').length} />
              <Stat label="Media" value={meta.stats?.mediaCount ?? mediaFiles.length} />
              <Stat label="Tagged" value={taggedCount} />
            </div>
            {meta.briefingText && <p className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-900 border border-slate-800 rounded-xl p-4">{meta.briefingText}</p>}
            <p className="text-xs text-slate-400">File names in this package. Media bytes are in the media folder next to this page. Original evidence was not modified.</p>
            <ul className="text-xs font-mono space-y-1 max-h-80 overflow-auto bg-slate-900 border border-slate-800 rounded-xl p-3">
              {initial.files.slice(0, 200).map(file => (
                <li key={file.name}>{file.name} · {(file.size / 1024).toFixed(1)} KB</li>
              ))}
              {initial.files.length > 200 && <li>… {initial.files.length - 200} more files</li>}
            </ul>
          </section>
        )}
        {tab === 'messages' && (
          <div id="portable-messages">
            <ConversationErrorBoundary label="Conversation View">
              <ConversationViewer
                events={initial.events}
                loadedFiles={mediaFiles}
                activeProvider={meta.provider || 'discord'}
                suspectAccountHint={meta.suspectName || meta.accountInfo?.username || meta.accountInfo?.displayName || undefined}
                evidenceTags={tags as Record<string, { tagged: boolean; notes?: string }>}
                onToggleTag={toggleTag}
                onUpdateNotes={updateNotes}
              />
            </ConversationErrorBoundary>
          </div>
        )}
        {tab === 'timeline' && (
          <div id="portable-timeline">
            <EventTimeline
              events={initial.events}
              onExportFilteredCSV={(rows) => exportTimelineCsv(meta.providerName, rows)}
              evidenceTags={tags as Record<string, { tagged: boolean; notes?: string }>}
              onToggleTag={toggleTag}
              onUpdateNotes={updateNotes}
              loadedFiles={mediaFiles}
              showCategoryDefinitions
              disableLanguageDetection
              ollamaEnabled={false}
            />
          </div>
        )}
        {tab === 'media' && (
          <MediaVault
            files={mediaFiles}
            evidenceTags={tags}
            events={initial.events}
            accounts={meta.accounts || []}
            accountFilter={accountFilter}
            onAccountFilterChange={setAccountFilter}
            showAccountFilter
            onToggleTag={toggleTag}
            onUpdateNotes={updateNotes}
            onBulkTag={bulk}
            emptyHint={meta.includeFiles ? 'No media was copied into this package.' : 'This package was built without media files.'}
            focusName={mediaFocus?.name}
            focusNonce={mediaFocus?.nonce || 0}
          />
        )}
        {tab === 'locations' && (
            <LocationList
            points={[
              ...mediaFiles.filter(file => file.gps).map(file => ({
                kind: (file.mediaType === 'video' ? 'video-metadata' : 'photo-exif') as LocationKind,
                lat: file.gps!.lat,
                lng: file.gps!.lng,
                alt: file.gpsAlt,
                capturedAt: file.capturedAt,
                device: file.device,
                coordSource: file.coordSource,
                fileName: file.name,
                filePath: file.relativePath,
                mediaName: file.name,
              })),
              ...initial.locations,
            ]}
            evidenceTags={tags}
            onToggleTag={toggleTag}
            onUpdateNotes={updateNotes}
            onOpenMedia={(name) => {
              setMediaFocus({ name, nonce: Date.now() });
              setTab('media');
            }}
          />
        )}
        {tab === 'exhibits' && (
          <ul id="portable-exhibits" className="space-y-2 text-sm">
            {exhibitRows.map(row => (
              <li key={row.id} className="bg-slate-900 border border-amber-900/40 rounded-lg p-3">
                <p className="text-xs text-slate-400 font-mono">{row.timestamp} · {row.category}</p>
                <p className="text-slate-100 mt-1">{row.content}</p>
                <textarea
                  value={row.notes}
                  onChange={(e) => updateNotes(row.id, e.target.value)}
                  placeholder="Examiner notes"
                  rows={2}
                  className="mt-2 w-full text-xs p-2 rounded-lg bg-slate-950 border border-amber-900/40 text-amber-100"
                />
              </li>
            ))}
            {exhibitRows.length === 0 && <li className="text-slate-400 text-sm">No tagged exhibits in this package.</li>}
          </ul>
        )}
      </main>
    </div>
  );
}

function TabButton({
  id,
  tab,
  setTab,
  children,
}: {
  id: 'overview' | 'messages' | 'timeline' | 'media' | 'locations' | 'exhibits';
  tab: string;
  setTab: (id: 'overview' | 'messages' | 'timeline' | 'media' | 'locations' | 'exhibits') => void;
  children: ReactNode;
}) {
  const active = tab === id;
  return (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${active ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
    >
      {children}
    </button>
  );
}

function LocationList({
  points,
  evidenceTags,
  onToggleTag,
  onUpdateNotes,
  onOpenMedia,
}: {
  points: LocationRecord[];
  evidenceTags: Record<string, { tagged?: boolean; notes?: string }>;
  onToggleTag: (id: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onOpenMedia: (name: string) => void;
}) {
  const [taggedOnly, setTaggedOnly] = useState(false);
  const shown = taggedOnly ? points.filter(point => evidenceTags[locationTagKey(point)]?.tagged) : points;
  if (!points.length) {
    return <p className="text-sm text-slate-400">No coordinates were stored in this package. Map tiles are not loaded offline. Each row can open in a maps site when you choose to.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">Coordinates from this case. Tags are saved with the other evidence tags in this package. Nothing is fetched until you open a maps link.</p>
        <label className="text-xs font-bold text-amber-200 shrink-0">
          <input type="checkbox" checked={taggedOnly} onChange={e => setTaggedOnly(e.target.checked)} className="mr-1" />
          Tagged only
        </label>
      </div>
      <ul className="space-y-2">
        {shown.map((point, index) => {
          const tagKey = locationTagKey(point);
          const tag = evidenceTags[tagKey];
          return (
            <li key={`${tagKey}-${index}`} className={`rounded-xl p-3 text-sm border ${tag?.tagged ? 'bg-amber-950/40 border-amber-500' : 'bg-slate-900 border-slate-800'}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">{kindLabel(point.kind)}{tag?.tagged ? ' · tagged' : ''}</p>
              <p className="text-slate-100 font-mono">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</p>
              <p className="text-xs text-slate-400">{point.fileName}{point.recordPath ? ` · ${point.recordPath}` : ''}</p>
              {point.capturedAt && <p className="text-xs text-slate-400">{point.capturedAt}</p>}
              {point.accuracy != null && <p className="text-xs text-slate-400">Accuracy {point.accuracy}</p>}
              <div className="flex gap-3 mt-2">
                <button type="button" className="text-xs font-bold text-amber-200 underline" onClick={() => onToggleTag(tagKey)}>
                  {tag?.tagged ? 'Remove tag' : 'Tag location'}
                </button>
                <a className="text-xs font-bold text-sky-300 underline" href={osmLink(point.lat, point.lng)} target="_blank" rel="noreferrer">Open in maps</a>
                {(point.mediaName || point.kind === 'photo-exif' || point.kind === 'video-metadata') && (
                  <button type="button" className="text-xs font-bold text-amber-200 underline" onClick={() => onOpenMedia(point.mediaName || point.fileName)}>
                    Open media
                  </button>
                )}
              </div>
              <textarea
                value={tag?.notes || ''}
                onChange={(e) => onUpdateNotes(tagKey, e.target.value)}
                placeholder="Location notes"
                rows={2}
                className="mt-2 w-full text-xs p-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{label}</p>
      <p className="text-xl font-black text-white">{value.toLocaleString()}</p>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<PortableApp />);
