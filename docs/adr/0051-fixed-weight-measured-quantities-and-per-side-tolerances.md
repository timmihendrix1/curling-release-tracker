# ADR-0051: Fixed Weight measured quantities, per-side tolerances, and the absence-as-legacy wire rule

## Status

**Accepted. Stage A implemented and independently reviewed (measurement model and
compatibility foundation). Stage B implemented (setup, capture and results UI);
its independent review is outstanding. Rollout readiness and real-device acceptance
are separate, unmet gates (see Consequences).** Stage A's review rounds found, and its
correction passes fixed: plan execution silently dropped on reload for speed-only steps; validation
that filtered unknown shapes instead of rejecting them, and threw on a null entry;
tolerance snapshots shared by reference with their caller; two time targets able to
disagree within one block; recording that accepted a foreign block id and discarded
supplied time provenance; a tolerance-template model that was still symmetric and
unitless; and consumers that classified the same stone differently. Six separately
confirmed, pre-existing Training Plan progression defects were corrected alongside
them — they are unrelated to measured quantities and are recorded in ADR-0048's area,
not here. Later rounds found, and this ADR now records as corrected: acknowledgements matched by
object identity rather than write ordering, and sequence coverage missing from every
handler that mutates the Session through a `setCurrentSession` updater; refused manual
input still cleared on the Enter path; validation that left required structure
(containers, entries, identities, references, enums, execution state) to legacy repair;
wire-version selection ignoring embedded plan-step snapshots; template defaults,
editing and storage not unit-safe through the real repositories and existing controls;
displayed tolerance labels and chart bands still symmetric while the calculation was
per-side; and malformed Training Plan storage surfacing as an empty writable library.

Stage A alone was deliberately **not** a user-ready m/s release: no recording control,
setup field or capture surface was exposed. **Stage B exposes them**, building entirely
on the decisions below rather than adding new ones — the setup, capture, completion and
result surfaces route through this ADR's `src/lib/measurement/` boundary, and no
parallel speed model, store or mutation path was introduced. The one architectural
consequence worth naming here is that the rollout gate below is now LIVE: a person using
the app can create a wire-version-2 record. The canonical product decision record is
`docs/FIXED_WEIGHT_SPEED_AND_CAPTURE_SPECIFICATION.md`; this ADR records only the
durable architectural choices that specification left open, and their consequences.

## Context

Fixed Weight training must be able to record a release **time** (seconds), a manually
entered **speed** (m/s), or **both**, with an independent fixed target per quantity,
independent per-side tolerances, and independent classification. Both measurements
belong to one stone with one identity, handle, shot type and progress count, and a
Both stone may legitimately carry only one of the two.

Three existing constraints made the representation non-obvious:

1. `Shot.releaseTime`/`Shot.targetTime` and `TrainingBlock.targetTime`/
   `measurementMode` were all **required**. A speed-only block has no timing interval
   and no time target; a Both stone awaiting its speed has no speed yet. Any
   representation that keeps these required necessarily fabricates a value
   (`releaseTime = 0`, `targetTime = 3.75`, `measurementMode = "back-hog"`), and a
   later reader cannot distinguish a fabricated zero from a measured one.
2. `AccuracyThresholds` is a **symmetric, seconds-only** pair, snapshotted per block
   (ADR-0008). It must keep its exact historical meaning for every stored block.
3. `deserializeTrainingSession` (`src/lib/cloudSporting/records.ts`) accepts a record
   only if `migrateSession(parsed)` deep-equals `parsed`, and `syncManager.reconcile`
   compares **exact payload strings**. Therefore *any* field migration adds to a
   legacy payload would either reject that record on restore or raise an artificial
   sync conflict — on data that is immutable and already uploaded.

## Decision

### 1. `MeasuredQuantity` is a first-class domain concept, distinct from two neighbours

`MeasuredQuantity = "time" | "speed"` (`src/types/index.ts`) names *what is measured*.
It is deliberately **not** called a Metric (the glossary reserves that for a *derived*
value) and deliberately **not** conflated with `MeasurementMode` (`"back-hog"` /
`"hog-hog"`), which is the **timing interval** and only ever qualifies a time. A
timing interval enum is never read as a quantity selector, and a speed is never
inferred from an interval or converted from seconds.

### 2. Absence of `TrainingBlock.measurement` IS the legacy time-only representation

A block carries an optional `measurement: BlockMeasurementConfiguration`
(`quantities`, plus a `{ target, tolerance }` entry per listed quantity). Its
**absence** is the legacy time-only representation: such a block keeps exactly its
historical shape and resolves through `resolveBlockMeasurement` to
`quantities: ["time"]` using its own `targetTime` and its own `accuracyThresholds`
snapshot re-expressed as a symmetric tolerance. Every block ever stored is of this
shape, and migration never adds the field to one.

