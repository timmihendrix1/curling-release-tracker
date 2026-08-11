# ADR-0013: Application-owned persistence repository boundary

## Status

Proposed. Not implemented. Requires product-owner review before acceptance. See
`docs/PERSISTENCE_BOUNDARY_DESIGN.md` for the full design this ADR summarizes.

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
IndexedDB migration (Phase 2) or any cloud/sync work (Phase 3+) is attempted. Three
questions had to be settled before that phase could be designed:

1. Does a persistence boundary replace the existing 7 independently-evolved domains with
   one generic storage interface, or preserve their independence?
2. Where does the line sit between "generic storage mechanism" and "domain-specific
   migration/validation" — i.e., what is actually shared, and what must not be?
3. What is the smallest seam that keeps a future sync layer possible later without
   designing that layer, or leaking cloud/identity concepts into local domain types, now?

## Decision

### 1. Domain-facing, application-owned repository boundaries — one per persisted domain

Introduce 7 repository interfaces (`SessionRepository`, `HistoryFiltersRepository`,
`AssessmentRepository`, `TrainingPlansRepository`, `AccuracyToleranceProfilesRepository`,
`SmartRandomProfilesRepository`, `AssessmentPreferencesRepository`), each owning the keys
listed in the design doc's §4.A.1 grouping table, each calling its domain's existing,
unchanged migration/validation function. No repository is a generic CRUD interface — each
exposes domain-shaped operations (e.g. `SessionRepository.archiveCurrentToHistory(...)`,
not a generic `save(key, value)`).

Why not fewer, larger repositories: this codebase has already rejected a shared/merged
persistence root twice, explicitly, for the same reason each time (ADR-0010 Decision 2:
rejecting a shared Session+Assessment root; ADR-0012: keeping Training Plans independent
of Session). A persistence-boundary design that consolidated further would contradict
decisions already made and justified elsewhere in this codebase.

Why not one repository per literal key (10, not 7): `SessionRepository` owns both the
current-session and session-history keys because "Start New Session" is one conceptual,
cross-key operation (archiving one into the other) that should be represented as one
repository method, not coordinated by caller code across two independent repositories.
`AssessmentPreferencesRepository` groups three small, currently-uncoordinated preference
keys under one file-level concern for code organization only — it does not merge their
storage keys or shapes.

### 2. An initial `localStorage` adapter preserving current behavior exactly

Introduce one shared `StorageAdapter` interface (`get(key): Promise<string | null>`,
`set(key, value): Promise<void>`) — the only component that knows about a specific browser
storage mechanism. Its first implementation wraps `localStorage` directly, synchronously
under the hood, but returns `Promise`s from day one so no caller-visible signature change
is needed when a second implementation is introduced later. `remove` is deliberately
omitted from this interface — no code anywhere in the app calls `localStorage.removeItem`
today (every "delete"/"clear" action is an in-memory state reset that rewrites the same
key with a smaller/empty value), and adding an unused capability now would be speculative.

All serialization, schema validation, and migration/quarantine/repair logic stays inside
repositories, calling each domain's existing function unchanged — never inside the
adapter. This preserves, rather than unifies, the two migration philosophies that already
coexist in this codebase (field-by-field repair for Session/Session History/History
Filters; root-schema-version-gated quarantine-or-wipe for Assessment/Training
Plans/Accuracy Tolerance Profiles/Smart Random Profiles) and even the fact that both
philosophies coexist *inside* the single current-session key (`Session.planExecution`
uses discard-style migration per ADR-0012 Decision 4, while the rest of `Session` uses
repair-style).

### 3. A later IndexedDB adapter behind the same boundary

A second `StorageAdapter` implementation, added later, targets IndexedDB. No repository or
domain-logic code changes when this happens — only the adapter passed to each repository
changes. Migrating existing browser data is staged explicitly (design doc §6): per-domain,
idempotently retryable, running each domain's existing migration function before data ever
reaches IndexedDB, and never deleting the `localStorage` copy automatically after a first
successful read — legacy-data cleanup is its own, later, explicitly-reviewed decision.

### 4. A future sync layer above local persistence, never direct UI-to-cloud persistence

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

- **One generic `Repository<T>` interface for all 10 keys.** Rejected: the two migration
  philosophies (repair vs. quarantine) already have genuinely different call shapes, and
  several domains (Session, Assessment) need domain-shaped multi-key operations a generic
  CRUD interface can't express without leaking that shape back out to callers anyway.
