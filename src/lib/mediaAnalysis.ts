/**
 * Hash every file from its original bytes, then run screenshot, nudity, and
 * EXIF checks separately. Hashing is streamed by the caller and is not timed
 * out. A hung preview or metadata read cannot discard a digest.
 */
import { normalizeHash } from './hashSets';

export const SKIN_TIMEOUT_MS = 8_000;
export const LOCATE_TIMEOUT_MS = 8_000;

export interface AnalysisTarget {
  name: string;
  relativePath?: string;
  size?: number;
  isMedia?: boolean;
  mediaType?: 'image' | 'video' | null;
  sourcePath?: string;
  content?: string;
  hasStoredBytes?: boolean;
  mediaMissing?: boolean;
  forensicsProcessed?: boolean;
  md5?: string | null;
  sha1?: string | null;
  sha256?: string | null;
  /** Set after a finished attempt so a failed file is not retried in this session. */
  digestStatus?: 'computed' | 'missing';
  /** True only when the three digests came from the original file bytes. */
  digestFromBytes?: boolean;
}

export interface DigestResult {
  md5?: string;
  sha1?: string;
  sha256?: string;
  gps?: { lat: number; lng: number } | null;
  gpsAlt?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
  missing?: boolean;
}

export type AnalysisStatus = 'analyzed' | 'skipped' | 'failed';

export interface AnalysisOutcome {
  name: string;
  relativePath?: string;
  status: AnalysisStatus;
  reason: string;
  md5?: string;
  sha1?: string;
  sha256?: string;
  isScreenshot?: boolean;
  skinTonePercent?: number;
  gps?: { lat: number; lng: number } | null;
  gpsAlt?: number | null;
  capturedAt?: string | null;
  device?: string | null;
  coordSource?: string | null;
  mediaMissing?: boolean;
  forensicsProcessed: true;
  digestStatus: 'computed' | 'missing';
}

export interface AnalysisSummary {
  analyzed: number;
  skipped: number;
  failed: number;
  reasons: Array<{ name: string; status: AnalysisStatus; reason: string }>;
}

export function fileKey(file: { name: string; relativePath?: string }): string {
  return `${file.relativePath || ''}::${file.name}`;
}

export function hasComputedDigests(file: { md5?: string | null; sha1?: string | null; sha256?: string | null }): boolean {
  return !!(normalizeHash(file.md5 || '') && normalizeHash(file.sha1 || '') && normalizeHash(file.sha256 || ''));
}

/** True when this file still needs MD5, SHA-1, and SHA-256 from its original bytes. */
export function fileNeedsHash(file: AnalysisTarget): boolean {
  if (file.digestFromBytes === false && canHash(file)) return true;
  if (file.digestStatus === 'missing') return false;
  if (file.digestFromBytes && hasComputedDigests(file)) return false;
  if (hasComputedDigests(file) && file.digestFromBytes !== false) return false;
  return canHash(file);
}

/** True when this media file still needs a pass over its bytes. Size is not a reason to skip. */
export function mediaNeedsAnalysis(file: AnalysisTarget): boolean {
  if (!file.isMedia) return false;
  if (file.digestFromBytes === false && canHash(file)) return true;
  if (file.digestStatus === 'missing') return false;
  if (hasComputedDigests(file) && file.forensicsProcessed !== false) return false;
  return true;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err || 'unknown error');
}

function canHash(file: AnalysisTarget): boolean {
  if (file.sourcePath) return true;
  if (file.hasStoredBytes) return true;
  const content = file.content || '';
  return content.startsWith('data:');
}

export function summarizeOutcomes(outcomes: AnalysisOutcome[]): AnalysisSummary {
  let analyzed = 0;
  let skipped = 0;
  let failed = 0;
  const reasons: AnalysisSummary['reasons'] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const item = outcomes[i];
    if (item.status === 'analyzed') analyzed += 1;
    else if (item.status === 'skipped') skipped += 1;
    else failed += 1;
    if (item.status !== 'analyzed' || /failed|timed out/i.test(item.reason)) {
      reasons.push({ name: item.name, status: item.status, reason: item.reason });
    }
  }
  return { analyzed, skipped, failed, reasons };
}

function cancelledError(): Error {
  const err = new Error('Hashing cancelled');
  err.name = 'AbortError';
  return err;
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(cancelledError());
      return;
    }
    signal.addEventListener('abort', () => reject(cancelledError()), { once: true });
  });
}

async function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return Promise.race([promise, waitForAbort(signal)]);
}

