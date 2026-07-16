# ADR-0010: Assessments are a separate domain with their own persistence key and immutable, snapshotted templates

## Status

Accepted. Implemented for Phase A (Assessment Foundation) — see
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "Assessment Framework" section for the phase
sequencing this belongs to. No Assess UI, navigation, or capture integration exists yet
(Phase B/C) — this ADR covers the domain and persistence foundation only.

## Context

`docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` defines Assessments as a distinct
athlete intention (Train / Assess / Analyze) with stricter requirements than an ordinary
Training Session: a fixed, versioned, non-randomised shot protocol; immutable completed
runs; preserved invalid-attempt and protocol-deviation history; and comparison rules that
depend on protocol identity, not just raw numbers. Three architectural questions had to be
settled before any of that domain logic could be written:

1. Do Assessment Runs reuse `Session`/`TrainingBlock`/`Shot`, or get their own types?
2. Where does Assessment data live in `localStorage` — merged into the existing Session
   History key, or a key of its own?
3. How does a Run reference "the exact template it was executed under" in a way that
   survives the template being edited or republished later?

## Decision

### 1. Assessments are a genuinely separate domain, not a Training Session variant

New types (`AssessmentTemplate`, `AssessmentBlockDefinition`, `PlannedAssessmentShot`,
`AssessmentRun`, `AssessmentAttempt`, `AccuracyThresholdSet`, `ProtocolDeviation`) live in
`src/lib/assessment/`, not `src/types/index.ts`. Shared concepts with identical semantics
(`Handle`, `ShotType`, `MeasurementMode`, `TimingProviderType`, the `{onTarget, acceptable}`
threshold value shape, `categorizeTargetError`, `average`/`standardDeviationOfValues`) are
imported and reused directly from the existing Training domain — never redefined. Concepts
that only *look* similar but carry different guarantees are not reused even though they
share a name: `AccuracyThresholdSet` is a deliberately richer type than Training's
`AccuracyThresholds` (it carries preset type, provenance, and a selection timestamp,
because a Run Threshold Snapshot needs to be distinguishable from a later Comparison
Threshold Set — see `src/lib/assessment/thresholds.ts` and `comparison.ts`), and
`AssessmentRun`/`AssessmentAttempt` are not modeled as `Session`/`Shot` even though the
capture inputs look alike.

Why: `Session`/`TrainingBlock`/`Shot` are designed to be freely editable (blocks added,
targets changed, shots deleted) and have no concept of "this exact numbered protocol
version," "a wrong-handle deviation that still counts as scored," or "at most one valid
attempt per position." Bending those types to carry Assessment's stricter invariants would
either weaken them for Training (unacceptable — Training's own editability is a feature,
not an oversight) or require enough Assessment-only optional fields and conditional logic
that the type would stop meaning one thing. A parallel, purpose-built domain keeps both
sides simple.

### 2. Assessment data gets its own `localStorage` key, not a shared root

`src/lib/assessment/persistence.ts` defines its own key
(`curling-release-tracker-assessment-data`) and its own root shape (`schemaVersion`,
`currentRun?`, `history: AssessmentRun[]`) — entirely separate from
`curling-release-tracker-current-session` / `curling-release-tracker-session-history`.

Alternatives considered:

- **A shared, versioned root object** combining Session and Assessment data under one key.
  Rejected: it would force one migration function to reason about two independent
  domains' schemas at once, exactly the kind of "growing migration complexity" already
  flagged as technical debt for `sessionMigration.ts`. A corrupt or unknown-version
  Assessment payload could then risk the *read path* for Session data too, even though
  the two are logically independent. Splitting the keys means an Assessment-side failure
  (bad schema version, corrupted record) can never affect the Training Session read/write
  path — confirmed by `migration.test.ts`'s "Training History remains untouched" style
  coverage.
- **Storing Assessment Runs as tagged entries inside `session-history`.** Rejected outright
  per the spec: an Assessment Run must not be substitutable for a Training Session in the
  same collection.

This also keeps a future cloud-sync migration simpler: a per-domain local key maps
naturally to a per-domain sync scope later, rather than needing to split a merged blob
after the fact.

