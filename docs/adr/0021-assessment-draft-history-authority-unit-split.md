# ADR-0021: Assessment Draft/History Authority-Unit Split

**Status:** Accepted. Design complete — every decision within this ADR's own scope is a
deterministic, internally consistent, and (per this revision) actually executable rule.
Implementation has not been performed (this commit changes documentation only).

**Correction note (this revision — final semantic pass).** Two prior revisions fixed most
contradictions but left several protocol-level defects: a possible lock re-entrancy
deadlock in the archive coordinator, a fresh-initialization supersession path that named a
branch it could not actually reach, an architectural decision on migrated-prepared drift
left as an implementation choice, incomplete idempotency for ordinary mutations, and
internally contradictory claims about when the split-layout evidence's fingerprints do or
don't require Web Crypto. All are corrected in place below, in addition to preserving every
already-sound correction from the prior revisions:

- ADR-0021 resolves ADR-0020 Decision D in full — never again described as "blocked by
  Decision D."
- The old-build hazard is documented, deterministically classified, and handled safely —
  never described as a product-acceptance decision this ADR makes on production's behalf.
- Fresh initialization and legacy migration are two named origins of one evidence-backed
  protocol, never conflated.
- Present-but-malformed legacy JSON is never treated as absence.
- Post-commit target validity is ordinary, current-content schema/domain validation —
  never a perpetual comparison against the values captured at commit time.
- Every current-build Assessment mutation shares one exclusive lease, re-checking durable
  authority **exactly once, immediately before that mutation's first write** — this
  revision corrects every remaining place that said "before every/each write," which
  described a different (and unimplemented) design.
- No public repository operation and its own internally-invoked helpers ever both request
  the same lease — this revision introduces an explicit, non-reentrant mutation-context
  design to guarantee it structurally, not just by convention.
- Run-to-run equality (collision detection, archive conflicts, exact-match clearing,
  baseline checks) uses **exact canonical serialized-value comparison**, never a SHA-256
  fingerprint — a fingerprint is cryptographically strong, not mathematically exact, and
  this revision no longer conflates the two. Compact SHA-256 fingerprints remain, unchanged
  in role, for the split-layout evidence record itself (Decision 4), where storing full
  source/target strings would be wasteful.

**Correction note (this revision — narrow final correction pass).** The prior revision's
protocol was sound in structure but left four remaining defects, all corrected in place
below without otherwise rewriting the design:

- **A mutation context remained valid after its lock was released.** The prior revision
  added each context to a registry on creation but never removed it, so a context reference
  that escaped its callback would still pass `assertActiveContext` after
  `navigator.locks` had already released the lock — it did not, in fact, prove the lock was
  currently held. Corrected: the registry entry is now removed in a `finally` block before
  the Web Lock callback returns or rejects (Decision 8), and construction no longer uses an
  `as any` bypass of a private constructor while calling the result "unforgeable" — a
  module-private `Symbol` brand is used instead.
- **The strict legacy-eligibility check still let some normalization through.** Own-key-set
  containment (a prior revision's check) proves no unknown field is present, but does not
  prove the validator did not add a default, repair, or normalize a value using only known
  field names. Corrected: eligibility now requires the raw parsed value to be **exactly
  structurally equal** to the validator's own canonical reconstruction (Decision 10),
  checked once, recursively, by one comparator — not approximated by a second,
  manually-enumerated nested schema.
- **`updateCurrentRun` could re-run a nondeterministic updater.** A prior revision's
  retry-recognition logic re-invoked a caller-supplied `updater` callback to check whether
  a prior attempt already succeeded — but an arbitrary callback is not guaranteed to
  reproduce the same result on a second call, so it could not actually prove idempotency.
  Corrected: the caller now computes the intended result once, itself, and passes it as a
  fixed `intendedRun` value (Decision 9/15) — never recomputed by this method or by a retry.
- **Pair validation ran only after some writes, not before.** A prior revision validated
  the draft/history pair "after any mutation whose result could introduce a conflict" —
  too late, since an invalid pair could already be durable by then. Corrected: three
  distinct checks (existing-state, prospective-state before the first write, and immediate
  read-back after) are now defined and applied to every relevant operation (Decision 12).

**Correction note (this revision — final micro-correction pass).** Four remaining defects,
all narrowly scoped, corrected in place:

- **The array comparator still read live properties.** After descriptor-gating each index,
  the comparator read `array.length`/`array[i]` as **live** property accesses — for an
  Array Proxy that permits `getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor` but throws
  from `get`, those live reads still invoked user-controlled code the prose claimed was
  never invoked. Its "expected keys" set was also built by iterating `0..length` **before**
  proving density, so a hostile array reporting a huge `length` with only a few real
  indices forced work proportional to that claim. Corrected: every array value, including
  `length` itself, is now read exclusively from an already-obtained descriptor; density is
  proven by comparing the count of valid in-range index keys (bounded by the array's real
  own-key count) against the descriptor-derived length, never by iterating the claim
  (Decision 10).
- **A remaining optional conflict-taxonomy branch.** Decision 12's `deleteHistoryEntry`
  discussion still said a check-B failure returns `prospective_target_conflict` "or a more
  specific prospective-validation error, if implementation distinguishes one" — directly
  contradicting the same section's own "one exact taxonomy, no implementation choice."
  Corrected: check B always returns exactly `prospective_target_conflict`, no alternative.
- **A residual overbroad definite-failure statement.** The archive section's recovery table
  said only that "a write call that itself reports failure (never reaching a success
  indication)" is a definite failure — too broad, since a failure report does not always
  rule out a completed write. Corrected: `history_unavailable`/`draft_clear_failed` require
  the adapter's own contract to positively guarantee no write took effect; anything short
  of that guarantee is `write_outcome_unknown` (Decision 14).
- **A dropped section rediscovered during this pass's audit.** The "Relationship to
  ADR-0016 and IndexedDB" content and the target 8-domain/11-key cardinality table — both
  already relied upon by the six summary documents — had been lost from the ADR body during
  an earlier rewrite. Restored as §11.1, unchanged in substance from what the summary
  documents already cite.

No runtime code, database schema, Supabase integration, or dependency changes are made or
authorized by this ADR. `localStorage` remains the sole production source of truth for
Assessment data; `curling-release-tracker-assessment-data` remains the only key the running
application reads or writes. IndexedDB remains unactivated. No Supabase table, RLS policy,
or adoption-protocol row becomes reachable as a result of this ADR.

## Context

`AssessmentPersistedState` (`src/lib/assessment/persistence.ts:20-24`) is one root object
under one `localStorage` key (`ASSESSMENT_STORAGE_KEY`,
`curling-release-tracker-assessment-data`):

```typescript
type AssessmentPersistedState = {
  schemaVersion: number;   // ASSESSMENT_PERSISTENCE_SCHEMA_VERSION = 1
  currentRun?: AssessmentRun;
  history: AssessmentRun[];
};
```

`currentRun` is a device-local, frequently-mutated, in-progress or just-completed
`AssessmentRun`. `history` is an append-ordered list of terminal runs
(`status: "completed" | "incomplete"`). Both live inside one key, read and written as one
JSON blob by one `AssessmentRepository`, constructed as an eager module-level singleton at
import time. ADR-0020 Decision D names the resulting authority-unit contradiction and asks
for exactly the split this ADR performs; accepting this ADR resolves Decision D in full —
see Decision 11 for the precise scope of what is, and is not, resolved as a consequence.

## Decision

Split the Assessment persistence domain into two independent authority units:

- **`assessmentDraft`** — permanently device-local. Owns the current or in-progress
  `AssessmentRun`. May also retain a terminal run until it has been durably transferred
  into history (Decision 14).
- **`assessmentHistory`** — owns terminal (`completed`/`incomplete`) `AssessmentRun`
  records. Remains local initially. Is the only Assessment authority unit ever eligible
  for future cloud adoption (Decision 11).

A single persisted `AssessmentRun` is never writable through both domains simultaneously.
The legacy combined domain does not remain a third live writable authority once the split
activates (Decision 3). One evidence-backed, crash-resumable establishment protocol
(Decision 4) covers both fresh initialization and legacy migration. Every Assessment
mutation — legacy, draft, or history — enters exactly one shared, non-reentrant mutation
runner (Decision 8) that acquires one unified lease and re-checks durable authority exactly
once, immediately before that mutation's first write.

---

## 1. Authority-unit definitions

### `assessmentDraft`

- **Owns:** at most one `AssessmentRun` at a time, in any status (including terminal,
  transiently — Decision 14).
- **Invariant:** never cloud-eligible, under any future ADR (Decision 11).
- **Invariant:** exactly one draft repository writes this domain's storage key at any
  time; every write goes through the one unified mutation runner (Decision 8).

### `assessmentHistory`

- **Owns:** an ordered list of terminal `AssessmentRun` records. Migration-time eligibility
  now requires **no duplicate IDs at all** (Decision 10) — a committed `assessmentHistory`
  therefore never contains two entries sharing an `id`, by construction, from the moment it
  is first established.
- **Invariant:** entries are immutable after insertion; only whole-entry deletion exists.
- **Invariant:** independently authority-resolvable from `assessmentDraft`.

### Cross-domain invariant

At no point after the split-layout protocol commits may both the split domain pair and the
legacy combined key be simultaneously treated as authoritative sources for the same logical
run. Exactly one of {legacy combined domain, split domain pair} is authoritative for
Assessment data at any moment a current build resolves authority.

### 1.1 Run-to-run equality — exact canonical comparison, not a hash

