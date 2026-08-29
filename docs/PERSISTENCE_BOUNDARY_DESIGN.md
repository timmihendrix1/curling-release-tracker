# Persistence Boundary Design

**Read first (2026-08-24):** two premises of this document are superseded by
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md` — the
accountless/no-owner assumption (local persistence is now **Profile-scoped**, implemented
in Stage B0.3/ADR-0026) and the legacy `localStorage`→IndexedDB copy/activation track as the forward
migration path (**retired** — the data it would carry is disposable). See §1's revision
note, §10's retirement note, and §12. The implemented repository boundary, hydration model,
and `localStorage` as today's sole production authority are unchanged.

**Status:** Accepted. Implemented. Companion to
`docs/adr/0013-application-owned-persistence-repository-boundary.md`. Phase 1
(everything this document describes: the `StorageAdapter`, all seven repositories, the
three-state hydration model, the interaction-boundary gating of Section 7.10, and the
wiring into `TrackerApp.tsx`/`AssessScreen.tsx`) was implemented on
`feature/persistence-boundary-phase-1`, with two follow-up correction commits: the first
closed the interaction-boundary gap `PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md` identified
(`PERSISTENCE_BOUNDARY_PHASE1_CORRECTION_REPORT.md`); the second closed a further,
external-review-identified gap in that same correction — an inconsistently-applied
readiness rule (History Filters' write-protected exception, Session's and Assessment's
reliance on handler-only no-ops, and the Assessment entry action's use of an
asynchronously-hydrated preference before it settled) — see
`PERSISTENCE_BOUNDARY_PHASE1_FINAL_CORRECTION_REPORT.md`. No storage key, stored shape,
migration behavior, or deduplication behavior changed at any point. See
`docs/SYSTEM_ARCHITECTURE.md`'s "Persistence boundary" section for the as-built summary,
and `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §18, "Phase 1: Persistence
boundary (Implemented)." The IndexedDB adapter described in Section 10 remains
unimplemented (Phase 2). **One Phase-2 prerequisite this document flagged (Section 6.4's
"transactional or safer-ordered archive operation," Section 6.5's adapter-contingent
write order) is now resolved**, ahead of and independent of the IndexedDB adapter itself,
by `docs/adr/0014-session-archive-write-ordering.md` — see Sections 6.2, 6.4, and 6.5
below for the updated text. This does not change this document's status regarding
IndexedDB: Section 10 is still documentation-only, and IndexedDB is still unimplemented.
**Revision 6 records one exception**: Section 10 step 1 (an IndexedDB-backed
`StorageAdapter` implementation) is now implemented, but unwired — see
`docs/adr/0015-indexeddb-adapter-unwired.md` and Section 10's revision note. Steps 2-4
(migration, verification, activation/rollback) remain unimplemented and undesigned.

**Revision 8 records that step 4 has a proposed, but explicitly incomplete, design**,
**Revision 9 corrects four further defects found on review of Revision 8's mechanism**,
**and Revision 10 corrects internal inconsistencies found on review of Revision 9's own
corrections** — see `docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md`
(**Proposed. Incomplete design**, not Accepted, unchanged by any of these corrections):
per-domain activation authority computed from two independent, fingerprint-bound
activation-evidence records (a new per-domain `localStorage` witness plus a new IndexedDB
`metadata` record, distinct from ADR-0016's migration marker) — **authority begins only
once the IndexedDB evidence reaches `"committed"` and matches the witness, never at the
earlier `"prepared"` step even with a matching witness present**; an **authority-aware
mutation lease**, not a bare lock around each individual write: per-domain Web Locks
(shared for ordinary writes, exclusive for activation, held for the whole
verify-through-finalize sequence) exclude concurrent writes, but a write *queued* behind
an in-progress activation must also re-check current durable evidence, under the lock,
**exactly once per complete logical mutation, immediately before that mutation's first
write** — never independently repeated before a later write in the same mutation —
otherwise it could still land after activation completes, through a repository instance
bound to the now-superseded backend; the lease is held across one *complete logical
mutation* (e.g. both of `SessionRepository.archiveAndReplace`'s ordered writes together,
checked once), never per individual `StorageAdapter.set` call, so an exclusive activation
attempt can never run partway through a multi-write operation; the ten-state startup
readiness gate; a bounded (at most two-pass) exact-string pre-activation verification
sequence; crash consistency per write, including an automatic, crash-resumable recovery
procedure for an interrupted `"prepared"` + witness state that deletes the witness
*before* the evidence when the source has drifted — the reverse of manual rollback's
order, deliberately, so every crash point resolves to plain `localStorage` authority
rather than a state requiring manual review (Revision 10 correction: the prior text had
this backwards); fail-closed failure/recovery rules; and rollback reclassified as
manual/blocked/deferred (never automatic). **ADR-0017 identifies exactly one unresolved
blocking prerequisite, stated as a single bundled decision (Revision 10 correction: not
two independent ones)**: no purely client-side mechanism in this codebase can prevent an
application build older than this protocol from continuing to write `localStorage`
during or after activation — and the same future decision that resolves this must also
explicitly decide the startup gate's one named, bounded fault-model gap (a witness lost
while IndexedDB is simultaneously unreachable cannot be distinguished from "never
activated," and currently resolves `localStorage` anyway as an accepted trade-off that
depends on production activation being blocked). ADR-0017 does not solve either part —
it names automatic production activation as blocked until that one, combined, separate
decision resolves it. **Nothing is implemented, and step 4 is not resolved** —
`localStorage` remains the sole production source of truth and IndexedDB remains
unactivated. Step 3 (verify before cleanup) is a **different problem from ADR-0017's
pre-activation verification and remains entirely unresolved** — see the correction to
this section's step 3, below.

**Revision 11 records the attempted answer to ADR-0017 Decision 3's bundled
prerequisite, and resolves neither of its two halves** — see
`docs/adr/0018-indexeddb-production-activation-fencing-and-outage-policy.md`
(**Proposed. Incomplete design**): row 0b is **narrowed, not closed**, by a proposed
`localStorage` "Activation Ledger" (one entry per domain, established as a barrier
*before* IndexedDB evidence is finalized — never as a best-effort write after — with its
own read-back validation, and deleted only as part of the discard/rollback procedures
extended for it). This catches an ordinary, isolated witness loss while IndexedDB is
unreachable. **It is not self-healing**: nothing repairs an already-established ledger
entry that is later lost. A whole-`localStorage`-origin wipe removes the ledger together
with the witness in one action, directly recreating the original ambiguity while
IndexedDB is unreachable. A targeted deletion of just the ledger entry, with the witness
left untouched, does **not** by itself recreate that ambiguity — it only removes this
domain's future mitigation against a later, independent witness loss coincident with
IndexedDB being unreachable; all three of deletion, later witness loss, and simultaneous
unreachability must hold together. Ledger corruption is different again: an invalid or
unreadable ledger fails closed and never silently selects `localStorage`, costing
availability, not safety. An absent ledger therefore narrows the
risk of a false `localStorage` resolution only for as long as the entry stays valid and
readable; it does not prove a domain was never activated, and row 0b remains bundled into
ADR-0017 Decision 3 pending an explicit, separate residual-risk decision — **a decision
that, if made, resolves the pending governance prerequisite, not a technical elimination
of the underlying ambiguity**. Old-build/tab exclusion, the other bundled
half, is **not resolved**: ADR-0018 evaluates staged deployment, service-worker-controlled
updates, build/protocol-epoch handshakes, `BroadcastChannel`/`storage` events, and Web
Locks (including `navigator.locks.query()` as a passive presence check, scoped to this
browser's own storage partition, never other devices) against the same six questions, and
proves that none of them — alone or combined — can make an already-running,
non-participating build's JavaScript stop writing; the best achievable design (a presence
check plus an explicit, honest, software-unverifiable user confirmation) is fully
specified but explicitly not claimed as a proof. **ADR-0017 Decision 3 therefore remains
blocked, as a whole**, since it requires both halves resolved together and neither is;
ADR-0018 does not recommend enabling activation on the basis of probability, telemetry, or
a bake period. Nothing in Revision 11 is implemented.

**Revision 12 records that the cloud-identity/data-authority boundary this document's
§12 named as deferred to "the cloud/login spike" now has a proposed, still-incomplete
design** — see `docs/adr/0019-cloud-identity-and-data-authority-transition.md`
(**Proposed. Incomplete design — genuine architecture blockers remain, not merely
missing implementation**): `localStorage` remains authoritative for a device-local,
unowned workspace and for any not-yet-adopted domain after login; a domain becomes
Supabase-authoritative only through a **committed, server-side Adoption Run record**
(never mere row existence) confirming an explicit, per-account, per-domain **Local
Adoption** (deliberately distinct from this document's own IndexedDB copy-migration
markers — different transport, unit of work, evidence location, and failure mode), never
automatically. ADR-0019 is explicit that this authority is scoped per `(scope, domain)`
pair, not per bare domain name, because reconstructing one device's repository proves
only that device's own consistency, never exclusive authority across devices — a device
holding unreconciled local writes for an already-cloud-authoritative domain is named as
an `account_local_branch`, with reconciliation left as an open, named blocker. Cloud
identity work is explicitly decoupled from this document's own still-unresolved
IndexedDB activation question (Revisions 8-11): adoption reads `localStorage` directly,
never IndexedDB, so ADR-0017/0018's bundled prerequisite is neither resolved nor
required to be resolved by it. **Second through eighth corrections to ADR-0019**
progressively design, and then structurally simplify, the actual cross-system commit
this two-backend transition requires (`localStorage` → Supabase, which cannot share one
atomic transaction). The structure as of the seventh correction replaced one earlier,
single overloaded scope model with **three independent state machines**:
`LocalGenerationState` (this browser storage partition's own legacy Role-A evidence
only), `AccountDomainAuthority` (server-side canonical ownership for one exact
`(accountScopeId, domain)` pair, resolved from a new account-domain authority registry
ADR-0020 must design — never derived from local evidence, which is what lets a second
device that never locally adopted a domain still discover its cloud authority
correctly), and `SessionAccessibility` (whether this session may actually use a domain
already resolved to `cloud_authoritative` — requiring `ready` cloud capability, a
matching authenticated identity, and reachable, RLS-authorized access). A discovered
local fence never by itself implies authority or accessibility. The Transition Fence is
stored under **one stable, per-domain key for the legacy generation, never scoped by
account**; one stable, **domain-scoped mutation lock** serializes ordinary writes
(shared mode) against adoption's own exclusive lease; a companion Claim Marker schema
drops a redundant "adopted" state; a local artifact, the **`AbortCleanupCursor`**,
anchors abort-cleanup recovery once the fence itself is deleted, since the marker alone
could not distinguish an ordinary pre-fence upload from cleanup already in progress; a
one-envelope role-B archive schema; a server-side run with **a seven-outcome query model
containing four distinct, fail-closed failure outcomes**; a fingerprint-first,
idempotent Source-Drift Resolution chain; and a fixed, crash-resumable local cleanup
order anchored by the cursor. **The Device Workspace Pointer mechanism, present in an
intermediate correction, is removed from the MVP decision entirely**: once a domain is
quarantined on a browser, anonymous use and any non-owning account are explicitly
blocked from local use of it there. Nothing in Revision 12 is implemented, and this
document's own status (IndexedDB unimplemented/unactivated) is unchanged.

**Revision 13 corrects a durability gap found on review of Revision 12's own local
generation model**: the prior `local_branch_detected` reclassification, and this
document's own prior mention of an `account_local_branch`, described only an in-memory,
per-session concept that vanished on logout or reload — silently re-exposing a
device's own legacy data as an ordinary, writable workspace on a later visit. ADR-0019
now defines a permanent local artifact, the **`RemoteAuthorityBarrier`** (one exact
schema, one fixed per-domain key), written and validated **before** a cloud repository
is ever exposed on a device that discovers remote authority it did not itself
establish — never overwritten by a later sign-in, and surviving logout, reload, and
account switch. It resolves to one of two new, equally permanent
`LocalGenerationState` values: `remote_authority_quarantined` (no local content existed
at discovery) or `local_branch_quarantined` (local content existed, or was later
detected by drift-aware re-resolution). **A quarantined local branch is read-only for
every participating build** — never appended to by ordinary application flows, and
never uploaded to Supabase automatically — correcting Revision 12's
`account_local_branch` description, which did not state this and could be read as still
accepting new writes; this restores the invariant that a cloud-authoritative domain
never has a second, ordinary, writable local authority, **for participating builds**. A
non-participating old build is not prevented from writing legacy keys directly; the
barrier's own re-resolution (comparing the current snapshot against the fingerprint
recorded at creation) only detects such drift afterward, surfacing a diagnostic outcome
rather than reverting or masking it — a per-resolution comparison later found, in
Revision 14 below, to have no durable memory of its own across a reload. The
account-domain authority registry ADR-0020 must
design is now required to be **one transactionally-maintained record per
`(accountScopeId, domain)`**, updated in the same transaction as every Adoption Run
state change — never derived by sorting runs. A second device observing a
`prepared`-but-not-yet-terminal remote adoption with no matching local evidence now
reports a distinct `adoption_in_progress_elsewhere` result and never fabricates local
adoption artifacts for another device's snapshot. The prior single accessibility table
is replaced by a **total repository-selection matrix** covering every account-domain
authority outcome, not only the cloud-authoritative one. The `AbortCleanupCursor`
gains explicit preconditions checked before cleanup begins; the previously
under-specified "superseded-run local cleanup" path is removed and fails closed instead
of being automatically repaired without proof it is reachable. Source-Drift recovery's
one-hop wording is clarified to the exact crash window in which it applies. Status
discipline now says **proposed MVP restriction**, never "accepted." Nothing in Revision
13 is implemented, and this document's own status (IndexedDB unimplemented/unactivated)
is unchanged.

**Revision 14 corrects six further defects found on review of Revision 13's own
mechanism.** Detected drift (Revision 13's per-resolution comparison) is now recorded
in its own new, permanent local artifact, **`RemoteAuthorityDriftEvidence`** — the
per-resolution comparison alone had no durable memory across a reload, so bytes
reverting to the original baseline after a drift event could silently, incorrectly
re-report `remote_authority_quarantined`, contradicting Revision 13's own
"one-directional" claim; the new evidence, once written, makes
`local_branch_quarantined` unconditional regardless of what the bytes currently look
like. Fingerprinting is split into **`captureDomainSnapshot`** (I/O) and
**`fingerprintDomainSnapshot`** (a pure function over an explicit snapshot), replacing
an ambiguous combined operation that different sections used to mean differently; a
canonical empty-domain fingerprint is now defined explicitly. `adoption_prepared`
recovery is restructured from five overlapping local-evidence-first cases into an
**ordered, server-state-first decision tree** — the prior structure's own
compatibility table described a fence-present row as eligible for a case that
explicitly required no fence, a direct contradiction; resolving server state first
removes it. **Committed-fence catch-up is now its own 11-step exclusive recovery
protocol**, since a crash releases the original lock and catch-up cannot resume
without reacquiring and re-validating it, and two concurrent attempts must converge on
one committed fence rather than race. The `AbortCleanupCursor`'s recovery is now an
**exact four-checkpoint matrix**, replacing a broad "operationally irrelevant" claim
about coexisting artifacts — a malformed or mismatched marker or archive at any
checkpoint now fails cleanup closed rather than being waved through. The
account-domain authority registry's bootstrap model gains an explicit
`authorityRevision: "0"` starting value and a **future-domain backfill migration**
requirement for domains introduced after an account already exists — otherwise a
missing row for a genuinely new domain would be misread as corruption. `not_initialized`
is corrected to mean only a present, persisted row, never a missing one, and a
committed fence is corrected to prove local-generation quarantine only, never which
account currently holds cloud authority — the signed-in account is never required to
match the fence's own recorded account. Nothing in Revision 14 is implemented, and
this document's own status (IndexedDB unimplemented/unactivated) is unchanged.

**Revision 15 is a narrow correction pass over Revision 14's own mechanisms**, fixing
four remaining defects rather than introducing new ones: (1) a prepared fence's Claim
Marker is now deliberately left unread by the local resolver until the server's own
state for that run is known, since validating it locally beforehand made
committed-fence catch-up's "the marker is unreachable" rule unreachable in practice;
(2) drift evidence now preserves the exact fingerprint that first proved drift occurred,
rather than a later, separately re-captured in-lock snapshot that a non-participating
old build could have already reverted to baseline by the time it was taken; (3)
committed-fence catch-up's concurrent-attempt convergence now fully validates a found
committed fence's schema, bindings, and archive before accepting it as this attempt's
own success, rather than trusting status and run ID alone; and (4) a stale enum comment
describing "any fixed-key artifact, including any Claim Marker" as unconditionally
fail-closed is corrected to state the marker's fail-closed behavior is conditional on
reachability. Nothing in Revision 15 is implemented, and this document's own status
(IndexedDB unimplemented/unactivated) is unchanged.

**Revision 1** responded to the product-owner architecture review recorded in
`PERSISTENCE_BOUNDARY_REVIEW_HANDOFF.md`: the original draft's
`SessionRepository.archiveCurrentToHistory` method was removed — Phase 1 is strictly
behavior-preserving, including the exact current write order and the current lack of
session-history deduplication (Section 6) — and all seven repository contracts were
completed (Section 5).

**Revision 2** corrected an unsafe conflation Revision 1 still contained, identified in
`PERSISTENCE_BOUNDARY_FINAL_REVIEW.md`: a genuine storage read failure was treated
identically to normal absence, which would let default state be persisted over
already-stored data once hydration "completed" and writes were enabled. That revision
introduced an application-owned read-result type distinct from the write-result type, a
three-state hydration model, and a corrected implementation sequence putting
characterization tests strictly before any production wiring change (Section 11) — but its
read-result type still had only two branches, folding a genuinely absent key together with
a real stored value (and any repaired/defaulted value derived from malformed data) into
one `"ready"` status.

**Revision 3** splits that remaining branch: the read-result type now has three top-level
outcomes — `value` (something was stored, used as-is or repaired per the domain's
existing policy), `absent` (the key genuinely does not exist), and `read_failed` (a
genuine storage-access failure) — per `PERSISTENCE_BOUNDARY_ACCEPTANCE_REPORT.md`. Every
repository's `load*` method documentation, the hydration transition table, and the
timing-provider gating condition are updated to name all three outcomes explicitly
(Sections 5, 7, 8, 9, 11).

**Revision 4** (this version) corrects a gap the Phase 1 implementation itself introduced
and `PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md` identified: Revision 3's hydration design
(Section 7) fully specified *save-effect* write-guards, but said nothing about the
*interaction boundary* — nothing required that a domain's mutating UI controls
themselves stay unavailable while `DomainHydrationState` is `"loading"` or
`"write_protected"`. The as-implemented `TrackerApp.tsx` (before this revision's
correction) left History Filters, Training Plans, Accuracy Tolerance Profiles, and Smart
Random Profiles fully interactive from an empty/default starting state the instant
Session became ready, independent of each domain's own load — so a user could create,
edit, or delete against that default before the real stored value ever arrived, only to
have it silently overwritten once it did. `AssessScreen.tsx`'s threshold-preset/custom-
threshold controls and its `handleViewAssessment` navigation had the equivalent defect.
Section 7.10 (new) states the corrected, binding requirement: readiness gating at the
interaction boundary, not a dirty-flag/"user state wins" guard, which Section 7.10
explains is actively unsafe for a collection domain that starts empty. This revision also
makes explicit (Section 6.5, new) that the session/history write-order property is
contingent on the current synchronous-under-the-hood adapter, not a structural guarantee
of the repository contract — `PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md` finding 7 flagged
prior documentation (the Phase 1 implementation report, left unmodified as a historical
artifact) as overstating this. See
`PERSISTENCE_BOUNDARY_PHASE1_CORRECTION_REPORT.md` for the full correction record.

**Revision 5** (this version) closes a gap external review found in Revision 4's own
correction: readiness gating had been applied inconsistently. History Filters was
documented (and implemented) as an exception allowed to stay interactive-but-non-
persisting after `"write_protected"`; Session's controls relied on handler-level no-ops
alone after a read failure, with no visible disabling; Assessment's setup/threshold
controls were interactive up to the point of clicking "Start Warm-up"; and
`AssessScreen`'s entry action could still decide between Guided Introduction and Overview
using the initial in-memory default before its preference hydration had settled, merely
because it was synchronous rather than because it was gated. Section 7.10 is rewritten to
state one uniform rule — every domain's controls are visibly disabled (or, while
`"loading"`, not rendered) *and* handler-guarded, with no per-domain exception — and to
name exactly which controls changed for Session and Assessment. See
`PERSISTENCE_BOUNDARY_PHASE1_FINAL_CORRECTION_REPORT.md` for the full record.

