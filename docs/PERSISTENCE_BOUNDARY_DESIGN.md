# Persistence Boundary Design

**Status:** Proposed. Companion to `docs/adr/0013-application-owned-persistence-repository-boundary.md`.
This document is design and documentation only — no repository code, no IndexedDB
adapter, and no change to any existing `localStorage` key, stored shape, or migration
behavior exists in this pass. See `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`
§18, "Phase 1: Persistence boundary."

## 1. Purpose and scope

This document inventories every current browser-persisted domain, then designs an
application-owned persistence boundary that can:

1. Wrap the existing `localStorage` implementation **without any behavior change**, as
   the first step.
2. Later support an IndexedDB adapter behind the same boundary, without touching
   domain logic or UI.
3. Leave a clear seam for a future application-owned sync layer, without designing
   that layer now.

Everything in this document is a proposal for product-owner review. Nothing here
authorizes implementation. Section 9 lists what would need explicit sign-off before
Phase 1 implementation could start.

## 2. Authoritative persistence inventory (as of commit `dfd06cb`)

The prior Phase 0 audit reported **8 persisted domains**. Re-verifying directly against
the code for this task found **10 distinct `localStorage` key strings**. Both numbers are
correct at different levels: the audit's "8" counted *conceptual domains* and folded three
small, independently-read/written preference keys into one "Assessment preferences"
domain; the literal key count is 10. This document uses the 10-key ground truth
throughout, and Section 4.A explicitly designs for why 8 *repositories* (not 10) is still
the right grouping.

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
| 1 | `curling-release-tracker-current-session` | `src/components/TrackerApp.tsx:222-223` (key), `src/lib/sessionMigration.ts` (migration) | `Session` (`src/types/index.ts:288-302`) | `TrackerApp.tsx:757-759`, mount effect | `TrackerApp.tsx:905-908`, effect on `[currentSession]` | None (rewritten via `handleStartNewSession`, archiving into history) | None — unversioned, unconditional | `migrateSession(raw): Session` — `sessionMigration.ts:610-640` | `src/lib/__tests__/sessionMigration.test.ts` |
| 2 | `curling-release-tracker-session-history` | same | `Session[]` | `TrackerApp.tsx:761-763` | `TrackerApp.tsx:919-923`, effect on `[sessionHistory]` | `handleClearSessionHistory` → `setSessionHistory([])`, then rewritten as `"[]"`, never removed | None | `migrateSessionHistory(raw): Session[]` — `sessionMigration.ts:642-645` (maps `migrateSession`) | same file |
| 3 | `curling-release-tracker-history-filters` | `TrackerApp.tsx:226-227` (key), `src/lib/historyAnalysis.ts` (sanitize) | `HistoryAnalysisFilters` | `TrackerApp.tsx:793-795`, wrapped in try/catch (`:797-804`) | `TrackerApp.tsx:911-916`, effect on `[historyFilters]` | None | None | `sanitizeHistoryFilters(raw)` — `historyAnalysis.ts:139-149`, merges onto `createDefaultHistoryFilters()` (`:85-96`); `sanitizeThresholdComparisonMode` (`:107-130`) repairs one sub-field | Indirect, via History/Analyze component tests — no dedicated migration test file |
| 4 | `curling-release-tracker-assessment-data` | `src/lib/assessment/persistence.ts:11` | `AssessmentPersistedState` (`persistence.ts:20-24`: `{schemaVersion, currentRun?, history: AssessmentRun[]}`) | `TrackerApp.tsx:807`, own try/catch (`:808-813`) | `TrackerApp.tsx:927-930`, effect on `[assessmentState]`, guarded by `if (!assessmentState) return;` | `deleteAssessmentRunFromHistory` (`persistence.ts:123-131`) — removes one run from the in-memory array; key is always rewritten, never removed | `ASSESSMENT_PERSISTENCE_SCHEMA_VERSION = 1` (`persistence.ts:12`); each `AssessmentRun` also independently carries `ASSESSMENT_RUN_SCHEMA_VERSION = 1` (`assessment/types.ts:220`) | `migrateAssessmentPersistedState(raw)` — `assessment/migration.ts:420`; root version gate at `:423`; per-run validation `validatePersistedAssessmentRun` — `migration.ts:173`, version gate `:178` | `assessment/__tests__/migration.test.ts`, `.../persistence.test.ts` |
| 5 | `curling-release-tracker-training-plans` | `src/lib/trainingPlans/persistence.ts:12` | `TrainingPlansPersistedState` (`persistence.ts:15-18`: `{schemaVersion, plans: TrainingPlan[]}`) | `TrackerApp.tsx:860` | `TrackerApp.tsx:933-939`, effect on `[trainingPlans]` | `deletePlan` (`persistence.ts:57-62`) — filters the in-memory array; key always rewritten | `TRAINING_PLANS_SCHEMA_VERSION = 1` (`persistence.ts:13`); each `TrainingPlan` also carries its own `schemaVersion` (`types/index.ts:260`), but `migratePlan` unconditionally overwrites it (`migration.ts:147`) rather than checking it — this per-plan field is currently decorative, not load-bearing | `migrateTrainingPlans(raw)` — `trainingPlans/migration.ts:157-176`; **root-level mismatch is a full-wipe gate** (`:159-161`); within a matching root version, each plan is repaired field-by-field via `migratePlan` (`:134-149`) | `trainingPlans/__tests__/migration.test.ts`, `.../persistence.test.ts` |
| 6 | `curling-release-tracker-accuracy-tolerance-profiles` | `src/lib/accuracyToleranceProfiles/persistence.ts:31-32` | `AccuracyToleranceProfilesState` (`persistence.ts:25-29`: `{schemaVersion, profiles, defaultProfileId}`) | `TrackerApp.tsx:870-872` | `TrackerApp.tsx:941-946`, effect on `[accuracyToleranceProfilesState]` | No dedicated delete key-path; profile removal is a state-list filter, key always rewritten | `ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION = 1` (`persistence.ts:33`) | `migrateAccuracyToleranceProfilesState(raw)` — `accuracyToleranceProfiles/migration.ts:52`; unknown version/invalid shape → empty state; per-profile quarantine via `migrateProfile` (`:18`); dangling `defaultProfileId` cleared to `null` | `accuracyToleranceProfiles/__tests__/migration.test.ts` |
| 7 | `curling-release-tracker-smart-random-profiles` | `src/lib/smartRandomProfiles/persistence.ts:42-43` | `SmartRandomProfilesState` (`persistence.ts:36-40`) | `TrackerApp.tsx:886-888` | `TrackerApp.tsx:948-953`, effect on `[smartRandomProfilesState]` | Same pattern as #6 | `SMART_RANDOM_PROFILES_SCHEMA_VERSION = 1` (`persistence.ts:44`) | `migrateSmartRandomProfilesState(raw)` — `smartRandomProfiles/migration.ts:66`; same quarantine style as #6, plus a domain check dropping any profile whose Measurement Mode doesn't support Smart Random | `smartRandomProfiles/__tests__/migration.test.ts` |
| 8 | `curling-release-tracker-assessment-show-introduction` | `src/lib/assessmentPreferences.ts:11` | raw string `"true"`/`"false"` | `getShowAssessmentIntroductionPreference()` (`:16-21`), called from `AssessScreen.tsx:301` | `setShowAssessmentIntroductionPreference()` (`:23-25`), called from `AssessScreen.tsx:508,512` | None | None (single scalar) | Inline default: `raw === null → true` (`:19`) | `src/lib/__tests__/assessmentPreferences.test.ts` |
| 9 | `curling-release-tracker-assessment-last-threshold-preset` | `assessmentPreferences.ts:12` | raw string, `AccuracyThresholdPreset` | `getLastAssessmentThresholdPreset()` (`:30-36`), called from `AssessScreen.tsx:119` | `setLastAssessmentThresholdPreset()` (`:38-40`), called from `AssessScreen.tsx:379` | None | None | Inline whitelist check against `VALID_PRESETS`, fallback `"standard"` (`:27,33-35`) | same test file |
| 10 | `curling-release-tracker-assessment-last-custom-threshold` | `assessmentPreferences.ts:13` | `AccuracyThresholds \| null` | `getLastAssessmentCustomThreshold()` (`:42-60`), called from `AssessScreen.tsx:121` | `setLastAssessmentCustomThreshold()` (`:62-64`), called from `AssessScreen.tsx:381` | None | None | Inline try/catch around `JSON.parse` + shape check (`:46-59`); explicitly documented (`:29`) as never authoritative — a Run's real threshold snapshot always comes from an explicit confirmation, never silently from this preference | same test file |

