# ADR-0013: Application-owned persistence repository boundary

## Status

**Superseded in part (2026-08-24) by `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`.**
This ADR remains **Accepted and Implemented** for the application-owned repository
boundary, hydration safety, provider-neutral domain types, and the storage abstraction.
**Superseded:** its accountless-use guarantee, and Decision 7's conclusion that identity
must not scope local persistence. Identity is now mandatory, and **local persistence
becomes Profile-scoped in Stage B0.3** (`Profile.id`, an application-owned UUID — the
repositories still never learn anything about the authentication provider). Decision 7's
other conclusions — that a sync layer composes repository calls from *above* the boundary,
and that provider identifiers never become core sporting concepts — stand unchanged. See
`docs/PERSISTENCE_BOUNDARY_DESIGN.md` §12 for the corrected seam.

Accepted. Implemented. Accepted by the product owner following review of
`PERSISTENCE_BOUNDARY_ACCEPTANCE_REPORT.md`. See `docs/PERSISTENCE_BOUNDARY_DESIGN.md`
for the full design this ADR summarizes. Phase 1 was implemented on
`feature/persistence-boundary-phase-1` (commit
`refactor(persistence): introduce application repository boundary`): the
`StorageAdapter`, all seven repositories, the three-state hydration model, and
`TrackerApp.tsx`'s wiring all exist exactly as designed below — see
`docs/SYSTEM_ARCHITECTURE.md`'s "Persistence boundary" section for the as-built summary.
IndexedDB, cloud sync, and the other Phase 2+ items in design doc §10 remain
unimplemented.

**Implementation-note correction:** `PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md` found that the
initial implementation correctly gated every domain's *save effect* (Decision 5) but left
the *interaction boundary* itself (the mutating UI controls, and `AssessScreen.tsx`'s
preference reads) ungated for History Filters, Training Plans, Accuracy Tolerance
Profiles, Smart Random Profiles, and the Assess preference controls — a delayed load
could still silently overwrite a user's in-session action even though it could never be
persisted. A follow-up correction commit closed this by extending Decision 5's
readiness model to the interaction boundary (design doc §7.10) — see
`PERSISTENCE_BOUNDARY_PHASE1_CORRECTION_REPORT.md` for the full record. This does not
change Decision 5 itself, any repository/adapter contract, or any storage key/shape; it
completes this ADR's own stated requirement ("a delayed hydration result must not
silently overwrite a user action performed after mount") at the layer the original
implementation had not yet reached.

**Second implementation-note correction:** external review of that same correction
commit found the readiness rule had been applied inconsistently rather than uniformly:
History Filters was left interactive-but-non-persisting after `"write_protected"` instead
of visibly disabled like every other domain; Session's and Assessment's controls relied
on handler-level no-ops alone after a read failure, with nothing visibly disabled; and
`AssessScreen`'s entry action could still decide navigation using its preference's
initial in-memory default before that preference's own hydration had settled, merely
because the decision itself was synchronous rather than because it was gated on
readiness. A second follow-up correction commit closed all three, removing the
History Filters exception, adding visible `disabled` states to Session's and
Assessment's reachable mutating controls, and gating the Assessment entry action on the
preference-hydration flag — see `PERSISTENCE_BOUNDARY_PHASE1_FINAL_CORRECTION_REPORT.md`
for the full record. Still no change to Decision 5, any repository/adapter contract, or
any storage key/shape.

**Revision 1** responded to the product-owner architecture review recorded in
`PERSISTENCE_BOUNDARY_REVIEW_HANDOFF.md`: Decision 1 was revised to no longer include a
composed, cross-key session-archiving method — Phase 1 is strictly behavior-preserving,
including today's exact session-archiving write order and its current lack of
deduplication (design doc §6) — and Decisions 5 (hydration safety) and 6 (error model)
were added.