## 1. Purpose and scope

**Revision note (2026-08-24, mandatory identity and Free Cloud Foundation).**
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md` (Accepted;
implemented through B0.4) and `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`
change two of this document's premises, corrected in place in §10 and §12 below:

- **The accountless / no-owner assumption is superseded.** This document was written to
  preserve accountless use, and §12 concluded that identity must not scope local
  persistence. Identity is now mandatory, and **local persistence is Profile-scoped as
  implemented in Stage B0.3/ADR-0026.** The repository boundary and hydration model remain
  accurate. B0.4/ADR-0027 now adds cloud authority for archived Training Sessions and
  terminal Assessment Runs; current Session and Assessment draft authority remains local.
- **The legacy copy/activation track (§10 steps 2-4) is retired as the forward migration
  path.** The unscoped local data it would carry forward is disposable early-test data
  discarded once, explicitly, by Stage B0.3. ADR-0015's unwired adapter remains valid
  infrastructure; no dormant code is deleted by that decision.

This document is **not** the place to redesign repository APIs for either change. See
implemented Stage B0.3 (Profile-scoped local persistence) and B0.4 (terminal sporting-record
cloud synchronisation) in the specification's Section 11 and ADR-0027.

This document inventories every current browser-persisted domain, then designs an
application-owned persistence boundary that can:

1. Wrap the existing `localStorage` implementation **without any behavior change**, as
   the first step.
2. Later support an IndexedDB adapter behind the same boundary, without touching
   domain logic or UI.
3. Leave a clear seam for a future application-owned sync layer, without designing
   that layer now.

Everything in this document is a proposal for product-owner review. Nothing here
authorizes implementation. Section 13 lists what remains open; Section 15 lists the
implementation-readiness gate.

## 2. Authoritative persistence inventory (as of commit `dfd06cb`)

**Ten storage keys, seven domain-facing repositories — current runtime.** This remains
the single, consistent count of what the running application actually persists today. (An
earlier Phase 0 audit pass reported "8 persisted domains" — that number counted conceptual
domains and folded three independently-read/written preference keys into one grouping; it
is superseded by this inventory and is not otherwise referenced below. This is unrelated to
the target 8-domain/11-key count below, which reflects a *future*, not-yet-implemented
state.)

**Target (not yet implemented):** `docs/adr/0021-assessment-draft-history-authority-unit-split.md`
(Accepted, design complete) splits the Assessment domain/key (#4 below) into two —
`assessmentDraft` and `assessmentHistory` — bringing the eventual, post-implementation
total to **8 domains, 11 keys**. Nothing in this document's inventory below reflects that
split yet; it documents current runtime only, exactly as it exists at commit `dfd06cb`.

Confirmed exhaustively: no `sessionStorage`, IndexedDB, Cache API, or `document.cookie`
usage exists anywhere in `src/` (grepped with zero hits outside comments). **No key is
ever deleted** — `localStorage.removeItem`/`localStorage.clear()` do not appear anywhere
in production code. Every "delete"/"clear" action in the UI (Clear History, delete an
Assessment Run, delete a Training Plan, delete a profile) is implemented as an in-memory
state reset that flows through the domain's existing save effect, which rewrites the same
key with a smaller/empty value — never a key removal.

### 2.1 Full key-by-key inventory

| # | Storage key | Owning module | Persisted type | Read path | Write path | Delete/reset path | Schema version | Migration/validation function | Test coverage |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `curling-release-tracker-current-session` | `src/lib/sessionRepository.ts`, `src/lib/sessionMigration.ts` | `Session`, optionally including one active Technique/Shotmaking `ExerciseExecution` (ADR-0029) | `SessionRepository.loadCurrent` | `SessionRepository.saveCurrent` | Rewritten via Start New Session, archiving into history — see Section 6 | No root version; embedded Exercise Executions carry their own schema version | `migrateSession` plus strict `validateSessionExerciseState`; corrupt Exercise state fails closed | `sessionMigration.test.ts`, `sessionRepository.test.ts` |
| 2 | `curling-release-tracker-session-history` | same | `Session[]`; embedded Exercise state must be terminal | `SessionRepository.loadHistory` | `SessionRepository.saveHistory` / `archiveAndReplace` | Clear History rewrites `"[]"`, never removes the key | Same as current Session | `migrateSessionHistory` plus strict terminal Exercise-state validation | same files |
| 3 | `curling-release-tracker-history-filters` | `TrackerApp.tsx:226-227` (key), `src/lib/historyAnalysis.ts` (sanitize) | `HistoryAnalysisFilters` | `TrackerApp.tsx:793-795`, wrapped in try/catch (`:797-804`) | `TrackerApp.tsx:911-916`, effect on `[historyFilters]`, **unguarded** | None | None | `sanitizeHistoryFilters(raw)` — `historyAnalysis.ts:139-149`, merges onto `createDefaultHistoryFilters()` (`:85-96`); `sanitizeThresholdComparisonMode` (`:107-130`) repairs one sub-field | Indirect, via History/Analyze component tests — no dedicated migration test file |
| 4 | `curling-release-tracker-assessment-data` | `src/lib/assessment/persistence.ts:11` | `AssessmentPersistedState` (`persistence.ts:20-24`: `{schemaVersion, currentRun?, history: AssessmentRun[]}`) | `TrackerApp.tsx:807`, own try/catch (`:808-813`) | `TrackerApp.tsx:927-930`, effect on `[assessmentState]`, guarded by `if (!assessmentState) return;` | `deleteAssessmentRunFromHistory` (`persistence.ts:123-131`) — removes one run from the in-memory array; key is always rewritten, never removed | `ASSESSMENT_PERSISTENCE_SCHEMA_VERSION = 1` (`persistence.ts:12`); each `AssessmentRun` also independently carries `ASSESSMENT_RUN_SCHEMA_VERSION = 1` (`assessment/types.ts:220`) | `migrateAssessmentPersistedState(raw)` — `assessment/migration.ts:420`; root version gate at `:423`; per-run validation `validatePersistedAssessmentRun` — `migration.ts:173`, version gate `:178` | `assessment/__tests__/migration.test.ts`, `.../persistence.test.ts` |
| 5 | `curling-release-tracker-training-plans` | `src/lib/trainingPlans/persistence.ts:12` | `TrainingPlansPersistedState` (`persistence.ts:15-18`: `{schemaVersion, plans: TrainingPlan[]}`) | `TrackerApp.tsx:860` | `TrackerApp.tsx:933-939`, effect on `[trainingPlans]`, **unguarded** | `deletePlan` (`persistence.ts:57-62`) — filters the in-memory array; key always rewritten | `TRAINING_PLANS_SCHEMA_VERSION = 1` (`persistence.ts:13`); each `TrainingPlan` also carries its own `schemaVersion` (`types/index.ts:260`), but `migratePlan` unconditionally overwrites it (`migration.ts:147`) rather than checking it — this per-plan field is currently decorative, not load-bearing | `migrateTrainingPlans(raw)` — `trainingPlans/migration.ts:157-176`; **root-level mismatch is a full-wipe gate** (`:159-161`); within a matching root version, each plan is repaired field-by-field via `migratePlan` (`:134-149`) | `trainingPlans/__tests__/migration.test.ts`, `.../persistence.test.ts` |
| 6 | `curling-release-tracker-accuracy-tolerance-profiles` | `src/lib/accuracyToleranceProfiles/persistence.ts:31-32` | `AccuracyToleranceProfilesState` (`persistence.ts:25-29`: `{schemaVersion, profiles, defaultProfileId}`) | `TrackerApp.tsx:870-872` | `TrackerApp.tsx:941-946`, effect on `[accuracyToleranceProfilesState]`, **unguarded** | No dedicated delete key-path; profile removal is a state-list filter, key always rewritten | `ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION = 1` (`persistence.ts:33`) | `migrateAccuracyToleranceProfilesState(raw)` — `accuracyToleranceProfiles/migration.ts:52`; unknown version/invalid shape → empty state; per-profile quarantine via `migrateProfile` (`:18`); dangling `defaultProfileId` cleared to `null` | `accuracyToleranceProfiles/__tests__/migration.test.ts` |
| 7 | `curling-release-tracker-smart-random-profiles` | `src/lib/smartRandomProfiles/persistence.ts:42-43` | `SmartRandomProfilesState` (`persistence.ts:36-40`) | `TrackerApp.tsx:886-888` | `TrackerApp.tsx:948-953`, effect on `[smartRandomProfilesState]`, **unguarded** | Same pattern as #6 | `SMART_RANDOM_PROFILES_SCHEMA_VERSION = 1` (`persistence.ts:44`) | `migrateSmartRandomProfilesState(raw)` — `smartRandomProfiles/migration.ts:66`; same quarantine style as #6, plus a domain check dropping any profile whose Measurement Mode doesn't support Smart Random | `smartRandomProfiles/__tests__/migration.test.ts` |
| 8 | `curling-release-tracker-assessment-show-introduction` | `src/lib/assessmentPreferences.ts:11` | raw string `"true"`/`"false"` | `getShowAssessmentIntroductionPreference()` (`:16-21`), called from `AssessScreen.tsx:301` | `setShowAssessmentIntroductionPreference()` (`:23-25`), called from `AssessScreen.tsx:508,512` | None | None (single scalar) | Inline default: `raw === null → true` (`:19`) | `src/lib/__tests__/assessmentPreferences.test.ts` |
| 9 | `curling-release-tracker-assessment-last-threshold-preset` | `assessmentPreferences.ts:12` | raw string, `AccuracyThresholdPreset` | `getLastAssessmentThresholdPreset()` (`:30-36`), called from `AssessScreen.tsx:119` | `setLastAssessmentThresholdPreset()` (`:38-40`), called from `AssessScreen.tsx:379` | None | None | Inline whitelist check against `VALID_PRESETS`, fallback `"standard"` (`:27,33-35`) | same test file |
| 10 | `curling-release-tracker-assessment-last-custom-threshold` | `assessmentPreferences.ts:13` | `AccuracyThresholds \| null` | `getLastAssessmentCustomThreshold()` (`:42-60`), called from `AssessScreen.tsx:121` | `setLastAssessmentCustomThreshold()` (`:62-64`), called from `AssessScreen.tsx:381` | None | None | Inline try/catch around `JSON.parse` + shape check (`:46-59`); explicitly documented (`:29`) as never authoritative — a Run's real threshold snapshot always comes from an explicit confirmation, never silently from this preference | same test file |

**Stage C1/C2a Team Exercise boundary.** ADR-0031 itself added no local key, and its Team aggregate is
explicitly rejected by `validateSessionExerciseState`, `attachSoloExerciseExecution`
and the `training_session` cloud serializer. It cannot enter either Session key above.
ADR-0032 now implements and verifies the separate server boundary: immutable shared Team
coordination, independently retried athlete-owned result bundles and athlete-only notes
over real RLS/RPCs. It does not widen keys #1/#2 or treat the recorder as owner. The next
ADR-0033 implements that Stage C2b gate by upgrading ADR-0027's same Profile-scoped
outbox record to schema 2. ADR-0034 advances it to schema 3 for the bounded offline
Team-start eligibility cache, and ADR-0035 advances it to schema 4 with one in-progress
Team draft. ADR-0037 advances it to schema 5 with a verified athlete-owned result read
cache. ADR-0038 keeps that root schema and key: Exercise Execution schema 2 stores the
append-only active correction audit inside the same draft, and Team cloud payload schema
2 carries only each athlete's filtered correction history. Existing personal entries remain under `entries`; immutable Team Session
envelopes and independently acknowledged athlete bundles live under `teamEntries`;
roster/permission observations live under `teamEligibilitySnapshots`; and
`activeTeamExerciseDraft` holds either `null` or one strictly validated recorder-owned
aggregate. `teamExerciseResults` contains only strict projections belonging to the
mounted Profile. Schemas 1-3 load deterministically with no active draft and schemas
1-4 load with an empty result cache.
The full Team package is durably written before any C2a RPC is called, a failed write
prevents upload, and account switching selects a different physical Profile namespace.
Exact completion replaces that draft with its full outbox package in one local write
before upload. `teamEntries` remains a one-way recorder queue, not read authority or a
second sync engine; C3c's separate owned projections follow only the authenticated RLS
read. ADR-0036 now drives this boundary from cache-bounded Team setup and
one-device capture: start and every C1 transition must save durably before the UI moves
on, reload resumes the one draft, explicit confirmed discard removes it, and completion
uses only the exact atomic handoff. C3c reuses this same Profile key for last-verified
offline reads: a cloud response replaces the cache only after all owned projections
validate, unavailable or invalid refresh never overwrites cached truth, and own note
updates reach the cloud before the cache changes. It adds no key or parallel persistence
path. C3d likewise uses the existing durable-first draft write and exact completion
handoff; schemas 1 of both the Exercise Execution and immutable Team cloud payload remain
readable, while current corrected aggregates/payloads write schema 2. ADR-0039's C4a
post-completion revisions are a separate append-only relational server stream; they do
not enter the recorder outbox or mutate the immutable original bundle. C4b advances the
same Profile-scoped record to schema 6: schema 5 migrates each valid cached result with
an identical immutable original/current result, empty revision history and non-void
state, while current reads replace the cache only after the complete owner-only revision
chain and every replacement sporting payload validate. No new key or recorder read
authority is introduced.

**Write-guard note (new in this revision):** the "Write path" column above now records
whether each domain's current save effect already guards against writing its React
state's *initial default* before the mount-time load completes. Only #1 (`if
(!currentSession) return;`) and #4 (`if (!assessmentState) return;`) have this guard
today. Domains #2, #3, #5, #6, #7 are **unguarded** — their save effects fire
unconditionally, including on the very first render, before the mount effect's `setState`
call (for the real, loaded value) has been processed. Today this is benign only because
the entire load sequence is synchronous JavaScript with no `await` — the unguarded
effect's "write the default" and the corrected "write the real value" both happen within
one commit/microtask window too narrow for any real interruption to land in. Section 7
(Hydration) designs the general fix this revision requires, because moving to
`Promise`-returning repository calls (Section 5) would otherwise widen this already-latent
risk into a real one. This is **not** a change to any domain's steady-state persisted
value — it only closes a transient window that already exists today.

### 2.2 Architectural split within the 10 keys

Keys #1-#7 share one architecture: a root object per key, read once in `TrackerApp.tsx`'s
single mount effect, written by that key's own dedicated `useEffect`, following the
"one-effect-per-key" pattern documented in ADR-0010/0011/0012.

Keys #8-#10 (`assessmentPreferences.ts`) are architecturally different: independent
scalar/JSON values, read and written directly from `AssessScreen.tsx` at arbitrary
interaction points, not through `TrackerApp`'s mount/save-effect pattern, with no root
object and no `schemaVersion`, and — because they are never written by an always-on
`useEffect` keyed to component state — **no exposure to the write-guard/hydration concern
in Section 2.1's note or Section 7 at all.** Any persistence-boundary abstraction that
assumes "every domain has one root object with a schema version, loaded once at mount,
guarded against premature writes" needs an explicit carve-out for these three (Section
4.A.2 explains the carve-out in full).

### 2.3 Import/export behavior

`src/lib/export.ts` provides pure CSV builders (`buildSessionCsv`, `buildHistoryCsv`) and
a DOM-touching `downloadCsv` helper, reused by `src/lib/assessment/export.ts`. This is
**export only** — there is no import/restore-from-CSV or restore-from-backup path
anywhere in the codebase. No persisted domain has an export function beyond Session/
Session History and Assessment; Training Plans, Accuracy Tolerance Profiles, and Smart
Random Profiles have no export path today. Nothing in this revision changes any of this.

### 2.4 Documentation currently out of sync with this inventory

`docs/SYSTEM_ARCHITECTURE.md`'s "Persistence and migration (Implemented)" section (line
1087) was corrected in the Phase 0/1 handoff to point here rather than restate a stale
"Two `localStorage` keys" claim; that cross-reference remains accurate and is not revised
further here.

## 3. Current behavioral differences between domains

Two migration philosophies coexist today, and a persistence boundary must preserve both,
not unify them into one:

- **Field-by-field repair, unversioned** — domains #1, #2 (`sessionMigration.ts`) and #3
  (`historyAnalysis.ts`). No `schemaVersion` field exists; migration/sanitization runs
  unconditionally on every load and must be idempotent (ADR-0005). Within domain #1 itself,
  `Session.planExecution` is the exception: per ADR-0012 Decision 4, it follows the
  *opposite* (discard) style even though it lives inside the same key as the rest of
  `Session`, which is field-repaired. **The "one key = one migration philosophy" mental
  model already breaks down inside key #1 today** — this must not be flattened away by a
  boundary design that assumes one policy per key.
- **Root-`schemaVersion`-gated, quarantine-or-wipe** — domains #4-#7. Domain #4
  (Assessment) quarantines individually invalid runs (drops one, keeps the rest). Domain #5
  (Training Plans) explicitly migrates schema 1 Release-Time-only plans to schema 2,
  wipes an unknown/future root version, then field-repairs scalar configuration while
  failing closed on a missing or rewritten schema-2 Exercise snapshot. Domains #6-#7 quarantine individual
  profiles and clear a dangling `defaultProfileId` to `null`.
- **No explicit migration strategy** — domains #8-#10. Each has an inline default/whitelist
  check at the point of read, not a named "migration" function, since each is a single
  scalar with no internal structure to repair.

Additional invariants that must not be flattened by any boundary abstraction:

- **ADR-0005's `blocks` vs. `blocks: []` distinction**: `migrateBlocks` treats *any* array
  (including empty) as "already block-architected"; only a fully-missing `blocks` key
  triggers legacy-block fabrication. This is a permanent, tested invariant
  (`sessionMigration.test.ts`), not an implementation detail incidental to `localStorage`.
- **ADR-0001/0008/0012's snapshot-at-write-time philosophy**: `Shot.targetTime`,
  `TrainingBlock.accuracyThresholds`, and `AssessmentRun.templateSnapshot`/
  `PlanExecutionState`'s step snapshots are all captured once and never re-derived from a
  later default. A repository boundary must never "helpfully" re-normalize a historical
  record against a newer default on read.
- **Never fabricate a value migration can't know** (CLAUDE.md, ADR-0005): e.g.
  `predictedTime` is either present or stays `undefined` — never invented.
- **Idempotency**: every existing migration function is tested to be a safe no-op when run
  on already-migrated data. Any repository wrapper must call these functions exactly as
  they exist today, not introduce a second migration pass that could interact badly with
  the first.

## 4. Recommended boundary architecture

### 4.A Boundary structure

**Repository/adapter separation.** Two layers, with a strict one-way dependency:

```
UI (components, hooks)
   ↓ depends on
