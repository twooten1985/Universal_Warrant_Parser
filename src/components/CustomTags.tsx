import { useState } from 'react';
import { TAG_COLOR_PALETTE, chipTextColor, cleanTagName, countTagUse, normalizeTagColor, tagsForLabels, type CustomTagDef } from '../lib/customTags';

export function TagChips({
  defs,
  ids,
  onRemove,
}: {
  defs: readonly CustomTagDef[];
  ids?: readonly string[];
  onRemove?: (id: string) => void;
}) {
  const chips = tagsForLabels(defs, ids);
  if (chips.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {chips.map(chip => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
          style={{ background: chip.color, color: chipTextColor(chip.color) }}
          title={chip.name}
        >
          {chip.name}
          {onRemove && (
            <button type="button" className="cursor-pointer opacity-80 hover:opacity-100" onClick={() => onRemove(chip.id)} aria-label={`Remove ${chip.name}`}>
              ×
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

export function TagApplyControls({
  defs,
  disabled,
  onApply,
  onClear,
}: {
  defs: readonly CustomTagDef[];
  disabled?: boolean;
  onApply: (id: string) => void;
  onClear: (id: string) => void;
}) {
  const [id, setId] = useState(defs[0]?.id || '');
  const current = defs.some(def => def.id === id) ? id : (defs[0]?.id || '');
  if (defs.length === 0) return <span className="text-[10px] text-slate-400">No custom tags yet.</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select
        aria-label="Custom tag"
        value={current}
        onChange={e => setId(e.target.value)}
        className="text-[11px] border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 px-1 py-1"
      >
        {defs.map(def => <option key={def.id} value={def.id}>{def.name}</option>)}
      </select>
      <button type="button" disabled={disabled || !current} onClick={() => current && onApply(current)} className="px-2 py-1 rounded-md bg-indigo-600 text-white text-[11px] font-bold disabled:opacity-40 cursor-pointer">Apply</button>
      <button type="button" disabled={disabled || !current} onClick={() => current && onClear(current)} className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 text-[11px] font-bold disabled:opacity-40 cursor-pointer">Remove</button>
    </span>
  );
}

export function TagManager({
  defs,
  tags,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
}: {
  defs: readonly CustomTagDef[];
  tags: Record<string, { labels?: string[] } | undefined>;
  onCreate: (name: string, color: string) => void;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(TAG_COLOR_PALETTE[6]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const pending = defs.find(def => def.id === pendingDelete) || null;
  const pendingCount = pending ? countTagUse(tags, pending.id) : 0;

  return (
    <div id="media-tag-manager" className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Custom tags</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">Saved with this case. The same tags are available on Google category rows and other tagged items.</p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={e => {
            e.preventDefault();
            const clean = cleanTagName(name);
            if (!clean) return;
            onCreate(clean, color);
            setName('');
          }}
        >
          <input
            id="custom-tag-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Tag name"
            maxLength={40}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 bg-white dark:bg-slate-950 w-36"
          />
          <ColorChoices color={color} onChange={setColor} />
          <button type="submit" className="px-2.5 py-1 rounded-md bg-indigo-600 text-white text-xs font-bold cursor-pointer">Add tag</button>
        </form>
      </div>
      {defs.length === 0 ? (
        <p className="text-[11px] text-slate-400">No custom tags yet. Add one, then apply it to media or to a Google category row.</p>
      ) : (
        <ul className="space-y-2">
          {defs.map(def => (
            <li key={def.id} className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: def.color, color: chipTextColor(def.color) }}>{def.name}</span>
              <input
                aria-label={`Rename ${def.name}`}
                defaultValue={def.name}
                key={`${def.id}:${def.name}`}
                maxLength={40}
                onBlur={e => {
                  const clean = cleanTagName(e.target.value);
                  if (clean && clean !== def.name) onRename(def.id, clean);
                  else e.target.value = def.name;
                }}
                className="text-xs border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 bg-white dark:bg-slate-950 w-36"
              />
              <ColorChoices color={def.color} onChange={next => onRecolor(def.id, next)} />
              <span className="text-[10px] text-slate-400">{countTagUse(tags, def.id)} item{countTagUse(tags, def.id) === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => setPendingDelete(def.id)} className="text-[11px] font-bold text-rose-600 cursor-pointer">Delete</button>
            </li>
          ))}
        </ul>
      )}
      {pending && (
        <div id="custom-tag-delete-confirm" className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-xs text-rose-900 dark:text-rose-100 space-y-2">
          <p>
            Delete “{pending.name}”? It is applied to {pendingCount} item{pendingCount === 1 ? '' : 's'}.
            Those items lose this tag. Evidence flags and notes stay.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              id="custom-tag-delete-yes"
              onClick={() => { onDelete(pending.id); setPendingDelete(null); }}
              className="px-2.5 py-1 rounded-md bg-rose-600 text-white font-bold cursor-pointer"
            >
              Delete tag
            </button>
            <button type="button" onClick={() => setPendingDelete(null)} className="px-2.5 py-1 rounded-md border border-rose-300 font-bold cursor-pointer">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ColorChoices({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const current = normalizeTagColor(color);
  return (
    <span className="inline-flex items-center gap-1">
      {TAG_COLOR_PALETTE.map(swatch => (
        <button
          key={swatch}
          type="button"
          aria-label={`Color ${swatch}`}
          onClick={() => onChange(swatch)}
          className={`h-4 w-4 rounded-full border cursor-pointer ${current === swatch ? 'ring-2 ring-offset-1 ring-slate-500' : 'border-white/40'}`}
          style={{ background: swatch }}
        />
      ))}
      <input aria-label="Custom color" type="color" value={current} onChange={e => onChange(normalizeTagColor(e.target.value))} className="h-6 w-8 cursor-pointer bg-transparent" />
    </span>
  );
}
