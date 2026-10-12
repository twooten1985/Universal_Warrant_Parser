/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ForensicEvent, UploadedFile } from '../types';
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
  HelpCircle,
  Hash,
  Users,
  ChevronRight,
  ImageIcon,
  User,
  Filter,
  CheckSquare,
  Square
} from 'lucide-react';

interface ConversationViewerProps {
  events: ForensicEvent[];
  loadedFiles: UploadedFile[];
  activeProvider: string;
  /** Warrant-return subject / suspect username (blue bubbles). */
  suspectAccountHint?: string;
  evidenceTags: Record<string, { tagged: boolean; notes?: string }>;
  onToggleTag: (eventId: string) => void;
  onUpdateNotes: (eventId: string, notes: string) => void;
}

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


/** Rows with no real chat body (empty / IP-only / abuse-report stubs). Kept for provenance. */
function isHollowChatMessage(m: ForensicEvent): boolean {
  if (m.details?.isHollowMessage === true) return true;
  const c = (m.content || '').trim();
  if (!c || c === '[Empty Message]') return true;
  if (/^\[Network:/i.test(c)) return true;
  if (/^\[Abuse report/i.test(c)) return true;
  return false;
}

/** Chronological sort key: valid times first; unknown timestamps sort after real dialogue. */
function messageSortMs(m: ForensicEvent): number {
  const parsed = Date.parse(m.timestamp);
  return isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

interface ChatThread {
  id: string;
  name: string;
  participantNames: string[];
  messages: ForensicEvent[];
  lastMessageTimestamp: string;
  substantiveCount?: number;
  hollowCount?: number;
}

export function ConversationViewer({
  events,
  loadedFiles,
  activeProvider,
  suspectAccountHint,
  evidenceTags,
  onToggleTag,
  onUpdateNotes
}: ConversationViewerProps) {
  // Filter for message-related events
  const messageEvents = useMemo(() => {
    return events.filter(e => e.category === 'message');
  }, [events]);

  // Unique Senders inside message logs
  const uniqueSenders = useMemo(() => {
    const list = new Set<string>();
    messageEvents.forEach(m => {
      if (m.sender) list.add(m.sender);
    });
    return Array.from(list).sort();
  }, [messageEvents]);

  const [senderFilter, setSenderFilter] = useState('All Senders');
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  // Set dates default ranges based on messages time
  const defaultDates = useMemo(() => {
    if (messageEvents.length === 0) {
      return { start: '2026-06-01', end: '2026-06-30' };
    }
    const timestamps = messageEvents.map(m => new Date(m.timestamp).getTime()).filter(t => !isNaN(t));
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
  }, [messageEvents]);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Auto-initialize filter dates once default dates are extracted
  useEffect(() => {
    if (defaultDates) {
      setStartDate(defaultDates.start);
      setEndDate(defaultDates.end);
    }
  }, [defaultDates]);

  // High-risk keywords matching python parser keywords exactly plus custom helper keywords
  const suggestedKeywords = [
    'daughter', 'niece', 'fantasy', 'kids', 'child', 'young', 'underage', 'family', 'payment', 'monero', 'stash', 'xmr', 'snap', 'kik'
  ];
  // Empty by default = full thread, no filter (analyst adds ICAC terms when needed)
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');

  // Right-side align target setting (Default aligns sending profile rightwise)
  const [rightSideUser, setRightSideUser] = useState<string>('');
  const [filterToKeywordHits, setFilterToKeywordHits] = useState(false);
  const [suspectManual, setSuspectManual] = useState(false);
  // Empty keyword list = full thread (never a blank filtered view)
  useEffect(() => {
    if (keywords.length === 0 && filterToKeywordHits) {
      setFilterToKeywordHits(false);
    }
  }, [keywords, filterToKeywordHits]);


  const normUser = (s?: string | null) => (s || '').trim().replace(/^@+/, '').toLowerCase();

  /** Kik return package labels / hollow buckets — not real chat partners. */
  const isPackagingParticipant = (name?: string | null) => {
    const n = normUser(name);
    if (!n) return true;
    if (n === 'unknown' || n === 'kik registry') return true;
    if (n === 'kik return' || n === 'kik_return') return true;
    if (n.includes('warrant return')) return true;
    if (n === 'direct convo' || n === 'general') return true;
    return false;
  };

  const isPackagingThread = (thread: { id: string; name: string; messages: ForensicEvent[]; substantiveCount?: number }) => {
    const substantiveMsgs = thread.messages.filter(m => !isHollowChatMessage(m));
    // Hollow-only buckets never belong in the chat list
    if (substantiveMsgs.length === 0) return true;

    const right = normUser(rightSideUser);
    const realPartners = new Set<string>();
    substantiveMsgs.forEach(m => {
      if (m.sender && !isPackagingParticipant(m.sender) && normUser(m.sender) !== right) {
        realPartners.add(m.sender);
      }
      if (m.recipient && !isPackagingParticipant(m.recipient) && normUser(m.recipient) !== right) {
        realPartners.add(m.recipient);
      }
    });
    // Keep any thread that has a real chat partner
    if (realPartners.size > 0) return false;

    // No real partners — packaging / return-file bucket (e.g. "Chat with Kik Return")
    return true;
  };

  // Bubble color follows the Suspect control only (not a sticky account-hint override).
  const isSuspectMsg = (m: ForensicEvent) => {
    if (typeof m.details?.isFromSuspect === 'boolean') return m.details.isFromSuspect;
    return isSuspectSender(m.sender);
  };
  const isSuspectSender = (sender?: string | null) => {
    const right = normUser(rightSideUser);
    if (!right) return false;
    return normUser(sender) === right;
  };

  // Auto-pick suspect for blue bubbles unless the analyst manually chose one
  useEffect(() => {
    if (suspectManual) return;
    if (uniqueSenders.length === 0) return;

    const hint = (suspectAccountHint || '').trim();
    if (hint) {
      const exact = uniqueSenders.find(s => normUser(s) === normUser(hint));
      if (exact) {
        setRightSideUser(exact);
        return;
      }
      const owner = uniqueSenders.find(s => normUser(s) === 'account owner');
      if (owner) {
        setRightSideUser(owner);
        return;
      }
    }

    const labeled = uniqueSenders.find(s => {
      const n = normUser(s);
      return n.includes('subject') || n.includes('suspect') || n === 'account owner' || n.endsWith(' owner');
    });
    if (labeled) {
      setRightSideUser(labeled);
      return;
    }

    if (activeProvider === 'kik') {
      const sentCounts = new Map<string, number>();
      messageEvents.forEach(m => {
        const src = (m.sourceFile || '').toLowerCase();
        if (src.includes('_sent') || src.includes('sent.csv') || src.includes('chat_sent')) {
          if (m.sender && normUser(m.sender) !== 'unknown') {
            sentCounts.set(m.sender, (sentCounts.get(m.sender) || 0) + 1);
          }
        }
      });
      let best = '';
      let bestN = 0;
      sentCounts.forEach((n, s) => {
        if (n > bestN) {
          best = s;
          bestN = n;
        }
      });
      if (best) {
        setRightSideUser(best);
        return;
      }
    }

    const freq = new Map<string, number>();
    messageEvents.forEach(m => {
      if (m.sender && normUser(m.sender) !== 'unknown') {
        freq.set(m.sender, (freq.get(m.sender) || 0) + 1);
      }
    });
    let top = uniqueSenders.find(s => normUser(s) !== 'unknown') || uniqueSenders[0] || '';
    let topN = -1;
    freq.forEach((n, s) => {
      if (n > topN) {
        top = s;
        topN = n;
      }
    });
    if (top) setRightSideUser(top);
  }, [uniqueSenders, suspectAccountHint, activeProvider, messageEvents, suspectManual]);

  // Modal Context viewer tracking
  const [contextModalEvent, setContextModalEvent] = useState<ForensicEvent | null>(null);
  const [showHollowInFeed, setShowHollowInFeed] = useState(false);
  const [hollowPanelOpen, setHollowPanelOpen] = useState(false);

  // Grouping logic based on active provider to form clean separate conversations/threads
  const threads = useMemo<ChatThread[]>(() => {
    if (messageEvents.length === 0) return [];

    const threadMap = new Map<string, ForensicEvent[]>();

    if (activeProvider === 'snapchat') {
      messageEvents.forEach(m => {
        // Group by conversationId if available, otherwise fall back
        const threadId = m.details?.conversationId || m.details?.threadName || 'general';
        if (!threadMap.has(threadId)) {
          threadMap.set(threadId, []);
        }
        threadMap.get(threadId)!.push(m);
      });
    } else if (activeProvider === 'discord') {
      messageEvents.forEach(m => {
        // Group by channelId
        const threadId = m.details?.channelId || 'general';
        if (!threadMap.has(threadId)) {
          threadMap.set(threadId, []);
        }
        threadMap.get(threadId)!.push(m);
      });
    } else if (activeProvider === 'twitter') {
      messageEvents.forEach(m => {
        // Group by conversationId
        const threadId = m.details?.conversationId || 'general';
        if (!threadMap.has(threadId)) {
          threadMap.set(threadId, []);
        }
        threadMap.get(threadId)!.push(m);
      });
    } else {
      // Kik or other platforms - group by convoId, or group by chat partner (i.e. sender/recipient combinations)
      messageEvents.forEach(m => {
        let threadId = m.details?.convoId || m.details?.conversationId;
        
        if (!threadId) {
          // If no convoId, let's group by Chat Partner (the other person in the message)
          const participants = [m.sender, m.recipient].filter(Boolean).sort() as string[];
          threadId = participants.length > 0 ? participants.join(' <-> ') : 'general';
        }

        if (!threadMap.has(threadId)) {
          threadMap.set(threadId, []);
        }
        threadMap.get(threadId)!.push(m);
      });
    }

    // Convert threadMap to structured ChatThread array
    const result: ChatThread[] = [];
    threadMap.forEach((msgs, id) => {
      // Find thread name
      let name = id;
      if (activeProvider === 'snapchat') {
        const firstMsgWithThreadName = msgs.find(m => m.details?.threadName);
        name = firstMsgWithThreadName?.details?.threadName || `Snapchat Chat: ${id.substring(0, 8)}`;
      } else if (activeProvider === 'discord') {
        name = `Discord Channel: #${id}`;
      } else if (activeProvider === 'twitter') {
        if (id === 'tweets') {
          name = 'My Tweets & Posts';
        } else if (id === 'deleted-tweets') {
          name = 'My Deleted Tweets & Posts';
        } else if (id === 'likes') {
          name = 'My Liked Tweets';
        } else {
          const customName = msgs.find(m => m.details?.conversationName)?.details?.conversationName;
          if (customName) {
            name = `Twitter GDM: ${customName}`;
          } else {
            const partner = msgs.find(m => m.sender && m.sender !== rightSideUser && !m.sender.includes('@Me'))?.sender || 
                            msgs.find(m => m.recipient && m.recipient !== rightSideUser)?.recipient;
            name = partner ? `Twitter Chat with ${partner}` : `Twitter Chat ID: ${id.substring(0, 10)}`;
          }
        }
      } else if (activeProvider === 'kik') {
        const partnerName = msgs.find(m => m.recipient && normUser(m.recipient) !== normUser(rightSideUser) && !isPackagingParticipant(m.recipient))?.recipient ||
                            msgs.find(m => m.sender && normUser(m.sender) !== normUser(rightSideUser) && !isPackagingParticipant(m.sender))?.sender ||
                            msgs.find(m => m.recipient && !isPackagingParticipant(m.recipient))?.recipient ||
                            msgs.find(m => m.sender && !isPackagingParticipant(m.sender))?.sender;
        name = partnerName ? `Chat with ${partnerName}` : `Kik Thread: ${String(id).substring(0, 10)}`;
      } else if (msgs.some(m => m.details?.syncThreadName)) {
        name = `Messages with ${msgs.find(m => m.details?.syncThreadName)?.details?.syncThreadName}`;
      } else {
        name = `Conversation Thread: ${id}`;
      }

      // Collect unique participant usernames
      const participantsSet = new Set<string>();
      msgs.forEach(m => {
        if (m.sender) participantsSet.add(m.sender);
        if (m.recipient) participantsSet.add(m.recipient);
      });

      // Sort messages chronologically (unknown timestamps after dated dialogue)
      msgs.sort((a, b) => {
        const hollowDelta = Number(isHollowChatMessage(a)) - Number(isHollowChatMessage(b));
        if (hollowDelta !== 0) return hollowDelta; // real chat first within thread
        return messageSortMs(a) - messageSortMs(b);
      });

      const substantive = msgs.filter(m => !isHollowChatMessage(m));
      const lastSubstantive = substantive[substantive.length - 1];
      const lastAny = msgs[msgs.length - 1];

      result.push({
        id,
        name,
        participantNames: Array.from(participantsSet),
        messages: msgs,
        lastMessageTimestamp: lastSubstantive?.timestamp || lastAny?.timestamp || '',
        substantiveCount: substantive.length,
        hollowCount: msgs.length - substantive.length
      } as ChatThread);
    });

    // Drop packaging / hollow-only buckets (e.g. "Chat with Kik Return") — not real partners
    const cleaned = result.filter(t => !isPackagingThread(t));

    // Threads with real dialogue first, then by most recent substantive message
    return cleaned.sort((a, b) => {
      const aHas = (a.substantiveCount ?? 0) > 0 ? 1 : 0;
      const bHas = (b.substantiveCount ?? 0) > 0 ? 1 : 0;
      if (bHas !== aHas) return bHas - aHas;
      const parsedA = Date.parse(a.lastMessageTimestamp);
      const parsedB = Date.parse(b.lastMessageTimestamp);
      const tA = isNaN(parsedA) ? 0 : parsedA;
      const tB = isNaN(parsedB) ? 0 : parsedB;
      return tB - tA;
    });
  }, [messageEvents, activeProvider, rightSideUser]);

  // Selected Thread ID
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');

  // Auto-select first thread with real dialogue (skip empty-only threads)
  useEffect(() => {
    if (threads.length === 0) return;
    const stillValid = selectedThreadId && threads.some(t => t.id === selectedThreadId);
    if (stillValid) return;
    const preferred = threads.find(t => (t.substantiveCount ?? t.messages.filter(m => !isHollowChatMessage(m)).length) > 0) || threads[0];
    setSelectedThreadId(preferred.id);
  }, [threads, selectedThreadId]);

  // Get active thread
  const activeThread = useMemo(() => {
    return threads.find(t => t.id === selectedThreadId) || null;
  }, [threads, selectedThreadId]);

  // Filter messages based on GUI widgets for the active thread
  const filteredMessages = useMemo(() => {
    if (!activeThread) return [];

    let list = [...activeThread.messages];

    // Dates check
    if (startDate) {
      const startMs = new Date(startDate + 'T00:00:00').getTime();
      list = list.filter(m => {
        const parsed = Date.parse(m.timestamp);
        return isNaN(parsed) || parsed >= startMs;
      });
    }
    if (endDate) {
      const endMs = new Date(endDate + 'T23:59:59').getTime();
      list = list.filter(m => {
        const parsed = Date.parse(m.timestamp);
        return isNaN(parsed) || parsed <= endMs;
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

    // Sort: real dialogue chronologically first; hollow/meta after (or unknown ts last)
    list.sort((a, b) => {
      const hollowDelta = Number(isHollowChatMessage(a)) - Number(isHollowChatMessage(b));
      if (hollowDelta !== 0) return hollowDelta;
      return messageSortMs(a) - messageSortMs(b);
    });

    return list;
  }, [activeThread, startDate, endDate, senderFilter, searchTerm]);

  // Hollow rows from dropped packaging threads (e.g. former "Chat with Kik Return")
  // stay visible in Related return rows so provenance is not lost.
  const packagingOrphanHollows = useMemo(() => {
    if (activeProvider !== 'kik') return [] as ForensicEvent[];
    const keptIds = new Set<string>();
    threads.forEach(t => t.messages.forEach(m => keptIds.add(m.id)));
    return messageEvents.filter(m => isHollowChatMessage(m) && !keptIds.has(m.id));
  }, [activeProvider, threads, messageEvents]);

  const hollowMessages = useMemo(() => {
    const map = new Map<string, ForensicEvent>();
    filteredMessages.filter(isHollowChatMessage).forEach(m => map.set(m.id, m));
    packagingOrphanHollows.forEach(m => map.set(m.id, m));
    return Array.from(map.values());
  }, [filteredMessages, packagingOrphanHollows]);

  const chatMessages = useMemo(
    () => filteredMessages.filter(m => !isHollowChatMessage(m)),
    [filteredMessages]
  );

  // Extract ±5 chronological context events surrounding a message inside active thread
  const contextSurroundingEvents = useMemo(() => {
    if (!contextModalEvent || !activeThread) return [];
    
    const allMsgs = [...activeThread.messages].sort((a, b) => {
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
  }, [contextModalEvent, activeThread]);

  // Keyword highlighter (case-insensitive substring match).
  const keywordPattern = useMemo(() => {
    const cleaned = keywords.map(k => k.trim()).filter(Boolean);
    if (cleaned.length === 0) return null;
    const escaped = cleaned.map(k => k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
    return new RegExp('(' + escaped.join('|') + ')', 'gi');
  }, [keywords]);

  const messageHasKeyword = (m: ForensicEvent) => {
    if (!keywordPattern) return false;
    const hay = `${m.content || ''} ${m.sender || ''} ${m.recipient || ''}`;
    keywordPattern.lastIndex = 0;
    return keywordPattern.test(hay);
  };

  const messageMatchesSearch = (m: ForensicEvent, q: string) => {
    if (!q) return true;
    const hay = `${m.content || ''} ${m.sender || ''} ${m.recipient || ''} ${m.ipAddress || ''} ${m.sourceFile || ''}`.toLowerCase();
    return hay.includes(q);
  };


  const highlightRegexContent = (text: string) => {
    if (!text) return text;
    let escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Global free-text search highlight (cyan)
    const q = searchTerm.trim();
    if (q) {
      const esc = q.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const searchRe = new RegExp('(' + esc + ')', 'gi');
      escapedText = escapedText.replace(searchRe, (match) => {
        return '<mark style="background-color:#a5f3fc;color:#0e7490;padding:1px 4px;border-radius:3px;font-weight:800;border:1px solid #67e8f9">' + match + '</mark>';
      });
    }

    // Keyword highlighter (yellow) when enabled
    if (highlightEnabled && keywordPattern) {
      keywordPattern.lastIndex = 0;
      escapedText = escapedText.replace(keywordPattern, (match) => {
        return '<mark style="background-color:#fef08a;color:#1e293b;padding:1px 4px;border-radius:3px;font-weight:800;border:1px solid #fde047">' + match + '</mark>';
      });
    }
    return escapedText;
  };


  const keywordHitCount = useMemo(() => {
    if (!keywordPattern) return 0;
    return chatMessages.filter(messageHasKeyword).length;
  }, [chatMessages, keywordPattern, keywords]);

  const threadKeywordHits = useMemo(() => {
    const map = new Map<string, number>();
    if (!keywordPattern) return map;
    threads.forEach(t => {
      const n = t.messages.filter(m => !isHollowChatMessage(m) && messageHasKeyword(m)).length;
      if (n > 0) map.set(t.id, n);
    });
    return map;
  }, [threads, keywordPattern, keywords]);

  const globalKeywordHitTotal = useMemo(() => {
    let n = 0;
    threadKeywordHits.forEach(v => { n += v; });
    return n;
  }, [threadKeywordHits]);

  // Free-text search across ALL threads (not just the open one)
  const threadSearchHits = useMemo(() => {
    const map = new Map<string, number>();
    const q = searchTerm.trim().toLowerCase();
    if (!q) return map;
    threads.forEach(t => {
      const n = t.messages.filter(m => !isHollowChatMessage(m) && messageMatchesSearch(m, q)).length;
      if (n > 0) map.set(t.id, n);
    });
    return map;
  }, [threads, searchTerm]);

  const globalSearchHitTotal = useMemo(() => {
    let n = 0;
    threadSearchHits.forEach(v => { n += v; });
    return n;
  }, [threadSearchHits]);

  // Sidebar thread list: apply global search and/or keyword-only filter
  const visibleThreads = useMemo(() => {
    let list = threads;
    const q = searchTerm.trim();
    if (q) {
      list = list.filter(t => (threadSearchHits.get(t.id) || 0) > 0);
    }
    if (filterToKeywordHits && keywordPattern) {
      list = list.filter(t => (threadKeywordHits.get(t.id) || 0) > 0);
    }
    return list;
  }, [threads, searchTerm, threadSearchHits, filterToKeywordHits, keywordPattern, threadKeywordHits]);

  // When global search/keywords narrow the list, jump to first matching thread if current is hidden
  useEffect(() => {
    if (visibleThreads.length === 0) return;
    if (!visibleThreads.some(t => t.id === selectedThreadId)) {
      setSelectedThreadId(visibleThreads[0].id);
    }
  }, [visibleThreads, selectedThreadId]);

  const scrollToFirstMatch = (threadId: string, mode: 'search' | 'keyword') => {
    setSelectedThreadId(threadId);
    // Defer until the selected thread feed renders
    window.setTimeout(() => {
      const thread = threads.find(t => t.id === threadId);
      if (!thread) return;
      const q = searchTerm.trim().toLowerCase();
      const match = thread.messages.find(m => {
        if (isHollowChatMessage(m)) return false;
        if (mode === 'search') return q !== '' && messageMatchesSearch(m, q);
        return !!keywordPattern && messageHasKeyword(m);
      });
      if (!match) return;
      const el = document.getElementById('bubble-' + match.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const ring = mode === 'keyword' ? 'ring-yellow-400' : 'ring-cyan-400';
        el.classList.add('ring-2', ring);
        window.setTimeout(() => el.classList.remove('ring-2', ring), 1600);
      }
    }, 80);
  };


  const feedMessagesBase = showHollowInFeed ? filteredMessages : chatMessages;
  const feedMessages = (filterToKeywordHits && keywordPattern)
    ? feedMessagesBase.filter(messageHasKeyword)
    : feedMessagesBase;

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

  // Resolve media attachment for a message
  const getInlineMedia = (m: ForensicEvent) => {
    if (Array.isArray(m.details?.syncAttachments)) {
      // Synchronoss: exact filename match only, preferring the mms/<dir>/<date>/ path. Never guess.
      const names: string[] = m.details.syncAttachments;
      if (names.length === 0) return null;
      const paths: string[] = (m.details.syncAttachmentPaths || []).map((x: string) => x.toLowerCase());
      const norm = (f: any) => String(f.relativePath || f.name || '').replace(/\\/g, '/').toLowerCase();
      const byPath = loadedFiles.filter(f => paths.some(pp => norm(f).endsWith(pp)));
      if (byPath.length >= 1) return byPath[0];
      const byName = loadedFiles.filter(f => names.some(n => String(f.name).toLowerCase() === n.toLowerCase()));
      return byName.length === 1 ? byName[0] : null;
    }
    const mediaName = m.details?.resolvedMediaName || m.details?.mediaRef || m.details?.attachments;
    if (!mediaName) return null;

    // Search in loaded files
    const mediaFile = loadedFiles.find(f => 
      f.name === mediaName || 
      f.relativePath === mediaName ||
      f.name.toLowerCase().includes(String(mediaName).toLowerCase())
    );
    return mediaFile || null;
  };

  // Export current active conversation thread to an interactive HTML chat document
  const handleExportHtml = () => {
    if (!activeThread) return;

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${activeThread.name} - Forensic Chat Log</title>
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
      color: #4f46e5;
      margin: 0 0 6px 0;
    }
    .meta {
      font-size: 11px;
      color: #71717a;
      font-family: monospace;
      margin-bottom: 4px;
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
      background-color: ${darkMode ? '#312e81' : '#e0e7ff'};
      color: ${darkMode ? '#ffffff' : '#1e1b4b'};
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
    .media-preview {
      max-width: 300px;
      max-height: 200px;
      border-radius: 8px;
      margin-top: 8px;
      border: 1px solid #e2e8f0;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${activeThread.name}</div>
    <div class="meta"><strong>Suspect handle (blue bubbles):</strong> ${rightSideUser || 'Unassigned'}</div>
    <div class="meta">Others rendered in gray. Analyst can override via Suspect control before export.</div>
    <div class="meta"><strong>Global search:</strong> ${searchTerm.trim() ? ('"' + searchTerm.trim().replace(/"/g, '') + '" — ' + globalSearchHitTotal + ' hit(s) in ' + threadSearchHits.size + ' thread(s)') : 'none (full threads)'}</div>
    <div class="meta"><strong>Keyword highlighter:</strong> ${keywords.length ? (keywords.join(', ') + ' — ' + globalKeywordHitTotal + ' hit(s) in ' + threadKeywordHits.size + ' thread(s)' + (filterToKeywordHits ? ' [Only show hits ON]' : '')) : 'none'}</div>
    <div class="meta">Search hits marked cyan in UI; keyword hits marked yellow. Export includes the filtered thread view as displayed.</div>
    <div class="meta">Export Timestamp: ${new Date().toUTCString()}</div>
    <div class="meta">Sender filter (list only): ${senderFilter} | Match Count: ${filteredMessages.length} Messages</div>
    <div class="meta">Thread ID: ${activeThread.id} | Platform: ${activeProvider.toUpperCase()}</div>
  </div>
  <div class="timeline">
    ${filteredMessages.map(m => {
      const isRight = isSuspectMsg(m);
      let bodyHtml = m.content;
      if (highlightEnabled) {
        keywords.forEach(k => {
          const pattern = new RegExp(`\\b(${k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})\\b`, 'gi');
          bodyHtml = bodyHtml.replace(pattern, '<span class="highlight">$1</span>');
        });
      }

      const mediaFile = getInlineMedia(m);
      let mediaHtml = '';
      if (mediaFile) {
        if (mediaFile.mediaType === 'video') {
          mediaHtml = `<br/><video class="media-preview" src="${mediaFile.content}" controls></video>`;
        } else {
          mediaHtml = `<br/><img class="media-preview" src="${mediaFile.content}" alt="media attachment"/>`;
        }
      }

      return `
      <div class="message ${isRight ? 'right' : 'left'}">
        <div class="msg-header">${m.sender}</div>
        <div class="bubble">
          ${bodyHtml}
          ${mediaHtml}
        </div>
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
    a.download = `${activeProvider}_Chat_View_${activeThread.id.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`rounded-xl border ${darkMode ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'} overflow-hidden shadow-md flex flex-col lg:flex-row transition-all duration-300 text-left`}>
      
      {/* 1. THREADS LIST SIDEBAR (LEFT) */}
      <div id="conv-threads-sidebar" className="w-full lg:w-72 border-r border-slate-200 dark:border-slate-800 p-0 flex flex-col bg-white dark:bg-slate-900 shrink-0">
        <div className="p-4 border-b border-slate-150 dark:border-slate-800 bg-slate-50 dark:bg-slate-955 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <MessageSquare className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <span className="font-extrabold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">Dialogue Threads</span>
          </div>
          <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
            {threads.length}
          </span>
        </div>

        {/* Search thread */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-850">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              placeholder="Search all messages (every thread)..."
              className="pl-8 pr-3 py-1.5 w-full text-xs border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200"
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {(searchTerm.trim() || (filterToKeywordHits && keywordPattern)) && (
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                {searchTerm.trim()
                  ? (String(globalSearchHitTotal) + ' message' + (globalSearchHitTotal === 1 ? '' : 's') + ' in ' + String(threadSearchHits.size) + ' thread' + (threadSearchHits.size === 1 ? '' : 's'))
                  : (String(threadKeywordHits.size) + ' thread' + (threadKeywordHits.size === 1 ? '' : 's') + ' with keyword hits')}
                {visibleThreads.length === 0 ? ' — no matches' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Scrollable list of threads */}
        <div className="flex-1 overflow-y-auto max-h-[300px] lg:max-h-[600px] divide-y divide-slate-100 dark:divide-slate-800/60">
          {visibleThreads.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-slate-600">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs font-semibold">No dialogs found</p>
            </div>
          ) : (
            threads.map(t => {
              const isActive = t.id === selectedThreadId;
              const matchingExhibitsCount = t.messages.filter(m => evidenceTags[m.id]?.tagged).length;

              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelectedThreadId(t.id);
                    setSenderFilter('All Senders'); // Reset sender filter on thread swap
                  }}
                  className={`w-full text-left p-3.5 transition-all flex flex-col space-y-1.5 hover:bg-slate-50 dark:hover:bg-slate-850/50 ${
                    isActive
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-l-4 border-indigo-600 dark:border-indigo-500 font-medium'
                      : 'border-l-4 border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className={`text-[11.5px] font-bold truncate leading-tight flex-1 ${
                      isActive ? 'text-indigo-900 dark:text-indigo-200' : 'text-slate-705 dark:text-slate-300'
                    }`}>
                      {t.name}
                    </span>
                    <ChevronRight className={`h-3 w-3 shrink-0 ml-1.5 text-slate-400 mt-0.5 ${isActive ? 'translate-x-0.5' : ''}`} />
                  </div>
                  
                  <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                    <span>
                      {(t.substantiveCount ?? t.messages.filter(m => !isHollowChatMessage(m)).length)} chats
                      {(t.hollowCount ?? t.messages.filter(isHollowChatMessage).length) > 0
                        ? (' - ' + String(t.hollowCount ?? t.messages.filter(isHollowChatMessage).length) + ' meta')
                        : ''}
                      {threadSearchHits.get(t.id) ? (
                        <button
                          type="button"
                          title="Open thread and jump to first search hit"
                          onClick={(e) => {
                            e.stopPropagation();
                            scrollToFirstMatch(t.id, 'search');
                          }}
                          className="ml-1 px-1 py-0 rounded bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300 text-[9px] font-extrabold hover:bg-cyan-200"
                        >
                          {String(threadSearchHits.get(t.id))} search
                        </button>
                      ) : null}
                      {threadKeywordHits.get(t.id) ? (
                        <button
                          type="button"
                          title="Open thread and jump to first keyword hit"
                          onClick={(e) => {
                            e.stopPropagation();
                            scrollToFirstMatch(t.id, 'keyword');
                          }}
                          className="ml-1 px-1 py-0 rounded bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-300 text-[9px] font-extrabold hover:bg-yellow-200"
                        >
                          {String(threadKeywordHits.get(t.id))} kw
                        </button>
                      ) : null}
                    </span>
                    {matchingExhibitsCount > 0 && (
                      <span className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400 text-[9px] px-1 rounded-sm font-extrabold flex items-center gap-0.5">
                        <Tag className="h-2 w-2" /> {matchingExhibitsCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* 2. CHAT FEED CONTROLS SIDEBAR (MIDDLE/RIGHT) */}
      <div id="conv-config-sidebar" className="w-full lg:w-76 border-r border-slate-200 dark:border-slate-800 p-5 space-y-4 bg-white dark:bg-slate-905 flex flex-col justify-between shrink-0">
        <div className="space-y-4">
          {/* Interactive Dark Mode & Reset settings header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <Filter className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="font-extrabold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Feed Controls</span>
            </div>
            <button
              id="chat-dark-mode-toggle"
              onClick={() => setDarkMode(!darkMode)}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-600 dark:text-slate-300"
              title="Theme toggler"
            >
              {darkMode ? <Sun className="h-3.5 w-3.5 text-yellow-500" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Date Warning Banner matching Python workflow requirements exactly */}
          <div id="chat-date-alert" className="border-2 border-amber-500 rounded-lg p-3 bg-amber-50 dark:bg-amber-955/10 text-amber-700 dark:text-amber-450 text-[10px] leading-tight">
            <div className="flex items-start space-x-1.5">
              <AlertOctagon className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <div>
                <p className="font-bold">FORENSIC TIMESTAMP NOTICE</p>
                <p className="mt-0.5 leading-normal opacity-90">
                  Verify date sliders match target suspect log periods, or thread renders may return empty states.
                </p>
              </div>
            </div>
          </div>

          {/* Senders Filter dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">Sender Filter</label>
            <select
              id="chat-filter-sender"
              value={senderFilter}
              onChange={(e) => setSenderFilter(e.target.value)}
              className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-hidden"
            >
              <option value="All Senders">All Senders</option>
              {activeThread ? activeThread.participantNames.sort().map(s => (
                <option key={s} value={s}>{s}</option>
              )) : uniqueSenders.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Align Right user Selector */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">Suspect = blue bubbles</label>
            <select
              id="chat-align-right"
              value={rightSideUser}
              onChange={(e) => { setSuspectManual(true); setRightSideUser(e.target.value); }}
              className="w-full text-xs font-mono p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-hidden"
            >
              {activeThread ? activeThread.participantNames.sort().map(s => (
                <option key={s} value={s}>{s}</option>
              )) : uniqueSenders.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Dates Deck */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Start Date</label>
              <input
                id="chat-filter-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-xs p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-250"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">End Date</label>
              <input
                id="chat-filter-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-xs p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-250"
              />
            </div>
          </div>

          {/* Direct searchable filter */}
          <div className="relative pt-1">
            <span className="absolute left-3 top-3.5">
              <Search className="h-3.5 w-3.5 text-slate-400" />
            </span>
            <input
              id="chat-filter-search"
              type="text"
              placeholder="Query thread logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-2 w-full text-xs border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-205 focus:outline-hidden focus:ring-1 focus:ring-indigo-550"
            />
          </div>

          {/* Highlighting Setup matching regex highlights workflow */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">Keyword Highlighter</label>
              <button
                onClick={() => setHighlightEnabled(!highlightEnabled)}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-full border transition-all ${
                  highlightEnabled 
                    ? 'bg-yellow-100 dark:bg-yellow-950/30 text-yellow-800 border-yellow-300' 
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-250 dark:border-slate-750'
                }`}
              >
                {highlightEnabled ? 'ACTIVE' : 'OFF'}
              </button>
            </div>
            <div className="mb-2 text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
              {keywordPattern
                ? (String(globalKeywordHitTotal) + ' hit' + (globalKeywordHitTotal === 1 ? '' : 's') + ' across ' + String(threadKeywordHits.size) + ' thread' + (threadKeywordHits.size === 1 ? '' : 's') + ' · ' + String(keywordHitCount) + ' in open thread')
                : 'No keywords yet — full threads shown. Add a term to scan all chats.'}
            </div>
            <p className="mb-2 text-[9px] text-slate-400 dark:text-slate-500">
              <span className="inline-block px-1 rounded bg-cyan-100 text-cyan-800 mr-1 font-bold">cyan</span> global search
              <span className="inline-block px-1 rounded bg-yellow-100 text-yellow-900 mx-1 font-bold">yellow</span> keywords
            </p>

            {/* Quick inputs to add high-risk search strings */}
            
            <div className="flex flex-wrap gap-1 mb-2">
              <span className="text-[9px] font-bold uppercase text-slate-400 dark:text-slate-500 w-full">Quick ICAC terms</span>
              {suggestedKeywords.filter(t => !keywords.includes(t)).slice(0, 10).map(term => (
                <button
                  key={`suggest-${term}`}
                  type="button"
                  onClick={() => setKeywords(prev => prev.includes(term) ? prev : [...prev, term])}
                  className="px-1.5 py-0.5 text-[10px] font-mono rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-yellow-50 hover:border-yellow-300 hover:text-yellow-900"
                >
                  + {term}
                </button>
              ))}
            </div>
<div className="flex items-center gap-2">
              <form onSubmit={handleAddKeyword} className="flex space-x-1 flex-1 min-w-0">
              <input
                type="text"
                placeholder="Add risk term..."
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                className="px-2 py-1.5 w-full text-xs font-mono border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200"
              />
              <button
                type="submit"
                className="px-2 py-1.5 text-[10px] font-bold rounded-md bg-yellow-100 dark:bg-yellow-950/40 text-yellow-900 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-800 shrink-0"
              >
                Add
              </button>
              </form>
              <label className="flex items-center gap-1 cursor-pointer select-none text-[10px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={filterToKeywordHits}
                  onChange={(e) => setFilterToKeywordHits(e.target.checked)}
                  disabled={!keywordPattern}
                  className="rounded border-slate-300"
                />
                Only show hits
              </label>
            </div>

            {/* Keywords tags array display */}
            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1.5 bg-slate-50 dark:bg-slate-950/40 rounded-lg border border-slate-100 dark:border-slate-850">
              {keywords.map(term => (
                <span
                  key={term}
                  className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono bg-yellow-100/70 dark:bg-yellow-950/20 text-slate-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-900/40"
                >
                  <span>{term}</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteKeyword(term)}
                    className="ml-1 text-slate-400 hover:text-red-500 text-[10px] font-bold leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Global Exports Deck */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 block">Report Export</span>
          <button
            onClick={handleExportHtml}
            disabled={!activeThread || filteredMessages.length === 0}
            className="w-full flex items-center justify-center px-3 py-2 border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-750 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-xs font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileCode2 className="h-3.5 w-3.5 mr-1.5" />
            Export Selected Thread
          </button>
        </div>
      </div>

      {/* 3. ACTIVE CHAT FEED (RIGHT) */}
      <div id="conv-chat-main-panel" className="flex-1 min-w-0 flex flex-col min-h-[500px]">
        {/* Header toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-850 bg-slate-100/50 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center">
              {activeProvider === 'discord' ? (
                <Hash className="h-4 w-4 mr-1.5 text-indigo-500" />
              ) : (
                <MessageSquare className="h-4.5 w-4.5 mr-1.5 text-purple-600 dark:text-purple-400" />
              )}
              {activeThread ? activeThread.name : 'Forensic Dialogue Thread'}
            </h4>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">
              {chatMessages.length} chat message{chatMessages.length === 1 ? '' : 's'}
              {hollowMessages.length > 0
                ? (' - ' + hollowMessages.length + ' related empty / IP / return rows')
                : ''}
              {' '}matching filters.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {hollowMessages.length > 0 && (
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showHollowInFeed}
                  onChange={(e) => setShowHollowInFeed(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Mix empty / IP rows into chat
              </label>
            )}
            <div className="flex items-center space-x-1.5 text-[9px] font-mono bg-slate-200 dark:bg-slate-850 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-800/80">
              Active suspect: {rightSideUser || 'Unassigned'}
            </div>
          </div>
        </div>

        {/* Chat Bubble Scroll Deck */}
        <div 
          className={`flex-1 overflow-y-auto p-6 space-y-4 max-h-[800px] font-sans ${
            darkMode ? 'bg-slate-925 text-slate-100' : 'bg-slate-100 text-slate-800'
          }`}
        >
          {!showHollowInFeed && hollowMessages.length > 0 && (
            <div className={`rounded-xl border mb-4 overflow-hidden ${darkMode ? 'border-slate-700 bg-slate-900/80' : 'border-slate-200 bg-white'}`}>
              <button
                type="button"
                onClick={() => setHollowPanelOpen(o => !o)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-xs font-bold ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}
              >
                <span>
                  Related return rows ({hollowMessages.length}) — empty / IP / abuse-report{packagingOrphanHollows.length > 0 ? ' + return packaging' : ''} stubs</span>
                <span className="text-[10px] font-semibold text-slate-400">{hollowPanelOpen ? 'Hide' : 'Show'}</span>
              </button>
              {hollowPanelOpen && (
                <div className={`max-h-48 overflow-y-auto divide-y text-[11px] ${darkMode ? 'divide-slate-800 border-t border-slate-800' : 'divide-slate-100 border-t border-slate-100'}`}>
                  {hollowMessages.map(m => (
                    <div key={`hollow-${m.id}`} className="px-4 py-2 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
                      <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">{m.sender || 'Unknown'}</span>
                      <span className={`${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>{m.content}</span>
                      {m.ipAddress && (
                        <span className="font-mono text-[10px] text-slate-500">IP: {m.ipAddress}</span>
                      )}
                      <span className="text-[10px] text-slate-400">{formatLocaleTimeShortSafe(m.timestamp)}</span>
                      <span className="font-mono text-[10px] text-slate-400 truncate max-w-[220px]">{m.sourceFile}</span>
                      <button
                        type="button"
                        title="Add to Official Exhibits File"
                        onClick={() => onToggleTag(m.id)}
                        className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          evidenceTags[m.id]?.tagged
                            ? 'bg-amber-500 text-white border-amber-600'
                            : 'border-slate-200 text-slate-500 hover:text-indigo-600'
                        }`}
                      >
                        {evidenceTags[m.id]?.tagged ? 'Exhibit ✓' : 'Exhibit'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {feedMessages.length === 0 ? (
            <div className="h-96 flex flex-col items-center justify-center text-slate-400 dark:text-slate-600">
              <MessageSquare className="h-16 w-16 mb-2 stroke-1 text-slate-300 dark:text-slate-700" />
              <p className="font-bold">No matching dialogue found</p>
              <p className="text-xs text-center max-w-sm mt-1 opacity-70">
                {hollowMessages.length > 0
                  ? 'This thread only has empty / IP / return rows above. Pick another conversation or enable “Mix empty / IP rows into chat”.'
                  : 'Please adjust filters or select another conversation thread from the sidebar.'}
              </p>
            </div>
          ) : (
            feedMessages.map((m, idx) => {
              const isRight = isSuspectMsg(m);
              const hasTag = evidenceTags[m.id]?.tagged;
              const mediaFile = getInlineMedia(m);

              return (
                <div 
                  key={`msg-${m.id}`} 
                  id={`bubble-${m.id}`}
                  className={`flex flex-col group max-w-[80%] ${isRight ? 'ml-auto items-end' : 'mr-auto items-start'} min-w-0`}
                >
                  {/* Sender title header */}
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1 leading-normal flex items-center gap-1.5">
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">{m.sender}</span>
                    {m.ipAddress && (
                      <span className="text-[9px] font-mono bg-slate-200 dark:bg-slate-850 px-1 py-0.2 rounded-sm text-slate-500">
                        IP: {m.ipAddress}
                      </span>
                    )}
                  </span>

                  {/* Message Bubble Container */}
                  <div className="relative flex items-stretch min-w-0 max-w-full">
                    {/* Event Tag check button overlay */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1/2 -translate-y-1/2 flex items-center space-x-1.5 px-2 z-10 select-none cursor-pointer"
                      style={isRight ? { left: '-120px' } : { right: '-120px' }}
                    >
                      <button
                        title="Add to Official Exhibits File"
                        onClick={() => onToggleTag(m.id)}
                        className={`p-1.5 rounded-md border text-[10px] font-bold flex items-center space-x-0.5 ${
                          hasTag 
                            ? 'bg-amber-500 text-white border-amber-600' 
                            : 'bg-white dark:bg-slate-850 text-slate-600 hover:text-indigo-600 border-slate-250 dark:border-slate-800 shadow-sm'
                        }`}
                      >
                        <Tag className="h-3 w-3" />
                        <span>{hasTag ? 'Exhibit ✅' : 'Exhibit'}</span>
                      </button>
                      
                      <button
                        title="View dialogue surround (+/-5)"
                        onClick={() => setContextModalEvent(m)}
                        className="p-1.5 rounded-md bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-slate-600 hover:bg-purple-50 hover:text-purple-700 text-[10px] font-bold flex items-center shadow-sm"
                      >
                        <Eye className="h-3 w-3 mr-0.5" />
                        <span>Ctx</span>
                      </button>
                    </div>

                    {/* Styled Talk Bubble */}
                    <div 
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed min-w-0 max-w-full [overflow-wrap:anywhere] ${
                        isRight 
                          ? `${darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-blue-600 text-white'} rounded-tr-xs shadow-sm text-right`
                          : `${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-200 border-slate-300 text-slate-800'} rounded-tl-xs shadow-sm text-left`
                      }`}
                    >
                      {/* Body parsing */}
                      <p 
                        className="whitespace-pre-wrap break-words"
                        dangerouslySetInnerHTML={{ __html: highlightRegexContent(m.content) }}
                      />

                      {/* Render Inline Media Attachment if resolved */}
                      {mediaFile && (
                        <div className="mt-3.5 border-t border-slate-200/25 pt-2 flex flex-col space-y-1 items-start text-left">
                          <span className="text-[9px] uppercase tracking-wider text-slate-300 dark:text-slate-400 font-bold flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" /> Inline Attachment Resolved
                          </span>
                          <div className="max-w-[280px] max-h-[180px] rounded-lg overflow-hidden border border-slate-500/20 bg-black/40 flex items-center justify-center">
                            {mediaFile.mediaType === 'video' ? (
                              <video src={mediaFile.content} controls className="max-w-full max-h-full object-contain" />
                            ) : (
                              <img src={mediaFile.content} alt={mediaFile.name} className="max-w-full max-h-full object-contain cursor-zoom-in" />
                            )}
                          </div>
                          <span className="text-[9px] font-mono text-slate-300 mt-1 truncate max-w-full block">{mediaFile.name}</span>
                        </div>
                      )}
                      {!mediaFile && Array.isArray(m.details?.syncAttachments) && m.details.syncAttachments.length > 0 && (
                        <div className="mt-2 text-[10px] font-semibold opacity-80 break-all" title={(m.details.syncAttachmentPaths || []).join('\n')}>
                          📎 Attachment not matched: {m.details.syncAttachments.join(', ')} (load the messages/attachments/mms folder)
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bubble timestamps and source path metadata footer */}
                  <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-1.5 space-x-1.5 leading-normal font-medium max-w-full truncate">
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
                    <div className="mt-2.5 w-full max-w-md rounded-lg p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/40 text-amber-800 dark:text-amber-400 shadow-xs">
                      <span className="font-extrabold uppercase tracking-wider text-[9.5px] block mb-1">FORENSIC CASE Note</span>
                      <textarea
                        value={evidenceTags[m.id]?.notes || ''}
                        onChange={(e) => onUpdateNotes(m.id, e.target.value)}
                        placeholder="Comment on testimony relevance, identity proofing, or geolocation linkage..."
                        className="w-full bg-white dark:bg-slate-950/80 border border-amber-200 dark:border-amber-900 text-slate-800 dark:text-slate-200 p-2 rounded-lg font-sans focus:outline-hidden text-xs resize-y shadow-inner"
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 4. ±5 CONTEXT MODAL OVERLAY */}
      {contextModalEvent && activeThread && (
        <div id="conv-context-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full flex flex-col overflow-hidden text-left">
            
            {/* Modal Title Banner */}
            <div className="p-4 bg-slate-50 dark:bg-slate-955 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center">
                  <Eye className="h-4 w-4 text-purple-650 dark:text-purple-400 mr-2" />
                  Chronological Dialogue Context
                </h3>
                <p className="text-[10px] mt-0.5 text-slate-400 dark:text-slate-500 font-medium">
                  Showing 5 messages surrounding this extraction point in {activeThread.name}.
                </p>
              </div>
              <button
                onClick={() => setContextModalEvent(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-bold text-lg p-1"
              >
                ×
              </button>
            </div>

            {/* Context Message Flow list */}
            <div className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[450px] bg-slate-50 dark:bg-slate-950">
              {contextSurroundingEvents.map((m, cIdx) => {
                const isTarget = m.id === contextModalEvent.id;
                const isRight = isSuspectMsg(m);
                const mediaFile = getInlineMedia(m);

                return (
                  <div
                    key={`context-flow-${m.id}`}
                    id={`context-bubble-${m.id}`}
                    className={`flex flex-col max-w-[85%] ${isRight ? 'ml-auto items-end' : 'mr-auto items-start'} ${
                      isTarget ? 'ring-2 ring-purple-500 p-2.5 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 mb-1 leading-normal">
                      <span className="font-mono text-indigo-650 dark:text-indigo-400">{m.sender}</span>
                      {isTarget && (
                        <span className="font-sans px-1.5 py-0.2 text-[8px] bg-purple-650 text-white rounded-full">
                          Target Log Message
                        </span>
                      )}
                    </div>

                    <div className={`rounded-xl px-3 py-2 text-xs leading-relaxed shadow-xs ${
                      isRight 
                        ? 'bg-blue-600 text-white rounded-tr-xs text-right' 
                        : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 rounded-tl-xs text-left'
                    }`}>
                      <p 
                        className="whitespace-pre-wrap break-all"
                        dangerouslySetInnerHTML={{ __html: highlightRegexContent(m.content) }}
                      />

                      {mediaFile && (
                        <div className="mt-2.5 border-t border-slate-200/25 pt-1.5 flex flex-col space-y-1 items-start">
                          <div className="max-w-[200px] max-h-[120px] rounded border border-slate-500/20 bg-black/25 overflow-hidden">
                            {mediaFile.mediaType === 'video' ? (
                              <video src={mediaFile.content} controls className="max-w-full max-h-full object-contain" />
                            ) : (
                              <img src={mediaFile.content} alt={mediaFile.name} className="max-w-full max-h-full object-contain" />
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <span className="text-[8px] text-slate-400 dark:text-slate-550 mt-1 leading-normal">
                      {formatLocaleDateSafe(m.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Modal footer closing trigger */}
            <div className="p-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/45 flex justify-end">
              <button
                onClick={() => setContextModalEvent(null)}
                className="px-4 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg transition-colors"
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
