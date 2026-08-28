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

### IndexedDB adapter and transactional session archiving — legacy copy/activation track RETIRED; cross-key atomicity still open

**Retired, not merely blocked (2026-08-24).** The `localStorage`→IndexedDB copy migration
(ADR-0016) and the activation programme (ADR-0017/0018) exist to carry the existing
unscoped local data forward. Per
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md` and
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §9, that data is
disposable early-test data which **Stage B0.3 discards once, explicitly** — so there is
nothing left for that track to preserve, and it is **no longer the forward production
path**. ADR-0015's unwired adapter remains valid infrastructure. **No dormant code is
deleted by this decision**, and ADR-0017 Decision 3 is neither resolved nor required to be.
What remains genuinely open from this item is **cross-key atomicity for session
archiving** (see the end of this entry) and, separately, whichever local store Stage B0.3/B0.4
selects — a new decision, never a reuse of ADR-0016's markers or ADR-0017's activation
evidence. Everything below is retained as the record of the retired track.

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
`docs/adr/0015-indexeddb-adapter-unwired.md`. **The copy-migration substage (design doc
§10 step 2) is also now implemented** —
`src/lib/persistence/localStorageToIndexedDbMigration.ts` copies exact serialized
strings for all seven repository-boundary domains (current runtime) into IndexedDB
behind fail-closed, resumable per-domain markers in the `metadata` store, without
invoking any domain's migration/repair function (a deliberate exact-string-copy design,
not a schema migration — see `docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md`).
`docs/adr/0021-assessment-draft-history-authority-unit-split.md` once planned to register
two separate `assessmentDraft`/`assessmentHistory` migration units here — **retired
2026-08-24**: this registry will not be extended, because the whole copy-migration track is
retired and the legacy Assessment key holds disposable data. See ADR-0021 §11.1 and the
Assessment Framework section below.
Neither the adapter nor the migration engine is wired into any repository singleton or
component; `localStorage` remains the sole production source of truth and is never
written to or deleted by the migration engine.

**Activation/rollback has a proposed design, but it is explicitly incomplete — not
design-resolved, and not accepted:**
`docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md` (status:
**Proposed, incomplete design**) answers design doc §10 step 4, but names a specific,
unresolved blocking prerequisite it does not solve — see below. It does **not** answer
step 3 (verify before cleanup), which remains fully unresolved as a distinct problem
(ADR-0017 Decision 11 is explicit that activation-time verification and cleanup
verification have different success criteria and are not the same mechanism).

What ADR-0017 specifies: per-domain activation authority computed (never stored) from
**two independent, fingerprint-bound activation-evidence records** — a new per-domain
`localStorage` witness plus a new IndexedDB `metadata` record distinct from ADR-0016's
migration marker. Authority is granted only when both records agree and the IndexedDB
evidence is `"committed"` — a lone witness or a lone `"committed"` evidence record fails
closed instead of silently re-selecting `localStorage`, but a lone, valid `"prepared"`
evidence record is a different case: it has never conferred authority on its own, so
finding it with no witness yet is simply pre-authority and resolves `localStorage`
(Decision 13 row 1b), not `blocked`. **Authority begins only once the IndexedDB evidence reaches
`"committed"` and matches the witness — never at the earlier `"prepared"` step**, even
with a matching witness already present: a crash between those two writes releases
activation's exclusive lock, and an ordinary, fully-participating writer may still
legitimately write to `localStorage` before a recovery procedure gets a chance to
re-verify the *current* snapshot, so that intermediate state blocks rather than grants
authority. That automatic recovery procedure discards a stale attempt (when the source
has drifted) by deleting the `localStorage` witness *before* the IndexedDB evidence — the
reverse of manual rollback's deletion order, deliberately: an unattended, automatic
discard must resolve any crash to plain `localStorage` authority, never to a state
requiring manual review, which is exactly what the opposite order (used for manual
rollback, where an operator is already present) could otherwise produce. An
**authority-aware mutation lease**, not a lock around each individual write, is the
actual write-exclusion mechanism: per-domain Web Locks (shared for ordinary writes,
exclusive for activation, held for the entire verify-through-finalize sequence) are
necessary but not sufficient on their own, since a write queued behind an in-progress
activation could otherwise still execute afterward through a repository instance bound to
the now-superseded backend — the lease closes this by re-checking current durable
evidence, under the lock, **exactly once per complete logical mutation, immediately
before that mutation's first write** (never independently repeated before a later write
in the same mutation), and the lease is held across that whole logical mutation (e.g.
both of `SessionRepository.archiveAndReplace`'s ordered writes, checked once), not per
individual `StorageAdapter.set` call, so an exclusive activation attempt can never run
partway through a multi-write operation. A `storage`-event or `BroadcastChannel`
notification may help another tab notice sooner, but is explicitly not the safety
mechanism. Also specified: a bounded, at-most-two-pass verification sequence (a second
mismatch under the held lock means a non-participating writer, and is reported, not
retried); a ten-state startup readiness gate that must resolve before any repository is
constructed, blocking the whole application only when `localStorage` itself is
unreadable; fail-closed failure/recovery rules reusing the existing `"write_protected"`
hydration state for a gate-withheld domain, an already-constructed repository's later
IndexedDB failure, and a mutation lease's authority-changed discovery alike; and rollback
reclassified as **manual, never automatic** (blocked once a post-activation IndexedDB
write exists — never "switch back to stale `localStorage`" — manual-but-conditional for a
deployment revert, deferred for storage-corruption data recovery).

**The blocking prerequisite ADR-0017 identifies and does not solve — one bundled
decision, not two independent ones:** no purely client-side mechanism in this codebase
can prevent an application build older than this protocol from continuing to read and
write `localStorage` during or after activation — such a build has no code participating
in the write-fencing lock or the evidence protocol, and nothing in a newer build can
reach or coordinate with it. **The same future decision must also explicitly decide the
fate of one further, named gap in the startup gate.** Precisely stated: *after* authority
has been granted (the IndexedDB evidence has reached `"committed"`), loss of either
evidence record fails closed whenever the surviving side can still be consulted —
Decision 13 row 0b is the one explicit outage exception, not a general exception to the
rule: a domain whose witness was lost while IndexedDB is *simultaneously unreachable*
cannot be distinguished from a never-activated domain (the surviving side, IndexedDB's
`"committed"` record, cannot be consulted in that exact window), and currently resolves
`localStorage` anyway — an accepted trade-off whose justification depends specifically on
production activation being blocked today, so it must be re-examined by, not separately
from, whatever decision lifts that block. ADR-0017 states plainly that
**automatic production activation is blocked by this one, combined prerequisite** until a
separate, future, explicitly approved decision resolves both parts together (a concrete
deployment/version-fencing mechanism, or a staged compatibility rollout with an
enforceable prerequisite, plus an explicit call on the bounded gap) — it does not propose
a tripwire or an "accepted residual risk" framing as a substitute for solving either.

**None of this is implemented** — `localStorage` remains the sole production source of
truth and IndexedDB remains unactivated. ADR-0017's own thirteen-stage implementation
sequence places most of those stages as buildable and testable now, but gates repository
wiring and any real activation behind the still-open, bundled old-build-and-bounded-gap
prerequisite above; that prerequisite itself is not a buildable stage this team can
complete unilaterally.

**`docs/adr/0018-indexeddb-production-activation-fencing-and-outage-policy.md` (Proposed,
incomplete design) is the attempted answer to that bundled prerequisite, and closes
neither of its two halves.** The bounded gap (row 0b) is **narrowed, not resolved**: a
proposed `localStorage` Activation Ledger (one entry per domain) is established as a
barrier *before* IndexedDB evidence finalizes — corrected from an earlier draft that wrote
it only as a best-effort step after finalize, which left a real crash-window gap — with
its own mandatory read-back validation, and is deleted as part of both the automatic
discard path and manual rollback, extended for it. This stops an ordinary, isolated
witness loss while IndexedDB is unreachable from being silently misread. **It is not
self-healing** — nothing repairs an already-established ledger entry that is later lost.
A whole-`localStorage`-origin wipe removes the ledger together with the witness in one
action, directly recreating the original ambiguity while IndexedDB is unreachable. A
**targeted deletion of just the ledger entry, with the witness left intact, does not by
itself** recreate that ambiguity — it only removes this domain's future mitigation
against a *later*, independent witness loss coincident with IndexedDB being unreachable;
all three conditions (deletion, later witness loss, simultaneous unreachability) must
hold together. **Ledger corruption is different still**: an invalid or unreadable ledger
fails closed and never silently selects `localStorage` — it costs availability, not
safety. An absent ledger (from either cause) narrows the risk only for as long as the
entry remains valid and readable; it is not proof a domain was never activated, and row
0b stays bundled into Decision 3 pending an explicit, separate residual-risk decision —
**accepting that residual would resolve the pending governance decision, not technically
eliminate the ambiguity itself**; only unconditional fail-closed behavior does that, at
the offline-first cost already named.
Old-build/tab exclusion is **also
not resolved**: ADR-0018 evaluates staged deployment, service-worker-controlled client
updates, build/protocol-epoch handshakes, `BroadcastChannel`/`storage` events, and Web
Locks (including a passive `navigator.locks.query()` presence check, corrected to a
single acquisition per tab, scoped to this browser's own storage partition) and proves
each one either cannot reach already-running, non-participating code at all, or — for the
one candidate that could (manual activation after an explicit client-drain confirmation)
— cannot be verified by software, only trusted. It declines to recommend enabling
activation on the strength of probability, telemetry, or a bake period, and states
directly that closing this half requires either new backend infrastructure paired with a
materially redesigned, server-authoritative model that could make an obsolete write's
effect harmless but never prevent the local `localStorage.setItem` call itself (out of
scope, and — under the product model in force when ADR-0018 was written — contrary to its
local-first, accountless product principle, since superseded by
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`; the technical
conclusion about already-running old builds does not depend on that premise) or
a separate, explicit product decision to **accept** the named residual risk — itself a
governance resolution, not a technical elimination — a call this architecture document
does not make on its own authority. **ADR-0017 Decision 3 therefore remains blocked as a
whole, with both bundled halves still open.**

