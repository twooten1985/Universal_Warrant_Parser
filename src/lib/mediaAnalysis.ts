/**
 * Forensic analysis of one media file at a time.
 * Hashing, nudity, and metadata each have a timeout, and a thrown step
 * is recorded. The run always returns, including when the last file hangs.
 */
import { normalizeHash } from './hashSets';

export const HASH_TIMEOUT_MS = 120_000;
export const SKIN_TIMEOUT_MS = 8_000;

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

/** True when this media file still needs a pass over its bytes. Size is not a reason to skip. */
export function mediaNeedsAnalysis(file: AnalysisTarget): boolean {
  if (!file.isMedia) return false;
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

export async function runMediaAnalysis(
  files: AnalysisTarget[],
  deps: {
    digest: (file: AnalysisTarget) => Promise<DigestResult>;
    skinTone?: (file: AnalysisTarget) => Promise<number>;
    isScreenshot?: (file: AnalysisTarget) => boolean;
    hashTimeoutMs?: number;
    skinTimeoutMs?: number;
    onFileDone?: (done: number, total: number) => void;
  }
): Promise<{ outcomes: AnalysisOutcome[]; summary: AnalysisSummary }> {
  const hashTimeoutMs = deps.hashTimeoutMs ?? HASH_TIMEOUT_MS;
  const skinTimeoutMs = deps.skinTimeoutMs ?? SKIN_TIMEOUT_MS;
  const outcomes: AnalysisOutcome[] = [];
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let outcome: AnalysisOutcome;
    try {
      outcome = await analyzeOne(file, deps, hashTimeoutMs, skinTimeoutMs);
    } catch (err) {
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
    skinTone?: (file: AnalysisTarget) => Promise<number>;
    isScreenshot?: (file: AnalysisTarget) => boolean;
  },
  hashTimeoutMs: number,
  skinTimeoutMs: number
): Promise<AnalysisOutcome> {
  const base = {
    name: file.name,
    relativePath: file.relativePath,
    forensicsProcessed: true as const,
  };

  if (!canHash(file)) {
    return {
      ...base,
      status: 'skipped',
      reason: 'No file bytes are available to hash',
      digestStatus: 'missing',
      mediaMissing: true,
    };
  }

  let digested: DigestResult;
  try {
    digested = await withTimeout(deps.digest(file), hashTimeoutMs, `Hashing ${file.name}`);
  } catch (err) {
    return {
      ...base,
      status: 'failed',
      reason: errorText(err),
      digestStatus: 'missing',
    };
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
  try {
    screenshot = deps.isScreenshot ? deps.isScreenshot(file) : false;
  } catch (err) {
    screenshot = false;
  }

  const notes: string[] = ['MD5, SHA-1, and SHA-256 computed from the file bytes'];
  let skinTonePercent: number | undefined;
  if (file.mediaType === 'image' && deps.skinTone) {
    try {
      skinTonePercent = await withTimeout(deps.skinTone(file), skinTimeoutMs, `Nudity check for ${file.name}`);
    } catch (err) {
      notes.push(`Nudity check failed: ${errorText(err)}`);
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
    gps: digested.gps,
    gpsAlt: digested.gpsAlt,
    capturedAt: digested.capturedAt,
    device: digested.device,
    coordSource: digested.coordSource,
    mediaMissing: false,
    digestStatus: 'computed',
  };
}
