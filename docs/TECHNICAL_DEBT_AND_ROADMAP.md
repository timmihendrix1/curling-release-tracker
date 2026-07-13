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

### No Blind Weight trend in `SessionTrendChart`

**What:** The cross-session trend chart shows session-level `Bias`/`Avg Abs Deviation`
only; it has no Blind-specific series (e.g. Mean Absolute Prediction Error per Blind
block over time). This was explicitly deferred during the Blind Weight feature pass
because the chart's current unit of aggregation (one point per *session*) doesn't
cleanly fit a per-*block* metric without restructuring its x-axis.

**Recommendation:** when this becomes a real ask, prefer a second, separate chart (or a
metric toggle) that aggregates per Blind Weight block, rather than retrofitting the
existing session-level chart to mean two different things depending on a toggle.

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
