/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 case-level Shared identifiers table.
 * Shows Exact link SUGGESTIONS only — never merges accounts.
 */

import { IdentifierOccurrence, LinkEdge } from '../identity';
import { Link2, AlertTriangle, X } from 'lucide-react';

interface Props {
  accountsCount: number;
  linkEdges: LinkEdge[];
  identifierOccurrences: IdentifierOccurrence[];
  selectedEdgeId: string | null;
  onSelectEdge: (id: string | null) => void;
  onJumpToAccount?: (accountLabel: string) => void;
}

export function SharedIdentifiersPanel({
  accountsCount,
  linkEdges,
  identifierOccurrences,
  selectedEdgeId,
  onSelectEdge,
  onJumpToAccount,
}: Props) {
  const selected = linkEdges.find((e) => e.id === selectedEdgeId) || null;
  const occById = new Map(identifierOccurrences.map((o) => [o.id, o]));

  if (accountsCount < 2) {
    return (
      <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center bg-slate-50/40 dark:bg-slate-950/20">
        <Link2 className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">Shared identifiers</h4>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          Need at least two separate accounts in this case before Exact link suggestions can appear.
          Accounts stay unmerged; overlaps are suggestions only.
        </p>
      </div>
    );
  }

  if (linkEdges.length === 0) {
    return (
      <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center bg-slate-50/40 dark:bg-slate-950/20">
        <Link2 className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">No Exact link suggestions</h4>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          No shared email, phone, recovery, or provider user-id overlaps were found across distinct accounts.
          Username-only matches across providers are not Exact links in Phase 1.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <Link2 className="h-4 w-4 text-indigo-500" />
            Shared identifiers
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Exact link suggestions — accounts remain separate. Associated by shared identifier only; not a merged identity.
          </p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900">
          {linkEdges.length} suggested
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950/80 text-[9px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100 dark:border-slate-800">
              <th className="px-4 py-2.5">Normalized</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Tier</th>
              <th className="px-4 py-2.5">Accounts / Providers</th>
              <th className="px-4 py-2.5">Source fields</th>
              <th className="px-4 py-2.5">Rationale</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
            {linkEdges.map((edge) => {
              const occA = edge.occurrenceIds[0] ? occById.get(edge.occurrenceIds[0]) : undefined;
              const occB = edge.occurrenceIds[1] ? occById.get(edge.occurrenceIds[1]) : undefined;
              const isSel = selectedEdgeId === edge.id;
              return (
                <tr
                  key={edge.id}
                  onClick={() => onSelectEdge(isSel ? null : edge.id)}
                  className={`cursor-pointer transition-colors ${
                    isSel
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-950/40'
                  }`}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800 dark:text-slate-200 select-all">
                    {edge.normalizedValue}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">
                      {edge.identifierType}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900">
                      {edge.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    <div className="font-medium">
                      {edge.accountLabelA}{' '}
                      <span className="text-slate-400 font-normal">({edge.providerA})</span>
                    </div>
                    <div className="font-medium">
                      {edge.accountLabelB}{' '}
                      <span className="text-slate-400 font-normal">({edge.providerB})</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
                    <div>{occA?.sourceField || '—'}</div>
                    <div>{occB?.sourceField || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-xs">
                    <span className="line-clamp-2">{edge.rationale}</span>
                    {edge.fpWarning && (
                      <span className="mt-1 flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{edge.fpWarning}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h5 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Provenance (side-by-side) — link suggestion
            </h5>
            <button
              type="button"
              onClick={() => onSelectEdge(null)}
              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">{selected.rationale}</p>
          {selected.fpWarning && (
            <div className="mb-3 flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {selected.fpWarning}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[selected.occurrenceIds[0], selected.occurrenceIds[1]].map((oid, i) => {
              const occ = oid ? occById.get(oid) : undefined;
              if (!occ) {
                return (
                  <div key={i} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-400">
                    Occurrence unavailable
                  </div>
                );
              }
              return (
                <div
                  key={occ.id}
                  className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-slate-800 dark:text-slate-200 font-mono truncate">
                      {occ.accountLabel}
                    </strong>
                    <span className="text-[10px] uppercase font-bold text-indigo-600 dark:text-indigo-400">
                      {occ.provider}
                    </span>
                  </div>
                  <div className="text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
                    <div>
                      <span className="text-slate-400">Type: </span>
                      <span className="font-mono font-semibold">{occ.type}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Raw: </span>
                      <span className="font-mono select-all">{occ.rawValue}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Normalized: </span>
                      <span className="font-mono select-all">{occ.normalizedValue}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Source field: </span>
                      <span className="font-mono">{occ.sourceField}</span>
                    </div>
                    {occ.sourceFile && (
                      <div>
                        <span className="text-slate-400">File: </span>
                        <span className="font-mono text-[10px]">{occ.sourceFile}</span>
                      </div>
                    )}
                  </div>
                  {onJumpToAccount && (
                    <button
                      type="button"
                      onClick={() => onJumpToAccount(occ.accountLabel)}
                      className="mt-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      Open account card →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
