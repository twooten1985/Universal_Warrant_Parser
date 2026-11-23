/**
 * Guess which provider a zip or folder belongs to from names and a short text sample.
 * The examiner confirms or overrides the guess before anything is parsed.
 */
import type { ProviderType } from '../types';

export type Confidence = 'high' | 'medium' | 'low';

export interface ProviderDetection {
  /** Best supported provider. Meta is its own provider when that production is recognized. */
  provider: ProviderType;
  confidence: Confidence;
  /** Short reasons shown in the wizard. */
  reasons: string[];
  /** True when two providers scored almost the same. */
  conflict: boolean;
}

interface Signal {
  provider: ProviderType;
  weight: number;
  reason: string;
  test: (hay: string) => boolean;
}

const SIGNALS: Signal[] = [
  { provider: 'google', weight: 4, reason: 'Google category folder name', test: h => /[.#]\d{6,}[.#][A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.]+_\d{3}\b/.test(h) },
  { provider: 'google', weight: 3, reason: 'SubscriberInfo or Google Account Data', test: h => /subscriberinfo\.html|google account data|my activity/.test(h) },
  { provider: 'google', weight: 2, reason: 'Google Takeout or Gaia path', test: h => /\bgaia\b|takeout\/|google photos/.test(h) },
  { provider: 'apple', weight: 4, reason: 'Apple encrypted production (.zip.gpg)', test: h => /\.zip\.gpg\b|\.gpg\b/.test(h) && /apple|icloud|gpg/.test(h) },
  { provider: 'apple', weight: 4, reason: 'iCloud or Apple ID files', test: h => /icloud|apple\s*id|com\.apple\.|mobilesync|info\.plist/.test(h) },
  { provider: 'apple', weight: 2, reason: 'Apple backup folder', test: h => /manifest\.db|manifest\.mbdb|status\.plist/.test(h) },
  { provider: 'snapchat', weight: 4, reason: 'Snapchat chat history', test: h => /chat_history\.(csv|json)|snapchat/.test(h) },
  { provider: 'snapchat', weight: 2, reason: 'Snapchat memories or conversation columns', test: h => /conversation_id|memories|sender_username/.test(h) },
  { provider: 'meta', weight: 4, reason: 'Meta / Facebook / Instagram export', test: h => /facebook|instagram|meta platforms|your_facebook_activity|records\.html/.test(h) },
  { provider: 'kik', weight: 4, reason: 'Kik subscriber or message export', test: h => /\bkik\b|subscriber-data-/.test(h) },
  { provider: 'cybertip', weight: 4, reason: 'NCMEC CyberTip report', test: h => /cybertip|cyber\s*tipline|\bncmec\b/.test(h) },
  { provider: 'synchronos', weight: 4, reason: 'Synchronoss backup manifest', test: h => /synchronoss|backup_files_manifest|sms_call_sync/.test(h) },
  { provider: 'discord', weight: 4, reason: 'Discord messages or reports', test: h => /message_transaction_records|username_change\.csv|channel\.json/.test(h) },
  { provider: 'discord', weight: 2, reason: 'Discord messages.csv', test: h => /messages\.csv|analytics\.json/.test(h) && /discord|channel/.test(h) },
  { provider: 'mega', weight: 4, reason: 'MEGA LE / BSI JSON', test: h => /\bmega\b|userhandle|session_details/.test(h) },
  { provider: 'twitter', weight: 3, reason: 'X / Twitter account export', test: h => /direct-messages|twitter|account\.js|\bx corp\b/.test(h) },
  { provider: 'dropbox', weight: 5, reason: 'Dropbox part archive', test: h => /(?:deleted-)?file-data-part-\d+/.test(h) },
  { provider: 'dropbox', weight: 4, reason: 'Dropbox file activity or user metadata', test: h => /dropbox-[\w-]*file-activity|file-metadata|user-metadata|deleted files|file data/.test(h) },
];

export function detectReturnProvider(paths: readonly string[], snippets: readonly string[] = []): ProviderDetection {
  const hay = `${paths.join('\n')}\n${snippets.join('\n')}`.toLowerCase();
  const scores = new Map<ProviderType, { score: number; reasons: string[] }>();
  for (let i = 0; i < SIGNALS.length; i++) {
    const signal = SIGNALS[i];
    if (!signal.test(hay)) continue;
    const row = scores.get(signal.provider) || { score: 0, reasons: [] };
    row.score += signal.weight;
    if (!row.reasons.includes(signal.reason)) row.reasons.push(signal.reason);
    scores.set(signal.provider, row);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) {
    return { provider: 'discord', confidence: 'low', reasons: ['No provider markers in the file names'], conflict: false };
  }
  const [best, second] = ranked;
  const conflict = !!second && best[1].score - second[1].score <= 1;
  let confidence: Confidence = 'low';
  if (!conflict && best[1].score >= 4) confidence = 'high';
  else if (!conflict && best[1].score >= 2) confidence = 'medium';
  return {
    provider: best[0],
    confidence,
    reasons: best[1].reasons.slice(0, 3),
    conflict,
  };
}

export function detectionConflicts(detected: ProviderType, chosen: ProviderType, confidence: Confidence): boolean {
  return chosen !== detected && confidence !== 'low';
}
