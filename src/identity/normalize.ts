/**
 * Phase 1 normalizers (v1).
 * - email-v1: NFKC, lower, trim; Gmail/Googlemail local-part dots and +tags stripped
 * - e164-v1: digits only; leading 1 kept for NANP 11-digit; no country DB
 * - puid-v1: trim, preserve case for opaque IDs (Discord snowflakes etc.)
 */

export function nfkcLowerTrim(value: string): string {
  try {
    return value.normalize('NFKC').trim().toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

/** email-v1 */
export function normalizeEmailV1(raw: string): string | null {
  const base = nfkcLowerTrim(raw);
  if (!base || !base.includes('@')) return null;
  const at = base.lastIndexOf('@');
  let local = base.slice(0, at);
  let domain = base.slice(at + 1);
  if (!local || !domain) return null;

  if (domain === 'googlemail.com') domain = 'gmail.com';

  if (domain === 'gmail.com') {
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replace(/\./g, '');
  }

  if (!local) return null;
  return `${local}@${domain}`;
}

/** e164-v1 — digit-only; drop leading 00; keep NANP leading 1 when 11 digits */
export function normalizeE164V1(raw: string): string | null {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/** puid-v1 — trim only; case preserved (provider user ids are opaque) */
export function normalizePuidV1(raw: string): string | null {
  const v = String(raw || '').trim();
  return v.length > 0 ? v : null;
}
