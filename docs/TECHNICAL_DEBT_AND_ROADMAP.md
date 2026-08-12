# Technical Debt and Roadmap

## Purpose

A prioritized, honest inventory of the current implementation's rough edges — so future
work picks the right thing to fix, and doesn't fix things that aren't actually costing
anything yet. Not every technical imperfection is technical debt; something only
belongs here if it has a real, describable cost.

Priority buckets: **Now** (actively causing or risking harm) · **Soon** (will start
costing real time within the next few feature passes) · **Later** (correct to fix
eventually, no pressure today) · **On demand** (only worth touching if a specific new
requirement needs it).

See `docs/SYSTEM_ARCHITECTURE.md`'s "Current Implementation Snapshot" for the full
context behind each item.

---

## Now

None. Nothing in the current codebase is actively causing incorrect behavior, data
loss, or a blocked feature. (If that changes, this section is where it goes.)

---

## Soon

### Growing migration complexity

**What:** `sessionMigration.ts` has grown a normalization/backfill branch for every new
Training Mode and Target Source (Legacy Block, Variable Weight, Blind Weight, Smart
Random ranges, Hog-Hog-forced-to-Manual...). Each addition is currently small and
well-tested in isolation, but the function is accumulating conditional branches.

**Impact:** Medium (a missed case silently produces a wrong or crashing session on
load — this is the one place where a bug affects *every* user's existing data, not just
new usage). **Likelihood of a future mistake:** Medium and rising with each new mode.
**Urgency:** not yet, but trending toward "Now" as more modes are added.

**Recommended fix, when it becomes worth it:** extract a small, explicit "backfill
rule" table (one entry per optional field, each entry pure and independently testable)
instead of one growing function with nested conditionals — same behavior, easier to
reason about the Nth addition. Don't do this preemptively; do it the next time adding a
mode makes the current function genuinely hard to follow.

**Related, not a substitute:** `docs/PERSISTENCE_BOUNDARY_DESIGN.md` and
`docs/adr/0013-application-owned-persistence-repository-boundary.md` (Accepted.
Implemented) put a repository boundary around `migrateSession` and every other persisted
domain's migration function, calling each unchanged — that work does not itself reduce
`sessionMigration.ts`'s branching, and was not a prerequisite for the backfill-rule-table
fix described above.

### CSV schema stability

**What:** The CSV export column set has already been reordered once (`predicted_time`
moved earlier, several columns added across three feature passes). There is no
versioning or stability guarantee for the exported schema.

**Impact:** Low today (no known downstream consumer parses this CSV by position), but
grows every time a real user builds a spreadsheet/analysis on top of an export.
**Recommendation:** before the next schema change, decide and document whether column
order is a stability guarantee going forward, or whether consumers are expected to read
by header name (the current code already assumes the latter internally — tests locate
columns by name, not position). Worth a one-line note in `export.ts` once decided.

---

## Later

### Scatterplot trend lines (Target vs. Actual) — deliberately not built

**What:** The product spec for the Analytics/Visualization overhaul (ADR-0008) allows
an optional per-handle regression trend line on `TargetActualScatterChart`, gated on
≥5 shots and ≥3 distinct target times. This pass ships the scatterplot itself (with the
"becomes more informative with multiple targets" hint) but does **not** add the
regression line — building it well (clean slope calculation, no false precision, no
automatic performance judgement) is a real, separable piece of work, and a half-built
trend line would be worse than none.

**Recommendation:** implement `computeLinearRegression(points)` as a small pure
function in `chartData.ts` (slope/intercept over `{ x: targetTime, y: actualTime }`),
gated by the exact thresholds above, the next time this becomes a real ask — the
scatter chart's data contract already carries everything needed.

### Blind Weight's optional Prediction-Accuracy charts — deliberately not built

**What:** "Prediction Error by Shot" and an "Actual vs. Predicted" scatterplot were
listed as optional, low-effort additions during the Analytics/Visualization overhaul.
Not built in this pass — Target Accuracy charts already work for Blind Weight shots
(judged against `targetTime`, same as every other mode), and the existing Prediction
Dashboard cards (bias/MAE/SD/correlation) remain the only Prediction-Accuracy surface.

**Recommendation:** if requested, model them as `chartData.ts` functions mirroring
`prepareTargetErrorByShotData`/`prepareTargetVsActualScatterData` but keyed on
`predictedTime` instead of `targetTime` — reuse the same chart shell
(`ChartCard`/`TargetErrorChart`-shaped component), don't build a parallel one.

### ~~Session-level rollup can mix Measurement Modes for its Bias tendency label~~ — Resolved (History Filtering pass)

**What it was:** History's per-session summary cards used to compute one
`TargetAccuracyAnalytics` across every block in a session, which could include both
Back-Hog and Hog-Hog blocks.

