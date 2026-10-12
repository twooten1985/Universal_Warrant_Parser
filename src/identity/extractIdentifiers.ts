/**
 * Phase 1 identifier extraction from AccountInfo / AccountRecord.
 * accountKey / accountLabel must stay stable with App account chips.
 */

import { AccountRecord } from '../types';
import { IdentifierOccurrence, IdentifierType } from './types';
import { normalizeE164V1, normalizeEmailV1, normalizePuidV1 } from './normalize';

/** Stable key: provider+userId, else provider+email, else provider+username. */
export function buildAccountKey(
  provider: string | undefined,
  userId?: string | null,
  username?: string | null,
  email?: string | null
): string {
  const prov = (provider || 'unknown').toString().trim().toLowerCase() || 'unknown';
  const uid = userId?.toString().trim();
  if (uid) return `${prov}::uid::${uid}`;
  const emailRaw = email?.toString().trim();
  if (emailRaw) {
    const norm = normalizeEmailV1(emailRaw);
    if (norm) return `${prov}::email::${norm}`;
  }
  const user = username?.toString().trim();
  if (user) return `${prov}::user::${user.toLowerCase()}`;
  return `${prov}::anon`;
}

/** Chip / filter label matching AccountInfoCard buttons */
export function accountFilterLabel(account: AccountRecord, idx = 0): string {
  return (
    account.username?.trim() ||
    account.userId?.trim() ||
    account.displayName?.trim() ||
    account.accountKey ||
    `identity-${idx}`
  );
}

const RECOVERY_EMAIL_KEYS = [
  'recovery email',
  'recovery_email',
  'recoveryemail',
  'backup email',
  'backup_email',
  'secondary email',
  'alternate email',
  'alt email',
];

const RECOVERY_SMS_KEYS = [
  'recovery sms',
  'recovery_sms',
  'recoverysms',
  'recovery phone',
  'recovery_phone',
  'backup phone',
  'backup_phone',
  'secondary phone',
  'alternate phone',
];

function findOtherDetail(
  otherDetails: Record<string, string> | undefined,
  keyHints: string[]
): { field: string; value: string } | undefined {
  if (!otherDetails) return undefined;
  for (const [k, v] of Object.entries(otherDetails)) {
    const lk = k.toLowerCase().trim();
    if (keyHints.some((h) => lk === h || lk.includes(h))) {
      const s = String(v || '').trim();
      if (s) return { field: `otherDetails.${k}`, value: s };
    }
  }
  return undefined;
}

function pushOcc(
  out: IdentifierOccurrence[],
  partial: Omit<IdentifierOccurrence, 'id'> & { id?: string }
): void {
  const id =
    partial.id ||
    `${partial.accountKey}::${partial.type}::${partial.normalizedValue}::${partial.sourceField}`;
  out.push({ ...partial, id });
}

/**
 * Extract Exact-matchable identifiers from a list of unmerged accounts.
 */
export function extractIdentifiers(accounts: AccountRecord[]): IdentifierOccurrence[] {
  const out: IdentifierOccurrence[] = [];

  accounts.forEach((acc, idx) => {
    const provider = (acc.provider || 'unknown').toString();
    const accountKey =
      acc.accountKey || buildAccountKey(provider, acc.userId, acc.username, acc.email);
    const accountLabel = accountFilterLabel(acc, idx);

    if (acc.email) {
      const norm = normalizeEmailV1(acc.email);
      if (norm) {
        pushOcc(out, {
          accountKey,
          provider,
          type: 'email',
          rawValue: acc.email,
          normalizedValue: norm,
          sourceField: 'email',
          sourceFile: acc.sourceFile,
          accountLabel,
        });
      }
    }

    if (acc.phone) {
      const norm = normalizeE164V1(acc.phone);
      if (norm) {
        pushOcc(out, {
          accountKey,
          provider,
          type: 'phone',
          rawValue: acc.phone,
          normalizedValue: norm,
          sourceField: 'phone',
          sourceFile: acc.sourceFile,
          accountLabel,
        });
      }
    }

    if (acc.userId) {
      const norm = normalizePuidV1(acc.userId);
      if (norm) {
        pushOcc(out, {
          accountKey,
          provider,
          type: 'provider_user_id',
          rawValue: acc.userId,
          normalizedValue: norm,
          sourceField: 'userId',
          sourceFile: acc.sourceFile,
          accountLabel,
        });
      }
    }

    const recoveryEmail = findOtherDetail(acc.otherDetails, RECOVERY_EMAIL_KEYS);
    if (recoveryEmail) {
      const norm = normalizeEmailV1(recoveryEmail.value);
      if (norm) {
        pushOcc(out, {
          accountKey,
          provider,
          type: 'recovery_email',
          rawValue: recoveryEmail.value,
          normalizedValue: norm,
          sourceField: recoveryEmail.field,
          sourceFile: acc.sourceFile,
          accountLabel,
        });
      }
    }

    const recoverySms = findOtherDetail(acc.otherDetails, RECOVERY_SMS_KEYS);
    if (recoverySms) {
      const norm = normalizeE164V1(recoverySms.value);
      if (norm) {
        pushOcc(out, {
          accountKey,
          provider,
          type: 'recovery_sms',
          rawValue: recoverySms.value,
          normalizedValue: norm,
          sourceField: recoverySms.field,
          sourceFile: acc.sourceFile,
          accountLabel,
        });
      }
    }
  });

  return out;
}

export type { IdentifierType };
