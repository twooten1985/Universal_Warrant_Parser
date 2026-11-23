/**
 * Dropbox return: media, documents, file activity, and the user-metadata report.
 * Activity rows with no file, and files with no activity row, both stay on screen.
 */
import React, { useMemo, useState } from 'react';
import type { ForensicEvent, UploadedFile } from '../types';
import { classifyDropboxPath, dropboxCategoryLabel } from '../lib/dropboxPath';
import { DROPBOX_NO_DATA } from '../lib/dropboxParse';
import { matchDropboxActivity } from '../lib/dropboxMatch';

interface Props {
  events: ForensicEvent[];
  files: UploadedFile[];
  account?: {
    userId?: string;
    displayName?: string;
    email?: string;
    otherDetails?: Record<string, string>;
  };
}

function mediaUrl(file: UploadedFile): string {
  if (file.content?.startsWith('data:')) return file.content;
  if (file.sourcePath) return `/api/local-media?path=${encodeURIComponent(file.sourcePath)}`;
  return '';
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{children}</span>;
}

export function DropboxView({ events, files, account }: Props) {
  const [tab, setTab] = useState<'media' | 'documents' | 'activity' | 'account'>('media');
  const located = useMemo(() => files.map(file => ({ file, loc: classifyDropboxPath(file.relativePath || file.name) })), [files]);
  const media = located.filter(item => item.file.isMedia && (item.loc.area === 'deleted' || item.loc.area === 'current'));
  const documents = located.filter(item => !item.file.isMedia && (item.loc.area === 'deleted' || item.loc.area === 'current') && !/\.(csv|tsv)$/i.test(item.file.name));
  const notes = events.filter(event => event.details?.dropboxKind === 'no-data');
  const match = useMemo(() => matchDropboxActivity(files, events), [files, events]);
  const auth = events.filter(event => event.details?.dropboxKind === 'auth-log');
  const mobile = events.filter(event => event.details?.dropboxKind === 'mobile');

  return (
    <div id="tabview-dropbox" className="space-y-4 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Dropbox</h3>
        {account?.userId && <Badge>User {account.userId}</Badge>}
        {account?.displayName && <span className="text-xs text-slate-500">{account.displayName}</span>}
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

      {notes.length > 0 && (
        <ul id="dropbox-no-data" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          {notes.map(note => (
            <li key={note.id}>{note.details?.dropboxSection ? `${note.details.dropboxSection}: ` : ''}{DROPBOX_NO_DATA}</li>
          ))}
        </ul>
      )}

      {tab === 'media' && (
        <div id="dropbox-media-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.length === 0 && <p className="text-xs text-slate-400">No images or videos in this return.</p>}
          {media.map(({ file, loc }) => {
            const src = mediaUrl(file);
            return (
              <figure key={file.relativePath || file.name} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
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
                  </p>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      {tab === 'documents' && (
        <ul id="dropbox-documents" className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {documents.length === 0 && <li className="p-3 text-xs text-slate-400">No documents in this return.</li>}
          {documents.map(({ file, loc }) => (
            <li key={file.relativePath || file.name} className="flex flex-wrap items-center justify-between gap-2 p-2 text-xs">
              <span className="font-mono" title={file.relativePath}>{file.relativePath || file.name}</span>
              <span className="flex gap-1">
                <Badge>{loc.deleted ? 'Deleted' : 'File Data'}</Badge>
                <Badge>{loc.categoryLabel}</Badge>
                {loc.part && <Badge>{loc.part}</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'activity' && (
        <div id="dropbox-activity" className="space-y-4">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>
                <th className="py-1 pr-2">Time (UTC)</th>
                <th className="py-1 pr-2">Action</th>
                <th className="py-1 pr-2">Size</th>
                <th className="py-1 pr-2">Path</th>
                <th className="py-1">Category</th>
              </tr>
            </thead>
            <tbody>
              {[...match.matched.map(item => item.event), ...match.activityWithoutFile].map(event => (
                <tr key={event.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-2 font-mono">{event.details?.dropboxTime || event.timestamp}</td>
                  <td className="py-1 pr-2">{event.details?.dropboxAction || ''}</td>
                  <td className="py-1 pr-2">{event.details?.dropboxSize || ''}</td>
                  <td className="py-1 pr-2 font-mono">{event.details?.dropboxFilePath || ''}</td>
                  <td className="py-1">{event.details?.dropboxCategoryLabel || dropboxCategoryLabel('unknown')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <h4 className="text-[11px] font-bold uppercase text-slate-500">CSV rows with no matching file</h4>
            <ul id="dropbox-activity-unmatched" className="mt-1 space-y-1 text-xs">
              {match.activityWithoutFile.length === 0 && <li className="text-slate-400">None.</li>}
              {match.activityWithoutFile.map(event => (
                <li key={event.id} className="font-mono">{event.details?.dropboxCategoryLabel}: {event.details?.dropboxFilePath}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-[11px] font-bold uppercase text-slate-500">Files with no CSV row</h4>
            <ul id="dropbox-files-unmatched" className="mt-1 space-y-1 text-xs">
              {match.filesWithoutActivity.length === 0 && <li className="text-slate-400">None.</li>}
              {match.filesWithoutActivity.map(file => {
                const loc = classifyDropboxPath(file.relativePath || file.name);
                return <li key={file.relativePath || file.name} className="font-mono">{loc.categoryLabel}: {file.relativePath || file.name}</li>;
              })}
            </ul>
          </div>
        </div>
      )}

      {tab === 'account' && (
        <div id="dropbox-account" className="space-y-3 text-xs">
          <section>
            <h4 className="font-bold uppercase text-slate-500">Basic information</h4>
            <p>User ID: {account?.userId || 'Not in this return'}</p>
            <p>Full name: {account?.displayName || account?.otherDetails?.['Full Name'] || 'Not in this return'}</p>
            <p>Email: {account?.email || account?.otherDetails?.['Email Address'] || 'Not in this return'}</p>
          </section>
          <section>
            <h4 className="font-bold uppercase text-slate-500">Authentication log</h4>
            {auth.length === 0 && <p>{DROPBOX_NO_DATA}</p>}
            <ul>
              {auth.map(event => (
                <li key={event.id} className="font-mono">{event.details?.dropboxTime || event.timestamp} {event.ipAddress || ''}</li>
              ))}
            </ul>
          </section>
          <section>
            <h4 className="font-bold uppercase text-slate-500">Mobile</h4>
            {mobile.length === 0 && !account?.otherDetails?.['Device model'] && <p>{notes.some(note => note.details?.dropboxSection === 'Mobile Information') ? DROPBOX_NO_DATA : 'Not in this return'}</p>}
            {mobile.map(event => (
              <p key={event.id}>{event.details?.deviceModel || 'Device'} · {event.details?.deviceCarrier || ''} · {event.ipAddress} · {event.details?.dropboxTime || event.timestamp}</p>
            ))}
          </section>
          <section>
            <h4 className="font-bold uppercase text-slate-500">Linked computers</h4>
            <p>{account?.otherDetails?.['Linked computers'] || (notes.some(note => note.details?.dropboxSection === 'Linked Computer Information') ? DROPBOX_NO_DATA : 'Not in this return')}</p>
          </section>
          <section>
            <h4 className="font-bold uppercase text-slate-500">Billing</h4>
            <p>{account?.otherDetails?.['Billing Activity'] || (notes.some(note => note.details?.dropboxSection === 'Billing Activity') ? DROPBOX_NO_DATA : 'Not in this return')}</p>
          </section>
        </div>
      )}
    </div>
  );
}
