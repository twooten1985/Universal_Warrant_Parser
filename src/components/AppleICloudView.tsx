/**
 * Apple iCloud views: Overview (coverage, "No data produced", backups), Notes, iCloud Drive,
 * Contacts, Calendars, Reminders and Apple tables (bookmarks, Sign in with Apple, logs, account sheets).
 * Media previews use MediaThumb (in memory, never written to disk). Originals are only read.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useMemoTimed as useMemo } from '../lib/perfMemo'; /*uwrp-b9p*/
import { Archive, BookOpen, Calendar, CheckSquare, ChevronDown, ChevronRight, ExternalLink, File as FileIcon, Folder, HardDrive, Image as ImageIcon, LayoutGrid, Search, Table2, Users } from 'lucide-react';
import type { ForensicEvent, UploadedFile } from '../types';
import { MediaThumb } from './MediaThumb';
import { appleContext } from '../lib/appleParsers';
import { metaForEvent, metaForFile, type TagItem, type TagMap } from '../lib/exhibits';

/** Shared tag + selection state so every iCloud sub-view tags the same way. */
interface TagApi { tags: TagMap; onTag?: (items: TagItem[], tagged: boolean) => void; sel: Map<string, TagItem>; setSel: (fn: (m: Map<string, TagItem>) => Map<string, TagItem>) => void; files: UploadedFile[] }
const TagCtx = createContext<TagApi>({ tags: {}, sel: new Map(), setSel: () => {}, files: [] });
export const eventItem = (e: ForensicEvent, files: UploadedFile[]): TagItem => ({ key: e.id, meta: metaForEvent(e, files) });
export const fileItem = (f: UploadedFile): TagItem => ({ key: f.isMedia ? `media-file-${f.name}` : `icloud-file-${f.relativePath || f.name}`, meta: metaForFile(f) });
function TagButton({ item, label }: { item: TagItem; label?: boolean }) {
  const { tags, onTag } = useContext(TagCtx); const on = !!tags[item.key]?.tagged;
  return <button type="button" data-tagkey={item.key} disabled={!onTag} onClick={ev => { ev.stopPropagation(); onTag?.([item], !on); }} title={on ? 'Tagged as evidence (click to untag)' : 'Tag as evidence'}
    className={`icloud-tag inline-flex items-center gap-1 text-[13px] leading-none cursor-pointer ${on ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}>{on ? '★' : '☆'}{label && <span className="text-[11px] font-bold">{on ? 'Tagged' : 'Tag as evidence'}</span>}</button>;
}
function SelBox({ item }: { item: TagItem }) {
  const { sel, setSel } = useContext(TagCtx);
  return <input type="checkbox" className="icloud-sel cursor-pointer" checked={sel.has(item.key)} onClick={ev => ev.stopPropagation()} onChange={ev => { const c = ev.target.checked; setSel(m => { const x = new Map(m); c ? x.set(item.key, item) : x.delete(item.key); return x; }); }} />;
}
function BulkBar({ all }: { all: TagItem[] }) {
  const { sel, setSel, onTag } = useContext(TagCtx);
  if (!all.length) return null;
  return <div className="flex items-center gap-2 text-[11px]" id="icloud-bulk">
    <label className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={all.length > 0 && all.every(i => sel.has(i.key))} onChange={ev => { const c = ev.target.checked; setSel(m => { const x = new Map(m); all.forEach(i => c ? x.set(i.key, i) : x.delete(i.key)); return x; }); }} />Select all ({all.length})</label>
    <span className="font-bold text-slate-600">{sel.size} selected</span>
    <button type="button" id="icloud-tag-selected" disabled={!sel.size || !onTag} onClick={() => { onTag?.([...sel.values()], true); setSel(() => new Map()); }} className="px-2 py-1 rounded-md bg-amber-500 text-white font-bold disabled:opacity-40 cursor-pointer">★ Tag selected</button>
    <button type="button" disabled={!sel.size || !onTag} onClick={() => { onTag?.([...sel.values()], false); setSel(() => new Map()); }} className="px-2 py-1 rounded-md border border-slate-300 font-bold disabled:opacity-40 cursor-pointer">Untag selected</button>
  </div>;
}
export interface BackupSummaryItem { dir: string; id: string; account: string; encrypted: boolean; device: Record<string, any>; counts: Record<string, number> }

type Sub = 'overview' | 'notes' | 'drive' | 'contacts' | 'calendars' | 'reminders' | 'tables' | 'backups';

interface Props {
  events: ForensicEvent[];
  files: UploadedFile[];
  caseId: string;
  accountFilter: string;
  onOpenMedia: (name: string) => void;
  onSearchTimeline: (term: string) => void;
  /** Starting sub-view (tests / deep links). */
  initialSub?: Sub;
  /** Evidence tags (shared case DB) and the tag handler (single + bulk). */
  tags?: TagMap;
  onTag?: (items: TagItem[], tagged: boolean) => void;
  /** Parsed iOS backups (desktop) are handed up so messages/calls join the timeline. */
  onBackupEvents?: (events: ForensicEvent[]) => void;
  /** Tests: pre-parsed backup summary instead of asking the desktop app. */
  backupSummary?: BackupSummaryItem[];
}

const NOTE_FILES = /^(summary|downloadsummary|metadata)\.txt$/i;
const fmtBytes = (n?: number) => n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
const fmtTime = (t?: string) => !t || t === 'Unknown' ? '' : /^\d{4}-\d{2}-\d{2}T/.test(t) ? new Date(t).toLocaleString() : t;
const TYPE_LABEL: Record<string, string> = {
  ACCOUNT: 'Account information', BACKUP: 'iCloud Backup', BOOKMARKS: 'Bookmarks', CALENDARS: 'Calendars', CONTACTS: 'Contacts', ICLOUDDRIVE: 'iCloud Drive',
  MAIL: 'Mail', MAILHEADER: 'Mail headers', MAPS: 'Maps', MESSAGESINICLOUD: 'Messages in iCloud', NOTES: 'Notes', CLOUDPHOTOLIBRARY: 'iCloud Photos',
  ICLOUDREMINDERS: 'Reminders', SAFARIBROWSINGHISTORY: 'Safari history', SIGNINWITHAPPLE: 'Sign in with Apple', 'ICLOUD-LOG': 'iCloud logs', 'MAIL-LOG': 'Mail logs',
  'FACETIME-LOG': 'FaceTime logs', 'IMESSAGE-LOG': 'iMessage logs', LOG: 'Logs', // uwrp-b7 bash layout
};
const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl';
const th = 'text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold px-2 py-1.5 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900';
const td = 'px-2 py-1.5 border-b border-slate-100 dark:border-slate-800/60 align-top text-xs text-slate-700 dark:text-slate-300';

export function fileAppleCtx(f: UploadedFile) { return appleContext(f.relativePath || f.name); }

function NoData({ label, note }: { label: string; note?: string }) {
  return (
    <div className={`${card} p-4 border-dashed`}>
      <div className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</div>
      <div className="text-[11px] text-slate-400 mt-1">No data produced{note ? ` — ${note}` : ' by Apple for this account.'}</div>
    </div>
  );
}

export function AppleICloudView({ events, files, caseId, accountFilter, onOpenMedia, onSearchTimeline, initialSub, tags = {}, onTag, onBackupEvents, backupSummary }: Props) {
  const [sub, setSub] = useState<Sub>(initialSub || 'overview');
  const [sel, setSelState] = useState<Map<string, TagItem>>(new Map());
  const setSel = (fn: (m: Map<string, TagItem>) => Map<string, TagItem>) => setSelState(fn);
  const [q, setQ] = useState('');

  const appleFiles = useMemo(() => files.map(f => ({ f, ctx: fileAppleCtx(f) })).filter(x => x.ctx.type && /^\d+$/.test(x.ctx.account)), [files]);
  const visibleFiles = useMemo(() => {
    if (!accountFilter || accountFilter === 'all') return appleFiles;
    return appleFiles.filter(x => accountFilter === x.ctx.account || accountFilter.endsWith('::' + x.ctx.account) || accountFilter.includes(x.ctx.account));
  }, [appleFiles, accountFilter]);
  const ev = (re: RegExp, kind?: string) => events.filter(e => re.test(String(e.details?.appleType || '')) && (!kind || e.details?.kind === kind));

  // coverage: account -> type -> {files, real}
  const coverage = useMemo(() => {
    const m = new Map<string, Map<string, { files: number; real: number; note?: string }>>();
    for (const { f, ctx } of visibleFiles) {
      const a = m.get(ctx.account) || new Map(); m.set(ctx.account, a);
      const t = a.get(ctx.type) || { files: 0, real: 0 }; a.set(ctx.type, t);
      t.files++; if (!NOTE_FILES.test(f.name)) t.real++;
    }
    for (const e of events) {
      if (!e.details?.appleType || !(e.details.kind === 'production-note' || e.details.kind === 'no-data')) continue;
      const a = m.get(String(e.details.appleAccount)); const t = a?.get(String(e.details.appleType));
      if (t && !t.note) t.note = String(e.content || '').replace(/^[^:]*:\s*/, '').slice(0, 160);
    }
    return m;
  }, [visibleFiles, events]);
  const accounts = [...coverage.keys()].sort();
  const isEmpty = (type: string) => accounts.length > 0 && accounts.every(a => { const t = coverage.get(a)?.get(type); return !t || t.real === 0; });
  const emptyCards = (type: string) => accounts.filter(a => { const t = coverage.get(a)?.get(type); return t && t.real === 0; })
    .map(a => <NoData key={a} label={`${TYPE_LABEL[type] || type} · account ${a}`} note={coverage.get(a)?.get(type)?.note} />);

  const match = (s: unknown) => !q || String(s ?? '').toLowerCase().includes(q.toLowerCase());

  const tabs: Array<{ id: Sub; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { id: 'notes', label: 'Notes', icon: <BookOpen className="h-3.5 w-3.5" />, count: ev(/NOTES/, 'note').length },
    { id: 'drive', label: 'iCloud Drive', icon: <HardDrive className="h-3.5 w-3.5" />, count: visibleFiles.filter(x => x.ctx.type === 'ICLOUDDRIVE' && !NOTE_FILES.test(x.f.name)).length },
    { id: 'contacts', label: 'Contacts', icon: <Users className="h-3.5 w-3.5" />, count: events.filter(e => e.details?.kind === 'contact').length },
    { id: 'calendars', label: 'Calendars', icon: <Calendar className="h-3.5 w-3.5" />, count: events.filter(e => e.details?.kind === 'calendar-event').length },
    { id: 'reminders', label: 'Reminders', icon: <CheckSquare className="h-3.5 w-3.5" />, count: events.filter(e => e.details?.kind === 'reminder').length },
    { id: 'tables', label: 'Logs & tables', icon: <Table2 className="h-3.5 w-3.5" />, count: events.filter(e => e.details?.sheet).length },
    { id: 'backups', label: 'Backups', icon: <Archive className="h-3.5 w-3.5" /> },
  ];

  return (
    <TagCtx.Provider value={{ tags, onTag, sel, setSel, files }}>
    <div id="tabview-icloud" className="space-y-4 text-left animate-fadeIn">
      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map(t => (
          <button key={t.id} id={`icloud-sub-${t.id}`} type="button" onClick={() => { setSub(t.id); setSel(() => new Map()); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${sub === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50'}`}>
            {t.icon}<span>{t.label}</span>{t.count != null && <span className={`text-[10px] px-1.5 rounded-full ${sub === t.id ? 'bg-indigo-500' : 'bg-slate-100 dark:bg-slate-800'}`}>{t.count}</span>}
          </button>
        ))}
        {sub !== 'overview' && sub !== 'backups' && sub !== 'drive' && (
          <div className="ml-auto relative"><Search className="h-3.5 w-3.5 absolute left-2 top-2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="pl-7 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 w-56" /></div>
        )}
      </div>

      {sub === 'overview' && <Overview coverage={coverage} accounts={accounts} onPick={setSub} />}
      {sub === 'notes' && <Notes events={ev(/NOTES/, 'note').filter(e => match(e.content))} files={visibleFiles.filter(x => x.ctx.type === 'NOTES' && x.f.isMedia).map(x => x.f)} caseId={caseId} onOpenMedia={onOpenMedia} empty={isEmpty('NOTES')} emptyCards={emptyCards('NOTES')} />}
      {sub === 'drive' && <Drive files={visibleFiles.filter(x => x.ctx.type === 'ICLOUDDRIVE')} caseId={caseId} onOpenMedia={onOpenMedia} emptyCards={emptyCards('ICLOUDDRIVE')} />}
      {sub === 'contacts' && <Contacts events={events.filter(e => e.details?.kind === 'contact' && match(JSON.stringify(e.details)))} onSearch={onSearchTimeline} emptyCards={emptyCards('CONTACTS')} />}
      {sub === 'calendars' && <Calendars events={events.filter(e => e.details?.kind === 'calendar-event' && match(JSON.stringify(e.details)))} onSearch={onSearchTimeline} emptyCards={emptyCards('CALENDARS')} />}
      {sub === 'reminders' && <Reminders events={events.filter(e => e.details?.kind === 'reminder' && match(e.content))} emptyCards={emptyCards('ICLOUDREMINDERS')} />}
      {sub === 'tables' && <Tables events={events.filter(e => e.details?.sheet && match(JSON.stringify(e.details)))} emptyCards={[...emptyCards('BOOKMARKS'), ...emptyCards('SIGNINWITHAPPLE'), ...emptyCards('SAFARIBROWSINGHISTORY'), ...emptyCards('MAPS')]} />}
      {sub === 'backups' && <Backups files={visibleFiles.filter(x => x.ctx.type === 'BACKUP')} accounts={accounts} coverage={coverage} onBackupEvents={onBackupEvents} summary={backupSummary} />}
    </div>
    </TagCtx.Provider>
  );
}