### 2.2 Architectural split within the 10 keys

Keys #1-#7 share one architecture: a root object per key, read once in `TrackerApp.tsx`'s
single mount effect, written by that key's own dedicated `useEffect`, following the
"one-effect-per-key" pattern documented in ADR-0010/0011/0012.

Keys #8-#10 (`assessmentPreferences.ts`) are architecturally different: independent
scalar/JSON values, read and written directly from `AssessScreen.tsx` at arbitrary
interaction points, not through `TrackerApp`'s mount/save-effect pattern, with no root
object and no `schemaVersion`. Any persistence-boundary abstraction that assumes "every
domain has one root object with a schema version, loaded once at mount" needs an explicit
carve-out for these three (see Section 4.A).

### 2.3 Import/export behavior

`src/lib/export.ts` provides pure CSV builders (`buildSessionCsv`, `buildHistoryCsv`) and
a DOM-touching `downloadCsv` helper, reused by `src/lib/assessment/export.ts`. This is
**export only** — there is no import/restore-from-CSV or restore-from-backup path
anywhere in the codebase. No persisted domain has an export function beyond Session/
Session History and Assessment; Training Plans, Accuracy Tolerance Profiles, and Smart
Random Profiles have no export path today.

### 2.4 Documentation currently out of sync with this inventory

`docs/SYSTEM_ARCHITECTURE.md`'s "Persistence and migration (Implemented)" section (line
1087) states "Two `localStorage` keys" and describes only #1 and #2 above — it predates
domains #4-#10 and was never updated as they were added, even though each of those domains
has its own, individually-accurate "Persistence and migration" subsection elsewhere in the
same document. `assessmentPreferences.ts`'s three keys (#8-#10) are not mentioned anywhere
in `SYSTEM_ARCHITECTURE.md`. Section 5 of this document proposes a minimal correction.

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
  (Training Plans) does a **full root-level wipe** on any `schemaVersion` mismatch, then
  field-repairs each plan within a matching version. Domains #6-#7 quarantine individual
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
StorageAdapter (new — one shared, generic, key-value interface)
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

**4.A.1 — Repository granularity.** One repository per *persisted domain*, where a domain
is defined as "the set of keys that must be read/written/migrated together to stay
consistent" — not one repository per literal key, and not one repository per UI feature.
This resolves the 8-vs-10 tension explicitly:

