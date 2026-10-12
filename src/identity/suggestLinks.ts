/**
 * Phase 1 Exact link suggestions.
 *
 * Product rules:
 * - Accounts stay UNMERGED in presentation.
 * - Shared identifiers = link SUGGESTIONS only (status: suggested).
 * - Wording: “associated by shared identifier” / “link suggestion” — never “same person”.
 * - No username cross-provider Exact in Phase 1.
 * - Pair distinct accountKeys only (same Discord userId consolidated upstream → one account → no self-edge).
 */

import { IdentifierOccurrence, LinkEdge, LinkRuleId, IdentifierType } from './types';

const FP_WARNING_FAMILY_SHARED =
  'False-positive risk: recovery/primary email may be a shared family or institutional inbox — treat as a link suggestion only, not proof of a single subject.';

function edgeId(ruleId: LinkRuleId, norm: string, a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `${ruleId}::${norm}::${x}::${y}`;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

interface Cand {
  ruleId: LinkRuleId;
  identifierType: IdentifierType;
  normalizedValue: string;
  occA: IdentifierOccurrence;
  occB: IdentifierOccurrence;
  rationale: string;
  fpWarning?: string;
}

function tryPairs(
  left: IdentifierOccurrence[],
  right: IdentifierOccurrence[],
  ruleId: LinkRuleId,
  identifierType: IdentifierType,
  rationaleFor: (a: IdentifierOccurrence, b: IdentifierOccurrence) => string,
  fpWarning?: string
): Cand[] {
  const out: Cand[] = [];
  const seen = new Set<string>();

  for (const a of left) {
    for (const b of right) {
      if (a.accountKey === b.accountKey) continue;
      if (a.normalizedValue !== b.normalizedValue) continue;
      const pk = pairKey(a.accountKey, b.accountKey);
      const dedupe = `${ruleId}::${a.normalizedValue}::${pk}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        ruleId,
        identifierType,
        normalizedValue: a.normalizedValue,
        occA: a,
        occB: b,
        rationale: rationaleFor(a, b),
        fpWarning,
      });
    }
  }
  return out;
}

/**
 * Build Exact LinkEdge suggestions from extracted identifier occurrences.
 */
export function suggestLinks(occurrences: IdentifierOccurrence[]): LinkEdge[] {
  const byType = (t: IdentifierType) => occurrences.filter((o) => o.type === t);

  const emails = byType('email');
  const recoveryEmails = byType('recovery_email');
  const phones = byType('phone');
  const recoverySms = byType('recovery_sms');
  const puids = byType('provider_user_id');

  const candidates: Cand[] = [];

  // email.exact — primary email on two distinct accounts
  candidates.push(
    ...tryPairs(
      emails,
      emails,
      'email.exact',
      'email',
      (a, b) =>
        `Link suggestion: accounts “${a.accountLabel}” (${a.provider}) and “${b.accountLabel}” (${b.provider}) are associated by shared identifier (primary email).`
    )
  );

  // recovery_to_primary.email — recovery on one matches primary on another
  candidates.push(
    ...tryPairs(
      recoveryEmails,
      emails,
      'recovery_to_primary.email',
      'recovery_email',
      (a, b) =>
        `Link suggestion: recovery email on “${a.accountLabel}” (${a.provider}) matches primary email on “${b.accountLabel}” (${b.provider}) — associated by shared identifier.`,
      FP_WARNING_FAMILY_SHARED
    )
  );

  // recovery_to_primary.sms — recovery SMS matches primary phone
  candidates.push(
    ...tryPairs(
      recoverySms,
      phones,
      'recovery_to_primary.sms',
      'recovery_sms',
      (a, b) =>
        `Link suggestion: recovery SMS on “${a.accountLabel}” (${a.provider}) matches primary phone on “${b.accountLabel}” (${b.provider}) — associated by shared identifier.`
    )
  );

  // phone.e164 — primary phones match
  candidates.push(
    ...tryPairs(
      phones,
      phones,
      'phone.e164',
      'phone',
      (a, b) =>
        `Link suggestion: accounts “${a.accountLabel}” (${a.provider}) and “${b.accountLabel}” (${b.provider}) are associated by shared identifier (phone / e164).`
    )
  );

  // provider_user_id.exact — same opaque provider user id on distinct accountKeys
  // (Normally same-provider same-uid consolidates upstream; this catches edge cases / provider label drift.)
  candidates.push(
    ...tryPairs(
      puids,
      puids,
      'provider_user_id.exact',
      'provider_user_id',
      (a, b) =>
        `Link suggestion: accounts “${a.accountLabel}” (${a.provider}) and “${b.accountLabel}” (${b.provider}) are associated by shared identifier (provider user id).`
    )
  );

  // NOTE: No username cross-provider Exact in Phase 1.

  const edges: LinkEdge[] = [];
  const seenEdge = new Set<string>();

  for (const c of candidates) {
    const id = edgeId(c.ruleId, c.normalizedValue, c.occA.accountKey, c.occB.accountKey);
    if (seenEdge.has(id)) continue;
    seenEdge.add(id);

    edges.push({
      id,
      status: 'suggested',
      tier: 'exact',
      ruleId: c.ruleId,
      normalizedValue: c.normalizedValue,
      identifierType: c.identifierType,
      accountKeyA: c.occA.accountKey,
      accountKeyB: c.occB.accountKey,
      providerA: c.occA.provider,
      providerB: c.occB.provider,
      accountLabelA: c.occA.accountLabel,
      accountLabelB: c.occB.accountLabel,
      rationale: c.rationale,
      fpWarning: c.fpWarning,
      occurrenceIds: [c.occA.id, c.occB.id],
    });
  }

  edges.sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
    return a.normalizedValue.localeCompare(b.normalizedValue);
  });

  return edges;
}
