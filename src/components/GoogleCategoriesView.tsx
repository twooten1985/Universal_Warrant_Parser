/**
 * Google Categories: product/category tree, coverage grid, and a viewer
 * that falls back to the raw file so an unmapped category is never invisible.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { ForensicEvent, UploadedFile } from '../types';
import { describeCategory, productDef } from '../lib/googleCategories';
import { accountFromGoogleFolder, extensionOfName, isGoogleAudioExt, isGoogleImageExt, isNoDataText } from '../lib/googleFolders';
import { inventoryGoogleReturn, type GoogleFolderInventory } from '../lib/googleInventory';

interface Props {
  events: ForensicEvent[];
  files: UploadedFile[];
  accountFilter: string;
  caseId: string;
}

function fileText(file: UploadedFile): string | null {
  if (file.content && !file.content.startsWith('data:')) return file.content;
  if ((file as UploadedFile & { noDataPlaceholder?: boolean }).noDataPlaceholder) return 'No Data';
  return null;
}

export function GoogleCategoriesView({ events, files, accountFilter, caseId }: Props) {
  const [hideNoData, setHideNoData] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);

  const inventory = useMemo(() => inventoryGoogleReturn(files.map(f => ({
    name: f.name,
    relativePath: f.relativePath || f.name,
    size: f.size,
    text: fileText(f),
    isMedia: f.isMedia,
  }))), [files]);

  const visible = useMemo(() => {
    const filter = accountFilter && accountFilter !== 'all' ? accountFilter.toLowerCase() : '';
    return inventory.folders.filter(folder => {
      if (!filter) return true;
      const acct = accountFromGoogleFolder(folder.folder);
      const hay = [acct.email, acct.username, acct.gaiaId, acct.targetAccount, folder.folder.accountText].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(filter) || filter.includes((acct.username || '').toLowerCase());
    });
  }, [inventory, accountFilter]);

  const tree = useMemo(() => {
    const products = new Map<string, GoogleFolderInventory[]>();
    for (const folder of visible) {
      if (hideNoData && folder.badge === 'No Data') continue;
      const list = products.get(folder.folder.product) || [];
      list.push(folder);
      products.set(folder.folder.product, list);
    }
    return [...products.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible, hideNoData]);

  useEffect(() => {
    if (selected && visible.some(f => f.folder.folder === selected)) return;
    const first = tree[0]?.[1][0];
    setSelected(first ? first.folder.folder : null);
  }, [tree, selected, visible]);

  const current = visible.find(f => f.folder.folder === selected) || null;
  const currentEvents = useMemo(() => {
    if (!current) return [];
    const acct = accountFromGoogleFolder(current.folder);
    return events.filter(e => {
      if (e.details?.googleCategory !== current.folder.key) return false;
      const t = String(e.targetAccount || e.accountKey || '').toLowerCase();
      if (!t) return true;
      return [acct.targetAccount, acct.username, acct.email, acct.gaiaId, acct.accountKey].some(v => v && t.includes(String(v).toLowerCase()));
    });
  }, [current, events]);

  const accounts = useMemo(() => {
    const set = new Set<string>();
    for (const folder of visible) {
      const acct = accountFromGoogleFolder(folder.folder);
      set.add(acct.email || acct.gaiaId || acct.targetAccount);
    }
    return [...set].sort();
  }, [visible]);

  const categoryRows = useMemo(() => {
    const set = new Map<string, string>();
    for (const folder of visible) set.set(folder.folder.key, describeCategory(folder.folder.product, folder.folder.category).label);
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  return (
    <div id="tabview-google-categories" className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4 text-left">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Products</h3>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
            <input id="google-hide-nodata" type="checkbox" checked={hideNoData} onChange={e => setHideNoData(e.target.checked)} />
            Hide No Data
          </label>
        </div>
        <p className="text-[10px] text-slate-400">No Data placeholders stay in the workspace and in exports. Hiding them only changes this tree.</p>
        <div id="google-category-tree" className="space-y-2 max-h-[480px] overflow-auto pr-1">
          {tree.length === 0 && <p className="text-xs text-slate-400">No Google category folders in this case.</p>}
          {tree.map(([product, folders]) => {
            const info = productDef(product);
            return (
              <div key={product}>
                <HoverTip id={`tip-product-${product}`} text={info.description}>
                  <button type="button" className="text-[11px] font-bold text-slate-700 dark:text-slate-200 text-left cursor-pointer">{info.label}</button>
                </HoverTip>
                <ul className="mt-1 space-y-0.5">
                  {folders.map(folder => {
                    const def = describeCategory(folder.folder.product, folder.folder.category);
                    const count = events.filter(e => e.details?.googleCategory === folder.folder.key && accountMatches(e, folder)).length;
                    const on = folder.folder.folder === selected;
                    return (
                      <li key={folder.folder.folder}>
                        <HoverTip id={`tip-${folder.folder.key}`} text={def.description}>
                          <button
                            type="button"
                            id={`google-cat-${folder.folder.key}`}
                            onClick={() => { setSelected(folder.folder.folder); setRaw(def.mode !== 'parsed'); }}
                            className={`w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-left cursor-pointer ${on ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >
                            <span className="flex-1 truncate text-[11px] text-slate-700 dark:text-slate-200">{def.label}</span>
                            <span className="text-[10px] font-mono text-slate-400">{count}</span>
                            <Badge kind={folder.badge} />
                          </button>
                        </HoverTip>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        {inventory.audit.length > 0 && (
          <details id="google-audit-list" className="text-[11px] text-slate-500">
            <summary className="cursor-pointer font-semibold">{inventory.audit.length} No Data placeholder{inventory.audit.length === 1 ? '' : 's'} kept</summary>
            <ul className="mt-1 space-y-0.5 max-h-28 overflow-auto">
              {inventory.audit.map(item => <li key={item.relativePath} className="font-mono truncate" title={item.relativePath}>{item.name}</li>)}
            </ul>
          </details>
        )}
      </div>

      <div className="space-y-3 min-w-0">
        <div id="google-coverage-grid" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-auto">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="p-2 text-[10px] uppercase tracking-wider text-slate-400 sticky left-0 bg-white dark:bg-slate-900">Category</th>
                {accounts.map(a => <th key={a} className="p-2 font-mono text-[10px] text-slate-500 whitespace-nowrap">{a}</th>)}
              </tr>
            </thead>
            <tbody>
              {categoryRows.map(([key, label]) => (
                <tr key={key} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-2 text-slate-700 dark:text-slate-200 sticky left-0 bg-white dark:bg-slate-900">{label}</td>
                  {accounts.map(account => {
                    const cell = visible.find(f => f.folder.key === key && (accountFromGoogleFolder(f.folder).email || accountFromGoogleFolder(f.folder).gaiaId || accountFromGoogleFolder(f.folder).targetAccount) === account);
                    return <td key={account} className="p-2">{cell ? <Badge kind={cell.badge} /> : <span className="text-slate-300">not produced</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {current && (
          <CategoryPane
            folder={current}
            events={currentEvents}
            files={files}
            caseId={caseId}
            raw={raw || describeCategory(current.folder.product, current.folder.category).mode !== 'parsed'}
            onToggleRaw={() => setRaw(v => !v)}
          />
        )}
      </div>
    </div>
  );
}

function accountMatches(e: ForensicEvent, folder: GoogleFolderInventory): boolean {
  const acct = accountFromGoogleFolder(folder.folder);
  const t = String(e.targetAccount || '').toLowerCase();
  if (!t) return e.details?.googleCategory === folder.folder.key;
  return [acct.targetAccount, acct.username, acct.email, acct.gaiaId].some(v => v && t.includes(String(v).toLowerCase()));
}

function Badge({ kind }: { kind: GoogleFolderInventory['badge'] }) {
  const cls = kind === 'Data' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
    : kind === 'No Data' ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
    : kind === 'Encrypted' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}>{kind}</span>;
}

function HoverTip({ id, text, children }: { id: string; text: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 340) });
  };
  return (
    <span
      className="relative block"
      onMouseEnter={e => show(e.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={e => show(e.currentTarget)}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          role="tooltip"
          id={id}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-80 rounded-lg border border-slate-700 bg-slate-900 p-2 text-[11px] leading-snug text-slate-100 shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}

function CategoryPane({ folder, events, files, caseId, raw, onToggleRaw }: {
  folder: GoogleFolderInventory;
  events: ForensicEvent[];
  files: UploadedFile[];
  caseId: string;
  raw: boolean;
  onToggleRaw: () => void;
}) {
  const def = describeCategory(folder.folder.product, folder.folder.category);
  const owned = files.filter(f => (f.relativePath || '').includes(folder.folder.folder) || f.relativePath === folder.folder.folder);
  const [fileName, setFileName] = useState(owned[0]?.name || '');
  const file = owned.find(f => f.name === fileName) || owned[0];
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{def.group} · {def.label}</h3>
          <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">{def.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge kind={folder.badge} />
          {def.mode === 'parsed' && (
            <button type="button" onClick={onToggleRaw} className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer">
              {raw ? 'Show records' : 'Show file'}
            </button>
          )}
        </div>
      </div>
      {folder.badge === 'Encrypted' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-xs text-rose-800 dark:text-rose-200">
          Flagged as not viewable. The file is listed and can be hashed. Its contents are not decoded.
        </div>
      )}
      {!raw && events.length > 0 && <RecordTable events={events} />}
      {(raw || events.length === 0) && file && (
        <div id="google-generic-viewer" className="space-y-2">
          {owned.length > 1 && (
            <select value={file.name} onChange={e => setFileName(e.target.value)} className="text-xs border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 p-1">
              {owned.map(f => <option key={f.relativePath || f.name}>{f.name}</option>)}
            </select>
          )}
          <GenericFile file={file} caseId={caseId} events={events} />
        </div>
      )}
    </div>
  );
}

function RecordTable({ events }: { events: ForensicEvent[] }) {
  const columns = ['timestamp', 'sender', 'content', 'ip'];
  const rows = events.map(e => [e.details?.untimed ? 'No timestamp' : e.timestamp, e.sender || '', e.content || '', e.ipAddress || '']);
  return (
    <div id="google-record-table">
      <VirtualTable columns={columns} rows={rows} />
    </div>
  );
}

function VirtualTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ col: number; dir: number } | null>(null);
  const [scroll, setScroll] = useState(0);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = needle ? rows.filter(r => r.join(' ').toLowerCase().includes(needle)) : rows.slice();
    if (sort) {
      const { col, dir } = sort;
      list = list.slice().sort((a, b) => String(a[col] || '').localeCompare(String(b[col] || '')) * dir);
    }
    return list;
  }, [rows, q, sort]);
  const rowH = 32;
  const height = 360;
  const start = Math.max(0, Math.floor(scroll / rowH) - 2);
  const count = Math.ceil(height / rowH) + 6;
  const slice = filtered.slice(start, start + count);
  return (
    <div className="space-y-2">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter rows" className="w-full max-w-xs text-xs border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 bg-white dark:bg-slate-950" />
      <div className="text-[10px] text-slate-400">{filtered.length} row{filtered.length === 1 ? '' : 's'}</div>
      <div className="overflow-auto border border-slate-200 dark:border-slate-800 rounded-lg" style={{ height }} onScroll={e => setScroll((e.target as HTMLDivElement).scrollTop)}>
        <div style={{ height: filtered.length * rowH }}>
          <table className="w-full text-left text-[11px]" style={{ transform: `translateY(${start * rowH}px)` }}>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th key={c} className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 sticky top-0 bg-white dark:bg-slate-900">
                    <button type="button" className="cursor-pointer" onClick={() => setSort(s => ({ col: i, dir: s?.col === i ? -s.dir : 1 }))}>{c}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map((r, i) => (
                <tr key={start + i} className="border-t border-slate-100 dark:border-slate-800" style={{ height: rowH }}>
                  {r.map((cell, j) => <td key={j} className="px-2 py-1 align-top text-slate-700 dark:text-slate-200 max-w-[280px] truncate" title={cell}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GenericFile({ file, caseId, events = [] }: { file: UploadedFile; caseId: string; events?: ForensicEvent[] }) {
  const ext = extensionOfName(file.name);
  const [text, setText] = useState(file.content && !file.content.startsWith('data:') ? file.content : '');
  useEffect(() => {
    if (file.content && !file.content.startsWith('data:')) { setText(file.content); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const url = file.sourcePath
          ? `/api/text-preview?path=${encodeURIComponent(file.sourcePath)}`
          : `/api/cases/${encodeURIComponent(caseId)}/file-text?rel=${encodeURIComponent(file.relativePath || '')}&name=${encodeURIComponent(file.name)}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setText(String(data.text || ''));
      } catch { /* preview is optional */ }
    };
    if (!isGoogleImageExt(ext) && !isGoogleAudioExt(ext)) void load();
    return () => { cancelled = true; };
  }, [file, caseId, ext]);

  if (isGoogleAudioExt(ext)) {
    const src = file.content?.startsWith('data:') ? file.content : file.sourcePath ? `/api/local-media?path=${encodeURIComponent(file.sourcePath)}` : '';
    return src
      ? <audio id="google-audio-player" controls src={src} className="w-full" />
      : <p className="text-xs text-slate-400">Audio file {file.name} is listed. Open it from the original return to play the bytes.</p>;
  }
  if (isGoogleImageExt(ext) || file.isMedia) {
    const src = file.content?.startsWith('data:') ? file.content : file.sourcePath ? `/api/local-media?path=${encodeURIComponent(file.sourcePath)}` : '';
    return src ? <img src={src} alt={file.name} className="max-h-64 rounded-lg border border-slate-200" /> : <p className="text-xs text-slate-400">{file.name}</p>;
  }
  if (ext === 'html' || ext === 'htm' || /^\s*</.test(text)) {
    const safe = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
    return <iframe id="google-html-frame" title={file.name} sandbox="" srcDoc={safe} className="w-full h-80 rounded-lg border border-slate-200 bg-white" />;
  }
  if (ext === 'json' || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    return <JsonPane text={text || file.content || ''} />;
  }
  const fieldRows = events.map(e => e.details?.fields).filter((row): row is Record<string, string> => !!row && typeof row === 'object');
  if (!text.trim() && fieldRows.length > 0) {
    const columns = [...new Set(fieldRows.flatMap(row => Object.keys(row)))];
    return <VirtualTable columns={columns} rows={fieldRows.map(row => columns.map(c => String(row[c] ?? '')))} />;
  }
  if (ext === 'csv' || ext === 'tsv' || text.includes('\t') || text.includes(',')) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const delim = (lines[0] || '').includes('\t') ? '\t' : ',';
    const table = lines.map(l => l.split(delim));
    if (table.length > 1 && table[0].length > 1) return <VirtualTable columns={table[0]} rows={table.slice(1)} />;
  }
  return <TextPane text={text || (isNoDataText(file.content) ? 'No Data' : file.content || '')} />;
}

