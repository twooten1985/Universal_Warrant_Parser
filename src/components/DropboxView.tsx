/**
 * Dropbox return: media, documents, file activity, and the user-metadata report.
 * Activity rows with no file, and files with no activity row, both stay on screen.
 * Rows use the same case tags as the media vault and Google rows.
 */
import React, { useMemo, useState } from 'react';
import type { ForensicEvent, UploadedFile } from '../types';
import { classifyDropboxPath, dropboxCategoryLabel, dropboxFileTagKey, isDropboxUserReport } from '../lib/dropboxPath';
import { DROPBOX_NO_DATA } from '../lib/dropboxParse';
import { matchDropboxActivity } from '../lib/dropboxMatch';
import type { TagItem } from '../lib/exhibits';
import type { CustomTagDef } from '../lib/customTags';
import { TagApplyControls, TagChips } from './CustomTags';

interface TagRecord { tagged?: boolean; notes?: string; labels?: string[] }

interface Props {
  events: ForensicEvent[];
  files: UploadedFile[];
  account?: {
    userId?: string;
    displayName?: string;
    email?: string;
    otherDetails?: Record<string, string>;
  };
  evidenceTags?: Record<string, TagRecord>;
  tagDefinitions?: CustomTagDef[];
  onTag?: (items: TagItem[], tagged: boolean) => void;
  onUpdateNotes?: (key: string, notes: string) => void;
  onToggleLabels?: (keys: string[], labelId: string, on: boolean) => void;
}

function mediaUrl(file: UploadedFile): string {
  if (file.content?.startsWith('data:')) return file.content;
  if (file.sourcePath) return `/api/local-media?path=${encodeURIComponent(file.sourcePath)}`;
  return '';
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{children}</span>;
}

function itemMeta(event: ForensicEvent, accountId: string): TagItem['meta'] {
  return {
    source: 'Dropbox',
    kind: String(event.details?.dropboxKind || event.category || 'file'),
    account: accountId,
    path: String(event.details?.relativePath || event.sourceFile || ''),
    timestamp: String(event.details?.dropboxTime || event.timestamp || ''),
    category: String(event.details?.dropboxSection || event.details?.dropboxCategoryLabel || 'Dropbox'),
    description: String(event.content || '').slice(0, 240),
  };
}

function fileMeta(file: UploadedFile, accountId: string): TagItem['meta'] {
  const loc = classifyDropboxPath(file.relativePath || file.name);
  return {
    source: 'Dropbox',
    kind: 'dropbox-file',
    account: accountId,
    path: file.relativePath || file.name,
    category: `${loc.deleted ? 'Deleted' : 'File Data'} · ${loc.categoryLabel}`,
    description: `${file.isMedia ? 'Media' : 'File'} ${file.relativePath || file.name}`,
  };
}