### 3. A Run holds a deep, immutable snapshot of the template it was created from

`createAssessmentRun` (`src/lib/assessment/run.ts`) deep-clones the template
(`JSON.parse(JSON.stringify(template))`) into `AssessmentRun.templateSnapshot`, alongside
`templateId`/`templateVersion` for identity. The official `RELEASE_TIME_CORE_ASSESSMENT_V1`
template itself is also recursively `Object.freeze`d at module load
(`src/lib/assessment/templates.ts`) and validated once against
`validateAssessmentTemplate` + its own v1-specific shape invariants (exactly 6 warm-up / 32
scored / 16 In / 16 Out shots) — a broken literal shot sequence fails fast at import time,
not silently at runtime.

Why a deep clone rather than holding a reference: the official template is frozen and safe
to reference directly today, but Custom templates (type-prepared, not yet editable in
Phase A) will not be. A Run's protocol record must never be able to drift if its source
template is later edited — deep-cloning at creation time makes that true unconditionally,
regardless of whether the source template happens to be frozen.

## Alternatives Considered

- **Model `AssessmentRun` as a `TrainingBlock` with an `assessment` flag.** Rejected — see
  Decision 1; this is exactly the "Training Session semantics as a substitute" the product
  spec forbids.
- **Reference the template by ID+version only, without a snapshot**, looking it up from a
  static registry (`OFFICIAL_ASSESSMENT_TEMPLATES`) whenever needed. Rejected for Phase A:
  it works for the one official template that will never change post-publication, but
  breaks the moment a Custom template can be edited by its owner after runs already exist
  against it — the snapshot has to exist for Custom templates to ever be safe, so it was
  built once, for every template type, rather than retrofitted later.
- **Cache derived Result metrics on the Run.** Rejected — raw data (targets, measured
  times, handles, attempt validity, protocol deviations) stays the sole persisted source of
  truth; `src/lib/assessment/metrics.ts`'s functions are cheap and pure enough to
  recompute on demand under whichever threshold set is currently relevant.

## Consequences

- Phase B (the executable Assess flow) can build directly on
  `createAssessmentRun`/`transitionAssessmentRun`/`addValidAttempt`/`addInvalidAttempt`
  without touching the domain model — it only needs to wire a UI and the existing
  `TimingProvider`/`TimingResult` boundary to these functions.
- Training Session persistence, migration, and tests are completely unaffected — confirmed
  by running the full existing suite unchanged alongside the new Assessment tests.
- A future Custom Assessment editor (later phase) will need its own template-mutation
  guards (never edit a `published` template in place — bump `version` instead), but the
  version/snapshot machinery this ADR establishes already supports that; no rework needed.
- **Relationship to Training Sessions:** deliberately none at the data-model level. Any
  shared analysis UI (Phase C's Analyze integration) will read from both domains
  side-by-side, never merge them into one type.
- **Relationship to Timing Providers:** `AssessmentTimingProviderSnapshot` reuses
  `TimingProviderType`/`MeasurementMode` and stays provider-neutral (no Brower-specific
  fields in the core domain — see `docs/BROWER_INTEGRATION_STATUS.md`); Phase B wiring a
  real capture flow into `addValidAttempt`/`addInvalidAttempt` should follow the same
  Timing Result boundary discipline as Capture Sequences (ADR-0006), not invent a second
  path.
- **Migration impact:** none for existing data — this is a brand-new persistence key with
  no prior version to migrate from. `src/lib/assessment/migration.ts` establishes the
  versioning discipline (unknown/future `schemaVersion` never guessed at) that a real v1→v2
  migration will extend later.
- **Future cloud considerations:** the per-domain local key and the Run's self-contained
  template snapshot (no external lookup required to interpret a historical run) both make
  a future sync boundary a matter of syncing one more key/collection, not restructuring
  existing data.
- **Known limitation, not solved by this pass:** persistence functions in
  `src/lib/assessment/persistence.ts` are pure state-shape transformations only — no
  `localStorage` read/write call site exists yet, since no UI or App-level state currently
  needs one (see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`). Phase B must add the actual
  `TrackerApp`-level (or equivalent) load/save wiring, following the same
  one-effect-per-key pattern already used for Session data.
