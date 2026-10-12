import React, { useEffect, useRef, useState } from 'react';
import { ProviderType, ParseResult, UploadedFile } from '../types';
import { reportClientError } from '../lib/clientLog';
import {
  Package,
  ShieldAlert,
  CheckSquare,
  Square,
  Lock,
  Download,
  FileArchive,
  Info,
  X,
  Eye,
  EyeOff,
  UserCheck,
  MessageSquare,
  Network,
  MapPin,
  FileText,
  Tag,
  Key,
  ShieldCheck,
  Sparkles
} from 'lucide-react';

interface PortableCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseId: string;
  investigatorName: string;
  suspectName: string;
  provider: ProviderType;
  providerName: string;
  parsedResult: ParseResult | null;
  loadedFiles: UploadedFile[];
  evidenceTags: Record<string, { tagged: boolean; notes?: string }>;
  briefingText?: string;
  caseDbId?: string;
  onBeforeExport?: () => Promise<void>;
}

export const PortableCaseModal: React.FC<PortableCaseModalProps> = ({
  isOpen,
  onClose,
  caseId,
  investigatorName,
  suspectName,
  provider,
  providerName,
  parsedResult,
  loadedFiles,
  evidenceTags,
  briefingText,
  caseDbId,
  onBeforeExport
}) => {
  // State options
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeBriefing, setIncludeBriefing] = useState(true);
  const [includeEvidenceTags, setIncludeEvidenceTags] = useState(true);
  const [onlyTaggedExhibits, setOnlyTaggedExhibits] = useState(false);

  // Evidence Streams
  const [includeAccountInfo, setIncludeAccountInfo] = useState(true);
  const [includeMessages, setIncludeMessages] = useState(true);
  const [includeIpAudit, setIncludeIpAudit] = useState(true);
  const [includeGeoMap, setIncludeGeoMap] = useState(true);
  const [includeFiles, setIncludeFiles] = useState(true);
  const [includeAccountChanges, setIncludeAccountChanges] = useState(true);

  // Redaction
  const [redactIpAddresses, setRedactIpAddresses] = useState(false);
  const [redactPii, setRedactPii] = useState(false);

  // Passcode
  const [enablePasscode, setEnablePasscode] = useState(false);
  const [passcode, setPasscode] = useState('1234');
  const [showPasscodeText, setShowPasscodeText] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; filesDone: number; filesTotal: number; currentFile: string } | null>(null);
  const [exportError, setExportError] = useState('');
  const [savedPath, setSavedPath] = useState('');
  const [manualPath, setManualPath] = useState('');
  const jobRef = useRef('');
  const cancelRequested = useRef(false);

  useEffect(() => {
    return () => {
      if (jobRef.current) {
        void fetch(`/api/portable-case/${jobRef.current}/cancel`, { method: 'POST' }).catch(() => {});
      }
    };
  }, []);

  if (!isOpen) return null;

  const totalEvents = parsedResult?.events?.length || 0;
  const taggedCount = Object.values(evidenceTags).filter((t: { tagged: boolean; notes?: string }) => t.tagged).length;
  const messagesCount = parsedResult?.events?.filter(e => e.category === 'message').length || 0;
  const connectionsCount = parsedResult?.events?.filter(e => e.category === 'connection').length || 0;

  const handleCancelExport = async () => {
    cancelRequested.current = true;
    const id = jobRef.current;
    if (!id) {
      setIsGenerating(false);
      return;
    }
    try {
      await fetch(`/api/portable-case/${id}/cancel`, { method: 'POST' });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      reportClientError('Could not cancel portable export', error.stack || error.message, 'renderer');
    }
  };

  const handleGenerate = async () => {
    setExportError('');
    setSavedPath('');
    setProgress(null);
    cancelRequested.current = false;
    setIsGenerating(true);
    try {
      if (!caseDbId) throw new Error('Open a case before building a portable package.');
      if (onBeforeExport) await onBeforeExport();
      const filename = `Case_${caseId || 'Evidence'}_Portable_Viewer_${new Date().toISOString().slice(0, 10)}.zip`;
      let destPath = '';
      if (window.forensicDesktop?.pickSaveZip) {
        destPath = await window.forensicDesktop.pickSaveZip(filename);
        if (!destPath) {
          setIsGenerating(false);
          return;
        }
      } else {
        destPath = manualPath.trim();
        if (!destPath) throw new Error('Enter a full path for the zip file, including the .zip name.');
      }

      const start = await fetch('/api/portable-case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseDbId,
          destPath,
          caseId,
          investigatorName,
          suspectName,
          provider,
          providerName,
          briefingText,
          includeMetadata,
          includeBriefing,
          includeEvidenceTags,
          onlyTaggedExhibits,
          includeAccountInfo,
          includeMessages,
          includeIpAudit,
          includeGeoMap,
          includeFiles,
          includeAccountChanges,
          redactIpAddresses,
          redactPii,
          passcode: enablePasscode ? passcode : '',
          evidenceTags,
        }),
      });
      const started = await start.json().catch(() => ({}));
      if (!start.ok) throw new Error(started.error || 'The portable case could not be started.');
      jobRef.current = String(started.id || '');
      if (!jobRef.current) throw new Error('The portable case did not return a job id.');

      for (;;) {
        if (cancelRequested.current) break;
        await new Promise(resolve => window.setTimeout(resolve, 400));
        const statusRes = await fetch(`/api/portable-case/${jobRef.current}`);
        const status = await statusRes.json().catch(() => ({}));
        if (!statusRes.ok) throw new Error(status.error || 'Lost contact with the portable export.');
        setProgress({
          phase: status.phase || 'Working',
          filesDone: status.filesDone || 0,
          filesTotal: status.filesTotal || 0,
          currentFile: status.currentFile || '',
        });
        if (status.cancelled) {
          setExportError('Export cancelled. The partial file was deleted.');
          break;
        }
        if (status.error) throw new Error(status.error);
        if (status.done) {
          setSavedPath(status.destPath || destPath);
          break;
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const message = error.message || 'The portable case could not be saved.';
      setExportError(message);
      reportClientError(message, error.stack || message, 'renderer');
    } finally {
      jobRef.current = '';
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600/30 border border-indigo-500/50 rounded-xl text-indigo-400">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-tight flex items-center gap-2">
                Package Portable Law Enforcement Case
                <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">
                  Offline Interactive Bundle
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Bundle warrant evidence into an air-gapped, standalone HTML viewer to share with officers or prosecutors.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-left font-sans">
          
          {/* Active Return Type Banner */}
          <div className="bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                  Target Return Platform:
                </span>
                <span className="font-extrabold text-xs text-indigo-900 dark:text-indigo-200 bg-white dark:bg-slate-900 px-2.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 font-mono">
                  {providerName} ({provider.toUpperCase()})
                </span>
                <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" /> Multi-GB Return Stream Ready
                </span>
              </div>
              <p className="text-xs text-indigo-800/80 dark:text-indigo-300/80">
                Available dataset: <strong>{totalEvents}</strong> forensic events, <strong>{taggedCount}</strong> tagged exhibits, <strong>{loadedFiles.length}</strong> loaded files.
              </p>
            </div>
            <div className="text-right text-[11px] text-slate-500 font-mono">
              Case ID: <span className="font-bold text-slate-800 dark:text-slate-200">{caseId || 'Unspecified'}</span>
            </div>
          </div>

          {/* Large Return Handling Info Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <Info className="h-4 w-4 text-cyan-400 shrink-0" />
              <span>Multi-Gigabyte Return Processing (e.g., 15 GB Returns)</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              When working with large law enforcement returns (10 GB – 100 GB+):
            </p>
            <ul className="list-disc pl-4 text-slate-400 space-y-1">
              <li><strong>Memory Safety:</strong> Structured event logs (messages, IP connects, subscriber details) are indexed into lightweight JSON, while 15 GB raw video/image blobs remain referenced on disk to bypass browser RAM limits.</li>
              <li><strong>Paginated media browser:</strong> The unzipped viewer uses the same media vault as this app: search, type tabs, exhibit tags, inspect view, and 25/50/100/250/500 per page above and below the grid.</li>
              <li><strong>Streamed copy:</strong> Media is copied one file at a time into the zip. The original evidence files are not modified, and the page does not hold the whole archive in memory.</li>
              <li><strong>Air-Gapped Portability:</strong> Generates a single standalone, zero-dependency HTML file or ZIP archive that opens in any browser offline.</li>
            </ul>
          </div>

          {/* Section 1: Investigative Context & Scope */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <UserCheck className="h-4 w-4 text-indigo-500" />
              1. Investigative Context &amp; Exhibit Scope
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-850/50 transition-colors">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Include Case Metadata</span>
                  <span className="text-slate-400">Case ID, Agent ({investigatorName || 'N/A'}), Suspect ({suspectName || 'N/A'})</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-850/50 transition-colors">
                <input
                  type="checkbox"
                  checked={includeBriefing}
                  onChange={(e) => setIncludeBriefing(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Include AI Case Briefing Summary</span>
                  <span className="text-slate-400">Embed executive briefing text if generated</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-850/50 transition-colors">
                <input
                  type="checkbox"
                  checked={includeEvidenceTags}
                  onChange={(e) => setIncludeEvidenceTags(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Include Tagged Exhibit Notes</span>
                  <span className="text-slate-400">Include investigator notes on bookmarked items ({taggedCount} tagged)</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20 cursor-pointer hover:bg-amber-100/40 transition-colors">
                <input
                  type="checkbox"
                  checked={onlyTaggedExhibits}
                  onChange={(e) => setOnlyTaggedExhibits(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-amber-900 dark:text-amber-300 block flex items-center gap-1">
                    <Tag className="h-3 w-3 text-amber-600" /> Package ONLY Tagged Exhibits
                  </span>
                  <span className="text-amber-800/80 dark:text-amber-400/80">Exclude non-tagged records for focused court presentation</span>
                </div>
              </label>
            </div>
          </div>

          {/* Section 2: Data Streams based on Warrant Return Type */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-indigo-500" />
              2. Data Streams ({providerName} Warrant Returns)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAccountInfo}
                  onChange={(e) => setIncludeAccountInfo(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <UserCheck className="h-3.5 w-3.5 text-pink-500" />
                <span>Subscriber &amp; Profile</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMessages}
                  onChange={(e) => setIncludeMessages(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <MessageSquare className="h-3.5 w-3.5 text-indigo-500" />
                <span>Messages ({messagesCount})</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeIpAudit}
                  onChange={(e) => setIncludeIpAudit(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <Network className="h-3.5 w-3.5 text-emerald-500" />
                <span>IP Audit Logs ({connectionsCount})</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeGeoMap}
                  onChange={(e) => setIncludeGeoMap(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <MapPin className="h-3.5 w-3.5 text-rose-500" />
                <span>IP Geolocation Map</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFiles}
                  onChange={(e) => setIncludeFiles(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <FileText className="h-3.5 w-3.5 text-amber-500" />
                <span>Media Manifest ({loadedFiles.length})</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAccountChanges}
                  onChange={(e) => setIncludeAccountChanges(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                <span>Account Audit History</span>
              </label>
            </div>
          </div>

          {/* Section 3: Redaction & CJIS Privacy Controls */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              3. Privacy, CJIS &amp; Redaction Controls
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={redactIpAddresses}
                  onChange={(e) => setRedactIpAddresses(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Sanitize IP Addresses</span>
                  <span className="text-slate-400">Mask last 2 octets (e.g. 192.168.XXX.XXX) for public/court sharing</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={redactPii}
                  onChange={(e) => setRedactPii(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Mask PII (Emails &amp; Phones)</span>
                  <span className="text-slate-400">Mask email usernames and phone digits for victim/witness privacy</span>
                </div>
              </label>
            </div>
          </div>

          {/* Section 4: Security Passcode Protection */}
          <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-indigo-500" />
                4. Security &amp; Access PIN Protection
              </h3>
              <label className="flex items-center gap-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enablePasscode}
                  onChange={(e) => setEnablePasscode(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                Enable Passcode Lock
              </label>
            </div>

            {enablePasscode && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
                <Key className="h-5 w-5 text-indigo-400 shrink-0" />
                <div className="flex-1 text-xs">
                  <label className="font-bold text-slate-300 block mb-1">Set Access Passcode PIN</label>
                  <p className="text-slate-400 text-[11px]">Reviewing officers must enter this PIN to unlock the evidence viewer.</p>
                </div>
                <div className="relative w-full sm:w-48">
                  <input
                    type={showPasscodeText ? 'text' : 'password'}
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white text-center focus:outline-hidden focus:border-indigo-500"
                    placeholder="Enter PIN"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasscodeText(!showPasscodeText)}
                    className="absolute right-2 top-2 text-slate-400 hover:text-white"
                  >
                    {showPasscodeText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
              5. Delivery Package
            </h3>
            <div className="p-3.5 rounded-xl border border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 flex items-start gap-3">
              <FileArchive className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-xs">Zip you can hand to someone else</div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Unzip it and double-click Portable_Case_Viewer.html. Case records are split into small script files so the page opens from a folder, with no extra program and no network.
                </p>
              </div>
            </div>
            {!window.forensicDesktop?.pickSaveZip && (
              <label className="block text-xs font-bold text-slate-500">
                Save path
                <input
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  placeholder="/tmp/Case_Portable.zip"
                  className="mt-1 w-full text-xs font-mono p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
            )}
            {progress && (
              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                <p className="font-bold">{progress.phase}</p>
                <p>{progress.filesDone.toLocaleString()} / {progress.filesTotal.toLocaleString()} media files{progress.currentFile ? ` · ${progress.currentFile}` : ''}</p>
              </div>
            )}
            {exportError && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{exportError}</p>
            )}
            {savedPath && (
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Saved to {savedPath}</p>
            )}
          </div>

        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 dark:bg-slate-950 p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400 font-medium hidden sm:block">
            Ready to generate portable evidence viewer
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => { if (isGenerating) void handleCancelExport(); else onClose(); }}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {isGenerating ? 'Cancel export' : 'Close'}
            </button>
            <button
              type="button"
              onClick={() => { void handleGenerate(); }}
              disabled={isGenerating}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-extrabold text-xs transition-colors shadow-lg shadow-indigo-600/20 flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {isGenerating ? 'Building package...' : 'Build portable case'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
