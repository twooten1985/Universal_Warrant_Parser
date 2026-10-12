/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { ForensicEvent } from '../types';
import { 
  Download, 
  Search, 
  Tag, 
  AlertOctagon, 
  Check, 
  MessageSquare, 
  Moon, 
  Sun,
  Eye,
  Calendar,
  Layers,
  FileCode2,
  Trash2,
  HelpCircle
} from 'lucide-react';

function formatLocaleDateSafe(timestamp: string): string {
  if (!timestamp) return 'Extraction Timestamp';
  const parsed = Date.parse(timestamp);
  if (isNaN(parsed)) return 'Extraction Timestamp';
  try {
    const d = new Date(parsed);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return 'Extraction Timestamp';
  }
}

function formatLocaleTimeShortSafe(timestamp: string): string {
  if (!timestamp) return 'Extraction Timestamp';
  const parsed = Date.parse(timestamp);
  if (isNaN(parsed)) return 'Extraction Timestamp';
  try {
    const d = new Date(parsed);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return 'Extraction Timestamp';
  }
}

interface KikChatViewerProps {
  events: ForensicEvent[];
  evidenceTags: Record<string, { tagged: boolean; notes?: string }>;
  onToggleTag: (eventId: string) => void;
  onUpdateNotes: (eventId: string, notes: string) => void;
}

