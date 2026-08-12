# System Architecture

## Purpose

This document defines the architectural direction of the Curling Performance Platform.

It describes the architectural principles that should guide implementation decisions over time.

It is intentionally independent of the current implementation details.

The implementation will evolve continuously.

The architectural principles should remain comparatively stable.

---

# Architectural philosophy

The architecture should support long-term evolution.

New functionality should be added by extending the system rather than rewriting it.

The platform should remain modular, maintainable and easy to understand while avoiding unnecessary complexity.

Architecture exists to support the product—not the other way around.

---

# High-level architecture

The platform should evolve around six major areas.

```text

Presentation

        │

Application

        │

Domain

   ┌────┼────┐

Analytics  Integrations

        │

Persistence

```

Each area has a clearly defined responsibility.

---

# Presentation

Responsible for:

- User interface

- Navigation

- Forms

- Charts

- Visual feedback

- Device status

- User interactions

Presentation should contain as little business logic as possible.

---

# Application

Responsible for coordinating workflows.

Examples:

- Start training session

- Finish training session

- Create blocks

- Record shots

- Associate measurements

- Validate user actions

Application logic coordinates the system.

It should not contain domain-specific calculations.

---

# Domain

The domain represents curling itself.

It contains concepts such as:

- Athlete

- Coach

- Team

- Training Session

- Training Block

- Drill

- Shot

- Measurement

- Target

- Feedback

The domain should remain independent of:

- React

- Next.js

- Browsers

- Bluetooth

- Brower Timing

- Apple Health

- Database technology

The domain is the heart of the platform.

---

# Analytics

Responsible for transforming data into insights.

Examples:

- averages

- consistency

- deviations

- trends

- baselines

- comparisons

- future coaching recommendations

Analytics should never depend on specific hardware vendors.

Analytics operate on domain data.

---

# Integrations

Integrations connect the platform to external systems.

Examples:

- Timing systems

- Stone sensors

- Apple Health

- WHOOP

- Garmin

- Video

- CSV imports

- Future APIs

Integrations translate external data into the internal domain model.

External formats should never leak into the domain.

---

# Persistence

Responsible for storing information.

Possible storage mechanisms may evolve over time.

Examples:

- Local browser storage

- Cloud database

- Offline cache

- Synchronisation layer

The rest of the application should not depend on a specific storage technology.

---

# Core architectural principles

## Domain-first

Everything revolves around curling concepts.

Technology should adapt to the domain—not vice versa.

---

## Device independence

No hardware manufacturer should become part of the core architecture.

Devices are replaceable.

The athlete's data is not.

---

## Local-first today

The current implementation is local-first.

Future cloud capabilities should extend the architecture without fundamentally changing the domain model.

---

## Progressive complexity

The architecture should grow only when required.

Avoid building infrastructure for hypothetical future features.

---

## Separation of concerns

Each layer should have one clear responsibility.

Avoid mixing:

- UI

- business logic

- persistence

- analytics

- integrations

---

## Backwards compatibility

Historical athlete data is valuable.

Whenever practical, new versions should migrate existing data instead of discarding it.

---

## Raw data preservation

Store sufficient raw information to support future analyses.

Never assume today's analytics are the final analytics.

---

# Domain hierarchy

The platform should evolve around the following hierarchy.

```text

Organisation (future)

    │

Team

    │

Athlete

    │

Training Plan

    │

Training Session

    │

Training Block

    │

Shot

    │

Measurement

```

Not every level currently exists.

The hierarchy describes the intended long-term structure.

---

# Measurements

Measurements should be independent from their source.

Examples:

- Release Time

- Rotation

- Speed

- Heart Rate

- Line Deviation

Possible sources include:

- Manual Entry

- Timing Gate

- Stone Sensor

- Wearable

- Camera System

Measurements should describe **what** was measured.

Sources describe **where** the information came from.

---

# Future extensibility

Potential future capabilities include:

- Native mobile applications

- Cloud synchronisation

- Team management

- Coach dashboards

- AI-assisted coaching

- Video analysis

- Sensor integrations

- Health integrations

The architecture should allow these capabilities without requiring major redesign.

However, they should only be implemented when justified by real product needs.

---

# Architectural decision rule

Whenever a significant architectural decision is made, ask:

1. Does this make future extensions easier?

2. Does it unnecessarily increase complexity today?

3. Does it keep the domain independent?

4. Does it preserve historical data?

5. Can this decision be reversed later?

---

# Non-goals

The platform should currently avoid introducing:

- Microservices

- Event sourcing

- Plugin frameworks

- Enterprise infrastructure

- Complex synchronisation

- Generic abstractions without practical use

Simple solutions should be preferred whenever they satisfy current requirements.

---

# Guiding principle

The architecture should remain as simple as possible today while making tomorrow's evolution as easy as possible.

---

# Current Implementation Snapshot

> Everything above this line is the long-term architectural **vision** for the Curling
> Performance Platform. Everything below documents what is **actually implemented today**
> in the Curling Release Tracker MVP (`PROJECT.md`). Where the two differ, the vision
> isn't wrong — the implementation just hasn't grown into it yet. This section uses the
> current code as ground truth and is expected to be revised as the app evolves; the
> sections above should rarely need to change.
>
> Status tags used throughout: **Implemented**, **Prepared**, **Planned**, **Open decision**.
> See `docs/adr/` for the reasoning behind the decisions marked with an ADR reference, and
> `docs/DOMAIN_GLOSSARY.md` for term definitions.

## Domain model (Implemented)

Three types, all in `src/types/index.ts`. There is no backend and no database — a
`Session` is the entire unit of persistence.

### Session

The current training session. Exactly one exists at a time (`currentSession` in
`TrackerApp.tsx`); completed sessions move into a `Session[]` history list.

| Field | Meaning |
|---|---|
| `id`, `title`, `date`, `notes` | Session identity and free-text metadata |
| `blocks: TrainingBlock[]` | All blocks created in this session, in creation order |
| `activeBlockId: string` | The block currently receiving shots. `""` means no block has been configured yet (see "Active Block" in the glossary) |
| `shots: Shot[]` | **Flat** list of every shot across every block in this session — shots are not nested inside blocks; they reference their block via `shot.blockId` |

A session has no explicit status field. "In progress" vs. "finished" is implicit:
the current session is whatever is in `currentSession`; clicking *Start New Session*
archives it into the history array (only if it has at least one shot) and creates a
fresh, blockless session. There is no partial/paused/completed session status —
only "current" (exactly one) and "history" (append-only list, deletable per entry
or entirely from the History view).

### TrainingBlock

A named, bounded stretch of shots sharing one training objective and one target
configuration. Ending one block and starting the next never mutates the old block —
`addTrainingBlock` stamps `completedAt` on the outgoing block and appends a new one.

| Field | Meaning |
|---|---|
| `mode: "fixed" \| "variable" \| "blind"` | **Training mode** — see below |
| `measurementMode: "back-hog" \| "hog-hog"` | **Measurement mode** — what the release time actually measures |
| `targetTime: number` | The block's default/fallback target — see "Target model" below; its exact meaning depends on `mode` |
| `variableTargetMode?: "smart-random" \| "manual"` | **Target source**, only set when `mode === "variable"` |
| `blindTargetMode?: "fixed" \| "smart-random" \| "manual"` | **Target source**, only set when `mode === "blind"` (has one more option than Variable Weight — see ADR-0004) |
| `smartRandomMin?`, `smartRandomMax?: number` | The configured Smart Random range, only set when the resolved target source is `"smart-random"` |
| `pendingTargetTime?: number` | The target to show/use for the *next* shot when the resolved target source is `"smart-random"` or `"manual"` — see "Target model" |
| `completedAt?: string` | Set once a newer block takes over; `undefined` means this is the active block |
| `accuracyThresholds?: { onTarget, acceptable }` | **Target Accuracy** tolerance, snapshotted once at block creation from whichever preset/custom pair was selected — never re-derived from the app's current default afterward. See ADR-0008 and `src/lib/accuracyThresholds.ts`. |

**Do not conflate four different concepts that all live near each other on this type:**

1. **Training mode** (`mode`) — *what kind of training is this block* (Fixed / Variable / Blind).
2. **Target source** (`variableTargetMode` / `blindTargetMode`) — *how is the target for the next shot determined* (Fixed / Smart Random / Coach-Manual). Only Variable and Blind blocks have one; Fixed Weight blocks are implicitly target-source "fixed".
3. **Measurement mode** (`measurementMode`) — *what the release time physically measures* (Back-Hog / Hog-Hog). Orthogonal to both of the above — any training mode can (in principle) use either measurement mode, though Smart Random is currently only available for Back-Hog.
4. **Shot classification** (`shot.shotType`) — *draw or takeout*, a property of the individual shot, not the block. Fixed and Variable Weight shots have one; Blind Weight shots do not (see "Shot" below).

`trainingBlocks.ts`'s `getEffectiveTargetMode(block)` is the one place that reads
`variableTargetMode`/`blindTargetMode` and normalizes them into a single
`"fixed" | "smart-random" | "manual"` value — every target-generation function
downstream (`getNextShotTarget`, `advanceBlockTarget`, `createTrainingBlock`) is written
once against that normalized concept instead of branching on `mode` repeatedly.

### Shot

| Field | Meaning |
|---|---|
| `blockId` | The block this shot belongs to (shots are flat on the session, not nested) |
| `shotNumber` | 1-based, sequential **within its block** — deleting a shot renumbers only the remaining shots of that same block |
| `releaseTime: number` | The measured release time — always required |
| `targetTime: number` | **The target that actually applied to this specific shot.** Always required, always a plain number captured at save time. Never recomputed, never touched again — even if the block's default target, Smart Random range, or pending target later change. This is what makes Variable/Blind Weight's changing targets historically safe: a block-level change can never retroactively alter what an already-recorded shot was judged against |
| `predictedTime?: number` | The player's own guess, locked in **before** `releaseTime` was known. Present **only** for Blind Weight shots; always `undefined` for Fixed/Variable Weight, and never fabricated during migration |
| `handle: "in" \| "out"` | Required for every shot, including Blind Weight |
| `shotType?: "draw" \| "takeout"` | **Optional.** Required in practice for Fixed/Variable Weight (the UI always sets one); genuinely absent for Blind Weight, which trains perception rather than shot execution. A missing `shotType` is a real, valid state — it is never defaulted to `"draw"` by the app itself. (Migration *does* fold truly-legacy garbage values like the removed `"guard"`/`"other"` into `"draw"`, since those were real historical classifications that no longer have a matching type — see "Persistence and migration") |

## Training modes (Implemented)

### Fixed Weight

- One constant target (`block.targetTime`) for every shot in the block.
- Each shot still stores its own `shot.targetTime` (copied from the block's target at
  save time) — Fixed Weight is simply the case where every shot in a block happens to
  share the same value, not a special code path in analytics or export.
- Shot type (draw/takeout) is required, same as it always has been.
- Analytics run unmodified: `analyzeShots` always compares each shot to its own
  `targetTime`, which is trivially correct here.

### Variable Weight

Target source (`variableTargetMode`) is one of:

- **Smart Random** — the app generates a new target after every shot, within a
  configured range. Only available when `measurementMode === "back-hog"` (see
  "Measurement modes"). Default for newly-created Variable Weight blocks.
- **Coach / Manual** — a human enters the next target before each shot. The
  previously-used value stays as an editable starting point so the same value can be
  reused or lightly adjusted without retyping it.

Both share:
- No required shot type — draw/takeout may still be picked (`ShotEntry.tsx` always
  offers it for Fixed/Variable), but nothing about target generation depends on it.
- Each shot's own `targetTime` is what was actually shown/used for that shot.
- `pendingTargetTime` holds the next target and survives reload; it is only
  regenerated *after* a shot is saved, never before.
- `smartRandomMin`/`smartRandomMax` hold the configured range for Smart Random blocks.
- The "natural transition" logic (below) applies identically to Blind Weight's Smart
  Random target source — it is not duplicated per training mode.

### Blind Weight

Trains the player's ability to *perceive* their own release time before it's measured.
Target source (`blindTargetMode`) is one of **Fixed**, **Smart Random**, or **Coach /
Manual** — Blind Weight is the only mode with a Fixed target-source option, since here
"fixed" describes *what the perception task is measured against*, not the training mode
itself (see ADR-0004).

- No shot type required, same reasoning and same "never fabricate one" rule as above.
- Entry follows a 3-phase state machine (`predict` → `measure` → `review`) — documented
  in full below.
- **Important clarification:** Blind Weight does not mean the app already knows the real
  release time and hides it. The actual release time genuinely doesn't exist inside the
  app until the player reads it off the external timing system and types it in — *after*
  locking their prediction. There is no capture-then-mask step anywhere in this codebase.
- A Blind Weight *draft* (in-progress prediction/measurement) is not a `Shot` — see
  ADR-0002. It never appears in analytics, charts, History, or CSV export while
  incomplete, and reload is allowed to lose it (only the block's own configuration and
  `pendingTargetTime` are guaranteed to survive reload).
- `shot.predictedTime` is set **only** on Blind Weight shots, at the moment of saving —
  never on Fixed/Variable Weight shots, never invented during migration.

## Target model (Implemented)

Four distinct concepts that are easy to conflate — kept deliberately separate here:

1. **Block default target** (`block.targetTime`) — the constant target for Fixed Weight
   and Blind+Fixed; the initial seed value used to create the very first
   `pendingTargetTime` for Manual mode.
2. **Next target** (`block.pendingTargetTime`) — what Smart Random/Manual blocks will use
   for the *next* shot. Persisted, survives reload, only changes after a shot is saved.
3. **Actually-used shot target** (`shot.targetTime`) — the immutable, per-shot value
   described above.
4. **Target source** (`variableTargetMode`/`blindTargetMode`) — which of the three
   generation strategies below produced #2.

### Fixed

`block.targetTime` is used directly for every shot; `pendingTargetTime` is never set for
this target source (`getNextShotTarget` falls through to `block.targetTime` whenever
`pendingTargetTime` is `undefined`).

### Manual (Coach)

- `pendingTargetTime` is seeded from `block.targetTime` at block creation.
- Before saving, the UI may override it (`ShotEntry`/`BlindShotEntry`'s editable target
  input); whatever value is actually used becomes both `shot.targetTime` and the new
  `pendingTargetTime` (`advanceBlockTarget`), so the same/adjusted value is ready as the
  next starting point without retyping.
- Earlier shots are never touched by a later manual change — `shot.targetTime` is a
  plain number copied at save time, not a reference to the block.

### Smart Random (`src/lib/variableTargets.ts`)

- Configured per block via `smartRandomMin`/`smartRandomMax` — **not** a fixed profile;
  the user picks the range they want to train (e.g. a narrow takeout-weight band) at
  block setup. Default for a newly-created block: **min 2.50s, max 4.50s**
  (`DEFAULT_SMART_RANDOM_MIN`/`MAX`).
- Step is **not** user-configurable: always **0.05s** (`SMART_RANDOM_STEP`). Minimum
  valid range width: **0.10s** (`MIN_SMART_RANDOM_RANGE_WIDTH`). Both bounds are snapped
  to the 0.05s grid and re-validated after snapping (`validateSmartRandomRange`).
- The next target is generated by `generateSmartRandomTarget({ min, max, recentTargets,
  randomFn })` and stored as `pendingTargetTime` — **only after a shot is saved**
  (`advanceBlockTarget`), never speculatively. Reload never changes it, because it's
  read straight from the persisted block.