**Revision 2** corrected an unsafe conflation identified in
`PERSISTENCE_BOUNDARY_FINAL_REVIEW.md`: Revision 1's Decision 6 treated a genuine storage
read failure identically to normal absence, which — combined with Decision 5's
then-boolean hydration flag — would have let default state be persisted over already-
stored data once hydration "completed," even when it completed via a failed read. That
revision's read-result type still folded a successful stored value and normal absence
together into one status, only separating both from a genuine read failure.

**Revision 3** (this version) splits that remaining fold, per
`PERSISTENCE_BOUNDARY_ACCEPTANCE_REPORT.md`: the read-result type in Decision 6 now has
three top-level outcomes — `"value"`, `"absent"`, and `"read_failed"` — and every
repository's `load*` method contract (design doc §5) documents all three explicitly.

## Context

The app currently persists 10 distinct `localStorage` keys across 7 architecturally
independent domains (current session, session history, history filters, Assessment,
Training Plans, Accuracy Tolerance Profiles, Smart Random Profiles, and three small
Assessment UI preferences) — see `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §2 for the full,
re-verified inventory. Every domain's read/write call site talks to `localStorage`
directly (mostly from `TrackerApp.tsx`'s one-effect-per-key pattern), and every domain has
its own, independently-evolved migration/validation function.

`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §18 names "Phase 1: Persistence
boundary" as the step immediately after the Phase 0 local-first alpha release
(`v0.1.0-local-first-alpha`, commit `dfd06cb`): introduce repository/persistence
interfaces around the existing storage, with no visible behavior change, before an
IndexedDB migration (Phase 2) or any cloud/sync work (Phase 3+) is attempted. Questions
that had to be settled before that phase could be designed:

1. Does a persistence boundary replace the existing 7 independently-evolved domains with
   one generic storage interface, or preserve their independence?
2. Where does the line sit between "generic storage mechanism" and "domain-specific
   migration/validation" — i.e., what is actually shared, and what must not be?
3. What is the smallest seam that keeps a future sync layer possible later without
   designing that layer, or leaking cloud/identity concepts into local domain types, now?
4. (Added in Revision 1, from product-owner review) How does making repository reads
   and writes asynchronous avoid introducing new risk — defaults overwriting stored data,
   dropped timing-provider results, or an undisclosed change to session-archiving
   behavior — that today's fully-synchronous code does not have?
5. (Added in this revision) How does the design avoid a *narrower* version of the same
   problem — a genuine storage read failure being treated as if it were normal absence,
   letting the application initialize and later persist default state over data that was
   never actually confirmed missing?

## Decision

### 1. Domain-facing, application-owned repository boundaries — one per persisted domain

Introduce 7 repository interfaces (`SessionRepository`, `HistoryFiltersRepository`,
`AssessmentRepository`, `TrainingPlansRepository`, `AccuracyToleranceProfilesRepository`,
`SmartRandomProfilesRepository`, `AssessmentPreferencesRepository`), each owning the keys
listed in the design doc's §4.A.1 grouping table, each calling its domain's existing,
unchanged migration/validation function. No repository is a generic CRUD interface — each
exposes domain-shaped operations. All seven are fully specified (design doc §5), not just
illustrated by example — this revision closes a gap in the original proposal, which fully
specified only two of the seven.

Why not fewer, larger repositories: this codebase has already rejected a shared/merged
persistence root twice, explicitly, for the same reason each time (ADR-0010 Decision 2:
rejecting a shared Session+Assessment root; ADR-0012: keeping Training Plans independent
of Session). A persistence-boundary design that consolidated further would contradict
decisions already made and justified elsewhere in this codebase.

Why not one repository per literal key (10, not 7): each grouping is justified by cohesive
ownership, lifecycle, migration policy, and consistency needs together (design doc
§4.A.1), not by a composed atomic operation. In particular, `SessionRepository` owning
both the current-session and session-history keys is justified because both hold the same
entity type (`Session`) migrated by the same function family — **not**, as the original
proposal stated, because it exposes a single atomic archiving method; see Decision 2 for
why that method is removed. `AssessmentPreferencesRepository` groups three small,
independently-stored preference keys under one file-level concern for code organization
only (design doc §4.A.2) — it does not merge their storage keys or shapes.

