import { useState } from 'react';
import { Trash2, UploadCloud } from 'lucide-react';
import {
  HASH_CATEGORIES,
  hashesFromPlainChunk,
  hashesFromTabularChunk,
  isHashCategory,
  sniffTabular,
  type HashCategory,
  type HashSetInfo,
  type TabularPreview,
} from '../lib/hashSets';

function readSlice(file: File, start: number, end: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read that file'));
    reader.readAsText(file.slice(start, end));
  });
}

async function streamHashes(
  file: File,
  mode: { kind: 'plain' } | { kind: 'csv'; delimiter: ',' | '\t'; columns: number[] },
  onBatch: (hashes: string[], bytesDone: number) => Promise<void>
) {
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  let carry = '';
  const batch = new Set<string>();
  const flush = async (bytesDone: number) => {
    if (batch.size === 0) return;
    const hashes = Array.from(batch);
    batch.clear();
    await onBatch(hashes, bytesDone);
  };
  while (offset < file.size) {
    const end = Math.min(file.size, offset + chunkSize);
    const text = await readSlice(file, offset, end);
    const pulled = mode.kind === 'csv'
      ? hashesFromTabularChunk(text, mode.delimiter, mode.columns, carry)
      : hashesFromPlainChunk(text, carry);
    carry = pulled.carry;
    for (let i = 0; i < pulled.hashes.length; i++) batch.add(pulled.hashes[i]);
    offset = end;
    if (batch.size >= 20000) await flush(offset);
  }
  const tail = mode.kind === 'csv'
    ? hashesFromTabularChunk('\n', mode.delimiter, mode.columns, carry)
    : hashesFromPlainChunk('\n', carry);
  for (let i = 0; i < tail.hashes.length; i++) batch.add(tail.hashes[i]);
  await flush(file.size);
}

export function HashSetManager({
  sets,
  busy,
  status,
  onRefresh,
  onStatus,
}: {
  sets: HashSetInfo[];
  busy: boolean;
  status: string;
  onRefresh: () => void;
  onStatus: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<HashCategory>('notable');
  const [preview, setPreview] = useState<TabularPreview | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [column, setColumn] = useState(0);
  const [allHashColumns, setAllHashColumns] = useState(true);

  const resetPicker = () => {
    setPreview(null);
    setPending(null);
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    const sample = await readSlice(file, 0, Math.min(file.size, 64 * 1024));
    const table = sniffTabular(sample);
    setPending(file);
    setPreview(table);
    if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, '').slice(0, 80));
    if (table) {
      setColumn(table.hashColumns[0] ?? 0);
      setAllHashColumns(table.hashColumns.length > 0);
    }
  };

  const importPending = async () => {
    if (!pending) return;
    const label = name.trim() || pending.name;
    if (!isHashCategory(category)) return;
    onStatus('Creating hash set...');
    const created = await fetch('/api/hash-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: label, category }),
    });
    if (!created.ok) {
      const err = await created.json().catch(() => ({}));
      throw new Error(err.error || 'Could not create the hash set');
    }
    const { id } = await created.json() as { id: string };
    let saved = 0;
    const columns = preview
      ? (allHashColumns && preview.hashColumns.length ? preview.hashColumns : [column])
      : [];
    try {
      await streamHashes(
        pending,
        preview ? { kind: 'csv', delimiter: preview.delimiter, columns } : { kind: 'plain' },
        async (hashes, bytesDone) => {
          onStatus(`Saving ${label}: ${(bytesDone / (1024 * 1024)).toFixed(1)} MB read, ${saved.toLocaleString()} hashes stored...`);
          const res = await fetch(`/api/hash-sets/${encodeURIComponent(id)}/hashes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hashes }),
          });
          if (!res.ok) throw new Error('Could not store a batch of hashes');
          const body = await res.json() as { added?: number };
          saved += body.added || hashes.length;
        }
      );
    } catch (err) {
      await fetch(`/api/hash-sets/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
      throw err;
    }
    onStatus('');
    resetPicker();
    setName('');
    onRefresh();
    return saved;
  };

  const removeSet = async (set: HashSetInfo) => {
    if (!window.confirm(`Remove the hash set “${set.name}”? This does not change Project VIC hashes.`)) return;
    const res = await fetch(`/api/hash-sets/${encodeURIComponent(set.id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not remove that hash set');
    onRefresh();
  };

  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-left space-y-3">
      <div>
        <h4 className="font-bold text-slate-850 dark:text-slate-100 text-sm">Other hash sets</h4>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-normal">
          Load plain text (one hash per line), CSV with a hash column, or JSON / NSRL-style files. MD5, SHA-1, and SHA-256 are recognized by length. Each set has a name and a category. Sets are saved in this program and apply to every case. Project VIC above is unchanged.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[10px] font-bold text-slate-500 uppercase">
          Set name
          <input
            id="hash-set-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Example: Agency notable list"
            className="mt-1 w-full text-xs font-medium p-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
          />
        </label>
        <label className="text-[10px] font-bold text-slate-500 uppercase">
          Category
          <select
            id="hash-set-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as HashCategory)}
            className="mt-1 w-full text-xs font-bold p-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
          >
            {HASH_CATEGORIES.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 font-bold text-xs rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5">
        <UploadCloud className="h-4 w-4 text-slate-400" />
        <span>Choose hash list</span>
        <input
          id="hash-set-file"
          type="file"
          accept=".txt,.csv,.json,.tsv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void chooseFile(file);
          }}
        />
      </label>
      {preview && pending && (
        <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
          <p className="text-[10px] text-slate-500">{pending.name} looks like a table. Choose the hash column.</p>
          <select
            id="hash-set-column"
            value={column}
            onChange={(e) => setColumn(Number(e.target.value))}
            className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950"
          >
            {preview.headers.map((header, index) => (
              <option key={`${header}-${index}`} value={index}>{header || `Column ${index + 1}`}</option>
            ))}
          </select>
          {preview.hashColumns.length > 1 && (
            <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={allHashColumns} onChange={(e) => setAllHashColumns(e.target.checked)} />
              Import every recognized hash column (MD5, SHA-1, SHA-256)
            </label>
          )}
        </div>
      )}
      {pending && (
        <div className="flex items-center gap-2">
          <button
            id="hash-set-import"
            type="button"
            disabled={busy}
            onClick={() => {
              void importPending().catch((err: Error) => onStatus(err.message || 'Import failed'));
            }}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg disabled:opacity-50"
          >
            Import set
          </button>
          <button type="button" onClick={resetPicker} className="px-3 py-1.5 text-xs font-bold text-slate-500">
            Cancel
          </button>
        </div>
      )}
      {status && <p className="text-[11px] text-indigo-600 dark:text-indigo-300">{status}</p>}
      <ul id="hash-set-list" className="space-y-1">
        {sets.length === 0 && <li className="text-[10px] text-slate-400 italic">No extra hash sets loaded</li>}
        {sets.map(set => (
          <li key={set.id} className="flex items-center justify-between gap-2 text-xs border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5">
            <span>
              <span className="font-bold text-slate-800 dark:text-slate-100">{set.name}</span>
              <span className="text-slate-400"> · {categoryLabelSafe(set.category)} · {set.hashCount.toLocaleString()} hashes</span>
            </span>
            <button type="button" onClick={() => { void removeSet(set).catch((err: Error) => onStatus(err.message)); }} className="text-rose-600 inline-flex items-center gap-1 font-bold">
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function categoryLabelSafe(category: string): string {
  return HASH_CATEGORIES.find(item => item.id === category)?.label || category;
}
