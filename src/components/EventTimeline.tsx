/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from 'react';
import { ForensicEvent, UploadedFile } from '../types';
import { 
  Search, ChevronDown, ChevronUp, Download, Eye, Calendar, UserPlus, 
  Inbox, Info, ShieldAlert, Wifi, Tag, Globe, Languages, Cpu, Sparkles, 
  RefreshCw, AlertCircle, CheckCircle, HelpCircle
} from 'lucide-react';
import { detectLanguage, translateWithOllama, testOllamaConnection } from '../lib/translationHelper';
import { VideoScrubber } from './VideoScrubber';
import { HashMatchBadges } from './HashMatchBadges';
import { recordHashes, type HashHit } from '../lib/hashSets';

interface TimelineProps {
  events: ForensicEvent[];
  onExportFilteredCSV: (filtered: ForensicEvent[]) => void;
  evidenceTags?: Record<string, { tagged: boolean; notes?: string }>;
  onToggleTag?: (eventId: string) => void;
  onUpdateNotes?: (eventId: string, notes: string) => void;
  loadedFiles?: UploadedFile[];
  searchTerm?: string;
  onSearchTermChange?: (term: string) => void;
  showCategoryDefinitions?: boolean;
  disableLanguageDetection?: boolean;
  
  // Ollama translation props
  ollamaEnabled?: boolean;
  ollamaUrl?: string;
  ollamaModel?: string;
  ollamaAutoTranslate?: boolean;
  translations?: Record<string, { text: string; detectedLang: string; originalText: string; translatedAt: string }>;
  onSaveTranslation?: (eventId: string, text: string, detectedLang: string, originalText: string) => void;
  vicHashes?: ReadonlySet<string> | null;
  hashHits?: ReadonlyMap<string, HashHit[]> | null;
}