### 2. Session archiving is not composed into one repository method in Phase 1

**This revises the original proposal.** `SessionRepository` exposes only
`loadCurrent`/`saveCurrent`/`loadHistory`/`saveHistory` (design doc §5.1) — there is no
`archiveCurrentToHistory` or equivalent composed method. The application layer continues
to decide whether to archive, construct the next session and next history array, and call
`saveCurrent` then `saveHistory` in that order — preserving today's real, verified write
order (current-session write before session-history write, per effect declaration order
at `TrackerApp.tsx:902-909` and `:918-923`) and today's real, verified lack of
ID-based deduplication for session-history entries (design doc §6.1). Both were
misrepresented in the original proposal, which claimed the opposite write order as a
safety "guarantee" without disclosing that it reversed current behavior. Phase 1 must not
make that change, disclosed or not, without its own separate decision (design doc §6.4).

### 3. An initial `localStorage` adapter preserving current behavior exactly

Introduce one shared `StorageAdapter` interface (`get(key): Promise<StorageGetResult>`,
`set(key, value): Promise<PersistenceWriteResult>`) — the only component that knows about
a specific browser storage mechanism, and, per Decision 6, the only component that
classifies its exceptions. The adapter's own read result may represent successful absence
as a successful `value: null` (design doc §9) — a permitted simplification at this raw,
string-only layer — but every repository built on it must translate that into its own
explicit `"absent"` outcome (Decision 6); nothing above the adapter is allowed to treat
`null` as if it were a domain value.
Its first implementation wraps `localStorage` directly, synchronously under the hood, but
returns `Promise`s from day one so no caller-visible signature change is needed when a
second implementation is introduced later. `remove` is deliberately omitted — no code
anywhere in the app calls `localStorage.removeItem` today, and adding an unused capability
now would be speculative. This interface provides no multi-key atomicity and cannot, by
itself, express an IndexedDB transaction — both stated explicitly, not left implicit
(design doc §9).

All serialization, schema validation, and migration/quarantine/repair logic stays inside
repositories, calling each domain's existing function unchanged — never inside the
adapter. This preserves, rather than unifies, the two migration philosophies that already
coexist in this codebase (field-by-field repair for Session/Session History/History
Filters; root-schema-version-gated quarantine-or-wipe for Assessment/Training
Plans/Accuracy Tolerance Profiles/Smart Random Profiles) and even the fact that both
philosophies coexist *inside* the single current-session key (`Session.planExecution`
uses discard-style migration per ADR-0012 Decision 4, while the rest of `Session` uses
repair-style).

### 4. A later IndexedDB adapter behind the same boundary, with an explicit activation gate

A second `StorageAdapter` implementation, added later, targets IndexedDB. No repository or
domain-logic code changes when this happens — only the adapter passed to each repository
changes. Migrating existing browser data is staged explicitly (design doc §10): per-domain,
idempotently retryable, running each domain's existing migration function before data ever
reaches IndexedDB, and never deleting the `localStorage` copy automatically after a first
successful read. **This revision adds an explicit gate**: retaining `localStorage` is not,
by itself, a safe rollback once the application begins writing new data to IndexedDB only
— a separately approved activation-and-rollback design is required before that cutover,
with the exact mechanism deferred (design doc §10, step 4).

### 5. Hydration uses three explicit states, not one boolean — writes require success, not merely settling

