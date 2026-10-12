/**
 * Phase 1 identity types.
 *
 * Phase 1 = Exact link SUGGESTIONS between unmerged provider accounts.
 * Later phases (not implemented): fuzzy/username cross-provider, IP windows,
 * device IDs, SubjectHypothesis, Accept/Reject persistence, graph viz.
 */

export type IdentifierType =
  | 'email'
  | 'phone'
  | 'recovery_email'
  | 'recovery_sms'
  | 'provider_user_id';

export type LinkRuleId =
  | 'email.exact'
  | 'recovery_to_primary.email'
  | 'recovery_to_primary.sms'
  | 'phone.e164'
  | 'provider_user_id.exact';

export type LinkTier = 'exact';

export type LinkEdgeStatus = 'suggested';

export interface IdentifierOccurrence {
  id: string;
  accountKey: string;
  provider: string;
  type: IdentifierType;
  /** Raw value as extracted from the return */
  rawValue: string;
  /** Normalized value used for Exact matching */
  normalizedValue: string;
  /** Field path / label in the source profile (e.g. email, otherDetails.Recovery Email) */
  sourceField: string;
  sourceFile?: string;
  /** Chip / roster label matching App account filter */
  accountLabel: string;
}

export interface LinkEdge {
  id: string;
  status: LinkEdgeStatus;
  tier: LinkTier;
  ruleId: LinkRuleId;
  /** Normalized shared identifier */
  normalizedValue: string;
  identifierType: IdentifierType;
  accountKeyA: string;
  accountKeyB: string;
  providerA: string;
  providerB: string;
  accountLabelA: string;
  accountLabelB: string;
  /** Human rationale — use “associated by shared identifier” / “link suggestion” wording */
  rationale: string;
  /** Optional false-positive family/shared-inbox warning */
  fpWarning?: string;
  occurrenceIds: string[];
}