**What remains open:** design doc §10 step 3 (verify before cleanup, entirely
unresolved); both of ADR-0018's own halves (old-build/tab exclusion, and row 0b's
residual whole-origin-wipe gap — the Activation Ledger narrows but does not close it);
every one of ADR-0017's implementation stages that follows Decision 3's resolution, plus
ADR-0018's own eleven stages; plus true
cross-key atomicity for session archiving. ADR-0014 explicitly does not, and cannot, make
the two writes atomic under either backend — an interruption between them can still
produce a recoverable duplicate (never a loss, per ADR-0014's chosen ordering, but not
"nothing happened either"). True cross-key atomicity requires a real IndexedDB
transaction spanning both object stores, which the current adapter does not provide for
`archiveAndReplace` (its generic `get`/`set` remain a single-key interface, exactly like
`localStorageAdapter.ts`'s, though `IndexedDbMigrationTarget.commitDomainSnapshot` shows
the same adapter's underlying connection can support a genuine multi-store transaction
when a narrower, purpose-built interface is used instead of the generic one) — ADR-0014
documents the seam (`archiveAndReplace`'s stable signature/failure-semantics) a future
transaction-based implementation can use without any change above the repository layer.

**Recommendation:** when migration/activation work is actually scheduled, implement
`archiveAndReplace`'s IndexedDB-backed version as one transaction over both object
stores rather than two sequential `set` calls — do not assume the current, still-
non-atomic `localStorage` implementation's behavior needs to be preserved beyond its
documented failure semantics (ADR-0014). Not urgent: no activation work is scheduled
yet.

**Relationship to cloud identity (ADR-0019):** `docs/adr/0019-cloud-identity-and-data-authority-transition.md`
proposes decoupling the personal-cloud/Supabase transition from this item entirely —
Local Adoption reads `localStorage` directly and does not wait on IndexedDB production
activation. ADR-0017/0018's bundled prerequisite (old-build exclusion, row 0b) is
therefore neither resolved nor required to be resolved by cloud work; it remains exactly
as open as this section already describes. Any future IndexedDB role would be a new,
separately designed account-scoped read cache or offline-mutation-queue mechanism for a
cloud-authoritative domain, never a reuse of ADR-0016's copy-migration markers or
ADR-0017's activation evidence — see ADR-0019 Decision 14. **ADR-0019 also has its own,
independently analyzed non-participating-build blocker (Decision 8)**, distinct from
ADR-0017/0018's: an old build has no code participating in ADR-0019's mutation lock,
Transition Fence, `RemoteAuthorityBarrier`, or `RemoteAuthorityDriftEvidence`
establishment sequence, and will keep writing legacy local keys obliviously. That analysis
concludes the consequence is narrower than ADR-0017/0018's (a stray old-build write can
never reach committed cloud authority on its own — Supabase never trusts it directly),
but the write and any resulting old-UI confusion cannot be prevented either, so no
production Local Adoption finalize may be enabled until a deployment/version strategy or
an explicit residual-risk decision addresses it, same as ADR-0017/0018 require for
IndexedDB activation. `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`'s
§4.1/§12.1/§18 instructions have been corrected in place (not merely annotated) in the
same change that introduced ADR-0019 — this is no longer an open documentation-debt item.

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

