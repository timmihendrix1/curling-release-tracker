# Persistence Boundary Design

**Status:** Accepted. Implemented. Companion to
`docs/adr/0013-application-owned-persistence-repository-boundary.md`. Phase 1
(everything this document describes: the `StorageAdapter`, all seven repositories, the
three-state hydration model, the interaction-boundary gating of Section 7.10, and the
wiring into `TrackerApp.tsx`/`AssessScreen.tsx`) was implemented on
`feature/persistence-boundary-phase-1`, with one follow-up correction commit closing the
interaction-boundary gap `PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md` identified — see
`PERSISTENCE_BOUNDARY_PHASE1_CORRECTION_REPORT.md`. No storage key, stored shape,
migration behavior, or deduplication behavior changed at any point. See
`docs/SYSTEM_ARCHITECTURE.md`'s "Persistence boundary" section for the as-built summary,
and `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §18, "Phase 1: Persistence
boundary (Implemented)." The IndexedDB adapter described in Section 10 remains
unimplemented (Phase 2).

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

### 6.5 The write-order property is adapter-contingent, not a structural guarantee (added in Revision 4)

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

Applied per domain:

- **History Filters** — the interactive filter control is not rendered while
  `historyFiltersHydration === "loading"` (a minimal loading placeholder stands in
  instead); it renders normally once `"ready"` or `"write_protected"`. Unlike the
  collection domains, History Filters may remain interactive after `"write_protected"` —
  it is a single, always-overwritten preference object, not a collection that could be
  partially clobbered, and its own save effect already refuses to persist anything for a
  write-protected domain, so an in-memory-only change is harmless. The UI never presents
  this as a saved preference either way.
- **Training Plans** — the "Training Plans" tab (not the ad-hoc Quick Start subtree,
  which neither reads nor mutates this collection) is disabled while
  `trainingPlansHydration !== "ready"`, so the library/editor/start-review screens are
  simply unreachable until the real collection has loaded.
- **Accuracy Tolerance Profiles / Smart Random Profiles** — the "Manage Accuracy
  Tolerances"/"Manage Smart Random Profiles" entry points are disabled while their
  respective hydration state `!== "ready"`, for the same reason.
- **Session** — its `"loading"` case was already safe structurally (the pre-existing
  `if (!currentSession) return null;` render gate means nothing renders, so nothing can
  be interacted with, before Session's own load resolves). Its `"write_protected"` case
  was not: once write-protected, `currentSession` holds the display-only fallback and is
  non-null, so the full UI would otherwise render normally. Every Session-mutating
  handler (`handleStartNewSession`, block creation/editing, session-history delete/clear,
  manual shot entry, Auto Capture start, etc.) now guards on `sessionHydration === "ready"`,
  and `processQueuedTimingResult`'s non-Assessment branch carries the same guard — closing
  both the classic manual-entry path and the Timing Simulator/Auto Capture path, which
  both funnel through that one function (see "Manual entry and future sensor input share
  one domain flow" in `CLAUDE.md`). The Timing Simulator's subscription effect already had
  the equivalent guard (7.4).
- **Assessment** — `updateAssessmentState`, the one function `AssessScreen.tsx` uses to
  mutate Assessment state, now also guards on `assessmentHydration === "ready"` (it
  previously only checked for a non-null ref, which a `"write_protected"` fallback
  satisfies).
- **`AssessScreen.tsx` preferences** — the three preference reads (last threshold preset,
  last custom threshold, show-introduction) are hydrated together, once, by a single
  mount-time effect, rather than by three independent effects/action-time reads. The
  threshold-preset/custom-threshold controls do not render until that settles, closing the
  default-then-correction window entirely. `handleViewAssessment` no longer performs its
  own read; it reads the already-hydrated preference value synchronously — the preferred
  fix per the correction's binding requirements, since it removes the pending-Promise
  supersession risk by construction rather than adding an explicit request-invalidation
  mechanism on top of it.

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

**This section covers Phase 2 (IndexedDB) only.** The Phase 1 (`localStorage`-backed
repository boundary, including hydration and testing) sequence is now specified once,
authoritatively, in Section 11 — this section no longer restates or overlaps with it,
resolving an ordering ambiguity in Revision 1 that could be read as permitting
`TrackerApp.tsx` wiring changes (its old step 1) before characterization tests existed
(its old step 2, "before or alongside"). Phase 2 begins only after Section 11's sequence
is complete.

1. **Introduce an IndexedDB adapter behind the same `StorageAdapter` interface** (or a
   richer one, per Section 9's "may later expand" note). No repository or domain-logic
   code changes — only a second adapter implementation is added.
2. **Migrate existing browser data without loss.** On first load under the IndexedDB
   adapter, for each of the 10 keys: read the existing `localStorage` value (still
   present, untouched), run it through the *same* existing migration function used today,
   write the migrated result into IndexedDB, and — critically — **do not delete the
   `localStorage` copy yet** (see step 3). If the `localStorage` read itself fails
   (Section 8.2's `"read_failed"`), that key's migration is skipped and retried on a later
   load, per the same write-protection principle as Section 7 — a failed read must never
   be treated as "confirmed nothing to migrate."
3. **Verify migrated data before considering cleanup of legacy storage.** A separate,
   later step, never an automatic consequence of a successful first read.
4. **Before IndexedDB becomes the authoritative write target, obtain a separately
   approved activation-and-rollback design.** Retaining legacy `localStorage` (step 2) is
   **not, by itself, a safe rollback strategy once the application starts writing new
   data to IndexedDB only** — any record created *after* that cutover exists solely in
   IndexedDB, so rolling back to an older, `localStorage`-only build would make that
   record invisible to the rolled-back build, not merely "unsynced." A real rollback
   strategy needs either a dual-write transition window, an explicit, reversible
   feature-flagged cutover point, or some other mechanism — **which mechanism is used is
   explicitly deferred** to that future, separate decision; this document only requires
   that the decision be made deliberately, not implied by "we kept the old data around."

### 10.1 Explicit handling of each required migration risk

- **Interrupted migrations.** Per-key migration (step 2) must be independently retryable:
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
  13). As long as step 2's `localStorage` copy is retained and step 4's activation
  decision has not yet made IndexedDB the sole write target, an older build can keep
  reading `localStorage` unaffected. Once IndexedDB becomes authoritative (step 4), full
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

**Explicitly deferred**: per-domain migration-progress tracking's storage location; the
exact equality-check mechanism for pre-deletion validation; the IndexedDB
activation-and-rollback mechanism (Section 10, step 4); a transactional/safer-ordered
session-archive operation and retry deduplication (Section 6.4); any automatic-retry or
recovery UX for a `"write_protected"` domain (Section 7.1); downgrade behavior once
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
  exactly what changed between the original draft and Revision 1, for traceability.
- **`PERSISTENCE_BOUNDARY_FINAL_REVIEW.md`** (repository root, untracked) identified the
  read-failure/absence conflation this Revision 2 corrects, and records what changed
  between Revision 1 and Revision 2.
