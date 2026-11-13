// uwrp-b8: Instructions guide sections for direct ZIP loading and the Apple iCloud features (beta.1 - beta.8).
import React from 'react';

const H = ({ children }: { children: React.ReactNode }) => <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm mt-4">{children}</h4>;
const Box = ({ tone = 'indigo', children }: { tone?: 'indigo' | 'amber' | 'emerald'; children: React.ReactNode }) => {
  const c = tone === 'amber' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300'
    : tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300'
    : 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/50 text-indigo-800 dark:text-indigo-300';
  return <div className={`border p-4 rounded-xl text-xs space-y-2 leading-normal ${c}`}>{children}</div>;
};
const UL = ({ children }: { children: React.ReactNode }) => <ul className="list-disc pl-5 space-y-1 text-xs">{children}</ul>;

export function HelpZip() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200" data-help="zip">
      <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Loading a ZIP directly vs. an extracted folder</h3>
      <p>In the desktop app, a <code>.zip</code> you pick or drop is streamed from disk by the app (not loaded into memory), one entry at a time, into a private working folder inside the app's data folder. It is then processed exactly like a folder you extracted yourself, including zips nested inside zips.</p>
      <Box tone="emerald">
        <p><strong>Same results either way.</strong> Loading <code>Return.zip</code> or the folder you get from extracting it now gives the same files, media and events. There is no practical size limit apart from free disk space. Multi-gigabyte returns are fine.</p>
        <p>The original zip is only ever read. It is never changed. The working copy is reused when you reopen the case, so the zip isn't extracted twice.</p>
      </Box>
      <UL>
        <li>Entries that can't be extracted (damaged or unsafe paths) are listed in the Diagnostics log. They are never silently dropped.</li>
        <li>Empty (0-byte) entries are kept and labelled "empty file", so you can tell them apart from extraction failures.</li>
        <li>Encrypted Apple returns (<code>.zip.gpg</code>) open the Apple wizard instead. See the "Apple iCloud" tab.</li>
        <li>Web/browser builds (no desktop app) still unzip in the browser, which is limited to about 100 MB. For bigger returns there, extract first and use "Import Folder / Directory".</li>
      </UL>
      <H>Media recognition</H>
      <p className="text-xs">Images (JPEG, PNG, GIF, HEIC) and videos (MP4, MOV including HEVC, WEBM) are recognised by their content, not just their extension, and indexed as attachments for the timeline and Media Vault.</p>
    </div>
  );
}

export function HelpICloud() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200" data-help="icloud">
      <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Apple iCloud returns</h3>

      <H>1. Encrypted returns (.zip.gpg) and the passcode</H>
      <UL>
        <li>Choose <strong>Import Apple .zip.gpg…</strong>, or simply pick or drop a <code>.zip.gpg</code> anywhere. It goes straight to the wizard's passcode step. The file pickers show <code>.gpg</code> files.</li>
        <li>Type the passcode Apple supplied. It is kept in memory only and passed to GnuPG privately. It is never written to settings, logs or the command line.</li>
        <li>Decryption and extraction write to a working folder (temporary <code>.part</code> files are renamed only after the size checks out). The original download is never modified.</li>
        <li>Several <code>.zip.gpg</code> parts of one production can be added together. The wizard shows progress for each file and a summary of what it found.</li>
      </UL>

      <H>2. Already-extracted returns</H>
      <UL>
        <li>Use <strong>Open extracted Apple return folder…</strong> when the return is already decrypted and unzipped. This includes the "bash download" layout (<code>production / account / Apple ID / category</code>).</li>
        <li>Every account and every data category is detected, and it parses the same as loading the zipped return.</li>
      </UL>

      <H>3. The iCloud tab</H>
      <UL>
        <li>Sections: Account / subscriber, Contacts, Calendars, Photos and iCloud Drive media, Mail, Notes, Messages / iMessage backups, FaceTime and call logs, Find My / device info, Sign-in and IP logs, and iCloud device backups.</li>
        <li><strong>Backups:</strong> each device backup is listed by device and date with its contents (messages, contacts, photos, app data). Open a backup to browse it, whether it was loaded as a folder or a zip.</li>
        <li>Spreadsheet logs (xlsx/csv) are shown as sortable, searchable tables.</li>
      </UL>

      <H>4. Tagging to Exhibits</H>
      <p className="text-xs">Any item in the iCloud tab, a backup, media or email can be tagged. Tagged items show up in <strong>Exhibits</strong> and in the HTML/PDF report, with their source file path for provenance.</p>

      <H>5. Several accounts or providers</H>
      <UL>
        <li><strong>Account switcher:</strong> shown only when a case has two or more Apple accounts. It filters the iCloud tab to one account or All. With a single account it stays hidden.</li>
        <li><strong>Provider filter:</strong> shown only when a case has two or more providers (for example Apple plus Snapchat). It limits conversations, media, email, timeline and exhibits to All or one provider. Correlation and cross-provider views always use every provider.</li>
      </UL>

      <H>6. Media viewer</H>
      <UL>
        <li><strong>HEVC .mov/.mp4</strong> (sound with no picture before): the app converts the video to H.264 on the fly in memory using the bundled ffmpeg. Nothing is written to disk. Seeking can take a moment on long videos.</li>
        <li><strong>HEIC photos</strong> are decoded in memory and displayed.</li>
        <li><strong>Zoom and pan:</strong> use the mouse wheel or the +/- buttons to zoom and drag to pan. Double-click or press 0 to reset.</li>
        <li>Previews and thumbnails are generated in memory only. They are never saved to disk or hashed.</li>
      </UL>

      <H>7. Email</H>
      <UL>
        <li>Emails open only in the <strong>Email</strong> viewer. They no longer clutter Conversations.</li>
        <li>HTML emails are sanitised and shown in a locked-down sandbox. Scripts never run, and remote images and trackers are <strong>blocked</strong> unless you click "Load remote content" for that message. A plain-text view is always available.</li>
        <li>The email viewer follows the app's light/dark theme.</li>
      </UL>

      <H>8. "0 KB" / empty files</H>
      <Box tone="amber">
        <p>File sizes are now exact (bytes for small files). A file is labelled <strong>empty file</strong> only if it really is 0 bytes in the return. Apple sometimes produces genuinely empty placeholders. Extraction verifies every size, so a size mismatch shows up as an error, not as a silent 0 KB file.</p>
      </Box>
    </div>
  );
}