**When the field is present.** It is required whenever the block records speed. It is
also *permitted*, and necessary, for a **time-only block that needs an asymmetric
tolerance** — `accuracyThresholds` is a symmetric pair and structurally cannot express
one. So an explicit time-only configuration is a real, supported shape, not a
contradiction; the domain, validation, migration and both persistence boundaries
accept it, and it is covered by test.

The compatibility consequence follows directly and is the same in both cases: because
the wire version is selected by the presence of the field (Decision 5), a time-only
block carrying an explicit configuration serializes as **wire version 2**, exactly like
a speed block, and is therefore subject to the same unresolved old-client rollout gate.
An asymmetric time tolerance is consequently NOT a free, backwards-compatible addition
— it costs the same compatibility step that speed does. Ordinary symmetric time
training continues to carry no configuration and stays on version 1.

**Alternatives rejected:**

- *Materialize `measurement` on every block, including time-only ones.* Simpler to
  read, but it changes the serialized bytes of ordinary time training. Every
  time-only session would have become wire version 2, would have failed an already
  deployed old client's restore, and — because migration would now add a field —
  every existing immutable cloud payload would have been rejected on restore and
  flagged as a conflict by `reconcile`. Rejected: it imposes the full compatibility
  cost of this feature on the users who never asked for it.
- *A separate speed-session domain or a parallel speed store.* Rejected by the
  specification's architecture constraints, and it would have split one stone's
  identity, handle and progress count across two aggregates.

This choice is what keeps ordinary symmetric time training — the overwhelming
majority of stored data — entirely untouched: no new field, no changed bytes, no
changed digest, no changed wire version. The compatibility cost falls only on sessions
that genuinely carry a configuration: those recording speed, those needing an
asymmetric time tolerance, and those whose archived plan still carries such a step.

### 3. Missing is representable, and is never zero

`Shot.releaseTime`, `Shot.targetTime`, `TrainingBlock.targetTime` and
`TrainingBlock.measurementMode` became optional, and `Shot` gained `speed`,
`targetSpeed`, `speedSource` and `speedRecordedAt`. A measured value is always stored
**together with the target it was judged against**; a value without its own target is
treated as not measured rather than silently borrowing the block's current target,
which would rewrite history.

A measurement is recorded with its own provenance: `measurementSource` is the time
value's source and `speedSource` the speed's, kept independent through creation,
explicit completion and persistence. Recording enforces the ownership it is given —
`buildMeasuredShot` refuses a stone attributed to a different block than the one it is
built for, and `completeShotMeasurement` requires a matching session, block and a
single unambiguous stone, refuses to overwrite a recorded value, and refuses a stone
whose existing measurement state is already malformed.

Making these optional was chosen specifically *because* it forces the compiler to
enumerate every consumer that reads a time, which is how the safe-reading work in
Stage A was scoped. Selection is centralized in
`src/lib/measurement/quantities.ts` (`timeMeasuredShots`, `speedMeasuredShots`,
`shotDeviation`); no consumer reads `releaseTime`/`speed` directly to decide
eligibility. Each quantity therefore has its own independent denominator: a Both
stone missing its speed still counts fully towards time.

### 4. Tolerances are per quantity and per side; legacy pairs are re-expressed losslessly

`QuantityTolerance` carries an independent `lower`/`upper` for each of the On Target
and Acceptable bands, in the quantity's own unit. On each side independently,
Acceptable must extend strictly beyond On Target. Symmetry is a presentation concern,
not a separate model.

`categorizeDeviation` classifies a **signed** deviation against the matching side,
with inclusive inner boundaries and the same floating-point epsilon
`categorizeTargetError` already used — comparisons are made on the **raw** deviation,
never on a pre-rounded value. For a symmetric tolerance built from a legacy
`AccuracyThresholds` pair, it returns exactly what `categorizeTargetError` returns;
this equivalence is proved by test across ~1000 sampled deviations and three
threshold sets. ADR-0008's snapshot rule is unchanged and extended, not replaced:
block tolerances are still snapshotted at creation and never re-derived from a later
default change.

Speed starts at On Target ±0.05 m/s and Acceptable ±0.10 m/s. These are **adjustable
product starting values, not validated sporting norms**.

### 5. Cloud wire version follows the content, not the app version