| Repository | Owns keys | Why grouped this way |
|---|---|---|
| `SessionRepository` | #1, #2 | A session moving from current → history (`handleStartNewSession`) is one conceptual operation touching both keys; modeling them as two independent repositories would push that atomicity concern (Section 4.A, "transaction boundaries") out to caller code instead of owning it where it belongs. |
| `HistoryFiltersRepository` | #3 | Independent of training data; a UI-analysis preference, not authoritative training history. |
| `AssessmentRepository` | #4 | Matches ADR-0010's existing "own key, own root shape" decision exactly. |
| `TrainingPlansRepository` | #5 | Matches ADR-0012's existing "own key" decision. Does **not** own `Session.planExecution` — that stays inside `SessionRepository`, migrated by `sessionMigration.ts`'s `migratePlanExecution`, exactly as today (ADR-0012 Decision 4). |
| `AccuracyToleranceProfilesRepository` | #6 | Matches existing independent module boundary. |
| `SmartRandomProfilesRepository` | #7 | Matches existing independent module boundary. |
| `AssessmentPreferencesRepository` | #8, #9, #10 | These three already live in one file today and serve one UI concern (Assess flow prefill). Grouping them as one repository does **not** mean merging them into one storage key or one JSON blob — the repository internally still performs three independent reads/writes, preserving the exact current shapes. Grouping is a code-organization convenience only. |

This yields **7 repositories** covering **10 keys** — not 8 and not 10. The number "8" from
the prior audit is superseded by this explicit design decision, not silently preserved.

**Repository responsibilities**, per repository:
- Read the raw string(s) from the `StorageAdapter`.
- Parse (`JSON.parse`, with try/catch — malformed JSON is not a domain-logic concern, it's
  a storage-boundary concern) and hand the parsed value to the domain's *existing*
  migration/validation function, unchanged.
- Return a fully-typed, already-migrated domain object (or `undefined`/empty-default, per
  current per-domain behavior — see Section 4.B).
- Serialize a domain object back to a string and write it via the `StorageAdapter`.
- Own the domain's delete/reset/clear semantics exactly as implemented today (state-based
  rewrite, never a key removal — see Section 2), unless a future task explicitly decides to
  change this.
- Own import/export composition where it already exists (Session, Assessment) — export
  functions in `src/lib/export.ts`/`assessment/export.ts` continue building CSV from
  already-loaded domain objects; nothing about export changes.

**`StorageAdapter` responsibilities** (the only new low-level component):
- `get(key: string): string | null`
- `set(key: string, value: string): void`
- No JSON parsing, no domain typing, no migration knowledge whatsoever. It is a thin,
  swappable wrapper around whichever underlying mechanism (`localStorage` today,
  IndexedDB later) — see Section 6 for why `remove` is deliberately omitted from the first
  version of this interface (Section 2 confirms nothing in the current app calls it).

**Serialization/deserialization**: owned by repositories, not the adapter — because the
exact serialization shape (e.g. `JSON.stringify(state)` for a root object vs. a raw string
for a scalar preference) is domain knowledge, not storage knowledge. The adapter only ever
sees/returns strings.

**Validation and migration**: owned by domain logic (`src/lib/sessionMigration.ts`,
`src/lib/assessment/migration.ts`, etc.), called by repositories, exactly as today. A
repository must never re-implement or duplicate a migration rule — it is a thin caller.

**Transaction/atomicity boundaries**: see Section 6, question 6, and Section 7's "partially
migrated domains." Today, no cross-key atomicity exists at all — e.g. archiving a session
writes key #1 and key #2 via two independent React effects, relying on same-tick state
updates, not a storage-level transaction. This is an existing, accepted property, not a
defect this design introduces or is obligated to fix. The design does recommend (Section
4.B) that `SessionRepository` expose the *archive* operation as one repository method
(rather than two independent `save`/`setItem` calls issued by caller code), so that if a
future storage backend *can* offer atomicity (IndexedDB transactions can span multiple
object stores), the seam already exists at the right level to take advantage of it without
changing any caller.

**Error handling and corrupted-data handling**: a repository's read path never throws for
corrupted/malformed persisted data — it degrades exactly as the current code does today
(quarantine, discard, or default, per domain — see Section 3), because that is the existing,
tested, product-accepted behavior. A repository's *write* path can fail (e.g. a real quota
error) — Section 6, question 7, addresses how that surfaces to callers without leaking
`DOMException` upward.

**Concurrency assumptions**: unchanged from today — single-tab, no multi-tab
synchronization, no `storage` event listening, last-write-wins if two tabs happen to write
the same key. This is an existing, accepted limitation (the app has never handled it) and
is explicitly out of scope for this design; a future sync layer (Section 8) is a different
problem from same-device multi-tab consistency, and neither is being solved now.

**Reset and deletion semantics**: preserved exactly as-is (Section 2 — no key deletion
anywhere, "clear" is always a state-based rewrite to an empty/default value). The boundary
does not introduce a new "delete the key" capability unless a future task explicitly asks
for one.

**Import/export ownership**: stays with the existing `src/lib/export.ts`/
`assessment/export.ts` modules, which operate on already-loaded domain objects. Repositories
are not involved in CSV construction; they only supply the objects.

## 5. Proposed contracts (documentation examples only — not added to runtime source)

### 5.1 `StorageAdapter` (shared, one implementation swapped later)

```typescript
/**
 * The only component in this design that knows about a specific browser storage
 * mechanism. Every method is synchronous in the localStorage-backed implementation and
 * MUST be assumed possibly-asynchronous by callers, because the IndexedDB-backed
 * implementation introduced in Phase 2 cannot be synchronous — see Section 6.
 */
interface StorageAdapter {
  /**
   * Returns the raw stored string for `key`, or `null` if nothing is stored under it.
   * Never throws for "not found" — absence is a normal, expected return value, not an
   * error (mirrors `localStorage.getItem`'s existing contract exactly).
   * May reject/throw only for a genuine storage-layer failure (e.g. a browser blocking
   * storage access entirely) — not for "key not found" or "value present but malformed,"
   * both of which are the calling repository's concern, not the adapter's.
   */
  get(key: string): Promise<string | null>;

  /**
   * Stores `value` under `key`, overwriting any existing value. Resolves once the write
   * is durable per the backend's own guarantee (synchronous completion for localStorage;
   * transaction completion for IndexedDB). Rejects only on a genuine storage-layer
   * failure (e.g. quota exceeded) — the repository decides what a caller sees for that
   * (Section 6, question 7), the adapter just reports it faithfully.
   * Mutation semantics: full overwrite, never a partial/merge write — matches
   * `localStorage.setItem`'s existing contract exactly.
   */
  set(key: string, value: string): Promise<void>;
}
```