Domain logic (src/lib/**, existing migration/validation functions — unchanged)
   ↓ depends on
Repositories (new — one per persisted domain, per Section 4.A.1)
   ↓ depends on
StorageAdapter (new — one shared, minimal, key-value interface)
   ↓ depends on
Browser storage (localStorage today; IndexedDB later, behind the same adapter interface)
```

UI never imports a `StorageAdapter` or touches `localStorage`/`indexedDB` directly (this is
already true today for domains #4-#10; only `TrackerApp.tsx` currently calls
`localStorage` directly, for domains #1-#3, plus its own read calls for #4-#7 — the
implementation phase would replace those specific call sites with repository calls,
changing nothing else). Domain logic (existing `migrateSession`, `migrateAssessmentPersistedState`,
etc.) is called *by* repositories, unchanged — repositories are new code that wraps
existing functions, not a replacement for them.

**4.A.1 — Repository granularity.** One repository per *persisted domain*. A domain is
defined by four criteria together, not by key count alone:

- **Cohesive ownership** — does one conceptual entity type own this data (a Session, a
  Run, a Plan, a Profile)?
- **Lifecycle** — do the keys represent the same entity moving through stages (e.g. a
  Session moving from "current" to "history"), or genuinely unrelated entities that happen
  to be adjacent in the UI?
- **Migration policy** — are the keys migrated by the same function family, with the same
  repair/quarantine philosophy?
- **Consistency needs** — must the keys be read/interpreted together to make sense (e.g.
  Assessment's `currentRun` and `history` inside one root object), even if no atomic
  cross-key write is promised?

| Repository | Owns keys | Cohesive ownership | Lifecycle | Migration policy | Consistency needs |
|---|---|---|---|---|---|
| `SessionRepository` | #1, #2 | Both keys hold the same entity type, `Session` | A `Session` moves from the "current" slot into the "history" list over its lifetime (Section 6) | Both migrated by the same function family (`migrateSession`/`migrateSessionHistory`, the latter mapping the former) | The two keys are conceptually one "Session lifecycle" domain, even though **no atomic cross-key write is promised in Phase 1** (Section 6) |
| `HistoryFiltersRepository` | #3 | A single UI-analysis preference object, not training data | No lifecycle — a standalone, always-overwritten preference | Field-by-field repair (`sanitizeHistoryFilters`), independent of Session | None beyond its own key |
| `AssessmentRepository` | #4 | One root object already holding `currentRun` + `history` together (ADR-0010) | An `AssessmentRun` moves from `currentRun` to `history`, entirely *inside* this one key already | Quarantine-per-run, schema-versioned | The two sub-parts of the root object must be read/written together — already true today, unaffected by this design |
| `TrainingPlansRepository` | #5 | The reusable Training Plan *library* only — never `Session.planExecution` | Plans are edited/duplicated/deleted independently of any in-flight execution | Root full-wipe-on-mismatch + per-plan field repair | None beyond its own key; explicitly **not** coupled to `SessionRepository` (ADR-0012 Decision 4) |
| `AccuracyToleranceProfilesRepository` | #6 | Reusable named threshold presets | No lifecycle beyond CRUD on the list | Quarantine-per-profile | `defaultProfileId` must stay consistent with the profile list — handled inside this one repository |
| `SmartRandomProfilesRepository` | #7 | Reusable named Smart Random ranges | Same as above | Quarantine-per-profile + measurement-mode check | Same as above |
| `AssessmentPreferencesRepository` | #8, #9, #10 | Three independent scalars, all scoped to the Assess-flow UI's prefill concern | No lifecycle; each is a standalone, on-demand preference | No migration function for any of the three (Section 4.A.2 explains why this is still correctly grouped) | None — see Section 4.A.2 |

This yields **7 repositories** covering **10 keys** — current runtime. (The one prior
"8-repository" grouping this note used to disclaim was the superseded Phase 0 audit
miscount referenced in §2 above, not a forward-looking count. `docs/adr/0021-assessment-draft-history-authority-unit-split.md`
now separately designs a genuine future 8th repository — `AssessmentRepository` splitting
into `AssessmentDraftRepository`/`AssessmentHistoryRepository` — which is a target, not yet
implemented, and does not change the "7 repositories, 10 keys" count above until that
implementation lands.)

**4.A.2 — Why the three Assessment-preference keys share one repository while remaining
independently stored.** `AssessmentPreferencesRepository` is a **code-organization
grouping only** — it exists because all three keys already live in one file
(`assessmentPreferences.ts`) and serve one UI concern (prefilling the Assess flow), not
because they share a root object, a schema version, or any migration function. Three
reasons this is the correct grouping, not an accidental "third failure mode" the review
warned against:

1. **Not folded into a generic "Settings" repository.** `HistoryFiltersRepository` and the
   two profile repositories all have real root objects, schema versions, and
   quarantine/repair logic these three entirely lack (confirmed: `assessmentPreferences.ts`
   has no root object, no `schemaVersion`, and three independent inline default/whitelist
   checks). Grouping them with domains that have genuine migration machinery would imply a
   migration concern that doesn't exist for these three.
2. **Not folded into `AssessmentRepository` itself**, despite both being Assess-flow-scoped.
   The reason: `assessmentPreferences.ts:29` explicitly documents these three values as
   "UI preselection only... never silently" authoritative for a Run's actual threshold
   snapshot — they are presentation state, not part of the Assessment domain's protocol or
   persisted record at all. `AssessmentRepository` owns actual protocol/run data;
   `AssessmentPreferencesRepository` owns UI convenience state that happens to be
   Assess-scoped. Conflating the two would blur a distinction the domain code itself
   already draws sharply.
3. **The grouping never merges storage keys or shapes.** The repository interface
   (Section 5.7) exposes three independent `get`/`set` method pairs, each still reading and
   writing its own distinct key — exactly as `assessmentPreferences.ts` does today. Nothing
   about this grouping is visible in `localStorage` itself.

**Repository responsibilities**, per repository:
- Read the raw string(s) from the `StorageAdapter`.
- Parse (`JSON.parse`, with try/catch — malformed JSON is not a domain-logic concern, it's
  a storage-boundary concern) and hand the parsed value to the domain's *existing*
  migration/validation function, unchanged.
- Return a fully-typed, already-migrated domain object (or the domain's own
  absence/default value, per Section 5's per-method specification).
- Serialize a domain object back to a string and write it via the `StorageAdapter`.
- Own the domain's delete/reset/clear semantics exactly as implemented today (state-based
  rewrite, never a key removal — see Section 2), unless a future task explicitly decides to
  change this.
- Own import/export composition where it already exists (Session, Assessment) — export
  functions in `src/lib/export.ts`/`assessment/export.ts` continue building CSV from
  already-loaded domain objects; nothing about export changes.

**`StorageAdapter` responsibilities** (the only new low-level component) — see Section 9
for the complete, revised specification.

**Serialization/deserialization**: owned by repositories, not the adapter — because the
exact serialization shape (e.g. `JSON.stringify(state)` for a root object vs. a raw string
for a scalar preference) is domain knowledge, not storage knowledge. The adapter only ever
sees/returns strings.

**Validation and migration**: owned by domain logic (`src/lib/sessionMigration.ts`,
`src/lib/assessment/migration.ts`, etc.), called by repositories, exactly as today. A
repository must never re-implement or duplicate a migration rule — it is a thin caller.

**Transaction/atomicity boundaries.** Today, no cross-key atomicity exists at all — e.g.
archiving a session writes key #1 and key #2 via two independent React effects, relying on
same-tick state updates, not a storage-level transaction. **This revision does not change
that.** Unlike the original draft, this design does **not** propose a composed,
cross-key repository method for session archiving — see Section 6 for the full, corrected
treatment and Section 9 for why no adapter-level primitive in this design can express true
multi-key atomicity either.

**Error handling and corrupted-data handling**: a repository's read path never throws or
rejects, for *any* reason — see Section 8 for the complete, revised read/write result
model. Corrupted or malformed data degrades exactly as today, per domain, and is **not**
distinguished from normal absence (both are safe to persist going forward). A genuine
storage-layer read failure **is** distinguished from both — it resolves to a
`read_failed` outcome carrying a safe fallback value for display purposes only; that
outcome must not be treated as if the domain were successfully hydrated (Section 7).

**Concurrency assumptions**: unchanged from today — single-tab, no multi-tab
synchronization, no `storage` event listening, last-write-wins if two tabs happen to write
the same key. This is an existing, accepted limitation (the app has never handled it) and
is explicitly out of scope for this design; a future sync layer (Section 12) is a different
problem from same-device multi-tab consistency, and neither is being solved now.

**Reset and deletion semantics**: preserved exactly as-is (Section 2 — no key deletion
anywhere, "clear" is always a state-based rewrite to an empty/default value). The boundary
does not introduce a new "delete the key" capability unless a future task explicitly asks
for one.

**Import/export ownership**: stays with the existing `src/lib/export.ts`/
`assessment/export.ts` modules, which operate on already-loaded domain objects. Repositories
are not involved in CSV construction; they only supply the objects.

## 5. Complete repository contracts (documentation examples only — not added to runtime source)

All seven repositories are fully specified below, to the same level of detail, per the
product-owner requirement that implementation not begin against a partially-specified
boundary. Every `load*`-family method below returns a **freshly deserialized object on
every call — never a cached or shared mutable reference.** This is stated once, here,
generally, and applies uniformly to every method in every repository in this section; it
is not restated per method.

Every write method returns `Promise<PersistenceWriteResult>` (defined in Section 8.1)
rather than `Promise<void>` or a bare rejected `Promise`. Every read method returns
`Promise<DomainLoadResult<T>>` (defined in Section 8.2) rather than a bare `Promise<T>` —
distinguishing three outcomes, not the one a bare `Promise<T>` could express:

- **`{ status: "value"; value: T }`** — something was stored under the key. `value` is
  either that stored data as-is, or the result of the domain's existing repair/quarantine/
  discard policy if the stored data was malformed or an unsupported schema version
  (Section 3) — both are "a value," never distinguished from each other within this
  status, exactly as today.
- **`{ status: "absent" }`** — the key genuinely does not exist. Carries no value on
  purpose: the caller (hydration owner) initializes that domain's own documented default
  directly (stated per method below), the same way current code already does per domain —
  **this is not a generic "call the migration function with `null`" step**, and Section
  5.1 explains below why that generic approach would be actively wrong for `Session`
  specifically.
- **`{ status: "read_failed"; fallback: T; error }`** — a genuine storage-layer read
  failure. `fallback` is named differently from `value` so the type itself documents
  "display only, never for persistence" (Section 7 enforces this at the write-guard
  level).

Every `load*` method still **never rejects, for any reason** — see Section 8.2 for the
full type and Section 7 for how hydration consumes all three outcomes.

### 5.1 `SessionRepository`

Owns keys #1 (`curling-release-tracker-current-session`) and #2
(`curling-release-tracker-session-history`). Wraps `migrateSession`/`migrateSessionHistory`
(`sessionMigration.ts`) unchanged. **Does not expose a composed archive operation** — see
Section 6 for why, and for exactly how `TrackerApp.tsx`'s `handleStartNewSession` composes
`saveCurrent`/`saveHistory` itself in Phase 1.

**Why `"absent"` must not call `migrateSession(null)`:** `migrateSession`'s own
`migrateBlocks` step treats a genuinely *missing* `blocks` array as legacy pre-block data
and fabricates a `"Legacy Block"` to hold it (ADR-0005) — confirmed directly:
`migrateSession(null)` resolves `source = {}`, and `migrateBlocks({})` sees no `blocks`
array at all, so it returns `[createLegacyBlock({})]`. A brand-new session that was never
stored yet is not legacy data and must never receive a fabricated block. This is exactly
why today's code (`TrackerApp.tsx:765-780`) checks `if (savedSession)` **before** ever
calling `migrateSession`, and calls `createNewSession()` in the `else` branch instead —
and exactly why `loadCurrent()`'s `"absent"` status must remain a distinct,
migration-bypassing outcome, not a convenience wrapper around calling the migration
function with an empty input.

```typescript
interface SessionRepository {
  /**
   * Input: none. Output: `DomainLoadResult<Session>` (Section 8.2).
   * `"value"`: something was stored under the key; `value` is that data run through
   * `migrateSession` (Section 3) — this covers both a genuine prior session and a
   * malformed/partial stored string, both repaired to a valid `Session` by the existing
   * function, never distinguished from each other within `"value"`.
   * `"absent"`: the key genuinely does not exist. The hydration owner initializes
   * `createNewSession()` directly (`TrackerApp.tsx`'s existing function) — **never**
   * `migrateSession(null)`, per the note above this interface.
   * `"read_failed"`: a genuine adapter-level read failure (Section 8.2) — `fallback` is
   * `createNewSession()`, for display purposes only. Callers/hydration (Section 7) must
   * not treat this as equivalent to `"value"`/`"absent"`.
   * A repaired `"value"` result may be persisted once the domain reaches `"ready"`
   * (Section 7) — this is the existing, accepted "re-persist the migrated value
   * immediately" behavior, unchanged.
   * Mutation semantics: read-only, no side effect.
   * Copy semantics: fresh object every call (Section 5's general rule).
   * Atomicity: N/A (single read, single key).
   * Idempotency: yes — repeated calls with no intervening write return equal results.
   * Current behavior preserved: yes, exactly, for `"value"`/`"absent"`
   * (`TrackerApp.tsx:757-780`'s existing load-then-optionally-create split, now made
   * explicit as two distinct statuses instead of one `if (savedSession)` branch); the
   * `"read_failed"` distinction is new and has no prior behavior to preserve, since
   * today's synchronous code has no observable read-failure path at all.
   */
  loadCurrent(): Promise<DomainLoadResult<Session>>;

  /**
   * Input: the full `Session` to persist. Output: a `PersistenceWriteResult` (Section 8).
   * Mutation semantics: full overwrite of key #1 — never a partial/merge write, matching
   * `localStorage.setItem`'s existing contract.
   * Atomicity: single-key only; no relationship to `saveHistory` is implied or promised.
   * Idempotency: yes — saving the same `Session` twice produces the same stored value.
   * Current behavior preserved: yes — this is the direct replacement for
   * `TrackerApp.tsx:902-909`'s existing effect body, including its existing
   * `if (!currentSession) return;` guard, which moves to the *caller* (or the hydration
   * gate described in Section 7) rather than into this method, since "don't write yet"
   * is a caller/hydration-state concern, not a storage concern.
   */
  saveCurrent(session: Session): Promise<PersistenceWriteResult>;

  /**
   * Input: none. Output: `DomainLoadResult<Session[]>` (Section 8.2).
   * `"value"`: something was stored; `value` is that data run through
   * `migrateSessionHistory` (mapping `migrateSession` over the array) — covers both a
   * genuine prior history and a malformed/partial stored string, repaired the same way,
   * never distinguished from each other within `"value"`. Unlike `loadCurrent()`, running
   * migration on an actually-stored-but-malformed array here carries no Legacy-Block-style
   * trap, since `migrateSessionHistory` maps `migrateSession` per-entry over whatever
   * array elements exist — there is no equivalent "was this key ever written at all"
   * ambiguity once we already know `"value"` (something was stored).
   * `"absent"`: the key genuinely does not exist. The hydration owner initializes `[]`
   * directly — the domain's existing, documented empty-history default.
   * `"read_failed"`: a genuine adapter-level read failure; `fallback` is `[]`, for
   * display purposes only — not to be treated as "confirmed empty history."
   * Copy semantics: fresh array every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly, for `"value"`/`"absent"`
   * (`TrackerApp.tsx:761-763`); `"read_failed"` is new, with no prior behavior to
   * preserve.
   */
  loadHistory(): Promise<DomainLoadResult<Session[]>>;

  /**
   * Input: the full history list to persist (the caller has already decided its
   * contents — e.g. `[]` for "Clear History," or `[sessionToArchive, ...previousHistory]`
   * for archiving — see Section 6). Output: a `PersistenceWriteResult`.
   * Mutation semantics: full overwrite of key #2 — matches
   * `handleClearSessionHistory`'s existing `setSessionHistory([])` exactly, and matches
   * today's unconditional prepend in `handleStartNewSession` exactly.
   * Atomicity: single-key only; no relationship to `saveCurrent` is implied or promised
   * (Section 6).
   * Idempotency: yes — saving the same array twice produces the same stored value.
   * Deduplication: **none** — this method does not check for duplicate `Session.id`
   * values in the array it's given, because `handleStartNewSession` does not do this
   * today either (Section 6). This is a deliberate preservation of current behavior, not
   * an oversight.
   * Current behavior preserved: yes, exactly (`TrackerApp.tsx:918-923`).
   */
  saveHistory(history: Session[]): Promise<PersistenceWriteResult>;
}
```

### 5.2 `HistoryFiltersRepository`

Owns key #3. Wraps `sanitizeHistoryFilters`/`sanitizeThresholdComparisonMode`
(`historyAnalysis.ts`) unchanged.

```typescript
interface HistoryFiltersRepository {
  /**
   * Input: none. Output: `DomainLoadResult<HistoryAnalysisFilters>` (Section 8.2).
   * `"value"`: something was stored and parsed successfully; `value` is that data run
   * through `sanitizeHistoryFilters`/`sanitizeThresholdComparisonMode`
   * (`historyAnalysis.ts:139-149`) — repairs a malformed `thresholdComparisonMode`
   * sub-field exactly as today, still `"value"` (something was there, just partly wrong).
   * A stored string that fails `JSON.parse` entirely is treated as `"absent"` below —
   * matching `TrackerApp.tsx:793-804`'s existing try/catch, which today falls back to the
   * already-set default on either "nothing stored" or "couldn't parse" without
   * distinguishing them; this repository preserves that exact grouping rather than
   * inventing a new distinction between "no string" and "unparseable string" that current
   * code never made.
   * `"absent"`: the key genuinely does not exist, or its stored string is not valid JSON.
   * The hydration owner initializes `createDefaultHistoryFilters()`
   * (`historyAnalysis.ts:85-96`) directly.
   * `"read_failed"`: `fallback` is `createDefaultHistoryFilters()`, for display purposes
   * only.
   * Mutation semantics: read-only.
   * Copy semantics: fresh object every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly, for `"value"`/`"absent"`; `"read_failed"`
   * is new.
   */
  load(): Promise<DomainLoadResult<HistoryAnalysisFilters>>;

