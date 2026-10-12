/**
 * Phase 1 identity barrel.
 *
 * Phase 1 (this package): Exact link suggestions between unmerged accounts
 * (email / phone / recovery / provider_user_id). Accounts stay separate cards;
 * overlaps are “associated by shared identifier” suggestions only.
 *
 * Later phases (not here): username cross-provider Exact, device IDs, IP windows,
 * SubjectHypothesis, Accept/Reject persistence, graph visualization.
 */

export * from './types';
export * from './normalize';
export {
  buildAccountKey,
  accountFilterLabel,
  extractIdentifiers,
} from './extractIdentifiers';
export { suggestLinks } from './suggestLinks';