export function EventTimeline({
  events,
  onExportFilteredCSV,
  evidenceTags,
  onToggleTag,
  onUpdateNotes,
  loadedFiles = [],
  searchTerm: externalSearchTerm,
  onSearchTermChange,
  showCategoryDefinitions = true,
  disableLanguageDetection = false,
  ollamaEnabled = false,
  ollamaUrl = 'http://localhost:11434',
  ollamaModel = 'llama3',
  ollamaAutoTranslate = false,
  translations = {},
  onSaveTranslation,
  vicHashes,
  hashHits
}: TimelineProps) {
  const [internalSearchTerm, setInternalSearchTerm] = useState('');

  const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;
  const setSearchTerm = onSearchTermChange || setInternalSearchTerm;

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [hoveredMediaId, setHoveredMediaId] = useState<string | null>(null);
  const [inspectMediaEvent, setInspectMediaEvent] = useState<ForensicEvent | null>(null);

  // Date range state
  const [startDateStr, setStartDateStr] = useState<string>('');
  const [endDateStr, setEndDateStr] = useState<string>('');

  // Date range bounds from event history
  const eventDateBounds = useMemo(() => {
    if (events.length === 0) return { min: '', max: '', minMs: 0, maxMs: 0 };
    let minTime = Infinity;
    let maxTime = -Infinity;
    events.forEach(e => {
      const t = Date.parse(e.timestamp);
      if (!isNaN(t)) {
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;
      }
    });
    if (minTime === Infinity) return { min: '', max: '', minMs: 0, maxMs: 0 };
    
    // Format to yyyy-MM-ddThh:mm for datetime-local
    const formatForInput = (ms: number) => {
      const d = new Date(ms);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    return {
      min: formatForInput(minTime),
      max: formatForInput(maxTime),
      minMs: minTime,
      maxMs: maxTime
    };
  }, [events]);

  // Ollama states
  const [isOllamaConnected, setIsOllamaConnected] = useState<boolean | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [singleTranslatingIds, setSingleTranslatingIds] = useState<Record<string, boolean>>({});
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translateProgress, setTranslateProgress] = useState({ current: 0, total: 0 });

  // Find all items with Spanish/foreign language detection
  const detectedEvents = useMemo(() => {
    return events.map(evt => {
      const translation = translations[evt.id];
      const isTranslated = !!translation;
      const detection = (isTranslated || disableLanguageDetection) ? null : detectLanguage(evt.content);
      return {
        event: evt,
        isTranslated,
        translation,
        detection
      };
    });
  }, [events, translations, disableLanguageDetection]);

  const foreignLanguageCount = useMemo(() => {
    return detectedEvents.filter(d => d.detection !== null).length;
  }, [detectedEvents]);

  const checkOllama = async () => {
    if (!ollamaEnabled) return;
    setIsOllamaConnected(null);
    setOllamaError(null);
    try {
      const res = await testOllamaConnection(ollamaUrl);
      if (res.success) {
        setIsOllamaConnected(true);
      } else {
        setIsOllamaConnected(false);
        setOllamaError(res.error || 'Server unreachable');
      }
    } catch (err: any) {
      setIsOllamaConnected(false);
      setOllamaError(err.message || 'Connection failed');
    }
  };

  useEffect(() => {
    checkOllama();
  }, [ollamaEnabled, ollamaUrl]);

  const translateSingle = async (eventId: string, text: string, sourceLang: string) => {
    if (!onSaveTranslation) return;
    setSingleTranslatingIds(prev => ({ ...prev, [eventId]: true }));
    try {
      const translated = await translateWithOllama(text, ollamaUrl, ollamaModel, sourceLang);
      onSaveTranslation(eventId, translated, sourceLang, text);
    } catch (err: any) {
      console.error(err);
      // Fail silently or log to console rather than blocking alert
    } finally {
      setSingleTranslatingIds(prev => ({ ...prev, [eventId]: false }));
    }
  };

  const translateAll = async () => {
    if (!onSaveTranslation) return;
    const nonEnglishItems = detectedEvents.filter(d => d.detection !== null);
    if (nonEnglishItems.length === 0) return;

    setIsTranslatingAll(true);
    setTranslateProgress({ current: 0, total: nonEnglishItems.length });

    for (let i = 0; i < nonEnglishItems.length; i++) {
      const item = nonEnglishItems[i];
      setTranslateProgress(prev => ({ ...prev, current: i + 1 }));
      try {
        const translated = await translateWithOllama(
          item.event.content,
          ollamaUrl,
          ollamaModel,
          item.detection!.lang
        );
        onSaveTranslation(item.event.id, translated, item.detection!.lang, item.event.content);
      } catch (err) {
        console.error(`Failed to batch translate ${item.event.id}:`, err);
      }
    }

    setIsTranslatingAll(false);
  };

  // Auto-translate if enabled and Ollama is connected
  useEffect(() => {
    if (ollamaEnabled && ollamaAutoTranslate && isOllamaConnected === true && onSaveTranslation && !isTranslatingAll) {
      const nonTranslated = detectedEvents.find(d => d.detection !== null);
      if (nonTranslated && !singleTranslatingIds[nonTranslated.event.id]) {
        translateSingle(nonTranslated.event.id, nonTranslated.event.content, nonTranslated.detection!.lang);
      }
    }
  }, [detectedEvents, ollamaEnabled, ollamaAutoTranslate, isOllamaConnected]);

  // Available unique categories in data
  const categories = useMemo(() => {
    const list = new Set<string>();
    events.forEach(e => list.add(e.category));
    return ['all', ...Array.from(list)];
  }, [events]);

  // Unique files list in data
  const sourceFiles = useMemo(() => {
    const list = new Set<string>();
    events.forEach(e => list.add(e.sourceFile));
    return Array.from(list);
  }, [events]);

  const [selectedFile, setSelectedFile] = useState<string>('all');

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    let result = events;

    // Filter by file
    if (selectedFile !== 'all') {
      result = result.filter(e => e.sourceFile === selectedFile);
    }

    // Filter by category
    if (selectedCategory !== 'all') {
      result = result.filter(e => e.category === selectedCategory);
    }

    // Filter by Date Range
    if (startDateStr) {
      const startMs = Date.parse(startDateStr);
      if (!isNaN(startMs)) {
        result = result.filter(e => {
          const t = Date.parse(e.timestamp);
          return isNaN(t) || t >= startMs;
        });
      }
    }
    if (endDateStr) {
      const endMs = Date.parse(endDateStr);
      if (!isNaN(endMs)) {
        result = result.filter(e => {
          const t = Date.parse(e.timestamp);
          return isNaN(t) || t <= endMs;
        });
      }
    }

    // Filter by search text
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        e =>
          e.content.toLowerCase().includes(q) ||
          e.sender.toLowerCase().includes(q) ||
          (e.recipient && e.recipient.toLowerCase().includes(q)) ||
          (e.ipAddress && e.ipAddress.includes(q)) ||
          e.sourceFile.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q)
      );
    }

    // Sort a copy so the caller's event array is never mutated.
    if (result === events) result = events.slice();
    result.sort((a, b) => {
      const parsedA = Date.parse(a.timestamp);
      const parsedB = Date.parse(b.timestamp);
      const timeA = isNaN(parsedA) ? 0 : parsedA;
      const timeB = isNaN(parsedB) ? 0 : parsedB;
      return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });

    return result;
  }, [events, selectedCategory, selectedFile, searchTerm, sortOrder, startDateStr, endDateStr]);

  // Page index
  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredEvents.slice(start, start + itemsPerPage);
  }, [filteredEvents, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredEvents.length / itemsPerPage);

  const getCategoryBadge = (category: string) => {
    let title = 'Activity';
    let desc = 'General actions, user clicks, session activity, or miscellaneous system events.';
    let badge = <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-400 border border-slate-100 dark:border-slate-800/50">Activity</span>;

    if (category === 'message') {
      title = 'Message';
      desc = 'Communication exchange (text, media, or chat) between users recorded in the application database.';
      badge = <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50">Message</span>;
    } else if (category === 'connection') {
      title = 'IP Connection';
      desc = 'Network registration, session initiation, or logging event mapping the user to an IP address.';
      badge = <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">IP Connection</span>;
    } else if (category === 'file') {
      title = 'File Backup';
      desc = 'Files, photos, downloads, attachments, or media assets uploaded or stored on the platform servers.';
      badge = <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/50">File Backup</span>;
    } else if (category === 'profile') {
      title = 'Registry Log';
      desc = 'Account creation, status updates, modifications to security, or credential change history.';
      badge = <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50">Registry Log</span>;
    } else if (category === 'call') {
      title = 'Voice Link';
      desc = 'Audio, video, or call logs mapping sessions, connections, or call durations between endpoints.';
      badge = <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border border-purple-100 dark:border-purple-900/50">Voice Link</span>;
    }

    if (!showCategoryDefinitions) {
      return badge;
    }

    return (
      <div className="group/tooltip relative inline-block select-none" onClick={(e) => e.stopPropagation()}>
        {badge}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-56 bg-slate-900 dark:bg-slate-950 text-white text-[10px] p-2 rounded-lg shadow-xl border border-slate-750 dark:border-slate-800 z-50 pointer-events-none whitespace-normal leading-relaxed text-center">
          <div className="font-bold text-indigo-450 mb-0.5">{title}</div>
          <div className="text-slate-300">{desc}</div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-950" />
        </div>
      </div>
    );
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedEventId(expandedEventId === id ? null : id);
  };

  return (
    <div id="timeline-component-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
      {/* Search and control deck */}
      <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Forensic Chronometer Log</h3>
            <p className="text-xs text-slate-500 dark:text-slate-405">Search, trace, and inspect records parsed across active warrants.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="export-csv-btn"
              onClick={() => onExportFilteredCSV(filteredEvents)}
              className="inline-flex items-center px-3 py-2 border border-slate-200 dark:border-slate-800 text-xs font-semibold rounded-lg bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors"
            >
              <Download className="h-4 w-4 mr-1.5 text-slate-500 dark:text-slate-400" /> Export CSV ({filteredEvents.length})
            </button>
            <button
              id="sort-btn"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="inline-flex items-center px-3 py-2 border border-slate-200 dark:border-slate-800 text-xs font-semibold rounded-lg bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors"
            >
              Timeline: {sortOrder === 'asc' ? 'Oldest First' : 'Newest First'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Global query input */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
            <input
              id="timeline-search"
              type="text"
              placeholder="Search words, IPs, names..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9 pr-4 py-2 w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          {/* Filter Category */}
          <div className="flex items-center space-x-2">
            <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase leading-none min-w-[50px]">Category:</label>
            <select
              id="timeline-category-select"
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="p-2 w-full text-xs font-medium border border-slate-200 dark:border-slate-805 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200 capitalize"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Classes' : cat}
                </option>
              ))}
            </select>
          </div>

          {/* Filter Source File */}
          <div className="flex items-center space-x-2">
            <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase leading-none min-w-[40px]">Source:</label>
            <select
              id="timeline-source-select"
              value={selectedFile}
              onChange={(e) => {
                setSelectedFile(e.target.value);
                setCurrentPage(1);
              }}
              className="p-2 w-full text-xs font-medium border border-slate-200 dark:border-slate-805 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="all">All Parsed Files</option>
              {sourceFiles.map(file => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          </div>

          {/* Records count select */}
          <div className="flex items-center space-x-2">
            <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase leading-none min-w-[50px]">Rows:</label>
            <select
              id="timeline-limit-select"
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="p-2 w-full text-xs font-strong border border-slate-200 dark:border-slate-805 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-200"
            >
              <option value={15}>15 Per Page</option>
              <option value={30}>30 Per Page</option>
              <option value={50}>50 Per Page</option>
              <option value={100}>100 Per Page</option>
            </select>
          </div>
        </div>

        {/* Date Range Filtering Panel */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-col md:flex-row md:items-center gap-3.5 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 shrink-0 font-medium">
            <Calendar className="h-4 w-4 text-indigo-500" />
            <span>Date Filtering:</span>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 dark:text-slate-500">From</span>
              <input
                id="timeline-start-date"
                type="datetime-local"
                value={startDateStr}
                onChange={(e) => {
                  setStartDateStr(e.target.value);
                  setCurrentPage(1);
                }}
                className="p-1.5 text-[11px] font-mono border border-slate-200 dark:border-slate-800 rounded-md focus:outline-hidden focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-250"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400 dark:text-slate-500">To</span>
              <input
                id="timeline-end-date"
                type="datetime-local"
                value={endDateStr}
                onChange={(e) => {
                  setEndDateStr(e.target.value);
                  setCurrentPage(1);
                }}
                className="p-1.5 text-[11px] font-mono border border-slate-200 dark:border-slate-800 rounded-md focus:outline-hidden focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-slate-950 dark:text-slate-250"
              />
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5 items-center md:ml-auto">
              {eventDateBounds.min && (
                <>
                  <button
                    onClick={() => {
                      setStartDateStr(eventDateBounds.min);
                      setEndDateStr(eventDateBounds.max);
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-[10px] font-bold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Reset Bounds
                  </button>
                  <button
                    onClick={() => {
                      // First 24 hours of logs
                      const minMs = eventDateBounds.minMs;
                      const nextDayMs = minMs + (24 * 60 * 60 * 1000);
                      const d = new Date(nextDayMs);
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const nextDayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                      
                      setStartDateStr(eventDateBounds.min);
                      setEndDateStr(nextDayStr);
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-[10px] font-bold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    First 24h
                  </button>
                  <button
                    onClick={() => {
                      // Last 24 hours of logs
                      const maxMs = eventDateBounds.maxMs;
                      const prevDayMs = maxMs - (24 * 60 * 60 * 1000);
                      const d = new Date(prevDayMs);
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const prevDayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                      
                      setStartDateStr(prevDayStr);
                      setEndDateStr(eventDateBounds.max);
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-[10px] font-bold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Last 24h
                  </button>
                </>
              )}
              
              {(startDateStr || endDateStr) && (
                <button
                  onClick={() => {
                    setStartDateStr('');
                    setEndDateStr('');
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 bg-amber-50 dark:bg-amber-950 hover:bg-amber-100 dark:hover:bg-amber-900 rounded text-[10px] font-bold text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-900/30 transition-colors cursor-pointer"
                >
                  Clear Date Filters
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Ollama Translation / Language Detection Deck */}
        {ollamaEnabled ? (
          <div className="mt-3 p-3 bg-indigo-50/50 dark:bg-indigo-950/25 border border-indigo-100/60 dark:border-indigo-900/40 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Cpu className="h-4 w-4 text-indigo-500 shrink-0" />
              <div className="text-left">
                <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 flex-wrap">
                  <span>Ollama Translation Service</span>
                  {isOllamaConnected === null ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-medium bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded-md">
                      <RefreshCw className="h-3 w-3 animate-spin" /> Connecting...
                    </span>
                  ) : isOllamaConnected ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-450 font-bold bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded-md">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> Active ({ollamaModel})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-rose-700 dark:text-rose-450 font-bold bg-rose-100 dark:bg-rose-950/60 px-1.5 py-0.5 rounded-md" title={ollamaError || ''}>
                      <AlertCircle className="h-3 w-3" /> Connection Failed
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">{ollamaUrl}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {isOllamaConnected === false && (
                <button
                  onClick={checkOllama}
                  className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-bold rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 inline-flex items-center gap-1 transition-all"
                >
                  <RefreshCw className="h-3 w-3" /> Retry Connection
                </button>
              )}

              <div className="text-right shrink-0">
                <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                  {foreignLanguageCount === 0 ? "No pending foreign logs" : `${foreignLanguageCount} foreign log(s) pending`}
                </span>
                <span className="text-[10px] text-slate-400 block">Languages like Spanish, French...</span>
              </div>

              {foreignLanguageCount > 0 && isOllamaConnected === true && (
                <button
                  onClick={translateAll}
                  disabled={isTranslatingAll}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold rounded-lg shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  {isTranslatingAll ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Translating ({translateProgress.current}/{translateProgress.total})</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Translate All to English</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ) : (
          foreignLanguageCount > 0 && (
            <div className="mt-3 p-3 bg-amber-50/40 dark:bg-amber-950/15 border border-amber-100/60 dark:border-amber-900/30 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-amber-500 shrink-0 animate-pulse" />
                <div className="text-left">
                  <span className="font-bold text-slate-700 dark:text-slate-300">Foreign Languages Detected</span>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Found <strong className="font-semibold text-slate-700 dark:text-slate-300">{foreignLanguageCount} log events</strong> containing languages like Spanish. Enable Ollama in Settings to translate offline.
                  </p>
                </div>
              </div>
              <span className="text-[10px] text-slate-400 italic bg-amber-100/50 dark:bg-amber-955 px-2 py-0.5 rounded-full shrink-0">
                Offline Translation Ready
              </span>
            </div>
          )
        )}
      </div>

      {/* Main Events list */}
      {filteredEvents.length === 0 ? (
        <div id="empty-timeline-state" className="p-12 text-center bg-white dark:bg-slate-905">
          <Inbox className="h-12 w-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <h4 className="font-bold text-slate-700 dark:text-slate-300">No events match query filter</h4>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 max-w-md mx-auto">
            Try resetting your search parameter or selecting "All Classes" to show remaining attributes.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[800px]">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-800">
                <th className="w-[185px] px-4 py-3">Timestamp (UTC/Local)</th>
                <th className="w-[110px] px-4 py-3">Event Type</th>
                <th className="w-[160px] px-4 py-3">Identity / Entity</th>
                <th className="px-4 py-3 max-w-0 w-[40%]">Parsed Action & Payload</th>
                <th className="w-[140px] px-4 py-3">IP Address</th>
                <th className="w-[80px] px-4 py-3 text-center">Evidence</th>
                <th className="w-[70px] px-4 py-3 text-center">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40 text-sm">
              {paginatedEvents.map((evt) => {
                const isExpanded = expandedEventId === evt.id;
                return (
                  <tr
                    key={evt.id}
                    id={`row-${evt.id}`}
                    onClick={() => toggleRow(evt.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group"
                  >
                    {/* Timestamp */}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300 font-mono text-xs">
                      {(() => {
                        const parsed = Date.parse(evt.timestamp);
                        if (isNaN(parsed)) {
                          return 'Extraction Timestamp';
                        }
                        try {
                          return new Date(parsed).toISOString().replace('T', ' ').substring(0, 19);
                        } catch {
                          return 'Extraction Timestamp';
                        }
                      })()}
                    </td>

                    {/* Category Label */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getCategoryBadge(evt.category)}
                    </td>

                    {/* Sender Identity */}
                    <td className="px-4 py-3 truncate text-slate-800 dark:text-slate-200 font-medium" title={evt.sender}>
                      <span className="font-mono text-xs">{evt.sender}</span>
                      {evt.recipient && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block truncate">
                          ➜ {evt.recipient}
                        </span>
                      )}
                    </td>

                    {/* Main payload / Message text */}
                    <td className="px-4 py-3 max-w-0 text-slate-600 dark:text-slate-350 select-all group-hover:text-slate-800 dark:group-hover:text-slate-200" title={!isExpanded ? evt.content : undefined}>
                      {(() => {
                        const tr = translations[evt.id];
                        const displayText = tr ? `${tr.text} ${tr.originalText}` : (evt.content || '');
                        const needsClamp = displayText.length > 180;
                        const textClampClass = isExpanded
                          ? 'whitespace-pre-wrap break-words max-w-full'
                          : 'line-clamp-3 overflow-hidden break-words max-w-full';
                        const showMoreHint = needsClamp ? (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 select-none">
                            {isExpanded ? 'Show less' : 'Show more'}
                          </span>
                        ) : null;

                        if (tr) {
                          return (
                            <div className="flex flex-col text-left space-y-1">
                              <div className="flex items-start gap-1.5 flex-wrap">
                                <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-450 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase shrink-0 flex items-center gap-0.5" title={`Translated on ${new Date(tr.translatedAt).toLocaleString()}`}>
                                  <CheckCircle className="h-2.5 w-2.5" /> Translated
                                </span>
                                <span className={`text-slate-800 dark:text-slate-200 font-medium ${textClampClass}`}>{tr.text}</span>
                              </div>
                              <span className={`text-[10px] text-slate-400 dark:text-slate-500 font-mono italic pl-2 border-l-2 border-slate-200 dark:border-slate-800 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'line-clamp-2 overflow-hidden break-words'}`}>
                                Original ({tr.detectedLang}): "{tr.originalText}"
                              </span>
                              {showMoreHint}
                            </div>
                          );
                        }

                        // Check if language detection is available
                        const det = disableLanguageDetection ? null : detectLanguage(evt.content);
                        if (det) {
                          return (
                            <div className="flex flex-col text-left space-y-1">
                              <div className={`flex items-start gap-1.5 ${isExpanded ? 'flex-wrap' : ''}`}>
                                <span className="bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-400 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase shrink-0 flex items-center gap-0.5">
                                  <Globe className="h-2.5 w-2.5" /> {det.lang} Detected
                                </span>
                                <span className={`text-slate-700 dark:text-slate-300 min-w-0 ${textClampClass}`}>{evt.content}</span>
                              </div>
                              {ollamaEnabled && isOllamaConnected === true && (
                                <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => translateSingle(evt.id, evt.content, det.lang)}
                                    disabled={singleTranslatingIds[evt.id]}
                                    className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center gap-1 hover:underline bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-md border border-indigo-100 dark:border-indigo-900/30 transition-all cursor-pointer"
                                  >
                                    {singleTranslatingIds[evt.id] ? (
                                      <>
                                        <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                                        <span>Translating with Ollama...</span>
                                      </>
                                    ) : (
                                      <>
                                        <Sparkles className="h-2.5 w-2.5" />
                                        <span>Translate with Ollama</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              )}
                              {showMoreHint}
                            </div>
                          );
                        }

                        // Default English text
                        return (
                          <div className="flex flex-col text-left space-y-1">
                            <div className={textClampClass}>{evt.content}</div>
                            {showMoreHint}
                          </div>
                        );
                      })()}

                      {evt.details?.attachments && (
                        <div className="mt-1 text-[11px] text-indigo-600 dark:text-indigo-400 font-medium flex items-center">
                          📎 Attachment: <span className="font-mono ml-1 underline">{String(evt.details.attachments)}</span>
                        </div>
                      )}
                      {evt.details?.resolvedMediaName ? (
                        (() => {
                          const file = loadedFiles.find(f => f.name === evt.details?.resolvedMediaName);
                          if (!file) {
                            return (
                              <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center">
                                📎 Attached Media: <span className="font-mono ml-1 underline">{evt.details.resolvedMediaName}</span>
                                <span className="ml-2 px-1.5 py-0.5 rounded-sm bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[9px] font-extrabold uppercase">MATCHED ✅</span>
                              </div>
                            );
                          }

                          return (
                            <div className="relative mt-2" onClick={(e) => e.stopPropagation()}>
                              <div
                                className="inline-flex items-center space-x-2.5 p-1.5 bg-slate-50 dark:bg-slate-950 rounded-lg cursor-pointer border border-slate-200 dark:border-slate-800 hover:border-indigo-500/50 hover:bg-white dark:hover:bg-slate-900 shadow-xs transition-all"
                                onMouseEnter={() => setHoveredMediaId(evt.id)}
                                onMouseLeave={() => setHoveredMediaId(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInspectMediaEvent(evt);
                                }}
                              >
                                <div className="w-8 h-8 rounded bg-slate-900 border border-slate-200 dark:border-slate-850 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {file.mediaType === 'video' ? (
                                    <VideoScrubber src={file.content} className="w-full h-full" />
                                  ) : (
                                    <img src={file.content} alt={file.name} className="w-full h-full object-cover" />
                                  )}
                                </div>
                                <div className="text-left leading-none font-sans max-w-[170px]">
                                  <span className="block text-[10px] font-bold text-indigo-600 dark:text-indigo-405 font-mono truncate">{file.name}</span>
                                  <span className="text-[8.5px] text-slate-400 font-mono">{(file.size / 1024).toFixed(1)} KB • {file.mediaType?.toUpperCase()}</span>
                                </div>
                              </div>

                              {hoveredMediaId === evt.id && (
                                <div className="absolute z-50 left-0 sm:left-auto md:left-full ml-1 top-0 p-2 bg-slate-900 border border-slate-800 rounded-lg shadow-xl animate-fadeIn w-56 flex flex-col pointer-events-none text-left">
                                  <div className="relative aspect-video w-full bg-slate-950 rounded overflow-hidden flex items-center justify-center">
                                    {file.mediaType === 'video' ? (
                                      <VideoScrubber src={file.content} className="w-full h-full" />
                                    ) : (
                                      <img src={file.content} alt="Hover Preview" className="w-full h-full object-contain" />
                                    )}
                                  </div>
                                  <span className="mt-1 text-[8.5px] text-slate-400 font-mono text-center">Click item to inspect & annotate</span>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ) : evt.details?.mediaId ? (
                        <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-500 font-medium flex items-center flex-wrap">
                          📷 Media ID: <span className="font-mono ml-1">{String(evt.details.mediaRef || evt.details.mediaId).substring(0, 16)}...</span>
                          <span className="ml-2 px-1.5 py-0.5 rounded-sm bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[9px] font-extrabold uppercase">MISSING ⚠️</span>
                        </div>
                      ) : null}
                      {(vicHashes || hashHits) && (
                        <div className="mt-1">
                          <HashMatchBadges hashes={recordHashes(evt)} vicHashes={vicHashes} hashHits={hashHits} />
                        </div>
                      )}
                    </td>

                    {/* IP and Geo location */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs font-semibold">
                      {evt.ipAddress ? (
                        <div className="flex flex-col">
                          <span className="text-rose-700 dark:text-rose-400 font-mono">{evt.ipAddress}</span>
                          {evt.location && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium font-sans">
                              Country: {evt.location}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-700 font-mono">-</span>
                      )}
                    </td>

                    {/* Evidence Toggle Pin */}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onToggleTag) onToggleTag(evt.id);
                        }}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-block"
                        title={evidenceTags?.[evt.id]?.tagged ? "Remove from Case Evidence" : "Mark as Relevant Case Evidence"}
                      >
                        {evidenceTags?.[evt.id]?.tagged ? (
                          <Tag className="h-4 w-4 text-amber-500 fill-amber-500" />
                        ) : (
                          <Tag className="h-4 w-4 text-slate-450 dark:text-slate-600 hover:text-amber-500" />
                        )}
                      </button>
                    </td>

                    {/* Quick debug layout toggle */}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRow(evt.id);
                        }}
                        className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 mx-auto" />
                        ) : (
                          <ChevronDown className="h-4 w-4 mx-auto" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Sub-table inspector row details */}
          {paginatedEvents.some(evt => expandedEventId === evt.id) && (
            <div className="bg-indigo-50/40 dark:bg-indigo-950/15 p-4 border-t border-b border-indigo-100 dark:border-indigo-900/30 text-xs text-left">
              <h4 className="font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider text-[10px]">Forensic Element Audit Record</h4>
              {paginatedEvents.filter(evt => expandedEventId === evt.id).map(evt => (
                <div key={`exp-${evt.id}`} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5 flex flex-col justify-between md:col-span-1">
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 font-medium">Record ID: <span className="font-mono text-slate-800 dark:text-slate-205 font-semibold">{evt.id}</span></p>
                      <p className="text-slate-500 dark:text-slate-400 font-medium">Warrant Extract File: <span className="font-mono text-indigo-700 dark:text-indigo-400 font-semibold">{evt.sourceFile}</span></p>
                      <p className="text-slate-500 dark:text-slate-400 font-medium">Timestamp UTC: <span className="font-mono text-slate-800 dark:text-slate-205 font-semibold">{evt.timestamp}</span></p>
                      {evt.ipAddress && <p className="text-slate-500 dark:text-slate-400 font-medium">Recorded Client IP: <span className="font-mono text-rose-700 dark:text-rose-450 font-semibold">{evt.ipAddress}</span></p>}
                    </div>

                    {evt.details?.resolvedMediaName ? (
                      <div className="mt-3 p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 space-y-1">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold tracking-wider bg-emerald-500 text-white uppercase mb-1">
                          {evt.details.resolvedMediaName.toLowerCase().endsWith('.mp4') || evt.details.resolvedMediaName.toLowerCase().endsWith('.mov') ? '📹 VIDEO ATTACHED' : '📷 PHOTO ATTACHED'}
                        </div>
                        <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Disk Match: {evt.details.resolvedMediaName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">Decoded Ref: {evt.details.mediaRef || 'N/A'}</p>
                        <p className="text-[10px] text-slate-500 font-mono truncate">SHA-1: 1af53ee39049753c1d9048ef0e98516fb{evt.id.substring(0, 7)}</p>
                      </div>
                    ) : evt.details?.mediaId ? (
                      <div className="mt-3 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 space-y-1 select-all">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold tracking-wider bg-amber-550 text-white uppercase mb-1">
                          ⚠️ Media Detached From Return
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">The chat referenced a media file that was deleted or not included in this warrant return.</p>
                        <p className="text-[10px] text-slate-500 font-mono">Raw Media ID: {evt.details.mediaId}</p>
                        {evt.details.mediaRef && <p className="text-[10px] text-slate-500 font-mono">Decoded Search Ref: {evt.details.mediaRef}</p>}
                      </div>
                    ) : null}
                  </div>

                  {/* Evidence Control Center */}
                  <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col justify-between md:col-span-1">
                    <div>
                      <h5 className="font-bold text-slate-700 dark:text-slate-305 flex items-center gap-1.5 mb-1 tracking-tight text-[11px] uppercase">
                        💼 Case Exhibits & Tagging
                      </h5>
                      <p className="text-slate-400 dark:text-slate-500 text-[10px] mb-2 font-medium">Tag this event to include it in the exported case report document.</p>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onToggleTag) onToggleTag(evt.id);
                        }}
                        className={`w-full py-1.5 px-3 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                          evidenceTags?.[evt.id]?.tagged
                            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-xs'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-750 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <Tag className="h-3.5 w-3.5" />
                        {evidenceTags?.[evt.id]?.tagged ? 'Tagged as Case Evidence' : 'Mark as Key Evidence'}
                      </button>
                    </div>

                    {evidenceTags?.[evt.id]?.tagged && (
                      <div className="mt-3">
                        <label className="text-[9px] font-extrabold tracking-wider text-slate-400 dark:text-slate-500 uppercase block mb-1">Relevance Annotations / Notes</label>
                        <textarea
                          value={evidenceTags?.[evt.id]?.notes || ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            if (onUpdateNotes) onUpdateNotes(evt.id, e.target.value);
                          }}
                          rows={3}
                          className="w-full text-xs p-1.5 border border-slate-203 dark:border-slate-805 rounded-md bg-slate-50 dark:bg-slate-900 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden resize-none font-sans"
                          placeholder="Explain why this log event is key evidence..."
                        />
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-1">
                    <span className="text-slate-500 dark:text-slate-400 font-medium block mb-1">Raw Payload Keys (JSON Dump):</span>
                    <pre className="p-2.5 rounded bg-slate-900 text-teal-400 font-mono overflow-auto max-h-[160px] text-[11px]">
                      {JSON.stringify(evt, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Showing <strong className="font-semibold text-slate-700 dark:text-slate-300">{((currentPage - 1) * itemsPerPage) + 1}</strong> to{' '}
            <strong className="font-semibold text-slate-700 dark:text-slate-300">
              {Math.min(currentPage * itemsPerPage, filteredEvents.length)}
            </strong> of <strong className="font-semibold text-slate-700 dark:text-slate-300">{filteredEvents.length}</strong> events
          </span>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
            >
              Prev
            </button>
            {Array.from({ length: totalPages }).map((_, idx) => {
              const pageIdx = idx + 1;
              if (totalPages > 6 && Math.abs(currentPage - pageIdx) > 2 && pageIdx !== 1 && pageIdx !== totalPages) {
                if (pageIdx === 2 || pageIdx === totalPages - 1) {
                  return <span key={`dots-${pageIdx}`} className="text-slate-450 px-1">...</span>;
                }
                return null;
              }
              return (
                <button
                  key={pageIdx}
                  onClick={() => handlePageChange(pageIdx)}
                  className={`px-2.5 py-1 text-xs border rounded-md font-medium transition-colors ${
                    currentPage === pageIdx
                      ? 'bg-indigo-600 dark:bg-indigo-800 text-white border-indigo-600 dark:border-indigo-800 shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {pageIdx}
                </button>
              );
            })}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {inspectMediaEvent && (() => {
        const file = loadedFiles.find(f => f.name === inspectMediaEvent.details?.resolvedMediaName);
        if (!file) return null;
        const isTagged = !!evidenceTags?.[inspectMediaEvent.id]?.tagged;
        const notesValue = evidenceTags?.[inspectMediaEvent.id]?.notes || '';
        
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn" onClick={() => setInspectMediaEvent(null)}>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[85vh]" onClick={(e) => e.stopPropagation()}>
              
              {/* Media visual screen (Left) */}
              <div className="flex-1 bg-slate-950 flex flex-col justify-between p-6 relative min-h-[300px]">
                {/* Header */}
                <div className="flex items-center justify-between text-white z-10">
                  <span className="text-[10px] bg-indigo-600 font-bold px-2 py-0.5 rounded tracking-widest uppercase">
                    CASE EXHIBIT INSPECTOR
                  </span>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-slate-300 font-mono">{file.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                
                {/* Main Renderer */}
                <div className="flex-1 flex items-center justify-center overflow-hidden my-4">
                  {file.mediaType === 'video' ? (
                    <video
                      src={file.content}
                      controls
                      autoPlay
                      className="max-h-[50vh] max-w-full rounded-lg"
                    />
                  ) : (
                    <img
                      src={file.content}
                      alt={file.name}
                      className="max-h-[55vh] max-w-full rounded-lg object-contain"
                    />
                  )}
                </div>
                
                {/* Context footer */}
                <div className="border-t border-slate-800/60 pt-3 text-[11px] text-slate-450 font-mono text-left">
                  <span>Linked Event Date: {new Date(inspectMediaEvent.timestamp).toUTCString()}</span>
                </div>
              </div>

              {/* Notes & Actions sidebar (Right) */}
              <div className="w-full md:w-80 bg-slate-50 dark:bg-slate-955 p-6 flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 shrink-0 text-left">
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-850 dark:text-slate-100 uppercase tracking-wider">
                      Exhibit Metadata
                    </h4>
                    <button
                      onClick={() => setInspectMediaEvent(null)}
                      className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-201 dark:border-slate-800 cursor-pointer shadow-xs font-semibold text-xs"
                    >
                      ✕ Close
                    </button>
                  </div>

                  {/* Conversation detail info block */}
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                    <span className="text-[9px] font-extrabold tracking-wider text-slate-400 dark:text-slate-500 uppercase block">Intercepted Context</span>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Sender: <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">{inspectMediaEvent.sender}</span>
                      </p>
                      {inspectMediaEvent.recipient && (
                        <p className="text-xs font-semibold text-slate-705 dark:text-slate-300">
                          Recipient: <span className="font-mono text-indigo-600 dark:text-indigo-405 font-bold">{inspectMediaEvent.recipient}</span>
                        </p>
                      )}
                      <div className="mt-2 text-xs italic text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-850">
                        "{inspectMediaEvent.content}"
                      </div>
                    </div>
                  </div>

                  {/* Evidence Checkbox */}
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[9px] font-extrabold tracking-wider text-slate-400 dark:text-slate-500 uppercase block">Sealed Exhibit Status</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block">Flag this object for case logging</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={isTagged}
                        onChange={() => onToggleTag?.(inspectMediaEvent.id)}
                        className="h-4 w-4 text-indigo-600 rounded focus:ring-indigo-500 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-800 cursor-pointer"
                      />
                    </div>

                    <button
                      onClick={() => onToggleTag?.(inspectMediaEvent.id)}
                      className={`w-full py-2 px-3 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        isTagged
                          ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-750 dark:text-slate-300 border border-slate-205 dark:border-slate-800'
                      }`}
                    >
                      <Tag className="h-3.5 w-3.5" />
                      {isTagged ? 'Tagged in Evidence Locker' : 'Pin to Evidence Locker'}
                    </button>
                  </div>

                  {/* Notes Section */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-extrabold tracking-wider text-slate-400 dark:text-slate-500 uppercase block">
                      Examiner Annotations
                    </label>
                    <textarea
                      value={notesValue}
                      onChange={(e) => onUpdateNotes?.(inspectMediaEvent.id, e.target.value)}
                      rows={4}
                      className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden font-sans resize-none"
                      placeholder="Enter forensic analysis details regarding this matched media asset..."
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-center font-mono text-[9px] text-slate-400">
                  Case ID Code: {inspectMediaEvent.id}
                </div>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
}