  /**
   * Input: the full filters object. Output: a `PersistenceWriteResult`.
   * Mutation semantics: full overwrite — matches `TrackerApp.tsx:911-916` exactly.
   * Atomicity: N/A (single key).
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly.
   */
  save(filters: HistoryAnalysisFilters): Promise<PersistenceWriteResult>;
}
```

### 5.3 `AssessmentRepository`

**Current runtime, unchanged.** Owns key #4. Wraps `migrateAssessmentPersistedState`
(`assessment/migration.ts`) unchanged. Illustrates the quarantine philosophy: unlike
`SessionRepository`, there is no partial repair here — the whole root state is loaded, or
resolves to a fresh empty state.

**Target (not yet implemented):** `docs/adr/0021-assessment-draft-history-authority-unit-split.md`
splits this single repository into `AssessmentDraftRepository` (owning a new
`curling-release-tracker-assessment-draft` key) and `AssessmentHistoryRepository` (owning a
new `curling-release-tracker-assessment-history` key), via a dedicated one-time structural
migration — see that ADR for the full design (persisted shapes, migration protocol,
startup authority resolution, and the archive-and-clear mutation replacing
`archiveCurrentAssessmentRun`). The contract below documents current runtime only.

```typescript
/**
 * Extends the plain migrated state with the one additional signal `TrackerApp.tsx`
 * currently derives itself by comparing raw vs. migrated data
 * (`rawHadCurrentRun && !migratedAssessment.currentRun`) to surface the existing
 * user-visible quarantine notice (see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 24). Without this field,
 * extracting a repository would silently drop a real, currently-implemented behavior.
 */
type AssessmentLoadResult = {
  state: AssessmentPersistedState;
  /** True when a raw `currentRun` existed in storage but failed validation and was
   * quarantined during migration. */
  currentRunQuarantined: boolean;
};

interface AssessmentRepository {
  /**
   * Input: none. Output: `DomainLoadResult<AssessmentLoadResult>` (Section 8.2).
   * `"value"`: the stored string parsed successfully (as *some* JSON object, whether or
   * not its shape is actually valid); `value` is `{ state, currentRunQuarantined }` where
   * `state` is that parsed object run through `migrateAssessmentPersistedState` — an
   * individually invalid run is quarantined (dropped), never partially repaired, exactly
   * as today; an unrecognized root `schemaVersion` resolves to the fresh empty state —
   * still `"value"`, since something parseable was there, it just didn't validate.
   * `"absent"`: the key genuinely does not exist, **or its stored string failed
   * `JSON.parse` entirely** — matching `TrackerApp.tsx:802-811`'s existing behavior
   * exactly (both cases set `rawAssessment = null` and take the same
   * `createEmptyAssessmentPersistedState()` shortcut *without* calling
   * `migrateAssessmentPersistedState` at all); this repository preserves that exact
   * grouping. The hydration owner initializes `{ state: createEmptyAssessmentPersistedState(),
   * currentRunQuarantined: false }` directly.
   * `"read_failed"`: `fallback` is the same empty-state shape as `"absent"`, for display
   * purposes only — the app must not assume no run is actually in progress merely because
   * this read failed.
   * Reload-recovery (forcing a `warmup`/`in_progress` run to `paused`) stays in
   * application code, operating on a `"value"` result only — it is an existing
   * domain-function composition (`pauseAssessmentRun`), not a repository concern, and
   * must not run against an `"absent"`/`"read_failed"` fallback (there is no run to
   * recover in either case).
   * Copy semantics: fresh object every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, including the quarantine-notice signal, for
   * `"value"`/`"absent"`; `"read_failed"` is new.
   */
  loadState(): Promise<DomainLoadResult<AssessmentLoadResult>>;

  /**
   * Input: the full persisted state. Output: a `PersistenceWriteResult`.
   * Mutation semantics: full overwrite — matches `TrackerApp.tsx:927-930` exactly,
   * including that callers, not this method, decide *when* to call it (the existing
   * `if (!assessmentState) return;` guard stays in application/hydration code, per the
   * same reasoning as `SessionRepository.saveCurrent`).
   * Atomicity: N/A (single key; `currentRun` and `history` are both inside this one
   * object already, so no cross-key concern exists for this domain).
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly.
   */
  saveState(state: AssessmentPersistedState): Promise<PersistenceWriteResult>;
}
```

### 5.4 `TrainingPlansRepository`

Owns key #5. Wraps `migrateTrainingPlans` (`trainingPlans/migration.ts`) unchanged. Not
sketched in the original draft; fully specified here. Illustrates the third migration
shape: a **root-level full wipe on version mismatch**, distinct from both
`SessionRepository`'s field-repair and `AssessmentRepository`'s per-record quarantine.

```typescript
interface TrainingPlansRepository {
  /**
   * Input: none. Output: `DomainLoadResult<TrainingPlan[]>` (Section 8.2).
   * `"value"`: something was stored (any parseable JSON, whether or not it validates);
   * `value` is that data run through `migrateTrainingPlans` — `[]` if the root
   * `schemaVersion` doesn't match (`migrateTrainingPlans`'s full-wipe gate,
   * `migration.ts:159-161`) or the stored value is malformed, still `"value"` since
   * something was there. Within a matching root version, each plan is independently
   * field-repaired (`migratePlan`, `migration.ts:134-149`); a single structurally broken
   * plan is dropped without invalidating the rest of the list.
   * `"absent"`: the key genuinely does not exist. The hydration owner initializes `[]`
   * directly. Note: today's code (`TrackerApp.tsx:860`) always calls
   * `migrateTrainingPlans(rawTrainingPlans).plans` even when `rawTrainingPlans` is
   * `null`, relying on the migration function's own internal `isRecord` check to produce
   * `[]` — this repository bypasses that call entirely on genuine absence instead, for
   * consistency with the other six repositories' `"absent"` handling; the *value*
   * produced is identical either way (`[]`), so this changes no observable behavior.
   * `"read_failed"`: `fallback` is `[]`, for display purposes only.
   * Mutation semantics: read-only.
   * Copy semantics: fresh array every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, for `"value"`/`"absent"` (identical output to
   * today's unconditional `migrateTrainingPlans` call); `"read_failed"` is new.
   */
  loadPlans(): Promise<DomainLoadResult<TrainingPlan[]>>;

  /**
   * Input: the full plan list to persist. Output: a `PersistenceWriteResult`.
   * Mutation semantics: this method internally reconstructs the root wrapper object
   * (`{ schemaVersion: TRAINING_PLANS_SCHEMA_VERSION, plans }`) before serializing —
   * matching `TrackerApp.tsx:933-939`'s existing effect body exactly, which builds that
   * same wrapper itself before calling `serializeTrainingPlansState`. Callers pass only
   * the plan array, never the wrapper — this repository is the one place that knows the
   * current schema version constant.
   * Atomicity: N/A (single key). Never touches `Session.planExecution`, which stays
   * inside `SessionRepository`/`sessionMigration.ts` unchanged (ADR-0012 Decision 4).
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly.
   */
  savePlans(plans: TrainingPlan[]): Promise<PersistenceWriteResult>;
}
```

### 5.5 `AccuracyToleranceProfilesRepository`

Owns key #6. Wraps `migrateAccuracyToleranceProfilesState`
(`accuracyToleranceProfiles/migration.ts`) unchanged. Not sketched in the original draft;
fully specified here.

```typescript
interface AccuracyToleranceProfilesRepository {
  /**
   * Input: none. Output: `DomainLoadResult<AccuracyToleranceProfilesState>` (Section 8.2).
   * `"value"`: something was stored (parseable, whether or not it validates); `value` is
   * that data run through `migrateAccuracyToleranceProfilesState` — an unrecognized
   * `schemaVersion` or a fully-invalid top-level shape resolves to
   * `createEmptyAccuracyToleranceProfilesState()`, still `"value"`. An individually
   * invalid profile is quarantined (dropped) via `migrateProfile`, never repaired,
   * without invalidating the rest of the list. A `defaultProfileId` that no longer
   * resolves to a surviving profile is cleared to `null` — this repair happens *within*
   * the loaded object, not as a side effect the repository performs separately.
   * `"absent"`: the key genuinely does not exist. The hydration owner initializes
   * `createEmptyAccuracyToleranceProfilesState()` directly. As with
   * `TrainingPlansRepository` (Section 5.4), today's code always calls the migration
   * function even on `null`; bypassing it here on genuine absence produces the identical
   * value, so no observable behavior changes.
   * `"read_failed"`: `fallback` is `createEmptyAccuracyToleranceProfilesState()`, for
   * display purposes only.
   * Mutation semantics: read-only.
   * Copy semantics: fresh object every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly, for `"value"`/`"absent"`; `"read_failed"`
   * is new.
   */
  loadState(): Promise<DomainLoadResult<AccuracyToleranceProfilesState>>;

  /**
   * Input: the full state object (profiles, `defaultProfileId`, `schemaVersion` all
   * together). Output: a `PersistenceWriteResult`.
   * Mutation semantics: full overwrite of the *entire* object exactly as given — unlike
   * `TrainingPlansRepository.savePlans`, this method does **not** reconstruct a wrapper;
   * it serializes the whole state object the caller already holds, matching
   * `serializeAccuracyToleranceProfilesState`'s existing behavior
   * (`JSON.stringify(state)` on the object as-is) and `TrackerApp.tsx:941-946`'s existing
   * effect body exactly. This asymmetry with `TrainingPlansRepository` is intentional and
   * domain-specific, not an inconsistency — each repository preserves whichever save
   * shape its own domain already uses today.
   * Atomicity: N/A (single key).
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly.
   */
  saveState(state: AccuracyToleranceProfilesState): Promise<PersistenceWriteResult>;
}
```

### 5.6 `SmartRandomProfilesRepository`

Owns key #7. Wraps `migrateSmartRandomProfilesState` (`smartRandomProfiles/migration.ts`)
unchanged. Same shape as Section 5.5, own types. Not sketched in the original draft; fully
specified here.

```typescript
interface SmartRandomProfilesRepository {
  /**
   * Output: `DomainLoadResult<SmartRandomProfilesState>` (Section 8.2). Same
   * `"value"`-path malformed/quarantine semantics as
   * `AccuracyToleranceProfilesRepository.loadState()` (Section 5.5), plus one additional
   * domain-specific repair: a profile whose `measurementMode` no longer supports Smart
   * Random (per `isSmartRandomAvailable`) is quarantined, never coerced into a fabricated
   * range — exactly as `migrateSmartRandomProfilesState` does today, still `"value"`.
   * Same `"absent"` treatment as Section 5.5 (hydration owner initializes
   * `createEmptySmartRandomProfilesState()` directly; bypassing today's unconditional
   * migration call on `null` changes no observable value). Same `"read_failed"`
   * semantics as Section 5.5, with `fallback: createEmptySmartRandomProfilesState()`.
   * Mutation semantics: read-only. Copy semantics: fresh object every call.
   * Atomicity: N/A. Idempotency: yes.
   * Current behavior preserved: yes, exactly, for `"value"`/`"absent"`; `"read_failed"`
   * is new.
   */
  loadState(): Promise<DomainLoadResult<SmartRandomProfilesState>>;

  /**
   * Same full-overwrite, whole-object-as-given semantics as
   * `AccuracyToleranceProfilesRepository.saveState()` (Section 5.5) — matches
   * `TrackerApp.tsx:948-953` exactly.
   * Atomicity: N/A (single key). Idempotency: yes.
   * Current behavior preserved: yes, exactly.
   */
  saveState(state: SmartRandomProfilesState): Promise<PersistenceWriteResult>;
}
```

### 5.7 `AssessmentPreferencesRepository`

Owns keys #8, #9, #10. **No shared root, no migration function, no schema version** — see
Section 4.A.2 for why this grouping is still correct. Three independent method pairs,
mirroring `assessmentPreferences.ts`'s three existing functions exactly. Not sketched in
the original draft; fully specified here. This repository is exempt from the hydration
gate in Section 7 — see that section's note.

```typescript
interface AssessmentPreferencesRepository {
  /**
   * Input: none. Output: `DomainLoadResult<boolean>` (Section 8.2) — whether the Assess
   * Guided Introduction should be shown.
   * `"value"`: a string was stored; `value` is `raw === "true"` evaluated literally
   * (`assessmentPreferences.ts:20`) — **note this is not a "repair to default"
   * situation**: an unrecognized stored string (anything other than the literal `"true"`)
   * evaluates to `false`, not to the `"absent"` default of `true` below. This exact,
   * slightly surprising literal-comparison behavior is preserved unchanged.
   * `"absent"`: the key genuinely does not exist. The hydration owner initializes `true`
   * (shown) directly — matches `getShowAssessmentIntroductionPreference`'s existing
   * `raw === null → true` default exactly (`assessmentPreferences.ts:19`).
   * `"read_failed"`: `fallback: true`, for display purposes only. Never rejects.
   * **No write-protection state applies to this repository** (see the note above this
   * interface) — there is no passive save effect to protect; a `"read_failed"` result
   * here only means this specific call should be treated as provisional, and a caller
   * may simply retry on the next relevant interaction if it chooses to.
   * Mutation semantics: read-only. Copy semantics: N/A (primitive).
   * Atomicity/idempotency: N/A/yes. Current behavior preserved: yes, exactly, for
   * `"value"`/`"absent"`; `"read_failed"` is new.
   */
  getShowIntroduction(): Promise<DomainLoadResult<boolean>>;

  /** Input: the new value. Output: a `PersistenceWriteResult`. Full overwrite, matches
   * `setShowAssessmentIntroductionPreference` exactly. */
  setShowIntroduction(show: boolean): Promise<PersistenceWriteResult>;

  /**
   * Output: `DomainLoadResult<AccuracyThresholdPreset>`.
   * `"value"`: a string was stored; `value` is that string if it's one of
   * `VALID_PRESETS`, else `"standard"` — matches the existing whitelist-check-with-
   * fallback exactly (`assessmentPreferences.ts:27,33-35`); an invalid stored string is
   * still `"value"` (something was there, repaired to `"standard"`), distinct from
   * `"absent"` below even though the resulting fallback value happens to be the same.
   * `"absent"`: the key genuinely does not exist. The hydration owner initializes
   * `"standard"` directly.
   * `"read_failed"`: `fallback: "standard"`.
   * Never authoritative for an actual Run's threshold snapshot (documented at
   * `assessmentPreferences.ts:29`) — this remains a UI-preselection concern only,
   * unchanged. No write-protection state applies, per the note above.
   * Mutation semantics: read-only. Current behavior preserved: yes, exactly, for
   * `"value"`/`"absent"`; `"read_failed"` is new.
   */
  getLastThresholdPreset(): Promise<DomainLoadResult<AccuracyThresholdPreset>>;

  /** Input: the new preset. Output: a `PersistenceWriteResult`. Full overwrite, matches
   * `setLastAssessmentThresholdPreset` exactly. */
  setLastThresholdPreset(preset: AccuracyThresholdPreset): Promise<PersistenceWriteResult>;

  /**
   * Output: `DomainLoadResult<AccuracyThresholds | null>`.
   * `"value"`: a non-empty string was stored; `value` is the parsed-and-shape-checked
   * threshold pair if it parses and validates, else `null` — matches
   * `getLastAssessmentCustomThreshold`'s existing try/catch + shape-check exactly
   * (`assessmentPreferences.ts:46-59`); a present-but-invalid string is still `"value"`
   * (repaired to `null`), distinct from `"absent"` even though the fallback value is
   * again coincidentally the same.
   * `"absent"`: the key genuinely does not exist (or is an empty string, which today's
   * `if (!raw) return null` treats identically — preserved). The hydration owner
   * initializes `null` directly.
   * `"read_failed"`: `fallback: null`.
   * Also never authoritative, same reasoning as above; no write-protection state applies.
   * Mutation semantics: read-only. Current behavior preserved: yes, exactly, for
   * `"value"`/`"absent"`; `"read_failed"` is new.
   */
  getLastCustomThreshold(): Promise<DomainLoadResult<AccuracyThresholds | null>>;