export async function runMediaAnalysis(
  files: AnalysisTarget[],
  deps: {
    digest: (file: AnalysisTarget) => Promise<DigestResult>;
    locate?: (file: AnalysisTarget) => Promise<Pick<DigestResult, 'gps' | 'gpsAlt' | 'capturedAt' | 'device' | 'coordSource'>>;
    skinTone?: (file: AnalysisTarget) => Promise<number>;
    isScreenshot?: (file: AnalysisTarget) => boolean;
    /** Ignored. Hashing is not timed out. Kept so older callers still compile. */
    hashTimeoutMs?: number;
    skinTimeoutMs?: number;
    locateTimeoutMs?: number;
    signal?: AbortSignal;
    onFileDone?: (done: number, total: number) => void;
  }
): Promise<{ outcomes: AnalysisOutcome[]; summary: AnalysisSummary }> {
  const skinTimeoutMs = deps.skinTimeoutMs ?? SKIN_TIMEOUT_MS;
  const locateTimeoutMs = deps.locateTimeoutMs ?? LOCATE_TIMEOUT_MS;
  const outcomes: AnalysisOutcome[] = [];
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    if (deps.signal?.aborted) break;
    const file = files[i];
    let outcome: AnalysisOutcome;
    try {
      outcome = await analyzeOne(file, deps, skinTimeoutMs, locateTimeoutMs);
    } catch (err) {
      if (deps.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) break;
      outcome = {
        name: file.name,
        relativePath: file.relativePath,
        status: 'failed',
        reason: errorText(err),
        forensicsProcessed: true,
        digestStatus: 'missing',
        mediaMissing: !!file.mediaMissing,
      };
    }
    outcomes.push(outcome);
    if (deps.onFileDone) deps.onFileDone(i + 1, total);
  }

  return { outcomes, summary: summarizeOutcomes(outcomes) };
}

async function analyzeOne(
  file: AnalysisTarget,
  deps: {
    digest: (file: AnalysisTarget) => Promise<DigestResult>;
    locate?: (file: AnalysisTarget) => Promise<Pick<DigestResult, 'gps' | 'gpsAlt' | 'capturedAt' | 'device' | 'coordSource'>>;
    skinTone?: (file: AnalysisTarget) => Promise<number>;
    isScreenshot?: (file: AnalysisTarget) => boolean;
    signal?: AbortSignal;
  },
  skinTimeoutMs: number,
  locateTimeoutMs: number
): Promise<AnalysisOutcome> {
  const base = {
    name: file.name,
    relativePath: file.relativePath,
    forensicsProcessed: true as const,
  };

  if (!canHash(file) && !(file.digestFromBytes && hasComputedDigests(file))) {
    return {
      ...base,
      status: 'skipped',
      reason: 'No file bytes are available to hash',
      digestStatus: 'missing',
      mediaMissing: true,
    };
  }

  let digested: DigestResult;
  if (file.digestFromBytes && hasComputedDigests(file)) {
    digested = { md5: file.md5 || undefined, sha1: file.sha1 || undefined, sha256: file.sha256 || undefined };
  } else {
    try {
      digested = await withSignal(deps.digest(file), deps.signal);
    } catch (err) {
      if (deps.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
      return {
        ...base,
        status: 'failed',
        reason: errorText(err),
        digestStatus: 'missing',
      };
    }
  }

  if (digested.missing) {
    return {
      ...base,
      status: 'failed',
      reason: 'File bytes were not found',
      digestStatus: 'missing',
      mediaMissing: true,
    };
  }

  const md5 = normalizeHash(digested.md5 || '') || undefined;
  const sha1 = normalizeHash(digested.sha1 || '') || undefined;
  const sha256 = normalizeHash(digested.sha256 || '') || undefined;
  if (!md5 || !sha1 || !sha256) {
    return {
      ...base,
      status: 'failed',
      reason: 'MD5, SHA-1, and SHA-256 were not all computed from the file bytes',
      digestStatus: 'missing',
      md5,
      sha1,
      sha256,
    };
  }

  let screenshot = false;
  if (file.isMedia) {
    try {
      screenshot = deps.isScreenshot ? deps.isScreenshot(file) : false;
    } catch {
      screenshot = false;
    }
  }

  const notes: string[] = ['MD5, SHA-1, and SHA-256 computed from the file bytes'];
  let skinTonePercent: number | undefined;
  if (file.isMedia && file.mediaType === 'image' && deps.skinTone) {
    try {
      skinTonePercent = await withTimeout(deps.skinTone(file), skinTimeoutMs, `Nudity check for ${file.name}`);
    } catch (err) {
      notes.push(`Nudity check failed: ${errorText(err)}`);
    }
  }

  let gps = digested.gps;
  let gpsAlt = digested.gpsAlt;
  let capturedAt = digested.capturedAt;
  let device = digested.device;
  let coordSource = digested.coordSource;
  if (file.isMedia && deps.locate) {
    try {
      const found = await withTimeout(deps.locate(file), locateTimeoutMs, `Metadata for ${file.name}`);
      if (found.gps) gps = found.gps;
      if (found.gpsAlt != null) gpsAlt = found.gpsAlt;
      if (found.capturedAt) capturedAt = found.capturedAt;
      if (found.device) device = found.device;
      if (found.coordSource) coordSource = found.coordSource;
    } catch (err) {
      notes.push(`Metadata read failed: ${errorText(err)}`);
    }
  }

  return {
    ...base,
    status: 'analyzed',
    reason: notes.join('. '),
    md5,
    sha1,
    sha256,
    isScreenshot: screenshot,
    skinTonePercent,
    gps,
    gpsAlt,
    capturedAt,
    device,
    coordSource,
    mediaMissing: false,
    digestStatus: 'computed',
  };
}