function TextPane({ text }: { text: string }) {
  const [q, setQ] = useState('');
  const shown = !q ? text : text.split(/\n/).filter(l => l.toLowerCase().includes(q.toLowerCase())).join('\n');
  return (
    <div className="space-y-2">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search text" className="w-full max-w-xs text-xs border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 bg-white dark:bg-slate-950" />
      <pre className="text-[11px] whitespace-pre-wrap max-h-80 overflow-auto font-mono text-slate-700 dark:text-slate-200">{shown || 'Empty file'}</pre>
    </div>
  );
}

function JsonPane({ text }: { text: string }) {
  const [flat, setFlat] = useState(false);
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (data == null) return <TextPane text={text} />;
  if (flat) {
    const rows = flattenRows(data);
    const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
    return (
      <div className="space-y-2">
        <button type="button" className="text-[11px] font-bold text-indigo-600 cursor-pointer" onClick={() => setFlat(false)}>Show tree</button>
        <VirtualTable columns={columns} rows={rows.map(r => columns.map(c => r[c] || ''))} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button type="button" id="google-json-flatten" className="text-[11px] font-bold text-indigo-600 cursor-pointer" onClick={() => setFlat(true)}>Flatten to table</button>
      <div className="max-h-80 overflow-auto text-[11px] font-mono"><JsonNode value={data} name="$" depth={0} /></div>
    </div>
  );
}

function flattenRows(data: unknown): Array<Record<string, string>> {
  const list = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
  return list.filter(x => x && typeof x === 'object').map(row => {
    const out: Record<string, string> = {};
    const walk = (node: unknown, prefix: string) => {
      if (node == null || typeof node !== 'object') { out[prefix] = String(node ?? ''); return; }
      if (Array.isArray(node)) { out[prefix] = node.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('; '); return; }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, prefix ? `${prefix}.${k}` : k);
    };
    walk(row, '');
    return out;
  });
}

function JsonNode({ value, name, depth }: { value: unknown; name: string; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (value == null || typeof value !== 'object') {
    return <div className="pl-3"><span className="text-slate-400">{name}: </span><span className="text-slate-800 dark:text-slate-100">{String(value)}</span></div>;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  return (
    <div className="pl-3">
      <button type="button" className="text-slate-500 cursor-pointer" onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} {name} {Array.isArray(value) ? `[${entries.length}]` : ''}</button>
      {open && entries.slice(0, 200).map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} />)}
    </div>
  );
}