**Forward path for Assessment cloud persistence: Stage B0.4 (Free Cloud Data Backbone).**
Assessment history becomes part of the **Free Cloud Core** through B0.4 — see "Mandatory
Identity and Free Cloud Foundation" below. **Everything in the remainder of this subsection
describes ADR-0019/ADR-0020's Local Adoption programme, which is superseded as the forward
production path** (there is no legacy data to adopt; `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`).
It is retained because two things in it survive: **ADR-0021's authority-unit split is still
the accepted Assessment constraint** (`assessmentDraft` device-local, `assessmentHistory`
the cloud-eligible unit), and the technical problems named below are **real problems any
cloud design must handle** — B0.4 must solve its own equivalents rather than inheriting
ADR-0020's specific, unreconciled answers. Read "pilot eligibility", "Local Adoption" and
the numbered ADR-0020 blockers below as historical scope, not scheduled work.

**Cloud authority precondition (ADR-0020), authority-unit split now designed (ADR-0021):**
`docs/adr/0020-supabase-schema-rls-and-adoption-transactions.md` named a genuine
architecture blocker specific to this domain — `AssessmentPersistedState` combines the
device-local, in-progress `currentRun` with the cloud-eligible, terminal `history` under
one `localStorage` key (`ASSESSMENT_STORAGE_KEY`). `docs/adr/0021-assessment-draft-history-authority-unit-split.md`
(Accepted, design complete) now resolves this specific blocker — it defines
`assessmentDraft` (permanently device-local) and `assessmentHistory` (the only Assessment
unit ever eligible for future cloud adoption) as two independent persistence domains,
with a full structural migration, startup authority resolution, and archive-and-clear
mutation design. **Implementation has not been performed** — the running application
still uses the single combined domain/key today, and cloud authority (via ADR-0019 Local
Adoption) still cannot be piloted or enabled for Assessment history until that
implementation is carried out. Moving only `history` to cloud authority under today's
still-combined domain would create two writable authorities inside one domain the instant
it activated — exactly the hazard ADR-0021 exists to eliminate before implementation.
ADR-0020 designs the generic server substrate and a target canonical mapping for
Assessment history, but does not, and cannot, claim the current combined domain is
pilot-ready, and ADR-0021 resolves only this one authority-unit blocker — every other
ADR-0020/ADR-0019 blocker below remains open, unaffected by ADR-0021. **A second,
independent blocker (ADR-0020's Decision E.2b):** `jsonb`'s
stricter input rules reject a valid-JSON escape sequence for U+0000 and
malformed/unpaired Unicode surrogate escapes, both of which the existing TS validators
currently accept as valid source content. This is now an **unconditional hard block**,
not a conditional gate: `transition_adoption_protocol_status` refuses every
`design_only → pilot` transition, for every domain, until a later, separate, accepted
ADR either adopts a durable approval-record design or a lossless canonical
representation — no fixture evidence of any kind is checked or required (a finite
fixture corpus was never proof over an unbounded future value space, and ADR-0020 no
longer claims otherwise). **A third, independent blocker (ADR-0020's Decision E.2c):**
"mapping execution/dispatch integration" — `private.implemented_canonical_mappings`
rows are migration-time attestations only (a `regprocedure` value proves a named
function existed at `INSERT` time, never that it still exists, still matches, or is
ever actually invoked); no generic dispatch mechanism that looks up and calls a
domain's mapping handler from `analyze_adoption`/`finalize_adoption` is designed by
ADR-0020, so a row's mere existence never means a domain's mapping logic actually
runs. None of the three is resolved by ADR-0020 itself. **A fourth, independent
blocker, named in the fourth Team Foundation correction pass:** ADR-0020's own
`account_scope_id` — the key every one of its authority/run/assessment tables uses —
is derived inconsistently across the document itself (`bootstrap_account()` treats it
as the raw Auth account id; `backfill_domain_authority()` and `assessment_runs`'s own
`fk_athlete` constraint treat it as `docs/adr/0022`'s independent `Profile.id`), and
**the architecture/product choice itself is now CLOSED:**
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md` (Accepted)
fixes athlete-owned authority as **Profile-scoped** (`Profile.id`, an application-owned
UUID, never the authentication-provider user id). **What remains open is not the choice
but ADR-0020's own internal consistency:** its tables, RPCs, RLS rules, locks,
completeness proofs and tests derive the scope inconsistently, and reconciling every one
of them to Profile scope is a later, focused stage nobody has performed. Do not describe
the Profile-versus-account choice as an unmade decision.

**And none of this gates the new forward path.** ADR-0019/ADR-0020's Local Adoption is
**not** the forward production path — there is no legacy data to adopt (see "Mandatory
Identity and Free Cloud Foundation" below). ADR-0020's remaining unresolved
questions — the representability question (Decision E.2b) and mapping execution/dispatch
integration (Decision E.2c) — stay unresolved **inside that historical Local Adoption
design**, and must not be treated as automatic gates on **Stage B0.4's Free Cloud Data
Backbone**. B0.4 designs and verifies its **own** schema, representability rules,
mapping, upload protocol and RLS, against a real database.

**ADR-0021, precisely.** Its **authority-unit split remains the accepted Assessment
constraint** — `assessmentDraft` is the device-local/in-progress unit, `assessmentHistory`
the completed-history unit and the only cloud-eligible one. But its **legacy mechanics are
retired**: the establishment/migration protocol that splits today's combined, unscoped
`ASSESSMENT_STORAGE_KEY`, the retained legacy residue, and its planned ADR-0016 marker
registration will **not** be implemented, because that data is disposable and Stage B0.3
discards it. **B0.3/B0.4 instead establish fresh Profile-scoped draft and history
persistence for post-onboarding data**, adopting nothing and reusing no retired marker. Its
old-build/deployment-fencing hazard survives as a real caution for any B0.3
scope-transition design.

"Pilot eligibility" under ADR-0020's own adoption protocol is now a historical question
rather than scheduled work; the forward Assessment path is B0.4.

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

## Mandatory Identity and Free Cloud Foundation (Stages B0.1-B0.4)

**Accepted product/architecture direction. B0.1-B0.4 are implemented and locally verified.** Canonical
product source: `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`.
Architecture decision: `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`
(Accepted; implemented through B0.4). This replaces the older accountless-use and paid-cloud-backup
assumptions that were spread across the cloud, persistence and commercial documents.

**Stages and their gates:**

| Stage | Scope | State |
|---|---|---|
| **B0.1 — Decision Reconciliation** | Documentation and ADR only: the canonical specification, ADR-0024, and reconciliation of the active architecture/persistence/commercial/Exercise/roadmap/glossary/routing documents. | **Documentation reconciliation complete** in the state documented here. B0.1 itself implements no runtime, test, schema or configuration behaviour. This describes B0.1's own scope only — it makes no claim about unrelated corrections that may share a repository commit with it. |
| **B0.2 — Identity and Onboarding Gate** | One application-level auth authority; email OTP; **Google sign-in**; Profile bootstrap; versionable, auditable legal acceptance; Athlete capability; default Free entitlement; the **global access gate**; offline identity continuity. No sporting cloud persistence. | **Implemented and verified.** B0.2a-e provide the executed database/RPC foundation, provider mechanics, identity domain/coordinator/runtime, mounted global gate/onboarding UI, durable Team intent replay, and retirement of all transitional auth/Profile-bootstrap routes. **Not independently releasable** — see the release-unit rule below. |
| **B0.3 — Profile-scoped Local Data** | Profile-isolated local persistence; sign-out/account-switch isolation; the **one-time** retirement of the disposable unscoped test data. | **Implemented and verified.** ADR-0026: immutable per-Profile namespace over all seven repositories, keyed application remount, exact content-blind ten-key retirement with fail-closed retry. B0.4 now adds its separate Profile-scoped queue. |
| **B0.4 — Free Cloud Data Backbone** | Server schema, ownership, RLS, idempotent upload, durable outbox, restore, retry, honest sync status, conflict behaviour. | **Implemented and verified against real local Supabase.** ADR-0027 covers archived Training Sessions and terminal Assessment Runs; Exercise records extend the same backbone when Exercise execution exists. |
| **Exercise Stages A-C3d** | Curated Library, Solo execution, Team domain/cloud/outbox/eligibility/draft foundations, one-device Team capture, athlete-owned result restore and audited active corrections — see "Exercise Library and multi-athlete execution" below. | **Stage A, Solo B1-B3 and Team C1-C3d implemented.** Remaining post-completion revision/void/notification work, Plans and content hardening remain planned. |

**B0.2 + B0.3 are one releasable privacy unit** (see
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §11.1). They stay two
implementation scopes with two independent review gates, but they ship together. **The
concrete hazard:** B0.2 introduces mandatory authentication and account switching, while the
seven sporting-data repositories still read and wrote **one identity-unscoped
`localStorage` workspace** before B0.3. A separately released B0.2 would therefore have let a
**second authenticated account in the same browser see the first account's sessions, shots
and assessments** — the gate would invite account switching before anything isolates what
switching exposes.

- B0.2 may be implemented and independently reviewed **first**.
- **Its mandatory-gate and account-switching experience could not be enabled for real users,
  or released as the new product behaviour, until B0.3's Profile isolation and one-time
  disposal were implemented.** The combined privacy unit is now implemented and verified.
- **The release gate remains the combined unit**, and must prove **no Profile can observe another
  Profile's local data or pending writes**.
- **B0.2's account-switch negative cases prove authentication/onboarding state transitions
  only.** Sporting-data confidentiality across a switch is not closed by that review, and
  B0.2's completion report must say so.
- Never resolve this by importing, adopting or assigning the unscoped data to whichever
  account signs in first — it is **discarded**, never adopted. Never move disposal into
  B0.2. **No deployment or feature-flag mechanism is chosen here**; that belongs to those
  stages.
- **B0.2 is never independently release-ready.**

**Current application boundary, stated plainly.** B0.2 now changes the user-visible
application: the global gate is mandatory; email OTP and Google entry are visible;
personal onboarding displays and pins one server-authoritative Legal snapshot; and
completed onboarding establishes the Profile, Athlete capability and Free entitlement
before `TrackerApp` mounts. The former four auth controllers, optional `AccountControl`,
embedded Team sign-in forms and Team-local Profile bootstrap are removed. B0.3 now binds
all ten sporting keys to an immutable canonical `Profile.id` namespace and retires the
disposable unscoped keys before any repository mounts. The remaining gaps are:

- **Cloud sporting history is implemented for the domains that currently execute:** archived
  Training Sessions and terminal Assessment Runs. Exercise execution records do not yet
  exist and remain for Exercise Stage B to add to this same backbone.
- **No account deletion, export-before-deletion, or recovery-period behaviour.**

The historical `bootstrap_profile` function remains in migration history only. The B0.2e
forward migration revokes browser execution; Team services expose no creation method and
their UIs assume the gate-approved completed Profile.

**Real database execution remains a blocking requirement.** SQL, RLS, grants, triggers and
concurrency behaviour are not verified by TypeScript tests or careful reading. Stage B0.4
is not complete until its SQL has actually run against a real Postgres/Supabase instance —
the same discipline the Team Foundation beta operates under, which has now cleared that bar
for its own SQL (see below). If no real database environment is available, classify the SQL
as **written but unexecuted** and keep database execution as a blocking stage. The Team
Foundation execution found two defects invisible to TypeScript tests and to review —
`SELECT` policies with no matching table grant, and unqualified pgcrypto calls under a
pinned `search_path` — which is precisely why this stage cannot be signed off on reading.

**Decisions deliberately left open** (do not invent them): a fixed expiry period for a
device's trusted offline Profile state; the final commercial name of the paid personal tier;
video/sensor/AI storage entitlements, quotas and retention; the exact shared Team-result
anonymisation and participant-notification behaviour on deletion; minor/guardian workflows;
billing provider, pricing and market.

---

## Historical Cloud Auth Shell (Supabase) — retired

> The optional `AccountControl`/`useSupabaseAuthController` implementation described
> below was removed by B0.2e. This subsection is retained only as historical context;
> the mandatory-identity section above is authoritative for the current tree.

**Implemented (narrow, alpha slice) — transitional; Stage B0.2 replaces it.** See the
"Mandatory Identity and Free Cloud Foundation" section above for the accepted target and
the concrete gaps, `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §5.3/§5.4 for
the corrected product decisions, and
`docs/SYSTEM_ARCHITECTURE.md`'s "Optional Supabase Auth Shell" section for the
architecture-level summary. `src/lib/supabase/` provides typed `NEXT_PUBLIC_*`
configuration resolution (`config.ts`), a lazy Supabase client factory and auth-service
implementation (`supabaseClient.ts`/`supabaseAuthService.ts` — the only two files
permitted to import `@supabase/supabase-js`, enforced by an architecture-boundary test),
an explicit `AuthState` discriminated union and pure reducer (`authState.ts`), and a
React controller hook (`useSupabaseAuthController.ts`). `AccountControl.tsx` is mounted
at the top of `TrackerApp.tsx`'s render body, visible (or, cloud-disabled, invisible)
regardless of `activeView`. Supports: cloud-disabled/invalid-configuration detection
without constructing a client, session restoration, persistent auto-refreshed sessions,
six-digit email OTP request/verification, and sign-out — all through the public
Supabase Auth API only.

### Deliberately deferred to keep this slice focused

- **No cloud data repository, no upload, and no Assessment authority change of any
  kind.** Signing in only establishes a Supabase Auth identity (`AccountIdentity` —
  an id and an email, nothing else); it never uploads, transforms, or claims local data,
  and no domain becomes cloud-authoritative as a side effect. **Corrected 2026-08-24:** the
  forward path is Stage B0.4's Free cloud data backbone, **not** ADR-0019/ADR-0020's Local
  Adoption — that protocol is superseded, because the legacy local data is disposable.
  ADR-0021's `assessmentDraft`/`assessmentHistory` split remains the accepted authority-unit
  constraint, but its legacy-key migration mechanics and ADR-0016 marker registration are
  retired — B0.3/B0.4 establish fresh Profile-scoped draft/history persistence instead.
- **No account bootstrap RPC, RLS, or schema deployment** — ADR-0020's server-side
  contract is not called or deployed here.
- **No user-visible Google OAuth, password login, or magic-link-only flow** — this historical
  transitional UI exposed email OTP only. B0.2 later mounted Google provider mechanics
  through the global identity gate. Passwords, magic links and Apple sign-in remain deferred.
- ~~**No teams, coaches, or collaboration features.**~~ — Superseded by the separate
  Team Foundation beta (see below) built on top of this Auth Shell in a later pass. This
  bullet described only what this narrow alpha slice itself left out, not a
  whole-product statement.
- Signed-in identity is not surfaced anywhere else in the app yet (e.g. no
  account-scoped Settings section) — only the compact header control (superseded in
  part by Team Foundation's `AccountControl` "Teams" button, below).
- **The shell never gated the app.** This was the historical reason the transitional
  shell was retired. B0.2's application-level provider now invokes and enforces Profile
  onboarding, legal evidence, Athlete capability and the Free entitlement.

---

## Team Foundation (beta)

**Implemented — domain, service, Route Handlers, and UI.** See
`docs/adr/0022-team-foundation-domain-and-persistence.md` for the full decision record,
`docs/SYSTEM_ARCHITECTURE.md`'s "Team Foundation" section for the architecture-level
summary, and `docs/DOMAIN_GLOSSARY.md` for the domain terms.

### ~~Not yet run against a real database~~ — Resolved (SQL layer only)

**What it was:** `supabase/migrations/*team_foundation*.sql` (schema, RLS, functions)
and the pgTAP suite had never been executed — no `supabase`/`docker` CLI was available
in this development environment, in any pass up to that point.

**Resolution:** all three migrations now apply cleanly from scratch via
`supabase db reset` against a real local Supabase Postgres, and
`supabase/tests/team_foundation.test.sql` passes **102/102** against it (the suite grew
from 91 as part of this correction). The five two-session concurrency procedures
documented at the end of that file — Admin Request accept-vs-revoke,
accept-vs-membership-ending, concurrent creation, and `restore_team` racing a final
admin's `leave_team`/`relinquish_own_admin` — have been executed with genuinely
concurrent sessions in both orderings each, so the SQL-level locking (docs/adr/0022
§Admin Request Concurrency, §Team Lifecycle Lock Ordering, §Membership Write-Time
Locking) is now verified rather than reasoned about. See `supabase/tests/README.md` for
the recorded outcomes.

**What that first execution cost, and why it was worth it:** two defects that neither
TypeScript tests nor careful reading could surface. (1) The RLS migration defined
`SELECT` policies for `authenticated` but granted it no table-level `SELECT` — an RLS
policy narrows an access the ACL already permits and never grants one, so every direct
client read in `supabaseTeamService.ts` and the Team Route Handler context would have
failed with `permission denied for table ...`. (2) `private.hash_token`/
`private.generate_raw_token` called pgcrypto unqualified while every calling RPC pins
`search_path = public, pg_temp`; pgcrypto lives in the `extensions` schema, so no
invitation could ever have been created. Both are fixed, and the suite now asserts the
table-privilege boundary from the catalog (§17) and the token round-trip from a real
`create_invitation` (§4a). One documentation defect was corrected the other way: the
predicted `conflict` outcome for Procedure B's remove-first ordering is actually
`revoked`, because `remove_member` atomically revokes the pending request and
`accept_admin_request` checks request status before membership status — the prose was
wrong, not the precedence.

### Route Handlers and UI have never run against the real database

**What:** only the SQL layer has been executed for real. The Next.js Route Handlers, the
`supabaseTeamService` client calls, and the whole Teams UI are still verified solely
against the fake/in-memory `TeamService` and unit/component tests. No end-to-end flow
(sign in → bootstrap Profile → create team → invite → accept) has been run against a
live Supabase instance.

**Impact:** Medium. The RPC contracts themselves are now proven, and the missing table
grants that would have broken every direct client read are fixed — but PostgREST-level
concerns (embedded-resource select syntax, the RPC parameter-name mapping, auth token
propagation through the Route Handlers, email delivery) remain unexercised.

**Recommendation:** before any pilot use, run one full manual end-to-end pass against a
local `supabase start` stack with a real signed-in account, and treat its findings as
ordinary integration bug-fixing.

### ~~No way to list a team's own outstanding Admin Requests~~ — Resolved (correction pass)

**What it was:** `TeamService.listAdminRequestsForMe()` only returns Admin Requests
naming the *signed-in caller* as nominee — there was no method scoped the other way (the
Team Admin's own view of "requests I've created for this team that are still pending").

**Resolution:** `TeamService.listAdminRequestsForTeam(teamId)` (fake and Supabase-backed
implementations) fills this gap — scoped to one Team, effectively-pending requests
only. The Supabase-backed implementation calls a dedicated, genuinely admin-only RPC
(`list_admin_requests_for_team`, added in a second correction pass) rather than a
plain RLS-scoped `select` — `team_admin_requests_select`'s policy deliberately also
permits the nominee to see their own row (for their separate inbox), so a plain select
was not actually an admin-only boundary on its own, even though `FakeTeamService` was
already correctly admin-only. `TeamsScreen`'s "Outstanding Admin Requests" section
(with a Revoke action, gated by a confirmation dialog) is built on it and correctly
survives leaving and re-entering the team workspace, since it re-fetches from the
server on every `getTeamWorkspace` call rather than relying on local component state.
See `docs/adr/0022`'s "§Team-Side Admin Request Read Model".

### `AccountControl`'s "Teams" button has no notification-count badge

**What:** `AccountControl.tsx`'s "Teams" button (visible when signed in) is a plain
static label — it does not show how many unread notifications or pending Admin Requests
are waiting, even though `TeamsScreen` itself does show and act on them once opened.

**Impact:** Low (nothing is lost or hidden — opening Teams always shows the current,
accurate notification/request list; this is purely a "would I know to check" affordance
gap).

**Recommendation:** if requested, this would need either a shared auth/team-session
context (so `AccountControl` and `TeamsScreen` aren't two independent
`useSupabaseAuthController` instances, as they are today) or a second, lightweight
polling read — neither was built speculatively in this pass to avoid introducing new
global state infrastructure beyond this feature's reviewed scope.

---

## Exercise Library and multi-athlete execution

**Stage A, Solo Stage B (B1-B3) and Team Stages C1-C3d are implemented. The remaining Stage C
post-completion revision/void/notification work and
Stages D-E remain planned.** The canonical product and domain boundary
is `docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` (section 21 defines the stages).
The full closed-beta catalogue contains three Swiss Curling
Shotmaking Exercises, four unscored Technique Exercises and two standalone Measured
Exercises. All user-facing content is English.

**Stage A (domain and curated-content foundation) — implemented.** See
`docs/SYSTEM_ARCHITECTURE.md`'s "Exercise Library" section for what exists:
`src/lib/exercises/` (identity/immutable versions, classification, participation and
sweeping requirements, reusable Measurement Protocols, both Diagram variants, the
validation boundary, lookup and query), three curated Exercises (Release Point, Eight
Guards Progressively Longer, standalone Release Time), a generic responsive structured
Ice Sheet diagram renderer, and read-only discovery/detail as Train's third entry path
alongside Quick Start and Training Plans. Stage A **stores nothing** — no key, no
repository, no migration, no `Session`/`TrainingBlock`/`Shot` change.

Known delivery boundaries, deliberate rather than defects:

- **Solo execution is implemented for the three current items.** Technique is unscored,
  Shotmaking records actual handle plus 0-4/exclusion and a private note, and Release Time
  links to the existing Fixed/Variable/Blind runner without a duplicate outcome record.
- **Six of the nine approved Exercises are not authored yet** (Rotation, Laser, Release
  Gates, the Draw and Soft Take-out Shotmaking Exercises, Rotation Count). They expand
  the same schemas and renderers; none may require a named, exercise-specific UI branch.
  This is Stage E.
- **Release Time references both release-time Measurement Protocols as `optional`.** The
  requirement is "choose one and keep it for the whole execution", which the Exercise
  states as a setup instruction. Nothing in the approved content makes either mode the
  standard for this Exercise, so neither is marked `required`. Stage B1 resolves the
  execution rule without inventing a content preference: every standalone Measured
  execution must enable at least one compatible protocol, while either protocol remains
  a valid choice.
- **Rotation Count is available where capture needs it.** C3b adds a manual, target-free
  versioned protocol in rotations and validates positive 0.5 increments. Eight Guards
  Version 1 remains immutable; current Version 2 adds the optional reference. A separate
  standalone Rotation Count Exercise remains part of Stage E.
- **Search does not match a referenced protocol's name.** `exerciseSearchableText`
  operates on one Exercise Version without the catalog, so "hog" does not find Release
  Time via its protocol names. Widen it if discovery feedback asks for it.

**Exercise Solo Stage B is implemented through B3 (ADR-0028 through ADR-0030), ADR-0031
implements Stage C1's Team domain foundation, ADR-0032 implements Stage C2a's real
server authority, ADR-0033 implements C2b's client persistence/upload bridge, and
ADR-0034 implements C2c's eligibility cache and athlete permission UI; ADR-0035
implements C3a's reload-safe active Team draft and atomic completion handoff; ADR-0036
implements C3b's setup and one-device capture UI; ADR-0037 implements C3c's
athlete-owned result restore, verified offline cache, raw export and private-note UI;
ADR-0038 implements C3d's durable active-attempt corrections and audited annulment; the
rest of Stages C-E remains planned.** B2 embeds
Technique and Shotmaking executions in the existing Profile-owned Session, local
repository/archive transition and Free-cloud `training_session` record, with strict
terminal-history validation and no extra storage silo. It deliberately leaves Measured
Release Time on the current Block/Shot execution path; B3 provides the generic Solo UI
and stores only immutable Library provenance for a measured entry. The remaining work
follows the specification's order and review gates: one-device Team execution with
bounded offline upload, generalised simple
Training Plans containing curated Exercise steps, then the remaining approved content and
release hardening. C1 is deliberately standalone: it models confirmed Profile
participants, multiple athlete result slots, the active recorder, planned rotation and
actual role segments. C2a adds three executed migrations and 68 passing pgTAP assertions
for explicit recording permission, immutable shared coordination, athlete-owned result
bundles, independent partial rejection, concrete-Session approval and athlete-only notes.
C2b adds strict payload splitting and the provider-neutral/Supabase upload service.
C2c advances the same Profile-scoped record to schema 3 with a bounded active Team
roster/recording-permission snapshot and adds the athlete-owned grant/revoke control to
Team settings. C3a advances it to schema 4 with exactly one validated recorder-owned
in-progress Team aggregate; reload/account isolation, failed-write rollback, explicit
discard and atomic exact-completion-to-outbox replacement are tested. C3b now consumes
those boundaries for cached setup, durable capture, actual role rotation, per-athlete
Shotmaking results, manual half-step Rotation Count, completion and an honest sync
receipt. C3c now restores only the authenticated athlete's hash/manifest-verified
projection, preserves the last verified Profile-scoped cache offline and saves/clears
only that athlete's note after cloud acknowledgement. C3d appends exact before/after
events for any active-stone correction, persists them through the same draft, excludes
recorded-by-mistake attempts from current results and filters the audit into only the
affected athlete bundles under backwards-readable cloud payload schema 2. Private Athlete Notes remain
excluded from the shared recorder
aggregate, and Team Release Time still uses the existing timing runner rather than a
parallel Team Measured execution. Existing Release Timing Training Plans and history must remain
compatible throughout. Exercise authoring, public/community libraries, standardised
Shotmaking rubrics, advanced analytics, sensor coordinates and video analysis remain
deliberately deferred.

**Identity/persistence prerequisites added 2026-08-24.** Stage B sits behind Stages
B0.2-B0.4 (see "Mandatory Identity and Free Cloud Foundation" above). The Exercise
specification already assumes every Team participant resolves to an authenticated Profile,
that the recorder is derived from authentication with no Recorder selector, that private
Athlete Notes stay private across an account switch, and that pending data must not be
exposed after one. Those foundations are now implemented and verified.
**Commercial correction:** structured raw Exercise results, private Athlete Notes, and
their **Free** cloud persistence and basic restore, are Free (the **Free Cloud Core**) —
not part of the paid personal tier; Team Session coordination remains a Team Workspace
capability. See `docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` §20.

The client persistence boundary now proves reload, storage failure, account switching,
lost acknowledgement and per-athlete partial-sync receipts. Permission control and its
offline eligibility cache, one-device Team capture, active correction/annulment and
athlete-owned result/private-note UI are usable. Remaining Stage C work must add
post-completion correction/void workflows and participant notifications. Any further
database/RLS/transaction change still requires real database evidence; TypeScript tests
alone are not sufficient.

**Restricted source diagrams.** The supplied Swiss Curling diagrams may be shown only to
the named one-Team closed beta with visible attribution and genuinely restricted
delivery. Their inclusion in a public asset bundle does not satisfy that boundary. Stage
A therefore bundles **no** restricted asset at all: the PDF and its diagrams are not in
this repository, `Eight Guards, Progressively Longer` uses an independently authored
structured platform diagram, and the attributed-source-image variant is modelled,
validated and gated behind ADR-0023's opaque-reference-plus-authorized-resolver boundary
with no resolver implemented. Actually showing a restricted diagram is therefore a new
capability to build, not a flag to flip. Before any larger pilot or release, the product
owner must still record Swiss Curling's permission scope — a safe delivery mechanism is
not permission to deliver.

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
