# Persistence Boundary Design

**Status:** Proposed. Companion to `docs/adr/0013-application-owned-persistence-repository-boundary.md`.
This document is design and documentation only — no repository code, no IndexedDB
adapter, and no change to any existing `localStorage` key, stored shape, or migration
behavior exists in this pass. See `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`
§18, "Phase 1: Persistence boundary."

**Revision 1** (this version): responds to the product-owner architecture review recorded
in `PERSISTENCE_BOUNDARY_REVIEW_HANDOFF.md` and the accompanying binding decisions in
`PERSISTENCE_BOUNDARY_REVISION_REPORT.md`. The most consequential change: the original
draft's `SessionRepository.archiveCurrentToHistory` method is removed — Phase 1 is
strictly behavior-preserving, including the exact current write order and the current
lack of session-history deduplication (see Section 6). This revision also completes all
seven repository contracts (Section 5), adds a concrete hydration design (Section 7), a
concrete error model (Section 8), and clarifies adapter/transaction and rollback framing
(Sections 9–10).

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
authorizes implementation. Section 13 lists what remains open; Section 15 lists the
implementation-readiness gate.

## 2. Authoritative persistence inventory (as of commit `dfd06cb`)

**Ten storage keys, seven domain-facing repositories.** This is the single, consistent
count used throughout this document and its companion ADR. (An earlier Phase 0 audit pass
reported "8 persisted domains" — that number counted conceptual domains and folded three
independently-read/written preference keys into one grouping; it is superseded by this
inventory and is not otherwise referenced below.)

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
| 1 | `curling-release-tracker-current-session` | `src/components/TrackerApp.tsx:222-223` (key), `src/lib/sessionMigration.ts` (migration) | `Session` (`src/types/index.ts:288-302`) | `TrackerApp.tsx:757-759`, mount effect | `TrackerApp.tsx:902-909`, effect on `[currentSession]`, guarded by `if (!currentSession) return;` | None (rewritten via `handleStartNewSession`, archiving into history — see Section 6) | None — unversioned, unconditional | `migrateSession(raw): Session` — `sessionMigration.ts:610-640` | `src/lib/__tests__/sessionMigration.test.ts` |
| 2 | `curling-release-tracker-session-history` | same | `Session[]` | `TrackerApp.tsx:761-763` | `TrackerApp.tsx:918-923`, effect on `[sessionHistory]`, **unguarded** | `handleClearSessionHistory` → `setSessionHistory([])`, then rewritten as `"[]"`, never removed | None | `migrateSessionHistory(raw): Session[]` — `sessionMigration.ts:642-645` (maps `migrateSession`) | same file |
| 3 | `curling-release-tracker-history-filters` | `TrackerApp.tsx:226-227` (key), `src/lib/historyAnalysis.ts` (sanitize) | `HistoryAnalysisFilters` | `TrackerApp.tsx:793-795`, wrapped in try/catch (`:797-804`) | `TrackerApp.tsx:911-916`, effect on `[historyFilters]`, **unguarded** | None | None | `sanitizeHistoryFilters(raw)` — `historyAnalysis.ts:139-149`, merges onto `createDefaultHistoryFilters()` (`:85-96`); `sanitizeThresholdComparisonMode` (`:107-130`) repairs one sub-field | Indirect, via History/Analyze component tests — no dedicated migration test file |
| 4 | `curling-release-tracker-assessment-data` | `src/lib/assessment/persistence.ts:11` | `AssessmentPersistedState` (`persistence.ts:20-24`: `{schemaVersion, currentRun?, history: AssessmentRun[]}`) | `TrackerApp.tsx:807`, own try/catch (`:808-813`) | `TrackerApp.tsx:927-930`, effect on `[assessmentState]`, guarded by `if (!assessmentState) return;` | `deleteAssessmentRunFromHistory` (`persistence.ts:123-131`) — removes one run from the in-memory array; key is always rewritten, never removed | `ASSESSMENT_PERSISTENCE_SCHEMA_VERSION = 1` (`persistence.ts:12`); each `AssessmentRun` also independently carries `ASSESSMENT_RUN_SCHEMA_VERSION = 1` (`assessment/types.ts:220`) | `migrateAssessmentPersistedState(raw)` — `assessment/migration.ts:420`; root version gate at `:423`; per-run validation `validatePersistedAssessmentRun` — `migration.ts:173`, version gate `:178` | `assessment/__tests__/migration.test.ts`, `.../persistence.test.ts` |
| 5 | `curling-release-tracker-training-plans` | `src/lib/trainingPlans/persistence.ts:12` | `TrainingPlansPersistedState` (`persistence.ts:15-18`: `{schemaVersion, plans: TrainingPlan[]}`) | `TrackerApp.tsx:860` | `TrackerApp.tsx:933-939`, effect on `[trainingPlans]`, **unguarded** | `deletePlan` (`persistence.ts:57-62`) — filters the in-memory array; key always rewritten | `TRAINING_PLANS_SCHEMA_VERSION = 1` (`persistence.ts:13`); each `TrainingPlan` also carries its own `schemaVersion` (`types/index.ts:260`), but `migratePlan` unconditionally overwrites it (`migration.ts:147`) rather than checking it — this per-plan field is currently decorative, not load-bearing | `migrateTrainingPlans(raw)` — `trainingPlans/migration.ts:157-176`; **root-level mismatch is a full-wipe gate** (`:159-161`); within a matching root version, each plan is repaired field-by-field via `migratePlan` (`:134-149`) | `trainingPlans/__tests__/migration.test.ts`, `.../persistence.test.ts` |
| 6 | `curling-release-tracker-accuracy-tolerance-profiles` | `src/lib/accuracyToleranceProfiles/persistence.ts:31-32` | `AccuracyToleranceProfilesState` (`persistence.ts:25-29`: `{schemaVersion, profiles, defaultProfileId}`) | `TrackerApp.tsx:870-872` | `TrackerApp.tsx:941-946`, effect on `[accuracyToleranceProfilesState]`, **unguarded** | No dedicated delete key-path; profile removal is a state-list filter, key always rewritten | `ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION = 1` (`persistence.ts:33`) | `migrateAccuracyToleranceProfilesState(raw)` — `accuracyToleranceProfiles/migration.ts:52`; unknown version/invalid shape → empty state; per-profile quarantine via `migrateProfile` (`:18`); dangling `defaultProfileId` cleared to `null` | `accuracyToleranceProfiles/__tests__/migration.test.ts` |
| 7 | `curling-release-tracker-smart-random-profiles` | `src/lib/smartRandomProfiles/persistence.ts:42-43` | `SmartRandomProfilesState` (`persistence.ts:36-40`) | `TrackerApp.tsx:886-888` | `TrackerApp.tsx:948-953`, effect on `[smartRandomProfilesState]`, **unguarded** | Same pattern as #6 | `SMART_RANDOM_PROFILES_SCHEMA_VERSION = 1` (`persistence.ts:44`) | `migrateSmartRandomProfilesState(raw)` — `smartRandomProfiles/migration.ts:66`; same quarantine style as #6, plus a domain check dropping any profile whose Measurement Mode doesn't support Smart Random | `smartRandomProfiles/__tests__/migration.test.ts` |
| 8 | `curling-release-tracker-assessment-show-introduction` | `src/lib/assessmentPreferences.ts:11` | raw string `"true"`/`"false"` | `getShowAssessmentIntroductionPreference()` (`:16-21`), called from `AssessScreen.tsx:301` | `setShowAssessmentIntroductionPreference()` (`:23-25`), called from `AssessScreen.tsx:508,512` | None | None (single scalar) | Inline default: `raw === null → true` (`:19`) | `src/lib/__tests__/assessmentPreferences.test.ts` |
| 9 | `curling-release-tracker-assessment-last-threshold-preset` | `assessmentPreferences.ts:12` | raw string, `AccuracyThresholdPreset` | `getLastAssessmentThresholdPreset()` (`:30-36`), called from `AssessScreen.tsx:119` | `setLastAssessmentThresholdPreset()` (`:38-40`), called from `AssessScreen.tsx:379` | None | None | Inline whitelist check against `VALID_PRESETS`, fallback `"standard"` (`:27,33-35`) | same test file |
| 10 | `curling-release-tracker-assessment-last-custom-threshold` | `assessmentPreferences.ts:13` | `AccuracyThresholds \| null` | `getLastAssessmentCustomThreshold()` (`:42-60`), called from `AssessScreen.tsx:121` | `setLastAssessmentCustomThreshold()` (`:62-64`), called from `AssessScreen.tsx:381` | None | None | Inline try/catch around `JSON.parse` + shape check (`:46-59`); explicitly documented (`:29`) as never authoritative — a Run's real threshold snapshot always comes from an explicit confirmation, never silently from this preference | same test file |

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