**Corrected in this revision.** SHA-256 fingerprint equality is cryptographically strong
collision resistance, not mathematical exactness — calling it "exact content equality" (the
prior revision's wording) overstated what it proves. Every place that needs to know whether
two persisted copies of a run are *the same* now uses:

```typescript
function toCanonicalAssessmentRun(run: AssessmentRun): AssessmentRun
// Reconstructs the run through the same fixed-field-order construction
// validatePersistedAssessmentRun already performs (migration.ts) — the existing,
// unchanged reconstruction this codebase already relies on to produce a stable shape.

function serializeCanonicalAssessmentRun(run: AssessmentRun): string
// JSON.stringify(toCanonicalAssessmentRun(run)) — deterministic, because the
// reconstruction always builds the object with the same fixed key order.
```

Two persisted copies are considered **identical** only if **both**:

1. `a.id === b.id` (a separate, explicit, always-required condition — never implied by
   string equality alone, stated this way so the two checks can never silently collapse
   into one in an implementation), **and**
2. `serializeCanonicalAssessmentRun(a) === serializeCanonicalAssessmentRun(b)` (exact
   string equality, not a hash).

This governs: the cross-domain ID-collision policy (§1.2), archive conflict detection
(Decision 14), `insertTerminalRunIfAbsent`'s idempotency (Decision 9), and
`updateCurrentRun`'s stale-baseline check (Decision 15). **No hash is used as a final
equality predicate anywhere in this ADR.**

The compact `asfp1:` SHA-256 fingerprints (Decision 4) remain, unchanged in role, for the
split-layout **evidence record** — there, storing the full source/target serialized
strings inside the evidence record itself would be wasteful, and a fingerprint's job there
is narrower: proving *that evidence was derived from* a specific snapshot, immediately
after deriving it, not standing in for run-to-run business equality.

### 1.2 Cross-domain and intra-domain run-ID collision policy

| Case | Canonically equal? | Migration eligibility (Decision 10) | Runtime (archive/committed-pair validation, Decisions 12/14) |
|---|---|---|---|
| Same `id` in `currentRun` and a `history` entry, terminal `currentRun` | Identical | **Eligible** — recognized interrupted-archive/pending-clear shape; both copies split unchanged | Recognized **valid pending-clear state** (Decision 12); the archive coordinator resolves it idempotently (`already_archived`, Decision 14) |
| Same `id` in `currentRun` and a `history` entry, terminal `currentRun` | Different | **Ineligible**: `current_history_id_conflict` | `committed_target_conflict` (Decision 12); archive coordinator returns `archive_conflict` (Decision 14) |
| Same `id` in `currentRun` (non-terminal/active) and any `history` entry | Either | **Ineligible**: `active_current_run_id_collides_with_history` | `committed_target_conflict` (Decision 12) — no legitimate flow produces this shape today |
| Two `history` entries share an `id` | Either | **Always ineligible**: `duplicate_history_id_conflict` — see Decision 10's correction; multiplicity/position is itself information a migration cannot both discard and call lossless | Cannot arise post-split — `insertTerminalRunIfAbsent`'s own idempotency (Decision 9) guarantees it |

---

## 2. Persisted shapes and storage keys

### Target types

```typescript
// src/lib/assessment/draftPersistence.ts (new)
export const ASSESSMENT_DRAFT_PERSISTENCE_SCHEMA_VERSION = 1;

export type AssessmentDraftPersistedState = {
  schemaVersion: number;      // ASSESSMENT_DRAFT_PERSISTENCE_SCHEMA_VERSION
  currentRun?: AssessmentRun; // absent (key omitted), never null
};

// src/lib/assessment/historyPersistence.ts (new)
export const ASSESSMENT_HISTORY_PERSISTENCE_SCHEMA_VERSION = 1;

export type AssessmentHistoryPersistedState = {
  schemaVersion: number;       // ASSESSMENT_HISTORY_PERSISTENCE_SCHEMA_VERSION
  history: AssessmentRun[];    // append order, no duplicate IDs (see Decision 10)
};
```

Both schema-version constants start at `1`, independent of the legacy
`ASSESSMENT_PERSISTENCE_SCHEMA_VERSION`, the per-run `ASSESSMENT_RUN_SCHEMA_VERSION`, and
every other version namespace (Decision 13).

**Post-commit mutability.** These types describe the *shape* every persisted draft/history
value must satisfy — not a value frozen to its initial migrated/initialized content.
Ordinary repository operations (Decision 9) legitimately change both keys' contents over
the domain's lifetime. Nothing ties a post-commit key's validity to a value it held at the
moment of commit (Decision 6).

### Storage keys

| Key | Constant | Value | Role after split-layout commit |
|---|---|---|---|
| Draft | `ASSESSMENT_DRAFT_STORAGE_KEY` | `curling-release-tracker-assessment-draft` | Authoritative for `assessmentDraft` |
| History | `ASSESSMENT_HISTORY_STORAGE_KEY` | `curling-release-tracker-assessment-history` | Authoritative for `assessmentHistory` |
| Legacy | `ASSESSMENT_STORAGE_KEY` (existing, unchanged) | `curling-release-tracker-assessment-data` | For `origin: "legacy_migration"` evidence: retained residue, expected to remain present and fingerprint-matching (Decision 7 corrects the earlier draft's tolerance of its deletion). For `origin: "fresh_initialization"` evidence: expected to remain absent. Read only by the resolver and the unified mutation runner's authority check, solely for branch/residue detection — never application data |
| Evidence | `ASSESSMENT_AUTHORITY_SPLIT_EVIDENCE_KEY` | `curling-release-tracker-assessment-authority-split-evidence` | Protocol metadata, not application data |

### Absence vs. `null`

`currentRun` keeps today's convention: optional (`?:`), never `null`. `history` stays
non-optional, always an array (`[]` when empty), never omitted, never `null`.

---

## 3. Legacy combined key

Before split authority is committed, the legacy key is authoritative; the two new keys, if
present without valid evidence, are non-authoritative stray data (`blocked:
stray_target_data`, Decision 7). After commit, the two split keys are authoritative;
the legacy key is retained residue, read only for branch/residue detection (Decision 7).

**The legacy key is not deleted by this ADR's protocol, ever, automatically** — an old
build has no code participating in this protocol and would simply recreate it; deleting it
destroys the fingerprint-bound evidence trail branch/residue detection relies on.

**Corrected in this revision.** A prior revision tolerated the legacy key being deleted
after a `legacy_migration`-origin commit, reasoning that deletion "can never represent an
old build overwriting data." That reasoning was too strong — see Decision 7's corrected
rule: an old build can write divergent content and *then* delete the key before any
participating code observes the divergence, which would erase the only signal that
divergence ever existed. **Deletion of a `legacy_migration`-origin residue key is therefore
no longer tolerated silently** — it resolves `legacy_residue_missing` (Decision 7), the
same severity class as a detected content change, until a future, separately-designed
cleanup ADR establishes its own durable evidence state authorizing removal.

Physical cleanup remains explicitly **out of scope** for this ADR.

---

## 4. Durable split-layout establishment protocol

One protocol, two named origins — never two different mechanisms, never conflated.

- **Name:** the Assessment Authority Split-Layout Protocol.
- **Protocol version constant:** `ASSESSMENT_AUTHORITY_SPLIT_PROTOCOL_VERSION = 1`.
- **Evidence key:** `ASSESSMENT_AUTHORITY_SPLIT_EVIDENCE_KEY`.
- **Lease:** the single, unified `curling-release-tracker:assessment-mutation` lock
  (Decision 8) — this protocol shares it with every other Assessment mutation; it has no
  lock of its own.

### Why ADR-0016's marker does not, and cannot, prove anything here

ADR-0016 copies *exact serialized strings*, one domain = one source key, and its marker's
fail-closed validation checks `sourceKeys` for an **exact-match, same-order** list. Today
`assessment`'s registered `sourceKeys` is `[ASSESSMENT_STORAGE_KEY]` — one key. The moment
this protocol commits a split, the legacy key still exists (quarantined) but is no longer
the domain's sole authoritative source — a fundamentally different domain shape ADR-0016
never reasoned about. This ADR does not reuse, extend, or reinterpret ADR-0016's
`assessment` marker for any purpose — see §11.1 for the target future relationship.

### 4.0 Evidence: an exact discriminated union

```typescript
type AssessmentSplitFingerprint = `asfp1:${string}`; // asfp1: + exactly 64 lowercase hex chars

interface AssessmentSplitEvidenceFreshPrepared {
  protocolVersion: 1;
  origin: "fresh_initialization";
  status: "prepared";
  draftTargetFingerprint: AssessmentSplitFingerprint;
  historyTargetFingerprint: AssessmentSplitFingerprint;
}
interface AssessmentSplitEvidenceFreshCommitted {
  protocolVersion: 1;
  origin: "fresh_initialization";
  status: "committed";
  draftTargetFingerprint: AssessmentSplitFingerprint;
  historyTargetFingerprint: AssessmentSplitFingerprint;
}
interface AssessmentSplitEvidenceMigratedPrepared {
  protocolVersion: 1;
  origin: "legacy_migration";
  status: "prepared";
  legacySourceFingerprint: AssessmentSplitFingerprint;
  draftTargetFingerprint: AssessmentSplitFingerprint;
  historyTargetFingerprint: AssessmentSplitFingerprint;
}
interface AssessmentSplitEvidenceMigratedCommitted {
  protocolVersion: 1;
  origin: "legacy_migration";
  status: "committed";
  legacySourceFingerprint: AssessmentSplitFingerprint;
  draftTargetFingerprint: AssessmentSplitFingerprint;
  historyTargetFingerprint: AssessmentSplitFingerprint;
}
type AssessmentSplitEvidence =
  | AssessmentSplitEvidenceFreshPrepared
  | AssessmentSplitEvidenceFreshCommitted
  | AssessmentSplitEvidenceMigratedPrepared
  | AssessmentSplitEvidenceMigratedCommitted;
```

`fresh_initialization` variants have exactly **5** own properties; `legacy_migration`
variants have exactly **6**.

### 4.0.1 Total validation

**Corrected in this revision — the descriptor-gate was not actually enforced.** A prior
revision's steps 5-7 validated each candidate property's descriptor (step 4) and then
declared it "now safe to read" via a **live** property access — `raw.protocolVersion`,
`raw.origin`, `raw.status`. That is not safe: a Proxy can expose a valid data descriptor
through `getOwnPropertyDescriptor` while its `get` trap returns a *different* value, throws,
or observes/counts the read. Validating a descriptor never makes a later `raw.<field>`
access safe — the two are unrelated Proxy trap operations. The surrounding `try`/`catch`
stopped an exception from escaping, but did not stop the live read from happening, and did
not stop validation from depending on a value the `get` trap fabricated rather than the one
the descriptor actually reported. This revision replaces the algorithm with a
**descriptor-snapshot** design: every value is copied out of its own validated descriptor
into a trusted local structure **once**, and every subsequent check — and the function's
own return value — reads exclusively from that snapshot, never from `raw` again.

```typescript
function validateAssessmentSplitEvidence(raw: unknown): AssessmentOutcome<AssessmentSplitEvidence> {
  try {
    // 1. Reject null, primitives, arrays, and non-plain prototypes.
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return err("invalid_evidence_shape");
    }
    const proto = Object.getPrototypeOf(raw); // reflection, not a live data read
    if (proto !== Object.prototype && proto !== null) return err("invalid_evidence_shape");

    // 2. One ownKeys call; reject any symbol key.
    const ownKeys = Reflect.ownKeys(raw);
    if (ownKeys.some((k) => typeof k === "symbol")) return err("invalid_evidence_shape");

    // 3. Build the trusted snapshot — the ONLY place any of raw's values is ever read.
    //    Every value is obtained from its own descriptor; nothing here, or afterward,
    //    ever reads `raw.<field>` or `raw[key]` live.
    const snapshot = new Map<string, unknown>();
    for (const key of ownKeys as string[]) {
      const desc = Object.getOwnPropertyDescriptor(raw, key); // reflection, not a live read
      if (!desc || !desc.enumerable || !("value" in desc)) return err("invalid_evidence_shape");
      snapshot.set(key, desc.value); // the descriptor's OWN reported value — never raw.key
    }

    // 4. Check PRESENCE of the three base discriminant fields before reading any of
    //    their values. A genuinely absent field must resolve to
    //    invalid_evidence_missing_field — never silently fall through to a
    //    value-validation code, which would incorrectly imply a wrong value was present
    //    when none was there at all.
    if (!snapshot.has("protocolVersion") || !snapshot.has("origin") || !snapshot.has("status")) {
      return err("invalid_evidence_missing_field");
    }

    // 5. Only now validate the (confirmed-present) base discriminant VALUES, exclusively
    //    from `snapshot`, never from `raw` again.
    if (snapshot.get("protocolVersion") !== 1) return err("unsupported_protocol_version");

    const origin = snapshot.get("origin");
    if (origin !== "fresh_initialization" && origin !== "legacy_migration") {
      return err("invalid_evidence_origin");
    }

    const status = snapshot.get("status");
    if (status !== "prepared" && status !== "committed") return err("invalid_evidence_status");

    // 6. Expected field set determined by the validated, SNAPSHOTTED origin, never
    //    raw.origin again.
    const expectedKeys =
      origin === "legacy_migration"
        ? ["protocolVersion", "origin", "status", "legacySourceFingerprint",
           "draftTargetFingerprint", "historyTargetFingerprint"]
        : ["protocolVersion", "origin", "status",
           "draftTargetFingerprint", "historyTargetFingerprint"];

    // 7. Check EVERY expected key for presence first — a missing required field always
    //    wins over an extra-field/count mismatch, regardless of what else is present.
    for (const key of expectedKeys) {
      if (!snapshot.has(key)) return err("invalid_evidence_missing_field");
    }

    // 8. Only after every expected key is confirmed present does a size mismatch mean
    //    anything — at this point every expected key is already known to exist, so a
    //    mismatch can only come from an unexpected EXTRA key.
    if (snapshot.size !== expectedKeys.length) return err("invalid_evidence_field_count");

    // 9. Validate every fingerprint value only once all required keys are known to exist.
    for (const key of expectedKeys) {
      if (!key.endsWith("Fingerprint")) continue;
      const value = snapshot.get(key);
      if (typeof value !== "string" || !/^asfp1:[0-9a-f]{64}$/.test(value)) {
        return err("invalid_evidence_fingerprint_format");
      }
    }

    // 10. Retain the already-validated fingerprint values in trusted local variables —
    //    each read exactly once from `snapshot`, never from `raw`.
    const draftTargetFingerprint = snapshot.get("draftTargetFingerprint") as AssessmentSplitFingerprint;
    const historyTargetFingerprint = snapshot.get("historyTargetFingerprint") as AssessmentSplitFingerprint;

    // 11. Construct the exact variant by branching on BOTH already-snapshotted
    //    discriminants — `origin`, then `status` — instead of assigning the WIDENED
    //    union value `status` (typed "prepared" | "committed") into one shared object
    //    shape. `AssessmentSplitEvidence` has four members, each requiring one concrete
    //    `status` literal; a value whose `status` field is still the two-member union is
    //    wider than any single member and is not structurally assignable to it without a
    //    whole-object cast. Each branch below writes its `status` (and `origin`) as a
    //    literal directly in the object, so each result is statically assignable to its
    //    corresponding union member with no cast on the object as a whole, no
    //    `as AssessmentSplitEvidence`, and no widening of the four interfaces themselves.
    //    Every field in every branch still comes only from the trusted local variables
    //    above or from `snapshot` — never `raw`, never a spread, never a live read.
    if (origin === "fresh_initialization") {
      if (status === "prepared") {
        return ok({
          protocolVersion: 1,
          origin: "fresh_initialization",
          status: "prepared",
          draftTargetFingerprint,
          historyTargetFingerprint,
        });
      }
      return ok({
        protocolVersion: 1,
        origin: "fresh_initialization",
        status: "committed",
        draftTargetFingerprint,
        historyTargetFingerprint,
      });
    }

    const legacySourceFingerprint = snapshot.get("legacySourceFingerprint") as AssessmentSplitFingerprint;
    if (status === "prepared") {
      return ok({
        protocolVersion: 1,
        origin: "legacy_migration",
        status: "prepared",
        legacySourceFingerprint,
        draftTargetFingerprint,
        historyTargetFingerprint,
      });
    }
    return ok({
      protocolVersion: 1,
      origin: "legacy_migration",
      status: "committed",
      legacySourceFingerprint,
      draftTargetFingerprint,
      historyTargetFingerprint,
    });
  } catch {
    // Any throwing reflection trap (getPrototypeOf/ownKeys/getOwnPropertyDescriptor)
    // resolves this same fixed, deterministic result — never propagates.
    return err("invalid_evidence_shape");
  }
}
```

**Exactly seven distinct error codes** are ever returned by this validator, unchanged from
the prior revision: `invalid_evidence_shape`, `invalid_evidence_missing_field`,
`unsupported_protocol_version`, `invalid_evidence_origin`, `invalid_evidence_status`,
`invalid_evidence_field_count`, `invalid_evidence_fingerprint_format`. Nothing in this
correction adds, removes, or renames a code — the existing exact taxonomy already covers
every rejection path the snapshot design can reach.

**Corrected in this revision — the precedence between "missing" and "extra/count" was
backwards.** A prior revision compared `snapshot.size !== expectedKeys.length` *before*
checking each expected key's individual presence, so an ordinary missing field (with the
snapshot's size otherwise short by exactly one) incorrectly returned
`invalid_evidence_field_count` instead of `invalid_evidence_missing_field` — contradicting
this ADR's own test matrix. The corrected, exact precedence, stated explicitly:

1. **A missing required field always wins over an extra-field/count mismatch** — every
   expected key (the three base discriminants first, then the full origin-derived set) is
   checked for presence before the snapshot's overall size is ever compared to the expected
   count.
2. **An extra field, with every expected field already confirmed present, is
   `invalid_evidence_field_count`** — reached only once step 1 has already proven no
   expected key is missing, so a remaining size mismatch can only mean an unexpected key
   exists alongside the complete required set.
3. **Malformed values (wrong `protocolVersion`, invalid `origin`/`status`, a malformed
   fingerprint) are classified only after their own required key is already known to
   exist** — a value-validation code is never returned for a field that was never present
   in the first place.

**Corrected in this revision — the snapshot is not assumed to hold only primitives.** A
prior revision claimed "there is nothing to recurse into, since every snapshotted field is
a primitive" — false *before* field-value validation runs: a hostile `raw` may place an
object, an array, a cyclic object, a Proxy, a `BigInt`, a function, or any other
non-primitive value at a candidate field's descriptor, and step 3 above snapshots that
value **by reference, as `unknown`**, exactly as it was found — it is not inspected,
narrowed, or assumed to be a primitive at that point. The exact, accurate reason this
validator is still total: **it never recursively traverses a snapshotted candidate
value.** It only (a) checks the snapshot's exact key set, (b) reads each required field's
snapshotted value and checks it against a primitive type/literal/regular-expression
contract (`=== 1`, `=== "fresh_initialization"`, the fingerprint regex, etc.), and (c)
rejects (`unsupported_protocol_version` / `invalid_evidence_origin` /
`invalid_evidence_status` / `invalid_evidence_fingerprint_format`) any value that does not
satisfy that exact contract — an object, array, cyclic reference, Proxy, or `BigInt` found
there simply fails the relevant `typeof`/`===`/regex check and is rejected, **without ever
being traversed, stringified, interpolated into a message, or returned**. A cyclic object
may sit briefly in the local `snapshot` `Map` as an opaque, untouched `unknown` reference —
that is not recursion, and this validator never calls `JSON.stringify` on `raw` or on any
snapshotted value.

**The exact, precise claim — corrected in this revision — is narrower than "no getter/trap
invocation":** reflection operations (`Object.getPrototypeOf`, `Reflect.ownKeys`,
`Object.getOwnPropertyDescriptor`) **necessarily invoke the corresponding Proxy reflection
traps** — that is unavoidable and is exactly how this validator inspects a value's shape at
all; any of them throwing is caught by the single outer boundary and resolves to
`invalid_evidence_shape`. What this validator does **not** do, and the only claim actually
made, is: **no user-supplied property value is ever obtained through a live property
access (`raw.field`, `raw[key]`) or through a user-defined accessor getter** — every value
is read exactly once, from its own already-validated descriptor, into the trusted
`snapshot`, and every check after that point — including the function's own return value
— consults only `snapshot`, never `raw` again.

**The same total-validation, descriptor-snapshot, no-live-read discipline applies to every
other exported *value-producing* validator this ADR introduces or extends** — the legacy
root validator, both target-state validators, and any `AssessmentRun` validator that
returns a validated run.

**Corrected in this revision — a single-input validator needs a single-graph guard, not
the comparator's pair-state map.** A prior revision said these validators should use "a
`visited` guard (a pair-state map, per Decision 10)" — imprecise: a pair-state
(`visiting`/`completed`) map is the right tool for `exactStructurallyEqual` specifically,
because it compares two independent object graphs against each other, pair by pair. A
value-producing validator traverses only **one** input graph — it needs, and uses, a
simpler mechanism: **a single `WeakSet<object>` of object identities already encountered
during that one validation call.** Where any of these validators performs genuine nested
traversal (e.g., walking `attempts`/`protocolDeviations` arrays), it adds each object it
descends into to that `WeakSet` before recursing, and **rejects the input outright,
fail-closed, the moment it encounters an object identity already in the set** — this
catches a direct cycle, an indirect cycle, and even a merely-repeated/shared object
reference (none of which a genuine `JSON.parse` output can ever produce, since real JSON is
always a tree with no shared identity, so this rejection can never fire against real
persisted data). This guard is **local to one validation call** and is **not** the
comparator's `(left, right)` pair-state map — the comparator retains its own, separate
`visiting`/`completed` algorithm unchanged (Decision 10), including its ability to safely
reuse an already-`completed` shared subgraph rather than reject it, which is specific to
comparing *two* graphs and has no equivalent in a single-graph validator. **None of these
validators returns its raw hostile input, narrowed or cast — each returns a newly
constructed, trusted value built exclusively from snapshotted descriptor data**, so a
Proxy or accessor-bearing object passed to any of them never escapes through the result.

**Corrected in this revision — `exactStructurallyEqual` (Decision 10) is not one of these
value-producing validators and must not be described as if it were.** A prior revision's
wording grouped it together with the validators above and implied it also "returns a newly
constructed canonical value." That is false: `exactStructurallyEqual`'s return type is
`boolean` — it never returns either compared operand, and it never returns a canonical
reconstruction of anything. Its role is narrower and different in kind: it is the
*comparison* the eligibility check (below) uses between (a) a raw candidate value and (b)
the separately-produced canonical reconstruction a value-producing validator already
returned. `exactStructurallyEqual` does follow the same **no-live-read-from-either-input**
discipline as the validators above (descriptor-gated traversal, pair-state cycle rejection,
a single fail-closed `try`/`catch` boundary) — but "the same discipline applied to inputs"
is not the same claim as "returns a trusted value"; see Decision 10's own corrected
comparator section for the exact, non-overlapping contract.

### 4.0.2 Fingerprinting and Web Crypto availability

```typescript
function computeAssessmentSplitFingerprint(exact: string): Promise<AssessmentOutcome<AssessmentSplitFingerprint>>
```

SHA-256 via `crypto.subtle.digest`, hex-encoded, `asfp1:`-prefixed. If `crypto.subtle` is
unavailable or `.digest()` rejects: `err("fingerprint_unavailable", ...)` — retryable,
never thrown.

**Corrected in this revision — Web Crypto is not needed only for the one-time
transition.** A prior revision claimed exactly that, which is false: `origin:
"legacy_migration"` committed evidence's ongoing branch detection (Decision 7) compares the
*current* legacy content's fingerprint against `committed.legacySourceFingerprint` on every
resolution and every mutation's authority check — this requires Web Crypto whenever the
legacy key is non-absent. The corrected, exact rule:

| Committed evidence | Legacy key | Fingerprinting needed for branch/residue detection? |
|---|---|---|
| `origin: "fresh_initialization"` | Absent | **No** — nothing to fingerprint; absence itself is the "no branch" signal |
| `origin: "fresh_initialization"` | Present | **No** — presence alone is `legacy_branch_detected` (Decision 7); no comparison needed |
| `origin: "legacy_migration"` | Present | **Yes** — must fingerprint current content and compare to `committed.legacySourceFingerprint` |
| `origin: "legacy_migration"` | Absent | **No fingerprinting**, but this is `legacy_residue_missing` (Decision 7), not a "no branch" result |

**If fingerprinting is required (the one `origin: "legacy_migration"` + legacy-present row)
and is unavailable or rejects:** authority cannot be fully established for **writable**
use. The resolver returns `split_local` with `disposition: { kind:
"read_only_pending_reconciliation", reason: "branch_detection_unavailable" }` (Decision
13) — no writable Assessment repository is constructed; a read-only one may be, since the
target data itself is still independently schema/domain-valid (Decision 12) even though its
relationship to the legacy residue cannot currently be confirmed.

Run-to-run equality (Decision 1.1) no longer uses fingerprints at all, so **ordinary
archive/mutation operations never require Web Crypto** after this revision's Decision 1.1
correction — only the establishment protocol's own derivation/recovery steps and ongoing
`legacy_migration`-origin branch detection ever need it.

### 4.1 Fresh initialization

Eligible only when the legacy key, both target keys, and the evidence key are all absent.

1. **Cheap check (no lease).** Confirm all four are absent.
2. **Enter the unified mutation runner** (Decision 8) — one lease acquisition for this
   entire establishment attempt.
3. **Re-read all four keys**, inside the runner.
4. If any is no longer absent: **abort without writes**; the next resolution reclassifies
   from scratch (very likely legacy migration, or — if legacy is now non-absent while
   fresh-prepared evidence from an *earlier, still-uncommitted* attempt already exists —
   Decision 4.4's supersession protocol, not this fresh path).
5. Derive the canonical empty target values and their fingerprints. On
   `fingerprint_unavailable`: abort; resolver falls back to `legacy_combined_local`
   (deferred).
6. Write `prepared` fresh evidence. Read back and validate. On failure: abort — nothing
   else written.
7. Write the empty draft target key; read back, confirm.
8. Write the empty history target key; read back, confirm.
9. **Re-check the legacy key remains absent**, still inside the runner. If it is now
   non-absent: **do not commit** — this attempt is abandoned; Decision 4.4 defines exactly
   how a *later* resolution handles the now-orphaned `prepared` fresh evidence plus the new
   legacy content (this step does not itself perform the supersession — it only recognizes
   that committing here would be unsafe and stops).
10. Finalize `committed` fresh evidence. Read back and validate.
11. Exit the runner. Split authority (`split_local`) begins now, never at `prepared`.

### 4.2 Legacy migration

Eligible only when the legacy key is present and passes Decision 10's strict eligibility.

1. **Classify (no lease).** If eligible, proceed. If evidence already shows `committed`
   matching this content's fingerprint, nothing to do. If ineligible: `legacy_combined_local`
   (deferred) — this session does not proceed further here.
2. **Enter the unified mutation runner.**
3. Re-read and re-fingerprint the legacy source, inside the runner.
4. Abort without writes if this fingerprint differs from step 1's.
5. Re-check evidence: `committed` matching → nothing to do. `prepared` matching → this is
   recovery (Decision 4.3), not a fresh derivation. `prepared` **not** matching → this is
   drift, handled by Decision 4.4's mandatory automatic restart, not by this sequence.
   Invalid evidence → abort, `blocked: invalid_split_evidence`.
6. Re-validate eligibility and derive both target values from this exact snapshot. Compute
   all three fingerprints.
7. Write `prepared` migrated evidence. Read back, validate. On failure: abort.
8. Write the draft target key; read back, confirm.
9. Write the history target key; read back, confirm.
10. **Final source-consistency check** — re-fingerprint the legacy source one more time,
    still inside the runner. **This is a source-consistency check, not a repository-
    authority check** (Decision 8 draws this distinction explicitly): it asks "is the
    snapshot I derived from still current?", not "am I still allowed to write?" — the two
    are answered by different mechanisms and at different moments, and this ADR no longer
    uses the same language for both. If it no longer matches: abort — this is drift,
    handled by Decision 4.4's mandatory automatic restart.
11. Advance evidence to `committed` (same three fingerprints). Read back, validate. This is
    the single moment authority begins.
12. Exit the runner.

### 4.3 Prepared-state recovery — re-derives, never assumes

On finding `prepared`, `origin: "fresh_initialization"` evidence with legacy still absent:
deterministically re-derive the canonical empty values, recompute fingerprints (always
matching, for the canonical empty value), retain any target key already matching without
rewriting, write/read-back-validate any missing or mismatched one, re-check legacy absence,
commit.

On finding `prepared`, `origin: "legacy_migration"` evidence with the current legacy
fingerprint matching `prepared.legacySourceFingerprint`: re-parse and re-validate the
source's eligibility (a mismatch here is `blocked: invalid_split_evidence` — an
internal-consistency anomaly, since a fingerprint-matching source cannot legitimately have
become ineligible without the codebase's own derivation function changing), re-derive both
target values, recompute fingerprints (always matching, since derivation is pure over an
unchanged, fingerprint-confirmed source), retain/rewrite target keys as needed, perform the
final source-consistency check, commit.

Recovery never trusts a stale or partial target key without independently re-deriving and
matching what it *should* contain first.

### 4.4 Drift and supersession — one architecture decision, fully executable

**Corrected in this revision, substantially.** A prior revision's fresh-prepared
supersession said "abandon fresh initialization, re-enter the evidence-absent legacy
branch" — but the fresh `prepared` evidence still exists at that point, so "the
evidence-absent branch" is not actually reachable; nothing told the protocol what to do
with the orphaned evidence. Separately, migrated-prepared drift was left as "the resolver
may attempt automatic restart, or may surface blocked" — an unresolved implementation
choice an Accepted ADR cannot leave open. Both are now fully specified, executable
protocols, entered under the unified mutation runner.

#### 4.4.1 Fresh-prepared evidence superseded by newly-appeared legacy content

Reached when a resolution finds `prepared`, `origin: "fresh_initialization"` evidence and
the legacy key is **now non-absent** (Decision 4.1 step 9's abort condition, encountered on
a later resolution).

1. Enter the unified mutation runner (one entry for this whole supersession attempt).
2. Legacy remains authoritative throughout — nothing here has ever granted split authority.
3. Parse and evaluate the new legacy value against Decision 10's strict eligibility.
4. **If eligible:**
   a. Derive migrated target values from this new legacy snapshot; compute all three
      fingerprints.
   b. **Overwrite** the existing fresh-prepared evidence with a new `prepared`,
      `origin: "legacy_migration"` record bound to the new source and target fingerprints
      — safe, because neither the old (fresh) nor the new (migrated) `prepared` record has
      ever granted authority; overwriting one non-authoritative record with another is not
      an authority transition.
   c. Read back, validate.
   d. Write/read-back-validate both migrated target keys — **unconditionally overwriting**
      whatever the abandoned fresh attempt may have written (an empty value can never
      fingerprint-match a real migrated value, so there is no "retain" case here).
   e. Perform the final source-consistency check against the fingerprint just recorded.
   f. Commit (`origin: "legacy_migration"`, `committed`).
   g. Exit the runner. `split_local`.
5. **If ineligible:** leave legacy authoritative; exit the runner; return
   `legacy_combined_local` (deferred, exact ineligibility reason). The orphaned
   fresh-`prepared` evidence and any partial fresh targets are left as inert,
   non-authoritative, explained residue — not deleted, not acted upon further this session.
   **Every later resolution re-evaluates the current legacy content against eligibility
   again** — this is not a one-shot decision; if the legacy content is later fixed or
   replaced with something eligible, the next resolution's step 3-4 sequence runs again and
   can still succeed.
6. **If the legacy read itself fails:** exit the runner, `blocked: storage_unavailable`.
7. **If leasing or fingerprinting fails:** exit, return the corresponding deferred/blocked
   result already defined for that failure (`lease_unavailable` /
   `lease_request_failed` / `fingerprint_unavailable` → `legacy_combined_local`, deferred).

#### 4.4.2 Migrated-prepared evidence whose source has drifted — mandatory automatic restart

**This is this ADR's own architectural decision, not an implementation option:** on
detecting that a `prepared`, `origin: "legacy_migration"` record's bound
`legacySourceFingerprint` no longer matches the current legacy content (at Decision 4.2
step 5 or step 10), the protocol **always automatically attempts** the restart below,
under the same held lease — it never surfaces an unresolved "blocked, human must decide"
result for this case alone.

1. Re-fingerprint and parse the **new** current legacy content; evaluate its eligibility.
2. **If eligible:** derive a new target pair; compute new fingerprints; **overwrite** the
   drifted `prepared` record with a new one bound to the new source/targets (safe — neither
   the old nor new `prepared` record has ever granted authority); read back, validate;
   write/read-back-validate both targets against the new fingerprints; perform the final
   source-consistency check against this new fingerprint; commit. `split_local`.
3. **If the new source is ineligible:** leave legacy authoritative; return
   `legacy_combined_local` (deferred, exact ineligibility reason) — the orphaned `prepared`
   evidence is left as inert residue, re-evaluated on the next resolution, exactly as
   §4.4.1's ineligible branch.
4. **If the source has become absent** (the legacy key itself was deleted between the
   original `prepared` write and this detection): **do not** silently convert this to fresh
   initialization, and **do not** commit the now-stale `prepared` targets (derived from
   content that no longer exists). Return one exact, named, durable result: **`blocked:
   legacy_migration_source_vanished`** — there is no legacy content left to fall back to
   (so `legacy_combined_local` is not available either), and committing an orphaned
   derivation would be unsafe. This requires investigation/reconciliation before this
   session's Assessment feature can proceed.
5. **If the source changes again while this restart's own final source-consistency check
   (step 2's last part) is running** (source churn — a second drift landing mid-restart):
   leave legacy authoritative; **do not** loop indefinitely; return a retryable, deferred
   result: `legacy_combined_local` (deferred, `{ kind: "source_churn" }`) — safe to retry on
   a later resolution.

**`source_drift_detected` is no longer a public, terminal result of any kind.** It was a
detection *event* that a prior revision incorrectly treated as a permanent,
human-repair-only `blocked` reason; this revision replaces every such occurrence with the
actual, executable terminal outcome above (`split_local` after a successful restart,
`legacy_combined_local` deferred if the new/newer source is ineligible or churned, or
`blocked: legacy_migration_source_vanished` if the source vanished).

---

## 5. (Folded into Decision 10)

Source validation, strict eligibility, and the ID-collision/duplicate rules are one
coherent set of rules that a prior split presentation let drift apart. Decision 10 below is
the single, authoritative source for all of it.

---

## 6. Post-commit mutable-target semantics

`draftTargetFingerprint`/`historyTargetFingerprint` (Decision 4) prove only the exact
values written **during establishment** (fresh initialization, legacy migration, or
recovery/restart) — a one-time proof used exclusively for that write's own immediate
read-back and for recovery/restart's re-derivation check. They are **never** compared
against a target key's content on ordinary startup once evidence shows `committed`.

**Startup validation of a committed split is ordinary schema/domain validation of each
target key's *current* content** (Decision 12's committed target-pair validator), applied
to whatever the key currently holds — never to what it held at commit time. Missing,
unparseable, unsupported-schema-version, or domain-invalid committed target state fails
closed with an exact reason (`committed_target_missing` / `committed_target_invalid` /
`committed_target_conflict`, Decision 12/16) — this ADR makes no corruption-detection claim
stronger than what schema/domain/pair validation already provides.

**`target_fingerprint_mismatch`** exists only as the name for a write's own immediate
read-back check inside Decision 4 — never a description of any post-commit, ongoing
comparison.

---

## 7. Startup authority resolution

### Public resolver contract

```typescript
type AssessmentAuthorityResolution =
  | { result: "legacy_combined_local"; migrationDeferred?: AssessmentMigrationDeferredReason }
  | { result: "split_local"; disposition: AssessmentSplitDisposition }
  | { result: "blocked"; reason: AssessmentAuthorityBlockedReason };

type AssessmentMigrationDeferredReason =
  | { kind: "lease_unavailable" }
  | { kind: "lease_request_failed" }
  | { kind: "fingerprint_unavailable" }
  | { kind: "legacy_ineligible"; detail: AssessmentLegacyIneligibleReason }
  | { kind: "prepared_recovery_failed"; detail: "lease_unavailable" | "lease_request_failed" | "fingerprint_unavailable" }
  | { kind: "source_churn" }; // Decision 4.4.2 step 5

type AssessmentAuthorityBlockedReason =
  | "storage_unavailable"
  | { kind: "invalid_split_evidence"; detail: AssessmentSplitEvidenceValidationErrorCode }
  | "stray_target_data"
  | "legacy_migration_source_vanished"    // Decision 4.4.2 step 4
  | "committed_target_missing"
  | "committed_target_invalid"
  | "committed_target_conflict";          // Decision 12

// See Decision 13 for AssessmentSplitDisposition (the corrected write-disposition model).
```

No result exposes `fresh_split_local` or `split_migration_recovery` — fresh initialization,
legacy migration, recovery, and drift/supersession (Decision 4) are internal activities that
always run to one of the three results above. `source_drift_detected` is **not** a public
result (Decision 4.4.2). No row returns a writable repository if authority could not be
determined.

### Ordered resolution procedure

**Step A — read all four keys.** Any genuine read failure relevant to the current branch →
**`blocked: storage_unavailable`** immediately; no repository constructed; no cached or
legacy fallback used.

**Step B — validate evidence, if present.** Invalid → `blocked: { kind:
"invalid_split_evidence", detail }`.

**Step C — branch on evidence:**

- **C1. Evidence absent:**
  - **C1a. Legacy absent:** both targets also absent → fresh initialization (4.1); success
    → `split_local`, `disposition: writable`; failure → `legacy_combined_local` (deferred).
    Either target present (stray, no evidence) → `blocked: stray_target_data`.
  - **C1b. Legacy present, eligible (Decision 10):** legacy migration (4.2); success →
    `split_local`, `disposition: writable`; failure → `legacy_combined_local` (deferred).
    Ineligible → `legacy_combined_local` (deferred, exact reason) — legacy remains safely
    usable via the unmodified legacy repository. Either target *also* present, no evidence
    → `blocked: stray_target_data` regardless of eligibility.

- **C2. Evidence `prepared`:**
  - `origin: "fresh_initialization"`, legacy now present → **Decision 4.4.1** (supersession)
    — resolves per that protocol's own terminal outcomes.
  - `origin: "fresh_initialization"`, legacy still absent → recover (4.3) → `split_local`
    on success, `legacy_combined_local` (deferred) on failure.
  - `origin: "legacy_migration"`, current fingerprint matches → recover (4.3) → same as
    above.
  - `origin: "legacy_migration"`, current fingerprint does not match (or legacy now absent)
    → **Decision 4.4.2** (mandatory automatic restart) — resolves per that protocol's own
    terminal outcomes (`split_local`, `legacy_combined_local` deferred, `blocked:
    legacy_migration_source_vanished`, or `legacy_combined_local` deferred with
    `source_churn`).

- **C3. Evidence `committed`:**
  - Draft/history keys: each validated via Decision 12's exact validators. Absent →
    `committed_target_missing`. Present but invalid → `committed_target_invalid`.
  - **Cross-target pair validation** (Decision 12): an unresolved conflict → `blocked:
    committed_target_conflict`.
  - Both individually and jointly valid → determine write disposition (Decision 13):
    - `origin: "fresh_initialization"`, legacy present → `read_only_pending_reconciliation`,
      reason `legacy_branch_detected` (presence alone is sufficient — no fingerprinting).
    - `origin: "legacy_migration"`, legacy present, fingerprinting available → compare; a
      mismatch → `read_only_pending_reconciliation`, reason `legacy_branch_detected`; a
      match → `writable`.
    - `origin: "legacy_migration"`, legacy present, fingerprinting **unavailable** →
      `read_only_pending_reconciliation`, reason `branch_detection_unavailable` (Decision
      4.0.2).
    - `origin: "legacy_migration"`, legacy **absent** → `read_only_pending_reconciliation`,
      reason `legacy_residue_missing` (Decision 7's own corrected rule, below).
    - `origin: "fresh_initialization"`, legacy absent → `writable`.
  - Final: `split_local` with the computed disposition.

### The corrected residue rule (Decision 3/13 cross-reference)

For `origin: "legacy_migration"` committed evidence, the retained legacy key is **expected**
to remain present and fingerprint-matching. Changed content → `legacy_branch_detected`.
**Missing content → `legacy_residue_missing`** (no longer tolerated as harmless deletion —
Decision 3's correction). Both dispositions preserve split data, refuse writes, never
auto-merge/auto-recreate; a future cleanup ADR must establish its own durable evidence state
before condoning removal.

**Honest, stated limitation:** an old build could write divergent content and *then* delete
the legacy key before any participating build observes the divergence — purely client-side
sampling cannot detect that transient round-trip. This remains part of the production
old-build gate (Decision 8.1), not something this ADR claims to close.

### Partial-rendering decision (unchanged)

One blocked or read-only-quarantined Assessment subdomain still gates the whole Assess
feature's write path for that session — see Decision 13 for exactly what remains available
(reads) versus refused (writes) under `read_only_pending_reconciliation`.

### Repository construction ordering

The startup gate resolves authority before any repository is constructed. Today's eager
module-level singleton must change during implementation (Implementation sequence, stage
14, below).

---

## 8. One unified, non-reentrant Assessment mutation runner

**Corrected in this revision, in two ways.** First, the authority-check wording is
normalized: a prior revision said both "checked exactly once, before the first write" *and*
"before every write" in different places — only the first is correct, and every remaining
occurrence of the second is corrected below. Second, and more seriously: the prior
revision's repository methods implied each acquires the lease **internally**, while the
archive coordinator **also** acquires the same lease and then calls those same methods —
since Web Locks are not reentrant, a coordinator that holds the lock and then requests it
again (even indirectly, via a method it calls) would deadlock waiting for a lock only it
itself could release. This revision introduces an explicit, non-reentrant structure that
makes this impossible by construction, not by convention.

### The lease

```
curling-release-tracker:assessment-mutation
```

One name, `{ mode: "exclusive" }`, default queuing mode. Every current-build logical
mutation that writes any of {legacy combined state, `assessmentDraft`, `assessmentHistory`,
the split evidence key} participates.

### The non-reentrant mutation runner

**Corrected in this revision.** A prior revision added each context to a module-private
`WeakSet` when it was created but **never removed it** — a context reference that escaped
its callback (stored, logged, or otherwise retained) would still pass
`assertActiveContext` after `navigator.locks` had already released the lock, so possessing
a context did **not**, in fact, prove the lock was currently held. The prior revision also
constructed the context via `new (AssessmentMutationContext as any)()`, an `as any` bypass
of the class's own private constructor, while calling the result "unforgeable" — a
contradiction, since the bypass is exactly a way to forge one. Both are corrected below:
the context is now registered only for the lifetime of the callback that received it (an
explicit `try`/`finally` removes it, regardless of success or exception), and construction
uses a module-private `Symbol` brand rather than a bypass of its own type system.

```typescript
const ASSESSMENT_MUTATION_LOCK = "curling-release-tracker:assessment-mutation";

// Module-private brand — never exported. A plain object literal or a structurally-typed
// fake can never carry this symbol-keyed property, so it can never satisfy
// assertActiveContext's check below, whether or not it is also present in the registry.
const _brand = Symbol("AssessmentMutationContext");
interface AssessmentMutationContext {
  readonly [_brand]: true;
}
function createMutationContext(): AssessmentMutationContext {
  return { [_brand]: true };
}

// A context is registered only for the exact lifetime of the callback it was created for.
const _activeContexts = new WeakSet<AssessmentMutationContext>();
function assertActiveContext(ctx: AssessmentMutationContext): void {
  if (!(_brand in Object(ctx)) || !_activeContexts.has(ctx)) {
    throw new Error("invalid or expired mutation context");
  }
}

// The ONLY function in the codebase that ever calls navigator.locks.request for this lock.
async function runAssessmentMutation<T>(
  fn: (ctx: AssessmentMutationContext) => Promise<T>
): Promise<T> {
  return navigator.locks.request(ASSESSMENT_MUTATION_LOCK, { mode: "exclusive" }, async () => {
    // The context is created only after the Web Lock callback has begun — i.e., only once
    // the lock is actually held — never earlier.
    const ctx = createMutationContext();
    _activeContexts.add(ctx);
    try {
      return await fn(ctx);
    } finally {
      // Removed before the Web Lock callback returns or rejects, on every path —
      // success, a thrown error, or a rejected promise all reach this block. A context
      // reference that escapes fn (stored, logged, closed over) is worthless afterward:
      // assertActiveContext rejects it exactly like a fabricated one, because the
      // registry membership this check depends on is gone.
      _activeContexts.delete(ctx);
    }
  });
}
```

**Normative contract, stated explicitly (not merely an implementation detail) — corrected
in this revision.** A prior revision described a context as valid "for the synchronous
extent" of its creating call — imprecise, since the callback passed to
`runAssessmentMutation` is `async` and legitimately `await`s internal operations, meaning a
context is used across multiple microtask turns, not within one synchronous stretch of
code. The accurate statement: **a context is valid for the entire dynamic asynchronous
lifetime of the single `runAssessmentMutation` call that created it** — from the moment
`createMutationContext()` runs (after the lock is granted) and the context is registered,
through every `await` inside that call's callback, until the callback settles (resolves or
rejects) and the context is removed in `finally`, before `runAssessmentMutation`'s own
returned promise settles. **Storing a context and reusing it after that call's callback has
settled (successfully or by throwing) is a programming error**, not a supported pattern —
there is no reuse across separate `runAssessmentMutation` calls, ever. Any internal
operation that receives an expired or fabricated context must reject it via
`assertActiveContext` before touching storage, surfacing `invalid_mutation_context`
(Decision 16) — an internal-programming-error outcome, never a user-data error.

**Two layers of operations, never mixed:**

- **Public, standalone mutations** (`AssessmentDraftRepository.createCurrentRun`,
  `.updateCurrentRun`; `AssessmentHistoryRepository.deleteHistoryEntry`) each call
  `runAssessmentMutation` themselves, exactly once, for their own single logical mutation.
  These are the only operations UI code ever calls directly.
- **Internal, context-bound operations** (`internalLoadCurrentRun`,
  `internalClearIfExactMatch`, `internalLoadHistoryState`,
  `internalInsertTerminalRunIfAbsent`) accept a required `ctx: AssessmentMutationContext`
  as their first parameter, assert it via `assertActiveContext`, and **never call
  `runAssessmentMutation` themselves** — they assume the lock is already held, proven by
  possessing a valid `ctx`, which only `runAssessmentMutation` can mint. These are not part
  of the public repository interface; only the archive coordinator (Decision 14) — the one
  operation that genuinely needs multiple internal steps inside one logical mutation —
  imports and uses them.

**No operation holding the lock invokes another operation that requests it.** The archive
coordinator enters `runAssessmentMutation` exactly once and uses only context-bound internal
operations for every subsequent read/write inside that one call — it never calls
`createCurrentRun`/`updateCurrentRun`/`deleteHistoryEntry` (the public, self-locking
operations) from within its own already-held lease. **A dedicated test asserts this
directly:** a fake lock implementation counts `request()` invocations across one full
`archiveCurrentTerminalAssessmentRun` call and asserts the count is exactly **1**.

### The pattern every logical mutation follows

1. Enter the runner once, for the mutation's entire logical scope.
2. Inside the held lease, re-read durable split-layout evidence.
3. **Confirm the repository/backend this mutation is about to write remains
   authoritative — checked exactly once, immediately before this mutation's first write.
   This check is never repeated before any later write in the same logical mutation.**
4. Perform every write in this logical mutation.
5. Hold the lease until the final read-back/confirmation completes.
6. Release it (by returning from the callback passed to `runAssessmentMutation`).

**The authority check, precisely — normalized wording used everywhere in this ADR:** "one
durable authority check inside the held lease, performed exactly once, immediately before
the mutation's first write." **This is distinct from, and never confused with, the
establishment protocol's own final source-consistency check** (Decision 4.2 step 10 /
4.4.2's restart step) — that check asks whether the *source snapshot a derivation was based
on* is still current, a question about data provenance; the authority check asks whether
*this mutation is still allowed to write to the backend it assumed*, a question about which
domain is authoritative. Both happen "immediately before committing," but they check
different things and neither substitutes for the other.

- A **legacy-repository** mutation checks: has evidence since become `committed`? If so, no
  legacy write is performed; returns `authority_changed`.
- A **split-repository** mutation checks: is evidence still `committed`, and does the
  computed disposition (Decision 13) remain `writable`? If evidence changed or the
  disposition is `read_only_pending_reconciliation`, no target write is performed; returns
  `write_refused_read_only` (with the disposition's own reason nested) or
  `authority_changed`, as appropriate.

This reactive, per-mutation, inside-the-lease, exactly-once check is the entire, guaranteed,
current-build safety mechanism. No event, broadcast, cache, or lifecycle notification is
ever the safety mechanism.

### What this does and does not prove

- **Current-build tab vs. current-build tab, every kind of mutation:** fully serialized —
  a technical elimination, not a residual risk.
- **A bfcache-restored stale repository instance:** safe for the same reason — its next
  write re-enters the runner and re-checks fresh, regardless of how long it was suspended.
- **A long-lived tab's read-side view may go stale** until its next write or a reload — an
  accepted liveness/UX limitation, distinct from write safety.
- **Old (pre-this-ADR) builds:** not solved, not claimed to be — Decision 7's
  branch/residue detection is the deterministic, bounded response, never a claim of
  prevention.
- **A browser without `navigator.locks`:** the establishment protocol does not run;
  `legacy_combined_local` (deferred, `lease_unavailable`).

### 8.1 Scope of "current-build safety" — bounded explicitly

**Corrected in this revision.** The unified lease is scoped to **one browser storage
partition / origin environment on one device** — it never serializes across other devices,
other browser profiles, or server-side cloud mutations. For a future
cloud-authoritative `assessmentHistory`: this local lease protects only this client's local
logical mutation and draft-clear sequencing; a genuinely concurrent cloud mutation protocol
(across multiple clients/devices) would need its own server-side transaction/idempotency/
RLS design (Supabase's own constraints), which this ADR does not design and does not claim
this local lease provides in any form. Production execution of the establishment protocol
in the presence of old builds remains a separate, not-yet-made deployment-fencing or
explicit-risk-acceptance decision (unchanged from prior revisions).

---

## 9. Repository/API separation — operation-oriented, non-reentrant, idempotency-aware

```typescript
// PUBLIC — each acquires the unified lease exactly once, for its own standalone mutation
interface AssessmentDraftRepository {
  loadDraftState(): Promise<DomainLoadResult<AssessmentDraftLoadResult>>; // read-only, no lease needed

  /** Idempotent: an existing active run with the same id and canonical content ->
   *  succeeds, returns the existing value, no rewrite. Same id, different content ->
   *  draft_conflict (practically unreachable — ids are freshly generated — kept for
   *  robustness). A different, still-active id -> current_run_already_active. A
   *  present, terminal, not-yet-archived run -> terminal_run_pending_archive. Before
   *  writing: constructs the prospective draft/history pair and validates it (Decision 12,
   *  check B) — an id collision with an existing history entry the write would introduce
   *  -> prospective_target_conflict, no write, existing durable state unchanged. */
  createCurrentRun(run: AssessmentRun): Promise<AssessmentOutcome<AssessmentRun>>;

  /** Corrected in this revision (Decision 15) — replaces a prior revision's arbitrary
   *  `updater: (run) => AssessmentRun` callback, which could not be relied on to prove
   *  idempotency: an arbitrary closure may read the clock, randomness, or external/mutable
   *  state, so invoking it twice is not guaranteed to produce the same result, which is
   *  exactly what the prior design's own retry-recognition logic needed to assume.
   *
   *  The caller — the UI/domain layer — applies its existing pure domain function
   *  (`transitionAssessmentRun`, `addValidAttempt`, etc.) to its own observed baseline
   *  EXACTLY ONCE, itself, and supplies the resulting value as `intendedRun`. It is never
   *  recomputed by this method or by an automatic retry.
   *
   *  `expectedBaselineCanonical` is the canonical serialization (Decision 1.1) of the run
   *  the caller last observed. Inside the lease:
   *  1. validate `expectedBaselineCanonical` parses as one canonical `AssessmentRun`
   *     (exact structural equality against its own re-validation, Decision 10).
   *  2. validate `intendedRun` exactly the same way.
   *  3. require `intendedRun.id === expectedRunId`.
   *  4. load the current authoritative run; compute `currentCanonical`.
   *  5. compute `intendedCanonical` from the (already-validated) `intendedRun`.
   *  6. if `currentCanonical === intendedCanonical`: idempotent success, no write — this is
   *     what makes retrying the same attempt-add or transition safe, without ever
   *     re-invoking a caller-supplied transformation.
   *  7. else if `currentCanonical !== expectedBaselineCanonical`: `draft_conflict`, no
   *     write — the caller's baseline is stale.
   *  8. else: construct the prospective draft/history pair and validate it (Decision 12,
   *     check B) — an active/history ID collision the intended write would introduce ->
   *     `prospective_target_conflict`, no write, existing durable state unchanged.
   *  9. write `intendedRun`, read back. Exact match -> success, returns `intendedRun`.
   *     Failed or ambiguous read-back -> `write_outcome_unknown` (Decision 15) — never
   *     silently assumed to have succeeded or failed. */
  updateCurrentRun(
    expectedRunId: string,
    expectedBaselineCanonical: string,
    intendedRun: AssessmentRun
  ): Promise<AssessmentOutcome<AssessmentRun>>;
}

interface AssessmentHistoryRepository {
  loadHistoryState(): Promise<DomainLoadResult<AssessmentHistoryLoadResult>>; // read-only

  /** Idempotent unconditionally: an absent entry is already the postcondition this
   *  operation guarantees, so deleting an already-absent entry succeeds (Decision 15) —
   *  never surfaced as an error at this layer. UI-level "did this actually remove
   *  something the user was looking at" feedback is a UI concern using loadHistoryState
   *  before/after, not a repository-level error. */
  deleteHistoryEntry(runId: string): Promise<AssessmentOutcome<void>>;
}

// INTERNAL — context-bound (Decision 8), never exported outside the archive coordinator's
// own module boundary, never callable without a valid, already-lease-holding context.
interface AssessmentDraftMutationInternal {
  internalLoadCurrentRun(ctx: AssessmentMutationContext): Promise<AssessmentRun | undefined>;
  internalClearIfExactMatch(
    ctx: AssessmentMutationContext,
    expectedRunId: string,
    expectedCanonical: string // Decision 1.1 — canonical serialization, never a fingerprint
  ): Promise<AssessmentOutcome<void>>;
}
interface AssessmentHistoryMutationInternal {
  internalLoadHistoryState(ctx: AssessmentMutationContext): Promise<AssessmentHistoryPersistedState>;
  internalInsertTerminalRunIfAbsent(
    ctx: AssessmentMutationContext,
    run: AssessmentRun
  ): Promise<AssessmentOutcome<"inserted" | "already_present_identical" | "archive_conflict">>;
}
```

No single mutable object spans both domains. The only code touching both is the archive
coordinator (Decision 14), which uses only the internal, context-bound operations.

**How the UI receives results without a whole-state save effect.** Every public mutation
above returns the resulting authoritative value (or a typed error) directly; callers set
local React state from that **return value**, at the moment of the user action, never
reactively from a `useEffect` watching state for changes. **No whole-state
`saveDraftState`/`saveHistoryState` method exists.**

**Future cloud implementation, precisely scoped.** `AssessmentHistoryRepository`'s
operation-level interface is authority-neutral in shape; a future cloud-backed
implementation still needs its own, separately-designed network/offline/RLS concurrency
protocol (Decision 8.1) — this ADR claims only that the interface shape does not need to
change, never that the implementation is trivial.

### Caller transition

| Existing caller | Existing call | Target |
|---|---|---|
| `AssessScreen.tsx:472` | `setCurrentAssessmentRun` | `AssessmentDraftRepository.createCurrentRun` |
| `AssessScreen.tsx` (attempts, transitions) | in-memory mutation | `AssessmentDraftRepository.updateCurrentRun(expectedRunId, expectedBaselineCanonical, intendedRun)` — the caller applies its existing pure domain function to its observed baseline once, itself, before calling |
| `AssessScreen.tsx:332,429` | `archiveCurrentAssessmentRun` | `archiveCurrentTerminalAssessmentRun(expectedRunId)` (Decision 14) |
| `TrackerApp.tsx:2232` | `deleteAssessmentRunFromHistory` | `AssessmentHistoryRepository.deleteHistoryEntry` |
| `TrackerApp.tsx` hydration effect | single `assessmentRepository.loadState()` | `resolveAssessmentAuthorityLayout()` first, then both repositories' `load*State()` |
| `TrackerApp.tsx` save effect | single `assessmentRepository.saveState()` | **removed** — no whole-state save effect exists |
| `AssessmentAnalyze.tsx`, `AssessmentResultScreen.tsx`, `AssessmentLanding.tsx` | read props | prop types change; no new repository dependency |

Repository instances are constructed only after `resolveAssessmentAuthorityLayout()`
resolves — **writable** repositories only under `split_local, disposition: writable`;
**read-only** repositories (no mutation methods exposed at all) under
`read_only_pending_reconciliation` (Decision 13); the existing legacy `AssessmentRepository`
under `legacy_combined_local`, itself now routed through the unified runner.

---

## 10. Strict, information-preserving legacy eligibility

**Corrected in this revision** in several places: the root's exact field set, `history`'s
required-array rule, `currentRun: null`'s explicit handling, unexpected-field detection at
every level of an `AssessmentRun`, and — most substantively — duplicate history IDs are now
**always** ineligible, never deduplicated.

### The eligibility boundary

| # | Legacy source condition | Eligibility outcome |
|---|---|---|
| 1 | Absent | Not migration — fresh-initialization territory (Decision 4.1) |
| 2 | Present, `JSON.parse` throws | **Ineligible**: `invalid_legacy_json` — never treated as absent, never routed to fresh-initialization; the raw value is left untouched |
| 3 | Parses, root is not a plain object | **Ineligible**: `invalid_legacy_root` |
| 4 | Object root — **exact recognized field set is `{schemaVersion, currentRun, history}`, `currentRun` optional, `schemaVersion` and `history` both required** | See rows 5-9 for each field's own check |
| 5 | Any own field on the root **outside** `{schemaVersion, currentRun, history}` | **Ineligible**: `unexpected_root_field` — checked independently of, and never gated behind, the `schemaVersion` check below; an extra field alongside a perfectly valid `schemaVersion: 1` is still ineligible |
| 6 | `schemaVersion !== ASSESSMENT_PERSISTENCE_SCHEMA_VERSION` (missing, wrong type, or an unrecognized value) | **Ineligible**: `unknown_legacy_schema` |
| 7 | `history` field missing, `null`, or present but not an array | **Ineligible**: `invalid_history_field` — **never defaulted to `[]`**; a missing/null/non-array `history` is a shape violation for the purpose of an authority transition, even though ordinary runtime hydration's own `Array.isArray(raw.history) ? raw.history : []` default remains unchanged for that separate, already-shipped concern |
| 8 | `currentRun` is `null` | **Ineligible**: `invalid_current_run` — an explicit, stated rule: `null` is not treated as absence (only a genuinely-omitted key is absence); `null` is not a valid `AssessmentRun`, so it fails run validation |
| 9 | `currentRun` present (non-`null`) but fails the strict `AssessmentRun` check below | **Ineligible**: `invalid_current_run` |
| 10 | A `history` entry is not itself terminal | **Ineligible**: `non_terminal_history_entry` |
| 11 | A `history` entry fails the strict `AssessmentRun` check below | **Ineligible**: `invalid_history_entry` |
| 12 | **Any** two `history` entries share an `id`, identical or different content | **Always ineligible**: `duplicate_history_id_conflict` — see the correction below; never deduplicated |
| 13 | `currentRun` (terminal) and a `history` entry share an `id`, different content | **Ineligible**: `current_history_id_conflict` |
| 13a | `currentRun` (terminal) and a `history` entry share an `id`, identical content | **Eligible for this check** — recognized pending-clear shape (Decision 1.2) |
| 14 | `currentRun` (non-terminal/active) shares an `id` with any `history` entry | **Ineligible**: `active_current_run_id_collides_with_history` |
| 15 | Storage read of the legacy key fails | Not ineligibility — resolver-level `blocked: storage_unavailable` (Decision 7), independent of content |

### The strict `AssessmentRun` check — exact raw-to-canonical structural equality

**Corrected in this revision.** A prior revision's check only verified that the raw
object's own keys were a subset of the known field names ("own-key-set containment"). That
does **not** prove value preservation: `validatePersistedAssessmentRun` (unchanged) may
still, for an input using only known keys, add a missing optional field, apply a default,
normalize a value, drop an invalid optional sub-value, or otherwise reconstruct a value
that differs from what was actually present in the raw input — key-set containment alone
cannot detect any of that. This revision replaces it with an exact structural comparison
between the raw parsed value and the validator's own canonical reconstruction.

**Corrected in this revision.** The prior version of this comparator was not total for
every input it claimed to handle: cycle tracking existed only in the object branch, not
the array branch, so a self-referential array could recurse forever; `Object.is(x, y)`
ran *before* any cycle/structure validation, so the exact same cyclic object passed as
both arguments returned `true` immediately — the wrong answer, since a cyclic value is
never a valid JSON tree and must be rejected regardless of reference identity; array
comparison checked only length and indexed reads, missing sparse arrays, accessor-backed
indices, symbol keys, extra named properties, and exotic array prototypes; and the
visited-pair bookkeeping conflated "currently mid-comparison" (an active cycle) with
"already fully compared" (a safe, provably-equal shared subgraph) into one boolean
presence check. This revision replaces the whole comparator with one that tracks explicit
per-pair state and never lets reference identity bypass structural validation for
object-typed values.

**Corrected further in this revision.** The comparator that fixed the defects above still
had two remaining problems in its array handling: after descriptor-gating each index, it
read the comparison values back via **live** `array.length` and `array[i]` — for an Array
Proxy that permits `getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor` but throws from
its `get` trap, those live reads still invoked user-controlled code the surrounding prose
claimed was never invoked. Separately, its "expected keys" set was built by looping from
`0` to the array's own claimed `length` **before** density had been established, so a
hostile array reporting a huge `length` with only a few real indices forced work
proportional to that claimed length merely to discover it was sparse. Both are corrected
below: every array value, including `length` itself, is read exclusively from an
already-obtained property descriptor, and density is proven by comparing the count of
valid in-range index keys (bounded by the array's *real* own-key count) against the
descriptor-derived length — never by iterating the claimed length up front.

```typescript
type PairState = "visiting" | "completed";

function exactStructurallyEqual(a: unknown, b: unknown): boolean {
  // One (x -> (y -> state)) map, scoped to this single top-level call — never shared
  // across calls, so no state leaks between independent comparisons.
  const pairState = new WeakMap<object, WeakMap<object, PairState>>();

  function isAcceptablePrimitive(v: unknown): boolean {
    // Accept exactly: null, string, boolean, finite number.
    // Reject: undefined, bigint, symbol, function, NaN, Infinity, -Infinity.
    if (v === null) return true;
    const t = typeof v;
    if (t === "string" || t === "boolean") return true;
    if (t === "number") return Number.isFinite(v as number);
    return false;
  }

  function equal(x: unknown, y: unknown): boolean {
    const xIsObj = typeof x === "object" && x !== null;
    const yIsObj = typeof y === "object" && y !== null;
    if (!xIsObj && !yIsObj) {
      // Neither side is an object — the only case where a fast primitive comparison is
      // used. Both sides must independently be an acceptable primitive type; reference
      // identity (Object.is) is applied only to compare their VALUES, never to bypass
      // the type check, and never reached for object-typed values (see below).
      if (!isAcceptablePrimitive(x) || !isAcceptablePrimitive(y)) return false;
      return Object.is(x, y);
    }
    if (xIsObj !== yIsObj) return false; // one object, one primitive: never equal

    // Both are non-null objects/arrays. Object identity is NEVER used as a shortcut here
    // — not even when x === y — because the exact same cyclic object passed as both
    // arguments must still be rejected as an invalid (non-JSON-representable) tree, not
    // trivially accepted. The pair-state map below is what actually distinguishes a
    // genuine cycle from a legitimately-shared, already-proven-equal acyclic subgraph.
    const xo = x as object, yo = y as object;
    let inner = pairState.get(xo);
    const state = inner?.get(yo);
    if (state === "completed") return true;  // a previously fully-verified equal pair —
                                              // reused, not re-traversed (shared subgraph)
    if (state === "visiting") return false;  // this exact pair is already on the active
                                              // path being compared — a cycle
    if (!inner) { inner = new WeakMap<object, PairState>(); pairState.set(xo, inner); }
    inner.set(yo, "visiting"); // marked BEFORE descending into either array or object
                                // descendants — uniformly, for both branches below

    const xArray = Array.isArray(x), yArray = Array.isArray(y);
    if (xArray !== yArray) return false;
    const ok = xArray ? compareArrays(x as unknown[], y as unknown[]) : compareObjects(xo, yo);
    if (ok) pairState.get(xo)!.set(yo, "completed");
    // If `ok` is false, the "visiting" marker is simply never consulted again — the
    // caller unwinds and the overall result is false regardless.
    return ok;
  }

  // Maximum valid JS array length (2^32 - 1); the highest valid index is one less.
  const MAX_ARRAY_LENGTH = 4294967295;
  const CANONICAL_INDEX = /^(0|[1-9][0-9]*)$/; // decimal, no leading zeros except "0"

  /**
   * Descriptor-only array inspection — corrected in this revision. A prior revision read
   * `array.length` and `array[i]` as LIVE property accesses after its own descriptor-gated
   * checks had already run, which — for an Array Proxy whose `get` trap throws while its
   * `getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor` traps do not — still invoked
   * user-controlled code the surrounding prose claimed was never invoked. It also built its
   * "expected keys" set by looping from 0 to the UNTRUSTED `length` value before proving
   * the array was dense, so a hostile array reporting an enormous `length` with only a
   * handful of real indices forced work proportional to that claimed length just to
   * discover it was sparse.
   *
   * This version reads `length`'s value only from its own property descriptor, derives
   * every index value the same way, and proves density by comparing counts — the number
   * of valid, in-range index keys against the descriptor-derived length — rather than by
   * iterating 0..length up front. `Reflect.ownKeys` is bounded by the array's REAL own
   * property count, never by its claimed length, so a huge-`length`/few-real-indices
   * hostile array is rejected in time proportional to its real key count, not to `length`.
   * No live `arr.length` or `arr[i]` read of this input array ever occurs — every value
   * returned in `values` is copied once from a validated descriptor into this function's
   * own freshly-allocated array, which callers may then read normally (ordinary indexing
   * is not a live read of the original `arr`).
   */
  function inspectArray(arr: object): { length: number; values: unknown[] } | null {
    const proto = Object.getPrototypeOf(arr); // reflection, not a live data read; may throw
                                                // for a hostile Proxy — caught by the
                                                // single outer boundary below
    if (proto !== Array.prototype) return null;

    const lengthDesc = Object.getOwnPropertyDescriptor(arr, "length");
    if (!lengthDesc || !("value" in lengthDesc)) return null; // "length" must be a plain
      // data property — its value is read only from this descriptor, never as `arr.length`
    const length = lengthDesc.value;
    if (
      typeof length !== "number" ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > MAX_ARRAY_LENGTH
    ) {
      return null; // not a valid JS array-length integer
    }

    const ownKeys = Reflect.ownKeys(arr); // one call; every subsequent check is bounded by
                                            // this real key count, never by `length`
    if (ownKeys.some((k) => typeof k === "symbol")) return null; // no symbol keys

    let sawLengthKey = false;
    const indexEntries: Array<{ index: number; key: string }> = [];
    for (const k of ownKeys) {
      if (k === "length") { sawLengthKey = true; continue; }
      const key = k as string;
      if (!CANONICAL_INDEX.test(key)) return null; // not a canonical array-index string
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length) return null;
      indexEntries.push({ index, key });
    }
    if (!sawLengthKey) return null; // "length" itself must be an own key
    // Own keys are unique, and every accepted index is already proven to lie in
    // [0, length). If the count of such indices equals `length`, every index in that
    // range is present exactly once — this proves density without ever iterating
    // 0..length to probe for gaps.
    if (indexEntries.length !== length) return null;

    const values = new Array<unknown>(length);
    for (const { index, key } of indexEntries) {
      const desc = Object.getOwnPropertyDescriptor(arr, key);
      // A hole is already excluded by construction (the key came from ownKeys, so a
      // descriptor must exist) — the enumerable/data-property check still rejects an
      // accessor-backed or non-enumerable index. `.value` is read only from this
      // descriptor, never via `arr[index]`.
      if (!desc || !("value" in desc) || !desc.enumerable) return null;
      values[index] = desc.value;
    }
    return { length, values };
  }

  function compareArrays(x: unknown[], y: unknown[]): boolean {
    const xInfo = inspectArray(x);
    if (!xInfo) return false;
    const yInfo = inspectArray(y);
    if (!yInfo) return false;
    if (xInfo.length !== yInfo.length) return false; // exact equal length required
    for (let i = 0; i < xInfo.length; i++) {
      // Ordinary indexing into the trusted `values` arrays `inspectArray` already
      // produced — never a live read of the original `x`/`y` input arrays themselves.
      if (!equal(xInfo.values[i], yInfo.values[i])) return false; // order matters
    }
    return true;
  }

  /**
   * Descriptor-snapshot object inspection — corrected in this revision to follow the
   * exact same single-snapshot discipline `inspectArray` already uses, instead of
   * combining `Reflect.ownKeys`, a separate `Object.keys` call, and a later, independent
   * round of descriptor reads. This was never a live-read safety defect (the prior version
   * never touched `object[key]`), but it performed multiple independently-trapped
   * enumeration passes where one snapshot suffices, and it did not read `Object.keys`'
   * own count from the same reflection pass as the symbol/non-enumerable check.
   */
  function inspectPlainObject(obj: object): Map<string, unknown> | null {
    const proto = Object.getPrototypeOf(obj); // reflection, not a live data read
    if (proto !== Object.prototype && proto !== null) return null; // rejects Map, Set,
      // Date, RegExp, typed arrays, and class instances — real JSON.parse output is always
      // a plain object or null-prototype object, never any of these

    const ownKeys = Reflect.ownKeys(obj); // one call
    if (ownKeys.some((k) => typeof k === "symbol")) return null; // no symbol keys

    const snapshot = new Map<string, unknown>();
    for (const key of ownKeys as string[]) {
      const desc = Object.getOwnPropertyDescriptor(obj, key); // reflection, not a live read
      // Reject a missing descriptor (should not occur for an own key just enumerated, but
      // checked defensively for a hostile Proxy), an accessor (no "value"), and a
      // non-enumerable property — `.value` is read only from this descriptor, never via
      // `obj[key]` or `obj.key`.
      if (!desc || !desc.enumerable || !("value" in desc)) return null;
      snapshot.set(key, desc.value);
    }
    return snapshot;
  }

  function compareObjects(x: object, y: object): boolean {
    const xSnap = inspectPlainObject(x);
    if (!xSnap) return false;
    const ySnap = inspectPlainObject(y);
    if (!ySnap) return false;
    if (xSnap.size !== ySnap.size) return false; // no extra, no missing fields
    for (const key of xSnap.keys()) if (!ySnap.has(key)) return false; // exact key-set
                                                    // equality; insertion order irrelevant
    for (const key of xSnap.keys()) {
      // Compares descriptor-derived values retained in the trusted snapshots — never a
      // live read of either original object.
      if (!equal(xSnap.get(key), ySnap.get(key))) return false;
    }
    return true;
  }

  try {
    return equal(a, b);
  } catch {
    // Any reflection failure (a hostile Proxy trap throwing on getPrototypeOf/ownKeys/
    // getOwnPropertyDescriptor) — and, incidentally, a RangeError from pathologically deep
    // acyclic nesting, since the recursive calls above are not individually wrapped and a
    // stack-overflow exception unwinds through them into this one boundary — resolves to a
    // fixed `false`, never a thrown exception escaping this function.
    return false;
  }
}
```

**Precise claim, corrected in this revision.** A prior revision said this comparator
"never invokes a getter/trap." That overstated things: **reflection necessarily invokes
the corresponding reflection trap** — `Object.getPrototypeOf`, `Reflect.ownKeys`, and
`Object.getOwnPropertyDescriptor` are themselves trapped operations on a Proxy, and calling
them does invoke whichever trap the Proxy defines for them. The comparator does not, and
cannot, avoid that — nor does it need to: those three reflection operations are how this
comparator inspects a value's shape at all, and any of them throwing (a hostile Proxy trap)
is caught by the single `try`/`catch` boundary below and resolves to `false`, never
propagating. **The precise, accurate claim — corrected in this revision to state the exact
boundary, not a blanket "no live access" — is exactly this:** no property value is ever
read live from **either original, user-supplied input operand** (`x` or `y` as passed into
`exactStructurallyEqual`, and their own nested descendants) — not via `input.field`,
`input[key]`, `input[index]`, or `input.length` on either original operand, and never
through a **user-defined accessor getter** attached to either original operand. Every value
belonging to an original operand (including that operand's own `length`, and every one of
its array index values) is read exactly once, exclusively from an already-obtained property
descriptor's `.value` field on *that operand* — and only after that descriptor has been
confirmed to be a plain, enumerable data property (never one with a `get`/`set` accessor
pair) — then copied into a trusted internal snapshot (`inspectArray`'s `values` array,
`inspectPlainObject`'s snapshot map). **This does not mean the comparator never performs an
ordinary property/array read at all** — it reads its own trusted snapshots normally
(`xInfo.values[i]`, `xSnap.get(key)`, and similar), because a snapshot is the comparator's
own local data, built once from already-validated descriptor values, not a second read of
the hostile input. Reading a trusted internal snapshot is not a live read of the original
input. `exactStructurallyEqual` never calls
`JSON.stringify` on either argument, and never recurses unboundedly on a cyclic input: the
explicit `visiting`/`completed`
per-pair state (not a presence-only check) is set **before** descending into either an
array's or an object's own descendants — applied **uniformly to both**, closing the prior
revision's array-branch gap — and is consulted on every subsequent encounter of that exact
`(x, y)` pair, so a genuine cycle (revisiting a pair still marked `visiting`) is
distinguished from a legitimately-shared, already-fully-verified acyclic subgraph
(revisiting a pair marked `completed`, safely reused without re-traversal). **Object
identity is never used as a shortcut for object-typed values, even when `x === y`** — the
exact same cyclic object passed as both arguments is still routed through this same
pair-state tracking and rejected as a cycle, not accepted via reference equality. **Object
property order is not semantically relevant** to this comparison (two objects with the
same key set in different insertion order are equal); **array order is relevant** (two
arrays with the same elements in a different order are not equal, and array comparison
additionally rejects sparse arrays, accessor-backed indices, symbol keys, extra named
properties, and non-`Array.prototype` exotic prototypes, all descriptor-gated the same way
object properties are).

For every raw `currentRun`/`history` entry:

1. Run today's existing `validatePersistedAssessmentRun` (unchanged) to get a **candidate**
   canonical value, or reject outright (`invalid_current_run`/`invalid_history_entry`) if
   it fails any of its existing checks.
2. **Compare the raw parsed value against that canonical value with
   `exactStructurallyEqual`.** If they are exactly equal: eligible, use the canonical
   value. If they differ **in any way** — an added default, a normalized value, a dropped
   invalid optional sub-value, a reordered array, an extra field, a missing field, a
   type-coerced value, a nested difference at any depth — the source is **ineligible**:
   `legacy_requires_repair`. Migration does not run; the raw legacy value is left
   completely untouched; `legacy_combined_local` continues to serve the domain via the
   existing, unmodified, permissive hydration (which is exactly what would have performed
   that repair/normalization anyway, unaffected by this ADR).
3. **This single raw-vs-canonical comparison applies recursively to the entire run
   automatically** — because `exactStructurallyEqual` walks the whole object graph itself,
   there is no separate, manually-enumerated list of nested field names
   (`templateSnapshot`, `thresholdSnapshot`, `timingProviderSnapshot`, `attempts`,
   `protocolDeviations`, `interruption`, or any field nested inside those) to keep in sync
   with the validator's own schema as a second, driftable copy. A prior revision's own
   own-key-containment approach needed exactly such a second copy (an explicit statement
   of every nested type's known-field set) — the exact-equality comparator makes that
   redundant, and the earlier claim that own-key containment alone "proves no information
   loss" is withdrawn: it does not, for the reasons given above.

"Value-preserving" now means exactly this: an eligible source's raw parsed value and its
canonical reconstruction are **exactly structurally equal**, at every depth, with no
repair, normalization, default, or reordering (of arrays) between them — anything less
makes the whole migration refuse to run rather than silently accept a repaired value.

**The same principle — raw-vs-canonical exact structural equality via
`exactStructurallyEqual`, not own-key containment — applies to:**

- **Legacy root eligibility** (the table above): the raw parsed root object is compared
  against its own candidate canonical `{schemaVersion, currentRun?, history}` reconstruction
  (built from the already-individually-validated `currentRun`/`history` values) — any
  difference (an extra root field, a `history` default, etc.) is `legacy_requires_repair`
  or the more specific reason rows 2-9 already name where one applies more precisely (e.g.
  malformed JSON is still `invalid_legacy_json`, a non-object root is still
  `invalid_legacy_root` — `legacy_requires_repair` is reserved for the case where the root
  parses as a plausible object and reconstructs successfully but differs structurally from
  its own canonical form).
- **Draft target validation and history target validation** (Decision 12): the same
  `exactStructurallyEqual` check against each domain's own canonical reconstruction is what
  "passes the strict `AssessmentRun` check" and "exact allowed root fields" already meant
  in Decision 12 — this correction sharpens what that check actually proves, without
  changing which values Decision 12 validates.

An accepted value, in every one of these places, must be **exactly representable** by the
supported canonical schema — never repaired, normalized, or partially accepted.

### Duplicate history IDs — corrected: always ineligible, never deduplicated

**Corrected in this revision.** A prior revision called deduplicating two
content-identical duplicate history entries "lossless." That is wrong: **multiplicity and
array position are themselves information** — a persisted array with two identical entries
at positions 3 and 7 is a different persisted value than one with a single entry, and the
target invariant (`assessmentHistory` permits exactly one entry per `id`) cannot be
satisfied without discarding that information. **Any duplicate `id` in `history` — content
identical or not — makes the whole legacy value ineligible** (`duplicate_history_id_conflict`).
Migration refuses to run; the raw legacy value is left completely untouched;
`legacy_combined_local` continues to serve the domain exactly as today (the existing
runtime's own first-wins behavior, unaffected by this ADR).

A direct, useful consequence: **history order and multiplicity are preserved for every
eligible source, vacuously** — since eligibility itself now guarantees no duplicate `id`
exists, there is nothing to preserve *across* duplicates for an eligible source; the earlier
"order/multiplicity preservation" claim is simplified to this trivial, always-true form
rather than a claim requiring its own separate proof.

### Ineligible ≠ blocked (unchanged reasoning, restated briefly)

Every ineligibility reason above refuses the **migration**, never the whole feature — for
every one of these conditions, the already-shipped, unmodified legacy
`AssessmentRepository` already handles the same legacy content safely today (silently
treating malformed JSON as absent, quarantining an invalid run, deduplicating by
first-wins), so falling back to `legacy_combined_local` changes nothing about the user's
actual experience. The two genuine exceptions remain: a storage read failure (no safe
fallback can be confirmed) and unexplained stray target data with no legacy value to fall
back to (Decision 7) — both resolve a true resolver-level `blocked`.

---

## 11. Relationship to cloud adoption (ADR-0019/ADR-0020)

Only `assessmentHistory` may ever be registered for cloud adoption; `assessmentDraft` is
permanently excluded. **This ADR resolves ADR-0020 Decision D in full** — never again
"blocked by Decision D." Cloud adoption of `assessmentHistory` remains blocked by: this
ADR's own implementation not yet performed; ADR-0020 Decision E.2b/E.2c; the account
deletion/anonymization policy; ADR-0019's old-build/local-branch limitation; and this ADR's
own production-deployment gate (Decision 8.1) — none of which this ADR resolves or makes
progress toward.

### 11.1 Relationship to ADR-0016 and IndexedDB, and target key/domain cardinality

ADR-0016's registry (`MIGRATION_DOMAINS`) currently registers `assessment` as one domain
with one source key (`sourceKeys: [ASSESSMENT_STORAGE_KEY]`). This ADR does not modify
ADR-0016 or that registry in this commit. Target future relationship:

- The existing `assessment` marker (`migration:local-storage-to-indexeddb:v1:assessment`)
  remains historical evidence for the legacy combined key **only** — never reinterpreted as
  proving anything about `assessmentDraft` or `assessmentHistory`.
- Future implementation must register **two separate** migration units, `assessmentDraft`
  (`sourceKeys: [ASSESSMENT_DRAFT_STORAGE_KEY]`) and `assessmentHistory`
  (`sourceKeys: [ASSESSMENT_HISTORY_STORAGE_KEY]`), each with its own marker key following
  the existing `buildMigrationMarkerKey(domain)` convention — names that cannot collide
  with the legacy `...:assessment` marker.
- Because IndexedDB has never been activated, `localStorage` remains the sole source of
  truth for this ADR's structural split — nothing here depends on IndexedDB's activation
  status.

**Target key/domain cardinality.** Three separate things, never totaled into one
unqualified number:

- **Authoritative domain-data keys** — data an application repository actually reads as
  its domain's content.
- **Retained legacy residue** — the old combined key, preserved but inert (Decision 3).
- **Protocol metadata** — the split-layout evidence key (Decision 4), never application
  data, exactly analogous to how ADR-0016's own per-domain markers are protocol metadata
  and were never counted among the original 7 domains/10 keys either.

| Count | Value | Scope |
|---|---|---|
| Current runtime domain inventory (unaffected by this ADR) | 7 domains, 10 domain-data keys | Whole app, per ADR-0013 |
| Target after implementation (authoritative domain-data only) | **8 domains, 11 domain-data keys** | Whole app — the single `assessment` domain/key becomes two |
| Additional, uncounted-above, transitional-to-permanent | +1 key: the retained legacy residue (Decision 3), until a future cleanup decision | Assessment only |
| Additional, uncounted-above, permanent | +1 key: the split-layout evidence key (Decision 4) | Assessment only |

**Never state a single total "physical key count"** that folds residue and evidence into
the 11-key authoritative figure, or that claims to be the app's complete physical
`localStorage` footprint — this ADR's counts are scoped to Assessment's own authoritative
domain-data inventory plus its own two additional, explicitly-named metadata/residue keys,
nothing broader. (ADR-0016's IndexedDB `metadata`-store markers are a separate storage
backend entirely and are never part of any `localStorage` key count in this ADR or in
ADR-0013's inventory.)

---

## 12. Committed target validation — pair-aware, not merely per-key

**New/corrected in this revision** — a prior revision validated each committed target key
independently but never checked their relationship to each other, missing exactly the
cross-target ID-collision hazard Decision 1.2 already names.

### Per-key validators

- **Draft target:** exact allowed root fields `{schemaVersion, currentRun}`; exact
  `schemaVersion`; `currentRun` optional (omitted key = absent, never `null`), and, if
  present, passes the strict `AssessmentRun` check (Decision 10) — no silent normalization.
- **History target:** exact root fields `{schemaVersion, history}`; exact `schemaVersion`;
  `history` required, array-valued; every entry passes the strict `AssessmentRun` check and
  is terminal; **no duplicate IDs** (this is now always true by construction for a
  post-split-commit history, per Decision 1's invariant, but is still actively re-checked
  here, not merely assumed).

### Cross-target pair validator

- Active (non-terminal) draft `currentRun`'s `id` colliding with any history entry's `id`
  → **`committed_target_conflict`**.
- Terminal draft `currentRun` + a history entry sharing its `id`, canonically identical
  (Decision 1.1) → recognized **valid pending-clear state** (the ordinary "archived, draft
  not yet cleared" shape — reachable any time an ordinary archive is interrupted between
  its history write and its draft clear, Decision 14).
- Terminal draft `currentRun` + a history entry sharing its `id`, canonically different →
  **`committed_target_conflict`**.

### When the pair validator runs — three distinct checks, never only after the write

**Corrected in this revision.** A prior revision stated only that the pair check runs
"after any mutation whose result could introduce a conflict" — that alone is too late: an
invalid pair could already be durable by the time it is checked. This revision defines
three distinct checks, at three distinct moments, none of which substitutes for another:

**A. Existing-state check.** Part of the unified mutation runner's single, exactly-once
authority/precondition check (Decision 8), before anything else: load the current
draft/history, validate their current individual and pair state, and **refuse the mutation
outright** if it is already invalid — never proceed to attempt a write on top of an
already-broken pair.

**B. Prospective-state check — before the first write, not after.** Having passed check A,
each mutation constructs the **exact prospective** draft/history pair its own intended
write would produce — applying the deterministic operation (Decision 15's `intendedRun`,
an insertion, a deletion) **in memory only** — and validates that prospective pair with the
same validator. **If invalid, the mutation returns `prospective_target_conflict` —
exclusively this code, never `committed_target_conflict`, since nothing has been written
yet and the existing durable state remains exactly as valid as it was before the call** —
and **performs no write at all**. This is not a repeat of the authority check (A) — it is
mutation-*result* validation, checking a value that does not exist yet, precisely so that
an invalid pair is never durable in the first place.

**C. Immediate read-back check — after writing.** Read back the just-written state and
validate the exact intended content and the pair invariant together.
- If the write may have occurred but confirmation **fails or is ambiguous** (a read error,
  an inconclusive adapter result): `write_outcome_unknown` (Decision 15) — never assumed to
  be a definite failure, and never `committed_target_conflict`, since nothing has been
  *confirmed* invalid, only left uncertain.
- If confirmation **succeeds and definitively shows** the now-durable pair is invalid (an
  implementation bug slipping an invalid value past check B, or a write racing something
  outside this protocol): `committed_target_conflict` — this is the one case where check C
  itself, not startup, is the moment invalid durable state is first proven to exist.

**Startup resolution (Decision 7, C3) is the backstop, not the primary defense** — it still
classifies any genuinely invalid durable pair fail-closed
(`committed_target_missing`/`committed_target_invalid`/`committed_target_conflict`),
covering the case where all three checks above were somehow bypassed entirely (a bug, or
data written outside this protocol) — a pre-existing conflict discovered there is a
genuine, durable block, exactly as before.

**One exact taxonomy, no implementation choice:** `committed_target_conflict` is used
**only** when invalid state is **already durable** — discovered at startup, by check A
against pre-existing stored data, or by check C definitively confirming a just-written
durable value is invalid. `prospective_target_conflict` is used **only** when check B
proves an *intended, not-yet-written* value would be invalid — no write occurs, and
existing durable state is untouched. `write_outcome_unknown` is used whenever a write may
have occurred but read-back cannot determine the durable result. These three are never
interchangeable and never left to implementation discretion.

**Applied to every operation that could touch this invariant:** `createCurrentRun` and
`updateCurrentRun` (checks A, B, C — B specifically checks the intended run's `id` against
existing history entries before writing), the archive coordinator's history insertion and
draft clear (checks A, B, C — B checks the prospective post-clear draft/post-insert history
pair before either write), and `deleteHistoryEntry` — **corrected in this revision: A, B,
and C, not "A and C only."** A prior revision said history deletion used only checks A and
C, on the reasoning that a deletion cannot introduce an ID collision — true, but that
reasoning describes what check B *cannot find*, not whether check B *runs*. Deletion still
constructs the exact prospective post-deletion `history` array and validates it (check B)
before writing — this cannot detect an ID collision (deletion only ever removes an entry,
never adds one), but it still catches an invalid prospective serialization or an
implementation error in the removal logic itself, before that value is ever written. A
check-B failure here returns exactly `prospective_target_conflict` — the same one
mandatory code check B always returns; there is no implementation-selected
alternative — never a write.

**Never compared against initial establishment fingerprints (Decision 6)** — every one of
A/B/C is ordinary, current-content schema/domain/pair validation, applied either to
already-stored content (A, C) or to a not-yet-written prospective value (B).

---

## 13. Explicit write disposition — never a plain boolean

**Corrected in this revision.** A prior revision's `branchDetected: boolean` on `split_local`
let a caller trivially ignore it and treat the domain as ordinarily writable. This revision
makes the disposition an explicit, structurally-unavoidable discriminated value:

```typescript
type AssessmentSplitDisposition =
  | { kind: "writable" }
  | {
      kind: "read_only_pending_reconciliation";
      reason: "legacy_branch_detected" | "legacy_residue_missing" | "branch_detection_unavailable";
    };
```

**Requirements, all satisfied structurally:**

- Authority remains `split_local` either way — the split data itself is not considered
  wrong or unauthoritative; only its *write* eligibility differs.
- **Reads remain available** under `read_only_pending_reconciliation` — the target data
  passed schema/domain/pair validation (Decision 12); only the relationship to the legacy
  residue (or the ability to confirm it) is unresolved.
- **No write-capable mutation path is ever constructed** while the disposition is
  `read_only_pending_reconciliation` — repository construction (Decision 9) reflects this
  directly: under this disposition, the app constructs **read-only** repository instances
  exposing only `loadDraftState`/`loadHistoryState`, with no `createCurrentRun`/
  `updateCurrentRun`/`deleteHistoryEntry`/archive-coordinator access exposed at all — there
  is structurally no mutation method a caller could call, not merely a runtime check a
  caller could forget to consult.
- If a stale, already-constructed writable-repository reference somehow attempts a write
  anyway (e.g., a bfcache-restored writable instance from before a disposition changed):
  the unified mutation runner's own authority check (Decision 8) independently re-derives
  the current disposition and refuses with `write_refused_read_only` regardless of which
  interface the caller held.

This same disposition mechanism is what Decision 4.0.2 (`branch_detection_unavailable`) and
Decision 7 (`legacy_residue_missing`) hook into — all three reasons resolve to the identical
`read_only_pending_reconciliation` shape, so a caller handling this disposition correctly
once handles every one of its causes correctly.

---

## 14. Archive-and-clear — exact equality, single lease entry, retry-convergent

**Corrected in this revision** in three ways: run equality now uses canonical serialization
(Decision 1.1), the coordinator enters the unified mutation runner exactly once and calls
only context-bound internal operations (Decision 8 — eliminating the deadlock risk), and
`expectedRunId` is now **required**, with a distinct `already_archived` outcome so a retry
after a fully-successful-but-response-lost archive converges to success instead of
incorrectly reporting `no_current_run`.

```typescript
function archiveCurrentTerminalAssessmentRun(
  expectedRunId: string
): Promise<AssessmentOutcome<AssessmentArchiveOutcome>>

type AssessmentArchiveOutcome =
  | { outcome: "archived"; draftCleared: boolean } // draftCleared false only in the
                                                     // defensive re-check edge case below
  | { outcome: "already_archived" }                 // retry after full prior success
  | { outcome: "no_current_run" }
  | { outcome: "run_id_mismatch" }
  | { outcome: "archive_conflict" };
```

### Steps — one entry into `runAssessmentMutation`, only internal operations thereafter

1. Enter the unified mutation runner once.
2. Re-check authority/disposition (Decision 8) — abort with `authority_changed` /
   `write_refused_read_only` if it no longer holds.
3. `internalLoadCurrentRun(ctx)` and `internalLoadHistoryState(ctx)` — both authoritative,
   both freshly read inside this one held lease.
4. **If no `currentRun`:**
   - History already contains `expectedRunId` → `{ outcome: "already_archived" }` (no
     write) — the retry-convergence fix.
   - History lacks it → `{ outcome: "no_current_run" }`.
5. **If `currentRun.id !== expectedRunId`:** `{ outcome: "run_id_mismatch" }`, draft
   untouched.
6. **If `currentRun` is not terminal:** `run_not_completable`, draft untouched.
7. Compute `draftCanonical = serializeCanonicalAssessmentRun(currentRun)` (Decision 1.1).
8. **If `expectedRunId` already exists in history:**
   - `serializeCanonicalAssessmentRun(historyEntry) === draftCanonical` → proceed to step
     10 (idempotent — history already durably correct).
   - Otherwise → `{ outcome: "archive_conflict" }`, draft and history both left untouched.
9. **Else:** `internalInsertTerminalRunIfAbsent(ctx, currentRun)` — write, then read back.
   **Corrected in this revision — three distinct outcomes, not two conflated ones, and
   qualified by the adapter-guarantee rule (below):**
   - The adapter's write call fails in a way its own contract **positively guarantees**
     means no write took effect: `history_unavailable` — history is definitely not durable;
     draft retained; retry-safe.
   - The write call reports success **and** read-back confirms the exact intended content:
     proceed to step 10.
   - Any other outcome — the write reports success but read-back fails or does not match,
     **or the adapter's failure signal does not itself guarantee no write occurred**: the
     underlying state is genuinely unknown — `write_outcome_unknown` (Decision 15); draft
     retained either way. **Never classify this case as a definite write failure** — history
     may already be durably correct.
10. **Defensive re-check** (still inside the one held lease — with the unified runner
    serializing every Assessment mutation, nothing else could have changed the draft since
    step 3 in practice; retained anyway in case a future refactor ever narrows the runner's
    scope): re-read the draft via `internalLoadCurrentRun(ctx)`; if it no longer matches
    `expectedRunId`/`draftCanonical` exactly → `{ outcome: "archived", draftCleared: false }`
    — not an error; history is durable either way.
11. `internalClearIfExactMatch(ctx, expectedRunId, draftCanonical)` — clears `currentRun`,
    then reads back. **Corrected in this revision, the same way and under the same
    adapter-guarantee rule as step 9:**
    - The adapter's clear call fails in a way its own contract **positively guarantees**
      means the clear never took effect: `draft_clear_failed` — history remains durable
      (from step 8 or 9); retry-safe (a later call finds history already holding a
      canonically-matching entry via step 8's idempotent path and simply retries the clear).
    - The clear call reports success and read-back confirms: proceed to step 12.
    - Any other outcome — success reported but read-back fails or does not match, or the
      adapter's failure signal does not itself guarantee the clear never took effect: the
      underlying state is genuinely unknown — `write_outcome_unknown`; history remains
      durable either way; **never classified as a definite `draft_clear_failed`**.
12. Exit the runner. `{ outcome: "archived", draftCleared: true }`.

**Idempotency, including the retry-after-full-success case:** calling this again for the
same `expectedRunId` after full prior success — step 4 now correctly recognizes "no
current run, but history already has it" as `already_archived`, not an error.

### Recovery from `write_outcome_unknown` (Decision 15's general rule, applied here exactly)

The caller reloads the authoritative draft and history state, then classifies deterministically:

| Reloaded state | Recovery action |
|---|---|
| No `currentRun`, and `expectedRunId` is present in history | `already_archived` — the earlier attempt fully landed |
| An exact terminal `currentRun` matching `expectedRunId`, and history already holds a canonically-identical entry for it | Retry **only the clear path** (re-invoke with the same `expectedRunId` — steps 8's idempotent branch and 10-12 will run; step 9 is never re-attempted, since history is already confirmed correct) |
| An exact terminal `currentRun` matching `expectedRunId`, and history does **not** yet hold it | Retry the **whole** archive call — history insertion has not happened yet |
| History holds `expectedRunId` with **different** content than the exact terminal `currentRun` | `archive_conflict` — never silently resolved |
| The current draft holds a **different** run (a different active/terminal run than `expectedRunId`) | `run_id_mismatch` (a genuinely different run is now current) or, for an ordinary draft mutation encountering the equivalent ambiguity, `draft_conflict`, as applicable to the operation being recovered |

**Corrected in this revision — the exact, normative rule, not merely "a definite write
failure":** this rule is not "any write call that reports failure is a definite failure" —
a write call can report an error *after* the underlying write may already have taken
effect (e.g. a timeout following a completed operation, or an ambiguous transport error).
The precise rule:

- `history_unavailable`/`draft_clear_failed` may be returned **only when the storage
  adapter's own documented contract positively guarantees that no write/clear took
  effect** — not merely "the call reported an error."
- A timeout, an ambiguous exception, a transport interruption, or any failure signal that
  does **not** itself rule out a completed write must be classified `write_outcome_unknown`
  — never `history_unavailable`/`draft_clear_failed`.
- A success response followed by a failed, missing, or mismatching read-back must be
  classified `write_outcome_unknown` — the same rule, for the complementary case (the
  write reported success, but confirmation could not be obtained).
- A read-back that *succeeds* and *definitively proves* an invalid durable pair is
  `committed_target_conflict` (Decision 12) — a distinct case from either of the above.
- A check-B rejection *before* any write is attempted is `prospective_target_conflict` —
  also distinct; no write occurred at all.

No read-back failure, on its own, and no adapter failure signal that does not itself
guarantee a write never took effect, is ever classified as a definite write failure.

### Crash points

| Crash point | Durable state after | Public outcome / retry-safe? |
|---|---|---|
| Before lease acquired | Nothing changed | Yes |
| After lease acquired, authority/disposition re-check fails | Nothing changed | Yes |
| After lease acquired, before history write | Nothing changed | Yes |
| History write fails with the adapter's own contract positively guaranteeing no write occurred | Draft untouched, history not written | `history_unavailable` — a definite failure; retry-safe |
| History write reports success, read-back fails or does not match — or the failure signal does not itself guarantee no write occurred | History may or may not durably hold the entry | `write_outcome_unknown` (never `history_unavailable`) — reload and compare per the recovery table above, do not blindly retry the whole call |
| History confirmed durable, before draft clear | History durable, draft still holds the run (recoverable duplicate) | Yes — retry converges via `already_archived` if `currentRun` was concurrently cleared by some other means, or via the ordinary idempotent path otherwise |
| Draft-clear call fails with the adapter's own contract positively guaranteeing the clear never took effect | History already durable, draft untouched | `draft_clear_failed` — a definite failure; retry-safe |
| Draft-clear call reports success, read-back fails or does not match — or the failure signal does not itself guarantee the clear never took effect | History already durable; draft may or may not be cleared | `write_outcome_unknown` (never `draft_clear_failed`) — reload and compare |
| During draft-clear write (ordinary storage-level interruption) | Atomic per key — old or new value observed, never torn | Yes |
| `archive_conflict` | History and draft both left exactly as they were | Not a crash — a durable, genuine conflict requiring reconciliation |

---

## 15. Repository-operation idempotency and unknown-outcome contract

**New in a prior revision, corrected further in this one.** An earlier draft claimed an
ordinary draft update could simply be retried after a crash or read-back failure — unsafe
for a non-idempotent transformation. A subsequent revision fixed the retry problem by
recomputing whether a prior attempt already succeeded — but did so by re-invoking a
caller-supplied `updater` callback, which is unsafe for a different reason: an arbitrary
closure may depend on the clock, randomness, mutable closure state, or external state, so
invoking it twice is not guaranteed to reproduce the same result, and therefore cannot
itself prove idempotency. **This revision removes the callback entirely.**

`updateCurrentRun` now takes a **deterministic, already-computed `intendedRun` value**
(Decision 9) instead of an updater function — the UI/domain layer applies its existing pure
domain function to its own observed baseline **exactly once**, itself, before calling this
method; the method (and any automatic retry logic) never recomputes it.

| Operation | Idempotency / conflict rule |
|---|---|
| `createCurrentRun(run)` | Same `id` + canonically identical existing active run → idempotent success, no rewrite. Same `id` + different content → `draft_conflict` (practically unreachable — fresh runs get fresh ids — kept for robustness). Existing active run, different `id` → `current_run_already_active`. Existing terminal, not-yet-archived run → `terminal_run_pending_archive`. Prospective pair check (Decision 12, check B) before writing. |
| `updateCurrentRun(expectedRunId, expectedBaselineCanonical, intendedRun)` | Loads the authoritative run fresh, inside the lease, and computes `currentCanonical`. If `currentCanonical === canonical(intendedRun)`: idempotent success, no write — safe to retry, since `intendedRun` was computed once by the caller and is compared as a fixed value, never recomputed. Else if `currentCanonical !== expectedBaselineCanonical`: `draft_conflict`, no write. Else: prospective pair check (Decision 12, check B), write `intendedRun`, read back. Ambiguous read-back → `write_outcome_unknown`. |
| History insertion (`internalInsertTerminalRunIfAbsent`) | Same `id`, canonically identical → `"already_present_identical"`, no rewrite. Same `id`, different content → `"archive_conflict"`. Absent → prospective pair check (Decision 12, check B), then insert, preserving append order. |
| History deletion (`deleteHistoryEntry`) | **Unconditionally idempotent** — an already-absent entry is already this operation's postcondition; deleting it succeeds, never an error at this layer. Still constructs and validates the prospective post-deletion history schema before writing (Decision 12, check B) — a deletion cannot introduce an ID collision, but the "never write an unvalidated prospective value" discipline still applies. |
| Archive | Decision 14's own contract. |

**Recovery from `write_outcome_unknown`, stated once, applying everywhere this outcome can
occur:** reload the authoritative state and compare it against the fixed `intendedRun` (or,
for archive/history operations, the fixed intended outcome) the caller already computed —
**never recompute a transformation to check.**

- If the current authoritative state already equals the intended result: report success —
  the earlier attempt landed.
- If the current authoritative state still equals the old baseline: the operation may be
  explicitly retried with the *same*, already-computed `intendedRun` (never a freshly
  recomputed one).
- Otherwise: report `draft_conflict` — something else changed the state in the interim;
  the caller must re-observe and re-derive a new `intendedRun` from scratch before trying
  again.

**Establishment-protocol writes (Decision 4) are exempt from this ambiguity by
construction** — every establishment write derives and writes a value that is itself
already deterministic given its inputs (the canonical empty state, or a pure derivation
from a fingerprint-confirmed legacy snapshot), so a subsequent resolution simply re-reads
and re-validates from scratch regardless of whether a prior write "actually" landed; this
is why Decision 4's own crash tables never needed `write_outcome_unknown` language, and why
this section is scoped to *ordinary, ongoing* mutations specifically.

---

## 16. Error taxonomy

```typescript
type AssessmentAuthorityErrorCode =
  // Internal programming error — never a user-data error, never expected in ordinary
  // operation (Decision 8):
  | "invalid_mutation_context"                // an expired or fabricated context was used
  // Durable — retrying the identical operation will not help without reconciliation:
  | "invalid_split_evidence"
  | "stray_target_data"
  | "legacy_migration_source_vanished"       // Decision 4.4.2
  | "committed_target_missing"
  | "committed_target_invalid"
  | "committed_target_conflict"              // Decision 12 — an already-durable invalid pair
  | "current_history_id_conflict"
  | "duplicate_history_id_conflict"
  | "active_current_run_id_collides_with_history"
  | "archive_conflict"
  // Read-only-pending-reconciliation write refusal (Decision 13) — durable until a future
  // reconciliation policy, but reads remain available and the underlying data is intact:
  | "write_refused_read_only"                // carries the disposition's own reason nested
  // Retryable / requires reload before retry — the one-authority invariant and every
  // already-durable write are preserved, but "untouched" is not always literally true —
  // see the corrected statement below:
  | "storage_unavailable"
  | "quota_exceeded"
  | "lease_unavailable"
  | "lease_request_failed"
  | "fingerprint_unavailable"
  | "authority_changed"
  | "history_unavailable"                    // ONLY a definite write failure — see below
  | "draft_clear_failed"                     // ONLY a definite write failure — see below
  | "draft_conflict"                          // Decision 15 — stale baseline, not corruption
  | "prospective_target_conflict"             // Decision 12, check B — rejected BEFORE any
                                               // write; no durable state changed; retry with
                                               // a different, valid intended value is safe
  | "write_outcome_unknown"                   // Decision 15 — reload before deciding to retry
  | "cloud_confirmation_unavailable"
  // Ordinary, expected outcomes of calling an operation under the wrong precondition —
  // not failures of the mutation machinery itself:
  | "no_current_run"
  | "already_archived"
  | "run_id_mismatch"
  | "run_not_completable";
```

**`invalid_mutation_context`** (Decision 8): thrown by `assertActiveContext` when a
context is expired (its owning `runAssessmentMutation` call has already returned or
thrown) or fabricated (never minted by `runAssessmentMutation` at all). This is **always
an internal programming error** — a context is never something application/UI code
constructs, stores across calls, or passes around outside the single logical mutation that
received it — never a condition arising from user data or ordinary operation.

**`committed_target_conflict` vs. `prospective_target_conflict` — one exact, mandatory
taxonomy, corrected in this revision.** A prior revision described these as
distinguishable "if implementation keeps them distinct" — an unresolved implementation
choice left inside an Accepted ADR. This revision removes the choice: the two codes are
**never interchangeable and never collapsed into one**.

- **`committed_target_conflict`** — used **only** when invalid state is **already durable**:
  discovered at startup resolution (Decision 7, C3), by the existing-state check (A, a
  pre-existing invalid pair in already-stored data), or by the immediate read-back check
  (C, when it definitively confirms a just-written durable value is invalid). This is
  always a genuine, durable block requiring reconciliation.
- **`prospective_target_conflict`** — used **only** when the prospective-state check (B)
  proves that a mutation's **own intended, not-yet-written** result would be invalid.
  Because check B runs strictly before any write, **no write is ever attempted** when this
  code is returned; the durable state remains exactly as valid as it was before the call.
  Retrying with a different, valid intended value is always possible — this code never
  indicates durable corruption.

A caller/log reader can therefore always tell "this call left something durably broken"
(`committed_target_conflict`) from "this call was correctly refused and changed nothing"
(`prospective_target_conflict`) from the code alone, with no ambiguity about which applies.

**`history_unavailable`/`draft_clear_failed` — precisely scoped, corrected in this
revision to state the exact condition, not just an intuition of "reported failure."** A
prior revision said these two codes apply "when the write call itself reported failure,"
without stating what makes a report trustworthy. The precise, normative rule: **these two
codes may be used only when the storage/adapter contract positively guarantees that no
corresponding write occurred** — i.e., the adapter's own contract (Decision 9's
`StorageAdapter`/`PersistenceWriteResult` shape) is one where a reported failure is
defined to mean the write never took effect, not merely "an error surfaced." **If the
adapter cannot make that guarantee** — an ambiguous result, a timeout with no confirmed
outcome, any adapter whose failure signal does not rule out a completed write — **the
result must be classified as `write_outcome_unknown`, never `history_unavailable`/
`draft_clear_failed`.** A write that reported success but whose read-back failed or did
not match is, for the same reason, always `write_outcome_unknown` — conflating either case
with a definite-failure code would misclassify a possibly-already-durable write as
something guaranteed not to have happened.

**Corrected statement, replacing an even earlier revision's blanket claim.** It is **not**
true that every retryable/deferred failure leaves all underlying data untouched — a history
insert may have already succeeded before its read-back failed; a draft-clear may be
attempted only after history is already durable; `write_outcome_unknown` exists precisely
because a write's own success is sometimes not confirmable. The accurate statement:
**retryable and outcome-unknown failures preserve the one-authority invariant and never
lose already-durable data; they may leave safe, idempotently-recoverable partial progress
behind; callers must follow the specific recovery rule named for that operation (Decision
14/15), never assume "nothing happened" by default.**

`invalid_legacy_json`/`invalid_legacy_root`/`unknown_legacy_schema`/`unexpected_root_field`/
`invalid_history_field`/`invalid_current_run`/`non_terminal_history_entry`/
`invalid_history_entry`/`legacy_requires_repair` (Decision 10) are migration-**eligibility**
reasons carried in `AssessmentMigrationDeferredReason.legacy_ineligible.detail` — they
resolve `legacy_combined_local`, never a thrown/returned mutation error. Every one of them
is a `legacy_combined_local` deferral, never a `blocked` result — see Decision 10's
"Ineligible ≠ blocked" reasoning.

`source_drift_detected` is **not** part of this taxonomy — it was a detection event, not a
terminal outcome (Decision 4.4.2).

---

## 17. Security and privacy

Unchanged in substance from prior revisions: splitting one `localStorage` key into two
(plus one evidence key) changes neither confidentiality nor the local/XSS/browser-extension
threat model. `localStorage` fingerprints, the split-layout evidence record, and the
unified mutation lease are never security boundaries.

---

## 18. Tests

**Updated in this revision** for every corrected contract; every test that would have
encoded a now-incorrect rule (deduplicating identical duplicate history IDs, retrying an
ordinary update blindly, comparing post-commit content to establishment fingerprints, a
tolerated-deletion legacy residue, an optional `expectedRunId` on archive, a plain
`branchDetected` boolean, "before every write" lease semantics, own-key-containment alone
proving no information loss, an arbitrary `updater` callback's idempotency, a context that
remains valid after its callback completes, or pair validation checked only after a
mutation's write) is removed.

**Non-reentrancy (Decision 8):** a fake-lock test double counts `request()` calls across
one full `archiveCurrentTerminalAssessmentRun` invocation and asserts the count is exactly
**1**. The same style of test is applied to every other public mutation (each expected to
call `request()` exactly once per call). A dedicated test asserts the archive coordinator
never calls `createCurrentRun`/`updateCurrentRun`/`deleteHistoryEntry` (the public,
self-locking operations) from inside its own held lease — only the internal, context-bound
operations.

**Mutation-context lifecycle (Decision 8; corrected terminology — Decision 8's own
correction note):**
- **Context valid across an `await` inside the callback (scenario 74):** a context is valid
  for the callback's entire *dynamic asynchronous lifetime*, not merely a synchronous
  stretch of code — asserted by having the callback perform an internal operation, `await`
  something else, then perform a second internal operation with the same context, both
  succeeding.
- **Context valid inside the callback:** a context captured and passed to an internal,
  context-bound operation *during* the `runAssessmentMutation` callback's execution passes
  `assertActiveContext` without error.
- **Context invalid after the callback resolves:** a context reference retained (e.g.
  assigned to an outer variable) and used *after* `runAssessmentMutation`'s returned promise
  has resolved fails `assertActiveContext` with `invalid_mutation_context`.
- **Context invalid after the callback rejects:** the same, when the callback throws —
  `finally`'s removal runs regardless of success or exception, asserted directly by forcing
  the callback to throw and then attempting to reuse the context it received.
- **Fabricated context rejected:** an object shaped like `AssessmentMutationContext` but
  never produced by `createMutationContext` (e.g. `{}` or a hand-constructed object
  carrying an unrelated symbol) fails `assertActiveContext` — asserted directly against the
  symbol-brand design, not merely against the `WeakSet` membership check.
- **No internal operation can reuse an expired context:** each `internal*` function is
  called once with a context obtained from a prior, already-completed
  `runAssessmentMutation` call and is asserted to reject via `invalid_mutation_context`
  without performing any read or write.

**Exact structural equality (Decision 10):** `exactStructurallyEqual` — a raw value with
only known keys but one field the existing validator would default, repair, or normalize
differently is **not** equal to its canonical reconstruction (`legacy_requires_repair`, not
silently accepted); a raw value whose nested field (inside `templateSnapshot`, an
`attempts` entry, etc.) the validator would normalize is likewise unequal; a raw value that
is exactly, recursively identical to its canonical reconstruction is equal (eligible); a
cyclic hostile object passed directly to the comparator — including the exact same cyclic
object passed as both arguments, and cyclic arrays as well as cyclic objects — rejects
deterministically via the `visiting`/`completed` per-pair state, applied uniformly to both
branches, without throwing and without infinite recursion; a shared (non-cyclic) subgraph
compared twice reuses its already-`completed` result rather than being silently accepted by
reference; array element order
is significant (two arrays with the same elements reordered are unequal); object own-key
order is not significant (two objects with the same key set in different insertion order
are equal).

**Corrected, precise Proxy claim** (a prior revision's "a `Proxy`/accessor/symbol-keyed
hostile input on either side rejects" overstated this — it is not true of every Proxy, and
contradicts the comparator's own totality proof for a *transparent* one): accessor-backed,
symbol-keyed, non-enumerable, sparse, and exotic-prototype values are always rejected,
structurally, regardless of whether they arrive via a Proxy or not. A Proxy whose required
reflection trap (`getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor`) throws is rejected,
fail-closed, by the single outer boundary. But **a Proxy that transparently exposes an
otherwise-valid, plain, enumerable-data-property structure is not blanket-rejected merely
for being a Proxy** — it is compared exactly like any other value, using its own
descriptor-reflected snapshot; it may compare equal or unequal depending on that snapshot,
the same as a non-Proxy input would. Its `get` trap is never invoked, because no value
belonging to that Proxy (an original input operand) is ever read any way other than
through its own descriptor — the descriptor-derived value is then copied into the
comparator's trusted local snapshot, which the comparator does go on to read normally; that
normal read of the comparator's own local data is not a second read of the Proxy and never
touches its `get` trap. **This comparator does not, and cannot, detect Proxy identity at
all** — JavaScript provides no
general-purpose test for "is this a Proxy," and no part of this design relies on one; no
security or correctness decision anywhere in this ADR depends on whether a transparent
Proxy is accepted or on being able to tell a Proxy apart from an ordinary object. Real
persisted values always originate from `JSON.parse`, which never produces a Proxy — the
Proxy scenarios exist only to prove this comparator's totality and its no-live-read
guarantee against a hostile *direct* call, never as a scenario expected in production data.

**Comparator hostile-input matrix (Decision 10, this and the prior revision's corrections
— scenarios 61-80), each proven individually:**

1. The exact same self-referential object passed as both arguments → `false`.
2. Two *distinct* self-referential objects compared to each other (`x.self = x`,
   `y.self = y`, `equal(x, y)`) → `false`.
3. A self-referential array → `false`.
4. Mutually cyclic arrays → `false`.
5. A shared (non-cyclic) subgraph reached twice via two different paths → `true`, without a
   second full traversal (observed via a call counter on the underlying descriptor-reading
   calls, confirming the `completed` state is actually reused).
6. A sparse array (an explicit hole) → `false`.
7. **A huge-`length`, mostly-sparse array** (e.g. `length: 2**32 - 2` with only three real
   indices) → `false`, asserted **and** timed/counted to confirm the comparator's work is
   bounded by the array's real own-key count (three, plus `length`), never by the claimed
   `length` — this is the specific defect this revision corrects.
8. An accessor-backed array index → `false`, **with the getter's call count asserted to be
   zero**.
9. A symbol-keyed array → `false`.
10. An array with an extra named (non-index) property → `false`.
11. **An array with an exotic (non-`Array.prototype`) prototype** — e.g.
    `Object.setPrototypeOf([], {})` or a class extending `Array` — → `false`.
12. An object with an accessor property → `false`, **with the getter's call count asserted
    to be zero**.
13. A Proxy whose `getPrototypeOf`, `ownKeys`, or `getOwnPropertyDescriptor` trap throws, at
    any depth → `false`, without the exception escaping the comparator.
14. **A Proxy whose `get` trap throws, while its `getPrototypeOf`/`ownKeys`/
    `getOwnPropertyDescriptor` traps permit full descriptor inspection** — asserted with a
    spy confirming the `get` trap is **never invoked** at all, since every value belonging
    to that Proxy (the original input operand) is read only from its own descriptor, never
    via a live property access on the Proxy itself.
15. **A transparent Proxy that exposes an otherwise-valid, plain, descriptor-consistent
    structure** (all reflection traps behave as an ordinary object would) — compared
    exactly like any other value, using its descriptor-reflected snapshot; asserted to
    compare **equal or unequal according to that snapshot**, the same as an equivalent
    non-Proxy input would — **never blanket-rejected merely for being a Proxy**, and its
    `get` trap is asserted, via a spy, to be invoked zero times regardless of the outcome.
16. `Map`, `Set`, `Date`, `RegExp`, a typed array, a class instance, `BigInt`, `NaN`, and
    `+Infinity`/`-Infinity` — each, at any depth — → `false`.
17. Two ordinary, independently-parsed, field-for-field equivalent JSON trees → `true`.
18. Object property insertion order does not affect equality (two objects with the same
    key set built in different orders) → `true`.
19. Array element order does affect equality (the same elements, reordered) → `false`.

None of these ever throws or hangs. **The precise, corrected claim** (not "never invokes
any getter/trap," which is impossible for reflection itself, and not "never performs a live
read of any kind," which is untrue of the comparator's own trusted local data): reflection
operations (`getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor`) are necessarily invoked
by the act of inspection, and any of them throwing is caught by the comparator's single
`try`/`catch` boundary. What never happens is a live property read of **either original
input operand** (`object[key]`, `array[i]`, `array.length` — on `x`, `y`, or any of their
own descendants) or an invocation of a user-defined accessor getter attached to either
original operand. Every value belonging to an original operand is obtained exactly once
from an already-validated descriptor **on that operand** and copied into a trusted local
snapshot (`inspectArray`'s `values` array, `inspectPlainObject`'s snapshot map) — never
re-read from the original input afterward. The comparator does then read those trusted
local snapshots normally (ordinary array indexing, ordinary `Map.get`) — that is a read of
the comparator's own local data, not a second read of the hostile input, and is not covered
by, or in tension with, the no-live-read-of-original-input claim above.

**Canonical run equality (Decision 1.1):** `serializeCanonicalAssessmentRun` is
deterministic across repeated calls on an identical value; two structurally-identical-but-
differently-key-ordered raw inputs, once passed through `validatePersistedAssessmentRun`
and reconstructed, serialize identically; a single differing field anywhere fails equality.

**Deterministic `intendedRun` mutation contract (Decision 15):** `updateCurrentRun` is
called with a pre-computed `intendedRun` and a spy wrapping the pure domain function that
produced it — the spy is asserted to have been called **at most once**, including across a
simulated retry. Current-equal-to-baseline (ordinary case): applies and writes.
Current-equal-to-intended (idempotent retry): succeeds without a second write, spy not
re-invoked. Current-equal-to-neither (genuine conflict): `draft_conflict`, no write. A
simulated write-success/read-back-failure sequence returns `write_outcome_unknown`, and a
subsequent reload-based recovery call (never a blind retry) resolves per Decision 15's
table.

**Prospective pair validation (Decision 12, checks A/B/C):** a prospective
`createCurrentRun`/`updateCurrentRun` write that would collide with an existing history
entry's `id` is rejected via `prospective_target_conflict` **before** any write is
attempted (asserted by spying on the underlying storage adapter and confirming zero write
calls) — never `committed_target_conflict`, since nothing became durable. The equivalent
for a prospective archive-history insertion that would collide with an existing,
different-content history entry: `archive_conflict`, no write. An already-invalid existing
pair (check A) refuses the mutation outright, before even constructing a prospective value
→ `committed_target_conflict` (already durable). `deleteHistoryEntry`'s own check B —
constructing the prospective post-deletion `history` array and validating it before writing
— is asserted directly with a fake adapter forced to produce a structurally invalid
prospective value, confirming `prospective_target_conflict` and zero writes. Check C is
tested for both of its outcomes independently: an **ambiguous** post-write read-back →
`write_outcome_unknown` (never treated as success, never `committed_target_conflict`); a
read-back that **definitively confirms** an invalid durable pair (simulated via a hostile
fake adapter) → `committed_target_conflict` (the one case check C itself proves durable
invalidity, rather than merely leaving it uncertain).

**Web Crypto availability (Decision 4.0.2):** committed `fresh_initialization` evidence
with legacy absent or present resolves `writable`/`legacy_branch_detected` respectively
**without any fingerprint computation attempted** (asserted via a spy on
`crypto.subtle.digest` recording zero calls). Committed `legacy_migration` evidence with
legacy present and Web Crypto unavailable resolves `read_only_pending_reconciliation,
branch_detection_unavailable`.

**Fresh-prepared supersession (Decision 4.4.1):** eligible new legacy content overwrites
fresh-prepared evidence with migrated-prepared evidence and commits to `split_local`, in
one continuous run under one lease entry. Ineligible new legacy content resolves
`legacy_combined_local` (deferred), leaves the orphaned fresh-prepared evidence untouched,
and a *subsequent* resolution against now-eligible content succeeds.

**Migrated-prepared restart (Decision 4.4.2):** drifted-but-still-eligible source
automatically restarts and commits. Drifted-to-ineligible source resolves
`legacy_combined_local` (deferred). Drifted-to-absent source resolves `blocked:
legacy_migration_source_vanished`. A second drift during the restart's own final check
resolves `legacy_combined_local` (deferred, `source_churn`), retried successfully on a later
pass.

**Strict eligibility (Decision 10):** each of the corrected rows individually — extra root
field alongside a valid `schemaVersion`; missing/`null`/non-array `history`;
`currentRun: null`; an unexpected field on `currentRun` itself and on each nested structure
(`templateSnapshot`, an `attempts` entry, etc.); **any** duplicate history `id` (identical
or different content) is always ineligible, never deduplicated.

**Committed target-pair validation (Decision 12):** an active draft id colliding with a
history id → `committed_target_conflict`, both at startup and via the mutation runner's
authority check. A terminal draft + canonically-identical history entry → recognized valid
pending-clear state, not a conflict.

**Archive retry convergence (Decision 14):** a simulated "history durable, draft cleared,
response lost" state, retried with the same `expectedRunId`, returns `already_archived`,
not `no_current_run`.

**Ordinary-mutation idempotency (Decision 15):** see "Deterministic `intendedRun` mutation
contract," above — `updateCurrentRun` no longer accepts a callback, so this coverage is
expressed as fixed-value comparisons (current vs. baseline vs. intended), not as a spy on a
re-invoked function.

**Evidence validator — descriptor-snapshot and safe-return correctness (Decision 4.0.1,
this revision's correction), each proven individually:**

1. Valid, plain Evidence input → the validator returns a separate, newly constructed plain
   object (not `raw` itself).
2. That returned value is **not reference-equal** to the input (`result !== raw`).
3. The returned value contains **exactly** the expected fields for its variant — no more,
   no fewer.
4. **A transparent Proxy whose `get` trap throws**, while its
   `getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor` traps expose an otherwise-valid
   Evidence shape: validation **succeeds**, using only descriptor values; a spy confirms
   the `get` trap's call count is **zero**; the returned value is a new plain object.
5. **A Proxy whose `get` trap lies** — returning a different `protocolVersion`, `origin`,
   or `status` than the value its own `getOwnPropertyDescriptor` reports — the `get` trap
   is asserted, via a spy, to be **uncalled**; the result is determined **exclusively** by
   the descriptor-reported (snapshotted) values, never by whatever the `get` trap would
   have returned.
6. A Proxy whose `getPrototypeOf`, `ownKeys`, or `getOwnPropertyDescriptor` trap throws →
   the fixed `invalid_evidence_shape` result; no exception escapes.
7. An accessor-backed required field → rejected (`invalid_evidence_shape`); the getter's
   call count is asserted to be **zero**.
8. A symbol-keyed Evidence object → rejected.
9. A non-enumerable Evidence field → rejected.
10. A missing field → the deterministic `invalid_evidence_missing_field` result.
11. An extra field → the deterministic `invalid_evidence_field_count` result.
12. **A `BigInt`, cyclic object, array, or Proxy placed as the value of a required
    fingerprint (or `protocolVersion`/`origin`/`status`) field** — the snapshot holds it,
    untouched, as an opaque `unknown` reference (proving the snapshot is not assumed
    primitive); the corresponding field-value check (`typeof`/`===`/regex) rejects it
    (`invalid_evidence_fingerprint_format` or the matching base-field code) **without ever
    traversing, stringifying, or recursing into it**, and without any exception escaping.
13. **Mutating the original Proxy or its target *after* validation cannot alter the
    already-returned validated Evidence** — asserted by mutating the input post-call and
    confirming the previously-returned object is unchanged, proving the returned value
    holds its own copied primitive data, not a live view over the input.

**Missing-field-versus-field-count precedence (Decision 4.0.1, this revision's
correction), each proven individually:**

14. Missing `protocolVersion` → `invalid_evidence_missing_field`.
15. Missing `origin` → `invalid_evidence_missing_field`.
16. Missing `status` → `invalid_evidence_missing_field`.
17. Missing `draftTargetFingerprint`/`historyTargetFingerprint` on an otherwise-valid
    `fresh_initialization` object → `invalid_evidence_missing_field`.
18. Missing `legacySourceFingerprint` on an otherwise-valid `legacy_migration` object →
    `invalid_evidence_missing_field`.
19. A required field absent **while an unexpected replacement field of a different name is
    present instead** (same total key count as the expected set) →
    `invalid_evidence_missing_field` — never `invalid_evidence_field_count`, even though
    the snapshot's size happens to match `expectedKeys.length`; presence of every expected
    key is checked independently of the overall count.
20. Every expected field present, plus one additional unexpected field →
    `invalid_evidence_field_count`.
21. Wrong (but present) `protocolVersion` → `unsupported_protocol_version`.
22. Invalid (but present) `origin` → `invalid_evidence_origin`.
23. Invalid (but present) `status` → `invalid_evidence_status`.
24. A malformed (but present) fingerprint value → `invalid_evidence_fingerprint_format`.

**Single-graph validator guard versus comparator pair-state (this revision's
correction) — tested as two distinct mechanisms, never conflated:**

25. **Value-producing validator, repeated object identity within one input graph** (a
    direct cycle, an indirect cycle, or merely the same object referenced twice via
    different paths, with no cycle at all) → the validator's own `WeakSet<object>` guard
    fails the input closed, deterministically, the moment the repeated identity is
    encountered — a single terminal rejection, never a partial/successful traversal.
26. **Comparator, an actively-being-compared pair repeated** (a genuine cycle) →
    `visiting` state found → `false` (Decision 10, scenarios 61-63).
27. **Comparator, an already-fully-compared pair repeated** (a shared, acyclic subgraph,
    reached via two different paths) → `completed` state found → reused as `true` without
    re-traversal — **never rejected**, unlike case 25's single-graph validator guard,
    which has no equivalent "safe reuse" outcome, because a value-producing validator only
    ever traverses one graph and any repeated identity within it is *itself* proof of a
    non-tree shape real `JSON.parse` output can never produce.

**Corrected in this revision — value-producing validators and the boolean comparator are
tested for distinct contracts, not "identically."** The same descriptor-snapshot,
safe-return-value discipline is tested for every other **value-producing validator** —
the legacy root validator and both target-state validators: each returns a freshly
constructed canonical value, never the raw input narrowed or cast.

`exactStructurallyEqual` (Decision 10) is tested for its own, different contract instead:
it returns only `boolean`, never either compared operand, and its own hostile-input matrix
(above) already proves its totality and no-live-read-of-original-input guarantee
independently. Tests confirm the two **cooperate** correctly in the migration-eligibility
check: a value-producing validator (e.g. `validatePersistedAssessmentRun`) produces the
canonical reconstruction, and `exactStructurallyEqual` is then called with the raw parsed
candidate as one argument and that canonical reconstruction as the other — never the other
way around, and never with the comparator expected to produce a value of its own.

**Corrected in this revision — totality is not the same claim as universal rejection.**
Every one of these — the value-producing validators and the comparator alike — is proven
total (never throws, never hangs) against the same hostile-input categories, but the
*outcome* differs by category, not a blanket rejection for all of them:

- `BigInt`, `Map`, `Set`, `Date`, `RegExp`, a typed array, a symbol-keyed object, an object
  with a throwing getter for an expected field, a Proxy whose *required* reflection trap
  (`getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor`) throws, and a cyclic object — each
  of these **is rejected**, deterministically, without throwing, and without ever invoking
  the hostile object's own getter/trap code beyond the minimum reflection needed to decide
  the result.
- **A Proxy whose `get` trap throws or lies, while its reflection traps
  (`getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor`) remain valid and expose a
  consistent, otherwise-acceptable shape, is a distinct category — it is *not*
  automatically rejected.** Its `get` trap is never invoked at all (nothing it throws or
  returns is ever consulted), and the result — accept or reject — is determined **entirely
  by the descriptor-reflected snapshot**, exactly as for a transparent, non-throwing,
  non-lying Proxy or an ordinary object with the same snapshot. Totality here means "never
  throws, never invokes the `get` trap," not "always rejects."

**Cloud-eligibility exclusion, version-namespace independence, key/domain-count
assertions, startup gate ordering, `write_protected` timing:** unchanged in substance from
prior revisions — see Decisions 11, 13 (version namespaces), 7/§write_protected timing.

---

## Alternatives considered

| Alternative | Verdict |
|---|---|
| Keep the combined Assessment persistence domain | **Rejected** — the status quo Decision D asks this ADR to move past. |
| Move both `currentRun` and `history` to cloud | **Rejected** — contradicts "draft stays permanently local." |
| Split only at the repository API, one storage key | **Rejected** — a single key is a single atomic-write unit. |
| Continuous dual-write between combined and split keys | **Rejected outright.** |
| Write history before clearing the draft | **Selected** (Decision 14) — recoverable duplicate over unrecoverable loss. |
| Reuse ADR-0016's marker | **Rejected** — scoped to a one-key domain. |
| Caller-supplied run as archive source of truth | **Rejected** (Decision 14) — derive from the repository itself, under the lease. |
| Clear draft by ID alone | **Rejected** (Decision 14) — exact canonical-content matching required. |
| SHA-256 fingerprint as run-to-run equality | **Rejected** (Decision 1.1) — cryptographically strong is not mathematically exact; exact canonical serialization used instead. Fingerprints retained only for split-evidence records. |
| Independent locks per operation, ordinary writers unlocked | **Rejected** (Decision 8) — one unified lease every writer shares. |
| Repository methods each acquiring the lease internally, called from within an already-held lease | **Rejected** (Decision 8) — this is exactly the re-entrancy deadlock this revision fixes; replaced with the non-reentrant runner/context design. |
| Perpetual fingerprint-matching of mutable post-commit targets | **Rejected** (Decision 6) — ordinary schema/domain/pair validation instead. |
| Tolerate deletion of `legacy_migration`-origin residue | **Rejected** (Decision 3/7, corrected this revision) — an old build could write-then-delete, erasing the only branch signal; deletion now resolves `legacy_residue_missing`, not "harmless." |
| Deduplicate content-identical duplicate history IDs during migration | **Rejected** (Decision 10, corrected this revision) — multiplicity/position is information the target invariant cannot represent; any duplicate makes migration ineligible instead. |
| Leave migrated-prepared drift's recovery as an implementation choice | **Rejected** (Decision 4.4.2, corrected this revision) — an Accepted ADR commits to automatic restart as its own architectural decision. |
| Optional `expectedRunId` on archive | **Rejected** (Decision 14, corrected this revision) — required, so a retry after full success can be recognized as `already_archived` rather than misreported as `no_current_run`. |
| Blind retry of an ordinary non-idempotent update after a crash | **Rejected** (Decision 15, new this revision) — replaced with an exact baseline/idempotency contract and `write_outcome_unknown`. |
| Plain `branchDetected: boolean` | **Rejected** (Decision 13, corrected this revision) — replaced with a discriminated write-disposition value and structurally-reflecting repository construction. |

---

## Scenario proofs

1. **Fresh initialization, no data.** All four keys absent → 4.1 → `split_local, writable`.
2. **Fresh prepared evidence, then legacy appears.** 4.4.1: eligible → overwritten with
   migrated-prepared, commits → `split_local, writable`. Ineligible → `legacy_combined_local`
   (deferred), fresh-prepared evidence left as inert residue, re-evaluated later.
3. **Fresh prepared evidence plus ineligible legacy.** Same as scenario 2's ineligible
   branch — deterministic, non-committing, retried on every later resolution.
4. **Crash during fresh-to-migrated supersession.** Decision 4.4.1's own steps are each
   atomic-per-key with read-back; an interruption anywhere before the final commit leaves
   legacy authoritative and the (partially-updated) evidence non-authoritative; the next
   resolution re-enters 4.4.1 from scratch against current content.
5. **Migrated-prepared evidence whose source changes to another eligible value.** 4.4.2 step
   2 — automatic restart, commits against the new source → `split_local, writable`.
6. **Migrated-prepared evidence whose source becomes ineligible.** 4.4.2 step 3 →
   `legacy_combined_local` (deferred, exact reason); orphaned evidence re-evaluated later.
7. **Migrated-prepared evidence whose source disappears.** 4.4.2 step 4 → `blocked:
   legacy_migration_source_vanished` — never silently treated as fresh, never committed.
8. **Repeated source churn before commit.** 4.4.2 step 5 → `legacy_combined_local`
   (deferred, `source_churn`) — retried successfully on a later, quieter resolution.
9. **First ordinary draft write after commit.** `updateCurrentRun`/`createCurrentRun`
   writes directly under the unified runner; the next startup's committed-target
   validation (Decision 12) is ordinary schema/domain validation of the now-mutated
   content — **never** compared to the establishment-time fingerprint.
10. **Legitimate mutable targets after reload.** Same as 9, for both domains, repeatedly.
11. **Post-commit migrated residue changed.** `legacy_branch_detected` →
    `read_only_pending_reconciliation` — reads available, writes refused.
12. **Post-commit migrated residue missing.** `legacy_residue_missing` — same disposition;
    no longer tolerated as harmless (corrected this revision).
13. **Old build changes then deletes residue.** Detected as `legacy_residue_missing` (the
    deletion is what's observed) — the changed-content intermediate state is not
    independently provable after the fact, an honestly-stated limitation (Decision 7).
14. **Old build changes then restores exact original bytes.** Not detectable by any
    purely client-side sampling — stated explicitly as a residual limitation, part of the
    production old-build gate, never claimed solved.
15. **Fingerprinting unavailable during initial establishment.** Fresh-init/migration
    derivation abort without writes → `legacy_combined_local` (deferred,
    `fingerprint_unavailable`).
16. **Fingerprinting unavailable during committed branch detection.**
    `read_only_pending_reconciliation, branch_detection_unavailable` — reads available,
    writes refused, no fingerprinting attempted for `fresh_initialization`-origin evidence
    at all (not needed there regardless).
17. **Getter-throwing, reflection-throwing, and cyclic validator input.** An object with a
    throwing getter, a Proxy whose *required* reflection trap throws, and a genuinely
    cyclic object are each rejected deterministically (`invalid_evidence_shape` or the
    corresponding validator's own fixed code) — no getter/trap is ever invoked beyond the
    minimum reflection needed to decide the result, and no throw escapes the validator.
    **A transparent Proxy whose reflection traps expose a valid, consistent shape is a
    distinct case and is not automatically rejected** — see Decision 4.0.1's own transparent-
    Proxy tests (items 4-5) — validation succeeds or fails according to the
    descriptor-reflected snapshot alone, exactly as it would for an equivalent non-Proxy
    input.
18. **Extra legacy root field with `schemaVersion: 1`.** `unexpected_root_field` —
    ineligible independently of the (otherwise-valid) schema version.
19. **Missing or non-array `history`.** `invalid_history_field` — never defaulted to `[]`
    for eligibility purposes.
20. **Nested unknown `AssessmentRun` field, or any raw/canonical structural difference at
    any depth (a missing value later defaulted, a normalized nested value, a reordered
    array, an extra field).** `legacy_requires_repair`, detected by one recursive
    `exactStructurallyEqual` comparison against the validator's own canonical
    reconstruction — ineligible, never silently repaired or dropped (Decision 10).
21. **Duplicate identical history IDs.** `duplicate_history_id_conflict` — always
    ineligible now, never deduplicated.
22. **Duplicate conflicting history IDs.** Same reason, same outcome — the identical/
    conflicting distinction no longer changes the eligibility result (both are ineligible).
23. **Committed active-draft/history ID collision.** `committed_target_conflict` (Decision
    12), both at startup and via the mutation runner's authority check.
24. **Archive same-ID exact content.** Idempotent — proceeds to clear without rewriting
    history.
25. **Archive same-ID different content.** `archive_conflict` — draft and history both
    left untouched.
26. **Archive completed, response lost, then retried.** `already_archived` (Decision 14's
    retry-convergence fix) — never `no_current_run`.
27. **Archive coordinator lock acquired exactly once.** Asserted directly by a dedicated
    test (Decision 8/18).
28. **Draft update with a stale baseline.** `draft_conflict`, no write — unless the current
    authoritative value already canonically equals the caller's already-computed
    `intendedRun`, in which case it succeeds idempotently instead, without recomputing
    anything (Decision 15; see also scenarios 45-48).
29. **Draft append write succeeded but read-back failed.** `write_outcome_unknown` —
    caller reloads and compares before deciding whether to retry.
30. **History deletion racing archive.** Fully serialized by the one unified runner — one
    completes entirely before the other's lease request is granted.
31. **bfcache-restored stale current-build repository.** Its next write re-enters the
    runner and re-checks fresh — safe regardless of suspension duration.
32. **localStorage failure during startup.** `blocked: storage_unavailable` — no repository
    constructed, no cached/legacy fallback.
33. **Later storage failure after successful resolution.** Ordinary `write_protected`
    (ADR-0013's existing, distinct concept) — never confused with startup's
    `storage_unavailable` (Decision 7/§write_protected timing).
34. **Web Locks unavailable before split.** `legacy_combined_local` (deferred,
    `lease_unavailable`) — permanent for that browser until a Locks-capable one is used.
35. **Web Lock request failure after split.** The specific mutation attempting the write
    fails with `lease_request_failed`; `split_local` itself is unaffected; the caller may
    retry the same operation.
36. **Existing ADR-0016 legacy Assessment marker.** Untouched by this ADR; remains valid
    evidence for the legacy combined key's IndexedDB copy status only — never reinterpreted
    as proving anything about `assessmentDraft`/`assessmentHistory`.

Every scenario ends with exactly one durable authority, one exact public result, one exact
write disposition, and one exact retry/reconciliation rule.

### Additional scenarios — this revision's four corrections

37. **Context used inside the lock callback.** Passes `assertActiveContext` throughout the
    callback's execution — durable state: whatever the callback itself writes; authority:
    unaffected; public outcome: the callback's own return value; retry: N/A.
38. **Context used after callback completion.** `finally` has already removed it from the
    registry by the time the outer `runAssessmentMutation` promise resolves — any later use
    fails `assertActiveContext` with `invalid_mutation_context` — durable state: unaffected
    by the (rejected) attempted reuse; authority: unaffected; public outcome:
    `invalid_mutation_context`, an internal programming error; retry: N/A — this indicates a
    bug, not a transient condition.
39. **Context used after callback rejection.** Same as 38 — `finally` runs on the
    exception path identically; the context is removed before the rejection propagates.
40. **Archive calling internal operations without re-locking.** `archiveCurrentTerminalAssessmentRun`
    enters `runAssessmentMutation` exactly once; every subsequent read/write inside it uses
    only context-bound `internal*` operations, none of which requests the lock again —
    asserted directly by a request-count test (Decision 8/18); no deadlock is possible by
    construction.
41. **Raw run with only known keys but a missing value later defaulted by the existing
    validator.** `exactStructurallyEqual` finds the canonical reconstruction includes a
    field the raw value never had → not equal → `legacy_requires_repair` — ineligible,
    never silently accepted merely because no *unknown* key was present.
42. **Raw nested field normalized by the validator.** Same mechanism, applied recursively —
    a difference nested inside `templateSnapshot`/`attempts`/etc. is caught by the same one
    comparator, without a second, manually-enumerated nested schema.
43. **Raw and canonical values exactly equal.** `exactStructurallyEqual` returns true —
    eligible; the canonical value is used for migration (Decision 4.2).
44. **Cyclic hostile raw value.** The `visiting`/`completed` per-pair state inside
    `exactStructurallyEqual` rejects deterministically (not equal) rather than recursing
    indefinitely or throwing. See scenarios 61-64 below for the exact cyclic/shared-graph
    cases this comparator must handle correctly (this revision's specific correction).
45. **Draft update with current equal to baseline.** The ordinary case —
    `updateCurrentRun` applies, validates, writes `intendedRun`, reads back → success.
46. **Draft update with current equal to intended result.** Idempotent retry recognition —
    succeeds without a second write; the caller's already-computed `intendedRun` is
    compared as a fixed value, never recomputed.
47. **Draft update with current equal to neither baseline nor intended.** `draft_conflict`
    — no write; the caller must re-observe the authoritative state and compute a new
    `intendedRun` before trying again.
48. **Nondeterministic transformation computed only once outside the repository.** The
    caller (UI/domain layer) applies its pure domain function to its observed baseline
    exactly once and passes the fixed result as `intendedRun` — `updateCurrentRun` and any
    automatic retry logic never re-invoke it (Decision 15) — asserted by a spy call-count
    of at most one across a simulated retry.
49. **Prospective update would create an active-draft/history ID collision.** Decision 12's
    check B constructs the prospective pair in memory and rejects with
    `prospective_target_conflict` — exclusively this code, never `committed_target_conflict`
    — before any write; the durable pair remains exactly as valid as before the call.
50. **Prospective archive would create conflicting same-ID history content.** Detected at
    Decision 14 step 8 (before the write is attempted) → `archive_conflict` — draft and
    history both left untouched.
51. **History write success plus failed read-back.** `write_outcome_unknown` (Decision 14
    step 9) — never `history_unavailable`; draft retained; recovery reloads and compares.
52. **Draft clear success plus failed read-back.** `write_outcome_unknown` (Decision 14 step
    11) — never `draft_clear_failed`; history remains durable; recovery reloads and
    compares.
53. **Reload after archive outcome is unknown.** Resolved deterministically per Decision
    14's recovery table: no draft + history present → `already_archived`; exact terminal
    draft + identical history → retry only the clear; exact terminal draft + no history →
    retry the whole archive; conflicting history → `archive_conflict`; a different current
    draft → `run_id_mismatch`/`draft_conflict` as applicable.
54. **Fully completed archive retried by `expectedRunId`.** `already_archived` (Decision
    14) — never `no_current_run`.
55. **Fresh prepared supersession.** Unchanged from the prior revision's scenario 2 —
    eligible new legacy content overwrites fresh-prepared evidence and commits; ineligible
    content defers to `legacy_combined_local`, re-evaluated on a later resolution.
56. **Migrated prepared automatic restart.** Unchanged from the prior revision's scenario
    5 — drifted-but-eligible source restarts and commits automatically.
57. **Missing migrated residue.** Unchanged from the prior revision's scenario 12 —
    `legacy_residue_missing`, not tolerated as harmless.
58. **Fingerprinting unavailable during committed branch detection.** Unchanged from the
    prior revision's scenario 16 — `read_only_pending_reconciliation,
    branch_detection_unavailable`.
59. **Legitimate mutable targets after reload.** Unchanged from the prior revision's
    scenario 10 — ordinary schema/domain/pair validation of current content, never compared
    to the establishment-time fingerprint.
60. **Existing ADR-0016 Assessment marker.** Unchanged from scenario 36 above.

Every scenario in this section, like every scenario above it, ends with exactly one
durable state, one exact authority, one exact write disposition, one exact public outcome,
and one exact retry/reload/reconciliation action.

### Comparator, taxonomy, and context-lifetime scenarios — this micro-correction

61. **Same cyclic object passed on both sides.** `equal(c, c)` where `c.self = c`: object
    identity is never used as a shortcut for object-typed values, so `c` is still routed
    through `compareObjects`; comparing `c.self` against `c.self` re-enters `equal(c, c)`,
    finds the pair already marked `visiting`, and returns `false` — rejected, not trivially
    accepted by reference.
62. **Self-referential array.** `arr.push(arr)`: `compareArrays` recurses into
    `equal(arr, arr)` for the pushed element, which hits the same `(arr, arr)` pair already
    marked `visiting` — rejected. (The prior revision's comparator lacked this check in the
    array branch entirely and would have recursed until a stack overflow.)
63. **Mutually cyclic arrays.** `a1 = [a2]; a2 = [a1];` — comparing `a1` against `a2`
    descends into `equal(a2, a1)` (from `a1[0]` vs. `a2[0]`), which descends into
    `equal(a1, a2)` again, finding that exact pair already marked `visiting` at the
    outermost call — rejected deterministically, no infinite recursion.
64. **Shared acyclic subgraph.** `const s = {a: 1}; x = {p: s, q: s}; y = {p: {a: 1}, q: {a:
    1}}` where `y.p`/`y.q` are two distinct but structurally identical objects: comparing
    `x.p` vs. `y.p` fully verifies `(s, y.p)` and marks it `completed`; if `y.p` and `y.q`
    were instead the same reference, comparing `x.q` vs. `y.q` would find the identical
    `(s, y.q)` pair already `completed` and return `true` immediately, reusing the
    already-proven result rather than re-traversing — this is memoization of a genuinely
    shared, acyclic subgraph, never confused with a cycle (a different state value gates
    each case).
65. **Sparse array.** `[1, , 3]` (a hole at index 1): `Object.getOwnPropertyDescriptor` at
    index 1 returns `undefined` → no descriptor → rejected — never treated as
    `undefined`-valued or silently skipped.
66. **Accessor array index.** `Object.defineProperty(arr, 0, { get() { return 1; },
    enumerable: true })`: the descriptor has no `"value"` → rejected without ever invoking
    the getter.
67. **Symbol-keyed array.** `arr[Symbol("x")] = 1`: `Reflect.ownKeys(arr)` includes the
    symbol key, which is not in the expected string-key set (indices plus `"length"`) →
    rejected.
68. **Exact ordinary JSON trees.** Two independently-parsed, field-for-field identical
    values (any key insertion order, any array of matching, correctly-ordered elements) →
    `equal` returns `true` — the ordinary, expected case underlying every eligible
    migration (Decision 10) and every recovery re-derivation check (Decision 4.3).
69. **Existing durable pair conflict.** Startup resolution (Decision 7, C3) or the
    mutation runner's existing-state check (A) finds an already-stored, invalid draft/
    history pair → `committed_target_conflict` — a genuine, durable block.
70. **Prospective conflict before write.** Check B constructs the exact in-memory
    prospective pair a mutation's own intended write would produce and finds it invalid →
    `prospective_target_conflict` — no write occurs; existing durable state is unaffected
    and remains valid.
71. **Definitively observed invalid pair after write.** Check C's read-back succeeds and
    definitively shows the now-durable pair is invalid (an implementation bug slipping past
    check B, or an out-of-protocol write) → `committed_target_conflict` — the one case
    where check C itself, not startup, first proves durable invalidity.
72. **Read-back unavailable after a possible write.** Check C's read-back fails or is
    ambiguous, and/or the adapter's own failure signal does not positively guarantee no
    write occurred → `write_outcome_unknown` — never `committed_target_conflict` (nothing
    was *confirmed* invalid) and never `history_unavailable`/`draft_clear_failed` (the
    adapter did not guarantee the write never took effect).
73. **History deletion prospective validation.** `deleteHistoryEntry` constructs the exact
    prospective post-deletion `history` array (check B) and validates it before writing —
    it can never detect an ID collision (a deletion only removes an entry), but a
    structurally invalid prospective value (an implementation error in the removal logic)
    still returns `prospective_target_conflict` with no write attempted.
74. **Context across an `await` inside the callback.** A context obtained at the start of
    `runAssessmentMutation`'s callback remains valid across every `await` inside that same
    callback — its validity is the callback's entire dynamic asynchronous lifetime, not a
    single synchronous stretch of code — asserted by an internal operation succeeding after
    an intervening `await` within the same call.
75. **Context after callback completion.** The same context, retained and reused after the
    callback has resolved (or rejected — Decision 8), fails `assertActiveContext` with
    `invalid_mutation_context` — the registry entry was removed in `finally` before the
    outer `runAssessmentMutation` promise settled.
76. **Two distinct self-referential objects compared to each other.** `x.self = x`,
    `y.self = y` (two different objects, each cyclic in the same shape), `equal(x, y)`:
    comparing `x.self` against `y.self` re-enters `equal(x, y)` — the same top-level pair —
    already marked `visiting` → `false`. Distinct from scenario 61 (the *same* object on
    both sides); this is two *different* self-referential objects, still correctly
    rejected.
77. **Huge-`length`, mostly-sparse array.** An array reporting `length: 2**32 - 2` via its
    own `"length"` descriptor but with only three real own index keys: `inspectArray`
    partitions `Reflect.ownKeys` (bounded by the real key count — four, including
    `"length"`) into index candidates, finds `indexEntries.length` (3) does not equal the
    claimed `length`, and rejects — **without ever iterating from `0` to `2**32 - 2`**,
    asserted by bounding the test's own timeout/iteration count independent of the claimed
    length (this revision's specific correction; the prior comparator would have looped the
    full claimed length before discovering the mismatch).
78. **Proxy whose `get` trap throws, while `getPrototypeOf`/`ownKeys`/
    `getOwnPropertyDescriptor` are all permitted.** `inspectArray`/`compareObjects` reject
    or accept the value using only descriptor-derived data — the `get` trap is asserted,
    via a spy, to be **invoked zero times** — this is the exact defect this revision
    corrects (a prior comparator read `array.length`/`array[i]` live, which would have
    triggered this trap and thrown).
79. **Array with an exotic (non-`Array.prototype`) prototype.** `Object.setPrototypeOf(arr,
    {})`, or an instance of a class extending `Array`: `inspectArray`'s
    `Object.getPrototypeOf(arr) !== Array.prototype` check rejects it → `false`.
80. **Object with an accessor property.** `Object.defineProperty(obj, "k", { get() { return
    1; }, enumerable: true })`: `compareObjects` finds the descriptor has no `"value"` and
    rejects → `false`, with the getter's call count asserted to be zero.

Every scenario in this section, like every scenario above it, ends with exactly one
durable state, one exact authority, one exact write disposition, one exact public outcome,
and one exact retry/reload/reconciliation action.

---

## §write_protected timing — precise sequencing

**New in this revision**, per the corrected distinction already used throughout: startup
authority resolution reads the required keys *first*; a read failure there returns
`blocked: storage_unavailable` and constructs no repository at all. **Only after**
authority resolves successfully and a repository is constructed does the pre-existing
concept of `write_protected` (ADR-0013, unchanged) ever apply — to a **later**, independent
storage failure discovered during that already-constructed repository's own hydration or a
subsequent mutation. A repository is never described as "already hydrated with
`read_failed`" as a substitute for authority resolution having failed — those are sequenced,
distinct steps. (Implementation may reuse the resolver's own committed-target reads,
Decision 12, as the repository's initial hydration rather than reading twice — an
efficiency detail, not an architectural requirement.)

---

## 19. Version namespaces

Nine independently-tracked "version" concepts, none cross-referenced or derived from
another: the legacy combined persisted-state schema (`ASSESSMENT_PERSISTENCE_SCHEMA_VERSION`,
unchanged), `assessmentDraft`'s and `assessmentHistory`'s own persisted-state schema
versions (new, each `1`), the split-layout establishment protocol version
(`ASSESSMENT_AUTHORITY_SPLIT_PROTOCOL_VERSION`, new), the per-run `AssessmentRun` schema
(`ASSESSMENT_RUN_SCHEMA_VERSION`, unchanged), ADR-0016's migration protocol version and
ADR-0017's activation protocol version (both existing, unrelated), and ADR-0019's/ADR-0020's
own client source-contract and server canonical-mapping versions for a future
`assessmentHistory` registration — the latter two are **independently assigned**, never
required to equal `AssessmentHistoryPersistedState.schemaVersion`, even where their first
numeric values happen to coincide. This ADR assigns no cloud protocol-registry version.

---

## Implementation sequence (future work — not performed by this ADR)

**Reordered in this revision** so mutation-idempotency and stale-current-build fencing exist
before any live wiring — split authority must never be wired ahead of these.

1. **Accept the corrected ADR-0021.**
2. **Strict total validators** (Decision 4.0.1/10/12) — evidence union, legacy root,
   target-state pair, `AssessmentRun` structural checks. Pure, no I/O.
3. **Canonical exact-run serialization/equality** (Decision 1.1) — replacing every prior
   fingerprint-based run comparison.
4. **The unified mutation runner and opaque context** (Decision 8), tested against a fake
   lock, independent of any repository — including the exactly-once-acquisition proof.
5. **Authority-aware legacy mutations** — wrap the existing `AssessmentRepository`'s writes
   to go through the unified runner and authority check, before anything else changes.
6. **Operation-level idempotency and unknown-outcome handling** (Decision 15) as its own
   tested layer, before any repository uses it.
7. **The evidence union and total validators wired to real storage** (Decision 4.0).
8. **Fresh initialization** (Decision 4.1).
9. **Legacy migration** (Decision 4.2).
10. **Prepared recovery and drift/supersession** (Decision 4.3/4.4), including the mandatory
    automatic restart.
11. **The total authority resolver** (Decision 7), including the write-disposition model
    (Decision 13).
12. **Committed target-pair validation** (Decision 12), wired into the resolver, the
    mutation runner's authority check, and post-mutation re-verification.
13. **Crash, concurrency, and hostile-value tests** (Decision 18, in full) before any UI
    wiring.
14. **Remove eager combined-repository construction.**
15. **Atomic startup/UI wiring** — repository construction gated on the resolver's result,
    reflecting disposition structurally (writable vs. read-only).
16. **The archive coordinator** (Decision 14), using only context-bound internal
    operations.
17. **Update ADR-0016 domain registrations** to separate `assessmentDraft`/
    `assessmentHistory` units.
18. **Architecture-boundary enforcement** — reject a reintroduced combined writable
    repository; reject any public method that acquires the lease and then calls another
    lease-acquiring method.
19. **Satisfy the separate production deployment/old-build gate** before automatic
    fresh-initialization/migration execution is enabled for all users — this ADR does not
    make this decision.
20. **Separately design ordinary cloud history mutation APIs** for `assessmentHistory`,
    including their own concurrency protocol (Decision 8.1) — distinct future work.
21. **Satisfy every remaining ADR-0019/ADR-0020 gate**, then, **only then**, consider an
    Assessment cloud pilot.

---

## Consequences

- `assessmentDraft`/`assessmentHistory` become the two authoritative Assessment
  persistence names going forward.
- A future implementation project budgets for: two new repository modules
  (operation-level, non-reentrant, idempotency-aware), one new evidence/establishment
  module (with drift/supersession handling), one new unified mutation-runner module, one
  new authority-resolution module (with pair validation and write disposition), and updated
  tests across every existing Assessment-persistence test file.
- The legacy key becomes residue expected to remain present and fingerprint-matching for
  `legacy_migration`-origin splits (not merely tolerated if deleted); its eventual, policy-
  governed cleanup remains a distinct, future, undesigned decision.
- No user-visible behavior changes, and no runtime code changes, result from accepting
  this ADR.

## Relationship to existing ADRs

- **ADR-0010** — the precedent for Assessment's own, independent `localStorage` key.
- **ADR-0013** — the repository-boundary pattern this ADR extends with operation-level,
  non-reentrant, idempotency-aware interfaces, and whose `write_protected` concept this ADR
  is careful never to conflate with its own `blocked: storage_unavailable`.
- **ADR-0014** — the history-first archive-and-clear precedent this ADR's Decision 14
  applies across two independent domains, now with exact canonical equality and
  single-lease-entry non-reentrancy.
- **ADR-0016** — untouched; its existing marker cannot be reinterpreted to cover the split.
- **ADR-0017/ADR-0018** — the source of this ADR's fingerprinting technique (retained,
  narrowly, for split-evidence records only — Decision 1.1/4), prepared/committed pattern,
  Web Locks lease pattern, and "technical elimination vs. explicit residual-risk acceptance
  vs. governance resolution" framing — credited, never claimed as implemented dependencies.
- **ADR-0019/ADR-0020** — this ADR resolves Decision D in full and names, without
  resolving, every other independent blocker those ADRs already establish.