`remove(key)` is intentionally absent from this first version — nothing in the current
codebase calls `removeItem` (Section 2), and adding a capability nothing uses yet would be
speculative. If a future task introduces real key deletion, add it then, with its own
review of what "delete" should mean for each domain.

### 5.2 Domain repository shape — illustrated with `SessionRepository` and `AssessmentRepository`

These two are chosen because they illustrate the two migration philosophies (repair vs.
quarantine) and the one repository that spans two keys.

```typescript
/**
 * Owns `curling-release-tracker-current-session` and `curling-release-tracker-session-history`
 * (Section 4.A.1). Wraps `migrateSession`/`migrateSessionHistory` (sessionMigration.ts)
 * unchanged — this repository introduces no new migration logic.
 */
interface SessionRepository {
  /**
   * Returns the current session, already migrated. If nothing is stored yet, returns
   * `undefined` — callers are responsible for calling `createNewSession()` themselves,
   * exactly as `TrackerApp.tsx`'s current mount effect does (this repository does not
   * silently create a session; that stays an explicit, visible caller decision).
   * Never throws for malformed persisted JSON — `migrateSession` already degrades
   * malformed/partial data to a valid, repaired `Session` (Section 3); a completely
   * unparseable string (invalid JSON) is treated the same as "nothing stored."
   * Returned value is a fresh object each call, not a shared mutable reference into any
   * internal cache — callers may freely mutate their own copy without affecting a later
   * `loadCurrent()` call.
   */
  loadCurrent(): Promise<Session | undefined>;

  /**
   * Overwrites the current session. Not atomic with `loadHistory`/`saveHistory` — see
   * `archiveCurrentToHistory` below for the one operation that must span both keys.
   * Must be safe to call with the exact same `Session` repeatedly (idempotent at the
   * storage layer, since it's a full overwrite).
   */
  saveCurrent(session: Session): Promise<void>;

  /** Returns the full history list, already migrated. Empty array if nothing stored. */
  loadHistory(): Promise<Session[]>;

  /**
   * Composes the "Start New Session" operation (today: `handleStartNewSession`,
   * `TrackerApp.tsx:1713`) as one repository method instead of two independent
   * save calls issued by caller code — see Section 4.A's transaction-boundary note.
   * `nextCurrent` becomes the new current session; `sessionToArchive`, if it has at
   * least one shot (existing rule, unchanged), is appended to history. If
   * `sessionToArchive` has zero shots, this call MUST behave exactly like
   * `saveCurrent(nextCurrent)` alone — the existing "don't archive empty sessions" rule
   * (TrackerApp.tsx's existing check) is preserved here, not silently dropped.
   * Ordering guarantee (Section 4.A): the history write is durable before the current-session
   * write is issued, so an interruption between the two never loses `sessionToArchive` —
   * worst case on interruption, it is briefly visible in both places, never in neither.
   */
  archiveCurrentToHistory(
    sessionToArchive: Session,
    nextCurrent: Session
  ): Promise<void>;

  /**
   * Overwrites the full history list. Used by "Clear History" (passing `[]`) and any
   * future per-entry deletion (passing a filtered array) — matches today's exact
   * behavior of rewriting the key, never removing it (Section 2).
   */
  saveHistory(history: Session[]): Promise<void>;
}
```

```typescript
/**
 * Owns `curling-release-tracker-assessment-data`. Wraps `migrateAssessmentPersistedState`
 * (assessment/migration.ts) unchanged. Illustrates the quarantine philosophy's shape:
 * unlike SessionRepository, there is no equivalent to "partial repair" here — the whole
 * root state is loaded, or resolves to a fresh empty state (Section 3).
 */
interface AssessmentRepository {
  /**
   * Returns the full persisted state, already migrated/quarantined. Never returns
   * `undefined` — an absent or fully-invalid key resolves to
   * `createEmptyAssessmentPersistedState()` (persistence.ts:26-28), exactly as today.
   * This asymmetry with `SessionRepository.loadCurrent()` (which CAN return `undefined`)
   * is intentional and must be preserved — it reflects a real, existing difference in
   * default-value behavior between the two domains, not an inconsistency to smooth over.
   */
  loadState(): Promise<AssessmentPersistedState>;

  /** Overwrites the full persisted state. Guarded by callers exactly as today
   * (TrackerApp.tsx's save effect currently skips writing while `assessmentState` is
   * `null`/not yet loaded) — this repository does not change when a write is attempted,
   * only how it's issued. */
  saveState(state: AssessmentPersistedState): Promise<void>;
}
```

The remaining five repositories (`HistoryFiltersRepository`, `TrainingPlansRepository`,
`AccuracyToleranceProfilesRepository`, `SmartRandomProfilesRepository`,
`AssessmentPreferencesRepository`) follow the same shape as whichever of the two above
matches their existing migration philosophy (Section 3) — they are not sketched in full
here to avoid mechanically repeating the same pattern five times; each would be specified
in full at implementation time, reusing this document's contract-definition style
(absence semantics, error semantics, atomicity, copy-vs-reference) for every method.

### 5.3 How these contracts preserve current behavior

- Every method signature returns exactly the type the corresponding existing
  `migrate*`/`sanitize*` function already returns — no new default-value rule, no new
  fallback behavior, no new validation rule is introduced anywhere in this section.