This yields **7 repositories** covering **10 keys**. There is no remaining reference to an
"8-repository" grouping anywhere in this document or its companion ADR.

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
rejects, for *any* reason — see Section 8 for the complete, revised error model
(corrupted/malformed data degrades exactly as today, per domain; a genuine storage-layer
read failure also degrades to the domain's own absence/default value, rather than
propagating).

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

Every write method returns `Promise<PersistenceWriteResult>` (defined in Section 8) rather
than `Promise<void>` or a bare rejected `Promise` — this is the one contract-shape change
from the original draft, needed to satisfy the error model in Section 8. Every read method
returns `Promise<T>` and **never rejects, for any reason** — a genuine storage-layer read
failure (not just malformed data) degrades to the domain's own documented absence/default
value; see Section 8 for why this is a deliberate, stated choice, not an oversight.

### 5.1 `SessionRepository`

Owns keys #1 (`curling-release-tracker-current-session`) and #2
(`curling-release-tracker-session-history`). Wraps `migrateSession`/`migrateSessionHistory`
(`sessionMigration.ts`) unchanged. **Does not expose a composed archive operation** — see
Section 6 for why, and for exactly how `TrackerApp.tsx`'s `handleStartNewSession` composes
`saveCurrent`/`saveHistory` itself in Phase 1.

