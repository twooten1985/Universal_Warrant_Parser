/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ParseResult, AccountRecord } from '../types';
import { LinkEdge } from '../identity';
import { accountFilterLabel } from '../identity';
import { User, Mail, Phone, Calendar, ShieldCheck, Cpu, Clock, Link2 } from 'lucide-react';

interface AccountProps {
  account?: ParseResult['accountInfo'];
  accounts?: ParseResult['accounts'];
  accountChanges?: ParseResult['accountChanges'];
  provider: string;
  selectedAccountFilter: string;
  onAccountFilterChange: (username: string) => void;
  /** Phase 1 Exact link suggestions (accounts stay unmerged) */
  linkEdges?: LinkEdge[];
}

function exactLinkCountForAccount(accountKey: string | undefined, edges: LinkEdge[]): number {
  if (!accountKey) return 0;
  return edges.filter(
    (e) => e.tier === 'exact' && (e.accountKeyA === accountKey || e.accountKeyB === accountKey)
  ).length;
}

function MiniAccountCard({
  acc,
  idx,
  exactCount,
  onSelect,
}: {
  acc: AccountRecord;
  idx: number;
  exactCount: number;
  onSelect: () => void;
  key?: React.Key;
}): React.ReactElement {
  const label = accountFilterLabel(acc, idx);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-indigo-500 shrink-0">
            <User className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <strong className="text-sm text-slate-800 dark:text-slate-200 font-mono block truncate">
              {acc.username || acc.displayName || label}
            </strong>
            <span className="text-[10px] uppercase tracking-wider text-slate-400">
              {acc.provider || 'Unknown provider'}
            </span>
          </div>
        </div>
        {exactCount > 0 && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900 shrink-0"
            title="Exact link suggestions (associated by shared identifier)"
          >
            <Link2 className="h-3 w-3" /> {exactCount}
          </span>
        )}
      </div>
      <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
        {acc.userId && <div className="truncate font-mono text-[10px]">UID: {acc.userId}</div>}
        {acc.email && <div className="truncate font-mono text-[10px]">{acc.email}</div>}
        {acc.phone && <div className="truncate font-mono text-[10px]">{acc.phone}</div>}
        {acc.sourceFile && (
          <div className="truncate text-[9px] text-slate-400 mt-1">Src: {acc.sourceFile}</div>
        )}
      </div>
    </button>
  );
}

function QuietChip({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 max-w-full">
      <span className="uppercase tracking-wider text-slate-400 font-bold">{label}</span>
      <span className="font-mono truncate select-all">{value}</span>
    </span>
  );
}