Each of the six `TrackerApp`-orchestrated domains (all but
`AssessmentPreferencesRepository`, which needs none) tracks a per-domain
`DomainHydrationState`: `"loading"` until the domain's `load*` call resolves; `"ready"` if
it resolved `{ status: "value" }` or `{ status: "absent" }` (Decision 6) — a real/repaired
stored value and normal absence are both safe-to-persist, and the hydration owner
initializes each domain's own documented default specifically on `"absent"`, never via a
generic migration call (design doc §5.1's `Session`/Legacy-Block note); `"write_protected"`
if it resolved `{ status: "read_failed" }`. Every save effect is gated on
`state === "ready"` **specifically** — not merely "no longer loading." The Timing
Simulator's subscription effect is gated the same way: it may start once
`SessionRepository.loadCurrent()` resolved `"value"` or `"absent"`, and must stay inactive
after `"read_failed"`. A cancellation guard prevents a late-resolving load from updating
state after unmount, regardless of which of the three outcomes it would have set. See
design doc §7 for the complete mechanism, rationale, and required tests.

This decision did not exist in the original proposal (a gap Revision 1 closed), and in
its first two forms still risked conflating outcomes that must stay distinct — Revision 1
conflated read failure with success entirely; Revision 2 conflated a real value with
absence (Decision 6 explains why that second conflation also mattered). This revision's
`"write_protected"` state never has its save effect enabled, so a display-only fallback
value is never persisted merely because the domain finished attempting to load, and its
`"ready"` state is only reached via the two outcomes the design doc's Section 5 documents,
per domain, as actually safe to persist.

### 6. Read result has three outcomes; writes have their own, separate error shape

Every repository write method returns `Promise<PersistenceWriteResult>`, a three-variant
error shape (`storage_unavailable` | `quota_exceeded` | `unknown`) — see design doc §8.1,
unchanged since Revision 1. Every repository read method (`load*`) returns
`Promise<DomainLoadResult<T>>` (design doc §8.2) — corrected across two revisions from
Revision 1's bare `Promise<T>`:

```typescript
type DomainLoadResult<T> =
  | { status: "value"; value: T }
  | { status: "absent" }
  | { status: "read_failed"; fallback: T; error: PersistenceReadError };
```

`"value"` covers a real stored value and any repaired/quarantined/discarded result of the
domain's existing policy applied to malformed or unsupported stored data — these two
remain undistinguished from each other, exactly as today's migration functions already
treat them. `"absent"` — **new in this revision** — is now separate from `"value"`: the
storage key genuinely does not exist, and carries no value at all, because (design doc
§5.1) at least one domain's migration function would misinterpret a bare "nothing here"
input as legacy data requiring fabrication, so the hydration owner, not a generic
repair pass, must decide what "never stored" becomes, per domain. `"read_failed"` (added
in Revision 2) remains the one outcome requiring write-protection (Decision 5). `load*`
still never rejects — every one of the three outcomes is a resolved value, never a thrown
exception. The `StorageAdapter`, and only the `StorageAdapter`, translates `DOMException`,
`QuotaExceededError`, and any IndexedDB-specific transaction error into either result
shape; no repository contains browser-exception-sniffing logic.

Revision 1's form of this decision ("reads never fail," folding everything into one
success value) is exactly what the product-owner review identified as unsafe. Revision 2's
form fixed the read-failure conflation but left a narrower one: it did not satisfy the
explicit requirement that repository contracts distinguish a successful stored value from
normal absence, which made per-method absence semantics less precise than required. This
revision's three-outcome read result, combined with Decision 5's three-state hydration,
closes both gaps while preserving the original goal (no `DOMException`/
`QuotaExceededError`/IndexedDB-specific error ever reaches a repository or the UI, and no
repository duplicates browser-specific exception knowledge).

### 7. A future sync layer above local persistence, never direct UI-to-cloud persistence