export function DropboxView({
  events,
  files,
  account,
  evidenceTags = {},
  tagDefinitions = [],
  onTag,
  onUpdateNotes,
  onToggleLabels,
}: Props) {
  const [tab, setTab] = useState<'media' | 'documents' | 'activity' | 'account'>('account');
  const [taggedOnly, setTaggedOnly] = useState(false);
  const located = useMemo(() => files.map(file => ({ file, loc: classifyDropboxPath(file.relativePath || file.name) })), [files]);
  const media = located.filter(item => item.file.isMedia && (item.loc.area === 'deleted' || item.loc.area === 'current'));
  const documents = located.filter(item => !item.file.isMedia && (item.loc.area === 'deleted' || item.loc.area === 'current') && !/\.(csv|tsv)$/i.test(item.file.name));
  const notes = events.filter(event => event.details?.dropboxKind === 'no-data');
  const notices = events.filter(event => event.details?.dropboxKind === 'parse-notice');
  const report = files.find(file => isDropboxUserReport(file.name) || isDropboxUserReport(file.relativePath || ''));
  const match = useMemo(() => matchDropboxActivity(files, events), [files, events]);
  const auth = events.filter(event => event.details?.dropboxKind === 'auth-log');
  const mobile = events.filter(event => event.details?.dropboxKind === 'mobile');
  const computers = events.filter(event => event.details?.dropboxKind === 'computer');
  const billing = events.filter(event => event.details?.dropboxKind === 'billing');
  const accountId = account?.userId || '';
  const tagged = (key: string) => {
    const row = evidenceTags[key];
    return !!row?.tagged || (row?.labels?.length || 0) > 0;
  };
  const show = (key: string) => !taggedOnly || tagged(key);

  const star = (item: TagItem) => (
    <button
      type="button"
      disabled={!onTag}
      onClick={() => onTag?.([item], !evidenceTags[item.key]?.tagged)}
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${evidenceTags[item.key]?.tagged ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
    >
      {evidenceTags[item.key]?.tagged ? 'Tagged' : 'Tag'}
    </button>
  );

  return (
    <div id="tabview-dropbox" className="space-y-4 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Dropbox</h3>
        {account?.userId && <Badge>User {account.userId}</Badge>}
        {account?.displayName && <span className="text-xs text-slate-500">{account.displayName}</span>}
        <label className="ml-auto flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
          <input id="dropbox-tagged-only" type="checkbox" checked={taggedOnly} onChange={e => setTaggedOnly(e.target.checked)} />
          Tagged only
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {([
          ['media', `Media (${media.length})`],
          ['documents', `Documents (${documents.length})`],
          ['activity', `File activity (${match.matched.length + match.activityWithoutFile.length})`],
          ['account', 'Account'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            id={`dropbox-tab-${id}`}
            onClick={() => setTab(id)}
            className={`rounded-lg px-2 py-1 text-[11px] font-bold ${tab === id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {notices.length > 0 && (
        <div id="dropbox-pdf-notice" className="space-y-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-950 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-100">
          <p className="font-bold">The user report could not be read into the account panel.</p>
          {notices.map(note => <p key={note.id}>{note.details?.dropboxNote || note.content}</p>)}
          {report ? (
            <p>
              {report.sourcePath ? (
                <a className="font-bold underline" href={mediaUrl(report)} target="_blank" rel="noreferrer">View PDF</a>
              ) : (
                <span>The PDF is in this return.</span>
              )}
              <span className="ml-2 font-mono">{report.relativePath || report.name}</span>
            </p>
          ) : (
            <p>No user-metadata PDF was found at any depth in this return. Names such as user-metadata.pdf and User Metadata.pdf are accepted.</p>
          )}
        </div>
      )}

      {notes.length > 0 && (
        <ul id="dropbox-no-data" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          {notes.map(note => (
            <li key={note.id}>{note.details?.dropboxSection ? `${note.details.dropboxSection}: ` : ''}{DROPBOX_NO_DATA}</li>
          ))}
        </ul>
      )}

      {tab === 'media' && (
        <div id="dropbox-media-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.length === 0 && <p className="text-xs text-slate-400">No images or videos in this return. They are also listed in the Media Vault.</p>}
          {media.map(({ file, loc }) => {
            const key = dropboxFileTagKey(file);
            if (!show(key)) return null;
            const src = mediaUrl(file);
            const meta = fileMeta(file, accountId);
            return (
              <figure key={key} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                {file.mediaType === 'video' && src
                  ? <video src={src} controls className="h-36 w-full bg-black object-contain" />
                  : src
                    ? <img src={src} alt={file.name} className="h-36 w-full object-cover" />
                    : <div className="flex h-36 items-center justify-center text-[10px] text-slate-400">No preview path</div>}
                <figcaption className="space-y-1 p-2 text-[10px]">
                  <p className="truncate font-mono" title={file.relativePath}>{file.name}</p>
                  <p className="flex flex-wrap gap-1">
                    <Badge>{loc.deleted ? 'Deleted' : 'File Data'}</Badge>
                    <Badge>{loc.categoryLabel}</Badge>
                    {loc.part && <Badge>{loc.part}</Badge>}
                    {star({ key, meta })}
                  </p>
                  <TagChips defs={tagDefinitions} ids={evidenceTags[key]?.labels} onRemove={onToggleLabels ? (id => onToggleLabels([key], id, false)) : undefined} />
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      {tab === 'documents' && (
        <ul id="dropbox-documents" className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {documents.length === 0 && <li className="p-3 text-xs text-slate-400">No documents in this return.</li>}
          {documents.map(({ file, loc }) => {
            const key = dropboxFileTagKey(file);
            if (!show(key)) return null;
            const meta = fileMeta(file, accountId);
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 p-2 text-xs">
                <span className="font-mono" title={file.relativePath}>{file.relativePath || file.name}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge>{loc.deleted ? 'Deleted' : 'File Data'}</Badge>
                  <Badge>{loc.categoryLabel}</Badge>
                  {loc.part && <Badge>{loc.part}</Badge>}
                  {star({ key, meta })}
                  <TagChips defs={tagDefinitions} ids={evidenceTags[key]?.labels} onRemove={onToggleLabels ? (id => onToggleLabels([key], id, false)) : undefined} />
                  {onToggleLabels && <TagApplyControls defs={tagDefinitions} onApply={id => onToggleLabels([key], id, true)} onClear={id => onToggleLabels([key], id, false)} />}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'activity' && (
        <div id="dropbox-activity" className="space-y-4">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>
                <th className="py-1 pr-2">Tag</th>
                <th className="py-1 pr-2">Time (UTC)</th>
                <th className="py-1 pr-2">Action</th>
                <th className="py-1 pr-2">Size</th>
                <th className="py-1 pr-2">Path</th>
                <th className="py-1">Category</th>
              </tr>
            </thead>
            <tbody>
              {[...match.matched.map(item => item.event), ...match.activityWithoutFile].map(event => {
                if (!show(event.id)) return null;
                return (
                  <tr key={event.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1 pr-2">{star({ key: event.id, meta: itemMeta(event, accountId) })}</td>
                    <td className="py-1 pr-2 font-mono">{event.details?.dropboxTime || event.timestamp}</td>
                    <td className="py-1 pr-2">{event.details?.dropboxAction || ''}</td>
                    <td className="py-1 pr-2">{event.details?.dropboxSize || ''}</td>
                    <td className="py-1 pr-2 font-mono">{event.details?.dropboxFilePath || ''}</td>
                    <td className="py-1">
                      {event.details?.dropboxCategoryLabel || dropboxCategoryLabel('unknown')}
                      <TagChips defs={tagDefinitions} ids={evidenceTags[event.id]?.labels} onRemove={onToggleLabels ? (id => onToggleLabels([event.id], id, false)) : undefined} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {onToggleLabels && (
            <TagApplyControls
              defs={tagDefinitions}
              onApply={id => onToggleLabels(activityKeys(match, taggedOnly, evidenceTags), id, true)}
              onClear={id => onToggleLabels(activityKeys(match, taggedOnly, evidenceTags), id, false)}
            />
          )}
          <div>
            <h4 className="text-[11px] font-bold uppercase text-slate-500">CSV rows with no matching file</h4>
            <ul id="dropbox-activity-unmatched" className="mt-1 space-y-1 text-xs">
              {match.activityWithoutFile.length === 0 && <li className="text-slate-400">None.</li>}
              {match.activityWithoutFile.filter(event => show(event.id)).map(event => (
                <li key={event.id} className="font-mono">{event.details?.dropboxCategoryLabel}: {event.details?.dropboxFilePath}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-[11px] font-bold uppercase text-slate-500">Files with no CSV row</h4>
            <ul id="dropbox-files-unmatched" className="mt-1 space-y-1 text-xs">
              {match.filesWithoutActivity.length === 0 && <li className="text-slate-400">None.</li>}
              {match.filesWithoutActivity.map(file => {
                const key = dropboxFileTagKey(file);
                if (!show(key)) return null;
                const loc = classifyDropboxPath(file.relativePath || file.name);
                return (
                  <li key={key} className="flex flex-wrap items-center gap-2 font-mono">
                    <span>{loc.categoryLabel}: {file.relativePath || file.name}</span>
                    {star({ key, meta: fileMeta(file, accountId) })}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {tab === 'account' && (
        <div id="dropbox-account" className="space-y-4 text-xs">
          <section id="dropbox-account-basic">
            <h4 className="font-bold uppercase text-slate-500">Basic information</h4>
            <p>User ID: {account?.userId || 'Not in this return'}</p>
            <p>Full name: {account?.displayName || account?.otherDetails?.['Full Name'] || 'Not in this return'}</p>
            <p>Email: {account?.email || account?.otherDetails?.['Email Address'] || 'Not in this return'}</p>
            {report && (
              <p className="mt-1">
                {report.sourcePath ? <a className="font-bold text-indigo-600 underline" href={mediaUrl(report)} target="_blank" rel="noreferrer">View user report PDF</a> : 'User report PDF'}
                <span className="ml-2 font-mono text-slate-500">{report.relativePath || report.name}</span>
              </p>
            )}
          </section>
          <section id="dropbox-account-auth">
            <h4 className="font-bold uppercase text-slate-500">Authentication log</h4>
            {auth.length === 0 && <p>{notes.some(note => note.details?.dropboxSection === 'Authentication Log') ? DROPBOX_NO_DATA : 'Not in this return'}</p>}
            {auth.length > 0 && (
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase text-slate-400"><tr><th className="py-1 pr-2">Tag</th><th className="py-1 pr-2">Time (UTC)</th><th className="py-1">IP</th></tr></thead>
                <tbody>
                  {auth.filter(event => show(event.id)).map(event => (
                    <tr key={event.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1 pr-2">{star({ key: event.id, meta: itemMeta(event, accountId) })}</td>
                      <td className="py-1 pr-2 font-mono">{event.details?.dropboxTime || event.timestamp}</td>
                      <td className="py-1 font-mono">{event.ipAddress || ''}<TagChips defs={tagDefinitions} ids={evidenceTags[event.id]?.labels} onRemove={onToggleLabels ? (id => onToggleLabels([event.id], id, false)) : undefined} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section id="dropbox-account-mobile">
            <h4 className="font-bold uppercase text-slate-500">Mobile devices</h4>
            {mobile.length === 0 && <p>{notes.some(note => note.details?.dropboxSection === 'Mobile Information') ? DROPBOX_NO_DATA : 'Not in this return'}</p>}
            {mobile.filter(event => show(event.id)).map(event => (
              <p key={event.id} className="flex flex-wrap items-center gap-2">
                {star({ key: event.id, meta: itemMeta(event, accountId) })}
                <span>{event.details?.deviceModel || 'Device'} · {event.details?.deviceCarrier || ''} · {event.ipAddress || ''} · {event.details?.dropboxTime || event.timestamp}</span>
                <TagChips defs={tagDefinitions} ids={evidenceTags[event.id]?.labels} onRemove={onToggleLabels ? (id => onToggleLabels([event.id], id, false)) : undefined} />
              </p>
            ))}
          </section>
          <section id="dropbox-account-computers">
            <h4 className="font-bold uppercase text-slate-500">Linked computers</h4>
            {computers.length === 0 && <p>{account?.otherDetails?.['Linked computers'] || (notes.some(note => note.details?.dropboxSection === 'Linked Computer Information') ? DROPBOX_NO_DATA : 'Not in this return')}</p>}
            <ul>
              {computers.filter(event => show(event.id)).map(event => (
                <li key={event.id} className="flex flex-wrap items-center gap-2">
                  {star({ key: event.id, meta: itemMeta(event, accountId) })}
                  <span>{event.content}</span>
                  <TagChips defs={tagDefinitions} ids={evidenceTags[event.id]?.labels} onRemove={onToggleLabels ? (id => onToggleLabels([event.id], id, false)) : undefined} />
                </li>
              ))}
            </ul>
          </section>
          <section id="dropbox-account-billing">
            <h4 className="font-bold uppercase text-slate-500">Billing</h4>
            {billing.length === 0 && <p>{notes.some(note => note.details?.dropboxSection === 'Billing Activity') ? DROPBOX_NO_DATA : (account?.otherDetails?.['Billing Activity'] || 'Not in this return')}</p>}
            {billing.filter(event => show(event.id)).map(event => (
              <p key={event.id} className="flex flex-wrap items-center gap-2">
                {star({ key: event.id, meta: itemMeta(event, accountId) })}
                <span>{event.content}</span>
              </p>
            ))}
          </section>
          {onUpdateNotes && (
            <p className="text-[10px] text-slate-400">Tags on these rows are the case evidence tags. They stay with the case and appear in the evidence locker and exports.</p>
          )}
        </div>
      )}
    </div>
  );
}

function activityKeys(
  match: ReturnType<typeof matchDropboxActivity>,
  taggedOnly: boolean,
  evidenceTags: Record<string, TagRecord>,
): string[] {
  return [...match.matched.map(item => item.event), ...match.activityWithoutFile]
    .map(event => event.id)
    .filter(id => !taggedOnly || !!evidenceTags[id]?.tagged || (evidenceTags[id]?.labels?.length || 0) > 0);
}