```typescript
interface SessionRepository {
  /**
   * Input: none. Output: the current session, already migrated, or `undefined` if
   * nothing is stored yet (matches today's absence semantics exactly — callers remain
   * responsible for calling `createNewSession()` themselves, as `TrackerApp.tsx`'s
   * current mount effect does).
   * Malformed/unknown-shape data: never rejects — `migrateSession` already degrades
   * malformed/partial data to a valid, repaired `Session` (Section 3); a completely
   * unparseable string is treated the same as "nothing stored." A genuine adapter-level
   * read failure (Section 8) is likewise treated as "nothing stored."
   * Mutation semantics: read-only, no side effect.
   * Copy semantics: fresh object every call (Section 5's general rule).
   * Atomicity: N/A (single read, single key).
   * Idempotency: yes — repeated calls with no intervening write return equal values.
   * Current behavior preserved: yes, exactly (`TrackerApp.tsx:757-780`'s existing
   * load-then-optionally-create split).
   */
  loadCurrent(): Promise<Session | undefined>;

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
   * Input: none. Output: the full history list, already migrated. `[]` if nothing is
   * stored — never `undefined` (this domain's absence value is an empty array, not a
   * missing object; this is a real, existing asymmetry with `loadCurrent()` and must be
   * preserved, not smoothed over).
   * Malformed/unknown-shape data: never rejects — degrades via `migrateSessionHistory`
   * exactly as today.
   * Copy semantics: fresh array every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly (`TrackerApp.tsx:761-763`).
   */
  loadHistory(): Promise<Session[]>;

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
   * Input: none. Output: the current filters, already sanitized. Never `undefined` —
   * absence or a `JSON.parse` failure resolves to `createDefaultHistoryFilters()`
   * (`historyAnalysis.ts:85-96`), exactly matching `TrackerApp.tsx:793-804`'s existing
   * try/catch-to-defaults behavior. A malformed `thresholdComparisonMode` sub-field is
   * independently repaired by `sanitizeThresholdComparisonMode`, exactly as today.
   * Mutation semantics: read-only.
   * Copy semantics: fresh object every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly.
   */
  load(): Promise<HistoryAnalysisFilters>;

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

Owns key #4. Wraps `migrateAssessmentPersistedState` (`assessment/migration.ts`) unchanged.
Illustrates the quarantine philosophy: unlike `SessionRepository`, there is no partial
repair here — the whole root state is loaded, or resolves to a fresh empty state.

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
   * Input: none. Output: `{ state, currentRunQuarantined }`. `state` never has an
   * `undefined`/missing shape — an absent or fully-invalid key resolves to
   * `createEmptyAssessmentPersistedState()` (`persistence.ts:26-28`), exactly as today.
   * This asymmetry with `SessionRepository.loadCurrent()` (which CAN return `undefined`)
   * is intentional and preserved, not smoothed over — it reflects a real, existing
   * difference in default-value behavior between the two domains.
   * Malformed/unknown-version data: an individually invalid run is quarantined (dropped),
   * never partially repaired, exactly as `migrateAssessmentPersistedState` does today; an
   * unrecognized root `schemaVersion` resolves to the fresh empty state.
   * Reload-recovery (forcing a `warmup`/`in_progress` run to `paused`) stays in
   * application code, operating on this method's return value — it is an existing
   * domain-function composition (`pauseAssessmentRun`), not a repository concern.
   * Copy semantics: fresh object every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, including the quarantine-notice signal.
   */
  loadState(): Promise<AssessmentLoadResult>;

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
   * Input: none. Output: the plan list, already migrated. `[]` if nothing is stored, if
   * the root `schemaVersion` doesn't match (`migrateTrainingPlans`'s full-wipe gate,
   * `migration.ts:159-161`), or if the stored value is fully malformed — never
   * `undefined`. Within a matching root version, each plan is independently
   * field-repaired (`migratePlan`, `migration.ts:134-149`); a single structurally broken
   * plan is dropped without invalidating the rest of the list.
   * Mutation semantics: read-only.
   * Copy semantics: fresh array every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes — matches `TrackerApp.tsx:860`'s existing
   * `migrateTrainingPlans(rawTrainingPlans).plans` unwrapping exactly.
   */
  loadPlans(): Promise<TrainingPlan[]>;

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
   * Input: none. Output: the full state, already migrated. Never `undefined` — absence,
   * an unrecognized `schemaVersion`, or a fully-invalid top-level shape resolves to
   * `createEmptyAccuracyToleranceProfilesState()` (`persistence.ts`). An individually
   * invalid profile is quarantined (dropped) via `migrateProfile`, never repaired,
   * without invalidating the rest of the list. A `defaultProfileId` that no longer
   * resolves to a surviving profile is cleared to `null` — this repair happens *within*
   * the loaded object, not as a side effect the repository performs separately.
   * Mutation semantics: read-only.
   * Copy semantics: fresh object every call.
   * Atomicity: N/A.
   * Idempotency: yes.
   * Current behavior preserved: yes, exactly.
   */
  loadState(): Promise<AccuracyToleranceProfilesState>;

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
   * Same absence/malformed/quarantine semantics as
   * `AccuracyToleranceProfilesRepository.loadState()` (Section 5.5), plus one additional
   * domain-specific repair: a profile whose `measurementMode` no longer supports Smart
   * Random (per `isSmartRandomAvailable`) is quarantined, never coerced into a fabricated
   * range — exactly as `migrateSmartRandomProfilesState` does today.
   * Mutation semantics: read-only. Copy semantics: fresh object every call.
   * Atomicity: N/A. Idempotency: yes.
   * Current behavior preserved: yes, exactly.
   */
  loadState(): Promise<SmartRandomProfilesState>;

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
   * Input: none. Output: whether the Assess Guided Introduction should be shown.
   * Absence semantics: `true` (shown) if nothing is stored yet — matches
   * `getShowAssessmentIntroductionPreference`'s existing `raw === null → true` default
   * exactly (`assessmentPreferences.ts:19`). Never rejects.
   * Mutation semantics: read-only. Copy semantics: N/A (primitive).
   * Atomicity/idempotency: N/A/yes. Current behavior preserved: yes, exactly.
   */
  getShowIntroduction(): Promise<boolean>;

  /** Input: the new value. Output: a `PersistenceWriteResult`. Full overwrite, matches
   * `setShowAssessmentIntroductionPreference` exactly. */
  setShowIntroduction(show: boolean): Promise<PersistenceWriteResult>;

  /**
   * Input: none. Output: the last-selected threshold preset. Absence/invalid-value
   * semantics: `"standard"` — matches the existing whitelist-check-with-fallback
   * exactly (`assessmentPreferences.ts:27,33-35`). Never authoritative for an actual
   * Run's threshold snapshot (documented at `assessmentPreferences.ts:29`) — this
   * remains a UI-preselection concern only, unchanged.
   * Mutation semantics: read-only. Current behavior preserved: yes, exactly.
   */
  getLastThresholdPreset(): Promise<AccuracyThresholdPreset>;

  /** Input: the new preset. Output: a `PersistenceWriteResult`. Full overwrite, matches
   * `setLastAssessmentThresholdPreset` exactly. */
  setLastThresholdPreset(preset: AccuracyThresholdPreset): Promise<PersistenceWriteResult>;

  /**
   * Input: none. Output: the last-entered custom threshold pair, or `null` if absent or
   * malformed — matches `getLastAssessmentCustomThreshold`'s existing try/catch +
   * shape-check exactly (`assessmentPreferences.ts:46-59`). Also never authoritative,
   * same reasoning as above.
   * Mutation semantics: read-only. Current behavior preserved: yes, exactly.
   */
  getLastCustomThreshold(): Promise<AccuracyThresholds | null>;

  /** Input: the new threshold pair. Output: a `PersistenceWriteResult`. Full overwrite,
   * matches `setLastAssessmentCustomThreshold` exactly. */
  setLastCustomThreshold(values: AccuracyThresholds): Promise<PersistenceWriteResult>;
}
```