Training wire version **1** remains the payload of a session that declares no
measurement configuration anywhere. Version **2** is used as soon as one appears —
on a block, or on an **embedded plan-step snapshot** whose Block has not been
materialised yet. Finishing a mixed plan during step 1 archives a Session whose blocks
are all legacy but whose `planExecution` still carries step 2's configuration; an old
client's plan validator cannot read that step, so calling such a payload
legacy-compatible would be untrue.

The selector is the presence of the configuration — never the presence of speed, and
never the app version. Writer and reader apply the identical rule, so a record this
build writes is always one it can read back.
Deserialization accepts both and additionally requires the declared version to match
what the payload actually contains — a version-1 record carrying measurement-aware
content is rejected rather than treated as legacy-compatible, and vice versa. An
unsupported future version is rejected, never guess-migrated.

No SQL, RLS or API change was required: the existing terminal-record storage already
accepts any positive schema version and an opaque payload string.

### 6. Malformed new-format data is rejected, never repaired into something legacy-shaped

`validateSessionMeasurementState` and `validateTrainingPlansMeasurementState`
(`src/lib/measurement/validation.ts`) are strict validators used at the session
repository, the Training Plan repository and the cloud boundaries, in the same role
`validateSessionExerciseState` already plays — deliberately separate from
`sessionMigration.ts`'s field-by-field repair style. The format discriminator is the
block's `measurement` field:

- **absent** → the legacy path, with its existing repair rules (including
  `releaseTime = 0` and the block-target fallback) completely untouched;
- **present** → strict and structural. Nothing is defaulted, nothing is filtered. The
  required SHAPE is validated before any repair can alter it — containers (`blocks`,
  `shots` must be lists), entries (each must be an object), identities, references,
  required fields, enums and plan-execution state — not only measurement numbers. All of these are rejected outright: an unknown or duplicated quantity; a
  `null` or malformed entry; an entry for an undeclared quantity; a non-canonical
  quantity order (which migration would rewrite, breaking the reader's exact-equality
  check); a dangling block reference; duplicate block or stone identities; a stone with
  no stable identity; a stone stamped with another session's id; a stone with no real
  measurement; and two time targets that disagree. Raw data is validated BEFORE
  normalization, so a malformed shape can neither be partially accepted nor throw past
  the repository's protected failure path. A speed-only block must carry neither a
  timing interval nor a time target; only Fixed Weight may declare a configuration.

An **explicit completion** applies the same standard before it writes: it verifies the
stone's ownership and unambiguous identity, and that *every* measurement already on the
stone is well formed — not merely that one of them is. A recorded value that happens to
be malformed is never permission to replace it.

Rejecting rather than filtering matters specifically because this build would
otherwise *write the downgrade back*: quietly dropping a quantity it does not
understand would replace the stored original with a lesser version of itself.

**Writer/reader agreement is guaranteed by construction, not by a list of guards** —
but validating the persisted representation is deliberately separate from the
lifecycle transitions migration performs on purpose.

The cloud reader accepts a record only when `migrateSession(parsed)` deep-equals
`parsed`, so that is the write condition for a **terminal** measurement-aware session
(`sessionMeasurementStateIsCanonical`). **Local** storage uses
`sessionMeasurementStateIsRestorable`, which additionally tolerates exactly one
documented recovery transition: a Capture Sequence still `running` is forced to
`paused` on load so automatic capture can never keep listening after a reload
(ADR-0006). A running sequence is valid state, not malformed data — requiring
byte-identical restoration locally would refuse to save active training, which would
either lose accepted results or defer their persistence until capture stopped. Both
conditions reject everything else: malformed measurements, identities, references,
counts and execution state.

Finishing a training ends an active Capture Sequence, as its confirmation has always
promised, so an archived Session is genuinely terminal and its record restorable.

Legacy sessions are exempt from both and keep their ADR-0005 repair rules.

**Both conditions compare VALUES, which is not sufficient on its own.** The cloud
contract is stricter: a record is identified by the SHA-256 of its exact payload bytes,
and both `reconcile` and the restore pass compare them. So a Session must also serialize
in a stable property order — and an already authoritative payload must serialize in
*its own* order, not a newly chosen one.

The rule is applied on **load**: a Session is restored in the order it was stored in
(`preserveStoredSessionOrder`). Re-serializing it then reproduces exactly the bytes it
came from, which keeps an existing record immutable in practice and not only in intent,
including one written by an earlier producer whose order differed. A brand-new Session
has no stored representation yet, so the order its producers chose becomes authoritative
on first write and is preserved thereafter — which is why later transitions
(`addTrainingBlock` appending `completedAt`, a plan attaching before a capture sequence,
`pauseCaptureSequenceWithError` adding `lastError`) can no longer destabilise it.