  /** Input: the new threshold pair. Output: a `PersistenceWriteResult`. Full overwrite,
   * matches `setLastAssessmentCustomThreshold` exactly. */
  setLastCustomThreshold(values: AccuracyThresholds): Promise<PersistenceWriteResult>;
}
```

### 5.8 How these contracts preserve current behavior

- Every method's `"value"`/`"absent"`/malformed-data behavior matches the corresponding
  existing `migrate*`/`sanitize*` function or inline check exactly — no new default-value
  rule, no new fallback behavior, no new validation rule is introduced anywhere in this
  section. Where today's code always invokes a migration function even on a `null` input
  (`TrainingPlansRepository`, `AccuracyToleranceProfilesRepository`,
  `SmartRandomProfilesRepository`), this document documents an equivalent-output
  simplification (bypass the call on genuine `"absent"`) explicitly, per method, rather
  than silently changing what those three methods return.
- No repository exposes a generic `save(key, value)`/`get(key)` method — every method is
  named for its domain operation.
- Every domain's `"absent"` default is stated explicitly and independently — `Session`
  uses `createNewSession()` specifically (never a generic migration call, per Section
  5.1's note on the Legacy Block trap), while every other domain uses its own documented
  empty-state constructor or literal default. No two domains' absence handling is
  assumed identical merely because this document uses one shared result type for all of
  them.
- Nothing in this section touches a storage *key name* or a persisted *shape* — the
  contracts describe how existing keys/shapes are accessed, never what they contain.
- **`SessionRepository` no longer includes `archiveCurrentToHistory`** — see Section 6 for
  the corrected treatment of session archiving.
- **Every `load*` method now returns `DomainLoadResult<T>`, not a bare `T`** — see
  Section 8.2. Three outcomes, not one: `"value"` (something was stored, used as-is or
  repaired per the domain's existing policy), `"absent"` (the key genuinely does not
  exist), and `"read_failed"` (a genuine storage-layer failure, which current behavior
  has no equivalent for — today's fully-synchronous code has no observable read-failure
  path at all). Section 7's hydration design consumes all three, initializing the correct
  default on `"absent"` and keeping the domain write-protected on `"read_failed"`.

## 6. Session archiving (corrected in this revision)

### 6.1 Current behavior, accurately described

`handleStartNewSession` (`TrackerApp.tsx:1718-1752`) is the only code path that moves a
`Session` from the "current" slot into history. Inside its confirmation modal's
`onConfirm`:

```js
if (currentSession && currentSession.shots.length > 0) {
  setSessionHistory((currentHistory) => [currentSession, ...currentHistory]);
}
setCurrentSession(createNewSession());
```

Both `setState` calls are batched into one React render. The actual `localStorage` writes
happen in two separate `useEffect`s, and **the effect declaration order — not the call
order above — determines the real write order**:

- The current-session save effect is declared at `TrackerApp.tsx:902-909` (guarded:
  `if (!currentSession) return;`).
- The session-history save effect is declared at `TrackerApp.tsx:918-923` (unguarded).

Because `902 < 918`, **React fires the current-session write before the session-history
write**, on the render where both changed. Confirmed by direct reading of both effect
declarations. This means: **today, the new (empty) session overwrites the "current" slot
before the just-archived session is durably written to history.** If the app is
interrupted between these two writes, the old session is briefly represented in neither
location — an existing, unmitigated, narrow risk window, not something this revision
introduces or is required to fix.

Also confirmed: **no ID-based deduplication exists** for this operation.
`setSessionHistory((h) => [currentSession, ...h])` unconditionally prepends; a repeat
invocation with the same session (which the current UI cannot trigger, but which is worth
naming precisely) would create a duplicate history entry. `migrateSessionHistory`
performs no deduplication on load either. (Contrast: `AssessmentRepository`'s real-code
equivalent, `archiveCurrentAssessmentRun`, *is* ID-idempotent — `persistence.ts:60-86`.
Session has no equivalent today.)

### 6.2 Binding product-owner decision for Phase 1 (superseded in part by ADR-0014)

**Phase 1 did not change any of the above.** Specifically, and explicitly superseding the
original draft's `archiveCurrentToHistory` method:

1. ~~**The write order is unchanged**: current-session first, session-history second.~~
   **Superseded by `docs/adr/0014-session-archive-write-ordering.md`**, the separate,
   explicitly-approved decision Section 6.4 (below) called for: the write order is now
   session-history first, current-session second, coordinated inside one repository
   method (`SessionRepository.archiveAndReplace`) rather than left to two independent
   `useEffect`s. See ADR-0014 for the full rationale (history-first is the safer
   direction for a non-atomic backend) and failure semantics. Points 2, 4, and 5 below
   are unaffected by that change.
2. **No ID-based deduplication or new idempotency behavior is introduced** for session
   archiving.
3. ~~**`SessionRepository` exposes only `loadCurrent`/`saveCurrent`/`loadHistory`/
   `saveHistory`**~~ — **superseded by ADR-0014**: `SessionRepository` now also exposes
   `archiveAndReplace`, the one composed, cross-key operation ADR-0014 authorizes
   specifically for this transition. It still does not decide *what* the next state is
   (point 4 below still holds) — only how the two writes it's given are coordinated.
4. **Construction of the next session and the next history array stays in the existing
   application flow** (`TrackerApp.tsx`'s `handleStartNewSession`) — the repository does
   not decide *what* the next state is, only persists what it's given, in the order and
   with the failure semantics ADR-0014 specifies.
5. **The activity guard stays in application code**, not inside a repository operation.
   ADR-0029 expands it from `shots.length > 0` to release-timing Shots **or any embedded
   Exercise Execution**, because a completed Technique Exercise can legitimately have no
   Attempt and no Shot. An active Exercise is abandoned explicitly before archival.

As implemented (post-ADR-0014), `handleStartNewSession` calls:

```
if (currentSession has at least one shot or Exercise Execution) {
  abandon any active Exercise Execution in the archive snapshot;
  const nextHistory = [currentSession, ...existingHistory];
  const result = await sessionRepository.archiveAndReplace(nextHistory, nextCurrentSession);
  // result distinguishes a history-write failure (nothing persisted, React state left
  // untouched) from a current-session-write failure (history already durable; React
  // state still updated; the ordinary saveCurrent effect retries) — see ADR-0014.
} else {
  // handled by the ordinary, independent saveCurrent save effect, unchanged.
}
```

### 6.3 Partial-failure behavior, stated accurately

If `saveCurrent` succeeds and `saveHistory` fails (a rejected write per Section 8) or the
app is interrupted between the two `await`s, the outcome is **identical to today's real
risk**: the old session is already overwritten in "current" and not yet durable in
"history." Phase 1 does not fix this. It is documented here so no reader mistakes the
absence of a fix for an oversight.

### 6.4 Deferred to a separate, future, explicitly-approved decision

Not decided by this document, and not authorized by ADR-0013 directly:

- ~~A transactional (or safer-ordered) archive operation.~~ **Resolved by
  `docs/adr/0014-session-archive-write-ordering.md`**: a safer-ordered (history-first),
  explicitly-coordinated `archiveAndReplace` operation. Not transactional — ADR-0014 is
  explicit that `localStorage` still cannot provide cross-key atomicity; it only commits
  to which non-atomic order is safer, and documents the seam a future IndexedDB adapter
  could use to make the same operation genuinely atomic.
- Retry-safe deduplication for session archiving, of the kind `AssessmentRepository`
  already has for run archiving. **Still not decided** — ADR-0014 does not add
  ID-based deduplication to `archiveAndReplace`.
- ~~Any change to the current write order.~~ **Resolved by ADR-0014** (above).

Retry-safe deduplication remains a genuine behavior change requiring its own, separate
product-owner decision and ADR — not an implicit consequence of ADR-0014.

### 6.5 The write-order property is now coordinated at the repository boundary, not adapter-contingent (Resolved by ADR-0014; historical description below kept for context)

**This subsection described a gap that has since been closed.** `docs/adr/0014-session-archive-write-ordering.md`
introduces `SessionRepository.archiveAndReplace`, which sequences the two writes with a
plain `await` inside the repository method itself — the guarantee no longer depends on
adapter synchronicity or React effect declaration order, for the reasons the original
finding below identified as a risk. The original finding is preserved here as the
historical record of why ADR-0014 was needed:

`PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md` finding 7: the current-session-before-history
write order (6.1–6.2) is real and is directly verified by
`TrackerApp.persistenceCharacterization.test.tsx`'s
`"writes the current-session key before the session-history key..."` test, which spies on
`Storage.prototype.setItem` against the real adapter. But that order is preserved by two
facts specific to *today's* implementation, not by anything `SessionRepository`'s
interface itself promises:

1. `localStorageAdapter.set()` has no `await` in its body, so calling it executes
   synchronously through to `localStorage.setItem()` before the call expression finishes
   evaluating — there is no genuine asynchrony to reorder.
2. React fires passive effects in declaration order on the same commit; the current-
   session save effect is declared before the session-history save effect.

Neither of these is part of `SessionRepository.saveCurrent`/`saveHistory`'s
`Promise<PersistenceWriteResult>` signature. A genuinely asynchronous future adapter
(IndexedDB or otherwise) could complete the history write before the current-session
write if, e.g., the current-session transaction is larger or slower — nothing in
`TrackerApp.tsx` or the repository layer would notice or prevent that, because nothing
`await`s `saveCurrent()`'s Promise before triggering `saveHistory()`; the two effects are
independent, uncoordinated call sites that happen to resolve synchronously today only
because of points 1–2 above. Any IndexedDB migration or a transactional archive operation
(6.4) requires its own explicit sequencing decision before this order can be relied on
under a genuinely asynchronous adapter — not assumed to carry over from today's behavior.

## 7. Hydration design

This section is new in this revision. It exists because Section 5's repository methods
are `Promise`-returning, which widens the mount-time load window described in Section
2.1's write-guard note from "negligible, self-correcting within one synchronous JS task"
to "a real asynchronous gap" — and the product-owner decision requires that this gap
introduce **no** new risk: no default overwriting stored data, no dropped timing results,
no unintended rewrites, and no cross-domain contamination.

**Corrected across Revisions 2–3**: the original version of this section collapsed a
genuine storage read failure into "hydration completed," which — combined with an
unconditional "writes enabled once hydrated" rule — would have let default state be
persisted over already-stored data purely because a *read* failed (Revision 2's fix).
Revision 2's own read-result type still folded a real/repaired stored value together with
genuine absence into one `"ready"` outcome; Revision 3 (this version) splits those into
`"value"` and `"absent"` at the repository-contract level (Section 8.2), and this section
now maps all **three** repository-level outcomes onto the hydration model explicitly.
**"Hydration settled" and "writes enabled" remain two different things**, tracked by three
explicit states, not one boolean.

### 7.1 Three-state model, per effect-persisted domain

For each of the six domains wired through `TrackerApp.tsx`'s mount/save-effect pattern
(#1–#7 minus `AssessmentPreferencesRepository`, which has no mount effect to gate — see
7.6), the application layer tracks one hydration-state value per domain:

```typescript
type DomainHydrationState = "loading" | "ready" | "write_protected";
```

Only three states — mapping from the repository's **three** `DomainLoadResult` outcomes
(Section 8.2), not a one-to-one correspondence:

- **`"loading"`** — the initial state, before the domain's `load*()` call resolves.
- **`"ready"`** — the load resolved either `{ status: "value", value }` or
  `{ status: "absent" }` (Section 8.2). Both are safe to persist going forward, exactly as
  today (today's code never distinguishes "a real/repaired value" from "the documented
  default because nothing was stored" for write-permission purposes, only for *which*
  value gets initialized — Section 7.2). **Only in this state are the domain's save
  effects permitted to run.**
- **`"write_protected"`** — the load resolved `{ status: "read_failed", fallback, error }`
  (Section 8.2): a genuine storage-layer read failure. The domain's state is set to
  `fallback` **for UI display purposes only**; the domain's save effect stays disabled
  for the remainder of the session, so nothing — including that same fallback value — is
  ever written back to storage merely because the read failed. The `error` value is
  retained (see 7.5) so the UI can report or later attempt recovery, though no automatic
  retry is designed here (no current code has automatic-retry behavior for anything, and
  this document does not introduce it; recovery UX is an implementation-time decision,
  write-protection while unretried is not).

Each domain's save effect gains an explicit guard using this state, not a boolean:

```js
if (sessionHydrationState !== "ready") return;
// ...existing save logic, unchanged...
```

This generalizes the ad hoc guard that already exists for exactly 2 of 7 domains today
(`if (!currentSession) return;`, `if (!assessmentState) return;`) into a uniform rule
applied to all 6 relevant domains, closing the write-guard gap identified in Section 2.1
for the other 4 — **and** it is strictly narrower than a boolean guard would be, because
`"write_protected"` is a third state such a guard could not express. This is not a change
to any domain's steady-state persisted value on the success path — a `"ready"` domain's
save effect behaves exactly as today.

### 7.2 Required behavior per load outcome

- **`{ status: "value", value }`** → initialize the domain's state from `value` directly
  (this is either a genuine stored value, or the result of the domain's existing repair/
  quarantine/discard policy applied to malformed/unsupported stored data — Section 8.2
  does not distinguish those two from each other, only from absence and read failure),
  then set `DomainHydrationState` to `"ready"`, permitting writes. A repaired/discarded
  fallback produced this way may be persisted once `"ready"` — e.g.
  `TrainingPlansRepository`'s full-wipe-to-`[]` on a `schemaVersion` mismatch is already,
  today, something the existing save effect would happily re-persist as `[]` on the next
  write; this design changes nothing about that.
- **`{ status: "absent" }`** → initialize the domain's own documented current default or
  empty state directly (Section 5's per-method absence semantics — e.g. `createNewSession()`
  for `SessionRepository.loadCurrent()`, `[]` for history/plans, each profile domain's own
  `createEmpty*State()`, per-preference literal defaults), then set `DomainHydrationState`
  to `"ready"`, permitting writes. This is not a call to any migration function (Section
  5.1's note on why that would be wrong for `Session` specifically applies as a general
  principle: the hydration owner, not a generic repair pass, decides what "nothing was
  ever stored" becomes).
- **`{ status: "read_failed", fallback, error }`** → initialize the domain's state from
  `fallback` **for display purposes only**, retain `error` (7.5), and set
  `DomainHydrationState` to `"write_protected"`, **never** `"ready"`. The save effect's
  guard (7.1) keeps it disabled. This is the one outcome the original hydration design
  handled incorrectly before Revision 2 (it treated it as equivalent to success).

Malformed or unsupported stored data is always handled under the first bullet
(`"value"`), per each domain's existing, unchanged repair/quarantine/discard policy
(Section 3) — it is never treated as `"read_failed"`, since nothing about the storage
mechanism itself failed; something was simply stored that didn't validate.

### 7.3 Preventing defaults from overwriting stored data

Two independent protections, both required:

1. **Against the ordinary "default fires before load resolves" race** (Section 2.1's
   write-guard note): the `"loading"` state blocks all writes exactly as `"write_protected"`
   does — a save effect's guard is `!== "ready"`, so both `"loading"` and
   `"write_protected"` block it. No domain's save effect can fire with its React state
   still at its initial default value, because the guard is closed until the state
   becomes `"ready"` specifically.
2. **Against a read failure being mistaken for a safe-to-persist default** (this revision's
   correction): per 7.2, a read failure never produces `"ready"`. Even though the
   in-memory state is set to a default-shaped `fallback` value for display, the domain
   stays `"write_protected"` — so that same fallback is never the thing that gets written
   back to storage, and any genuinely persisted data from before the failed read remains
   untouched in storage until a successful read (an implementation-time retry mechanism,
   not designed here) actually confirms what should replace it.

### 7.4 Timing providers require successful session readiness, not merely a finished attempt

The Timing Simulator's subscription effect (`TrackerApp.tsx:730`, declared *before* the
session-load effect at `:756`) must not call `simulatorProvider.start()` until
`sessionHydrationState === "ready"` **specifically** — not merely "no longer `\"loading\"`."
Concretely: the effect's body is gated (`if (sessionHydrationState !== "ready") return;`),
and `sessionHydrationState` is added to its dependency array, so the effect re-runs each
time that state changes and performs the real subscribe+start only on the transition into
`"ready"` — never on a transition into `"write_protected"`, and never before either
transition. A future real hardware `TimingProvider` must follow the same gate.

**This is corrected from the original design**, which gated the provider on "hydration
completed," a condition that collapsed model made true even after a read failure. Under
this three-state model, the provider may start once `SessionRepository.loadCurrent()`
resolved either `{ status: "value" }` or `{ status: "absent" }` — both transition
`sessionHydrationState` to `"ready"` — but must remain inactive after
`{ status: "read_failed" }`, which leaves it at `"write_protected"` instead. A timing
result is never generated as processable input for a session that never actually became
ready, closing exactly the case identified in review: "timing results must remain blocked
until the current-session domain is successfully ready, not merely until its read attempt
has finished."

`processIncomingTimingResult`'s existing `if (!session) return;` guard
(`TrackerApp.tsx:586-587`) remains as defense-in-depth, but the primary fix is: the
provider is never started early enough, in either failure mode, for this to matter.

### 7.5 Retained failure information for reporting or recovery

Each domain that can enter `"write_protected"` also stores the `PersistenceReadError`
(Section 8) that caused it — e.g. `sessionReadError: PersistenceReadError | null`,
alongside `sessionHydrationState`. This is application-owned state the UI may use to show
a "couldn't load your data" indicator, to disable relevant actions, or (in a future,
separately-designed retry mechanism) to attempt recovery — none of that UI/recovery
behavior is designed here; only that the information is not discarded is required now.

### 7.6 Stale asynchronous completions after unmount are ignored

Each domain's mount-time load sequence uses a cancellation guard set in the effect's
cleanup function:

```js
useEffect(() => {
  let cancelled = false;
  sessionRepository.loadCurrent().then((result) => {
    if (cancelled) return;
    switch (result.status) {
      case "value":
        setCurrentSession(result.value);
        setSessionHydrationState("ready");
        break;
      case "absent":
        setCurrentSession(createNewSession());
        setSessionHydrationState("ready");
        break;
      case "read_failed":
        setCurrentSession(result.fallback);
        setSessionReadError(result.error);
        setSessionHydrationState("write_protected");
        break;
    }
  });
  return () => { cancelled = true; };
}, []);
```

A load `Promise` that resolves after the owning component has unmounted (or, in a future
architecture, after the specific load call is no longer relevant) never calls `setState`,
regardless of which branch it would have taken. This is the standard, minimal pattern for
this exact problem and introduces no new abstraction.

**Exemption for `AssessmentPreferencesRepository`**: its three keys are read on demand
from `AssessScreen.tsx` at arbitrary interaction points, never from an always-on mount
effect with a corresponding save effect. There is no `DomainHydrationState`, no
write-guard, and no unmount-cancellation concern for this repository — each `get`/`set`
call is a single, self-contained, already-async-safe operation with no steady-state
"loading"/"ready"/"write_protected" state to speak of (Section 5.7). This exemption is
about the *repository/hydration-state* concept specifically, not about whether the
*consuming component* needs any readiness concept of its own — `AssessScreen.tsx` still
needs, and (as of the Phase 1 correction, Section 7.10) has, its own local one-time
mount-time hydration flag so its threshold-preset/custom-threshold controls don't paint
an interactive default before their initial reads settle, and so a single, later-added
navigation decision doesn't depend on an unguarded per-click read at all. That is a
component-level UI concern, not a repository-boundary one — nothing here reintroduces a
`DomainHydrationState`/write-guard/unmount-cancellation concept for this repository.

### 7.7 First post-`"ready"` render does not cause unintended rewrites

The freshly-loaded value is written back to storage on the render immediately following
the transition to `"ready"`, because the domain's state changed (from `"loading"`'s
initial default to the loaded value) in that same render, and the save effect's dependency
array includes that state. **This is not new or unintended** — it is exactly what happens
today already (the existing synchronous load-then-save-effect sequence already re-persists
the freshly-migrated value immediately after loading it; an accepted, harmless, idempotent
consequence of the one-effect-per-key pattern). What this design prevents is a
**different** rewrite: a write of the *stale initial default* before the real value has
loaded, or a write of a *read-failure fallback* mistaken for a safe value (7.3) — those are
the only "unintended rewrites" this design is required to close.

### 7.8 One domain's failure does not corrupt another domain's hydration

Each domain's load-and-settle sequence (7.6's pattern) is independent — six separate
`useEffect`s, six separate `.then()` continuations, six separate `DomainHydrationState`
values. A storage-layer failure in one domain's `loadX()` call (Section 8) moves only that
domain to `"write_protected"`; it has no code path that touches any other domain's state,
effect, or hydration value. No `Promise.all`/sequential-await chain across domains is
introduced — each domain's mount effect is independent today (one `useEffect` per concern)
and stays independent under this design.

