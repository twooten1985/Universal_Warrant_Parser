/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, DragEvent, ChangeEvent } from 'react';
import { flushSync } from 'react-dom';
import { ProviderType, ForensicEvent, ParseResult, UploadedFile } from './types';
import { parseForensicFile, extractTextFromPdfContent } from './parserHelper';
import { DashboardStats } from './components/DashboardStats';
import { AccountInfoCard } from './components/AccountInfoCard';
import { SharedIdentifiersPanel } from './components/SharedIdentifiersPanel';
import {
  buildAccountKey,
  accountFilterLabel,
  extractIdentifiers,
  suggestLinks,
  IdentifierOccurrence,
  LinkEdge,
} from './identity';
import { ForensicCharts } from './components/ForensicCharts';
import { EventTimeline } from './components/EventTimeline';
import { ConversationViewer } from './components/ConversationViewer';
import { ConversationErrorBoundary } from './components/ConversationErrorBoundary';
import { LocationsMap, type MapPoint } from './components/LocationsMap';
import { GmailBrowser } from './components/GmailBrowser';
import { PortableCaseModal } from './components/PortableCaseModal';
import { motion } from 'motion/react';
import JSZip from 'jszip';
import { generateBriefWithOllama } from './lib/translationHelper';
import { analyzeSkinTone, checkIsScreenshot } from './forensicHelper';
import { classifyReturnName, extensionOf, inventoryBytes, isTextReturnName, listReturnFiles, type InventoriedFile } from './lib/ingestReturn';
import { eventSeedsFromEvents } from './lib/textLocations';
import { mediaKindForSource, validLatLng, type LocationRecord } from './lib/locationRecord';
import { assembleWorkspaceParse } from './lib/consolidateParse';
import {
  addToSet,
  appendEvents,
  bytesFromDataUrl,
  fileParseSignature,
  mediaDisplaySrc,
  paginateItems,
  shouldRestoreSavedParse,
  toUploadedFile,
  workspaceResultFromSaved,
  type SavedWorkspaceFile,
} from './lib/casePersistence';
import { yieldToPaint } from './lib/yieldToPaint';
import { mergeEvidenceTags, readEvidenceTagExport } from './lib/evidenceTags';
import { assembleCaseReport, mediaExhibitTimestamp, standaloneReportPackage, type StandaloneMediaFile } from './lib/caseReportHtml';
import { isHeicName } from './lib/heicPreview';
import { locationTagKey } from './lib/locationTag';
import { HashSetManager } from './components/HashSetManager';
import {
  collectCaseHashes,
  emptyHashWindowCarry,
  formatHashImportSummary,
  hashHitMap,
  hashWindowBounds,
  scanHashWindow,
  VIC_CHUNK_BYTES,
  VIC_CHUNK_OVERLAP,
  type HashHit,
  type HashImportSummary,
  type HashSetInfo,
  type HashWindowCarry,
} from './lib/hashSets';
import { fileKey, fileNeedsHash, mediaNeedsAnalysis, runMediaAnalysis, type AnalysisOutcome, type AnalysisSummary } from './lib/mediaAnalysis';
import { mediaDigestReport, type HashAudit, type HashInventory } from './lib/hashMatchReport';
import { HashMatchReport } from './components/HashMatchReport';
import { reportClientError } from './lib/clientLog';
import { BusyOverlay, type BusyState } from './components/BusyOverlay';
import { MediaPager } from './components/MediaPager';
import { MediaVault } from './components/MediaVault';
import {
  FileText,
  UploadCloud,
  Layers,
  Package,
  Sparkles,
  SlidersHorizontal,
  Info,
  Printer,
  Trash2,
  Lock,
  ChevronRight,
  Database,
  FileCheck,
  HelpCircle,
  Clock,
  UserCheck,
  User,
  CheckCircle,
  Sun,
  Moon,
  Search,
  ShieldAlert,
  Key,
  Image as ImageIcon,
  Tag,
  Play,
  Pause,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  MessageSquare,
  Map as MapIcon,
  Settings,
  Save,
  Plus,
  Upload,
  Loader2,
  FolderOpen,
  Fingerprint,
  Network,
  Maximize2,
  Minimize2,
  Columns,
  ChevronLeft,
  Globe,
  Phone,
  Mail,
  X
} from 'lucide-react';


const providersInfo = {
  discord: {
    name: 'Discord',
    badge: 'Chat logs & DM clusters',
    desc: 'Parses Direct Message (DM) indices, IP address history files, and user.json profile metadata returns.',
    formats: 'user.json, ip_history.csv, messages.csv'
  },
  snapchat: {
    name: 'Snapchat',
    badge: 'Sent/Received stories',
    desc: 'Parses massive snap JSON trees containing Chat History arrays, User Profile parameters, and Login Logs.',
    formats: 'chat_history.json, user_profile.json, ip_history.json'
  },
  kik: {
    name: 'Kik Messenger',
    badge: 'Room logs & message IP',
    desc: 'Reassembles Kik spreadsheet arrays into direct thread chronologies, detailing sending IPs and registration records.',
    formats: 'kik_messages.csv, kik_profile.txt'
  },
  synchronos: {
    name: 'Synchronos Cloud',
    badge: 'Cloud Sync & phone backups',
    desc: 'Unfolds massive device cloud backups, tracking uploaded file directories, device metadata, and synced SMS logs.',
    formats: 'backup_files_manifest.csv, sms_call_sync_log.csv, subscriber_info.txt'
  },
  mega: {
    name: 'Mega Storage',
    badge: 'Storage nodes & transactions',
    desc: 'Parses MEGA LE/BSI JSON: account, session_details, IPs, storage, contacts — UTC times with epoch provenance.',
    formats: 'MEGA LE JSON (userhandle, session_details, storage), optional nodes/sessions CSV'
  },
  cybertip: {
    name: 'NCMEC CyberTip',
    badge: 'CyberTip Returns',
    desc: 'Extracts incident metadata, reported persons, file uploads, and IP addresses from NCMEC XML or JSON reports.',
    formats: 'cybertip.json, cybertip.xml'
  },
  google: {
    name: 'Google Returns',
    badge: 'Takeout / Warrant',
    desc: 'Parses Google Workspace returns, including subscriber info, location history, and account activity from JSON/CSV files.',
    formats: 'subscriber_info.json, location_history.json, etc.'
  },
  twitter: {
    name: 'X Corp / Twitter',
    badge: 'Warrant / Export Returns',
    desc: 'Parses X Corp. (formerly Twitter) exports, including account records, profile metadata, direct message conversations (flat/nested), deleted DMs, likes, tweets, and security IP login audits.',
    formats: 'account.json/txt, direct-messages.json/txt, tweets.json/txt, like.json/txt, ip-audit.json/txt'
  }
};

const REPORT_SECTIONS_KEY = 'uwrp-report-sections-v1';

function reportSectionDefault(key: string, fallback: boolean): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(REPORT_SECTIONS_KEY) || '');
    if (raw && typeof raw[key] === 'boolean') return raw[key];
  } catch {
    /* keep the default */
  }
  return fallback;
}

