import React, { useState, useMemo, useEffect } from 'react';
import { ForensicEvent } from '../types';
import { 
  Mail, Inbox, Send, Star, Trash, Search, Tag, 
  User, Calendar, Clock, ShieldAlert, ArrowLeft,
  CheckCircle, FileText, AlertOctagon, Filter
} from 'lucide-react';

interface GmailBrowserProps {
  events: ForensicEvent[];
  evidenceTags: Record<string, { tagged: boolean; notes?: string }>;
  onToggleTag: (eventId: string) => void;
  onUpdateNotes: (eventId: string, notes: string) => void;
  userEmail?: string;
}

export function GmailBrowser({ events, evidenceTags, onToggleTag, onUpdateNotes, userEmail }: GmailBrowserProps) {
  const [selectedFolder, setSelectedFolder] = useState<'all' | 'inbox' | 'sent' | 'tagged' | 'trash'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [bodyView, setBodyView] = useState<'rendered' | 'plain'>('plain');

  // Extract all emails from events
  const emails = useMemo(() => {
    return events
      .filter(evt => evt.category === 'message' && evt.details && evt.details.isEmail)
      .map(evt => {
        const details = evt.details || {};
        return {
          id: evt.id,
          timestamp: evt.timestamp,
          from: details.from || evt.sender || 'Unknown Sender',
          to: details.to || evt.recipient || 'Unknown Recipient',
          subject: details.subject || 'No Subject',
          body: details.body || evt.content || '',
          htmlBody: details.htmlBody || '',
          labels: details.labels || [],
          ipAddress: details.ipAddress || evt.ipAddress || undefined,
          sourceFile: evt.sourceFile,
          isTagged: !!evidenceTags[evt.id]?.tagged,
          notes: evidenceTags[evt.id]?.notes || ''
        };
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [events, evidenceTags]);

  // Set the first email as default selection if none selected and emails are available
  useMemo(() => {
    if (!selectedEmailId && emails.length > 0) {
      setSelectedEmailId(emails[0].id);
    }
  }, [emails, selectedEmailId]);

  // Folders and counts
  const folderCounts = useMemo(() => {
    const counts = {
      all: emails.length,
      inbox: 0,
      sent: 0,
      tagged: 0,
      trash: 0
    };

    emails.forEach(em => {
      // Basic rule-based classification based on addresses or labels
      const fromLower = em.from.toLowerCase();
      const labels = em.labels.map(l => l.toLowerCase());
      
      if (em.isTagged) {
        counts.tagged++;
      }
      
      const isSent = labels.includes('sent') || 
                     fromLower.includes('suspect') || 
                     (userEmail && fromLower.includes(userEmail.toLowerCase()));
      
      if (isSent) {
        counts.sent++;
      } else if (labels.includes('trash') || labels.includes('deleted')) {
        counts.trash++;
      } else {
        counts.inbox++;
      }
    });

    return counts;
  }, [emails, userEmail]);

  // Filter emails based on folder and search query
  const filteredEmails = useMemo(() => {
    return emails.filter(em => {
      // Folder filter
      if (selectedFolder === 'tagged' && !em.isTagged) return false;
      
      const fromLower = em.from.toLowerCase();
      const labels = em.labels.map(l => l.toLowerCase());
      const isSent = labels.includes('sent') || 
                     fromLower.includes('suspect') || 
                     (userEmail && fromLower.includes(userEmail.toLowerCase()));
      const isTrash = labels.includes('trash') || labels.includes('deleted');

      if (selectedFolder === 'sent' && !isSent) return false;
      if (selectedFolder === 'trash' && !isTrash) return false;
      if (selectedFolder === 'inbox' && (isSent || isTrash)) return false;

      // Search filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        const matchesSubject = em.subject.toLowerCase().includes(query);
        const matchesBody = em.body.toLowerCase().includes(query);
        const matchesFrom = em.from.toLowerCase().includes(query);
        const matchesTo = em.to.toLowerCase().includes(query);
        const matchesIP = em.ipAddress ? em.ipAddress.toLowerCase().includes(query) : false;
        
        return matchesSubject || matchesBody || matchesFrom || matchesTo || matchesIP;
      }

      return true;
    });
  }, [emails, selectedFolder, searchQuery]);

  const selectedEmail = useMemo(() => {
    return emails.find(em => em.id === selectedEmailId) || null;
  }, [emails, selectedEmailId]);

  // Default to Rendered HTML when available; otherwise Plain text
  useEffect(() => {
    if (selectedEmail?.htmlBody) {
      setBodyView('rendered');
    } else {
      setBodyView('plain');
    }
  }, [selectedEmailId, selectedEmail?.htmlBody]);

  const previewSrcDoc = useMemo(() => {
    if (!selectedEmail?.htmlBody) return '';
    // Open links in a new tab; keep preview sandboxed (no scripts).
    return `<base target="_blank">${selectedEmail.htmlBody}`;
  }, [selectedEmail?.htmlBody]);

  return (
    <div id="email-browser-module" className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-[650px] flex flex-col font-sans">
      {/* Header Bar */}
      <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-950/60 rounded-lg border border-indigo-900/50 text-indigo-400">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-white font-bold text-base leading-tight">Gmail Evidence Browser</h3>
            <p className="text-xs text-slate-400 mt-0.5">Interactive parsing and exhibits marking workbench</p>
          </div>
        </div>
        
        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-500">
            <Search className="h-4 w-4" />
          </span>
          <input
            type="text"
            placeholder="Search subject, body, sender, IP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 text-slate-100 placeholder-slate-500 border border-slate-800 rounded-lg py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Main Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Folders */}
        <div className="w-48 bg-slate-950/40 border-r border-slate-800 p-3 space-y-1 hidden md:block select-none text-left">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 block mb-2 font-mono">Mailboxes</span>
          
          <button
            onClick={() => { setSelectedFolder('all'); setSelectedEmailId(null); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              selectedFolder === 'all' 
                ? 'bg-slate-800 text-white font-semibold' 
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Mail className="h-4 w-4 text-indigo-400" />
              <span>All Mail</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 font-bold text-slate-400">{folderCounts.all}</span>
          </button>

          <button
            onClick={() => { setSelectedFolder('inbox'); setSelectedEmailId(null); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              selectedFolder === 'inbox' 
                ? 'bg-slate-800 text-white font-semibold' 
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Inbox className="h-4 w-4 text-blue-400" />
              <span>Inbox</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 font-bold text-slate-400">{folderCounts.inbox}</span>
          </button>

          <button
            onClick={() => { setSelectedFolder('sent'); setSelectedEmailId(null); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              selectedFolder === 'sent' 
                ? 'bg-slate-800 text-white font-semibold' 
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Send className="h-4 w-4 text-emerald-400" />
              <span>Sent Messages</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 font-bold text-slate-400">{folderCounts.sent}</span>
          </button>

          <button
            onClick={() => { setSelectedFolder('tagged'); setSelectedEmailId(null); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              selectedFolder === 'tagged' 
                ? 'bg-amber-950/30 text-amber-300 border border-amber-900/30 font-semibold' 
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Tag className="h-4 w-4 text-amber-500" />
              <span>Tagged Evidence</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 font-bold text-amber-400">{folderCounts.tagged}</span>
          </button>

          <button
            onClick={() => { setSelectedFolder('trash'); setSelectedEmailId(null); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              selectedFolder === 'trash' 
                ? 'bg-slate-800 text-white font-semibold' 
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Trash className="h-4 w-4 text-rose-400" />
              <span>Trash & Deleted</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 font-bold text-slate-400">{folderCounts.trash}</span>
          </button>
        </div>

        {/* List of emails (Middle Pane) */}
        <div className="w-full md:w-80 border-r border-slate-800 flex flex-col overflow-y-auto select-none">
          {filteredEmails.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <Mail className="h-8 w-8 text-slate-700 mb-2" />
              <p className="text-xs font-medium">No matching emails found</p>
              <p className="text-[10px] text-slate-600 mt-1">Try adjusting your filters or search query.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-850">
              {filteredEmails.map(em => (
                <div
                  key={em.id}
                  onClick={() => setSelectedEmailId(em.id)}
                  className={`p-4 text-left cursor-pointer transition-colors ${
                    selectedEmailId === em.id 
                      ? 'bg-indigo-950/30 border-l-4 border-indigo-500' 
                      : 'hover:bg-slate-850 bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-bold text-slate-200 truncate max-w-[140px]" title={em.from}>
                      {em.from.split('<')[0].trim() || em.from}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                      {new Date(em.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <h4 className={`text-xs truncate ${em.isTagged ? 'text-amber-400 font-semibold' : 'text-slate-300'}`}>
                    {em.subject}
                  </h4>
                  <p className="text-[11px] text-slate-500 line-clamp-2 mt-1">
                    {em.body.replace(/<[^>]*>/g, '')}
                  </p>
                  
                  {/* Status indicators */}
                  <div className="flex items-center gap-2 mt-2">
                    {em.isTagged && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-950/60 text-amber-300 border border-amber-900/40">
                        <Tag className="h-2.5 w-2.5 mr-1 text-amber-500" /> Evidence
                      </span>
                    )}
                    {em.ipAddress && (
                      <span className="text-[9px] font-mono bg-rose-950/30 text-rose-300 border border-rose-900/30 rounded px-1" title="Login / Sending IP">
                        IP: {em.ipAddress}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail view pane (Right Pane) */}
        <div className="flex-1 flex flex-col bg-slate-900/40 overflow-y-auto">
          {selectedEmail ? (
            <div className="p-6 flex flex-col h-full space-y-6 text-left">
              {/* Header Details */}
              <div className="border-b border-slate-850 pb-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <h2 className="text-base font-bold text-white tracking-tight leading-tight">
                    {selectedEmail.subject}
                  </h2>
                  <button
                    onClick={() => onToggleTag(selectedEmail.id)}
                    className={`shrink-0 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      selectedEmail.isTagged
                        ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-750'
                        : 'bg-slate-800 text-amber-400 border-amber-900/40 hover:bg-slate-750'
                    }`}
                  >
                    <Tag className="h-3.5 w-3.5 mr-1.5" />
                    {selectedEmail.isTagged ? 'Tagged as Case Evidence' : 'Mark as Case Evidence'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400">
                  <div className="flex items-start space-x-2">
                    <User className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 block">Sender</span>
                      <strong className="text-slate-200 select-all">{selectedEmail.from}</strong>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <User className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 block">Recipient</span>
                      <strong className="text-slate-200 select-all">{selectedEmail.to}</strong>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <Calendar className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 block">Timestamp</span>
                      <strong className="text-slate-200">{new Date(selectedEmail.timestamp).toUTCString()}</strong>
                    </div>
                  </div>
                  {selectedEmail.ipAddress && (
                    <div className="flex items-start space-x-2">
                      <ShieldAlert className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                      <div>
                        <span className="text-[10px] uppercase font-mono tracking-wider text-rose-400 block">Login / Transport IP</span>
                        <strong className="text-rose-300 font-mono select-all">{selectedEmail.ipAddress}</strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Email Body Content */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {selectedEmail.htmlBody ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setBodyView('rendered')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                          bodyView === 'rendered'
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                        }`}
                      >
                        Rendered (HTML)
                      </button>
                      <button
                        type="button"
                        onClick={() => setBodyView('plain')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                          bodyView === 'plain'
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                        }`}
                      >
                        Plain text
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] font-semibold text-slate-400">Plain text</span>
                  )}
                </div>
                {selectedEmail.htmlBody && (
                  <p className="text-[10px] text-slate-500">
                    Sandboxed preview — scripts blocked; remote images may be missing if offline or CID-only.
                  </p>
                )}
                {bodyView === 'rendered' && selectedEmail.htmlBody ? (
                  <iframe
                    title="Email HTML preview"
                    sandbox=""
                    srcDoc={previewSrcDoc}
                    className="w-full min-h-[360px] bg-white rounded-lg border border-slate-700"
                  />
                ) : (
                  <div className="flex-1 bg-slate-950/30 p-5 rounded-xl border border-slate-850 text-slate-200 text-xs leading-relaxed font-sans whitespace-pre-wrap select-text">
                    {selectedEmail.body}
                  </div>
                )}
              </div>

              {/* Examiner Annotation Panel */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-3">
                <div className="flex items-center space-x-2">
                  <FileText className="h-4 w-4 text-amber-500" />
                  <span className="text-xs font-bold text-slate-300">Examiner Evidence Annotation</span>
                </div>
                <textarea
                  value={selectedEmail.notes}
                  onChange={(e) => onUpdateNotes(selectedEmail.id, e.target.value)}
                  placeholder="Annotate forensic findings or case relevance here... Notes are compiled automatically into the printed PDF warrant report."
                  rows={3}
                  className="w-full bg-slate-900 text-slate-100 placeholder-slate-600 border border-slate-800 rounded-lg p-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>ID: {selectedEmail.id}</span>
                  <span className="text-emerald-400 font-bold flex items-center">
                    <CheckCircle className="h-3 w-3 mr-1" /> Saves automatically
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-500">
              <Mail className="h-10 w-10 text-slate-800 mb-2" />
              <p className="text-sm font-semibold">No Email Selected</p>
              <p className="text-xs text-slate-600 mt-1">Select an email from the column to view its contents.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