**Resolution:** the central `HistoryAnalysisFilters.measurementMode` (see
`src/lib/historyAnalysis.ts` and `SYSTEM_ARCHITECTURE.md`'s "History Analytics and
Filtering") is now applied *before* any session grouping happens — every block in every
`historySessionGroups` entry already shares one Measurement Mode, so the Blocks/Sessions
list's per-session rollup can no longer mix modes. The "Measurement modes vary" note is
kept only as a defensive check (relevant if a session's blocks span categories the
current filters didn't fully narrow down), not as a routine caveat.

Threshold snapshots can still differ across blocks within a session under **Original**
Threshold Comparison Mode — `aggregateTargetAccuracyAcrossBlocks` correctly categorizes
each shot against its own block's threshold rather than one representative value; only
the *display label* ("within ±0.10s") falls back to a representative value
(`representativeThresholds`) when they disagree, same approximation as before, now
scoped to a much narrower, already-filtered selection.

### `TrackerApp.tsx` as the single orchestration file

**What:** ~1,470 lines, owns all app-level state. See `SYSTEM_ARCHITECTURE.md`'s
assessment — this is not urgent, since the actual domain logic is already extracted
into `src/lib/`; what's left is largely thin orchestration.

**When to revisit:** the first time a new feature would have to be wedged into this
file in a way that clearly duplicates an existing boundary (History rendering, the
Blind-draft-leave guard, or the shot-edit form are the most self-contained extraction
candidates when that happens).

### No historical shot editor for `predictedTime`

**What:** The existing inline shot editor (release time, handle, shot type) does not
support editing a saved Blind Weight shot's `predictedTime` after the fact. It simply
doesn't render the field.

**Impact:** Low (a genuine typo in a locked-in prediction can't be corrected after
saving; the shot can still be deleted and re-entered). **Recommendation:** add
`predictedTime` to the existing edit form when there's a real request for it — no
architecture blocks this, it just isn't built.

### ~~No Blind Weight trend in `SessionTrendChart`~~ — Resolved (History Filtering pass, by removal)

**What it was:** The cross-session trend chart showed session-level `Bias`/`Avg Abs
Deviation` only, with no Blind-specific series, since its unit of aggregation (one point
per *session*) didn't cleanly fit a per-*block* metric.

**Resolution:** `SessionTrendChart.tsx` has been removed rather than extended. The
History information hierarchy's Progress Metric Chart already aggregates **per
comparable Training Block** (never per session), for whichever Training Category and
Measurement Mode the central filters currently select — this includes Blind Weight
exactly like every other category, since Target Accuracy is category-agnostic (Blind
Weight's separate Prediction Accuracy metrics remain in the Key Progress Summary and the
Blocks/Sessions detail list, never merged into Target Accuracy). A session-level-only
trend concept no longer exists to have a gap in.

### Unused `updateSmartRandomRange`

**What:** `trainingBlocks.ts` exports `updateSmartRandomRange` (clamp/replace
`pendingTargetTime` when a range changes) — used today only by migration's
range-backfill path. There is no UI to edit a Smart Random range on an already-active
block; this function is the ready-made implementation for that feature, unused until it
exists.

**Impact:** None currently (dead code from a UI's perspective, but real code from
migration's). **Recommendation:** leave as-is; wire a settings UI to it if/when
mid-block range editing becomes a real feature, rather than removing "unused" code that
is actually load-bearing for migration.

### Many optional fields on `TrainingBlock`

**What:** `variableTargetMode`, `blindTargetMode`, `smartRandomMin`, `smartRandomMax`,
`pendingTargetTime` are all optional and only meaningful in combination with `mode` and
each other — see `SYSTEM_ARCHITECTURE.md`'s explicit warning against conflating them.

**Impact:** Low today (`getEffectiveTargetMode` centralizes the one place that has to
understand the combination), but every new mode/target-source combination adds another
optional field or another meaning to an existing one.

**Recommendation:** if a fourth Training Mode is ever added, consider whether the
target-source fields should become one discriminated sub-object
(`block.targetConfig: { source: ..., ... }`) instead of continuing to add
mode-prefixed optional fields — but only if a fourth mode actually arrives; two modes
sharing `getEffectiveTargetMode` today does not yet justify the migration cost of that
change.

### Possible setup-form duplication

**What:** The "target for next shot" display + editable-input pattern (value, `Auto`
badge, reset-on-external-change local state) is implemented independently in
`ShotEntry.tsx` and `BlindShotEntry.tsx` — deliberately not extracted into a shared
component/hook during the Blind Weight pass, to avoid a rushed abstraction under a
large task. The two implementations are currently in sync but could drift.

**Impact:** Low (small, self-contained code; a mismatch would be a UI inconsistency,
not a data bug). **Recommendation:** extract a small shared hook
(`useEditableTargetInput`) the next time either file needs a real change to this
behavior, so the extraction is driven by an actual edit rather than done speculatively.

### Scatterplot combining Fixed and Variable Weight in one selection — deliberately not built

**What:** The History Analytics pass's spec allowed combining Fixed and Variable Weight
shots in one Scatterplot when "deliberately selected and the Measurement Mode is
compatible." This pass's Training Category filter is single-select (one category at a
time) — Progress, Shot Quality, and the Scatterplot all read from whichever one category
is currently selected. A dedicated "combine these categories" control was not built, to
avoid a rushed multi-select filter design under an already-large task.

**Impact:** Low (every other required Scatterplot case — multiple Fixed Weight blocks,
Variable Weight, multiple sessions, In/Out together — already works over the current
single-category selection).

**Recommendation:** if a real ask for this arrives, extend `trainingCategory` to accept
an array (or add an explicit "Include other categories" toggle in "More filters") and
make `buildHistoryAnalysisContext` accept a `TrainingCategory[]` — the underlying
per-block filtering/aggregation already generalizes to that case without restructuring.

### Unused `groupProgressEntriesByMeasurementMode`

**What:** `chartData.ts` still exports `groupProgressEntriesByMeasurementMode`, no
longer called from `TrackerApp.tsx` — the central History filter pipeline
(`historyAnalysis.ts`) now resolves `HistoryAnalysisFilters.measurementMode` to exactly
one mode before `progressEntries` is ever built, so there is nothing left to group by
mode. Kept (not deleted) because the rule it encodes — Back-Hog and Hog-Hog must never
share a series — is still fundamental, it remains covered by its own passing unit test,
and removing it would be pure code deletion with no current behavior change.

**Recommendation:** delete it only alongside a change that actually needs to re-mix
Measurement Modes before this function would be reintroduced (e.g. an "All modes" view),
not preemptively.

### Custom Date Range has a type but no picker UI

**What:** `DateRangeFilter`'s `{ preset: "custom"; from; to }` shape and
`historyAnalysis.ts`'s filtering logic both support a custom range end-to-end, but
`HistoryFilterBar.tsx` only exposes the four presets (All time / 30 / 90 / 6 months) in
its UI — no date-picker inputs were added for Custom, per the spec's own "Custom, falls
ohne grossen Zusatzaufwand möglich" allowance; a good two-date-input picker with
validation was judged more than the "no big extra effort" bar for this pass.

**Recommendation:** add two date inputs (from/to) to the primary Date Range control,
gated behind a "Custom…" option, the next time this becomes a real ask — no pipeline
change is needed, only the picker UI.

### Training Category help not surfaced in the Current Session header

**What:** `helpContent.ts`'s Training Category explanations (Fixed/Variable/Blind
Weight) are wired up at every Setup screen (first Setup, New Training Block) via
`InfoButton`s on the Training Mode/Measurement Mode option buttons. The Current
Session "Active Training Block" header (`TrackerApp.tsx`) — which also names the
active category inline — does not get one, since its category name is concatenated
into one dense paragraph alongside target/measurement-mode text rather than sitting
next to a clear label; adding an `InfoButton` there would need restructuring that
paragraph, not just adding a sibling icon.

**Impact:** Low — a user already saw the explanation when choosing the category at
Setup; this only affects re-discovering it later without reopening Setup.

**Recommendation:** if requested, extract the category name into its own labeled
span within that header (as a small, self-contained change) so an `InfoButton` can
sit next to it the same way it does in `TrainingSetup.tsx`.

### `InfoButton` popover has no full keyboard focus trap

**What:** `InfoButton.tsx` closes on Escape and returns focus to its trigger, but does
not trap Tab focus inside the open popover — Tab can move focus to whatever is next in
the page's normal tab order while the popover is still visually open.

**Impact:** Low (the popover is non-modal informational content, not a form; nothing is
lost by tabbing past it), but it's a real accessibility gap relative to a full ARIA
dialog pattern.

**Recommendation:** add a small focus-trap effect (cycle Tab/Shift+Tab between the
popover's first and last focusable element) if a stricter accessibility audit requires
it — not built preemptively for a lightweight info popover.

---

## On demand

### Persistence write-failure visibility, retry, and recovery UX — deliberately deferred

**What:** Since the Phase 1 persistence boundary (`docs/adr/0013-application-owned-persistence-repository-boundary.md`),
`localStorageAdapter` never lets a raw `DOMException`/`QuotaExceededError` escape — every
`save*`/`set*` call resolves a typed `PersistenceWriteResult`, `{ ok: false, error }` on
failure, instead of throwing. No call site in `TrackerApp.tsx`/`AssessScreen.tsx`
currently inspects that result; every write remains fire-and-forget. Likewise, a domain
that reaches `"write_protected"` (a genuine read failure) has no user-visible indicator,
no retry affordance, and no recovery workflow — it silently keeps working from the
display-only fallback for the rest of the session.

**Why this is deliberate, not an oversight:** ADR-0013 Decision 5/6 explicitly scoped
Phase 1 to "no automatic retry, no recovery UX" — introducing either now would exceed
what was reviewed and accepted. This is also **not** equivalent to the pre-Phase-1
behavior: previously, an uncaught `QuotaExceededError` thrown from a bare
`localStorage.setItem()` call inside a `useEffect` was at least visible (a console error,
and potentially an aborted commit); now it is a typed, contained, but completely silent
result. This is a deliberate trade documented in
`PERSISTENCE_BOUNDARY_PHASE1_CORRECTION_REPORT.md` (and, before it, the Phase 1 audit),
not a claim that nothing changed.

**Recommendation:** revisit if real users start hitting storage quota limits (unlikely at
current data volumes) or once a cloud/sync layer gives write failures new stakes. Any fix
should decide, explicitly, what the user sees for each of `"storage_unavailable"` /
`"quota_exceeded"` / `"unknown"`, and whether/how a `"write_protected"` domain can ever
retry — neither is designed today.

### IndexedDB adapter and transactional session archiving — construction done, migration/activation/atomicity still open

**What:** `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §10 describes a future IndexedDB-backed
`StorageAdapter` behind the same repository boundary. The sequencing half of this item is
resolved: `docs/adr/0014-session-archive-write-ordering.md` introduced
`SessionRepository.archiveAndReplace`, which coordinates the session-history and
current-session writes with a plain sequential `await` inside the repository method
itself (history-first, chosen as the safer-recoverable order for a non-atomic backend) —
this no longer depends on `localStorageAdapter`'s incidental synchronicity or React's
effect declaration order, closing the exact gap this item originally flagged.

**Now also done:** the adapter-construction substage (design doc §10 step 1) is
implemented — `src/lib/persistence/indexedDbAdapter.ts`'s `createIndexedDbAdapter()`,
backed by the `idb` package, against a two-store (`records`/`metadata`)
`curling-release-tracker` database — see
`docs/adr/0015-indexeddb-adapter-unwired.md`. It is not wired into any repository
singleton or component; `localStorage` remains the sole production source of truth.

**What remains open:** everything else in design doc §10 — migrating existing
`localStorage` data into IndexedDB (step 2), verification before any legacy-data cleanup
(step 3), and the activation-and-rollback mechanism required before IndexedDB could
become the authoritative write target (step 4) — plus true cross-key atomicity for
session archiving. ADR-0014 explicitly does not, and cannot, make the two writes atomic
under either backend — an interruption between them can still produce a recoverable
duplicate (never a loss, per ADR-0014's chosen ordering, but not "nothing happened
either"). True cross-key atomicity requires a real IndexedDB transaction spanning both
object stores, which the current adapter does not provide (its `get`/`set` remain a
single-key interface, exactly like `localStorageAdapter.ts`'s) — ADR-0014 documents the
seam (`archiveAndReplace`'s stable signature/failure-semantics) a future
transaction-based implementation can use without any change above the repository layer.

**Recommendation:** when migration/activation work is actually scheduled, implement
`archiveAndReplace`'s IndexedDB-backed version as one transaction over both object
stores rather than two sequential `set` calls — do not assume the current, still-
non-atomic `localStorage` implementation's behavior needs to be preserved beyond its
documented failure semantics (ADR-0014). Not urgent: no migration or activation work is
scheduled yet.

### `react-hooks/set-state-in-effect` lint warning on initial load

**What:** `TrackerApp.tsx`'s mount effect (`localStorage` read → `migrateSession` →
`setCurrentSession`) trips this lint rule. This is a **pre-existing** condition,
present before the Training Block / Variable / Blind Weight work and confirmed via
`git stash` at the time it was first investigated — not a regression from any of that
work.

**Why it's parked here instead of fixed:** the recommended fix (lazy `useState`
initializer reading `localStorage` directly) would run during SSR, where
`localStorage` doesn't exist, and risks a hydration mismatch between server and client
output — a worse problem than a lint warning. The current pattern (`useState(null)` +
effect + "render nothing until loaded") is the standard safe pattern for browser-only
initial state in a server-rendered app.

**Recommendation:** only revisit if a lint-clean baseline becomes a hard requirement
(e.g. CI enforcement); the fix would need explicit hydration testing, not just silencing
the rule.

### `eslint-plugin-react-hooks` gained two new stricter rules mid-project (`react-hooks/refs`, `react-hooks/immutability`)

**What:** Installing `@playwright/test` during the Capture Sequence hardening pass
caused `npm install` to also re-resolve `eslint-plugin-react-hooks` within its existing
`^7.0.0` semver range, picking up a newer version that added two new rules: refs may no
longer be mutated during a component's render body (`react-hooks/refs`), and a closure
may not reference a `function` declared later in the same component
(`react-hooks/immutability`). Both immediately flagged existing, working code in
`TrackerApp.tsx` (the ref-mirroring pattern for the Simulator subscription, and the
subscription effect referencing `processIncomingTimingResult` before its textual
declaration — safe at runtime via function-declaration hoisting, but not accepted by
this newer rule). Both were fixed in the same pass: ref mirroring moved into small
dedicated `useEffect`s instead of render-body mutation, and the capture-processing
functions were reordered to be declared before the effect that uses them.

**Recommendation:** no outstanding action — mentioned here so a future contributor
seeing this rule trip on a *new* piece of code understands it's an intentional,
already-adopted stricter baseline (matching a pattern this project's own `ShotEntry.tsx`
still uses for local *state* — that pattern is unaffected, this rule is specific to
*refs*), not a fluke to work around with an inline disable comment.

### ~~Missing formal Playwright test configuration~~ — Resolved (Capture Sequence pass)

**What it was:** End-to-end verification across every feature pass up to and including
Blind Weight had used ad hoc Node scripts driving Playwright directly
(`chromium.launch()` + manual assertions), not `npx playwright test` with a project
config.

**Resolution:** `playwright.config.ts` + `tests/e2e/*.spec.ts` + `npm run test:e2e` were
added during the Capture Sequence pass, covering Simulator Auto Capture, Manual
Fallback, Pause/Resume, Undo (exact Smart Random target restoration), Reload, and a
Regression group (classic manual entry, History navigation, New Training Block). The
config deliberately runs against `next dev`, not a production build — the Timing
Simulator is dev/test-only by design (gated by
`process.env.NODE_ENV !== "production"`), so a production server would hide the UI most
of this suite exercises. Shared setup helpers live in `tests/e2e/utils.ts`. Earlier
feature passes' ad hoc scripts were not retroactively ported — only kept as reference —
since this suite already exercises the same underlying flows they verified.

### No Blind Weight draft persistence across reload

**What:** Deliberate, documented product decision (see ADR-0002) — not a bug. Listed
here only so a future "should the draft survive reload?" conversation starts from "this
was a decision", not "this looks unfinished".

### External time discarded (not buffered) before prediction lock

**What:** Deliberate, documented placement for a not-yet-built feature (see
`docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`) — buffering only matters once a real
device exists and its early-arrival behavior is known. Building a buffer today would be
guessing at hardware behavior nobody has observed yet.

### A Capture Sequence result received while paused is discarded, not buffered

**What:** Same shape as the item above, for the newer Capture Sequence boundary
(`processTimingResult` returns `"ignored-paused"` for any result received while a
sequence is paused, and it is never re-delivered on Resume). Deliberate, not an
oversight — see `docs/SYSTEM_ARCHITECTURE.md`'s "Capture Sequences" section and
ADR-0006.

**Recommendation:** revisit only once a real (non-simulator, non-manual) provider
exists and its actual early/late-arrival behavior is known — building a buffer today
would be guessing.

### Auto Capture is not available for Blind Weight

**What:** `createCaptureSequence` throws for `mode === "blind"`; the UI shows an
explicit "not available yet" message instead of a half-working integration. Deliberate
scope decision for this pass, not an oversight — Blind Weight's predict-before-measure
requirement doesn't fit the current linear "receive result → save shot" processing
order without a real design pass. See `docs/SYSTEM_ARCHITECTURE.md`'s "Capture
Sequences" section.

**Recommendation:** if/when this becomes a real ask, design the predict-lock step as an
explicit state the Capture Sequence must pass through before a `TimingResult` is
allowed to resolve the shot — don't retrofit it as a special case inside
`processTimingResult`'s existing linear order.

### A stale delayed result can be attributed to a *new* sequence started after a Cancel

**What:** A `TimingResult` carries no sequence identity (real hardware wouldn't have one
either). Cancelling a sequence correctly rejects any result that arrives afterward *for
that sequence* (status-checked at processing time, not emission time). But if a **new**
sequence is started for the same block before a stale, in-flight delayed result arrives,
that result is attributed to the new, running sequence as its next shot — there is no
"generation token" tying a result to the specific sequence it was originally intended
for. Deliberate simplicity trade-off, tested and locked in by
`tests/e2e/stale-callback.spec.ts`, not an oversight — see
`docs/SYSTEM_ARCHITECTURE.md`'s "Provider lifecycle and Strict Mode" section.

**Impact:** Low with the current Simulator/manual providers (a developer or user
triggering this exact sequence — schedule delayed, cancel, immediately start a new one,
all within the delay window — is a narrow, mostly-testing scenario). Would need
revisiting before a real hardware provider ships, if that provider's actual behavior
(e.g. resending a stale reading late) makes this a real-world occurrence rather than a
theoretical one.

**Recommendation:** if it becomes a real problem, tag each `CaptureSequence` with a
generation identifier and have `processTimingResult` compare it against whichever
sequence was active when the *listen* began — not before, since inventing this now would
be speculative infrastructure for a scenario not yet observed with real hardware.

### `sessionRef` can lag one render behind a concurrent classic manual shot

**What:** `TrackerApp.tsx`'s Capture Sequence result-processing queue reads/writes an
authoritative `sessionRef` that every capture-mutating handler updates synchronously
(see `docs/SYSTEM_ARCHITECTURE.md`'s "Race conditions" section). The *other*, non-capture
handlers (`handleAddShot`, `handleDeleteShot`, block creation) still use the classic
functional-`setState`-updater pattern and only resync `sessionRef` on the next render.
Since Auto Capture is additive — `ShotEntry` and `AutoCapture` can both be visible and
used for the same block at the same time — there is a narrow window where a manually
added shot (via classic `ShotEntry`) might not yet be reflected in `sessionRef` if a
capture result is processed in that exact window before a render happens.

**Impact:** Low (requires actively using both entry methods for the same block within
a sub-render-cycle window; the classic manual flow's own correctness, via React's own
update-queue chaining, is unaffected either way — only a *concurrent capture result*
processed in that exact window could theoretically miscount).

**Recommendation:** if this becomes a real ask, extend `commitSession` (or an
equivalent) to the other session-mutating handlers too, so every session write goes
through one synchronous-ref-plus-setState path — not done in this pass to keep scope to
the Capture Sequence subsystem specifically, per this task's own instruction not to
touch unrelated flows.

### No routing / deep-linking for Home, Train, Analyze, or Settings

**What:** Navigation is an in-memory `ActiveView` value (see `docs/adr/0009`), not Next.js
routes — there is no URL for any section, so nothing can be bookmarked, shared, or
reached via browser back/forward.

**Impact:** Low today (single-user, local-first, no sharing use case yet).

**Recommendation:** if a section ever needs a shareable/bookmarkable URL, introduce routes
for that section specifically; the navigation config (`src/lib/navigation.ts`) was kept
independent of the switching mechanism so this doesn't require a redesign.

---

## Assessment Framework

**Phase A, Phase B, and Phase C implemented.** See
`docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` for the authoritative product and
domain model this workstream implements, `docs/SYSTEM_ARCHITECTURE.md`'s "Assessments"
section for the architecture-level summary, `docs/adr/0010-assessment-domain-foundation.md`
for the domain-separation and persistence-strategy decisions, and
`docs/adr/0011-assessment-capture-ownership-and-app-shell-integration.md` for the
Phase B app-shell integration decisions. The phases below are a proposed sequencing,
not a committed schedule.

### Phase A — Assessment Foundation (Implemented)

- Domain types (`src/lib/assessment/types.ts`)
- immutable, versioned Release Time Core Assessment v1 template
  (`src/lib/assessment/templates.ts`), self-validated at import
- Assessment Run state machine (`src/lib/assessment/run.ts`)
- planned-shot and attempt semantics, incl. wrong-handle Protocol Deviation and
  invalid-repeat-limit enforcement (`src/lib/assessment/attempts.ts`)
- threshold-independent raw metrics and threshold-dependent category metrics
  (`src/lib/assessment/metrics.ts`)
- protocol/category comparison eligibility (`src/lib/assessment/comparison.ts`)
- local persistence with its own `localStorage` key, separate from Session History
  (`src/lib/assessment/persistence.ts`)
- defensive validation/migration strategy — individually invalid persisted runs are
  quarantined, never partially repaired (`src/lib/assessment/migration.ts`)
- 148 unit + integration tests (`src/lib/assessment/__tests__/`)
- no active Assess UI, navigation, or capture integration in this phase — see Phase B

### Phase B — Release Time Core v1 execution flow (Implemented)

- Assess navigation activated (`src/lib/navigation.ts`, `PrimaryNavigation.tsx`
  unchanged) and Home integration (`TodayPlanCard`'s "Resume Assessment")
- Assess Landing (`AssessmentLanding.tsx`) and Overview (`AssessmentOverview.tsx`)
- Guided Introduction (`AssessmentGuidedIntroduction.tsx`) with a local, resettable
  "show automatically" preference (`assessmentPreferences.ts`)
- permanently accessible protocol (`AssessmentProtocolSheet.tsx`)
- provider-neutral setup guidance and diagram (`AssessmentSetupConfirmation.tsx`,
  `AssessmentSetupDiagram.tsx`)
- standard six-shot warm-up, four fixed scored blocks, fixed target/handle sequences —
  all driven by `getAllPlannedShots`/`getCurrentPlannedShot`, never a separately
  maintained shot counter (`AssessmentExecution.tsx`)
- capture integration sharing Training's single `TimingProvider` subscription under a
  Run-status-derived capture-ownership rule (`src/lib/assessment/capture.ts`,
  `TrackerApp.tsx`'s `isAssessmentCaptureActive`/`processQueuedAssessmentTimingResult`
  — see ADR-0011)
- invalid attempts (capped at 2 per shot, technical reasons only —
  `AssessmentInvalidAttemptDialog.tsx`) and wrong-handle Protocol Deviations
  (`AssessmentCurrentShot.tsx`)
- pause/resume (`pauseAssessmentRun`, ADR-0011 Decision 3), reload recovery
  (force-pause + quarantine notice, ADR-0011 Decision 4), and abandonment
- completion (`AssessmentCompletionSummary.tsx`) — raw metrics + category summary
  under the original Run Threshold, no charts/trends/score

### Phase C — Results and Analyze integration (Implemented)

- `AssessmentResultScreen.tsx` — full single-run result view (`src/lib/assessment/result.ts`'s
  `AssessmentResultView`), reached from the Completion Summary's "View Full Results",
  `AssessmentLanding`'s "Latest Completed Assessment" card, and Analyze → Assessments
- transparent metrics: threshold-independent (MAE/Bias/SD) and threshold-dependent
  (On Target/Acceptable/Major Miss) always shown with the active Threshold Set labeled
- block (`AssessmentBlockResults.tsx`), handle (`AssessmentHandleComparison.tsx`,
  grouped by executed handle), target (`AssessmentTargetResults.tsx`, Fast/Medium/Slow
  Delivery combining every block), and Variable Adaptation
  (`AssessmentVariableAdaptationResults.tsx`, deliberately restrained given 8 shots)
  breakdowns
- Original/Standard/Tight/Custom Analysis Threshold control
  (`AssessmentThresholdControl.tsx`) — never mutates the run or its Run Threshold
  Snapshot
- completed-run history, separated from incomplete runs
  (`AssessmentAnalyze.tsx`/`AssessmentHistoryItem.tsx`), plus whole-run delete with
  explicit confirmation (`deleteAssessmentRunFromHistory`)
- comparison of protocol-compatible completed runs under one shared Comparison
  Threshold Set (`compareAssessmentRuns`, `AssessmentRunComparison.tsx`,
  `AssessmentComparisonEligibilityNotice.tsx`) and development trends across
  same-Template-and-Version completed runs (`AssessmentTrendChart.tsx`)
- Analyze → Assessments tab (`analyzeTab` local state in `TrackerApp.tsx`), a dedicated
  Assessment CSV export (`src/lib/assessment/export.ts`) never merged with Training's
  export
- no benchmarking or synthetic overall score in v1 — by design, not an omission (see
  `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` sections 2/20)

**Known limitation carried from this pass**: `AssessmentResultScreen` is mounted as a
top-level overlay in `TrackerApp.tsx`, conditionally unmounting `AssessScreen` while
shown. Returning via "← Back" therefore remounts `AssessScreen` from scratch, losing an
in-flight Completion Summary in favor of Assess Landing — the archived run itself is
unaffected (still fully visible under Analyze → Assessments), only the transient "just
completed" UI framing is lost. Fixing this would mean lifting `completedRunSummary` (or
an equivalent "just finished this run" flag) out of `AssessScreen` into `TrackerApp`, or
keeping `AssessScreen` mounted underneath the overlay — not done in this pass to keep
scope to Phase C's own brief.

### Later

- Blind Weight Assessment
- Custom Assessments
- organisation-published assessments
- optional baseline onboarding
- capability profiles
- explainable training-focus suggestions
- benchmarking after sufficient validation and data
- coach-assigned assessments
- cloud and workspace permissions

### Product validation / research items (not technical debt)

Release Time Core Assessment v1 is **proposed, not yet externally validated** — targets
and the overall protocol need piloting, and the provider-neutral setup needs validation
against real hardware, before this is treated as a validated platform standard. The
specification's "Open Validation Questions" and "Pilot Recommendation" sections list the
open questions in full (target times, 32-stone duration/fatigue impact, warm-up
adequacy, block order, invalid-attempt/protocol-deviation thresholds, accuracy
thresholds, run-to-run reliability, single-run sufficiency for a baseline, and others) —
not duplicated here.

---

## Training Plans (v1)

**Implemented.** See `docs/TRAINING_SYSTEM_AND_PLANS.md` for the authoritative product
and domain model, `docs/SYSTEM_ARCHITECTURE.md`'s "Training Plans" section for the
architecture-level summary, and `docs/adr/0012-training-plans-domain-and-execution-model.md`
for the domain-separation, lazy-block-creation, and migration-style decisions.

### Deliberately deferred to keep Version 1 focused

- **Skip Step.** Only "Continue after completion" and "End session early" (the
  existing Start New Session flow) exist — a dedicated Skip Step action was left out
  per the spec's own recommended Version 1 decisions (section 63).
- **Drag-and-drop step reordering.** Explicit Move Up/Down controls only, per spec
  sections 16/50 — more reliable on mobile, and avoids a drag-and-drop library
  dependency for a small, usually-short list.
- **Auto Capture handle preset is best-effort, not exhaustively tested.**
  `handleStrategyToCaptureHandleMode` pre-fills a plan-driven block's Capture Sequence
  setup, but the primary, fully-tested path is classic manual entry
  (`ShotEntry`/`BlindShotEntry`'s `presetHandle` prop). Auto Capture users get the
  same preset, still fully overridable, but this pairing wasn't a focus of the V1
  acceptance criteria.
- **No re-entry after a manual block interrupts an active plan.** If the athlete taps
  "New Training Block" instead of the plan's own Continue/Finish action,
  `isPlanExecutionActive` becomes false and the plan progress/transition UI simply
  stops rendering for that session — the plan's own execution state isn't lost or
  corrupted, but there's no "resume the plan" action to return to it. A real ask for
  this would need a small explicit re-entry affordance, not built speculatively.
- **Unsaved Plan Editor navigation loss isn't guarded.** Unlike the Blind-draft/
  Capture-Sequence/Assessment-Run guards `guardLeavingActiveWork` composes, navigating
  away (e.g. tapping Home) while mid-edit in `TrainingPlanEditor`/`TrainingPlanStepEditor`
  has no confirmation — same category of gap as Session Settings' notes field, not a
  new one. Worth a guard if it becomes a real, reported annoyance.
- **History/Analyze integration is intentionally minimal.** Only a single "Started
  from: {plan name}" label on the session summary (`TrackerApp.tsx`'s Blocks and
  Sessions list) — no new filter, tab, chart, or plan-level analytics (repeated-
  execution comparison, planned-vs-actual volume, completion consistency), per spec
  sections 35/36. These are explicit Future Product Opportunities in the spec
  (section 61), not omissions.
- **No maximum Number of Stones / step count limit.** The spec (section 49) allows
  "reasonable technical limits if required" but warns against inventing one without a
  concrete reason — none exists yet for a plan step, so none was added (contrast
  Capture Sequence's `MAX_CAPTURE_SHOT_COUNT`, added for a documented typo-guard
  reason).

### Not built (explicitly out of Version 1 scope, per the spec)

Scheduling/calendars, coach-created or shared/team plans, plan marketplaces,
AI-generated plans, automatic/performance-based progression, Assessment Plan Steps,
and non-release-time (rotation/line/sweeping/sensor) Plan Step types — see spec
section 4. The architecture (a discriminated `TrainingPlanStep` union with only one
member today) is intended to make adding a new step type additive later, without
redefining the meaning of existing release-time plans.

---

## Accuracy Tolerance Profiles (v1)

**Implemented.** See `docs/SYSTEM_ARCHITECTURE.md`'s "Accuracy Tolerance Profiles"
section for the architecture-level summary and `docs/DOMAIN_GLOSSARY.md`'s "Accuracy
Tolerance Profile"/"Default Profile" entries for the domain concepts.

### Deliberately deferred to keep this feature focused

- **Assessment setup integration.** `AssessmentThresholdSelector.tsx` (used by
  `AssessmentOverview.tsx`/`AssessScreen.tsx` before a Release Time Core Assessment Run
  starts) already lets an athlete enter a user-configurable Custom Accuracy Tolerance,
  so this was in scope per the product spec's "include only if Assessments already
  support it" condition. Not wired up in this pass: doing so would mean threading
  `accuracyToleranceProfiles`/`defaultAccuracyToleranceProfileId` through
  `AssessScreen.tsx` (which owns its own threshold-preset/custom-input state locally,
  independent of Training's) — a component with careful, already-tuned
  capture-ownership and navigation-guard integration (ADR-0011). The change would be
  mechanical (prop threading + reusing the same `AccuracyToleranceProfileSelector`,
  with Assessment's own stricter `validateThresholdValues` — 0.01s precision, 0.01s–5s
  range — governing what's actually accepted) but was left out to avoid touching
  `AssessScreen.tsx` as a side effect of an unrelated feature.
  **Recommendation:** if requested, add the same two props to
  `AssessmentOverview.tsx`/`AssessmentThresholdSelector.tsx`, thread them from
  `TrackerApp.tsx` through `AssessScreen.tsx`, and add one local
  `selectedToleranceProfileId` state in `AssessmentOverview.tsx` (not persisted,
  mirroring `TrainingSetup.tsx`'s own local selection state) — no Run/threshold-snapshot
  domain logic needs to change, since the selector only prefills the Custom input
  fields already validated and stored via `createAccuracyThresholdSet`.
- **No reverse profile-matching when editing an existing Training Block/Plan Step.**
  Opening an already-configured Custom Accuracy Tolerance for editing always starts on
  "Custom for this exercise" showing its stored values, even if those values happen to
  match a saved profile exactly — it is never guessed to be "this profile, currently
  selected." Avoids ambiguity when multiple profiles could match, and floating-point
  equality comparisons across independently-entered values.
  **Impact:** low (the athlete can still re-select the matching profile from the
  dropdown if they want the picker's summary display; the numeric values themselves are
  correct either way).
- **No lightweight "manage profiles" shortcut from inside the selector itself.** The
  product spec allowed this "if it fits the existing navigation pattern" — it doesn't
  cleanly fit, since `TrainingSetup.tsx` is always reached from a modal or an in-progress
  Quick Start flow, and navigating to Settings from there would abandon that in-progress
  setup. Settings > Accuracy Tolerances remains the only management location.
- **No profile provenance metadata** (`sourceProfileId`/`sourceProfileName`) stored on a
  `TrainingBlock`/`ReleaseTimingBlockConfiguration`. The product spec allowed this as
  optional; omitted to avoid a schema/migration change to either type for a purely
  informational nicety with no other product need yet.

---

## Smart Random Profiles (v1)

**Implemented.** See `docs/SYSTEM_ARCHITECTURE.md`'s "Smart Random Profiles" section
for the architecture-level summary and `docs/DOMAIN_GLOSSARY.md`'s "Smart Random
Profile"/"Default Smart Random Profile" entries for the domain concepts.

### Scope decision confirmed before implementation

Auditing `src/lib/variableTargets.ts` found that Smart Random's step size (`0.05s`,
`SMART_RANDOM_STEP`) and its repeat-avoidance memory
(`NORMAL_REPEAT_AVOIDANCE_MEMORY`/`LARGE_JUMP_REPEAT_AVOIDANCE_MEMORY`) are fixed
implementation constants today, not per-block configurable settings — the code
explicitly comments the step as "Not user-configurable." The original feature request
described profiles with a per-profile Step and Memory value; this would require
genuinely extending `generateSmartRandomTarget`/`TrainingBlock`, a real
target-generation-algorithm change explicitly out of scope for a configuration-reuse
feature. Confirmed with the product owner: Smart Random Profiles store only Measurement
Mode and the Minimum/Maximum range — what is actually configurable today. Step and
memory remain fixed constants, unrelated to any profile.

**Recommendation, if per-profile step/memory is ever genuinely wanted:** treat it as its
own, separately-scoped product decision (it changes what athletes actually train, not
just how a range is entered) — extend `TrainingBlock`/`ReleaseTimingBlockConfiguration`
with explicit new fields, thread them through `generateSmartRandomTarget`, and add a
dedicated migration/backfill rule, rather than folding it into this profile-reuse
feature after the fact.

### Deliberately deferred to keep this feature focused

- **"Save current settings as a profile."** The product spec allowed this only if
  trivial; not implemented, since it would need a name-prompt UI mid-setup-flow with its
  own validation path, duplicating parts of `SmartRandomProfileForm.tsx` rather than
  reusing it directly. **Recommendation:** if requested, add a small inline "Save as
  Profile" affordance next to "Custom for this exercise" that opens
  `SmartRandomProfileForm.tsx` pre-filled with the current Custom values, reusing the
  existing `onCreate` handler — no new persistence or validation logic needed.
- **No lightweight "manage profiles" shortcut from inside the selector itself** — same
  reasoning as Accuracy Tolerance Profiles: `TrainingSetup.tsx` is always reached from a
  modal or an in-progress Quick Start flow. Settings > Smart Random Profiles remains the
  only management location.
- **No profile provenance metadata** stored on a `TrainingBlock`/
  `ReleaseTimingBlockConfiguration` — same reasoning as Accuracy Tolerance Profiles.
- **No reverse profile-matching when editing an existing Training Block/Plan Step** —
  same reasoning as Accuracy Tolerance Profiles: opening an already-configured Smart
  Random range for editing always starts on "Custom for this exercise," never guessed to
  be a currently-selected profile even if the values happen to match one exactly.
- **Assessment integration not applicable.** The Release Time Core Assessment v1
  protocol uses fixed targets (3.50s/3.75s/4.00s), never Smart Random — there is no
  Assessment setup surface for this feature to integrate with.

---

## Open product decisions

These are not technical debt — they are decisions the product owner / domain expert
needs to make, not something engineering can resolve by itself:

1. **Hog-Hog Smart Random range.** No validated range exists. Needs real training data
   or coaching input, not an engineering estimate.
2. **Precise Back-Hog / Hog-Hog physical definitions**, if not already documented
   elsewhere outside this codebase — this document does not attempt to define curling
   physics.
3. **CSV schema stability guarantee** (see above) — is column order a public contract?
4. **Whether/when to build a settings UI for mid-block Smart Random range edits** — the
   underlying function exists (`updateSmartRandomRange`); no product ask has confirmed
   this is wanted yet.
5. **External timing device discovery** — see
   `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`; this is a full open question, not a
   narrow one.
6. ~~**Assess as a real screen.**~~ — Resolved (Phase B). `NAVIGATION_ITEMS`'s
   `"assess"` entry is now `availability: "active"`, and `AssessScreen.tsx` implements
   the full Release Time Core Assessment v1 execution flow on top of the Phase A
   domain foundation — see "Assessment Framework" above and ADR-0011.
   ~~**The Result screen, Assessment history/comparison, and Analyze integration.**~~ —
   Resolved (Phase C) — see "Assessment Framework" above.
7. **Athlete Experience (Personal / Coach Guided / Team Training).** Described
   conceptually in the platform nav doc as something that "changes Home's behavior,
   rather than unlocking different products," but no selection, persistence, or
   Home-branching logic exists yet — Home currently behaves identically regardless of
   this concept. Needs a decision on where this selection would live (Settings?
   first-run?) before any implementation.
