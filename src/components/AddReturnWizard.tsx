/**
 * Confirm one return before it is parsed. The global provider control is not used here.
 */
import React from 'react';
import type { ProviderType } from '../types';
import { detectionConflicts, type ProviderDetection } from '../lib/detectReturn';
import { RETURN_ROLES, returnRoleLabel, type ReturnRole } from '../lib/caseReturns';

export interface AddReturnDraft {
  files: File[];
  sourceLabel: string;
  detection: ProviderDetection;
  provider: ProviderType;
  name: string;
  subjectName: string;
  role: ReturnRole;
}

interface ProviderChoice {
  id: ProviderType;
  name: string;
}

interface Props {
  draft: AddReturnDraft;
  providers: ProviderChoice[];
  onChange: (next: AddReturnDraft) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AddReturnWizard({ draft, providers, onChange, onCancel, onConfirm }: Props) {
  const conflict = detectionConflicts(draft.detection.provider, draft.provider, draft.detection.confidence);
  const detectedName = providers.find(item => item.id === draft.detection.provider)?.name || draft.detection.provider;
  return (
    <div id="add-return-wizard" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="add-return-title">
      <form
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onSubmit={event => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Add return</p>
        <h2 id="add-return-title" className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">Confirm this import</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {draft.files.length} item{draft.files.length === 1 ? '' : 's'} from <span className="font-mono">{draft.sourceLabel}</span>. The source file stays read-only.
        </p>

        <div id="add-return-detection" className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-950">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-100">Detected: {detectedName}</span>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
              {draft.detection.confidence} confidence
            </span>
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-slate-600 dark:text-slate-300">
            {draft.detection.reasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        </div>

        <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Provider
          <select
            id="add-return-provider"
            value={draft.provider}
            onChange={event => onChange({ ...draft, provider: event.target.value as ProviderType })}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {conflict && (
          <p id="add-return-conflict" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            You chose a different provider than the one detected ({detectedName}). Parsing will follow your choice.
          </p>
        )}

        <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Return name
          <input
            id="add-return-name"
            value={draft.name}
            onChange={event => onChange({ ...draft, name: event.target.value })}
            required
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Subject name <span className="font-normal normal-case">(optional)</span>
          <input
            id="add-return-subject"
            value={draft.subjectName}
            onChange={event => onChange({ ...draft, subjectName: event.target.value })}
            placeholder="Name used in this return"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Role
          <select
            id="add-return-role"
            value={draft.role}
            onChange={event => onChange({ ...draft, role: event.target.value as ReturnRole })}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {RETURN_ROLES.map(role => <option key={role} value={role}>{returnRoleLabel(role)}</option>)}
          </select>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancel</button>
          <button id="add-return-confirm" type="submit" className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">Add return</button>
        </div>
      </form>
    </div>
  );
}