export function KikChatViewer({
  events,
  evidenceTags,
  onToggleTag,
  onUpdateNotes
}: KikChatViewerProps) {
  // Filter for Kik message-related events
  const kikMessages = useMemo(() => {
    return events.filter(e => e.category === 'message');
  }, [events]);

  // Unique Senders inside Kik message logs
  const uniqueSenders = useMemo(() => {
    const list = new Set<string>();
    kikMessages.forEach(m => {
      if (m.sender) list.add(m.sender);
    });
    return Array.from(list).sort();
  }, [kikMessages]);

  const [senderFilter, setSenderFilter] = useState('All Senders');
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  // Set dates default ranges based on messages time
  const defaultDates = useMemo(() => {
    if (kikMessages.length === 0) {
      return { start: '2026-06-01', end: '2026-06-30' };
    }
    const timestamps = kikMessages.map(m => new Date(m.timestamp).getTime()).filter(t => !isNaN(t));
    if (timestamps.length === 0) {
      return { start: '2026-06-01', end: '2026-06-30' };
    }
    const minDate = new Date(Math.min(...timestamps));
    const maxDate = new Date(Math.max(...timestamps));

    // Pad dates slightly
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 1);

    return {
      start: minDate.toISOString().split('T')[0],
      end: maxDate.toISOString().split('T')[0]
    };
  }, [kikMessages]);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Auto-initialize filter dates once default dates are extracted
  useMemo(() => {
    if (defaultDates) {
      setStartDate(defaultDates.start);
      setEndDate(defaultDates.end);
    }
  }, [defaultDates]);

  // High-risk keywords matching python parser keywords exactly plus custom helper keywords
  const [keywords, setKeywords] = useState<string[]>([
    'daughter', 'niece', 'fantasy', 'kids', 'child', 'young', 'underage', 'family', 'payment', 'monero', 'stash', 'xmr'
  ]);
  const [newKeyword, setNewKeyword] = useState('');

  // Right-side align target setting (Default aligns sending profile rightwise)
  const [rightSideUser, setRightSideUser] = useState<string>(() => {
    // Try to auto-detect a main "outgoing" username, or standard suspect profile
    const outboundMsg = events.find(e => e.details?.direction?.toLowerCase()?.includes('out') || e.sender?.includes('secure'));
    return outboundMsg ? outboundMsg.sender : (uniqueSenders[0] || 'kik_trader_secure');
  });

  // Modal Context viewer tracking
  const [contextModalEvent, setContextModalEvent] = useState<ForensicEvent | null>(null);

  // Filter messages based on GUI widgets
  const filteredMessages = useMemo(() => {
    let list = [...kikMessages];

    // Dates check
    if (startDate) {
      const startMs = new Date(startDate + 'T00:00:00').getTime();
      list = list.filter(m => {
        const parsed = Date.parse(m.timestamp);
        return !isNaN(parsed) && parsed >= startMs;
      });
    }
    if (endDate) {
      const endMs = new Date(endDate + 'T23:59:59').getTime();
      list = list.filter(m => {
        const parsed = Date.parse(m.timestamp);
        return !isNaN(parsed) && parsed <= endMs;
      });
    }

    // Sender dropdown filter
    if (senderFilter !== 'All Senders') {
      list = list.filter(m => m.sender === senderFilter);
    }

    // Text search filter
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        m =>
          m.content.toLowerCase().includes(q) ||
          m.sender.toLowerCase().includes(q) ||
          (m.recipient && m.recipient.toLowerCase().includes(q)) ||
          (m.ipAddress && m.ipAddress.includes(q))
      );
    }

    // Sort: real chat body first, then hollow/empty; unknown timestamps last
    const isHollow = (m: typeof list[number]) =>
      m.details?.isHollowMessage === true ||
      !(m.content || '').trim() ||
      (m.content || '').trim() === '[Empty Message]' ||
      /^\[Network:/i.test(m.content || '') ||
      /^\[Abuse report/i.test(m.content || '');
    list.sort((a, b) => {
      const ha = isHollow(a) ? 1 : 0;
      const hb = isHollow(b) ? 1 : 0;
      if (ha !== hb) return ha - hb;
      const parsedA = Date.parse(a.timestamp);
      const parsedB = Date.parse(b.timestamp);
      const tA = isNaN(parsedA) ? Number.POSITIVE_INFINITY : parsedA;
      const tB = isNaN(parsedB) ? Number.POSITIVE_INFINITY : parsedB;
      return tA - tB;
    });

    return list;
  }, [kikMessages, startDate, endDate, senderFilter, searchTerm]);

  // Extract ±5 chronological context events surrounding a message
  const contextSurroundingEvents = useMemo(() => {
    if (!contextModalEvent) return [];
    
    // Sort all messages chronologically
    const allMsgs = [...kikMessages].sort((a, b) => {
      const parsedA = Date.parse(a.timestamp);
      const parsedB = Date.parse(b.timestamp);
      const tA = isNaN(parsedA) ? 0 : parsedA;
      const tB = isNaN(parsedB) ? 0 : parsedB;
      return tA - tB;
    });
    
    const targetIdx = allMsgs.findIndex(m => m.id === contextModalEvent.id);
    if (targetIdx === -1) return [contextModalEvent];

    const startIndex = Math.max(0, targetIdx - 5);
    const endIndex = Math.min(allMsgs.length, targetIdx + 6);
    return allMsgs.slice(startIndex, endIndex);
  }, [contextModalEvent, kikMessages]);

  // Regex-based keyword highlighter
  const highlightRegexContent = (text: string) => {
    if (!highlightEnabled || keywords.length === 0) return text;
    
    // Highlight exact terms with boundaries
    const escaped = keywords.map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

    return text.replace(pattern, (match) => {
      return `<strong style="background-color: #fef08a; color: #1e293b; padding: 2px 4px; border-radius: 4px; font-weight: 800; border: 1px solid #fde047;">${match}</strong>`;
    });
  };

  // Add custom tag keyword
  const handleAddKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    const term = newKeyword.trim().toLowerCase();
    if (term && !keywords.includes(term)) {
      setKeywords(prev => [...prev, term]);
      setNewKeyword('');
    }
  };

  // Delete tag keyword
  const handleDeleteKeyword = (term: string) => {
    setKeywords(prev => prev.filter(k => k !== term));
  };

  // Export current list to an interactive HTML chat document
  const handleExportHtml = () => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Kik Messenger Chat Extract - Forensic Export</title>
  <style>
    body {
      background-color: ${darkMode ? '#1e1e1e' : '#f8fafc'};
      color: ${darkMode ? '#f8fafc' : '#0f172a'};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 24px;
    }
    .header {
      background-color: ${darkMode ? '#2d2d2d' : '#ffffff'};
      border: 1px solid ${darkMode ? '#404040' : '#e2e8f0'};
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .title {
      font-size: 20px;
      font-weight: 800;
      color: #6d28d9;
      margin: 0 0 6px 0;
    }
    .meta {
      font-size: 11px;
      color: #71717a;
      font-family: monospace;
    }
    .timeline {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      display: flex;
      flex-direction: column;
      max-width: 75%;
      margin: 4px 0;
    }
    .left {
      align-self: flex-start;
      align-items: flex-start;
    }
    .right {
      align-self: flex-end;
      align-items: flex-end;
    }
    .bubble {
      border-radius: 14px;
      padding: 12px 14px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }
    .left .bubble {
      background-color: ${darkMode ? '#404040' : '#e2e8f0'};
      color: ${darkMode ? '#ffffff' : '#0f172a'};
      border-bottom-left-radius: 4px;
    }
    .right .bubble {
      background-color: ${darkMode ? '#166534' : '#d1e7dd'};
      color: ${darkMode ? '#ffffff' : '#064e3b'};
      border-bottom-right-radius: 4px;
    }
    .msg-header {
      font-size: 10px;
      font-weight: bold;
      color: #71717a;
      margin-bottom: 2px;
    }
    .msg-footer {
      font-size: 10px;
      color: #a1a1aa;
      margin-top: 4px;
      display: flex;
      gap: 8px;
    }
    .highlight {
      background-color: #fef08a;
      color: #1e293b;
      font-weight: bold;
      padding: 2px 4px;
      border-radius: 4px;
      border: 1px solid #fde047;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">KIK MESSENGER forensically certified bubble chat log</div>
    <div class="meta">Export Timestamp: ${new Date().toUTCString()}</div>
    <div class="meta">Sender Filter: ${senderFilter} | Match Count: ${filteredMessages.length} Messages</div>
  </div>
  <div class="timeline">
    ${filteredMessages.map(m => {
      const isRight = m.sender === rightSideUser;
      let bodyHtml = m.content;
      if (highlightEnabled) {
        keywords.forEach(k => {
          const pattern = new RegExp(`\\b(${k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})\\b`, 'gi');
          bodyHtml = bodyHtml.replace(pattern, '<span class="highlight">$1</span>');
        });
      }
      return `
      <div class="message ${isRight ? 'right' : 'left'}">
        <div class="msg-header">${m.sender}</div>
        <div class="bubble">${bodyHtml}</div>
        <div class="msg-footer">
          <span>${formatLocaleDateSafe(m.timestamp)}</span>
          ${m.ipAddress ? `<span>• IP: ${m.ipAddress}</span>` : ''}
          <span>• File: ${m.sourceFile}</span>
        </div>
      </div>`;
    }).join('')}
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Kik_Chat_View_Export_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`rounded-xl border ${darkMode ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'} overflow-hidden shadow-md flex flex-col lg:flex-row transition-all duration-300 text-left`}>
      
      {/* LEFT COLUMN: Controls, Filters & Highlighting Keywords Config */}
      <div id="kik-config-sidebar" className="w-full lg:w-80 border-r border-slate-200 dark:border-slate-800 p-5 space-y-5 bg-white dark:bg-slate-900">
        
        {/* Interactive Dark Mode & Reset settings header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <Layers className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="font-extrabold text-xs uppercase tracking-wider text-slate-450 dark:text-slate-400">Kik Engine Control</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              id="kik-dark-mode-toggle"
              onClick={() => setDarkMode(!darkMode)}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-600 dark:text-slate-300"
              title="Theme toggler"
            >
              {darkMode ? <Sun className="h-3.5 w-3.5 text-yellow-500" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Date Warning Banner matching Python workflow requirements exactly */}
        <div id="kik-date-alert" className="border-2 border-red-500 rounded-lg p-3 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400">
          <div className="flex items-start space-x-2">
            <AlertOctagon className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
            <div>
              <p className="font-bold text-xs leading-tight">*** IMPORTANT DATE RANGE ***</p>
              <p className="text-[10px] mt-1 leading-normal text-red-655 dark:text-red-400 font-medium">
                Verify date parameters! Ensure start and end timestamps match the extraction log period, or the dataset render will return 0 rows.
              </p>
            </div>
          </div>
        </div>

        {/* Dynamic Filters Deck */}
        <div className="space-y-3">
          <span className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500 block">Extract Filters</span>

          {/* Senders Filter dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-505 dark:text-slate-400">Target Sender</label>
            <select
              id="kik-filter-sender"
              value={senderFilter}
              onChange={(e) => setSenderFilter(e.target.value)}
              className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200"
            >
              <option value="All Senders">All Senders</option>
              {uniqueSenders.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Align Right user Selector */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-505 dark:text-slate-400">Assign to Right Bubble (Suspect Profile)</label>
            <select
              id="kik-align-right"
              value={rightSideUser}
              onChange={(e) => setRightSideUser(e.target.value)}
              className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200"
            >
              {uniqueSenders.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Dates Deck */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Start Date</label>
              <input
                id="kik-filter-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-xs p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">End Date</label>
              <input
                id="kik-filter-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-xs p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200"
              />
            </div>
          </div>

          {/* Direct searchable filter */}
          <div className="relative">
            <span className="absolute left-3 top-2.5">
              <Search className="h-3.5 w-3.5 text-slate-400" />
            </span>
            <input
              id="kik-filter-search"
              type="text"
              placeholder="Query current dialogue..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-2 w-full text-xs border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* Highlighting Setup matching regex highlights workflow */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500 flex items-center space-x-1">
              <span>Regex Highlighter</span>
            </label>
            <button
              id="kik-toggle-highlight-state"
              onClick={() => setHighlightEnabled(!highlightEnabled)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded-full border transition-all ${
                highlightEnabled 
                  ? 'bg-yellow-100 dark:bg-yellow-950/30 text-yellow-805 border-yellow-300' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-750'
              }`}
            >
              {highlightEnabled ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>

          {/* Quick inputs to add high-risk search strings */}
          <form id="kik-add-keyword-form" onSubmit={handleAddKeyword} className="flex space-x-1">
            <input
              id="kik-new-keyword-input"
              type="text"
              placeholder="Add forensic term..."
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              className="px-2 py-1.5 w-full text-xs font-mono border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200"
            />
            <button
              id="kik-add-keyword-btn"
              type="submit"
              className="px-2.5 py-1 text-xs font-bold leading-normal bg-purple-650 hover:bg-purple-700 text-white rounded-md transition-colors"
            >
              Add
            </button>
          </form>

          {/* Keywords tags array display */}
          <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto p-1 bg-slate-50 dark:bg-slate-950/40 rounded-lg border border-slate-100 dark:border-slate-850">
            {keywords.map(term => (
              <span
                key={term}
                className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono bg-yellow-100/70 dark:bg-yellow-950/20 text-slate-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-900/40"
              >
                <span>{term}</span>
                <button
                  type="button"
                  onClick={() => handleDeleteKeyword(term)}
                  className="ml-1 text-slate-400 hover:text-red-500 text-[10px] items-center text-center justify-center font-bold"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Global Exports Deck */}
        <div className="pt-3 border-t border-slate-105 dark:border-slate-800 space-y-2">
          <span className="text-xs font-bold uppercase text-slate-400 dark:text-slate-505 block">Report Extraction</span>
          <button
            id="kik-export-html-btn"
            onClick={handleExportHtml}
            className="w-full flex items-center justify-center px-3 py-2 border border-purple-200 dark:border-purple-900 bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-xs font-bold rounded-lg transition-colors"
          >
            <FileCode2 className="h-3.5 w-3.5 mr-1.5" />
            Export Live View to HTML
          </button>
        </div>
      </div>

      {/* RIGHT COLUMN: Chat Timeline Feed View */}
      <div id="kik-chat-main-panel" className="flex-1 flex flex-col min-h-[500px]">
        
        {/* Header toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-850 bg-slate-100/50 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-250 flex items-center">
              <MessageSquare className="h-4.5 w-4.5 mr-2 text-purple-600 dark:text-purple-400" />
              Kik Forensic Bubble Thread
            </h4>
            <p className="text-[10px] text-slate-404 dark:text-slate-505 font-medium mt-0.5">
              Active Stream: {filteredMessages.length} Messages matching parameters.
            </p>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-mono bg-slate-200 dark:bg-slate-850 text-slate-650 dark:text-slate-350 px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-800">
              Aligning outbound profiles to standard rightside
            </span>
          </div>
        </div>

        {/* Chat Stream Bubble box */}
        <div 
          id="kik-bubble-container" 
          className={`flex-1 overflow-y-auto p-6 space-y-4 max-h-[800px] font-sans ${
            darkMode ? 'bg-slate-925 text-slate-100' : 'bg-slate-100 text-slate-800'
          }`}
        >
          {filteredMessages.length === 0 ? (
            <div className="h-96 flex flex-col items-center justify-center text-slate-400 dark:text-slate-600">
              <MessageSquare className="h-16 w-16 mb-2 stroke-1" />
              <p className="font-bold">No Messages Found</p>
              <p className="text-xs text-center max-w-sm mt-1">
                Please change the date sliders or targets above to render matching conversation logs.
              </p>
            </div>
          ) : (
            filteredMessages.map((m, idx) => {
              const isRight = m.sender === rightSideUser;
              const hasTag = evidenceTags[m.id]?.tagged;

              return (
                <div 
                  key={`msg-${m.id}`} 
                  id={`bubble-${m.id}`}
                  className={`flex flex-col group max-w-[80%] ${isRight ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                >
                  {/* Sender title header */}
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1 leading-normal flex items-center gap-1.5">
                    <span className="font-mono text-purple-605 dark:text-purple-400">{m.sender}</span>
                    {m.ipAddress && (
                      <span className="text-[9px] font-mono bg-slate-200 dark:bg-slate-850 px-1 py-0.2 rounded-sm text-slate-500">
                        IP: {m.ipAddress}
                      </span>
                    )}
                  </span>

                  {/* Message Bubble Container */}
                  <div className="relative flex items-stretch">
                    
                    {/* Event Tag check button overlay */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1/2 -translate-y-1/2 flex items-center space-x-1 px-2 z-10 select-none cursor-pointer"
                      style={isRight ? { left: '-90px' } : { right: '-90px' }}
                    >
                      <button
                        title="Add to Official Exhibits File"
                        onClick={() => onToggleTag(m.id)}
                        className={`p-1 rounded-md border text-[10px] font-bold flex items-center space-x-0.5 ${
                          hasTag 
                            ? 'bg-amber-100 text-amber-700 border-amber-300' 
                            : 'bg-white dark:bg-slate-850 text-slate-500 hover:text-indigo-600 border-slate-250 dark:border-slate-800 shadow-xs'
                        }`}
                      >
                        <Tag className="h-3 w-3" />
                        <span>{hasTag ? 'Tag ✅' : 'Tag'}</span>
                      </button>
                      
                      <button
                        title="View dialog surround (+/-5)"
                        onClick={() => setContextModalEvent(m)}
                        className="p-1 rounded-md bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-slate-505 hover:bg-purple-100 hover:text-purple-700 text-[10px] font-bold flex items-center shadow-xs"
                      >
                        <Eye className="h-3 w-3 mr-0.5" />
                        <span>Ctx</span>
                      </button>
                    </div>

                    {/* Styled Talk Bubble */}
                    <div 
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        isRight 
                          ? `${darkMode ? 'bg-indigo-900 border-indigo-805 text-white' : 'bg-indigo-650 text-white'} rounded-tr-xs shadow-xs text-right`
                          : `${darkMode ? 'bg-slate-800 border-slate-750 text-slate-100' : 'bg-white border-slate-200 text-slate-800'} rounded-tl-xs shadow-xs text-left`
                      }`}
                    >
                      {/* Body parsing */}
                      <p 
                        className="whitespace-pre-wrap break-all"
                        dangerouslySetInnerHTML={{ __html: highlightRegexContent(m.content) }}
                      />
                    </div>
                  </div>

                  {/* Bubble timestamps and source path metadata footer */}
                  <div className="text-[9px] text-slate-405 dark:text-slate-500 mt-1 space-x-1.5 leading-normal font-medium max-w-full truncate">
                    <span>
                      {formatLocaleTimeShortSafe(m.timestamp)}
                    </span>
                    <span>•</span>
                    <span className="font-mono bg-slate-200/50 dark:bg-slate-900/60 p-0.5 rounded-sm">
                      {m.sourceFile}
                    </span>
                  </div>

                  {/* Render exhibit note field if tagged */}
                  {hasTag && (
                    <div className="mt-1 w-full max-w-sm rounded p-2 text-[11px] bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 text-amber-800 dark:text-amber-400">
                      <span className="font-bold uppercase tracking-wide block mb-0.5">FORENSIC CASE Note</span>
                      <textarea
                        value={evidenceTags[m.id]?.notes || ''}
                        onChange={(e) => onUpdateNotes(m.id, e.target.value)}
                        placeholder="Add extraction notes, file index, or testimony relevance comments..."
                        className="w-full bg-white dark:bg-slate-950/80 border border-amber-200 dark:border-amber-900 text-slate-800 dark:text-slate-205 p-1 rounded font-sans focus:outline-hidden text-xs resize-y"
                        rows={1}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ============================================== */}
      {/* DIALOGUE +5 / -5 MULTI-MESSAGE CONTEXT MODAL VIEW */}
      {/* ============================================== */}
      {contextModalEvent && (
        <div id="kik-context-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full flex flex-col overflow-hidden text-left">
            
            {/* Modal Title Banner */}
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center">
                  <Eye className="h-4 w-4 text-purple-600 dark:text-purple-400 mr-2" />
                  Chronological Conversation Context View
                </h3>
                <p className="text-[10px] mt-0.5 text-slate-400 dark:text-slate-500 font-medium font-sans">
                  Displaying 5 messages before and 5 messages after the matched extraction point.
                </p>
              </div>
              <button
                id="close-context-modal"
                onClick={() => setContextModalEvent(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-sans font-bold text-lg p-1"
              >
                ×
              </button>
            </div>

            {/* Context Message Flow list */}
            <div className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[450px] bg-slate-50 dark:bg-slate-950">
              {contextSurroundingEvents.map((m, cIdx) => {
                const isTarget = m.id === contextModalEvent.id;
                const isRight = m.sender === rightSideUser;

                return (
                  <div
                    key={`context-flow-${m.id}`}
                    id={`context-bubble-${m.id}`}
                    className={`flex flex-col max-w-[85%] ${isRight ? 'ml-auto items-end' : 'mr-auto items-start'} ${
                      isTarget ? 'ring-2 ring-purple-500 p-2 rounded-xl bg-purple-50/50 dark:bg-purple-950/20' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 mb-1 leading-normal">
                      <span className="font-mono text-purple-600">{m.sender}</span>
                      {isTarget && (
                        <span className="font-sans px-1.5 py-0.1 text-[8px] bg-purple-600 text-white rounded-full">
                          Target Selected Document
                        </span>
                      )}
                    </div>

                    <div className={`rounded-xl px-3 py-2 text-xs leading-relaxed shadow-xs ${
                      isRight 
                        ? 'bg-indigo-650 text-white rounded-tr-xs text-right' 
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-750 text-slate-800 dark:text-slate-200 rounded-tl-xs text-left'
                    }`}>
                      <p 
                        className="whitespace-pre-wrap break-all"
                        dangerouslySetInnerHTML={{ __html: highlightRegexContent(m.content) }}
                      />
                    </div>

                    <span className="text-[8px] text-slate-400 dark:text-slate-550 mt-0.5 leading-normal">
                      {formatLocaleDateSafe(m.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Modal footer closing trigger */}
            <div className="p-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 flex justify-end">
              <button
                id="close-context-modal-footer"
                onClick={() => setContextModalEvent(null)}
                className="px-4 py-1.5 bg-slate-200 dark:bg-slate-850 hover:bg-slate-300 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg transition-colors"
              >
                Close Context Viewer
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
