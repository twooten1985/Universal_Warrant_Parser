import { useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MediaVault } from '../components/MediaVault';
import type { AccountRecord, ForensicEvent, UploadedFile } from '../types';
import { kindLabel, osmLink, type LocationKind, type LocationRecord } from '../lib/locationRecord';

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

function PortableApp() {
  const initial = useMemo(() => assemble(), []);
  const [unlocked, setUnlocked] = useState(!initial.meta?.passcode);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [tab, setTab] = useState<'overview' | 'messages' | 'timeline' | 'media' | 'locations' | 'exhibits'>('media');
  const [mediaFocus, setMediaFocus] = useState<{ name: string; nonce: number } | null>(null);
  const [tags, setTags] = useState(initial.meta?.evidenceTags || {});
  const [accountFilter, setAccountFilter] = useState('all');
  const [eventQuery, setEventQuery] = useState('');
  const meta = initial.meta;
  const mediaFiles = useMemo(() => initial.media.map(toUploaded), [initial.media]);

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
        const match = initial.events.find(e => e.details?.resolvedMediaName === file.name);
        const key = match ? match.id : `media-file-${file.name}`;
        next[key] = { tagged, notes: prev[key]?.notes || '' };
      }
      return next;
    });
  };

  const q = eventQuery.trim().toLowerCase();
  const visibleEvents = q
    ? initial.events.filter(e => `${e.content || ''} ${e.sender || ''} ${e.ipAddress || ''}`.toLowerCase().includes(q))
    : initial.events;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950 px-6 py-4">
        <p className="text-[10px] font-bold tracking-widest text-indigo-300">PORTABLE CASE VIEWER</p>
        <h1 className="text-lg font-extrabold text-white">{meta.caseId || 'Evidence return'}</h1>
        <p className="text-xs text-slate-400 mt-1">
          {meta.providerName} · {meta.suspectName || 'Subject'} · {meta.investigatorName || 'Examiner'}
        </p>
      </header>
      <nav className="flex gap-2 px-6 py-3 border-b border-slate-800 overflow-x-auto">
        <TabButton id="overview" tab={tab} setTab={setTab}>Overview</TabButton>
        <TabButton id="messages" tab={tab} setTab={setTab}>Messages</TabButton>
        <TabButton id="timeline" tab={tab} setTab={setTab}>Timeline</TabButton>
        <TabButton id="media" tab={tab} setTab={setTab}>Media Vault ({meta.stats?.mediaCount ?? mediaFiles.length})</TabButton>
        <TabButton id="locations" tab={tab} setTab={setTab}>Locations ({initial.locations.length + mediaFiles.filter(file => file.gps).length})</TabButton>
        <TabButton id="exhibits" tab={tab} setTab={setTab}>Exhibits</TabButton>
      </nav>
      <main className="max-w-6xl mx-auto p-4 md:p-6">
        {tab === 'overview' && (
          <section className="space-y-4 text-sm text-slate-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Events" value={meta.stats?.totalEvents ?? initial.events.length} />
              <Stat label="Messages" value={meta.stats?.messagesCount ?? 0} />
              <Stat label="Media" value={meta.stats?.mediaCount ?? mediaFiles.length} />
              <Stat label="Tagged" value={meta.stats?.taggedCount ?? 0} />
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
          <EventTable
            rows={visibleEvents.filter(e => e.category === 'message')}
            query={eventQuery}
            setQuery={setEventQuery}
          />
        )}
        {tab === 'timeline' && (
          <EventTable rows={visibleEvents} query={eventQuery} setQuery={setEventQuery} />
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
            onOpenMedia={(name) => {
              setMediaFocus({ name, nonce: Date.now() });
              setTab('media');
            }}
          />
        )}
        {tab === 'exhibits' && (
          <ul className="space-y-2 text-sm">
            {initial.events.filter(e => tags[e.id]?.tagged).map(e => (
              <li key={e.id} className="bg-slate-900 border border-amber-900/40 rounded-lg p-3">
                <p className="text-xs text-slate-400 font-mono">{e.timestamp} · {e.category}</p>
                <p className="text-slate-100 mt-1">{e.content}</p>
                {tags[e.id]?.notes && <p className="text-amber-300 text-xs mt-1">{tags[e.id]?.notes}</p>}
              </li>
            ))}
            {initial.events.every(e => !tags[e.id]?.tagged) && <li className="text-slate-400 text-sm">No tagged exhibits in this package.</li>}
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
  onOpenMedia,
}: {
  points: LocationRecord[];
  onOpenMedia: (name: string) => void;
}) {
  if (!points.length) {
    return <p className="text-sm text-slate-400">No coordinates were stored in this package. Map tiles are not loaded offline. Each row can open in a maps site when you choose to.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Coordinates from this case. Nothing is fetched until you open a maps link.</p>
      <ul className="space-y-2">
        {points.map((point, index) => (
          <li key={`${point.fileName}-${point.recordPath || index}`} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">{kindLabel(point.kind)}</p>
            <p className="text-slate-100 font-mono">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</p>
            <p className="text-xs text-slate-400">{point.fileName}{point.recordPath ? ` · ${point.recordPath}` : ''}</p>
            {point.capturedAt && <p className="text-xs text-slate-400">{point.capturedAt}</p>}
            {point.accuracy != null && <p className="text-xs text-slate-400">Accuracy {point.accuracy}</p>}
            <div className="flex gap-3 mt-2">
              <a className="text-xs font-bold text-sky-300 underline" href={osmLink(point.lat, point.lng)} target="_blank" rel="noreferrer">Open in maps</a>
              {(point.mediaName || point.kind === 'photo-exif' || point.kind === 'video-metadata') && (
                <button type="button" className="text-xs font-bold text-amber-200 underline" onClick={() => onOpenMedia(point.mediaName || point.fileName)}>
                  Open media
                </button>
              )}
            </div>
          </li>
        ))}
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

function EventTable({
  rows,
  query,
  setQuery,
}: {
  rows: ForensicEvent[];
  query: string;
  setQuery: (value: string) => void;
}) {
  const pageSize = 100;
  const [page, setPage] = useState(1);
  const count = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, count);
  const slice = rows.slice((current - 1) * pageSize, current * pageSize);
  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setPage(1); }}
        placeholder="Search events"
        className="w-full text-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white"
      />
      <p className="text-xs text-slate-400">Showing {slice.length} of {rows.length}. Page {current} of {count}.</p>
      <div className="overflow-auto border border-slate-800 rounded-xl">
        <table className="w-full text-left text-xs">
          <tbody>
            {slice.map(row => (
              <tr key={row.id} className="border-b border-slate-800">
                <td className="p-2 font-mono text-slate-400 whitespace-nowrap">{row.timestamp}</td>
                <td className="p-2 text-slate-200">{row.sender}</td>
                <td className="p-2 text-slate-100">{row.content}</td>
                <td className="p-2 font-mono text-emerald-300">{row.ipAddress || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button type="button" className="px-2 py-1 text-xs font-bold rounded bg-slate-800 text-white" disabled={current <= 1} onClick={() => setPage(current - 1)}>Prev</button>
        <button type="button" className="px-2 py-1 text-xs font-bold rounded bg-slate-800 text-white" disabled={current >= count} onClick={() => setPage(current + 1)}>Next</button>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<PortableApp />);