function Overview({ coverage, accounts, onPick }: { coverage: Map<string, Map<string, { files: number; real: number; note?: string }>>; accounts: string[]; onPick: (s: Sub) => void }) {
  const types = Object.keys(TYPE_LABEL).filter(t => accounts.some(a => coverage.get(a)?.has(t)));
  const jump: Record<string, Sub> = { NOTES: 'notes', ICLOUDDRIVE: 'drive', CONTACTS: 'contacts', CALENDARS: 'calendars', ICLOUDREMINDERS: 'reminders', BACKUP: 'backups', BOOKMARKS: 'tables', SIGNINWITHAPPLE: 'tables', 'ICLOUD-LOG': 'tables', 'MAIL-LOG': 'tables', 'FACETIME-LOG': 'tables', 'IMESSAGE-LOG': 'tables', ACCOUNT: 'tables' };
  if (!accounts.length) return <div className={`${card} p-6 text-xs text-slate-500`}>No Apple iCloud files are loaded. Use <b>Import Apple .zip.gpg…</b> or <b>Open extracted Apple return folder…</b>.</div>;
  return (
    <div className={`${card} p-4 overflow-auto`}>
      <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">What Apple produced ({accounts.length} account{accounts.length === 1 ? '' : 's'})</div>
      <table className="w-full"><thead><tr><th className={th}>Data type</th>{accounts.map(a => <th key={a} className={th}>{a}</th>)}</tr></thead>
        <tbody>{types.map(t => (
          <tr key={t}><td className={td}>{jump[t] ? <button type="button" className="text-indigo-600 hover:underline cursor-pointer" onClick={() => onPick(jump[t])}>{TYPE_LABEL[t]}</button> : TYPE_LABEL[t]}</td>
            {accounts.map(a => { const c = coverage.get(a)?.get(t); return <td key={a} className={td}>{!c ? <span className="text-slate-400">not produced</span> : c.real ? <span className="text-emerald-600 font-semibold">{c.real} file{c.real === 1 ? '' : 's'}</span> : <span className="text-slate-400" title={c.note}>No data produced</span>}</td>; })}
          </tr>))}</tbody></table>
      <p className="text-[11px] text-slate-400 mt-2">Messages appear in Conversation View, mail in the Mail tab, photos in the Media Vault, and every record in the Chronology Timeline.</p>
    </div>
  );
}