### 5.8 How these contracts preserve current behavior

- Every method's absence/default/malformed-data behavior matches the corresponding
  existing `migrate*`/`sanitize*` function or inline check exactly — no new default-value
  rule, no new fallback behavior, no new validation rule is introduced anywhere in this
  section.
- No repository exposes a generic `save(key, value)`/`get(key)` method — every method is
  named for its domain operation.
- `AssessmentRepository.loadState()`'s "never missing" contract, and
  `SessionRepository.loadHistory()`'s "`[]`, never `undefined`" contract, are both stated
  as intentional asymmetries with `SessionRepository.loadCurrent()` — preserved, not
  smoothed into one uniform absence value.
- Nothing in this section touches a storage *key name* or a persisted *shape* — the
  contracts describe how existing keys/shapes are accessed, never what they contain.
- **`SessionRepository` no longer includes `archiveCurrentToHistory`** — see Section 6 for
  the corrected treatment of session archiving.

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

### 6.2 Binding product-owner decision for Phase 1

**Phase 1 does not change any of the above.** Specifically, and explicitly superseding the
original draft's `archiveCurrentToHistory` method:

1. **The write order is unchanged**: current-session first, session-history second.
2. **No ID-based deduplication or new idempotency behavior is introduced** for session
   archiving.
3. **`SessionRepository` exposes only `loadCurrent`/`saveCurrent`/`loadHistory`/
   `saveHistory`** (Section 5.1) — there is no composed, cross-key repository method for
   archiving.
4. **Construction of the next session and the next history array stays in the existing
   application flow** (`TrackerApp.tsx`'s `handleStartNewSession`, or its eventual
   equivalent) — the repository does not decide *what* the next state is, only persists
   what it's given.
5. **The empty-session guard (`shots.length > 0`) stays in application code**, not inside
   any repository operation — a repository method has no product-level opinion about
   whether a session is "worth archiving."

Concretely, the Phase 1 implementation of `handleStartNewSession` (or its equivalent) is
expected to call, in this exact order, matching today's effect declaration order exactly:

```
if (currentSession has at least one shot) {
  const nextHistory = [currentSession, ...existingHistory];
  await sessionRepository.saveCurrent(nextCurrentSession);
  await sessionRepository.saveHistory(nextHistory);
} else {
  await sessionRepository.saveCurrent(nextCurrentSession);
}
```

### 6.3 Partial-failure behavior, stated accurately

If `saveCurrent` succeeds and `saveHistory` fails (a rejected write per Section 8) or the
app is interrupted between the two `await`s, the outcome is **identical to today's real
risk**: the old session is already overwritten in "current" and not yet durable in
"history." Phase 1 does not fix this. It is documented here so no reader mistakes the
absence of a fix for an oversight.

### 6.4 Deferred to a separate, future, explicitly-approved decision