- `archiveCurrentToHistory`'s "don't archive empty sessions" guard is explicitly called out
  as a preserved rule, not a new one — it already exists in `TrackerApp.tsx`'s current
  `handleStartNewSession` and must move into the repository unchanged.
- `AssessmentRepository.loadState()`'s "never `undefined`" contract matches
  `createEmptyAssessmentPersistedState()`'s existing role exactly.
- Nothing in this section touches a storage *key name* or a persisted *shape* — the
  contracts describe how existing keys/shapes are accessed, never what they contain.

## 6. Migration path (staged; documentation only in this pass)

1. **Introduce repository boundaries, retain the `localStorage` backend.**
   Implement `StorageAdapter` as a thin synchronous-under-the-hood-but-`Promise`-returning
   wrapper around `localStorage` (wrapping a synchronous call in `Promise.resolve(...)` is
   sufficient — the `Promise` return type exists so callers never need to change when the
   backend later becomes genuinely asynchronous). Implement the 7 repositories from Section
   4.A.1, each calling the *existing, unchanged* migration functions. Replace `TrackerApp.tsx`'s
   direct `localStorage.getItem`/`setItem` call sites with the corresponding repository
   calls — this is the only runtime-behavior-relevant step in the whole migration path, and
   it must produce **zero visible behavior change** (Phase 1's own acceptance criterion,
   per `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §19).

2. **Characterize current behavior with contract tests** (Section 7) *before* step 1's
   `TrackerApp.tsx` changes land, so the tests can be run against the *old* direct-
   `localStorage` code path first (as a baseline) and then against the new repository-
   backed path, proving behavioral equivalence rather than assuming it.

3. **Introduce an IndexedDB adapter behind the same `StorageAdapter` interface.** No
   repository or domain-logic code changes — only a second `StorageAdapter`
   implementation is added. This is the first point where `StorageAdapter.get`/`set`
   genuinely need to be asynchronous (IndexedDB has no synchronous API), which is why
   Section 5.1 already specifies `Promise`-returning signatures from step 1 onward.

4. **Migrate existing browser data without loss.** On first load under the IndexedDB
   adapter, for each of the 10 keys: read the existing `localStorage` value (still
   present, untouched), run it through the *same* existing migration function used today,
   write the migrated result into IndexedDB, and — critically — **do not delete the
   `localStorage` copy yet** (see step 5).

5. **Verify migrated data before considering cleanup of legacy storage.** This is
   explicitly a separate, later step, not an automatic consequence of a successful first
   read. See the sub-points below.

6. **Retain a safe rollback strategy.** As long as `localStorage` is not deleted (step 5),
   rolling back to a `localStorage`-only build is always possible by simply not swapping
   the `StorageAdapter` implementation — the data never left `localStorage` in the first
   place until an explicit, separately-decided cleanup step.

### 6.1 Explicit handling of each required migration risk

- **Interrupted migrations.** Per-key migration (step 4) must be independently retryable:
  if the browser closes mid-migration after key #3 but before key #4, the next load must
  detect that #4 is not yet migrated (its IndexedDB store is empty/absent) and migrate it,
  without re-migrating #1-#3 in a way that could duplicate or corrupt already-migrated
  data. This requires each per-key migration step to be idempotent at the IndexedDB side,
  not just at the existing `migrate*` function's side (which is already idempotent per
  ADR-0005, but idempotency of the *transform* is not the same as idempotency of the
  *write*-into-a-new-store operation — the latter must be designed explicitly at
  implementation time, e.g. by keying each write so a re-run overwrites rather than
  duplicates).
- **Partially migrated domains.** The migration state itself needs to be tracked
  per-domain (e.g. "has key #4 been migrated to IndexedDB yet?"), not as one global
  boolean — because domains are migrated independently (per the "one repository per
  domain" design), a partial migration is a normal, expected intermediate state, not an
  error state. Exactly where this per-domain migration-progress flag itself lives is an
  open question (Section 9) — it must not silently become an 11th `localStorage` key
  without an explicit decision.
- **Malformed JSON.** Handled identically to today — a `JSON.parse` failure on the
  `localStorage` source data during the read-for-migration step degrades exactly as it
  does today (Section 3: treated as absent/default, never thrown as a fatal error).
- **Unknown schema versions.** Handled identically to today for domains #4-#7 (unknown
  version → fresh empty state, per each domain's existing rule) — migrating into IndexedDB
  does not relax or change this rule. For domains #1-#3 (unversioned), "unknown version"
  doesn't apply; their existing unconditional-repair behavior is what migrates.
- **Duplicate records.** Only relevant to array-shaped domains (Session History,
  Assessment history, Training Plans, both profile lists). Existing dedup rules already
  exist for the ones that need them (e.g. Assessment migration's `seenIds` check,
  `migration.ts:429-436`, dropping duplicate-ID history entries) — the IndexedDB migration
  step must preserve, not bypass, these existing checks, since they run inside the
  unchanged `migrate*` functions.
- **Stable identifiers.** Already present for every record-like entity: `Session.id`,
  `Shot.id`, `TrainingBlock.id`, `AssessmentRun.id`, `AssessmentAttempt.id`,
  `TrainingPlan.id`, `AccuracyToleranceProfile.id`, `SmartRandomProfile.id` — all
  `crypto.randomUUID()`-generated today. **No new ID scheme is required before IndexedDB
  migration** (see Section 9, design decision 5, for the one nuance: singleton domains
  need a fixed synthetic key, not a new ID scheme).
- **Timestamps and revisions.** Every record-like entity already carries `createdAt`
  and/or `updatedAt`/similar ISO-timestamp fields. No record currently carries a revision/
  version-per-write counter (distinct from the root `schemaVersion`) — this is flagged as
  an open question for the future sync layer (Section 8), not decided here.
- **Data written by an older application version.** This is exactly what the existing
  `migrate*` functions already handle for `localStorage` today, and the IndexedDB
  migration step is defined (step 4, above) to run that same function before the data ever
  reaches IndexedDB — an "older version's data" is never written into IndexedDB in its
  un-migrated form.
- **Downgrade behavior** (a user's browser rolls back to an older app build after
  IndexedDB data exists). Not solved by this design — flagged explicitly as an open
  question (Section 9). The safest available default, absent further design, is: an older
  build that doesn't know about the `StorageAdapter`/IndexedDB path at all would simply
  keep reading `localStorage` (which step 5 has NOT deleted), so a downgrade loses only
  whatever changes happened exclusively in IndexedDB after the last time `localStorage`
  was still being kept in sync — this is only safe if step 5's `localStorage` deletion is
  deferred long enough to make that gap acceptable, which is exactly why this document
  insists cleanup is a separate, later decision.
- **Validation before legacy-data deletion.** Required, not optional: before any
  `localStorage` key is deleted, the corresponding IndexedDB data must be read back and
  compared against the migrated (not raw) `localStorage` value for structural/value
  equality, for every record, not just a count check. This document does not specify the
  exact comparison mechanism (deep-equal on the migrated domain object is the obvious
  candidate) — that belongs to the implementation task, not this design doc — but it
  explicitly forbids skipping this step. **This document does not authorize deleting
  `localStorage` data automatically after the first successful read**, per the task's own
  instruction; cleanup requires its own explicit, later, reviewed decision.
- **Idempotent retry behavior.** Every migration step (per-key, per-record) must be safe to
  run again from scratch, matching ADR-0005's existing idempotency requirement, extended
  from "running `migrateSession` twice is a no-op" to "running the localStorage→IndexedDB
  migration twice is a no-op" (i.e., a second run overwrites with the same result, never
  duplicates or appends).
- **The `blocks` vs. `blocks: []` distinction.** Unaffected by this migration path — it
  is enforced entirely inside `migrateBlocks` (`sessionMigration.ts`), which the IndexedDB
  migration step calls unchanged (step 4). No part of this design re-implements or
  re-interprets that check.
- **The existing field-repair vs. whole-record-discard philosophies.** Both are preserved
  unchanged for the same reason — the migration step always calls each domain's existing
  function, never a new generic one. Section 4.A.1's repository grouping keeps this
  explicit by construction: a repository never "flattens" its domain's declared policy,
  because it never re-implements migration logic itself.

## 7. Future sync compatibility (seam only — not a sync protocol)

- **Local repositories remain authoritative while offline.** The repository interfaces in
  Section 5 have no concept of "online"/"offline," "authenticated," or "pending sync" —
  they read and write local storage and return. A future sync layer sits *above* this
  boundary (composing repository calls the way `TrackerApp.tsx` does today), never inside
  it. This directly continues ADR-0010's own stated reasoning: "the per-domain local key…
  make[s] a future sync boundary a matter of syncing one more key/collection, not
  restructuring existing data" (ADR-0010, Decision 2) — this design's 7-repository split
  is the natural continuation of that same principle at the code-boundary level, not just
  the storage-key level.
- **Where stable IDs, revisions, and sync metadata could live.** Stable IDs already exist
  (Section 6.1). Sync metadata (last-synced-at, a pending-write flag, a server-assigned
  revision) does **not** exist on any current domain type, and this design deliberately
  does not add it now. If/when needed, the natural seam is a wrapper the sync layer
  maintains *alongside* (not inside) each domain's existing persisted shape — e.g. a
  separate, sync-layer-owned small record keyed by the same stable ID, not a new required
  field injected into `Session`/`AssessmentRun`/etc. themselves. This preserves
  `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §3.6's principle ("Domain
  concepts remain provider-neutral… their identifiers and APIs must not become core
  sporting concepts") at the persistence-boundary level specifically.
- **Storage concerns stay separate from authentication/authorization.** No repository or
  adapter in this design has any concept of a signed-in user, a `UserAccount`, or a
  `Profile` (all defined only in `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`
  §5, none implemented). This is intentional: the local repositories are correct for
  exactly one athlete's exactly-one-device local data, with or without an account, and
  must stay that way. A sync layer, when built, is what would associate a repository's
  data with an authenticated identity — never the repository itself.
- **Why cloud identity must not leak into local domain entities prematurely.** Adding a
  `userId`/`ownerId` field to `Session`/`AssessmentRun`/etc. now, in anticipation of sync,
  would violate the accountless-use guarantee this design is explicitly required to
  preserve (Section 1) — a locally-created `Session` has no concept of "whose" it is today,
  by design (`docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`'s "Local-first is a current
  feature, not a placeholder," line 444), and premature identity fields would be dead
  weight for every accountless user, forever, for a capability that may not ship for a
  long time.
- **What can remain deferred until the cloud/login spike.** Per
  `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §12 (Synchronisation protocol)
  and §17.1 (decisions blocking personal cloud sync) — the entire conflict-resolution
  policy, the mutation-outbox design, the idempotency-key scheme, and the cursor/revision
  protocol are all explicitly out of scope for this document and already flagged as
  belonging to that later phase. This document's only obligation to that future phase is:
  don't build anything into the local repository boundary that would make those decisions
  harder later (e.g., don't couple a repository's success/failure signaling to a network
  call, don't assume synchronous storage forever — both already satisfied by the
  `Promise`-returning `StorageAdapter` in Section 5.1).

## 8. Contract-test strategy

**Core principle:** the same test suite runs, unmodified, against every `StorageAdapter`
implementation (`localStorage` today, IndexedDB later) — a test that only passes against
one backend has found either a real behavioral difference (a bug to fix in the newer
backend) or an assumption the test suite was wrong to make (in which case the test, not
the backend, needs fixing). This is only possible because Section 5's contracts are
defined entirely in terms of domain objects and `Promise`s, never in terms of
`localStorage`-specific behavior.

For **every** domain (all 7 repositories from Section 4.A.1, covering all 10 keys), the
contract-test suite must cover:

1. **Empty storage** — `loadX()` on a `StorageAdapter` with nothing written returns the
   domain's documented empty/default value (Section 5's "absence semantics" per method) —
   `undefined` for `SessionRepository.loadCurrent()`, `[]` for `loadHistory()`, a fresh
   `createEmptyAssessmentPersistedState()`-equivalent for `AssessmentRepository.loadState()`,
   etc. — never a thrown error.
2. **Valid round trip** — `save*` then `load*` returns a value structurally equal to what
   was saved (after accounting for any migration function's own normalization, which is
   expected and must be asserted explicitly, not treated as a test failure).
3. **Update** — save, then save again with a changed value, then load returns the latest
   value, not the first.
4. **Deletion or reset** — exercise each domain's actual existing reset semantics (Section
   2): e.g. `SessionRepository.saveHistory([])` then `loadHistory()` returns `[]`, not an
   error and not the old value.
5. **Malformed payload** — write a raw string that isn't valid JSON (where the domain
   expects JSON) directly via the adapter, then confirm `load*` degrades exactly per
   Section 3's documented behavior for that domain (default/empty for most; for
   `HistoryFiltersRepository`, confirm the try/catch fallback to defaults specifically).
6. **Current migration behavior** — for domains #1-#3, write a legacy/partial shape (e.g.
   a session missing `blocks` entirely) and confirm the exact existing repair behavior
   (Legacy Block fabrication, `targetTime` backfill, etc.) still occurs through the
   repository. This is where **the existing `sessionMigration.test.ts`/`historyAnalysis`
   test fixtures should be reused as contract-test inputs**, not reinvented.
7. **Unknown schema version** (domains #4-#7 only) — write a payload with
   `schemaVersion: 999` (or absent) and confirm the documented full-reset (or, for
   Assessment, per-run quarantine) behavior.
8. **Preservation of optional-property semantics** — explicitly assert the `blocks` vs.
   `blocks: []` distinction (ADR-0005) as its own named test case against the repository,
   not just against the underlying migration function directly (proving the repository
   layer doesn't accidentally normalize this away).
9. **Isolation between domains** — writing corrupted data to one domain's key(s) must not
   affect another domain's `load*` result. This directly tests ADR-0010's stated rationale
   for per-domain keys and must be a real, executable test, not just a design claim.
10. **Failed write behavior** — simulate `StorageAdapter.set` rejecting (e.g. a mocked
    quota-exceeded adapter) and confirm the repository surfaces a typed error (Section 9,
    design decision 7) rather than throwing a raw browser exception, and that the
    in-memory domain state a caller already held is not silently corrupted by a failed
    write.
11. **Reload behavior** — construct a fresh repository instance backed by the same
    (persisted) adapter state and confirm `load*` returns the same data a previous
    instance last wrote — this is the contract-test equivalent of the existing
    `reload.spec.ts`/`corrupt-persistence.spec.ts` e2e coverage, but running at the
    repository level instead of the full browser.

At minimum, dedicated coverage is required for current session, session history,
assessments, and settings (`HistoryFiltersRepository`, standing in for "settings" — see
Section 9 for why `AssessmentPreferencesRepository` is treated as a distinct, lower-
priority case), per the task's explicit requirement — but the strategy above is written to
apply uniformly to all 7 repositories, not just those four, since a persistence boundary
that's only proven correct for 4 of 7 domains is not yet trustworthy for the other 3.

## 9. Required design decisions

### 1. One repository per persisted domain vs. repositories per larger aggregate

**Recommendation: one repository per persisted domain**, where "domain" is defined by
consistency requirements, not by key count — yielding 7 repositories over 10 keys
(Section 4.A.1). Reasoning: this matches the codebase's own repeated, deliberate pattern
(ADR-0010 Decision 2 explicitly rejecting a shared root object; ADR-0012 keeping Training
Plans separate from Session) — a persistence boundary that consolidated further would be
fighting the grain of decisions already made and justified elsewhere in this codebase, for
the same reasons (isolation of failure, independent migration cadence).

### 2. Shared low-level adapter vs. direct storage logic inside repositories

**Recommendation: one shared `StorageAdapter`** (Section 5.1), with all domain-specific
serialization/validation/migration logic staying inside repositories. Reasoning: the only
thing genuinely identical across all 10 keys is "read/write a string by key" — everything
else (shape, versioning, repair-vs-discard) already differs per domain today, and forcing
that logic into a shared adapter would recreate exactly the "one migration function
reasoning about multiple domains' schemas" problem ADR-0010 already rejected.

### 3. Where schema validation and migration belong

**Recommendation: inside each repository, calling the existing, unchanged domain-specific
migration function** (`migrateSession`, `migrateAssessmentPersistedState`, etc.) —
never inside the `StorageAdapter`, never inside a UI component or hook. This is not a new
decision so much as a formalization of where migration logic already lives today; the
repository's job is to be the one caller of it, not to reimplement it.

### 4. How domain-specific repair and discard policies remain explicit

**Recommendation: preserve them as-is, at the function level, and make each repository's
choice self-documenting via a required doc comment on the repository interface stating
which of the two philosophies (Section 3) it follows** — not a shared type-level enum or
flag forced into a common interface. Reasoning: the two philosophies have genuinely
different call shapes already (repair returns a repaired value; quarantine can drop
individual array entries) — forcing a common representation (e.g. a generic
`MigrationResult<T> = { repaired: T } | { discarded: true }` union across both) would be
speculative abstraction for two data points, contradicting this project's own working
rules against premature abstraction. **This is flagged as a place where the recommendation
is a judgment call, not a hard requirement — worth revisiting if a third philosophy
emerges.**

### 5. Whether stable IDs must be introduced before IndexedDB migration

**Recommendation: no new ID scheme is required.** Every record-like entity already has a
`crypto.randomUUID()` `id` field (Section 6.1's full list). The only nuance: the four
singleton root-object domains (current session, history filters, assessment root state,
each profile-state root) need a **fixed, constant synthetic key** (e.g. the literal string
`"current"` or reusing the existing `localStorage` key name itself as the IndexedDB key)
rather than a UUID, since there is exactly one of each per browser — this is a naming
convention to settle at implementation time, not a design gap.

### 6. How atomic multi-record operations should be represented

**Recommendation: as an explicit repository method per known operation** (Section 5.2's
`archiveCurrentToHistory` is the concrete example), never as two independent `save` calls
issued by caller/UI code. **Open sub-question, not resolved here**: whether the
`localStorage`-backed implementation should adopt an explicit "write order" convention
(write the destination before clearing/rewriting the source) as a real code requirement, or
whether this is acceptable to leave as an accepted, documented gap until the IndexedDB
adapter can offer true transactions. This document recommends the former (a documented
write-order convention per multi-key repository method) as a low-cost safety improvement
that requires no new abstraction, but marks it a decision the product owner should confirm
is worth doing in the localStorage phase at all, versus deferring entirely to Phase 2.

### 7. How repository errors should be exposed without coupling the UI to browser APIs

**Recommendation: extend the codebase's existing `Outcome`/`ok`/`err` pattern** (already
used for `AssessmentOutcome` in `src/lib/assessment/errors.ts` and `TrainingPlanOutcome` in
`src/lib/trainingPlans/errors.ts`) to repository write operations that can fail, rather
than throwing raw `DOMException`/`QuotaExceededError`. A repository's write methods would
return `Promise<RepositoryOutcome<void>>` (or reuse a domain's existing outcome type where
one already exists) so no caller ever needs to catch a browser-specific exception type.
Read operations, per Section 4.A, do not fail for corrupted data (they degrade per Section
3) and so don't need this — only genuine storage-layer failures (quota, blocked storage)
need an outcome type at all.

### 8. How to prevent React components from bypassing the persistence boundary

**Recommendation, staged:** (a) at implementation time, make repositories the only modules
permitted to import a `StorageAdapter` — a code-review/structural convention first; (b) as
a **later**, separate, explicitly-approved task, add an ESLint restriction (e.g.
`no-restricted-globals`/`no-restricted-syntax` banning bare `localStorage`/`indexedDB`
identifiers outside an allowlisted set of repository files) to make the convention
enforceable rather than aspirational. Note: this second step is **not** performed by this
task (it would be a lint-config change, and this task's constraints forbid modifying
runtime/config in this pass) — it is recorded here as a recommended follow-up, not
something already decided to implement. Also note: most of the codebase already follows
this discipline today — domains #4-#10 have zero raw `localStorage` calls inside any
component file; only `TrackerApp.tsx` currently calls `localStorage` directly (for all 10
keys' *read* triggers and for domains #1-#7's writes), which is exactly the set of call
sites the Phase 1 implementation would replace with repository calls.

### 9. What must be decided now vs. what should remain deferred

**Decide now** (i.e., this document's own recommendations, ready for product-owner
sign-off): the 7-repository grouping (Section 4.A.1); the `StorageAdapter` shape (Section
5.1, including its deliberate omission of `remove`); the `Promise`-returning contract from
day one (so the IndexedDB swap in Phase 2 requires no caller-side signature change); the
outcome-type pattern for write failures (decision 7); that `localStorage` deletion is never
automatic after a first successful migrated read (Section 6.1).

**Explicitly deferred** (not decided by this document, and not to be inferred as decided):
per-domain migration-progress tracking's storage location (Section 6.1); the exact
equality-check mechanism for pre-deletion validation (Section 6.1); the write-order
convention for atomic operations in the localStorage phase specifically (decision 6);
the ESLint enforcement mechanism (decision 8); anything about downgrade behavior beyond
"don't delete localStorage soon" (Section 6.1); anything about sync metadata, conflict
resolution, or identity (Section 7 — explicitly out of scope per the task).

## 10. Relationship to existing ADRs and documents

- **ADR-0005** (migration is idempotent and never overwrites an existing shot value) is the
  ADR governing the `blocks`/`blocks: []` distinction referenced throughout this document
  and is the primary precedent this design is obligated not to violate.
- **ADR-0010** (Assessment domain foundation) is the direct precedent for per-domain
  `localStorage` keys and explicitly already anticipated a future sync boundary in its own
  "Future cloud considerations" consequence — this document is the next concrete step
  after that anticipation, not a new direction.
- **ADR-0012** (Training Plans domain and execution model) is the precedent for
  discard-style migration coexisting with repair-style migration inside a single
  persisted domain, which Section 3 relies on directly.
- **`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §18** defines "Phase 1:
  Persistence boundary" at a one-paragraph level; this document and its companion ADR are
  the detailed design for exactly that phase, and Section 19's "Definition of Ready" is
  satisfied by this document's existence plus the Phase 0 release it depends on.
- **`docs/SYSTEM_ARCHITECTURE.md`'s "Persistence and migration" section** (line 1087) is
  stale relative to this document's inventory (Section 2.4) — Section 5 of the companion
  changes proposes the minimal correction.
