import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import html2canvas from 'html2canvas';
import { Camera, Eye, Layers, Map, RefreshCw } from 'lucide-react';
import { kindLabel, type LocationKind } from '../lib/locationRecord';
import { locationsToCsv, locationsToKml } from '../lib/locationExport';
import { locationTagKey } from '../lib/locationTag';

const STREET_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const KIND_COLOR: Record<LocationKind, string> = {
  ip: '#e11d48',
  'photo-exif': '#d97706',
  'video-metadata': '#0284c7',
  'location-record': '#059669',
  sidecar: '#7c3aed',
};

export interface MapPoint {
  id: string;
  kind: LocationKind;
  lat: number;
  lng: number;
  title: string;
  fileName: string;
  filePath?: string | null;
  recordPath?: string | null;
  capturedAt?: string | null;
  accuracy?: number | null;
  device?: string | null;
  coordSource?: string | null;
  mediaName?: string | null;
  eventId?: string | null;
}

interface LocationsMapProps {
  points: MapPoint[];
  ips: string[];
  lookupIps: boolean;
  onOpenMedia?: (name: string) => void;
  onOpenRecord?: (point: MapPoint) => void;
  onRescan?: () => void;
  rescanning?: boolean;
  evidenceTags?: Record<string, { tagged?: boolean; notes?: string }>;
  onToggleTag?: (key: string) => void;
  onUpdateNotes?: (key: string, notes: string) => void;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dayKey(value?: string | null): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value.slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

export const LocationsMap: React.FC<LocationsMapProps> = ({
  points,
  ips,
  lookupIps,
  onOpenMedia,
  onOpenRecord,
  onRescan,
  rescanning,
  evidenceTags,
  onToggleTag,
  onUpdateNotes,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const fittedKeyRef = useRef<string>('');
  const accuracyRef = useRef<L.Circle | null>(null);
  const onOpenMediaRef = useRef(onOpenMedia);
  const onOpenRecordRef = useRef(onOpenRecord);
  onOpenMediaRef.current = onOpenMedia;
  onOpenRecordRef.current = onOpenRecord;
  const [ipPoints, setIpPoints] = useState<MapPoint[]>([]);
  const [loadingIps, setLoadingIps] = useState(false);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [cluster, setCluster] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [includeUndated, setIncludeUndated] = useState(true);
  const [taggedOnly, setTaggedOnly] = useState(false);
  const tagsRef = useRef(evidenceTags);
  const onToggleTagRef = useRef(onToggleTag);
  const onUpdateNotesRef = useRef(onUpdateNotes);
  tagsRef.current = evidenceTags;
  onToggleTagRef.current = onToggleTag;
  onUpdateNotesRef.current = onUpdateNotes;
  const [layers, setLayers] = useState<Record<LocationKind, boolean>>({
    ip: true,
    'photo-exif': true,
    'video-metadata': true,
    'location-record': true,
    sidecar: true,
  });

  const ipsKey = useMemo(() => (ips || []).slice().sort().join(','), [ips]);

  useEffect(() => {
    if (!lookupIps || !ips.length) {
      setIpPoints([]);
      setLoadingIps(false);
      return;
    }
    let alive = true;
    const run = async () => {
      setLoadingIps(true);
      const found: MapPoint[] = [];
      const seen = new Set<string>();
      for (const ip of ips) {
        if (!ip || seen.has(ip)) continue;
        seen.add(ip);
        if (ip.includes('Unknown') || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') || ip.startsWith('172.2') || ip.startsWith('172.30.') || ip.startsWith('172.31.')) continue;
        try {
          const apiKey = localStorage.getItem('ipinfo_api_key');
          const url = apiKey ? `https://ipinfo.io/${ip}/json?token=${apiKey}` : `https://ipinfo.io/${ip}/json`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json();
          if (!data.loc) continue;
          const [lat, lng] = String(data.loc).split(',').map(Number);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          found.push({
            id: `ip-${ip}`,
            kind: 'ip',
            lat,
            lng,
            title: ip,
            fileName: ip,
            filePath: [data.city, data.region, data.country].filter(Boolean).join(', '),
            recordPath: data.org || '',
            coordSource: 'ipinfo',
          });
        } catch {
          /* one address failing does not stop the rest */
        }
      }
      if (alive) {
        setIpPoints(found);
        setLoadingIps(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, [ipsKey, lookupIps]);

  const visible = useMemo(() => {
    const all = points.concat(ipPoints);
    return all.filter(point => {
      if (taggedOnly && !evidenceTags?.[locationTagKey(point)]?.tagged) return false;
      if (!layers[point.kind]) return false;
      const day = dayKey(point.capturedAt);
      if (!day) return includeUndated;
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
  }, [points, ipPoints, layers, fromDate, toDate, includeUndated, taggedOnly, evidenceTags]);

  const visibleKey = useMemo(
    () => visible.map(p => `${p.id}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}:${p.kind}:${evidenceTags?.[locationTagKey(p)]?.tagged ? 1 : 0}`).join('|'),
    [visible, evidenceTags]
  );

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
    mapRef.current = map;
    tileLayerRef.current = L.tileLayer(STREET_TILES, { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(mapContainerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!tileLayerRef.current) return;
    tileLayerRef.current.setUrl(mapStyle === 'satellite' ? SATELLITE_TILES : STREET_TILES);
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (markersRef.current) {
      map.removeLayer(markersRef.current);
      markersRef.current = null;
    }
    const group: L.LayerGroup = cluster ? L.markerClusterGroup({ maxClusterRadius: 48, spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true }) : L.featureGroup();
    markersRef.current = group;
    visible.forEach(point => {
      const color = KIND_COLOR[point.kind];
      const tagKey = locationTagKey(point);
      const tagged = !!tagsRef.current?.[tagKey]?.tagged;
      const notes = tagsRef.current?.[tagKey]?.notes || '';
      const icon = L.divIcon({
        className: 'uwrp-loc-marker',
        html: tagged
          ? `<div style="width:16px;height:16px;border-radius:3px;background:${color};border:3px solid #f59e0b;box-shadow:0 0 0 2px #fff,0 1px 3px rgba(0,0,0,.45)"></div>`
          : `<div style="width:14px;height:14px;border-radius:99px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
        iconSize: tagged ? [16, 16] : [14, 14],
        iconAnchor: tagged ? [8, 8] : [7, 7],
      });
      const marker = L.marker([point.lat, point.lng], { icon });
      const openMedia = point.mediaName || (point.kind === 'photo-exif' || point.kind === 'video-metadata' ? point.fileName : '');
      const buttons = [
        `<button type="button" data-uwrp-tag="1" style="margin-top:6px;margin-right:6px">${tagged ? 'Remove tag' : 'Tag location'}</button>`,
        openMedia ? `<button type="button" data-uwrp-open="media" data-name="${escapeHtml(openMedia)}" style="margin-top:6px;margin-right:6px">Open media</button>` : '',
        `<button type="button" data-uwrp-open="record" style="margin-top:6px">Open record</button>`,
      ].join('');
      marker.bindPopup(`
        <div style="font:12px/1.4 sans-serif;color:#0f172a;min-width:210px">
          <strong>${escapeHtml(kindLabel(point.kind))}</strong>
          <div>${escapeHtml(point.title)}</div>
          <div>File: ${escapeHtml(point.fileName)}</div>
          ${point.filePath ? `<div>Path: ${escapeHtml(point.filePath)}</div>` : ''}
          ${point.recordPath ? `<div>Record: ${escapeHtml(point.recordPath)}</div>` : ''}
          ${point.capturedAt ? `<div>Time (as reported): ${escapeHtml(point.capturedAt)}</div>` : '<div>Time: not reported</div>'}
          ${point.accuracy != null ? `<div>Accuracy radius: ${escapeHtml(point.accuracy)} m</div>` : ''}
          ${point.device ? `<div>Device: ${escapeHtml(point.device)}</div>` : ''}
          ${point.coordSource ? `<div>Source: ${escapeHtml(point.coordSource)}</div>` : ''}
          <div style="font-family:monospace;display:flex;align-items:center;gap:6px"><span>${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</span><button type="button" data-uwrp-copy="1" style="font:11px sans-serif">Copy</button></div>
          ${tagged ? '<div style="color:#b45309;font-weight:700">Tagged</div>' : ''}
          <label style="display:block;margin-top:6px">Notes<br><textarea data-uwrp-notes="1" rows="2" style="width:100%;font:11px sans-serif">${escapeHtml(notes)}</textarea></label>
          ${point.recordPath && /^(row|line):/.test(point.recordPath) ? `<div>Source: ${escapeHtml(point.fileName)} (${escapeHtml(point.recordPath.replace(':', ' '))})</div>` : ''}
          ${buttons}
        </div>
      `);
      marker.on('popupopen', (event) => {
        const root = event.popup.getElement();
        root?.querySelector('[data-uwrp-tag]')?.addEventListener('click', () => onToggleTagRef.current?.(tagKey));
        root?.querySelector('[data-uwrp-open="media"]')?.addEventListener('click', () => {
          if (openMedia) onOpenMediaRef.current?.(openMedia);
        });
        root?.querySelector('[data-uwrp-open="record"]')?.addEventListener('click', () => onOpenRecordRef.current?.(point));
        const notesBox = root?.querySelector('[data-uwrp-notes]') as HTMLTextAreaElement | null;
        notesBox?.addEventListener('change', () => onUpdateNotesRef.current?.(tagKey, notesBox.value));
        const copyBtn = root?.querySelector('[data-uwrp-copy]') as HTMLButtonElement | null;
        copyBtn?.addEventListener('click', () => {
          void navigator.clipboard?.writeText(`${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`).then(() => { copyBtn.textContent = 'Copied'; });
        });
        if (accuracyRef.current) { map.removeLayer(accuracyRef.current); accuracyRef.current = null; }
        if (point.accuracy != null && Number(point.accuracy) > 0) {
          accuracyRef.current = L.circle([point.lat, point.lng], { radius: Number(point.accuracy), color: KIND_COLOR[point.kind], weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
        }
      });
      marker.on('popupclose', () => {
        if (accuracyRef.current) { map.removeLayer(accuracyRef.current); accuracyRef.current = null; }
      });
      group.addLayer(marker);
    });
    group.addTo(map);
    // Auto-fit only when the set of points changes, never on re-render or cluster toggle, so user pan/zoom sticks.
    if (visible.length && fittedKeyRef.current !== visibleKey) {
      fittedKeyRef.current = visibleKey;
      fitAll();
    }
  }, [visibleKey, cluster]);

  function fitAll() {
    const map = mapRef.current;
    const group = markersRef.current as L.FeatureGroup | null;
    if (!map || !group || !('getBounds' in group)) return;
    const bounds = group.getBounds();
    if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.2), { maxZoom: 16 });
  }

  const download = (filename: string, mime: string, body: string) => {
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportRows = visible.map(point => ({
    kind: point.kind,
    lat: point.lat,
    lng: point.lng,
    alt: null,
    accuracy: point.accuracy,
    capturedAt: point.capturedAt,
    device: point.device,
    coordSource: point.coordSource,
    fileName: point.fileName,
    filePath: point.filePath,
    recordPath: point.recordPath,
    mediaName: point.mediaName,
    eventId: point.eventId,
  }));

  const capture = async () => {
    if (!mapContainerRef.current) return;
    setCapturing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 200));
      const canvas = await html2canvas(mapContainerRef.current, { useCORS: true, logging: false, backgroundColor: '#0f172a' });
      const link = document.createElement('a');
      link.download = `locations-map-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Map capture failed', err);
    } finally {
      setCapturing(false);
    }
  };

  const counts = useMemo(() => {
    const tally: Record<LocationKind, number> = { ip: 0, 'photo-exif': 0, 'video-metadata': 0, 'location-record': 0, sidecar: 0 };
    points.concat(ipPoints).forEach(point => { tally[point.kind] += 1; });
    return tally;
  }, [points, ipPoints]);

  return (
    <div id="locations-map" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 md:p-6 text-left shadow-xs space-y-4">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-wider flex items-center gap-1.5">
            <Map className="h-4.5 w-4.5 text-emerald-500" />
            Locations Map
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {visible.length.toLocaleString()} points shown. IP lookup is {lookupIps ? 'on' : 'off'} and does not hide photo, video, or file locations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setMapStyle(mapStyle === 'street' ? 'satellite' : 'street')} className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700">
            {mapStyle === 'street' ? <Eye className="inline h-3 w-3 mr-1" /> : <Layers className="inline h-3 w-3 mr-1" />}
            {mapStyle === 'street' ? 'Street' : 'Satellite'}
          </button>
          <button type="button" onClick={() => setCluster(v => !v)} className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700">
            Cluster {cluster ? 'on' : 'off'}
          </button>
          <button type="button" onClick={() => download('locations.csv', 'text/csv', locationsToCsv(exportRows))} className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700">CSV</button>
          <button type="button" onClick={() => download('locations.kml', 'application/vnd.google-earth.kml+xml', locationsToKml(exportRows))} className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700">KML</button>
          <button type="button" onClick={() => void capture()} disabled={capturing} className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
            <Camera className="inline h-3 w-3 mr-1" />
            {capturing ? 'Capturing' : 'Capture'}
          </button>
          {onRescan && (
            <button type="button" onClick={onRescan} disabled={rescanning} className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-emerald-300 text-emerald-800 dark:text-emerald-200">
              <RefreshCw className={`inline h-3 w-3 mr-1 ${rescanning ? 'animate-spin' : ''}`} />
              Rescan media
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        {(Object.keys(KIND_COLOR) as LocationKind[]).map(kind => (
          <label key={kind} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={layers[kind]} onChange={() => setLayers(prev => ({ ...prev, [kind]: !prev[kind] }))} />
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: KIND_COLOR[kind] }} />
            {kindLabel(kind)} ({counts[kind]})
          </label>
        ))}
        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          From <input id="locations-from" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="ml-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent px-1 py-0.5" />
        </label>
        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          To <input id="locations-to" type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="ml-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent px-1 py-0.5" />
        </label>
        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={includeUndated} onChange={e => setIncludeUndated(e.target.checked)} className="mr-1" />
          Include undated
        </label>
        <label className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <input id="locations-tagged-only" type="checkbox" checked={taggedOnly} onChange={e => setTaggedOnly(e.target.checked)} className="mr-1" />
          Tagged only
        </label>
      </div>

      {loadingIps && (
        <p className="text-xs text-indigo-600 dark:text-indigo-300">Looking up {ips.length} IP addresses. Other locations stay on the map.</p>
      )}
      {!lookupIps && ips.length > 0 && (
        <p className="text-xs text-slate-500">IP address lookup is off, so {ips.length} addresses are not plotted. Photo, video, and file locations do not use that setting.</p>
      )}

      <div className="relative w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
        <div ref={mapContainerRef} className="w-full h-[520px] bg-slate-100 dark:bg-slate-950" />
        {visible.length > 0 && (
          <button type="button" onClick={fitAll} title="Fit to all points" className="absolute top-2 right-2 z-[1000] px-2.5 py-1 text-[11px] font-bold rounded-md bg-white/95 text-slate-800 border border-slate-300 shadow">
            Fit to all points
          </button>
        )}
        {visible.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="bg-white/90 dark:bg-slate-900/90 text-xs font-semibold text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
              No locations match the current layers and dates.
            </p>
          </div>
        )}
      </div>

      <ul className="space-y-2 max-h-80 overflow-y-auto">
        {visible.map(point => {
          const tagKey = locationTagKey(point);
          const tag = evidenceTags?.[tagKey];
          return (
            <li key={`${tagKey}-${point.lat}-${point.lng}-${point.fileName}`} className={`rounded-lg border px-3 py-2 text-xs ${tag?.tagged ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-800'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-700 dark:text-slate-200">{kindLabel(point.kind)} · {point.fileName}</p>
                  <p className="font-mono text-slate-500">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleTag?.(tagKey)}
                  className="shrink-0 px-2 py-1 text-[11px] font-bold rounded-md border border-amber-400 text-amber-800 dark:text-amber-200"
                >
                  {tag?.tagged ? 'Tagged' : 'Tag'}
                </button>
              </div>
              <textarea
                value={tag?.notes || ''}
                onChange={e => onUpdateNotes?.(tagKey, e.target.value)}
                rows={2}
                placeholder="Location notes"
                className="mt-2 w-full rounded border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
};