export default function App() {
  const [activeProvider, setActiveProvider] = useState<ProviderType>('discord');
  const [caseId, setCaseId] = useState('');
  const [investigatorName, setInvestigatorName] = useState('');
  const [suspectName, setSuspectName] = useState('');
  const [glossarySearch, setGlossarySearch] = useState('');
  const [expandedGlossaryTerm, setExpandedGlossaryTerm] = useState<string | null>(null);

  // SQLite and Case Management states
  const [currentCaseDbId, setCurrentCaseDbId] = useState<string>(() => 'case-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now());
  const [savedCases, setSavedCases] = useState<any[]>([]);
  const [caseManagerMessage, setCaseManagerMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [parsedResult, setParsedResult] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsInfo, setDiagnosticsInfo] = useState<{ logPath?: string; logFolder?: string } | null>(null);
  const [autosaveNote, setAutosaveNote] = useState('');
  const signatureRef = useRef('');
  const saveRequestRef = useRef(0);
  const locationRevRef = useRef(0);
  const loadedFilesRef = useRef<UploadedFile[]>([]);
  const [caseLocations, setCaseLocations] = useState<LocationRecord[]>([]);
  const [mediaFocus, setMediaFocus] = useState<{ name: string; nonce: number } | null>(null);
  const [workspaceFocus, setWorkspaceFocus] = useState<string | null>(null);
  const [rescanningLocations, setRescanningLocations] = useState(false);
  const fetchSavedCases = async () => {
    try {
      const res = await fetch('/api/cases');
      if (res.ok) {
        const data = await res.json();
        setSavedCases(data);
      }
    } catch (err) {
      console.error('Failed to fetch saved cases:', err);
    }
  };

  const loadStoredLocations = async (dbId: string) => {
    const all: LocationRecord[] = [];
    let offset = 0;
    const limit = 2000;
    try {
      for (;;) {
        const res = await fetch(`/api/cases/${encodeURIComponent(dbId)}/locations?offset=${offset}&limit=${limit}`);
        if (!res.ok) break;
        const data = await res.json();
        const batch = (data.locations || []) as LocationRecord[];
        for (let i = 0; i < batch.length; i++) all.push(batch[i]);
        if (batch.length < limit || all.length >= 100000) break;
        offset += batch.length;
      }
    } catch (err) {
      console.error('Could not load stored locations', err);
    }
    setCaseLocations(all);
  };

  const rescanLocations = async (fileList?: UploadedFile[], events?: ForensicEvent[]) => {
    const files = fileList || loadedFilesRef.current;
    const sourceEvents = events || parsedResult?.events || [];
    setRescanningLocations(true);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/rescan-locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: files.map(file => ({
            name: file.name,
            relativePath: file.relativePath || '',
            sourcePath: file.sourcePath || null,
            isMedia: !!file.isMedia,
            mediaType: file.mediaType || null,
          })),
          seeds: eventSeedsFromEvents(sourceEvents),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Location rescan failed');
      }
      const data = await res.json();
      locationRevRef.current = Number(data.locationRev || locationRevRef.current);
      const patches = new Map<string, { gps: { lat: number; lng: number } | null; gpsAlt: number | null; capturedAt: string | null; device: string | null; coordSource: string | null }>();
      for (const patch of data.media || []) {
        patches.set(`${patch.relativePath || ''}::${patch.name}`, patch);
      }
      if (patches.size) {
        setLoadedFiles(prev => prev.map(file => {
          const patch = patches.get(`${file.relativePath || ''}::${file.name}`);
          if (!patch) return file;
          return {
            ...file,
            gps: patch.gps,
            gpsAlt: patch.gpsAlt,
            capturedAt: patch.capturedAt,
            device: patch.device,
            coordSource: patch.coordSource,
          };
        }));
      }
      await loadStoredLocations(currentCaseDbId);
    } catch (err: any) {
      reportClientError('Location rescan failed', err?.stack || err?.message || String(err));
      showCaseMsg('Could not rescan locations.', 'error');
    } finally {
      setRescanningLocations(false);
    }
  };

  const loadCase = async (dbId: string) => {
    flushSync(() => setBusy({ label: 'Loading case...', detail: 'Reading the saved case. The original return is not parsed again.' }));
    await yieldToPaint();
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(dbId)}`);
      if (!res.ok) {
        showCaseMsg('Failed to load case.', 'error');
        return;
      }
      const data = await res.json();
      const files = ((data.files || []) as SavedWorkspaceFile[]).map(f => toUploadedFile(f, data.id));
      const total = Number(data.event_count || 0);
      const events: ForensicEvent[] = [];
      const batch = 1000;
      for (let offset = 0; total > 0 && offset < total; offset += batch) {
        flushSync(() => setBusy({
          label: 'Loading case...',
          detail: 'Restoring saved records',
          current: Math.min(offset + batch, total),
          total,
        }));
        await yieldToPaint();
        const evRes = await fetch(`/api/cases/${encodeURIComponent(dbId)}/events?offset=${offset}&limit=${batch}`);
        if (!evRes.ok) throw new Error('Could not read saved records');
        const evData = await evRes.json();
        appendEvents(events, evData.events || []);
      }

      const provider = (data.active_provider || 'discord') as ProviderType;
      const canRestore = !!data.fromSavedParse && shouldRestoreSavedParse(data.signature, files, provider, events.length);
      let result = canRestore
        ? workspaceResultFromSaved({
            provider,
            events,
            accounts: data.accounts,
            accountChanges: data.accountChanges,
            summaryStats: data.summaryStats || undefined,
            accountInfo: data.accountInfo || undefined,
          })
        : null;

      if (!canRestore) {
        const pending = files.filter(f => !f.isMedia && !!f.sourcePath);
        if (pending.length > 0) {
          const byKey = new Map<string, ParseResult>();
          for (let i = 0; i < pending.length; i++) {
            const file = pending[i];
            flushSync(() => setBusy({
              label: 'Parsing return...',
              detail: file.name,
              current: i,
              total: pending.length,
            }));
            await yieldToPaint();
            try {
              const parseRes = await fetch('/api/parse/source', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sourcePath: file.sourcePath,
                  name: file.name,
                  provider: file.provider || provider,
                  relativePath: file.relativePath,
                }),
              });
              if (parseRes.ok) {
                byKey.set(`${file.relativePath || ''}::${file.name}`, await parseRes.json());
              }
            } catch (err: any) {
              reportClientError(`Could not parse ${file.name}`, err?.stack || err?.message || String(err));
            }
          }
          const inputs = files.map(f => ({
            name: f.name,
            relativePath: f.relativePath,
            size: f.size,
            provider: f.provider,
            isMedia: f.isMedia,
            parse: byKey.get(`${f.relativePath || ''}::${f.name}`) || null,
          }));
          result = assembleWorkspaceParse(inputs, provider, (p) => providersInfo[p as ProviderType]?.name || p);
        }
      }

      signatureRef.current = data.signature || fileParseSignature(files, provider);
      locationRevRef.current = Number(data.location_rev || 0);
      setCurrentCaseDbId(data.id);
      setCaseId(data.case_id_code || '');
      setInvestigatorName(data.investigator_name || '');
      setSuspectName(data.suspect_name || '');
      setActiveProvider(provider);
      setLoadedFiles(files);
      setParsedResult(result);
      setEvidenceTags(data.evidence_tags || {});
      void loadStoredLocations(data.id);
      const missing = files.filter(f => f.isMedia && f.mediaMissing).length;
      if (canRestore) {
        showCaseMsg(
          `Restored saved case (${events.length.toLocaleString()} records) without parsing the original return.${missing ? ` ${missing} media file${missing === 1 ? ' is' : 's are'} missing.` : ''}`,
          'success'
        );
      } else if (result) {
        showCaseMsg('Case opened. Saved records were not found, so the original files were parsed from disk.', 'success');
      } else {
        showCaseMsg('Case opened. No saved records were found for this case.', 'success');
      }
    } catch (err: any) {
      console.error('Error loading case:', err);
      reportClientError('Failed to load case', err?.stack || err?.message);
      showCaseMsg('Error loading case data.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveCurrentCase = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const requestId = ++saveRequestRef.current;
    try {
      if (!silent) {
        flushSync(() => setBusy({ label: 'Saving case...', detail: 'Writing records to the local database' }));
        await yieldToPaint();
      }
      const prepared: UploadedFile[] = [];
      let changedInline = false;
      for (let i = 0; i < loadedFiles.length; i++) {
        const file = loadedFiles[i];
        if (!file.isMedia || file.sourcePath || !file.content || !file.content.startsWith('data:')) {
          prepared.push(file);
          continue;
        }
        const bytes = bytesFromDataUrl(file.content);
        if (!bytes) {
          prepared.push({ ...file, content: '' });
          changedInline = true;
          continue;
        }
        try {
          const res = await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/cache-media`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-filename': encodeURIComponent(file.name),
              'x-relative-path': encodeURIComponent(file.relativePath || file.name),
            },
            body: bytes,
          });
          if (!res.ok) throw new Error('cache failed');
          const data = await res.json();
          prepared.push({
            ...file,
            content: '',
            sourcePath: data.sourcePath || undefined,
            mediaMissing: !data.sourcePath,
            size: file.size || bytes.byteLength,
          });
          changedInline = true;
        } catch (err) {
          console.error('Could not cache inline media', file.name, err);
          prepared.push({ ...file, content: '' });
          changedInline = true;
        }
      }
      if (changedInline) setLoadedFiles(prepared);

      const signature = fileParseSignature(prepared, activeProvider);
      const filesForSave = prepared.map(file => ({
        name: file.name,
        relativePath: file.relativePath || '',
        size: file.size || 0,
        isMedia: !!file.isMedia,
        mediaType: file.mediaType || null,
        provider: file.provider || activeProvider,
        sourcePath: file.sourcePath || null,
        content: file.isMedia ? '' : (file.sourcePath ? '' : (file.content || '')),
        md5: file.md5 || null,
        sha1: file.sha1 ?? null,
        sha256: file.sha256 ?? null,
        isScreenshot: !!file.isScreenshot,
        skinTonePercent: file.skinTonePercent ?? null,
        gps: file.gps || null,
        gpsAlt: file.gpsAlt ?? null,
        capturedAt: file.capturedAt || null,
        device: file.device || null,
        coordSource: file.coordSource || null,
        forensicsProcessed: !!file.forensicsProcessed,
        digestFromBytes: !!file.digestFromBytes,
      }));

      const metaRes = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentCaseDbId,
          case_id_code: caseId,
          investigator_name: investigatorName,
          suspect_name: suspectName,
          active_provider: activeProvider,
          signature,
          locationRev: locationRevRef.current,
          files: filesForSave,
          accounts: parsedResult?.accounts || [],
          accountChanges: parsedResult?.accountChanges || [],
          summaryStats: parsedResult?.summaryStats || null,
          accountInfo: parsedResult?.accountInfo || null,
          evidence_tags: evidenceTags,
          keepEvents: true,
        }),
      });
      if (!metaRes.ok) {
        const err = await metaRes.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }

      const events = parsedResult?.events || [];
      const batchSize = 500;
      if (events.length === 0) {
        await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset: 0, events: [], reset: true, complete: true }),
        });
      } else {
        for (let offset = 0; offset < events.length; offset += batchSize) {
          const slice = events.slice(offset, offset + batchSize);
          const evRes = await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              offset,
              events: slice,
              reset: offset === 0,
              complete: offset + slice.length >= events.length,
            }),
          });
          if (!evRes.ok) throw new Error('Failed to store parsed records');
          if (!silent) {
            flushSync(() => setBusy({
              label: 'Saving case...',
              detail: 'Writing parsed records',
              current: Math.min(offset + batchSize, events.length),
              total: events.length,
            }));
            await yieldToPaint();
          }
        }
      }

      if (requestId !== saveRequestRef.current) return;
      signatureRef.current = signature;
      if (silent) {
        setAutosaveNote(`Auto-saved ${new Date().toLocaleTimeString()}`);
      } else {
        showCaseMsg('Case saved. Reopening it will use these records and will not parse the return again.', 'success');
      }
      fetchSavedCases();
    } catch (err: any) {
      console.error('Error saving case:', err);
      reportClientError('Failed to save case', err?.stack || err?.message);
      if (!silent) showCaseMsg('Error saving case: ' + err.message, 'error');
    } finally {
      if (!silent && requestId === saveRequestRef.current) setBusy(null);
    }
  };

  const createNewCase = () => {
    setCurrentCaseDbId('case-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now());
    setCaseId('');
    setInvestigatorName('');
    setSuspectName('');
    setLoadedFiles([]);
    setParsedResult(null);
    setEvidenceTags({});
    signatureRef.current = '';
    locationRevRef.current = 0;
    setCaseLocations([]);
    showCaseMsg('Created new empty case.', 'success');
  };

  const deleteCase = async (dbId: string) => {
    if (!window.confirm('Are you sure you want to delete this case from the SQLite database?')) {
      return;
    }
    try {
      const res = await fetch(`/api/cases/${dbId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showCaseMsg('Case deleted successfully.', 'success');
        fetchSavedCases();
        if (dbId === currentCaseDbId) {
          createNewCase();
        }
      } else {
        showCaseMsg('Failed to delete case.', 'error');
      }
    } catch (err) {
      console.error('Error deleting case:', err);
      showCaseMsg('Error deleting case.', 'error');
    }
  };

  const exportCaseWithOption = (dbId: string, mediaOption: 'all' | 'tagged' | 'none') => {
    window.location.href = `/api/cases/${dbId}/export?mediaOption=${encodeURIComponent(mediaOption)}`;
    setShowExportModal(false);
  };

  const handleImportSQLite = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch('/api/cases/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: buffer
      });

      if (res.ok) {
        const data = await res.json();
        showCaseMsg('Case imported successfully!', 'success');
        await fetchSavedCases();
        if (data.imported_ids && data.imported_ids.length > 0) {
          await loadCase(data.imported_ids[0]);
        }
      } else {
        const err = await res.json();
        showCaseMsg('Error importing SQLite: ' + (err.error || 'Unknown'), 'error');
      }
    } catch (err: any) {
      showCaseMsg('Failed to import: ' + err.message, 'error');
    }
  };

  const showCaseMsg = (text: string, type: 'success' | 'error') => {
    setCaseManagerMessage({ text, type });
    setTimeout(() => {
      setCaseManagerMessage(null);
    }, 4000);
  };

  const handleImportEvidenceTags = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = readEvidenceTagExport(parsed);
      if (!incoming) {
        showCaseMsg('That file is not an evidence tag export.', 'error');
        return;
      }
      const count = Object.keys(incoming.evidenceTags).length;
      setEvidenceTags(prev => mergeEvidenceTags(prev, incoming.evidenceTags));
      const otherCase = incoming.caseId && caseId && incoming.caseId !== caseId
        ? ` The file was labeled ${incoming.caseId}.`
        : '';
      showCaseMsg(
        `Merged ${count.toLocaleString()} tag record${count === 1 ? '' : 's'} into this case.${otherCase} They are saved with the case.`,
        'success'
      );
    } catch (err: any) {
      showCaseMsg(`Could not read that tag file. ${err?.message || ''}`.trim(), 'error');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchSavedCases();
      try {
        const res = await fetch('/api/session/last-case');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data?.id) await loadCase(data.id);
      } catch (err) {
        console.error('Could not restore the last case', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // File processing state for large datasets
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0, currentFileName: '' });

  // Workspace sub-navigation index
  const [activeTab, setActiveTab] = useState<'timeline' | 'media' | 'evidence' | 'chats' | 'ip-map' | 'workspace' | 'entity-discovery' | 'emails'>('timeline');

  // Viewport-Fit Mode (Docked multi-window split workspace layout)
  const [isViewportFitMode, setIsViewportFitMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('forensic_viewport_fit_v1') === 'true';
    }
    return false;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [showDashboardSummary, setShowDashboardSummary] = useState<boolean>(true);

  // Entity Discovery filter states
  const [entitySearchQuery, setEntitySearchQuery] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState<'all' | 'ip' | 'phone' | 'username'>('all');

  // Sync isViewportFitMode with localStorage
  useEffect(() => {
    localStorage.setItem('forensic_viewport_fit_v1', String(isViewportFitMode));
  }, [isViewportFitMode]);

  // Raw file preview inspector state
  const [previewFileContent, setPreviewFileContent] = useState<{ name: string; content: string } | null>(null);

  // Interactive PDF report modal active state
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isPortableModalOpen, setIsPortableModalOpen] = useState(false);

  // PDF report customization settings
  const [reportIncludeCaseMetadata, setReportIncludeCaseMetadata] = useState(true);
  const [reportIncludeAccountMetadata, setReportIncludeAccountMetadata] = useState(() => reportSectionDefault('account', true));
  const [reportIncludeMessages, setReportIncludeMessages] = useState(() => reportSectionDefault('messages', true));
  const [reportIncludeTimeline, setReportIncludeTimeline] = useState(() => reportSectionDefault('timeline', true));
  const [reportIncludeMedia, setReportIncludeMedia] = useState(() => reportSectionDefault('media', true));
  const [reportIncludeLocations, setReportIncludeLocations] = useState(() => reportSectionDefault('locations', true));
  const [reportTimelineOnlyTagged, setReportTimelineOnlyTagged] = useState(true);
  const [reportIncludeEntityDiscovery, setReportIncludeEntityDiscovery] = useState(() => reportSectionDefault('entities', true));
  const [reportIncludeSources, setReportIncludeSources] = useState(() => reportSectionDefault('sources', true));
  const [reportEmbedMedia, setReportEmbedMedia] = useState(false);
  const [reportAgency, setReportAgency] = useState('');
  const [reportItemNumber, setReportItemNumber] = useState('');
  const [reportNotes, setReportNotes] = useState('');
  const [reportTimeZone, setReportTimeZone] = useState('UTC');
  const [reportBlurImages, setReportBlurImages] = useState(true);
  const [reportRedactIp, setReportRedactIp] = useState(false);
  const [reportRedactPii, setReportRedactPii] = useState(false);
  const [reportLogo, setReportLogo] = useState('');

  useEffect(() => {
    localStorage.setItem(REPORT_SECTIONS_KEY, JSON.stringify({
      account: reportIncludeAccountMetadata,
      messages: reportIncludeMessages,
      timeline: reportIncludeTimeline,
      media: reportIncludeMedia,
      locations: reportIncludeLocations,
      entities: reportIncludeEntityDiscovery,
      sources: reportIncludeSources,
    }));
  }, [
    reportIncludeAccountMetadata,
    reportIncludeMessages,
    reportIncludeTimeline,
    reportIncludeMedia,
    reportIncludeLocations,
    reportIncludeEntityDiscovery,
    reportIncludeSources,
  ]);

  // Evidence tagging tracking state
  const [evidenceTags, setEvidenceTags] = useState<Record<string, { tagged: boolean; notes?: string }>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forensic_evidence_tags_v2');
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  // Search state for exhibits list
  const [evidenceSearchQuery, setEvidenceSearchQuery] = useState('');

  // Active sub-account filter for multi-account collections
  const [activeAccountFilter, setActiveAccountFilter] = useState<string>('all');
  const [selectedLinkEdgeId, setSelectedLinkEdgeId] = useState<string | null>(null);

  // Reset account filter if active provider or case changes
  useEffect(() => {
    setActiveAccountFilter('all');
  }, [activeProvider, currentCaseDbId]);


  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showCategoryDefinitions, setShowCategoryDefinitions] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forensic_show_cat_defs_v1');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  // Import Ingestion Settings for performance optimization
  const [ingestDecodeMedia, setIngestDecodeMedia] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forensic_ingest_decode_media');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const [ingestLanguageDetection, setIngestLanguageDetection] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forensic_ingest_lang_detect');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const [ingestAnalyticsCharts, setIngestAnalyticsCharts] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forensic_ingest_charts');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const [ingestIPGeolocation, setIngestIPGeolocation] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forensic_ingest_ip_geo');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  useEffect(() => {
    localStorage.setItem('forensic_ingest_decode_media', String(ingestDecodeMedia));
  }, [ingestDecodeMedia]);
  useEffect(() => {
    localStorage.setItem('forensic_ingest_lang_detect', String(ingestLanguageDetection));
  }, [ingestLanguageDetection]);
  useEffect(() => {
    localStorage.setItem('forensic_ingest_charts', String(ingestAnalyticsCharts));
  }, [ingestAnalyticsCharts]);
  useEffect(() => {
    localStorage.setItem('forensic_ingest_ip_geo', String(ingestIPGeolocation));
  }, [ingestIPGeolocation]);
  
  useEffect(() => {
    localStorage.setItem('forensic_show_cat_defs_v1', String(showCategoryDefinitions));
  }, [showCategoryDefinitions]);

  // Ollama translation settings
  const [ollamaEnabled, setOllamaEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('forensic_ollama_enabled_v1') === 'true';
    }
    return false;
  });
  const [ollamaUrl, setOllamaUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('forensic_ollama_url_v1') || 'http://localhost:11434';
    }
    return 'http://localhost:11434';
  });
  const [ollamaModel, setOllamaModel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('forensic_ollama_model_v1') || 'llama3';
    }
    return 'llama3';
  });
  const [ollamaAutoTranslate, setOllamaAutoTranslate] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('forensic_ollama_auto_translate_v1') === 'true';
    }
    return false;
  });
  const [translations, setTranslations] = useState<Record<string, { text: string; detectedLang: string; originalText: string; translatedAt: string }>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forensic_ollama_translations_v1');
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  useEffect(() => {
    localStorage.setItem('forensic_ollama_enabled_v1', String(ollamaEnabled));
  }, [ollamaEnabled]);
  useEffect(() => {
    localStorage.setItem('forensic_ollama_url_v1', ollamaUrl);
  }, [ollamaUrl]);
  useEffect(() => {
    localStorage.setItem('forensic_ollama_model_v1', ollamaModel);
  }, [ollamaModel]);
  useEffect(() => {
    localStorage.setItem('forensic_ollama_auto_translate_v1', String(ollamaAutoTranslate));
  }, [ollamaAutoTranslate]);
  useEffect(() => {
    localStorage.setItem('forensic_ollama_translations_v1', JSON.stringify(translations));
  }, [translations]);

  // Offline case briefing states using Ollama
  const [briefingText, setBriefingText] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('forensic_ollama_briefing_v1') || '';
    }
    return '';
  });
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('forensic_ollama_briefing_v1', briefingText);
  }, [briefingText]);

  const [ipInfoKey, setIpInfoKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ipinfo_api_key') || '';
    }
    return '';
  });

  // Instructions Modal State
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);
  const [activeInstructionTab, setActiveInstructionTab] = useState<'walkthrough' | 'troubleshooting' | 'zip_ingestion'>('walkthrough');
  const [timelineSearchQuery, setTimelineSearchQuery] = useState('');

  useEffect(() => {
    localStorage.setItem('forensic_evidence_tags_v2', JSON.stringify(evidenceTags));
  }, [evidenceTags]);

  const handleToggleTag = (eventId: string) => {
    setEvidenceTags(prev => {
      const current = prev[eventId];
      return {
        ...prev,
        [eventId]: {
          tagged: !current?.tagged,
          notes: current?.notes || ''
        }
      };
    });
  };

  const handleUpdateNotes = (eventId: string, notes: string) => {
    setEvidenceTags(prev => {
      const current = prev[eventId];
      return {
        ...prev,
        [eventId]: {
          tagged: current?.tagged ?? true,
          notes
        }
      };
    });
  };

  const handleSaveTranslation = (eventId: string, text: string, detectedLang: string, originalText: string) => {
    setTranslations(prev => ({
      ...prev,
      [eventId]: {
        text,
        detectedLang,
        originalText,
        translatedAt: new Date().toISOString()
      }
    }));
  };

  const handleGenerateOllamaBrief = async () => {
    if (unifiedExhibits.length === 0) {
      setBriefingError('No exhibits have been added to the Evidence Locker yet.');
      return;
    }
    
    setIsGeneratingBrief(true);
    setBriefingError(null);
    try {
      const brief = await generateBriefWithOllama(
        unifiedExhibits,
        ollamaUrl,
        ollamaModel,
        { caseId, investigatorName, suspectName }
      );
      setBriefingText(brief);
    } catch (err: any) {
      console.error(err);
      setBriefingError(err.message || 'Failed to communicate with local Ollama service. Ensure Ollama is running, the model is downloaded, and CORS is configured.');
    } finally {
      setIsGeneratingBrief(false);
    }
  };

  // Mapped Platform-Specific Forensic Glossary & Protocols
  const glossaryData = useMemo(() => {
    const list = [
      {
        provider: 'mega',
        term: "Unix Epoch Converter",
        category: "Metadata Protocol",
        description: "All timestamps in MEGA JSON dumps are UTC stored as Unix epoch numbers (seconds since Jan 1, 1970). They are parsed automatically client-side by this workspace tracker.",
        protocol: "Manual Formula: =[cell]/86400+DATE(1970,1,1) in Excel"
      },
      {
        provider: 'mega',
        term: "Active (Status)",
        category: "Account Status",
        description: "Account is active and not suspended. However, it could be either parked, cancelled, or limited.",
        protocol: "Routine client logins permissible."
      },
      {
        provider: 'mega',
        term: "Admin Suspended (Status)",
        category: "Account Status",
        description: "MEGA has traced and closed a batch of accounts related to suspicious behaviour, safety audits, or reported abuse. The ‘mega_support_notes’ field details specific triggers.",
        protocol: "Do NOT attempt to sign-in unless security coordinates are cleared."
      },
      {
        provider: 'mega',
        term: "Parked (Status)",
        category: "Account Status",
        description: "The user cancelled their account or forgot their password and 'parked' it, creating a new account under the same email. Access can be reverted to retrieve original folder nodes. The 10-digit text in a parked account is the UTC timestamp it was parked.",
        protocol: "Audit the 10-digit UNIX parameter for date of parking."
      },
      {
        provider: 'mega',
        term: "Pending Confirmation",
        category: "Account Status",
        description: "The registrant has not completed email validation or signup sequences. Functions are locked.",
        protocol: "Awaiting confirmation link click."
      },
      {
        provider: 'mega',
        term: "Suspended Due to Emergency Takedown",
        category: "Account Status",
        description: "Instantaneous closure of the entire account due to verified/unverified high-severity content violations (CSAM, Violent Extremism, Gore, Terrorist propaganda).",
        protocol: "Immediate voluntary disclosure of IP logs to international authorities."
      },
      {
        provider: 'mega',
        term: "PRO status Levels",
        category: "Subscription Attributes",
        description: "Denotes paid tier: 0: Free account, 1: Pro I paid account, 2: Pro II paid account, 3: Pro III paid account, 4: Pro Lite paid account, 100: Business account / Pro Flexi account.",
        protocol: "Cross-examine payment history cards for detailed invoices."
      },
      {
        provider: 'mega',
        term: "Outshares target '0'",
        category: "Nodes Sharing Key",
        description: "In the Outshares database table, targets of '0' are not real users. They represent fake/purely infrastructural outshares that system-generate folder links.",
        protocol: "Signifies a public directory link was minted."
      },
      {
        provider: 'mega',
        term: "Unwanted Associations Isolation",
        category: "Investigator Operational Protocol",
        description: "CRITICAL: Under no circumstances log into a suspect's account on a browser that has logged into other MEGA accounts. Re-using windows or browser cookies maps associations directly inside MEGA's related-users search index.",
        protocol: "Close ALL incognito windows; launch a fresh Incognito window, perform login, complete download, logout and physically CLOSE the incognito window. Do NOT open another tab. Desktop App logins require fresh Virtual Machines (VM) per account."
      },
      {
        provider: 'mega',
        term: "Public Decryption Key Format",
        category: "Encryption Key",
        description: "Post-April 2020 layout format: https://mega.nz/file/<8 Char Handle>#<43 Char Decryption Key>. MEGA servers NEVER store or receive the decryption hash block (characters following #) — it is processed purely client-side on the suspect's device.",
        protocol: "If you do not possess the key suffix, content files are physically impossible to decrypt."
      },
      {
        provider: 'snapchat',
        term: "b~ Protobuf Media ID Encoding",
        category: "Metadata Protocol",
        description: "Snapchat's b~ prefix denotes Base64 URL-safe protobuf sequences. The actual hash filename is encoded inside, which this tool extracts to automatically match physical media on disk.",
        protocol: "Decoded via Base64 to string extraction logic."
      },
      {
        provider: 'snapchat',
        term: "Physical Media Purging",
        category: "Retention Protocol",
        description: "Snapchat automatically scripts server-purges of opened or expired snaps. Media references that do not match items on disk denote snaps that were purged prior to warrant execution.",
        protocol: "Indicated as MISSING in the active forensic sequence timeline."
      },
      {
        provider: 'kik',
        term: "Est vs UTC conversion",
        category: "Timezone Offset",
        description: "Kik warrant spreadsheets traditionally stamp timestamps in US Eastern Standard Time (EST) or Eastern Daylight Time (EDT). Correlate session offsets carefully when overlapping with master network UTC logs.",
        protocol: "Verify local offset vs standard UTC time parameters."
      },
      {
        provider: 'synchronos',
        term: "Synchronos Cloud Engine",
        category: "Cloud Core",
        description: "Handles off-device carrier-integrated automated backups. Captures direct local directory duplicates, ledger databases, and cell SMS tracks.",
        protocol: "Backups can continue after suspect burner phone formats or deletions are run."
      }
    ];
    return list.filter(item => item.provider === activeProvider);
  }, [activeProvider]);

  const filteredGlossary = useMemo(() => {
    if (!glossarySearch.trim()) return glossaryData;
    const lower = glossarySearch.toLowerCase();
    return glossaryData.filter(item =>
      item.term.toLowerCase().includes(lower) ||
      item.category.toLowerCase().includes(lower) ||
      item.description.toLowerCase().includes(lower)
    );
  }, [glossaryData, glossarySearch]);
  
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forensic_dark_mode');
      return saved === 'true';
    }
    return false;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const body = window.document.body;
    if (darkMode) {
      root.classList.add('dark');
      body.classList.add('dark');
    } else {
      root.classList.remove('dark');
      body.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('forensic_dark_mode', String(next));
      return next;
    });
  };
  
  // Workspace files
  const [loadedFiles, setLoadedFiles] = useState<UploadedFile[]>([]);
  useEffect(() => {
    loadedFilesRef.current = loadedFiles;
  }, [loadedFiles]);

  // Forensic classifications states
  const [vicHashes, setVicHashes] = useState<Set<string>>(new Set<string>());
  const [fileTablePage, setFileTablePage] = useState(1);

  useEffect(() => {
    if (isProcessing || busy || loadedFiles.length === 0 || !parsedResult) return;
    const timer = window.setTimeout(() => {
      void saveCurrentCase({ silent: true });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [parsedResult, evidenceTags, caseId, investigatorName, suspectName, loadedFiles, activeProvider, isProcessing, busy]);
  const [isImportingVic, setIsImportingVic] = useState(false);
  const [vicImportStatus, setVicImportStatus] = useState('');
  const [vicImportedCount, setVicImportedCount] = useState(0);
  const [vicTotalToImport, setVicTotalToImport] = useState(0);
  const [vicImportSummary, setVicImportSummary] = useState('');
  const [hashSets, setHashSets] = useState<HashSetInfo[]>([]);
  const [hashHits, setHashHits] = useState<Map<string, HashHit[]>>(new Map());
  const [hashSetStatus, setHashSetStatus] = useState('');
  const [forensicQueueProgress, setForensicQueueProgress] = useState<{ current: number; total: number } | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary | null>(null);
  const [hashInventory, setHashInventory] = useState<HashInventory | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMediaOption, setExportMediaOption] = useState<'all' | 'tagged' | 'none'>('all');

  // Load forensic hashes from SQLite database on startup
  useEffect(() => {
    fetch("/api/forensic-hashes")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const next = new Set<string>();
          for (let i = 0; i < data.length; i++) {
            const hex = String(data[i] || '').trim().toLowerCase();
            if (/^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(hex)) next.add(hex);
          }
          setVicHashes(next);
        }
      })
      .catch(err => console.error("Failed to load forensic hashes from database:", err));
  }, []);

  const refreshHashSets = async () => {
    try {
      const res = await fetch('/api/hash-sets');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setHashSets(data);
    } catch (err) {
      console.error('Failed to load hash sets', err);
    }
  };

  useEffect(() => {
    void refreshHashSets();
  }, []);

  useEffect(() => {
    if (!isSettingsOpen) return;
    let cancelled = false;
    void fetch('/api/hash-inventory')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data && data.vic && Array.isArray(data.sets)) setHashInventory(data);
      })
      .catch(() => {
        if (!cancelled) setHashInventory(null);
      });
    return () => { cancelled = true; };
  }, [isSettingsOpen, hashSets, vicHashes]);

  useEffect(() => {
    if (hashSets.length === 0) {
      setHashHits(new Map());
      return;
    }
    const hashes = collectCaseHashes(loadedFiles, parsedResult?.events || []);
    if (hashes.length === 0) {
      setHashHits(new Map());
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const map = new Map<string, HashHit[]>();
        try {
          for (let i = 0; i < hashes.length; i += 5000) {
            const res = await fetch('/api/hash-sets/match', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ hashes: hashes.slice(i, i + 5000) }),
            });
            if (!res.ok) {
              console.error('Hash set match failed', res.status);
              continue;
            }
            const rows = await res.json();
            if (!Array.isArray(rows)) continue;
            const part = hashHitMap(rows);
            part.forEach((hits, hash) => {
              const existing = map.get(hash);
              if (existing) existing.push(...hits);
              else map.set(hash, hits.slice());
            });
          }
          if (!cancelled) setHashHits(map);
        } catch (err) {
          console.error('Hash set match failed', err);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadedFiles, parsedResult, hashSets]);

  const filesRef = useRef(loadedFiles);
  filesRef.current = loadedFiles;
  const ingestDecodeMediaRef = useRef(ingestDecodeMedia);
  ingestDecodeMediaRef.current = ingestDecodeMedia;
  const [hashAuditResult, setHashAuditResult] = useState<HashAudit | null>(null);
  const inventoryKey = loadedFiles.map(file => `${file.relativePath || ''}::${file.name}::${file.size}::${file.sourcePath || ''}::${file.hasStoredBytes ? 1 : 0}`).join('|');

  useEffect(() => {
    if (!isSettingsOpen) return;
    const hashes: string[] = [];
    for (let i = 0; i < loadedFiles.length; i++) {
      const file = loadedFiles[i];
      if (!file.digestFromBytes) continue;
      if (file.md5) hashes.push(file.md5);
      if (file.sha1) hashes.push(file.sha1);
      if (file.sha256) hashes.push(file.sha256);
    }
    let cancelled = false;
    fetch('/api/hash-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data && typeof data.uniqueLoaded === 'number' && Array.isArray(data.notFound)) setHashAuditResult(data);
      })
      .catch(() => {
        if (!cancelled) setHashAuditResult(null);
      });
    return () => { cancelled = true; };
  }, [isSettingsOpen, loadedFiles, hashSets, vicHashes]);

  useEffect(() => {
    if (isProcessing) return;
    const controller = new AbortController();
    let alive = true;
    const pending = filesRef.current.filter(file => fileNeedsHash(file) || mediaNeedsAnalysis(file));
    if (pending.length === 0) {
      setForensicQueueProgress(null);
      return;
    }
    const totalCount = filesRef.current.length;
    const alreadyDone = totalCount - pending.length;
    setForensicQueueProgress({ current: alreadyDone, total: totalCount });

    const applyOutcomes = (batch: AnalysisOutcome[]) => {
      if (!alive || batch.length === 0) return;
      setLoadedFiles(prev => prev.map(file => {
        const outcome = batch.find(item => fileKey(item) === fileKey(file));
        if (!outcome) return file;
        const hashed = outcome.digestStatus === 'computed' && !!outcome.md5 && !!outcome.sha1 && !!outcome.sha256;
        return {
          ...file,
          md5: hashed ? outcome.md5 : (file.digestFromBytes ? file.md5 : undefined),
          sha1: hashed ? outcome.sha1 : (file.digestFromBytes ? file.sha1 : undefined),
          sha256: hashed ? outcome.sha256 : (file.digestFromBytes ? file.sha256 : undefined),
          digestFromBytes: hashed ? true : file.digestFromBytes,
          isScreenshot: outcome.isScreenshot ?? file.isScreenshot,
          skinTonePercent: outcome.skinTonePercent ?? file.skinTonePercent,
          gps: outcome.gps || file.gps,
          gpsAlt: outcome.gpsAlt != null ? outcome.gpsAlt : file.gpsAlt,
          capturedAt: outcome.capturedAt || file.capturedAt,
          device: outcome.device || file.device,
          coordSource: outcome.coordSource || file.coordSource,
          mediaMissing: outcome.mediaMissing ?? file.mediaMissing,
          forensicsProcessed: hashed ? true : file.forensicsProcessed,
          digestStatus: outcome.digestStatus,
          digestNote: outcome.reason,
        };
      }));
    };

    const runQueue = async () => {
      const finished: AnalysisOutcome[] = [];
      try {
        const result = await runMediaAnalysis(pending, {
          signal: controller.signal,
          isScreenshot: (file) => checkIsScreenshot(file.name, file.relativePath),
          digest: async (file) => {
            if (isHeicName(file.name) && !file.sourcePath && !file.hasStoredBytes) {
              throw new Error('HEIC is hashed from the original file, not a preview');
            }
            const params = new URLSearchParams();
            if (file.sourcePath) params.set('path', file.sourcePath);
            else if (file.hasStoredBytes) {
              params.set('caseId', currentCaseDbId);
              params.set('rel', file.relativePath || '');
              params.set('name', file.name);
            } else if ((file.content || '').startsWith('data:') && !isHeicName(file.name)) {
              const bytes = bytesFromDataUrl(file.content, Number.MAX_SAFE_INTEGER);
              if (!bytes || bytes.byteLength === 0) throw new Error('Inline file could not be decoded for hashing');
              const posted = await fetch('/api/media/hash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: bytes,
                signal: controller.signal,
              });
              if (!posted.ok) throw new Error(`Hash failed (${posted.status})`);
              const body = await posted.json();
              return { md5: body.md5, sha1: body.sha1, sha256: body.sha256 };
            } else {
              return { missing: true };
            }
            const res = await fetch(`/api/media/hash-file?${params.toString()}`, { signal: controller.signal });
            if (res.status === 404) return { missing: true };
            if (!res.ok) throw new Error(`Hash failed (${res.status})`);
            const hashed = await res.json();
            if (hashed.missing) return { missing: true };
            return { md5: hashed.md5 || undefined, sha1: hashed.sha1 || undefined, sha256: hashed.sha256 || undefined };
          },
          locate: async (file) => {
            if (!file.isMedia || !file.sourcePath) return {};
            const res = await fetch(`/api/media/exif?path=${encodeURIComponent(file.sourcePath)}`, { signal: controller.signal });
            if (!res.ok) throw new Error(`Metadata failed (${res.status})`);
            const found = await res.json();
            return {
              gps: found.gps || null,
              gpsAlt: found.gpsAlt ?? null,
              capturedAt: found.capturedAt || null,
              device: found.device || null,
              coordSource: found.coordSource || null,
            };
          },
          skinTone: ingestDecodeMediaRef.current
            ? async (file) => {
              const src = mediaDisplaySrc({ ...file, caseId: currentCaseDbId, mediaMissing: false }).url;
              if (!src) throw new Error('No preview URL for the nudity check');
              return analyzeSkinTone(src);
            }
            : undefined,
          onFileDone: (done) => {
            if (alive) setForensicQueueProgress({ current: alreadyDone + done, total: totalCount });
          },
        });
        if (!alive || controller.signal.aborted) return;
        finished.push(...result.outcomes);
        applyOutcomes(result.outcomes);
        setAnalysisSummary(result.summary);
      } catch (err) {
        if (!alive || controller.signal.aborted) return;
        console.error('Forensic analysis stopped', err);
        reportClientError('Forensic analysis stopped', err instanceof Error ? err.stack || err.message : String(err));
        setAnalysisSummary({
          analyzed: finished.filter(item => item.status === 'analyzed').length,
          skipped: finished.filter(item => item.status === 'skipped').length,
          failed: finished.filter(item => item.status === 'failed').length + pending.length - finished.length,
          reasons: [{ name: 'Analysis', status: 'failed', reason: err instanceof Error ? err.message : String(err) }],
        });
      } finally {
        if (alive) setForensicQueueProgress(null);
      }
    };

    void runQueue();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [inventoryKey, isProcessing, currentCaseDbId]);

  const handleImportVICHashes = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImportingVic(true);
    setVicImportStatus('Preparing streaming upload...');
    setVicImportSummary('');
    setVicImportedCount(0);
    setVicTotalToImport(file.size);

    const fileSize = file.size;
    const readSlice = (start: number, end: number): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve((event.target?.result as string) || '');
        reader.onerror = (err) => reject(err);
        reader.readAsText(file.slice(start, end));
      });
    };

    let offset = 0;
    const seen = new Set<string>();
    let carry: HashWindowCarry = emptyHashWindowCarry();
    const totals: HashImportSummary = {
      linesRead: 0,
      md5: 0,
      sha1: 0,
      sha256: 0,
      duplicates: 0,
      skippedLines: 0,
      unique: [],
    };
    let pending: string[] = [];
    let added = 0;
    let alreadyPresent = 0;
    let persistFailed = false;

    const flushPending = async () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      setVicImportStatus(`Saving batch of ${batch.length.toLocaleString()} hashes...`);
      try {
        const res = await fetch('/api/forensic-hashes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes: batch }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        const batchAdded = Number(body.added);
        const batchExisting = Number(body.alreadyPresent);
        added += Number.isFinite(batchAdded) ? batchAdded : batch.length;
        alreadyPresent += Number.isFinite(batchExisting) ? batchExisting : 0;
        setVicHashes(prev => addToSet(prev, batch));
      } catch (err) {
        console.error('Batch persist failed:', err);
        persistFailed = true;
        setVicHashes(prev => addToSet(prev, batch));
      }
    };

    try {
      while (offset < fileSize) {
        const bounds = hashWindowBounds(offset, fileSize, VIC_CHUNK_BYTES, VIC_CHUNK_OVERLAP);
        const percent = Math.round((offset / fileSize) * 100);
        setVicImportStatus(`Parsing file: ${percent}% (${(offset / (1024 * 1024 * 1024)).toFixed(2)} GB processed)...`);
        setVicImportedCount(offset);

        const text = await readSlice(bounds.start, bounds.end);
        const part = scanHashWindow(text, bounds.acceptUntil, seen, carry);
        carry = part.carry;
        totals.linesRead += part.summary.linesRead;
        totals.md5 += part.summary.md5;
        totals.sha1 += part.summary.sha1;
        totals.sha256 += part.summary.sha256;
        totals.duplicates += part.summary.duplicates;
        totals.skippedLines += part.summary.skippedLines;
        pending.push(...part.summary.unique);

        if (pending.length >= 100000) await flushPending();
        if (bounds.isLast) break;
        offset = bounds.nextOffset;
      }

      await flushPending();
      setVicImportedCount(fileSize);
      const summary = formatHashImportSummary(totals, added, alreadyPresent) + (persistFailed ? ' Some batches could not be written to the database.' : '');
      setVicImportSummary(summary);
      showCaseMsg(summary, persistFailed ? 'error' : 'success');
    } catch (err: any) {
      console.error('Failed to parse large hash database:', err);
      showCaseMsg(`Failed to read database: ${err.message || err}`, 'error');
    } finally {
      setIsImportingVic(false);
      e.target.value = '';
    }
  };

  const handleBulkTagMedia = (tag: boolean) => {
    const mediaFiles = loadedFiles.filter(f => f.isMedia);
    if (mediaFiles.length === 0) return;
    
    setEvidenceTags(prev => {
      const updated = { ...prev };
      mediaFiles.forEach(file => {
        const matchingEvent = activeResult?.events.find(e => e.details?.resolvedMediaName === file.name);
        const tagKey = matchingEvent ? matchingEvent.id : `media-file-${file.name}`;
        
        updated[tagKey] = {
          tagged: tag,
          notes: prev[tagKey]?.notes || ''
        };
      });
      return updated;
    });
    
    showCaseMsg(
      tag 
        ? `Tagged all ${mediaFiles.length} media files as evidence.` 
        : `Removed evidence tags from all ${mediaFiles.length} media files.`, 
      'success'
    );
  };
  const [rawPaste, setRawPaste] = useState('');
  const [pasteFileName, setPasteFileName] = useState('raw_pasted_data.csv');
  const [dragOver, setDragOver] = useState(false);

  const parseCacheRef = useRef<Map<string, ParseResult>>(new Map());
  const providerLabel = (provider: string) => providersInfo[provider as ProviderType]?.name || provider;

  // Files that still hold raw text (paste, sample data) are parsed one at a time,
  // then the text is dropped. Saved cases never take this path.
  useEffect(() => {
    if (isProcessing) return;
    const pending = loadedFiles.filter(f => !f.isMedia && !!f.content);
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      flushSync(() => setBusy({ label: 'Parsing return...', current: 0, total: pending.length, detail: pending[0]?.name || '' }));
      await yieldToPaint();
      for (let i = 0; i < pending.length; i++) {
        if (cancelled) return;
        const file = pending[i];
        const fileProvider = (file.provider || activeProvider) as ProviderType;
        const cacheKey = `${fileProvider}::${file.relativePath || file.name}::${file.size}`;
        try {
          const parsed = parseForensicFile(fileProvider, file.name, file.content, file.relativePath);
          parseCacheRef.current.set(cacheKey, parsed);
        } catch (err: any) {
          reportClientError(`Could not parse ${file.name}`, err?.stack || err?.message || String(err));
          console.error('Forensic parser failed for', file.name, err);
        }
        if (!file.sourcePath && file.content) {
          try {
            await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/file-text`, {
              method: 'POST',
              headers: {
                'Content-Type': 'text/plain',
                'x-filename': encodeURIComponent(file.name),
                'x-relative-path': encodeURIComponent(file.relativePath || file.name),
                'x-provider': encodeURIComponent(fileProvider),
              },
              body: file.content,
            });
          } catch (err) {
            console.error('Could not store text preview', file.name, err);
          }
        }
        if (i % 2 === 1 || i === pending.length - 1) {
          flushSync(() => setBusy({ label: 'Parsing return...', detail: file.name, current: i + 1, total: pending.length }));
          await yieldToPaint();
        }
      }
      if (cancelled) return;
      const cleared = loadedFiles.map(f => (!f.isMedia && f.content ? { ...f, content: '' } : f));
      const inputs = cleared.map(f => {
        const fileProvider = (f.provider || activeProvider) as ProviderType;
        const cacheKey = `${fileProvider}::${f.relativePath || f.name}::${f.size}`;
        return {
          name: f.name,
          relativePath: f.relativePath,
          size: f.size,
          provider: f.provider,
          isMedia: f.isMedia,
          parse: parseCacheRef.current.get(cacheKey) || null,
        };
      });
      const result = assembleWorkspaceParse(inputs, activeProvider, providerLabel);
      parseCacheRef.current.clear();
      setParsedResult(result);
      signatureRef.current = fileParseSignature(cleared, activeProvider);
      setLoadedFiles(cleared);
      setBusy(null);
    })();
    return () => { cancelled = true; };
  }, [loadedFiles, isProcessing, activeProvider, currentCaseDbId]);

  // Derived filtered results based on activeAccountFilter
  // "all" = union of events with per-event account identity — NOT a blended profile
  const activeResult = useMemo(() => {
    if (!parsedResult) return null;

    if (activeAccountFilter === 'all') {
      return {
        ...parsedResult,
        accountInfo: parsedResult.accounts && parsedResult.accounts.length === 1
          ? parsedResult.accounts[0]
          : undefined,
      };
    }

    const selectedAcc = parsedResult.accounts?.find((a, idx) => {
      const label = accountFilterLabel(a, idx);
      return (
        label === activeAccountFilter ||
        a.username === activeAccountFilter ||
        a.userId === activeAccountFilter ||
        a.accountKey === activeAccountFilter ||
        a.displayName === activeAccountFilter
      );
    });

    // Single-identity returns (typical Kik: subscriber PDF + chat CSVs) often tag
    // chat rows with a different accountKey than the PDF profile. Filtering by the
    // PDF identity would hide every message and falsely suggest a re-import.
    const soleIdentity = (parsedResult.accounts?.length ?? 0) <= 1;

    const norm = (v?: string | null) => (v || '').trim().toLowerCase();
    const selectedUser = norm(selectedAcc?.username);
    const selectedId = norm(selectedAcc?.userId);
    const selectedKey = selectedAcc?.accountKey;
    const filterNorm = norm(activeAccountFilter);

    let filteredEvts = soleIdentity && selectedAcc
      ? parsedResult.events
      : parsedResult.events.filter(e => {
          if (!e.targetAccount && !e.accountKey) return false;
          if (selectedKey && e.accountKey === selectedKey) return true;
          if (e.targetAccount && norm(e.targetAccount) === filterNorm) return true;
          if (selectedUser && norm(e.targetAccount) === selectedUser) return true;
          if (selectedId && norm(e.targetAccount) === selectedId) return true;
          // Kik chats sometimes stamp the subject only on sender/details
          const sender = norm(
            (e.details && (e.details.sender || e.details.from || e.details.username)) as string | undefined
          );
          if (selectedUser && sender && sender === selectedUser) return true;
          return false;
        });

    // Kik safety net: subscriber PDF identity often does not share accountKey with chat CSVs.
    // Prefer keeping chats visible over an empty Conversation View + false "re-import" banner.
    const selectedLooksLikeKikPdf =
      activeProvider === 'kik' &&
      !!(
        selectedAcc?.sourceFile?.toLowerCase().includes('subscriber-data') ||
        String(selectedAcc?.otherDetails?.['Source'] || '').toLowerCase().includes('subscriber-data') ||
        String(selectedAcc?.otherDetails?.['Source File'] || '').toLowerCase().includes('subscriber-data')
      );
    if (
      selectedLooksLikeKikPdf &&
      selectedAcc &&
      !filteredEvts.some(e => e.category === 'message') &&
      parsedResult.events.some(e => e.category === 'message')
    ) {
      filteredEvts = parsedResult.events;
    }

    const messagesCount = filteredEvts.filter(e => e.category === 'message').length;
    const connectionsCount = filteredEvts.filter(e => e.category === 'connection').length;
    const filesCount = filteredEvts.filter(e => e.category === 'file').length;
    const callsCount = filteredEvts.filter(e => e.category === 'call').length;

    const uniqueIPs = new Set<string>();
    filteredEvts.forEach(e => {
      if (e.ipAddress) uniqueIPs.add(e.ipAddress);
    });

    const accountInfo = selectedAcc || parsedResult.accountInfo;

    return {
      ...parsedResult,
      events: filteredEvts,
      accountInfo,
      summaryStats: {
        totalEvents: filteredEvts.length,
        messagesCount,
        connectionsCount,
        filesCount,
        callsCount,
        uniqueIPs: Array.from(uniqueIPs),
        dateRange: parsedResult.summaryStats.dateRange
      }
    };
  }, [parsedResult, activeAccountFilter, activeProvider]);

  // Phase 1 identity: extract identifiers → Exact link suggestions (no person-merge)
  const identifierOccurrences: IdentifierOccurrence[] = useMemo(() => {
    if (!parsedResult?.accounts?.length) return [];
    return extractIdentifiers(parsedResult.accounts);
  }, [parsedResult]);

  const linkEdges: LinkEdge[] = useMemo(() => {
    return suggestLinks(identifierOccurrences);
  }, [identifierOccurrences]);

  const locationPoints = useMemo(() => {
    const points: MapPoint[] = [];
    const seen = new Set<string>();
    const push = (point: MapPoint) => {
      const key = `${point.kind}|${point.fileName}|${point.recordPath || ''}|${point.lat.toFixed(5)}|${point.lng.toFixed(5)}|${point.capturedAt || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      points.push(point);
    };
    for (let i = 0; i < loadedFiles.length; i++) {
      const file = loadedFiles[i];
      if (!file.isMedia || !file.gps || !validLatLng(file.gps.lat, file.gps.lng)) continue;
      push({
        id: locationTagKey({
          id: `${file.relativePath || ''}-${file.name}`,
          kind: mediaKindForSource(file.coordSource, file.mediaType),
          coordSource: file.coordSource,
          fileName: file.name,
          filePath: file.relativePath || file.sourcePath || '',
        }),
        kind: mediaKindForSource(file.coordSource, file.mediaType),
        lat: file.gps.lat,
        lng: file.gps.lng,
        title: file.name,
        fileName: file.name,
        filePath: file.relativePath || file.sourcePath || '',
        capturedAt: file.capturedAt,
        device: file.device,
        coordSource: file.coordSource,
        mediaName: file.name,
      });
    }
    for (let i = 0; i < caseLocations.length; i++) {
      const row = caseLocations[i];
      if (!validLatLng(row.lat, row.lng)) continue;
      push({
        id: locationTagKey({
          id: row.recordPath || row.fileName || `${row.lat},${row.lng}`,
          eventId: row.eventId,
          kind: row.kind,
          coordSource: row.coordSource,
          fileName: row.fileName,
          filePath: row.filePath,
          recordPath: row.recordPath,
        }),
        kind: row.kind,
        lat: row.lat,
        lng: row.lng,
        title: row.fileName,
        fileName: row.fileName,
        filePath: row.filePath,
        recordPath: row.recordPath,
        capturedAt: row.capturedAt,
        accuracy: row.accuracy,
        device: row.device,
        coordSource: row.coordSource,
        mediaName: row.mediaName,
        eventId: row.eventId,
      });
    }
    const events = parsedResult?.events || [];
    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      const details = evt.details || {};
      let lat: number | null = null;
      let lng: number | null = null;
      if (details.latitude != null && details.longitude != null) {
        lat = Number(details.latitude);
        lng = Number(details.longitude);
      } else if (details.lat != null && (details.lng != null || details.lon != null)) {
        lat = Number(details.lat);
        lng = Number(details.lng ?? details.lon);
      }
      if (lat == null || lng == null || !validLatLng(lat, lng)) continue;
      push({
        id: locationTagKey({
          id: evt.id,
          eventId: evt.id,
          kind: 'location-record',
          coordSource: 'event',
          fileName: evt.sourceFile || '',
          filePath: evt.sourceFile || '',
          recordPath: evt.id,
        }),
        kind: 'location-record',
        lat,
        lng,
        title: evt.sourceFile || evt.id,
        fileName: evt.sourceFile || '',
        filePath: evt.sourceFile || '',
        recordPath: evt.id,
        capturedAt: evt.timestamp,
        accuracy: details.accuracy != null ? Number(details.accuracy) : null,
        coordSource: 'event',
        eventId: evt.id,
      });
    }
    return points;
  }, [loadedFiles, caseLocations, parsedResult]);

  const hasLocationTab = locationPoints.length > 0 || (parsedResult?.summaryStats.uniqueIPs.length || 0) > 0;

  const fileTableSlice = useMemo(
    () => paginateItems(loadedFiles, fileTablePage, 100),
    [loadedFiles, fileTablePage]
  );

  useEffect(() => {
    if (!workspaceFocus) return;
    const idx = loadedFiles.findIndex(file => file.name === workspaceFocus || file.relativePath === workspaceFocus);
    if (idx >= 0) setFileTablePage(Math.floor(idx / 100) + 1);
    const timer = window.setTimeout(() => {
      document.getElementById('workspace-focus-row')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [workspaceFocus, loadedFiles]);


  // Discovered entities across all loaded files of all providers
  const discoveredEntities = useMemo(() => {
    const ipToProviders: Record<string, Set<string>> = {};
    const phoneToProviders: Record<string, Set<string>> = {};
    const usernameToProviders: Record<string, Set<string>> = {};

    const occurrences: Record<string, Array<{ provider: string; fileName: string; detail: string; timestamp?: string; eventId?: string }>> = {};

    const addOccurrence = (entity: string, provider: string, fileName: string, detail: string, timestamp?: string, eventId?: string) => {
      const cleanEntity = entity.trim();
      const lookupKey = cleanEntity.toLowerCase();
      if (!lookupKey || lookupKey.length < 2) return;
      if (!occurrences[lookupKey]) occurrences[lookupKey] = [];
      const isDuplicate = occurrences[lookupKey].some(o => o.fileName === fileName && o.detail === detail && o.timestamp === timestamp);
      if (!isDuplicate) {
        occurrences[lookupKey].push({ provider, fileName, detail, timestamp, eventId });
      }
    };

    const eventsByFile = new Map<string, ForensicEvent[]>();
    for (const evt of parsedResult?.events || []) {
      const key = evt.sourceFile || '';
      const list = eventsByFile.get(key);
      if (list) list.push(evt);
      else eventsByFile.set(key, [evt]);
    }

    loadedFiles.forEach(file => {
      if (file.isMedia) return;
      const fileProvider = file.provider || activeProvider;
      const provName = providersInfo[fileProvider]?.name || fileProvider;

      // Use the already-built parse. Do not read file bytes or parse again.
      const fileParse: ParseResult = {
        provider: fileProvider,
        events: eventsByFile.get(file.name) || eventsByFile.get(file.relativePath || '') || [],
        accountInfo: parsedResult?.accounts?.find(a => a.sourceFile === file.name),
        summaryStats: parsedResult?.summaryStats || {
          totalEvents: 0,
          messagesCount: 0,
          connectionsCount: 0,
          filesCount: 0,
          callsCount: 0,
          uniqueIPs: [],
          dateRange: null,
        },
      };
      if (fileParse.events.length === 0 && !fileParse.accountInfo) return;

      // If filtering by a specific account, resolve the same way as activeResult
      // (accountKey / accountFilterLabel / username / userId) — keep event-level overlap scan only
      if (activeAccountFilter !== 'all') {
        const selectedAcc = parsedResult?.accounts?.find((a, idx) => {
          const label = accountFilterLabel(a, idx);
          return (
            label === activeAccountFilter ||
            a.username === activeAccountFilter ||
            a.userId === activeAccountFilter ||
            a.accountKey === activeAccountFilter ||
            a.displayName === activeAccountFilter
          );
        });

        const matchesSelected = (target?: string, key?: string) => {
          if (selectedAcc?.accountKey && key === selectedAcc.accountKey) return true;
          if (target === activeAccountFilter) return true;
          if (selectedAcc?.username && target === selectedAcc.username) return true;
          if (selectedAcc?.userId && target === selectedAcc.userId) return true;
          return false;
        };

        const hasMatchingEvent = fileParse.events.some(e =>
          matchesSelected(e.targetAccount, e.accountKey)
        );
        const matchesAccountInfo =
          matchesSelected(fileParse.accountInfo?.username, fileParse.accountInfo?.accountKey) ||
          matchesSelected(fileParse.accountInfo?.userId, fileParse.accountInfo?.accountKey) ||
          matchesSelected(fileParse.accountInfo?.displayName, fileParse.accountInfo?.accountKey);

        if (!hasMatchingEvent && !matchesAccountInfo) {
          return;
        }
      }

      if (fileParse.accountInfo) {
        const info = fileParse.accountInfo;
        
        if (info.registrationIp) {
          const ip = info.registrationIp.trim();
          if (ip) {
            if (!ipToProviders[ip]) ipToProviders[ip] = new Set();
            ipToProviders[ip].add(provName);
            addOccurrence(ip, provName, file.name, `Registered account IP address for subscriber ${info.username || 'User'}`);
          }
        }
        if (info.phone) {
          const phone = info.phone.trim();
          if (phone) {
            if (!phoneToProviders[phone]) phoneToProviders[phone] = new Set();
            phoneToProviders[phone].add(provName);
            addOccurrence(phone, provName, file.name, `Profile phone verification record for user: ${info.username || 'User'}`);
          }
        }
        if (info.username) {
          const user = info.username.trim();
          if (user) {
            if (!usernameToProviders[user]) usernameToProviders[user] = new Set();
            usernameToProviders[user].add(provName);
            addOccurrence(user, provName, file.name, `Subscriber core registration username: "${user}"`);
          }
        }
        if (info.email) {
          const email = info.email.trim();
          if (email) {
            if (!usernameToProviders[email]) usernameToProviders[email] = new Set();
            usernameToProviders[email].add(provName);
            addOccurrence(email, provName, file.name, `Subscriber core registration email: "${email}"`);
          }
        }
      }

      fileParse.events.forEach(evt => {
        if (evt.ipAddress) {
          const ip = evt.ipAddress.trim();
          if (ip) {
            if (!ipToProviders[ip]) ipToProviders[ip] = new Set();
            ipToProviders[ip].add(provName);
            addOccurrence(ip, provName, file.name, `Direct logging record IP marker`, evt.timestamp, evt.id);
          }
        }

        const ipRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
        if (evt.content) {
          let match;
          while ((match = ipRegex.exec(evt.content)) !== null) {
            const ip = match[0];
            if (!ipToProviders[ip]) ipToProviders[ip] = new Set();
            ipToProviders[ip].add(provName);
            addOccurrence(ip, provName, file.name, `Mentioned IP address in content: "${evt.content}"`, evt.timestamp, evt.id);
          }
        }

        const phoneRegex = /\+?\b\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
        if (evt.content) {
          let match;
          while ((match = phoneRegex.exec(evt.content)) !== null) {
            const phone = match[0];
            const digitsOnly = phone.replace(/[^0-9]/g, '');
            if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
              if (!phoneToProviders[phone]) phoneToProviders[phone] = new Set();
              phoneToProviders[phone].add(provName);
              addOccurrence(phone, provName, file.name, `Mentioned telephone digits in content: "${evt.content}"`, evt.timestamp, evt.id);
            }
          }
        }

        if (evt.sender) {
          const sender = evt.sender.trim();
          if (sender && sender !== 'System' && sender !== 'Unknown') {
            if (!usernameToProviders[sender]) usernameToProviders[sender] = new Set();
            usernameToProviders[sender].add(provName);
            addOccurrence(sender, provName, file.name, `Active sender/author of timeline item: "${evt.content?.substring(0, 40) || ''}"`, evt.timestamp, evt.id);
          }
        }
        if (evt.recipient) {
          const recipient = evt.recipient.trim();
          if (recipient && recipient !== 'System' && recipient !== 'Unknown') {
            if (!usernameToProviders[recipient]) usernameToProviders[recipient] = new Set();
            usernameToProviders[recipient].add(provName);
            addOccurrence(recipient, provName, file.name, `Direct message recipient of timeline item: "${evt.content?.substring(0, 40) || ''}"`, evt.timestamp, evt.id);
          }
        }
      });
    });

    const shared: Array<{
      value: string;
      type: 'ip' | 'phone' | 'username';
      providers: string[];
      occurrences: Array<{ provider: string; fileName: string; detail: string; timestamp?: string; eventId?: string }>;
    }> = [];

    Object.entries(ipToProviders).forEach(([ip, providersSet]) => {
      if (providersSet.size >= 2) {
        shared.push({
          value: ip,
          type: 'ip',
          providers: Array.from(providersSet),
          occurrences: occurrences[ip.toLowerCase()] || []
        });
      }
    });

    Object.entries(phoneToProviders).forEach(([phone, providersSet]) => {
      if (providersSet.size >= 2) {
        shared.push({
          value: phone,
          type: 'phone',
          providers: Array.from(providersSet),
          occurrences: occurrences[phone.toLowerCase()] || []
        });
      }
    });

    const excludedUsernames = new Set(['system', 'admin', 'user', 'recipient', 'sender', 'unknown', 'everyone', 'here', 'true', 'false', 'null', 'undefined']);
    Object.entries(usernameToProviders).forEach(([user, providersSet]) => {
      const lowerUser = user.toLowerCase();
      if (providersSet.size >= 2 && user.length >= 3 && !excludedUsernames.has(lowerUser) && !user.includes('@import') && !user.includes(';') && !user.includes('{')) {
        shared.push({
          value: user,
          type: 'username',
          providers: Array.from(providersSet),
          occurrences: occurrences[lowerUser] || []
        });
      }
    });

    return shared;
  }, [loadedFiles, activeProvider, activeAccountFilter, parsedResult]);

  // Unified list of all items flagged as case evidence (both chat logs and detached media files)
  const unifiedExhibits = useMemo(() => {
    if (!activeResult) return [];

    // 1. Tagged timeline events
    const taggedEvents = activeResult.events.filter(e => evidenceTags[e.id]?.tagged);

    // 2. Tagged media assets that don't match any already tagged events
    const taggedFiles = loadedFiles.filter(file => {
      if (!file.isMedia) return false;
      const fileTagKey = `media-file-${file.name}`;
      const isTaggedDirect = !!evidenceTags[fileTagKey]?.tagged;

      const isAssociatedWithTaggedEvent = taggedEvents.some(
        e => e.details?.resolvedMediaName === file.name
      );

      return isTaggedDirect && !isAssociatedWithTaggedEvent;
    });

    const list: Array<{
      id: string;
      timestamp: string;
      sender: string;
      recipient?: string;
      content: string;
      ipAddress?: string;
      sourceFile: string;
      notes: string;
      mediaFile?: UploadedFile;
      isDiscreteMedia?: boolean;
      category: string;
    }> = [];

    taggedEvents.forEach((evt) => {
      const assocMedia = loadedFiles.find(f => f.name === evt.details?.resolvedMediaName);
      list.push({
        id: evt.id,
        timestamp: evt.timestamp,
        sender: evt.sender,
        recipient: evt.recipient || '',
        content: evt.content,
        ipAddress: evt.ipAddress || '',
        sourceFile: evt.sourceFile,
        notes: evidenceTags[evt.id]?.notes || '',
        mediaFile: assocMedia,
        category: evt.category || 'chat'
      });
    });

    taggedFiles.forEach((file) => {
      const fileTagKey = `media-file-${file.name}`;
      list.push({
        id: fileTagKey,
        timestamp: mediaExhibitTimestamp(file),
        sender: 'Extracted Media Asset',
        recipient: 'Forensic Vault',
        content: `Independent File Extraction: ${file.name}`,
        ipAddress: 'N/A',
        sourceFile: 'Warrant Folder Attachment',
        notes: evidenceTags[fileTagKey]?.notes || '',
        mediaFile: file,
        isDiscreteMedia: true,
        category: 'media'
      });
    });

    return list;
  }, [activeResult, evidenceTags, loadedFiles]);

  // Filtered exhibits based on the search query
  const filteredExhibits = useMemo(() => {
    // First map original indexes to make them stable and searchable
    const mapped = unifiedExhibits.map((evt, idx) => ({
      ...evt,
      originalIndex: idx,
      exhibitIdStr: `EXHIBIT-${idx + 1}`
    }));

    if (!evidenceSearchQuery.trim()) {
      return mapped;
    }

    const query = evidenceSearchQuery.toLowerCase().trim();
    return mapped.filter(evt => {
      const matchId = evt.exhibitIdStr.toLowerCase().includes(query) || String(evt.originalIndex + 1) === query;
      const matchSender = evt.sender.toLowerCase().includes(query) || (evt.recipient && evt.recipient.toLowerCase().includes(query));
      const matchContent = evt.content.toLowerCase().includes(query);
      const matchNotes = evt.notes.toLowerCase().includes(query);
      const matchFile = evt.mediaFile?.name?.toLowerCase().includes(query);

      return matchId || matchSender || matchContent || matchNotes || matchFile;
    });
  }, [unifiedExhibits, evidenceSearchQuery]);

  // Handle Drag & Drop
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const processFileText = (
    name: string,
    text: string,
    size: number,
    isMedia?: boolean,
    mediaType?: 'image' | 'video',
    relativePath?: string
  ) => {
    setLoadedFiles(prev => {
      const filtered = prev.filter(f => {
        if (relativePath && f.relativePath) {
          return f.relativePath !== relativePath;
        }
        return f.name !== name;
      });
      return [...filtered, { name, content: text, size, isMedia, mediaType, relativePath, provider: activeProvider }];
    });
  };

  const cacheReturnBytes = async (name: string, relativePath: string, body: Blob | Uint8Array): Promise<string> => {
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/cache-media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-filename': encodeURIComponent(name),
          'x-relative-path': encodeURIComponent(relativePath),
        },
        body,
      });
      if (res.ok) return (await res.json()).sourcePath || '';
    } catch (err: any) {
      reportClientError(`Could not store ${name}`, err?.message || String(err));
    }
    return '';
  };

  const uploadedFromInventory = async (item: InventoriedFile, sourcePath?: string): Promise<UploadedFile> => {
    const kept = sourcePath || await cacheReturnBytes(item.name, item.relativePath, item.bytes);
    return {
      name: item.name,
      content: '',
      size: item.size,
      isMedia: item.isMedia,
      mediaType: item.mediaType || undefined,
      relativePath: item.relativePath,
      provider: activeProvider,
      sourcePath: kept || undefined,
      mediaMissing: item.isMedia && !kept,
      forensicsProcessed: false,
    };
  };

  const parseReturnText = (item: InventoriedFile): ParseResult | null => {
    const lower = item.name.toLowerCase();
    const kikPdf = activeProvider === 'kik' && lower.endsWith('.pdf') && lower.includes('subscriber-data');
    let text: string | null = null;
    if (kikPdf) {
      const raw = new TextDecoder('latin1').decode(item.bytes);
      const fromName = item.name.replace(/^subscriber-data-/i, '').replace(/\.pdf$/i, '');
      text = extractTextFromPdfContent(raw) || ('Username: ' + fromName);
    } else if (!item.isMedia && item.text != null && !lower.endsWith('.zip') && (isTextReturnName(item.name) || extensionOf(item.name) === '')) {
      text = item.text;
    }
    if (text == null) return null;
    try {
      return parseForensicFile(activeProvider, item.name, text, item.relativePath);
    } catch (err: any) {
      reportClientError(`Could not parse ${item.name}`, err?.stack || err?.message || String(err));
      return null;
    }
  };

  const unzipFile = async (zipFile: File) => {
    try {
      setIsProcessing(true);
      setProcessingProgress({ current: 0, total: 1, currentFileName: 'Reading ZIP archive...' });
      const outer = new Uint8Array(await zipFile.arrayBuffer());
      const inventoried = await listReturnFiles(outer);
      const accepted: UploadedFile[] = [];
      const zipParses: Array<{ name: string; relativePath?: string; size: number; provider?: ProviderType; isMedia?: boolean; parse: ParseResult | null }> = [];
      const outerPath = await cacheReturnBytes(zipFile.name, zipFile.name, outer);
      accepted.push({
        name: zipFile.name,
        content: '',
        size: zipFile.size || outer.byteLength,
        isMedia: false,
        relativePath: zipFile.name,
        provider: activeProvider,
        sourcePath: outerPath || undefined,
        forensicsProcessed: false,
      });
      setProcessingProgress({ current: 0, total: inventoried.length, currentFileName: 'Beginning extraction...' });
      for (let i = 0; i < inventoried.length; i++) {
        const item = inventoried[i];
        accepted.push(await uploadedFromInventory(item));
        zipParses.push({
          name: item.name,
          relativePath: item.relativePath,
          size: item.size,
          provider: activeProvider,
          isMedia: item.isMedia,
          parse: parseReturnText(item),
        });
        setProcessingProgress({
          current: i + 1,
          total: inventoried.length,
          currentFileName: item.relativePath,
        });
        if (i % 8 === 0) await yieldToPaint();
      }
      if (accepted.length > 0) {
        setLoadedFiles(prev => {
          const updated = [...prev];
          accepted.forEach(newFile => {
            const idx = updated.findIndex(f => {
              if (newFile.relativePath && f.relativePath) return f.relativePath === newFile.relativePath;
              return f.name === newFile.name;
            });
            if (idx !== -1) updated[idx] = newFile;
            else updated.push(newFile);
          });
          return updated;
        });
      }
      if (zipParses.length > 0) {
        const fresh = assembleWorkspaceParse(zipParses, activeProvider, providerLabel);
        setParsedResult(prev => {
          const events: ForensicEvent[] = [];
          appendEvents(events, prev?.events || []);
          appendEvents(events, fresh?.events || []);
          if (!fresh) return prev;
          return { ...fresh, events, accounts: [...(prev?.accounts || []), ...(fresh.accounts || [])] };
        });
      }
    } catch (err) {
      console.error('Error unzipping warrant return file:', err);
      reportClientError('Could not unzip warrant return', err instanceof Error ? err.stack || err.message : String(err));
    } finally {
      setIsProcessing(false);
      window.setTimeout(() => { void rescanLocations(); }, 1000);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files) as File[];
      
      const zipFiles = filesArray.filter(f => f.name.toLowerCase().endsWith('.zip'));
      const nonZipFiles = filesArray.filter(f => !f.name.toLowerCase().endsWith('.zip'));

      zipFiles.forEach(file => {
        unzipFile(file);
      });

      if (nonZipFiles.length > 0) {
        processFilesIncrementally(nonZipFiles);
      }
    }
  };

  // Manual File Select
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files) as File[];
      
      const zipFiles = filesArray.filter(f => f.name.toLowerCase().endsWith('.zip'));
      const nonZipFiles = filesArray.filter(f => !f.name.toLowerCase().endsWith('.zip'));

      const massiveZip = zipFiles.some(f => f.size > 100 * 1024 * 1024);
      if (massiveZip) {
        if (!window.confirm('⚠️ Warning: You selected a large ZIP archive directly. Unzipping archives in the browser can exceed memory limits and crash the tab. For returns larger than 100 MB, we strongly recommend unzipping on your machine and using the "Import Folder / Directory" option. Would you like to proceed anyway?')) {
          return;
        }
      }

      zipFiles.forEach(file => {
        unzipFile(file);
      });

      if (nonZipFiles.length > 0) {
        processFilesIncrementally(nonZipFiles);
      }
    }
  };

  const processFilesIncrementally = async (files: File[]) => {
    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: files.length, currentFileName: '' });

    const desktopPath = (file: File) => {
      try {
        return window.forensicDesktop?.getPathForFile?.(file) || '';
      } catch {
        return '';
      }
    };
    const sourcePaths = files.map(desktopPath).filter(Boolean);
    if (sourcePaths.length > 0) {
      await fetch('/api/media/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: sourcePaths }),
      }).catch(() => {});
    }

    const index: UploadedFile[] = [];
    const parses: Array<{ name: string; relativePath?: string; size: number; provider?: ProviderType; isMedia?: boolean; parse: ParseResult | null }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lowercaseName = file.name.toLowerCase();
      if (lowercaseName.includes('__macosx') || lowercaseName.endsWith('.ds_store')) continue;

      const relPath = file.webkitRelativePath || file.name;
      const nameOnly = file.name;
      const sourcePath = desktopPath(file);

      flushSync(() => setBusy({
        label: 'Reading return...',
        detail: nameOnly,
        current: i + 1,
        total: files.length,
      }));
      if (i % 2 === 0) await yieldToPaint();

      if (lowercaseName.endsWith('.zip')) {
        let kept = sourcePath;
        if (!kept) kept = await cacheReturnBytes(nameOnly, relPath, file);
        index.push({
          name: nameOnly,
          content: '',
          size: file.size,
          isMedia: false,
          relativePath: relPath,
          provider: activeProvider,
          sourcePath: kept || undefined,
          forensicsProcessed: false,
        });
        try {
          const nested = await listReturnFiles(await file.arrayBuffer(), `${relPath.replace(/\.zip$/i, '')}/`);
          for (let n = 0; n < nested.length; n++) {
            const item = nested[n];
            const uploaded = await uploadedFromInventory(item);
            index.push(uploaded);
            parses.push({
              name: item.name,
              relativePath: item.relativePath,
              size: item.size,
              provider: activeProvider,
              isMedia: item.isMedia,
              parse: parseReturnText(item),
            });
          }
        } catch (err: any) {
          reportClientError(`Could not read zip ${nameOnly}`, err?.stack || err?.message || String(err));
        }
        setProcessingProgress({ current: i + 1, total: files.length, currentFileName: nameOnly });
        continue;
      }

      const isKikSubscriberPdf =
        activeProvider === 'kik' &&
        lowercaseName.endsWith('.pdf') &&
        (lowercaseName.startsWith('subscriber-data-') || lowercaseName.includes('subscriber-data'));
      const isText = isTextReturnName(nameOnly) || isKikSubscriberPdf;

      if (isText && sourcePath && !isKikSubscriberPdf) {
        let parsed: ParseResult | null = null;
        try {
          const res = await fetch('/api/parse/source', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: activeProvider, name: nameOnly, relativePath: relPath, sourcePath }),
          });
          if (res.ok) parsed = await res.json();
          else {
            const err = await res.json().catch(() => ({}));
            reportClientError(`Could not parse ${nameOnly}`, err.error || `HTTP ${res.status}`);
          }
        } catch (err: any) {
          reportClientError(`Could not parse ${nameOnly}`, err?.stack || err?.message || String(err));
        }
        index.push({
          name: nameOnly,
          content: '',
          size: file.size,
          isMedia: false,
          relativePath: relPath,
          provider: activeProvider,
          sourcePath,
          forensicsProcessed: false,
        });
        parses.push({ name: nameOnly, relativePath: relPath, size: file.size, provider: activeProvider, isMedia: false, parse: parsed });
      } else if (isText) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const item = inventoryBytes(nameOnly, relPath, bytes);
        const uploaded = await uploadedFromInventory(item, sourcePath || undefined);
        uploaded.size = file.size || item.size;
        index.push(uploaded);
        parses.push({
          name: nameOnly,
          relativePath: relPath,
          size: uploaded.size,
          provider: activeProvider,
          isMedia: false,
          parse: parseReturnText(item),
        });
        if (!sourcePath && item.text != null && !isKikSubscriberPdf) {
          await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/file-text`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain',
              'x-filename': encodeURIComponent(nameOnly),
              'x-relative-path': encodeURIComponent(relPath),
              'x-provider': encodeURIComponent(activeProvider),
            },
            body: item.text,
          }).catch(() => {});
        }
      } else {
        const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
        const kind = classifyReturnName(nameOnly, head);
        let kept = sourcePath;
        if (!kept) kept = await cacheReturnBytes(nameOnly, relPath, file);
        index.push({
          name: nameOnly,
          content: '',
          size: file.size,
          isMedia: kind.isMedia,
          mediaType: kind.mediaType || undefined,
          relativePath: relPath,
          provider: activeProvider,
          sourcePath: kept || undefined,
          mediaMissing: kind.isMedia && !kept,
          forensicsProcessed: false,
        });
      }

      setProcessingProgress({
        current: i + 1,
        total: files.length,
        currentFileName: nameOnly,
      });
    }

    const prior = loadedFiles.filter(f => !index.some(n => (n.relativePath || n.name) === (f.relativePath || f.name)));
    const mergedFiles = [...prior, ...index];
    const inputs = [
      ...prior.map(f => ({ name: f.name, relativePath: f.relativePath, size: f.size, provider: f.provider, isMedia: f.isMedia, parse: null })),
      ...parses,
    ];
    const fresh = assembleWorkspaceParse(inputs, activeProvider, providerLabel);
    const events: ForensicEvent[] = [];
    appendEvents(events, parsedResult?.events || []);
    appendEvents(events, fresh?.events || []);
    const nextResult = fresh
      ? { ...fresh, events, accounts: [...(parsedResult?.accounts || []), ...(fresh.accounts || [])] }
      : parsedResult;
    signatureRef.current = fileParseSignature(mergedFiles, activeProvider);
    setLoadedFiles(mergedFiles);
    setParsedResult(nextResult);
    setIsProcessing(false);
    setBusy(null);
    window.setTimeout(() => { void rescanLocations(mergedFiles, nextResult?.events || []); }, 400);
  };


  const handleFolderSelect = (e: any) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files) as File[];
      processFilesIncrementally(filesArray);
    }
  };

  // Paste handler
  const handlePasteParse = () => {
    if (!rawPaste.trim()) return;
    processFileText(pasteFileName, rawPaste, rawPaste.length);
    setRawPaste('');
  };

  const handleRemoveFile = (name: string) => {
    setLoadedFiles(prev => prev.filter(f => f.name !== name));
  };

  const buildCurrentReport = (embedMedia: boolean, files: UploadedFile[] = loadedFiles) => {
    const hashLabels: Record<string, string[]> = {};
    hashHits.forEach((hits, hash) => {
      hashLabels[hash] = hits.map(hit => `${hit.name} (${hit.category})`);
    });
    const accounts = activeResult?.accounts?.length
      ? activeResult.accounts
      : (activeResult?.accountInfo ? [activeResult.accountInfo] : []);
    return assembleCaseReport({
      caseId: caseId || 'CASE',
      agency: reportAgency,
      itemNumber: reportItemNumber,
      examiner: investigatorName,
      subject: suspectName,
      providerName: providersInfo[activeProvider]?.name || activeProvider,
      notes: reportNotes,
      logoDataUrl: reportLogo,
      generatedAtIso: new Date().toISOString(),
      exhibitsOnly: reportTimelineOnlyTagged,
      blurImages: reportBlurImages,
      timeZone: reportTimeZone,
      redactIpAddresses: reportRedactIp,
      redactPii: reportRedactPii,
      includeAccount: reportIncludeAccountMetadata,
      includeMessages: reportIncludeMessages,
      includeTimeline: reportIncludeTimeline,
      includeMedia: reportIncludeMedia,
      includeEntities: reportIncludeEntityDiscovery,
      includeLocations: reportIncludeLocations,
      includeSources: reportIncludeSources,
      includeCaseIdentifiers: reportIncludeCaseMetadata,
      embedMedia,
      events: parsedResult?.events || [],
      files,
      tags: evidenceTags,
      accounts,
      locations: locationPoints.filter(point => point.kind !== 'ip').map(point => {
        const tagKey = locationTagKey(point);
        return {
          lat: point.lat,
          lng: point.lng,
          label: point.title || point.fileName || 'Location',
          cardId: '',
          capturedAt: point.capturedAt || '',
          eventId: point.eventId || '',
          tagKey,
          tagged: !!evidenceTags[tagKey]?.tagged,
        };
      }),
      entities: discoveredEntities.map(entity => ({
        value: entity.value,
        type: entity.type,
        providers: entity.providers,
        detail: entity.occurrences.map(item => `${item.provider} · ${item.fileName}: ${item.detail}`).join('\n'),
      })),
      vicHashes,
      hashLabels,
    });
  };

  const handleTriggerPrint = () => {
    const html = buildCurrentReport(true).html;
    const frame = document.createElement('iframe');
    frame.setAttribute('title', 'Case report');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1500);
    }, 250);
  };

  const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  const loadOriginalBytes = async (file: UploadedFile): Promise<Uint8Array | null> => {
    try {
      if (file.sourcePath) {
        const res = await fetch(`/api/local-media?path=${encodeURIComponent(file.sourcePath)}`);
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer());
      }
      if (file.hasStoredBytes) {
        const params = new URLSearchParams({ rel: file.relativePath || '', name: file.name });
        const res = await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/stored-media?${params}`);
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer());
      }
      if ((file.content || '').startsWith('data:')) return bytesFromDataUrl(file.content, Number.MAX_SAFE_INTEGER);
    } catch (err: any) {
      reportClientError(`Could not read ${file.name} for the report`, err?.message || String(err));
    }
    return null;
  };

  const reportDataMime = (file: UploadedFile): string => {
    const ext = extensionOf(file.name);
    if (file.mediaType === 'video') {
      if (ext === 'webm') return 'video/webm';
      if (ext === 'mov') return 'video/quicktime';
      return 'video/mp4';
    }
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
  };

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportHtmlReport = async () => {
    const includeMedia = reportIncludeMedia;
    const embed = includeMedia && reportEmbedMedia;
    if (embed) {
      const bytes = loadedFiles.filter(file => file.isMedia).reduce((sum, file) => sum + (file.size || 0), 0);
      const mb = bytes / (1024 * 1024);
      const grown = mb * 4 / 3;
      const ok = window.confirm(`Embedding media writes the original file bytes into the HTML as base64. About ${mb.toFixed(1)} MB of media becomes roughly ${grown.toFixed(1)} MB in one file. Large videos can make the page slow to open. Continue?`);
      if (!ok) return;
    }
    setBusy({ label: 'Building HTML report...', detail: embed ? 'Embedding media' : includeMedia ? 'Packing files' : 'Writing report', current: 0, total: 1 });
    try {
      let files = loadedFiles;
      if (embed) {
        const next: UploadedFile[] = [];
        for (let i = 0; i < loadedFiles.length; i++) {
          const file = loadedFiles[i];
          if (!file.isMedia || isHeicName(file.name) || (file.content || '').startsWith('data:')) {
            next.push(file);
            continue;
          }
          const original = await loadOriginalBytes(file);
          if (!original) {
            next.push(file);
            continue;
          }
          const mime = reportDataMime(file);
          next.push({ ...file, content: `data:${mime};base64,${bytesToBase64(original)}` });
        }
        files = next;
      }
      const built = buildCurrentReport(embed, files);
      const safeCase = (caseId || 'CASE').replace(/[^a-zA-Z0-9-_]/g, '_');
      if (!includeMedia || embed) {
        downloadBlob(`CASE_${safeCase}_report.html`, new Blob([built.html], { type: 'text/html;charset=utf-8' }));
        return;
      }
      const packedFiles: StandaloneMediaFile[] = [];
      for (let i = 0; i < built.attachments.length; i++) {
        const attachment = built.attachments[i];
        if (attachment.base64) {
          packedFiles.push({ path: attachment.path, base64: attachment.base64 });
          continue;
        }
        const file = loadedFiles.find(item => item.name === attachment.name && (item.relativePath || '') === (attachment.relativePath || ''));
        const original = file ? await loadOriginalBytes(file) : null;
        if (original && original.byteLength) packedFiles.push({ path: attachment.path, bytes: original });
      }
      const packed = standaloneReportPackage({
        includeMedia: true,
        embedMedia: false,
        html: built.html,
        files: packedFiles,
      });
      if (packed.kind === 'html') {
        downloadBlob(`CASE_${safeCase}_report.html`, new Blob([packed.html], { type: 'text/html;charset=utf-8' }));
        return;
      }
      const zip = new JSZip();
      zip.file('report.html', packed.html);
      for (let i = 0; i < packed.files.length; i++) zip.file(packed.files[i].path, packed.files[i].bytes);
      downloadBlob(`CASE_${safeCase}_report.zip`, await zip.generateAsync({ type: 'blob' }));
    } catch (err: any) {
      reportClientError('Could not export the HTML report', err?.stack || err?.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleClearWorkspace = () => {
    setLoadedFiles([]);
    setParsedResult(null);
    signatureRef.current = '';
    setRawPaste('');
  };

  const handleProviderChange = (provider: ProviderType) => {
    setActiveProvider(provider);
    setActiveTab('timeline');
  };

  const loadSampleDataset = () => {
    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: 3, currentFileName: 'Preparing high-fidelity mock evidence returns...' });

    setTimeout(() => {
      let samples: UploadedFile[] = [];

      if (activeProvider === 'twitter') {
        samples = [
          {
            name: 'account.js',
            content: `window.YTD.account.part0 = [ {
              "account" : {
                "accountId" : "1234567890",
                "username" : "suspect_jack",
                "email" : "jack.suspect@protonmail.com",
                "phone" : "+1 (555) 019-2834",
                "createdAt" : "2018-04-12T10:15:30.000Z",
                "createdVia" : "104.244.42.1"
              }
            } ]`,
            size: 400,
            isMedia: false
          },
          {
            name: 'profile.js',
            content: `window.YTD.profile.part0 = [ {
              "profile" : {
                "description" : {
                  "bio" : "Researcher. Coffee enthusiast. Security analysis enthusiast. Postings are my own.",
                  "location" : "Miami, FL",
                  "website" : "https://jack-sec-vault.org"
                }
              }
            } ]`,
            size: 300,
            isMedia: false
          },
          {
            name: 'direct-messages.js',
            content: `window.YTD.direct_message.part0 = [ {
              "dmConversation" : {
                "conversationId" : "12345-67890",
                "messages" : [ {
                  "messageCreate" : {
                    "id" : "tw-msg-101",
                    "createdAt" : "2026-06-15T14:30:22.000Z",
                    "senderId" : "1234567890",
                    "recipientId" : "999888777",
                    "text" : "Hola, ¿tienes los documentos para las coordenadas?",
                    "mediaUrls" : [ "https://pbs.twimg.com/media/evidence_vault_map.png" ],
                    "reactions" : [ { "senderId": "999888777", "reactionKey": "👍" } ]
                  }
                }, {
                  "messageCreate" : {
                    "id" : "tw-msg-102",
                    "createdAt" : "2026-06-15T14:31:05.000Z",
                    "senderId" : "999888777",
                    "recipientId" : "1234567890",
                    "text" : "Sende mir das Passwort, schnell! Der verschlüsselte Container muss geöffnet werden."
                  }
                }, {
                  "messageCreate" : {
                    "id" : "tw-msg-103",
                    "createdAt" : "2026-06-15T14:32:10.000Z",
                    "senderId" : "1234567890",
                    "recipientId" : "999888777",
                    "text" : "Everything is ready for the drop. Clean the access trails after deployment."
                  }
                } ]
              }
            } ]`,
            size: 1024,
            isMedia: false
          },
          {
            name: 'tweets.js',
            content: `window.YTD.tweet.part0 = [ {
              "tweet" : {
                "id_str" : "1122334455",
                "created_at" : "2026-06-15T12:00:00.000Z",
                "full_text" : "Just landed in Miami. All transactions are proceeding smoothly. ☀️🌴",
                "favorite_count" : "42",
                "retweet_count" : "3"
              }
            }, {
              "tweet" : {
                "id_str" : "1122334456",
                "created_at" : "2026-06-16T15:45:00.000Z",
                "full_text" : "[Deleted Tweet Backup] Target code sequence is loaded: 0xF89A23C",
                "favorite_count" : "0",
                "retweet_count" : "0"
              }
            } ]`,
            size: 800,
            isMedia: false
          },
          {
            name: 'like.js',
            content: `window.YTD.like.part0 = [ {
              "like" : {
                "tweetId" : "8877665544",
                "fullText" : "Offshore banking setup and cryptographic assets storage tutorial: https://banking-guide.com",
                "expandedUrl" : "https://banking-guide.com"
              }
            } ]`,
            size: 300,
            isMedia: false
          },
          {
            name: 'ip-audit.js',
            content: `window.YTD.ip_audit.part0 = [ {
              "ipAudit" : {
                "accountId" : "1234567890",
                "createdAt" : "2026-06-15T14:25:00.000Z",
                "loginIp" : "104.244.42.1"
              }
            }, {
              "ipAudit" : {
                "accountId" : "1234567890",
                "createdAt" : "2026-06-14T09:12:00.000Z",
                "loginIp" : "186.77.139.198"
              }
            }, {
              "ipAudit" : {
                "accountId" : "1234567890",
                "createdAt" : "2026-06-13T10:11:00.000Z",
                "loginIp" : "8.8.8.8"
              }
            } ]`,
            size: 600,
            isMedia: false
          },
          {
            name: 'block.js',
            content: `window.YTD.block.part0 = [ {
              "block" : {
                "accountId" : "999222111",
                "userLink" : "https://twitter.com/intent/user?user_id=999222111"
              }
            } ]`,
            size: 200,
            isMedia: false
          },
          {
            name: 'evidence_vault_map.png',
            content: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNjAwIDQwMCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iIzFlMWUyZiIvPjxjaXJjbGUgY3g9IjMwMCIgY3k9IjIwMCIgcj0iMTAwIiBmaWxsPSIjZmZkNzAwIiBvcGFjaXR5PSIwLjE1Ii8+PHBhdGggZD0iTSAxMDAgMzAwIFEgMzAwIDE1MCA1MDAgMzAwIiBmaWxsPSJub25lIiBzdHJva2U9IiM0ZjQ2ZTUiIHN0cm9rZS13aWR0aD0iNCIvPjx0ZXh0IHg9IjUwJSIgeT0iNDUlIiBmaWxsPSIjZmZmZmZmIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjIwIiBmb250LXdlaWdodD0iYm9sZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+U1VTUEVDVCBBVFRBQ0hNRU5UPC90ZXh0Pjx0ZXh0IHg9IjUwJSIgeT0iNTUlIiBmaWxsPSIjYTdmM2QwIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5NaWFtaSBCZWFjaCBHUFMgTm9kZSBjb29yZGluYXRlIDI1Ljc2MTcsIC04MC4xOTE4PC90ZXh0PjxyZWN0IHg9IjUwIiB5PSIzMjAiIHdpZHRoPSI1MDAiIGhlaWdodD0iNDAiIHJ4PSI2IiBmaWxsPSIjMTExMTFmIiBzdHJva2U9IiMzMzMzNGYiLz48dGV4dCB4PSI1MCUiIHk9IjM0NSUiIGZpbGw9IiNmODcxNzEiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTEiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkNPTkZJREVOVElBTCBXQVJSQU5UWSBSRVRVUk4gRVZJREVOQ0UgQVNTRVQ8L3RleHQ+PC9zdmc+',
            size: 2000,
            isMedia: true,
            mediaType: 'image'
          }
        ];
      } else if (activeProvider === 'discord') {
        samples = [
          {
            name: 'user.json',
            content: `{
              "id": "28374928374928374",
              "username": "coder_suspect",
              "global_name": "Marcus Vance",
              "email": "suspect@discord-node.net",
              "phone": "+1 (555) 012-3456",
              "created_at": "2020-03-12T14:30:00.000Z",
              "registration_ip": "104.244.42.1",
              "mfa_enabled": true,
              "verified": true,
              "flags": 64
            }`,
            size: 350,
            isMedia: false
          },
          {
            name: 'ip_history.csv',
            content: `Timestamp,IP Address,Action
2026-06-15 10:22:15 UTC,104.244.42.1,Successful Login
2026-06-14 22:11:05 UTC,8.8.8.8,IP Security Alert
2026-06-13 18:45:10 UTC,186.77.139.198,Successful Login`,
            size: 250,
            isMedia: false
          },
          {
            name: 'messages.csv',
            content: `channel_id,message_id,timestamp,author_id,author_username,content,attachments
channel-999,msg-201,2026-06-15 10:25:00 UTC,28374928374928374,coder_suspect,"Let's deploy the node tonight. Todo está listo en nuestro lado.",discord_evidence_photo.jpg
channel-999,msg-202,2026-06-15 10:26:12 UTC,999888777666,partner_bob,"Entendido. Ich habe die Datenbank aktualisiert und gesichert.",
channel-999,msg-203,2026-06-15 10:28:00 UTC,28374928374928374,coder_suspect,"Perfect. Keep the keys encrypted with AES-256.",`,
            size: 500,
            isMedia: false
          },
          {
            name: 'discord_evidence_photo.jpg',
            content: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNjAwIDQwMCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iIzBmMTcyYSIvPjxjaXJjbGUgY3g9IjMwMCIgY3k9IjIwMCIgcj0iODAiIGZpbGw9IiMxMGI5ODEiIG9wYWNpdHk9IjAuMiIvPjx0ZXh0IHg9IjUwJSIgeT0iNDUlIiBmaWxsPSIjZmZmZmZmIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE4IiBmb250LXdlaWdodD0iYm9sZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RElTQ09SRCBTVVNQRUNUIFJFQ09SRDwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjU1JSIgZmlsbD0iIzk0YTNiOCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxMiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+UHJveHkgSVAgYWN0aXZlOiAxODYuNzcuMTM5LjE5ODwvdGV4dD48L3N2Zz4=',
            size: 1500,
            isMedia: true,
            mediaType: 'image'
          }
        ];
      } else if (activeProvider === 'snapchat') {
        samples = [
          {
            name: 'user_profile.json',
            content: `{
              "Profile": {
                "Username": "snap_suspect_26",
                "Display Name": "Marcus Vance",
                "Mobile Number": "+1 555-987-6543",
                "Email": "snap_suspect@protonmail.ch",
                "Created Timestamp": "2020-01-05 14:10:00 UTC",
                "Registration IP": "104.244.42.1"
              }
            }`,
            size: 300,
            isMedia: false
          },
          {
            name: 'ip_history.json',
            content: `{
              "Login History": [
                {
                  "Timestamp": "2026-06-15 18:30:00 UTC",
                  "IP Address": "104.244.42.1",
                  "Device UI": "Snap iOS",
                  "Carrier": "Verizon Wireless"
                },
                {
                  "Timestamp": "2026-06-14 11:22:00 UTC",
                  "IP Address": "186.77.139.198",
                  "Device UI": "Snap Android",
                  "Carrier": "Claro Miami"
                }
              ]
            }`,
            size: 400,
            isMedia: false
          },
          {
            name: 'chat_history.csv',
            content: `Target username snap_suspect_26
conversation_id,sender_username,recipient_username,group_member_usernames,conversation_title,text,media_id,timestamp
snap_chat_101,snap_suspect_26,partner_bob,,Secure DM,"Did you delete the server logs?",,2026-06-15 18:30:00 UTC
snap_chat_101,partner_bob,snap_suspect_26,,Secure DM,"Oui, tout est effacé. Rien ne reste sur le serveur.",,2026-06-15 18:31:15 UTC
snap_chat_101,snap_suspect_26,partner_bob,,Secure DM,,"b~encoded_snap_hash",2026-06-15 18:35:00 UTC`,
            size: 500,
            isMedia: false
          },
          {
            name: 'encoded_snap_hash.jpg',
            content: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgNDAwIDMwMCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmZmMwMCIvPjxwYXRoIGQ9Ik0gMjAwIDgwIFEgMjUwIDE0MCAyMDAgMjAwIFEgMTUwIDE0MCAyMDAgODAiIGZpbGw9IiNmZmZmZmYiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSI0Ii8+PHRleHQgeD0iNTAlIiB5PSI4NSUiIGZpbGw9IiMwMDAwMDAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBmb250LXdlaWdodD0iYm9sZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+U25hcGNoYXQgRGVjb2RlZCBNZWRpYSBBc3NldDwvdGV4dD48L3N2Zz4=',
            size: 1000,
            isMedia: true,
            mediaType: 'image'
          }
        ];
      } else if (activeProvider === 'google') {
        samples = [
          {
            name: 'subscriber_info.json',
            content: `{
              "profile": {
                "google_account_id": "1079250836616",
                "name": "Alex Mercer",
                "given_name": "Alex",
                "family_name": "Mercer",
                "email": "suspect_primary@gmail.com",
                "created_date": "2020-05-30T19:57:04Z",
                "terms_of_service_ip": "186.77.139.198",
                "tos_language": "en-US",
                "birthday": "October 26, 1993",
                "services": [
                  "Gmail", "Web & App Activity", "Location History", "Google Calendar", "YouTube", "Google Chat"
                ],
                "unregistered_services": [
                  "Google One"
                ],
                "status": "Disabled",
                "last_updated": "2026-07-09T02:08:11Z",
                "last_logins": [
                  "2026-06-15T03:57:17Z", "2026-06-07T15:00:04Z"
                ],
                "contact_email": "suspect_primary@gmail.com",
                "recovery_email": "suspect_recovery@gmail.com",
                "recovery_sms": "+13185644124 [US]"
              }
            }`,
            size: 1200,
            isMedia: false
          },
          {
            name: 'google_chat_user_info.json',
            content: `{
              "user": {
                "email": "suspect_recovery@gmail.com",
                "user_type": "Human"
              },
              "created_date": "2023-08-03T13:19:07Z",
              "user_state": "JOINED",
              "presence_shared": true,
              "blocked_rooms": []
            }`,
            size: 300,
            isMedia: false
          },
          {
            name: 'emails.json',
            content: `{
              "emails": [
                {
                  "id": "google-email-1",
                  "date": "2026-06-15T14:30:00Z",
                  "from": "partner_bob@protonmail.com",
                  "to": "suspect_recovery@gmail.com",
                  "subject": "Delivery Coordinates & Drop Schedule",
                  "body": "Alex, we need to finalize the transfer coordinates. I am connecting from our proxy server to transmit these parameters. The primary endpoint IP address is 186.77.139.199. Keep this secure.",
                  "ipAddress": "186.77.139.199",
                  "labels": ["Inbox", "Important"]
                },
                {
                  "id": "google-email-2",
                  "date": "2026-06-15T14:45:00Z",
                  "from": "suspect_recovery@gmail.com",
                  "to": "partner_bob@protonmail.com",
                  "subject": "Re: Delivery Coordinates & Drop Schedule",
                  "body": "Got it, Bob. I've logged the proxy IP. Срочно удали все резервные копии и сотри логи сессии.",
                  "ipAddress": "186.77.140.22",
                  "labels": ["Sent"]
                },
                {
                  "id": "google-email-3",
                  "date": "2026-06-14T09:12:00Z",
                  "from": "no-reply@coinbase.com",
                  "to": "suspect_recovery@gmail.com",
                  "subject": "New login detected on your account",
                  "body": "A login was detected from a new device on your Coinbase account. Details: IP Address: 186.77.140.45, Miami, FL.",
                  "ipAddress": "186.77.140.45",
                  "labels": ["Inbox", "Notifications"]
                }
              ]
            }`,
            size: 2000,
            isMedia: false
          },
          {
            name: 'browser_history.json',
            content: `{
              "Browser History": [
                {
                  "title": "how to clear web logs google takeout",
                  "url": "https://www.google.com/search?q=how+to+clear+web+logs+google+takeout",
                  "time_usec": 1781534400000000,
                  "client_id": "google_chrome_win64",
                  "ipAddress": "186.77.139.198"
                },
                {
                  "title": "protonmail encrypted message verification",
                  "url": "https://www.google.com/search?q=protonmail+encrypted+message+verification",
                  "time_usec": 1781533800000000,
                  "client_id": "google_chrome_win64",
                  "ipAddress": "186.77.139.198"
                },
                {
                  "title": "Log in - ProtonMail",
                  "url": "https://mail.proton.me/login",
                  "time_usec": 1781533200000000,
                  "client_id": "google_chrome_win64",
                  "ipAddress": "186.77.139.198"
                }
              ]
            }`,
            size: 1100,
            isMedia: false
          },
          {
            name: 'records.json',
            content: `{
              "locations": [
                {
                  "timestamp": "2026-06-15T14:30:00.000Z",
                  "latitudeE7": 257617000,
                  "longitudeE7": -801918000,
                  "accuracy": 15
                },
                {
                  "timestamp": "2026-06-15T14:45:00.000Z",
                  "latitudeE7": 257620000,
                  "longitudeE7": -801930000,
                  "accuracy": 10
                },
                {
                  "timestamp": "2026-06-15T15:00:00.000Z",
                  "latitudeE7": 257640000,
                  "longitudeE7": -801950000,
                  "accuracy": 5
                }
              ]
            }`,
            size: 800,
            isMedia: false
          },
          {
            name: 'devices.json',
            content: `{
              "devices": [
                {
                  "deviceModel": "iPhone 15 Pro",
                  "brand": "Apple",
                  "os": "iOS",
                  "lastLoginTime": "2026-06-15T14:30:00.000Z",
                  "lastLoginIp": "186.77.139.198"
                }
              ]
            }`,
            size: 250,
            isMedia: false
          }
        ];
      } else if (activeProvider === 'kik') {
        samples = [
          {
            name: 'kik_profile.txt',
            content: `=== REGISTRATION RECORD ===
Username: kik_covert_ops
Display Name: Covert Analyst
Email: ops_kik@sec-mail.net
Associated Phone: +1-312-555-8899
Created Date: 2021-08-19 14:22:00 UTC
Registration IP: 200.48.0.1`,
            size: 250,
            isMedia: false
          },
          {
            name: 'kik_messages.csv',
            content: `messageid,conversationid,timestampest,senderusername,recipientid,messagebody,ipaddress
kik-msg-501,convo-105,2026-06-15 14:30:00 EST,kik_covert_ops,partner_alice,"Hola Alice, ¿puedes verificar el servidor proxy hoy?",200.48.0.2
kik-msg-502,convo-105,2026-06-15 14:31:15 EST,partner_alice,kik_covert_ops,"Sí, todo está funcionando perfectamente. Sin registros en el disco.",200.48.0.5
kik-msg-503,convo-105,2026-06-15 14:35:00 EST,kik_covert_ops,partner_alice,"Great. I will establish the transfer bridge tonight.",200.48.0.2`,
            size: 500,
            isMedia: false
          }
        ];
      } else if (activeProvider === 'synchronos') {
        samples = [
          {
            name: 'subscriber_profile.txt',
            content: `SYNCHRONOS CLOUD SUBSCRIBER REPORT
Subscriber ID: SYNC-WARRANT-902
Registered Owner: Sarah Jenkins
Email: sjenkins_secure@proton.me
Primary Phone: +1-206-555-0144
Sync Account Created: 2022-11-04 09:15:30 UTC`,
            size: 250,
            isMedia: false
          },
          {
            name: '143022_sms.txt',
            relativePath: 'sms/2026-06-15/143022_sms.txt',
            content: `Address: +12065550199
Type: Received
Message Time UTC: 2026-06-15T14:30:22Z
Body: Meet me at the drop point. Todo está listo en Seattle.`,
            size: 150,
            isMedia: false
          },
          {
            name: '144500_call.txt',
            relativePath: 'call/2026-06-15/144500_call.txt',
            content: `Address: +12065550199
Type: Incoming
Message Time: 2026-06-15T14:45:00Z
Duration: 182
Status: Completed`,
            size: 150,
            isMedia: false
          },
          {
            name: 'device_backup.csv',
            relativePath: 'vzmobile/2026-06-16/device_backup.csv',
            content: `fileid,storagepath,filename,sizebytes,uploadtimestamp,filehashmd5,mimetype
f-101,/vault/keys.zip,keys.zip,4521000,2026-06-16T12:00:00Z,9e107d9d372bb6826bd81d3542a419d6,application/zip
f-102,/photos/confidential.png,confidential.png,120500,2026-06-16T12:05:00Z,8f4a7c0d3a2b1c8e9f0c2a5d4e6b7c8a,image/png`,
            size: 350,
            isMedia: false
          }
        ];
      } else if (activeProvider === 'mega') {
        samples = [
          {
            name: 'mega_account.json',
            content: `{
              "userhandle": "ABC12xyz",
              "email": "mega_shadow@protonmail.com",
              "firstname": "Marcus",
              "lastname": "Vance",
              "msisdn": "+12135550922",
              "status": "active",
              "signup_country": "DE",
              "language": "en",
              "pro_level": 1,
              "mfa_enabled": 1,
              "purge_protected": 1,
              "bsi_version": 2,
              "creation_timestamp": 1583838900,
              "lastactive_timestamp": 1718461800,
              "bsi_timestamp": 1718460000,
              "active_public_links": 1,
              "copyright_takedowns": 0,
              "num_chats": 2,
              "storage": { "bytes": 53687091200, "files": 120, "folders": 15 },
              "session_details": [
                {
                  "creation_timestamp": 1718452800,
                  "lastactive_timestamp": 1718461800,
                  "creation_ip": "82.165.1.100",
                  "user_agent": "Mozilla/5.0 MEGAAndroid",
                  "viable": 1,
                  "additional_ips": [
                    { "ip": "80.82.77.20", "firstseen_timestamp": 1718456400, "lastseen_timestamp": 1718460000 }
                  ]
                }
              ],
              "contacts": [
                { "ts": 1718186400, "cuserid": "bobSecure", "email": "bob_secure_node@mega.nz" }
              ],
              "password_changes": [
                { "timestamp": 1718000000, "ip": "82.165.1.100" }
              ],
              "links": [
                { "creation_timestamp": 1718373600, "handle": "shadow_archive_key_status" }
              ],
              "outshares": [
                { "target": "0", "handle": "SHARE_HDL_9921", "creation_timestamp": 1718366400 }
              ],
              "recoverable_delete_nodes": 2
            }`,
            size: 2000,
            isMedia: false
          }
        ];
      } else if (activeProvider === 'cybertip') {
        samples = [
          {
            name: 'cybertip_report_998312.json',
            content: `{
              "reportId": 998312,
              "dateReceived": "2026-06-15T10:00:00Z",
              "reportedInformation": {
                "incidentSummary": {
                  "incidentType": "Cyber Security Violation"
                },
                "reportingEsp": {
                  "espName": "Mega Ltd"
                },
                "reportedPeople": {
                  "reportedPersons": [
                    {
                      "role": "Suspect",
                      "espIdentifier": "mega-user-88421",
                      "firstName": "Marcus",
                      "lastName": "Vance",
                      "screenName": "marcus_v",
                      "emails": {
                        "emails": [{ "value": "marcus_vance@protonmail.com", "type": "Home" }]
                      },
                      "phones": {
                        "phones": [{ "value": "+1-213-555-0922" }]
                      },
                      "sourceInformation": {
                        "sourceCaptures": [
                          { "captureType": "IP Address", "value": "104.244.42.1" }
                        ]
                      }
                    },
                    {
                      "role": "Intended Recipient",
                      "firstName": "Elena",
                      "lastName": "Cho",
                      "emails": {
                        "emails": [{ "value": "elena.cho@example.com" }]
                      },
                      "phones": {
                        "phones": [{ "value": "+1-646-555-0144" }]
                      }
                    }
                  ]
                },
                "uploadedFiles": {
                  "uploadedFiles": [
                    {
                      "fileName": "suspect_image_extract_01.jpg",
                      "dateTime": "2026-06-15T09:45:00Z",
                      "hash": { "md5": "e10adc3949ba59abbe56e057f20f883e" },
                      "viewedByEsp": "Yes",
                      "sourceInformation": {
                        "sourceCaptures": [
                          { "captureType": "IP Address", "value": "104.244.42.1" }
                        ]
                      }
                    }
                  ]
                }
              },
              "additionalNcmecInformation": {
                "notes": {
                  "notes": [
                    { "dateTime": "2026-06-15T11:30:00Z", "value": "Subject connected from residential IP pool. Alerting local jurisdiction." }
                  ]
                }
              }
            }`,
            size: 1500,
            isMedia: false
          },
          {
            name: 'cybertip_report_998312.xml',
            content: `<CyberTipReport>
              <ReportId>998312</ReportId>
              <DateReceived>2026-06-15T10:00:00Z</DateReceived>
              <ReportingInformation>
                <ReportingESP>
                  <ESPName>Discord Inc</ESPName>
                </ReportingESP>
                <ReportingPerson>
                  <FirstName>ESP</FirstName>
                  <LastName>Analyst</LastName>
                  <Email>esp.analyst@discord.com</Email>
                </ReportingPerson>
                <ReportedPeople>
                  <ReportedPerson>
                    <Role>Suspect</Role>
                    <EspIdentifier>discord-user-88421</EspIdentifier>
                    <ScreenName>marcus_v</ScreenName>
                    <FirstName>Marcus</FirstName>
                    <LastName>Vance</LastName>
                    <Email>marcus_vance@protonmail.com</Email>
                    <Phone>+1-213-555-0922</Phone>
                    <SourceInformation>
                      <SourceCaptures>
                        <SourceCapture>
                          <IPAddress>186.77.139.198</IPAddress>
                        </SourceCapture>
                      </SourceCaptures>
                    </SourceInformation>
                  </ReportedPerson>
                  <ReportedPerson>
                    <Role>Intended Recipient</Role>
                    <FirstName>Elena</FirstName>
                    <LastName>Cho</LastName>
                    <Email>elena.cho@example.com</Email>
                    <PhoneNumber>+1-646-555-0144</PhoneNumber>
                  </ReportedPerson>
                </ReportedPeople>
                <UploadedFiles>
                  <UploadedFile>
                    <FileName>discord_extract_media_99.png</FileName>
                    <DateTime>2026-06-15T09:45:00Z</DateTime>
                    <MD5>e10adc3949ba59abbe56e057f20f883e</MD5>
                  </UploadedFile>
                </UploadedFiles>
              </ReportingInformation>
            </CyberTipReport>`,
            size: 1200,
            isMedia: false
          }
        ];
      }

      setLoadedFiles(samples);
      setIsProcessing(false);
      setProcessingProgress({ current: samples.length, total: samples.length, currentFileName: 'Workspace hydrated successfully!' });
      setActiveTab('timeline');
    }, 800);
  };

  // Client-side CSV Exporter
  const handleExportFilteredCSV = (filteredEvents: ForensicEvent[]) => {
    if (filteredEvents.length === 0) return;

    // Build headers
    const headers = ['Record ID', 'Timestamp', 'Category', 'Identity Sender', 'Identity Recipient', 'Action Payload', 'IP Address', 'Geo Location', 'Source File'];
    const csvRows = [headers.join(',')];

    filteredEvents.forEach(evt => {
      const row = [
        `"${evt.id.replace(/"/g, '""')}"`,
        `"${evt.timestamp}"`,
        `"${evt.category}"`,
        `"${evt.sender.replace(/"/g, '""')}"`,
        `"${(evt.recipient || '').replace(/"/g, '""')}"`,
        `"${evt.content.replace(/"/g, '""')}"`,
        `"${(evt.ipAddress || '')}"`,
        `"${(evt.location || '')}"`,
        `"${evt.sourceFile.replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${activeProvider}_forensic_timeline_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportEvidenceCSV = () => {
    if (unifiedExhibits.length === 0) return;
    
    const headers = ['Exhibit ID', 'Timestamp (UTC)', 'Category', 'Identity Sender', 'Identity Recipient', 'Action Payload / Content', 'Recorded IP', 'Evidence Notes', 'Source Extraction File'];
    const csvRows = [headers.join(',')];
    
    unifiedExhibits.forEach((evt, idx) => {
      const row = [
        `"EXHIBIT-${idx + 1}"`,
        `"${evt.timestamp}"`,
        `"${evt.category}"`,
        `"${evt.sender.replace(/"/g, '""')}"`,
        `"${(evt.recipient || '').replace(/"/g, '""')}"`,
        `"${evt.content.replace(/"/g, '""')}"`,
        `"${evt.ipAddress || ''}"`,
        `"${evt.notes.replace(/"/g, '""')}"`,
        `"${evt.sourceFile.replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(','));
    });
    
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `CASE_${caseId.replace(/[^a-zA-Z0-9-_]/g, '_')}_Evidence_Exhibits.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAllTaggedEvidenceZIP = async () => {
    if ((parsedResult?.events.length || 0) === 0 && unifiedExhibits.length === 0) return;
    
    try {
      const zip = new JSZip();
      const built = buildCurrentReport(false);
      const attachmentPaths = new Set(built.attachments.map(item => item.path));
      const reportFilePath = (file: { relativePath?: string; name?: string } | null | undefined) => {
        if (!file) return '';
        const raw = (file.relativePath || file.name || 'media').replace(/\\/g, '/');
        const parts = raw.split('/').filter(part => part && part !== '.' && part !== '..' && !/^[a-zA-Z]:$/.test(part));
        const safe = parts.map(part => part.replace(/[^a-zA-Z0-9._-]+/g, '_')).join('/') || 'media';
        const base = `files/${safe}`;
        if (attachmentPaths.has(base)) return base;
        return [...attachmentPaths].find(item => item.startsWith(`${base}-`)) || base;
      };
      
      const headers = [
        'Exhibit ID', 'Timestamp (UTC)', 'Category', 'Identity Sender', 
        'Identity Recipient', 'Action Payload / Content', 'Recorded IP', 
        'Evidence Notes', 'Source Extraction File', 'Associated File Path'
      ];
      const csvRows = [headers.join(',')];
      const manifestList: any[] = [];
      
      for (let idx = 0; idx < unifiedExhibits.length; idx++) {
        const evt = unifiedExhibits[idx];
        const exhibitIdStr = `EXHIBIT-${idx + 1}`;
        const safeId = evt.id.replace(/[^a-zA-Z0-9-_]/g, '_');
        const cleanSender = evt.sender.replace(/[^a-zA-Z0-9-_ ]/g, '_');
        const detailsFilename = `${exhibitIdStr}_${cleanSender.substring(0, 20)}_${safeId.substring(0, 10)}.txt`;
        const categoryDir = evt.category || 'other';
        
        const assocFilePathInZip = evt.mediaFile ? reportFilePath(evt.mediaFile) : '';
        
        const textContent = `======================================================================
OFFICIAL LAW ENFORCEMENT WARRANT EXHIBIT
======================================================================
EXHIBIT REFERENCE: ${exhibitIdStr}
EXHIBIT ID:        ${evt.id}
TIMESTAMP (UTC):   ${evt.timestamp}
CATEGORY:          ${evt.category.toUpperCase()}
SOURCE EXTRACTION: ${evt.sourceFile}
IDENTITY SENDER:   ${evt.sender}
IDENTITY RECIPIENT:${evt.recipient || 'N/A'}
RECORDED IP:       ${evt.ipAddress || 'N/A'}

CASE REFERENCE:    ${caseId || 'CASE-2026-UNSPECIFIED'}
OFFICIAL IN CHARGE:${investigatorName || 'Analyst (N/A)'}
TARGET SUBJECT:    ${suspectName || 'Target Subject'}

----------------------------------------------------------------------
EXHIBIT CONTENT / EVIDENCE RECORD:
----------------------------------------------------------------------
${evt.content}

----------------------------------------------------------------------
EXAMINER NOTES & ANNOTATIONS:
----------------------------------------------------------------------
${evt.notes || 'No notes added yet.'}

${assocFilePathInZip ? `----------------------------------------------------------------------
ASSOCIATED ATTACHMENT:
----------------------------------------------------------------------
File is exported in the ZIP archive at:
${assocFilePathInZip}
` : ''}
======================================================================
`;
        
        const detailsPathInZip = `exhibits/${categoryDir}/${detailsFilename}`;
        zip.file(detailsPathInZip, textContent);
        
        const csvRow = [
          `"${exhibitIdStr}"`,
          `"${evt.timestamp}"`,
          `"${evt.category}"`,
          `"${evt.sender.replace(/"/g, '""')}"`,
          `"${(evt.recipient || '').replace(/"/g, '""')}"`,
          `"${evt.content.replace(/"/g, '""')}"`,
          `"${evt.ipAddress || ''}"`,
          `"${evt.notes.replace(/"/g, '""')}"`,
          `"${evt.sourceFile.replace(/"/g, '""')}"`,
          `"${assocFilePathInZip}"`
        ];
        csvRows.push(csvRow.join(','));
        
        manifestList.push({
          exhibitId: exhibitIdStr,
          eventId: evt.id,
          timestamp: evt.timestamp,
          category: evt.category,
          sender: evt.sender,
          recipient: evt.recipient,
          content: evt.content,
          ipAddress: evt.ipAddress,
          sourceFile: evt.sourceFile,
          notes: evt.notes,
          detailsPath: detailsPathInZip,
          associatedFilePath: assocFilePathInZip || null
        });
      }
      
      zip.file('evidence_ledger.csv', csvRows.join('\n'));
      zip.file('evidence_manifest.json', JSON.stringify({
        caseId: caseId || 'CASE-2026-UNSPECIFIED',
        investigatorName: investigatorName || 'Analyst (N/A)',
        suspectName: suspectName || 'Target Subject',
        exportTimestamp: new Date().toISOString(),
        totalExhibits: unifiedExhibits.length,
        exhibits: manifestList
      }, null, 2));
      
      for (const attachment of built.attachments) {
        if (attachment.base64) zip.file(attachment.path, attachment.base64, { base64: true });
        else if (attachment.text != null) zip.file(attachment.path, attachment.text);
      }
      zip.file('evidence_report.html', built.html);

      
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `CASE_${(caseId || '2026').replace(/[^a-zA-Z0-9-_]/g, '_')}_Evidence_Archive.zip`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("ZIP Generation Failed:", e);
    }
  };

  const ingestionProfileCard = (
    <div id="ingestion-profile-card" className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          Ingestion profiles
        </span>
        <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded font-mono">
          Speeds up large returns
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
        <label className="flex items-start gap-2.5 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 rounded-lg cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-900 transition-all shadow-2xs">
          <input
            type="checkbox"
            checked={ingestDecodeMedia}
            onChange={(e) => setIngestDecodeMedia(e.target.checked)}
            className="mt-1 h-3.5 w-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
          />
          <div className="text-left select-none">
            <span className="text-[11px] font-bold text-slate-750 dark:text-slate-350 block">Media Attachments</span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-none">Every file is still hashed. Uncheck to skip the nudity check.</span>
          </div>
        </label>
        <label className="flex items-start gap-2.5 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 rounded-lg cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-900 transition-all shadow-2xs">
          <input
            type="checkbox"
            checked={ingestLanguageDetection}
            onChange={(e) => setIngestLanguageDetection(e.target.checked)}
            className="mt-1 h-3.5 w-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
          />
          <div className="text-left select-none">
            <span className="text-[11px] font-bold text-slate-750 dark:text-slate-350 block">Language NLP checks</span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-none">Auto-detect foreign text languages.</span>
          </div>
        </label>
        <label className="flex items-start gap-2.5 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 rounded-lg cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-900 transition-all shadow-2xs">
          <input
            type="checkbox"
            checked={ingestAnalyticsCharts}
            onChange={(e) => setIngestAnalyticsCharts(e.target.checked)}
            className="mt-1 h-3.5 w-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
          />
          <div className="text-left select-none">
            <span className="text-[11px] font-bold text-slate-750 dark:text-slate-350 block">Analytics &amp; Graphs</span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-none">Render distribution and category charts.</span>
          </div>
        </label>
        <label className="flex items-start gap-2.5 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 rounded-lg cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-900 transition-all shadow-2xs">
          <input
            id="ip-address-lookup"
            type="checkbox"
            checked={ingestIPGeolocation}
            onChange={(e) => setIngestIPGeolocation(e.target.checked)}
            className="mt-1 h-3.5 w-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
          />
          <div className="text-left select-none">
            <span className="text-[11px] font-bold text-slate-750 dark:text-slate-350 block">IP address lookup</span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-none">Look up IP addresses on the locations map. Photos, video, and file coordinates stay mapped either way.</span>
          </div>
        </label>
      </div>
    </div>
  );

  const renderControlCards = (isSidebar: boolean = false) => {
    const caseCard = (
      <div id="case-settings-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 uppercase tracking-wider">Investigative Context</h3>
          <p className="text-xs text-slate-400 mb-4 font-medium dark:text-slate-500">Set identifiers to customize database & report metadata.</p>
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Case Identifier / File Code</label>
            <input
              id="case-id-input"
              type="text"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              className="w-full text-sm font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-9"
              placeholder="e.g. CASE-2026-F8"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">AGENT NAME</label>
            <input
              id="examiner-name-input"
              type="text"
              value={investigatorName}
              onChange={(e) => setInvestigatorName(e.target.value)}
              className="w-full text-sm p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-9"
              placeholder="e.g. Agent John Doe"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Suspect Subject Name</label>
            <input
              id="suspect-name-input"
              type="text"
              value={suspectName}
              onChange={(e) => setSuspectName(e.target.value)}
              className="w-full text-sm p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-9"
              placeholder="e.g. Suspect Subject"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-3.5 mt-4 flex items-center justify-between text-[11px] text-slate-400 font-medium">
          <span>Database: <strong className="text-indigo-600 dark:text-indigo-400">SQLite Active</strong></span>
          <span className="flex items-center text-slate-500 dark:text-slate-400">
            <Lock className="h-3 w-3 mr-1 text-slate-400" /> Multi-Case Storage
          </span>
        </div>
      </div>
    );

    const sqliteCard = (
      <div id="sqlite-case-manager-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 uppercase tracking-wider flex items-center gap-1.5">
            <Database className="h-4 w-4 text-indigo-500" /> SQLite Case Manager
          </h3>
          <p className="text-xs text-slate-400 mb-4 font-medium dark:text-slate-500">Create, load, and switch between SQLite database cases.</p>
        </div>

        <div className="space-y-3.5 flex-1 flex flex-col justify-between">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Load Saved SQLite Case</label>
            {savedCases.length === 0 ? (
              <div className="text-center py-2 px-3 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-slate-400 dark:text-slate-500 text-[11px]">
                No saved cases in SQLite database.
              </div>
            ) : (
              <select
                value={savedCases.some(c => c.id === currentCaseDbId) ? currentCaseDbId : ''}
                onChange={(e) => {
                  if (e.target.value) loadCase(e.target.value);
                }}
                className="w-full text-xs p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-250 h-9 font-sans"
              >
                <option value="">-- Choose Case to Load --</option>
                {savedCases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.case_id_code ? `${c.case_id_code} (${c.suspect_name || 'No Suspect'})` : `Unnamed Case (${new Date(c.updated_at).toLocaleDateString()})`}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={() => { void saveCurrentCase(); }}
              className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-[11px] transition-colors flex items-center justify-center gap-1 shadow-xs cursor-pointer"
              title="Save case to master SQLite database"
            >
              <Save className="h-3 w-3" /> Save Case
            </button>

            <button
              onClick={createNewCase}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg text-[11px] transition-colors flex items-center justify-center gap-1 border border-slate-200 dark:border-slate-700 cursor-pointer"
              title="Start a new blank case"
            >
              <Plus className="h-3 w-3" /> New Case
            </button>

            <button
              onClick={() => setShowExportModal(true)}
              disabled={!savedCases.some(c => c.id === currentCaseDbId)}
              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg text-[11px] transition-colors flex items-center justify-center gap-1 shadow-xs cursor-pointer"
              title="Export this case as a portable SQLite database"
            >
              <Download className="h-3 w-3" /> Export DB
            </button>

            <label
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg text-[11px] transition-colors flex items-center justify-center gap-1 border border-slate-200 dark:border-slate-700 cursor-pointer text-center"
              title="Import a case from an uploaded SQLite database file"
            >
              <Upload className="h-3 w-3 inline" /> Import DB
              <input
                type="file"
                accept=".sqlite,.db"
                onChange={handleImportSQLite}
                className="hidden"
              />
            </label>
          </div>

          {savedCases.some(c => c.id === currentCaseDbId) && (
            <div className="mt-2 border-t border-slate-100 dark:border-slate-800 pt-2 flex justify-end">
              <button
                onClick={() => deleteCase(currentCaseDbId)}
                className="text-[10px] text-rose-500 hover:text-rose-600 font-bold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" /> Delete Case
              </button>
            </div>
          )}
        </div>

        {caseManagerMessage && (
          <div className={`mt-2 px-2.5 py-1 rounded text-[10px] font-bold ${
            caseManagerMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/30'
              : 'bg-rose-50 dark:bg-rose-950/20 text-rose-650 dark:text-rose-400 border border-rose-100/50 dark:border-rose-900/30'
          }`}>
            {caseManagerMessage.text}
          </div>
        )}
        {autosaveNote && (
          <p className="mt-2 text-[10px] font-medium text-slate-500 dark:text-slate-400">{autosaveNote}</p>
        )}
      </div>
    );

    const providerCard = (
      <div id="provider-selector-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 uppercase tracking-wider">Select Warrant Platform</h3>
          <p className="text-xs text-slate-400 mb-4 dark:text-slate-500">Choose formatting platform to parse return logs.</p>
        </div>

        <div className={`grid gap-2 ${isSidebar ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-2'}`}>
          {(Object.keys(providersInfo) as ProviderType[]).map((pType) => {
            const isActive = activeProvider === pType;
            return (
              <button
                key={pType}
                id={`provider-${pType}`}
                onClick={() => handleProviderChange(pType)}
                className={`p-2 rounded-lg border text-center transition-all flex flex-col items-center justify-center space-y-1 cursor-pointer ${
                  isActive
                    ? 'border-indigo-655 bg-indigo-50/75 text-indigo-900 dark:text-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-500/50 font-extrabold shadow-sm ring-1 ring-indigo-500/25'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Database className={`h-3.5 w-3.5 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
                <span className="text-[10px] font-bold font-sans tracking-tight leading-tight">{providersInfo[pType].name}</span>
              </button>
            );
          })}
        </div>

        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850 rounded-lg p-2.5 mt-4 text-[11px] text-slate-500 dark:text-slate-400 flex items-start space-x-2 shrink-0">
          <Info className="h-4 w-4 text-indigo-505 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-slate-700 dark:text-slate-300 block text-[11px]">{providersInfo[activeProvider].name} Profile:</span>
            <p className="text-[10px] mt-0.5 text-slate-500 dark:text-slate-400 leading-tight">{providersInfo[activeProvider].formats}</p>
          </div>
        </div>
      </div>
    );

    const dropzoneCard = (
      <div id="dropzone-control-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div
          id="parser-drag-dropzone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
            dragOver
              ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20 scale-[1.01]'
              : 'border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-700'
          }`}
        >
          <div className="max-w-md mx-auto space-y-2">
            <div className="mx-auto w-10 h-10 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 text-indigo-650 dark:text-indigo-400 rounded-xl flex items-center justify-center shadow-xs">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Drop Warrant Files Here</h4>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-tight">
                Supports .json, .csv, .txt, or .zip files.
              </p>
            </div>
            
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
              <label className="cursor-pointer inline-flex items-center px-2 py-1 border border-slate-200 dark:border-slate-805 text-[10px] font-semibold rounded-lg bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 text-slate-705 dark:text-slate-300 transition-colors shadow-xs">
                <FileText className="h-3 w-3 mr-1 text-slate-500" />
                <span>Files</span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  accept=".json,.csv,.txt,.tsv,.xml,.zip"
                />
              </label>

              <label className="cursor-pointer inline-flex items-center px-2 py-1 border border-indigo-200 dark:border-indigo-900/50 text-[10px] font-semibold rounded-lg bg-indigo-50/50 dark:bg-indigo-950 hover:bg-indigo-100/50 text-indigo-700 dark:text-indigo-300 transition-colors shadow-xs">
                <FolderOpen className="h-3 w-3 mr-1 text-indigo-500" />
                <span>Folder</span>
                <input
                  type="file"
                  multiple
                  {...({ webkitdirectory: "", directory: "" } as any)}
                  className="hidden"
                  onChange={handleFolderSelect}
                />
              </label>

              <button
                onClick={loadSampleDataset}
                className="cursor-pointer inline-flex items-center px-2 py-1 border border-amber-250/50 dark:border-amber-900/40 text-[10px] font-semibold rounded-lg bg-amber-50/50 dark:bg-amber-950 hover:bg-amber-100/50 text-amber-800 dark:text-amber-300 transition-colors shadow-xs animate-bounce"
              >
                <Sparkles className="h-3 w-3 mr-1 text-amber-500" />
                <span>Demo</span>
              </button>
            </div>
          </div>
        </div>

        {ingestionProfileCard}

        {/* Active Loading progress card */}
        {isProcessing && (
          <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-100/60 dark:border-indigo-900/45 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-indigo-750 dark:text-indigo-300">
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin text-indigo-650" />
                Parsing...
              </span>
              <span>{processingProgress.current} / {processingProgress.total}</span>
            </div>
            <div className="w-full bg-slate-250 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-indigo-600 dark:bg-indigo-500 h-1.5 rounded-full transition-all duration-150 animate-pulse" 
                style={{ width: `${(processingProgress.current / (processingProgress.total || 1)) * 100}%` }}
              />
            </div>
            {processingProgress.currentFileName && (
              <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono truncate">
                {processingProgress.currentFileName}
              </p>
            )}
          </div>
        )}

        {/* Uploaded evidence status banner */}
        {loadedFiles.length > 0 && (
          <div id="loaded-chips-card" className="p-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/55 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-emerald-850 dark:text-emerald-300">
              <FileCheck className="h-4 w-4 text-emerald-600" />
              <span>{loadedFiles.length} files loaded</span>
            </div>
            <button
              onClick={() => setActiveTab('workspace')}
              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-750 dark:text-indigo-400 dark:hover:text-indigo-300 inline-flex items-center"
            >
              <span>Workspace</span>
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );

    const pasteCard = (
      <div id="paste-input-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 uppercase tracking-wider">Raw Text Ingestion</h3>
          <p className="text-xs text-slate-400 mb-4 dark:text-slate-550">Paste clipboard search warrant code blocks directly to parse.</p>
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Assigned Dummy File Name</label>
            <input
              id="paste-file-name"
              type="text"
              value={pasteFileName}
              onChange={(e) => setPasteFileName(e.target.value)}
              className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-8"
              placeholder="raw_data.csv"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Clipboard Log Payload</label>
            <textarea
              id="paste-text-area"
              rows={isSidebar ? 2 : 4}
              value={rawPaste}
              onChange={(e) => setRawPaste(e.target.value)}
              className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 dark:bg-slate-950 dark:text-slate-200"
              placeholder="Paste CSV rows or JSON data here..."
            />
          </div>
        </div>

        <button
          id="parse-paste-btn"
          onClick={handlePasteParse}
          disabled={!rawPaste.trim()}
          className="w-full mt-4 inline-flex items-center justify-center px-3 py-2 border border-transparent text-xs font-bold rounded-lg text-white bg-indigo-650 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs"
        >
          Parse Raw Text
        </button>
      </div>
    );

    if (isSidebar) {
      return (
        <div className="space-y-4">
          {caseCard}
          {sqliteCard}
          {providerCard}
          {dropzoneCard}
          {pasteCard}
        </div>
      );
    }

    return (
      <>
        {/* Case Scope Settings & Platform Selectors */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
          {caseCard}
          {sqliteCard}
          {providerCard}
        </div>

        {/* Drag Zone, Presets, and Paste Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
          <div className="lg:col-span-2 text-left">
            {dropzoneCard}
          </div>
          {pasteCard}
        </div>
      </>
    );
  };

  const handleInspectRaw = async (file: UploadedFile) => {
    let preview = file.content || '';
    try {
      if (!preview && file.sourcePath) {
        const q = new URLSearchParams({ path: file.sourcePath });
        const res = await fetch(`/api/text-preview?${q.toString()}`);
        if (res.ok) {
          const data = await res.json();
          preview = data.text || '';
        }
      }
      if (!preview) {
        const q = new URLSearchParams({ rel: file.relativePath || '', name: file.name });
        const res = await fetch(`/api/cases/${encodeURIComponent(currentCaseDbId)}/file-text?${q.toString()}`);
        if (res.ok) {
          const data = await res.json();
          preview = data.text || '';
        }
      }
    } catch (err: any) {
      reportClientError(`Could not preview ${file.name}`, err?.stack || err?.message || String(err));
    }
    if (!preview) {
      preview = 'No text preview is available. The original file is not on this machine, or it was not stored with the case.';
    }
    if (preview.length > 8000) {
      preview = preview.substring(0, 8000) + '\n\n... [FORENSIC TRUNCATION: Content exceeds preview display threshold] ...';
    }
    setPreviewFileContent({ name: file.name, content: preview });
  };

  const openDiagnostics = async () => {
    setDiagnosticsOpen(true);
    try {
      const res = await fetch('/api/diagnostics');
      if (res.ok) setDiagnosticsInfo(await res.json());
    } catch (err) {
      console.error('Could not read diagnostics', err);
    }
  };

  return (
    <div id="application-layout-root" className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-100 antialiased flex flex-col transition-colors duration-300">
      
      {/* Print / Save PDF uses the shared case report document, not a second template. */}

      {/* ============================================== */}
      {/* 2. STANDARD APP PAGE LAYOUT (Visible in Browser) */}
      {/* ============================================== */}
      <div className="print:hidden flex-1 flex flex-col">
        
        {/* Top Header Section */}
        <header id="app-top-header" className="bg-slate-900 text-white border-b border-slate-800 shrink-0 select-none">
          <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="p-2.5 bg-indigo-600 rounded-xl border border-indigo-500 shadow-lg text-white">
                <Layers className="h-6 w-6" />
              </div>
              <div className="text-left">
                <h1 className="text-lg font-black tracking-tight flex items-center gap-1.5">
                  Warrant Return Parser <span className="text-[10px] uppercase bg-indigo-500 font-bold px-1.5 py-0.5 rounded tracking-widest text-indigo-100">PRO v1.2</span>
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">Unified offline-first evidence extraction workbench</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Layout Mode Toggle */}
              <button
                id="layout-toggle"
                onClick={() => setIsViewportFitMode(prev => !prev)}
                title={isViewportFitMode ? "Switch to Scrollable Page Layout" : "Switch to Full-Height Split Workspace Layout"}
                aria-label="Toggle workspace viewport fit mode"
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white font-bold text-xs transition-all border shadow-sm cursor-pointer ${
                  isViewportFitMode
                    ? 'bg-emerald-650 hover:bg-emerald-600 border-emerald-550'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700'
                }`}
              >
                <Columns className="h-3.5 w-3.5 text-slate-200" />
                <span>{isViewportFitMode ? "Split Pane" : "Page View"}</span>
              </button>

              <button
                id="diagnostics-toggle"
                onClick={() => { void openDiagnostics(); }}
                title="Open the error log and developer tools"
                aria-label="Open diagnostics"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors border border-slate-700 shadow-sm cursor-pointer"
              >
                <FolderOpen className="h-3.5 w-3.5 text-slate-200" />
                <span>Diagnostics</span>
              </button>

              <button
                id="instructions-toggle"
                onClick={() => setIsInstructionsOpen(true)}
                title="Instructions"
                aria-label="Open instructions guide"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-650 hover:bg-indigo-600 text-white font-bold text-xs transition-colors border border-indigo-550 shadow-sm cursor-pointer"
              >
                <HelpCircle className="h-3.5 w-3.5 text-indigo-200" />
                <span>Instructions</span>
              </button>

              {/* Portable Case Button */}
              <button
                id="portable-case-toggle"
                onClick={() => setIsPortableModalOpen(true)}
                title="Package Portable Case Viewer for external Law Enforcement sharing"
                aria-label="Package portable case"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs transition-colors border border-indigo-400 shadow-sm cursor-pointer"
              >
                <Package className="h-3.5 w-3.5 text-indigo-100" />
                <span>Portable Case</span>
              </button>
              {/* Settings button */}
              <button
                id="settings-toggle"
                onClick={() => setIsSettingsOpen(true)}
                title="Settings"
                aria-label="Open settings"
                className="inline-flex items-center justify-center p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700 shadow-sm cursor-pointer"
              >
                <Settings className="h-4 w-4 text-slate-400 hover:text-white transition-colors" />
              </button>
              <button
                id="dark-mode-toggle"
                onClick={toggleDarkMode}
                title="Toggle Eye-Strain Dark Mode"
                aria-label="Toggle eye-strain dark mode"
                className="inline-flex items-center justify-center p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700 shadow-sm"
              >
                {darkMode ? (
                  <Sun className="h-4 w-4 text-yellow-400" />
                ) : (
                  <Moon className="h-4 w-4 text-indigo-400" />
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Outer Grid */}
        <main className={`mx-auto px-4 py-4 sm:px-6 lg:px-8 flex-1 flex w-full transition-all duration-300 ${
          isViewportFitMode 
            ? 'max-w-full h-[calc(100vh-68px)] flex-row gap-4 overflow-hidden' 
            : 'max-w-7xl flex-col gap-6 overflow-y-auto'
        }`}>
          
          {isViewportFitMode ? (
            /* Left Sidebar */
            <div className={`${isSidebarCollapsed ? 'w-12' : 'w-80'} shrink-0 flex flex-col gap-4 overflow-y-auto h-full pr-1.5 scrollbar-thin border-r border-slate-200 dark:border-slate-800 transition-all duration-300 select-none pb-4 text-left`}>
              {isSidebarCollapsed ? (
                <div className="flex flex-col items-center gap-4 py-2">
                  <button
                    onClick={() => setIsSidebarCollapsed(false)}
                    title="Expand Left Control Pane"
                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-750 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <div className="h-px w-6 bg-slate-200 dark:bg-slate-800" />
                  <div className="text-[10px] font-black text-slate-405 uppercase tracking-widest rotate-90 my-12 shrink-0 whitespace-nowrap">
                    FORENSIC CONTEXT
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 shrink-0">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Forensic Control Deck</span>
                    <button
                      onClick={() => setIsSidebarCollapsed(true)}
                      title="Collapse Left Control Pane"
                      className="p-1 rounded-md bg-slate-55 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-405 hover:text-slate-600 dark:text-slate-350 cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  </div>
                  {renderControlCards(true)}
                </>
              )}
            </div>
          ) : null}

          {/* 4. Active Parsed Workplace Dashboard Wrapper */}
          <div className={isViewportFitMode ? "flex-1 flex flex-col min-w-0 h-full overflow-hidden text-left" : "w-full space-y-6"}>
            
            {!isViewportFitMode && (
              /* Case Scope Settings & Platform Selectors */
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
            
            {/* Case Profile details card */}
            <div id="case-settings-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 uppercase tracking-wider">Investigative Context</h3>
                <p className="text-xs text-slate-400 mb-4 font-medium dark:text-slate-500">Set identifiers to customize database & report metadata.</p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Case Identifier / File Code</label>
                  <input
                    id="case-id-input"
                    type="text"
                    value={caseId}
                    onChange={(e) => setCaseId(e.target.value)}
                    className="w-full text-sm font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-9"
                    placeholder="e.g. CASE-2026-F8"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">AGENT NAME</label>
                  <input
                    id="examiner-name-input"
                    type="text"
                    value={investigatorName}
                    onChange={(e) => setInvestigatorName(e.target.value)}
                    className="w-full text-sm p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-9"
                    placeholder="e.g. Agent John Doe"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Suspect Subject Name</label>
                  <input
                    id="suspect-name-input"
                    type="text"
                    value={suspectName}
                    onChange={(e) => setSuspectName(e.target.value)}
                    className="w-full text-sm p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-9"
                    placeholder="e.g. Suspect Subject"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800 pt-3.5 mt-4 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                <span>Database: <strong className="text-indigo-600 dark:text-indigo-400">SQLite Active</strong></span>
                <span className="flex items-center text-slate-500 dark:text-slate-400">
                  <Lock className="h-3 w-3 mr-1 text-slate-400" /> Multi-Case Storage
                </span>
              </div>
            </div>

            {/* SQLite Case Manager Card */}
            <div id="sqlite-case-manager-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 uppercase tracking-wider flex items-center gap-1.5">
                  <Database className="h-4 w-4 text-indigo-500" /> SQLite Case Manager
                </h3>
                <p className="text-xs text-slate-400 mb-4 font-medium dark:text-slate-500">Create, load, and switch between SQLite database cases.</p>
              </div>

              <div className="space-y-3.5 flex-1 flex flex-col justify-between">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Load Saved SQLite Case</label>
                  {savedCases.length === 0 ? (
                    <div className="text-center py-2 px-3 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-slate-400 dark:text-slate-500 text-[11px]">
                      No saved cases in SQLite database.
                    </div>
                  ) : (
                    <select
                      value={savedCases.some(c => c.id === currentCaseDbId) ? currentCaseDbId : ''}
                      onChange={(e) => {
                        if (e.target.value) loadCase(e.target.value);
                      }}
                      className="w-full text-xs p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-250 h-9 font-sans"
                    >
                      <option value="">-- Choose Case to Load --</option>
                      {savedCases.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.case_id_code ? `${c.case_id_code} (${c.suspect_name || 'No Suspect'})` : `Unnamed Case (${new Date(c.updated_at).toLocaleDateString()})`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    onClick={() => { void saveCurrentCase(); }}
                    className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-[11px] transition-colors flex items-center justify-center gap-1 shadow-xs cursor-pointer"
                    title="Save case to master SQLite database"
                  >
                    <Save className="h-3 w-3" /> Save Case
                  </button>

                  <button
                    onClick={createNewCase}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg text-[11px] transition-colors flex items-center justify-center gap-1 border border-slate-200 dark:border-slate-700 cursor-pointer"
                    title="Start a new blank case"
                  >
                    <Plus className="h-3 w-3" /> New Case
                  </button>

                  <button
                    onClick={() => setShowExportModal(true)}
                    disabled={!savedCases.some(c => c.id === currentCaseDbId)}
                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg text-[11px] transition-colors flex items-center justify-center gap-1 shadow-xs cursor-pointer"
                    title="Export this case as a portable SQLite database"
                  >
                    <Download className="h-3 w-3" /> Export DB
                  </button>

                  <label
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg text-[11px] transition-colors flex items-center justify-center gap-1 border border-slate-200 dark:border-slate-700 cursor-pointer text-center"
                    title="Import a case from an uploaded SQLite database file"
                  >
                    <Upload className="h-3 w-3 inline" /> Import DB
                    <input
                      type="file"
                      accept=".sqlite,.db"
                      onChange={handleImportSQLite}
                      className="hidden"
                    />
                  </label>
                </div>

                {savedCases.some(c => c.id === currentCaseDbId) && (
                  <div className="mt-2 border-t border-slate-100 dark:border-slate-800 pt-2 flex justify-end">
                    <button
                      onClick={() => deleteCase(currentCaseDbId)}
                      className="text-[10px] text-rose-500 hover:text-rose-600 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" /> Delete Case
                    </button>
                  </div>
                )}
              </div>

              {caseManagerMessage && (
                <div className={`mt-2 px-2.5 py-1 rounded text-[10px] font-bold ${
                  caseManagerMessage.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/30'
                    : 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100/50 dark:border-rose-900/30'
                }`}>
                  {caseManagerMessage.text}
                </div>
              )}
              {autosaveNote && (
                <p className="mt-2 text-[10px] font-medium text-slate-500 dark:text-slate-400">{autosaveNote}</p>
              )}
            </div>

            {/* Provider Selection Card */}
            <div id="provider-selector-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 uppercase tracking-wider">Select Warrant Platform</h3>
                <p className="text-xs text-slate-400 mb-4 dark:text-slate-500">Choose formatting platform to parse return logs.</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
                {(Object.keys(providersInfo) as ProviderType[]).map((pType) => {
                  const isActive = activeProvider === pType;
                  return (
                    <button
                      key={pType}
                      id={`provider-${pType}`}
                      onClick={() => handleProviderChange(pType)}
                      className={`p-2.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center space-y-1 ${
                        isActive
                          ? 'border-indigo-600 bg-indigo-50/75 text-indigo-900 dark:text-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-500/50 font-extrabold shadow-sm ring-1 ring-indigo-500/25'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <Database className={`h-4 w-4 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
                      <span className="text-[11px] font-bold font-sans tracking-tight">{providersInfo[pType].name}</span>
                    </button>
                  );
                })}
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850 rounded-lg p-2.5 mt-4 text-[11px] text-slate-500 dark:text-slate-400 flex items-start space-x-2 shrink-0">
                <Info className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-300 block text-[11px]">{providersInfo[activeProvider].name} Profile:</span>
                  <p className="text-[10px] mt-0.5 text-slate-500 dark:text-slate-400 leading-tight">{providersInfo[activeProvider].formats}</p>
                </div>
              </div>
            </div>
          </div>
          )}

          {!isViewportFitMode && (
            /* 3. Drag Zone, Presets, and Paste Controls */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
            
            {/* Parser Dropzone file importer */}
            <div className="lg:col-span-2 space-y-4 text-left">
              <div
                id="parser-drag-dropzone"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                  dragOver
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20 scale-[1.01]'
                    : 'border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-700'
                }`}
              >
                <div className="max-w-md mx-auto space-y-3">
                  <div className="mx-auto w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center shadow-xs">
                    <UploadCloud className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Drop Warrant Files Here</h4>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      Drag & Drop .json, .csv, .txt, or .zip files containing returns, chat logs, or media attachments.
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                    <label className="cursor-pointer inline-flex items-center px-3 py-1.5 border border-slate-200 dark:border-slate-800 text-xs font-semibold rounded-lg bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300 transition-colors shadow-xs">
                      <FileText className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                      <span>Pick Local Files</span>
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleFileSelect}
                        accept=".json,.csv,.txt,.tsv,.xml,.zip"
                      />
                    </label>

                    <label className="cursor-pointer inline-flex items-center px-3 py-1.5 border border-indigo-200 dark:border-indigo-900/50 text-xs font-semibold rounded-lg bg-indigo-50/50 dark:bg-indigo-950 hover:bg-indigo-100/50 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 transition-colors shadow-xs">
                      <FolderOpen className="h-3.5 w-3.5 mr-1.5 text-indigo-500" />
                      <span>Import Folder / Directory</span>
                      <input
                        type="file"
                        multiple
                        {...({ webkitdirectory: "", directory: "" } as any)}
                        className="hidden"
                        onChange={handleFolderSelect}
                      />
                    </label>

                    <button
                      onClick={loadSampleDataset}
                      className="cursor-pointer inline-flex items-center px-3 py-1.5 border border-amber-200 dark:border-amber-900/50 text-xs font-semibold rounded-lg bg-amber-50/50 dark:bg-amber-950 hover:bg-amber-100/50 dark:hover:bg-amber-900 text-amber-800 dark:text-amber-300 transition-colors shadow-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
                      <span>Load Sample Return</span>
                    </button>
                  </div>

                  <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal max-w-sm mx-auto text-center mt-1">
                    💡 <strong>Massive Returns (up to 500 GB+)</strong>: Unzip locally and use "Import Folder" to stream files in chunks with zero-memory footprint.
                  </p>
                </div>
              </div>

              {/* Active Loading progress card */}
              {isProcessing && (
                <div className="p-4 bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-100/60 dark:border-indigo-900/45 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-700 dark:text-indigo-300">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400" />
                      Incremental Parser Active...
                    </span>
                    <span>{processingProgress.current} / {processingProgress.total} Files</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-indigo-600 dark:bg-indigo-500 h-2 rounded-full transition-all duration-150 animate-pulse" 
                      style={{ width: `${(processingProgress.current / (processingProgress.total || 1)) * 100}%` }}
                    />
                  </div>
                  {processingProgress.currentFileName && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">
                      Processing: {processingProgress.currentFileName}
                    </p>
                  )}
                </div>
              )}

              {ingestionProfileCard}

              {/* Uploaded evidence status banner */}
              {loadedFiles.length > 0 && (
                <div id="loaded-chips-card" className="p-3.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/55 rounded-xl flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                    <FileCheck className="h-4.5 w-4.5 text-emerald-600" />
                    <span>{loadedFiles.length} files successfully loaded & parsed.</span>
                  </div>
                  <button
                    onClick={() => {
                      setActiveTab('workspace');
                      setTimeout(() => {
                        const element = document.getElementById('active-workplace-dashboard') || document.getElementById('dashboard-tabs-bar');
                        if (element) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }, 100);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-750 dark:text-indigo-400 dark:hover:text-indigo-300 inline-flex items-center cursor-pointer"
                  >
                    <span>View Workspace</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Paste Data Control */}
            <div id="paste-input-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 uppercase tracking-wider">Raw Text Ingestion</h3>
                <p className="text-xs text-slate-400 mb-4 dark:text-slate-500">Paste clipboard search warrant code blocks directly to parse.</p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Assigned Dummy File Name</label>
                  <input
                    id="paste-file-name"
                    type="text"
                    value={pasteFileName}
                    onChange={(e) => setPasteFileName(e.target.value)}
                    className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-8"
                    placeholder="raw_data.csv"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Clipboard Log Payload</label>
                  <textarea
                    id="paste-text-area"
                    rows={4}
                    value={rawPaste}
                    onChange={(e) => setRawPaste(e.target.value)}
                    className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 dark:bg-slate-950 dark:text-slate-200"
                    placeholder="Paste CSV rows or JSON data here..."
                  />
                </div>
              </div>

              <button
                id="parse-paste-btn"
                onClick={handlePasteParse}
                disabled={!rawPaste.trim()}
                className="w-full mt-4 inline-flex items-center justify-center px-3 py-2 border border-transparent text-xs font-bold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs"
              >
                Parse Raw Text
              </button>
            </div>
          </div>
          )}


          {/* 4. Active Parsed Workplace Dashboard */}
          {!parsedResult ? (
            <motion.div
              id="empty-workplace-dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 text-center text-slate-500 dark:text-slate-400 ${
                isViewportFitMode ? 'flex-1 flex flex-col items-center justify-center p-8 h-full' : 'p-12'
              }`}
            >
              <Database className="h-10 w-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <h3 className="font-bold text-slate-700 dark:text-slate-300 text-base">Workspace is Clear</h3>
              <p className="text-sm text-slate-400 dark:text-slate-550 max-w-sm mx-auto mt-1">
                Establish clinical context by loading a sample dataset or dropping local law enforcement files directly in the active drop deck.
              </p>
            </motion.div>
          ) : (
            <div className={isViewportFitMode ? "flex-1 flex flex-col min-h-0 h-full gap-4 overflow-hidden text-left" : "w-full"}>
              
              {isViewportFitMode && (
                /* Compact Case Context Header */
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-wrap gap-4 items-center justify-between shrink-0 text-left">
                  <div className="flex items-center space-x-2">
                    <FolderOpen className="h-4 w-4 text-indigo-500" />
                    <span className="text-xs font-bold text-slate-750 dark:text-slate-300">
                      {caseId ? `Case: ${caseId}` : "Untitled Case"}
                    </span>
                    <span className="text-slate-300 dark:text-slate-700 font-light">|</span>
                    <span className="text-xs text-slate-500">
                      {suspectName ? `Subject: ${suspectName}` : "No Suspect"}
                    </span>
                  </div>
                  <div className="flex gap-3 text-[10px] font-bold text-slate-400 uppercase font-mono">
                    <div>Exhibits: <span className="text-slate-800 dark:text-slate-200">{loadedFiles.length}</span></div>
                    <div>Timeline: <span className="text-slate-800 dark:text-slate-200">{activeResult.events.length}</span></div>
                  </div>
                </div>
              )}

              <div id="active-workplace-dashboard" className={isViewportFitMode ? "flex-1 overflow-y-auto h-full pr-1 pb-6 space-y-6 text-left scrollbar-thin" : "space-y-6"}>
              
              {/* Dashboard stats indicators */}
              <DashboardStats result={activeResult} />

              {/* Sub-identity mapping */}
              <AccountInfoCard 
                account={activeResult?.accountInfo ?? parsedResult.accountInfo} 
                accounts={parsedResult.accounts}
                accountChanges={parsedResult.accountChanges}
                selectedAccountFilter={activeAccountFilter}
                onAccountFilterChange={setActiveAccountFilter}
                provider={providersInfo[activeProvider].name}
                linkEdges={linkEdges}
              />

              {activeAccountFilter !== 'all' && (
                <div id="account-filter-chip" className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 px-3 py-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Showing{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {providersInfo[activeProvider].name}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600 mx-1" aria-hidden>{'\u00B7'}</span>
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                      {(() => {
                        const acc = parsedResult.accounts?.find((a, idx) => {
                          const label = accountFilterLabel(a, idx);
                          return (
                            label === activeAccountFilter ||
                            a.username === activeAccountFilter ||
                            a.userId === activeAccountFilter ||
                            a.accountKey === activeAccountFilter ||
                            a.displayName === activeAccountFilter
                          );
                        });
                        return acc?.username || acc?.displayName || acc?.userId || activeAccountFilter;
                      })()}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveAccountFilter('all')}
                    className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Show all
                  </button>
                </div>
              )}

              {activeProvider === 'kik' &&
                !!(parsedResult.accountInfo?.username || parsedResult.accounts?.some(a => a.username)) &&
                !(parsedResult.events || []).some(e => e.category === 'message') && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-left">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                    Subscriber PDF loaded - waiting on chat CSVs
                  </p>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/70 mt-0.5">
                    Identity is on the card above. Re-import the Kik return folder/zip so chat_sent / messages CSVs are included. Conversation View stays empty until those load.
                  </p>
                </div>
              )}

              {/* Phase 1: Exact link suggestions — accounts stay unmerged */}
              <SharedIdentifiersPanel
                accountsCount={parsedResult.accounts?.length || 0}
                linkEdges={linkEdges}
                identifierOccurrences={identifierOccurrences}
                selectedEdgeId={selectedLinkEdgeId}
                onSelectEdge={setSelectedLinkEdgeId}
                onJumpToAccount={(label) => {
                  setActiveAccountFilter(label);
                  setSelectedLinkEdgeId(null);
                }}
              />

              {/* Visualized graphs */}
              {ingestAnalyticsCharts ? (
                <ForensicCharts events={activeResult.events} />
              ) : (
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-4 text-center">
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    📈 Analytics Distribution Graphs &amp; Charts are disabled in Ingestion settings. Toggle it on in the settings panel above to render timelines visually.
                  </p>
                </div>
              )}

              {/* Navigation Tabs Bar */}
              <div id="dashboard-tabs-bar" className="border-b border-slate-200 dark:border-slate-800 flex items-center justify-between overflow-hidden">
                <div className="flex space-x-1 overflow-x-auto whitespace-nowrap scrollbar-thin pb-1 flex-nowrap w-full">
                  <button
                    id="tab-toggle-timeline"
                    onClick={() => setActiveTab('timeline')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all inline-flex items-center space-x-1.5 ${
                      activeTab === 'timeline'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <Layers className="h-4 w-4" />
                    <span>Chronology Timeline</span>
                  </button>
                  <button
                    id="tab-toggle-media"
                    onClick={() => setActiveTab('media')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all inline-flex items-center space-x-1.5 ${
                      activeTab === 'media'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <ImageIcon className="h-4 w-4" />
                    <span>Media Vault</span>
                    {loadedFiles.filter(f => f.isMedia).length > 0 && (
                      <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 text-[10px] px-1.5 py-0.5 rounded-full font-sans font-extrabold ml-1">
                        {loadedFiles.filter(f => f.isMedia).length}
                      </span>
                    )}
                  </button>
                  <button
                    id="tab-toggle-evidence"
                    onClick={() => setActiveTab('evidence')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all inline-flex items-center space-x-1.5 ${
                      activeTab === 'evidence'
                        ? 'border-amber-600 text-amber-600 dark:text-amber-400'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-amber-200'
                    }`}
                  >
                    <Tag className="h-4 w-4 text-amber-500" />
                    <span>Exhibits & Evidence</span>
                    {unifiedExhibits.length > 0 && (
                      <span className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] px-1.5 py-0.5 rounded-full font-sans font-extrabold ml-1">
                        {unifiedExhibits.length}
                      </span>
                    )}
                  </button>

                  {activeResult.events.some(e => e.category === 'message') && (
                    <button
                      id="tab-toggle-chats"
                      onClick={() => setActiveTab('chats')}
                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all inline-flex items-center space-x-1.5 ${
                        activeTab === 'chats'
                          ? 'border-purple-600 text-purple-600 dark:text-purple-450'
                          : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-purple-200'
                      }`}
                    >
                      <MessageSquare className="h-4 w-4 text-purple-500" />
                      <span>Conversation View</span>
                    </button>
                  )}

                  <button
                    id="tab-toggle-workspace"
                    onClick={() => setActiveTab('workspace')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all inline-flex items-center space-x-1.5 ${
                      activeTab === 'workspace'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <FolderOpen className="h-4 w-4 text-slate-500" />
                    <span>Workspace Files</span>
                    {loadedFiles.length > 0 && (
                      <span className="bg-slate-100 text-slate-800 dark:bg-slate-950 dark:text-slate-300 text-[10px] px-1.5 py-0.5 rounded-full font-sans font-extrabold ml-1">
                        {loadedFiles.length}
                      </span>
                    )}
                  </button>

                  <button
                    id="tab-toggle-entity-discovery"
                    onClick={() => setActiveTab('entity-discovery')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all inline-flex items-center space-x-1.5 ${
                      activeTab === 'entity-discovery'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <Fingerprint className="h-4 w-4 text-indigo-500 animate-pulse" />
                    <span>Entity Discovery</span>
                    {discoveredEntities.length > 0 && (
                      <span className="bg-indigo-150 text-indigo-900 dark:bg-indigo-900/60 dark:text-indigo-250 text-[10px] px-2 py-0.5 rounded-full font-sans font-extrabold ml-1">
                        {discoveredEntities.length} matches
                      </span>
                    )}
                  </button>

                  {hasLocationTab && (
                    <button
                      id="tab-toggle-ip-map"
                      onClick={() => setActiveTab('ip-map')}
                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all inline-flex items-center space-x-1.5 ${
                        activeTab === 'ip-map'
                          ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                          : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-emerald-200'
                      }`}
                    >
                      <MapIcon className="h-4 w-4 text-emerald-500" />
                      <span>Locations Map</span>
                      <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] px-1.5 py-0.5 rounded-full font-sans font-extrabold ml-1">
                        {locationPoints.length}
                      </span>
                    </button>
                  )}

                  {activeProvider === 'google' && activeResult.events.some(e => e.category === 'message' && e.details?.isEmail) && (
                    <button
                      id="tab-toggle-emails"
                      onClick={() => setActiveTab('emails')}
                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all inline-flex items-center space-x-1.5 ${
                        activeTab === 'emails'
                          ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                          : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      <Mail className="h-4 w-4 text-indigo-400" />
                      <span>Gmail Browser</span>
                      {activeResult.events.filter(e => e.category === 'message' && e.details?.isEmail).length > 0 && (
                        <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 text-[10px] px-1.5 py-0.5 rounded-full font-sans font-extrabold ml-1">
                          {activeResult.events.filter(e => e.category === 'message' && e.details?.isEmail).length}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Tab views content switcher */}
              {activeTab === 'timeline' && (
                <div id="tabview-timeline" className="space-y-4 animate-fadeIn">
                  <EventTimeline
                    events={activeResult.events}
                    onExportFilteredCSV={handleExportFilteredCSV}
                    evidenceTags={evidenceTags}
                    onToggleTag={handleToggleTag}
                    onUpdateNotes={handleUpdateNotes}
                    loadedFiles={loadedFiles}
                    searchTerm={timelineSearchQuery}
                    onSearchTermChange={setTimelineSearchQuery}
                    showCategoryDefinitions={showCategoryDefinitions}
                    disableLanguageDetection={!ingestLanguageDetection}
                    ollamaEnabled={ollamaEnabled}
                    ollamaUrl={ollamaUrl}
                    ollamaModel={ollamaModel}
                    ollamaAutoTranslate={ollamaAutoTranslate}
                    translations={translations}
                    onSaveTranslation={handleSaveTranslation}
                    vicHashes={vicHashes}
                    hashHits={hashHits}
                  />
                </div>
              )}

              {activeTab === 'ip-map' && (
                <div id="tabview-ip-map" className="animate-fadeIn">
                  <LocationsMap
                    points={locationPoints}
                    ips={ingestIPGeolocation ? activeResult.summaryStats.uniqueIPs : []}
                    lookupIps={ingestIPGeolocation}
                    rescanning={rescanningLocations}
                    evidenceTags={evidenceTags}
                    onToggleTag={handleToggleTag}
                    onUpdateNotes={handleUpdateNotes}
                    onRescan={() => { void rescanLocations(); }}
                    onOpenMedia={(name) => {
                      setMediaFocus({ name, nonce: Date.now() });
                      setActiveTab('media');
                    }}
                    onOpenRecord={(point) => {
                      if (point.mediaName || point.kind === 'photo-exif' || point.kind === 'video-metadata') {
                        setMediaFocus({ name: point.mediaName || point.fileName, nonce: Date.now() });
                        setActiveTab('media');
                        return;
                      }
                      if (point.eventId) {
                        setTimelineSearchQuery(point.eventId);
                        setActiveTab('timeline');
                        return;
                      }
                      setWorkspaceFocus(point.fileName);
                      setActiveTab('workspace');
                    }}
                  />
                </div>
              )}

              {activeTab === 'emails' && activeProvider === 'google' && (
                <div id="tabview-emails" className="animate-fadeIn">
                  <GmailBrowser
                    events={activeResult.events}
                    evidenceTags={evidenceTags}
                    onToggleTag={handleToggleTag}
                    onUpdateNotes={handleUpdateNotes}
                    userEmail={activeResult.accountInfo?.email}
                  />
                </div>
              )}

              {activeTab === 'media' && (
                <MediaVault
                  files={loadedFiles}
                  evidenceTags={evidenceTags}
                  events={parsedResult?.events}
                  accounts={parsedResult?.accounts}
                  accountFilter={activeAccountFilter}
                  vicHashes={vicHashes}
                  hashHits={hashHits}
                  caseId={currentCaseDbId}
                  forensicProgress={forensicQueueProgress}
                  analysisSummary={analysisSummary}
                  onToggleTag={handleToggleTag}
                  onUpdateNotes={handleUpdateNotes}
                  onBulkTag={handleBulkTagMedia}
                  focusName={mediaFocus?.name}
                  focusNonce={mediaFocus?.nonce || 0}
                />
              )}


              {activeTab === 'evidence' && (
                <div id="tabview-evidence-exhibits" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-left space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm uppercase tracking-wider flex items-center">
                        <Tag className="h-4.5 w-4.5 text-amber-500 mr-2" />
                        Law Enforcement Evidence Locker
                      </h3>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                        Review, annotate, and sign off on marked exhibits. Export to PDF/Excel formats.
                      </p>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <label
                        id="import-evidence-tags"
                        className="inline-flex items-center px-3 py-1.5 border border-amber-300 dark:border-amber-800 text-xs font-bold rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 hover:bg-amber-100/80 transition-colors shadow-xs cursor-pointer"
                        title="Merge a portable viewer tag export into this case"
                      >
                        <Upload className="h-4 w-4 mr-1.5" />
                        Import tags
                        <input
                          type="file"
                          accept=".json,application/json"
                          onChange={handleImportEvidenceTags}
                          className="hidden"
                        />
                      </label>
                      <button
                        id="evidence-excel-export"
                        onClick={handleExportEvidenceCSV}
                        className="inline-flex items-center px-3 py-1.5 border border-indigo-200 dark:border-indigo-900 text-xs font-bold rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-300 hover:bg-indigo-100/80 transition-colors shadow-xs cursor-pointer"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-1.5 text-emerald-600" />
                        Export Ledger (CSV)
                      </button>
                      <button
                        id="evidence-zip-export"
                        onClick={handleDownloadAllTaggedEvidenceZIP}
                        className="inline-flex items-center px-3 py-1.5 border border-indigo-200 dark:border-indigo-900 text-xs font-bold rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-300 hover:bg-indigo-100/80 transition-colors shadow-xs cursor-pointer"
                      >
                        <Download className="h-4 w-4 mr-1.5 text-indigo-600" />
                        Download Archive (ZIP)
                      </button>
                      <button
                        id="evidence-portable-case"
                        onClick={() => setIsPortableModalOpen(true)}
                        className="inline-flex items-center px-3 py-1.5 border border-indigo-500 text-xs font-extrabold rounded-lg text-white bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-xs cursor-pointer"
                      >
                        <Package className="h-4 w-4 mr-1.5 text-indigo-100" />
                        Package Portable Case
                      </button>
                      <button
                        id="evidence-print-sealed"
                        onClick={() => setIsReportOpen(true)}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-bold rounded-lg text-white bg-amber-600 hover:bg-amber-500 transition-colors shadow-xs cursor-pointer"
                      >
                        <FileText className="h-4 w-4 mr-1.5" />
                        Create PDF Report
                      </button>
                    </div>
                  </div>

                  {unifiedExhibits.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <Tag className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto mb-3 opacity-80" />
                      <p className="text-sm font-medium text-slate-400 dark:text-slate-500">No evidence tags have been placed yet.</p>
                      <p className="text-xs text-slate-300 dark:text-slate-650 mt-1 max-w-sm mx-auto font-medium animate-pulse">Navigate to the Chronology Timeline or Media Vault and toggle the Tag icon beside any record row to populate this official ledger.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Ollama-powered Case Briefing Assistant Section */}
                      <div className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/60 dark:border-indigo-900/30 rounded-xl space-y-3.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-indigo-500 animate-pulse" />
                            <div className="text-left">
                              <h4 className="font-bold text-slate-850 dark:text-slate-200 text-xs uppercase tracking-wider">
                                AI Intel Analysis & Case Briefing Assistant
                              </h4>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {ollamaEnabled 
                                  ? `Construct a comprehensive investigative brief offline using ${ollamaModel}.`
                                  : "Enable Ollama in Case Settings to unlock offline intelligence reports & executive briefs."
                                }
                              </p>
                            </div>
                          </div>

                          {ollamaEnabled && (
                            <button
                              onClick={handleGenerateOllamaBrief}
                              disabled={isGeneratingBrief}
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              {isGeneratingBrief ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  <span>Generating Intelligence Brief...</span>
                                </>
                              ) : (
                                <>
                                  <Sparkles className="h-3.5 w-3.5" />
                                  <span>{briefingText ? 'Regenerate Case Briefing' : 'Generate Case Briefing'}</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        {briefingError && (
                          <div className="p-3 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-400 text-xs rounded-lg border border-rose-100 dark:border-rose-900/40 font-semibold text-left">
                            ⚠️ {briefingError}
                          </div>
                        )}

                        {briefingText && (
                          <div className="space-y-2 animate-fadeIn text-left">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Generated Intel Briefing Document
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(briefingText);
                                    alert("Briefing copied to clipboard!");
                                  }}
                                  className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                >
                                  Copy Text
                                </button>
                                <span className="text-slate-300 dark:text-slate-800">|</span>
                                <button
                                  onClick={() => {
                                    const blob = new Blob([briefingText], { type: 'text/markdown' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `CASE_${(caseId || '2026').replace(/[^a-zA-Z0-9-_]/g, '_')}_Intelligence_Brief.md`;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                  }}
                                  className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                >
                                  Download Markdown (.md)
                                </button>
                                <span className="text-slate-300 dark:text-slate-800">|</span>
                                <button
                                  onClick={() => setBriefingText('')}
                                  className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>

                            <div className="p-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg text-xs leading-relaxed max-h-[300px] overflow-y-auto font-sans select-text shadow-inner">
                              <div className="whitespace-pre-wrap text-slate-750 dark:text-slate-300 text-left">
                                {briefingText}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Search & Filter Bar */}
                      <div className="relative max-w-md">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Search className="h-4 w-4 text-slate-400" />
                        </span>
                        <input
                          type="text"
                          placeholder="Filter exhibits by ID, sender, annotation or keyword..."
                          value={evidenceSearchQuery}
                          onChange={(e) => setEvidenceSearchQuery(e.target.value)}
                          className="w-full text-xs pl-9 pr-8 py-2.5 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-500 bg-slate-55 dark:bg-slate-950 dark:text-slate-200"
                        />
                        {evidenceSearchQuery && (
                          <button
                            onClick={() => setEvidenceSearchQuery('')}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {filteredExhibits.length === 0 ? (
                        <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                          <Search className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto mb-3 opacity-80" />
                          <p className="text-sm font-medium text-slate-400 dark:text-slate-500">No matching exhibits found.</p>
                          <p className="text-xs text-slate-300 dark:text-slate-650 mt-1 max-w-sm mx-auto font-medium">
                            Try adjusting your filter keyword or search query.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold uppercase text-[10px] text-slate-500 dark:text-slate-400">
                                <th className="py-2.5 px-3 w-[100px]">Exhibit ID</th>
                                <th className="py-2.5 px-3 w-[160px]">Timestamp (UTC)</th>
                                <th className="py-2.5 px-3 w-[120px]">Sender ➜ Recipient</th>
                                <th className="py-2.5 px-3">Content / Action Payload</th>
                                <th className="py-2.5 px-3 w-[250px]">Examiner annotations</th>
                                <th className="py-2.5 px-3 text-center w-[60px]">Remove</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                              {filteredExhibits.map((evt) => (
                                <tr key={`evh-${evt.id}`} className="hover:bg-slate-55 dark:hover:bg-slate-950/10">
                                  <td className="py-2.5 px-3 font-mono font-extrabold text-amber-600">{evt.exhibitIdStr}</td>
                                  <td className="py-2.5 px-3 font-mono font-medium text-slate-600 dark:text-slate-400">
                                    {isNaN(Date.parse(evt.timestamp)) ? 'Extraction Timestamp' : new Date(evt.timestamp).toISOString().replace('T', ' ').substring(0, 19)}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400 truncate max-w-[130px]" title={evt.sender}>
                                    {evt.sender} {evt.recipient ? `➜ ${evt.recipient}` : ''}
                                  </td>
                                  <td className="py-2.5 px-3 font-sans text-slate-800 dark:text-slate-250">
                                    <p className="leading-relaxed font-semibold">{evt.content}</p>
                                    {evt.mediaFile ? (
                                      <span className="inline-flex items-center space-x-1 mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded">
                                        <ImageIcon className="h-3 w-3" />
                                        <span>Attachment: {evt.mediaFile.name}</span>
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="py-2.5 px-3 bg-amber-50/10 dark:bg-amber-950/5">
                                    <textarea
                                      placeholder="Annotate evidentiary link details..."
                                      value={evt.notes}
                                      onChange={(e) => handleUpdateNotes(evt.id, e.target.value)}
                                      className="w-full text-xs font-sans p-1.5 border border-slate-200 dark:border-slate-850 focus:outline-hidden focus:ring-1 focus:ring-amber-500 rounded-md bg-white dark:bg-slate-950 dark:text-slate-250 resize-y"
                                      rows={2}
                                    />
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    <button
                                      onClick={() => handleToggleTag(evt.id)}
                                      className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-xs font-bold"
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'chats' && (
                <div id="tabview-conversation-flow" className="animate-fadeIn">
                  <ConversationErrorBoundary label="Conversation View">
                    <ConversationViewer
                      events={activeResult.events}
                      loadedFiles={loadedFiles}
                      activeProvider={activeProvider}
                      suspectAccountHint={
                        (activeAccountFilter && activeAccountFilter !== 'all' ? activeAccountFilter : undefined)
                        || activeResult?.accountInfo?.username
                        || activeResult?.accountInfo?.userId
                        || activeResult?.accountInfo?.displayName
                        || undefined
                      }
                      evidenceTags={evidenceTags}
                      onToggleTag={handleToggleTag}
                      onUpdateNotes={handleUpdateNotes}
                      vicHashes={vicHashes}
                      hashHits={hashHits}
                    />
                  </ConversationErrorBoundary>
                </div>
              )}

              {activeTab === 'workspace' && (
                <div id="tabview-workspace-files" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-left space-y-6 animate-fadeIn">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800/80">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm uppercase tracking-wider flex items-center">
                        <FolderOpen className="h-4.5 w-4.5 text-indigo-500 mr-2" />
                        Workspace Evidence Repository
                      </h3>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        Manage active digital exhibits, inspect raw content blocks, and upload additional search warrant returns.
                      </p>
                    </div>
                    <button
                      id="workspace-tab-reset-btn"
                      onClick={handleClearWorkspace}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 text-rose-700 dark:text-rose-450 border border-rose-200 dark:border-rose-900 text-xs font-bold rounded-lg transition-colors flex items-center"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Reset Workspace
                    </button>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Total Loaded Files</span>
                      <p className="text-xl font-black text-slate-800 dark:text-slate-200 mt-1">{loadedFiles.length}</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Cumulative Volume</span>
                      <p className="text-xl font-black text-slate-800 dark:text-slate-200 mt-1">
                        {(loadedFiles.reduce((acc, f) => acc + f.size, 0) / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Interactive Attachments</span>
                      <p className="text-xl font-black text-indigo-650 dark:text-indigo-400 mt-1">
                        {loadedFiles.filter(f => f.isMedia).length} media items
                      </p>
                    </div>
                  </div>

                  {/* Drag and Drop secondary target inside workspace tab */}
                  <div
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className="border-2 border-dashed border-indigo-200 dark:border-indigo-900 rounded-xl p-8 text-center bg-slate-50/50 dark:bg-slate-950/20 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/10 transition-colors cursor-pointer relative"
                  >
                    <input
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <Upload className="h-8 w-8 mx-auto text-indigo-400 dark:text-indigo-650 mb-2" />
                    <p className="text-xs font-bold text-indigo-900 dark:text-indigo-300">Drag & drop or click to ingest more files</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-550 mt-1">Support ZIP archives, JSON logs, HTML, or media attachments</p>
                  </div>

                  {/* Loaded Files Table */}
                  <div className="overflow-x-auto border border-slate-150 dark:border-slate-850 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950 text-slate-405 font-bold uppercase tracking-wider text-[10px] border-b border-slate-150 dark:border-slate-850">
                          <th className="p-3">File Asset Name</th>
                          <th className="p-3">Relative Import Path</th>
                          <th className="p-3">Size</th>
                          <th className="p-3">Assigned Warrant Provider</th>
                          <th className="p-3">Type Classification</th>
                          <th className="p-3 text-right">Administrative Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-850/60 font-medium">
                        {fileTableSlice.items.map(file => {
                          const isMedia = file.isMedia;
                          const extension = file.name.split('.').pop()?.toLowerCase();
                          let typeLabel = "JSON Forensic Record";
                          if (isMedia) {
                            typeLabel = file.mediaType === 'video' ? "Video Attachment" : "Image Attachment";
                          } else if (extension === 'csv') {
                            typeLabel = "CSV Spreadsheet";
                          } else if (extension === 'html' || extension === 'htm') {
                            typeLabel = "HTML Log Document";
                          } else if (extension === 'mbox') {
                            typeLabel = "MBOX Mailbox Archive";
                          } else if (extension === 'eml') {
                            typeLabel = "EML Email Message";
                          } else if (extension === 'txt') {
                            typeLabel = "Plain Text Record";
                          }

                          return (
                            <tr id={file.name === workspaceFocus || file.relativePath === workspaceFocus ? 'workspace-focus-row' : undefined} key={`${file.relativePath || ''}-${file.name}`} className={`hover:bg-slate-50/50 dark:hover:bg-slate-950/40 transition-colors ${file.name === workspaceFocus || file.relativePath === workspaceFocus ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''}`}>
                              <td className="p-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 flex items-center space-x-2">
                                {isMedia ? (
                                  <ImageIcon className="h-4 w-4 text-emerald-500 shrink-0" />
                                ) : (
                                  <FileText className="h-4 w-4 text-indigo-500 shrink-0" />
                                )}
                                <span className="truncate max-w-[240px] block" title={file.name}>{file.name}</span>
                              </td>
                              <td className="p-3 text-slate-400 dark:text-slate-505 font-mono text-[10px]">
                                {file.relativePath || file.name}
                              </td>
                              <td className="p-3 text-slate-500 font-sans">
                                {(file.size / 1024).toFixed(1)} KB
                              </td>
                              <td className="p-3">
                                <select
                                  value={file.provider || activeProvider}
                                  onChange={(e) => {
                                    const newProv = e.target.value as ProviderType;
                                    setLoadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, provider: newProv } : f));
                                  }}
                                  className="text-[11px] p-1 border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 cursor-pointer font-sans"
                                >
                                  {(Object.keys(providersInfo) as ProviderType[]).map((p) => (
                                    <option key={p} value={p}>
                                      {providersInfo[p].name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isMedia 
                                    ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' 
                                    : 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400'
                                }`}>
                                  {typeLabel}
                                </span>
                              </td>
                              <td className="p-3 text-right space-x-1.5">
                                {!isMedia && (
                                  <button
                                    onClick={() => { void handleInspectRaw(file); }}
                                    className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 hover:text-indigo-800 text-[10px] font-bold rounded transition-colors"
                                  >
                                    Inspect Raw
                                  </button>
                                )}
                                <button
                                  onClick={() => handleRemoveFile(file.name)}
                                  className="px-2 py-1 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 hover:text-rose-800 text-[10px] font-bold rounded transition-colors"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {loadedFiles.length > 0 && (
                    <MediaPager
                      noun="files"
                      showPageSize={false}
                      page={fileTableSlice.page}
                      pageCount={fileTableSlice.pageCount}
                      pageSize={fileTableSlice.pageSize}
                      total={fileTableSlice.total}
                      start={fileTableSlice.start}
                      end={fileTableSlice.end}
                      onPage={setFileTablePage}
                      onPageSize={() => { /* file table page size is fixed */ }}
                    />
                  )}
                </div>
              )}

              {activeTab === 'entity-discovery' && (
                <div id="tabview-entity-discovery" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-left space-y-6 animate-fadeIn">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800/80">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm uppercase tracking-wider flex items-center">
                        <Fingerprint className="h-4.5 w-4.5 text-indigo-500 mr-2" />
                        Cross-Provider Shared Identifier Discovery
                      </h3>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                        Deep forensic scanning maps shared identifier overlaps (IPs, phones, usernames) across warrant returns — accounts stay separate; these are link suggestions only.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold">
                      <span>Status:</span>
                      <span className="flex items-center text-emerald-600 dark:text-emerald-400 font-bold gap-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        Scanning Real-Time
                      </span>
                    </div>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-650 dark:text-indigo-400">
                        <Network className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Shared Identifier Overlaps</span>
                        <p className="text-lg font-black text-slate-800 dark:text-slate-200 mt-0.5">{discoveredEntities.length}</p>
                      </div>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-650 dark:text-emerald-400">
                        <Globe className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Shared IP Targets</span>
                        <p className="text-lg font-black text-slate-800 dark:text-slate-200 mt-0.5">
                          {discoveredEntities.filter(e => e.type === 'ip').length}
                        </p>
                      </div>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-pink-50 dark:bg-pink-950/40 text-pink-650 dark:text-pink-400">
                        <Phone className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Shared Phone Numbers</span>
                        <p className="text-lg font-black text-slate-800 dark:text-slate-200 mt-0.5">
                          {discoveredEntities.filter(e => e.type === 'phone').length}
                        </p>
                      </div>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-450">
                        <User className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Shared Usernames/Emails</span>
                        <p className="text-lg font-black text-slate-800 dark:text-slate-200 mt-0.5">
                          {discoveredEntities.filter(e => e.type === 'username').length}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col md:flex-row gap-3 items-center justify-between bg-slate-50 dark:bg-slate-950 p-3.5 border border-slate-150 dark:border-slate-850 rounded-xl">
                    <div className="flex flex-wrap gap-1.5 w-full md:w-auto">
                      {(['all', 'ip', 'phone', 'username'] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => setEntityTypeFilter(type)}
                          className={`px-3 py-1 text-xs font-bold rounded-lg transition-all border cursor-pointer ${
                            entityTypeFilter === type
                              ? 'bg-indigo-600 border-indigo-650 text-white shadow-xs'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-355 hover:bg-slate-50 dark:hover:bg-slate-850'
                          }`}
                        >
                          {type === 'all' && 'All Discovered'}
                          {type === 'ip' && 'IP Addresses'}
                          {type === 'phone' && 'Phone Numbers'}
                          {type === 'username' && 'Usernames & Emails'}
                        </button>
                      ))}
                    </div>
                    <div className="relative w-full md:w-80">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        value={entitySearchQuery}
                        onChange={(e) => setEntitySearchQuery(e.target.value)}
                        placeholder="Filter entities by value..."
                        className="w-full pl-9 pr-4 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:text-slate-200"
                      />
                    </div>
                  </div>

                  {/* Interactive matches listing */}
                  {discoveredEntities.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-950/10">
                      <Fingerprint className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto mb-2 animate-pulse" />
                      <h4 className="font-bold text-slate-700 dark:text-slate-355 text-sm">No Cross-Provider Matches Found Yet</h4>
                      <p className="text-xs text-slate-400 dark:text-slate-550 max-w-sm mx-auto mt-1 leading-normal">
                        Ingest warrant logs from multiple providers (e.g. upload a Discord chat CSV and a Snapchat registration profile) to automatically discover identical values.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {discoveredEntities
                        .filter(e => {
                          if (entityTypeFilter !== 'all' && e.type !== entityTypeFilter) return false;
                          if (entitySearchQuery) {
                            return e.value.toLowerCase().includes(entitySearchQuery.toLowerCase());
                          }
                          return true;
                        })
                        .map(entity => {
                          let typeColor = "bg-indigo-50 dark:bg-indigo-950/45 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50";
                          let typeIcon = <Globe className="h-3.5 w-3.5" />;
                          let typeName = "IP Address";
                          if (entity.type === 'phone') {
                            typeColor = "bg-pink-50 dark:bg-pink-950/45 text-pink-700 dark:text-pink-400 border border-pink-100 dark:border-pink-900/50";
                            typeIcon = <Phone className="h-3.5 w-3.5" />;
                            typeName = "Phone Number";
                          } else if (entity.type === 'username') {
                            typeColor = "bg-amber-50 dark:bg-amber-955 text-amber-700 dark:text-amber-450 border border-amber-100 dark:border-amber-900/50";
                            typeIcon = <User className="h-3.5 w-3.5" />;
                            typeName = "Username / Identity";
                          }

                          return (
                            <div key={entity.value + '-' + entity.type} className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:shadow-md transition-all bg-white dark:bg-slate-900 flex flex-col gap-4">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-850">
                                <div className="flex flex-wrap items-center gap-2.5">
                                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${typeColor}`}>
                                    {typeIcon}
                                    {typeName}
                                  </span>
                                  <span className="font-mono text-sm sm:text-base font-black tracking-tight text-slate-800 dark:text-slate-200 select-all">
                                    {entity.value}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(entity.value);
                                    }}
                                    className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-355 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                                    title="Copy Value to Clipboard"
                                  >
                                    Copy Value
                                  </button>
                                  <button
                                    onClick={() => {
                                      setTimelineSearchQuery(entity.value);
                                      setActiveTab('timeline');
                                    }}
                                    className="px-2.5 py-1.5 bg-indigo-650 hover:bg-indigo-600 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                                    title="Trace all timeline entries matching this value"
                                  >
                                    🔍 Jump to Chronology
                                  </button>
                                </div>
                              </div>

                              <div>
                                <h5 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2.5">Discovered overlap footprint:</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {entity.occurrences.map((occ, idx) => (
                                    <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-lg flex flex-col justify-between">
                                      <div>
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-400">{occ.provider}</span>
                                          <span className="text-[9px] font-mono text-slate-400 truncate max-w-[150px]">{occ.fileName}</span>
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed font-medium">
                                          {occ.detail}
                                        </p>
                                      </div>
                                      {occ.timestamp && (
                                        <div className="text-[9px] text-slate-400 font-mono mt-2 pt-1 border-t border-slate-100 dark:border-slate-900">
                                          Timestamp: {new Date(occ.timestamp).toLocaleString()}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* Reference Glossary and Law Enforcement Protocol Lookup */}
              {glossaryData.length > 0 && (
                <div id="forensic-glossary-section" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-left shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-100 dark:border-slate-800/80">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm uppercase tracking-wider flex items-center">
                        <HelpCircle className="h-4.5 w-4.5 text-indigo-505 dark:text-indigo-400 mr-2" />
                        {providersInfo[activeProvider].name} Glossary & Forensic Protocol Guide
                      </h3>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                        Interactive lookup mapped directly from raw law enforcement guidelines and database structures.
                      </p>
                    </div>

                    <div className="relative max-w-sm w-full shrink-0">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search glossary terms & safety parameters..."
                        value={glossarySearch}
                        onChange={(e) => setGlossarySearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-8"
                      />
                    </div>
                  </div>

                  {filteredGlossary.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 dark:text-slate-500 text-xs">
                      No matching glossary terms found for "{glossarySearch}"
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredGlossary.map((g) => {
                        const isExpanded = expandedGlossaryTerm === g.term;
                        return (
                          <div
                            key={g.term}
                            onClick={() => setExpandedGlossaryTerm(isExpanded ? null : g.term)}
                            className={`p-3 rounded-lg border transition-all cursor-pointer text-left select-none ${
                              isExpanded
                                ? 'bg-indigo-50/45 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-950/80 ring-1 ring-indigo-500/10'
                                : 'bg-slate-50/50 dark:bg-slate-950/30 border-slate-201 dark:border-slate-850 hover:bg-slate-50 dark:hover:bg-slate-950/50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <span className="inline-block px-1.5 py-0.5 text-[9px] font-extrabold tracking-wider bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-sm uppercase">
                                  {g.category}
                                </span>
                                <h4 className="font-bold text-xs text-slate-700 dark:text-slate-250 flex items-center">
                                  {g.term.includes("Isolation") ? (
                                    <ShieldAlert className="h-3.5 w-3.5 text-rose-500 mr-1.5 shrink-0" />
                                  ) : g.term.includes("Key") ? (
                                    <Key className="h-3.5 w-3.5 text-amber-500 mr-1.5 shrink-0" />
                                  ) : null}
                                  {g.term}
                                </h4>
                              </div>
                              <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90 text-indigo-500' : ''}`} />
                            </div>

                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-350 space-y-2 font-sans"
                              >
                                <p className="leading-relaxed">{g.description}</p>
                                {g.protocol && (
                                  <div className="p-2 rounded-md bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-slate-800/60 font-mono text-[10px] text-slate-600 dark:text-slate-450 leading-relaxed break-all">
                                    <strong className="text-slate-850 dark:text-slate-350 font-sans block text-[9px] font-bold uppercase tracking-wider mb-0.5">Operational Protocol:</strong>
                                    {g.protocol}
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

                </div>
              </div>
            )}
          </div>

        </main>
      </div>

      {/* 5.5. Raw File Preview Inspector Modal */}
      {previewFileContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl max-w-4xl w-full flex flex-col overflow-hidden text-left animate-fadeIn">
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center">
                  <FileText className="h-4.5 w-4.5 text-indigo-500 mr-2" />
                  Raw File Inspector: {previewFileContent.name}
                </h3>
                <p className="text-[10px] mt-0.5 text-slate-400 dark:text-slate-500 font-medium">
                  Showing first 8,000 characters of file content to preserve browser performance.
                </p>
              </div>
              <button
                onClick={() => setPreviewFileContent(null)}
                className="text-slate-400 hover:text-slate-705 dark:hover:text-slate-200 font-bold text-lg p-1"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 bg-slate-50 dark:bg-slate-950 flex-1 overflow-auto max-h-[500px]">
              <pre className="font-mono text-[11px] leading-relaxed text-slate-750 dark:text-slate-300 whitespace-pre-wrap bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 max-w-full overflow-x-auto select-text">
                {previewFileContent.content}
              </pre>
            </div>

            <div className="p-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/45 flex justify-between items-center">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                Asset Size: {(new Blob([previewFileContent.content]).size / 1024).toFixed(1)} KB shown
              </span>
              <button
                onClick={() => setPreviewFileContent(null)}
                className="px-4 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

                {/* 6. High-Fidelity Forensic PDF Report Preview Drawer */}
      {isReportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md print:hidden">
          <div className="bg-white text-slate-900 rounded-2xl w-full max-w-6xl max-h-[96vh] sm:max-h-[92vh] overflow-hidden shadow-2xl relative flex flex-col border border-slate-300 shadow-xl">
            {/* Modal Header Controls */}
            <div className="p-4 bg-slate-900 border-b border-slate-800 text-white flex items-center justify-between pl-6 pr-6 shrink-0 select-none">
              <div className="flex items-center space-x-2">
                <FileText className="h-5 w-5 text-amber-500 animate-pulse" />
                <span className="font-extrabold text-xs uppercase tracking-wider font-sans">
                  Report Preview Generator
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => { void handleExportHtmlReport(); }}
                  className="px-3.5 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 shadow-sm cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export HTML report</span>
                </button>
                <button
                  onClick={handleTriggerPrint}
                  className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 shadow-sm cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print / Save PDF</span>
                </button>
                <button
                  onClick={() => setIsReportOpen(false)}
                  className="text-slate-400 hover:text-white p-2 rounded-md hover:bg-slate-800 transition-all font-bold text-xs"
                >
                  Close Preview
                </button>
              </div>
            </div>

            {/* Modal Content - Two-column customizer & preview */}
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
              {/* Left Column: Customizer Control Deck */}
              <div className="w-full md:w-80 shrink-0 border-r border-slate-200 bg-slate-50 p-5 space-y-5 flex flex-col overflow-y-auto text-left select-none">
                <div>
                  <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center">
                    <SlidersHorizontal className="h-4 w-4 text-indigo-500 mr-2" />
                    Select Report Fields
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    The preview, Print/Save PDF, and the zip report are the same document. Blur is set here and is not remembered.
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block text-left">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Agency</span>
                    <input
                      type="text"
                      value={reportAgency}
                      onChange={(e) => setReportAgency(e.target.value)}
                      placeholder="Agency name"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                    />
                  </label>
                  <label className="block text-left">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Item number</span>
                    <input
                      type="text"
                      value={reportItemNumber}
                      onChange={(e) => setReportItemNumber(e.target.value)}
                      placeholder="Item number"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                    />
                  </label>
                  <label className="block text-left">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Time zone</span>
                    <select
                      value={reportTimeZone}
                      onChange={(e) => setReportTimeZone(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                    >
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York</option>
                      <option value="America/Chicago">America/Chicago</option>
                      <option value="America/Denver">America/Denver</option>
                      <option value="America/Los_Angeles">America/Los_Angeles</option>
                      <option value="Europe/London">Europe/London</option>
                    </select>
                  </label>
                  <label className="block text-left">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Notes</span>
                    <textarea
                      value={reportNotes}
                      onChange={(e) => setReportNotes(e.target.value)}
                      rows={2}
                      placeholder="Shown under the report header"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                    />
                  </label>
                  <label className="block text-left">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Agency logo</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) {
                          setReportLogo('');
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => setReportLogo(typeof reader.result === 'string' ? reader.result : '');
                        reader.readAsDataURL(file);
                      }}
                      className="mt-1 w-full text-[10px] text-slate-600"
                    />
                  </label>
                </div>

                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => {
                      const on = !(reportIncludeAccountMetadata && reportIncludeMessages && reportIncludeTimeline && reportIncludeMedia && reportIncludeLocations && reportIncludeEntityDiscovery && reportIncludeSources);
                      setReportIncludeAccountMetadata(on);
                      setReportIncludeMessages(on);
                      setReportIncludeTimeline(on);
                      setReportIncludeMedia(on);
                      setReportIncludeLocations(on);
                      setReportIncludeEntityDiscovery(on);
                      setReportIncludeSources(on);
                    }}
                    className="w-full py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-indigo-50"
                  >
                    {(reportIncludeAccountMetadata && reportIncludeMessages && reportIncludeTimeline && reportIncludeMedia && reportIncludeLocations && reportIncludeEntityDiscovery && reportIncludeSources) ? 'Select none' : 'Select all'}
                  </button>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50/10 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={reportIncludeCaseMetadata}
                      onChange={(e) => setReportIncludeCaseMetadata(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Case Identifiers</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Include Case Code, Assigned Examiner, and Subject.</span>
                    </div>
                  </label>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50/10 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={reportIncludeAccountMetadata}
                      onChange={(e) => setReportIncludeAccountMetadata(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Account info</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Include profile credentials, emails, and phone indices.</span>
                    </div>
                  </label>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50/10 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={reportIncludeMessages}
                      onChange={(e) => setReportIncludeMessages(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Messages</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Conversation records. Unchecked sections are left out of the file, the summary, and print.</span>
                    </div>
                  </label>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50/10 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={reportIncludeTimeline}
                      onChange={(e) => setReportIncludeTimeline(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Timeline</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Logins, calls, files, profiles, and other records.</span>
                    </div>
                  </label>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50/10 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={reportIncludeMedia}
                      onChange={(e) => setReportIncludeMedia(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Media</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Images and videos. Included media is saved beside the report unless you embed it.</span>
                    </div>
                  </label>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50/10 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={reportIncludeLocations}
                      onChange={(e) => setReportIncludeLocations(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Locations</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Coordinate plot and list. Tagged only keeps tagged points.</span>
                    </div>
                  </label>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50/10 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={reportIncludeEntityDiscovery}
                      onChange={(e) => setReportIncludeEntityDiscovery(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Entity overlaps</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {discoveredEntities.length === 0
                          ? 'No overlapping cross-provider overlaps discovered.'
                          : `Include ${discoveredEntities.length} shared-identifier link suggestions.`}
                      </span>
                    </div>
                  </label>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50/10 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={reportIncludeSources}
                      onChange={(e) => setReportIncludeSources(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Sources</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Source-file table.</span>
                    </div>
                  </label>
                  <div className="p-3 bg-slate-50/65 border border-slate-200 rounded-xl space-y-2.5">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Tagged scope</span>
                    <label className="flex items-start space-x-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="timeline_scope"
                        checked={reportTimelineOnlyTagged}
                        onChange={() => setReportTimelineOnlyTagged(true)}
                        className="mt-0.5 h-3.5 w-3.5 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                      />
                      <div>
                        <span className="font-semibold text-slate-700 text-xs block">Exhibits only ({unifiedExhibits.length})</span>
                        <span className="text-[10px] text-slate-400 block leading-tight">Messages, media, and the location plot list only tagged items.</span>
                      </div>
                    </label>
                    <label className="flex items-start space-x-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="timeline_scope"
                        checked={!reportTimelineOnlyTagged}
                        onChange={() => setReportTimelineOnlyTagged(false)}
                        className="mt-0.5 h-3.5 w-3.5 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                      />
                      <div>
                        <span className="font-semibold text-slate-700 text-xs block">Full report ({parsedResult?.events?.length || 0} events)</span>
                        <span className="text-[10px] text-slate-400 block leading-tight">Include untagged events, media, and locations.</span>
                      </div>
                    </label>
                  </div>
                  <label className="flex items-start space-x-3 p-3 bg-white border border-amber-200 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reportEmbedMedia}
                      onChange={(e) => setReportEmbedMedia(e.target.checked)}
                      disabled={!reportIncludeMedia}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer disabled:opacity-45"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Embed media as base64</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">One HTML file instead of a zip. Base64 is about a third larger, and a big video can make the file hard to open.</span>
                    </div>
                  </label>

                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reportBlurImages}
                      onChange={(e) => setReportBlurImages(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Blur images</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">On by default. This choice is baked into the file and is not remembered.</span>
                    </div>
                  </label>

                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reportRedactIp}
                      onChange={(e) => setReportRedactIp(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Redact IP addresses</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Hide the last two octets of IPv4 addresses.</span>
                    </div>
                  </label>

                  <label className="flex items-start space-x-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reportRedactPii}
                      onChange={(e) => setReportRedactPii(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-xs block">Redact email and phone</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Mask addresses and phone numbers in the report text.</span>
                    </div>
                  </label>
                </div>

                <div className="pt-4 border-t border-slate-200 flex-1 flex flex-col justify-end text-[10px] text-slate-400 leading-normal">
                  <p className="flex items-center gap-1 font-semibold text-slate-500 mb-1">
                    <Printer className="h-3.5 w-3.5 text-slate-400" />
                    Print / PDF Guide:
                  </p>
                  <span className="mb-4 block">Checking "Background Graphics" in browser print layouts ensures visual markers, highlighted tags, and media items are rendered beautifully.</span>

                  <div className="space-y-2 pt-3 border-t border-slate-200 select-none">
                    <button
                      onClick={() => { void handleExportHtmlReport(); }}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-md cursor-pointer"
                    >
                      <Download className="h-4 w-4" />
                      <span>Export HTML report</span>
                    </button>
                    <button
                      onClick={handleTriggerPrint}
                      className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-md cursor-pointer"
                    >
                      <Printer className="h-4 w-4" />
                      <span>Print / Save PDF Report</span>
                    </button>
                    <button
                      onClick={() => setIsReportOpen(false)}
                      className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <span>Close Preview Window</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: the same report document Print and the zip export use */}
              <div className="flex-1 bg-stone-100 min-h-0">
                <iframe
                  title="Case report preview"
                  className="w-full h-full min-h-[70vh] bg-white border-0"
                  srcDoc={isReportOpen ? buildCurrentReport(true).html : ''}
                />
              </div>
            </div>

            {/* Footer informational context */}
            <div className="p-4 bg-slate-100 border-t border-slate-200 text-slate-500 text-xs flex justify-between items-center pl-6 pr-6 shrink-0">
              <span>Examiner Client Local Database Sync</span>
              <span className="font-mono text-[9px]">Case UUID: {caseId ? `CASE_${caseId}` : 'NONE'}</span>
            </div>
          </div>
        </div>
      )}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center print:hidden p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl max-w-3xl w-full shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 flex justify-between items-center">
              <h2 className="font-bold text-slate-800 dark:text-slate-200 text-lg flex items-center gap-2">
                <Settings className="h-5 w-5 text-indigo-500" />
                Settings
              </h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                &times;
              </button>
            </div>
            
            <div className="p-6 space-y-6 flex-1 overflow-y-auto text-left text-slate-800 dark:text-slate-200">
              <div>
                <h3 className="font-bold text-slate-850 dark:text-slate-100 text-sm mb-2">API Keys</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  API keys are stored locally in your browser and are never sent to any server.
                </p>
                <div>
                  <label htmlFor="ipinfo-key" className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    IPinfo.io API Key
                  </label>
                  <input
                    id="ipinfo-key"
                    type="password"
                    value={ipInfoKey}
                    onChange={(e) => {
                      setIpInfoKey(e.target.value);
                      localStorage.setItem('ipinfo_api_key', e.target.value);
                    }}
                    className="w-full text-sm font-mono p-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-10"
                    placeholder="Enter your IPinfo.io API key"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-850 dark:text-slate-100 text-sm">Ollama Offline Translation</h4>
                      <p className="text-[10px] text-slate-550">Auto-translate foreign text (Spanish, French, etc.) locally using your own Ollama LLM.</p>
                    </div>
                    <input
                      id="ollama-enabled-toggle"
                      type="checkbox"
                      checked={ollamaEnabled}
                      onChange={(e) => setOllamaEnabled(e.target.checked)}
                      className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded cursor-pointer"
                    />
                  </div>
                </div>

                {ollamaEnabled && (
                  <div className="space-y-3 pl-4 border-l-2 border-indigo-200 dark:border-indigo-900 animate-slideDown">
                    <div>
                      <label htmlFor="ollama-url" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                        Ollama API Server Address
                      </label>
                      <input
                        id="ollama-url"
                        type="text"
                        value={ollamaUrl}
                        onChange={(e) => setOllamaUrl(e.target.value)}
                        className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-9"
                        placeholder="http://localhost:11434"
                      />
                    </div>

                    <div>
                      <label htmlFor="ollama-model" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                        Translation Model
                      </label>
                      <input
                        id="ollama-model"
                        type="text"
                        value={ollamaModel}
                        onChange={(e) => setOllamaModel(e.target.value)}
                        className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 h-9"
                        placeholder="llama3, gemma2, mistral"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div>
                        <label htmlFor="ollama-auto-translate" className="text-xs font-bold text-slate-700 dark:text-slate-300 block cursor-pointer">
                          Auto-Translate Logs
                        </label>
                        <span className="text-[9px] text-slate-400 dark:text-slate-500">
                          Automatically translate non-English logs in the background when loaded.
                        </span>
                      </div>
                      <input
                        id="ollama-auto-translate"
                        type="checkbox"
                        checked={ollamaAutoTranslate}
                        onChange={(e) => setOllamaAutoTranslate(e.target.checked)}
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <h3 className="font-bold text-slate-850 dark:text-slate-100 text-sm mb-2">Interactive UI Features</h3>
                <div className="flex items-center justify-between">
                  <div className="pr-4 text-left">
                    <label htmlFor="hover-definitions-toggle" className="text-xs font-bold text-slate-700 dark:text-slate-300 block cursor-pointer">
                      Hover Category Definitions
                    </label>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      Show definitions of forensic classes when hovering over timeline categories.
                    </span>
                  </div>
                  <input
                    id="hover-definitions-toggle"
                    type="checkbox"
                    checked={showCategoryDefinitions}
                    onChange={(e) => setShowCategoryDefinitions(e.target.checked)}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded cursor-pointer"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-left space-y-3">
                <div>
                  <h4 className="font-bold text-slate-850 dark:text-slate-100 text-sm flex items-center gap-1.5">
                    <ShieldAlert className="h-4.5 w-4.5 text-rose-500 shrink-0" />
                    <span>Project VIC Hash Database</span>
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-normal">
                    Import a Project VIC list (.json, .csv, or .txt). MD5, SHA-1, and SHA-256 are recognized by length and matched against those hashes on each media file. Hashes are saved in this program's database and apply to every case.
                  </p>
                </div>
                {isImportingVic ? (
                  <div className="w-full space-y-2 pt-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-indigo-600 dark:text-indigo-455 flex items-center gap-1.5 animate-pulse">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>{vicImportStatus}</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-200/50 dark:border-slate-750">
                      <div 
                        className="bg-indigo-650 h-full rounded-full transition-all duration-300 animate-pulse"
                        style={{ width: `${vicTotalToImport > 0 ? Math.min(100, Math.round((vicImportedCount / vicTotalToImport) * 100)) : 0}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <label className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 text-slate-705 dark:text-slate-355 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs">
                      <UploadCloud className="h-4 w-4 text-slate-400" />
                      <span>Import VIC Hashes</span>
                      <input
                        type="file"
                        accept=".csv,.txt,.json"
                        className="hidden"
                        onChange={handleImportVICHashes}
                      />
                    </label>
                    
                    {vicHashes.size > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-2 py-1 rounded">
                          {vicHashes.size.toLocaleString()} hashes active
                        </span>
                        <button
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to clear all ${vicHashes.size} imported forensic hashes permanently from the database?`)) {
                              fetch("/api/forensic-hashes", { method: "DELETE" })
                                .then(() => {
                                  setVicHashes(new Set());
                                  showCaseMsg("Successfully cleared all forensic hashes permanently.", "success");
                                })
                                .catch(err => {
                                  console.error("Failed to clear forensic hashes:", err);
                                  setVicHashes(new Set());
                                });
                            }
                          }}
                          className="px-2 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-955/20 dark:hover:bg-rose-905 text-rose-600 dark:text-rose-455 border border-rose-200 dark:border-rose-900/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        >
                          Clear Hashes
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">No hashes imported</span>
                    )}
                  </div>
                )}
                {vicImportSummary && !isImportingVic && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{vicImportSummary}</p>
                )}
              </div>
              <HashSetManager
                sets={hashSets}
                busy={false}
                status={hashSetStatus}
                onRefresh={() => { void refreshHashSets(); }}
                onStatus={setHashSetStatus}
              />
              <HashMatchReport
                inventory={hashInventory}
                report={mediaDigestReport(loadedFiles, vicHashes, hashHits)}
                audit={hashAuditResult}
              />
            </div>

            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold shadow-xs transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {isInstructionsOpen && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center print:hidden p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl max-w-2xl w-full shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 flex justify-between items-center shrink-0">
              <h2 className="font-bold text-slate-800 dark:text-slate-200 text-lg flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-indigo-500" />
                Evidence Processing & Ingestion Instructions
              </h2>
              <button
                onClick={() => setIsInstructionsOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl font-bold transition-colors cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Inner navigation tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 shrink-0">
              <button
                onClick={() => setActiveInstructionTab('walkthrough')}
                className={`flex-1 py-3 px-4 text-xs font-bold text-center border-b-2 transition-colors cursor-pointer ${
                  activeInstructionTab === 'walkthrough'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                1. Walkthrough & Quick Start
              </button>
              <button
                onClick={() => setActiveInstructionTab('troubleshooting')}
                className={`flex-1 py-3 px-4 text-xs font-bold text-center border-b-2 transition-colors cursor-pointer ${
                  activeInstructionTab === 'troubleshooting'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                2. Data Prep & Troubleshooting
              </button>
              <button
                onClick={() => setActiveInstructionTab('zip_ingestion')}
                className={`flex-1 py-3 px-4 text-xs font-bold text-center border-b-2 transition-colors cursor-pointer ${
                  activeInstructionTab === 'zip_ingestion'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                3. Direct ZIP Ingestion
              </button>
            </div>

            {/* Content area */}
            <div className="p-6 space-y-6 flex-1 overflow-y-auto text-left text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {activeInstructionTab === 'walkthrough' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">How to Use the Warrant Return Parser</h3>
                  <p>
                    This utility acts as a specialized offline evidence viewer. You can ingest, parse, and analyze digital evidence returns from various social networks and messaging applications securely right inside your web browser.
                  </p>
                  
                  <div className="space-y-3 mt-2">
                    <div className="flex gap-3">
                      <div className="flex-none w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center font-bold text-xs mt-0.5">
                        1
                      </div>
                      <div>
                        <strong className="text-slate-800 dark:text-slate-100 block">Select Your Active Platform</strong>
                        <span>Click on one of the provider logs at the top of the Case Workspace (e.g. Discord, Snapchat, Kik, MEGA, Google, or X/Twitter). The parser customizes its expectations based on the platform you select.</span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-none w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center font-bold text-xs mt-0.5">
                        2
                      </div>
                      <div>
                        <strong className="text-slate-800 dark:text-slate-100 block">Ingest or Upload Files</strong>
                        <span>Drag and drop your logs, click <strong>Pick Local Files</strong> to select multiple files, or use <strong>Import Folder / Directory</strong>. Alternatively, you can drop a <strong>ZIP archive (.zip)</strong> directly!</span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-none w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center font-bold text-xs mt-0.5">
                        3
                      </div>
                      <div>
                        <strong className="text-slate-800 dark:text-slate-100 block">Review Parsed Metrics & Timelines</strong>
                        <span>Once parsed, you can examine general metrics under the <strong>Dashboard Stats</strong>, read messages chronologically in the <strong>Chat Threads</strong> explorer, search keywords, or map connection locations on the interactive map.</span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-none w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center font-bold text-xs mt-0.5">
                        4
                      </div>
                      <div>
                        <strong className="text-slate-800 dark:text-slate-100 block">Generate Reports & Print</strong>
                        <span>Flag key events as exhibit tags, then click the export or print buttons to save a standardized offline report ready for evidence dossiers.</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeInstructionTab === 'troubleshooting' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Troubleshooting Ingestion & Preparing Your Data</h3>
                  <p>
                    If your data does not load or you see an empty timeline/error message, it is usually because the file names or formatting do not match the expected structures. Here is how to fix them:
                  </p>

                  <div className="space-y-4 mt-2">
                    <div className="border-l-2 border-indigo-500 pl-4 py-1">
                      <h4 className="font-bold text-slate-800 dark:text-slate-150 text-sm">File Naming Strategy</h4>
                      <p className="text-xs mt-1">
                        The engine identifies which type of database structure to parse by reading the file name. Refer to the expected format names below:
                      </p>
                      <ul className="list-disc list-inside text-xs mt-2 space-y-1 text-slate-500 dark:text-slate-400">
                        <li><strong>Discord</strong>: Look for files named <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">user.json</code>, <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">messages.csv</code>, or <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">ip_history.csv</code>.</li>
                        <li><strong>Snapchat</strong>: Look for files named <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">chat_history.json</code>, <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">user_profile.json</code>, or <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">ip_history.json</code>.</li>
                        <li><strong>Kik Messenger</strong>: Make sure files contain <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">messages.csv</code> or <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">kik_messages.csv</code>.</li>
                        <li><strong>X/Twitter</strong>: Expects standard export file names containing <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">account.json</code>, <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">direct-messages.json</code>, or <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">tweets.json</code>.</li>
                      </ul>
                    </div>

                    <div className="border-l-2 border-indigo-500 pl-4 py-1">
                      <h4 className="font-bold text-slate-800 dark:text-slate-150 text-sm">How to Structure Custom/Manual Logs</h4>
                      <p className="text-xs mt-1">
                        If you have messages in a custom format, you can easily format them as a standard CSV and ingest them under <strong>Discord</strong> or <strong>Kik Messenger</strong> by naming the file <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">messages.csv</code> with these column headers:
                      </p>
                      <pre className="bg-slate-100 dark:bg-slate-950 p-2 font-mono text-[10px] rounded mt-2 block overflow-x-auto text-slate-700 dark:text-slate-400">
                        timestamp, author_username, content, recipient
                      </pre>
                      <p className="text-xs mt-1 text-slate-500">
                        Alternatively, use column headers: <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">Date, Sender, Message, Receiver</code>.
                      </p>
                    </div>

                    <div className="border-l-2 border-indigo-500 pl-4 py-1">
                      <h4 className="font-bold text-slate-800 dark:text-slate-150 text-sm">Ensuring JSON Formats are Clean</h4>
                      <p className="text-xs mt-1">
                        If you are copying raw data or pasting text, verify that brackets <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">[ ]</code> and curly braces <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">&#123; &#125;</code> are balanced and there are no stray trailing commas. Our parser automatically cleans common JavaScript prefixes (like <code className="bg-slate-100 dark:bg-slate-950 p-0.5 font-mono text-[11px] rounded">window.YTD.tweet.part0 =</code>) from Twitter files.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeInstructionTab === 'zip_ingestion' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Direct ZIP Archive Ingestion (.zip)</h3>
                  <p>
                    Our workbench includes a high-performance in-browser unzipper. You can drop a `.zip` archive containing your warrant returns directly into the system instead of manual file extraction.
                  </p>

                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 p-4 rounded-xl text-xs space-y-2 mt-2">
                    <h4 className="font-bold text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4" /> Browser Memory Limit Advice
                    </h4>
                    <p className="text-amber-700 dark:text-amber-300 leading-normal">
                      ZIP extraction runs entirely client-side inside your browser sandbox to ensure <strong>total privacy</strong>—your raw forensic files never touch our servers.
                    </p>
                    <p className="text-amber-700 dark:text-amber-300 leading-normal">
                      However, because browser tabs are allocated limited memory, attempting to extract files larger than <strong>100 MB</strong> can cause performance lag or memory crashes.
                    </p>
                    <p className="text-amber-700 dark:text-amber-300 leading-normal font-bold">
                      💡 Best Practice: For returns larger than 100 MB, we highly recommend unzipping the files on your local machine first, then clicking "Import Folder / Directory" to load them instantly without using extra browser memory!
                    </p>
                  </div>

                  <div className="border-l-2 border-indigo-500 pl-4 py-1 mt-4">
                    <h4 className="font-bold text-slate-800 dark:text-slate-150 text-sm">Media Recognition</h4>
                    <p className="text-xs mt-1">
                      During ZIP ingestion, image files (JPEG, PNG, GIF) and video files (MP4, MOV, WEBM) are automatically identified, read, and saved locally as interactive attachments for timeline viewing.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 flex justify-end shrink-0">
              <button
                onClick={() => setIsInstructionsOpen(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold shadow-xs transition-colors cursor-pointer"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portable Case Generator Modal */}
      <PortableCaseModal
        isOpen={isPortableModalOpen}
        onClose={() => setIsPortableModalOpen(false)}
        caseId={caseId}
        investigatorName={investigatorName}
        suspectName={suspectName}
        provider={activeProvider}
        providerName={providersInfo[activeProvider]?.name || activeProvider}
        parsedResult={parsedResult}
        loadedFiles={loadedFiles}
        evidenceTags={evidenceTags}
        briefingText={briefingText}
        caseDbId={currentCaseDbId}
        onBeforeExport={() => saveCurrentCase({ silent: true })}
      />

      {/* Export DB Options Modal */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowExportModal(false); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />

          {/* Dialog */}
          <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Download className="h-4 w-4 text-emerald-500" />
                  Export Case Database
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Choose how media attachments should be handled in the exported portable SQLite file.
                </p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer p-1 -mr-1 -mt-1 rounded-lg"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Options */}
            <div className="space-y-2">
              {([
                {
                  value: 'all' as const,
                  label: 'All Media Included',
                  desc: 'Export every file — text data, images, and videos. Largest file size.',
                  icon: '🗂️',
                  color: 'indigo'
                },
                {
                  value: 'tagged' as const,
                  label: 'Tagged Media Only',
                  desc: 'Include only media files you have flagged as evidence exhibits. Excludes untagged attachments.',
                  icon: '🏷️',
                  color: 'emerald'
                },
                {
                  value: 'none' as const,
                  label: 'No Media (Text / Data Only)',
                  desc: 'Strip all images and videos. Only CSV, JSON, and text data files are exported. Smallest file size.',
                  icon: '📄',
                  color: 'amber'
                }
              ] as const).map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-150 ${
                    exportMediaOption === opt.value
                      ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="exportMediaOption"
                    value={opt.value}
                    checked={exportMediaOption === opt.value}
                    onChange={() => setExportMediaOption(opt.value)}
                    className="mt-0.5 accent-indigo-600 cursor-pointer"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => exportCaseWithOption(currentCaseDbId, exportMediaOption)}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Download Export
              </button>
            </div>
          </div>
        </div>
      )}

      {diagnosticsOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/70">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl p-5 text-left">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black tracking-wide uppercase">Diagnostics</h2>
                <p className="text-xs text-slate-400 mt-1">Errors in the installed app are written to a local log. Ctrl+Shift+I opens developer tools from the Help menu.</p>
              </div>
              <button
                type="button"
                onClick={() => setDiagnosticsOpen(false)}
                className="text-slate-400 hover:text-white px-2 py-1 rounded-lg bg-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2 text-xs">
              <p><span className="text-slate-500">Log file: </span><span className="font-mono break-all">{diagnosticsInfo?.logPath || 'uwrp-errors.log (next to the case database)'}</span></p>
              <p><span className="text-slate-500">Folder: </span><span className="font-mono break-all">{diagnosticsInfo?.logFolder || 'Same folder as database.sqlite'}</span></p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.forensicDesktop?.openLogFolder?.()}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold cursor-pointer"
              >
                Open log folder
              </button>
              <button
                type="button"
                onClick={() => window.forensicDesktop?.toggleDevTools?.()}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold cursor-pointer"
              >
                Toggle developer tools
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.forensicDesktop?.reloadWindow) window.forensicDesktop.reloadWindow();
                  else window.location.reload();
                }}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold cursor-pointer"
              >
                Reload window
              </button>
            </div>
            <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
              In the packaged app, use Help → Open Log Folder and Help → Toggle Developer Tools. The menu stays visible so those commands work when the page is blank. If the window stops, the app shows a reload screen instead of a white window.
            </p>
          </div>
        </div>
      )}
      <BusyOverlay busy={busy} />
    </div>
  );
}