function ProfileGrid({
  activeAccount,
  provider,
}: {
  activeAccount: AccountRecord;
  provider: string;
}) {
  const title =
    activeAccount.username?.trim() ||
    activeAccount.displayName?.trim() ||
    activeAccount.userId?.trim() ||
    'Not supplied';
  const createdLabel = activeAccount.createdDate
    ? (() => {
        const t = Date.parse(activeAccount.createdDate);
        return isNaN(t) ? activeAccount.createdDate : new Date(t).toLocaleString();
      })()
    : undefined;

  return (
    <>
      <div className="px-6 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900 shrink-0">
            <User className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              {provider === 'kik' ? 'Kik username' : 'Username / Subject Identity'}
            </span>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono select-all truncate leading-tight">
              {title}
            </h3>
            {activeAccount.displayName && activeAccount.displayName !== title && (
              <span className="text-xs text-slate-500 block mt-0.5">Alias: {activeAccount.displayName}</span>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <QuietChip label="email" value={activeAccount.email} />
              <QuietChip label="phone" value={activeAccount.phone} />
              <QuietChip label="created" value={createdLabel} />
              <QuietChip label="reg IP" value={activeAccount.registrationIp} />
              {activeAccount.userId && activeAccount.userId !== title && (
                <QuietChip label="uid" value={activeAccount.userId} />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <User className="h-5 w-5 text-slate-400 mt-0.5" />
            <div>
              <span className="text-xs font-medium text-slate-400 block">Username / Subject Identity</span>
              <strong className="text-slate-800 dark:text-slate-200 font-mono select-all text-sm">
                {activeAccount.username || title}
              </strong>
              {activeAccount.displayName && (
                <span className="text-xs text-slate-500 block mt-0.5">Alias: {activeAccount.displayName}</span>
              )}
            </div>
          </div>

          {activeAccount.userId && (
            <div className="flex items-start space-x-3">
              <Cpu className="h-5 w-5 text-slate-400 mt-0.5" />
              <div>
                <span className="text-xs font-medium text-slate-400 block">Assigned UID / Forensic ID</span>
                <span className="text-slate-800 dark:text-slate-300 font-mono text-xs select-all bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 px-1.5 py-0.5 rounded leading-none block mt-1 w-fit">
                  {activeAccount.userId}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <Mail className="h-5 w-5 text-slate-400 mt-0.5" />
            <div>
              <span className="text-xs font-medium text-slate-400 block">Associated Email Address</span>
              {activeAccount.email ? (
                <a href={`mailto:${activeAccount.email}`} className="text-indigo-600 dark:text-indigo-400 font-mono text-sm hover:underline select-all">
                  {activeAccount.email}
                </a>
              ) : (
                <span className="text-slate-550 dark:text-slate-400 text-xs italic">N/A</span>
              )}
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Phone className="h-5 w-5 text-slate-400 mt-0.5" />
            <div>
              <span className="text-xs font-medium text-slate-400 block">Registered Telephone</span>
              <span className="text-slate-800 dark:text-slate-200 font-mono text-sm select-all">
                {activeAccount.phone || 'N/A'}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <Calendar className="h-5 w-5 text-slate-400 mt-0.5" />
            <div>
              <span className="text-xs font-medium text-slate-400 block">Registration Timestamp</span>
              <span className="text-slate-800 dark:text-slate-200 font-medium text-sm">
                {activeAccount.createdDate ? new Date(activeAccount.createdDate).toLocaleString() : 'N/A'}
              </span>
            </div>
          </div>

          {activeAccount.registrationIp && (
            <div className="flex items-start space-x-3">
              <ShieldCheck className="h-5 w-5 text-slate-400 mt-0.5" />
              <div>
                <span className="text-xs font-medium text-slate-400 block">Registration IP Address</span>
                <span className="text-rose-700 dark:text-rose-400 font-semibold font-mono text-xs bg-rose-50 dark:bg-rose-950/50 border border-rose-100 dark:border-rose-900/50 px-1.5 py-0.5 rounded block mt-1 w-fit">
                  {activeAccount.registrationIp}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {(activeAccount.sourceFile || activeAccount.otherDetails?.['Source File']) && (
        <div className="px-6 py-2 bg-slate-50/50 dark:bg-slate-950/30 border-t border-slate-100 dark:border-slate-850/60 text-[10px] text-slate-400 dark:text-slate-500 font-mono flex items-center justify-between gap-3">
          <span className="truncate" title={activeAccount.sourceFile || activeAccount.otherDetails?.['Source File']}>
            Source: {activeAccount.sourceFile || activeAccount.otherDetails?.['Source File']}
          </span>
          <span className="shrink-0">Scope: {activeAccount.provider || provider}</span>
        </div>
      )}

      {activeAccount.otherDetails && Object.keys(activeAccount.otherDetails).length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-950/60 border-t border-slate-100 dark:border-slate-800 px-6 py-4">
          <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Extended Registry Audit Attributes</h5>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Object.entries(activeAccount.otherDetails)
              .filter(([key]) => !['Profile', 'Username', 'Display Name', 'Email', 'Mobile Number', 'Created Timestamp', 'Registration IP', 'Phone', 'Created Date', 'User ID', 'Source', 'Source File'].includes(key))
              .map(([key, val]) => (
                <div key={key} className="text-xs">
                  <span className="text-slate-400 block truncate font-medium">{key}</span>
                  <span className="text-slate-700 dark:text-slate-350 font-mono block truncate font-semibold" title={String(val)}>
                    {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}

export function AccountInfoCard({
  account,
  accounts,
  accountChanges,
  provider,
  selectedAccountFilter,
  onAccountFilterChange,
  linkEdges = [],
}: AccountProps) {
  const hasMultiple = !!(accounts && accounts.length > 1);

  const activeAccount: AccountRecord | undefined = (() => {
    if (selectedAccountFilter === 'all') return undefined;
    if (accounts && accounts.length > 0) {
      const match = accounts.find((a, idx) => {
        const label = accountFilterLabel(a, idx);
        return (
          label === selectedAccountFilter ||
          a.username === selectedAccountFilter ||
          a.userId === selectedAccountFilter ||
          a.accountKey === selectedAccountFilter ||
          a.displayName === selectedAccountFilter
        );
      });
      return match || account;
    }
    return account;
  })();

  if (!activeAccount && !(accounts && accounts.length > 0)) {
    return (
      <div id="no-profile-card" className="p-6 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl shadow-xs text-center animate-pulse">
        <User className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
        <h4 className="font-semibold text-slate-700 dark:text-slate-300 text-sm">No Primary Profile Extracted</h4>
        <p className="text-xs text-slate-400 dark:text-slate-550 mt-1">
          {provider === 'kik'
            ? 'Include subscriber-data-<username>.pdf from the Kik return root, then re-import.'
            : 'Upload details like JSON profiles, account settings, or registration files to pull account metadata.'}
        </p>
      </div>
    );
  }

  return (
    <div id="account-profile-card" className="bg-white dark:bg-slate-900 border text-left border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
      <div className="bg-slate-900 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-800 rounded-lg border border-slate-700 text-indigo-400">
            <User className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-white font-bold text-base leading-tight font-mono truncate max-w-[280px] sm:max-w-md">
              {activeAccount?.username || activeAccount?.displayName || 'Subscriber Details'}
            </h4>
            <span className="text-xs text-slate-400 uppercase tracking-widest">
              {provider === 'kik' ? 'Kik subject identity' : `${provider} Registry`}
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          {linkEdges.length > 0 && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-900/40 text-indigo-300 border border-indigo-800/50">
              <Link2 className="h-3 w-3 mr-1" /> {linkEdges.length} link suggestion{linkEdges.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-900/40 text-emerald-300 border border-emerald-800/50">
            <ShieldCheck className="h-3 w-3 mr-1" /> Verified Data
          </span>
        </div>
      </div>

      {hasMultiple && (
        <div className="bg-slate-50 dark:bg-slate-950/75 border-b border-slate-200 dark:border-slate-800/80 px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">
            Accounts ({accounts!.length}) — unmerged:
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onAccountFilterChange('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center space-x-1.5 cursor-pointer ${
                selectedAccountFilter === 'all'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-350 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${selectedAccountFilter === 'all' ? 'bg-white' : 'bg-indigo-400'}`} />
              <span>All Accounts</span>
            </button>

            {accounts!.map((acc, idx) => {
              const label = accountFilterLabel(acc, idx);
              const isSelected =
                selectedAccountFilter === label ||
                selectedAccountFilter === acc.username ||
                selectedAccountFilter === acc.userId ||
                selectedAccountFilter === acc.accountKey;
              const exactCount = exactLinkCountForAccount(acc.accountKey, linkEdges);
              return (
                <button
                  key={acc.accountKey || `${label}-${idx}`}
                  onClick={() => onAccountFilterChange(label)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center space-x-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-350 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : exactCount > 0 ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                  <span>{acc.username || acc.displayName || acc.userId || `Identity #${idx + 1}`}</span>
                  {exactCount > 0 && (
                    <span
                      className={`inline-flex items-center gap-0.5 text-[9px] font-black ${
                        isSelected ? 'text-indigo-100' : 'text-indigo-600 dark:text-indigo-400'
                      }`}
                      title="Exact link suggestions"
                    >
                      <Link2 className="h-3 w-3" />
                      {exactCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedAccountFilter === 'all' && accounts && accounts.length > 1 ? (
        <div className="p-6">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Account roster ({accounts.length} separate identities)
            </h5>
            <span className="text-[10px] text-slate-400">
              Profiles stay separate — shared identifiers are link suggestions only
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((acc, idx) => {
              const label = accountFilterLabel(acc, idx);
              return (
                <MiniAccountCard
                  key={acc.accountKey || `${label}-${idx}`}
                  acc={acc}
                  idx={idx}
                  exactCount={exactLinkCountForAccount(acc.accountKey, linkEdges)}
                  onSelect={() => onAccountFilterChange(label)}
                />
              );
            })}
          </div>
        </div>
      ) : (activeAccount || (accounts && accounts.length === 1)) ? (
        <ProfileGrid
          activeAccount={activeAccount || accounts![0]}
          provider={provider}
        />
      ) : null}

      {accountChanges && accountChanges.length > 0 && selectedAccountFilter !== 'all' && (
        <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Account Changes & Security Modifications</h5>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Forensic audit logs of profile edits, password updates, and settings changes.</p>
              </div>
            </div>
            <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono font-bold px-2.5 py-1 rounded-full w-fit">
              {accountChanges.length} Events Detected
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-100 dark:border-slate-850 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-450 dark:text-slate-400 font-bold uppercase text-[9px] tracking-wider bg-slate-50/75 dark:bg-slate-950/80">
                  <th className="px-4 py-3">Timestamp (UTC/Local)</th>
                  <th className="px-4 py-3">Subject / Operator</th>
                  <th className="px-4 py-3">Modification Field</th>
                  <th className="px-4 py-3">Updated Value & Payload</th>
                  <th className="px-4 py-3">Initiated IP Address</th>
                  <th className="px-4 py-3">Source File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-850/40">
                {accountChanges.map((change, idx) => (
                  <tr key={change.id || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition-all">
                    <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {(() => {
                        try {
                          return new Date(change.timestamp).toISOString().replace('T', ' ').substring(0, 19);
                        } catch {
                          return change.timestamp;
                        }
                      })()}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{change.username}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded font-bold text-[9px] uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40">
                        {change.field}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                      {change.oldValue !== 'N/A' ? (
                        <div className="flex items-center space-x-2">
                          <span className="text-slate-400 line-through font-normal">{change.oldValue}</span>
                          <span className="text-slate-400">→</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">{change.newValue}</span>
                        </div>
                      ) : (
                        <span className="truncate max-w-xs block" title={change.newValue}>{change.newValue}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono whitespace-nowrap">
                      {change.ipAddress ? (
                        <span className="text-rose-600 dark:text-rose-450 font-semibold">{change.ipAddress}</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-[10px] truncate max-w-[120px]" title={change.source}>
                      {change.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
