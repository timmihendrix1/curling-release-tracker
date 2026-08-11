# ADR-0013: Application-owned persistence repository boundary

## Status

Proposed. Not implemented. Requires product-owner review before acceptance. See
`docs/PERSISTENCE_BOUNDARY_DESIGN.md` for the full design this ADR summarizes.

**Revision 1** (this version): responds to the product-owner architecture review recorded
in `PERSISTENCE_BOUNDARY_REVIEW_HANDOFF.md`. The most consequential change: Decision 1
below no longer includes a composed, cross-key session-archiving method — Phase 1 is
strictly behavior-preserving, including today's exact session-archiving write order and
its current lack of deduplication (see the design doc's Section 6). This revision also
adds explicit decisions for hydration safety (5) and the error model (6), neither of which
existed in the original proposal.

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
4. (Added in this revision, from product-owner review) How does making repository reads
   and writes asynchronous avoid introducing new risk — defaults overwriting stored data,
   dropped timing-provider results, or an undisclosed change to session-archiving
   behavior — that today's fully-synchronous code does not have?

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

Introduce one shared `StorageAdapter` interface (`get(key): Promise<string | null>`,
`set(key, value): Promise<void>`) — the only component that knows about a specific browser
storage mechanism, and, per Decision 6, the only component that classifies its exceptions.
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
with the exact mechanism deferred (design doc §10, step 6).

### 5. Hydration must not introduce new risk when reads become asynchronous

Each of the six `TrackerApp`-orchestrated domains (all but `AssessmentPreferencesRepository`,
which needs none) gets a per-domain hydration flag: `false` until the domain's `load*`
call resolves and its state is set, `true` from then on for the rest of the session's
lifetime. Every save effect is gated on its domain's flag; the Timing Simulator's
subscription effect is gated on `sessionHydrated` specifically, so no timing result can be
processed before the session is ready. Every `load*` call always resolves (Decision 6), so
hydration always completes deliberately — absence, malformed data, and a genuine storage
failure all resolve to the domain's documented default rather than leaving hydration
pending. A cancellation guard prevents a late-resolving load from updating state after
unmount. See design doc §7 for the complete mechanism, rationale, and required tests. This
decision exists because it did not exist in the original proposal, and its absence would
have widened an already-latent, currently-negligible risk (defaults overwriting stored
data on the first render; a timing result arriving before `sessionRef` is populated) into
a real one, purely as a side effect of making repository calls asynchronous.

### 6. One small, adapter-classified error model; reads never fail

Every repository write method returns `Promise<PersistenceWriteResult>`, a three-variant
shape (`storage_unavailable` | `quota_exceeded` | `unknown`) — see design doc §8. The
`StorageAdapter`, and only the `StorageAdapter`, translates `DOMException`,
`QuotaExceededError`, and any IndexedDB-specific transaction error into this shape; no
repository contains browser-exception-sniffing logic. Every repository read method
(`load*`) always resolves, never rejects — a genuine storage-layer read failure is treated
identically to "nothing stored," falling back to the domain's own documented absence
value. This decision exists because the original proposal named the error-handling
*pattern* (reuse the existing `Outcome`/`ok`/`err` style) without naming a concrete shape
or assigning classification responsibility, which — if implemented literally — would have
required all seven repositories to duplicate browser-specific exception knowledge,
contradicting this ADR's own stated separation of concerns.

### 7. A future sync layer above local persistence, never direct UI-to-cloud persistence

Local repositories remain the sole source of truth for offline/accountless use, with no
concept of "online," "authenticated," or "pending sync" inside them. A future sync layer,
when built, composes repository calls from above (the way `TrackerApp.tsx` composes them
today) — it does not live inside the repository or adapter layer, and no repository or
adapter gains a dependency on authentication or network state as part of this decision.
Cloud identity fields (`userId`, `ownerId`, etc.) are explicitly not added to any local
domain type by this decision — doing so now would violate the accountless-use guarantee
(`docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`, "Local-first is a current feature, not a
placeholder") for a capability that may not ship for a long time.

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
  under-specified error-handling recommendation).** Rejected in this revision: it would
  duplicate browser-specific knowledge across all seven repositories and contradict the
  adapter's role as the sole component aware of the underlying storage mechanism.
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
- Six new per-domain hydration flags and their accompanying save-effect guards are
  introduced (Decision 5) — this generalizes a guard that already exists, ad hoc, for 2 of
  7 domains today, to all 6 relevant domains uniformly. This closes a real, currently
  latent (synchronous-code-only) risk; it does not change any domain's steady-state
  persisted value.
- A contract-test suite, staged explicitly (design doc §11), becomes required
  infrastructure before or alongside the `TrackerApp.tsx` call-site replacement.
- An architecture-enforcement test against unapproved direct storage access is required
  during implementation (design doc §11, stage 6) — no longer an optional, indefinitely
  deferred follow-up, per binding product-owner decision.
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
   (design doc §10, step 6).
5. Anything about sync metadata, conflict resolution, revisions, or identity — explicitly
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