Not decided by this document, and not authorized by ADR-0013:

- A transactional (or safer-ordered) archive operation.
- Retry-safe deduplication for session archiving, of the kind `AssessmentRepository`
  already has for run archiving.
- Any change to the current write order.

Any of the above would be a genuine behavior change and requires its own, separate
product-owner decision and its own ADR update — not an implicit consequence of introducing
the repository boundary.

## 7. Hydration design

This section is new in this revision. It exists because Section 5's repository methods
are `Promise`-returning, which widens the mount-time load window described in Section
2.1's write-guard note from "negligible, self-correcting within one synchronous JS task"
to "a real asynchronous gap" — and the product-owner decision requires that this gap
introduce **no** new risk: no default overwriting stored data, no dropped timing results,
no unintended rewrites, and no cross-domain contamination.

### 7.1 Mechanism

For each of the six domains wired through `TrackerApp.tsx`'s mount/save-effect pattern
(#1–#7 minus the preferences repository, which is exempt — see 7.5), the application layer
maintains one boolean **hydration flag** per domain (e.g. `sessionHydrated`,
`historyFiltersHydrated`, `assessmentHydrated`, `trainingPlansHydrated`,
`accuracyProfilesHydrated`, `smartRandomProfilesHydrated`). Each flag:

1. **Starts `false`.**
2. Is set to `true` **exactly once**, inside the mount-time load sequence, in the same
   state-update batch as the corresponding domain state being set to its resolved value
   (real data, repaired/migrated data, or the domain's own defined default/absence value —
   Section 5's per-method absence semantics apply unchanged).
3. **Always eventually becomes `true`** — see 7.3 for why a load "failure" cannot leave a
   domain stuck un-hydrated.

Each domain's save effect gains an explicit guard:

```js
if (!sessionHydrated) return;
// ...existing save logic, unchanged...
```

This generalizes the ad hoc guard that already exists for exactly 2 of 7 domains today
(`if (!currentSession) return;`, `if (!assessmentState) return;`) into a uniform rule
applied to all 6 relevant domains, closing the write-guard gap identified in Section 2.1
for the other 4. **This is not a change to any domain's steady-state persisted value** — a
hydrated domain's save effect behaves exactly as today; the guard only prevents a write
from firing *before* hydration completes, which today's synchronous load already
prevented in practice (Section 2.1) and which an asynchronous load would not, absent this
guard.

### 7.2 Preventing defaults from overwriting stored data

Directly satisfied by 7.1's guard: no domain's save effect can fire with its React state
still at its **initial default** value, because the guard is closed until hydration
completes — and hydration only completes once the *loaded* value (not the initial default)
has been set. This closes the exact risk identified in Section 2.1: today, `sessionHistory`,
`historyFilters`, `trainingPlans`, `accuracyToleranceProfilesState`, and
`smartRandomProfilesState` all have unguarded save effects that fire with their initial
default (`[]` or an empty-state object) on the very first render, before the mount
effect's corrected `setState` has been processed — self-correcting today only because
everything happens synchronously. The hydration guard makes this safe unconditionally,
regardless of how long the load takes.

### 7.3 Timing providers cannot emit processable results before the session is ready

The Timing Simulator's subscription effect (`TrackerApp.tsx:730`, declared *before* the
session-load effect at `:756`) must not call `simulatorProvider.start()` until
`sessionHydrated` is `true`. Concretely: the effect's body is gated
(`if (!sessionHydrated) return;`), and `sessionHydrated` is added to its dependency array,
so the effect re-runs once hydration completes and performs the real subscribe+start at
that point — never before. A future real hardware `TimingProvider` must follow the same
gate.

This closes the risk identified in the product-owner review: `processIncomingTimingResult`
reads `sessionRef.current` and silently drops a result if it's `null`
(`TrackerApp.tsx:586-587`) — today this window is negligible (pure synchronous JS between
simulator-start and session-load); under an asynchronous load, without this gate, it would
widen into a real, silent-data-loss window. `processIncomingTimingResult`'s existing
`if (!session) return;` guard remains as defense-in-depth, but the primary fix is: the
provider is never started early enough for this to matter.

### 7.4 Deliberate hydration completion on absence, malformed data, and load failure

Per Section 5, every `load*` method **always resolves** — it never rejects, for malformed
data (existing degrade-to-default behavior, Section 3) or for a genuine adapter-level read
failure (Section 8 explains why read failures are treated identically to absence). This
means hydration for a given domain has exactly one path to completion, not a
success/failure fork: `await repository.loadX()` always returns a value, that value is
always used to set the domain's state, and the domain's hydration flag always flips to
`true` immediately afterward, in the same batch. **There is no scenario in which a domain
is left permanently un-hydrated** — the worst case (a genuine storage failure) still
completes hydration with the domain's safe in-memory default, exactly as if nothing had
ever been stored.

### 7.5 Stale asynchronous completions after unmount are ignored

Each domain's mount-time load sequence uses a cancellation guard set in the effect's
cleanup function:

```js
useEffect(() => {
  let cancelled = false;
  sessionRepository.loadCurrent().then((loaded) => {
    if (cancelled) return;
    setCurrentSession(loaded ?? createNewSession());
    setSessionHydrated(true);
  });
  return () => { cancelled = true; };
}, []);
```

A load `Promise` that resolves after the owning component has unmounted (or, in a future
architecture, after the specific load call is no longer relevant) never calls `setState`.
This is the standard, minimal pattern for this exact problem and introduces no new
abstraction.

**Exemption for `AssessmentPreferencesRepository`**: its three keys are read on demand
from `AssessScreen.tsx` at arbitrary interaction points, never from an always-on mount
effect with a corresponding save effect. There is no hydration flag, no write-guard, and
no unmount-cancellation concern for this repository — each `get`/`set` call is a single,
self-contained, already-async-safe operation with no steady-state "hydrated" or
"un-hydrated" state to speak of.

### 7.6 First post-hydration render does not cause unintended rewrites

The freshly-loaded value is written back to storage on the render immediately following
hydration, because the domain's state changed (from initial default to loaded value) in
that same render, and the save effect's dependency array includes that state. **This is
not new or unintended** — it is exactly what happens today already (the existing
synchronous load-then-save-effect sequence already re-persists the freshly-migrated value
immediately after loading it; this is an accepted, harmless, idempotent consequence of the
one-effect-per-key pattern, not a defect this design introduces or must avoid). What the
hydration guard prevents is a **different** rewrite: a write of the *stale initial
default* before the real value has loaded (Section 7.2) — that is the only "unintended
rewrite" this design is required to close.

### 7.7 One domain's failure does not corrupt another domain's hydration

Each domain's load-and-hydrate sequence (7.5's pattern) is independent — six separate
`useEffect`s, six separate `.then()` continuations, six separate hydration flags. A
storage-layer failure in one domain's `loadX()` call (Section 8) resolves to that domain's
own default and flips only that domain's flag; it has no code path that touches any other
domain's state, effect, or flag. No `Promise.all`/sequential-await chain across domains is
introduced — each domain's mount effect is independent today (one `useEffect` per
concern) and stays independent under this design.