- **Natural transitions**, not pure uniform randomness (this was a deliberate fix — a
  naive uniform draw could jump e.g. 4.45 → 2.50 → 4.35 between consecutive shots, which
  doesn't train anything realistic):
  - ~85% of the time (`1 - LARGE_JUMP_PROBABILITY`, `LARGE_JUMP_PROBABILITY = 0.15`) the
    next target stays within `TYPICAL_MAX_DELTA` (**0.40s**) of the last one — or the
    whole range, if the range itself is narrower than 0.40s.
  - ~15% of the time the next target may come from anywhere in the range, to train real
    adaptability.
  - Either way, exact repeats of the most recent target(s) are avoided when the range
    offers alternatives (2 shots of memory in the typical case, 1 in the large-jump
    case); if avoidance or the delta window would leave nothing to pick, the pool widens
    back to the full range rather than searching indefinitely — `generateSmartRandomTarget`
    always resolves in exactly 1–2 calls to its injected `randomFn`, never a loop.
- **Smart Random is currently only available for `measurementMode === "back-hog"`**
  (`isSmartRandomAvailable`). Hog-Hog has no validated range anywhere in this project's
  history — **it never falls back to the Back-Hog range or any invented Hog-Hog range**.
  When Hog-Hog is selected, Smart Random is disabled in the setup UI with an explicit
  explanation, and Fixed/Manual remain available (see ADR-0004 and Measurement Modes
  below).

## Measurement modes (Implemented / Open decision)

### Back-Hog

- **Implemented.** The only measurement mode with a validated Smart Random range today.
- Every training mode (Fixed, Variable, Blind) and every target source works with it.
- The exact curling-specific physical definition of "Back-Hog" (which line, which
  direction) is **not** re-derived or re-defined in this document — it's assumed to be
  the release-timing convention already understood by the app's users. If a precise,
  written physical definition doesn't exist elsewhere yet, that is an **open
  documentation gap**, not a code gap.

### Hog-Hog

- **Implemented for Fixed and Coach/Manual target sources.** Any training mode can use
  Hog-Hog as its measurement mode as long as its target source doesn't require Smart
  Random.
- **Smart Random is deliberately disabled for Hog-Hog** (`isSmartRandomAvailable`
  returns `false`) — not because it's technically hard, but because there is no
  validated Hog-Hog target range anywhere in this project (no prior defaults, no mock
  data, no product decision). Inventing one, or reusing the Back-Hog numbers, would
  silently misrepresent a physically different measurement as if it were the same thing
  — this was an actual bug earlier in this project's history, fixed and now guarded
  against (see ADR-0004).
- **Open decision:** what a validated Hog-Hog Smart Random range should be. Needs a
  domain expert / real training data, not an engineering guess.

## Blind Weight state machine (Implemented)

`src/lib/blindWeight.ts` holds a single discriminated `BlindShotDraft.phase`, not a set
of independent booleans — this makes states like "measured but no locked prediction" or
"reviewing without a measured time" structurally unrepresentable rather than merely
discouraged by convention.

```mermaid
stateDiagram-v2
    [*] --> Predict
    Predict --> Measure: lockPrediction (requires phase === predict)
    Measure --> Predict: editPrediction
    Measure --> Review: setMeasuredReleaseTime + confirmMeasuredTime (requires a measured time)
    Review --> Predict: editPrediction
    Review --> Measure: editMeasuredTime
    Review --> Saved: Save (requires isDraftComplete)
    Saved --> Predict: draft reset to INITIAL_BLIND_SHOT_DRAFT
```

Allowed transitions (all implemented as pure functions in `blindWeight.ts` that return
the draft **unchanged** — a safe no-op — if the precondition isn't met):

| Function | From → To | Precondition |
|---|---|---|
| `lockPrediction(draft, predictedTime)` | predict → measure | phase is `predict` |
| `setMeasuredReleaseTime(draft, releaseTime, source)` | measure → measure (no phase change) | phase is `measure` — this is the one function that never changes phase by itself; see "External timing integration" below |
| `confirmMeasuredTime(draft)` | measure → review | phase is `measure` **and** a measured time is already set |
| `editPrediction(draft)` | measure/review → predict | phase is `measure` or `review` |
| `editMeasuredTime(draft)` | review → measure | phase is `review` |
| `isDraftComplete(draft)` | (query, no transition) | true only when phase is `review` with both values set — gates the Save button |

Forbidden by construction (not just convention): predicting straight into review;
reviewing without a locked prediction or a measured time; a measured time becoming
visible before the prediction is locked; saving an incomplete draft.

**Value validation** (predicted/measured time must be a positive, parseable number) is
the caller's responsibility — `BlindShotEntry.tsx` validates before calling into
`blindWeight.ts`, which only enforces phase-transition validity, not value shape.

**Correction paths:** Edit Prediction (from measure *or* review) returns to predict with
the old prediction still shown as an editable value; Edit Measured Time (from review
only) returns to measure with the prediction still locked and the old measured value
editable. Neither path touches any already-saved `Shot` — they only ever mutate the
local, unsaved draft.

**Leaving an incomplete draft:** `hasUnsavedBlindProgress(draft)` is simply
`phase !== "predict"`. `TrackerApp.tsx` tracks this as `hasUnsavedBlindDraft` and gates
History navigation, "New Training Block", and "Start New Session" behind the existing
`ConfirmModal` ("You have an unfinished blind-weight shot..."). Confirming discards the
draft — no shot is saved, no shot number is consumed, `pendingTargetTime` is untouched —
and bumps `blindDraftResetToken`, which is part of `BlindShotEntry`'s React `key`, so a
subsequent *cancelled* action (e.g. dismissing the New Training Block modal) can't
resurrect the discarded draft.

**Reload:** the draft is plain component state, not persisted — a reload always resets
to `predict`. Only the block's configuration and `pendingTargetTime` are guaranteed to
survive reload (see ADR-0002 for why this is the deliberate first-cut rule, not an
oversight).

**Block switch / session end:** same discard-with-warning behavior as "leaving" above —
there is no separate code path for these; they all funnel through the same
`runOrConfirmBlindDraftDiscard` guard in `TrackerApp.tsx`.

**Why draft and Shot are separate concepts:** a `Shot` is meant to be a permanent,
analyzable training record. A draft is mid-entry UI state that may be wrong, abandoned,
or corrected multiple times before it's ever complete. Merging them would mean either
inventing fake shots for incomplete data, or teaching every consumer of `Shot` (charts,
analytics, export, filters) to understand "maybe incomplete" — both worse than keeping
the draft a purely local, throwaway concept until `isDraftComplete` is true.

## Data flows (Implemented)

### Block creation

```text
TrainingSetup (validated input)
  → tryCreateTrainingBlock (TrackerApp) — defensive re-validation, since a
    setCurrentSession updater must never throw
  → createTrainingBlock (trainingBlocks.ts)
      → resolve effective target mode (fixed / smart-random / manual)
      → validateSmartRandomRange, if applicable
      → generateSmartRandomTarget for the initial pendingTargetTime, if applicable
  → addTrainingBlock — stamps completedAt on the outgoing block, appends the new one
  → setCurrentSession → persisted to localStorage by the session-write effect
```

### Normal shot capture (Fixed / Variable Weight)

```text
getNextShotTarget(activeBlock) — the target already computed for this render
  → ShotEntry captures releaseTime, handle, shotType (+ a manual target override, if editable)
  → handleAddShot (TrackerApp)
      → computeShotTarget — manual override wins, else the pending/default target
      → new Shot stamped with that targetTime, next shotNumber in this block
      → advanceBlockTarget — generates/updates pendingTargetTime for the *next* shot
  → setCurrentSession → analyzeShots recomputed on next render from the updated shots
  → persisted to localStorage
```

### Blind Weight shot capture

```text
Target shown (Fixed value, or Auto-generated, or editable Manual field)
  → BlindShotEntry: predict phase — capture handle + predictedTime → lockPrediction
  → measure phase — read the external timing system → setMeasuredReleaseTime → confirmMeasuredTime
  → review phase — show target/prediction/actual/prediction error/target error
  → Save Shot & Continue → handleAddShot (same function as the normal flow, with
    shotType: undefined and predictedTime set)
  → advanceBlockTarget generates the next target only now
  → draft resets to predict
```

### Migration (`sessionMigration.ts`)

```text
Read raw JSON from localStorage
  → migrateSession(raw)
      → migrateBlocks — normalize mode/measurementMode/target sources; fabricate a
        single "Legacy Block" ONLY when `blocks` is entirely absent (not when it's an
        empty array — see the migration invariant below)
      → migrateShots — backfill missing shot.targetTime from the shot's block; never
        invent predictedTime; fold legacy/garbage shotType values to "draw", but leave a
        genuinely absent shotType absent
      → backfillPendingTargets — ensure variable/blind blocks have a valid
        pendingTargetTime and (for Smart Random) a valid range; force Hog-Hog Smart
        Random blocks to Manual (never fabricate a Hog-Hog range)
  → migrated Session used for the rest of the app's lifetime this load
```

### Export (`export.ts`)

```text
Session or session history
  → buildSessionCsv / buildHistoryCsv (pure string builders, no DOM access)
      → join each shot with its block (name, mode, target source, measurement mode, range)
      → compute prediction_error / absolute_prediction_error (blank if no predictedTime)
      → compute target_error / absolute_target_error (always present)
      → round every computed error to 3 decimals
  → exportSessionToCsv / exportHistoryToCsv — wrap the string in a Blob and trigger a download
```

## Analytics (Implemented)

All in `src/lib/analytics.ts`, operating on whatever `Shot[]` is handed to
`analyzeShots` — filtering happens *before* this call (`filterShots`), so every
metric described here is already filter-aware without analytics needing to know about
filters at all.

**Release-time metrics** — plain statistics of `shot.releaseTime`, no target involved:
`average`, `median`, `min`, `max`, `releaseTimeStandardDeviation`.

**Target metrics** — every shot judged against its own `shot.targetTime`:
- `averageDeviationFromTarget` (signed bias) and `averageAbsoluteDeviationFromTarget`
  (magnitude), both defined as `releaseTime - targetTime`.
- `targetErrorStandardDeviation` — spread of that same per-shot error. Kept under an
  unambiguous, distinct name from `releaseTimeStandardDeviation` on purpose (an earlier
  iteration of this app conflated "how much did release times vary" with "how much did
  they miss their target by" under one ambiguous `standardDeviation` field).

**Prediction metrics** (`analysis.prediction.*`) — Blind Weight only, computed from
whichever shots in the input happen to have a `predictedTime`:
- `predictionErrors` / `meanPredictionError` — signed, `predictedTime - releaseTime`.
  Positive means the player believed they were slower than they actually were; negative
  means they believed they were faster.
- `meanAbsolutePredictionError` — magnitude only, overall self-assessment accuracy.
- `predictionErrorStandardDeviation` — consistency of the self-assessment.
- `predictionCorrelation` — Pearson r between predicted and actual release time.
  **Never shown or interpreted alone** — a player who is confidently, consistently
  wrong by the same offset (e.g. always guesses 0.20s slow) can still score a high
  correlation. It is always shown alongside bias, absolute error, and standard
  deviation in the UI (Dashboard, History, Block Summary) for exactly this reason.
- All four return `null` — never `0`, `NaN`, or `Infinity` — when there isn't enough
  data: correlation needs ≥ 2 points with non-constant predicted *and* actual values
  (division by zero is guarded explicitly); the others need ≥ 1 shot with a
  `predictedTime`. Fixed/Variable Weight shots (no `predictedTime`) are silently excluded
  from these four metrics rather than counted as a prediction error of `0`.
- **UI naming note:** the Dashboard/History card labeled *"Avg Prediction Error"* /
  *"Mean Abs Prediction Error"* is always the **absolute** value
  (`meanAbsolutePredictionError`); the **signed** bias is always labeled *"Prediction
  Bias"*. This distinction is intentional and already consistent across the codebase —
  no renaming was needed as part of this review, but the naming will bear repeating if
  more prediction cards are ever added.

### Target Accuracy (Implemented, ADR-0008)

A second target-related lens, added alongside the plain target-deviation metrics above
— judges each shot against a resolved `AccuracyThresholds` snapshot rather than just
computing a raw error. `analyzeShots(shots, thresholds?)` takes an optional threshold
parameter (defaulting to the legacy/Standard preset for backward compatibility with
every pre-existing call site) and exposes:

- **`targetAccuracy: TargetAccuracyAnalytics`** (`computeTargetAccuracyAnalytics`) —
  `meanTargetError` (bias) and `meanAbsoluteTargetError` (magnitude) kept as always-
  distinct fields; `onTargetCount`/`acceptableCount`/`majorMissCount` (mutually
  exclusive, see `categorizeTargetError` in `src/lib/accuracyThresholds.ts`) plus their
  rates; `largestAbsoluteMiss`, `averageMajorMiss`,
  `positiveMajorMissCount`/`negativeMajorMissCount` (split by signed direction). All
  rate/mean fields are `null` — never `0`/`NaN`/`Infinity` — for zero shots.
- **`handleAccuracy: HandleAccuracyComparison`** (`computeHandleAccuracyComparison`) —
  the same `TargetAccuracyAnalytics` shape computed independently for `in`/`out`
  handle groups. Filtering always happens before this grouping.
- **`targetErrorBoxPlot` / `handleTargetErrorBoxPlots`** (`src/lib/boxPlotStatistics.ts`)
  — boxplot statistics (median-of-halves quantiles, 1.5×IQR whiskers/outliers) computed
  over **Target Error, never raw Release Time**. A boxplot's statistical outlier is a
  different concept from a Major Miss (see the Domain Glossary) and the two are never
  cross-labeled.
- **`interpretTargetErrorDirection(targetError, measurementMode)`** — the one place
  Target Error's sign is turned into language. Returns a mathematical `sign`
  (`"faster" | "slower" | "on-target"`) and a neutral `relativeToTargetLabel` always;
  only for `measurementMode === "back-hog"` does it also return a `curlingTendency`
  (`"more-weight-long" | "less-weight-short"`) — Hog-Hog has no documented, validated
  curling-outcome mapping for its sign, so it deliberately stays neutral-only (same
  "no fabricated precision" posture as Hog-Hog Smart Random, ADR-0004).

### Chart data preparation (Implemented) — `src/lib/chartData.ts`

Pure functions that shape already-filtered `Shot[]`/block data into chart-ready arrays
— no analytics computation happens inside any chart component (`src/components/*Chart.tsx`);
they only receive prepared data and render it. Covers: `prepareTargetErrorByShotData`,
`prepareTargetVsActualScatterData` (+ `hasMultipleTargetTimes`),
`prepareProgressMetricData` (+ rolling average, `groupProgressEntriesByMeasurementMode`),
`prepareShotQualityDistributionData`, and `hasUniformThresholds` (gates whether
on-target/acceptable reference bands or a "Thresholds vary" notice should show for a
multi-block selection). Chart color/label tokens live in `src/lib/chartTheme.ts` — no
chart hard-codes a handle/category color or re-derives sign-formatted text locally.

## History Analytics and Filtering (Implemented) — `src/lib/historyAnalysis.ts`

Everything in the History view — Key Progress Summary, Progress Metric Chart, Shot
Quality Over Time, the Target vs. Actual Scatterplot, Handle Analysis, and the
Blocks/Sessions list — reads from **one** `HistoryAnalysisContext`, built by
`buildHistoryAnalysisContext(sessionHistory, filters)`. No History chart or card is
allowed to independently re-filter `sessionHistory`; `TrackerApp.tsx`'s History branch
builds the context once per render and passes its fields down.

```text
All historical sessions
  → extract blocks and shots
  → HistoryAnalysisFilters (Training Category, Measurement Mode, Date Range, Handle,
    Shot Type, Session, Block, Target Range, Threshold Comparison Mode)
  → filtered comparable blocks (HistoryAnalysisBlockContext[])
  → filtered shots (flat, shot-level, across every comparable block/session)
  → progressEntries / scatter points / handle analytics / session-block list
```

### Training Category vs. Training Block vs. Session

*Training Category* is the UI-facing name for the existing `BlockMode` type (Fixed /
Variable / Blind Weight) — **not** a new domain concept or a renamed type; see
`TrainingCategory` in `historyAnalysis.ts`, a plain alias. A *Training Block* is one
concrete block within a *Session* (a Session may contain several different Blocks).
Progress is always computed **per comparable Training Block**, one point per block —
different Blocks within one Session are never automatically merged into a single
figure, and a Session-level rollup (in the Blocks/Sessions list) never mixes Measurement
Modes or Training Categories without an explicit "varies" notice.

### `HistoryAnalysisFilters`

```ts
type HistoryAnalysisFilters = {
  trainingCategory: TrainingCategory | null; // BlockMode | null
  measurementMode: MeasurementMode | null;
  dateRange: DateRangeFilter; // all | 30d | 90d | 6m | custom
  handles: Handle[];   // empty = Both
  shotTypes: ShotType[]; // empty = All
  sessionIds: string[];  // empty = All
  blockIds: string[];    // empty = All
  targetRange?: { min?: number; max?: number };
  thresholdComparisonMode: ThresholdComparisonMode;
};
```

**Defaults** (`resolveDefaultTrainingCategory`/`resolveDefaultMeasurementMode`): a single
available Training Category or Measurement Mode is auto-selected; with multiple
available, the previously-chosen value (persisted in `localStorage` under
`curling-release-tracker-history-filters`, the same simple per-key pattern already used
for the current session/history, not a new settings architecture) wins, else the first
available one — the app never leaves both unset, which would silently let incompatible
categories/modes mix in Progress or the Scatterplot. This resolution is a **plain
render-time derivation** in `TrackerApp.tsx` (`effectiveHistoryFilters`), not a
`useEffect` writing state back — deriving it during render avoids the
`react-hooks/set-state-in-effect` lint violation a naive "sync defaults via effect"
implementation would trip, and avoids an extra render pass.

### Threshold Comparison Mode

```ts
type ThresholdComparisonMode =
  | { type: "original" }
  | { type: "comparison"; thresholds: AccuracyThresholds };
```

- **Original** (default): each block is judged against its own persisted
  `accuracyThresholds` snapshot (ADR-0008) — "how well did I perform against the
  standard used in that training?"
- **Comparison**: every selected shot is temporarily re-classified with one shared
  `AccuracyThresholds` (Standard/Tight preset, or Custom) — "how do all selected
  trainings compare under one consistent standard?" This **never** mutates a
  `TrainingBlock` or `Shot` — `HistoryAnalysisBlockContext.thresholds` simply holds the
  override for that render's analytics instead of the block's own snapshot. Scatterplot
  coordinates (`targetTime`/`actualTime`) are unaffected either way; only
  On Target/Acceptable/Major Miss classification changes.
- `aggregateTargetAccuracyAcrossBlocks` (used for the Key Progress Summary rollup)
  categorizes **each shot against its own block's effective threshold** before
  counting — correct even when Original-mode blocks carry different snapshots, rather
  than picking one threshold and misjudging every other block against it.
  `representativeThresholds` picks a single value for *display labels only* (e.g. "within
  ±0.10s") when blocks disagree, falling back to the legacy default — the same
  approximation this codebase already used for the pre-existing session-level rollup.

**Compare: Custom UI flow (`HistoryFilterBar.tsx`)** — selecting "Compare: Custom…" from
the Threshold Comparison Mode `<select>` reveals On Target / Acceptable input fields
immediately, seeded with sensible starting values (the currently-active Standard/Tight
preset's numbers, or the Standard default if none was active) the first time Custom is
entered from a fresh, unedited state. A local `thresholdModeSelection` tracks the
dropdown's own selection separately from the applied `filters.thresholdComparisonMode`,
since Custom needs an explicit Apply step (gated on the same
`validateAccuracyThresholds` every other threshold entry point already uses — no second,
divergent validation logic) while Standard/Tight/Original apply immediately. Once the
coach edits a Custom field by hand (or a valid value is applied/restored from reload),
the fields are marked "dirty" so a later Standard/Tight→Custom switch never silently
overwrites an already-considered value; Reset explicitly restores the Standard default
and clears that flag. Switching to Original, editing Custom, and switching back to
Custom preserves the not-yet-applied entry — none of this ever mutates a `TrainingBlock`
or `Shot`, only the render-local Comparison override (same guarantee as the Decision
above). `sanitizeThresholdComparisonMode`/`sanitizeHistoryFilters`
(`historyAnalysis.ts`) repair an invalid persisted Custom value (corrupt/hand-edited
`localStorage`) to Original on load — the same "never invent a value, fall back to a
documented safe default" discipline `sessionMigration.ts` uses for `TrainingBlock`s.

### Dynamic analytics visibility

- **Handle Analysis** (`HandleAnalysisSection.tsx`) inspects which handles actually have
  shots in the current selection: two present → "Handle Comparison"; exactly one → "{Handle}
  Distribution" (never called a comparison); zero → an explicit empty state, not a blank
  chart.
- **Blind Weight** Prediction Accuracy cards (`PredictionDashboardCards`) only render
  when the selection's Training Category is Blind Weight — Target Accuracy cards remain
  the same for every category, since they apply uniformly (see ADR-0008).
- The Scatterplot is prominent (always expanded) for Variable Weight; for Fixed Weight
  with only one distinct target time it renders inside a collapsed `<details>` (secondary,
  one tap to expand) instead of being hidden — see "Current Session information
  hierarchy" below.

### Multi-session Scatterplot

`TargetActualScatterChart` is always shot-level (never reduced to block averages) and,
in History, receives every filtered shot across every comparable block/session at once
via `prepareTargetVsActualScatterData(shots, blocksById, sessionContextByBlockId)` — the
same function already used for the single-block Current Session case, now called with a
cross-block/cross-session shot list. `TargetVsActualPoint` carries `trainingCategory`
and `measurementMode` (in addition to the pre-existing `blockName`/`sessionTitle`/`date`)
so the History tooltip can show them. Back-Hog and Hog-Hog are never combined (the
Measurement Mode filter guarantees this upstream); combining Fixed and Variable Weight
deliberately, in one chart, is **not implemented** in this pass (see Technical Debt).

### Metric and chart explanation architecture — `src/lib/analyticsExplanations.ts` + `InfoButton.tsx`

One `AnalyticsExplanation` record (`title`, `shortDescription`, `whatItShows`,
`howToRead[]`, `betterMeans[]`, optional `possiblePatterns[]`/`limitations[]`) per core
metric/chart — the single source of truth rendered by `InfoButton.tsx` (an accessible
popover on wide screens, a bottom sheet on narrow ones via CSS breakpoints alone, same
markup) wherever that metric/chart appears (`DashboardCard`'s optional `explanation`
prop, `ChartCard`'s optional `explanation` prop). Chart subtitles read
`shortDescription`; nothing hard-codes a second copy of the same text. Back-Hog gets an
additional curling-tendency sentence (`biasExplanation`, `targetErrorByShotExplanation`);
Hog-Hog explanations stay neutral, since no validated curling-outcome mapping exists for
its sign (same posture as `interpretTargetErrorDirection`, ADR-0004's "no fabricated
precision"). `ExplanationContext` (`"current" | "history"`) swaps only the
*interpretation* framing (immediate in-block feedback vs. recurring cross-block
patterns) — the underlying math is identical either way.

`ChartCard`'s and `DashboardCard`'s title rows use a `<header>`, not a `<div>`, to hold
the title/label plus `InfoButton` — both to keep the popover's block-level content
(`<h3>`/`<p>`/`<ul>`) out of an invalid `<p>`-in-`<p>`/`<h2>`-containing-`<div>` nesting,
and so existing tests that scope a card by "the div containing this title" keep
resolving to the card's own root element instead of a new title-only wrapper.

### Training concept explanation architecture — `src/lib/helpContent.ts` + `InfoButton.tsx`

A second, deliberately separate content source from `analyticsExplanations.ts`: that
file explains *already-recorded analytics* (a metric or chart); `helpContent.ts`
explains a *training concept a user is choosing or configuring* — today, Training
Category (Fixed/Variable/Blind Weight) and Measurement Mode (Backline – Hog/Hog – Hog).
One `FeatureExplanation` record (`title`, `shortDescription`, `purpose`, `howItWorks[]`,
`usefulFor[]`, optional `limitations[]`) per concept — `trainingCategoryExplanation(mode)`
and `measurementModeExplanation(mode)` are the lookup functions every call site uses;
no component hard-codes this text a second time.

`InfoButton.tsx` renders **either** shape (`AnalyticsExplanation | FeatureExplanation`,
distinguished by a `"purpose" in explanation` type guard) through the same popover/sheet
shell, keyboard/Escape/focus behavior, and `aria-label` pattern — not a second Info
component. `TrainingSetup.tsx` places one `InfoButton` per Training Mode option, one per
Measurement Mode option, and one on the Accuracy Tolerance section heading (reusing
`analyticsExplanations.ts`'s existing On Target/Acceptable/Major Miss definitions via a
new `accuracyThresholdsSetupExplanation()`, framed for someone about to choose a
tolerance rather than someone reading a result). Each per-option Info button is a
**sibling** of that option's selection `<button>` inside a small `position: relative`
wrapper `<div>` — never nested inside the selection button — so it can never produce an
invalid `<button>`-in-`<button>` and clicking it can never also select that option
(sibling elements don't receive each other's click events).

### History information hierarchy

Sticky Analysis Filters (`HistoryFilterBar.tsx`, primary: Training Category, Measurement
Mode, Date Range, Handle, Threshold Comparison Mode; secondary, behind "More filters":
Shot Type, Session, Block, Target Range) → Analysis Context (`AnalysisContextSummary.tsx`
— headline + block/shot/date-span counts + short, non-overloading notices) → Key
Progress Summary → Progress Metric Chart → Shot Quality Over Time → Target vs. Actual
Scatterplot → Handle Analysis → Blocks and Sessions (a detail/navigation list onto the
same filtered selection — it no longer computes its own, separately-filtered rollup).

### Current Session information hierarchy

Active Block header + Shot Entry/Auto Capture → Dashboard (immediate feedback) → Target
Error by Shot (primary live chart) → Handle Analysis (same dynamic-visibility component
as History) → Target vs. Actual Scatterplot (prominent for Variable Weight; collapsed
`<details>` for Fixed Weight with one target) → Current Shots list → Target Time
Settings / Session Settings / Export / Start New Session. Same interpretation-text
math as History, framed for immediate in-block feedback (`ExplanationContext: "current"`).

## Persistence boundary (Implemented)

Every persisted domain is read and written through an application-owned repository, not
through direct `localStorage` calls scattered across components — see
`docs/PERSISTENCE_BOUNDARY_DESIGN.md` and `docs/adr/0013-application-owned-persistence-repository-boundary.md`
(Accepted. Implemented) for the full design and rationale. Summary of what exists today:

- **`StorageAdapter`** (`src/lib/persistence/localStorageAdapter.ts`) is the only file
  permitted to reference the `localStorage` global directly — enforced by
  `src/lib/persistence/__tests__/architectureBoundary.test.ts`, a filesystem scan rather
  than a custom ESLint rule (deferred as unnecessary for this phase). It never throws;
  both `get`/`set` resolve to a typed result (`StorageGetResult` /
  `PersistenceWriteResult`), classifying any raw browser exception
  (`QuotaExceededError`, storage-unavailable, etc.) before it can escape the boundary.
- **Seven repositories** (`SessionRepository`, `HistoryFiltersRepository`,
  `AssessmentRepository`, `TrainingPlansRepository`,
  `AccuracyToleranceProfilesRepository`, `SmartRandomProfilesRepository`,
  `AssessmentPreferencesRepository`) each wrap the adapter and one domain's existing
  migration/serialization logic unchanged. Every `load*` method resolves a
  `DomainLoadResult<T>` with three distinct outcomes — `"value"`, `"absent"`, or
  `"read_failed"` — never conflating a genuinely missing key with a storage failure (see
  design doc §8.2 for why that distinction matters:
  `SessionRepository.loadCurrent()`'s doc comment is the concrete cautionary example —
  calling `migrateSession` on a failure's fallback would fabricate a bogus "Legacy
  Block", ADR-0005).
- **Hydration** in `TrackerApp.tsx` is a three-state model per domain (`"loading"` →
  `"ready"` or `"write_protected"`, see `src/lib/persistence/types.ts`). A domain's save
  effect only runs once hydration reaches `"ready"` (via either `"value"` or `"absent"`);
  a `"read_failed"` result leaves that domain `"write_protected"` for the rest of the
  session — its state is set to the result's display-only fallback, but nothing is ever
  written back over whatever is actually stored. The Timing Simulator subscription is
  additionally gated on session hydration reaching `"ready"` specifically, so a session
  read failure can never let a stale or not-yet-hydrated session receive timing results.
- This phase is strictly behavior-preserving: storage keys, serialized shapes, and the
  lack of cross-save deduplication are all unchanged from before the boundary existed
  (design doc §6). IndexedDB, cloud sync, and the rest of design doc §10 remain
  unimplemented.
- **The current-session-before-history write order is preserved by the current
  implementation, not guaranteed by the repository contract itself.** It holds today
  because `localStorageAdapter` resolves synchronously under the hood and React fires
  passive effects in declaration order — not because `Promise<PersistenceWriteResult>`
  itself promises any ordering. A future genuinely-asynchronous adapter (IndexedDB or
  otherwise) would need its own explicit sequencing decision before this order could
  still be relied on (design doc §6, §10).

### Readiness gating at the interaction boundary (Phase 1 correction, Implemented)

Save-effect write-guards (`if (xHydration !== "ready") return;`, above) are necessary but
not, by themselves, sufficient: an audit of the initial Phase 1 implementation
(`PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md`) found that History Filters, Training Plans,
Accuracy Tolerance Profiles, and Smart Random Profiles all exposed a fully interactive
control backed by that domain's initial default *before* its own repository load had
resolved — a user could create a Training Plan, an Accuracy/Smart Random profile, or
change a filter during that window, only to have the late-arriving mount-effect result
silently overwrite it once the load resolved. `AssessScreen.tsx`'s threshold-preset and
custom-threshold controls had the same defect, plus a second race:
`handleViewAssessment` started a fresh, unguarded preference read on every call, whose
late completion could force navigation after the user had already moved on.

The corrected rule, applied per domain, independently, **with no per-domain exception**:
`"loading"` — no user action may mutate that domain, and its mutating control(s) are not
even rendered; `"ready"` — normal interaction and persistence are permitted;
`"write_protected"` — the fallback may be displayed, but every control that mutates the
domain or implies durable persistence is visibly disabled (never merely a silently
no-op'd control that still looks interactive). Two layers are both required: the visible
UI gate prevents a user from being misled into interacting with something that cannot
durably take effect, and a matching guard at the top of every handler that mutates that
domain's state is defence in depth against any trigger path that bypasses the UI layer.
Neither layer alone is sufficient on its own.

An earlier pass of this correction treated History Filters as an exception, reasoning
that an in-memory-only change to a single, always-overwritten preference object is
harmless since its own save effect already refuses to persist anything once
write-protected. External review rejected that reasoning: the user-visible guarantee
("this control is unavailable") must be identical across every domain regardless of what
happens underneath. History Filters' controls (five `<select>`s, the custom-threshold
inputs, "More filters" and its own contents) are now all passed
`disabled={historyFiltersHydration !== "ready"}`, exactly like every other domain's
controls, with `onChange` additionally routed through a handler-level guard
(`handleChangeHistoryFilters`) as defence in depth.

The "Training Plans" tab, the "Manage Accuracy Tolerances"/"Manage Smart Random
Profiles" buttons, and the History Filter bar are disabled the same way. Session gained
the same treatment for its own `"write_protected"` case specifically (its `"loading"`
case was already safe, structurally, via the pre-existing `if (!currentSession) return
null;` render gate): every *reachable* Session-mutating control is now visibly
disabled — the Quick Start "Start Training" submit, the session name/notes fields, the
Training Plan "Start Training" review button, the per-session-history "Delete" button,
and "Clear History" — and every Session-mutating handler (`handleStartNewSession`, block
creation/editing, session-history delete/clear, manual shot entry, Auto Capture start,
etc.) also guards on `sessionHydration === "ready"`, together with
`processQueuedTimingResult`'s non-Assessment branch. Manual timing entry, Auto Capture,
and the Timing Simulator panel are, in the current implementation, structurally
*unreachable* rather than merely disabled while Session is write-protected: the fallback
`SessionRepository.loadCurrent()` returns on a read failure is always a blockless
`createNewSession()`, and since every block-creating handler is guarded, `activeBlock`
can never become non-null for the rest of that session — none of that UI ever mounts.
Assessment received the equivalent treatment via its single choke point,
`updateAssessmentState`, plus a `disabled` prop on `AssessmentOverview` that visibly
disables the threshold-preset radios, the custom-threshold inputs, the setup-confirmation
controls, and "Start Warm-up" together, so a user cannot complete an apparently
functional setup that could only ever end in a silent no-op. Pure navigation that neither
mutates the Assessment domain nor implies durable workflow progress ("View
Assessment"/"Resume Assessment" from Landing) stays available regardless of Assessment's
own hydration state, since it depends only on the separately-gated preferences hydration
below. Each domain's gate is independent — one domain being unavailable never disables an
unrelated, already-ready domain.

**Why not a dirty-flag ("user state wins") guard instead**, which would be simpler: for a
*collection* domain (Training Plans, Accuracy Tolerance Profiles, Smart Random Profiles),
"skip the late load if the user already touched this domain" is unsafe on its own — the
UI starts from an *empty* default, so if the user creates one item before the real load
resolves, the late result is (correctly) skipped, but the complete stored collection is
then never applied at all, and the user's one new item silently becomes the entire
collection once hydration reaches `"ready"` and the save effect fires — replacing a
missed-update bug with a data-loss bug. Readiness gating avoids this because it closes
the window entirely rather than trying to resolve a conflict after the fact; no
conflict-merge, operation-replay, or three-way-merge logic was introduced.

`AssessScreen.tsx`'s three preference reads (last threshold preset, last custom
threshold, show-introduction) are now hydrated together, once, by a single mount-time
effect, tracked by a local `preferencesHydration: "loading" | "ready"` flag — the
threshold-preset/custom-threshold controls do not render at all until that settles, so
there is no "interactive default, then silently replaced" window. The Assessment entry
action itself ("View Assessment"/"Resume Assessment"/"Start New Assessment" on
`AssessmentLanding`) is disabled while `preferencesHydration === "loading"`, since it
decides between Guided Introduction and Overview using that hydrated value — an action
whose outcome depends on an asynchronously-hydrated preference must stay unavailable
until that preference settles, not merely resolve to a same-tick default and call itself
safe because the read is synchronous. `handleViewAssessment` no longer performs its own
read at all; it reads the already-hydrated `showIntroductionPreference` value
synchronously, which eliminates the late-completion-overrides-navigation race by
construction (there is no longer a pending Promise per click for a later resolution to
override anything with), and still guards on `preferencesHydration === "ready"` as
defence in depth.

**Accepted, undisplayed consequence (Finding 6 of the audit):** no call site in
`TrackerApp.tsx`/`AssessScreen.tsx` inspects the `PersistenceWriteResult` any `save*`/
`set*` call returns — every write remains fire-and-forget, same as the original Phase 1
implementation. This is a deliberate, product-owner-accepted deviation from the
pre-Phase-1 code's (crude, uncaught-exception-based) write-failure visibility, not a
claim of equivalence: a raw storage exception can no longer escape and crash a render,
but a quota-exceeded or storage-unavailable write failure is now also completely silent
to the user. Write-failure notification, retry, and recovery UX remain deferred (see
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`).

This section covers `Session`/`Session History` specifically for the migration rules
below. **For the complete, re-verified inventory of all 10 persisted `localStorage` keys
across all 7 independent domains** (Session, History Filters, Assessment, Training
Plans, Accuracy Tolerance Profiles, Smart Random Profiles, Assessment Preferences) see
`docs/PERSISTENCE_BOUNDARY_DESIGN.md`.

Session and Session History are two `localStorage` keys, read and written through
`SessionRepository` (`src/lib/sessionRepository.ts`), via two independent `useEffect`s
in `TrackerApp.tsx`:

- `curling-release-tracker-current-session` — the current `Session`.
- `curling-release-tracker-session-history` — a `Session[]` of completed sessions.

Migration (`migrateSession`) runs unconditionally on every successful load of either key
(a `"value"` result), whether
the data is brand new or years old — there is no version field or explicit "needs
migration" check; the function is written to be a safe no-op on already-current data.

- **Legacy sessions** (no `blocks` array *at all*) get a single fabricated `"Legacy
  Block"` (Fixed Weight, Back-Hog) to hold their pre-block-era shots.
- **⚠️ Migration invariant — do not regress this:** a session with `blocks: []` (an
  *empty array*, meaning "no first block configured yet") is **not** legacy data and
  must **never** be treated as if it were. This was an actual, shipped bug: a freshly
  created session that got written to `localStorage` before its first block existed —
  a completely normal state — was misdetected as legacy on the next load and given a
  bogus, unrequested "Legacy Block", silently skipping the intended setup screen. The
  fix (`Array.isArray(raw.blocks)` rather than a truthiness/length check) is covered by
  a regression test and must be preserved by any future change to `migrateBlocks`.
- **Missing `targetTime`** on an old shot is backfilled from that shot's own block's
  target; if even the block has none, a documented constant (`3.75`) is used —
  `predictedTime` is never backfilled this way; it's either present or stays `undefined`.
- **Missing `variableTargetMode`** defaults to `"manual"` (assume the old behavior was
  manual entry, since Smart Random didn't exist yet when such data could have been
  written) — new blocks default to `"smart-random"` instead; migration and creation are
  intentionally allowed to have different defaults.
- **Missing `blindTargetMode`** defaults to `"fixed"` if the block already has a
  `targetTime`, otherwise `"manual"`.
- **Smart Random ranges** missing on an old block default to
  `DEFAULT_SMART_RANDOM_MIN`/`MAX` (2.50s–4.50s).
- **Invalid Hog-Hog Smart Random blocks** (only possible from an earlier, since-fixed
  bug that let Hog-Hog share the Back-Hog range) are forced to Manual on migration; the
  old numeric `pendingTargetTime` is kept only as a plain, freely-editable manual
  starting value — never re-presented as if it were a validated range.
- **`pendingTargetTime`** already inside the (possibly just-backfilled) range is left
  untouched; outside the range, a single new one is generated once.
- **Missing or invalid `accuracyThresholds`** (absent, NaN, Infinity, zero/negative, or
  `acceptable <= onTarget`) repairs to the fixed legacy default (0.10s / 0.20s) — never
  to whichever preset the app currently defaults new blocks to (see ADR-0008). A valid
  stored snapshot is left untouched.
- **Already-recorded shot values are never rewritten** by migration, under any
  circumstance — only block-level configuration gaps are filled in.
- **Migration must be idempotent** — running it twice on its own output must be a
  no-op. This is enforced by tests (`sessionMigration.test.ts`) for every migration path
  described above, including the Hog-Hog-forced-to-Manual case.

## External timing integration boundary (Prepared)

See `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md` for the full discovery plan. Summary
of what exists today:

```ts
setMeasuredReleaseTime(draft: BlindShotDraft, releaseTime: number, source: ReleaseTimeSource)
```

- `ReleaseTimeSource` (`src/types/index.ts`) is `"manual" | "external"`. Only `"manual"`
  is used today (typed into the Measured Release Time field); `"external"` exists as a
  named, tested placeholder — **no hardware, protocol, or device integration exists**.
- The function only takes effect during the `measure` phase (see the state machine
  above) — a value arriving through this path before the prediction is locked is
  silently discarded, by construction, not by a special case. This is the one rule that
  must hold regardless of where a future reading comes from: **an externally-supplied
  time must never become visible before the prediction is locked.**
  `source` is not currently stored anywhere (not on the draft, not on the `Shot`) —
  there is no product need for it yet; storing it later would be additive, not breaking.
- **Buffering an early external reading is intentionally not built.** Today, "too
  early" simply means "discarded". A real integration will need to decide whether to
  buffer a reading that arrives before the lock and re-deliver it once `measure` is
  reached, or require the device to wait for a "ready" signal — that decision is
  deferred, not resolved, to avoid guessing at hardware behavior that isn't known yet.
- Target architecture (**Planned**, not built):

  ```text
  Timing Device → Device Adapter → Release-Time Input Boundary
    → Blind Weight State Machine (setMeasuredReleaseTime, gated by phase)
    → Review → Shot Save
  ```

  The "Device Adapter" and "Release-Time Input Boundary" layers don't exist as code yet
  — `setMeasuredReleaseTime` **is** the input boundary today, just fed exclusively by a
  manual text field. A future adapter would call the exact same function; the state
  machine does not need to change to support it.

## Capture Sequences (Implemented for Fixed/Variable Weight; Prepared for Blind Weight; Planned for real hardware)

Automatic, sequential capture of multiple shots from a stream of timing readings —
built around the exact same provider-neutral boundary described above, generalized
beyond Blind Weight's single-value case. See ADR-0006 for the central design decision
and `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md` for how this relates to a future
real device.

### The shared Timing Provider boundary (`src/lib/timingProvider.ts`)

```ts
interface TimingProvider {
  type: TimingProviderType; // "simulator" | "manual" | "external"
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  subscribe(listener: (result: TimingResult) => void): () => void;
}
```

- A `TimingResult` (`src/types/index.ts`) is a normalized reading:
  `{ id, receivedAt, source, measurements: TimingMeasurement[], deviceId?, laneId? }`.
  A `TimingMeasurement` is `{ measurementMode, value }` — a result *may* carry more than
  one measurement (e.g. a future device reporting Back-Hog and Hog-Hog from one throw),
  but only the one matching the active block's `measurementMode` is ever consumed; the
  rest are neither saved nor counted.
- Three implementations exist or are named today:
  - **Manual** (`createManualTimingResult`) — wraps a typed-in value into the exact same
    `TimingResult` shape. This is not a fallback bolted on beside the real boundary; it
    **is** the boundary, same as `setMeasuredReleaseTime`'s manual path for Blind Weight.
  - **Simulator** (`src/lib/simulatorTimingProvider.ts`, `SimulatorTimingProvider`) —
    development/test-only. Implements `TimingProvider` plus test-trigger methods
    (`simulateResult`, `simulateDuplicate`, `simulateDelayed`,
    `simulateMultiMeasurementResult`, `simulateInvalidResult`). Gated out of the
    production UI by `process.env.NODE_ENV !== "production"` in `TrackerApp.tsx` — it is
    never started, subscribed to, or rendered in a production build.
  - **External** (`"external"` as a `TimingProviderType` value) — **Planned, not
    implemented.** Named ahead of time, same as `ReleaseTimeSource` was for Blind Weight,
    so a future real adapter is just another `TimingProvider` implementation; nothing
    downstream needs to change.
- `ReleaseTimeSource` (Blind Weight's existing type) is now a type alias of
  `TimingProviderType` — same concept, same values, one definition instead of two
  competing ones for "where did this value come from."

### Capture Sequence domain model (`src/lib/captureSequence.ts`, `CaptureSequence` in `src/types/index.ts`)

A `CaptureSequence` is scoped to exactly one `TrainingBlock`, belongs to exactly one
`Session` (`session.captureSequence?`), and only ever has one active instance per
session at a time.

| Field | Meaning |
|---|---|
| `expectedShotCount` | Mandatory, validated whole number > 0, capped at `MAX_CAPTURE_SHOT_COUNT` (200 — a technical ceiling against typos, not a sporting limit) |
| `capturedShotCount` | Shots actually **saved** by this sequence — a duplicate, invalid, mismatched, or paused-and-discarded result never increments this |
| `status` | `"ready" \| "running" \| "paused" \| "completed" \| "cancelled"` |
| `handleMode` | `"manual" \| "fixed-in" \| "fixed-out" \| "alternate"` — see below |
| `shotType?` | Optional fixed classification applied to every captured shot — only meaningful for Fixed Weight, consistent with Variable/Blind Weight never requiring one |
| `processedResultIds` | Every `TimingResult.id` ever submitted, accepted or not — a resend of any of these is always a duplicate |
| `steps: CaptureStepRecord[]` | One entry per successfully captured shot, in order — the only state Undo needs (see below) |

Status transitions (`startCaptureSequence`, `pauseCaptureSequence`, `resumeCaptureSequence`,
`cancelCaptureSequence`) are pure, no-op-on-invalid-transition functions, same shape as
`blindWeight.ts`'s phase transitions. A sequence completes automatically the moment
`capturedShotCount === expectedShotCount` — there is no separate "finish" action.

**Blind Weight is deliberately out of scope for this pass** — `createCaptureSequence`
throws if `block.mode === "blind"`. Prediction must be locked before a measured time may
be used, which the current linear "receive result → save shot" flow doesn't model; rather
than build an unsafe half-integration, Blind Weight keeps its existing full manual
predict → measure → review flow, and Auto Capture is not offered for it (the UI shows an
explicit "not available yet" message). This is a **Prepared, not Planned-in-detail**
integration point — see `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`.

### Handle strategies

The handle for the *next* captured shot is computed by `computeNextCaptureHandle`,
purely from `capturedShotCount` (and, for `"manual"`, from live UI state) — nothing
extra needs to be persisted or reconstructed for Undo:

- `"fixed-in"` / `"fixed-out"` — constant.
- `"alternate"` — flips every shot starting from `startHandle`
  (`capturedShotCount % 2 === 0 ? startHandle : opposite`).
- `"manual"` — whatever the live "Next Handle" toggle in the UI currently says.

A duplicate, invalid, mismatched, or paused-and-discarded result never advances
`capturedShotCount`, and therefore never advances the handle sequence either.

### The one shot-save path (`processTimingResult`)

```ts
processTimingResult({ result, sequence, session, activeBlock, manualTargetOverride?, manualHandleOverride? })
```

This is the **only** place a `TimingResult` becomes (or doesn't become) a `Shot`.
Simulator results, manual-fallback results submitted through "Add Result Manually," and
(later) real hardware results all pass through here identically. It reuses the exact
same functions manual entry (`handleAddShot` in `TrackerApp.tsx`) already uses —
`computeShotTarget`, `advanceBlockTarget`, `getBlockShots`, `getNextShotNumberInBlock`
from `trainingBlocks.ts` — so Auto Capture can never diverge from manual entry's target
resolution, shot numbering, or target-advancement logic. There is deliberately no
parallel shot-save path.

Processing order (short-circuits at the first matching condition):

1. Result's block doesn't match the active block → `invalid`.
2. Sequence is `completed`/`cancelled` → `ignored-completed`.
3. Sequence is `paused` → `ignored-paused` (a result arriving while paused is
   **discarded, not buffered** — the same deliberate scope limit as Blind Weight's
   external-timing boundary; see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`).
4. `result.id` already in `processedResultIds` → `duplicate`.
5. No measurements at all → `invalid`.
6. No measurement matches the active block's `measurementMode` → `measurement-mode-mismatch`
   (the result is never saved as a shot and never counted — but it's diagnosable, not
   silently dropped).
7. Matching value isn't plausible (`Number.isFinite(value) && value > 0`) → `invalid`.
8. Otherwise → `accepted`: a new `Shot` is built (target/handle/shot-number resolved via
   the shared functions above, plus `measurementSource`/`captureSequenceId`/
   `timingResultId`/`deviceId`/`laneId` from the result), the block's pending target is
   advanced, a `CaptureStepRecord` is appended, and the sequence completes automatically
   if `capturedShotCount` now equals `expectedShotCount`.

A value outside `[0.5s, 30s]` (`isUnusualTimingValue`) is **not** rejected — it's still
saved, with a non-blocking `unusualValueWarning` ("Unusual timing value: 12.85s. Saved.
Undo if this was a false trigger.") shown to the user. No sport-specific precision range
is enforced, consistent with this project's "no fabricated precision" principle.

### Target behavior per training mode

- **Fixed** — every captured shot uses `block.targetTime`, same as manual entry.
- **Variable / Smart Random** — the currently-shown `pendingTargetTime` is used; a new
  one is generated only *after* a shot is successfully saved, never speculatively —
  identical timing to manual entry.
- **Variable / Coach-Manual** — the live "Current Target" input in the Auto Capture
  panel supplies `manualTargetOverride`; capture only proceeds once this holds a valid
  target, mirroring `ShotEntry`'s existing editable-target requirement for this same
  target source.

### Undo (`undoLastCapturedShot`)

Reverses only the most-recently-captured shot **of this exact sequence** — never an
older manual shot. Restoration is exact, not reconstructed:

- The removed shot's `CaptureStepRecord.previousPendingTargetTime` is written back to the
  block verbatim — **no new random target is ever generated**, so Smart Random Undo
  cannot produce a different target than existed before the undone shot.
- `capturedShotCount` is decremented; a `"completed"` sequence flips back to `"running"`
  if its last shot is undone.
- Handle progress is automatically correct once `capturedShotCount` is decremented, since
  `computeNextCaptureHandle` is a pure function of that count — no separate handle
  history needs restoring.
- **The undone result's id is deliberately NOT removed from `processedResultIds`** — it
  stays "spent" forever for this sequence. A replacement shot needs a genuinely new
  `TimingResult` id; resubmitting the undone one is still a `duplicate`. This is a
  chosen semantic (see ADR-0006), not an oversight.

### Pause / Resume / Cancel

- **Pause** does not stop the `TimingProvider` itself (pausing is a sequence-level
  concern) — it stops results from being processed as shots. A result received while
  paused is diagnosed as `ignored-paused` and discarded; the UI also disables "Add
  Result Manually" while paused, as a matching UX signal (the domain layer would refuse
  it either way).
- **Resume** picks up exactly where the sequence left off — target, handle progress, and
  `capturedShotCount` are all untouched by pausing.
- **Cancel** (`ConfirmModal`-gated) sets `status: "cancelled"`. Already-saved shots are
  never deleted; the active block is untouched; classic manual shot entry remains fully
  available afterward; no session end is triggered.
- Attempting to leave a running/paused sequence (open History, start a New Training
  Block, or Start New Session) shows the same kind of `ConfirmModal` warning already used
  for an in-progress Blind Weight draft (`runOrConfirmCaptureLeave`, composed with the
  existing Blind guard via `guardLeavingActiveWork` in `TrackerApp.tsx`) — confirming
  cancels the sequence (shots already saved remain) before the navigation proceeds.

### Persistence and reload (`sessionMigration.ts`'s `migrateCaptureSequence`)

- The active `CaptureSequence` is persisted as part of `Session` and migrated on every
  load, same as everything else in `sessionMigration.ts`.
- **A `"running"` sequence is always forced to `"paused"` on load** — the
  `TimingProvider` (in particular the Simulator) is never silently running again after a
  reload; the user must explicitly tap Resume. Doing this only when the *raw* stored
  status is literally `"running"` (not when it's already `"paused"`) keeps migration
  idempotent — a second migration pass doesn't stamp a fresh `pausedAt` over an existing
  one.
- `expectedShotCount`/`capturedShotCount`/`processedResultIds`/`steps` all survive reload
  unchanged — no double-counting, no re-processing of already-seen result ids.
- A structurally invalid persisted sequence (no valid `expectedShotCount`, or more real
  captured shots than `expectedShotCount` allows) is **discarded, not repaired** — same
  "don't invent a value migration can't know" rule as the rest of `sessionMigration.ts`.
  A sequence referencing a block that no longer exists is discarded the same way, before
  `sanitizeCaptureSequence` ever runs. See "Persistence validation and repair" below for
  the cases that ARE repaired rather than discarded.

### Race conditions and serialized result processing (Implemented)

Two distinct problems, both solved by the same mechanism (`TrackerApp.tsx`):

1. **Two `TimingResult`s arriving in the same synchronous tick** (two simulator events
   fired without an `await` between them, or a simulator event and an "Add Result
   Manually" click landing together) must never be processed concurrently, never read a
   torn/stale copy of each other's in-flight work, and must never collide on shot number,
   double-count, or silently drop one of the two.
2. **Reading the *outcome* of a state transition synchronously**, right after triggering
   it (needed for the "Shot N captured: X.XXs" feedback and the Simulator's debug log) —
   this is a different problem from #1, and the two are easy to conflate. React
   guarantees that queued functional `setState` updaters chain correctly against each
   other (a later updater always sees the result of an earlier queued one), but it does
   **not** guarantee an updater is invoked *synchronously* at the moment `setState` is
   called — that only happens as an internal "eager state" optimization when no other
   update is already pending. Code that needs to synchronously know a transition's
   outcome cannot safely depend on that optimization (it silently stops firing the moment
   two updates are queued in the same tick).

**Chosen solution:** a small, hand-rolled Promise queue plus an authoritative session
mirror — no external state-management library, no reducer framework.

```text
processIncomingTimingResult(result)
  → captureQueueRef.current = captureQueueRef.current.then(() => processQueuedTimingResult(result))
      → reads sessionRef.current (never `currentSession` from the render closure)
      → applyTimingResultToSession(...) — the pure atomic transition (see below)
      → commitSession(nextSession) — writes sessionRef.current AND calls setCurrentSession
        synchronously, together, before returning
  → next queued result starts from here
```

- `sessionRef` (a `useRef`) mirrors the session. Every capture-mutating action —
  processing a result, and every Pause/Resume/Cancel/Undo/Start-sequence handler, via a
  shared `commitSession(nextSession)` helper — writes this ref **synchronously**, at the
  same point it calls `setCurrentSession`. This is what makes "read the latest session
  right now, without waiting for a render" possible at all.
- `captureQueueRef` is a `Promise` that each call to `processIncomingTimingResult` chains
  onto via `.then()`. Because `.then()` callbacks for the same promise chain always run
  in registration order, two results queued back-to-back — even in the exact same
  synchronous tick — are guaranteed to run one at a time, each starting from the
  immediately-preceding result's already-committed `sessionRef.current`. An outer
  `.catch()` on the chain exists purely so a bug in the queue plumbing itself (not an
  ordinary rejection like `"duplicate"`, which is a normal return value, never a thrown
  exception) can never permanently wedge the queue and silently drop every subsequent,
  unrelated result.
- This makes `processIncomingTimingResult` **not synchronous** — actual processing is
  always deferred by at least one microtask. This is a deliberate trade-off: the tiny,
  imperceptible delay buys a correctness guarantee that doesn't depend on React's
  internal `setState` batching/eager-evaluation behavior at all.
- `sessionRef` is also resynced after every render (in a `useEffect`) as a catch-all for
  the *other*, non-capture handlers (`handleAddShot`, `handleDeleteShot`, block
  creation, ...) that still use the classic functional-`setState`-updater pattern and
  don't call `commitSession`. **Known, narrow edge case, out of scope for this pass:** if
  a classic manual shot (`ShotEntry`) is added in the same render window as a capture
  result is being processed for the *same* block (both can be on screen at once — Auto
  Capture is additive, not exclusive), there is a brief window before the next render
  where `sessionRef` may not yet reflect the manual shot. See
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.

### The atomic Capture Sequence transition (Implemented)

`applyTimingResultToSession({ session, result, manualTargetOverride?,
manualHandleOverride? })` (`src/lib/captureSequence.ts`) is the single pure function that
computes "old `Session` + `TimingResult` → new `Session`" in one step: shot append,
block replace, and `CaptureSequence` replace are computed together and returned as one
object, never as three separately-observable state changes. It has no framework
dependency (plain values in, plain values out), which is what makes it safely callable
from the hand-rolled queue above instead of needing React's `setState` semantics at all —
and independently unit-testable without a browser or React (see
`captureSequence.test.ts`'s `applyTimingResultToSession` suite, which exercises exactly
this: two and three results applied sequentially never collide on shot number; a
manual result and a simulator result interleaved each get a distinct, deterministic
position; a rejected result returns the *exact same* session reference, proving no
partial mutation happened).

### Save-Fehler semantics: paused + `lastError`, not a new status (Implemented)

`processTimingResult`/`applyTimingResultToSession` never throw for an ordinary
rejection (duplicate, invalid, paused, completed, mismatch) — those are always a normal
returned outcome. A genuine exception (a bug, not a rejection) is caught in
`TrackerApp.tsx`'s `processQueuedTimingResult`: the session's shots/blocks are left
**exactly as they were** (no partial capture progress), and the sequence is forced into
`"paused"` with a new `lastError: string` field set (`pauseCaptureSequenceWithError`),
surfaced in the Auto Capture UI. There is deliberately **no** separate `"error"`
`CaptureSequenceStatus`: reusing `"paused"` means every existing paused-state UI/guard/
migration rule already applies without needing a new one, and Resume already means "the
user has explicitly decided to continue" — `resumeCaptureSequence` clears `lastError` on
a successful resume, so a subsequent successful capture starts from a clean slate. No
automatic retry is attempted.

### Persistence validation and repair (Implemented)

`sanitizeCaptureSequence(sequence, shotsForThisSequence)` (`src/lib/captureSequence.ts`)
is called from `sessionMigration.ts`'s `migrateCaptureSequence`, after structural
coercion (type-checking raw JSON) and after the block-reference/`expectedShotCount`
discard checks. It cross-checks the sequence against `shots` — **the actually-saved
shots are the primary source of truth**, never the separately-stored counters:

- `capturedShotCount` is always recomputed from the real number of shots whose
  `captureSequenceId` matches — never trusted from the stored value.
- `steps` is filtered to only those whose `shotId` matches a real, still-existing shot —
  a step referencing a vanished shot is dropped, never repaired by inventing one.
- `processedResultIds` is widened (never narrowed) from the *original, unfiltered*
  steps — so a result whose shot later vanished still stays "spent" forever; it can
  never accidentally become resubmittable as if it were new.
- `completedAt`/`cancelledAt` are cleared whenever they don't match `status` (e.g. a
  `completedAt` stamp on a `"running"` sequence is nonsensical and discarded).
- A `"completed"` sequence whose real shot count doesn't actually reach
  `expectedShotCount` is reopened as `"paused"` (with a `lastError` explaining why) —
  safer than either silently treating it as done, or discarding real, valid shots.
- The whole sequence is discarded (not repaired) if `expectedShotCount` isn't a valid
  positive integer, or if the real captured-shot count exceeds `expectedShotCount` — an
  impossible state that can't be safely repaired by guessing which shots "shouldn't
  count."
- `sanitizeCaptureSequence` is idempotent by construction (applying it to its own output
  is a no-op) — verified by a dedicated test, the same discipline
  `sessionMigration.ts` already applies everywhere else.

### Provider lifecycle and Strict Mode (Implemented)

The Simulator subscription effect in `TrackerApp.tsx` follows the standard
subscribe-in-effect / unsubscribe-in-cleanup shape: `subscribe`/`unsubscribe` are a
plain `Set` add/delete, and `start`/`stop` are a plain boolean flag (both idempotent —
calling either twice in a row changes nothing further). This means:

- React Strict Mode's dev-only mount → cleanup → remount double-invoke can never result
  in two active listeners — the cleanup always unsubscribes the first listener before
  the second mount subscribes a new one.
- A delayed/in-flight simulated result from an instance that has since been cleaned up
  (unsubscribed) can never reach a listener that no longer exists — it simply has no
  listener to call.
- A delayed result that fires while the *same* listener is still subscribed, but after
  the sequence it was intended for has been cancelled, is still correctly rejected — not
  by any provider-level mechanism, but because `processTimingResult` checks the
  sequence's `status` at processing time, not at emission time (see "Race conditions"
  above): a `"cancelled"`/`"completed"` sequence ignores every result regardless of when
  it arrives.
- **Known, documented scope limit:** a `TimingResult` carries no sequence identity (real
  hardware has no concept of "which capture sequence" either — see ADR-0006). If a
  sequence is cancelled and a **new** sequence is started for the same block before a
  stale delayed result arrives, that result is attributed to the new, running sequence
  as its next shot — there is no "generation token" tying a result to the specific
  sequence that was active when it was requested. This is a deliberate, tested
  simplicity trade-off (see `tests/e2e/stale-callback.spec.ts`), not an oversight — see
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.
- Verified directly at the provider level by a dedicated unit test simulating the exact
  Strict Mode mount→cleanup→remount sequence (`simulatorTimingProvider.test.ts`).

### Contract for a future real Timing Provider (Planned, formally specified now)

Any future non-simulator, non-manual `TimingProvider` implementation must satisfy:

- **Result id** — stable within one provider source; the same id for a genuine retry of
  the same reading; a new id for a genuinely new measurement. The app treats id equality
  as the *only* signal of duplication — two results with an identical measured value but
  different ids are two distinct shots, never merged or treated as suspicious.
  **No exactly-once delivery is required or assumed** — the app is built to tolerate
  at-least-once delivery (duplicates arriving) by deduplicating on id; it never assumes a
  provider will avoid resending.
  Ordering: a provider should preserve the order readings actually occurred in, but the
  Capture Sequence layer serializes processing itself regardless (see "Race conditions"
  above) — it does not trust or depend on provider-side ordering for correctness.
- **Timestamps** — `receivedAt` is when the app received the result, not necessarily when
  the measurement physically occurred; a future adapter may add a separate
  measurement-time field additively, without needing to change this one's meaning.
- **Multi-measurement results** — a single result may carry more than one
  `TimingMeasurement`; only the one matching the active block's `measurementMode` is ever
  consumed. The order of measurements within one result carries no meaning about shot
  order — shot order is entirely determined by the order results are *processed* in, not
  by measurement array position.
- **Lifecycle** — `start()`/`stop()` and `subscribe()`/its returned unsubscribe function
  are the entire contract (see `timingProvider.ts`). A provider has no access to Session
  state, capture sequence state, or React state of any kind — it only ever emits
  `TimingResult` values to its subscribers. Error propagation and connection status are
  **not yet part of the contract** — deliberately deferred until a real device's actual
  failure modes are known (see `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`); a
  `TimingProviderError` shape was considered for this pass and intentionally not added,
  since inventing error codes for a device that doesn't exist yet would be exactly the
  kind of "looks real but isn't" fabrication this project's principles warn against.

### Shot metadata (`Shot` in `src/types/index.ts`)

Five new optional fields, all `undefined` for every shot recorded through the classic
manual flows (ShotEntry/BlindShotEntry) and never fabricated by migration:
`measurementSource`, `captureSequenceId`, `timingResultId`, `deviceId`, `laneId`. A
captured shot is otherwise an entirely ordinary `Shot` — analytics, History, charts,
filters, and CSV export all handle it without any special-casing, by construction (see
"Analytics" above and `export.ts`'s CSV columns).

### Not implemented (Planned)

Real hardware/radio/Bluetooth/USB/serial integration, an `"external"` `TimingProvider`
implementation, a formal `TimingProviderError` shape (considered, deliberately deferred —
see above), multi-lane or multi-athlete capture, a "generation token" tying a result to
the specific sequence that was active when it was requested (see the Provider lifecycle
scope limit above), buffering a result that arrives while paused, and Auto Capture for
Blind Weight. See `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md` and
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`.

## Platform Navigation (Implemented for Home/Train/Assess/Analyze/Settings)

See `docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md` for the product-level navigation
model and Home content, ADR-0009 for the original two architectural decisions
summarized here, and ADR-0011 for the Assess-specific navigation guard added in Phase B.

### Navigation config — `src/lib/navigation.ts`

A single `NAVIGATION_ITEMS: NavigationItem[]` array is the one place the platform's
top-level structure is declared: `{ id, label, availability }` per item, for
`home | train | assess | analyze | settings`. All five are `availability: "active"` as
of the Release Time Core Assessment v1 execution flow (Phase B) —
`getVisibleNavigationItems()` still filters on `availability`, so a future section can
still be added `"hidden"` first without a navigation/layout rewrite; this filter is just
not currently hiding anything.

`ActiveView` (`"home" | "train" | "assess" | "analyze" | "settings"`) is the
screen-switching type — kept distinct from `NavigationItemId` in case a nav entry is
ever reserved (`"hidden"`) again before its screen exists. `sanitizeActiveView`/
`isActiveView` resolve any value to a valid `ActiveView`, defaulting to `"home"` — used
by `src/lib/__tests__/navigation.test.ts`, not currently wired to persistence (see
below).

### `TrackerApp`'s `activeView` state

`TrackerApp` owns one `activeView: ActiveView` state value and renders exactly one of
`HomeScreen` / the Train JSX / `AssessScreen` / the Analyze JSX (a Training/Assessments
segmented control, no repeated screen title) / `SettingsScreen` based on it.
`PrimaryNavigation` is the only thing that calls `setActiveView` (via `handleNavigate`).
`TrackerApp` also renders the one screen-identifying header for whichever view is
active — `AppHeader` (full product identity) only when `activeView === "home"`,
`PageHeader` (compact contextual title + one-sentence description) otherwise — see
"Mobile shell, safe area and page headers" below.

### Leaving Train or Assess are the guarded transitions

The Blind-draft-leave guard, the Training-Capture-Sequence-leave guard, and (added in
Phase B) the Assessment-leave guard are composed by `guardLeavingActiveWork` (see
"Module responsibilities" below). `handleNavigate` gates on them when
`activeView === "train"` and the target is something else, or when
`activeView === "assess"` and the target is something else — navigating **into**
Train/Assess, or moving among Home/Analyze/Settings, is always safe by construction,
since neither Session nor Assessment state is touched by which screen currently
renders it. Confirming the Train guard still cancels an active Capture Sequence exactly
as it always did (see "Pause / Resume / Cancel" below); confirming the Assess guard
*pauses* (never cancels/abandons) an active Assessment Run — see ADR-0011 Decision 2 for
why pausing, not cancelling, is correct there. This pass generalized *which
navigations* trigger the existing guard mechanism, not what confirming
it does.

### Default view and reload behavior

Home is the default `activeView` on every normal load — no scheduling data model exists
yet to justify anything else, and nothing about Session/Capture state is protected by
*which* screen is shown first (both are read from `localStorage` and rendered correctly
whichever screen the user navigates to). The one exception: if the loaded session has an
active Capture Sequence (`isCaptureSequenceActive` — status `"ready"`, `"running"`, or
`"paused"`), the initial view is `"train"` instead, so a paused-on-reload sequence (see
"Persistence and reload" below) is immediately visible rather than hidden behind an extra
tap. `activeView` itself is **not** persisted to `localStorage` — seeing §"Non-goals" in
ADR-0009 for why not, and why no "invalid persisted view" migration exists for it (there
is nothing to migrate).

### Home screen composition — `src/components/HomeScreen.tsx` + friends

`HomeScreen` renders, in order: a plain time-of-day greeting (no card), `TodayPlanCard`,
`TrainingOverview`, `DeviceStatusCard`, and `FutureCapabilitiesSection` (which renders one
`FutureCapabilityItem` row per Schedule/Coach/Team inside one shared, dashed-border
container — not three individually-boxed tiles, which read as fragmented even when
stacked on mobile). All of them receive already-prepared data/callbacks as props — none
computes analytics or invents scheduling/coaching data;
`TrainingOverview`'s "Last Training"/"Total Sessions" figures are read directly from
`sessionHistory`/`currentSession`, not a new analytics function. There is no standalone
Quick Access section — its one non-redundant action ("View Analyze") is a secondary
control inside `TrainingOverview` instead (see
`docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md`'s Implementation Status for the full
rationale of this narrower, first-review information hierarchy). `TodayPlanCard` adds
one contextual action (Phase B) when an active, non-terminal Assessment Run exists —
"Resume Assessment" — computed from `assessmentState.currentRun` exactly like
`hasActiveAssessmentRun`/`onResumeAssessment`; never an invented or scheduled
assessment, only a real in-progress one. The full-product-identity title
(`AppHeader.tsx`) currently reads "Curling Performance" with the subtitle "Train,
assess and understand your performance." — a provisional, visible-only name/subtitle,
not reflected in package/PWA metadata. It is rendered by `TrackerApp` only on Home;
every other screen renders `PageHeader.tsx` instead (see below).

### Mobile shell, safe area and page headers

- **Content clearance** — `TrackerApp`'s one scrolling content root uses a single
  `app-content-clearance` utility class (`src/app/globals.css`) rather than a
  per-screen bottom-padding value, so the reserved space for the fixed mobile
  navigation (its rendered height + `env(safe-area-inset-bottom)` + a small visual
  gap) is centralized in one place. At `sm:` and above, where `PrimaryNavigation`
  returns to normal document flow, the class collapses to ordinary page padding.
- **Safe area** — `src/app/layout.tsx` exports a Next.js `viewport` config with
  `viewportFit: "cover"` (required for `env(safe-area-inset-*)` to resolve to a
  non-zero value on notch/Home-Indicator devices) and carries `themeColor` (moved
  there from `metadata` per Next's current API). `PrimaryNavigation`'s mobile bar is a
  floating, edge-inset surface (not five buttons flush against the device edge) that
  reads the safe-area inset directly in its own Tailwind class.
  `NAVIGATION_ITEMS`/`ActiveView`/`getVisibleNavigationItems` are unchanged.
- **Page headers** — `PageHeader.tsx` is a small shared component (title + optional
  one-sentence description, no card/border/shadow) used for Train/Assess/Analyze/
  Settings, so the large `AppHeader` product identity is never repeated as a card on
  every functional screen. Screens that previously rendered their own in-content
  "Train"/"Analyze"/"Settings" title card (e.g. the old "Analyze" / "History &
  Analytics" card) no longer do, since `PageHeader` now owns that role.

## Assessments (Phase A domain/persistence, Phase B execution flow, and Phase C Results/Analyze integration implemented)

See `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` for the authoritative product
and domain model this section only summarizes at an architecture-snapshot level,
`docs/adr/0010-assessment-domain-foundation.md` for the Phase A domain/persistence
decisions, and `docs/adr/0011-assessment-capture-ownership-and-app-shell-integration.md`
for the Phase B app-shell integration decisions (capture ownership, navigation guard,
persistence wiring) summarized below.

### Current state

- Assess is a real, active navigation item (see "Platform Navigation" above) — no
  longer reserved/hidden.
- The complete Assessment domain and persistence layer from Phase A is unchanged
  (`src/lib/assessment/` — types, the official Release Time Core Assessment v1
  template, the Run state machine, attempt semantics, raw/category metrics, comparison
  eligibility, defensive persistence/migration), plus one new Phase B addition,
  `src/lib/assessment/capture.ts` (see below).
- `AssessScreen.tsx` and its `Assessment*.tsx` sub-components drive the full Landing →
  Overview → Guided Introduction → Threshold/Setup → Warm-up → Scored Execution →
  Pause/Resume/Abandon → Completion Summary flow, calling the Phase A domain functions
  directly — no domain logic is duplicated in the UI layer.
- Training Sessions and Assessment Runs are both executable workflows now, sharing the
  app's single `TimingProvider`/`TimingResult` subscription under one
  status-derived capture-ownership rule (see below) — never simultaneously.

### Implemented Assessment domain (Phase A, unchanged)

Core concepts: `AssessmentTemplate`, `AssessmentBlockDefinition`, `PlannedAssessmentShot`,
`AssessmentRun`, `AssessmentAttempt`, `AccuracyThresholdSet`, `ProtocolDeviation`, plus
the official `RELEASE_TIME_CORE_ASSESSMENT_V1` template.

Architectural principles this module follows (see ADR-0010 for the full reasoning):

- Reuses `Handle`/`ShotType`/`MeasurementMode`/`TimingProviderType` and the existing
  `categorizeTargetError`/`average`/`standardDeviationOfValues` utilities directly —
  never redefines them.
- An `AssessmentRun` is not persisted as, or substitutable for, a Training Session —
  it has its own types, its own `localStorage` key, its own state machine.
- Every `AssessmentRun` holds a deep, immutable snapshot of the exact template version
  it was created from (`AssessmentRun.templateSnapshot`) — a later template edit can
  never retroactively change a historical run's protocol.
- Completed (and incomplete) runs are terminal: `transitionAssessmentRun` refuses any
  further status change, and `addValidAttempt`/`addInvalidAttempt` refuse any further
  attempt, once a run reaches `"completed"` or `"incomplete"`.
- Invalid Attempts and Protocol Deviations are preserved, never discarded — a wrong-handle
  attempt stays scored and valid, with the deviation recorded alongside it.
- Assessment persistence (`src/lib/assessment/persistence.ts` /
  `src/lib/assessment/migration.ts`) is schema-versioned and defensively validated on
  load: an individually invalid persisted run is quarantined (dropped) rather than
  partially repaired, since — unlike `Session`/`Shot`'s mostly-independent scalar
  fields — an `AssessmentRun`'s cross-field invariants (at most one valid attempt per
  planned shot, no duplicate `timingResultId`s, a completed run must cover every scored
  shot) make partial repair unsafe. See ADR-0010 and this module's doc comments for the
  full rationale.
- `pauseAssessmentRun` (`run.ts`, added in Phase B) composes the two already-legal
  `"warmup" -> "in_progress" -> "paused"` transitions so a run can be paused regardless
  of whether warm-up has finished — `ALLOWED_TRANSITIONS` deliberately has no direct
  `"warmup" -> "paused"` edge (see ADR-0011 Decision 3). This is the only function the
  app calls to pause a run.

### Capture integration (Phase B) — one shared TimingResult stream, ownership derived from Run status

`src/lib/assessment/capture.ts`'s `applyTimingResultToAssessmentRun(run, result,
executedHandle)` is the sole adapter from a `TimingResult` to `addValidAttempt` — the
Assessment-domain counterpart to `captureSequence.ts`'s `applyTimingResultToSession`.
`TrackerApp` keeps exactly one Timing Simulator subscription (unchanged from Training)
feeding one serialized processing queue; a new `isAssessmentCaptureActive()` check
(true iff `currentRun.status` is `"warmup"` or `"in_progress"`) decides, per result,
whether it's routed to Assessment (`processQueuedAssessmentTimingResult`) or to
Training's existing logic — never both, and never via a second, independently-set
"owner" flag that could desync from the Run's own status. Manual Assessment timing
entry (`AssessScreen`'s "Enter measured time") builds a `TimingResult` via the same
`createManualTimingResult` Training's manual fallback uses and pushes it through the
same queue, so there is exactly one code path that ever creates a valid Assessment
Attempt from captured input. See ADR-0011 Decision 1.

### Navigation guard and persistence wiring (Phase B)

`handleNavigate`'s guard (ADR-0009) now also protects leaving Assess while a Run is
actively warming up or scoring: confirming pauses the run (via `pauseAssessmentRun`,
never abandons/cancels it) before the navigation proceeds — composed into
`guardLeavingActiveWork` alongside the pre-existing Blind-draft and Training-Capture
guards. `assessmentState` (`AssessmentPersistedState | null`) mirrors
`currentSession`'s existing load/save-effect pattern exactly: its own `localStorage`
key (`ASSESSMENT_STORAGE_KEY`), read via `migrateAssessmentPersistedState` inside the
same mount effect, a save effect on every change, and an `assessmentStateRef` mirror for
the capture queue's synchronous reads (same rationale as `sessionRef`, ADR-0007). A
`currentRun` still `"warmup"`/`"in_progress"` at load time (i.e. it survived a reload
rather than an explicit Pause) is force-paused via `pauseAssessmentRun` before ever
rendering, so capture never silently reactivates without an explicit Resume — see
ADR-0011 Decision 4 for the reload-recovery/quarantine-notice details.

### Implemented Assessment Results and Analyze integration (Phase C)

All derivation is on-demand and pure — see `src/lib/assessment/result.ts`. No
`AssessmentResult` type is persisted; ADR-0010's rejection of caching derived metrics on
the Run extends to this phase too (ADR-0010's Decision 4 already anticipated exactly
this: ".../`metrics.ts`'s functions are cheap and pure enough to recompute on demand" —
`result.ts` is the same principle applied to richer, multi-dimensional breakdowns).

- `src/lib/assessment/result.ts` — block/target/handle/Variable-Adaptation breakdowns,
  Protocol Integrity summaries, comparison-ineligibility copy, an `AssessmentResultView`
  aggregate for a single run, `compareAssessmentRuns` (two protocol-comparable runs
  under one shared Comparison Threshold Set), and `buildAssessmentTrendSeries`
  (same-Template-and-Version completed runs only). Handle-based breakdowns group by the
  handle actually **executed**, not the planned/expected handle — an explicit
  implementation decision (the domain spec doesn't spell this out in exact words); a
  wrong-handle attempt's own Protocol Deviation stays independently visible via
  `ProtocolIntegritySummary`.
- `src/lib/assessment/persistence.ts` gained `getCompletedAssessmentRuns` /
  `getIncompleteAssessmentRuns` / `getLatestCompletedAssessmentRun` /
  `deleteAssessmentRunFromHistory` — still pure state-shape functions, no new
  `localStorage` access.
- `src/lib/assessment/export.ts` — a dedicated Assessment CSV builder
  (`buildAssessmentCsv`/`exportAssessmentRunsToCsv`), one row per attempt (valid and
  invalid), never merged with Training's `export.ts` CSV. `export.ts`'s `downloadCsv`
  is now exported so this module reuses the same download mechanics rather than
  duplicating it.
- `AssessmentResultScreen.tsx` (plus its `Assessment*.tsx` sub-components — see the
  components table below) is a read-only view over one already-terminal
  `AssessmentRun`: it never calls `updateAssessmentState` to mutate the run itself, only
  the Original/Standard/Tight/Custom Analysis Threshold selection (local UI state,
  recalculates category metrics only) and the caller-supplied `onDeleteRun` (removes the
  run from history as a whole). It is mounted from `TrackerApp.tsx` as a top-level
  overlay (`viewingAssessmentResultRunId`, an id, not the run object, so it always
  resolves against the latest `assessmentState` and self-clears if the run is deleted) —
  reachable from the Completion Summary's new "View Full Results" action, from
  `AssessmentLanding`'s "Latest Completed Assessment" card, and from Analyze →
  Assessments.
- Analyze gained a Training/Assessments tab (`analyzeTab` local state inside
  `TrackerApp.tsx`'s existing `activeView === "analyze"` block — no new top-level
  `ActiveView`/nav item). `AssessmentAnalyze.tsx` reads `assessmentState` directly:
  Latest Completed Assessment, separate Completed/Incomplete history lists
  (`AssessmentHistoryItem.tsx`), the empty state, and a CSV export action. Training's own
  History filters/state are untouched by switching tabs.
- **Known limitation**: navigating away from `AssessmentResultScreen` back into
  `AssessScreen` remounts `AssessScreen` from scratch (it was conditionally unmounted
  while the Result Screen overlay was shown), so an in-flight Completion Summary is
  lost in favor of Assess Landing — the archived run itself is never affected, only the
  transient "just completed" UI state. See `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.

### Not yet implemented

- Benchmarking, a synthetic overall score, athlete-level classification/capability
  profile, automatic training-focus suggestions, a Custom Assessment editor, coach/team
  workflows, cloud sync — see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "Assessment
  Framework" section. None of these were in scope for Phase C by design (see
  `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` sections 2/20).

## Training Plans (Implemented — Version 1)

See `docs/TRAINING_SYSTEM_AND_PLANS.md` for the authoritative product/domain
specification this section only summarizes at an architecture-snapshot level, and
`docs/adr/0012-training-plans-domain-and-execution-model.md` for the reasoning behind
the decisions below.

### Current state

- Training Plans live entirely inside the existing `"train"` `ActiveView` — no new
  navigation item. `TrainLanding.tsx` (mounted only when there is no active block)
  offers Quick Start (the pre-existing hero, unchanged) and Training Plans as two
  equally-reachable entry paths.
- A Training Plan (`TrainingPlan`/`TrainingPlanStep`/`ReleaseTimingPlanStep`/
  `HandleStrategy`/`ShotCountCompletion`/`ReleaseTimingBlockConfiguration`, all in
  `src/types/index.ts` — see ADR-0012 Decision 2 for why they live centrally rather
  than in their own `trainingPlans/types.ts`) is persisted independently of
  `currentSession`/`sessionHistory`, under its own `localStorage` key
  (`curling-release-tracker-training-plans`, `src/lib/trainingPlans/persistence.ts`).
- Starting a plan attaches `Session.planExecution?: PlanExecutionState` — a deep-copied
  snapshot of the plan's steps taken at start time, plus which step is active and
  which steps' `TrainingBlock`s have been created so far. A later edit or deletion of
  the source `TrainingPlan` can never affect this snapshot (spec invariant #2).
- Each step's `TrainingBlock` is created lazily, via the existing `addTrainingBlock`
  (`src/lib/trainingBlocks.ts`) — exactly when the athlete starts the plan or taps
  Continue — never all up front (ADR-0012 Decision 1). `handleAddShot` and Auto
  Capture's shot-save path are completely unchanged; a plan-driven block is an
  ordinary `TrainingBlock`.

### Domain (`src/lib/trainingPlans/`)

- `mapping.ts` — `mapPlanStepToTrainingBlockInput(step): NewBlockInput`, the one
  boundary translating a Plan Step template into `trainingBlocks.ts`'s existing block-
  creation input (spec section 40). Never re-validates; validation lives in
  `validation.ts`.
- `validation.ts` — `isStepExecutable`/`isPlanExecutable`/`validatePlanStep`/
  `validatePlan`, reusing `isSmartRandomAvailable`/`validateSmartRandomRange`
  (`variableTargets.ts`) directly rather than a second interpretation of "valid".
  Distinguishes "readable" (loads without crashing) from "executable" (safe to start)
  per spec section 53 — an unexecutable plan stays visible with an Edit action, Start
  disabled.
- `handleStrategy.ts` — `resolveExpectedHandle(strategy, shotsSavedInBlock)`, using the
  same alternation parity math as `captureSequence.ts`'s `computeNextCaptureHandle`
  (`shotsSaved % 2`), applied to classic manual entry instead of a Capture Sequence's
  `capturedShotCount`. `handleStrategyToCaptureHandleMode` maps a Handle Strategy onto
  `CaptureHandleMode` so a plan-driven block's Auto Capture setup can be pre-filled
  (still fully overridable).
- `progress.ts` — pure, derived-only functions: `isPlanExecutionActive` (true only
  when `session.activeBlockId` matches the active step's stored `blockId`, which
  itself resolves to a real block — false, never a crash or a guess, if a manual "New
  Training Block" interrupted the plan, or the reference is corrupt), `isActiveStepComplete`,
  `isFinalStep`, `isPlanComplete`, `getPlanProgressSummary`. Progression is always
  keyed by the snapshot's stored `blockId`, never `session.blocks` array position
  (ADR-0012 Decision 6).
- `execution.ts` — `startPlanExecution(plan, firstBlockId)` (deep-copies every step;
  never a live reference back into the saved plan) and
  `advanceToNextPlanStep(planExecution, newBlockId)`. Neither function creates a
  `TrainingBlock` itself — the caller (`TrackerApp.tsx`) creates the block first via
  the existing `addTrainingBlock`, then calls these to update the execution snapshot,
  in one atomic session update (never two separate `setCurrentSession` calls).
- `persistence.ts` / `migration.ts` — the Training Plan *library*'s own root state,
  pure state-shape functions (`addPlan`/`updatePlan`/`deletePlan`/`duplicatePlan`), and
  its own migration (`migrateTrainingPlans`) — field-by-field repair style (like
  `sessionMigration.ts`'s block backfill), since a `TrainingPlan`'s fields are mostly
  independent scalars. An unexecutable step's sport-specific configuration is never
  silently coerced into a fabricated-valid combination.
- `errors.ts` — the same `Outcome<T>`/`ok`/`err` discriminated-union convention as
  `src/lib/assessment/errors.ts`.

### `Session.planExecution` migration (`sessionMigration.ts`)

Unlike the plan library above, `Session.planExecution` follows Assessment's
discard-the-whole-record style, not `sessionMigration.ts`'s general field-by-field
repair style — its cross-field invariants (`activeStepIndex` validly indexes `steps`;
every step at or before it has a `blockId` resolving to a real, already-migrated
block; every step after it has none) are too strict to safely patch in isolation. A
structurally invalid `planExecution` is discarded entirely (`undefined`); `blocks`/
`shots` (the real training data) are migrated independently, before this runs, and are
never affected by a corrupt or missing `planExecution`. See ADR-0012 Decision 4 and
`sessionMigration.test.ts`'s "planExecution (Training Plans)" suite for the covered
cases (active/completed execution reload, legacy sessions without one, and four
distinct malformed shapes).

### UI (`src/components/`)

`TrainLanding.tsx` (Quick Start vs. Training Plans chooser, owning its own
library/editor/start-review sub-navigation locally — TrackerApp only learns about a
plan being started/saved/duplicated/deleted), `TrainingPlansLibrary.tsx` (list +
Start/Edit/Duplicate/Delete + empty state), `TrainingPlanEditor.tsx` (name/description
+ ordered step list with Move Up/Down, no drag-and-drop),
`TrainingPlanStepEditor.tsx` (reuses `TrainingSetup.tsx` unmodified for the block-
scoped fields, converting its `TrainingSetupValue` output to/from the domain's
`ReleaseTimingBlockConfiguration` locally — the persisted type is never derived from
the component's form-value export, see ADR-0012 Decision 3 — plus Number of Stones and
a Handle Strategy selector), `TrainingPlanStartReview.tsx` (pre-start summary),
`TrainingPlanProgress.tsx` (compact "Step X of Y · Shot N of M", visually secondary to
active capture), and `TrainingPlanStepTransition.tsx` (two mutually exclusive states —
"Continue to next step" mid-plan, or a distinct "Plan complete" / Finish Training once
the final step's count is reached; the latter reuses the existing
`handleStartNewSession` session-archiving path, introducing no new completion logic —
ADR-0012 Decision 5).

`ShotEntry.tsx`/`BlindShotEntry.tsx` gained one optional prop, `presetHandle?: Handle`
(undefined ⇒ unchanged behavior): when present, a render-time state-adjustment (same
pattern already used for the editable-target input, not a `useEffect`) resyncs the
locally-selected handle whenever the prop changes — the athlete may still override it
for one shot; the next shot's preselect follows the plan's own sequence regardless.

### Scope (Version 1)

Not built: Skip Step, drag-and-drop step reordering, scheduling/calendar, coach/team
features, cloud sync, shared/marketplace plans, adaptive plans, Assessment Plan Steps,
a dedicated plan-editor-navigation-loss guard, or any History/Analyze surface beyond a
single "Started from: {plan name}" label on the session summary — see
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "Training Plans" section.

## Accuracy Tolerance Profiles (Implemented)

A small, independent persisted domain (`src/lib/accuracyToleranceProfiles/`) letting
an athlete save reusable, named Accuracy Tolerance values (`AccuracyToleranceProfile:
{ id, name, onTarget, acceptable, createdAt, updatedAt }`) and select one wherever
Custom Accuracy Tolerance is already configured, instead of retyping the same On
Target / Acceptable pair for every Training Block, Training Plan Step, or Quick Start
session. See "Accuracy Tolerance Profile" and "Default Profile" in
`docs/DOMAIN_GLOSSARY.md`.

**Core principle — a profile helps select, it never becomes a live dependency.**
Selecting a profile copies its current `onTarget`/`acceptable` values into whichever
`TrainingSetupValue`/`ReleaseTimingBlockConfiguration`/`TrainingBlock.accuracyThresholds`
is being built at that moment (a plain `{ onTarget, acceptable }` object, same shape
`AccuracyThresholds` already uses) — no persisted type anywhere stores a profile id or
any other live reference back to a profile. This is a stricter version of the same
discipline ADR-0008 already established for `TrainingBlock.accuracyThresholds` itself:
editing or deleting a profile can never retroactively change an already-configured
Training Block, Training Plan Step, active Session, completed Session, or historical
analytics, because nothing downstream ever re-reads the profile after the values were
copied.

**Domain and validation (`src/lib/accuracyToleranceProfiles/profiles.ts`)** — reuses
`validateAccuracyThresholds` from `src/lib/accuracyThresholds.ts` directly (no second
definition of a valid On Target/Acceptable pair): `buildAccuracyToleranceProfile`
validates both the profile name (non-empty, ≤40 characters) and the thresholds before
ever constructing a profile. `duplicateAccuracyToleranceProfile` generates a new id and
an athlete-visible "(Copy)" name suffix; `deleteAccuracyToleranceProfile` removes a
profile and, if it was the current default, clears `defaultProfileId` to `null` rather
than silently promoting another saved profile to default (the athlete must explicitly
choose a new one) — the same "no fabricated value migration/deletion can't know" posture
as everywhere else in this codebase.

**Persistence and migration** — its own `localStorage` key
(`curling-release-tracker-accuracy-tolerance-profiles`) and schema version, loaded/saved
by `TrackerApp.tsx` following the exact one-effect-per-key pattern already used for
Session/Assessment/Training Plan data, and deliberately not coupled to
`sessionMigration.ts` or `src/lib/trainingPlans/migration.ts`.
`migrateAccuracyToleranceProfilesState` (`src/lib/accuracyToleranceProfiles/migration.ts`)
resolves an unknown/future schema version or any structurally invalid top-level shape to
a safe, empty state (never guess-migrated); an individual structurally-invalid profile is
dropped without invalidating the rest of the list (quarantine style, like
`src/lib/assessment/migration.ts` — a profile has no cross-field invariants worth a
field-by-field repair); a `defaultProfileId` that no longer resolves to a surviving
profile is cleared to `null`. Malformed profile data can never invalidate a Session or
Training Plan, since this module never reads or writes either of their storage keys.

**UI integration** — `AccuracyToleranceProfileSelector.tsx` is the one shared "pick a
saved profile, or enter a one-off Custom value" control, rendered inside
`TrainingSetup.tsx`'s existing Custom Accuracy Tolerance branch. Because Quick Start
(`TrackerApp.tsx`), New Training Block (`NewTrainingBlock.tsx`), and the Training Plan
Step Editor (`TrainingPlanStepEditor.tsx`) all already render `TrainingSetup.tsx`
unmodified (see "Training Plans" above and ADR-0012), adding the two new
`accuracyToleranceProfiles`/`defaultAccuracyToleranceProfileId` props to `TrainingSetup`
and threading them down from `TrackerApp` covers all three surfaces without any
per-surface logic. A default profile only prefills a **brand-new** configuration's
Custom fields (never an already-configured block/step being edited, and never the
top-level Standard/Tight/Custom choice itself — see "Default Profile" in the glossary).
Settings > Accuracy Tolerances (`AccuracyToleranceProfilesScreen.tsx` +
`AccuracyToleranceProfileForm.tsx`, opened from a new section in `SettingsScreen.tsx`) is
the main management location: create/edit/duplicate/delete/set-default, following the
same full-screen-modal convention `NewTrainingBlock.tsx`/`TrainingPlanStepEditor.tsx`
already use, with delete confirmed via the existing shared `ConfirmModal`.

**Deferred (see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`):** Assessment setup
(`AssessmentThresholdSelector.tsx`/`AssessmentOverview.tsx`/`AssessScreen.tsx`) already
lets an athlete enter a user-configurable Custom Accuracy Tolerance before a Run starts,
so it was in scope per the product spec — not wired up in this pass to avoid touching
`AssessScreen.tsx`'s carefully-integrated capture-ownership/navigation-guard logic
(ADR-0011) as a side effect of an unrelated feature.

## Smart Random Profiles (Implemented)

A small, independent persisted domain (`src/lib/smartRandomProfiles/`), the same shape
as Accuracy Tolerance Profiles above, letting an athlete save reusable, named Smart
Random ranges (`SmartRandomProfile: { id, name, measurementMode, min, max, createdAt,
updatedAt }`) and select one wherever Smart Random is the selected target source,
instead of retyping the same Minimum/Maximum Target Time for every Variable Weight or
Blind Weight exercise. See "Smart Random Profile" and "Default Smart Random Profile" in
`docs/DOMAIN_GLOSSARY.md`.

**Scope decision, confirmed with the product owner before implementation:** auditing
`src/lib/variableTargets.ts` found that Smart Random's step size (always `0.05s`) and
its two-tier repeat-avoidance memory (`NORMAL_REPEAT_AVOIDANCE_MEMORY`/
`LARGE_JUMP_REPEAT_AVOIDANCE_MEMORY`) are fixed implementation constants today, not
per-block configurable settings — the code explicitly documents the step as "Not
user-configurable." A Smart Random Profile therefore stores only what is actually
configurable today: Measurement Mode and the Minimum/Maximum range. Making step/memory
genuinely configurable would be a real target-generation-algorithm change, which is
explicitly out of scope for this feature.

**Core principle — a profile helps select, it never becomes a live dependency.**
Identical discipline to Accuracy Tolerance Profiles: selecting a profile copies its
current `min`/`max` into whichever `TrainingSetupValue`/`ReleaseTimingBlockConfiguration`/
`TrainingBlock.smartRandomMin`/`smartRandomMax` is being built at that moment — no
persisted type anywhere stores a profile id. Editing or deleting a profile can never
retroactively change an already-configured Training Block, Training Plan Step, active
Session, completed Session, or historical analytics, because nothing downstream ever
re-reads the profile after the values were copied; target generation itself
(`generateSmartRandomTarget`, `advanceBlockTarget`) is completely unmodified and has no
awareness that profiles exist.

**Domain and validation (`src/lib/smartRandomProfiles/profiles.ts`)** — reuses
`isSmartRandomAvailable`/`validateSmartRandomRange` from `src/lib/variableTargets.ts`
directly (no second definition of a valid range or Measurement Mode restriction):
`buildSmartRandomProfile` rejects any Measurement Mode Smart Random has no validated
range for (today, anything but Back-Hog) before a profile can ever be saved — a
Hog-Hog profile can never exist, so it can never later be silently applied in the
wrong measurement context. `duplicateSmartRandomProfile`/`deleteSmartRandomProfile`
follow the exact same "(Copy)" naming and "clear the default reference, never
silently promote another profile" rules as Accuracy Tolerance Profiles.

**Persistence and migration** — its own `localStorage` key
(`curling-release-tracker-smart-random-profiles`) and schema version, loaded/saved by
`TrackerApp.tsx` following the same one-effect-per-key pattern as every other
independent persisted domain, deliberately not coupled to `sessionMigration.ts` or
`src/lib/trainingPlans/migration.ts`. `migrateSmartRandomProfilesState`
(`src/lib/smartRandomProfiles/migration.ts`) resolves an unknown/future schema version
or any structurally invalid top-level shape to a safe, empty state; an individual
structurally-invalid profile (including any Hog-Hog or otherwise Smart-Random-unavailable
Measurement Mode, or a range failing `validateSmartRandomRange`) is dropped without
invalidating the rest of the list; a `defaultProfileId` that no longer resolves to a
surviving profile is cleared to `null`.

**UI integration** — `SmartRandomProfileSelector.tsx` is the one shared "pick a saved
profile, or enter a one-off Custom range" control, rendered inside `TrainingSetup.tsx`'s
existing Smart Random range section (renamed "Smart Random Settings"), gated on the
same pre-existing `showSmartRandomRange` boolean (`effectiveTargetMode ===
"smart-random" && smartRandomAvailable`) — the selector can therefore never appear for
Fixed, Manual, or an unsupported Hog-Hog combination without any new visibility logic.
Because Quick Start, New Training Block, and the Training Plan Step Editor all already
render `TrainingSetup.tsx` unmodified, adding `smartRandomProfiles`/
`defaultSmartRandomProfileId` props to `TrainingSetup` and threading them down from
`TrackerApp` covers Variable Weight and Blind Weight Quick Start, New Training Block,
and the Plan Step Editor without any per-surface logic. The selector additionally
filters offered profiles to the form's current Measurement Mode, so a profile can never
be applied in the wrong measurement context even defensively. A default profile only
prefills a **brand-new** configuration's range when Smart Random is already the
selected target source (never activates Smart Random on its own, never overrides an
already-configured block/step being edited). Settings > Smart Random Profiles
(`SmartRandomProfilesScreen.tsx` + `SmartRandomProfileForm.tsx`, opened from a new
section in `SettingsScreen.tsx`) is the main management location, following the exact
same list/form/delete-confirmation pattern as `AccuracyToleranceProfilesScreen.tsx`;
Measurement Mode is shown as a fixed, read-only "Backline – Hog" in the form rather than
a picker, since there is currently only one valid choice.

**Deferred (see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`):** "Save current settings as a
profile" from within the selector itself, and Hog-Hog Smart Random support (an
[Open decision] independent of this feature — see ADR-0004).

## Module responsibilities / architecture boundaries (Implemented)

### UI components (`src/components/`)

| Component | Responsibility |
|---|---|
| `TrainingSetup.tsx` | Block creation/edit form: mode, measurement mode, target source, Smart Random range, Accuracy Threshold preset/custom picker, inline validation; an `InfoButton` per Training Mode/Measurement Mode option plus one for Accuracy Tolerance |
| `NewTrainingBlock.tsx` | Modal wrapping `TrainingSetup` for mid-session block switches; also renders the outgoing block's summary cards |
| `ShotEntry.tsx` | Fixed/Variable Weight single-step shot capture (release time, handle, shot type, optional editable target) |
| `BlindShotEntry.tsx` | Blind Weight's 3-phase capture UI, wired to `blindWeight.ts` |
| `ReleaseTrendChart.tsx` | Per-block chart: target/release/(prediction if present) over shot number, with a combined tooltip |
| `DashboardCard.tsx` | One shared metric-tile presentational component (label/value/optional sublabel/tone/explanation), used by the live Dashboard, History, and Block Summary |
| `TargetAccuracyDashboardCards.tsx` | The shared Bias/Average Error/On Target/Major Misses/... card set — formats a pre-computed `TargetAccuracyAnalytics`, never computes analytics itself |
| `TargetErrorChart.tsx` | Target Error by Shot — bar chart with on-target/acceptable reference bands and a zero line |
| `TargetActualScatterChart.tsx` | Target vs. Actual scatterplot with a y=x reference diagonal and a clickable In/Out legend toggle (visual filter only); shot-level across multiple blocks/sessions in History |
| `HandleBoxPlot.tsx` | Custom-SVG boxplot of Target Error by handle (no Recharts boxplot primitive exists) — statistical outliers kept visually/semantically distinct from Major Miss |
| `HandleErrorBarChart.tsx` | Handle Bias and Consistency — mean Target Error ± 1 SD per handle, via Recharts `ErrorBar` |
| `HandleAnalysisSection.tsx` | Wraps Boxplot + Bias/Consistency with one dynamic heading ("Handle Comparison" / "{Handle} Distribution" / empty state) based on which handles are actually present |
| `ProgressMetricChart.tsx` | Selectable-metric progress line chart across blocks/sessions, with a 3-block rolling average — one point per comparable Training Block |
| `ShotQualityTrendChart.tsx` | 100%-stacked On Target/Acceptable/Major Miss distribution, one bar per block, plus an optional Major-Miss/On-Target trend summary (≥3 comparable, non-tiny blocks) |
| `ChartCard.tsx` | Shared chart shell: title + optional `InfoButton`, subtitle, contextual notices, consistent empty state |
| `InfoButton.tsx` | The one Info-popover/bottom-sheet affordance for `AnalyticsExplanation` **or** `FeatureExplanation` content — keyboard-operable, Escape closes and returns focus |
| `HistoryFilterBar.tsx` | Sticky History filter bar — primary filters (native `<select>`s) apply immediately; secondary filters and the Compare: Custom threshold fields behind an explicit Apply/Reset |
| `AnalysisContextSummary.tsx` | The "what am I looking at" line directly under the sticky filters — headline, block/shot/date-span counts, short contextual notices |
| `TargetTimeSettings.tsx` | Edits the active block's constant target — only rendered for Fixed Weight and Blind+Fixed |
| `AutoCapture.tsx` | Capture Sequence start form + live status/Pause/Resume/Cancel/Undo/"Add Result Manually" panel — not rendered for Blind Weight blocks |
| `TimingSimulatorPanel.tsx` | Dev/test-only Timing Simulator controls, gated by `process.env.NODE_ENV !== "production"` |
| `PrimaryNavigation.tsx` | The one platform-wide navigation surface — desktop top bar + mobile floating, safe-area-aware bottom bar, both rendered from `getVisibleNavigationItems()`; a hidden item would never reach it, though none currently is |
| `AppHeader.tsx` | The full "Curling Performance" product identity — rendered by `TrackerApp` only when `activeView === "home"` |
| `PageHeader.tsx` | Compact contextual header (title + optional one-sentence description, no card) for Train/Assess/Analyze/Settings |
| `HomeScreen.tsx` | Composes the Home screen's sections from already-prepared props — no analytics/scheduling logic of its own |
| `TodayPlanCard.tsx` | Today's Plan — the "no scheduled session" empty state (no scheduling data model exists yet) with the Start Training primary action, plus (Phase B) a contextual "Resume Assessment" action when an active Assessment Run exists |
| `TrainingOverview.tsx` | Compact Last Training / Total Sessions glance (an honestly-scoped rename of the former "Performance Snapshot"), or an honest "no training yet" empty state — never a new metric or inferred trend; also hosts the secondary "View Analyze" action |
| `FutureCapabilitiesSection.tsx` | Groups Schedule/Coach/Team into one shared, dashed-border "Coming next" container (rows stack on mobile, columns at `sm`+) instead of three separate full-width cards |
| `FutureCapabilityItem.tsx` | One reusable, visually secondary "Coming soon" row/column (used for Schedule, Coach, Team) — never interactive, renders no border/background of its own |
| `DeviceStatusCard.tsx` | Honest current device state ("Manual Timing") |
| `SettingsScreen.tsx` | App-wide Data Management (Export History CSV / Clear History, moved here from the old History view) and Data & Privacy — session-specific settings stay in Train |
| `AssessScreen.tsx` | Phase B's Assess-domain orchestrator — the Assess-domain counterpart to `TrackerApp`'s Train branch; owns pre-run UI state (threshold draft, setup confirmation, guided-introduction step) and calls `src/lib/assessment/*` directly, never duplicating its logic |
| `AssessmentLanding.tsx` | Assess entry point — Release Time Core Assessment v1 metadata card, and a prominent "Resume Assessment" state when an active run exists (never silently offering a fresh start alongside it) |
| `AssessmentOverview.tsx` | Compact protocol overview with progressive disclosure — purpose, what is/isn't measured, why this structure, threshold selection, setup confirmation |
| `AssessmentGuidedIntroduction.tsx` | The four-block explanation shown by default before a first run — Continue/Skip/"Do not show again", never skips threshold selection, setup, or the warm-up itself |
| `AssessmentProtocolSheet.tsx` | The permanent, full-protocol overlay reachable from Overview, execution, and the Completion Summary |
| `AssessmentSetupDiagram.tsx` | Plain provider-neutral inline SVG of the Backline–Hog measurement setup |
| `AssessmentThresholdSelector.tsx` | Standard/Tight/Custom Accuracy Threshold selection with inline Custom validation |
| `AssessmentSetupConfirmation.tsx` | Setup Requirements + a single confirmation checkbox before Warm-up can start; Manual vs. (dev-only) Simulator timing-method copy differs, never claiming a gate that isn't there |
| `AssessmentExecution.tsx` | The active warm-up/scored surface — header (block/progress/threshold/Protocol/Pause), current shot, attempt entry, warm-up-complete and block-transition sub-states |
| `AssessmentProgress.tsx` | A labeled progress bar with real `aria-valuenow`/`-valuemin`/`-valuemax` — reused for warm-up, per-block, and overall progress |
| `AssessmentCurrentShot.tsx` | Target/Expected Handle display, the Executed Handle toggle (defaults to Expected Handle), and the most recent result incl. the wrong-handle notice |
| `AssessmentAttemptEntry.tsx` | Manual timing entry (reusing `timeInput.ts`, Enter-key submit, a double-submit ref guard) plus the "Mark attempt invalid" trigger and invalid-count/limit display |
| `AssessmentInvalidAttemptDialog.tsx` | The technical-reason-only invalid-attempt picker — a sporting complaint is never offered here |
| `AssessmentBlockTransition.tsx` | Shown between scored blocks — next block's purpose/first target, `Continue`, no enforced rest |
| `AssessmentPausedView.tsx` | Shown while a Run is paused — progress, Resume, Abandon |
| `AssessmentCompletionSummary.tsx` | The simple Completion Summary — counts, raw metrics (MAE/Bias/SD), category percentages under the original Run Threshold, and (Phase C) a "View Full Results" action opening `AssessmentResultScreen` |
| `AssessmentResultScreen.tsx` | (Phase C) Top-level orchestrator for a single completed/incomplete run's full result view — composes every section below, owns Analysis/Comparison threshold UI state, delete confirmation |
| `AssessmentResultSummary.tsx` | (Phase C) Header card: name/version/date/measurement mode/shot type/scored count/original vs. active threshold |
| `AssessmentThresholdControl.tsx` | (Phase C) Original/Standard/Tight/Custom (or, with `allowOriginal={false}`, Standard/Tight/Custom only, for multi-run contexts) — never mutates the run |
| `AssessmentCoreMetrics.tsx` | (Phase C) Threshold-independent MAE/Bias/SD card + threshold-dependent On Target/Acceptable/Major Miss card, always shown with the active Threshold Set labeled |
| `AssessmentBlockResults.tsx` | (Phase C) Per-block metrics — no block score or ranking |
| `AssessmentTargetResults.tsx` | (Phase C) Fast/Medium/Slow Delivery breakdown, combining every block including Variable Adaptation |
| `AssessmentHandleComparison.tsx` | (Phase C) In vs. Out Handle (grouped by executed handle) plus MAE/Bias/SD differences, with careful non-diagnostic copy |
| `AssessmentVariableAdaptationResults.tsx` | (Phase C) The one block with more than one target time — deliberately restrained copy given only 8 scored shots |
| `AssessmentProtocolIntegrity.tsx` | (Phase C) Factual protocol-quality disclosure — never treats a deviation as automatic invalidation |
| `AssessmentShotDetails.tsx` | (Phase C) Expandable, read-only shot-level table + a separate invalid-attempt technical log — no edit/delete/reclassify action |
| `AssessmentComparisonEligibilityNotice.tsx` | (Phase C) Maps `ComparisonIneligibilityReason[]` to plain-language copy — never a raw enum value |
| `AssessmentRunComparison.tsx` | (Phase C) Two-run delta view under one shared Comparison Threshold — neutral, percentage-point phrasing, never a synthetic winner |
| `AssessmentTrendChart.tsx` | (Phase C) MAE/Bias/SD/On-Target trend across protocol-compatible completed runs of the same Template+Version, one shared Comparison Threshold |
| `AssessmentAnalyze.tsx` | (Phase C) Analyze → Assessments landing: Latest Completed Assessment, separate Completed/Incomplete history, empty state, CSV export |
| `AssessmentHistoryItem.tsx` | (Phase C) One history row (completed or incomplete), with View/Delete actions |
| `TrainLanding.tsx` | Train's "no active block" landing — Quick Start (unchanged hero) vs. Training Plans, owning the plans library/editor/start-review sub-navigation locally |
| `TrainingPlansLibrary.tsx` | Plan list — summary (steps/stones/mode composition), Start/Edit/Duplicate/Delete, empty state; Start disabled with an inline note for an unexecutable plan |
| `TrainingPlanEditor.tsx` | Create/edit a plan — name, optional description, ordered step list with Move Up/Down/Duplicate/Delete, "Add Step" |
| `TrainingPlanStepEditor.tsx` | Configures one Release Timing Plan Step — wraps `TrainingSetup.tsx` unmodified, adding Number of Stones and a Free/Fixed/Alternating Handle Strategy selector |
| `TrainingPlanStartReview.tsx` | Pre-start summary (ordered steps, stones, handle strategy, total) + Start Training |
| `TrainingPlanProgress.tsx` | Compact "Step X of Y · Shot N of M" during execution — visually secondary to active shot capture |
| `TrainingPlanStepTransition.tsx` | "Continue to next step" mid-plan, or a distinct "Plan complete" + Finish Training on the final step — never both at once |

### Domain and logic modules (`src/lib/`)

| Module | Responsibility |
|---|---|
| `trainingBlocks.ts` | Block lifecycle and target resolution: creation, active-block/shot lookups, `getEffectiveTargetMode`, `advanceBlockTarget`, labels |
| `variableTargets.ts` | Pure Smart Random logic: validation, candidate generation, natural-transition selection; measurement-mode availability gate |
| `blindWeight.ts` | Pure Blind Weight phase state machine and prediction/target error formulas |
| `analytics.ts` | All release-time/target/prediction/Target-Accuracy statistics, plus `interpretTargetErrorDirection` (see ADR-0008) |
| `accuracyThresholds.ts` | `AccuracyThresholds` presets (Standard/Tight), validation, `categorizeTargetError`, legacy-default resolution |
| `boxPlotStatistics.ts` | Pure, generic median-of-halves boxplot statistics (median/Q1/Q3/whiskers/statistical outliers) over any `number[]` |
| `chartData.ts` | Pure chart-data preparation (Target Error by Shot, Target-vs-Actual scatter, Progress, Shot Quality) — chart components never compute analytics themselves |
| `chartTheme.ts` | Central chart color/label tokens (handle colors, category colors, axis formatting) — no chart hard-codes its own |
| `historyAnalysis.ts` | The central History filter pipeline: `HistoryAnalysisFilters`, `ThresholdComparisonMode`, `buildHistoryAnalysisContext`, default-selection resolution, `aggregateTargetAccuracyAcrossBlocks`, `sanitizeThresholdComparisonMode`/`sanitizeHistoryFilters` (persisted-filter repair) |
| `analyticsExplanations.ts` | Central `AnalyticsExplanation` content for every core metric/chart — one source for `InfoButton`, chart subtitles, and (later) translation |
| `helpContent.ts` | Central `FeatureExplanation` content for Training Category and Measurement Mode — one source for `InfoButton` at every Training Setup selection point; kept separate from `analyticsExplanations.ts`, which is scoped to already-recorded analytics |
| `shotFilters.ts` | Handle/shot-type filtering for the active block view (Current Session only) — History's filtering now goes through `historyAnalysis.ts` |
| `sessionMigration.ts` | The one place old or partial `localStorage` JSON becomes a valid `Session` |
| `export.ts` | CSV string building (pure) and the DOM download side-effect |
| `timeInput.ts` | Shared numeric input parsing/formatting (`3.75` or `375` → `3.75`, signed formatting) |
| `timingProvider.ts` | The shared `TimingProvider` contract and `createManualTimingResult` |
| `simulatorTimingProvider.ts` | Dev/test-only `TimingProvider` implementation with test-trigger methods |
| `captureSequence.ts` | Capture Sequence lifecycle, handle strategies, `processTimingResult`/`applyTimingResultToSession` (the one shot-save path for captured shots, plain-value in/out), Undo, `sanitizeCaptureSequence` (persistence repair), `pauseCaptureSequenceWithError` |
| `navigation.ts` | The one place the platform's top-level navigation structure is declared (`NAVIGATION_ITEMS`, `ActiveView`, `sanitizeActiveView`) — see "Platform Navigation" above |
| `assessmentContent.ts` | Central Assessment UI copy (Guided Introduction block text, what-it-measures/doesn't, why-structure, setup requirements/notes, invalid-reason labels) — the Assessment-domain counterpart to `helpContent.ts` |
| `assessmentResultContent.ts` | (Phase C) Central Result-screen copy (MAE/Bias/SD explanations, category/handle/Variable-Adaptation/threshold-control notices) — facts and interpretation kept separately, per `docs/UX_WRITING_GUIDELINES.md` |
| `assessmentPreferences.ts` | Local, device-only Assess UI preferences (show-introduction, last-used threshold preset/custom values) — deliberately separate from the `AssessmentRun`/`AssessmentPersistedState` domain objects; never affects an already-started run |

### Assessment domain modules (`src/lib/assessment/`)

A separate domain from Training — see "Assessments" above, ADR-0010, and ADR-0011.
Wired into `TrackerApp.tsx`/`AssessScreen.tsx` as of Phase B; still covered by
`src/lib/assessment/__tests__/` for the domain layer itself.

| Module | Responsibility |
|---|---|
| `types.ts` | `AssessmentTemplate`, `AssessmentBlockDefinition`, `PlannedAssessmentShot`, `AssessmentRun`, `AssessmentAttempt`, `AccuracyThresholdSet`, `ProtocolDeviation`, and every related status/reason enum |
| `errors.ts` | The `AssessmentOutcome<T>`/`AssessmentError` discriminated-union convention every domain function returns |
| `thresholds.ts` | Assessment threshold presets (Standard/Tight, reusing `accuracyThresholds.ts`'s values), `validateThresholdValues`, `AccuracyThresholdSet` construction/cloning |
| `templateValidation.ts` | `validateAssessmentTemplate` — every structural template invariant (unique IDs, contiguous sequence, warm-up/scored separation, published-Official completeness) |
| `templates.ts` | The immutable, versioned, deterministic `RELEASE_TIME_CORE_ASSESSMENT_V1` template, self-validated at import |
| `progress.ts` | Planned-shot navigation and progress: `getCurrentPlannedShot`, `calculateWarmupProgress`/`calculateScoredProgress`, `isRunCompletable`, deviation/attempt counters |
| `run.ts` | `createAssessmentRun`, the centralized Run Status state machine (`transitionAssessmentRun`), and `pauseAssessmentRun` (Phase B — composes the legal `"warmup" -> "in_progress" -> "paused"` transitions; see ADR-0011) |
| `attempts.ts` | `addValidAttempt`/`addInvalidAttempt` — repeat-limit enforcement, wrong-handle Protocol Deviation, timing-result deduplication |
| `capture.ts` | (Phase B) `applyTimingResultToAssessmentRun` — the sole adapter from a `TimingResult` to `addValidAttempt`, the Assessment-domain counterpart to `captureSequence.ts`'s `applyTimingResultToSession` |
| `metrics.ts` | Threshold-independent raw metrics (MAE/Bias/SD) and threshold-dependent category metrics (On Target/Acceptable/Major Miss), reusing `analytics.ts`/`accuracyThresholds.ts` |
| `comparison.ts` | `checkProtocolComparisonEligibility`/`checkCategoryComparisonEligibility` |
| `persistence.ts` | The Assessment root persisted shape (own `localStorage` key, current run + history), pure state-shape transitions — the actual `localStorage` read/write call site lives in `TrackerApp.tsx` (Phase B, ADR-0011); Phase C added `getCompletedAssessmentRuns`/`getIncompleteAssessmentRuns`/`getLatestCompletedAssessmentRun`/`deleteAssessmentRunFromHistory` |
| `migration.ts` | Defensive validation/quarantine of persisted Assessment data (`migrateAssessmentPersistedState`, `validatePersistedAssessmentRun`) |
| `result.ts` | (Phase C) Derived, non-persisted Result view: block/target/handle/Variable-Adaptation breakdowns, Protocol Integrity summary, comparison-ineligibility copy, `AssessmentResultView`, `compareAssessmentRuns`, `buildAssessmentTrendSeries`, `resolveAnalysisThresholdSet` |
| `resultFormatting.ts` | (Phase C) Shared display formatting (percent/seconds/signed/percentage-point-delta) for Result-screen components — kept out of JSX |
| `export.ts` | (Phase C) `buildAssessmentCsv`/`exportAssessmentRunsToCsv` — one row per attempt; deliberately its own file, never merged with Training's `src/lib/export.ts` |

### Training Plan domain modules (`src/lib/trainingPlans/`)

A new persisted domain (see "Training Plans" above and ADR-0012) — its types live
centrally in `src/types/index.ts` rather than in this folder, deliberately, to avoid
an import cycle back into that file.

| Module | Responsibility |
|---|---|
| `mapping.ts` | `mapPlanStepToTrainingBlockInput` — the one Plan-Step-to-Block-input translation boundary |
| `validation.ts` | `isStepExecutable`/`isPlanExecutable`/`validatePlanStep`/`validatePlan`, reusing `variableTargets.ts`'s Smart Random rules directly |
| `handleStrategy.ts` | `resolveExpectedHandle`/`handleStrategyToCaptureHandleMode` — the manual-entry and Auto-Capture-preset counterparts of `captureSequence.ts`'s alternation logic |
| `progress.ts` | Pure, derived plan-execution state: `isPlanExecutionActive`, `isActiveStepComplete`, `isFinalStep`, `isPlanComplete`, `getPlanProgressSummary` |
| `execution.ts` | `startPlanExecution`/`advanceToNextPlanStep` — build/advance a `PlanExecutionState` snapshot; never creates a `TrainingBlock` itself |
| `persistence.ts` | The Training Plan library's own root state and CRUD (`addPlan`/`updatePlan`/`deletePlan`/`duplicatePlan`), pure state-shape functions only |
| `migration.ts` | `migrateTrainingPlans` — field-by-field repair of the plan library, distinct from `Session.planExecution`'s own migration in `sessionMigration.ts` |
| `errors.ts` | The `TrainingPlanOutcome<T>`/`ok`/`err` convention, matching `src/lib/assessment/errors.ts` |

### Orchestration — `TrackerApp.tsx`

The one client component that owns all application state: current session, history,
active view, filters, the edit-shot form, the new-block modal, confirm dialogs, the
Blind-draft-leave guard, the Capture Sequence handlers (`processIncomingTimingResult`
and Start/Pause/Resume/Cancel/Undo), the stable `SimulatorTimingProvider` instance, and
(Phase B) `assessmentState` plus its own load/save effect pair and
`updateAssessmentState`/`commitAssessmentState` helpers (`AssessScreen`'s one entry
point for mutating it — see ADR-0011). It reads `localStorage` on mount, migrates, and
persists on every change, for both Session data and Assessment data independently.

`processIncomingTimingResult` is the one place a `TimingResult` (from the simulator
subscription, from Training's "Add Result Manually", or from `AssessScreen`'s manual
timing entry) gets applied to state. It appends onto `captureQueueRef`, a Promise chain
that serializes processing (see
"Race conditions and serialized result processing" in the Capture Sequences section
above) — each queued call reads `sessionRef.current` (an authoritative session mirror,
not `currentSession` from the render closure), computes the next state via the pure
`applyTimingResultToSession` (`captureSequence.ts`), and commits both the ref and React
state together via a shared `commitSession` helper before the next queued result runs.
This is deliberately not the same shape as `handleAddShot`'s direct functional-updater
call — it needs a synchronous, framework-independent read of the outcome for
diagnostics/feedback, which a `setState` updater cannot reliably provide (see that
section for why). The simulator subscription itself is wired in a `useEffect` that calls
this function from the subscription's callback, not synchronously in the effect body —
the sanctioned pattern for bridging an external subscription into React state, which
does not trip the `react-hooks/set-state-in-effect` lint rule (unlike the one
pre-existing, documented exception on initial load — see
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`). Refs that mirror render state for this purpose
(`sessionRef`, `captureManualHandleRef`, `captureManualTargetInputRef`) are resynced via
small dedicated `useEffect`s rather than mutated during the render body itself — this
project's lint config flags ref mutation during render (`react-hooks/refs`) even for the
"adjust during render" pattern used elsewhere in this codebase (e.g. `ShotEntry.tsx`'s
local component state) — the effect-based form is the version that stays lint-clean for
refs specifically.

**Is this too much responsibility?** At ~1,900 lines, yes, in the sense that it is by
far the largest file in the project and touches nearly every domain concept. **No**, in
the sense that splitting it today would mostly move code around without reducing real
complexity — the state genuinely is one interconnected session/active-block/filter/
capture graph, and the *domain logic* (target resolution, migration, analytics, Smart
Random, Capture Sequence processing) is already correctly extracted into `src/lib/`.
What remains in `TrackerApp.tsx` is close to pure orchestration: read state, call a
`lib/` function, write state back.

Concrete risk: new features keep landing as more `useState` + more inline JSX in the
same file, and it will keep growing. Sensible extraction boundaries, **when** (not yet)
that becomes painful:
- The History view (its own filters, its own block/session rendering,
  `HistoryBlockPanel`/`PredictionDashboardCards`) is the most self-contained candidate
  for a `HistoryView.tsx` extraction — it already only reads props it's given.
- The Blind-draft-leave guard (`hasUnsavedBlindDraft`, `blindDraftResetToken`,
  `runOrConfirmBlindDraftDiscard`) and the Capture Sequence leave guard
  (`runOrConfirmCaptureLeave`) are already composed through one shared
  `guardLeavingActiveWork` function rather than duplicated per navigation action — a
  further extraction into a `useLeaveGuards` hook would be reasonable if a third kind of
  "unsaved work" is ever added.
- The inline shot-edit form (release time/handle/shot type) could become its own
  component if it ever needs to support editing `predictedTime` (it currently doesn't —
  see Technical Debt).

None of these are done in this pass — they would be pure code movement without a
concrete bug or blocked feature motivating them right now, which this project's own
principles argue against ("evolution over perfection", "avoid unnecessary complexity").
Revisit when a *new* feature would otherwise have to be wedged into `TrackerApp.tsx` in
a way that clearly duplicates one of the boundaries above.