### 7.9 Required integration and E2E tests

Corrected and expanded across revisions to test the three-outcome read model and the
three-state hydration model explicitly:

1. **Stored value and normal absence produce different repository results
   (integration):** for each repository, seed the adapter with a real stored value in one
   run and nothing at all in another; assert the `load*()` result's `status` is `"value"`
   in the first case and `"absent"` in the second — never the same tag. This is the direct
   regression guard for the requirement that repository contracts distinguish a
   successful stored value from normal absence, not just from a read failure.
2. **Normal absence initializes the current domain default and permits later writes
   (integration):** mock a `StorageAdapter.get()` resolving `{ status: "absent" }`; assert
   the domain's state is initialized to that domain's own documented default (Section 5 —
   e.g. `createNewSession()` for `SessionRepository`, not a generic empty object), the
   domain reaches `"ready"`, and a subsequent state change is persisted.
3. **Delayed successful reads cannot be overwritten by defaults (integration):** mock a
   `StorageAdapter` with an artificially delayed `get()` resolving `{ status: "value" }`;
   assert `set()` is never called for that domain's key(s) until after the load resolves
   and the corresponding state update (to `"ready"` with the real value) has committed.
4. **A storage read failure settles hydration but keeps the domain write-protected
   (integration):** mock `loadX()` to resolve `{ status: "read_failed", ... }`; assert the
   domain leaves `"loading"` (UI-visible state is set to `fallback`) but reaches
   `"write_protected"`, never `"ready"`, within a bounded time.
5. **Default state is never persisted after a read failure (integration):** using the
   same mock as test 4, assert `StorageAdapter.set()` is never called for that domain's
   key(s) for the remainder of the test, including after further unrelated re-renders.
6. **One failed domain does not prevent unrelated domains from becoming writable
   (integration):** mock one domain's `loadX()` to resolve `read_failed` (or hang) while
   another domain's resolves `"value"` or `"absent"` normally; assert the second domain
   reaches `"ready"` and its save effect activates regardless of the first.
7. **The timing provider remains inactive when current-session loading fails
   (integration):** mock `SessionRepository.loadCurrent()` to resolve `read_failed`; spy on
   `TimingProvider.start()`; assert it is never called. A companion assertion confirms the
   provider *does* start when `loadCurrent()` resolves either `"value"` or `"absent"`.
8. **Malformed-data behavior remains domain-specific (integration):** for each domain,
   write a malformed/legacy payload directly via the adapter and confirm the *existing*
   repair/discard/quarantine policy still produces a `"value"` result (never `"absent"`,
   never `"read_failed"`) with the documented repaired value. This is the regression guard
   for the requirement that malformed data and unknown schema versions are not raw
   storage-access failures.
9. **Browser exceptions do not escape the adapter boundary (integration):** mock the
   underlying `localStorage.getItem`/`setItem` to throw `DOMException`/
   `QuotaExceededError`; assert no repository or hydration code ever observes that
   exception type — only the typed `PersistenceReadError`/`PersistenceWriteError` shapes
   (Section 8).
10. **Unmount-safety (integration):** unmount the component before a pending `loadX()`
    resolves (any of the three branches); resolve it afterward; assert no
    `setState`-after-unmount warning and no corresponding `set()` call.
11. **Current absence, reset, repair, discard, and rewrite behavior is preserved
    (E2E, extends `tests/e2e/reload.spec.ts`/`tests/e2e/corrupt-persistence.spec.ts`):**
    seed realistic data (and, separately, no data) across all domains, reload, and assert
    the UI never renders an empty/default view before showing the loaded content, that no
    domain's final stored value ever equals its empty/default serialization when real data
    was seeded, and that every existing reset/clear/repair/discard behavior (Section 3,
    Section 6) still produces identical end-to-end results to the pre-repository baseline
    captured in the Section 11 characterization tests.

### 7.10 Interaction-boundary gating (added in Revision 4 — the Phase 1 correction)

Sections 7.1–7.9 fully specify *save-effect* write-guards: a domain's save effect must
not fire until `DomainHydrationState` is `"ready"`. This is necessary but was not, by
itself, sufficient — `PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md` found that the as-implemented
`TrackerApp.tsx` left every mutating control for History Filters, Training Plans,
Accuracy Tolerance Profiles, and Smart Random Profiles fully interactive, backed by that
domain's initial default, for the entire window between Session becoming ready and that
domain's *own* load resolving — independent of the (correctly implemented) save-effect
guard. A user could create a Training Plan, an Accuracy/Smart Random profile, or change a
filter during that window; the domain's own mount `.then()` would then unconditionally
overwrite whatever was in React state once it resolved, silently discarding the user's
action. `AssessScreen.tsx`'s threshold-preset/custom-threshold controls had the identical
defect, plus a related one: `handleViewAssessment` started a fresh, unguarded preference
read on every call, whose late completion could force navigation after the user had
already moved on to something else.

**The binding correction principle:** a late hydration result must never overwrite a user
action performed after mount. Per domain, independently:

- **`"loading"`** — no user action may mutate that domain.
- **`"ready"`** — normal interaction and persistence are permitted.
- **`"write_protected"`** — the fallback may be displayed, but actions that would mutate
  or imply durable persistence for that domain must remain unavailable.

**Why not a simple dirty-flag ("skip the late load if the user already touched this
domain") guard:** for a domain that starts from an *empty* default (Training Plans,
Accuracy Tolerance Profiles, Smart Random Profiles — all "collection" domains), that
approach is unsafe on its own:

1. The UI starts from an empty default.
2. The user creates one item before the real load resolves.
3. The dirty flag is now set, so the late-arriving *stored* collection is (correctly)
   skipped.
4. The user's one new item is now the entire in-memory collection.
5. The next save effect persists that one-item collection over the complete stored
   collection, since hydration has reached `"ready"` and nothing distinguishes "the user's
   one item is the *whole* truth" from "the user's one item was added *on top of* data
   never actually seen."

That replaces one data-loss race (a late load overwrites a user action) with a different
one (an early user action overwrites unseen stored data) — not a fix. **Readiness
gating**, applied at the interaction boundary itself rather than resolved after the fact,
is the required Phase 1 solution: the mutating control simply does not exist (or is
disabled) until that domain's own hydration state is `"ready"`, closing the window
entirely. No conflict-merging, operation-replay, or three-way-merge behavior is
introduced — Section 6.4's constraints against inventing new archival/reconciliation
semantics extend to this correction too.

**Every effect-persisted domain is non-mutable after `"read_failed"` — no domain-specific
exception.** An earlier pass of this correction treated History Filters as an exception
(reasoning that an in-memory-only change to a single, always-overwritten preference
object is harmless since its save effect already refuses to persist anything once
write-protected). External review rejected that reasoning: a control that remains
visibly interactive but silently produces a handler-level no-op does not satisfy
"unavailable," regardless of whether the underlying domain happens to be a single
preference object or a collection — the *user-visible* guarantee must be identical
across every domain. History Filters' controls are now disabled the same way every other
domain's are (below).

**Two layers are both required, not either/or**: a visible UI gate (the control is
disabled, or in the "loading" case not yet rendered) prevents a user from being misled
into interacting with something that cannot durably take effect; a handler-level guard
(`if (xHydration !== "ready") return;`, or equivalent) is defence in depth against any
trigger path that bypasses the UI layer (a bypassed `fireEvent`, a future added entry
point, a race in test tooling). Neither layer alone is sufficient: the UI gate alone
would regress if a future change added a new, undisabled entry point; the handler guard
alone is exactly what external review flagged as insufficient on its own — the user must
never be able to go through an apparently functional interaction that turns out to be a
no-op.

Applied per domain:

- **History Filters** — the interactive filter control is not rendered while
  `historyFiltersHydration === "loading"` (a minimal loading placeholder stands in
  instead). Once settled, the control always renders, but every control inside it is
  passed `disabled={historyFiltersHydration !== "ready"}` — so a `"write_protected"`
  domain shows its documented fallback with every select/input/button visibly
  non-interactive, exactly like every other domain, not merely "interactive but never
  persisted." `onChange` is also routed through a handler-level guard
  (`handleChangeHistoryFilters`) as defence in depth.
- **Training Plans** — the "Training Plans" tab (not the Exercise Library or nested
  Release Timing setup, which neither reads nor mutates this collection) is disabled while
  `trainingPlansHydration !== "ready"`, so the library/editor/start-review screens are
  simply unreachable until the real collection has loaded (or forever, if write-protected).
- **Accuracy Tolerance Profiles / Smart Random Profiles** — the "Manage Accuracy
  Tolerances"/"Manage Smart Random Profiles" entry points are disabled while their
  respective hydration state `!== "ready"`, for the same reason.