Local repositories remain the sole source of truth for offline/accountless use, with no
concept of "online," "authenticated," or "pending sync" inside them. A future sync layer,
when built, composes repository calls from above (the way `TrackerApp.tsx` composes them
today) — it does not live inside the repository or adapter layer, and no repository or
adapter gains a dependency on authentication or network state as part of this decision.
Cloud identity fields (`userId`, `ownerId`, etc.) are explicitly not added to any local
domain type by this decision — doing so now would violate the accountless-use guarantee
(then `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`, "Local-first is a current feature, not a
placeholder"; that section is now "Local-first means offline-capable after authenticated
onboarding") for a capability that may not ship for a long time. **This specific reasoning
is superseded — see Status.**

## Alternatives Considered

- **One generic `Repository<T>` interface for all 10 keys.** Rejected: the migration
  philosophies already have genuinely different call shapes, and several domains need
  domain-shaped operations a generic CRUD interface can't express without leaking that
  shape back out to callers anyway.
- **A composed `archiveCurrentToHistory` repository method (the original proposal).**
  Rejected in this revision by explicit product-owner decision: Phase 1 must be strictly
  behavior-preserving, and the composed method's proposed ordering silently reversed
  today's real write order without disclosing that as a behavior change. A transactional
  or safer-ordered archive operation remains available as a separate, future, explicitly
  approved decision (design doc §6.4) — this ADR does not foreclose it, only defers it.
- **Repository-level browser-exception classification (implied by the original proposal's
  under-specified error-handling recommendation).** Rejected: it would duplicate
  browser-specific knowledge across all seven repositories and contradict the adapter's
  role as the sole component aware of the underlying storage mechanism.
- **Treating a genuine read failure identically to normal absence (Revision 1's
  approach).** Rejected: it lets default state be initialized and later persisted over
  data that was never actually confirmed missing, purely because a read attempt failed
  rather than genuinely finding nothing.
- **Folding a real (or repaired) stored value together with normal absence into one
  status, distinguished only from read failure (Revision 2's approach).** Rejected in
  this revision: it did not satisfy the requirement that repository contracts distinguish
  a successful stored value from normal absence, and made per-method absence semantics
  (e.g. exactly which default a caller should initialize) less explicit than required. The
  three-outcome read result (Decision 6) replaces it.
- **Designing automatic retry or recovery UX for a `"write_protected"` domain now.**
  Rejected for this pass: no current code has automatic-retry behavior for anything, and
  introducing one here would exceed this ADR's scope. Write-protection itself is
  mandatory; retry/recovery UX remains a deferred, future implementation decision (design
  doc §7.1, §7.5).
- **Merge the three `assessmentPreferences.ts` keys into one JSON object under one key.**
  Rejected: the task constraints explicitly forbid changing any existing `localStorage`
  key or stored shape; this ADR only proposes a code-organization grouping, not a
  storage-shape change.
- **Skip the `localStorage`-backed repository stage and go straight to IndexedDB.**
  Rejected: it would conflate "introduce a boundary with zero behavior change" with
  "change the storage backend," making it much harder to isolate a regression to one
  cause if something breaks.
- **Add sync metadata (revision, last-synced-at) to domain types now, in anticipation of
  sync.** Rejected: premature per `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`
  §3.6 ("domain concepts remain provider-neutral") — dead weight for every accountless
  user until a sync layer actually exists to use it.

## Consequences

- `TrackerApp.tsx`'s direct `localStorage.getItem`/`setItem` call sites (currently the only
  component with any raw storage access, across all 10 keys) become the concrete
  implementation-phase change list — replaced by repository calls, wired through the
  hydration design (Decision 5), with zero other visible behavior change as the explicit
  acceptance criterion.
- Every existing migration/validation function is reused unchanged; none are rewritten,
  replaced, or merged by this decision.
- Six new per-domain `DomainHydrationState` values and their accompanying save-effect
  guards are introduced (Decision 5) — this generalizes a guard that already exists, ad
  hoc, for 2 of 7 domains today, to all 6 relevant domains uniformly, and is strictly
  narrower than a boolean guard would be (it also blocks writes for a domain that
  finished loading via failure, not just one still loading). This closes a real,
  currently latent (synchronous-code-only) risk; it does not change any domain's
  steady-state persisted value on the success path.
- A contract-test suite, staged explicitly (design doc §11) with characterization tests
  required to precede any production wiring change, becomes required infrastructure
  before the `TrackerApp.tsx` call-site replacement — not "before or alongside," which
  Revision 1 left ambiguous.
- An architecture-enforcement test against unapproved direct storage access is required
  during implementation (design doc §11, step 7) — no longer an optional, indefinitely
  deferred follow-up, per binding product-owner decision.
- A domain that experiences a genuine read failure remains write-protected for the
  remainder of the session unless a future, separately-designed retry mechanism changes
  that — this ADR does not authorize any automatic retry.
- **Migration impact on existing data: none in this pass.** No key, shape, or migration
  rule changes; this ADR only introduces a new code-organization boundary around access to
  already-existing keys, plus the hydration-safety guard described above.
- **Session archiving's known risk window is explicitly not fixed by this decision**
  (design doc §6.3) — the same partial-failure risk that exists today (an interruption
  between the current-session write and the session-history write) is preserved, not
  resolved, pending a separate future decision.
- **Future cloud considerations:** continues ADR-0010's own stated reasoning ("the
  per-domain local key… make[s] a future sync boundary a matter of syncing one more
  key/collection, not restructuring existing data") one level further, at the code
  boundary rather than just the storage-key level.

## Migration implications

None for existing user data (see Consequences). The staged migration path to IndexedDB
(design doc §10) is a future implementation concern, not something this ADR performs. This
ADR does authorize, in a later task, replacing `TrackerApp.tsx`'s direct storage calls with
repository calls — that replacement must ship with the hydration design (Decision 5), the
architecture-enforcement test (Consequences), and contract tests proving no other behavior
change, per `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §19's Definition of
Ready.

## Unresolved questions

See `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §13 for the full list with reasoning. Summarized:

1. A transactional or safer-ordered session-archiving operation, and retry-safe
   deduplication for it — explicitly deferred to a separate, future, product-owner-approved
   decision (design doc §6.4), not resolved by this ADR.
2. Where per-domain migration-progress state lives during the future IndexedDB migration
   (must not become an undecided 11th `localStorage` key).
3. The exact pre-deletion validation/equality-check mechanism for the future legacy-data
   cleanup step.
4. The exact IndexedDB activation-and-rollback mechanism (dual-write, feature-flagged
   cutover, or otherwise) required before IndexedDB becomes the authoritative write target
   (design doc §10, step 4).
5. Any automatic-retry or recovery UX for a `"write_protected"` domain — mandatory
   write-protection itself is resolved by this ADR (Decision 5); what, if anything,
   automatically retries a failed read is not.
6. Anything about sync metadata, conflict resolution, revisions, or identity — explicitly
   out of scope for this ADR and deferred to the cloud/login spike
   (`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §17.1).

## Relationship to existing ADRs

- **ADR-0005** (migration is idempotent and never overwrites an existing shot value) governs
  the `blocks`/`blocks: []` distinction this ADR's repository boundary must preserve
  unchanged — no repository method in this design re-implements or re-interprets that
  check; each calls `migrateSession` exactly as it exists today.
- **ADR-0010** (Assessment domain foundation) is the direct precedent for per-domain
  `localStorage` keys and already anticipated this ADR's Decision 7 in its own "Future
  cloud considerations" consequence. Its `archiveCurrentAssessmentRun` function is also
  the precedent this ADR explicitly declines to extend to `Session` in this revision
  (Decision 2) — a deliberate, disclosed choice, not an oversight of the precedent's
  existence.
- **ADR-0012** (Training Plans domain and execution model) is the precedent for two
  migration philosophies coexisting inside a single persisted domain, which this ADR's
  Decision 3 relies on directly (`SessionRepository` must not force `Session.planExecution`
  onto Session's repair-style migration, or vice versa).
