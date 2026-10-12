# Identity linking — Phase 1

## What Phase 1 does
- Keeps **provider accounts unmerged** in the UI (separate cards / roster).
- Extracts identifiers from account profiles: primary email/phone, recovery email/SMS (`otherDetails`), provider user id.
- Emits **Exact link suggestions** (`LinkEdge`, `status: 'suggested'`) when distinct `accountKey`s share a normalized identifier.
- Wording: “associated by shared identifier” / “link suggestion” — **not** “same person” / “merged identity”.

## Rules implemented
- `email.exact`
- `recovery_to_primary.email` (with family/shared-inbox `fpWarning`)
- `recovery_to_primary.sms` / `phone.e164`
- `provider_user_id.exact`
- **No** username cross-provider Exact in Phase 1.

## What file-level consolidation still does
Matching `userId` | `username` | `email` across files for the **same** provider account still collapses duplicate file extractions into one account row. That is not a person-merge across accounts. Recovery matching another account’s primary becomes a link suggestion only.

## Later phases (not implemented)
- Username cross-provider Exact / fuzzy
- Device IDs, IP time windows
- SubjectHypothesis / Accept–Reject persistence
- Graph visualization

Code lives under `src/identity/` (`normalize.ts`, `extractIdentifiers.ts`, `suggestLinks.ts`, `types.ts`).
