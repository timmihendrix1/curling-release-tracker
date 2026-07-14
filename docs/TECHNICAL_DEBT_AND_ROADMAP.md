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
