import type { AccountRecord, ForensicEvent, UploadedFile } from '../types';
import { accountFilterLabel } from '../identity/extractIdentifiers';

export type MediaKind = 'all' | 'vic' | 'screenshot' | 'nudity' | 'image' | 'video' | 'location';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'dng']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', '3gp', '3gpp', 'webm']);

export function classifyMediaName(name: string): 'image' | 'video' | null {
  const ext = (name || '').toLowerCase().split('.').pop() || '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

export function fileHasLocation(file: UploadedFile): boolean {
  return !!file.gps && Number.isFinite(file.gps.lat) && Number.isFinite(file.gps.lng);
}

export interface MediaFilterInput {
  files: readonly UploadedFile[];
  kind: MediaKind;
  query: string;
  accountFilter: string;
  accounts?: readonly AccountRecord[] | null;
  events?: readonly ForensicEvent[] | null;
  evidenceTags?: Record<string, { tagged?: boolean; notes?: string }>;
  vicHashes: ReadonlySet<string>;
  /** Hashes that belong to a named set. Combined with Project VIC for the hash-match filter. */
  knownHashes?: ReadonlySet<string>;
  skinToneThreshold: number;
  tagKeyForFile: (file: UploadedFile) => string;
}

export function fileDigestList(file: { md5?: string | null; sha1?: string | null; sha256?: string | null }): string[] {
  const out: string[] = [];
  if (file.md5) out.push(file.md5.toLowerCase());
  if (file.sha1) out.push(file.sha1.toLowerCase());
  if (file.sha256) out.push(file.sha256.toLowerCase());
  return out;
}

export function fileMatchesHashList(
  file: { md5?: string | null; sha1?: string | null; sha256?: string | null },
  vicHashes: ReadonlySet<string>,
  knownHashes?: ReadonlySet<string>
): boolean {
  const values = fileDigestList(file);
  for (let i = 0; i < values.length; i++) {
    if (vicHashes.has(values[i])) return true;
    if (knownHashes?.has(values[i])) return true;
  }
  return false;
}

function addMediaToken(exact: Set<string>, tokens: Set<string>, value: unknown) {
  if (typeof value !== 'string') return;
  const t = value.trim();
  if (!t) return;
  exact.add(t);
  tokens.add(t.toLowerCase());
  const base = t.replace(/\\/g, '/').split('/').pop() || t;
  tokens.add(base.toLowerCase());
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  if (stem.length >= 4) tokens.add(stem.toLowerCase());
  const blocks = t.match(/[a-zA-Z0-9_-]{8,}/g) || [];
  for (let i = 0; i < blocks.length; i++) tokens.add(blocks[i].toLowerCase());
}

/** Same account, type, and search rules the media vault uses in the app and the portable case. */
export function filterMediaFiles(input: MediaFilterInput): UploadedFile[] {
  const {
    files,
    kind,
    query,
    accountFilter,
    accounts,
    events,
    evidenceTags,
    vicHashes,
    knownHashes,
    skinToneThreshold,
    tagKeyForFile,
  } = input;

  const selectedAcc =
    accountFilter !== 'all' && accounts
      ? accounts.find((a, idx) => {
          const label = accountFilterLabel(a, idx);
          return (
            label === accountFilter ||
            a.username === accountFilter ||
            a.userId === accountFilter ||
            a.accountKey === accountFilter ||
            a.displayName === accountFilter
          );
        })
      : undefined;

  const accountMediaExact = new Set<string>();
  const accountMediaTokens = new Set<string>();
  if (accountFilter !== 'all' && events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const matches =
        (selectedAcc?.accountKey && e.accountKey === selectedAcc.accountKey) ||
        e.targetAccount === accountFilter ||
        (selectedAcc?.username && e.targetAccount === selectedAcc.username) ||
        (selectedAcc?.userId && e.targetAccount === selectedAcc.userId);
      if (!matches) continue;
      addMediaToken(accountMediaExact, accountMediaTokens, e.details?.resolvedMediaName);
      addMediaToken(accountMediaExact, accountMediaTokens, e.details?.mediaRef);
      addMediaToken(accountMediaExact, accountMediaTokens, e.details?.mediaId);
      addMediaToken(accountMediaExact, accountMediaTokens, e.details?.filename);
      addMediaToken(accountMediaExact, accountMediaTokens, e.details?.fileName);
      addMediaToken(accountMediaExact, accountMediaTokens, e.details?.attachmentUrl);
      if (typeof e.content === 'string' && e.content) {
        const fileHits = e.content.match(/[\w.-]+\.(?:jpg|jpeg|png|gif|webp|bmp|heic|mp4|mov|mkv|avi|m4v)/gi) || [];
        for (let h = 0; h < fileHits.length; h++) addMediaToken(accountMediaExact, accountMediaTokens, fileHits[h]);
        const idHits = e.content.match(/\bb~[A-Za-z0-9_-]{8,}/g) || [];
        for (let h = 0; h < idHits.length; h++) addMediaToken(accountMediaExact, accountMediaTokens, idHits[h]);
      }
      if (e.details && typeof e.details === 'object') {
        try {
          const detailStr = JSON.stringify(e.details);
          const fileHits = detailStr.match(/[\w.-]+\.(?:jpg|jpeg|png|gif|webp|bmp|heic|mp4|mov|mkv|avi|m4v)/gi) || [];
          for (let h = 0; h < fileHits.length; h++) addMediaToken(accountMediaExact, accountMediaTokens, fileHits[h]);
        } catch {
          /* ignore */
        }
      }
    }
  }

  const needle = query.trim().toLowerCase();
  const out: UploadedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.isMedia) continue;

    if (accountFilter !== 'all') {
      const pathNorm = (file.relativePath || file.name || '').replace(/\\/g, '/');
      const basename = pathNorm.split('/').pop() || file.name || '';
      const nameLower = (file.name || '').toLowerCase();
      const baseLower = basename.toLowerCase();
      const stemLower = baseLower.includes('.') ? baseLower.slice(0, baseLower.lastIndexOf('.')) : baseLower;
      let eventMatch =
        accountMediaExact.has(file.name) ||
        accountMediaExact.has(basename) ||
        accountMediaTokens.has(nameLower) ||
        accountMediaTokens.has(baseLower) ||
        (stemLower.length >= 4 && accountMediaTokens.has(stemLower));
      if (!eventMatch) {
        const blocks = (file.name || '').match(/[a-zA-Z0-9_-]{8,}/g) || [];
        eventMatch = blocks.some(b => accountMediaTokens.has(b.toLowerCase()));
      }
      const segs = pathNorm.split('/').map(s => s.trim().toLowerCase()).filter(Boolean);
      const filterLower = accountFilter.toLowerCase();
      const usernameLower = selectedAcc?.username?.toLowerCase();
      const userIdLower = selectedAcc?.userId?.toLowerCase();
      const displayLower = selectedAcc?.displayName?.toLowerCase();
      const pathExact = segs.some(
        seg =>
          seg === filterLower ||
          (!!usernameLower && seg === usernameLower) ||
          (!!userIdLower && seg === userIdLower) ||
          (!!displayLower && seg === displayLower)
      );
      const pathSoft =
        !pathExact &&
        ((!!usernameLower && usernameLower.length >= 3 && segs.some(seg => seg.includes(usernameLower))) ||
          (!!userIdLower && userIdLower.length >= 3 && segs.some(seg => seg.includes(userIdLower))));
      if (!eventMatch && !(pathExact || pathSoft)) continue;
    }

    const isVicMatch = fileMatchesHashList(file, vicHashes, knownHashes);
    const isSkinNudity = (file.skinTonePercent || 0) >= skinToneThreshold;
    if (kind === 'vic' && !isVicMatch) continue;
    if (kind === 'screenshot' && !file.isScreenshot) continue;
    if (kind === 'nudity' && !isSkinNudity) continue;
    if (kind === 'image' && file.mediaType !== 'image') continue;
    if (kind === 'video' && file.mediaType !== 'video') continue;
    if (kind === 'location' && !fileHasLocation(file)) continue;

    if (needle) {
      const notes = evidenceTags?.[tagKeyForFile(file)]?.notes || '';
      const hay = `${file.name} ${file.relativePath || ''} ${file.mediaType || ''} ${notes}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    out.push(file);
  }
  return out;
}

export function mediaTagKey(fileName: string, byName: Map<string, { id: string }>): string {
  const match = byName.get(fileName);
  return match ? match.id : `media-file-${fileName}`;
}

export function countMediaKinds(
  files: readonly UploadedFile[],
  vicHashes: ReadonlySet<string>,
  skinToneThreshold: number,
  knownHashes?: ReadonlySet<string>
) {
  let all = 0;
  let vic = 0;
  let screenshot = 0;
  let nudity = 0;
  let image = 0;
  let video = 0;
  let location = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.isMedia) continue;
    all++;
    if (fileMatchesHashList(file, vicHashes, knownHashes)) vic++;
    if (file.isScreenshot) screenshot++;
    if ((file.skinTonePercent || 0) >= skinToneThreshold) nudity++;
    if (file.mediaType === 'image') image++;
    if (file.mediaType === 'video') video++;
    if (fileHasLocation(file)) location++;
  }
  return { all, vic, screenshot, nudity, image, video, location };
}