### 7.8 Required integration and E2E tests

- **Overwrite-prevention (integration):** mock a `StorageAdapter` with an artificially
  delayed `get()`; assert `set()` is never called for that domain's key(s) until after
  `get()` resolves and the corresponding state update has committed.
- **Provider-gating (integration):** spy on the (simulated) `TimingProvider.start()`;
  assert it is never called before `sessionHydrated` becomes `true`, using a delayed
  `SessionRepository.loadCurrent()` to create an observable window.
- **Deliberate completion on failure (integration):** mock `loadX()` to reject (or, per
  Section 8, resolve as if storage were unavailable); assert the domain's hydration flag
  still becomes `true` and its state becomes the documented default, within a bounded time.
- **Domain isolation (integration):** mock one domain's `loadX()` to hang indefinitely (or
  reject) while another domain's resolves normally; assert the second domain hydrates
  and its save effect becomes active regardless of the first.
- **Unmount-safety (integration):** unmount the component before a pending `loadX()`
  resolves; resolve it afterward; assert no `setState`-after-unmount warning and no
  corresponding `set()` call.
- **Reload regression (E2E, extends `tests/e2e/reload.spec.ts`):** seed realistic data
  across all domains, reload, and assert the UI never renders an empty/default view before
  showing the loaded content, and that no domain's final stored value ever equals its
  empty/default serialization when real data was seeded.

## 8. Error model

**One small, application-owned error shape, used consistently by every write method in
Section 5** — distinguishing only failures a caller could plausibly handle differently:

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

**The `StorageAdapter` — and only the `StorageAdapter` — classifies raw browser
exceptions into this shape.** This is stated explicitly to resolve an inconsistency the
product-owner review identified: Section 4.A names the adapter as "the only component that
knows about a specific browser storage mechanism," so the adapter, not each of the seven
repositories, is responsible for recognizing `DOMException`/`QuotaExceededError`/any future
IndexedDB-specific transaction error and translating it into one of the three variants
above before the rejection ever reaches a repository. A repository's write method simply
propagates whatever `PersistenceWriteResult`-shaped rejection reason the adapter produced
(or wraps a resolved value into `{ ok: true }` on success) — **no repository contains any
`instanceof DOMException` check or equivalent.** `DOMException`, `QuotaExceededError`, and
any IndexedDB-specific transaction error type never escape the `StorageAdapter`.

**Read paths never produce this error type at all.** Per Section 5's general rule, every
`load*` method always resolves. A genuine storage-layer read failure (the adapter's `get`
call itself failing, as distinct from the *data* being malformed) is treated identically to
"nothing stored" — the repository falls back to the domain's own documented absence value.
This is a deliberate, accepted tradeoff: it loses the ability to distinguish "nothing
stored" from "storage is broken right now" at the read path, in exchange for guaranteeing
hydration always completes deliberately (Section 7.4) and the app never blocks on a broken
read. A future diagnostic/telemetry hook could observe this distinction without changing
the repository contract — out of scope here.

## 9. Adapter and transactions