Writes and serialization impose no ordering of their own, so nothing stored is
re-sorted, re-hashed or rewritten. Only order comes from the stored shape, and only from
an entry with the same record id; every value comes from migration, so a genuine edit, a
legacy repair or the running-to-paused recovery transition still changes the content and
is still detected as a conflict.

A session failing this is surfaced as a read failure with its stored bytes left
intact for recovery, and is refused by both the local write path and upload.

## Consequences

- Ordinary time-only training is byte-for-byte unaffected: same stored shape, same
  payload, same digest, same wire version, same classification, same analytics.
- Variable Weight, Blind Weight, Assessments and curated Exercise execution are
  untouched; a measurement configuration is rejected outright on a non-Fixed block.
- A timing device still only ever produces a time. `processTimingResult` rejects a
  result for a block that measures no time, and never fabricates a speed.
- `getNextShotTarget`/`computeShotTarget` now return `number | undefined`, and
  `isSmartRandomAvailable` accepts `undefined` (returning false) — a block with no
  timing interval has no Smart Random profile rather than being assumed Back-Hog.
- `HistoryAnalysisBlockContext` gained `timeTolerance`, so an asymmetric block
  tolerance is not flattened when analysing history in "original" mode. An explicit
  Standard/Tight comparison override still applies symmetrically to everything, which
  is what the user chose.
- Unreadable template or plan storage is a **protected failure**, never an empty
  writable value: the application's ordinary save effect writes what it loaded straight
  back, so handing it an emptied or silently shortened state would turn "this build
  cannot represent that" into permanent loss. Genuine absence stays distinct from it,
  and writes are validated before storage is touched.
- A persistence acknowledgement is matched on explicit **write ordering**, not object
  identity. An older or unrelated write never acknowledges a newer transition; a
  superseding write may, but only when it succeeded AND the state it wrote still
  contains the intended change. Failures surface with a real retry, and acknowledgement
  never blocks the shared capture/transition queue.
- A control that refuses a mutation refuses it on **every** submission path, and input
  belonging to a refused mutation is never cleared.
- Every configuration snapshot boundary — block creation, plan step mapping, stored
  templates, template duplication — takes a **deep copy**, so editing or deleting the source afterwards
  cannot reach into recorded history (the rule ADR-0008 set for `AccuracyThresholds`
  and ADR-0012 set for plan step snapshots, now covering nested tolerance bands).
- Accuracy Tolerance Profiles became unit-safe: a template carries the
  `MeasuredQuantity` its numbers are expressed in and a per-side `QuantityTolerance`
  (schema version 2). Stored version-1 templates migrate forward losslessly and remain
  **time** templates with their exact numbers; they are never reinterpreted as speed
  presets, and a template is only ever offered for a block measuring the same quantity.
  Stage A's setup control had one field per band and therefore offered only symmetric
  time templates; Stage B's per-side editor represents every stored shape, and offers a
  template only where the destination can actually persist it.
- CSV export gained `measured_quantities`, four per-side time tolerance columns and ten
  speed columns. The two legacy symmetric threshold columns keep their exact meaning
  but cannot represent an asymmetric tolerance, which is why the four per-side columns
  are required to interpret an exported classification. A time-derived result for a
  stone with no time (including `is_major_miss`) exports as an **absent** value, never
  as `false`, which would assert an assessment that was never made. Every absent
  measurement exports as an **empty field**, never `0`. All pre-existing columns keep
  their position relative to one another and their exact meaning.

### Accepted limitation: already deployed old clients

An already deployed old client stops its entire restore pass on a record whose schema
version it does not recognize. Updating this checkout **cannot** retroactively change
that behaviour on an installation already in the field. A wire-version-2 record is
therefore only safe to create once the rollout/update policy guarantees no old client
will attempt to restore it. **That policy is a release gate, not permission to
silently discard unsupported records**, and it is unresolved. Stage A created no such
record through any user-reachable path, because it exposed no speed recording UI.
**Stage B removes that protection**: Speed, Both and asymmetric time tolerances are
reachable from ordinary setup, so this gate now binds in practice. Stage B is authorized
for local implementation and testing only; version-2 records belong in disposable local
test accounts until the rollout policy is resolved.

| Writer \ Reader | Old client (v1 only) | This client |
| --- | --- | --- |
| Existing v1 record | Reads (bytes/digest unchanged) | Reads; re-serializes identically |
| New time-only session, no explicit configuration | Writes v1; reads | Writes v1; reads |
| New time-only session WITH an explicit configuration (e.g. asymmetric) | **Stops the restore pass** | Writes v2; reads |
| New speed/Both session | **Stops the restore pass** | Writes v2; reads |