function Notes({ events, files, caseId, onOpenMedia, empty, emptyCards }: { events: ForensicEvent[]; files: UploadedFile[]; caseId: string; onOpenMedia: (n: string) => void; empty: boolean; emptyCards: React.ReactNode[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const folderOf = (e: ForensicEvent) => String(e.details?.folder || '');
  const cur = events.find(e => e.id === sel) || events[0];
  const imgs = cur ? files.filter(f => (f.relativePath || '').replace(/\\/g, '/').split('/').slice(-2, -1)[0] === folderOf(cur)) : [];
  const { files: allFiles } = useContext(TagCtx);
  if (!events.length) return <div className="space-y-2">{empty || emptyCards.length ? emptyCards : <div className={`${card} p-4 text-xs text-slate-500`}>No notes match.</div>}</div>;
  return (<div className="space-y-2"><BulkBar all={[...events.map(e => eventItem(e, allFiles)), ...files.map(fileItem)]} />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className={`${card} max-h-[640px] overflow-auto`}>
        {events.map(e => (
          <button key={e.id} type="button" onClick={() => setSel(e.id)} className={`w-full text-left px-3 py-2 border-b border-slate-100 dark:border-slate-800 cursor-pointer ${cur?.id === e.id ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5"><SelBox item={eventItem(e, allFiles)} /><TagButton item={eventItem(e, allFiles)} />{String(e.details?.title || 'Untitled note')}</div>
            <div className="text-[10px] text-slate-400 truncate">{folderOf(e) || '—'} · {fmtTime(e.timestamp)} · acct {String(e.details?.appleAccount || '')}</div>
          </button>))}
      </div>
      <div className={`${card} md:col-span-2 p-4 max-h-[640px] overflow-auto`}>
        {cur && <>
          <div className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">{String(cur.details?.title || 'Untitled note')}<TagButton item={eventItem(cur, allFiles)} label /></div>
          <div className="text-[11px] text-slate-400 mb-3">Folder: {folderOf(cur) || '—'} · {fmtTime(cur.timestamp) || 'date not stated'} · {cur.sourceFile}</div>
          <pre className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300 font-sans">{String(cur.details?.body ?? cur.content)}</pre>
          {imgs.length > 0 && <div className="mt-4"><div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Images in this note folder ({imgs.length})</div>
            <div className="grid grid-cols-3 gap-2">{imgs.map(f => <div key={f.relativePath || f.name}><button type="button" onClick={() => onOpenMedia(f.name)} className="cursor-pointer"><MediaThumb file={f} caseId={caseId} mode="blur" revealOnHover /></button><div className="flex items-center gap-1 text-[10px]"><SelBox item={fileItem(f)} /><TagButton item={fileItem(f)} />{f.name}</div></div>)}</div></div>}
        </>}
      </div>
    </div></div>
  );
}

interface TreeNode { name: string; children: Map<string, TreeNode>; file?: UploadedFile }
function Drive({ files, caseId, onOpenMedia, emptyCards }: { files: Array<{ f: UploadedFile; ctx: ReturnType<typeof appleContext> }>; caseId: string; onOpenMedia: (n: string) => void; emptyCards: React.ReactNode[] }) {
  const real = files.filter(x => !NOTE_FILES.test(x.f.name));
  const root = useMemo(() => {
    const r: TreeNode = { name: '', children: new Map() };
    for (const { f, ctx } of real) {
      const parts = (f.relativePath || f.name).replace(/\\/g, '/').split('/');
      const i = parts.findIndex(p => /^\d+-ICLOUDDRIVE-\d+/i.test(p) || p === 'ICLOUDDRIVE');
      const rest = [`Account ${ctx.account}`, ...parts.slice(i + 1).filter(p => p !== ctx.account && p !== ctx.identifier)];
      let n = r;
      rest.forEach((p, k) => {
        if (!n.children.has(p)) n.children.set(p, { name: p, children: new Map() });
        n = n.children.get(p)!;
        if (k === rest.length - 1) n.file = f;
      });
    }
    return r;
  }, [real]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<UploadedFile | null>(null);
  if (!real.length) return <div className="space-y-2">{emptyCards.length ? emptyCards : <div className={`${card} p-4 text-xs text-slate-500`}>No iCloud Drive files loaded.</div>}</div>;
  const render = (n: TreeNode, pathKey: string, depth: number): React.ReactNode => [...n.children.values()].sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name)).map(c => {
    const key = pathKey + '/' + c.name; const isOpen = (depth <= 2) !== open.has(key); // top three levels start open
    if (c.file && !c.children.size) return (
      <button key={key} type="button" onClick={() => setSel(c.file!)} style={{ paddingLeft: 8 + depth * 14 }} className={`w-full text-left flex items-center gap-1.5 py-1 pr-2 text-xs cursor-pointer ${sel === c.file ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
        <SelBox item={fileItem(c.file)} /><TagButton item={fileItem(c.file)} />{c.file.isMedia ? <ImageIcon className="h-3.5 w-3.5 text-emerald-500" /> : <FileIcon className="h-3.5 w-3.5 text-slate-400" />}<span className="truncate flex-1">{c.name}</span><span className="text-[10px] text-slate-400">{fmtBytes(c.file.size)}</span></button>);
    return (<div key={key}>
      <button type="button" onClick={() => setOpen(s => { const x = new Set(s); x.has(key) ? x.delete(key) : x.add(key); return x; })} style={{ paddingLeft: 8 + depth * 14 }} className="w-full text-left flex items-center gap-1.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}<Folder className="h-3.5 w-3.5 text-amber-500" />{c.name}</button>
      {isOpen && render(c, key, depth + 1)}</div>);
  });
  return (<div className="space-y-2"><BulkBar all={real.map(x => fileItem(x.f))} />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className={`${card} md:col-span-2 max-h-[640px] overflow-auto py-1`}>{render(root, '', 0)}</div>
      <div className={`${card} p-4`}>
        {!sel ? <div className="text-xs text-slate-400">Select a file to see its details.</div> : <>
          <div className="text-sm font-bold break-all text-slate-800 dark:text-slate-100">{sel.name}</div><TagButton item={fileItem(sel)} label />
          <dl className="text-[11px] mt-2 space-y-1 text-slate-600 dark:text-slate-300">
            <div><dt className="inline font-bold">Size: </dt><dd className="inline">{fmtBytes(sel.size)}</dd></div>
            <div><dt className="inline font-bold">Path in return: </dt><dd className="inline break-all">{sel.relativePath}</dd></div>
            <div><dt className="inline font-bold">Modified: </dt><dd className="inline">{fmtTime((sel as any).capturedAt) || 'not stated by Apple'}</dd></div>
            <div><dt className="inline font-bold">SHA-256: </dt><dd className="inline font-mono break-all">{sel.sha256 || 'computed when the case is hashed (Media Vault / hash audit)'}</dd></div>
          </dl>
          {sel.isMedia
            ? <div className="mt-3"><MediaThumb file={sel} caseId={caseId} mode="blur" revealOnHover /><button type="button" onClick={() => onOpenMedia(sel.name)} className="mt-2 text-xs font-bold text-indigo-600 hover:underline cursor-pointer">Open in Media Vault</button></div>
            : <button type="button" disabled={!sel.sourcePath || !window.forensicDesktop?.openExternal} onClick={() => sel.sourcePath && window.forensicDesktop?.openExternal?.(sel.sourcePath)} className="mt-3 inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-40 cursor-pointer"><ExternalLink className="h-3.5 w-3.5" />Open externally</button>}
        </>}
      </div>
    </div></div>
  );
}

function TagCell({ e }: { e: ForensicEvent }) { const { files } = useContext(TagCtx); const it = eventItem(e, files); return <td className={td + ' whitespace-nowrap'}><SelBox item={it} /> <TagButton item={it} /></td>; }
function useEventItems(events: ForensicEvent[]) { const { files } = useContext(TagCtx); return useMemo(() => events.map(e => eventItem(e, files)), [events, files]); }
function Contacts({ events, onSearch, emptyCards }: { events: ForensicEvent[]; onSearch: (t: string) => void; emptyCards: React.ReactNode[] }) {
  const all = useEventItems(events);
  if (!events.length) return <div className="space-y-2">{emptyCards.length ? emptyCards : <div className={`${card} p-4 text-xs text-slate-500`}>No contacts match.</div>}</div>;
  const link = (v: string) => v.split(/;\s*/).filter(Boolean).map(x => <button key={x} type="button" onClick={() => onSearch(x.replace(/[^\d+@.\w-]/g, ''))} title="Find in timeline (messages, calls, logs)" className="block text-left text-indigo-600 hover:underline cursor-pointer">{x}</button>);
  return (
    <div className="space-y-2"><BulkBar all={all} /><div className={`${card} max-h-[680px] overflow-auto`}>
      <table className="w-full"><thead><tr>{['Tag', 'Name', 'Phones', 'Emails', 'Organization', 'Addresses', 'Account'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{events.map(e => (
          <tr key={e.id}><TagCell e={e} /><td className={td + ' font-semibold'}>{String(e.details?.name || '')}</td><td className={td}>{link(String(e.details?.phones || ''))}</td><td className={td}>{link(String(e.details?.emails || ''))}</td>
            <td className={td}>{String(e.details?.org || '')}</td><td className={td}>{String(e.details?.addresses || '')}</td><td className={td}>{String(e.details?.appleAccount || '')}</td></tr>))}</tbody></table>
    </div></div>
  );
}

function Calendars({ events, onSearch, emptyCards }: { events: ForensicEvent[]; onSearch: (t: string) => void; emptyCards: React.ReactNode[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, ForensicEvent[]>();
    for (const e of [...events].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))) { const k = String(e.details?.calendar || 'Calendar'); m.set(k, [...(m.get(k) || []), e]); }
    return [...m.entries()];
  }, [events]);
  const all = useEventItems(events);
  if (!events.length) return <div className="space-y-2">{emptyCards.length ? emptyCards : <div className={`${card} p-4 text-xs text-slate-500`}>No calendar events match.</div>}</div>;
  return (
    <div className="space-y-3"><BulkBar all={all} />{groups.map(([cal, list]) => (
      <div key={cal} className={`${card} overflow-auto`}>
        <div className="px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800">{cal} <span className="text-slate-400 font-normal">({list.length})</span></div>
        <table className="w-full"><thead><tr>{['Tag', 'Title', 'Start', 'End', 'Location', 'Attendees', 'Notes', ''].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{list.map(e => (
            <tr key={e.id}><TagCell e={e} /><td className={td + ' font-semibold'}>{String(e.details?.summary || '(no title)')}</td><td className={td}>{fmtTime(String(e.details?.start || e.timestamp))}</td><td className={td}>{fmtTime(String(e.details?.end || ''))}</td>
              <td className={td}>{String(e.details?.location || '')}</td><td className={td}>{String(e.details?.attendees || '')}</td><td className={td + ' whitespace-pre-wrap max-w-xs'}>{String(e.details?.description || '').slice(0, 400)}</td>
              <td className={td}><button type="button" className="text-indigo-600 hover:underline text-[11px] cursor-pointer" onClick={() => onSearch(String(e.id))}>Timeline</button></td></tr>))}</tbody></table>
      </div>))}</div>
  );
}

function Reminders({ events, emptyCards }: { events: ForensicEvent[]; emptyCards: React.ReactNode[] }) {
  const all = useEventItems(events);
  if (!events.length) return <div className="space-y-2">{emptyCards.length ? emptyCards : <div className={`${card} p-4 text-xs text-slate-500`}>No reminders match.</div>}</div>;
  return (
    <div className="space-y-2"><BulkBar all={all} /><div className={`${card} max-h-[680px] overflow-auto`}><table className="w-full"><thead><tr>{['Tag', 'Reminder', 'List', 'Date', 'Account'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{events.map(e => <tr key={e.id}><TagCell e={e} /><td className={td + ' whitespace-pre-wrap'}>{String(e.details?.title || e.content).slice(0, 600)}</td><td className={td}>{String(e.details?.folder || e.details?.calendar || '')}</td><td className={td}>{fmtTime(e.timestamp)}</td><td className={td}>{String(e.details?.appleAccount || '')}</td></tr>)}</tbody></table></div></div>
  );
}

function Tables({ events, emptyCards }: { events: ForensicEvent[]; emptyCards: React.ReactNode[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, ForensicEvent[]>();
    for (const e of events) { const k = `${String(e.details?.sheet)} · ${e.details?.appleAccount && /^\d+$/.test(String(e.details.appleAccount)) ? 'account ' + e.details.appleAccount : 'all accounts'}`; m.set(k, [...(m.get(k) || []), e]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);
  const [open, setOpen] = useState<string | null>(null);
  const { files } = useContext(TagCtx);
  return (
    <div className="space-y-2">
      {groups.map(([k, list]) => {
        const cols = [...new Set(list.flatMap(e => Object.keys(e.details || {}).filter(c => !['appleType', 'appleAccount', 'sheet', 'sheetTimezone'].includes(c))))].slice(0, 14);
        const isOpen = open === k;
        return (<div key={k} className={card}>
          <button type="button" onClick={() => setOpen(isOpen ? null : k)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">{isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{k}<span className="text-slate-400 font-normal">({list.length} rows · times shown in your local zone)</span></button>
          {isOpen && <div className="px-3 pb-1"><BulkBar all={list.slice(0, 2000).map(e => eventItem(e, files))} /></div>}
          {isOpen && <div className="max-h-[520px] overflow-auto"><table className="w-full"><thead><tr><th className={th}>Tag</th><th className={th}>Time</th>{cols.map(c => <th key={c} className={th}>{c}</th>)}</tr></thead>
            <tbody>{list.slice(0, 2000).map(e => <tr key={e.id}><TagCell e={e} /><td className={td}>{fmtTime(e.timestamp)}</td>{cols.map(c => <td key={c} className={td}>{String(e.details?.[c] ?? '')}</td>)}</tr>)}</tbody></table>
            {list.length > 2000 && <p className="text-[11px] text-slate-400 p-2">Showing the first 2,000 rows. All rows are in the Chronology Timeline.</p>}</div>}
        </div>);
      })}
      {!groups.length && !emptyCards.length && <div className={`${card} p-4 text-xs text-slate-500`}>No Apple tables loaded. Spreadsheets are read when the return is imported with the Apple buttons or the Folder button.</div>}
      {emptyCards}
    </div>
  );
}

function Backups({ files, accounts, coverage, onBackupEvents, summary }: { files: Array<{ f: UploadedFile; ctx: ReturnType<typeof appleContext> }>; accounts: string[]; coverage: Map<string, Map<string, { files: number; real: number; note?: string }>>; onBackupEvents?: (e: ForensicEvent[]) => void; summary?: BackupSummaryItem[] }) {
  const byAcct = (a: string) => files.filter(x => x.ctx.account === a && !NOTE_FILES.test(x.f.name));
  const rootFor = (a: string) => { const f = byAcct(a).find(x => /^(Manifest\.db|Manifest\.plist|Info\.plist|Status\.plist)$/i.test(x.f.name)) || byAcct(a)[0]; return f?.f.sourcePath ? f.f.sourcePath.replace(/[\\/][^\\/]+$/, '') : ''; };
  const roots = accounts.map(rootFor).filter(Boolean);
  const [parsed, setParsed] = useState<BackupSummaryItem[] | null>(summary || null);
  const [state, setState] = useState<string>('');
  useEffect(() => {
    if (summary || !roots.length || !window.forensicDesktop?.appleBackupSummary) return;
    let alive = true; setState('Reading backups (read-only)…');
    window.forensicDesktop.appleBackupSummary(roots).then(r => { if (!alive) return; setParsed(r.backups || []); setState(''); onBackupEvents?.(r.events || []); }).catch(e => alive && setState(String(e?.message || e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.join('|')]);
  const open = (root: string) => window.forensicDesktop?.openAppleBackups ? window.forensicDesktop.openAppleBackups(root) : alert('The backup viewer needs the desktop app.');
  const LABEL: Record<string, string> = { messages: 'Messages', attachments: 'Attachments', calls: 'Calls', contacts: 'Contacts', photos: 'Photos', notes: 'Notes', safari: 'Safari visits', calendar: 'Calendar events', apps: 'Apps', files: 'Files' };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><button id="open-backup-viewer" type="button" onClick={() => open(roots[0] || '')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold cursor-pointer"><Archive className="h-3.5 w-3.5" />Open backup viewer</button>
        <span className="text-[11px] text-slate-400">iOS backups (Manifest.db) are parsed read-only. Messages and calls also appear in the Chronology Timeline labelled “iOS backup”. Tags made in the viewer are saved in this case.</span>{state && <span className="text-[11px] text-indigo-600">{state}</span>}</div>
      {!accounts.length && <NoData label="iCloud Backup" note="no Apple return is loaded." />}
      {accounts.map(a => {
        const list = byAcct(a); const c = coverage.get(a)?.get('BACKUP');
        if (!list.length) return <NoData key={a} label={`iCloud Backup · account ${a}`} note={c ? c.note || 'Apple supplied only a summary file.' : 'BACKUP was not part of this production.'} />;
        const mine = (parsed || []).filter(b => b.account === a || (!b.account && rootFor(a) && b.dir.startsWith(rootFor(a))));
        return (<div key={a} className={`${card} p-4 space-y-2`}>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">iCloud Backup · account {a} <span className="font-normal text-slate-400">({list.length} file(s))</span></div>
          {parsed && !mine.length && <div className="text-[11px] text-slate-500">No Manifest.db / Manifest.plist found in these files.</div>}
          {!parsed && <div className="text-[11px] text-slate-500">Open the backup viewer to read this backup.</div>}
          {mine.map(b => (<div key={b.dir} className={`rounded-lg border p-2 ${b.encrypted ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-800'}`}>
            <div className="text-xs font-semibold">{String(b.device?.deviceName || 'iOS device')} <span className="text-slate-400 font-normal">{String(b.device?.productType || '')} · iOS {String(b.device?.iosVersion || '')} · last backup {fmtTime(String(b.device?.lastBackup || ''))}</span></div>
            {b.encrypted ? <div className="text-[11px] font-bold text-amber-700">Encrypted — password required. Decryption is not supported yet.</div>
              : <div className="text-[11px] text-slate-600 dark:text-slate-300">{Object.entries(b.counts || {}).map(([k, v]) => `${LABEL[k] || k}: ${v}`).join(' · ')}</div>}
          </div>))}
          <button type="button" onClick={() => open(rootFor(a))} className="text-xs font-bold text-indigo-600 hover:underline cursor-pointer">Open backup viewer for this account</button>
        </div>);
      })}
    </div>
  );
}