- **Merge the three `assessmentPreferences.ts` keys into one JSON object under one key.**
  Rejected for this pass: the task constraints explicitly forbid changing any existing
  `localStorage` key or stored shape; this ADR only proposes a code-organization grouping
  (one repository, three still-independent reads/writes), not a storage-shape change.
- **Skip the `localStorage`-backed repository stage and go straight to IndexedDB.**
  Rejected: it would conflate "introduce a boundary with zero behavior change" (provable
  by contract tests run against the same adapter interface, old and new) with "change the
  storage backend," making it much harder to isolate a regression to one cause if
  something breaks.
- **Add sync metadata (revision, last-synced-at) to domain types now, in anticipation of
  sync.** Rejected: premature per `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`
  §3.6 ("domain concepts remain provider-neutral") — dead weight for every accountless
  user until a sync layer actually exists to use it.

## Consequences

- `TrackerApp.tsx`'s direct `localStorage.getItem`/`setItem` call sites (currently the only
  component with any raw storage access, across all 10 keys) become the concrete
  implementation-phase change list — replaced by repository calls, with zero other
  behavior change as the explicit acceptance criterion.
- Every existing migration/validation function (`migrateSession`,
  `migrateAssessmentPersistedState`, `migrateTrainingPlans`, etc.) is reused unchanged;
  none are rewritten, replaced, or merged by this decision.
- A contract-test suite (design doc §8) becomes required infrastructure before or
  alongside the `TrackerApp.tsx` call-site replacement, so behavioral equivalence between
  "direct localStorage" and "via repository" is proven, not assumed.
- **Migration impact on existing data: none in this pass.** No key, shape, or migration
  rule changes; this ADR only introduces a new code-organization boundary around access to
  already-existing keys.
- **Future cloud considerations:** continues ADR-0010's own stated reasoning ("the
  per-domain local key… make[s] a future sync boundary a matter of syncing one more
  key/collection, not restructuring existing data") one level further, at the code
  boundary rather than just the storage-key level.
- **Known limitation, not solved by this decision:** the write-order convention for
  cross-key atomic operations (e.g. `SessionRepository.archiveCurrentToHistory`) in the
  `localStorage` phase specifically is flagged as an open question in the design doc, not
  resolved here — true atomicity is only available once an IndexedDB-backed adapter can
  offer real transactions.

## Migration implications

None for existing user data (see Consequences). The staged migration path itself (design
doc §6) is a future implementation concern, not something this ADR performs. This ADR
does authorize, in a later task, replacing `TrackerApp.tsx`'s direct storage calls with
repository calls — that replacement must ship with contract tests proving no behavior
change, per `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §19's Definition of
Ready.

## Unresolved questions

See `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §9 for the full list with reasoning. Summarized:

1. Whether a write-order convention for multi-key atomic repository operations is worth
   implementing in the `localStorage` phase, or should wait for IndexedDB transactions.
2. Where per-domain migration-progress state lives during the future IndexedDB migration
   (must not become an undecided 11th `localStorage` key).
3. The exact pre-deletion validation/equality-check mechanism for the future legacy-data
   cleanup step.
4. Whether/when to add ESLint enforcement preventing components from bypassing repositories
   (recommended as a later, separately-approved task — not a lint-config change made now).
5. Anything about sync metadata, conflict resolution, revisions, or identity — explicitly
   out of scope for this ADR and deferred to the cloud/login spike
   (`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §17.1).

## Relationship to existing ADRs

- **ADR-0005** (migration is idempotent and never overwrites an existing shot value) governs
  the `blocks`/`blocks: []` distinction this ADR's repository boundary must preserve
  unchanged — no repository method in this design re-implements or re-interprets that
  check; each calls `migrateSession` exactly as it exists today.
- **ADR-0010** (Assessment domain foundation) is the direct precedent for per-domain
  `localStorage` keys and already anticipated this ADR's Decision 4 in its own
  "Future cloud considerations" consequence.
- **ADR-0012** (Training Plans domain and execution model) is the precedent for two
  migration philosophies coexisting inside a single persisted domain, which this ADR's
  Decision 2 relies on directly (`SessionRepository` must not force `Session.planExecution`
  onto Session's repair-style migration, or vice versa).