- **Session** — its `"loading"` case was already safe structurally (the pre-existing
  `if (!currentSession) return null;` render gate means nothing renders, so nothing can
  be interacted with, before Session's own load resolves). Its `"write_protected"` case
  was not: once write-protected, `currentSession` holds the display-only fallback and is
  non-null, so the full UI would otherwise render normally. Every reachable
  Session-mutating control is now visibly disabled — the Release Time Exercise's
  "Continue to Timing Setup" action (so setup and session metadata never mount), the
  Training Plan "Start Training" review
  button, the per-session-history "Delete" button, and "Clear History" — and every
  Session-mutating handler (`handleStartNewSession`, block creation/editing,
  session-history delete/clear, manual shot entry, Auto Capture start, etc.) also guards
  on `sessionHydration === "ready"` as defence in depth. `processQueuedTimingResult`'s
  non-Assessment branch carries the same guard — closing both the classic manual-entry
  path and the Timing Simulator/Auto Capture path, which both funnel through that one
  function (see "Manual entry and future sensor input share one domain flow" in
  `CLAUDE.md`). The Timing Simulator's subscription effect already had the equivalent
  guard (7.4). Manual timing entry, Auto Capture, and the Timing Simulator panel itself
  are, in the current implementation, structurally unreachable while write-protected —
  the fallback session `SessionRepository.loadCurrent()` returns on `read_failed` is
  always blockless (`createNewSession()`), and every block-creating handler is guarded,
  so `activeBlock` can never become non-null for the lifetime of a write-protected
  session, and none of that UI ever mounts at all.
- **Assessment** — `updateAssessmentState`, the one function `AssessScreen.tsx` uses to
  mutate Assessment state, now also guards on `assessmentHydration === "ready"` (it
  previously only checked for a non-null ref, which a `"write_protected"` fallback
  satisfies). `AssessmentOverview` additionally receives `disabled={assessmentHydration
  !== "ready"}`, visibly disabling the threshold-preset radios, the custom-threshold
  inputs, the setup-confirmation checkbox/timing-method selector, and the "Start
  Warm-up" button together — a user must not be able to complete an apparently
  functional setup that could only ever end in a silent no-op. Pure navigation that
  neither mutates the Assessment domain nor implies durable workflow progress ("View
  Assessment"/"Resume Assessment" from Landing) remains available, since it depends only
  on the separate, independently-gated preferences hydration below, not on the
  Assessment domain's own hydration state.
- **`AssessScreen.tsx` preferences** — the three preference reads (last threshold preset,
  last custom threshold, show-introduction) are hydrated together, once, by a single
  mount-time effect, rather than by three independent effects/action-time reads, tracked
  by a local `preferencesHydration: "loading" | "ready"` flag. The threshold-preset/
  custom-threshold controls do not render until that settles, closing the
  default-then-correction window entirely. The Assessment entry action itself ("View
  Assessment"/"Resume Assessment"/"Start New Assessment" on `AssessmentLanding`) is also
  disabled while `preferencesHydration === "loading"` — an action that depends on an
  asynchronously-hydrated preference must stay unavailable until that preference settles,
  the same rule as every other domain, applied to a value that isn't itself a
  `DomainHydrationState`-tracked repository. `handleViewAssessment` no longer performs its
  own read; it reads the already-hydrated preference value synchronously — the preferred
  fix per the correction's binding requirements, since it removes the pending-Promise
  supersession risk by construction rather than adding an explicit request-invalidation
  mechanism on top of it — and, as defence in depth, still no-ops if called while
  `preferencesHydration !== "ready"`.

Each domain's gate is independent — one domain being `"loading"`/`"write_protected"` never
disables an unrelated, already-`"ready"` domain's controls.

## 8. Error and read-result model

Two small, application-owned result shapes — one for writes (unchanged from Revision 1),
one for reads (**new in this revision**, correcting Revision 1's unsafe conflation of
normal absence with genuine read failure).

### 8.1 Write result (unchanged)

```typescript
/**
 * The only failure shape any repository write method returns. Never used for absence
 * (a missing key — that is a normal, valid `load*` result, not an error) and never used
 * for malformed or unknown-version data (that remains domain-specific repair/quarantine/
 * discard behavior, Section 3, resolved entirely inside `load*`, which never fails).
 */
type PersistenceWriteError =
  | { kind: "storage_unavailable" }
  | { kind: "quota_exceeded" }
  | { kind: "unknown"; message: string };

type PersistenceWriteResult =
  | { ok: true }
  | { ok: false; error: PersistenceWriteError };
```

Three variants, no more: `quota_exceeded` and `storage_unavailable` are the only two a
caller could reasonably act on differently (e.g. "ask the user to free up space" vs. "show
a persistent, storage-is-broken banner"); `unknown` is the required catch-all so nothing
un-typed ever crosses the boundary.

### 8.2 Read result (three outcomes as of Revision 3)

```typescript
/**
 * The failure shape a read can produce — a strict subset of PersistenceWriteError,
 * since "quota exceeded" has no meaning for a read.
 */
type PersistenceReadError =
  | { kind: "storage_unavailable" }
  | { kind: "unknown"; message: string };

/**
 * The result every repository load* method resolves to. Three top-level outcomes —
 * corrected in Revision 3 from Revision 2's two-outcome shape, which still folded a
 * genuinely absent key together with a real (or malformed-and-repaired) stored value
 * into one `"ready"` status. That folding did not satisfy the requirement that
 * repository contracts distinguish a successful stored value from normal absence, even
 * though it correctly distinguished both from a genuine read failure.
 *
 *   1. `"value"` — something was stored under the key, and is now either that value as
 *      loaded, or the result of applying the domain's existing repair/quarantine/discard
 *      policy to it if it was malformed or an unsupported schema version (Section 3).
 *      A malformed *string* is not the same as a *missing* key — something was there,
 *      it just couldn't be used as-is.
 *   2. `"absent"` — the storage key genuinely does not exist. Carries no value: per
 *      Section 5/7, the caller (hydration owner) initializes that domain's own
 *      documented default directly, the same way current code already does per domain —
 *      this is not a generic "call migrate(null)" step (see Section 5.1's `SessionRepository`
 *      note for why that generic approach would be actively wrong for at least one
 *      domain).
 *   3. `"read_failed"` — a genuine storage-access failure (adapter-level), distinguished
 *      from both of the above by `error.kind`. `fallback` is named differently from
 *      `value` so the type itself documents "display only, never for persistence."
 *
 * Malformed/unknown-schema-version data is always `"value"`, never `"read_failed"` — it
 * is not a raw storage-access failure and must not be treated as one.
 */
type DomainLoadResult<T> =
  | { status: "value"; value: T }
  | { status: "absent" }
  | { status: "read_failed"; fallback: T; error: PersistenceReadError };
```

### 8.3 Classification responsibility

**The `StorageAdapter` — and only the `StorageAdapter` — classifies raw browser
exceptions into either shape.** Section 4.A names the adapter as "the only component that
knows about a specific browser storage mechanism," so the adapter, not each of the seven
repositories, is responsible for recognizing `DOMException`/`QuotaExceededError`/any future
IndexedDB-specific transaction error and translating it into `PersistenceWriteError` (for
`set`) or `PersistenceReadError` (for `get`) before either call ever resolves. A
repository's method simply propagates whatever result shape the adapter produced — **no
repository contains any `instanceof DOMException` check or equivalent.** `DOMException`,
`QuotaExceededError`, and any IndexedDB-specific transaction error type never escape the
`StorageAdapter` (Section 9).

### 8.4 Why reads never reject, but now can still "fail" — and why absence is not a failure

Every `load*` method still **always resolves — it never rejects, for any reason.** This is
unchanged since Revision 1. What changed across revisions is what the result resolves *to*:
Revision 1 resolved every outcome to the domain's plain value (`Promise<T>`), making a
genuine read failure indistinguishable from normal absence; Revision 2 introduced
`DomainLoadResult<T>` but still folded absence and a real/repaired value together as
`"ready"`; Revision 3 (this version) separates all three — `"value"`, `"absent"`, and
`"read_failed"` — so that "the storage key wasn't there" and "storage access itself is
broken" are never conflated, and neither is conflated with "a real or repaired value is
available." This preserves the original goal (hydration always completes deliberately —
Section 7.2, now covering three branches instead of two) while satisfying the explicit
requirement that a successful stored value and normal absence be distinguishable at the
repository contract level, not just at the adapter's raw string layer.

## 9. Adapter and transactions

```typescript
/**
 * The adapter's own, deliberately simpler read result — it represents successful
 * absence as a successful `value: null` (matching `localStorage.getItem`'s own `null`
 * contract exactly), rather than adopting `DomainLoadResult`'s three-way split at this
 * raw, string-only layer. This is a permitted simplification specifically at the
 * adapter boundary: nothing above this layer is allowed to leave the
 * `"value"`/`"absent"` distinction implicit — every repository's `load*` method
 * (Section 5) MUST translate a `{ status: "value", value: null }` result from this
 * adapter into its own explicit `{ status: "absent" }`, never pass `null` upward as if
 * it were a domain value.
 */
type StorageGetResult =
  | { status: "value"; value: string | null }
  | { status: "read_failed"; fallback: null; error: PersistenceReadError };

/**
 * The only component in this design that knows about a specific browser storage
 * mechanism, and the only component that classifies its exceptions (Section 8).
 * Both methods always resolve — neither ever rejects — consistent with each other.
 */
interface StorageAdapter {
  /**
   * `{ status: "value", value: null }` means the key genuinely does not exist (matches
   * `localStorage.getItem`'s `null` exactly) — repositories must translate this to
   * `{ status: "absent" }` (Section 8.2), never treat `null` itself as a domain value.
   * `{ status: "value", value: "..." }` means a string is stored, whatever its content —
   * malformed-JSON handling happens one layer up, in the repository, not here.
   * `{ status: "read_failed", fallback: null, error }` means a genuine storage-layer
   * failure (e.g. a browser blocking storage access entirely) — **corrected from
   * Revision 1**, which had this method reject and be silently treated as `null` by the
   * caller; that conflation is exactly what Revisions 2–3 remove.
   */
  get(key: string): Promise<StorageGetResult>;

  /** Full overwrite, matching `localStorage.setItem`'s existing contract. Resolves once
   * durable per the backend's own guarantee, to `{ ok: true }`. Resolves — never
   * rejects — to `{ ok: false, error }` (`PersistenceWriteError`, Section 8.1) on a
   * genuine failure — including a synchronous `localStorage.setItem` throw (e.g. Safari
   * private-mode `QuotaExceededError`), which the `localStorage` implementation of this
   * interface must catch and convert into that resolved shape, never let propagate as an
   * uncaught synchronous exception. */
  set(key: string, value: string): Promise<PersistenceWriteResult>;
}
```

**These two operations, asynchronous from day one, are sufficient for a behavior-preserving
`localStorage` wrapper.** Confirmed: `localStorage.getItem`/`setItem` are the only two
browser-storage primitives any current code path uses (Section 2's exhaustive grep).

**They provide no multi-key atomicity, and this design does not claim otherwise.**
`get`/`set` operate on exactly one key each. Nothing in this interface, and nothing any
repository built on it, can make two `set` calls succeed-or-fail together. Section 6.3
states plainly what this means for session archiving specifically; no other multi-key
operation exists in the current codebase.

**No `remove` operation was needed for Phase 1 — superseded for identity records by
ADR-0025 (Stage B0.2 identity gate implemented and mounted).** The Phase 1 finding stands as a
historical fact and still describes every **sporting** repository: nothing in the Phase 1
codebase calls `localStorage.removeItem` (Section 2), and every "delete"/"clear" action
there is a full overwrite with a smaller/empty value. Adding an unused capability at that
point would have been speculative, and the condition stated for revisiting it — "if a
future task introduces real key deletion, add `remove` then, with its own review of what
'delete' should mean per domain" — is exactly what has now happened.

Stage B0.2 introduces local **identity** records (a device trust record, an access
barrier, an interactive-authentication attempt, a barrier resolution and a pending
deep-link intent) for which removal is a genuine operation rather than an overwrite.
ADR-0025 therefore adds a **narrowly scoped removable capability that extends — and does
not replace — the minimal `StorageAdapter` contract above**. Two properties hold for every
repository that takes it:

- **removal resolves a typed result and never rejects**, matching the never-throw
  discipline the rest of this section establishes; and
- the concrete `localStorage` adapter implements it, and the rule that direct
  `localStorage` access exists only in that adapter is unchanged.

**Two kinds of removal exist here, and they must not be grouped together.** One is
security-relevant and required; the other is housekeeping whose failure changes nothing.

| Repository | Adapter | Kind of removal |
|---|---|---|
| `identityBarrierRepository` | **base `StorageAdapter` only** | **None.** No code path may remove a current barrier as a security transition — a barrier is superseded by writing a newer one and completed by a separate, per-barrier resolution record |
| `trustedDeviceRepository` | `RemovableStorageAdapter` | **Required** establishment, replacement and removal — but the consequence of a failure differs by case; see the three cases below. Never best-effort |
| `pendingIntentRepository` | `RemovableStorageAdapter` | **Required** deletion on sign-out and account switch. A failure blocks the transition rather than being ignored |
| `identityBarrierResolutionRepository` | `RemovableStorageAdapter` | **Best-effort cleanup of already non-current records only.** Never affects authorization; a failure changes nothing |
| `interactiveAttemptRepository` | `RemovableStorageAdapter` | **Best-effort cleanup of already non-current records only.** Never affects authorization; a failure changes nothing |
| The seven sporting repositories | **base `get`/`set` contract, unchanged** | None; they never delete |

**The trusted-device row covers three different operations, and they fail differently.**
Collapsing them into one rule would state something false about at least one of them:

- **Required establishment, or correlated account replacement, after successful
  authentication.** The provider and server operations **may already have succeeded** —
  authentication, Profile resolution, onboarding and entitlement can all be done. The
  failure is therefore *not* "the transition stopped before a provider call"; it is
  `trusted_state_not_established`, and the consequence is that **no ready state is
  entered**. This case **does not depend on an unresolved invalidation barrier existing**,
  because none is written for it.
- **Removal during explicit sign-out or invitation account recovery.** Required, and the
  barrier was written first. **A failure blocks provider sign-out**, and the
  already-written unresolved barrier remains authoritative.
- **Cleanup during server-driven invalidation.** This occurs **after** immediate in-memory
  denial and an **attempted** invalidation barrier. **If barrier persistence failed,
  removal is the fallback durable denial** rather than a follow-up to it. If both fail, the
  result is **page-lifetime denial only — not durable offline revocation**.

**"Best effort" describes only the two non-current cleanup rows above.** It never describes
required trusted-state or pending-intent removal.

**Where the barrier does the work, it must actually exist.** For the deliberate transitions
(sign-out, invitation recovery) the barrier is written first, so a later removal failure is
safe. That reasoning **does not extend to the case where the barrier write itself failed** —
there, removal is the remaining durable mechanism, and if it also fails the honest
limitation stands: denial holds for the page lifetime and **no durable offline revocation is
claimed**.

**The extended capability is not, and must not be presented as, a solution to multi-key
atomicity.** A plain `remove` still offers no compare-and-delete, which is precisely why
ADR-0025 resolves barriers with a key derived from the barrier's own id instead of
deleting a shared key.

**This interface cannot, by itself, express an IndexedDB transaction.** An IndexedDB
transaction spans a database connection, an explicit set of object stores, and a
commit/abort lifecycle that a bare `get(key)`/`set(key, value)` pair has no way to
represent. This is intentional for Phase 1 (which only wraps `localStorage`, which has no
transactions to expose) and is **not** a gap this interface needs to close now.

**Internal adapter capabilities may later expand without changing the application-facing
repository boundary.** A future IndexedDB-backed `StorageAdapter` implementation may
internally use real transactions, multi-store batches, or cursor-based iteration to fulfill
`get`/`set` (or a later, separately-designed richer interface) — none of that requires any
repository or UI code to change, as long as the repository-facing contract in Section 5
stays satisfied. Any *new* adapter-facing capability (e.g. a genuinely atomic multi-key
write primitive) is a separate, future, explicitly-approved design decision, not
authorized by this document.

## 10. Migration path to IndexedDB (staged; documentation only — retired as the forward production path)

**Retired as the forward production migration path (2026-08-24 revision).** Steps 2-4
below exist to carry the existing unscoped local data forward. That data is disposable
early-test data which Stage B0.3 discards once, explicitly — so there is nothing for a
copy migration or an activation programme to preserve. Step 1's adapter
(`docs/adr/0015-indexeddb-adapter-unwired.md`) remains valid, unwired infrastructure; step
2's mechanism (`docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md`)
remains a historical implemented mechanism, never invoked; steps 3-4
(`docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md`,
`docs/adr/0018-indexeddb-production-activation-fencing-and-outage-policy.md`) remain useful
analyses whose proposed activation programme is no longer the selected path. **Dormant code is not deleted
by that decision.** The rest of this section is retained as the record of what that track
was, not as scheduled work.

**This section covers Phase 2 (IndexedDB) only.** The Phase 1 (`localStorage`-backed
repository boundary, including hydration and testing) sequence is now specified once,
authoritatively, in Section 11 — this section no longer restates or overlaps with it,
resolving an ordering ambiguity in Revision 1 that could be read as permitting
`TrackerApp.tsx` wiring changes (its old step 1) before characterization tests existed
(its old step 2, "before or alongside"). Phase 2 begins only after Section 11's sequence
is complete.

**Revision 6 recorded that step 1 below is now done** — see
`docs/adr/0015-indexeddb-adapter-unwired.md`: `src/lib/persistence/indexedDbAdapter.ts`
implements `StorageAdapter` against a two-store (`records`/`metadata`) IndexedDB
database via the `idb` package, with no repository or domain-logic change, exactly as
step 1 requires. It is not imported or constructed by any repository singleton or
component — `localStorage` remains the sole production source of truth.

**Revision 7 (this version) records that step 2 below is now done, and corrects step
2's own original description** — see
`docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md`. The original text
below ("run it through the *same* existing migration function used today, write the
migrated result into IndexedDB") is superseded: the implemented migration engine
(`src/lib/persistence/localStorageToIndexedDbMigration.ts`) copies each key's **exact
serialized string**, unparsed and unrepaired, specifically to avoid a second
implementation of every domain's existing repair/quarantine/discard policy — see ADR-
0016 Decision 1 for the full reasoning, and its repository-equivalence tests for the
proof that reading the same copied string through each domain's existing repository
produces the same interpreted result regardless of which backend it came from. Per-domain
progress lives in the `metadata` store ADR-0015 reserved for exactly this — never an
11th `localStorage` key, closing the open risk 10.1 flagged below. Steps 3-4 remain
entirely undesigned and unimplemented; this revision does not change either of their
open questions.

1. **Introduce an IndexedDB adapter behind the same `StorageAdapter` interface** (or a
   richer one, per Section 9's "may later expand" note). No repository or domain-logic
   code changes — only a second adapter implementation is added. **Done, unwired** — see
   the note above.
2. **Migrate existing browser data without loss.** For each of the 7 repository-boundary
   domains (10 keys): read each existing `localStorage` value (still present, untouched)
   and copy its exact string into IndexedDB under a per-domain, fail-closed completion
   marker — **not** run through a migration function first (corrected by Revision 7
   above). If a `localStorage` read itself fails (Section 8.2's `"read_failed"`), that
   domain's migration is skipped and retried on a later run, per the same
   write-protection principle as Section 7 — a failed read must never be treated as
   "confirmed nothing to migrate." **Done, unwired** — see the note above. Not yet
   done: anything that actually *calls* this migration engine from the running
   application (an explicit, separate, future wiring decision).
3. **Verify migrated data before considering cleanup of legacy storage.** A separate,
   later step, never an automatic consequence of a successful first read. **Remains
   entirely unresolved.** ADR-0017 Decision 6 designs a *different, related* mechanism —
   verifying freshness immediately before *activation* — and Decision 11 is explicit that
   this is not the same problem as cleanup verification: once a domain is activated, IndexedDB is
   expected to receive new writes with no `localStorage` counterpart, so exact equality
   between the two backends is no longer the right success criterion by the time anyone
   considers deleting legacy data. Do not read ADR-0017 as resolving this step.
4. **Before IndexedDB becomes the authoritative write target, obtain a separately
   approved activation-and-rollback design.** Retaining legacy `localStorage` (step 2) is
   **not, by itself, a safe rollback strategy once the application starts writing new
   data to IndexedDB only** — any record created *after* that cutover exists solely in
   IndexedDB, so rolling back to an older, `localStorage`-only build would make that
   record invisible to the rolled-back build, not merely "unsynced." **A design is now
   proposed but not accepted** (`docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md`,
   status: Proposed, incomplete design): per-domain activation authority computed from
   two independent, fingerprint-bound activation-evidence records (a new per-domain
   `localStorage` witness plus a new IndexedDB `metadata` record, distinct from this
   section's own migration marker) — authority begins only once the IndexedDB evidence
   reaches `"committed"` and matches the witness, never at the earlier `"prepared"` step;
   an authority-aware mutation lease, scoped to one complete logical mutation and
   re-checking current durable evidence under the lock exactly once — immediately before
   that mutation's first write, never independently repeated before a later write within
   the same mutation (not merely a lock excluding concurrent writes, which does not by
   itself stop a *queued* write from later executing against a stale, pre-activation
   backend); a ten-state startup readiness gate, including one explicitly named and
   bounded gap (witness loss coincident with IndexedDB being unreachable resolves
   `localStorage`, accepted as a trade-off rather than a guarantee); and rollback
   reclassified as manual (before any post-activation IndexedDB write, and only as an
   operator-run diagnostic, never automatic), blocked (after — never "switch back to
   stale `localStorage`" treated as a safe rollback), manual-but-conditional (a
   deployment revert), or deferred (storage-corruption data recovery). **ADR-0017 itself
   identifies why it cannot be accepted yet — one bundled prerequisite, not two**: no
   purely client-side mechanism can exclude an application build older than this protocol
   from writing `localStorage` during or after activation, and the same future decision
   that resolves this must also explicitly decide the fate of the startup gate's bounded
   gap above, since that gap's current resolution depends specifically on production
   activation being blocked today. Automatic production activation is blocked on that
   one, combined, separate decision. Still **not implemented, and not resolved** —
   `localStorage` remains the sole production source of truth; see ADR-0017 for the full
   design and its own implementation sequence, most of which is itself gated on that
   still-open prerequisite. **`docs/adr/0018-indexeddb-production-activation-fencing-and-outage-policy.md`
   (Proposed, incomplete design) is the attempted answer to that bundled decision, and
   resolves neither half.** The bounded gap above is narrowed, not closed: a proposed,
   never-(automatically)-deleted `localStorage` Activation Ledger, established as a
   barrier before IndexedDB evidence finalizes (with its own read-back validation), stops
   an ordinary witness loss while IndexedDB is unreachable from being silently misread.
   **It is not self-healing** — nothing repairs an already-established ledger entry that
   is later lost. A whole-`localStorage`-origin wipe removes the ledger together with the
   witness in one action, directly recreating the original ambiguity while IndexedDB is
   unreachable. A targeted deletion of just the ledger entry, with the witness intact,
   does **not** by itself recreate that ambiguity — it only removes this domain's future
   mitigation against a *later*, independent witness loss coincident with IndexedDB being
   unreachable. Ledger corruption is different again: an invalid or unreadable ledger
   fails closed and never silently selects `localStorage`, costing availability, not
   safety. An absent ledger (however it arose) remains a narrowed risk, only for as long
   as the entry stays valid and readable, not proof a domain was never activated.
   Accepting that
   residual, if it happens, would resolve the pending governance decision on row 0b — it
   would not technically eliminate the ambiguity itself. Old-build/tab exclusion remains
   unresolved: ADR-0018 proves that no candidate it evaluated (staged deployment, a
   service worker, a version handshake, `BroadcastChannel`/`storage` events, or Web Locks
   presence detection alone) can make an already-running, non-participating build's
   JavaScript stop writing, and declines to recommend activation on the strength of
   probability, telemetry, or a bake period. ADR-0017 Decision 3 remains blocked as a
   whole, since both bundled halves remain open.

### 10.1 Explicit handling of each required migration risk

- **Interrupted migrations.** Per-domain migration (step 2) must be independently
  retryable: if the browser closes mid-migration after domain #3 but before domain #4,
  the next run must detect that #4 is not yet migrated and migrate it, without
  re-migrating #1-#3 in a way that could duplicate or corrupt already-migrated data.
  **Resolved (Revision 7, ADR-0016):** each domain's target commit is idempotent at the
  IndexedDB-write side via its own fail-closed completion marker, re-checked inside the
  same atomic transaction that writes it — independent of the existing `migrate*`
  functions' own idempotency (ADR-0005), since those functions are never invoked by the
  migration engine at all (Decision 1).
- **Partially migrated domains.** Migration state must be tracked per-domain, not as one
  global boolean — a partial migration is a normal, expected intermediate state.
  **Resolved (Revision 7, ADR-0016):** each domain's marker lives in the `metadata`
  object store ADR-0015 already reserved for exactly this — never an 11th `localStorage`
  key.
- **Malformed JSON.** **Corrected (Revision 7, ADR-0016):** the migration read copies a
  malformed or legacy serialized string unchanged — it never parses it, and never
  degrades it to absent/default itself. Degradation to absent/default (identical to
  today) happens only later, when the existing, unchanged repository hydration logic
  interprets the copied value at read time — never during the copy step, which has no
  interpretation logic of its own at all (Decision 1).
- **Unknown schema versions.** **Corrected (Revision 7, ADR-0016):** the migration
  engine does not evaluate a schema version at all — every value is copied verbatim,
  whatever it contains. Schema-version interpretation happens identically to today only
  later, inside each existing repository's unchanged migration function, for domains
  #4-#7; "unknown version" doesn't apply to domains #1-#3 (unversioned).
- **Duplicate records.** Existing dedup rules (e.g. Assessment migration's `seenIds`
  check, `migration.ts:429-436`) must be preserved, not bypassed, by the migration step —
  they run inside the unchanged `migrate*` functions. Session History has no existing
  dedup rule (Section 6.1) and this migration path does not add one.
- **Stable identifiers.** Already present for every record-like entity — no new ID scheme
  is required (Section 13, decision 5, for the singleton-domain nuance).
- **Timestamps and revisions.** Every record-like entity already carries
  `createdAt`/`updatedAt`. No sync-relevant revision counter exists yet — deferred to the
  future sync layer (Section 12).
- **Data written by an older application version.** Exactly what the existing `migrate*`
  functions already handle; the migration step runs that same function before data ever
  reaches IndexedDB.
- **Downgrade behavior.** As long as step 2's `localStorage` copy is retained and no
  domain has been activated, an older build can keep reading `localStorage` unaffected —
  unchanged by ADR-0017. Once a domain is activated, "downgrade" to an older,
  pre-activation-aware build is the concrete instance of ADR-0017 Decision 3's **named,
  unresolved blocking prerequisite** (old application builds/tabs cannot be excluded from
  writing `localStorage` during or after activation): the older build has no concept of
  the activation-evidence protocol and will simply resume reading/writing `localStorage`
  for that domain, with nothing in the newer code able to reach or coordinate with it.
  ADR-0017 does not close this gap and does not claim to mitigate it with a tripwire or
  any other partial measure — it states plainly that automatic production activation
  remains blocked until a separate, future decision resolves this prerequisite, and does
  not authorize deleting or disabling any older build.
- **Validation before legacy-data deletion.** Required, not optional, and **still fully
  unresolved** — this is not addressed by ADR-0017, which verifies freshness for
  activation only (a different problem, per ADR-0017 Decision 11: once a domain is
  activated, IndexedDB is expected to receive writes with no `localStorage` counterpart,
  so exact equality is no longer the right comparison by the time cleanup is considered).
  This bullet's prior text ("compared against the migrated value") described the
  original, superseded design-doc sketch, not what ADR-0016 actually implements —
  correcting it: ADR-0016's migration engine copies each key's **exact serialized
  string, unparsed and unrepaired**, into IndexedDB (Decision 1 there); no `migrate*`
  function ever runs during that copy. Interpretation/repair through each domain's
  existing `migrate*` function happens only later, when a repository's `load*` method
  reads the copied value during ordinary hydration — identically whichever backend the
  bytes came from. Any future deletion-time validation would therefore need its own,
  separately designed comparison basis; it is not simply "compare against the migrated
  value," since no migrated value exists anywhere in IndexedDB to compare against. The
  exact mechanism remains undecided, and skipping this step before ever deleting a
  `localStorage` key is not authorized.
- **Idempotent retry behavior.** Every migration step must be safe to run again from
  scratch — a second run overwrites with the same result, never duplicates or appends.
- **The `blocks` vs. `blocks: []` distinction.** Unaffected — enforced entirely inside
  `migrateBlocks`, called unchanged by the migration step.
- **The existing field-repair vs. whole-record-discard philosophies.** Both preserved
  unchanged, for the same reason: the migration step always calls each domain's existing
  function, never a new generic one.

## 11. Implementation and testing sequence

**This is the single, authoritative sequence for Phase 1** (the `localStorage`-backed
repository boundary). Revision 1 had two separately numbered lists (an old Section 10
"migration path" starting with `TrackerApp.tsx` wiring, and an old Section 11 "testing
sequence" starting with characterization tests) whose relative order was never stated
explicitly enough to rule out reading them as concurrent or wiring-first. **This revision
states plainly: characterization tests must be written and passing before any production
call site — `TrackerApp.tsx`, `AssessScreen.tsx`, or any other current direct-storage
call site — is touched.** Eight explicitly ordered steps:

1. **Add characterization tests around the existing direct-storage behavior.** Written
   against `TrackerApp.tsx`/`AssessScreen.tsx` **as they exist today** — real component
   tests (React Testing Library, as the existing `TrackerApp.*.test.tsx` suite already
   does), asserting today's actual `localStorage` reads/writes, effect order, and guard
   behavior (including the write-order finding in Section 6.1 and the unguarded-effect
   finding in Section 2.1). These must exist and pass **before step 4** touches any
   production wiring, and they run against the *current* code, before any repository
   exists, capturing the baseline this whole effort must not silently change.
2. **Implement `StorageAdapter`** (Section 9) wrapping `localStorage`, including its
   `DomainLoadResult`/`PersistenceWriteResult`-returning contract (Section 8) and browser-
   exception classification (Section 8.3). No production call site changes yet.
3. **Implement all seven repositories and their contract tests** (Section 5), each calling
   the *existing, unchanged* domain migration functions, each tested per Section 11.9's
   per-domain checklist below. Still no production call site changes — these are new
   modules, not yet wired to `TrackerApp.tsx`/`AssessScreen.tsx`.
4. **Introduce hydration state and repository wiring.** Only now does `TrackerApp.tsx`'s
   direct `localStorage.getItem`/`setItem` call sites get replaced with repository calls,
   wired through the three-state hydration model (Section 7) — this is the first step
   that changes any production call site, and step 1's characterization tests must be
   green immediately beforehand.
5. **Run hydration and integration tests** (Section 7.9) — verifying the three-state
   model, provider-gating, write-protection-after-read-failure, unmount-safety, and
   domain-isolation properties, which have no equivalent in step 1 (today's code has no
   asynchronous hydration to test).
6. **Replace remaining approved direct-storage access** — any call site not already
   covered by step 4 (e.g. `AssessScreen.tsx`'s direct `assessmentPreferences.ts`
   getter/setter calls, replaced with `AssessmentPreferencesRepository` calls).
7. **Add or finalize the architecture-enforcement test** (Section 13, decision 8): a
   static-analysis or lint-based test asserting no file outside the approved
   `StorageAdapter`/repository modules references `localStorage`/`indexedDB` directly.
   Required as part of this implementation task, not an optional later follow-up — not
   built in this documentation-only pass, but its place in the sequence (after wiring
   exists to enforce, before declaring the work done) is fixed here.
8. **Run the full unit and E2E suites** — the existing 833-unit/72-e2e baseline plus every
   test added in steps 1, 3, and 5, plus E2E persistence regressions extending
   `tests/e2e/reload.spec.ts` and `tests/e2e/corrupt-persistence.spec.ts` against the
   repository-backed implementation, confirming step 1's characterized behavior still
   holds end-to-end. Nothing in this sequence is complete until this step is green.

Steps 2–3 introduce no production behavior change (new, unwired modules); step 4 is the
only step with production-behavior risk, which is why steps 1 (characterization) and 3
(contract tests) must both precede it. A future IndexedDB implementation later runs the
*same* step-3 contract tests unmodified, per Section 9's "internal adapter capabilities may
expand" note — that is a Phase 2 activity (Section 10), not part of this eight-step
sequence.

### 11.9 Per-domain coverage checklist (steps 1, 3, 5, 8)

Each domain (all 7 repositories) requires coverage for: a distinct `"value"` result for a
real stored value, a distinct `"absent"` result for a genuinely missing key (asserted as
different from each other — Section 7.9, test 1), a valid round trip, an update, the
domain's actual reset/clear semantics, a malformed payload (asserting `"value"` with the
documented repaired content, never `"absent"` and never `"read_failed"` — Section 7.9,
test 8), current migration behavior (including the `blocks`/`blocks: []` case for domains
#1-#2), an unknown schema version where applicable (#4-#7), isolation from other domains,
failed-write behavior (Section 8.1), and a genuine read failure specifically (asserting
`"read_failed"`, write-protection, and no persisted default — Section 7.9, tests 4-5). At
minimum, dedicated coverage is required for current session, session history, Assessment,
and `HistoryFiltersRepository` (standing in for "settings"), per the task's explicit
requirement — but this applies uniformly to all 7, not just those four, since a boundary
proven correct for 4 of 7 domains is not yet trustworthy for the other 3.

## 12. Future sync compatibility (seam only — not a sync protocol)

**Corrected in the 2026-08-24 revision.** Two of this section's original conclusions are
superseded by `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`
and `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`:

- **Superseded:** "the local repositories are correct for exactly one athlete's
  exactly-one-device local data, with or without an account, and must stay that way", and
  the accountless-use justification for keeping identity out of local persistence entirely.
  **Local persistence becomes Profile-scoped in Stage B0.3.**
- **Superseded:** the framing of a future sync layer as an optional, indefinitely deferred
  capability. A durable outbox and idempotent upload are **required** Stage B0.4
  deliverables, because Free users record offline and their structured raw data belongs in
  the **Free Cloud Core**.

**Still valid, and deliberately unchanged:**

- **The local repository is the immediate operational source for active and offline
  capture; the cloud is the durable authority for an acknowledged record.** (Corrected
  2026-08-24 — the earlier phrasing, "local repositories remain authoritative while
  offline," could be read as licensing an offline local mutation to override a sporting fact
  the server has already acknowledged. It does not.) A device reads and writes locally
  without waiting for the network, and pending unsynced work lives locally and is
  authoritative *for itself* until acknowledged; once the server acknowledges a Free Cloud
  Core record, the cloud holds durable authority for it, and a later offline local edit is a
  change to be uploaded and reconciled under §12.2's conflict policy — never a silent
  overwrite of the acknowledged fact. **A sync layer sits *above* this boundary** (composing
  repository calls the way `TrackerApp.tsx` does today), never inside the adapter. This
  continues ADR-0010's reasoning — "the per-domain local key… make[s] a future sync boundary
  a matter of syncing one more key/collection, not restructuring existing data" — at the
  code-boundary level.
- **Where stable IDs, revisions and sync metadata could live.** Stable IDs already exist
  (§10.1). Sync metadata (last-synced-at, a pending-write flag, a server-assigned revision)
  does **not** exist on any current domain type, and this design still does not add it. The
  natural seam remains a wrapper the sync layer maintains *alongside* (not inside) each
  domain's existing persisted shape — a separate, sync-layer-owned record keyed by the same
  stable ID, not a required field injected into `Session`/`AssessmentRun`. This preserves
  `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §3.6's provider-neutrality
  principle at the persistence-boundary level.
- **Storage concerns stay separate from *authentication*.** No repository or adapter needs
  a concept of a signed-in `UserAccount`, a provider session, or a token. That separation
  survives intact.

**What changes, and where it is designed:**

- **Profile scope, not authentication, enters local persistence (Stage B0.3, implemented).** The scope
  key is `Profile.id` — an application-owned UUID, never the authentication-provider user
  id — so the repositories still never learn anything about the auth provider. Sign-out and
  account switching must immediately hide and lock the previous Profile's local data,
  including any future record pending upload. ADR-0026 resolves the mechanism as an
  immutable adapter namespace per canonical Profile UUID, composed above the unchanged
  repository APIs. A keyed React boundary remounts the sporting application on Profile
  change; no mutable active-scope pointer can retarget a delayed write.
- **The outbox, conflict protocol, idempotency-key scheme, retry schedule, cursor/revision
  protocol and API contract are Stage B0.4** — see
  `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §12.1 (now stated as required
  behaviour with open design questions, no longer as an illustrative sketch) and
  `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §7. Stage B0.4
  additionally requires **real database verification**; TypeScript tests do not verify SQL,
  RLS, grants, triggers or concurrency.
- **The existing unscoped local data is disposable** and is discarded once, explicitly, by
  Stage B0.3's exact ten-key, content-blind retirement — never adopted, claimed, imported or merged. `docs/adr/0019`'s Local Adoption
  is not the forward path.

## 13. Required design decisions

### 1. One repository per persisted domain vs. repositories per larger aggregate

**Resolved: one repository per persisted domain**, defined by cohesive ownership,
lifecycle, migration policy, and consistency needs together (Section 4.A.1) — 7
repositories over 10 keys.

### 2. Shared low-level adapter vs. direct storage logic inside repositories

**Resolved: one shared `StorageAdapter`** (Section 9), with all domain-specific
serialization/validation/migration logic staying inside repositories.

### 3. Where schema validation and migration belong

**Resolved: inside each repository, calling the existing, unchanged domain-specific
migration function** — never inside the `StorageAdapter`, never inside UI.

### 4. How domain-specific repair and discard policies remain explicit

**Resolved: preserved as-is, at the function level**, documented per repository (Section
5) rather than forced into a shared type-level abstraction — still a judgment call worth
revisiting only if a third philosophy emerges.

### 5. Whether stable IDs must be introduced before IndexedDB migration

**Resolved: no new ID scheme is required.** Every record-like entity already has a
`crypto.randomUUID()` `id` field. The singleton root-object domains (current session,
history filters, Assessment root state, each profile-state root) need a fixed, constant
synthetic key rather than a UUID — a naming convention to settle at implementation time,
not a design gap.

### 6. How atomic multi-record operations should be represented

**Resolved for Phase 1: there are none.** Section 6 removes the one candidate
(`archiveCurrentToHistory`) the original draft proposed. No repository method in Phase 1
claims cross-key atomicity. **Partially superseded by `docs/adr/0014-session-archive-write-ordering.md`**:
`SessionRepository.archiveAndReplace` now exists as a composed, cross-key operation, but
it is explicitly *coordinated* (a deliberate write order), not *atomic* — ADR-0014 is
explicit that `localStorage` still cannot provide cross-key atomicity, and documents the
seam a future IndexedDB adapter could use to make the same operation genuinely atomic.
True atomicity remains a future, separately-approved decision, same as before.

### 7. How repository errors should be exposed without coupling the UI to browser APIs

**Resolved: the three-variant `PersistenceWriteError`/`PersistenceWriteResult` shape for
writes, plus the distinct `PersistenceReadError`/`DomainLoadResult<T>` shape for reads**
(Section 8), both classified exclusively by the `StorageAdapter`.

### 8. How to prevent React components from bypassing the persistence boundary

**Resolved: an architecture-enforcement test is required during implementation**
(Section 11, step 7) — no longer an optional, indefinitely-deferred follow-up. The test
itself is not written in this documentation-only pass.

### 9. Whether normal absence, a successful stored value, and a genuine storage read failure may be treated alike

**Resolved: no — all three are explicitly distinct outcomes.** Revision 1 collapsed all
three into one "always resolves to a plain default" read contract. Revision 2 separated
read failure from the other two, but still folded a successful stored value and normal
absence together into one `"ready"` status. Revision 3 (this version) separates all
three: `DomainLoadResult`'s `"value"` status (a real stored value, or the result of the
domain's existing repair/quarantine/discard policy applied to malformed/unsupported
stored data — these two remain undistinguished from each other, since this codebase's
existing migration functions already treat them alike); `"absent"` (the key genuinely
does not exist — the hydration owner, not a migration function, decides what this becomes,
per domain, since at least one domain's migration function would otherwise misinterpret
absence as legacy data, Section 5.1); and `"read_failed"` (a genuine storage-layer
failure), which the hydration design (Section 7) keeps write-protected until a successful
read occurs — never persisting the failure's display-only fallback value. See Section 8.2
for the type and Section 7 for how all three are consumed.

### 10. What must be decided now vs. what should remain deferred

**Decided now** (this document's recommendations): the 7-repository grouping; the
`StorageAdapter` shape; the `Promise`-returning, always-resolving contract for both reads
and writes; the write-error and read-error type shapes and adapter-side classification;
the read/absence distinction (decision 9) and the three-state hydration model that
consumes it; that `localStorage` deletion is never automatic after a first successful
migrated read; that session archiving is not composed into one repository method in
Phase 1; that characterization tests precede production wiring changes (Section 11).

**Explicitly deferred**: ~~per-domain migration-progress tracking's storage location~~
(resolved by `docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md`: the
`metadata` object store ADR-0015 reserved for exactly this); **the exact equality-check
mechanism for pre-deletion validation remains fully unresolved** — it is a different
problem from the activation-time freshness check
`docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md` Decision 6
designs (that check has no bearing on cleanup, per that ADR's own Decision 11); **the
IndexedDB activation-and-rollback mechanism (Section 10, step 4) has a *proposed but not
accepted* design** in ADR-0017 (status: Proposed, incomplete design) — per-domain
authority computed from two independent, fingerprint-bound activation-evidence records (a
new per-domain `localStorage` witness plus a new IndexedDB `metadata` record), with
authority granted only once evidence reaches `"committed"` and matches the witness (never
at the earlier `"prepared"` step — ADR-0017 Decision 4 removed an earlier, incorrect
"self-healing" claim that it was); an authority-aware mutation lease, held per complete
logical mutation and re-checking current durable evidence under the lock exactly once,
immediately before that mutation's first write — never independently repeated before a
later write in the same mutation — rather than a bare per-write lock (ADR-0017 Decision
2, also corrected: a lock alone does not stop a queued write from later executing
against a stale, pre-activation backend once the lock releases); a bounded (at most
two-pass) verification sequence; a ten-state startup readiness gate, including one
explicitly named, bounded gap (ADR-0017 Decision 13, row 0b: witness loss coincident
with IndexedDB being unreachable resolves `localStorage`, an accepted trade-off, not a
guarantee — **explicitly bundled into Decision 3 below, not a second, independent open
question**); and rollback reclassified as manual/blocked/deferred (**never automatic** —
ADR-0017 Decision 10 found the prior "automatic" claim unsound) — but ADR-0017 itself
identifies why it cannot be accepted, as **one combined prerequisite**: no purely
client-side mechanism can exclude an application build older than this protocol from
writing `localStorage` during or after activation, **and** the same future decision must
also decide row 0b's fate, since that row's current resolution depends specifically on
production activation being blocked today — it declares automatic production activation
**blocked** on that one, separate decision (ADR-0017 Decision 3) — not implemented, and
not resolved. **Neither half of that bundled decision is resolved** by
`docs/adr/0018-indexeddb-production-activation-fencing-and-outage-policy.md` (Proposed,
incomplete design). **Row 0b's half is narrowed, not closed**: a proposed
`localStorage`-resident Activation Ledger — corrected there to be established as a
barrier before IndexedDB evidence finalizes, never as a best-effort write after — replaces
the accepted trade-off's silent ambiguity with a mechanism that catches an ordinary
witness loss. It is **not self-healing**: nothing in the design repairs an
already-established ledger entry that is later lost. A whole-`localStorage`-origin wipe
still defeats it directly — the ledger is lost with the witness, in one action, while
IndexedDB's evidence survives, unreachable. A targeted deletion of just the ledger entry,
without the witness being touched, does **not** by itself defeat it — it only removes
this domain's future mitigation against a later, independent witness loss coincident with
IndexedDB being unreachable. Ledger corruption is a third, distinct case: an invalid or
unreadable ledger fails closed and never silently selects `localStorage`, costing
availability rather than safety. An absent ledger (from either deletion or a genuine
whole-origin wipe) remains a narrowed risk, not proof of "never activated." **Old-build/tab
exclusion, the other half,
is not resolved** — ADR-0018 proves no candidate it evaluated
can exclude an already-running, non-participating build's writes, and does not recommend
activation on probability or a bake period alone — so ADR-0017 Decision 3 remains blocked
as a whole, with both halves still open, pending a future explicit decision on each.
**Either future decision, if it accepts the named residual risk, resolves the pending
governance prerequisite — it does not technically eliminate the hazard it accepts**; only
unconditional fail-closed behavior (row 0b) or a genuinely new enforcement mechanism
(old-build exclusion) would do that;
~~a transactional/safer-ordered
session-archive operation~~ (a safer-ordered, coordinated — but not transactional —
operation is now resolved by `docs/adr/0014-session-archive-write-ordering.md`; true
cross-key transactionality remains deferred to whatever future IndexedDB adapter
decision implements Section 6's "seam") and retry deduplication for session archiving
(Section 6.4, still unresolved); any automatic-retry or recovery UX for a
`"write_protected"` domain (Section 7.1) — ADR-0017 Decision 9 confirms this posture
extends unchanged to a gate-withheld or IndexedDB-caused write-protection too; downgrade
behavior once IndexedDB becomes authoritative for a given domain (ADR-0017 Decision 3
names this as the concrete instance of its own named, unresolved, *blocking* prerequisite
— not an accepted residual risk); anything about sync metadata, conflict resolution, or
identity (Section 12).

## 14. Relationship to existing ADRs and documents

- **ADR-0005** (migration is idempotent and never overwrites an existing shot value) is the
  ADR governing the `blocks`/`blocks: []` distinction referenced throughout this document
  and is the primary precedent this design is obligated not to violate.
- **ADR-0010** (Assessment domain foundation) is the direct precedent for per-domain
  `localStorage` keys and explicitly already anticipated a future sync boundary in its own
  "Future cloud considerations" consequence, and its own ID-idempotent archive function
  (`archiveCurrentAssessmentRun`) is the precedent Section 6 explicitly declines to extend
  to Session in this revision.
- **ADR-0012** (Training Plans domain and execution model) is the precedent for
  discard-style migration coexisting with repair-style migration inside a single
  persisted domain, which Section 3 relies on directly.
- **`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §18** defines "Phase 1:
  Persistence boundary" at a one-paragraph level; this document and its companion ADR are
  the detailed design for exactly that phase.
- **ADR-0021** (Assessment draft/history authority-unit split) is a target, accepted-but-
  not-yet-implemented amendment to this document's §2.1 row #4 and §4.A.1's
  `AssessmentRepository` row — see §5.3 above. It resolves ADR-0020 Decision D only; it
  does not change current runtime, and does not touch any other repository or key in this
  inventory.
- **`PERSISTENCE_BOUNDARY_REVIEW_HANDOFF.md`** (repository root, untracked) is the
  product-owner review this revision responds to — see its findings A–J for the full
  evidence trail behind every change in this revision.
- **`PERSISTENCE_BOUNDARY_REVISION_REPORT.md`** (repository root, untracked) records
  exactly what changed between the original draft and Revision 1, for traceability.
- **`PERSISTENCE_BOUNDARY_FINAL_REVIEW.md`** (repository root, untracked) identified the
  read-failure/absence conflation this Revision 2 corrects, and records what changed
  between Revision 1 and Revision 2.
