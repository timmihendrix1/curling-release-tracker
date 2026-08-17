# ADR-0016: A resumable, per-domain copy migration from localStorage into IndexedDB

## Status

Accepted. Implemented (mechanism only — not invoked by the app). Phase 2, Stage 3 of the
IndexedDB migration path `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §10 describes. Builds
directly on `docs/adr/0015-indexeddb-adapter-unwired.md` (the adapter this migration
copies into) and `docs/adr/0013-application-owned-persistence-repository-boundary.md`
(the repository/key inventory this migration's seven domains are drawn from).

## Context

ADR-0015 shipped an IndexedDB-backed `StorageAdapter` implementation, deliberately
unwired: nothing reads existing `localStorage` data into it. Design doc §10 stages what
comes next as four steps — adapter (done, ADR-0015), **migrate existing data without
loss** (this ADR), verify before cleanup (future), and a separately-approved
activation/rollback gate (future). This ADR is step 2 only, and only the copy itself —
verification-before-cleanup and activation remain entirely undecided, per §10's own
sequencing.

Design doc §10.1 lists the risks any such migration must handle: interrupted runs,
partial per-domain progress, malformed/legacy data, duplicate records, retry safety, and
— critically — that a per-domain migration-progress flag "must not silently become an
undecided 11th `localStorage` key." Three questions had to be settled:

1. **Copy exact strings, or re-migrate through each domain's schema-repair function
   during the copy?** These are different concerns with different failure modes.
2. **Where does per-domain progress live**, given it must not be an 11th `localStorage`
   key, and given `StorageAdapter.get`/`.set` only ever sees the `records` store?
3. **What does "atomic" mean for one domain's copy**, given `StorageAdapter` itself has
   no multi-key atomicity (ADR-0013, ADR-0014)?

## Decision

### 1. Exact-string copying — a storage-mechanism migration, not a domain-schema migration

The migration engine (`src/lib/persistence/localStorageToIndexedDbMigration.ts`) copies
the **exact string** each source key resolves to (`StorageGetResult.value`) into the
IndexedDB target, unparsed, unrepaired, unreserialized. It never calls a `migrate*`
function, never touches a repository's `save*` method, and never invokes any
repository at all beyond the `StorageAdapter.get` calls needed to read the raw strings.

**Why not migrate-and-copy in one pass.** The original proposal design doc §10 sketched
("read, run through the same existing migration function, write the migrated result")
would duplicate every domain's repair/quarantine/discard policy inside the migration
engine — the exact "second implementation of existing domain repair rules" ADR-0013
explicitly rejected for the adapter, now rejected again here for the migration engine.
Interpretation stays owned by each domain's repository and migration function, applied
uniformly whichever backend the bytes came from — proven directly by this ADR's
repository-equivalence tests (`localStorageToIndexedDbMigration.test.ts`): the same raw
string, read through `SessionRepository`/`AssessmentRepository`/
`AssessmentPreferencesRepository` backed by either adapter, produces the same
interpreted result (modulo fields a domain's own migration function fabricates fresh on
every call regardless of backend, e.g. `migrateSession`'s Legacy Block IDs — a
pre-existing, unrelated non-determinism this ADR does not change or need to solve).

### 2. Seven domains, covering all ten existing keys, one per commit unit

The same seven-domain grouping design doc §4.A.1 and ADR-0013 already established for
the repository boundary — `session` (2 keys), `historyFilters`, `assessment`,
`trainingPlans`, `accuracyToleranceProfiles`, `smartRandomProfiles`, and
`assessmentPreferences` (3 keys) — is reused unchanged as the migration's unit of
progress and atomicity. Every key is referenced via its existing exported repository
constant (`CURRENT_SESSION_STORAGE_KEY`, `SHOW_INTRODUCTION_KEY`, ...); none is
duplicated as a literal string anywhere in the migration engine.

**Why the same grouping, not one marker per key.** `AssessmentPreferencesRepository`'s
three keys are already one "domain" by the repository boundary's own reasoning (design
doc §4.A.2) despite having no shared root object — a partial copy (two of three keys
landed, one didn't) would leave that domain in a state no repository read path can even
observe as "half done," since each of the three keys is read independently. Grouping the
marker at the same granularity as the repository boundary means "is this domain
migrated" always has one unambiguous answer, matching how the domain is actually
consumed later.

### 3. Deterministic per-domain markers in the existing, already-reserved `metadata` store

ADR-0015 reserved the `metadata` object store specifically for "the future
migration/activation markers design doc §10.1 flags as needing *some* home" — this ADR
is the first thing to actually use it, closing design doc §10.1's "must not silently
become an undecided 11th key" requirement by giving migration progress a home that was
already structurally set aside for exactly this, never a `localStorage` key of any kind.

**Marker key namespace:** `migration:local-storage-to-indexeddb:v1:<domain>` (exported as
`MIGRATION_METADATA_NAMESPACE`, built by `buildMigrationMarkerKey(domain)` — both in
`indexedDbAdapter.ts`).

**Marker value shape** (`IndexedDbMigrationDomainMarker`):

```ts
{
  protocolVersion: 1,       // MIGRATION_PROTOCOL_VERSION — bump only for a genuinely
                            // incompatible marker shape, never reused for a data change
  domain: string,           // e.g. "session" — must match the key it's stored under
  status: "complete",       // the only status this protocol ever writes
  sourceKeys: string[],     // the exact, ordered key list this domain covered when
                            // the marker was written
}
```

**Deliberately excluded:** a timestamp, a random ID, or anything environment-specific.
A marker only ever needs to answer one question — "is this exact domain, with this exact
set of source keys, fully copied?" — and a timestamp/random ID would add a value this
protocol never reads back for any decision, exactly the kind of speculative field the
working rules warn against.

**Fresh users get complete markers too.** A domain with all of its source keys absent
still gets committed with zero records and a `status: "complete"` marker — otherwise
every later startup would re-inspect an empty legacy source forever, for every domain,
on every load, which is exactly the "repeatedly inspecting an empty legacy source" §10.1
implicitly warns against by requiring retry to be driven by real per-domain state, not
absence-of-evidence. A brand-new user therefore reaches full "already migrated" steady
state after exactly one run, identically to a user with real data.

**No global completion marker, no activation marker, in this commit.** Only the seven
domain markers exist after a run — verified directly
(`localStorageToIndexedDbMigration.test.ts`, "no activation or global source-of-truth
marker"). Whether a global "all domains migrated" convenience flag is ever worth adding,
and what an activation marker would even mean, are exactly the design doc §10 step 4
questions this ADR does not answer.

### 4. Per-domain atomicity via one IndexedDB transaction spanning both stores

`IndexedDbMigrationTarget.commitDomainSnapshot` (added to `indexedDbAdapter.ts`, not
exposed through `StorageAdapter.get`/`.set`) opens one `readwrite` transaction over both
`records` and `metadata`, and inside it:

1. re-reads and re-validates the domain's marker;
2. if it is already a valid, matching, complete marker — returns `already_complete`
   without touching a single record;
3. if no marker exists — deletes each of the domain's exact source keys from `records`
   (clearing any stale prior partial attempt), writes only the keys whose source value
   is non-null, and writes the completion marker last;
4. commits.

**Why the marker is re-checked *inside* the transaction, not just before starting one.**
This is what makes two concurrent commits of the same not-yet-migrated domain safe
without a second locking mechanism: IndexedDB serializes `readwrite` transactions over
shared object stores at the database level, regardless of which connection issued them.
Whichever commit's transaction is scheduled first sees `"absent"` and writes; the second
transaction runs only after the first has fully committed, so it re-reads a marker that
now exists, matches, and is complete — and returns `already_complete` instead of
re-deleting/re-writing anything. No new lock, queue, or coordination primitive was
added; this is IndexedDB's own transaction ordering, used the same deliberate way ADR-
0007/ADR-0014 reuse an existing serialization mechanism instead of inventing a new one.

**Why any failure aborts explicitly, not only implicitly.** IndexedDB's spec-level
auto-abort (any unhandled request-level error aborts the whole transaction) is real, but
this implementation does not rely on it exclusively — every failure path (including one
manufactured entirely inside a test, bypassing the request/event mechanism a real
browser failure would go through) explicitly calls `tx.abort()` before returning a
failed result. This guarantees the "no record change and no marker survive" invariant
deterministically, rather than depending on exactly how a given failure manifests at the
IndexedDB API surface.

**Fail-closed marker validation.** A marker that exists but doesn't validate — wrong
`protocolVersion`, wrong `domain`, a `sourceKeys` list that doesn't match exactly
(same keys, same order), or an unrecognized `status` — is never treated as `"absent"`
(which would silently re-copy and potentially duplicate/overwrite already-migrated data
under a corrupted marker) and never treated as `"complete"` (which would silently skip a
domain that was never actually verified as migrated). It resolves to a distinct
`"invalid"`/`"invalid_marker"` outcome, carrying a structured reason string, leaving
every target record for that domain completely untouched.

### 5. The orchestrator is a thin, injected-dependency mechanism — no side effects, no interpretation, no wiring

`src/lib/persistence/localStorageToIndexedDbMigration.ts`'s
`runLocalStorageToIndexedDbMigration({ source, target })`:

- depends only on an injected `StorageAdapter` (the source — read-only, `.set` is never
  called) and an injected `IndexedDbMigrationTarget` (the destination);
- has no side effect at import or construction time — importing the module or
  referencing `MIGRATION_DOMAINS` touches neither `localStorage` nor `indexedDB`;
- processes the seven domains in one fixed order (`session`, `historyFilters`,
  `assessment`, `trainingPlans`, `accuracyToleranceProfiles`, `smartRandomProfiles`,
  `assessmentPreferences`) — the same order listed throughout this ADR and the task that
  produced it;
- checks a domain's marker before ever reading its source keys, skipping the source
  entirely for an already-complete domain;
- reads every source key for a domain before attempting that domain's commit, and never
  commits a partial domain if any one of its source-key reads fails;
- stops at the first failed domain, returning a structured result identifying which
  domains completed, which were already complete, and — if processing stopped early —
  the failed domain, which of three stages it failed at (`marker_read`, `source_read`,
  `target_commit`), and a classified error;
- is idempotent (a fully-migrated run, run again, reads nothing from the source and
  reports every domain as already complete) and safe to resume after an interruption
  (a later run skips every already-complete domain's source reads entirely, and picks
  up exactly at the first incomplete one);
- never invokes any domain repository's save method, and never mutates the source
  adapter.

### 6. Why localStorage is never touched

The migration engine only ever calls `source.get`. No code path in this ADR calls
`source.set`, `localStorage.setItem`, or `localStorage.removeItem` — proven directly by
a test asserting zero `Storage.prototype.setItem` calls across a full run against the
real `localStorageAdapter`, and by asserting every source key's stored value is
byte-identical before and after. This is deliberate, not incidental: `localStorage`
remains the sole production source of truth (ADR-0015), and nothing about "the copy
exists" changes that — a copy is not a cutover.

## Alternatives Considered

- **Migrate-through-schema-repair during the copy** (design doc §10's original sketch).
  Rejected — see Decision 1: it would duplicate every domain's existing repair policy
  inside a second, migration-specific implementation.
- **One marker per literal storage key (10 markers), not one per domain (7).** Rejected:
  would let `assessmentPreferences`' three independently-read keys report
  "two of three migrated" as if that were a meaningful, actionable state — no repository
  or future activation logic reads these three keys as anything other than one domain's
  worth of UI-preference data, and a per-key marker would just reintroduce a granularity
  mismatch the repository boundary already resolved once (ADR-0013 Decision 1).
- **A global "all domains migrated" completion marker, added now for convenience.**
  Rejected for this pass: not required by anything this ADR implements (activation is a
  separate, future decision), and premature per the working rule against speculative
  capability. Nothing stops a future activation task from computing this itself by
  checking all seven per-domain markers, without this ADR pre-committing to its shape.
- **Storing markers as JSON strings in the `records` store under a reserved key
  prefix**, instead of structured objects in the dedicated `metadata` store. Rejected:
  `metadata` was reserved for exactly this by ADR-0015; reusing `records` would blur the
  one boundary ADR-0015 drew (`records` holds exactly what `StorageAdapter.get`/`.set`
  return/accept, nothing else) and would make "metadata must stay unreachable through
  the generic adapter" a much harder property to keep true.
- **Relying solely on IndexedDB's automatic transaction-abort-on-error** instead of
  explicitly calling `tx.abort()` in every failure path. Rejected on inspection: a
  synchronous throw from within a request call does not reliably route through that
  automatic path the same way an asynchronous request-level error event does — explicit
  abort makes the "nothing survives a failed commit" guarantee independent of exactly
  how a given failure manifests.
- **A second, independent `openDB`/connection-cache/error-classification
  implementation for the migration target.** Rejected: `indexedDbAdapter.ts` was
  refactored (behavior-preserving, all pre-existing adapter tests unchanged) to share
  one `createIndexedDbConnection` helper between `createIndexedDbAdapter` and
  `createIndexedDbMigrationTarget`, rather than hand-rolling connection lifecycle logic
  twice.
- **Wiring this migration into `TrackerApp.tsx` or a repository singleton now, behind a
  flag.** Rejected — explicitly out of scope per the task and per design doc §10 step
  4's still-unresolved activation/rollback gate. An architecture-enforcement test
  (`architectureBoundary.test.ts`) proves no production file imports this module.

## Consequences

- Two new files: `src/lib/persistence/localStorageToIndexedDbMigration.ts` (the
  orchestrator) and an extension to `src/lib/persistence/indexedDbAdapter.ts` (the
  `IndexedDbMigrationTarget` interface, `createIndexedDbMigrationTarget`, and the marker
  namespace/validation constants and functions) — plus two new test files
  (`indexedDbMigrationTarget.test.ts`, `localStorageToIndexedDbMigration.test.ts`) and
  one existing test file extended (`architectureBoundary.test.ts`).
- `indexedDbAdapter.ts`'s internals are refactored (connection lifecycle extracted into
  a shared, private helper) but `createIndexedDbAdapter`'s public behavior, and all of
  its pre-existing 21 tests, are unchanged and still pass unmodified.
- No existing storage key, stored shape, migration function, repository contract, or
  `StorageAdapter` interface changes. No dependency was added (`idb`/`fake-indexeddb`,
  already present since ADR-0015, are the only ones used).
- Running this migration has zero effect on what the application actually reads or
  writes today: nothing imports or invokes `runLocalStorageToIndexedDbMigration` from
  any production code path.
- `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s IndexedDB item is updated to record the copy
  mechanism as implemented, while migration **activation**, verification-before-cleanup,
  rollback, dual-write, and localStorage cleanup remain explicitly unresolved and
  unimplemented — this ADR resolves none of them.

## Relationship to existing ADRs

- **ADR-0015** is the direct prerequisite: the `records`/`metadata` schema, the lazy
  connection lifecycle this ADR's `createIndexedDbMigrationTarget` reuses, and the
  reservation of `metadata` for exactly this purpose all come from it unchanged.
- **ADR-0013** is the source of the seven-domain grouping and the ten storage-key
  inventory this migration copies — reused, not re-derived.
- **ADR-0014** established the precedent this ADR follows structurally: coordinate a
  multi-step operation's atomicity at the point that actually needs it (there, a
  repository method's sequential `await`s; here, one IndexedDB transaction), rather than
  widening the generic `StorageAdapter` contract to express something only one specific
  caller needs.
