/**
 * Compact list of returns in the case. Not a file listing.
 */
import React, { useState } from 'react';
import type { CaseReturn, ReturnRole } from '../lib/caseReturns';
import { RETURN_ROLES, returnRoleLabel } from '../lib/caseReturns';
import type { ProviderType } from '../types';

interface Props {
  returns: CaseReturn[];
  providerName: (provider: string) => string;
  onReparse: (id: string) => void;
  onRename: (id: string, patch: { name: string; subjectName: string; role: ReturnRole }) => void;
  onRemove: (id: string) => void;
}

export function CaseReturnsPanel({ returns, providerName, onReparse, onRename, onRemove }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftRole, setDraftRole] = useState<ReturnRole>('unassigned');

  if (!returns.length) return null;

  const startEdit = (item: CaseReturn) => {
    setEditing(item.id);
    setDraftName(item.name);
    setDraftSubject(item.subjectName || '');
    setDraftRole(item.role);
  };

  return (
    <div id="case-returns-panel" className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">Case returns</h3>
      <p className="mb-3 mt-1 text-[11px] text-slate-400">One row per import. Removing a return drops its parsed rows from the case and leaves the source files where they are.</p>
      <div className="space-y-2">
        {returns.map(item => (
          <div key={item.id} id={`case-return-${item.id}`} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{item.name}</span>
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">{providerName(item.provider)}</span>
                  {item.role !== 'unassigned' && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{returnRoleLabel(item.role)}</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {item.subjectName ? <span>{item.subjectName} · </span> : null}
                  {item.accountName ? <span>{item.accountName} · </span> : null}
                {item.accountId ? <span className="font-mono">{item.accountId}</span> : <span>Account not detected</span>}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {item.sourceName || 'Source'}{item.sourceSha256 ? ` · SHA-256 ${item.sourceSha256.slice(0, 16)}…` : ''}
                  {' · '}{item.importedAt ? item.importedAt.slice(0, 10) : 'imported'}
                  {' · '}{item.fileCount} files · {item.mediaCount} media · {item.eventCount} records
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300" onClick={() => onReparse(item.id)}>Re-parse</button>
                <button type="button" className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300" onClick={() => startEdit(item)}>Rename</button>
                <button
                  type="button"
                  className="rounded border border-rose-200 px-2 py-1 text-[10px] font-bold text-rose-600"
                  onClick={() => {
                    const ok = window.confirm(`Remove “${item.name}” from this case? Parsed rows for this return are deleted. The source zip or folder is not touched.`);
                    if (ok) onRemove(item.id);
                  }}
                >Remove</button>
              </div>
            </div>
            {editing === item.id && (
              <form
                className="mt-2 grid gap-2 border-t border-slate-100 pt-2 dark:border-slate-800"
                onSubmit={event => {
                  event.preventDefault();
                  onRename(item.id, { name: draftName.trim() || item.name, subjectName: draftSubject.trim(), role: draftRole });
                  setEditing(null);
                }}
              >
                <input value={draftName} onChange={event => setDraftName(event.target.value)} className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950" aria-label="Return name" />
                <input value={draftSubject} onChange={event => setDraftSubject(event.target.value)} placeholder="Subject name" className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950" aria-label="Subject name" />
                <select value={draftRole} onChange={event => setDraftRole(event.target.value as ReturnRole)} className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950" aria-label="Role">
                  {RETURN_ROLES.map(role => <option key={role} value={role}>{returnRoleLabel(role)}</option>)}
                </select>
                <div className="flex gap-1">
                  <button type="submit" className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white">Save</button>
                  <button type="button" className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold dark:border-slate-700" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export type { ProviderType };
