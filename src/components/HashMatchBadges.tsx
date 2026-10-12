import type { HashHit } from '../lib/hashSets';
import { categoryLabel } from '../lib/hashSets';

const categoryClass: Record<string, string> = {
  csam: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900/50',
  notable: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/40',
  ignorable: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  custom: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-900/40',
};

export function hitsForHashes(
  hashes: readonly string[],
  vicHashes?: ReadonlySet<string> | null,
  hashHits?: ReadonlyMap<string, HashHit[]> | null
): { vic: boolean; hits: HashHit[] } {
  let vic = false;
  const hits: HashHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < hashes.length; i++) {
    const key = hashes[i].trim().toLowerCase();
    if (!key) continue;
    if (vicHashes?.has(key)) vic = true;
    const list = hashHits?.get(key);
    if (!list) continue;
    for (let j = 0; j < list.length; j++) {
      if (seen.has(list[j].setId)) continue;
      seen.add(list[j].setId);
      hits.push(list[j]);
    }
  }
  return { vic, hits };
}

export function HashMatchBadges({
  hashes,
  vicHashes,
  hashHits,
}: {
  hashes: readonly string[];
  vicHashes?: ReadonlySet<string> | null;
  hashHits?: ReadonlyMap<string, HashHit[]> | null;
}) {
  const { vic, hits } = hitsForHashes(hashes, vicHashes, hashHits);
  if (!vic && hits.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1" data-hash-match="true">
      {vic && (
        <span className="text-[8px] bg-rose-50 dark:bg-rose-955/45 text-rose-750 dark:text-rose-200 font-extrabold px-1.5 py-0.5 rounded border border-rose-200/30 dark:border-rose-900/30">
          VIC MATCH
        </span>
      )}
      {hits.map(hit => (
        <span
          key={hit.setId}
          title={`${hit.name} · ${categoryLabel(hit.category)}`}
          className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded border ${categoryClass[hit.category] || categoryClass.custom}`}
        >
          {hit.name} · {categoryLabel(hit.category)}
        </span>
      ))}
    </span>
  );
}