```typescript
/**
 * The only component in this design that knows about a specific browser storage
 * mechanism, and the only component that classifies its exceptions (Section 8).
 */
interface StorageAdapter {
  /** Never rejects for "not found" (`null`) or for malformed stored data — only for a
   * genuine storage-layer failure, translated to `PersistenceWriteError`'s shape by the
   * adapter itself (though, per Section 8, repositories never surface a read failure as
   * an error — they fall back to the domain default; the adapter's classification exists
   * so a repository *could* distinguish this in the future without an adapter change). */
  get(key: string): Promise<string | null>;

  /** Full overwrite, matching `localStorage.setItem`'s existing contract. Resolves once
   * durable per the backend's own guarantee. Rejects with a `PersistenceWriteError`
   * (Section 8) on a genuine failure — including a synchronous `localStorage.setItem`
   * throw (e.g. Safari private-mode `QuotaExceededError`), which the `localStorage`
   * implementation of this interface must catch and convert into a rejected `Promise`,
   * never let propagate as an uncaught synchronous exception. */
  set(key: string, value: string): Promise<void>;
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

**No `remove` operation is needed.** Confirmed: nothing in the current codebase calls
`localStorage.removeItem` (Section 2) — every "delete"/"clear" action is a full overwrite
with a smaller/empty value. Adding an unused capability now would be speculative; if a
future task introduces real key deletion, add `remove` then, with its own review of what
"delete" should mean per domain.

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

## 10. Migration path to IndexedDB (staged; documentation only in this pass)

1. **Introduce repository boundaries, retain the `localStorage` backend.** Implement
   `StorageAdapter` (Section 9) wrapping `localStorage`. Implement all 7 repositories
   (Section 5), each calling the *existing, unchanged* migration functions. Replace
   `TrackerApp.tsx`'s direct `localStorage.getItem`/`setItem` call sites with the
   corresponding repository calls, wired through the hydration design (Section 7) — this
   is the only runtime-behavior-relevant step in the whole migration path, and it must
   produce **zero visible behavior change** beyond the hydration-safety guard itself
   (Section 7.1's note on why that guard is not a behavior change).
2. **Contract-test the new repositories** (Section 11) before or alongside step 1's
   `TrackerApp.tsx` call-site replacement.
3. **Introduce an IndexedDB adapter behind the same `StorageAdapter` interface** (or a
   richer one, per Section 9's "may later expand" note). No repository or domain-logic
   code changes — only a second adapter implementation is added.
4. **Migrate existing browser data without loss.** On first load under the IndexedDB
   adapter, for each of the 10 keys: read the existing `localStorage` value (still
   present, untouched), run it through the *same* existing migration function used today,
   write the migrated result into IndexedDB, and — critically — **do not delete the
   `localStorage` copy yet** (see step 5).
5. **Verify migrated data before considering cleanup of legacy storage.** A separate,
   later step, never an automatic consequence of a successful first read.
6. **Before IndexedDB becomes the authoritative write target, obtain a separately
   approved activation-and-rollback design.** Retaining legacy `localStorage` (step 4) is
   **not, by itself, a safe rollback strategy once the application starts writing new
   data to IndexedDB only** — any record created *after* that cutover exists solely in
   IndexedDB, so rolling back to an older, `localStorage`-only build would make that
   record invisible to the rolled-back build, not merely "unsynced." A real rollback
   strategy needs either a dual-write transition window, an explicit, reversible
   feature-flagged cutover point, or some other mechanism — **which mechanism is used is
   explicitly deferred** to that future, separate decision; this document only requires
   that the decision be made deliberately, not implied by "we kept the old data around."

### 10.1 Explicit handling of each required migration risk

- **Interrupted migrations.** Per-key migration (step 4) must be independently retryable:
  if the browser closes mid-migration after key #3 but before key #4, the next load must
  detect that #4 is not yet migrated and migrate it, without re-migrating #1-#3 in a way
  that could duplicate or corrupt already-migrated data. This requires each per-key
  migration step to be idempotent at the IndexedDB-write side, not just at the existing
  `migrate*` function's side (already idempotent per ADR-0005) — the latter must be
  designed explicitly at implementation time.
- **Partially migrated domains.** Migration state must be tracked per-domain, not as one
  global boolean — a partial migration is a normal, expected intermediate state. Where
  this per-domain flag lives is an open question (Section 13) — it must not silently
  become an undecided 11th `localStorage` key.
- **Malformed JSON.** Handled identically to today — degrades to absent/default, never
  thrown as a fatal error, during the read-for-migration step.
- **Unknown schema versions.** Handled identically to today for domains #4-#7; "unknown
  version" doesn't apply to domains #1-#3 (unversioned).
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
- **Downgrade behavior.** Not solved by this design — an explicit open question (Section
  13). As long as step 4's `localStorage` copy is retained and step 6's activation
  decision has not yet made IndexedDB the sole write target, an older build can keep
  reading `localStorage` unaffected. Once IndexedDB becomes authoritative (step 6), full
  downgrade safety requires whatever mechanism that separate decision specifies.
- **Validation before legacy-data deletion.** Required, not optional: before any
  `localStorage` key is deleted, the corresponding IndexedDB data must be read back and
  compared against the migrated (not raw) value for structural/value equality, for every
  record. The exact comparison mechanism is an implementation-time detail, not decided
  here — but skipping this step is not authorized.
- **Idempotent retry behavior.** Every migration step must be safe to run again from
  scratch — a second run overwrites with the same result, never duplicates or appends.
- **The `blocks` vs. `blocks: []` distinction.** Unaffected — enforced entirely inside
  `migrateBlocks`, called unchanged by the migration step.
- **The existing field-repair vs. whole-record-discard philosophies.** Both preserved
  unchanged, for the same reason: the migration step always calls each domain's existing
  function, never a new generic one.

## 11. Testing sequence

Six distinct, explicitly ordered stages — resolving the sequencing ambiguity the
product-owner review identified in the original draft (which conflated "characterize old
behavior" with "contract-test the new repository shape," when no repository shape exists
yet at the point the first characterization tests are written):

1. **Characterization tests for current direct-storage behavior.** Written against
   `TrackerApp.tsx` **as it exists today** — real component tests (React Testing Library,
   as the existing `TrackerApp.*.test.tsx` suite already does), asserting today's actual
   `localStorage` reads/writes, effect order, and guard behavior (including the
   write-order finding in Section 6.1 and the unguarded-effect finding in Section 2.1).
   These run against the *current* code, before any repository exists, and capture the
   baseline this whole effort must not silently change.
2. **Repository contract tests for the new `localStorage`-backed repositories.** Written
   against the Section 5 interfaces once they exist — a distinct, new test suite, not a
   re-run of stage 1's tests. Stage 1's captured expectations are *ported* into stage 2's
   assertions (same behavior, expressed against the new interface), not executed as the
   same test code against two different backends.
3. **The same stage-2 contracts, run unmodified against a future IndexedDB
   implementation.** Only possible because Section 5's contracts are defined entirely in
   terms of domain objects and `Promise`s, never `localStorage`-specific behavior. A test
   that only passes against one backend has found either a real behavioral difference (a
   bug in the newer backend) or a wrong assumption in the test itself.
4. **Hydration and wiring integration tests** (Section 7.8) — verifying the hydration
   guard, provider-gating, unmount-safety, and domain-isolation properties, which have no
   equivalent in stage 1 (today's code has no asynchronous hydration to test).
5. **E2E persistence regressions** — extending `tests/e2e/reload.spec.ts` and
   `tests/e2e/corrupt-persistence.spec.ts` to exercise the full, real browser stack against
   the repository-backed implementation, confirming stage 1's characterized behavior still
   holds end-to-end.
6. **Architecture-enforcement test against unapproved direct storage access.** Required
   during implementation (not deferred, per the binding product-owner decision): a
   static-analysis or lint-based test asserting no file outside the approved
   `StorageAdapter`/repository modules references `localStorage`/`indexedDB` directly.
   Still not built in this documentation-only pass — this section records that it is
   required as part of the implementation task, not an optional later follow-up.

Each domain (all 7 repositories) requires coverage at stages 1-3 for: empty storage, a
valid round trip, an update, the domain's actual reset/clear semantics, a malformed
payload, current migration behavior (including the `blocks`/`blocks: []` case for domains
#1-#2), an unknown schema version where applicable (#4-#7), isolation from other domains,
and failed-write behavior (Section 8). At minimum, dedicated stage-1/2/3 coverage is
required for current session, session history, Assessment, and `HistoryFiltersRepository`
(standing in for "settings"), per the task's explicit requirement — but this applies
uniformly to all 7, not just those four, since a boundary proven correct for 4 of 7
domains is not yet trustworthy for the other 3.

## 12. Future sync compatibility (seam only — not a sync protocol)

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
  (Section 10.1). Sync metadata (last-synced-at, a pending-write flag, a server-assigned
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
  belonging to that later phase.

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
(`archiveCurrentToHistory`) the original draft proposed. No repository method in this
revision claims cross-key atomicity. A future, separately-approved decision may introduce
one (Section 6.4).

### 7. How repository errors should be exposed without coupling the UI to browser APIs

**Resolved: the three-variant `PersistenceWriteError`/`PersistenceWriteResult` shape**
(Section 8), classified exclusively by the `StorageAdapter`.

### 8. How to prevent React components from bypassing the persistence boundary

**Resolved: an architecture-enforcement test is required during implementation**
(Section 11, stage 6) — no longer an optional, indefinitely-deferred follow-up. The test
itself is not written in this documentation-only pass.

### 9. What must be decided now vs. what should remain deferred

**Decided now** (this document's recommendations): the 7-repository grouping; the
`StorageAdapter` shape; the `Promise`-returning, always-resolving-on-read contract; the
three-variant error type and adapter-side classification; that `localStorage` deletion is
never automatic after a first successful migrated read; that session archiving is not
composed into one repository method in Phase 1; the hydration design (Section 7).

**Explicitly deferred**: per-domain migration-progress tracking's storage location; the
exact equality-check mechanism for pre-deletion validation; the IndexedDB
activation-and-rollback mechanism (Section 10, step 6); a transactional/safer-ordered
session-archive operation and retry deduplication (Section 6.4); downgrade behavior once
IndexedDB becomes authoritative; anything about sync metadata, conflict resolution, or
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
- **`PERSISTENCE_BOUNDARY_REVIEW_HANDOFF.md`** (repository root, untracked) is the
  product-owner review this revision responds to — see its findings A–J for the full
  evidence trail behind every change in this revision.
- **`PERSISTENCE_BOUNDARY_REVISION_REPORT.md`** (repository root, untracked) records
  exactly what changed between the original draft and this revision, for traceability.
